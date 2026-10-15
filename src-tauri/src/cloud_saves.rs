//! Cloud saves through Ludusavi, the port of the WPF client's
//! `SaveGameHelper` / `LudusaviCommand`.
//!
//! - Ludusavi ships as a sidecar next to the PlayStash executable (see
//!   `scripts/build-ludusavi.mjs`); it runs hidden, tracked by
//!   `children`, with arguments passed as a list and every title after `--`.
//! - The config file (`config.yaml`) maps the user folder and the install
//!   folder onto the fixed `G:\playstash\...` targets, so archives move
//!   between PCs, users and the WPF client unchanged.
//! - Backups are zipped (the temp folder itself becomes the archive root, as
//!   7-Zip did) and uploaded with `X-Installation-Id`; restores skip archives
//!   this installation uploaded itself.
//! - Settings live in the `cloudsaves` settings section.

use futures_util::StreamExt;
use serde::de::{Deserializer, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

pub(crate) const SETTINGS_SECTION: &str = "cloudsaves";
/// Redirect targets of the WPF client. Must stay byte-identical so archives
/// restore across both clients.
const CURRENT_USER_TARGET: &str = r"G:\playstash\currentuser";
const INSTALLATION_TARGET: &str = r"G:\playstash\installation";
/// The WPF client extracted with this password; plain archives ignore it.
const LEGACY_ARCHIVE_PASSWORD: &[u8] = b"PlayStash-no-password";
/// A Ludusavi match is accepted only above this score.
const MATCH_THRESHOLD: f64 = 0.9;
const GAME_CONFIG_FILE: &str = ".playstash.game.config.json";
const INSTALLATION_ID_KEY: &str = "installationid";
const UPLOAD_FILE_NAME: &str = "x.zip";
const UPLOAD_CONTENT_TYPE: &str = "application/x-zip-compressed";
/// The Windows user inside umu/Proton prefixes.
const PROTON_PREFIX_USER: &str = "steamuser";

// ── Settings ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct CloudSaveSettings {
  /// "Sync cloud saves" (default off).
  pub enabled: bool,
  /// "Use Primary Manifest" (default on).
  pub use_primary_manifest: bool,
  /// Custom Ludusavi manifests: file paths or URLs.
  pub custom_manifests: Vec<String>,
}

impl Default for CloudSaveSettings {
  fn default() -> Self {
    Self {
      enabled: false,
      use_primary_manifest: true,
      custom_manifests: Vec::new(),
    }
  }
}

/// Non-blank, trimmed manifest entries.
pub(crate) fn clean_manifests(entries: &[String]) -> Vec<String> {
  entries
    .iter()
    .map(|entry| entry.trim())
    .filter(|entry| !entry.is_empty())
    .map(str::to_string)
    .collect()
}

fn load_settings(app: &tauri::AppHandle) -> CloudSaveSettings {
  crate::settings::load_section(app, SETTINGS_SECTION)
}

#[tauri::command]
pub(crate) async fn get_cloud_save_settings(app: tauri::AppHandle) -> CloudSaveSettings {
  load_settings(&app)
}

#[tauri::command]
pub(crate) async fn set_cloud_saves_enabled(
  app: tauri::AppHandle,
  enabled: bool,
) -> Result<CloudSaveSettings, String> {
  crate::settings::update_section(&app, SETTINGS_SECTION, |settings: &mut CloudSaveSettings| {
    settings.enabled = enabled;
  })
}

#[tauri::command]
pub(crate) async fn set_cloud_save_use_primary_manifest(
  app: tauri::AppHandle,
  enabled: bool,
) -> Result<CloudSaveSettings, String> {
  let saved = crate::settings::update_section(&app, SETTINGS_SECTION, |settings: &mut CloudSaveSettings| {
    settings.use_primary_manifest = enabled;
  })?;
  clear_match_cache();
  Ok(saved)
}

#[tauri::command]
pub(crate) async fn set_cloud_save_custom_manifests(
  app: tauri::AppHandle,
  manifests: Vec<String>,
) -> Result<CloudSaveSettings, String> {
  let manifests = clean_manifests(&manifests);
  let saved = crate::settings::update_section(&app, SETTINGS_SECTION, |settings: &mut CloudSaveSettings| {
    settings.custom_manifests = manifests;
  })?;
  clear_match_cache();
  Ok(saved)
}

// ── Ludusavi sidecar ────────────────────────────────────────────────────────

fn sidecar_file_name() -> &'static str {
  if cfg!(windows) {
    "ludusavi.exe"
  } else {
    "ludusavi"
  }
}

/// The bundled Ludusavi executable: next to the PlayStash executable in
/// packaged builds (Tauri strips the target triple from sidecars), or in
/// `src-tauri/binaries/` for debug builds after `pnpm ludusavi:build`.
pub(crate) fn resolve_ludusavi() -> Option<PathBuf> {
  let mut candidates = Vec::new();
  if let Some(dir) = tauri::utils::platform::current_exe()
    .ok()
    .and_then(|exe| exe.parent().map(Path::to_path_buf))
  {
    candidates.push(dir.join(sidecar_file_name()));
  }
  #[cfg(debug_assertions)]
  {
    if let Ok(triple) = tauri::utils::platform::target_triple() {
      let extension = if cfg!(windows) { ".exe" } else { "" };
      candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
          .join("binaries")
          .join(format!("ludusavi-{triple}{extension}")),
      );
    }
  }
  candidates.into_iter().find(|path| path.is_file())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LudusaviStatus {
  pub available: bool,
  pub path: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_ludusavi_status() -> LudusaviStatus {
  let path = resolve_ludusavi();
  LudusaviStatus {
    available: path.is_some(),
    path: path.map(|path| path.to_string_lossy().to_string()),
  }
}

fn require_title(title: &str) -> Result<&str, String> {
  if title.trim().is_empty() {
    Err("A Ludusavi game title must not be blank.".to_string())
  } else {
    Ok(title)
  }
}

fn base_args(config_dir: &Path) -> Vec<OsString> {
  vec!["--config".into(), config_dir.as_os_str().to_owned()]
}

fn push_wine_prefix(args: &mut Vec<OsString>, wine_prefix: Option<&str>) {
  if let Some(prefix) = wine_prefix.map(str::trim).filter(|prefix| !prefix.is_empty()) {
    args.push("--wine-prefix".into());
    args.push(prefix.into());
  }
}

/// `--config <cfg> find --fuzzy --api -- <title>`
pub(crate) fn find_args(config_dir: &Path, title: &str) -> Result<Vec<OsString>, String> {
  let title = require_title(title)?;
  let mut args = base_args(config_dir);
  args.extend(["find", "--fuzzy", "--api", "--"].map(OsString::from));
  args.push(title.into());
  Ok(args)
}

/// `--config <cfg> backup --force --format zip --path <dir> [--wine-prefix <p>] -- <title>`
pub(crate) fn backup_args(
  config_dir: &Path,
  backup_dir: &Path,
  title: &str,
  wine_prefix: Option<&str>,
) -> Result<Vec<OsString>, String> {
  let title = require_title(title)?;
  let mut args = base_args(config_dir);
  args.extend(["backup", "--force", "--format", "zip", "--path"].map(OsString::from));
  args.push(backup_dir.as_os_str().to_owned());
  push_wine_prefix(&mut args, wine_prefix);
  args.push("--".into());
  args.push(title.into());
  Ok(args)
}

/// `--config <cfg> backup --preview --api [--wine-prefix <p>] -- <title>`:
/// lists the local save files without writing anything.
pub(crate) fn preview_args(
  config_dir: &Path,
  title: &str,
  wine_prefix: Option<&str>,
) -> Result<Vec<OsString>, String> {
  let title = require_title(title)?;
  let mut args = base_args(config_dir);
  args.extend(["backup", "--preview", "--api"].map(OsString::from));
  push_wine_prefix(&mut args, wine_prefix);
  args.push("--".into());
  args.push(title.into());
  Ok(args)
}

/// `--config <cfg> restore --force --path <dir> [--wine-prefix <p>] --`
pub(crate) fn restore_args(config_dir: &Path, backup_dir: &Path, wine_prefix: Option<&str>) -> Vec<OsString> {
  let mut args = base_args(config_dir);
  args.extend(["restore", "--force", "--path"].map(OsString::from));
  args.push(backup_dir.as_os_str().to_owned());
  push_wine_prefix(&mut args, wine_prefix);
  args.push("--".into());
  args
}

/// One Ludusavi run at a time: every operation rewrites the shared config.
fn ludusavi_lock() -> &'static tokio::sync::Mutex<()> {
  static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
  LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

async fn run_ludusavi(binary: &Path, args: Vec<OsString>) -> Result<std::process::Output, String> {
  let binary = binary.to_path_buf();
  tauri::async_runtime::spawn_blocking(move || {
    let mut command = Command::new(&binary);
    command.args(&args);
    crate::children::run_tracked(&mut command)
  })
  .await
  .map_err(|error| format!("Ludusavi task failed: {error}"))?
  .map_err(|error| format!("Failed to run Ludusavi: {error}"))
}

// ── Config file ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct LudusaviConfig {
  redirects: Vec<Redirect>,
  roots: Vec<Root>,
  #[serde(skip_serializing_if = "Option::is_none")]
  manifest: Option<Manifest>,
}

