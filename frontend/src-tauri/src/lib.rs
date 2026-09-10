#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[cfg(target_os = "macos")]
mod mac_traffic_lights;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![path_exists])
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
