//! Steam non-Steam-game shortcuts (`shortcuts.vdf`) for installed games.
//!
//! Port of the WPF `SteamHelper`: every PlayStash-owned entry carries
//! `ShortcutPath = playstash://start?gameid=<id>` as ownership marker. A sync
//! removes all owned entries and appends one per installed game, so changed
//! executables and launch options are always applied. Foreign shortcuts keep
//! their keys and order. All file errors are swallowed by the callers in JS;
//! the commands still report them for logging.

use crate::vdf::{self, VdfMap, VdfValue};
use md5::{Digest, Md5};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const SHORTCUTS_FILE: &str = "shortcuts.vdf";
const BACKUP_FILE: &str = "shortcuts.vdf.backup";
const OWNERSHIP_PREFIX: &str = "playstash://";

/// Serialises every read-modify-write of `shortcuts.vdf`.
static SHORTCUTS_LOCK: Mutex<()> = Mutex::new(());

/// The Steam grid id of a shortcut, identical to the WPF client and to
/// Steam ROM Manager style tools: MD5 of the UTF-8 input, the first four bytes
/// as a big-endian number, `-(value % 1_000_000_000)` as a two's complement
/// `u32`. Used for the `appid` field and the grid image names.
pub(crate) fn steam_grid_id(input: &str) -> u32 {
  let hash = Md5::digest(input.as_bytes());
  let value = u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]);
  let signed = -((value % 1_000_000_000) as i32);
  signed as u32
}

fn starts_with_ignore_case(value: &str, prefix: &str) -> bool {
  value.len() >= prefix.len()
    && value.is_char_boundary(prefix.len())
    && value[..prefix.len()].eq_ignore_ascii_case(prefix)
}

/// True when `ShortcutPath` or `Exe` starts with `playstash://`
/// (case-insensitive).
pub(crate) fn is_playstash_shortcut(entry: &VdfMap) -> bool {
  ["ShortcutPath", "Exe"].iter().any(|key| {
    vdf::map_get_ignore_case(entry, key)
      .and_then(VdfValue::as_str)
      .is_some_and(|value| starts_with_ignore_case(value, OWNERSHIP_PREFIX))
  })
}

fn entry_appid(entry: &VdfMap) -> Option<String> {
  // The WPF client read element 0, which is `appid` in every entry it wrote.
  let value = vdf::map_get_ignore_case(entry, "appid").or_else(|| entry.first().map(|(_, value)| value))?;
  match value {
    VdfValue::Int32(number) => Some(number.to_string()),
    VdfValue::String(text) => Some(text.clone()),
    _ => None,
  }
}

/// Removes every PlayStash-owned entry and returns the remaining list (same
/// keys and order) plus the appids of the removed entries.
pub(crate) fn remove_owned_shortcuts(shortcuts: &VdfMap) -> (VdfMap, Vec<String>) {
  let mut kept = VdfMap::new();
  let mut removed = Vec::new();
  for (key, value) in shortcuts {
    match value.as_map() {
      Some(entry) if is_playstash_shortcut(entry) => {
        if let Some(appid) = entry_appid(entry) {
          removed.push(appid);
        }
      }
      _ => kept.push((key.clone(), value.clone())),
    }
  }
  (kept, removed)
}

fn next_index(shortcuts: &VdfMap) -> i64 {
  shortcuts
    .iter()
    .filter_map(|(key, _)| key.parse::<i32>().ok())
    .map(i64::from)
    .max()
    .unwrap_or(-1)
    + 1
}

