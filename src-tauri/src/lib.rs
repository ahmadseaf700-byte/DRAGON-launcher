use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::{collections::HashMap, fs, io::{self, Read, Write}, net::{TcpStream, ToSocketAddrs}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{Mutex, OnceLock}, time::{Duration, Instant}};
use sysinfo::System;
use tauri::{Emitter, Manager};
use zip::ZipArchive;

#[derive(Serialize)]
struct SystemEnvironment {
    os: String,
    arch: String,
    total_ram_mb: u64,
    launcher_dir: String,
}

fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir()
        .map_err(|error| format!("Could not resolve app config directory: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create app config directory: {error}"))?;
    Ok(dir.join("config.json"))
}

fn launcher_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "Could not resolve application data directory".to_string())?;
    let dir = base.join("DRAGONLauncher");
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create launcher data directory: {error}"))?;
    Ok(dir)
}

fn allowed_mojang_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| format!("Invalid download URL: {e}"))?;
    let host = url.host_str().unwrap_or_default();
    let allowed = ["piston-meta.mojang.com", "piston-data.mojang.com", "launcher.mojang.com",
        "libraries.minecraft.net", "resources.download.minecraft.net"];
    if url.scheme() != "https" || !allowed.contains(&host) {
        return Err(format!("Refusing download from untrusted host: {host}"));
    }
    Ok(url)
}

async fn fetch_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let url = allowed_mojang_url(url)?;
    let response = client.get(url).send().await.map_err(|e| format!("Metadata request failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("Metadata server returned HTTP {}", response.status())); }
    response.json::<Value>().await.map_err(|e| format!("Invalid Mojang JSON: {e}"))
}

async fn download_verified(client: &reqwest::Client, url: &str, destination: &Path, expected_sha1: Option<&str>) -> Result<u64, String> {
    if destination.exists() {
        if let Some(expected) = expected_sha1 {
            let existing = fs::read(destination).map_err(|e| format!("Could not inspect cached file: {e}"))?;
            let digest = format!("{:x}", Sha1::digest(&existing));
            if digest.eq_ignore_ascii_case(expected) { return Ok(existing.len() as u64); }
        } else if fs::metadata(destination).map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(fs::metadata(destination).map(|m| m.len()).unwrap_or(0));
        }
    }
    let url = allowed_mojang_url(url)?;
    let response = client.get(url).send().await.map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() { return Err(format!("Download server returned HTTP {}", response.status())); }
    let bytes = response.bytes().await.map_err(|e| format!("Could not read download: {e}"))?;
    if bytes.is_empty() { return Err("Server returned an empty file".to_string()); }
    if let Some(expected) = expected_sha1 {
        let actual = format!("{:x}", Sha1::digest(&bytes));
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!("SHA-1 verification failed for {}", destination.display()));
        }
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create download directory: {e}"))?;
    }
    let temporary = destination.with_extension("dragon-download.tmp");
    fs::write(&temporary, &bytes).map_err(|e| format!("Could not write download: {e}"))?;
    if destination.exists() {
        fs::remove_file(destination).map_err(|e| format!("Could not replace cached file: {e}"))?;
    }
    fs::rename(&temporary, destination).map_err(|e| format!("Could not finalize download: {e}"))?;
    Ok(bytes.len() as u64)
}

fn library_allowed(library: &Value) -> bool {
    let Some(rules) = library.get("rules").and_then(Value::as_array) else { return true; };
    let os = match std::env::consts::OS { "windows" => "windows", "macos" => "osx", "linux" => "linux", _ => "unsupported" };
    let arch = std::env::consts::ARCH;
    let mut allowed = false;
    for rule in rules {
        let action = rule.get("action").and_then(Value::as_str).unwrap_or("disallow");
        let os_rule = rule.get("os");
        let name_matches = os_rule.and_then(|v| v.get("name")).and_then(Value::as_str)
            .map(|name| name == os).unwrap_or(true);
        let arch_matches = os_rule.and_then(|v| v.get("arch")).and_then(Value::as_str)
            .map(|expected| expected == arch || (expected == "x86" && arch == "x86")).unwrap_or(true);
        if name_matches && arch_matches { allowed = action == "allow"; }
    }
    allowed
}

fn safe_relative_path(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if path.is_absolute() || path.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err("Unsafe relative path in Mojang metadata".to_string());
    }
    Ok(path.to_path_buf())
}


fn native_classifier_key(library: &Value) -> Option<String> {
    let os = match std::env::consts::OS {
        "windows" => "windows", "macos" => "osx", "linux" => "linux", _ => return None
    };
    let base = library.get("natives")?.get(os)?.as_str()?;
    let arch = match std::env::consts::ARCH {
        "x86_64" => "64", "x86" => "32", "aarch64" => "arm64", _ => return None
    };
    let expanded = base.replace("${arch}", if arch == "arm64" { "64" } else { arch });
    let classifiers = library.pointer("/downloads/classifiers")?.as_object()?;
    let mut candidates = vec![expanded.clone()];
    if arch == "arm64" {
        candidates.insert(0, format!("{base}-arm64"));
    } else {
        candidates.insert(0, format!("{base}-{arch}"));
    }
    candidates.into_iter().find(|key| classifiers.contains_key(key))
}

