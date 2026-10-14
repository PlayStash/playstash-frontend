//! Helpers for launching and uninstalling local games: argument
//! splitting, uninstaller exit codes, "last played" bookkeeping and path
//! checks used by the Launch Options and Emulator dialogs.

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

const GAME_CONFIG_FILE: &str = ".playstash.game.config.json";

/// Splits launch parameters into arguments on platforms without a raw command
/// line (Unix). Whitespace separates arguments unless it is inside single or
/// double quotes; the quotes themselves are removed. Inside double quotes a
/// backslash escapes `"` and `\`. Outside quotes a backslash is kept literally,
/// so Windows paths passed to Wine survive unchanged.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn split_launch_args(params: &str) -> Vec<String> {
  let mut args = Vec::new();
  let mut current = String::new();
  let mut has_token = false;
  let mut chars = params.chars().peekable();
  let mut quote: Option<char> = None;

  while let Some(ch) = chars.next() {
    match quote {
      Some('"') => match ch {
        '"' => quote = None,
        '\\' if matches!(chars.peek(), Some('"') | Some('\\')) => {
          if let Some(next) = chars.next() {
            current.push(next);
          }
        }
        _ => current.push(ch),
      },
      Some(_) => {
        if ch == '\'' {
          quote = None;
        } else {
          current.push(ch);
        }
      }
      None => match ch {
        '"' | '\'' => {
          quote = Some(ch);
          has_token = true;
        }
        c if c.is_whitespace() => {
          if has_token {
            args.push(std::mem::take(&mut current));
            has_token = false;
          }
        }
        _ => {
          current.push(ch);
          has_token = true;
        }
      },
    }
  }
  if has_token {
    args.push(current);
  }
  args
}

/// Exit codes of a setup uninstaller that count as success: 0 and 3010
/// (`ERROR_SUCCESS_REBOOT_REQUIRED`). A process killed by a signal has no code
/// and does not count as success.
pub(crate) fn uninstall_exit_succeeded(code: Option<i32>) -> bool {
  matches!(code, Some(0) | Some(3010))
}

/// Overwrites an existing file in place (no truncating re-create, which fails
/// for hidden files on Windows) and restores its previous modified time, so
/// bookkeeping writes do not change what the library reads as the install
/// time.
fn write_preserving_mtime(path: &Path, content: &str) -> Result<(), String> {
  let previous_modified = fs::metadata(path).and_then(|meta| meta.modified()).ok();
  let mut file = fs::OpenOptions::new()
    .write(true)
    .open(path)
    .map_err(|error| format!("Failed to open {}: {error}", path.display()))?;
  file
    .set_len(0)
    .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
  file
    .write_all(content.as_bytes())
    .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
  if let Some(modified) = previous_modified {
    let _ = file.set_modified(modified);
  }
  Ok(())
}

/// Sets `lastlaunchedat` in a version config, keeping every other key.
pub(crate) fn apply_last_launched(config: &str, at_ms: u64) -> String {
  let mut value: serde_json::Value =
    serde_json::from_str(config).unwrap_or_else(|_| serde_json::json!({}));
  if !value.is_object() {
    value = serde_json::json!({});
  }
  value["lastlaunchedat"] = serde_json::json!(at_ms);
  serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
}

/// Stores the launch time (unix ms, default now) as `lastlaunchedat` in the
/// version's `.playstash.game.config.json`, so the installed-games order also
/// works offline.
#[tauri::command]
pub(crate) async fn set_last_played(
  version_directory: String,
  at: Option<u64>,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let path = PathBuf::from(&version_directory).join(GAME_CONFIG_FILE);
    if !path.is_file() {
      return Err(format!("{} does not exist", path.display()));
    }
    let at_ms = at.unwrap_or_else(|| {
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
    });
    let current = fs::read_to_string(&path).unwrap_or_default();
    write_preserving_mtime(&path, &apply_last_launched(&current, at_ms))
  })
  .await
  .map_err(|error| format!("Saving the launch time failed: {error}"))?
}

/// Reads `lastlaunchedat` from a parsed version config.
pub(crate) fn read_last_launched(config: &serde_json::Value) -> i64 {
  config
    .get("lastlaunchedat")
    .and_then(|value| value.as_i64().or_else(|| value.as_f64().map(|v| v as i64)))
    .unwrap_or(0)
    .max(0)
}

/// A file inside an installation, as a path relative to it and an absolute
/// path built from the (non-canonical) root the caller passed.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PathInside {
  /// Relative path with `/` separators.
  pub relative: String,
  pub absolute: String,
}