/// One game to add, as resolved by the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SteamShortcutGame {
  pub game_id: i64,
  pub title: String,
  /// Absolute path of the game (or emulator) executable.
  pub exe: String,
  /// Working directory; defaults to the executable's folder.
  #[serde(default)]
  pub start_dir: Option<String>,
  #[serde(default)]
  pub launch_options: Option<String>,
  /// Offline-cache media id of the cover (portrait capsule).
  #[serde(default)]
  pub cover_media_id: Option<i64>,
  /// Offline-cache media id of the background (hero).
  #[serde(default)]
  pub hero_media_id: Option<i64>,
  /// Launch through PlayStash (`start --gameid=<id>`) because Steam cannot
  /// replicate the launch (umu/Proton, emulator configs, run as admin).
  #[serde(default)]
  pub via_playstash: bool,
}

/// The `Exe`, `StartDir` and `LaunchOptions` a shortcut will get.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ShortcutLaunch {
  pub exe: String,
  pub start_dir: String,
  pub launch_options: String,
}

pub(crate) fn shortcut_launch(game: &SteamShortcutGame, playstash_exe: &Path, windows_exe_needs_playstash: bool) -> ShortcutLaunch {
  let exe_path = Path::new(&game.exe);
  let via_playstash = game.via_playstash || windows_exe_needs_playstash;
  if via_playstash {
    let start_dir = playstash_exe.parent().map(|dir| dir.to_string_lossy().into_owned()).unwrap_or_default();
    return ShortcutLaunch {
      exe: playstash_exe.to_string_lossy().into_owned(),
      start_dir,
      launch_options: format!("start --gameid={}", game.game_id),
    };
  }
  let start_dir = game
    .start_dir
    .clone()
    .filter(|dir| !dir.trim().is_empty())
    .or_else(|| exe_path.parent().map(|dir| dir.to_string_lossy().into_owned()))
    .unwrap_or_default();
  ShortcutLaunch {
    exe: game.exe.clone(),
    start_dir,
    launch_options: game.launch_options.clone().unwrap_or_default(),
  }
}

/// Builds one shortcut entry, fields in the WPF order.
pub(crate) fn shortcut_entry(game: &SteamShortcutGame, appid: u32, launch: &ShortcutLaunch, config_dir: &Path) -> VdfMap {
  let icon = config_dir.join("grid").join(format!("{appid}p.png"));
  let string = |value: &str| VdfValue::String(value.to_string());
  vec![
    ("appid".into(), VdfValue::Int32(appid)),
    ("AppName".into(), string(&game.title)),
    ("Exe".into(), string(&format!("\"{}\"", launch.exe))),
    ("StartDir".into(), string(&format!("\"{}\"", launch.start_dir))),
    ("icon".into(), string(&icon.to_string_lossy())),
    ("ShortcutPath".into(), string(&format!("{OWNERSHIP_PREFIX}start?gameid={}", game.game_id))),
    ("LaunchOptions".into(), string(&launch.launch_options)),
    ("IsHidden".into(), VdfValue::Int32(0)),
    ("AllowDesktopConfig".into(), VdfValue::Int32(1)),
    ("AllowOverlay".into(), VdfValue::Int32(1)),
    ("OpenVR".into(), VdfValue::Int32(0)),
    ("Devkit".into(), VdfValue::Int32(0)),
    ("DevkitGameID".into(), string("")),
    ("DevkitOverrideAppID".into(), VdfValue::Int32(0)),
    ("LastPlayTime".into(), VdfValue::Int32(0)),
    ("FlatpakAppID".into(), string("")),
    ("tags".into(), VdfValue::Map(Vec::new())),
  ]
}

/// Result of [`plan_sync`]: the new shortcut list, the appids whose grid
/// images must be deleted and the games whose images must be copied.
pub(crate) struct SyncPlan {
  pub shortcuts: VdfMap,
  pub removed_appids: Vec<String>,
  pub added: Vec<(u32, SteamShortcutGame)>,
}

