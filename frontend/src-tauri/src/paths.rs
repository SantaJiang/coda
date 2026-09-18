use std::fs;
use std::path::{Path, PathBuf};

pub fn user_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub fn coda_home() -> PathBuf {
    coda_home_from(std::env::var("CODA_HOME").ok(), user_home())
}

fn coda_home_from(explicit: Option<String>, home: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = explicit {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    home.unwrap_or_else(|| PathBuf::from(".")).join(".coda")
}

pub fn settings_path() -> PathBuf {
    coda_home().join("settings.json")
}

pub fn data_dir() -> PathBuf {
    coda_home().join("data")
}

pub fn logs_dir() -> PathBuf {
    coda_home().join("logs")
}

pub fn local_db_path() -> PathBuf {
    data_dir().join("opencode-local.db")
}

pub fn ensure_layout() {
    let home = coda_home();
    let _ = fs::create_dir_all(home.join("data"));
    let _ = fs::create_dir_all(home.join("logs"));
    let _ = fs::create_dir_all(home.join("cache"));
    let _ = fs::create_dir_all(home.join("state"));
}

fn xdg_dir(var: &str, fallback: &[&str]) -> PathBuf {
    if let Ok(value) = std::env::var(var) {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    let mut path = user_home().unwrap_or_else(|| PathBuf::from("."));
    for part in fallback {
        path.push(part);
    }
    path
}

fn legacy_settings_path() -> PathBuf {
    let home = user_home().unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "macos") {
        return home.join("Library/Application Support/ai.coda.app/settings.json");
    }
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            if !appdata.trim().is_empty() {
                return PathBuf::from(appdata).join("ai.coda.app").join("settings.json");
            }
        }
        return home.join("AppData/Roaming/ai.coda.app/settings.json");
    }
    xdg_dir("XDG_CONFIG_HOME", &[".config"]).join("ai.coda.app/settings.json")
}

fn legacy_opencode_config_dir() -> PathBuf {
    xdg_dir("XDG_CONFIG_HOME", &[".config"]).join("opencode")
}

fn legacy_opencode_data_dir() -> PathBuf {
    xdg_dir("XDG_DATA_HOME", &[".local", "share"]).join("opencode")
}

fn copy_if_missing(src: &Path, dest: &Path) {
    if dest.exists() || !src.exists() {
        return;
    }
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::copy(src, dest);
}

fn copy_dir_contents(src: &Path, dest: &Path) {
    if !src.is_dir() {
        return;
    }
    let _ = fs::create_dir_all(dest);
    let Ok(entries) = fs::read_dir(src) else {
        return;
    };
    for entry in entries.flatten() {
        let to = dest.join(entry.file_name());
        if to.exists() {
            continue;
        }
        let from = entry.path();
        if from.is_dir() {
            copy_dir_contents(&from, &to);
        } else {
            let _ = fs::copy(from, to);
        }
    }
}

pub fn migrate_legacy() {
    ensure_layout();
    let home = coda_home();
    copy_if_missing(&legacy_settings_path(), &home.join("settings.json"));

    let has_config = home.join("opencode.jsonc").exists() || home.join("opencode.json").exists();
    if !has_config {
        let legacy = legacy_opencode_config_dir();
        for name in ["opencode.jsonc", "opencode.json", "config.json"] {
            let src = legacy.join(name);
            if src.exists() {
                copy_if_missing(&src, &home.join(name));
                break;
            }
        }
    }

    let dest_data = data_dir();
    if !dest_data.join("opencode-local.db").exists() {
        copy_dir_contents(&legacy_opencode_data_dir(), &dest_data);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("coda-home-test-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn uses_explicit_coda_home() {
        assert_eq!(
            coda_home_from(Some(" /tmp/custom-coda ".into()), Some(PathBuf::from("/Users/me"))),
            PathBuf::from("/tmp/custom-coda")
        );
    }

    #[test]
    fn defaults_to_dot_coda_in_the_user_home() {
        assert_eq!(
            coda_home_from(None, Some(PathBuf::from("/Users/me"))),
            PathBuf::from("/Users/me/.coda")
        );
    }

    #[test]
    fn copies_legacy_settings_and_sidecar_files_once() {
        let root = temp_dir();
        let dest = root.join("coda");
        let legacy_settings = root.join("old-settings.json");
        let legacy_config_dir = root.join("old-config");
        let legacy_data_dir = root.join("old-data");
        fs::create_dir_all(&legacy_config_dir).unwrap();
        fs::create_dir_all(&legacy_data_dir).unwrap();
        fs::write(&legacy_settings, "{\"theme\":\"dark\"}").unwrap();
        fs::write(legacy_config_dir.join("opencode.jsonc"), "{\"model\":\"x\"}").unwrap();
        fs::write(legacy_data_dir.join("opencode-local.db"), "db").unwrap();
        fs::write(legacy_data_dir.join("auth.json"), "{}").unwrap();

        fs::create_dir_all(dest.join("data")).unwrap();
        copy_if_missing(&legacy_settings, &dest.join("settings.json"));
        copy_if_missing(&legacy_config_dir.join("opencode.jsonc"), &dest.join("opencode.jsonc"));
        copy_dir_contents(&legacy_data_dir, &dest.join("data"));

        assert_eq!(fs::read_to_string(dest.join("settings.json")).unwrap(), "{\"theme\":\"dark\"}");
        assert_eq!(fs::read_to_string(dest.join("opencode.jsonc")).unwrap(), "{\"model\":\"x\"}");
        assert_eq!(fs::read_to_string(dest.join("data/opencode-local.db")).unwrap(), "db");
        assert_eq!(fs::read_to_string(dest.join("data/auth.json")).unwrap(), "{}");

        fs::write(&legacy_settings, "changed").unwrap();
        copy_if_missing(&legacy_settings, &dest.join("settings.json"));
        assert_eq!(fs::read_to_string(dest.join("settings.json")).unwrap(), "{\"theme\":\"dark\"}");

        let _ = fs::remove_dir_all(root);
    }
}
