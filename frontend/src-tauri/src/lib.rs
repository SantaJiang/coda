use tauri::RunEvent;

mod backend;
mod paths;

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
fn settings_read() -> Option<String> {
    std::fs::read_to_string(paths::settings_path()).ok()
}

#[tauri::command]
fn settings_write(content: String) -> bool {
    let path = paths::settings_path();
    let Some(dir) = path.parent() else {
        return false;
    };
    if std::fs::create_dir_all(dir).is_err() {
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
    std::fs::rename(&tmp, path).is_ok()
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
            paths::migrate_legacy();
            #[cfg(target_os = "macos")]
            mac_traffic_lights::install_main(app);
            backend::ensure_running(&app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Coda")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                backend::stop_if_needed(app);
            }
        });
}
