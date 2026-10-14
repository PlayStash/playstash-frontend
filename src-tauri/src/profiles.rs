//! Login profiles (several servers and accounts), the WPF `ProfileManager`
//! equivalent.
//!
//! The list lives in `<app_data_dir>/profiles.json` together with the global
//! login options (remember me, last profile). Secrets are not stored here:
//! each profile's refresh token is kept in the Stronghold vault under
//! `refresh_token:<profileId>` by the frontend. Per-profile files (cloud-save
//! config, themes) live in `<app_data_dir>/profiles/<profileId>/`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const PROFILES_FILE: &str = "profiles.json";
const MAX_PROFILES: usize = 256;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Profile {
  pub id: String,
  pub server_url: String,
  pub username: String,
  pub display_name: Option<String>,
  pub avatar_media_id: Option<i64>,
  pub sso: bool,
  pub user_id: Option<i64>,
  pub created_at: i64,
  pub last_used_at: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct ProfilesState {
  pub profiles: Vec<Profile>,
  /// WPF `LoginRememberMe`: log into `last_profile_id` at startup.
  pub remember_me: bool,
  /// WPF `LastUserProfile`.
  pub last_profile_id: Option<String>,
  /// The pre-profile single session (`app_refresh_token`) was moved into a profile.
  pub legacy_session_migrated: bool,
  /// The "import from the previous PlayStash client" question was answered.
  pub legacy_import_offered: bool,
}

fn file_lock() -> &'static Mutex<()> {
  static LOCK: Mutex<()> = Mutex::new(());
  &LOCK
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app.path().app_data_dir().map_err(|error| format!("Failed to resolve app data dir: {error}"))
}

/// Profile ids are generated UUIDs; anything else is rejected so an id can
/// safely name a directory.
pub(crate) fn is_valid_profile_id(id: &str) -> bool {
  !id.is_empty() && id.len() <= 64 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// Validates and normalises a state received from the frontend.
pub(crate) fn validate_state(mut state: ProfilesState) -> Result<ProfilesState, String> {
  if state.profiles.len() > MAX_PROFILES {
    return Err("Too many profiles.".into());
  }
  let mut seen = std::collections::HashSet::new();
  for profile in &mut state.profiles {
    if !is_valid_profile_id(&profile.id) || !seen.insert(profile.id.clone()) {
      return Err("Invalid or duplicate profile id.".into());
    }
    let server = crate::net::parse_server_url(&profile.server_url)?;
    profile.server_url = server.as_str().trim_end_matches('/').to_string();
    profile.username = profile.username.trim().to_string();
    if profile.username.chars().count() > 320 {
      return Err("The username is too long.".into());
    }
    if let Some(name) = &profile.display_name {
      if name.chars().count() > 320 {
        profile.display_name = None;
      }
    }
  }
  if let Some(last) = &state.last_profile_id {
    if !state.profiles.iter().any(|profile| &profile.id == last) {
      state.last_profile_id = None;
    }
  }
  Ok(state)
}

fn read_state(path: &Path) -> ProfilesState {
  std::fs::read_to_string(path)
    .ok()
    .and_then(|data| serde_json::from_str::<ProfilesState>(&data).ok())
    .and_then(|state| validate_state(state).ok())
    .unwrap_or_default()
}

fn write_state(path: &Path, state: &ProfilesState) -> Result<(), String> {
  let dir = path.parent().ok_or("Invalid profiles path.")?;
  std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
  let data = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
  let temp = dir.join(format!(".{PROFILES_FILE}.{}.tmp", std::process::id()));
  std::fs::write(&temp, data).map_err(|error| format!("Failed to write profiles: {error}"))?;
  std::fs::rename(&temp, path).map_err(|error| {
    let _ = std::fs::remove_file(&temp);
    format!("Failed to write profiles: {error}")
  })
}

#[tauri::command]
pub(crate) async fn get_profiles_state(app: tauri::AppHandle) -> Result<ProfilesState, String> {
  let path = app_data_dir(&app)?.join(PROFILES_FILE);
  let _guard = file_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  Ok(read_state(&path))
}

#[tauri::command]
pub(crate) async fn save_profiles_state(app: tauri::AppHandle, state: ProfilesState) -> Result<ProfilesState, String> {
  let state = validate_state(state)?;
  let path = app_data_dir(&app)?.join(PROFILES_FILE);
  let _guard = file_lock().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  write_state(&path, &state)?;
  Ok(state)
}

/// `<app_data_dir>/profiles/<profileId>`: per-profile files such as the
/// cloud-save config (WP3) and custom themes (WP7).
pub(crate) fn profile_dir(app: &tauri::AppHandle, profile_id: &str) -> Result<PathBuf, String> {
  if !is_valid_profile_id(profile_id) {
    return Err("Invalid profile id.".into());
  }
  Ok(app_data_dir(app)?.join("profiles").join(profile_id))
}

#[tauri::command]
pub(crate) async fn get_profile_dir(app: tauri::AppHandle, profile_id: String) -> Result<String, String> {
  let dir = profile_dir(&app, &profile_id)?;
  std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir.to_string_lossy().to_string())
}

/// Removes a deleted profile's directory.
#[tauri::command]
pub(crate) async fn delete_profile_data(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
  let dir = profile_dir(&app, &profile_id)?;
  match std::fs::remove_dir_all(&dir) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
    Err(error) => Err(error.to_string()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn profile(id: &str, server: &str) -> Profile {
    Profile { id: id.into(), server_url: server.into(), username: " alice ".into(), ..Default::default() }
  }

  #[test]
  fn validates_ids_servers_and_last_profile() {
    let state = ProfilesState {
      profiles: vec![profile("a-1", "https://host/sub/")],
      last_profile_id: Some("missing".into()),
      ..Default::default()
    };
    let state = validate_state(state).unwrap();
    assert_eq!(state.profiles[0].server_url, "https://host/sub");
    assert_eq!(state.profiles[0].username, "alice");
    assert_eq!(state.last_profile_id, None);

    for bad_id in ["", "../x", "a/b", "a b"] {
      let state = ProfilesState { profiles: vec![profile(bad_id, "https://host")], ..Default::default() };
      assert!(validate_state(state).is_err(), "{bad_id}");
    }
    let duplicate = ProfilesState {
      profiles: vec![profile("x", "https://a"), profile("x", "https://b")],
      ..Default::default()
    };
    assert!(validate_state(duplicate).is_err());
    let bad_server = ProfilesState { profiles: vec![profile("x", "ftp://a")], ..Default::default() };
    assert!(validate_state(bad_server).is_err());
  }

  #[test]
  fn round_trips_the_state_file() {
    let dir = std::env::temp_dir().join(format!("playstash-profiles-{}", std::process::id()));
    let path = dir.join(PROFILES_FILE);
    let state = validate_state(ProfilesState {
      profiles: vec![profile("p1", "http://localhost:8080")],
      remember_me: true,
      last_profile_id: Some("p1".into()),
      ..Default::default()
    })
    .unwrap();
    write_state(&path, &state).unwrap();
    assert_eq!(read_state(&path), state);
    std::fs::write(&path, "not json").unwrap();
    assert_eq!(read_state(&path), ProfilesState::default());
    std::fs::remove_dir_all(dir).unwrap();
  }
}