#[derive(Serialize)]
struct Redirect {
  kind: &'static str,
  source: String,
  target: &'static str,
}

#[derive(Serialize)]
struct Root {
  store: &'static str,
  path: String,
}

#[derive(Serialize)]
struct Manifest {
  enable: bool,
  secondary: Vec<SecondaryManifest>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum SecondaryManifest {
  Url { url: String, enable: bool },
  Path { path: String, enable: bool },
}

/// Inputs of [`build_config_yaml`].
pub(crate) struct ConfigInput<'a> {
  /// The user's home folder (`C:\Users\<user>`, `/home/<user>`).
  pub home: &'a str,
  /// The game's installation folder, or "" when unknown.
  pub installation_path: &'a str,
  /// Download roots; each contributes `<root>/PlayStash`.
  pub roots: &'a [String],
  pub settings: &'a CloudSaveSettings,
  /// Wine/Proton prefix of a umu game.
  pub wine_prefix: Option<&'a str>,
}

/// True when a custom manifest entry is an absolute HTTP(S) URL (anything
/// else is passed to Ludusavi as a file path).
fn is_manifest_url(entry: &str) -> bool {
  url::Url::parse(entry)
    .map(|url| matches!(url.scheme(), "http" | "https") && url.has_host())
    .unwrap_or(false)
}

fn join_path(base: &str, child: &str) -> String {
  Path::new(base).join(child).to_string_lossy().to_string()
}

/// Builds Ludusavi's `config.yaml` (pure, see the golden tests).
pub(crate) fn build_config_yaml(input: &ConfigInput<'_>) -> Result<String, String> {
  let mut redirects = Vec::new();
  if let Some(prefix) = input.wine_prefix.map(str::trim).filter(|prefix| !prefix.is_empty()) {
    // Saves of a Proton game live in the prefix user's profile. Mapping it
    // onto the same target as a Windows user folder lets archives move
    // between Windows PCs and Linux prefixes. It comes first because the
    // prefix usually lies inside the home folder.
    redirects.push(Redirect {
      kind: "bidirectional",
      source: Path::new(prefix)
        .join("drive_c")
        .join("users")
        .join(PROTON_PREFIX_USER)
        .to_string_lossy()
        .to_string(),
      target: CURRENT_USER_TARGET,
    });
  }
  redirects.push(Redirect {
    kind: "bidirectional",
    source: input.home.to_string(),
    target: CURRENT_USER_TARGET,
  });
  redirects.push(Redirect {
    kind: "bidirectional",
    source: input.installation_path.to_string(),
    target: INSTALLATION_TARGET,
  });

  let roots = input
    .roots
    .iter()
    .map(|root| root.trim())
    .filter(|root| !root.is_empty())
    .map(|root| Root {
      store: "other",
      path: join_path(root, "PlayStash"),
    })
    .collect();

  let manifests = clean_manifests(&input.settings.custom_manifests);
  let manifest = (!manifests.is_empty()).then(|| Manifest {
    enable: input.settings.use_primary_manifest,
    secondary: manifests
      .into_iter()
      .map(|entry| {
        if is_manifest_url(&entry) {
          SecondaryManifest::Url { url: entry, enable: true }
        } else {
          SecondaryManifest::Path { path: entry, enable: true }
        }
      })
      .collect(),
  });

  serde_yaml::to_string(&LudusaviConfig {
    redirects,
    roots,
    manifest,
  })
  .map_err(|error| format!("Failed to build the Ludusavi config: {error}"))
}

fn valid_profile_key(key: &str) -> bool {
  !key.is_empty()
    && key.len() <= 64
    && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `<app_data_dir>/profiles/<profileKey>/cloudsave`, or
/// `<app_data_dir>/cloudsave` without a profile key.
fn config_dir(app: &tauri::AppHandle, profile_key: Option<&str>) -> Result<PathBuf, String> {
  let base = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Failed to resolve the app data dir: {error}"))?;
  let dir = match profile_key.map(str::trim).filter(|key| valid_profile_key(key)) {
    Some(key) => base.join("profiles").join(key).join("cloudsave"),
    None => base.join("cloudsave"),
  };
  fs::create_dir_all(&dir).map_err(|error| format!("Failed to create {}: {error}", dir.display()))?;
  Ok(dir)
}

fn home_dir(app: &tauri::AppHandle) -> String {
  app
    .path()
    .home_dir()
    .map(|dir| dir.to_string_lossy().to_string())
    .unwrap_or_default()
}

fn write_config(
  app: &tauri::AppHandle,
  dir: &Path,
  installation_path: &str,
  roots: &[String],
  wine_prefix: Option<&str>,
) -> Result<(), String> {
  let settings = load_settings(app);
  let home = home_dir(app);
  let yaml = build_config_yaml(&ConfigInput {
    home: &home,
    installation_path,
    roots,
    settings: &settings,
    wine_prefix,
  })?;
  fs::write(dir.join("config.yaml"), yaml).map_err(|error| format!("Failed to write the Ludusavi config: {error}"))
}

// ── Title match ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ScoreEntry {
  #[serde(default)]
  score: Option<f64>,
}

/// The first `games` entry in document order (a plain map would sort keys).
struct FirstGame(Option<(String, Option<f64>)>);

impl<'de> Deserialize<'de> for FirstGame {
  fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
    struct FirstGameVisitor;
    impl<'de> Visitor<'de> for FirstGameVisitor {
      type Value = FirstGame;
      fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a map of Ludusavi games")
      }
      fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<FirstGame, A::Error> {
        let mut first = None;
        while let Some(name) = map.next_key::<String>()? {
          let entry: ScoreEntry = map.next_value()?;
          if first.is_none() {
            first = Some((name, entry.score));
          }
        }
        Ok(FirstGame(first))
      }
    }
    deserializer.deserialize_map(FirstGameVisitor)
  }
}

#[derive(Deserialize)]
struct FindOutput {
  #[serde(default)]
  games: Option<FirstGame>,
}

/// Ludusavi title from `find --api` output: the first game, accepted only
/// when its score is above 0.9; otherwise "".
pub(crate) fn parse_find_output(stdout: &str) -> String {
  let Ok(output) = serde_json::from_str::<FindOutput>(stdout.trim()) else {
    return String::new();
  };
  match output.games.and_then(|games| games.0) {
    Some((name, Some(score))) if score > MATCH_THRESHOLD && !name.trim().is_empty() => name,
    _ => String::new(),
  }
}

fn match_cache() -> &'static Mutex<HashMap<i64, String>> {
  static CACHE: OnceLock<Mutex<HashMap<i64, String>>> = OnceLock::new();
  CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clear_match_cache() {
  if let Ok(mut cache) = match_cache().lock() {
    cache.clear();
  }
}

fn cached_match(game_id: i64) -> Option<String> {
  match_cache().lock().ok().and_then(|cache| cache.get(&game_id).cloned())
}

/// Runs `find` (config must be written). Caller holds the Ludusavi lock.
async fn find_title(binary: &Path, config_dir: &Path, game_id: i64, title: &str) -> Result<String, String> {
  if let Some(cached) = cached_match(game_id) {
    return Ok(cached);
  }
  if title.trim().is_empty() {
    return Ok(String::new());
  }
  let output = run_ludusavi(binary, find_args(config_dir, title)?).await?;
  let matched = parse_find_output(&String::from_utf8_lossy(&output.stdout));
  if let Ok(mut cache) = match_cache().lock() {
    cache.insert(game_id, matched.clone());
  }
  Ok(matched)
}