/// Pure sync step: drop owned entries, append the given games (each with its
/// pre-resolved launch) with keys continuing from the highest numeric key.
pub(crate) fn plan_sync(existing: &VdfMap, games: &[(SteamShortcutGame, ShortcutLaunch)], config_dir: &Path) -> SyncPlan {
  let (mut shortcuts, removed_appids) = remove_owned_shortcuts(existing);
  let first_index = next_index(&shortcuts);
  let mut added = Vec::new();
  for (index, (game, launch)) in (first_index..).zip(games) {
    let appid = steam_grid_id(&format!("{}{}", game.title, game.game_id));
    shortcuts.push((index.to_string(), VdfValue::Map(shortcut_entry(game, appid, launch, config_dir))));
    added.push((appid, game.clone()));
  }
  SyncPlan { shortcuts, removed_appids, added }
}

// ── Locating Steam ─────────────────────────────────────────────────────────

#[cfg(windows)]
fn steam_roots() -> Vec<PathBuf> {
  use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
  use winreg::RegKey;
  let mut roots = Vec::new();
  let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
  for key in ["SOFTWARE\\WOW6432Node\\Valve\\Steam", "SOFTWARE\\Valve\\Steam"] {
    if let Ok(value) = machine.open_subkey(key).and_then(|key| key.get_value::<String, _>("InstallPath")) {
      roots.push(PathBuf::from(value));
      break;
    }
  }
  if let Ok(value) = RegKey::predef(HKEY_CURRENT_USER)
    .open_subkey("Software\\Valve\\Steam")
    .and_then(|key| key.get_value::<String, _>("SteamPath"))
  {
    // SteamPath uses forward slashes.
    roots.push(PathBuf::from(value.replace('/', "\\")));
  }
  roots
}

#[cfg(target_os = "macos")]
fn steam_roots() -> Vec<PathBuf> {
  std::env::var_os("HOME")
    .map(PathBuf::from)
    .map(|home| vec![home.join("Library/Application Support/Steam")])
    .unwrap_or_default()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn steam_roots() -> Vec<PathBuf> {
  let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
    return Vec::new();
  };
  vec![
    home.join(".steam/steam"),
    home.join(".local/share/Steam"),
    home.join(".var/app/com.valvesoftware.Steam/data/Steam"),
  ]
}

/// `<steam>/userdata/<accountId>/config` of the most recent Steam user, or
/// `None` if Steam or the user folder cannot be found.
pub(crate) fn find_user_config_dir() -> Option<PathBuf> {
  let mut seen = Vec::new();
  for root in steam_roots() {
    let canonical = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    if seen.contains(&canonical) {
      continue;
    }
    seen.push(canonical);
    let Ok(loginusers) = fs::read_to_string(root.join("config").join("loginusers.vdf")) else {
      continue;
    };
    let Some(account_id) = vdf::most_recent_steam_account_id(&loginusers) else {
      continue;
    };
    let dir = root.join("userdata").join(account_id.to_string()).join("config");
    if dir.is_dir() {
      return Some(dir);
    }
  }
  None
}

/// The executable Steam should start for "via PlayStash" shortcuts. On Linux
/// AppImages `current_exe` points into a temporary mount, so `$APPIMAGE` wins.
fn playstash_executable() -> Option<PathBuf> {
  if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|value| !value.is_empty()) {
    return Some(PathBuf::from(appimage));
  }
  std::env::current_exe().ok()
}

// ── File operations ────────────────────────────────────────────────────────

fn ensure_backup(config_dir: &Path) -> Result<(), String> {
  let shortcuts = config_dir.join(SHORTCUTS_FILE);
  let backup = config_dir.join(BACKUP_FILE);
  if !backup.exists() && shortcuts.exists() {
    fs::copy(&shortcuts, &backup).map_err(|error| format!("Failed to back up shortcuts.vdf: {error}"))?;
  }
  Ok(())
}

