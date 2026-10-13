use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::paths;

const DEFAULT_PORT: &str = "4096";

static OWNED: Mutex<Option<Child>> = Mutex::new(None);

fn port() -> String {
    std::env::var("CODA_PORT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PORT.to_string())
}

fn keep_alive(_app: &AppHandle) -> bool {
    let Ok(raw) = fs::read_to_string(paths::settings_path()) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|value| {
            value
                .get("keepBackendAlive")
                .and_then(|flag| flag.as_bool())
        })
        .unwrap_or(false)
}

pub fn ensure_running(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let port = port();
    if healthy(&port) {
        return;
    }
    if let Err(err) = spawn(app, &port) {
        eprintln!("Coda backend failed to start: {err}");
        return;
    }
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if healthy(&port) {
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    eprintln!("Coda backend did not become ready on 127.0.0.1:{port}");
}

pub fn stop_if_needed(app: &AppHandle) {
    if keep_alive(app) {
        let _ = OWNED.lock().map(|mut slot| slot.take());
        return;
    }
    // 这个窗口没有拉起 sidecar 时，不要停掉其他窗口或开发服务占用的端口。
    let mut owned = false;
    if let Ok(mut slot) = OWNED.lock() {
        if let Some(mut child) = slot.take() {
            owned = true;
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if owned && !cfg!(debug_assertions) {
        stop_sidecar_on_port(&port());
    }
}

fn spawn(app: &AppHandle, port: &str) -> Result<(), String> {
    let sidecar = sidecar_path(app).ok_or("bundled coda-backend binary is missing")?;
    paths::migrate_legacy();
    let log_dir = paths::logs_dir();
    fs::create_dir_all(&log_dir).map_err(|err| err.to_string())?;

    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("backend.log"))
        .map_err(|err| err.to_string())?;
    let log_err = log.try_clone().map_err(|err| err.to_string())?;

    // 用户数据全部集中在 ~/.coda（可用 CODA_HOME 覆盖）。
    let home = paths::coda_home();
    let mut cmd = Command::new(&sidecar);
    cmd.args(["serve", "--port", port, "--hostname", "127.0.0.1"])
        .env("CODA_PORT", port)
        .env("CODA_HOME", &home)
        .env("OPENCODE_DISABLE_AUTOUPDATE", "1")
        .env("OPENCODE_CLIENT", "coda")
        .env("OPENCODE_CHANNEL", "local")
        .env("OPENCODE_DB", paths::local_db_path())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    detach_session(&mut cmd);

    let child = cmd
        .spawn()
        .map_err(|err| format!("spawn {sidecar:?}: {err}"))?;
    let mut slot = OWNED.lock().map_err(|err| err.to_string())?;
    *slot = Some(child);
    Ok(())
}

fn sidecar_path(app: &AppHandle) -> Option<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.to_path_buf());
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        dirs.push(dir);
    }
    dirs.into_iter().find_map(|dir| find_sidecar_in(&dir))
}

fn find_sidecar_in(dir: &Path) -> Option<PathBuf> {
    let mut exact = None;
    let mut prefixed = None;
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name == "coda-backend"
            || name == "coda-backend.exe"
            || name.starts_with("coda-backend-"))
        {
            continue;
        }
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if name == "coda-backend" || name == "coda-backend.exe" {
            exact = Some(path);
        } else if prefixed.is_none() {
            prefixed = Some(path);
        }
    }
    exact.or(prefixed)
}

fn healthy(port: &str) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let Ok(mut addrs) = addr.to_socket_addrs() else {
        return false;
    };
    let Some(addr) = addrs.next() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
    if stream
        .write_all(b"GET /global/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 256];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    let text = String::from_utf8_lossy(&buf[..n]);
    let ok = text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200");
    ok && (text.contains("\"healthy\":true") || text.contains("\"healthy\": true"))
}

fn stop_sidecar_on_port(port: &str) {
    let self_pid = std::process::id();
    for pid in listening_pids(port) {
        if pid == self_pid || !is_sidecar_process(pid) {
            continue;
        }
        kill_pid(pid);
    }
}

#[cfg(unix)]
fn listening_pids(port: &str) -> Vec<u32> {
    let Ok(output) = Command::new("lsof")
        .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

#[cfg(windows)]
fn listening_pids(port: &str) -> Vec<u32> {
    let suffix = format!(":{port}");
    let Ok(output) = Command::new("netstat").args(["-ano", "-p", "TCP"]).output() else {
        return Vec::new();
    };
    let mut pids = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 || parts[3] != "LISTENING" || !parts[1].ends_with(&suffix) {
            continue;
        }
        if let Ok(pid) = parts[4].parse() {
            pids.push(pid);
        }
    }
    pids
}

#[cfg(unix)]
fn is_sidecar_process(pid: u32) -> bool {
    let Ok(output) = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()
    else {
        return false;
    };
    let args = String::from_utf8_lossy(&output.stdout);
    args.contains("coda-backend")
}

#[cfg(windows)]
fn is_sidecar_process(pid: u32) -> bool {
    let Ok(output) = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout)
        .to_ascii_lowercase()
        .contains("coda-backend")
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F", "/T"])
        .status();
}

#[cfg(unix)]
fn detach_session(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    cmd.process_group(0);
}

#[cfg(windows)]
fn detach_session(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB);
}
