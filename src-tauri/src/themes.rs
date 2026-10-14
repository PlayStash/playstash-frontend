//! Custom theme files: the per-profile themes folder, file listing,
//! install/export/delete and the overlay image.
//!
//! The XAML itself is validated in TypeScript (`src/themes/xamlTheme.ts`,
//! port of the WPF `ThemeDefinition`). This module enforces the file-system
//! rules of the WPF `SafeThemeLoader`: size limits, no links, and overlay
//! images that stay inside the theme's folder.

use base64::Engine as _;
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

/// Maximum characters of a theme document.
const MAX_THEME_CHARS: usize = 65_536;
/// Maximum theme file size on disk (`MaximumCharacters * 4`).
const MAX_THEME_FILE_BYTES: u64 = (MAX_THEME_CHARS as u64) * 4;
const MAX_OVERLAY_BYTES: u64 = 16 * 1024 * 1024;
/// Upper bound for documents fetched from GitHub (lists, themes, releases).
const MAX_GITHUB_BYTES: usize = 16 * 1024 * 1024 + 1024;
const OVERLAY_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "bmp", "gif"];

const ERR_TOO_LARGE: &str = "The theme file is too large.";
const ERR_LOCAL_FILES: &str = "Themes must be local files.";
const ERR_IMAGE_TOO_LARGE: &str = "The theme image is too large.";
const ERR_IMAGE_FORMAT: &str = "Unsupported theme image format.";
const ERR_UNSAFE_PATH: &str = "The archive contains an unsafe path.";
const ERR_UNSAFE_WINDOWS_PATH: &str = "The archive contains an unsafe Windows path.";
const ERR_ESCAPES: &str = "The path escapes its destination.";
const ERR_LINKS: &str = "Filesystem links are not allowed in this destination.";

fn encode_base64(bytes: &[u8]) -> String {
  base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
  base64::engine::general_purpose::STANDARD
    .decode(data.as_bytes())
    .map_err(|error| format!("Invalid base64 data: {error}"))
}

fn validate_profile_id(profile_id: &str) -> Result<(), String> {
  if profile_id.is_empty()
    || profile_id.len() > 64
    || !profile_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
  {
    return Err("Invalid profile id.".to_string());
  }
  Ok(())
}

/// `<app_data_dir>/themes` or `<app_data_dir>/profiles/<id>/themes`.
pub(crate) fn themes_root(app_data_dir: &Path, profile_id: Option<&str>) -> Result<PathBuf, String> {
  match profile_id.filter(|id| !id.is_empty()) {
    Some(id) => {
      validate_profile_id(id)?;
      Ok(app_data_dir.join("profiles").join(id).join("themes"))
    }
    None => Ok(app_data_dir.join("themes")),
  }
}

fn app_themes_root(app: &tauri::AppHandle, profile_id: Option<&str>) -> Result<PathBuf, String> {
  let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  themes_root(&data_dir, profile_id)
}

/// The themes root an existing theme path belongs to: the global root or
/// any profile's root. Lets the stored theme load before the active profile
/// is known (and after switching). Falls back to `fallback` otherwise.
pub(crate) fn theme_root_for(app_data_dir: &Path, path: &Path, fallback: PathBuf) -> PathBuf {
  let global = app_data_dir.join("themes");
  if is_within(&global, path) {
    return global;
  }
  let profiles = app_data_dir.join("profiles");
  if is_within(&profiles, path) {
    let relative: Vec<_> = path.components().skip(profiles.components().count()).take(2).collect();
    if let [Component::Normal(id), Component::Normal(themes)] = relative.as_slice() {
      if let Some(id) = id.to_str() {
        if themes.to_str() == Some("themes") && validate_profile_id(id).is_ok() {
          return profiles.join(id).join("themes");
        }
      }
    }
  }
  fallback
}

fn app_theme_root_for(app: &tauri::AppHandle, profile_id: Option<&str>, path: &Path) -> Result<PathBuf, String> {
  let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  let fallback = themes_root(&data_dir, profile_id)?;
  Ok(theme_root_for(&data_dir, path, fallback))
}