/// The Ludusavi title for a game ("" when Ludusavi has no confident match or
/// is not bundled). Cached per game for the session.
#[tauri::command]
pub(crate) async fn cloud_save_match_title(
  app: tauri::AppHandle,
  game_id: i64,
  title: String,
  installation_path: Option<String>,
  roots: Option<Vec<String>>,
  profile_key: Option<String>,
) -> Result<String, String> {
  if let Some(cached) = cached_match(game_id) {
    return Ok(cached);
  }
  if title.trim().is_empty() {
    return Ok(String::new());
  }
  let Some(binary) = resolve_ludusavi() else {
    return Ok(String::new());
  };
  let _guard = ludusavi_lock().lock().await;
  let dir = config_dir(&app, profile_key.as_deref())?;
  write_config(
    &app,
    &dir,
    installation_path.as_deref().unwrap_or(""),
    &roots.unwrap_or_default(),
    None,
  )?;
  find_title(&binary, &dir, game_id, &title).await
}

// ── Installation identity ───────────────────────────────────────────────────

fn read_game_config(version_dir: &Path) -> Option<serde_json::Map<String, serde_json::Value>> {
  let text = fs::read_to_string(version_dir.join(GAME_CONFIG_FILE)).ok()?;
  match serde_json::from_str::<serde_json::Value>(&text).ok()? {
    serde_json::Value::Object(map) => Some(map),
    _ => None,
  }
}

/// The `installationid` of an installed version, if one was created.
pub(crate) fn read_installation_id(version_dir: &Path) -> Option<String> {
  read_game_config(version_dir)?
    .get(INSTALLATION_ID_KEY)
    .and_then(|value| value.as_str())
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
}

/// A random RFC 4122 version 4 UUID.
pub(crate) fn new_uuid() -> Result<String, String> {
  let mut bytes = [0u8; 16];
  getrandom::getrandom(&mut bytes).map_err(|error| format!("No randomness available: {error}"))?;
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
  Ok(format!(
    "{}-{}-{}-{}-{}",
    &hex[0..8],
    &hex[8..12],
    &hex[12..16],
    &hex[16..20],
    &hex[20..32]
  ))
}

/// The installation id of a version, created and merge-written into
/// `.playstash.game.config.json` on first use.
pub(crate) fn ensure_installation_id(version_dir: &Path) -> Result<String, String> {
  if let Some(existing) = read_installation_id(version_dir) {
    return Ok(existing);
  }
  if !version_dir.is_dir() {
    return Err(format!("The version folder {} does not exist.", version_dir.display()));
  }
  let config_path = version_dir.join(GAME_CONFIG_FILE);
  let mut config = if config_path.exists() {
    // Never replace a file we cannot parse: it holds the launch settings.
    read_game_config(version_dir).ok_or_else(|| format!("{} is not a JSON object.", config_path.display()))?
  } else {
    serde_json::Map::new()
  };
  let id = new_uuid()?;
  config.insert(INSTALLATION_ID_KEY.to_string(), serde_json::Value::String(id.clone()));
  let text = serde_json::to_string_pretty(&serde_json::Value::Object(config))
    .map_err(|error| format!("Failed to serialize the game config: {error}"))?;
  crate::fs_commands::fs_write_text_file(config_path.to_string_lossy().to_string(), text)?;
  Ok(id)
}

/// The installation id used for uploads from this version (created on demand).
#[tauri::command]
pub(crate) async fn get_cloud_save_installation_id(version_directory: String) -> Result<String, String> {
  ensure_installation_id(Path::new(&version_directory))
}

/// Existing installation ids of the given versions (none are created).
#[tauri::command]
pub(crate) async fn get_cloud_save_installation_ids(version_directories: Vec<String>) -> Vec<String> {
  let mut ids: Vec<String> = version_directories
    .iter()
    .filter_map(|dir| read_installation_id(Path::new(dir)))
    .collect();
  ids.sort();
  ids.dedup();
  ids
}

// ── Pure helpers for archives and HTTP ──────────────────────────────────────

/// File name from a `Content-Disposition` header, preferring the RFC 5987
/// `filename*` form.
pub(crate) fn content_disposition_filename(header: &str) -> Option<String> {
  let mut plain = None;
  for part in header.split(';').map(str::trim) {
    let Some((key, value)) = part.split_once('=') else {
      continue;
    };
    let key = key.trim().to_ascii_lowercase();
    let value = value.trim();
    if key == "filename*" {
      let encoded = value.splitn(3, '\'').nth(2).unwrap_or(value).trim_matches('"');
      if let Ok(decoded) = urlencoding::decode(encoded) {
        if !decoded.trim().is_empty() {
          return Some(decoded.into_owned());
        }
      }
    } else if key == "filename" && plain.is_none() {
      let unquoted = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(value);
      let unescaped = unquoted.replace("\\\"", "\"").replace("\\\\", "\\");
      if !unescaped.trim().is_empty() {
        plain = Some(unescaped);
      }
    }
  }
  plain
}

/// The installation id in a save archive name `<anything>_<installationId>.<ext>`:
/// the text after the last `_`, up to the extension.
pub(crate) fn installation_id_from_filename(name: &str) -> Option<String> {
  let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
  let (_, after) = base.rsplit_once('_')?;
  let id = after.split('.').next().unwrap_or("").trim();
  (!id.is_empty()).then(|| id.to_string())
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
  let year = if month <= 2 { year - 1 } else { year };
  let era = (if year >= 0 { year } else { year - 399 }) / 400;
  let year_of_era = year - era * 400;
  let month_index = (month + 9) % 12;
  let day_of_year = (153 * month_index + 2) / 5 + day - 1;
  let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
  era * 146_097 + day_of_era - 719_468
}

/// Unix milliseconds of an RFC 3339 timestamp such as `2026-10-13T12:00:00.123Z`.
pub(crate) fn parse_rfc3339_ms(value: &str) -> Option<i64> {
  let value = value.trim();
  let number = |text: &str| text.parse::<i64>().ok();
  let (date, rest) = value.split_once(['T', 't', ' '])?;
  let mut date_parts = date.split('-');
  let year = number(date_parts.next()?)?;
  let month = number(date_parts.next()?)?;
  let day = number(date_parts.next()?)?;
  if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
    return None;
  }
  let (time, offset_ms) = if let Some(time) = rest.strip_suffix(['Z', 'z']) {
    (time, 0)
  } else if let Some(index) = rest.rfind(['+', '-']) {
    let (time, offset) = rest.split_at(index);
    let sign = if offset.starts_with('-') { -1 } else { 1 };
    let (hours, minutes) = offset[1..].split_once(':').unwrap_or((&offset[1..], "0"));
    (time, sign * (number(hours)? * 3_600_000 + number(minutes)? * 60_000))
  } else {
    (rest, 0)
  };
  let (clock, fraction) = time.split_once('.').unwrap_or((time, ""));
  let mut clock_parts = clock.split(':');
  let hours = number(clock_parts.next()?)?;
  let minutes = number(clock_parts.next()?)?;
  let seconds = number(clock_parts.next().unwrap_or("0"))?;
  let millis = if fraction.is_empty() {
    0
  } else {
    number(&format!("{:0<3}", &fraction[..fraction.len().min(3)]))?
  };
  let days = days_from_civil(year, month, day);
  Some(((days * 86_400 + hours * 3_600 + minutes * 60 + seconds) * 1_000 + millis) - offset_ms)
}

#[derive(Debug, Deserialize)]
struct SaveVersion {
  #[serde(default)]
  filename: String,
  #[serde(default)]
  created_at: Option<String>,
}

/// Creation time of the server's latest save: the version named `filename`,
/// otherwise the newest one.
pub(crate) fn latest_cloud_save_ms(versions_json: &str, filename: Option<&str>) -> Option<i64> {
  let versions: Vec<SaveVersion> = serde_json::from_str(versions_json).ok()?;
  let created = |version: &SaveVersion| version.created_at.as_deref().and_then(parse_rfc3339_ms);
  if let Some(name) = filename {
    if let Some(version) = versions.iter().find(|version| version.filename == name) {
      if let Some(ms) = created(version) {
        return Some(ms);
      }
    }
  }
  versions.iter().filter_map(created).max()
}

#[derive(Deserialize)]
struct PreviewOutput {
  #[serde(default)]
  games: HashMap<String, PreviewGame>,
}

#[derive(Deserialize)]
struct PreviewGame {
  #[serde(default)]
  files: HashMap<String, serde_json::Value>,
}

