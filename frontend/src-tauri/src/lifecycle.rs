use crate::terminal_record::{Status as TerminalStatus, TerminalRecord};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;

static EXITING: AtomicBool = AtomicBool::new(false);
static EXIT_PENDING: AtomicBool = AtomicBool::new(false);
static EXIT_READY: AtomicBool = AtomicBool::new(false);
static TRAY_READY: AtomicBool = AtomicBool::new(false);
static NOTIFIED: AtomicBool = AtomicBool::new(false);
static ACTIVE: AtomicBool = AtomicBool::new(false);
static OWNER: OnceLock<String> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());

pub fn owner() -> &'static str {
    OWNER.get_or_init(|| format!("{}-{}", std::process::id(), now()))
}
fn now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
pub fn exiting() -> bool {
    EXITING.load(Ordering::SeqCst)
}

fn heartbeat() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let folder = crate::paths::coda_home().join("runtime");
    if fs::create_dir_all(&folder).is_err() {
        return;
    }
    let value = serde_json::json!({ "id": owner(), "pid": std::process::id(), "at": now(), "exiting": exiting() });
    let tmp = folder.join("desktop.json.tmp");
    if fs::write(&tmp, value.to_string()).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
        }
        let _ = fs::rename(tmp, folder.join("desktop.json"));
    }
}

#[tauri::command]
pub fn desktop_activity(active: bool) {
    ACTIVE.store(active, Ordering::SeqCst);
}

#[tauri::command]
pub fn desktop_quit(app: tauri::AppHandle) {
    request_exit(&app);
}

pub fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        eprintln!("Coda main window shown");
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// A transparent, antialiased C with round caps like the application's vector logo.
fn tray_image() -> tauri::image::Image<'static> {
    let size = 36usize;
    let radius = 11.5;
    let half_stroke = 2.5;
    let cap = radius * std::f64::consts::FRAC_1_SQRT_2;
    let mut rgba = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let mut coverage = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let dx = x as f64 + (sx as f64 + 0.5) / 4.0 - 18.0;
                    let dy = y as f64 + (sy as f64 + 0.5) / 4.0 - 18.0;
                    let r = (dx * dx + dy * dy).sqrt();
                    // The arc ends at +/-45 degrees. Beyond those ends, measure
                    // distance to the endpoint to produce a semicircular cap.
                    let distance = if dx <= dy.abs() {
                        (r - radius).abs()
                    } else {
                        ((dx - cap).powi(2) + (dy.abs() - cap).powi(2)).sqrt()
                    };
                    if distance <= half_stroke {
                        coverage += 1;
                    }
                }
            }
            let i = (y * size + x) * 4;
            #[cfg(not(target_os = "macos"))]
            {
                rgba[i] = 75;
                rgba[i + 1] = 170;
                rgba[i + 2] = 245;
            }
            rgba[i + 3] = (coverage * 255 / 16) as u8;
        }
    }
    tauri::image::Image::new_owned(rgba, size as u32, size as u32)
}

pub fn install(app: &tauri::App) {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    heartbeat();
    #[cfg(target_os = "macos")]
    mac_exit::install(app.handle());
    #[cfg(target_os = "macos")]
    if let Err(error) = install_app_menu(app) {
        eprintln!("Coda application menu unavailable: {error}");
    }
    #[cfg(windows)]
    install_job();
    let result = (|| -> tauri::Result<()> {
        let open = MenuItem::with_id(app, "open", "打开 Coda", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "退出 Coda", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;
        TrayIconBuilder::with_id("coda")
            .icon(tray_image())
            .icon_as_template(cfg!(target_os = "macos"))
            .tooltip("Coda")
            .menu(&menu)
            .show_menu_on_left_click(cfg!(target_os = "macos"))
            .on_menu_event(|app, event| match event.id.as_ref() {
                "open" => show(app),
                "quit" => request_exit(app),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if !cfg!(target_os = "macos")
                    && matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    )
                {
                    show(tray.app_handle());
                }
            })
            .build(app)?;
        Ok(())
    })();
    TRAY_READY.store(result.is_ok(), Ordering::Relaxed);
    if let Err(error) = result {
        eprintln!("Coda tray unavailable: {error}");
    }
    std::thread::spawn(|| {
        while !exiting() {
            heartbeat();
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg(target_os = "macos")]
fn install_app_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app.handle())?;
    if let Some(MenuItemKind::Submenu(submenu)) = menu.items()?.first() {
        // AppKit's predefined Quit sends terminate: directly and bypasses
        // ExitRequested. Replace it so both the menu and Cmd+Q await cleanup.
        let count = submenu.items()?.len();
        if count > 0 {
            submenu.remove_at(count - 1)?;
        }
        submenu.append(&MenuItem::with_id(
            app,
            "coda-quit",
            "退出 Coda",
            true,
            Some("CmdOrCtrl+Q"),
        )?)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id.as_ref() == "coda-quit" {
            request_exit(app);
        }
    });
    Ok(())
}

