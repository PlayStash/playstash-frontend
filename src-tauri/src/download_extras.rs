//! Helper commands for the download pipeline extras (WP5): free space per
//! download location, folder sizes for the download cards, the cached cover
//! for OS notifications and the duplicate-installation scan.

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Free bytes on the volume that holds `path`.
#[tauri::command]
pub(crate) async fn get_free_space(path: String) -> Result<u64, String> {
  tauri::async_runtime::spawn_blocking(move || {
    crate::util::free_space_on(Path::new(&path))
      .ok_or_else(|| format!("Could not determine the free space for {path}."))
  })
  .await
  .map_err(|error| format!("Free space lookup failed: {error}"))?
}

/// Recursive size of a file or directory. Links are not followed, unreadable
/// entries count as 0.
fn path_size(path: &Path) -> u64 {
  let Ok(metadata) = fs::symlink_metadata(path) else {
    return 0;
  };
  if metadata.file_type().is_symlink() {
    return 0;
  }
  if metadata.is_file() {
    return metadata.len();
  }
  let mut total = 0u64;
  let mut pending = vec![path.to_path_buf()];
  while let Some(dir) = pending.pop() {
    let Ok(entries) = fs::read_dir(&dir) else {
      continue;
    };
    for entry in entries.flatten() {
      let Ok(file_type) = entry.file_type() else {
        continue;
      };
      if file_type.is_symlink() {
        continue;
      }
      if file_type.is_dir() {
        pending.push(entry.path());
      } else if let Ok(meta) = entry.metadata() {
        total = total.saturating_add(meta.len());
      }
    }
  }
  total
}

/// Summed recursive size of the given files and directories (for example the
/// Download and Extraction folders of a download card).
#[tauri::command]
pub(crate) async fn get_paths_size(paths: Vec<String>) -> Result<u64, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let unique: BTreeSet<String> = paths.into_iter().filter(|p| !p.trim().is_empty()).collect();
    unique
      .iter()
      .map(|path| path_size(Path::new(path)))
      .fold(0u64, u64::saturating_add)
  })
  .await
  .map_err(|error| format!("Size calculation failed: {error}"))
}

fn valid_server_namespace(value: &str) -> bool {
  !value.is_empty()
    && value.len() <= 64
    && value
      .chars()
      .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
}

/// Absolute path of a cached image (`offline-cache/images/<ns>/<id>.<ext>`),
/// used as the picture of download notifications.
#[tauri::command]
pub(crate) async fn get_cached_image_path(
  app: tauri::AppHandle,
  server_namespace: String,
  media_id: i64,
) -> Result<Option<String>, String> {
  if !valid_server_namespace(&server_namespace) {
    return Err("Invalid server cache namespace".to_string());
  }
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?
    .join("offline-cache")
    .join("images")
    .join(server_namespace);
  let Ok(entries) = fs::read_dir(&dir) else {
    return Ok(None);
  };
  let prefix = format!("{media_id}.");
  Ok(
    entries
      .flatten()
      .find(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
      .map(|entry| entry.path().to_string_lossy().to_string()),
  )
}

/// One installed copy of a game.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallationLocation {
  pub root: String,
  pub installation_directory: String,
  pub version_directory: String,
}

/// A game that is installed under more than one download location.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DuplicateInstallation {
  pub game_id: i64,
  pub game_title: String,
  pub installations: Vec<InstallationLocation>,
}

/// Input row for [`find_duplicate_installations`].
#[derive(Clone, Debug)]
pub(crate) struct InstalledRow {
  pub root: String,
  pub game_id: i64,
  pub game_title: String,
  pub installation_directory: String,
  pub version_directory: String,
}

fn normalized_path(value: &str) -> String {
  let unified = value.replace('\\', "/");
  let trimmed = unified.trim_end_matches('/');
  if cfg!(windows) {
    trimmed.to_lowercase()
  } else {
    trimmed.to_string()
  }
}

