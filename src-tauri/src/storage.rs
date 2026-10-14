//! Storage / data settings (WP7): cache sizes, clearing the offline game
//! cache and the app data folder.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app.path().app_data_dir().map_err(|error| error.to_string())
}

/// Recursive byte size of a directory. Links are not followed.
pub(crate) fn dir_size(path: &Path) -> u64 {
  let Ok(metadata) = fs::symlink_metadata(path) else {
    return 0;
  };
  if metadata.file_type().is_symlink() {
    return 0;
  }
  if metadata.is_file() {
    return metadata.len();
  }
  let Ok(entries) = fs::read_dir(path) else {
    return 0;
  };
  entries.flatten().map(|entry| dir_size(&entry.path())).sum()
}

#[derive(Serialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CacheSizes {
  /// `offline-cache/images` (all servers).
  image_bytes: u64,
  /// `offline-cache/games`.
  offline_bytes: u64,
}

#[tauri::command]
pub(crate) async fn storage_cache_sizes(app: tauri::AppHandle) -> Result<CacheSizes, String> {
  let root = app_data_dir(&app)?.join("offline-cache");
  tauri::async_runtime::spawn_blocking(move || CacheSizes {
    image_bytes: dir_size(&root.join("images")),
    offline_bytes: dir_size(&root.join("games")),
  })
  .await
  .map_err(|error| error.to_string())
}

/// Deletes `<id>.json` entries of the offline game cache. Ids in `keep`
/// (installed games) are kept unless `keep` is empty and `all` is set.
pub(crate) fn clear_offline_games(dir: &Path, keep: &HashSet<i64>, all: bool) -> Result<u64, String> {
  if !dir.exists() {
    return Ok(0);
  }
  let mut deleted = 0u64;
  for entry in fs::read_dir(dir).map_err(|error| error.to_string())?.flatten() {
    let path = entry.path();
    let Some(id) = path
      .file_name()
      .and_then(|name| name.to_str())
      .and_then(|name| name.strip_suffix(".json"))
      .and_then(|stem| stem.parse::<i64>().ok())
    else {
      continue;
    };
    if !all && keep.contains(&id) {
      continue;
    }
    if path.is_file() {
      fs::remove_file(&path).map_err(|error| error.to_string())?;
      deleted += 1;
    }
  }
  Ok(deleted)
}

#[tauri::command]
pub(crate) async fn storage_clear_offline_cache(
  app: tauri::AppHandle,
  keep_game_ids: Vec<i64>,
  all: bool,
) -> Result<u64, String> {
  let dir = app_data_dir(&app)?.join("offline-cache").join("games");
  let keep: HashSet<i64> = keep_game_ids.into_iter().collect();
  tauri::async_runtime::spawn_blocking(move || clear_offline_games(&dir, &keep, all))
    .await
    .map_err(|error| error.to_string())?
}

/// The app data folder ("user cache folder"), created when missing.
#[tauri::command]
pub(crate) async fn storage_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
  let dir = app_data_dir(&app)?;
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir.to_string_lossy().to_string())
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
      let path = std::env::temp_dir().join(format!("playstash-storage-{label}-{}-{nanos}", std::process::id()));
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
  fn dir_size_sums_nested_files() {
    let scratch = ScratchDir::new("size");
    fs::write(scratch.0.join("a.bin"), [0u8; 10]).unwrap();
    fs::create_dir_all(scratch.0.join("sub")).unwrap();
    fs::write(scratch.0.join("sub").join("b.bin"), [0u8; 5]).unwrap();
    assert_eq!(dir_size(&scratch.0), 15);
    assert_eq!(dir_size(&scratch.0.join("missing")), 0);
  }

  #[test]
  fn clearing_keeps_installed_games_unless_all() {
    let scratch = ScratchDir::new("clear");
    for id in [1, 2, 3] {
      fs::write(scratch.0.join(format!("{id}.json")), "{}").unwrap();
    }
    fs::write(scratch.0.join("notes.txt"), "keep").unwrap();
    let keep: HashSet<i64> = [2].into_iter().collect();
    assert_eq!(clear_offline_games(&scratch.0, &keep, false).unwrap(), 2);
    assert!(scratch.0.join("2.json").exists());
    assert!(scratch.0.join("notes.txt").exists());
    assert_eq!(clear_offline_games(&scratch.0, &keep, true).unwrap(), 1);
    assert!(!scratch.0.join("2.json").exists());
    assert_eq!(clear_offline_games(&scratch.0.join("missing"), &keep, true).unwrap(), 0);
  }
}
