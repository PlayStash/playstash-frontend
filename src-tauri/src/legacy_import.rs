//! Import from the previous WPF client (PlayStash 1.x for Windows).
//!
//! The WPF client kept its settings in "Preferences" files under
//! `%APPDATA%\PlayStash`: one `Key=Value` per line, read with the first line
//! whose text starts with `Key=` (decompiled `Lib/Preferences.dll`). Encrypted
//! values are `Base64(ProtectedData.Protect(UTF8(value), entropy: null,
//! DataProtectionScope.CurrentUser))`, so only the same Windows user on the
//! same machine can read them. Values that cannot be decrypted are skipped.
//!
//! Layout (WPF `ProfileManager`):
//! - `profileconfig`: global (remember me, last profile, request headers, language)
//! - `profiles\<server>\<guid>\config\user`: one profile's settings
//! - `profiles\<server>\<guid>\themes\`: the profile's custom themes
//!
//! Installed games lived in `<root>\PlayStash\Installations\(<id>)<Title>\`
//! with a `playstash-exec` Preferences file. They can be adopted into the new
//! layout `<root>/PlayStash/<Title>/Versions/<version>/Installation`.
//!
//! Where every imported key lands is decided in `src/utils/legacyImport.ts`
//! (`LEGACY_SETTING_TARGETS`); that table and `LEGACY_KEYS` below must list the
//! same keys.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LegacyScope {
  /// `%APPDATA%\PlayStash\profileconfig`
  Global,
  /// `profiles\<server>\<guid>\config\user`
  Profile,
  /// `<install dir>\playstash-exec`
  Installation,
}

pub(crate) struct LegacyKey {
  pub key: &'static str,
  pub encrypted: bool,
  pub scope: LegacyScope,
}

const fn key(key: &'static str, encrypted: bool, scope: LegacyScope) -> LegacyKey {
  LegacyKey { key, encrypted, scope }
}

/// Every WPF key the import reads. `Password` is deliberately absent: the
/// new client never stores passwords (the imported session token replaces it).
pub(crate) const LEGACY_KEYS: &[LegacyKey] = &[
  key("LoginRememberMe", false, LegacyScope::Global),
  key("LastUserProfile", false, LegacyScope::Global),
  key("AdditionalRequestHeaders", false, LegacyScope::Global),
  key("ApplicationLanguage", false, LegacyScope::Global),
  key("ServerUrl", true, LegacyScope::Profile),
  key("Username", false, LegacyScope::Profile),
  key("IsLoggedInWithSSO", false, LegacyScope::Profile),
  key("UserID", false, LegacyScope::Profile),
  key("SessionToken", true, LegacyScope::Profile),
  key("ExtractionPassword", true, LegacyScope::Profile),
  key("Theme", true, LegacyScope::Profile),
  key("RootDirectories", false, LegacyScope::Profile),
  key("AutoExtract", false, LegacyScope::Profile),
  key("AutoInstallPortable", false, LegacyScope::Profile),
  key("AutoDeletePortable", false, LegacyScope::Profile),
  key("DownloadLimit", false, LegacyScope::Profile),
  key("BackgroundStart", false, LegacyScope::Profile),
  key("ShowMappedTitle", false, LegacyScope::Profile),
  key("FullscreenLibrary", false, LegacyScope::Profile),
  key("StartupSound", false, LegacyScope::Profile),
  key("ChatNotifications", false, LegacyScope::Profile),
  key("ActivityNotifications", false, LegacyScope::Profile),
  key("CommunityPresence", false, LegacyScope::Profile),
  key("SyncSteamShortcuts", false, LegacyScope::Profile),
  key("SyncDiscordPresence", false, LegacyScope::Profile),
  key("DiscordApplicationId", false, LegacyScope::Profile),
  key("CloudSaves", false, LegacyScope::Profile),
  key("UsePrimaryCloudSaveManifest", false, LegacyScope::Profile),
  key("CustomCloudSaveManifests", false, LegacyScope::Profile),
  key("MountIso", false, LegacyScope::Profile),
  key("CreateDesktopShortcut", false, LegacyScope::Profile),
  key("LibStartup", false, LegacyScope::Profile),
  key("RetainLibarySortByAndOrderBy", false, LegacyScope::Profile),
  key("LastLibrarySortBy", false, LegacyScope::Profile),
  key("LastLibraryOrderBy", false, LegacyScope::Profile),
  key("ArtworkSearchProviders", false, LegacyScope::Profile),
  key("MediaSliderVolume", false, LegacyScope::Profile),
  key("Executable", false, LegacyScope::Installation),
  key("LaunchParameter", false, LegacyScope::Installation),
  key("InstalledGameVersion", false, LegacyScope::Installation),
  key("ForcedInstallationType", false, LegacyScope::Installation),
  key("InstallationId", false, LegacyScope::Installation),
];

