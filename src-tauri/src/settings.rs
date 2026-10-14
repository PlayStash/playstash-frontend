use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::Manager;

#[derive(Serialize, Deserialize, Default, Clone)]
pub(crate) struct AppSettings {
  #[serde(default)]
  pub post_install: crate::post_install::PostInstallConfig,
  #[serde(default)]
  pub start_minimized: bool,
  #[serde(default)]
  pub minimize_on_game_launch: bool,
  #[serde(default)]
  pub ignored_executables: Vec<String>,
  #[serde(default)]
  pub ignore_list_initialized: bool,
  /// Base directory for Wine/Proton prefixes. When set, PlayStash creates an
  /// isolated `<base>/<slug>` prefix per game/installer so the OS root drive
  /// stays clean. Empty/None falls back to umu's built-in default location.
  #[serde(default)]
  pub default_wine_prefix: Option<String>,
  /// WebKitGTK smooth-scrolling override (Linux). `None` = leave WebKit default.
  #[serde(default)]
  pub webkit_smooth_scroll: Option<bool>,
  /// WebKitGTK hardware-acceleration policy (Linux): "Always" / "OnDemand" / "Never".
  /// `None` = leave WebKit default.
  #[serde(default)]
  pub webkit_hw_accel_policy: Option<String>,
  /// Whether the launch log window opens automatically when a game starts.
  /// Logs are always recorded; this only controls the window.
  #[serde(default)]
  pub always_show_launch_logs: bool,
  /// Pre-release channel ("unstable") whose one-time launch
  /// warning has already been acknowledged on this installation.
  ///
  /// This is kept in the app settings file instead of the webview's
  /// localStorage, because the webview data folder is cleared by the
  /// installer on updates - which made the warning reappear after each one.
  #[serde(default)]
  pub prerelease_notice_channel: Option<String>,
  /// Verbose diagnostics logging (Developer Tools).
  ///
  /// When off (the default), the diagnostics watchdog does not write its
  /// periodic interface snapshot to the app log. Hang detection and the
  /// automatic recovery reload stay active either way.
  #[serde(default)]
  pub diagnostics_verbose: bool,
}

#[derive(Serialize, Clone)]
pub(crate) struct IgnoreListState {
  pub ignored: Vec<String>,
  pub initialized: bool,
}

pub(crate) fn settings_path(app: &tauri::AppHandle) -> PathBuf {
  app.path().app_data_dir().unwrap().join("playstash-settings.json")
}

/// Last parsed settings, keyed by the file's modification time.
///
/// The time tracker reads the ignore list every 60 s tick; re-reading and
/// parsing the JSON from disk every time is pure overhead.
static SETTINGS_CACHE: OnceLock<Mutex<Option<(u64, AppSettings)>>> = OnceLock::new();

fn settings_cache() -> &'static Mutex<Option<(u64, AppSettings)>> {
  SETTINGS_CACHE.get_or_init(|| Mutex::new(None))
}

fn settings_modified_ms(path: &std::path::Path) -> u64 {
  std::fs::metadata(path)
    .and_then(|metadata| metadata.modified())
    .ok()
    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

pub(crate) fn load_settings(app: &tauri::AppHandle) -> AppSettings {
  let path = settings_path(app);
  let modified = settings_modified_ms(&path);

  if modified != 0 {
    if let Ok(cache) = settings_cache().lock() {
      if let Some((cached_modified, settings)) = cache.as_ref() {
        if *cached_modified == modified {
          return settings.clone();
        }
      }
    }
  }

  let settings = if path.exists() {
    std::fs::read_to_string(&path)
      .ok()
      .and_then(|data| serde_json::from_str::<AppSettings>(&data).ok())
      .unwrap_or_default()
  } else {
    AppSettings::default()
  };

  if modified != 0 {
    if let Ok(mut cache) = settings_cache().lock() {
      *cache = Some((modified, settings.clone()));
    }
  }

  settings
}

pub(crate) fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
  let path = settings_path(app);
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
  }
  let data = serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize: {}", e))?;
  std::fs::write(&path, &data).map_err(|e| format!("Failed to write config: {}", e))?;

  // Update the cache in place so the next reader does not re-parse the file.
  if let Ok(mut cache) = settings_cache().lock() {
    *cache = Some((settings_modified_ms(&path), settings.clone()));
  }
  Ok(())
}

#[tauri::command]
pub(crate) async fn get_start_minimized(app: tauri::AppHandle) -> bool {
  load_settings(&app).start_minimized
}

#[tauri::command]
pub(crate) async fn set_start_minimized(app: tauri::AppHandle, minimized: bool) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.start_minimized = minimized;
  save_settings(&app, &settings)
}

#[tauri::command]
pub(crate) async fn get_minimize_on_game_launch(app: tauri::AppHandle) -> bool {
  load_settings(&app).minimize_on_game_launch
}

#[tauri::command]
pub(crate) async fn set_minimize_on_game_launch(
  app: tauri::AppHandle,
  minimize_on_launch: bool,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.minimize_on_game_launch = minimize_on_launch;
  save_settings(&app, &settings)
}

