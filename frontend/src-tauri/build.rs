fn main() {
    // tauri::generate_context! caches the Dock icon; watch the files so cargo rebuilds.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