/// Relative path (with `/`) of `path` inside `root`, both canonical. `None`
/// when `path` is not strictly inside `root`.
pub(crate) fn relative_inside(canonical_path: &Path, canonical_root: &Path) -> Option<String> {
  let relative = canonical_path.strip_prefix(canonical_root).ok()?;
  if relative.as_os_str().is_empty() {
    return None;
  }
  let mut parts = Vec::new();
  for component in relative.components() {
    match component {
      Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
      _ => return None,
    }
  }
  Some(parts.join("/"))
}

/// Checks that `path` is an existing file strictly inside `root` (both are
/// canonicalized, so `..` and symlinks cannot escape) and returns it relative
/// to `root`. `None` when it is missing or outside.
#[tauri::command]
pub(crate) async fn resolve_path_inside(path: String, root: String) -> Option<PathInside> {
  let canonical_root = fs::canonicalize(&root).ok()?;
  let canonical_path = fs::canonicalize(&path).ok()?;
  if !canonical_path.is_file() {
    return None;
  }
  let relative = relative_inside(&canonical_path, &canonical_root)?;
  let absolute = relative
    .split('/')
    .fold(PathBuf::from(&root), |acc, part| acc.join(part));
  Some(PathInside {
    relative,
    absolute: absolute.to_string_lossy().to_string(),
  })
}

/// Picks the executable inside a macOS `.app` bundle: the file in
/// `Contents/MacOS` named like the bundle, otherwise the first file there.
fn app_bundle_executable(bundle: &Path) -> Option<PathBuf> {
  let macos = bundle.join("Contents").join("MacOS");
  let stem = bundle.file_stem()?.to_string_lossy().to_string();
  let preferred = macos.join(&stem);
  if preferred.is_file() {
    return Some(preferred);
  }
  let mut files: Vec<PathBuf> = fs::read_dir(&macos)
    .ok()?
    .flatten()
    .map(|entry| entry.path())
    .filter(|path| path.is_file())
    .collect();
  files.sort();
  files.into_iter().next()
}

/// Resolves a picked emulator to the file to execute: an existing file is
/// returned as is, a macOS `.app` bundle resolves to `Contents/MacOS/<exec>`.
/// `None` when nothing executable exists at `path`.
#[tauri::command]
pub(crate) async fn resolve_emulator_executable(path: String) -> Option<String> {
  let candidate = PathBuf::from(path.trim());
  if candidate.as_os_str().is_empty() {
    return None;
  }
  if candidate.is_file() {
    return Some(candidate.to_string_lossy().to_string());
  }
  let is_bundle = candidate
    .extension()
    .map(|ext| ext.eq_ignore_ascii_case("app"))
    .unwrap_or(false);
  if is_bundle && candidate.is_dir() {
    return app_bundle_executable(&candidate).map(|exe| exe.to_string_lossy().to_string());
  }
  None
}

/// Normalizes a path fragment for the uninstaller search: lowercase with `\`.
pub(crate) fn normalize_search_path(value: &str) -> String {
  value.replace('/', "\\").to_lowercase()
}

/// First file under `root` (breadth-first, sorted) whose path relative to
/// `root` contains `needle`, case-insensitively and with `/` and `\` treated
/// alike. Mirrors how the Windows client found `uninstaller_executable`.
pub(crate) fn find_file_containing_blocking(root: &Path, needle: &str) -> Option<PathBuf> {
  let needle = normalize_search_path(needle.trim());
  if needle.is_empty() || !root.is_dir() {
    return None;
  }
  let mut queue = std::collections::VecDeque::from([root.to_path_buf()]);
  let mut visited = 0usize;
  while let Some(dir) = queue.pop_front() {
    let Ok(entries) = fs::read_dir(&dir) else {
      continue;
    };
    let mut entries: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    entries.sort();
    for path in entries {
      visited += 1;
      if visited > 200_000 {
        return None;
      }
      if path.is_dir() {
        queue.push_back(path);
        continue;
      }
      let Ok(relative) = path.strip_prefix(root) else {
        continue;
      };
      if normalize_search_path(&relative.to_string_lossy()).contains(&needle) {
        return Some(path);
      }
    }
  }
  None
}