/// Reads the shortcut list. A missing file is empty. A file that cannot be
/// parsed is kept as `shortcuts.vdf.corrupt` and treated as empty, like the
/// WPF client (which overwrote it without a copy).
fn read_shortcuts_file(config_dir: &Path) -> VdfMap {
  let path = config_dir.join(SHORTCUTS_FILE);
  let Ok(bytes) = fs::read(&path) else {
    return VdfMap::new();
  };
  match vdf::read_shortcuts(&bytes) {
    Ok(shortcuts) => shortcuts,
    Err(error) => {
      log::warn!("[steam] shortcuts.vdf could not be parsed ({error}); rebuilding it");
      let _ = fs::write(config_dir.join("shortcuts.vdf.corrupt"), &bytes);
      VdfMap::new()
    }
  }
}

fn write_shortcuts_file(config_dir: &Path, shortcuts: &VdfMap) -> Result<(), String> {
  let bytes = vdf::write_shortcuts(shortcuts).map_err(|error| error.to_string())?;
  let path = config_dir.join(SHORTCUTS_FILE);
  let temp = config_dir.join("shortcuts.vdf.playstash-tmp");
  fs::write(&temp, &bytes).map_err(|error| format!("Failed to write shortcuts.vdf: {error}"))?;
  fs::rename(&temp, &path).or_else(|_| {
    // Rename over an existing file can fail on some Windows file systems.
    let _ = fs::remove_file(&path);
    fs::rename(&temp, &path)
  })
  .map_err(|error| format!("Failed to replace shortcuts.vdf: {error}"))
}

fn remove_grid_images(grid_dir: &Path, appid: &str) {
  for name in [format!("{appid}p.png"), format!("{appid}_hero.png")] {
    let path = grid_dir.join(name);
    if path.is_file() {
      let _ = fs::remove_file(path);
    }
  }
}

fn offline_image_dir(app: &tauri::AppHandle, server_namespace: &str) -> Option<PathBuf> {
  let valid = !server_namespace.is_empty()
    && server_namespace.len() <= 64
    && server_namespace.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
  if !valid {
    return None;
  }
  Some(app.path().app_data_dir().ok()?.join("offline-cache").join("images").join(server_namespace))
}

fn cached_image(dir: &Path, media_id: i64) -> Option<PathBuf> {
  let prefix = format!("{media_id}.");
  fs::read_dir(dir)
    .ok()?
    .flatten()
    .find(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
    .map(|entry| entry.path())
}

/// Writes `source` as PNG to `target`. PNG files are copied; other formats
/// are converted. Undecodable files are copied as they are (Steam sniffs the
/// content, which is what the WPF client relied on).
fn copy_as_png(source: &Path, target: &Path) -> Result<(), String> {
  let bytes = fs::read(source).map_err(|error| error.to_string())?;
  if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
    return fs::write(target, &bytes).map_err(|error| error.to_string());
  }
  match image::load_from_memory(&bytes) {
    Ok(decoded) => decoded
      .save_with_format(target, image::ImageFormat::Png)
      .map_err(|error| error.to_string()),
    Err(_) => fs::write(target, &bytes).map_err(|error| error.to_string()),
  }
}

fn set_grid_images(grid_dir: &Path, image_dir: Option<&Path>, appid: u32, game: &SteamShortcutGame) {
  let Some(image_dir) = image_dir else { return };
  for (media_id, name) in [
    (game.cover_media_id, format!("{appid}p.png")),
    (game.hero_media_id, format!("{appid}_hero.png")),
  ] {
    let Some(media_id) = media_id else { continue };
    let target = grid_dir.join(name);
    if target.exists() {
      continue;
    }
    if let Some(source) = cached_image(image_dir, media_id) {
      if let Err(error) = copy_as_png(&source, &target) {
        log::warn!("[steam] Failed to copy grid image for {}: {error}", game.game_id);
      }
    }
  }
}

