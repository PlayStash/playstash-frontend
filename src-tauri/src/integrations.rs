//! Settings of the "Integrations" category (Steam and Discord), stored in the
//! settings section `integrations.json`.

use crate::settings;
use serde::{Deserialize, Serialize};

const SECTION: &str = "integrations";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct IntegrationsSettings {
  /// Discord application (client) id; empty means the
  /// `PLAYSTASH_DISCORD_APPLICATION_ID` environment variable is used.
  pub discord_application_id: String,
  pub sync_discord_presence: bool,
  pub sync_steam_shortcuts: bool,
}

/// Partial update: only the fields that are set change.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct IntegrationsSettingsPatch {
  pub discord_application_id: Option<String>,
  pub sync_discord_presence: Option<bool>,
  pub sync_steam_shortcuts: Option<bool>,
}

fn apply_patch(settings: &mut IntegrationsSettings, patch: IntegrationsSettingsPatch) {
  if let Some(id) = patch.discord_application_id {
    // Application ids are numeric snowflakes; keep the field short.
    settings.discord_application_id = id.trim().chars().take(32).collect();
  }
  if let Some(enabled) = patch.sync_discord_presence {
    settings.sync_discord_presence = enabled;
  }
  if let Some(enabled) = patch.sync_steam_shortcuts {
    settings.sync_steam_shortcuts = enabled;
  }
}

#[tauri::command]
pub(crate) async fn get_integrations_settings(app: tauri::AppHandle) -> IntegrationsSettings {
  settings::load_section(&app, SECTION)
}

#[tauri::command]
pub(crate) async fn set_integrations_settings(
  app: tauri::AppHandle,
  patch: IntegrationsSettingsPatch,
) -> Result<IntegrationsSettings, String> {
  settings::update_section(&app, SECTION, |current: &mut IntegrationsSettings| apply_patch(current, patch))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn patch_changes_only_given_fields() {
    let mut settings = IntegrationsSettings {
      discord_application_id: "1".into(),
      sync_discord_presence: true,
      sync_steam_shortcuts: false,
    };
    apply_patch(
      &mut settings,
      IntegrationsSettingsPatch { sync_steam_shortcuts: Some(true), ..Default::default() },
    );
    assert_eq!(settings.discord_application_id, "1");
    assert!(settings.sync_discord_presence);
    assert!(settings.sync_steam_shortcuts);
    apply_patch(
      &mut settings,
      IntegrationsSettingsPatch { discord_application_id: Some(" 42 ".into()), ..Default::default() },
    );
    assert_eq!(settings.discord_application_id, "42");
  }

  #[test]
  fn missing_fields_default_to_off() {
    let parsed: IntegrationsSettings = serde_json::from_str("{\"syncSteamShortcuts\":true}").unwrap();
    assert!(parsed.sync_steam_shortcuts);
    assert!(!parsed.sync_discord_presence);
    assert_eq!(parsed.discord_application_id, "");
  }
}
