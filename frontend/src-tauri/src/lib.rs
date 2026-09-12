use tauri::{Manager, RunEvent};

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

fn backend_port() -> String {
    std::env::var("CODA_PORT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "4096".to_string())
}

/// 「退出后保持后端运行」关闭时，退出 Coda 前停掉本机监听后端端口的进程。
/// 后端不是 Coda 的子进程（可能由 run.sh 或用户手动启动），只能按端口找。
fn keep_backend_alive(app: &tauri::AppHandle) -> bool {
    let Ok(dir) = app.path().app_config_dir() else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(dir.join("settings.json")) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|value| value.get("keepBackendAlive").and_then(|flag| flag.as_bool()))
        .unwrap_or(false)
}

#[cfg(unix)]
fn stop_backend() {
    let port = backend_port();
    let Ok(output) = std::process::Command::new("lsof")
        .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
        .output()
    else {
        return;
    };
    let self_pid = std::process::id().to_string();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let pid = line.trim();
        if pid.is_empty() || pid == self_pid || pid.parse::<i32>().is_err() {
            continue;
        }
        let _ = std::process::Command::new("kill").arg(pid).status();
    }
}

#[cfg(windows)]
fn stop_backend() {
    let port = backend_port();
    let suffix = format!(":{port}");
    let Ok(output) = std::process::Command::new("netstat").args(["-ano", "-p", "TCP"]).output() else {
        return;
    };
    let self_pid = std::process::id().to_string();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // Proto  Local Address  Foreign Address  State  PID
        if parts.len() < 5 || parts[3] != "LISTENING" || !parts[1].ends_with(&suffix) {
            continue;
        }
        if parts[4] == self_pid || parts[4].parse::<u32>().is_err() {
            continue;
        }
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", parts[4], "/F", "/T"])
            .status();
    }
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
        .build(tauri::generate_context!())
        .expect("error while running Coda")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if !keep_backend_alive(app) {
                    stop_backend();
                }
            }
        });
}