fn sync_blocking(app: &tauri::AppHandle, server_namespace: Option<String>, games: Vec<SteamShortcutGame>) -> Result<usize, String> {
  let _guard = SHORTCUTS_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  let Some(config_dir) = find_user_config_dir() else {
    return Ok(0);
  };
  ensure_backup(&config_dir)?;
  let existing = read_shortcuts_file(&config_dir);
  let playstash_exe = playstash_executable().unwrap_or_default();
  let resolved: Vec<(SteamShortcutGame, ShortcutLaunch)> = games
    .into_iter()
    .filter(|game| game.game_id > 0 && !game.title.trim().is_empty() && Path::new(&game.exe).is_file())
    .filter_map(|game| {
      let needs_playstash = !cfg!(windows) && crate::umu::is_windows_executable(Path::new(&game.exe));
      if (game.via_playstash || needs_playstash) && playstash_exe.as_os_str().is_empty() {
        return None;
      }
      let launch = shortcut_launch(&game, &playstash_exe, needs_playstash);
      Some((game, launch))
    })
    .collect();
  let plan = plan_sync(&existing, &resolved, &config_dir);
  write_shortcuts_file(&config_dir, &plan.shortcuts)?;

  // Images only change once the VDF write worked.
  let grid_dir = config_dir.join("grid");
  fs::create_dir_all(&grid_dir).map_err(|error| format!("Failed to create the Steam grid folder: {error}"))?;
  for appid in &plan.removed_appids {
    remove_grid_images(&grid_dir, appid);
  }
  let image_dir = server_namespace.as_deref().and_then(|namespace| offline_image_dir(app, namespace));
  for (appid, game) in &plan.added {
    set_grid_images(&grid_dir, image_dir.as_deref(), *appid, game);
  }
  Ok(plan.added.len())
}

fn remove_blocking() -> Result<usize, String> {
  let _guard = SHORTCUTS_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  let Some(config_dir) = find_user_config_dir() else {
    return Ok(0);
  };
  let path = config_dir.join(SHORTCUTS_FILE);
  if !path.exists() {
    return Ok(0);
  }
  let bytes = fs::read(&path).map_err(|error| format!("Failed to read shortcuts.vdf: {error}"))?;
  // Unlike a sync, never rewrite a file that cannot be parsed here.
  let existing = vdf::read_shortcuts(&bytes).map_err(|error| error.to_string())?;
  let (kept, removed) = remove_owned_shortcuts(&existing);
  if removed.is_empty() {
    return Ok(0);
  }
  write_shortcuts_file(&config_dir, &kept)?;
  let grid_dir = config_dir.join("grid");
  for appid in &removed {
    remove_grid_images(&grid_dir, appid);
  }
  Ok(removed.len())
}

fn restore_blocking() -> Result<bool, String> {
  let _guard = SHORTCUTS_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  let Some(config_dir) = find_user_config_dir() else {
    return Ok(false);
  };
  let backup = config_dir.join(BACKUP_FILE);
  if !backup.is_file() {
    return Ok(false);
  }
  let shortcuts = config_dir.join(SHORTCUTS_FILE);
  if shortcuts.exists() {
    fs::remove_file(&shortcuts).map_err(|error| format!("Failed to delete shortcuts.vdf: {error}"))?;
  }
  fs::copy(&backup, &shortcuts).map_err(|error| format!("Failed to restore the backup: {error}"))?;
  Ok(true)
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(work)
    .await
    .map_err(|error| format!("Steam task failed: {error}"))?
}

/// The Steam user config folder, or `""` when Steam is not found.
#[tauri::command]
pub(crate) async fn steam_user_config_dir() -> Result<String, String> {
  blocking(|| Ok(find_user_config_dir().map(|dir| dir.to_string_lossy().into_owned()).unwrap_or_default())).await
}

/// Replaces all PlayStash shortcuts with the given games. Returns how many
/// were added (0 when Steam is not found).
#[tauri::command]
pub(crate) async fn steam_sync_shortcuts(
  app: tauri::AppHandle,
  server_namespace: Option<String>,
  games: Vec<SteamShortcutGame>,
) -> Result<usize, String> {
  blocking(move || sync_blocking(&app, server_namespace, games)).await
}