/// Local save files listed by `backup --preview --api`.
pub(crate) fn parse_preview_files(stdout: &str) -> Vec<String> {
  serde_json::from_str::<PreviewOutput>(stdout.trim())
    .map(|output| {
      let mut files: Vec<String> = output.games.into_values().flat_map(|game| game.files.into_keys()).collect();
      files.sort();
      files
    })
    .unwrap_or_default()
}

fn newest_mtime_ms(files: &[String]) -> Option<i64> {
  files
    .iter()
    .filter_map(|file| fs::metadata(file).ok())
    .filter_map(|metadata| metadata.modified().ok())
    .filter_map(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|duration| duration.as_millis() as i64)
    .max()
}

/// The first `mapping.yaml` below `root` (directories in name order).
pub(crate) fn find_mapping_file(root: &Path) -> Option<PathBuf> {
  let mut entries: Vec<_> = fs::read_dir(root).ok()?.flatten().collect();
  entries.sort_by_key(|entry| entry.file_name());
  for entry in &entries {
    let path = entry.path();
    let Ok(file_type) = entry.file_type() else {
      continue;
    };
    if file_type.is_file() && entry.file_name() == "mapping.yaml" {
      return Some(path);
    }
  }
  for entry in entries {
    if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
      if let Some(found) = find_mapping_file(&entry.path()) {
        return Some(found);
      }
    }
  }
  None
}

/// Ludusavi's backup folder for an extracted archive: the grandparent of the
/// first `mapping.yaml` (the folder containing `<GameName>/mapping.yaml`).
pub(crate) fn backup_dir_from_mapping(root: &Path) -> Option<PathBuf> {
  find_mapping_file(root)?.parent()?.parent().map(Path::to_path_buf)
}

/// Zips `dir` into `archive` with the folder itself as the archive root
/// (`<dir name>/<GameName>/mapping.yaml`), the layout `7z a <zip> <dir>`
/// produced in the WPF client. `archive` may live inside `dir`; it is skipped.
pub(crate) fn zip_directory(dir: &Path, archive: &Path) -> Result<(), String> {
  let root_name = dir
    .file_name()
    .map(|name| name.to_string_lossy().to_string())
    .ok_or("The backup folder has no name.")?;
  let file = fs::File::create(archive).map_err(|error| format!("Failed to create {}: {error}", archive.display()))?;
  let mut writer = zip::ZipWriter::new(std::io::BufWriter::new(file));
  let options = zip::write::SimpleFileOptions::default()
    .compression_method(zip::CompressionMethod::Deflated)
    .large_file(true);
  writer
    .add_directory(format!("{root_name}/"), options)
    .map_err(|error| error.to_string())?;
  add_directory_entries(&mut writer, dir, &root_name, archive, options)?;
  writer.finish().map_err(|error| error.to_string())?;
  Ok(())
}

fn add_directory_entries<W: Write + std::io::Seek>(
  writer: &mut zip::ZipWriter<W>,
  dir: &Path,
  prefix: &str,
  skip: &Path,
  options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
  let mut entries: Vec<_> = fs::read_dir(dir)
    .map_err(|error| format!("Failed to read {}: {error}", dir.display()))?
    .flatten()
    .collect();
  entries.sort_by_key(|entry| entry.file_name());
  for entry in entries {
    let path = entry.path();
    if path == skip {
      continue;
    }
    let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
      writer
        .add_directory(format!("{name}/"), options)
        .map_err(|error| error.to_string())?;
      add_directory_entries(writer, &path, &name, skip, options)?;
    } else if metadata.is_file() {
      writer.start_file(name, options).map_err(|error| error.to_string())?;
      let mut input = fs::File::open(&path).map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
      std::io::copy(&mut input, writer).map_err(|error| error.to_string())?;
    }
  }
  Ok(())
}

/// Output path of an archive entry below `destination`, with the same rules as
/// `extraction.rs`: relative, no `..`, no drive letters or backslashes, and
/// never through a symbolic link.
fn safe_output_path(destination: &Path, name: &Path) -> Result<PathBuf, String> {
  let text = name.to_string_lossy();
  if text.contains('\\')
    || text.contains(':')
    || name.is_absolute()
    || name
      .components()
      .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
  {
    return Err("Archive contains an unsafe path.".into());
  }
  let mut output = destination.to_path_buf();
  for component in name.components() {
    if component == Component::CurDir {
      continue;
    }
    output.push(component);
    if fs::symlink_metadata(&output)
      .map(|metadata| metadata.file_type().is_symlink())
      .unwrap_or(false)
    {
      return Err("Archive cannot write through a symbolic link.".into());
    }
  }
  Ok(output)
}

/// Extracts a save archive. Entries the WPF client encrypted are retried with
/// its fixed password.
pub(crate) fn extract_zip(archive: &Path, destination: &Path) -> Result<(), String> {
  let file = fs::File::open(archive).map_err(|error| format!("Failed to open {}: {error}", archive.display()))?;
  let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|error| error.to_string())?;
  fs::create_dir_all(destination).map_err(|error| error.to_string())?;
  for index in 0..zip.len() {
    let needs_password = match zip.by_index(index) {
      Ok(_) => false,
      Err(zip::result::ZipError::UnsupportedArchive(message)) if message == zip::result::ZipError::PASSWORD_REQUIRED => true,
      Err(error) => return Err(error.to_string()),
    };
    let mut entry = if needs_password {
      zip
        .by_index_decrypt(index, LEGACY_ARCHIVE_PASSWORD)
        .map_err(|error| format!("The save archive is encrypted with an unknown password: {error}"))?
    } else {
      zip.by_index(index).map_err(|error| error.to_string())?
    };
    if entry.is_symlink() {
      return Err("Save archives must not contain symbolic links.".into());
    }
    let raw_name = entry.name().to_string();
    let output = safe_output_path(destination, Path::new(raw_name.trim_end_matches('/')))?;
    if entry.is_dir() {
      fs::create_dir_all(&output).map_err(|error| error.to_string())?;
      continue;
    }
    if let Some(parent) = output.parent() {
      fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if fs::symlink_metadata(&output).is_ok() {
      fs::remove_file(&output).map_err(|error| error.to_string())?;
    }
    let mut target = fs::OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&output)
      .map_err(|error| format!("Failed to write {}: {error}", output.display()))?;
    let mut buffer = [0u8; 64 * 1024];
    loop {
      let read = entry.read(&mut buffer).map_err(|error| error.to_string())?;
      if read == 0 {
        break;
      }
      target.write_all(&buffer[..read]).map_err(|error| error.to_string())?;
    }
  }
  Ok(())
}

/// A temp folder `<temp>/<uuid>` removed on drop.
struct TempFolder(PathBuf);

impl TempFolder {
  fn create() -> Result<Self, String> {
    let path = std::env::temp_dir().join(new_uuid()?);
    fs::create_dir_all(&path).map_err(|error| format!("Failed to create {}: {error}", path.display()))?;
    Ok(Self(path))
  }
}

impl Drop for TempFolder {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

// ── Backup and restore ──────────────────────────────────────────────────────

/// Arguments of `cloud_save_backup` / `cloud_save_restore`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct CloudSaveRequest {
  pub game_id: i64,
  /// `<root>/PlayStash/<Title>/Versions/<Version>` (holds the installation id).
  pub version_directory: String,
  /// The game's installation folder.
  pub installation_path: String,
  /// `metadata.title`, falling back to the game title.
  pub title: String,
  pub server_url: String,
  pub user_id: i64,
  pub access_token: String,
  /// Wine/Proton prefix of a umu game (Linux). Resolved from the game config
  /// when absent.
  pub wine_prefix: Option<String>,
  /// Download roots for the Ludusavi config.
  pub roots: Vec<String>,
  /// Profile the Ludusavi config belongs to.
  pub profile_key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloudSaveStatus {
  BackupSuccess,
  BackupFailed,
  BackupCreationFailed,
  BackupUploadFailed,
  RestoreSuccess,
  RestoreFailed,
  UpToDate,
  SettingDisabled,
  Offline,
  /// Local save files are newer than the cloud save (nothing was changed).
  LocalNewer,
  /// The local save was kept because it is newer (automatic restore).
  KeptLocal,
  /// Ludusavi is not bundled with this build.
  ToolMissing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudSaveOutcome {
  pub status: CloudSaveStatus,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub http_status: Option<u16>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub detail: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub local_modified_at: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub cloud_created_at: Option<i64>,
}

impl CloudSaveOutcome {
  fn new(status: CloudSaveStatus) -> Self {
    Self {
      status,
      http_status: None,
      detail: None,
      local_modified_at: None,
      cloud_created_at: None,
    }
  }

  fn failed(status: CloudSaveStatus, detail: impl Into<String>) -> Self {
    let detail = detail.into();
    log::warn!("cloud saves: {status:?}: {detail}");
    Self {
      detail: Some(detail),
      ..Self::new(status)
    }
  }

  fn http(status: CloudSaveStatus, http_status: u16) -> Self {
    Self {
      http_status: Some(http_status),
      ..Self::new(status)
    }
  }
}

/// What a restore does when the local save is newer than the cloud save.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RestorePolicy {
  /// Report `LocalNewer` so the UI can ask.
  #[default]
  Ask,
  /// Restore anyway.
  Overwrite,
  /// Keep the local save and report `KeptLocal`.
  KeepLocal,
}

fn is_logged_in(request: &CloudSaveRequest) -> bool {
  request.user_id > 0 && !request.access_token.trim().is_empty() && !request.server_url.trim().is_empty()
}

fn savefiles_url(request: &CloudSaveRequest) -> Result<String, String> {
  let base = request.server_url.trim().trim_end_matches('/');
  let url = format!("{base}/api/savefiles/user/{}/game/{}", request.user_id, request.game_id);
  crate::net::validate_http_url(&url)?;
  Ok(url)
}

fn http_client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .connect_timeout(std::time::Duration::from_secs(30))
    .redirect(reqwest::redirect::Policy::none())
    .build()
    .map_err(|error| error.to_string())
}