#[tauri::command]
pub(crate) async fn get_ignore_list(app: tauri::AppHandle) -> IgnoreListState {
  let settings = load_settings(&app);
  IgnoreListState {
    ignored: settings.ignored_executables,
    initialized: settings.ignore_list_initialized,
  }
}

#[tauri::command]
pub(crate) async fn set_ignore_list(app: tauri::AppHandle, ignored: Vec<String>) -> Result<(), String> {
  let mut settings = load_settings(&app);

  let mut seen = HashSet::new();
  let mut clean = Vec::new();
  for name in ignored {
    let trimmed = name.trim();
    if trimmed.is_empty() {
      continue;
    }
    let key = trimmed.to_lowercase();
    if seen.insert(key) {
      clean.push(trimmed.to_string());
    }
  }

  settings.ignored_executables = clean;
  settings.ignore_list_initialized = true;
  save_settings(&app, &settings)
}

#[tauri::command]
pub(crate) async fn get_prerelease_notice_channel(app: tauri::AppHandle) -> Option<String> {
  load_settings(&app).prerelease_notice_channel
}
/// Records the pre-release channel whose warning was acknowledged. `None`
/// clears it, which makes the warning show up again on the next launch.
#[tauri::command]
pub(crate) async fn set_prerelease_notice_channel(
  app: tauri::AppHandle,
  channel: Option<String>,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.prerelease_notice_channel = channel
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  save_settings(&app, &settings)
}

#[tauri::command]
pub(crate) async fn get_default_wine_prefix(app: tauri::AppHandle) -> Option<String> {
  load_settings(&app).default_wine_prefix
}
#[tauri::command]
pub(crate) async fn set_default_wine_prefix(
  app: tauri::AppHandle,
  prefix: Option<String>,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  let trimmed = prefix
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());
  settings.default_wine_prefix = trimmed;
  save_settings(&app, &settings)
}

/// Whether the launch log window should open automatically on game start.
#[tauri::command]
pub(crate) async fn get_always_show_launch_logs(app: tauri::AppHandle) -> bool {
  load_settings(&app).always_show_launch_logs
}

#[tauri::command]
pub(crate) async fn set_always_show_launch_logs(
  app: tauri::AppHandle,
  enabled: bool,
) -> Result<(), String> {
  let mut settings = load_settings(&app);
  settings.always_show_launch_logs = enabled;
  save_settings(&app, &settings)
}

/// Whether the verbose diagnostics logging is enabled (Developer Tools).
#[tauri::command]
pub(crate) async fn get_diagnostics_verbose(app: tauri::AppHandle) -> bool {
  load_settings(&app).diagnostics_verbose
}

#[tauri::command]
pub(crate) async fn set_diagnostics_verbose(
  app: tauri::AppHandle,
  enabled: bool,
) -> Result<(), String> {
  crate::frontend_watchdog::set_verbose(enabled);
  let mut settings = load_settings(&app);
  settings.diagnostics_verbose = enabled;
  save_settings(&app, &settings)
}

// ── Per-package settings sections ──────────────────────────────────────
//
// New features keep their Rust-side settings in their own file
// `<app_data_dir>/settings/<name>.json` instead of growing `AppSettings`, so
// parallel work never touches the same struct. Writes are atomic (temp file +
// rename) and every section has its own lock, which makes `update_section` a
// safe read-modify-write. Section types should use `#[serde(default)]` so
// older files keep loading after fields are added.

static SECTION_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn section_lock(name: &str) -> Arc<Mutex<()>> {
  let locks = SECTION_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
  let mut locks = locks.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  locks
    .entry(name.to_string())
    .or_insert_with(|| Arc::new(Mutex::new(())))
    .clone()
}

/// Section names become file names, so only plain identifiers are allowed.
fn validate_section_name(name: &str) -> Result<(), String> {
  let valid = !name.is_empty()
    && name.len() <= 64
    && name
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
  if valid {
    Ok(())
  } else {
    Err(format!("Invalid settings section name: {name:?}"))
  }
}

fn sections_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .app_data_dir()
    .map(|dir| dir.join("settings"))
    .map_err(|e| format!("Failed to resolve app data dir: {}", e))
}

fn read_section_file<T: DeserializeOwned + Default>(dir: &Path, name: &str) -> T {
  if validate_section_name(name).is_err() {
    return T::default();
  }
  match std::fs::read_to_string(dir.join(format!("{name}.json"))) {
    Ok(data) => serde_json::from_str::<T>(&data).unwrap_or_else(|error| {
      log::warn!("settings section {name} is unreadable, using defaults: {error}");
      T::default()
    }),
    Err(_) => T::default(),
  }
}