/// `SecurityPaths.ResolveArchiveEntry`: resolves a relative entry below
/// `root`, rejecting rooted paths, illegal characters, `.`/`..`, trailing
/// dots or spaces and Windows device names.
pub(crate) fn resolve_relative_entry(root: &Path, entry: &str) -> Result<PathBuf, String> {
  if entry.trim().is_empty()
    || entry.starts_with('/')
    || entry.starts_with('\\')
    || entry.chars().any(|c| (c as u32) < 32 || "<>:\"|?*".contains(c))
  {
    return Err(ERR_UNSAFE_PATH.to_string());
  }
  let trimmed = entry.trim_end_matches(['/', '\\']);
  let mut path = root.to_path_buf();
  for component in trimmed.split(['/', '\\']) {
    let device = component.split('.').next().unwrap_or("").to_ascii_uppercase();
    let numbered_device = device.len() == 4
      && (device.starts_with("COM") || device.starts_with("LPT"))
      && device.as_bytes()[3].is_ascii_digit();
    if component.is_empty()
      || component == "."
      || component == ".."
      || component.ends_with('.')
      || component.ends_with(' ')
      || ["CON", "PRN", "AUX", "NUL"].contains(&device.as_str())
      || numbered_device
    {
      return Err(ERR_UNSAFE_WINDOWS_PATH.to_string());
    }
    path.push(component);
  }
  Ok(path)
}

/// True when `path` is lexically inside `root` (or equal to it).
fn is_within(root: &Path, path: &Path) -> bool {
  let normalize = |p: &Path| -> Vec<String> {
    p.components()
      .filter(|component| !matches!(component, Component::CurDir))
      .map(|component| component.as_os_str().to_string_lossy().to_lowercase())
      .collect()
  };
  let root_parts = normalize(root);
  let path_parts = normalize(path);
  path_parts.len() >= root_parts.len()
    && path_parts.iter().take(root_parts.len()).eq(root_parts.iter())
    && !path_parts.iter().any(|part| part == "..")
}

fn is_link(path: &Path) -> bool {
  let Ok(metadata) = fs::symlink_metadata(path) else {
    return false;
  };
  if metadata.file_type().is_symlink() {
    return true;
  }
  #[cfg(windows)]
  {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
      return true;
    }
  }
  false
}

/// `SecurityPaths.RejectLinks`: `path` must be inside `root`, and neither it
/// nor any directory between it and `root` may be a link.
pub(crate) fn reject_links(root: &Path, path: &Path) -> Result<(), String> {
  if !is_within(root, path) {
    return Err(ERR_ESCAPES.to_string());
  }
  let mut current = path.to_path_buf();
  loop {
    if is_link(&current) {
      return Err(ERR_LINKS.to_string());
    }
    if current.components().count() <= root.components().count() {
      break;
    }
    if !current.pop() {
      break;
    }
  }
  Ok(())
}

fn has_extension(path: &Path, allowed: &[&str]) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| allowed.iter().any(|candidate| ext.eq_ignore_ascii_case(candidate)))
    .unwrap_or(false)
}

/// Reads a theme file: local, inside `root`, no links, ≤ 256 KiB, UTF-8.
fn read_theme_file(root: &Path, path: &Path) -> Result<String, String> {
  if !path.is_absolute() {
    return Err(ERR_LOCAL_FILES.to_string());
  }
  reject_links(root, path)?;
  let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
  if !metadata.is_file() {
    return Err(ERR_LOCAL_FILES.to_string());
  }
  if metadata.len() > MAX_THEME_FILE_BYTES {
    return Err(ERR_TOO_LARGE.to_string());
  }
  let bytes = fs::read(path).map_err(|error| error.to_string())?;
  let text = String::from_utf8(bytes).map_err(|_| "The theme file is not valid UTF-8.".to_string())?;
  Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
}

fn collect_theme_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
  if depth > 16 {
    return;
  }
  let Ok(entries) = fs::read_dir(dir) else {
    return;
  };
  let mut entries: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
  entries.sort();
  for path in entries {
    if is_link(&path) {
      continue;
    }
    if path.is_dir() {
      collect_theme_files(&path, out, depth + 1);
    } else if has_extension(&path, &["xaml"]) {
      out.push(path);
    }
  }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThemeFileEntry {
  path: String,
  content: String,
}

