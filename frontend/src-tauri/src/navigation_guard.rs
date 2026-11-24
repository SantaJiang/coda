use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

/// 窗口内只允许显示 Coda 自带的前端页面。
/// 外部网页跳转交给系统默认浏览器，其余协议直接拒绝。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            if should_allow(url) {
                return true;
            }
            if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
                let _ = webview
                    .app_handle()
                    .opener()
                    .open_url(url.as_str(), None::<String>);
            }
            false
        })
        .build()
}

/// 只有前端自己的页面和前端生成的导出内容才允许留在窗口里。
fn should_allow(url: &Url) -> bool {
    // blob: 是前端内存里生成的导出（[download]），URL 形如 blob:http://localhost:1420/<uuid>，
    // url::Url 不会递归解析内层，因此按 scheme 单独放行。
    if url.scheme() == "blob" {
        return true;
    }
    is_app_url(url)
}

/// 正式包：macOS `tauri://localhost`，Windows/Linux `http(s)://tauri.localhost`；
/// 开发模式：devUrl `http://localhost:1420`（Vite 绑 127.0.0.1 时也算）。
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "ipc" => matches!(url.host_str(), Some("localhost")),
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost") | Some("127.0.0.1") => cfg!(debug_assertions) && url.port() == Some(1420),
            _ => false,
        },
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{is_app_url, should_allow};
    use tauri::Url;

    fn parse(url: &str) -> Url {
        Url::parse(url).expect("test url")
    }

    #[test]
    fn allows_packaged_app_origins() {
        assert!(is_app_url(&parse("tauri://localhost/")));
        assert!(is_app_url(&parse("http://tauri.localhost/")));
        assert!(is_app_url(&parse("https://tauri.localhost/#/session")));
        assert!(is_app_url(&parse("ipc://localhost")));
    }

    #[test]
    fn blocks_everything_else() {
        assert!(!should_allow(&parse("https://github.com/SantaJiang/coda")));
        assert!(!should_allow(&parse("http://example.com/")));
        assert!(!should_allow(&parse("data:text/html,hi")));
        assert!(!should_allow(&parse("javascript:alert(1)")));
        assert!(!should_allow(&parse("file:///etc/passwd")));
        // 正式包里 localhost 不是自己的页面；开发端口只放行 1420。
        assert!(!should_allow(&parse("http://localhost:3000/")));
    }

    #[test]
    fn allows_blob_exports() {
        assert!(should_allow(&parse("blob:http://localhost:1420/uuid")));
    }
}