fn extract_native_archive(archive_path: &Path, destination: &Path, excludes: &[String]) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|e| format!("Could not open native archive: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid native archive: {e}"))?;
    fs::create_dir_all(destination).map_err(|e| format!("Could not create natives directory: {e}"))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| format!("Could not read native archive entry: {e}"))?;
        let entry_name = entry.name().replace('\\', "/");
        let Ok(relative) = safe_relative_path(&entry_name) else { continue; };
        let normalized = relative.to_string_lossy().replace('\\', "/");
        if normalized.split('/').any(|part| part == "META-INF") ||
            excludes.iter().any(|excluded| normalized == *excluded || normalized.starts_with(&format!("{}/", excluded.trim_end_matches('/')))) {
            continue;
        }
        #[cfg(unix)]
        if entry.unix_mode().map(|mode| (mode & 0o170000) == 0o120000).unwrap_or(false) { continue; }
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|e| format!("Could not create native subdirectory: {e}"))?;
        } else {
            if let Some(parent) = output.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            let mut out = fs::File::create(&output).map_err(|e| format!("Could not write native file: {e}"))?;
            io::copy(&mut entry, &mut out).map_err(|e| format!("Could not extract native file: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn is_minecraft_version_installed(version_id: String) -> Result<bool, String> {
    if version_id.is_empty() || version_id.len() > 64
        || !version_id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        return Err("Invalid Minecraft version identifier".to_string());
    }

    let root = launcher_data_dir()?.join("game");
    let version_dir = root.join("versions").join(&version_id);
    let metadata_path = version_dir.join(format!("{version_id}.json"));
    let client_jar = version_dir.join(format!("{version_id}.jar"));
    if !metadata_path.is_file() || !client_jar.is_file() {
        return Ok(false);
    }

    let metadata: Value = match fs::read(&metadata_path)
        .ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()) {
        Some(value) => value,
        None => return Ok(false),
    };

    // A launcher must not mark an instance ready when its classpath is incomplete.
    if let Some(libraries) = metadata.get("libraries").and_then(Value::as_array) {
        for library in libraries.iter().filter(|item| library_allowed(item)) {
            if let Some(path) = library.pointer("/downloads/artifact/path").and_then(Value::as_str) {
                let relative = safe_relative_path(path)?;
                if !root.join("libraries").join(relative).is_file() {
                    return Ok(false);
                }
            }
            if let Some(key) = native_classifier_key(library) {
                if let Some(path) = library.pointer(&format!("/downloads/classifiers/{key}/path")).and_then(Value::as_str) {
                    let relative = safe_relative_path(path)?;
                    if !root.join("libraries").join(relative).is_file() {
                        return Ok(false);
                    }
                }
            }
        }
    }

    if let Some(asset_index) = metadata.get("assetIndex") {
        let index_id = match asset_index.get("id").and_then(Value::as_str) {
            Some(id) if !id.is_empty() && id.len() <= 80 => id,
            _ => return Ok(false),
        };
        let index_path = root.join("assets").join("indexes").join(format!("{index_id}.json"));
        let index_data: Value = match fs::read(&index_path)
            .ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()) {
            Some(value) => value,
            None => return Ok(false),
        };
        let objects = match index_data.get("objects").and_then(Value::as_object) {
            Some(objects) => objects,
            None => return Ok(false),
        };
        for object in objects.values() {
            let hash = match object.get("hash").and_then(Value::as_str) {
                Some(hash) if hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit()) => hash,
                _ => return Ok(false),
            };
            if !root.join("assets").join("objects").join(&hash[0..2]).join(hash).is_file() {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

#[derive(Serialize)]
struct InstallResult { version: String, game_directory: String, downloaded_bytes: u64, libraries: usize, natives: usize, assets: usize }

#[tauri::command]
async fn install_minecraft_version(app: tauri::AppHandle, version_id: String) -> Result<InstallResult, String> {
    if version_id.is_empty() || version_id.len() > 64 ||
       !version_id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        return Err("Invalid Minecraft version identifier".to_string());
    }
    let client = reqwest::Client::builder().user_agent("DRAGON-Launcher/0.1.0").build()
        .map_err(|e| format!("Could not initialize downloader: {e}"))?;
    let root = launcher_data_dir()?.join("game");
    fs::create_dir_all(&root).map_err(|e| format!("Could not create game directory: {e}"))?;
    let manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let manifest = fetch_json(&client, manifest_url).await?;
    let versions = manifest.get("versions").and_then(Value::as_array)
        .ok_or_else(|| "Mojang version manifest has no versions list".to_string())?;
    let entry = versions.iter().find(|v| v.get("id").and_then(Value::as_str) == Some(version_id.as_str()))
        .ok_or_else(|| format!("Version {version_id} was not found in Mojang's manifest"))?;
    let metadata_url = entry.get("url").and_then(Value::as_str).ok_or("Version metadata URL is missing")?;
    let metadata = fetch_json(&client, metadata_url).await?;
    let version_dir = root.join("versions").join(&version_id);
    fs::create_dir_all(&version_dir).map_err(|e| format!("Could not create version directory: {e}"))?;
    let metadata_bytes = serde_json::to_vec_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(version_dir.join(format!("{version_id}.json")), metadata_bytes)
        .map_err(|e| format!("Could not save version metadata: {e}"))?;

    let mut total_bytes = 0u64;
    let client_download = metadata.get("downloads").and_then(|v| v.get("client"))
        .ok_or_else(|| "This version does not provide a client download".to_string())?;
    let client_url = client_download.get("url").and_then(Value::as_str).ok_or("Client URL is missing")?;
    let client_sha1 = client_download.get("sha1").and_then(Value::as_str);
    total_bytes += download_verified(&client, client_url, &version_dir.join(format!("{version_id}.jar")), client_sha1).await?;
    let _ = app.emit("minecraft-install-progress", json!({"version":version_id,"stage":"client","done":1,"total":1}));

    let libraries = metadata.get("libraries").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut installed_libraries = 0usize;
    let mut installed_natives = 0usize;
    let natives_dir = root.join("versions").join(&version_id).join("natives");
    for library in libraries.iter().filter(|library| library_allowed(library)) {
        if let Some(classifier_key) = native_classifier_key(library) {
            if let Some(classifier) = library.pointer(&format!("/downloads/classifiers/{classifier_key}")) {
                if let (Some(url), Some(path)) = (classifier.get("url").and_then(Value::as_str), classifier.get("path").and_then(Value::as_str)) {
                    let relative = safe_relative_path(path)?;
                    let archive_path = root.join("libraries").join(relative);
                    let sha = classifier.get("sha1").and_then(Value::as_str);
                    total_bytes += download_verified(&client, url, &archive_path, sha).await?;
                    let excludes = library.pointer("/extract/exclude").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>()).unwrap_or_default();
                    extract_native_archive(&archive_path, &natives_dir, &excludes)?;
                    installed_natives += 1;
                    let _ = app.emit("minecraft-install-progress", json!({"version":version_id,"stage":"natives","done":installed_natives,"total":libraries.len()}));
                }
            }
        }
        if let Some(artifact) = library.pointer("/downloads/artifact") {
            if let (Some(url), Some(path)) = (artifact.get("url").and_then(Value::as_str), artifact.get("path").and_then(Value::as_str)) {
                let relative = safe_relative_path(path)?;
                let sha = artifact.get("sha1").and_then(Value::as_str);
                total_bytes += download_verified(&client, url, &root.join("libraries").join(relative), sha).await?;
                installed_libraries += 1;
                if installed_libraries % 10 == 0 {
                    let _ = app.emit("minecraft-install-progress", json!({"version":version_id,"stage":"libraries","done":installed_libraries,"total":libraries.len()}));
                }
            }
        }
    }

    let mut asset_count = 0usize;
    if let Some(index) = metadata.get("assetIndex") {
        let index_url = index.get("url").and_then(Value::as_str).ok_or("Asset index URL is missing")?;
        let index_id = index.get("id").and_then(Value::as_str).ok_or("Asset index ID is missing")?;
        let index_sha = index.get("sha1").and_then(Value::as_str);
        let index_path = root.join("assets").join("indexes").join(format!("{index_id}.json"));
        total_bytes += download_verified(&client, index_url, &index_path, index_sha).await?;
        let index_data: Value = serde_json::from_slice(&fs::read(&index_path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid asset index: {e}"))?;
        let objects = index_data.get("objects").and_then(Value::as_object).ok_or("Asset index has no objects")?;
        for object in objects.values() {
            let hash = object.get("hash").and_then(Value::as_str).ok_or("Asset hash is missing")?;
            if hash.len() != 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) { return Err("Invalid asset hash".to_string()); }
            let url = format!("https://resources.download.minecraft.net/{}/{}", &hash[0..2], hash);
            let destination = root.join("assets").join("objects").join(&hash[0..2]).join(hash);
            total_bytes += download_verified(&client, &url, &destination, Some(hash)).await?;
            asset_count += 1;
            if asset_count % 100 == 0 {
                let _ = app.emit("minecraft-install-progress", json!({"version":version_id,"stage":"assets","done":asset_count,"total":objects.len()}));
            }
        }
    }
    if !is_minecraft_version_installed(version_id.clone())? {
        return Err("اكتمل التنزيل لكن فحص الملفات كشف أن بعض ملفات Minecraft أو المكتبات أو الأصول ما زالت ناقصة. أعد المحاولة.".to_string());
    }
    let _ = app.emit("minecraft-install-progress", json!({"version":version_id,"stage":"complete","done":1,"total":1}));
    Ok(InstallResult { version: version_id, game_directory: root.to_string_lossy().into_owned(),
        downloaded_bytes: total_bytes, libraries: installed_libraries, natives: installed_natives, assets: asset_count })
}


fn argument_rules_allow(item: &Value) -> bool {
    let Some(rules) = item.get("rules").and_then(Value::as_array) else { return true; };
    let os = match std::env::consts::OS {
        "windows" => "windows", "macos" => "osx", "linux" => "linux", _ => "unsupported"
    };
    let arch = std::env::consts::ARCH;
    let mut allowed = false;
    for rule in rules {
        let os_rule = rule.get("os");
        let os_match = os_rule.and_then(|v| v.get("name")).and_then(Value::as_str)
            .map(|name| name == os).unwrap_or(true)
            && os_rule.and_then(|v| v.get("arch")).and_then(Value::as_str)
                .map(|value| value == arch || (value == "x86" && arch == "x86")).unwrap_or(true);
        let features_match = rule.get("features").and_then(Value::as_object).map(|features| {
            features.iter().all(|(_, expected)| expected.as_bool() == Some(false))
        }).unwrap_or(true);
        if os_match && features_match {
            allowed = rule.get("action").and_then(Value::as_str) == Some("allow");
        }
    }
    allowed
}

fn collect_argument_values(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::String(text) => output.push(text.clone()),
        Value::Object(_) if argument_rules_allow(value) => {
            if let Some(value) = value.get("value") {
                match value {
                    Value::String(text) => output.push(text.clone()),
                    Value::Array(items) => output.extend(items.iter().filter_map(Value::as_str).map(str::to_string)),
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

#[derive(Serialize)]
struct LaunchResult { pid: u32, log_file: String, java_executable: String }

static GAME_PROCESSES: OnceLock<Mutex<HashMap<u32, Child>>> = OnceLock::new();

fn game_processes() -> &'static Mutex<HashMap<u32, Child>> {
    GAME_PROCESSES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize)]
struct GameProcessStatus {
    pid: u32,
    running: bool,
    exit_code: Option<i32>,
}

#[tauri::command]
fn get_game_process_status(pid: u32) -> Result<GameProcessStatus, String> {
    let mut processes = game_processes().lock().map_err(|_| "تعذر الوصول إلى قائمة عمليات اللعبة.".to_string())?;
    let Some(child) = processes.get_mut(&pid) else {
        return Ok(GameProcessStatus { pid, running: false, exit_code: None });
    };
    match child.try_wait().map_err(|e| format!("تعذر فحص عملية اللعبة: {e}"))? {
        None => Ok(GameProcessStatus { pid, running: true, exit_code: None }),
        Some(status) => {
            let code = status.code();
            processes.remove(&pid);
            Ok(GameProcessStatus { pid, running: false, exit_code: code })
        }
    }
}

#[tauri::command]
fn stop_game_process(pid: u32) -> Result<GameProcessStatus, String> {
    let mut processes = game_processes().lock().map_err(|_| "تعذر الوصول إلى قائمة عمليات اللعبة.".to_string())?;
    let Some(child) = processes.get_mut(&pid) else {
        return Ok(GameProcessStatus { pid, running: false, exit_code: None });
    };
    if let Some(status) = child.try_wait().map_err(|e| format!("تعذر فحص عملية اللعبة: {e}"))? {
        let code = status.code();
        processes.remove(&pid);
        return Ok(GameProcessStatus { pid, running: false, exit_code: code });
    }
    child.kill().map_err(|e| format!("تعذر إيقاف Minecraft: {e}"))?;
    let status = child.wait().map_err(|e| format!("تعذر تأكيد إيقاف Minecraft: {e}"))?;
    processes.remove(&pid);
    Ok(GameProcessStatus { pid, running: false, exit_code: status.code() })
}

#[tauri::command]
fn launch_minecraft(
    app: tauri::AppHandle,
    version_id: String,
    player_name: String,
    player_uuid: String,
    ram_mb: u64
) -> Result<LaunchResult, String> {
    if std::env::consts::OS == "android" {
        return Err("تشغيل Minecraft Java مباشرة على Android غير مدعوم بهذا البناء؛ يلزم Runtime وطبقة توافق Android مخصصة.".to_string());
    }
    if !player_name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        || player_name.is_empty() || player_name.len() > 16 {
        return Err("Invalid local player name".to_string());
    }
    let digest = md5::compute(format!("OfflinePlayer:{player_name}"));
    let mut uuid_bytes = digest.0;
    uuid_bytes[6] = (uuid_bytes[6] & 0x0f) | 0x30;
    uuid_bytes[8] = (uuid_bytes[8] & 0x3f) | 0x80;
    let uuid_clean = uuid_bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let _ = player_uuid;
    if version_id.is_empty() || version_id.len() > 64
        || !version_id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        return Err("Invalid Minecraft version identifier".to_string());
    }

    if !is_minecraft_version_installed(version_id.clone())? {
        return Err("ملفات هذا الإصدار أو إحدى المكتبات أو أصول اللعبة ناقصة. أعد تثبيت الإصدار قبل التشغيل.".to_string());
    }
    let root = launcher_data_dir()?.join("game");
    let version_dir = root.join("versions").join(&version_id);
    let metadata_path = version_dir.join(format!("{version_id}.json"));
    let client_jar = version_dir.join(format!("{version_id}.jar"));
    let metadata: Value = serde_json::from_slice(&fs::read(&metadata_path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid version metadata: {e}"))?;
    let app_config = config_file(&app)?;
    let config: Value = if app_config.exists() {
        serde_json::from_slice(&fs::read(&app_config).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid launcher config: {e}"))?
    } else { json!({}) };
    let java_path = config.get("java_path").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).unwrap_or("java");
    let java_check = Command::new(java_path).arg("-version").output()
        .map_err(|e| format!("تعذر العثور على Java ({java_path}). ثبّت Java أو حدّد مسارها من الإعدادات: {e}"))?;
    if !java_check.status.success() {
        return Err(format!("Java لم تستجب لأمر فحص الإصدار: {}", String::from_utf8_lossy(&java_check.stderr)));
    }
    let java_output = format!("{}{}", String::from_utf8_lossy(&java_check.stdout), String::from_utf8_lossy(&java_check.stderr));
    let java_version_text = java_output.split('"').nth(1)
        .ok_or_else(|| "تعذر قراءة إصدار Java المثبّت.".to_string())?;
    let java_major = if java_version_text.starts_with("1.") {
        java_version_text.split('.').nth(1).and_then(|v| v.parse::<u32>().ok())
    } else {
        java_version_text.split('.').next().and_then(|v| v.parse::<u32>().ok())
    }.ok_or_else(|| format!("تعذر تحليل إصدار Java: {java_version_text}"))?;
    if let Some(required) = metadata.pointer("/javaVersion/majorVersion").and_then(Value::as_u64) {
        if (java_major as u64) < required {
            return Err(format!("هذا الإصدار يحتاج Java {required} أو أحدث، بينما المثبّت هو Java {java_major}."));
        }
    }
    let game_dir = config.get("game_directory").and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| root.clone());
    fs::create_dir_all(&game_dir).map_err(|e| format!("Could not create game directory: {e}"))?;

    let mut classpath_entries: Vec<String> = Vec::new();
    if let Some(libraries) = metadata.get("libraries").and_then(Value::as_array) {
        for library in libraries.iter().filter(|item| library_allowed(item)) {
            if let Some(path) = library.pointer("/downloads/artifact/path").and_then(Value::as_str) {
                let rel = safe_relative_path(path)?;
                let artifact = root.join("libraries").join(rel);
                if !artifact.is_file() {
                    return Err(format!("مكتبة Minecraft المطلوبة غير موجودة: {}", artifact.display()));
                }
                classpath_entries.push(artifact.to_string_lossy().into_owned());
            }
        }
    }
    classpath_entries.push(client_jar.to_string_lossy().into_owned());
    let classpath = classpath_entries.join(if cfg!(windows) { ";" } else { ":" });
    let assets_root = root.join("assets");
    let assets_index = metadata.pointer("/assetIndex/id").and_then(Value::as_str).unwrap_or("legacy");
    let natives_dir = version_dir.join("natives");
    let version_type = metadata.get("type").and_then(Value::as_str).unwrap_or("release");

    let mut replacements = std::collections::HashMap::<String, String>::new();
    let values = [
        ("${auth_player_name}", player_name.clone()),
        ("${version_name}", version_id.clone()),
        ("${game_directory}", game_dir.to_string_lossy().into_owned()),
        ("${assets_root}", assets_root.to_string_lossy().into_owned()),
        ("${assets_index_name}", assets_index.to_string()),
        ("${auth_uuid}", uuid_clean),
        ("${auth_access_token}", "0".to_string()),
        ("${user_type}", "legacy".to_string()),
        ("${version_type}", version_type.to_string()),
        ("${natives_directory}", natives_dir.to_string_lossy().into_owned()),
        ("${launcher_name}", "DRAGON Launcher".to_string()),
        ("${launcher_version}", "0.1.0".to_string()),
        ("${classpath}", classpath.clone()),
        ("${classpath_separator}", if cfg!(windows) { ";".to_string() } else { ":".to_string() }),
        ("${library_directory}", root.join("libraries").to_string_lossy().into_owned()),
        ("${clientid}", String::new()),
        ("${auth_xuid}", String::new()),
        ("${user_properties}", "{}".to_string()),
        ("${resolution_width}", "1280".to_string()),
        ("${resolution_height}", "720".to_string())
    ];
    for (key, value) in values { replacements.insert(key.to_string(), value); }
    let substitute = |input: &str| -> String {
        let mut result = input.to_string();
        for (key, value) in &replacements { result = result.replace(key, value); }
        result
    };

    let mut jvm_args = Vec::<String>::new();
    if let Some(items) = metadata.pointer("/arguments/jvm").and_then(Value::as_array) {
        for item in items { collect_argument_values(item, &mut jvm_args); }
    }
    for arg in &mut jvm_args { *arg = substitute(arg); }
    if !jvm_args.iter().any(|arg| arg.starts_with("-Djava.library.path=")) {
        jvm_args.push(format!("-Djava.library.path={}", natives_dir.to_string_lossy()));
    }
    if !jvm_args.iter().any(|arg| arg == "-cp" || arg == "-classpath") {
        jvm_args.push("-cp".to_string());
        jvm_args.push(classpath);
    }
    let memory = ram_mb.clamp(512, 32768);
    if !jvm_args.iter().any(|arg| arg.starts_with("-Xmx")) { jvm_args.push(format!("-Xmx{memory}M")); }
    if !jvm_args.iter().any(|arg| arg.starts_with("-Xms")) { jvm_args.push("-Xms512M".to_string()); }

    let main_class = metadata.get("mainClass").and_then(Value::as_str)
        .ok_or_else(|| "Minecraft metadata is missing mainClass".to_string())?;
    let mut args = jvm_args;
    args.push(main_class.to_string());
    if let Some(items) = metadata.pointer("/arguments/game").and_then(Value::as_array) {
        let mut game_args = Vec::new();
        for item in items { collect_argument_values(item, &mut game_args); }
        args.extend(game_args.into_iter().map(|arg| substitute(&arg)));
    } else if let Some(old_args) = metadata.get("minecraftArguments").and_then(Value::as_str) {
        args.extend(old_args.split_whitespace().map(substitute));
    }

    let logs_dir = game_dir.join("logs");
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    let log_path = logs_dir.join("dragon-console.log");
    let stdout = fs::OpenOptions::new().create(true).append(true).open(&log_path)
        .map_err(|e| format!("Could not open launcher output log: {e}"))?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
    let child = Command::new(java_path).args(&args).current_dir(&game_dir)
        .stdout(Stdio::from(stdout)).stderr(Stdio::from(stderr)).spawn()
        .map_err(|e| format!("تعذر تشغيل Java ({java_path}): {e}. تحقق من مسار Java وإصدارها."))?;
    let pid = child.id();
    let mut processes = game_processes().lock().map_err(|_| "تعذر تسجيل عملية Minecraft.".to_string())?;
    processes.insert(pid, child);
    Ok(LaunchResult { pid, log_file: log_path.to_string_lossy().into_owned(), java_executable: java_path.to_string() })
}


#[tauri::command]
fn list_game_instances() -> Result<Vec<Value>, String> {
    let root = launcher_data_dir()?.join("instances");
    fs::create_dir_all(&root).map_err(|e| format!("Could not create instances directory: {e}"))?;
    let mut instances = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| format!("Could not read instances: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() { continue; }
        let metadata = entry.path().join("instance.json");
        if !metadata.is_file() { continue; }
        let value: Value = serde_json::from_slice(&fs::read(metadata).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid instance metadata: {e}"))?;
        instances.push(value);
    }
    instances.sort_by(|a, b| a.get("created_at").and_then(Value::as_u64).cmp(&b.get("created_at").and_then(Value::as_u64)));
    instances.reverse();
    Ok(instances)
}

#[tauri::command]
fn create_game_instance(name: String, version_id: String) -> Result<Value, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(|c| c.is_control()) {
        return Err("اسم النسخة يجب أن يكون بين 1 و40 حرفاً.".to_string());
    }
    if version_id.is_empty() || version_id.len() > 64
        || !version_id.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        return Err("Invalid Minecraft version identifier".to_string());
    }
    let root = launcher_data_dir()?.join("instances");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let created_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_millis() as u64;
    let id = format!("{}-{}", created_at, md5::compute(format!("{name}:{version_id}:{created_at}")));
    let instance_dir = root.join(&id);
    fs::create_dir_all(&instance_dir).map_err(|e| e.to_string())?;
    for folder in ["mods", "config", "resourcepacks", "shaderpacks", "saves", "screenshots", "logs", "crash-reports"] {
        fs::create_dir_all(instance_dir.join(folder)).map_err(|e| e.to_string())?;
    }
    let value = json!({
        "id": id,
        "name": name,
        "version_id": version_id,
        "created_at": created_at,
        "game_directory": instance_dir.to_string_lossy()
    });
    let bytes = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    let temporary = instance_dir.join("instance.json.tmp");
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(temporary, instance_dir.join("instance.json")).map_err(|e| e.to_string())?;
    Ok(value)
}

#[tauri::command]
fn delete_game_instance(instance_id: String) -> Result<(), String> {
    if instance_id.is_empty() || instance_id.len() > 100
        || !instance_id.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c)) {
        return Err("Invalid instance identifier".to_string());
    }
    let root = launcher_data_dir()?.join("instances");
    let target = root.join(&instance_id);
    if !target.exists() { return Err("النسخة المطلوبة غير موجودة.".to_string()); }
    let metadata: Value = serde_json::from_slice(&fs::read(target.join("instance.json"))
        .map_err(|e| format!("Cannot verify instance metadata: {e}"))?)
        .map_err(|e| format!("Invalid instance metadata: {e}"))?;
    if metadata.get("id").and_then(Value::as_str) != Some(instance_id.as_str()) {
        return Err("Instance identity verification failed".to_string());
    }
    fs::remove_dir_all(target).map_err(|e| format!("Could not delete instance: {e}"))
}