/// Removes all PlayStash shortcuts and their grid images.
#[tauri::command]
pub(crate) async fn steam_remove_shortcuts() -> Result<usize, String> {
  blocking(remove_blocking).await
}

/// Restores `shortcuts.vdf.backup`. Returns false when there is no backup.
#[tauri::command]
pub(crate) async fn steam_restore_backup() -> Result<bool, String> {
  blocking(restore_blocking).await
}

/// Media ids that are not in the offline image cache yet, so the frontend can
/// download them before a sync.
#[tauri::command]
pub(crate) async fn steam_missing_cached_media(
  app: tauri::AppHandle,
  server_namespace: String,
  media_ids: Vec<i64>,
) -> Result<Vec<i64>, String> {
  blocking(move || {
    let Some(dir) = offline_image_dir(&app, &server_namespace) else {
      return Ok(Vec::new());
    };
    Ok(media_ids.into_iter().filter(|id| cached_image(&dir, *id).is_none()).collect())
  })
  .await
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn grid_id_matches_the_wpf_formula() {
    // Golden values computed with the C# algorithm (Python port):
    // (-(int(md5(s)[:4] as BE) % 1e9)) & 0xFFFFFFFF
    assert_eq!(steam_grid_id("Celeste42"), 4_098_766_851);
    assert_eq!(steam_grid_id("Hollow Knight7"), 3_597_154_196);
    assert_eq!(steam_grid_id("Stardew Valley1"), 3_912_483_083);
    assert_eq!(steam_grid_id("\u{dc}n\u{ef}c\u{f6}d\u{e9} Game123"), 3_908_437_790);
    assert_eq!(steam_grid_id("0"), 3_808_640_380);
  }

  fn entry(name: &str, exe: &str, shortcut_path: Option<&str>, appid: u32) -> VdfValue {
    let mut map = vec![
      ("appid".to_string(), VdfValue::Int32(appid)),
      ("AppName".to_string(), VdfValue::String(name.to_string())),
      ("Exe".to_string(), VdfValue::String(exe.to_string())),
    ];
    if let Some(path) = shortcut_path {
      map.push(("ShortcutPath".to_string(), VdfValue::String(path.to_string())));
    }
    VdfValue::Map(map)
  }

  fn game(id: i64, title: &str) -> SteamShortcutGame {
    SteamShortcutGame {
      game_id: id,
      title: title.to_string(),
      exe: format!("/games/{title}/run"),
      start_dir: None,
      launch_options: Some("-fullscreen".to_string()),
      cover_media_id: None,
      hero_media_id: None,
      via_playstash: false,
    }
  }

  #[test]
  fn owned_entry_removal_keeps_foreign_entries_in_order() {
    let shortcuts: VdfMap = vec![
      ("0".into(), entry("Foreign A", "\"C:\\a.exe\"", None, 10)),
      ("1".into(), entry("Mine", "\"C:\\m.exe\"", Some("PLAYSTASH://start?gameid=1"), 11)),
      ("2".into(), entry("Foreign B", "\"C:\\b.exe\"", Some("steam://x"), 12)),
      ("5".into(), entry("Legacy", "playstash://start?gameid=2", None, 13)),
    ];
    let (kept, removed) = remove_owned_shortcuts(&shortcuts);
    assert_eq!(kept.iter().map(|(key, _)| key.as_str()).collect::<Vec<_>>(), vec!["0", "2"]);
    assert_eq!(kept[0].1, shortcuts[0].1);
    assert_eq!(kept[1].1, shortcuts[2].1);
    assert_eq!(removed, vec!["11".to_string(), "13".to_string()]);
  }

  #[test]
  fn sync_appends_after_the_highest_numeric_key_with_wpf_fields() {
    let shortcuts: VdfMap = vec![
      ("0".into(), entry("Foreign", "\"x\"", None, 1)),
      ("7".into(), entry("Mine", "\"y\"", Some("playstash://start?gameid=9"), 2)),
      ("3".into(), entry("Foreign 2", "\"z\"", None, 3)),
    ];
    let config = Path::new("cfg");
    let celeste = game(42, "Celeste");
    let launch = shortcut_launch(&celeste, Path::new("/opt/playstash"), false);
    let plan = plan_sync(&shortcuts, &[(celeste.clone(), launch)], config);
    assert_eq!(plan.removed_appids, vec!["2".to_string()]);
    let keys: Vec<_> = plan.shortcuts.iter().map(|(key, _)| key.as_str()).collect();
    assert_eq!(keys, vec!["0", "3", "4"]);
    let added = plan.shortcuts[2].1.as_map().unwrap();
    let names: Vec<_> = added.iter().map(|(key, _)| key.as_str()).collect();
    assert_eq!(
      names,
      vec![
        "appid", "AppName", "Exe", "StartDir", "icon", "ShortcutPath", "LaunchOptions", "IsHidden",
        "AllowDesktopConfig", "AllowOverlay", "OpenVR", "Devkit", "DevkitGameID", "DevkitOverrideAppID",
        "LastPlayTime", "FlatpakAppID", "tags"
      ]
    );
    assert_eq!(vdf::map_get(added, "appid"), Some(&VdfValue::Int32(4_098_766_851)));
    assert_eq!(vdf::map_get(added, "Exe").and_then(VdfValue::as_str), Some("\"/games/Celeste/run\""));
    assert_eq!(vdf::map_get(added, "StartDir").and_then(VdfValue::as_str), Some("\"/games/Celeste\""));
    assert_eq!(
      vdf::map_get(added, "ShortcutPath").and_then(VdfValue::as_str),
      Some("playstash://start?gameid=42")
    );
    assert_eq!(vdf::map_get(added, "LaunchOptions").and_then(VdfValue::as_str), Some("-fullscreen"));
    assert_eq!(
      vdf::map_get(added, "icon").and_then(VdfValue::as_str).map(PathBuf::from),
      Some(config.join("grid").join("4098766851p.png"))
    );
    assert!(is_playstash_shortcut(added));
    assert_eq!(plan.added.len(), 1);
    // Re-syncing replaces our entry instead of duplicating it.
    let launch = shortcut_launch(&celeste, Path::new("/opt/playstash"), false);
    let again = plan_sync(&plan.shortcuts, &[(celeste, launch)], config);
    assert_eq!(again.shortcuts.len(), 3);
    assert_eq!(again.removed_appids, vec!["4098766851".to_string()]);
  }

  #[test]
  fn via_playstash_launches_the_app_with_start_arguments() {
    let mut admin = game(7, "Admin Game");
    admin.via_playstash = true;
    let launch = shortcut_launch(&admin, Path::new("/opt/PlayStash/playstash"), false);
    assert_eq!(launch.exe, "/opt/PlayStash/playstash");
    assert_eq!(launch.start_dir, "/opt/PlayStash");
    assert_eq!(launch.launch_options, "start --gameid=7");
    let windows_exe = shortcut_launch(&game(8, "Win"), Path::new("/opt/p"), true);
    assert_eq!(windows_exe.launch_options, "start --gameid=8");
  }

  #[test]
  fn start_dir_prefers_the_given_folder() {
    let mut custom = game(1, "A");
    custom.start_dir = Some("/data".into());
    assert_eq!(shortcut_launch(&custom, Path::new("/p"), false).start_dir, "/data");
  }

  #[test]
  fn sync_into_an_empty_file_starts_at_zero() {
    let plan = plan_sync(&VdfMap::new(), &[(game(1, "A"), shortcut_launch(&game(1, "A"), Path::new("/p"), false))], Path::new("c"));
    assert_eq!(plan.shortcuts[0].0, "0");
    let bytes = vdf::write_shortcuts(&plan.shortcuts).unwrap();
    assert_eq!(vdf::read_shortcuts(&bytes).unwrap(), plan.shortcuts);
  }
}
