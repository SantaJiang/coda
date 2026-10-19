use base64::{engine::general_purpose::STANDARD, Engine};
use clipboard_rs::{common::RustImage, Clipboard, ClipboardContext, RustImageData};
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_BYTES: usize = 25 * 1024 * 1024;

#[derive(Serialize)]
pub struct FileInfo {
    directory: bool,
    size: u64,
    sample: Vec<u8>,
    preview: Option<String>,
}

fn save_at(root: &Path, filename: &str, data: &[u8]) -> Result<String, String> {
    if data.len() > MAX_BYTES {
        return Err("单个附件不能超过 25 MiB".into());
    }
    let normalized = filename.replace('\\', "/");
    let name = Path::new(&normalized)
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or("附件文件名无效")?;
    let folder = root.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let path = folder.join(name);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = options
        .open(&path)
        .and_then(|mut file| file.write_all(data));
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&folder);
        return Err(error.to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

fn inspect(path: &Path) -> Result<FileInfo, String> {
    let meta = fs::metadata(path).map_err(|error| error.to_string())?;
    if !meta.is_dir() && !meta.is_file() {
        return Err("只能添加普通文件或文件夹".into());
    }
    if meta.is_file() && meta.len() > MAX_BYTES as u64 {
        return Err("单个附件不能超过 25 MiB".into());
    }
    let mut sample = Vec::new();
    if meta.is_file() {
        fs::File::open(path)
            .and_then(|file| file.take(4096).read_to_end(&mut sample))
            .map_err(|error| error.to_string())?;
    }
    let image = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif"
            )
        });
    let preview = if image {
        path.to_str()
            .and_then(|path| RustImageData::from_path(path).ok())
            .and_then(|image| image.thumbnail(160, 120).ok())
            .and_then(|image| image.to_png().ok())
            .map(|png| format!("data:image/png;base64,{}", STANDARD.encode(png.get_bytes())))
    } else {
        None
    };
    Ok(FileInfo {
        directory: meta.is_dir(),
        size: meta.len(),
        sample,
        preview,
    })
}

#[tauri::command]
pub async fn attachment_inspect(path: String) -> Result<FileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn attachment_convert_image(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_image_at(
            &crate::paths::coda_home().join("attachments"),
            Path::new(&path),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn convert_image_at(root: &Path, path: &Path) -> Result<String, String> {
    inspect(path)?;
    let path_string = path.to_str().ok_or("图片路径无效")?;
    let image = RustImageData::from_path(path_string).map_err(|error| error.to_string())?;
    let png = image.to_png().map_err(|error| error.to_string())?;
    let name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("图片");
    save_at(root, &format!("{name}.png"), png.get_bytes())
}

#[tauri::command]
pub async fn attachment_save(filename: String, data: Vec<u8>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_at(
            &crate::paths::coda_home().join("attachments"),
            &filename,
            &data,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn attachment_clipboard(include_image: bool) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clipboard = ClipboardContext::new().map_err(|error| error.to_string())?;
        let files = clipboard.get_files().unwrap_or_default();
        if !files.is_empty() {
            return Ok(files
                .into_iter()
                .map(|path| {
                    url::Url::parse(&path)
                        .ok()
                        .and_then(|url| url.to_file_path().ok())
                        .unwrap_or_else(|| PathBuf::from(path))
                        .to_string_lossy()
                        .into_owned()
                })
                .collect());
        }
        if !include_image {
            return Ok(Vec::new());
        }
        let Ok(image) = clipboard.get_image() else {
            return Ok(Vec::new());
        };
        if image.is_empty() {
            return Ok(Vec::new());
        }
        let png = image.to_png().map_err(|error| error.to_string())?;
        Ok(vec![save_at(
            &crate::paths::coda_home().join("attachments"),
            "剪贴板图片.png",
            png.get_bytes(),
        )?])
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_tiff_and_bmp_to_model_ready_png_and_builds_a_thumbnail() {
        let root = std::env::temp_dir().join(format!("coda-image-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        for extension in ["tiff", "bmp"] {
            let path = root.join(format!("中文 图片.{extension}"));
            image::RgbImage::from_pixel(3, 2, image::Rgb([40, 100, 200]))
                .save(&path)
                .unwrap();
            let imported = convert_image_at(&root, &path).unwrap();
            assert_eq!(&fs::read(&imported).unwrap()[..8], b"\x89PNG\r\n\x1a\n");
            assert!(inspect(Path::new(&imported))
                .unwrap()
                .preview
                .unwrap()
                .starts_with("data:image/png;base64,"));
            assert!(path.exists());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn imports_are_private_unique_and_cannot_escape_the_attachment_folder() {
        let root = std::env::temp_dir().join(format!("coda-attachment-{}", uuid::Uuid::new_v4()));
        let one = save_at(&root, "../../中文 file.txt", b"hello").unwrap();
        let two = save_at(&root, "../../中文 file.txt", b"second").unwrap();
        assert_ne!(one, two);
        assert!(Path::new(&one).starts_with(&root));
        assert_eq!(fs::read(&one).unwrap(), b"hello");
        assert_eq!(inspect(Path::new(&one)).unwrap().sample, b"hello");
        assert!(inspect(&root).unwrap().directory);
        assert!(save_at(&root, "..", b"bad").is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&one).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_oversized_files_without_reading_them_into_memory() {
        let path = std::env::temp_dir().join(format!("coda-large-{}", uuid::Uuid::new_v4()));
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_BYTES as u64 + 1).unwrap();
        assert!(inspect(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}