/// `Preferences.Get`: the value of the first line starting with `key=`, or
/// `""` when the key is missing. A value may itself contain `=`.
pub(crate) fn preference_value(content: &str, key: &str) -> String {
  let content = content.strip_prefix('\u{feff}').unwrap_or(content);
  for line in content.lines() {
    let line = line.strip_suffix('\r').unwrap_or(line);
    if let Some(rest) = line.strip_prefix(key) {
      if let Some(value) = rest.strip_prefix('=') {
        return value.to_string();
      }
    }
  }
  String::new()
}

/// Decrypts a WPF encrypted preference (Base64 + DPAPI, CurrentUser, no entropy).
pub(crate) fn decrypt_preference(value: &str) -> Option<String> {
  use base64::Engine as _;
  let bytes = base64::engine::general_purpose::STANDARD.decode(value.trim()).ok()?;
  let plain = dpapi::unprotect(&bytes)?;
  String::from_utf8(plain).ok()
}

/// Reads the keys of one scope from a Preferences file. Encrypted values that
/// cannot be decrypted are left out and reported in `skipped`.
fn read_scope(path: &Path, scope: LegacyScope, label: &str, skipped: &mut Vec<String>) -> BTreeMap<String, String> {
  let mut values = BTreeMap::new();
  let Ok(content) = std::fs::read_to_string(path) else { return values };
  for entry in LEGACY_KEYS.iter().filter(|entry| entry.scope == scope) {
    let raw = preference_value(&content, entry.key);
    if raw.is_empty() {
      continue;
    }
    if entry.encrypted {
      match decrypt_preference(&raw) {
        Some(value) => {
          values.insert(entry.key.to_string(), value);
        }
        None => skipped.push(format!("{label}: {} could not be decrypted", entry.key)),
      }
    } else {
      values.insert(entry.key.to_string(), raw);
    }
  }
  values
}

/// Parses a WPF game folder name `(<id>)<Title>`.
pub(crate) fn parse_legacy_folder_name(name: &str) -> Option<(i64, String)> {
  let rest = name.strip_prefix('(')?;
  let (id, title) = rest.split_once(')')?;
  let id = id.trim().parse::<i64>().ok().filter(|id| *id > 0)?;
  Some((id, title.trim().to_string()))
}