#[tauri::command]
fn rename_game_instance(instance_id: String, name: String) -> Result<Value, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(|c| c.is_control()) {
        return Err("اسم النسخة يجب أن يكون بين 1 و40 حرفاً.".to_string());
    }
    let root = launcher_data_dir()?.join("instances");
    let target = root.join(&instance_id);
    if !target.join("instance.json").is_file() { return Err("النسخة المطلوبة غير موجودة.".to_string()); }
    let mut value: Value = serde_json::from_slice(&fs::read(target.join("instance.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if value.get("id").and_then(Value::as_str) != Some(instance_id.as_str()) {
        return Err("Instance identity verification failed".to_string());
    }
    value["name"] = Value::String(name.to_string());
    let temp = target.join("instance.json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(temp, target.join("instance.json")).map_err(|e| e.to_string())?;
    Ok(value)
}

#[tauri::command]
fn open_instance_folder(instance_id: String, folder: String) -> Result<(), String> {
    let allowed = ["", "mods", "config", "resourcepacks", "shaderpacks", "saves", "screenshots", "logs", "crash-reports"];
    if !allowed.contains(&folder.as_str()) { return Err("Invalid instance folder".to_string()); }
    let target = launcher_data_dir()?.join("instances").join(&instance_id);
    if !target.join("instance.json").is_file() { return Err("النسخة المطلوبة غير موجودة.".to_string()); }
    let path = if folder.is_empty() { target } else { target.join(folder) };
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(&path).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&path).spawn();
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
    let result = Command::new("xdg-open").arg(&path).spawn();
    #[cfg(target_os = "android")]
    return Err("فتح مجلدات النسخ من واجهة Android غير متاح في هذا البناء.".to_string());
    #[cfg(not(target_os = "android"))]
    result.map(|_| ()).map_err(|e| format!("تعذر فتح المجلد: {e}"))
}

#[tauri::command]
fn get_system_environment() -> Result<SystemEnvironment, String> {
    let mut system = System::new();
    system.refresh_memory();
    let total_ram_mb = system.total_memory() / (1024 * 1024);
    let launcher_dir = launcher_data_dir()?;
    Ok(SystemEnvironment { os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(), total_ram_mb,
        launcher_dir: launcher_dir.to_string_lossy().into_owned() })
}

#[tauri::command]
fn load_launcher_config(app: tauri::AppHandle) -> Result<Value, String> {
    let path = config_file(&app)?;
    if !path.exists() { return Ok(json!({"ram_mb":4096,"game_directory":"","java_path":"",
        "window_width":1280,"window_height":720,"language":"ar"})); }
    let content = fs::read_to_string(&path).map_err(|e| format!("Could not read config.json: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("config.json contains invalid JSON: {e}"))
}

#[tauri::command]
fn save_launcher_config(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    let path = config_file(&app)?;
    let serialized = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serialized).map_err(|e| format!("Could not write launcher settings: {e}"))?;
    fs::rename(&temporary, &path).map_err(|e| format!("Could not replace config.json: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn download_modrinth_file(app: tauri::AppHandle, url: String, filename: String, kind: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid download URL: {e}"))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("cdn.modrinth.com") {
        return Err("Downloads are only allowed from the official Modrinth CDN over HTTPS".to_string());
    }
    let safe_name = Path::new(&filename).file_name().and_then(|n| n.to_str()).ok_or("Invalid download filename")?;
    if safe_name != filename || filename.contains('/') || filename.contains('\\') { return Err("Invalid download filename".to_string()); }
    let folder = match kind.as_str() { "mod" if filename.to_ascii_lowercase().ends_with(".jar") => "mods",
        "modpack" if filename.to_ascii_lowercase().ends_with(".mrpack") => "modpacks",
        _ => return Err("File type does not match selected project type".to_string()) };
    // Do not follow redirects: a trusted CDN URL must not be able to redirect the
    // launcher to an unrelated host. Stream with a hard size cap to avoid unbounded
    // memory use when a response omits Content-Length.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(900))
        .build().map_err(|e| format!("Could not initialize Modrinth downloader: {e}"))?;
    let mut response = client.get(parsed).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err(format!("Modrinth CDN returned HTTP {}", response.status())); }
    let max_bytes: usize = if kind == "mod" { 100 * 1024 * 1024 } else { 512 * 1024 * 1024 };
    if response.content_length().map(|length| length > max_bytes as u64).unwrap_or(false) {
        return Err("The selected Modrinth file exceeds the allowed download size".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err("The selected Modrinth file exceeds the allowed download size".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() { return Err("The downloaded file is empty".to_string()); }
    let data_dir = launcher_data_dir()?;
    let config_path = config_file(&app)?;
    let config: Value = if config_path.exists() { serde_json::from_slice(&fs::read(config_path).map_err(|e| e.to_string())?).unwrap_or_else(|_| json!({})) } else { json!({}) };
    let game_dir = config.get("game_directory").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| data_dir.join("game"));
    let base = if kind == "mod" { game_dir.join(folder) } else { data_dir.join(folder) };
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let mut destination = base.join(&filename);
    if destination.exists() {
        let stem = Path::new(&filename).file_stem().and_then(|v| v.to_str()).unwrap_or("download");
        let extension = Path::new(&filename).extension().and_then(|v| v.to_str()).unwrap_or("");
        let mut index = 2u32;
        loop {
            let candidate = if extension.is_empty() {
                format!("{stem}-{index}")
            } else {
                format!("{stem}-{index}.{extension}")
            };
            destination = base.join(candidate);
            if !destination.exists() { break; }
            index += 1;
            if index > 10_000 { return Err("Too many files with the same name".to_string()); }
        }
    }
    let temporary = destination.with_extension(format!("{}.part", destination.extension().and_then(|v| v.to_str()).unwrap_or("download")));
    fs::write(&temporary, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &destination).map_err(|e| format!("Could not finalize Modrinth download: {e}"))?;
    Ok(destination.to_string_lossy().into_owned())
}


#[tauri::command]
fn import_external_mod(app: tauri::AppHandle, filename: String, data_base64: String) -> Result<String, String> {
    if filename.len() > 180 || !filename.to_ascii_lowercase().ends_with(".jar")
        || filename.contains('/') || filename.contains('\\')
        || filename == "." || filename == ".." {
        return Err("Choose a valid .jar mod file".to_string());
    }
    if data_base64.len() > 140_000_000 {
        return Err("Mod file exceeds the 100 MB import limit".to_string());
    }
    let bytes = BASE64.decode(data_base64).map_err(|_| "Invalid encoded file data".to_string())?;
    if bytes.len() < 4 || bytes.len() > 100 * 1024 * 1024 || &bytes[0..2] != b"PK" {
        return Err("The selected file is not a valid JAR/ZIP archive or exceeds 100 MB".to_string());
    }
    let data_dir = launcher_data_dir()?;
    let config_path = config_file(&app)?;
    let config: Value = if config_path.exists() { serde_json::from_slice(&fs::read(config_path).map_err(|e| e.to_string())?).unwrap_or_else(|_| json!({})) } else { json!({}) };
    let game_dir = config.get("game_directory").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| data_dir.join("game"));
    let mods_dir = game_dir.join("mods");
    fs::create_dir_all(&mods_dir).map_err(|e| format!("Could not create mods folder: {e}"))?;
    let mut destination = mods_dir.join(&filename);
    if destination.exists() {
        let stem = Path::new(&filename).file_stem().and_then(|v| v.to_str()).unwrap_or("mod");
        let mut index = 2u32;
        loop {
            destination = mods_dir.join(format!("{stem}-{index}.jar"));
            if !destination.exists() { break; }
            index += 1;
            if index > 10_000 { return Err("Too many files with the same name".to_string()); }
        }
    }
    fs::write(&destination, bytes).map_err(|e| format!("Could not save imported mod: {e}"))?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_game_log(app: tauri::AppHandle) -> Result<String, String> {
    let root = launcher_data_dir()?.join("game");
    let config_path = config_file(&app)?;
    let config: Value = if config_path.exists() { serde_json::from_slice(&fs::read(config_path).map_err(|e| e.to_string())?).unwrap_or_else(|_| json!({})) } else { json!({}) };
    let game_dir = config.get("game_directory").and_then(Value::as_str).filter(|s| !s.trim().is_empty()).map(PathBuf::from).unwrap_or(root);
    let mut combined = String::new();
    for (label, path) in [
        ("Minecraft latest.log", game_dir.join("logs").join("latest.log")),
        ("DRAGON console output", game_dir.join("logs").join("dragon-console.log"))
    ] {
        if path.exists() {
            let content = fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
            if !content.is_empty() {
                combined.push_str("\n===== ");
                combined.push_str(label);
                combined.push_str(" =====\n");
                combined.push_str(&content);
                combined.push('\n');
            }
        }
    }
    if combined.len() > 1_000_000 {
        let mut start = combined.len() - 1_000_000;
        while !combined.is_char_boundary(start) { start += 1; }
        combined = combined[start..].to_string();
    }
    Ok(combined)
}



#[derive(Serialize)]
struct ServerPingResult {
    online: bool,
    host: String,
    port: u16,
    latency_ms: Option<u128>,
    players_online: Option<u32>,
    players_max: Option<u32>,
    version: Option<String>,
    motd: Option<String>,
    favicon: Option<String>,
    error: Option<String>,
}

fn write_varint(mut value: i32, output: &mut Vec<u8>) {
    loop {
        if (value & !0x7f) == 0 { output.push(value as u8); return; }
        output.push(((value & 0x7f) | 0x80) as u8);
        value = ((value as u32) >> 7) as i32;
    }
}

fn read_varint<R: Read>(reader: &mut R) -> io::Result<i32> {
    let mut result = 0i32;
    for index in 0..5 {
        let mut byte = [0u8; 1];
        reader.read_exact(&mut byte)?;
        result |= ((byte[0] & 0x7f) as i32) << (7 * index);
        if byte[0] & 0x80 == 0 { return Ok(result); }
    }
    Err(io::Error::new(io::ErrorKind::InvalidData, "VarInt is too large"))
}

fn write_mc_string(value: &str, output: &mut Vec<u8>) {
    write_varint(value.len() as i32, output);
    output.extend_from_slice(value.as_bytes());
}

fn frame_packet(payload: Vec<u8>) -> Vec<u8> {
    let mut framed = Vec::new();
    write_varint(payload.len() as i32, &mut framed);
    framed.extend(payload);
    framed
}

fn component_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(component_text).collect::<Vec<_>>().join(""),
        Value::Object(map) => {
            let mut text = map.get("text").and_then(Value::as_str).unwrap_or("").to_string();
            if let Some(extra) = map.get("extra") { text.push_str(&component_text(extra)); }
            text
        }
        _ => String::new(),
    }
}

#[tauri::command]
fn ping_minecraft_server(host: String, port: u16) -> Result<ServerPingResult, String> {
    let host = host.trim().trim_end_matches('.').to_string();
    if host.is_empty() || host.len() > 253 || host.chars().any(|c| !(c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')) {
        return Err("Invalid server hostname".to_string());
    }
    if port == 0 { return Err("Invalid server port".to_string()); }
    let offline = |message: String| ServerPingResult {
        online: false, host: host.clone(), port, latency_ms: None, players_online: None,
        players_max: None, version: None, motd: None, favicon: None, error: Some(message)
    };
    let addresses = match (host.as_str(), port).to_socket_addrs() {
        Ok(items) => items.collect::<Vec<_>>(),
        Err(error) => return Ok(offline(format!("DNS lookup failed: {error}"))),
    };
    if addresses.is_empty() { return Ok(offline("No server address found".to_string())); }
    let mut last_error = "Connection failed".to_string();
    for address in addresses.into_iter().take(8) {
        let mut stream = match TcpStream::connect_timeout(&address, Duration::from_secs(3)) {
            Ok(stream) => stream,
            Err(error) => { last_error = error.to_string(); continue; }
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
        let mut handshake = Vec::new();
        write_varint(0, &mut handshake);
        write_varint(-1, &mut handshake);
        write_mc_string(&host, &mut handshake);
        handshake.extend_from_slice(&port.to_be_bytes());
        write_varint(1, &mut handshake);
        if let Err(error) = stream.write_all(&frame_packet(handshake)) { last_error = error.to_string(); continue; }
        if let Err(error) = stream.write_all(&[1, 0]) { last_error = error.to_string(); continue; }
        let started = Instant::now();
        let packet_len = match read_varint(&mut stream) {
            Ok(length) if length > 0 && length <= 1_048_576 => length as usize,
            Ok(_) => { last_error = "Invalid status packet length".to_string(); continue; },
            Err(error) => { last_error = error.to_string(); continue; }
        };
        let mut packet = vec![0u8; packet_len];
        if let Err(error) = stream.read_exact(&mut packet) { last_error = error.to_string(); continue; }
        let latency = started.elapsed().as_millis();
        let mut cursor = io::Cursor::new(packet);
        let packet_id = match read_varint(&mut cursor) { Ok(id) => id, Err(error) => { last_error = error.to_string(); continue; } };
        if packet_id != 0 { last_error = "Unexpected status packet".to_string(); continue; }
        let json_len = match read_varint(&mut cursor) { Ok(length) if length >= 0 && length <= 1_000_000 => length as usize, _ => { last_error = "Invalid status JSON length".to_string(); continue; } };
        let mut json_bytes = vec![0u8; json_len];
        if let Err(error) = cursor.read_exact(&mut json_bytes) { last_error = error.to_string(); continue; }
        let status: Value = match serde_json::from_slice(&json_bytes) {
            Ok(value) => value,
            Err(error) => { last_error = format!("Invalid status JSON: {error}"); continue; }
        };
        let players = status.get("players");
        let description = status.get("description").map(component_text).filter(|s| !s.is_empty());
        return Ok(ServerPingResult {
            online: true, host, port, latency_ms: Some(latency),
            players_online: players.and_then(|p| p.get("online")).and_then(Value::as_u64).map(|v| v as u32),
            players_max: players.and_then(|p| p.get("max")).and_then(Value::as_u64).map(|v| v as u32),
            version: status.pointer("/version/name").and_then(Value::as_str).map(str::to_string),
            motd: description,
            favicon: status.get("favicon").and_then(Value::as_str).map(str::to_string),
            error: None,
        });
    }
    Ok(offline(last_error))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_system_environment, list_game_instances, create_game_instance, delete_game_instance, rename_game_instance, open_instance_folder, load_launcher_config,
            save_launcher_config, download_modrinth_file, is_minecraft_version_installed, install_minecraft_version, import_external_mod, read_game_log, launch_minecraft, get_game_process_status, stop_game_process, ping_minecraft_server])
        .run(tauri::generate_context!()).expect("Failed to run DRAGON Launcher");
}
