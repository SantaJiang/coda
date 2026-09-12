use tauri::Manager;

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
fn settings_read(app: tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::read_to_string(dir.join("settings.json")).ok()
}

#[tauri::command]
fn settings_write(app: tauri::AppHandle, content: String) -> bool {
    let Ok(dir) = app.path().app_config_dir() else {
        return false;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return false;
    }
    let tmp = dir.join("settings.json.tmp");
    if std::fs::write(&tmp, content).is_err() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, dir.join("settings.json")).is_ok()
}

#[cfg(target_os = "macos")]
mod mac_traffic_lights;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![path_exists, settings_read, settings_write])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            mac_traffic_lights::install_main(app);
            #[cfg(not(target_os = "macos"))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Coda");
}