fn write_section_file<T: Serialize>(dir: &Path, name: &str, value: &T) -> Result<(), String> {
  validate_section_name(name)?;
  std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
  let data = serde_json::to_string_pretty(value).map_err(|e| format!("Failed to serialize: {}", e))?;
  let target = dir.join(format!("{name}.json"));
  let nanos = std::time::SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_nanos())
    .unwrap_or(0);
  let temp = dir.join(format!(".{name}.json.{}-{nanos}.tmp", std::process::id()));
  std::fs::write(&temp, &data).map_err(|e| format!("Failed to write config: {}", e))?;
  // `rename` replaces the target in one step on Windows and Unix, so a crash
  // never leaves a half-written section behind.
  std::fs::rename(&temp, &target).map_err(|e| {
    let _ = std::fs::remove_file(&temp);
    format!("Failed to write config: {}", e)
  })
}

/// Loads the settings section `<name>`. A missing or unreadable file yields `T::default()`.
#[allow(dead_code)] // Used by the feature packages.
pub(crate) fn load_section<T: DeserializeOwned + Default>(app: &tauri::AppHandle, name: &str) -> T {
  let Ok(dir) = sections_dir(app) else {
    return T::default();
  };
  let lock = section_lock(name);
  let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  read_section_file(&dir, name)
}

/// Replaces the settings section `<name>` with `value`.
#[allow(dead_code)] // Used by the feature packages.
pub(crate) fn save_section<T: Serialize>(app: &tauri::AppHandle, name: &str, value: &T) -> Result<(), String> {
  let dir = sections_dir(app)?;
  let lock = section_lock(name);
  let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  write_section_file(&dir, name, value)
}

/// Read-modify-write of the settings section `<name>` under its lock, so
/// concurrent setters of the same section never lose each other's changes.
/// Returns the saved value.
#[allow(dead_code)] // Used by the feature packages.
pub(crate) fn update_section<T, F>(app: &tauri::AppHandle, name: &str, update: F) -> Result<T, String>
where
  T: DeserializeOwned + Serialize + Default,
  F: FnOnce(&mut T),
{
  let dir = sections_dir(app)?;
  update_section_in(&dir, name, update)
}

fn update_section_in<T, F>(dir: &Path, name: &str, update: F) -> Result<T, String>
where
  T: DeserializeOwned + Serialize + Default,
  F: FnOnce(&mut T),
{
  validate_section_name(name)?;
  let lock = section_lock(name);
  let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  let mut value = read_section_file::<T>(dir, name);
  update(&mut value);
  write_section_file(dir, name, &value)?;
  Ok(value)
}

#[cfg(test)]
mod tests {
  use super::*;

  struct ScratchDir(PathBuf);

  impl ScratchDir {
    fn new(label: &str) -> Self {
      let nanos = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
      Self(std::env::temp_dir().join(format!(
        "playstash-settings-section-{label}-{}-{nanos}",
        std::process::id()
      )))
    }
  }

  impl Drop for ScratchDir {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  #[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
  struct Sample {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    count: u32,
  }

  #[test]
  fn missing_section_loads_defaults() {
    let scratch = ScratchDir::new("missing");
    assert_eq!(read_section_file::<Sample>(&scratch.0, "sample"), Sample::default());
  }

  #[test]
  fn section_round_trips_without_leaving_temp_files() {
    let scratch = ScratchDir::new("roundtrip");
    let value = Sample { enabled: true, count: 3 };
    write_section_file(&scratch.0, "sample", &value).unwrap();
    write_section_file(&scratch.0, "sample", &value).unwrap();
    assert_eq!(read_section_file::<Sample>(&scratch.0, "sample"), value);
    let files: Vec<_> = std::fs::read_dir(&scratch.0)
      .unwrap()
      .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
      .collect();
    assert_eq!(files, vec!["sample.json".to_string()]);
  }

  #[test]
  fn unreadable_section_falls_back_to_defaults() {
    let scratch = ScratchDir::new("unreadable");
    std::fs::create_dir_all(&scratch.0).unwrap();
    std::fs::write(scratch.0.join("sample.json"), "{ not json").unwrap();
    assert_eq!(read_section_file::<Sample>(&scratch.0, "sample"), Sample::default());
  }

  #[test]
  fn rejects_section_names_that_are_not_plain_identifiers() {
    let scratch = ScratchDir::new("names");
    for name in ["", "../escape", "a/b", "a\\b", "tray.json"] {
      assert!(write_section_file(&scratch.0, name, &Sample::default()).is_err(), "{name}");
    }
    assert!(validate_section_name("cloud-saves_v2").is_ok());
  }

  #[test]
  fn concurrent_updates_do_not_lose_writes() {
    let scratch = ScratchDir::new("concurrent");
    let handles: Vec<_> = (0..8)
      .map(|_| {
        let dir = scratch.0.clone();
        std::thread::spawn(move || {
          for _ in 0..10 {
            update_section_in::<Sample, _>(&dir, "counter", |value| value.count += 1).unwrap();
          }
        })
      })
      .collect();
    for handle in handles {
      handle.join().unwrap();
    }
    assert_eq!(read_section_file::<Sample>(&scratch.0, "counter").count, 80);
  }
}