/// Groups installed versions by game id and keeps the games that are
/// installed in more than one root. The same version folder reported twice
/// (for example through nested roots) is counted once.
pub(crate) fn find_duplicate_installations(rows: Vec<InstalledRow>) -> Vec<DuplicateInstallation> {
  let mut by_game: BTreeMap<i64, (String, Vec<InstalledRow>)> = BTreeMap::new();
  for row in rows {
    if row.game_id <= 0 {
      continue;
    }
    let entry = by_game
      .entry(row.game_id)
      .or_insert_with(|| (row.game_title.clone(), Vec::new()));
    let key = normalized_path(&row.version_directory);
    if entry
      .1
      .iter()
      .any(|existing| normalized_path(&existing.version_directory) == key)
    {
      continue;
    }
    entry.1.push(row);
  }

  by_game
    .into_iter()
    .filter_map(|(game_id, (game_title, rows))| {
      let roots: BTreeSet<String> = rows.iter().map(|row| normalized_path(&row.root)).collect();
      if roots.len() < 2 {
        return None;
      }
      Some(DuplicateInstallation {
        game_id,
        game_title,
        installations: rows
          .into_iter()
          .map(|row| InstallationLocation {
            root: row.root,
            installation_directory: row.installation_directory,
            version_directory: row.version_directory,
          })
          .collect(),
      })
    })
    .collect()
}

/// Scans every root for installed games and reports the ones installed in
/// more than one root.
#[tauri::command]
pub(crate) async fn scan_duplicate_installations(
  roots: Vec<String>,
) -> Result<Vec<DuplicateInstallation>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut rows = Vec::new();
    for root in roots {
      if root.trim().is_empty() || !PathBuf::from(&root).is_dir() {
        continue;
      }
      let Ok(installed) = crate::games::list_installed_games_blocking(root.clone()) else {
        continue;
      };
      for game in installed {
        rows.push(InstalledRow {
          root: root.clone(),
          game_id: game.game_id,
          game_title: game.game_title,
          installation_directory: game.installation_directory,
          version_directory: game.version_directory,
        });
      }
    }
    find_duplicate_installations(rows)
  })
  .await
  .map_err(|error| format!("Duplicate scan failed: {error}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn row(root: &str, id: i64, version_dir: &str) -> InstalledRow {
    InstalledRow {
      root: root.to_string(),
      game_id: id,
      game_title: format!("Game {id}"),
      installation_directory: format!("{version_dir}/Installation"),
      version_directory: version_dir.to_string(),
    }
  }

  #[test]
  fn reports_games_installed_in_several_roots() {
    let duplicates = find_duplicate_installations(vec![
      row("C:/Games", 1, "C:/Games/PlayStash/A/Versions/1"),
      row("D:/Games", 1, "D:/Games/PlayStash/A/Versions/1"),
      row("C:/Games", 2, "C:/Games/PlayStash/B/Versions/1"),
      row("C:/Games", 3, "C:/Games/PlayStash/C/Versions/1"),
      row("C:/Games", 3, "C:/Games/PlayStash/C/Versions/2"),
    ]);
    assert_eq!(duplicates.len(), 1);
    assert_eq!(duplicates[0].game_id, 1);
    assert_eq!(duplicates[0].installations.len(), 2);
    assert_eq!(duplicates[0].installations[1].root, "D:/Games");
  }

  #[test]
  fn ignores_the_same_folder_seen_through_nested_roots() {
    let duplicates = find_duplicate_installations(vec![
      row("/games", 7, "/games/sub/PlayStash/A/Versions/1"),
      row("/games/sub", 7, "/games/sub/PlayStash/A/Versions/1/"),
    ]);
    assert!(duplicates.is_empty());
  }

  #[test]
  fn ignores_rows_without_a_game_id() {
    let duplicates = find_duplicate_installations(vec![
      row("/a", 0, "/a/PlayStash/A/Versions/1"),
      row("/b", 0, "/b/PlayStash/A/Versions/1"),
    ]);
    assert!(duplicates.is_empty());
  }

  #[test]
  fn sums_file_and_folder_sizes() {
    struct Scratch(PathBuf);
    impl Drop for Scratch {
      fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
      }
    }
    let dir = std::env::temp_dir().join(format!("playstash-wp5-size-{}", std::process::id()));
    let _guard = Scratch(dir.clone());
    fs::create_dir_all(dir.join("nested")).unwrap();
    fs::write(dir.join("a.bin"), [0u8; 10]).unwrap();
    fs::write(dir.join("nested").join("b.bin"), [0u8; 5]).unwrap();
    assert_eq!(path_size(&dir), 15);
    assert_eq!(path_size(&dir.join("a.bin")), 10);
    assert_eq!(path_size(&dir.join("missing")), 0);
  }

  #[test]
  fn validates_cache_namespaces() {
    assert!(valid_server_namespace("srv_abc-1"));
    assert!(!valid_server_namespace("../etc"));
    assert!(!valid_server_namespace(""));
  }
}
