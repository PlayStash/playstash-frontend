//! Desktop command dispatch (WP1 contract stub from Step 0).
//!
//! Rust resolves CLI arguments, `playstash://` deep links, jump-list entries
//! and tray menu items into a [`DesktopCommand`] and emits it to the frontend
//! as the `desktop-command` event. Commands are queued until the frontend
//! calls `desktop_commands_ready` (after the auth bootstrap and once the
//! router is mounted). WP1 fills in the queue and the dispatch.

use serde::{Deserialize, Serialize};

/// Event that carries a [`DesktopCommand`] to the frontend.
#[allow(dead_code)] // Contract stub, filled by WP1.
pub(crate) const DESKTOP_COMMAND_EVENT: &str = "desktop-command";

#[allow(dead_code)] // Contract stub, filled by WP1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesktopCommandAction {
  Show,
  Install,
  Uninstall,
  Start,
}

/// Payload of the `desktop-command` event.
#[allow(dead_code)] // Contract stub, filled by WP1.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopCommand {
  pub id: String,
  pub action: DesktopCommandAction,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub game_id: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub jump_list_command: Option<i32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub auto_install: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub confirm: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub minimized: Option<bool>,
}

/// Ready gate: the frontend can now receive `desktop-command` events.
/// Stub: nothing is queued yet, so there is nothing to flush.
#[tauri::command]
pub(crate) async fn desktop_commands_ready(_app: tauri::AppHandle) -> Result<(), String> {
  Ok(())
}