/// Lists `*.xaml` below `root` recursively with their contents. Files that
/// break a file-system rule are skipped silently (WPF behaviour).
pub(crate) fn list_theme_files(root: &Path) -> Vec<ThemeFileEntry> {
  let mut files = Vec::new();
  if !root.is_dir() || is_link(root) {
    return Vec::new();
  }
  collect_theme_files(root, &mut files, 0);
  files
    .into_iter()
    .filter_map(|path| {
      read_theme_file(root, &path).ok().map(|content| ThemeFileEntry {
        path: path.to_string_lossy().to_string(),
        content,
      })
    })
    .collect()
}

fn validate_theme_file_name(name: &str) -> Result<(), String> {
  if name.is_empty()
    || name.starts_with('.')
    || name.len() > 200
    || name.contains(['/', '\\'])
    || !has_extension(Path::new(name), &["xaml"])
  {
    return Err("Invalid theme file name.".to_string());
  }
  resolve_relative_entry(Path::new("."), name).map(|_| ())
}

fn validate_overlay_entry(theme_dir: &Path, rel_path: &str) -> Result<PathBuf, String> {
  let path = resolve_relative_entry(theme_dir, rel_path)?;
  if !has_extension(&path, &OVERLAY_EXTENSIONS) {
    return Err(ERR_IMAGE_FORMAT.to_string());
  }
  Ok(path)
}

/// Reads the overlay image of a theme file: inside the theme's directory,
/// no links, ≤ 16 MiB.
pub(crate) fn read_overlay(root: &Path, theme_path: &Path, rel_path: &str) -> Result<Vec<u8>, String> {
  reject_links(root, theme_path)?;
  let theme_dir = theme_path.parent().ok_or_else(|| ERR_LOCAL_FILES.to_string())?;
  let image = validate_overlay_entry(theme_dir, rel_path)?;
  reject_links(theme_dir, &image)?;
  let metadata = fs::metadata(&image).map_err(|error| error.to_string())?;
  if !metadata.is_file() {
    return Err(ERR_LOCAL_FILES.to_string());
  }
  if metadata.len() > MAX_OVERLAY_BYTES {
    return Err(ERR_IMAGE_TOO_LARGE.to_string());
  }
  let mut bytes = Vec::new();
  fs::File::open(&image)
    .map_err(|error| error.to_string())?
    .take(MAX_OVERLAY_BYTES + 1)
    .read_to_end(&mut bytes)
    .map_err(|error| error.to_string())?;
  if bytes.len() as u64 > MAX_OVERLAY_BYTES {
    return Err(ERR_IMAGE_TOO_LARGE.to_string());
  }
  Ok(bytes)
}

fn check_theme_content(content: &str) -> Result<(), String> {
  if content.chars().count() > MAX_THEME_CHARS || content.len() as u64 > MAX_THEME_FILE_BYTES {
    return Err(ERR_TOO_LARGE.to_string());
  }
  Ok(())
}