fn legacy_root() -> Option<PathBuf> {
  std::env::var_os("APPDATA").map(|appdata| PathBuf::from(appdata).join("PlayStash"))
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyProfile {
  /// The WPF profile directory (`LastUserProfile` refers to it).
  pub root_dir: String,
  /// Decrypted and plain values by WPF key name.
  pub values: BTreeMap<String, String>,
  /// Custom theme files (`themes\*`).
  pub theme_files: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyScan {
  pub found: bool,
  pub global: BTreeMap<String, String>,
  pub profiles: Vec<LegacyProfile>,
  pub skipped: Vec<String>,
}

fn find_user_config(profile_dir: &Path) -> Option<PathBuf> {
  let direct = profile_dir.join("config").join("user");
  if direct.is_file() {
    return Some(direct);
  }
  // WPF looked for a file named `user` at any depth.
  let mut stack = vec![profile_dir.to_path_buf()];
  while let Some(dir) = stack.pop() {
    for entry in std::fs::read_dir(&dir).ok()?.flatten() {
      let path = entry.path();
      let Ok(file_type) = entry.file_type() else { continue };
      if file_type.is_dir() {
        stack.push(path);
      } else if file_type.is_file() && entry.file_name() == "user" {
        return Some(path);
      }
    }
  }
  None
}

pub(crate) fn scan_legacy_root(root: &Path) -> LegacyScan {
  let mut scan = LegacyScan::default();
  let profiles_root = root.join("profiles");
  if !profiles_root.is_dir() {
    return scan;
  }
  scan.found = true;
  scan.global = read_scope(&root.join("profileconfig"), LegacyScope::Global, "profileconfig", &mut scan.skipped);
  let Ok(server_dirs) = std::fs::read_dir(&profiles_root) else { return scan };
  for server_dir in server_dirs.flatten().filter(|entry| entry.path().is_dir()) {
    let Ok(user_dirs) = std::fs::read_dir(server_dir.path()) else { continue };
    for user_dir in user_dirs.flatten() {
      let profile_dir = user_dir.path();
      if !profile_dir.is_dir() || user_dir.file_name() == "ImageCache" {
        continue;
      }
      let Some(config) = find_user_config(&profile_dir) else { continue };
      let label = format!(
        "{}\\{}",
        server_dir.file_name().to_string_lossy(),
        user_dir.file_name().to_string_lossy()
      );
      let values = read_scope(&config, LegacyScope::Profile, &label, &mut scan.skipped);
      let server = values.get("ServerUrl").map(String::as_str).unwrap_or("");
      let username = values.get("Username").map(String::as_str).unwrap_or("");
      if server.trim().is_empty() || username.trim().is_empty() {
        scan.skipped.push(format!("{label}: profile without server URL or username"));
        continue;
      }
      let mut theme_files = Vec::new();
      list_theme_files(&profile_dir.join("themes"), &mut theme_files, 0);
      scan.profiles.push(LegacyProfile { root_dir: profile_dir.to_string_lossy().to_string(), values, theme_files });
    }
  }
  scan
}

/// True on Windows when the WPF client left profiles behind.
#[tauri::command]
pub(crate) async fn legacy_import_available() -> bool {
  cfg!(windows) && legacy_root().map(|root| root.join("profiles").is_dir()).unwrap_or(false)
}

/// Reads the WPF profiles and settings, decrypting what DPAPI allows.
#[tauri::command]
pub(crate) async fn legacy_import_scan() -> Result<LegacyScan, String> {
  if !cfg!(windows) {
    return Ok(LegacyScan::default());
  }
  let root = legacy_root().ok_or("%APPDATA% is not set.")?;
  tauri::async_runtime::spawn_blocking(move || scan_legacy_root(&root))
    .await
    .map_err(|error| error.to_string())
}

fn is_inside(path: &Path, parent: &Path) -> bool {
  match (path.canonicalize(), parent.canonicalize()) {
    (Ok(path), Ok(parent)) => path.starts_with(parent),
    _ => false,
  }
}

/// Copies a WPF profile's custom themes (`*.xaml` plus overlay images) into
/// `<app_data_dir>/profiles/<profileId>/themes/` (the WP7 per-profile themes
/// dir), keeping sub folders: the WPF client loaded themes recursively.
#[tauri::command]
pub(crate) async fn legacy_import_copy_themes(
  app: tauri::AppHandle,
  legacy_profile_dir: String,
  profile_id: String,
) -> Result<u32, String> {
  let root = legacy_root().ok_or("%APPDATA% is not set.")?.join("profiles");
  let source = PathBuf::from(&legacy_profile_dir).join("themes");
  if !source.is_dir() {
    return Ok(0);
  }
  if !is_inside(&source, &root) {
    return Err("The theme folder is not part of the previous client's profiles.".into());
  }
  let target = crate::profiles::profile_dir(&app, &profile_id)?.join("themes");
  copy_theme_files(&source, &target, 0)
}

const MAX_THEME_DEPTH: usize = 16;

/// Theme files below a WPF `themes` folder (recursive, links skipped).
fn list_theme_files(dir: &Path, out: &mut Vec<String>, depth: usize) {
  if depth > MAX_THEME_DEPTH {
    return;
  }
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let Ok(kind) = entry.file_type() else {
      continue;
    };
    let path = entry.path();
    if kind.is_dir() {
      list_theme_files(&path, out, depth + 1);
    } else if kind.is_file() && is_theme_file(&path) {
      out.push(path.to_string_lossy().to_string());
    }
  }
}

fn is_theme_file(path: &Path) -> bool {
  let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
  matches!(extension.as_str(), "xaml" | "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp")
}

/// Copies theme files below `source` to `target` (existing files are kept).
/// Symbolic links are skipped.
fn copy_theme_files(source: &Path, target: &Path, depth: usize) -> Result<u32, String> {
  if depth > MAX_THEME_DEPTH {
    return Ok(0);
  }
  let mut copied = 0;
  for entry in std::fs::read_dir(source).map_err(|error| error.to_string())?.flatten() {
    let Ok(kind) = entry.file_type() else {
      continue;
    };
    let path = entry.path();
    let destination = target.join(entry.file_name());
    if kind.is_dir() {
      copied += copy_theme_files(&path, &destination, depth + 1)?;
    } else if kind.is_file() && is_theme_file(&path) && !destination.exists() {
      std::fs::create_dir_all(target).map_err(|error| error.to_string())?;
      std::fs::copy(&path, &destination).map_err(|error| error.to_string())?;
      copied += 1;
    }
  }
  Ok(copied)
}

/// Rust settings sections of other packages that imported WPF settings land
/// in (see `LEGACY_SETTING_TARGETS` in `src/utils/legacyImport.ts`).
const WRITABLE_SECTIONS: &[&str] = &["integrations", "cloudsaves", "startup"];

/// Merges imported values into another package's settings section, keeping
/// every field that is not imported.
#[tauri::command]
pub(crate) async fn legacy_import_write_section(
  app: tauri::AppHandle,
  section: String,
  values: serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
  if !WRITABLE_SECTIONS.contains(&section.as_str()) {
    return Err("This settings section cannot be imported.".into());
  }
  crate::settings::update_section::<serde_json::Value, _>(&app, &section, |current| {
    if !current.is_object() {
      *current = serde_json::Value::Object(Default::default());
    }
    if let Some(object) = current.as_object_mut() {
      for (key, value) in &values {
        object.insert(key.clone(), value.clone());
      }
    }
  })?;
  Ok(())
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyInstallation {
  pub root: String,
  pub path: String,
  pub game_id: i64,
  pub title: String,
  /// `Executable` relative to the installation folder (forward slashes), when inside it.
  pub executable_relative: Option<String>,
  pub executable: String,
  pub launch_parameter: String,
  pub installed_game_version: String,
  /// `ForcedInstallationType` mapped to the new game type names.
  pub forced_game_type: Option<String>,
  pub installation_id: String,
}

/// WPF `GameType` enum, stored as its JSON number.
pub(crate) fn map_forced_game_type(value: &str) -> Option<String> {
  let name = match value.trim().trim_matches('"') {
    "1" | "WINDOWS_SETUP" => "WINDOWS_SETUP",
    "2" | "WINDOWS_PORTABLE" => "WINDOWS_PORTABLE",
    "3" | "LINUX_PORTABLE" => "LINUX_PORTABLE",
    _ => return None,
  };
  Some(name.to_string())
}

pub(crate) fn relative_executable(install_dir: &Path, executable: &str) -> Option<String> {
  if executable.trim().is_empty() {
    return None;
  }
  let executable = Path::new(executable.trim());
  let relative = executable.strip_prefix(install_dir).ok()?;
  let parts: Vec<String> = relative
    .components()
    .map(|component| match component {
      std::path::Component::Normal(part) => Some(part.to_string_lossy().to_string()),
      _ => None,
    })
    .collect::<Option<_>>()?;
  (!parts.is_empty()).then(|| parts.join("/"))
}

pub(crate) fn scan_installations_in(root: &Path) -> Vec<LegacyInstallation> {
  let installations = root.join("PlayStash").join("Installations");
  let Ok(entries) = std::fs::read_dir(&installations) else { return Vec::new() };
  let mut found = Vec::new();
  for entry in entries.flatten() {
    let path = entry.path();
    if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
      continue;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    let Some((game_id, title)) = parse_legacy_folder_name(&name) else { continue };
    let exec = std::fs::read_to_string(path.join("playstash-exec")).unwrap_or_default();
    let executable = preference_value(&exec, "Executable");
    found.push(LegacyInstallation {
      root: root.to_string_lossy().to_string(),
      executable_relative: relative_executable(&path, &executable),
      executable,
      launch_parameter: preference_value(&exec, "LaunchParameter"),
      installed_game_version: preference_value(&exec, "InstalledGameVersion"),
      forced_game_type: map_forced_game_type(&preference_value(&exec, "ForcedInstallationType")),
      installation_id: preference_value(&exec, "InstallationId"),
      path: path.to_string_lossy().to_string(),
      game_id,
      title,
    });
  }
  found.sort_by_key(|entry| entry.title.to_lowercase());
  found
}

/// Lists the WPF-layout installations under the given library roots.
#[tauri::command]
pub(crate) async fn legacy_scan_installations(roots: Vec<String>) -> Result<Vec<LegacyInstallation>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    roots.iter().flat_map(|root| scan_installations_in(Path::new(root))).collect()
  })
  .await
  .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdoptRequest {
  pub root: String,
  pub legacy_path: String,
  /// Sanitised game folder name (the server title).
  pub game_folder: String,
  /// Sanitised version folder name.
  pub version_folder: String,
  /// Keys merged into `.playstash.game.config.json`.
  pub config: serde_json::Map<String, serde_json::Value>,
  /// `.playstash.metadata.json` entry: server identifier → game id.
  pub metadata_key: String,
  pub game_id: i64,
  /// `"move"` renames the folder into the new layout; `"link"` keeps it in
  /// place and links it into the new layout (directory junction on Windows).
  pub mode: String,
}

