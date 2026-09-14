fn main() {
    // tauri::generate_context! caches the Dock icon; watch the files so cargo rebuilds.
    println!("cargo:rerun-if-changed=icons");
    ensure_sidecar_placeholder();
    tauri_build::build()
}

/// tauri-build 在编译期就要求 externalBin 对应文件存在。
/// 开发态（run.sh / cargo check）用占位文件；pack.sh 会在打包前换成真正的后端。
fn ensure_sidecar_placeholder() {
    let triple = std::env::var("TARGET").unwrap_or_default();
    if triple.is_empty() {
        return;
    }
    let mut name = format!("coda-backend-{triple}");
    if triple.contains("windows") {
        name.push_str(".exe");
    }
    let path = std::path::Path::new("binaries").join(&name);
    if path.exists() {
        return;
    }
    if std::fs::create_dir_all("binaries").is_err() {
        return;
    }
    let bytes: &[u8] = if triple.contains("windows") {
        b""
    } else {
        b"#!/bin/sh\necho 'coda-backend sidecar is not bundled in this build' >&2\nexit 1\n"
    };
    if std::fs::write(&path, bytes).is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&path, perms);
        }
    }
}