fn authorized(builder: reqwest::RequestBuilder, url: &str, token: &str) -> reqwest::RequestBuilder {
  crate::net::server_request(builder, url).bearer_auth(token.trim())
}

/// Wine prefix for a umu game on Linux: the caller's value or the per-game
/// override as the preferred prefix, else the prefix PlayStash would launch
/// the game in. Only existing prefixes of Windows games are used.
#[cfg(target_os = "linux")]
fn resolve_wine_prefix(app: &tauri::AppHandle, request: &CloudSaveRequest) -> Option<String> {
  let config = read_game_config(Path::new(&request.version_directory)).unwrap_or_default();
  let text = |key: &str| {
    config
      .get(key)
      .and_then(|value| value.as_str())
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .map(str::to_string)
  };
  if let Some(executable) = text("launchexecutable") {
    if !crate::umu::is_windows_executable(Path::new(&executable)) {
      return None;
    }
  }
  let per_game = request
    .wine_prefix
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
    .or_else(|| text("umuwineprefix"));
  let umu_game_id = text("umugameid");
  let context = crate::umu::PrefixContext {
    per_game_prefix: per_game.as_deref(),
    version_directory: Some(request.version_directory.as_str()),
    game_id: Some(request.game_id),
    umu_game_id: umu_game_id.as_deref(),
  };
  let prefix = crate::umu::resolve_wine_prefix(app, &context)?;
  crate::umu::is_wine_prefix_dir(Path::new(&prefix)).then_some(prefix)
}

#[cfg(not(target_os = "linux"))]
fn resolve_wine_prefix(_app: &tauri::AppHandle, _request: &CloudSaveRequest) -> Option<String> {
  None
}

/// Back up a game's save files with Ludusavi and upload them (F6).
#[tauri::command]
pub(crate) async fn cloud_save_backup(app: tauri::AppHandle, request: CloudSaveRequest) -> CloudSaveOutcome {
  if !is_logged_in(&request) {
    return CloudSaveOutcome::new(CloudSaveStatus::Offline);
  }
  if !load_settings(&app).enabled {
    return CloudSaveOutcome::new(CloudSaveStatus::SettingDisabled);
  }
  match backup(&app, &request).await {
    Ok(outcome) => outcome,
    Err(error) => CloudSaveOutcome::failed(CloudSaveStatus::BackupFailed, error),
  }
}

async fn backup(app: &tauri::AppHandle, request: &CloudSaveRequest) -> Result<CloudSaveOutcome, String> {
  let installation_path = request.installation_path.trim();
  if installation_path.is_empty() || !Path::new(installation_path).is_dir() || request.version_directory.trim().is_empty() {
    return Ok(CloudSaveOutcome::failed(CloudSaveStatus::BackupFailed, "The game is not installed."));
  }
  let Some(binary) = resolve_ludusavi() else {
    return Ok(CloudSaveOutcome::new(CloudSaveStatus::ToolMissing));
  };
  let url = savefiles_url(request)?;
  let wine_prefix = resolve_wine_prefix(app, request);
  let temp = TempFolder::create()?;
  {
    let _guard = ludusavi_lock().lock().await;
    let dir = config_dir(app, request.profile_key.as_deref())?;
    write_config(app, &dir, installation_path, &request.roots, wine_prefix.as_deref())?;
    let title = find_title(&binary, &dir, request.game_id, &request.title).await?;
    if title.is_empty() {
      return Ok(CloudSaveOutcome::failed(
        CloudSaveStatus::BackupFailed,
        "Ludusavi has no confident match for this game.",
      ));
    }
    let output = run_ludusavi(&binary, backup_args(&dir, &temp.0, &title, wine_prefix.as_deref())?).await?;
    if !output.status.success() {
      log::warn!(
        "cloud saves: ludusavi backup exited with {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
      );
    }
  }
  if find_mapping_file(&temp.0).is_none() {
    return Ok(CloudSaveOutcome::new(CloudSaveStatus::BackupCreationFailed));
  }
  let archive = temp.0.join("backup.zip");
  {
    let (dir, archive) = (temp.0.clone(), archive.clone());
    tauri::async_runtime::spawn_blocking(move || zip_directory(&dir, &archive))
      .await
      .map_err(|error| error.to_string())??;
  }
  let installation_id = ensure_installation_id(Path::new(&request.version_directory))?;
  Ok(match upload(&url, &request.access_token, &installation_id, &archive).await {
    Ok(()) => CloudSaveOutcome::new(CloudSaveStatus::BackupSuccess),
    Err(UploadError::Http(status)) => CloudSaveOutcome::http(CloudSaveStatus::BackupUploadFailed, status),
    Err(UploadError::Other(error)) => CloudSaveOutcome::failed(CloudSaveStatus::BackupUploadFailed, error),
  })
}

enum UploadError {
  Http(u16),
  Other(String),
}

/// `multipart/form-data` head and tail around the archive bytes.
pub(crate) fn multipart_frame(boundary: &str) -> (String, String) {
  (
    format!(
      "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{UPLOAD_FILE_NAME}\"\r\nContent-Type: {UPLOAD_CONTENT_TYPE}\r\n\r\n"
    ),
    format!("\r\n--{boundary}--\r\n"),
  )
}

/// Streams the archive as multipart field `file` (`x.zip`), never buffering it.
async fn upload(url: &str, token: &str, installation_id: &str, archive: &Path) -> Result<(), UploadError> {
  use tokio::io::AsyncReadExt;
  let file = tokio::fs::File::open(archive)
    .await
    .map_err(|error| UploadError::Other(error.to_string()))?;
  let length = file
    .metadata()
    .await
    .map_err(|error| UploadError::Other(error.to_string()))?
    .len();
  let boundary = format!("PlayStashCloudSave{}", new_uuid().map_err(UploadError::Other)?.replace('-', ""));
  let (head, tail) = multipart_frame(&boundary);
  let content_length = head.len() as u64 + length + tail.len() as u64;
  let body_stream = futures_util::stream::unfold(Some(file), |state| async move {
    let mut file = state?;
    let mut buffer = vec![0u8; 256 * 1024];
    match file.read(&mut buffer).await {
      Ok(0) => None,
      Ok(read) => {
        buffer.truncate(read);
        Some((Ok::<Vec<u8>, std::io::Error>(buffer), Some(file)))
      }
      Err(error) => Some((Err(error), None)),
    }
  });
  let stream = futures_util::stream::once(async move { Ok::<Vec<u8>, std::io::Error>(head.into_bytes()) })
    .chain(body_stream)
    .chain(futures_util::stream::once(async move {
      Ok::<Vec<u8>, std::io::Error>(tail.into_bytes())
    }));
  let client = http_client().map_err(UploadError::Other)?;
  let response = authorized(client.post(url), url, token)
    .header("X-Installation-Id", installation_id)
    .header(
      reqwest::header::CONTENT_TYPE,
      format!("multipart/form-data; boundary={boundary}"),
    )
    .header(reqwest::header::CONTENT_LENGTH, content_length)
    .body(reqwest::Body::wrap_stream(stream))
    .send()
    .await
    .map_err(|error| UploadError::Other(error.to_string()))?;
  if response.status().is_success() {
    Ok(())
  } else {
    Err(UploadError::Http(response.status().as_u16()))
  }
}