fn is_plain_folder_name(name: &str) -> bool {
  let name = name.trim();
  !name.is_empty()
    && name != "."
    && name != ".."
    && name.len() <= 200
    && !name.chars().any(|ch| matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || ch.is_control())
}

fn merge_json_file(path: &Path, patch: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
  let mut current = std::fs::read_to_string(path)
    .ok()
    .and_then(|data| serde_json::from_str::<serde_json::Value>(&data).ok())
    .and_then(|value| value.as_object().cloned())
    .unwrap_or_default();
  for (key, value) in patch {
    current.insert(key.clone(), value.clone());
  }
  let data = serde_json::to_string_pretty(&serde_json::Value::Object(current)).map_err(|error| error.to_string())?;
  std::fs::write(path, data).map_err(|error| error.to_string())
}

pub(crate) fn adopt_installation(request: &AdoptRequest) -> Result<String, String> {
  if !is_plain_folder_name(&request.game_folder) || !is_plain_folder_name(&request.version_folder) {
    return Err("Invalid game or version folder name.".into());
  }
  let root = PathBuf::from(&request.root);
  let installations = root.join("PlayStash").join("Installations");
  let legacy = PathBuf::from(&request.legacy_path);
  let legacy_name = legacy.file_name().and_then(|name| name.to_str()).unwrap_or("");
  let parent_ok = legacy.parent().map(|parent| parent == installations).unwrap_or(false);
  if !parent_ok || parse_legacy_folder_name(legacy_name).map(|(id, _)| id) != Some(request.game_id) || !legacy.is_dir() {
    return Err("The folder is not a legacy PlayStash installation of this game.".into());
  }
  let game_dir = root.join("PlayStash").join(request.game_folder.trim());
  let version_dir = game_dir.join("Versions").join(request.version_folder.trim());
  let installation = version_dir.join("Installation");
  if std::fs::symlink_metadata(&installation).is_ok() {
    return Err(format!("{} already exists.", installation.display()));
  }
  std::fs::create_dir_all(&version_dir).map_err(|error| error.to_string())?;
  match request.mode.as_str() {
    "move" => std::fs::rename(&legacy, &installation).map_err(|error| format!("Moving the installation failed: {error}"))?,
    "link" => link_directory(&legacy, &installation).map_err(|error| format!("Linking the installation failed: {error}"))?,
    _ => return Err("Unknown adoption mode.".into()),
  }
  let mut config = request.config.clone();
  config.insert("gameid".into(), serde_json::json!(request.game_id));
  config.insert("installationfinished".into(), serde_json::json!(true));
  merge_json_file(&version_dir.join(".playstash.game.config.json"), &config)?;
  let mut metadata = serde_json::Map::new();
  let metadata_key = if request.metadata_key.trim().is_empty() { "unknown" } else { request.metadata_key.trim() };
  metadata.insert(metadata_key.to_string(), serde_json::json!(request.game_id.to_string()));
  merge_json_file(&game_dir.join(".playstash.metadata.json"), &metadata)?;
  Ok(version_dir.to_string_lossy().to_string())
}