// Read the shared preference natively, including before the WebView has loaded.
fn close_to_tray() -> bool {
    crate::settings_read()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .is_some_and(|settings| settings["closeBehavior"] == "tray")
}

pub fn window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if exiting() {
            return;
        }
        api.prevent_close();
        if EXIT_PENDING.load(Ordering::SeqCst) {
            return;
        }
        if !close_to_tray() || !TRAY_READY.load(Ordering::Relaxed) {
            request_exit(window.app_handle());
            return;
        }
        let _ = window.hide();
        eprintln!("Coda window hidden to tray");
        if (ACTIVE.load(Ordering::Relaxed) || has_running_terminals())
            && !NOTIFIED.swap(true, Ordering::Relaxed)
        {
            let _ = window
                .app_handle()
                .notification()
                .builder()
                .title("Coda")
                .body("Coda 仍在后台运行，可通过系统托盘打开或退出。")
                .show();
        }
    }
}

fn terminal_records() -> Vec<(std::path::PathBuf, TerminalRecord)> {
    fs::read_dir(crate::paths::coda_home().join("terminals"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            let value: TerminalRecord =
                serde_json::from_str(&fs::read_to_string(dir.join("info.json")).ok()?).ok()?;
            (value.owner_id == owner()).then_some((dir, value))
        })
        .collect()
}
fn is_running(value: &TerminalRecord) -> bool {
    matches!(
        value.status,
        TerminalStatus::Starting | TerminalStatus::Running
    )
}
fn has_running_terminals() -> bool {
    terminal_records()
        .iter()
        .any(|(_, value)| is_running(value))
}

fn cancel_terminal(value: &TerminalRecord) {
    let Some(pid) = value.pid else {
        return;
    };
    #[cfg(unix)]
    {
        // PTY children have their own process group. Only task records owned by this app are passed here.
        let _ = std::process::Command::new("kill")
            .args(["-TERM", "--", &format!("-{pid}")])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

pub fn backend_died(pid: u32) {
    for (dir, mut value) in terminal_records() {
        if value.backend_pid != Some(pid) || !is_running(&value) {
            continue;
        }
        cancel_terminal(&value);
        #[cfg(unix)]
        if let Some(child) = value.pid {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", "--", &format!("-{child}")])
                .status();
        }
        value.status = TerminalStatus::Interrupted;
        value.ended_at = Some(u64::try_from(now()).unwrap_or(u64::MAX));
        value.reason =
            Some("Interrupted: backend restarted; inspect project state before retrying".into());
        let tmp = dir.join("info.desktop.tmp");
        if fs::write(&tmp, value.to_string()).is_ok() {
            let _ = fs::rename(tmp, dir.join("info.json"));
        }
    }
}

pub fn request_exit(app: &tauri::AppHandle) {
    // Keep the backend and heartbeat alive until the user explicitly confirms.
    // All ordinary exit entry points pass through this guard.
    if exiting() || EXIT_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    if ACTIVE.load(Ordering::SeqCst) || has_running_terminals() {
        show(app);
        let handle = app.clone();
        let mut dialog = app
            .dialog()
            .message("还有会话或终端任务正在进行。退出将中断这些任务，是否继续？")
            .title("退出 Coda？")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "中断并退出".into(),
                "取消退出".into(),
            ));
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.parent(&window);
        }
        dialog.show(move |confirmed| {
            if confirmed {
                begin_exit(&handle);
            }
            EXIT_PENDING.store(false, Ordering::SeqCst);
        });
    } else {
        begin_exit(app);
        EXIT_PENDING.store(false, Ordering::SeqCst);
    }
}