/// Finds the configured uninstaller inside an installation (see
/// [`find_file_containing_blocking`]). Returns its absolute path.
#[tauri::command]
pub(crate) async fn find_uninstaller_executable(
  installation_path: String,
  needle: String,
) -> Result<Option<String>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    find_file_containing_blocking(Path::new(&installation_path), &needle)
      .map(|path| path.to_string_lossy().to_string())
  })
  .await
  .map_err(|error| format!("Searching the uninstaller failed: {error}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  struct ScratchDir(PathBuf);
  impl ScratchDir {
    fn new(name: &str) -> Self {
      let dir = std::env::temp_dir().join(format!(
        "playstash-launch-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .map(|d| d.as_nanos())
          .unwrap_or(0)
      ));
      fs::create_dir_all(&dir).unwrap();
      Self(dir)
    }
  }
  impl Drop for ScratchDir {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn splits_quoted_launch_arguments() {
    assert_eq!(
      split_launch_args(r#"-L core.so "/home/me/My Games/rom file.sfc""#),
      vec!["-L", "core.so", "/home/me/My Games/rom file.sfc"]
    );
    assert_eq!(split_launch_args("  -a   -b  "), vec!["-a", "-b"]);
    assert_eq!(split_launch_args("'single quoted' x"), vec!["single quoted", "x"]);
    assert_eq!(split_launch_args(r#""a \"b\"""#), vec![r#"a "b""#]);
    assert_eq!(split_launch_args(r"C:\Games\rom.bin"), vec![r"C:\Games\rom.bin"]);
    assert_eq!(split_launch_args(r#""""#), vec![""]);
    assert!(split_launch_args("").is_empty());
  }

  #[test]
  fn maps_uninstaller_exit_codes() {
    assert!(uninstall_exit_succeeded(Some(0)));
    assert!(uninstall_exit_succeeded(Some(3010)));
    assert!(!uninstall_exit_succeeded(Some(1)));
    assert!(!uninstall_exit_succeeded(Some(1602)));
    assert!(!uninstall_exit_succeeded(None));
  }

  #[test]
  fn writes_last_launched_and_keeps_other_keys() {
    let next = apply_last_launched(r#"{"launchexecutable":"game.exe","gameid":4}"#, 1234);
    let value: serde_json::Value = serde_json::from_str(&next).unwrap();
    assert_eq!(value["lastlaunchedat"], 1234);
    assert_eq!(value["launchexecutable"], "game.exe");
    assert_eq!(value["gameid"], 4);
    assert_eq!(read_last_launched(&value), 1234);

    let from_garbage: serde_json::Value =
      serde_json::from_str(&apply_last_launched("not json", 5)).unwrap();
    assert_eq!(from_garbage["lastlaunchedat"], 5);
    assert_eq!(read_last_launched(&serde_json::json!({})), 0);
  }

  #[test]
  fn last_launched_write_keeps_the_modified_time() {
    let scratch = ScratchDir::new("mtime");
    let path = scratch.0.join(GAME_CONFIG_FILE);
    fs::write(&path, r#"{"gameid":1}"#).unwrap();
    let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
    fs::File::options()
      .write(true)
      .open(&path)
      .unwrap()
      .set_modified(old)
      .unwrap();

    write_preserving_mtime(&path, &apply_last_launched(r#"{"gameid":1}"#, 99)).unwrap();
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    assert_eq!(modified, old);
    let value: serde_json::Value =
      serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(value["lastlaunchedat"], 99);
  }

  #[test]
  fn relative_paths_must_stay_inside_the_root() {
    let root = Path::new("/games/x/Installation");
    assert_eq!(
      relative_inside(Path::new("/games/x/Installation/bin/game.exe"), root),
      Some("bin/game.exe".to_string())
    );
    assert_eq!(relative_inside(Path::new("/games/x/Installation"), root), None);
    assert_eq!(relative_inside(Path::new("/games/y/game.exe"), root), None);
  }

  #[test]
  fn finds_the_uninstaller_by_relative_path_fragment() {
    let scratch = ScratchDir::new("uninst");
    fs::create_dir_all(scratch.0.join("a").join("Tools")).unwrap();
    fs::write(scratch.0.join("readme.txt"), "x").unwrap();
    fs::write(scratch.0.join("a").join("Tools").join("Unins000.EXE"), "x").unwrap();

    let found = find_file_containing_blocking(&scratch.0, "tools/unins000").unwrap();
    assert!(found.ends_with(Path::new("a").join("Tools").join("Unins000.EXE")));
    assert!(find_file_containing_blocking(&scratch.0, "missing.exe").is_none());
    assert!(find_file_containing_blocking(&scratch.0, "  ").is_none());
  }
}