/// Streams a response body into `path` through a `.partial` file, which is
/// removed again when the download fails.
pub(crate) async fn stream_to_file(response: reqwest::Response, path: &Path) -> Result<u64, String> {
  let partial = path.with_extension("partial");
  let result = write_partial(response, &partial).await;
  let result = match result {
    Ok(written) => tokio::fs::rename(&partial, path).await.map(|_| written).map_err(|error| error.to_string()),
    Err(error) => Err(error),
  };
  if result.is_err() {
    let _ = tokio::fs::remove_file(&partial).await;
  }
  result
}

async fn write_partial(response: reqwest::Response, partial: &Path) -> Result<u64, String> {
  use tokio::io::AsyncWriteExt;
  let mut file = tokio::fs::File::create(partial)
    .await
    .map_err(|error| format!("Failed to create {}: {error}", partial.display()))?;
  let mut written = 0u64;
  let mut stream = response.bytes_stream();
  while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(|error| format!("Download failed: {error}"))?;
    file.write_all(&chunk).await.map_err(|error| error.to_string())?;
    written += chunk.len() as u64;
  }
  file.flush().await.map_err(|error| error.to_string())?;
  Ok(written)
}

/// Download the latest cloud save and restore it with Ludusavi (F7).
#[tauri::command]
pub(crate) async fn cloud_save_restore(
  app: tauri::AppHandle,
  request: CloudSaveRequest,
  policy: Option<RestorePolicy>,
) -> CloudSaveOutcome {
  if !is_logged_in(&request) {
    return CloudSaveOutcome::new(CloudSaveStatus::Offline);
  }
  if !load_settings(&app).enabled {
    return CloudSaveOutcome::new(CloudSaveStatus::SettingDisabled);
  }
  match restore(&app, &request, policy.unwrap_or_default()).await {
    Ok(outcome) => outcome,
    Err(error) => CloudSaveOutcome::failed(CloudSaveStatus::RestoreFailed, error),
  }
}

async fn get_latest(client: &reqwest::Client, url: &str, token: &str) -> Result<Result<reqwest::Response, u16>, String> {
  let response = authorized(client.get(url), url, token)
    .send()
    .await
    .map_err(|error| format!("Failed to reach the server: {error}"))?;
  if response.status().is_success() {
    Ok(Ok(response))
  } else {
    Ok(Err(response.status().as_u16()))
  }
}

async fn restore(app: &tauri::AppHandle, request: &CloudSaveRequest, policy: RestorePolicy) -> Result<CloudSaveOutcome, String> {
  let installation_path = request.installation_path.trim();
  if installation_path.is_empty() || request.version_directory.trim().is_empty() {
    return Ok(CloudSaveOutcome::failed(CloudSaveStatus::RestoreFailed, "The game is not installed."));
  }
  let Some(binary) = resolve_ludusavi() else {
    return Ok(CloudSaveOutcome::new(CloudSaveStatus::ToolMissing));
  };
  let url = savefiles_url(request)?;
  let client = http_client()?;
  let response = match get_latest(&client, &url, &request.access_token).await? {
    Ok(response) => response,
    Err(status) => return Ok(CloudSaveOutcome::http(CloudSaveStatus::RestoreFailed, status)),
  };
  let filename = response
    .headers()
    .get(reqwest::header::CONTENT_DISPOSITION)
    .and_then(|value| value.to_str().ok())
    .and_then(content_disposition_filename);
  let installation_id = ensure_installation_id(Path::new(&request.version_directory))?;
  if filename.as_deref().and_then(installation_id_from_filename).as_deref() == Some(installation_id.as_str()) {
    return Ok(CloudSaveOutcome::new(CloudSaveStatus::UpToDate));
  }

  let wine_prefix = resolve_wine_prefix(app, request);
  let dir = config_dir(app, request.profile_key.as_deref())?;
  let mut response = Some(response);

  if policy != RestorePolicy::Overwrite {
    // Ask before overwriting local saves that are newer than the cloud save.
    // Release the download while Ludusavi scans the disk.
    response = None;
    let local = {
      let _guard = ludusavi_lock().lock().await;
      write_config(app, &dir, installation_path, &request.roots, wine_prefix.as_deref())?;
      let title = find_title(&binary, &dir, request.game_id, &request.title).await?;
      if title.is_empty() {
        None
      } else {
        let output = run_ludusavi(&binary, preview_args(&dir, &title, wine_prefix.as_deref())?).await?;
        newest_mtime_ms(&parse_preview_files(&String::from_utf8_lossy(&output.stdout)))
      }
    };
    if let Some(local) = local {
      let versions_url = format!("{url}/versions");
      let cloud = match authorized(client.get(&versions_url), &versions_url, &request.access_token)
        .send()
        .await
      {
        Ok(versions) if versions.status().is_success() => versions
          .text()
          .await
          .ok()
          .and_then(|text| latest_cloud_save_ms(&text, filename.as_deref())),
        _ => None,
      };
      if let Some(cloud) = cloud {
        if local > cloud {
          return Ok(CloudSaveOutcome {
            local_modified_at: Some(local),
            cloud_created_at: Some(cloud),
            ..CloudSaveOutcome::new(if policy == RestorePolicy::KeepLocal {
              CloudSaveStatus::KeptLocal
            } else {
              CloudSaveStatus::LocalNewer
            })
          });
        }
      }
    }
  }

  let response = match response {
    Some(response) => response,
    None => match get_latest(&client, &url, &request.access_token).await? {
      Ok(response) => response,
      Err(status) => return Ok(CloudSaveOutcome::http(CloudSaveStatus::RestoreFailed, status)),
    },
  };
  let temp = TempFolder::create()?;
  let archive = temp.0.join("backup.zip");
  stream_to_file(response, &archive).await?;
  let backup_dir = {
    let (archive, root) = (archive.clone(), temp.0.clone());
    tauri::async_runtime::spawn_blocking(move || {
      extract_zip(&archive, &root)?;
      backup_dir_from_mapping(&root).ok_or_else(|| "no savegame extracted".to_string())
    })
    .await
    .map_err(|error| error.to_string())??
  };
  let output = {
    let _guard = ludusavi_lock().lock().await;
    write_config(app, &dir, installation_path, &request.roots, wine_prefix.as_deref())?;
    run_ludusavi(&binary, restore_args(&dir, &backup_dir, wine_prefix.as_deref())).await?
  };
  if !output.status.success() {
    return Ok(CloudSaveOutcome::failed(
      CloudSaveStatus::RestoreFailed,
      format!(
        "Ludusavi restore exited with {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
      ),
    ));
  }
  Ok(CloudSaveOutcome::new(CloudSaveStatus::RestoreSuccess))
}

/// Streams an authenticated server download to a file the user picked
/// (save versions "Download selected"). Returns the number of bytes written.
#[tauri::command]
pub(crate) async fn download_to_file(url: String, path: String, auth_header: Option<String>) -> Result<u64, String> {
  let parsed = crate::net::validate_http_url(&url)?;
  let target = PathBuf::from(&path);
  if !target.is_absolute() || target.file_name().is_none() {
    return Err("Choose an absolute file path.".into());
  }
  let client = http_client()?;
  let mut builder = crate::net::server_request(client.get(parsed), &url);
  if let Some(header) = auth_header.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
    builder = builder.header(reqwest::header::AUTHORIZATION, header);
  }
  let response = builder.send().await.map_err(|error| format!("Download failed: {error}"))?;
  if !response.status().is_success() {
    return Err(format!("Download failed (HTTP {}).", response.status().as_u16()));
  }
  stream_to_file(response, &target).await
}

#[cfg(test)]
mod tests {
  use super::*;

  struct ScratchDir(PathBuf);

  impl ScratchDir {
    fn new(label: &str) -> Self {
      let path = std::env::temp_dir().join(format!("playstash-cloud-saves-{label}-{}", new_uuid().unwrap()));
      fs::create_dir_all(&path).unwrap();
      Self(path)
    }
  }

  impl Drop for ScratchDir {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn settings(use_primary: bool, manifests: &[&str]) -> CloudSaveSettings {
    CloudSaveSettings {
      enabled: true,
      use_primary_manifest: use_primary,
      custom_manifests: manifests.iter().map(|entry| entry.to_string()).collect(),
    }
  }