fn begin_exit(app: &tauri::AppHandle) {
    if EXITING.swap(true, Ordering::SeqCst) {
        return;
    }
    heartbeat(); // Prevent new shell launches before the asynchronous shutdown begins.
    eprintln!("Coda shutdown started");
    let app = app.clone();
    std::thread::spawn(move || {
        let mut records: Vec<_> = terminal_records()
            .into_iter()
            .filter(|(_, value)| is_running(value))
            .collect();
        for (_, value) in &records {
            if is_running(value) {
                cancel_terminal(value);
            }
        }
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while has_running_terminals() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
        crate::backend::stop_if_needed(&app);
        for record in terminal_records()
            .into_iter()
            .filter(|(_, value)| is_running(value))
        {
            if !records.iter().any(|(dir, _)| *dir == record.0) {
                records.push(record);
            }
        }
        // The backend may have exited before persisting PTY callbacks. Finish every
        // task captured by this shutdown and force-clean its remaining descendants.
        for (dir, original) in records {
            let mut value: TerminalRecord = fs::read_to_string(dir.join("info.json"))
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or(original);
            #[cfg(unix)]
            if let Some(pid) = value.pid {
                let _ = std::process::Command::new("kill")
                    .args(["-KILL", "--", &format!("-{pid}")])
                    .status();
            }
            if !is_running(&value) {
                continue;
            }
            value.status = TerminalStatus::Cancelled;
            value.ended_at = Some(u64::try_from(now()).unwrap_or(u64::MAX));
            value.reason = Some("Cancelled: Coda exited".into());
            let tmp = dir.join("info.desktop.tmp");
            if fs::write(&tmp, value.to_string()).is_ok() {
                let _ = fs::rename(tmp, dir.join("info.json"));
            }
        }
        eprintln!("Coda shutdown cleanup completed");
        EXIT_READY.store(true, Ordering::SeqCst);
        app.exit(0);
    });
}

pub fn run_event(app: &tauri::AppHandle, event: RunEvent) {
    match event {
        RunEvent::ExitRequested { api, .. } if !EXIT_READY.load(Ordering::SeqCst) => {
            api.prevent_exit();
            request_exit(app);
        }
        RunEvent::Exit => {
            EXITING.store(true, Ordering::SeqCst);
            heartbeat();
            crate::backend::stop_if_needed(app);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show(app),
        _ => {}
    }
}

#[cfg(windows)]
fn install_job() {
    use windows_sys::Win32::System::{JobObjects::*, Threading::GetCurrentProcess};
    // The job handle intentionally lives until process exit. The OS closes it on crashes too.
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of_val(&limits) as u32,
        ) == 0
            || AssignProcessToJobObject(job, GetCurrentProcess()) == 0
        {
            windows_sys::Win32::Foundation::CloseHandle(job);
        }
    }
}

#[cfg(target_os = "macos")]
mod mac_exit {
    use super::*;
    use objc2::{
        class, msg_send,
        runtime::{AnyClass, AnyObject, Sel},
        sel,
    };

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    // Dock Quit and macOS termination requests call the application delegate
    // directly, bypassing Tauri's ExitRequested and our custom application menu.
    pub fn install(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        unsafe {
            let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![application, delegate];
            if let Some(delegate) = delegate.as_ref() {
                let installed = objc2::ffi::class_addMethod(
                    delegate.class() as *const AnyClass as *mut AnyClass,
                    sel!(applicationShouldTerminate:),
                    std::mem::transmute::<
                        unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
                        objc2::runtime::Imp,
                    >(should_terminate),
                    c"Q@:@".as_ptr(),
                );
                if !installed.as_bool() {
                    eprintln!("Coda termination guard could not be installed");
                }
            }
        }
    }

    unsafe extern "C-unwind" fn should_terminate(
        _delegate: *mut AnyObject,
        _selector: Sel,
        _application: *mut AnyObject,
    ) -> usize {
        if EXIT_READY.load(Ordering::SeqCst) {
            return 1; // NSTerminateNow
        }
        if let Some(app) = APP.get() {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || request_exit(&handle));
        }
        0 // NSTerminateCancel; the shared shutdown path will exit after cleanup.
    }
}
