//! Game session and exit events (WP4 contract stub from Step 0).
//!
//! - `game-session` is emitted by the time tracker when a game starts or stops
//!   being matched (`state: "started" | "ended"`).
//! - `game-exited` is emitted by the launch monitors when a launched process
//!   exits.
//!
//! WP4 emits these events and fills `get_active_game_sessions` from the
//! tracker ledger.

use serde::{Deserialize, Serialize};

#[allow(dead_code)] // Contract stub, filled by WP4.
pub(crate) const GAME_SESSION_EVENT: &str = "game-session";
#[allow(dead_code)] // Contract stub, filled by WP4.
pub(crate) const GAME_EXITED_EVENT: &str = "game-exited";

#[allow(dead_code)] // Contract stub, filled by WP4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GameSessionState {
  Started,
  Ended,
}

/// Payload of the `game-session` event.
#[allow(dead_code)] // Contract stub, filled by WP4.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameSessionEvent {
  pub game_id: i64,
  pub version_directory: String,
  pub state: GameSessionState,
  /// Session minutes credited, set when the session ended.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub minutes: Option<u64>,
}

/// Payload of the `game-exited` event.
#[allow(dead_code)] // Contract stub, filled by WP4.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameExitedEvent {
  pub game_id: i64,
  pub version_directory: String,
  pub installation_path: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub exit_code: Option<i32>,
  pub ran_ms: u64,
  pub launched_running: bool,
}

/// One game the tracker currently sees running.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveGameSession {
  pub game_id: i64,
  pub version_directory: String,
  /// Unix epoch milliseconds.
  pub started_at: u64,
}

/// Games the tracker currently sees running. Stub: always empty.
#[tauri::command]
pub(crate) async fn get_active_game_sessions(
  _app: tauri::AppHandle,
) -> Result<Vec<ActiveGameSession>, String> {
  Ok(Vec::new())
}
