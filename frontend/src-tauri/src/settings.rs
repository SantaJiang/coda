use serde_json::{Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_BYTES: usize = 2 * 1024 * 1024;
static NEXT_WRITE: AtomicU64 = AtomicU64::new(0);

/// The lock covers the entire read/merge/replace transaction, across app processes.
pub fn patch_at(path: &Path, patch: Value, only_missing: bool) -> Result<Value, String> {
    let patch = patch.as_object().ok_or("设置补丁必须是 JSON 对象")?;
    let dir = path.parent().ok_or("设置路径无效")?;
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(dir.join("settings.lock"))
        .map_err(|error| error.to_string())?;
    lock.lock().map_err(|error| error.to_string())?;
    let mut current = match fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > MAX_BYTES {
                return Err("设置文件过大".into());
            }
            serde_json::from_slice::<Value>(&bytes)
                .map_err(|error| format!("设置文件损坏，未覆盖原文件：{error}"))?
                .as_object()
                .cloned()
                .ok_or("设置文件必须是 JSON 对象")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(error.to_string()),
    };
    for (key, value) in patch {
        if !only_missing || !current.contains_key(key) {
            current.insert(key.clone(), value.clone());
        }
    }
    current.remove("pinnedModelKeys");
    current.remove("keepBackendAlive");
    let value = Value::Object(current);
    let bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("设置文件过大".into());
    }
    let tmp = dir.join(format!(
        "settings.{}.{}.tmp",
        std::process::id(),
        NEXT_WRITE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)?;
        #[cfg(unix)]
        File::open(dir)?.sync_all()?;
        Ok::<_, std::io::Error>(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|error| error.to_string())?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    fn root() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "coda-settings-{}-{}-{}",
            std::process::id(),
            NEXT_WRITE.fetch_add(1, Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn preserves_unknown_fields_and_removes_retired_settings() {
        let dir = root();
        let path = dir.join("settings.json");
        fs::write(
            &path,
            r#"{"future":42,"theme":"dark","keepBackendAlive":true}"#,
        )
        .unwrap();
        let value = patch_at(&path, serde_json::json!({"theme":"light"}), false).unwrap();
        assert_eq!(value["future"], 42);
        assert_eq!(value["theme"], "light");
        assert!(value.get("keepBackendAlive").is_none());
        patch_at(
            &path,
            serde_json::json!({"theme":"dark","sendShortcut":"enter"}),
            true,
        )
        .unwrap();
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["theme"], "light");
        assert_eq!(saved["sendShortcut"], "enter");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn never_overwrites_a_corrupt_file() {
        let dir = root();
        let path = dir.join("settings.json");
        fs::write(&path, "broken").unwrap();
        assert!(patch_at(&path, serde_json::json!({"theme":"light"}), false).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken");
        fs::remove_dir_all(dir).unwrap();
    }

    // This same test executable acts as isolated writers; the production file lock is exercised.
    #[test]
    fn settings_writer_child() {
        let Ok(dir) = std::env::var("CODA_SETTINGS_TEST_DIR") else {
            return;
        };
        let key = std::env::var("CODA_SETTINGS_TEST_KEY").unwrap();
        patch_at(
            &Path::new(&dir).join("settings.json"),
            serde_json::json!({key: true}),
            false,
        )
        .unwrap();
    }

    #[test]
    fn independent_processes_preserve_all_field_updates() {
        let dir = root();
        let mut children = Vec::new();
        for index in 0..8 {
            children.push(
                Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "settings::tests::settings_writer_child"])
                    .env("CODA_SETTINGS_TEST_DIR", &dir)
                    .env("CODA_SETTINGS_TEST_KEY", format!("key{index}"))
                    .stdout(Stdio::null())
                    .spawn()
                    .unwrap(),
            );
        }
        for mut child in children {
            assert!(child.wait().unwrap().success());
        }
        let value: Value =
            serde_json::from_slice(&fs::read(dir.join("settings.json")).unwrap()).unwrap();
        for index in 0..8 {
            assert_eq!(value[format!("key{index}")], true);
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
