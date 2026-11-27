use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use sysinfo::System;
use tauri::Manager;

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
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app config directory: {error}"))?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
fn get_system_environment() -> Result<SystemEnvironment, String> {
    let mut system = System::new();
    system.refresh_memory();
    let total_ram_mb = system.total_memory() / (1024 * 1024);
    let data_dir: PathBuf = dirs::data_dir()
        .ok_or_else(|| "The operating system did not provide an application data directory".to_string())?;
    let launcher_dir = data_dir.join("DRAGONLauncher");
    fs::create_dir_all(&launcher_dir)
        .map_err(|error| format!("Could not create launcher data directory: {error}"))?;

    Ok(SystemEnvironment {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        total_ram_mb,
        launcher_dir: launcher_dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn load_launcher_config(app: tauri::AppHandle) -> Result<Value, String> {
    let path = config_file(&app)?;
    if !path.exists() {
        return Ok(json!({
            "ram_mb": 4096,
            "game_directory": "",
            "java_path": "",
            "window_width": 1280,
            "window_height": 720,
            "language": "ar"
        }));
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read config.json: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("config.json contains invalid JSON: {error}"))
}

#[tauri::command]
fn save_launcher_config(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    let path = config_file(&app)?;
    let serialized = serde_json::to_vec_pretty(&config)
        .map_err(|error| format!("Could not serialize launcher settings: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serialized)
        .map_err(|error| format!("Could not write launcher settings: {error}"))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Could not replace config.json: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn download_modrinth_file(
    app: tauri::AppHandle,
    url: String,
    filename: String,
    kind: String,
) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|error| format!("Invalid download URL: {error}"))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("cdn.modrinth.com") {
        return Err("Downloads are only allowed from the official Modrinth CDN over HTTPS".to_string());
    }
    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid download filename".to_string())?;
    if safe_name != filename || filename.contains(['/', '\\\\']) {
        return Err("Invalid download filename".to_string());
    }
    let folder = match kind.as_str() {
        "mod" if filename.to_ascii_lowercase().ends_with(".jar") => "mods",
        "modpack" if filename.to_ascii_lowercase().ends_with(".mrpack") => "modpacks",
        _ => return Err("File type does not match the selected Modrinth project type".to_string()),
    };
    let response = reqwest::get(parsed).await
        .map_err(|error| format!("Download request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Modrinth CDN returned HTTP {}", response.status()));
    }
    let bytes = response.bytes().await
        .map_err(|error| format!("Could not read downloaded file: {error}"))?;
    if bytes.is_empty() {
        return Err("The downloaded file is empty".to_string());
    }
    let base = dirs::data_dir()
        .ok_or_else(|| "Could not resolve application data directory".to_string())?
        .join("DRAGONLauncher")
        .join(folder);
    fs::create_dir_all(&base)
        .map_err(|error| format!("Could not create {folder} directory: {error}"))?;
    let destination = base.join(&filename);
    fs::write(&destination, &bytes)
        .map_err(|error| format!("Could not save downloaded file: {error}"))?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_system_environment,
            load_launcher_config,
            save_launcher_config,
            download_modrinth_file
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run DRAGON Launcher");
}