/// Adopts one WPF installation into the new layout. Returns the version directory.
#[tauri::command]
pub(crate) async fn legacy_adopt_installation(request: AdoptRequest) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || adopt_installation(&request))
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(unix)]
fn link_directory(target: &Path, link: &Path) -> std::io::Result<()> {
  std::os::unix::fs::symlink(target, link)
}

/// Creates a directory junction (no administrator rights or developer mode
/// needed, unlike a directory symlink).
#[cfg(windows)]
fn link_directory(target: &Path, link: &Path) -> std::io::Result<()> {
  junction::create(target, link)
}

#[cfg(windows)]
mod junction {
  use std::io;
  use std::os::windows::ffi::OsStrExt;
  use std::path::Path;
  use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_WRITE, INVALID_HANDLE_VALUE};
  use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, OPEN_EXISTING,
  };
  use windows_sys::Win32::System::IO::DeviceIoControl;

  const FSCTL_SET_REPARSE_POINT: u32 = 0x0009_00A4;
  const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;

  /// Builds a mount-point `REPARSE_DATA_BUFFER` for `target` (an absolute
  /// `C:\...` path).
  pub(super) fn reparse_buffer(target: &[u16]) -> Vec<u8> {
    let prefix: Vec<u16> = r"\??\".encode_utf16().collect();
    let substitute: Vec<u16> = prefix.iter().chain(target.iter()).copied().collect();
    let substitute_bytes = (substitute.len() * 2) as u16;
    let print_bytes = (target.len() * 2) as u16;
    // Path buffer: substitute + NUL + print + NUL.
    let path_bytes = substitute_bytes as usize + 2 + print_bytes as usize + 2;
    let data_length = (8 + path_bytes) as u16;
    let mut buffer = Vec::with_capacity(8 + data_length as usize);
    buffer.extend_from_slice(&IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
    buffer.extend_from_slice(&data_length.to_le_bytes());
    buffer.extend_from_slice(&0u16.to_le_bytes()); // Reserved
    buffer.extend_from_slice(&0u16.to_le_bytes()); // SubstituteNameOffset
    buffer.extend_from_slice(&substitute_bytes.to_le_bytes());
    buffer.extend_from_slice(&(substitute_bytes + 2).to_le_bytes()); // PrintNameOffset
    buffer.extend_from_slice(&print_bytes.to_le_bytes());
    for unit in substitute.iter().chain(std::iter::once(&0)).chain(target.iter()).chain(std::iter::once(&0)) {
      buffer.extend_from_slice(&unit.to_le_bytes());
    }
    buffer
  }

  pub(super) fn create(target: &Path, link: &Path) -> io::Result<()> {
    let target = std::fs::canonicalize(target)?;
    let target = target.as_os_str().to_string_lossy().to_string();
    let target = match target.strip_prefix(r"\\?\") {
      Some(rest) if !rest.starts_with("UNC\\") => rest.to_string(),
      _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, "Junctions need a local drive path.")),
    };
    std::fs::create_dir(link)?;
    let mut link_wide: Vec<u16> = link.as_os_str().encode_wide().collect();
    link_wide.push(0);
    let buffer = reparse_buffer(&target.encode_utf16().collect::<Vec<u16>>());
    // SAFETY: plain Win32 calls with valid, NUL-terminated buffers that
    // outlive the calls; the handle is closed on every path.
    let result = unsafe {
      let handle = CreateFileW(
        link_wide.as_ptr(),
        GENERIC_WRITE,
        0,
        std::ptr::null(),
        OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
        std::ptr::null_mut(),
      );
      if handle == INVALID_HANDLE_VALUE {
        Err(io::Error::last_os_error())
      } else {
        let mut returned = 0u32;
        let ok = DeviceIoControl(
          handle,
          FSCTL_SET_REPARSE_POINT,
          buffer.as_ptr().cast(),
          buffer.len() as u32,
          std::ptr::null_mut(),
          0,
          &mut returned,
          std::ptr::null_mut(),
        );
        let error = io::Error::last_os_error();
        CloseHandle(handle);
        if ok == 0 { Err(error) } else { Ok(()) }
      }
    };
    if result.is_err() {
      let _ = std::fs::remove_dir(link);
    }
    result
  }
}

