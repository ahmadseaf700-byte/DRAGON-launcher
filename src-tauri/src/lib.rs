use serde::Serialize;
use std::{fs, path::PathBuf};
use sysinfo::System;

#[derive(Serialize)]
struct SystemEnvironment {
    os: String,
    arch: String,
    total_ram_mb: u64,
    launcher_dir: String,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_system_environment])
        .run(tauri::generate_context!())
        .expect("Failed to run DRAGON Launcher");
}