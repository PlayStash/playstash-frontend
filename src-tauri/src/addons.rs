use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;
use tokio::io::AsyncWriteExt;

static ACTIVE: OnceLock<Mutex<std::collections::HashSet<PathBuf>>> = OnceLock::new();

struct InstallationLock(PathBuf);
impl Drop for InstallationLock {
  fn drop(&mut self) { if let Ok(mut active) = ACTIVE.get_or_init(Default::default).lock() { active.remove(&self.0); } }
}
struct StagingDirectory(PathBuf);
impl Drop for StagingDirectory {
  fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn collect_files(root: &Path, directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
  for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
    let entry = entry.map_err(|error| error.to_string())?;
    let kind = entry.file_type().map_err(|error| error.to_string())?;
    if kind.is_symlink() { return Err("Addon contains a symbolic link.".into()); }
    if kind.is_dir() { collect_files(root, &entry.path(), files)?; }
    else if kind.is_file() { files.push(entry.path().strip_prefix(root).map_err(|error| error.to_string())?.to_path_buf()); }
    else { return Err("Addon contains a special file.".into()); }
  }
  Ok(())
}

fn validate_destination(root: &Path, relative: &Path) -> Result<PathBuf, String> {
  if relative.is_absolute() || relative.components().any(|component| !matches!(component, std::path::Component::Normal(_))) {
    return Err("Addon contains an unsafe path.".into());
  }
  let mut output = root.to_path_buf();
  for component in relative.components() {
    output.push(component);
    if let Ok(metadata) = std::fs::symlink_metadata(&output) {
      if metadata.file_type().is_symlink() { return Err("Addon cannot overwrite or follow symbolic links.".into()); }
    }
  }
  Ok(output)
}

fn apply_files(staging: &Path, installation: &Path) -> Result<usize, String> {
  let mut files = Vec::new();
  collect_files(staging, staging, &mut files)?;
  // Check the entire plan before modifying any installed files.
  for relative in &files { validate_destination(installation, relative)?; }
  for relative in &files {
    let output = validate_destination(installation, relative)?;
    let parent = output.parent().ok_or("Invalid addon destination.")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(".playstash-addon-{}", unique_id()?));
    std::fs::copy(staging.join(relative), &temporary).map_err(|error| error.to_string())?;
    // Replacing the directory entry also avoids modifying an existing hard link
    // to a file outside the installation.
    if output.exists() { std::fs::remove_file(&output).map_err(|error| error.to_string())?; }
    std::fs::rename(&temporary, &output).map_err(|error| error.to_string())?;
  }
  Ok(files.len())
}

fn unique_id() -> Result<String, String> {
  let mut bytes = [0u8; 16];
  getrandom::getrandom(&mut bytes).map_err(|error| error.to_string())?;
  Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Each explicit UI request applies one addon. The UI awaits these requests in
/// the selected order. No executable from an addon is ever launched.
#[tauri::command]
pub(crate) async fn install_game_addon(
  app: tauri::AppHandle,
  game_id: i64,
  download_url: String,
  access_token: String,
  archive_name: String,
  installation_path: String,
  password: Option<String>,
  overwrite_confirmed: bool,
) -> Result<usize, String> {
  if !overwrite_confirmed { return Err("Confirm that addons may overwrite installed files.".into()); }
  let url = url::Url::parse(&download_url).map_err(|_| "Invalid asset URL.")?;
  if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
    return Err("Use an HTTP(S) asset URL without embedded credentials.".into());
  }
  let installation = std::fs::canonicalize(installation_path).map_err(|error| error.to_string())?;
  if !installation.is_dir() { return Err("Install the game before applying addons.".into()); }
  {
    let mut active = ACTIVE.get_or_init(Default::default).lock().map_err(|_| "Addon lock is unavailable.")?;
    if !active.insert(installation.clone()) { return Err("Another addon is being installed into this game.".into()); }
  }
  let _lock = InstallationLock(installation.clone());
  let staging = app.path().app_cache_dir().map_err(|error| error.to_string())?.join(format!("addon-{}", unique_id()?));
  std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
  let _staging = StagingDirectory(staging.clone());
  let name = Path::new(&archive_name).file_name().ok_or("Invalid addon filename.")?;
  if name.to_string_lossy().contains(['\\', ':']) { return Err("Invalid addon filename.".into()); }
  let archive = staging.join(name);
  let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().map_err(|error| error.to_string())?;
  let response = crate::net::server_request(client.get(url.clone()), url.as_str()).bearer_auth(access_token).send().await.map_err(|_| "Addon download failed.")?;
  if !response.status().is_success() { return Err(format!("Addon download returned HTTP {}.", response.status())); }
  let mut output = tokio::fs::File::create(&archive).await.map_err(|error| error.to_string())?;
  let mut stream = response.bytes_stream();
  while let Some(chunk) = stream.next().await {
    output.write_all(&chunk.map_err(|_| "Addon download was interrupted.")?).await.map_err(|error| error.to_string())?;
  }
  output.flush().await.map_err(|error| error.to_string())?;
  drop(output);
  let extracted = staging.join("contents");
  let result = crate::extraction::extract_archive(app, -game_id.abs(), archive.to_string_lossy().into(), extracted.to_string_lossy().into(), password).await?;
  if !result.success { return Err(result.message.unwrap_or_else(|| "Addon extraction failed; check its password.".into())); }
  tauri::async_runtime::spawn_blocking(move || apply_files(&extracted, &installation)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn destination_rejects_traversal_and_absolute_paths() {
    assert!(validate_destination(Path::new("/games"), Path::new("../outside")).is_err());
    assert!(validate_destination(Path::new("/games"), Path::new("/outside")).is_err());
    assert_eq!(validate_destination(Path::new("/games"), Path::new("bin/game.exe")).unwrap(), PathBuf::from("/games/bin/game.exe"));
  }
  #[test]
  fn files_are_applied_and_overwritten_without_running_scripts() {
    let root = std::env::temp_dir().join(format!("playstash-addon-test-{}", unique_id().unwrap()));
    let stage = root.join("stage"); let install = root.join("install");
    std::fs::create_dir_all(stage.join("bin")).unwrap(); std::fs::create_dir_all(install.join("bin")).unwrap();
    std::fs::write(stage.join("bin/game.exe"), "new").unwrap(); std::fs::write(install.join("bin/game.exe"), "old").unwrap();
    assert_eq!(apply_files(&stage, &install).unwrap(), 1);
    assert_eq!(std::fs::read_to_string(install.join("bin/game.exe")).unwrap(), "new");
    std::fs::remove_dir_all(root).unwrap();
  }
  #[cfg(unix)]
  #[test]
  fn existing_destination_links_are_rejected_before_any_write() {
    let root = std::env::temp_dir().join(format!("playstash-addon-test-{}", unique_id().unwrap()));
    let stage = root.join("stage"); let install = root.join("install"); let outside = root.join("outside");
    std::fs::create_dir_all(stage.join("bin")).unwrap(); std::fs::create_dir_all(&install).unwrap(); std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(stage.join("bin/game.exe"), "new").unwrap(); std::os::unix::fs::symlink(&outside, install.join("bin")).unwrap();
    assert!(apply_files(&stage, &install).is_err()); assert!(!outside.join("game.exe").exists());
    std::fs::remove_dir_all(root).unwrap();
  }
}
