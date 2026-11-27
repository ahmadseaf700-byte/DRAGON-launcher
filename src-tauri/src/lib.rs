use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::{fs, io, path::{Path, PathBuf}};
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
    let mut allowed = false;
    for rule in rules {
        let action = rule.get("action").and_then(Value::as_str).unwrap_or("disallow");
        let os_match = rule.get("os").and_then(|v| v.get("name")).and_then(Value::as_str)
            .map(|name| name == os).unwrap_or(true);
        if os_match { allowed = action == "allow"; }
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
        let Some(relative) = entry.enclosed_name().map(Path::to_path_buf) else { continue; };
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
    let _ = app.emit("minecraft-install-progress", json!({"version":version_id,"stage":"complete","done":1,"total":1}));
    Ok(InstallResult { version: version_id, game_directory: root.to_string_lossy().into_owned(),
        downloaded_bytes: total_bytes, libraries: installed_libraries, assets: asset_count })
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
async fn download_modrinth_file(_app: tauri::AppHandle, url: String, filename: String, kind: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid download URL: {e}"))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("cdn.modrinth.com") {
        return Err("Downloads are only allowed from the official Modrinth CDN over HTTPS".to_string());
    }
    let safe_name = Path::new(&filename).file_name().and_then(|n| n.to_str()).ok_or("Invalid download filename")?;
    if safe_name != filename || filename.contains('/') || filename.contains('\\') { return Err("Invalid download filename".to_string()); }
    let folder = match kind.as_str() { "mod" if filename.to_ascii_lowercase().ends_with(".jar") => "mods",
        "modpack" if filename.to_ascii_lowercase().ends_with(".mrpack") => "modpacks",
        _ => return Err("File type does not match selected project type".to_string()) };
    let response = reqwest::get(parsed).await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err(format!("Modrinth CDN returned HTTP {}", response.status())); }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() { return Err("The downloaded file is empty".to_string()); }
    let data_dir = launcher_data_dir()?;
    let base = if kind == "mod" { data_dir.join("game").join(folder) } else { data_dir.join(folder) };
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let destination = base.join(&filename);
    fs::write(&destination, &bytes).map_err(|e| e.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}


#[tauri::command]
fn import_external_mod(filename: String, data_base64: String) -> Result<String, String> {
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
    let mods_dir = launcher_data_dir()?.join("game").join("mods");
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
fn read_game_log() -> Result<String, String> {
    let path = launcher_data_dir()?.join("game").join("logs").join("latest.log");
    if !path.exists() { return Ok(String::new()); }
    let mut content = fs::read_to_string(&path).map_err(|e| format!("Could not read Minecraft log: {e}"))?;
    if content.len() > 1_000_000 {
        let mut start = content.len() - 1_000_000;
        while !content.is_char_boundary(start) { start += 1; }
        content = content[start..].to_string();
    }
    Ok(content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_system_environment, load_launcher_config,
            save_launcher_config, download_modrinth_file, install_minecraft_version, import_external_mod, read_game_log])
        .run(tauri::generate_context!()).expect("Failed to run DRAGON Launcher");
}
