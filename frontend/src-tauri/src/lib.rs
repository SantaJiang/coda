#[cfg(any(windows, test))]
use std::time::Duration;

mod backend;
mod lifecycle;
mod paths;
mod settings;
mod terminal_record;

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
fn settings_read() -> Option<String> {
    std::fs::read_to_string(paths::settings_path()).ok()
}

#[tauri::command]
fn settings_patch(
    patch: serde_json::Value,
    only_missing: Option<bool>,
) -> Result<serde_json::Value, String> {
    settings::patch_at(
        &paths::settings_path(),
        patch,
        only_missing.unwrap_or(false),
    )
}

// Retain the old command for callers upgrading from an earlier frontend.
#[tauri::command]
fn settings_write(content: String) -> bool {
    serde_json::from_str(&content)
        .ok()
        .and_then(|patch| settings::patch_at(&paths::settings_path(), patch, false).ok())
        .is_some()
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
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            lifecycle::show(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .on_window_event(lifecycle::window_event)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            lifecycle::desktop_activity,
            lifecycle::desktop_quit,
            path_exists,
            settings_read,
            settings_write,
            settings_patch,
            user_file_read,
            user_file_write
        ])
        .setup(|app| {
            paths::migrate_legacy();
            lifecycle::install(app);
            #[cfg(target_os = "macos")]
            mac_traffic_lights::install_main(app);
            // 窗口在这个 hook 之前就已经创建。Windows 上它默认可见，但 WebView2
            // 要等事件循环继续跑才能画出页面。以前在这里同步等 sidecar，主线程被
            // 堵住，用户会先看到一个没有内容的空窗口。后端改到后台启动；窗口保持
            // 隐藏，等前端画完再显示（见 tauri.windows.conf.json 的 visible: false）。
            #[cfg(windows)]
            {
                paint_hidden_window(app);
                schedule_reveal_fallback(app);
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || backend::supervise(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Coda")
        .run(lifecycle::run_event);
}

/// 跟 `global.css` 里的 `--bg` 保持一致，避免 WebView2 在首帧用默认白底。
#[cfg(any(windows, test))]
fn startup_theme(raw: &str) -> &'static str {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return "dark";
    };
    match value.get("theme").and_then(|theme| theme.as_str()) {
        Some("light") => "light",
        _ => "dark",
    }
}

/// 浅色 `#ffffff`，深色 `#1e1e20`。
#[cfg(any(windows, test))]
fn theme_background(theme: &str) -> (u8, u8, u8, u8) {
    if theme == "light" {
        (0xff, 0xff, 0xff, 255)
    } else {
        (0x1e, 0x1e, 0x20, 255)
    }
}

// `test` 让这段只在 Windows 上运行的逻辑也能在 macOS 上编译，方便本地做类型检查。
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
fn paint_hidden_window(app: &tauri::App) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let raw = std::fs::read_to_string(paths::settings_path()).ok();
    let theme = raw.as_deref().map(startup_theme).unwrap_or("dark");
    let (red, green, blue, alpha) = theme_background(theme);
    let _ = window.set_background_color(Some(tauri::window::Color(red, green, blue, alpha)));
}

/// 前端画完会自己 `show()`。如果脚本没跑起来，超时后再把窗口露出来，避免进程活着但看不见。
#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
fn schedule_reveal_fallback(app: &tauri::App) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(8));
        if window.is_visible().unwrap_or(true) {
            return;
        }
        let _ = window.show();
        let _ = window.set_shadow(true);
        let _ = window.set_focus();
    });
}

#[cfg(test)]
mod tests {
    use super::{startup_theme, theme_background};

    #[test]
    fn reads_light_theme_and_ignores_anything_else() {
        assert_eq!(startup_theme(r#"{"theme":"light"}"#), "light");
        assert_eq!(startup_theme(r#"{"theme":"dark"}"#), "dark");
        assert_eq!(startup_theme(r#"{"theme":"sepia"}"#), "dark");
        assert_eq!(startup_theme("not json"), "dark");
        assert_eq!(startup_theme("{}"), "dark");
    }

    #[test]
    fn background_matches_the_shell_colors() {
        assert_eq!(theme_background("light"), (0xff, 0xff, 0xff, 255));
        assert_eq!(theme_background("dark"), (0x1e, 0x1e, 0x20, 255));
    }
}