  #[test]
  fn config_without_custom_manifests() {
    let settings = settings(true, &["", "   "]);
    let yaml = build_config_yaml(&ConfigInput {
      home: "/home/ada",
      installation_path: "/games/PlayStash/Celeste/Versions/1/Installation",
      roots: &["/games".to_string(), " ".to_string()],
      settings: &settings,
      wine_prefix: None,
    })
    .unwrap();
    let root = join_path("/games", "PlayStash");
    assert_eq!(
      yaml,
      format!(
        "redirects:\n\
         - kind: bidirectional\n  source: /home/ada\n  target: G:\\playstash\\currentuser\n\
         - kind: bidirectional\n  source: /games/PlayStash/Celeste/Versions/1/Installation\n  target: G:\\playstash\\installation\n\
         roots:\n\
         - store: other\n  path: {root}\n"
      )
    );
  }

  #[test]
  fn config_with_url_and_path_manifests() {
    let settings = settings(true, &[" https://example.com/manifest.yaml ", "/abs/manifest.yaml", "file:///x.yaml"]);
    let yaml = build_config_yaml(&ConfigInput {
      home: r"C:\Users\ada",
      installation_path: "",
      roots: &[],
      settings: &settings,
      wine_prefix: None,
    })
    .unwrap();
    assert_eq!(
      yaml,
      "redirects:\n\
       - kind: bidirectional\n  source: C:\\Users\\ada\n  target: G:\\playstash\\currentuser\n\
       - kind: bidirectional\n  source: ''\n  target: G:\\playstash\\installation\n\
       roots: []\n\
       manifest:\n  enable: true\n  secondary:\n\
       \x20 - url: https://example.com/manifest.yaml\n    enable: true\n\
       \x20 - path: /abs/manifest.yaml\n    enable: true\n\
       \x20 - path: file:///x.yaml\n    enable: true\n"
    );
  }

  #[test]
  fn config_with_primary_manifest_disabled() {
    let settings = settings(false, &["https://example.com/m.yaml"]);
    let yaml = build_config_yaml(&ConfigInput {
      home: "/home/ada",
      installation_path: "/i",
      roots: &[],
      settings: &settings,
      wine_prefix: None,
    })
    .unwrap();
    assert!(yaml.contains("manifest:\n  enable: false\n  secondary:\n  - url: https://example.com/m.yaml\n    enable: true\n"));
  }

  #[test]
  fn config_maps_the_proton_prefix_user_first() {
    let settings = CloudSaveSettings::default();
    let yaml = build_config_yaml(&ConfigInput {
      home: "/home/ada",
      installation_path: "/i",
      roots: &[],
      settings: &settings,
      wine_prefix: Some("/home/ada/.local/share/PlayStash/prefixes/Celeste"),
    })
    .unwrap();
    let source = Path::new("/home/ada/.local/share/PlayStash/prefixes/Celeste")
      .join("drive_c")
      .join("users")
      .join("steamuser")
      .to_string_lossy()
      .to_string();
    assert!(yaml.starts_with(&format!(
      "redirects:\n- kind: bidirectional\n  source: {source}\n  target: G:\\playstash\\currentuser\n- kind: bidirectional\n  source: /home/ada\n"
    )));
    assert!(!yaml.contains("manifest:"));
  }

  #[test]
  fn command_lines_keep_titles_after_the_separator() {
    let cfg = Path::new("cfg");
    let strings = |args: Vec<OsString>| args.into_iter().map(|arg| arg.to_string_lossy().to_string()).collect::<Vec<_>>();
    assert_eq!(
      strings(find_args(cfg, "--help").unwrap()),
      ["--config", "cfg", "find", "--fuzzy", "--api", "--", "--help"]
    );
    assert_eq!(
      strings(backup_args(cfg, Path::new("out"), "Celeste", None).unwrap()),
      ["--config", "cfg", "backup", "--force", "--format", "zip", "--path", "out", "--", "Celeste"]
    );
    assert_eq!(
      strings(backup_args(cfg, Path::new("out"), "Celeste", Some("/pfx")).unwrap()),
      ["--config", "cfg", "backup", "--force", "--format", "zip", "--path", "out", "--wine-prefix", "/pfx", "--", "Celeste"]
    );
    assert_eq!(
      strings(restore_args(cfg, Path::new("in"), None)),
      ["--config", "cfg", "restore", "--force", "--path", "in", "--"]
    );
    assert_eq!(
      strings(restore_args(cfg, Path::new("in"), Some("/pfx"))),
      ["--config", "cfg", "restore", "--force", "--path", "in", "--wine-prefix", "/pfx", "--"]
    );
    assert_eq!(
      strings(preview_args(cfg, "Celeste", None).unwrap()),
      ["--config", "cfg", "backup", "--preview", "--api", "--", "Celeste"]
    );
    assert!(find_args(cfg, "  ").is_err());
    assert!(backup_args(cfg, Path::new("out"), "", None).is_err());
  }