/// Writes a theme (and optionally its overlay next to it) into `root`.
pub(crate) fn write_theme(
  root: &Path,
  file_name: &str,
  content: &str,
  overlay: Option<(&str, &[u8])>,
) -> Result<PathBuf, String> {
  validate_theme_file_name(file_name)?;
  check_theme_content(content)?;
  fs::create_dir_all(root).map_err(|error| error.to_string())?;
  let target = root.join(file_name);
  reject_links(root, &target)?;
  if let Some((rel_path, bytes)) = overlay {
    if bytes.len() as u64 > MAX_OVERLAY_BYTES {
      return Err(ERR_IMAGE_TOO_LARGE.to_string());
    }
    let image = validate_overlay_entry(root, rel_path)?;
    if let Some(parent) = image.parent() {
      fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    reject_links(root, &image)?;
    fs::write(&image, bytes).map_err(|error| error.to_string())?;
  }
  fs::write(&target, content.as_bytes()).map_err(|error| error.to_string())?;
  Ok(target)
}

/// Deletes a theme file and, unlike WPF, also its overlay image.
pub(crate) fn delete_theme(root: &Path, path: &Path, overlay_rel_path: Option<&str>) -> Result<(), String> {
  if !has_extension(path, &["xaml"]) {
    return Err("Only theme files can be deleted.".to_string());
  }
  reject_links(root, path)?;
  if let (Some(rel_path), Some(theme_dir)) = (overlay_rel_path, path.parent()) {
    if let Ok(image) = validate_overlay_entry(theme_dir, rel_path) {
      if reject_links(theme_dir, &image).is_ok() && image.is_file() {
        fs::remove_file(&image).map_err(|error| error.to_string())?;
      }
    }
  }
  if path.exists() {
    fs::remove_file(path).map_err(|error| error.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub(crate) async fn themes_dir(app: tauri::AppHandle, profile_id: Option<String>, create: bool) -> Result<String, String> {
  let root = app_themes_root(&app, profile_id.as_deref())?;
  if create {
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
  }
  Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) async fn themes_list(app: tauri::AppHandle, profile_id: Option<String>) -> Result<Vec<ThemeFileEntry>, String> {
  let root = app_themes_root(&app, profile_id.as_deref())?;
  tauri::async_runtime::spawn_blocking(move || list_theme_files(&root))
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn theme_read(app: tauri::AppHandle, profile_id: Option<String>, path: String) -> Result<String, String> {
  let root = app_theme_root_for(&app, profile_id.as_deref(), Path::new(&path))?;
  tauri::async_runtime::spawn_blocking(move || read_theme_file(&root, Path::new(&path)))
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn theme_write(
  app: tauri::AppHandle,
  profile_id: Option<String>,
  file_name: String,
  content: String,
  overlay_rel_path: Option<String>,
  overlay_base64: Option<String>,
) -> Result<String, String> {
  let root = app_themes_root(&app, profile_id.as_deref())?;
  let overlay_bytes = overlay_base64.as_deref().map(decode_base64).transpose()?;
  tauri::async_runtime::spawn_blocking(move || {
    let overlay = match (overlay_rel_path.as_deref(), overlay_bytes.as_deref()) {
      (Some(rel_path), Some(bytes)) => Some((rel_path, bytes)),
      _ => None,
    };
    write_theme(&root, &file_name, &content, overlay).map(|path| path.to_string_lossy().to_string())
  })
  .await
  .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn theme_delete(
  app: tauri::AppHandle,
  profile_id: Option<String>,
  path: String,
  overlay_rel_path: Option<String>,
) -> Result<(), String> {
  let root = app_theme_root_for(&app, profile_id.as_deref(), Path::new(&path))?;
  tauri::async_runtime::spawn_blocking(move || delete_theme(&root, Path::new(&path), overlay_rel_path.as_deref()))
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn theme_overlay_bytes(
  app: tauri::AppHandle,
  profile_id: Option<String>,
  theme_path: String,
  rel_path: String,
) -> Result<String, String> {
  let root = app_theme_root_for(&app, profile_id.as_deref(), Path::new(&theme_path))?;
  tauri::async_runtime::spawn_blocking(move || {
    read_overlay(&root, Path::new(&theme_path), &rel_path).map(|bytes| encode_base64(&bytes))
  })
  .await
  .map_err(|error| error.to_string())?
}

/// Writes a generated theme to a path the user picked in the save dialog and
/// copies the optional overlay image next to it as `<name>-overlay<.ext>`.
#[tauri::command]
pub(crate) async fn theme_export(path: String, content: String, overlay_source: Option<String>) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || export_theme(Path::new(&path), &content, overlay_source.as_deref()))
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn export_theme(path: &Path, content: &str, overlay_source: Option<&str>) -> Result<String, String> {
  if !path.is_absolute() || !has_extension(path, &["xaml"]) {
    return Err("Choose a .xaml file to export the theme.".to_string());
  }
  check_theme_content(content)?;
  let dir = path.parent().ok_or_else(|| "Invalid export path.".to_string())?;
  if let Some(source) = overlay_source {
    let source = Path::new(source);
    if !source.is_absolute() || !has_extension(source, &OVERLAY_EXTENSIONS) {
      return Err(ERR_IMAGE_FORMAT.to_string());
    }
    let metadata = fs::metadata(source).map_err(|error| error.to_string())?;
    if !metadata.is_file() || is_link(source) {
      return Err(ERR_LOCAL_FILES.to_string());
    }
    if metadata.len() > MAX_OVERLAY_BYTES {
      return Err(ERR_IMAGE_TOO_LARGE.to_string());
    }
    let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("Theme");
    let ext = source.extension().and_then(|ext| ext.to_str()).unwrap_or("png");
    let destination = dir.join(format!("{stem}-overlay.{ext}"));
    if is_link(&destination) {
      return Err(ERR_LINKS.to_string());
    }
    let same_file = fs::canonicalize(&destination).ok() == fs::canonicalize(source).ok()
      && destination.exists();
    if !same_file {
      fs::copy(source, &destination).map_err(|error| error.to_string())?;
    }
  }
  if is_link(path) {
    return Err(ERR_LINKS.to_string());
  }
  fs::write(path, content.as_bytes()).map_err(|error| error.to_string())?;
  Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubResponse {
  bytes_base64: String,
  content_type: String,
}

/// Hosts the GitHub helper may contact (community themes, backend releases).
pub(crate) fn is_allowed_github_url(value: &str) -> bool {
  let Ok(url) = url::Url::parse(value) else {
    return false;
  };
  url.scheme() == "https"
    && url.username().is_empty()
    && url.password().is_none()
    && matches!(
      url.host_str(),
      Some("api.github.com") | Some("raw.githubusercontent.com") | Some("github.com")
    )
}

/// Unauthenticated GET against GitHub with the `PlayStash` user agent (the
/// GitHub API rejects requests without one). Avoids CORS in the webview.
#[tauri::command]
pub(crate) async fn github_fetch(url: String) -> Result<GithubResponse, String> {
  if !is_allowed_github_url(&url) {
    return Err("Only GitHub URLs can be fetched.".to_string());
  }
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .redirect(reqwest::redirect::Policy::custom(|attempt| {
      if attempt.previous().len() >= 5 || !is_allowed_github_url(attempt.url().as_str()) {
        attempt.stop()
      } else {
        attempt.follow()
      }
    }))
    .user_agent("PlayStash")
    .build()
    .map_err(|error| error.to_string())?;
  let response = client
    .get(&url)
    .header("Accept", "application/vnd.github+json, */*;q=0.8")
    .send()
    .await
    .map_err(|error| error.to_string())?;
  if !response.status().is_success() {
    return Err(format!("HTTP {}", response.status()));
  }
  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .unwrap_or("application/octet-stream")
    .to_string();
  let bytes = response.bytes().await.map_err(|error| error.to_string())?;
  if bytes.len() > MAX_GITHUB_BYTES {
    return Err("The response is too large.".to_string());
  }
  Ok(GithubResponse {
    bytes_base64: encode_base64(&bytes),
    content_type,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  struct ScratchDir(PathBuf);

  impl ScratchDir {
    fn new(label: &str) -> Self {
      let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
      let path = std::env::temp_dir().join(format!("playstash-themes-{label}-{}-{nanos}", std::process::id()));
      fs::create_dir_all(&path).unwrap();
      Self(path)
    }
  }

  impl Drop for ScratchDir {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn themes_root_is_namespaced_per_profile() {
    let base = Path::new("data");
    assert_eq!(themes_root(base, None).unwrap(), base.join("themes"));
    assert_eq!(themes_root(base, Some("")).unwrap(), base.join("themes"));
    assert_eq!(
      themes_root(base, Some("abc-1")).unwrap(),
      base.join("profiles").join("abc-1").join("themes")
    );
    assert!(themes_root(base, Some("../x")).is_err());
  }

  #[test]
  fn theme_root_for_finds_global_and_profile_roots() {
    let data = Path::new("/data");
    let fallback = PathBuf::from("/fallback");
    assert_eq!(
      theme_root_for(data, Path::new("/data/themes/a.xaml"), fallback.clone()),
      data.join("themes")
    );
    assert_eq!(
      theme_root_for(data, Path::new("/data/profiles/p1/themes/sub/a.xaml"), fallback.clone()),
      data.join("profiles").join("p1").join("themes")
    );
    assert_eq!(
      theme_root_for(data, Path::new("/data/profiles/p1/other/a.xaml"), fallback.clone()),
      fallback
    );
    assert_eq!(theme_root_for(data, Path::new("/elsewhere/a.xaml"), fallback.clone()), fallback);
  }

  #[test]
  fn relative_entries_reject_unsafe_paths() {
    let root = Path::new("root");
    assert!(resolve_relative_entry(root, "overlay.png").is_ok());
    assert!(resolve_relative_entry(root, "images/overlay.png").is_ok());
    for bad in ["", "/abs.png", "\\abs.png", "C:\\x.png", "../x.png", "a/../x.png", "con.png", "LPT1.png", "x.png.", "a?.png"] {
      assert!(resolve_relative_entry(root, bad).is_err(), "{bad} should be rejected");
    }
  }

  #[test]
  fn within_check_is_lexical_and_case_insensitive() {
    let root = Path::new("/data/themes");
    assert!(is_within(root, Path::new("/data/themes/a.xaml")));
    assert!(is_within(root, Path::new("/DATA/Themes/sub/a.xaml")));
    assert!(!is_within(root, Path::new("/data/other/a.xaml")));
    assert!(!is_within(root, Path::new("/data/themes/../other/a.xaml")));
  }

  #[test]
  fn write_list_read_and_delete_round_trip() {
    let scratch = ScratchDir::new("roundtrip");
    let root = scratch.0.join("themes");
    let path = write_theme(&root, "Theme-1.xaml", "<x/>", Some(("Theme-1-overlay.png", b"png"))).unwrap();
    let nested = root.join("nested");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("Other.xaml"), "\u{feff}<y/>").unwrap();
    fs::write(nested.join("ignore.txt"), "nope").unwrap();

    let listed = list_theme_files(&root);
    assert_eq!(listed.len(), 2);
    assert!(listed.iter().any(|entry| entry.content == "<y/>"));

    assert_eq!(read_overlay(&root, &path, "Theme-1-overlay.png").unwrap(), b"png");
    assert!(read_overlay(&root, &path, "../escape.png").is_err());
    assert!(read_overlay(&root, &path, "Theme-1.xaml").is_err());

    delete_theme(&root, &path, Some("Theme-1-overlay.png")).unwrap();
    assert!(!path.exists());
    assert!(!root.join("Theme-1-overlay.png").exists());
  }

  #[test]
  fn oversized_theme_files_are_skipped_and_rejected() {
    let scratch = ScratchDir::new("oversized");
    let root = scratch.0.clone();
    let big = "a".repeat(MAX_THEME_FILE_BYTES as usize + 1);
    fs::write(root.join("Big.xaml"), &big).unwrap();
    assert!(list_theme_files(&root).is_empty());
    assert_eq!(read_theme_file(&root, &root.join("Big.xaml")).unwrap_err(), ERR_TOO_LARGE);
    assert_eq!(write_theme(&root, "x.xaml", &"a".repeat(MAX_THEME_CHARS + 1), None).unwrap_err(), ERR_TOO_LARGE);
  }

  #[test]
  fn theme_file_names_must_be_plain_xaml_names() {
    assert!(validate_theme_file_name("Theme-abc.xaml").is_ok());
    assert!(validate_theme_file_name("sub/Theme.xaml").is_err());
    assert!(validate_theme_file_name("Theme.txt").is_err());
    assert!(validate_theme_file_name("..xaml").is_err());
  }

  #[test]
  fn reading_outside_the_root_is_rejected() {
    let scratch = ScratchDir::new("outside");
    let root = scratch.0.join("themes");
    fs::create_dir_all(&root).unwrap();
    fs::write(scratch.0.join("Outside.xaml"), "<x/>").unwrap();
    assert_eq!(read_theme_file(&root, &scratch.0.join("Outside.xaml")).unwrap_err(), ERR_ESCAPES);
    assert_eq!(read_theme_file(&root, Path::new("relative.xaml")).unwrap_err(), ERR_LOCAL_FILES);
  }

  #[test]
  fn export_copies_the_overlay_next_to_the_file() {
    let scratch = ScratchDir::new("export");
    let source = scratch.0.join("picked.png");
    fs::write(&source, b"img").unwrap();
    let target = scratch.0.join("out").join("MyTheme.xaml");
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    export_theme(&target, "<x/>", Some(source.to_str().unwrap())).unwrap();
    assert_eq!(fs::read(scratch.0.join("out").join("MyTheme-overlay.png")).unwrap(), b"img");
    assert_eq!(fs::read_to_string(&target).unwrap(), "<x/>");
    assert!(export_theme(&scratch.0.join("x.txt"), "<x/>", None).is_err());
  }

  #[test]
  fn only_github_hosts_are_allowed() {
    assert!(is_allowed_github_url("https://api.github.com/repos/PlayStash/playstash-community-themes/contents/v1"));
    assert!(is_allowed_github_url("https://raw.githubusercontent.com/PlayStash/x/main/v1/a.xaml"));
    assert!(!is_allowed_github_url("http://api.github.com/x"));
    assert!(!is_allowed_github_url("https://evil.example/x"));
    assert!(!is_allowed_github_url("https://user:pw@api.github.com/x"));
  }
}