mod dpapi {
  /// `CryptUnprotectData` with no entropy and no UI (WPF `ProtectedData.Unprotect(data, null, CurrentUser)`).
  #[cfg(windows)]
  pub(crate) fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: `input` points to `data` for the duration of the call; the
    // output buffer is copied and released with LocalFree.
    unsafe {
      let ok = CryptUnprotectData(
        &input,
        std::ptr::null_mut(),
        std::ptr::null(),
        std::ptr::null(),
        std::ptr::null(),
        CRYPTPROTECT_UI_FORBIDDEN,
        &mut output,
      );
      if ok == 0 || output.pbData.is_null() {
        return None;
      }
      let plain = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
      LocalFree(output.pbData.cast());
      Some(plain)
    }
  }

  /// DPAPI does not exist outside Windows; the WPF client never ran there.
  #[cfg(not(windows))]
  pub(crate) fn unprotect(_data: &[u8]) -> Option<Vec<u8>> {
    None
  }

  /// `CryptProtectData`, used by the round-trip test.
  #[cfg(all(windows, test))]
  pub(crate) fn protect(data: &[u8]) -> Option<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: see `unprotect`.
    unsafe {
      let ok = CryptProtectData(
        &input,
        std::ptr::null(),
        std::ptr::null(),
        std::ptr::null(),
        std::ptr::null(),
        CRYPTPROTECT_UI_FORBIDDEN,
        &mut output,
      );
      if ok == 0 || output.pbData.is_null() {
        return None;
      }
      let protected = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
      LocalFree(output.pbData.cast());
      Some(protected)
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  struct ScratchDir(PathBuf);
  impl ScratchDir {
    fn new(name: &str) -> Self {
      let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
      let dir = std::env::temp_dir().join(format!("playstash-legacy-{name}-{}-{nanos}", std::process::id()));
      std::fs::create_dir_all(&dir).unwrap();
      Self(dir)
    }
  }
  impl Drop for ScratchDir {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn copies_theme_files_recursively_and_keeps_existing_ones() {
    let scratch = ScratchDir::new("themes");
    let source = scratch.0.join("themes");
    std::fs::create_dir_all(source.join("Sub")).unwrap();
    std::fs::write(source.join("A.xaml"), "a").unwrap();
    std::fs::write(source.join("notes.txt"), "x").unwrap();
    std::fs::write(source.join("Sub").join("B.xaml"), "b").unwrap();
    std::fs::write(source.join("Sub").join("overlay.png"), "p").unwrap();
    let target = scratch.0.join("target");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("A.xaml"), "kept").unwrap();

    let mut listed = Vec::new();
    list_theme_files(&source, &mut listed, 0);
    assert_eq!(listed.len(), 3);
    assert_eq!(copy_theme_files(&source, &target, 0).unwrap(), 2);
    assert_eq!(std::fs::read_to_string(target.join("A.xaml")).unwrap(), "kept");
    assert_eq!(std::fs::read_to_string(target.join("Sub").join("B.xaml")).unwrap(), "b");
    assert!(target.join("Sub").join("overlay.png").is_file());
    assert!(!target.join("notes.txt").exists());
  }


  #[test]
  fn reads_preference_lines_like_the_wpf_library() {
    let content = "\u{feff}Username=alice\r\nThemeX=wrong\r\nTheme=a=b=c\r\nEmpty=\r\n";
    assert_eq!(preference_value(content, "Username"), "alice");
    assert_eq!(preference_value(content, "Theme"), "a=b=c");
    assert_eq!(preference_value(content, "Empty"), "");
    assert_eq!(preference_value(content, "Missing"), "");
    assert_eq!(preference_value("UsernameX=1\nUsername=2", "Username"), "2");
  }

  #[test]
  fn parses_legacy_folder_names() {
    assert_eq!(parse_legacy_folder_name("(12)Half-Life (1998)"), Some((12, "Half-Life (1998)".into())));
    assert_eq!(parse_legacy_folder_name("( 7 ) Doom"), Some((7, "Doom".into())));
    assert_eq!(parse_legacy_folder_name("Doom"), None);
    assert_eq!(parse_legacy_folder_name("(x)Doom"), None);
    assert_eq!(parse_legacy_folder_name("(0)Doom"), None);
  }

  #[test]
  fn maps_forced_types_and_relative_executables() {
    assert_eq!(map_forced_game_type("2").as_deref(), Some("WINDOWS_PORTABLE"));
    assert_eq!(map_forced_game_type("0"), None);
    assert_eq!(map_forced_game_type(""), None);
    let base = std::env::temp_dir().join("game");
    let exe = base.join("bin").join("game.exe");
    assert_eq!(relative_executable(&base, &exe.to_string_lossy()).as_deref(), Some("bin/game.exe"));
    assert_eq!(relative_executable(&base, "C:\\elsewhere\\x.exe"), None);
    assert_eq!(relative_executable(&base, ""), None);
  }

  #[test]
  fn every_key_has_a_single_scope() {
    let mut seen = std::collections::HashSet::new();
    for entry in LEGACY_KEYS {
      assert!(seen.insert(entry.key), "{} is listed twice", entry.key);
    }
    assert!(!seen.contains("Password"));
  }

  #[test]
  fn scans_installations_and_adopts_them_by_moving() {
    let scratch = ScratchDir::new("adopt");
    let root = scratch.0.clone();
    let legacy = root.join("PlayStash").join("Installations").join("(42)Some Game");
    std::fs::create_dir_all(legacy.join("bin")).unwrap();
    std::fs::write(legacy.join("bin").join("game.exe"), "x").unwrap();
    let exe = legacy.join("bin").join("game.exe");
    std::fs::write(
      legacy.join("playstash-exec"),
      format!("Executable={}\nLaunchParameter=-fullscreen\nInstalledGameVersion=1.2\nForcedInstallationType=2\nInstallationId=abc\n", exe.display()),
    )
    .unwrap();
    let found = scan_installations_in(&root);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].game_id, 42);
    assert_eq!(found[0].title, "Some Game");
    assert_eq!(found[0].executable_relative.as_deref(), Some("bin/game.exe"));
    assert_eq!(found[0].forced_game_type.as_deref(), Some("WINDOWS_PORTABLE"));

    let mut config = serde_json::Map::new();
    config.insert("versionid".into(), serde_json::json!(7));
    let request = AdoptRequest {
      root: root.to_string_lossy().to_string(),
      legacy_path: legacy.to_string_lossy().to_string(),
      game_folder: "Some Game".into(),
      version_folder: "1.2".into(),
      config,
      metadata_key: "server-uuid".into(),
      game_id: 42,
      mode: "move".into(),
    };
    let version_dir = PathBuf::from(adopt_installation(&request).unwrap());
    assert!(version_dir.join("Installation").join("bin").join("game.exe").is_file());
    assert!(!legacy.exists());
    let config: serde_json::Value =
      serde_json::from_str(&std::fs::read_to_string(version_dir.join(".playstash.game.config.json")).unwrap()).unwrap();
    assert_eq!(config["versionid"], 7);
    assert_eq!(config["gameid"], 42);
    assert_eq!(config["installationfinished"], true);
    let metadata: serde_json::Value = serde_json::from_str(
      &std::fs::read_to_string(root.join("PlayStash").join("Some Game").join(".playstash.metadata.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(metadata["server-uuid"], "42");
    // A second adoption into the same target is refused.
    assert!(adopt_installation(&request).is_err());
  }

  #[test]
  fn refuses_foreign_folders_and_unsafe_names() {
    let scratch = ScratchDir::new("refuse");
    let root = scratch.0.clone();
    let foreign = root.join("elsewhere").join("(1)Game");
    std::fs::create_dir_all(&foreign).unwrap();
    let mut request = AdoptRequest {
      root: root.to_string_lossy().to_string(),
      legacy_path: foreign.to_string_lossy().to_string(),
      game_folder: "Game".into(),
      version_folder: "1".into(),
      config: Default::default(),
      metadata_key: String::new(),
      game_id: 1,
      mode: "move".into(),
    };
    assert!(adopt_installation(&request).is_err());
    request.game_folder = "..".into();
    assert!(adopt_installation(&request).is_err());
    request.game_folder = "a/b".into();
    assert!(adopt_installation(&request).is_err());
  }

  #[test]
  fn scans_a_legacy_profile_tree() {
    let scratch = ScratchDir::new("scan");
    let root = scratch.0.clone();
    std::fs::write(root.join("profileconfig"), "LoginRememberMe=1\nApplicationLanguage=de\n").unwrap();
    let profile = root.join("profiles").join("serverexamplecom").join("guid-1");
    std::fs::create_dir_all(profile.join("config")).unwrap();
    std::fs::create_dir_all(profile.join("themes")).unwrap();
    std::fs::write(profile.join("themes").join("Mine.xaml"), "<x/>").unwrap();
    // Not DPAPI data: the encrypted ServerUrl cannot be read, so the profile is skipped.
    std::fs::write(profile.join("config").join("user"), "Username=alice\nServerUrl=bm90LWRwYXBp\n").unwrap();
    std::fs::create_dir_all(root.join("profiles").join("serverexamplecom").join("ImageCache")).unwrap();
    let scan = scan_legacy_root(&root);
    assert!(scan.found);
    assert_eq!(scan.global.get("LoginRememberMe").map(String::as_str), Some("1"));
    assert_eq!(scan.global.get("ApplicationLanguage").map(String::as_str), Some("de"));
    assert!(scan.profiles.is_empty());
    assert!(scan.skipped.iter().any(|line| line.contains("ServerUrl could not be decrypted")));
  }

  #[cfg(windows)]
  #[test]
  fn dpapi_round_trip() {
    use base64::Engine as _;
    let protected = dpapi::protect("https://games.example.com".as_bytes()).unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(protected);
    assert_eq!(decrypt_preference(&encoded).as_deref(), Some("https://games.example.com"));
    assert_eq!(decrypt_preference("bm90LWRwYXBp"), None);
  }

  /// Fixture produced by .NET `ProtectedData.Protect(UTF8(value), null,
  /// CurrentUser)`, exactly like the WPF client. Generated at test time
  /// because DPAPI blobs only decrypt for the user who created them.
  #[cfg(windows)]
  #[test]
  fn decrypts_values_protected_by_dotnet() {
    let script = "Add-Type -AssemblyName System.Security; \
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('Grüße=ok'); \
      [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser'))";
    let Ok(output) = std::process::Command::new("powershell.exe")
      .args(["-NoProfile", "-NonInteractive", "-Command", script])
      .output()
    else {
      eprintln!("powershell.exe unavailable; skipping");
      return;
    };
    let encoded = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || encoded.is_empty() {
      eprintln!("ProtectedData unavailable; skipping");
      return;
    }
    assert_eq!(decrypt_preference(&encoded).as_deref(), Some("Grüße=ok"));
  }

  #[cfg(windows)]
  #[test]
  fn junctions_link_directories_in_place() {
    let scratch = ScratchDir::new("junction");
    let target = scratch.0.join("target dir");
    std::fs::create_dir_all(&target).unwrap();
    std::fs::write(target.join("file.txt"), "hello").unwrap();
    let link = scratch.0.join("link");
    link_directory(&target, &link).unwrap();
    assert_eq!(std::fs::read_to_string(link.join("file.txt")).unwrap(), "hello");
    std::fs::remove_dir(&link).unwrap();
    assert!(target.join("file.txt").is_file());
  }

  #[cfg(windows)]
  #[test]
  fn reparse_buffer_layout() {
    let target: Vec<u16> = "C:\\x".encode_utf16().collect();
    let buffer = junction::reparse_buffer(&target);
    // header 8 + offsets 8 + ("\??\C:\x" 8 units + NUL + "C:\x" 4 units + NUL) * 2
    assert_eq!(buffer.len(), 8 + 8 + (8 + 1 + 4 + 1) * 2);
    assert_eq!(u16::from_le_bytes([buffer[4], buffer[5]]) as usize, buffer.len() - 8);
  }
}
