use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub supported: bool,
    pub full_disk_access: bool,
    pub screen_recording: bool,
}

/// The privacy pane moved into an ExtensionKit extension on recent macOS,
/// while older releases still use the Security preference pane.
pub fn settings_urls(pane: &str) -> Result<Vec<String>, String> {
    let anchor = match pane {
        "fullDiskAccess" => "Privacy_AllFiles",
        "screenRecording" => "Privacy_ScreenCapture",
        "filesAndFolders" => "Privacy_FilesAndFolders",
        "desktopFolder" => "Privacy_DesktopFolder",
        "documentsFolder" => "Privacy_DocumentsFolder",
        "downloadsFolder" => "Privacy_DownloadsFolder",
        _ => return Err("未知的权限设置".into()),
    };
    Ok(vec![
        format!("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?{anchor}"),
        format!("x-apple.systempreferences:com.apple.preference.security?{anchor}"),
    ])
}

#[tauri::command]
pub fn macos_permission_status() -> PermissionStatus {
    platform::status()
}

#[tauri::command]
pub fn macos_request_screen_recording() -> bool {
    platform::request_screen_recording()
}

#[tauri::command]
pub fn macos_open_permission_settings(pane: String) -> Result<(), String> {
    platform::open_settings(&pane)
}

#[tauri::command]
pub fn macos_restart(app: tauri::AppHandle) {
    crate::lifecycle::request_restart(&app);
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{settings_urls, PermissionStatus};
    use std::path::Path;
    use std::process::Command;

    pub fn status() -> PermissionStatus {
        PermissionStatus {
            supported: true,
            full_disk_access: full_disk_access(),
            screen_recording: screen_capture::preflight(),
        }
    }

    /// macOS exposes no public API to grant Full Disk Access. Reading a
    /// protected store is the standard way to check whether it is on.
    fn full_disk_access() -> bool {
        let Some(home) = crate::paths::user_home() else {
            return false;
        };
        let probes = [
            home.join("Library/Mail"),
            home.join("Library/Safari/History.db"),
            home.join("Library/Messages/chat.db"),
            home.join("Library/Application Support/com.apple.TCC/TCC.db"),
            Path::new("/Library/Application Support/com.apple.TCC/TCC.db").to_path_buf(),
        ];
        probes.iter().any(|path| is_readable(path))
    }

    fn is_readable(path: &Path) -> bool {
        match std::fs::metadata(path) {
            Ok(meta) if meta.is_dir() => std::fs::read_dir(path).is_ok(),
            Ok(_) => std::fs::File::open(path).is_ok(),
            Err(_) => false,
        }
    }

    pub fn request_screen_recording() -> bool {
        screen_capture::request()
    }

    pub fn open_settings(pane: &str) -> Result<(), String> {
        let urls = settings_urls(pane)?;
        let mut last_error = None;
        for url in urls {
            match Command::new("open").arg(&url).status() {
                Ok(status) if status.success() => return Ok(()),
                Ok(_) => last_error = Some("系统设置未打开".to_string()),
                Err(err) => last_error = Some(err.to_string()),
            }
        }
        Err(last_error.unwrap_or_else(|| "无法打开系统设置".into()))
    }

    /// Resolve the CoreGraphics functions at runtime so builds still run on
    /// macOS versions older than the Screen Recording privacy controls.
    mod screen_capture {
        use libc::{c_void, dlopen, dlsym, RTLD_LAZY};
        use std::ffi::CString;
        use std::sync::OnceLock;

        type BoolFn = unsafe extern "C" fn() -> bool;

        fn lookup(name: &str) -> Option<BoolFn> {
            unsafe {
                let framework = c"/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics";
                let handle = dlopen(framework.as_ptr(), RTLD_LAZY);
                if handle.is_null() {
                    return None;
                }
                let symbol = CString::new(name).ok()?;
                let pointer = dlsym(handle, symbol.as_ptr());
                if pointer.is_null() {
                    return None;
                }
                Some(std::mem::transmute::<*mut c_void, BoolFn>(pointer))
            }
        }

        fn resolve(cell: &'static OnceLock<Option<BoolFn>>, name: &str) -> Option<BoolFn> {
            *cell.get_or_init(|| lookup(name))
        }

        pub fn preflight() -> bool {
            static FUNCTION: OnceLock<Option<BoolFn>> = OnceLock::new();
            resolve(&FUNCTION, "CGPreflightScreenCaptureAccess")
                .map(|function| unsafe { function() })
                .unwrap_or(false)
        }

        pub fn request() -> bool {
            static FUNCTION: OnceLock<Option<BoolFn>> = OnceLock::new();
            resolve(&FUNCTION, "CGRequestScreenCaptureAccess")
                .map(|function| unsafe { function() })
                .unwrap_or(false)
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::PermissionStatus;

    pub fn status() -> PermissionStatus {
        PermissionStatus {
            supported: false,
            full_disk_access: false,
            screen_recording: false,
        }
    }

    pub fn request_screen_recording() -> bool {
        false
    }

    pub fn open_settings(_pane: &str) -> Result<(), String> {
        Err("仅 macOS 支持此操作".into())
    }
}

#[cfg(test)]
mod tests {
    use super::settings_urls;

    #[test]
    fn builds_modern_and_legacy_privacy_urls() {
        let urls = settings_urls("fullDiskAccess").unwrap();
        assert_eq!(urls.len(), 2);
        assert_eq!(
            urls[0],
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles"
        );
        assert_eq!(
            urls[1],
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
        );
        assert!(settings_urls("screenRecording")
            .unwrap()
            .iter()
            .all(|url| url.contains("Privacy_ScreenCapture")));
        assert!(settings_urls("unknown").is_err());
    }
}
