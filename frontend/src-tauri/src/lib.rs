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

const MAX_USER_FILE_BYTES: u64 = 2 * 1024 * 1024;

fn is_json_path(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
}

fn tmp_path(path: &std::path::Path) -> std::path::PathBuf {
    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(".tmp");
    std::path::PathBuf::from(tmp)
}

#[tauri::command]
fn user_file_read(path: String) -> Result<String, String> {
    if path.trim().is_empty() || !is_json_path(&path) {
        return Err("只支持 JSON 文件".into());
    }
    let meta = std::fs::metadata(&path).map_err(|err| err.to_string())?;
    if !meta.is_file() {
        return Err("不是文件".into());
    }
    if meta.len() > MAX_USER_FILE_BYTES {
        return Err("文件过大".into());
    }
    std::fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[tauri::command]
fn user_file_write(path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() || !is_json_path(&path) {
        return Err("只支持 JSON 文件".into());
    }
    if content.len() as u64 > MAX_USER_FILE_BYTES {
        return Err("文件过大".into());
    }
    let path = std::path::PathBuf::from(path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    let tmp = tmp_path(&path);
    std::fs::write(&tmp, content.as_bytes()).map_err(|err| err.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    if let Err(err) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err.to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod mac_traffic_lights;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            path_exists,
            settings_read,
            settings_write,
            user_file_read,
            user_file_write
        ])
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