  #[test]
  fn find_output_accepts_only_confident_first_matches() {
    assert_eq!(parse_find_output(r#"{"games":{"Celeste":{"score":0.95}}}"#), "Celeste");
    assert_eq!(parse_find_output(r#"{"games":{"Celeste":{"score":0.9}}}"#), "");
    assert_eq!(parse_find_output(r#"{"games":{}}"#), "");
    assert_eq!(parse_find_output(""), "");
    assert_eq!(parse_find_output(r#"{"errors":{"unknownGames":["x"]},"games":{}}"#), "");
    assert_eq!(parse_find_output(r#"{"games":{"Celeste":{}}}"#), "");
    // Document order, not alphabetical order, decides the first entry.
    assert_eq!(
      parse_find_output(r#"{"games":{"Zeta":{"score":1.0},"Alpha":{"score":1.0}}}"#),
      "Zeta"
    );
  }

  #[test]
  fn content_disposition_installation_ids() {
    let id = |header: &str| content_disposition_filename(header).and_then(|name| installation_id_from_filename(&name));
    assert_eq!(id(r#"attachment; filename="x_abc.zip""#).as_deref(), Some("abc"));
    assert_eq!(id("attachment; filename=save_2024_abc.zip").as_deref(), Some("abc"));
    assert_eq!(
      id(r#"attachment; filename="fallback_old.zip"; filename*=UTF-8''sp%C3%A4t_2024_d3f.zip"#).as_deref(),
      Some("d3f")
    );
    assert_eq!(
      content_disposition_filename("attachment; filename*=UTF-8''sp%C3%A4t_x.zip").as_deref(),
      Some("spät_x.zip")
    );
    assert_eq!(id("attachment; filename=noid.zip"), None);
    assert_eq!(id("attachment"), None);
  }

  #[test]
  fn rfc3339_timestamps() {
    assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(parse_rfc3339_ms("2026-10-13T12:00:00.123Z"), Some(1_791_892_800_123));
    assert_eq!(parse_rfc3339_ms("2026-10-13T14:00:00+02:00"), Some(1_791_892_800_000));
    assert_eq!(parse_rfc3339_ms("not a date"), None);
    let versions = r#"[{"filename":"a_1.zip","created_at":"2026-10-13T12:00:00Z"},{"filename":"b_2.zip","created_at":"2026-10-14T12:00:00Z"}]"#;
    assert_eq!(latest_cloud_save_ms(versions, Some("a_1.zip")), parse_rfc3339_ms("2026-10-13T12:00:00Z"));
    assert_eq!(latest_cloud_save_ms(versions, None), parse_rfc3339_ms("2026-10-14T12:00:00Z"));
  }

  #[test]
  fn preview_lists_local_files() {
    let output = r#"{"overall":{},"games":{"Celeste":{"decision":"Processed","files":{"C:/saves/b.sav":{"bytes":1},"C:/saves/a.sav":{"bytes":2}},"registry":{}}}}"#;
    assert_eq!(parse_preview_files(output), ["C:/saves/a.sav", "C:/saves/b.sav"]);
    assert!(parse_preview_files(r#"{"games":{}}"#).is_empty());
  }

  #[test]
  fn backup_dir_is_the_grandparent_of_mapping_yaml() {
    let scratch = ScratchDir::new("mapping");
    let game = scratch.0.join("guid").join("Celeste");
    fs::create_dir_all(&game).unwrap();
    fs::write(game.join("mapping.yaml"), "name: Celeste").unwrap();
    assert_eq!(backup_dir_from_mapping(&scratch.0), Some(scratch.0.join("guid")));
    let empty = ScratchDir::new("mapping-empty");
    assert_eq!(backup_dir_from_mapping(&empty.0), None);
  }

  #[test]
  fn zip_round_trip_keeps_the_folder_as_archive_root() {
    let scratch = ScratchDir::new("zip");
    let source = scratch.0.join("backup-guid");
    fs::create_dir_all(source.join("Celeste")).unwrap();
    fs::write(source.join("Celeste").join("mapping.yaml"), "name: Celeste\n").unwrap();
    fs::write(source.join("Celeste").join("backup-1.zip"), [1u8, 2, 3]).unwrap();
    let archive = source.join("backup.zip");
    zip_directory(&source, &archive).unwrap();

    let names: Vec<String> = {
      let mut zip = zip::ZipArchive::new(fs::File::open(&archive).unwrap()).unwrap();
      (0..zip.len()).map(|index| zip.by_index(index).unwrap().name().to_string()).collect()
    };
    assert!(names.contains(&"backup-guid/Celeste/mapping.yaml".to_string()));
    assert!(!names.iter().any(|name| name.ends_with("backup.zip")));

    let output = scratch.0.join("restored");
    extract_zip(&archive, &output).unwrap();
    assert_eq!(
      fs::read_to_string(output.join("backup-guid").join("Celeste").join("mapping.yaml")).unwrap(),
      "name: Celeste\n"
    );
    assert_eq!(backup_dir_from_mapping(&output), Some(output.join("backup-guid")));
  }

  fn write_zip(path: &Path, entries: &[(&str, &[u8])], password: Option<&[u8]>) {
    let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
    for (name, data) in entries {
      let mut options = zip::write::SimpleFileOptions::default();
      if let Some(password) = password {
        options = zip::unstable::write::FileOptionsExt::with_deprecated_encryption(options, password);
      }
      writer.start_file(*name, options).unwrap();
      writer.write_all(data).unwrap();
    }
    writer.finish().unwrap();
  }

  #[test]
  fn extraction_rejects_traversal() {
    let scratch = ScratchDir::new("traversal");
    for name in ["../evil.txt", "a/../../evil.txt", "C:/evil.txt", "a\\..\\evil.txt"] {
      let archive = scratch.0.join("evil.zip");
      write_zip(&archive, &[(name, b"x")], None);
      let output = scratch.0.join("out");
      assert!(extract_zip(&archive, &output).is_err(), "{name} must be rejected");
      assert!(!scratch.0.join("evil.txt").exists());
    }
  }

  #[test]
  fn extraction_accepts_legacy_encrypted_archives() {
    let scratch = ScratchDir::new("legacy");
    let archive = scratch.0.join("legacy.zip");
    write_zip(&archive, &[("guid/Celeste/mapping.yaml", b"name: Celeste")], Some(LEGACY_ARCHIVE_PASSWORD));
    let output = scratch.0.join("out");
    extract_zip(&archive, &output).unwrap();
    assert_eq!(
      fs::read_to_string(output.join("guid").join("Celeste").join("mapping.yaml")).unwrap(),
      "name: Celeste"
    );
  }

  #[test]
  fn installation_id_is_created_once_and_merged() {
    let scratch = ScratchDir::new("installation-id");
    fs::write(scratch.0.join(GAME_CONFIG_FILE), r#"{"launchexecutable":"game.exe"}"#).unwrap();
    assert_eq!(read_installation_id(&scratch.0), None);
    let id = ensure_installation_id(&scratch.0).unwrap();
    assert_eq!(id.len(), 36);
    assert_eq!(&id[14..15], "4");
    assert_eq!(ensure_installation_id(&scratch.0).unwrap(), id);
    let config: serde_json::Value = serde_json::from_str(&fs::read_to_string(scratch.0.join(GAME_CONFIG_FILE)).unwrap()).unwrap();
    assert_eq!(config["launchexecutable"], "game.exe");
    assert_eq!(config["installationid"], id.as_str());

    let broken = ScratchDir::new("installation-id-broken");
    fs::write(broken.0.join(GAME_CONFIG_FILE), "not json").unwrap();
    assert!(ensure_installation_id(&broken.0).is_err());
    assert_eq!(fs::read_to_string(broken.0.join(GAME_CONFIG_FILE)).unwrap(), "not json");
  }

  #[test]
  fn multipart_frame_names_the_file_field() {
    let (head, tail) = multipart_frame("b");
    assert_eq!(
      head,
      "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.zip\"\r\nContent-Type: application/x-zip-compressed\r\n\r\n"
    );
    assert_eq!(tail, "\r\n--b--\r\n");
  }

  #[test]
  fn manifests_are_trimmed_and_blank_entries_dropped() {
    assert_eq!(
      clean_manifests(&[" a ".into(), "".into(), "  ".into(), "b".into()]),
      ["a", "b"]
    );
  }

  /// Manual smoke test of the real sidecar (`pnpm ludusavi:build` first):
  /// version, find, backup into a temp folder, zip, extract, restore.
  /// `cargo test --lib cloud_saves::tests::ludusavi_smoke -- --ignored --nocapture`
  #[test]
  #[ignore]
  fn ludusavi_smoke() {
    let binary = resolve_ludusavi().expect("run `pnpm ludusavi:build` first");
    tauri::async_runtime::block_on(async {
      let version = run_ludusavi(&binary, vec!["--version".into()]).await.unwrap();
      assert_eq!(String::from_utf8_lossy(&version.stdout).trim(), "ludusavi 0.31.0");

      let scratch = ScratchDir::new("smoke");
      let home = scratch.0.join("home");
      let install = scratch.0.join("install");
      fs::create_dir_all(home.join("Saves")).unwrap();
      fs::create_dir_all(&install).unwrap();
      let save = home.join("Saves").join("slot1.sav");
      fs::write(&save, "original save").unwrap();
      let config = scratch.0.join("config");
      fs::create_dir_all(&config).unwrap();

      let settings = CloudSaveSettings::default();
      let mut yaml = build_config_yaml(&ConfigInput {
        home: &home.to_string_lossy(),
        installation_path: &install.to_string_lossy(),
        roots: &[],
        settings: &settings,
        wine_prefix: None,
      })
      .unwrap();
      // Offline smoke: no primary manifest, one custom game instead.
      yaml.push_str(&format!(
        "manifest:\n  enable: false\n  secondary: []\ncustomGames:\n- name: PlayStash Smoke --help\n  integration: override\n  files:\n  - '{}'\n",
        save.to_string_lossy().replace('\\', "/")
      ));
      fs::write(config.join("config.yaml"), yaml).unwrap();

      let title = "PlayStash Smoke --help";
      let found = run_ludusavi(&binary, find_args(&config, title).unwrap()).await.unwrap();
      println!("find: {}", String::from_utf8_lossy(&found.stdout));
      assert_eq!(parse_find_output(&String::from_utf8_lossy(&found.stdout)), title);

      let temp = TempFolder::create().unwrap();
      let backed_up = run_ludusavi(&binary, backup_args(&config, &temp.0, title, None).unwrap()).await.unwrap();
      assert!(backed_up.status.success(), "{}", String::from_utf8_lossy(&backed_up.stderr));
      let mapping = find_mapping_file(&temp.0).expect("mapping.yaml");
      println!("mapping: {}", fs::read_to_string(&mapping).unwrap());
      let archive = temp.0.join("backup.zip");
      zip_directory(&temp.0, &archive).unwrap();

      let preview = run_ludusavi(&binary, preview_args(&config, title, None).unwrap()).await.unwrap();
      let files = parse_preview_files(&String::from_utf8_lossy(&preview.stdout));
      println!("preview files: {files:?}");
      assert_eq!(files.len(), 1);
      let original_mtime = newest_mtime_ms(&files).unwrap();

      std::thread::sleep(std::time::Duration::from_millis(1_100));
      fs::write(&save, "changed save").unwrap();
      let restored_root = scratch.0.join("download");
      extract_zip(&archive, &restored_root).unwrap();
      let backup_dir = backup_dir_from_mapping(&restored_root).unwrap();
      let restored = run_ludusavi(&binary, restore_args(&config, &backup_dir, None)).await.unwrap();
      assert!(restored.status.success(), "{}", String::from_utf8_lossy(&restored.stderr));
      assert_eq!(fs::read_to_string(&save).unwrap(), "original save");
      let restored_mtime = newest_mtime_ms(&files).unwrap();
      println!("mtime before backup {original_mtime}, after restore {restored_mtime}");
    });
  }
}
