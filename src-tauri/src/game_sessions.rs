//! Game session and exit events.
//!
//! - `game-session` is emitted by the time tracker when a game starts or stops
//!   being matched (`state: "started" | "ended"`). It follows the game across
//!   launcher hand-offs, so it is the event to use for "the game really quit".
//! - `game-exited` is emitted by the launch monitors when the process that
//!   PlayStash started exits (which can be a launcher that handed off).
//!
//! `get_active_game_sessions` lists the games the tracker currently sees
//! running (matched or within the grace window).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

pub(crate) const GAME_SESSION_EVENT: &str = "game-session";
pub(crate) const GAME_EXITED_EVENT: &str = "game-exited";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GameSessionState {
  Started,
  Ended,
}

/// Payload of the `game-session` event.
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

/// Identifies the game a launch monitor watches, so its exit can be reported.
#[derive(Debug, Clone, Default)]
pub(crate) struct LaunchIdentity {
  pub game_id: Option<i64>,
  pub version_directory: Option<String>,
  pub installation_path: String,
}

impl LaunchIdentity {
  /// Builds the `game-exited` payload, or `None` when the launch carries no
  /// game id (nothing to attribute the exit to).
  pub(crate) fn exited_event(
    &self,
    exit_code: Option<i32>,
    ran_ms: u64,
    launched_running: bool,
  ) -> Option<GameExitedEvent> {
    let game_id = self.game_id.filter(|id| *id > 0)?;
    Some(GameExitedEvent {
      game_id,
      version_directory: self.version_directory.clone().unwrap_or_default(),
      installation_path: self.installation_path.clone(),
      exit_code,
      ran_ms,
      launched_running,
    })
  }
}

/// Emits `game-exited` for a monitored launch. Never fails the caller.
pub(crate) fn emit_game_exited(
  app: &tauri::AppHandle,
  identity: &LaunchIdentity,
  exit_code: Option<i32>,
  ran_ms: u64,
  launched_running: bool,
) {
  if let Some(event) = identity.exited_event(exit_code, ran_ms, launched_running) {
    let _ = app.emit(GAME_EXITED_EVENT, event);
  }
}

/// A session that is running right now, plus the minute counter it started at.
#[derive(Debug, Clone)]
struct OpenSession {
  version_directory: String,
  started_at: u64,
  baseline_minutes: u64,
}

static OPEN_SESSIONS: OnceLock<Mutex<HashMap<i64, OpenSession>>> = OnceLock::new();

fn open_sessions() -> &'static Mutex<HashMap<i64, OpenSession>> {
  OPEN_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Records a started session. `baseline_minutes` is the ledger's
/// credited + offline minute count when the session started.
pub(crate) fn record_session_started(
  game_id: i64,
  version_directory: &str,
  started_at: u64,
  baseline_minutes: u64,
) {
  if let Ok(mut sessions) = open_sessions().lock() {
    sessions.insert(
      game_id,
      OpenSession {
        version_directory: version_directory.to_string(),
        started_at,
        baseline_minutes,
      },
    );
  }
}

/// Removes a session and returns its version directory and the minutes it
/// credited, given the ledger's current credited + offline minute count.
pub(crate) fn record_session_ended(game_id: i64, total_minutes: u64) -> (String, u64) {
  let session = open_sessions()
    .lock()
    .ok()
    .and_then(|mut sessions| sessions.remove(&game_id));
  match session {
    Some(session) => (
      session.version_directory,
      total_minutes.saturating_sub(session.baseline_minutes),
    ),
    None => (String::new(), 0),
  }
}

/// Forgets every open session (the tracker restarted and reset its ledger).
pub(crate) fn clear_sessions() {
  if let Ok(mut sessions) = open_sessions().lock() {
    sessions.clear();
  }
}

/// Emits `game-session` on a separate task so the caller never blocks on it
/// (the tracker calls this right after releasing the ledger lock).
pub(crate) fn spawn_emit_game_session(app: &tauri::AppHandle, event: GameSessionEvent) {
  let app = app.clone();
  tauri::async_runtime::spawn(async move {
    let _ = app.emit(GAME_SESSION_EVENT, event);
  });
}

/// Open sessions whose game the ledger still sees as matched (or in grace),
/// earliest start first.
fn active_sessions(matched: &dyn Fn(i64) -> bool) -> Vec<ActiveGameSession> {
  let mut list: Vec<ActiveGameSession> = open_sessions()
    .lock()
    .map(|sessions| {
      sessions
        .iter()
        .filter(|(game_id, _)| matched(**game_id))
        .map(|(game_id, session)| ActiveGameSession {
          game_id: *game_id,
          version_directory: session.version_directory.clone(),
          started_at: session.started_at,
        })
        .collect()
    })
    .unwrap_or_default();
  list.sort_by_key(|session| (session.started_at, session.game_id));
  list
}

/// Games the tracker currently sees running (matched or in the grace window).
#[tauri::command]
pub(crate) async fn get_active_game_sessions(
  _app: tauri::AppHandle,
) -> Result<Vec<ActiveGameSession>, String> {
  let matched: HashMap<i64, bool> = crate::state::tracker_ledger_snapshot()
    .into_iter()
    .map(|entry| (entry.game_id, entry.matched))
    .collect();
  Ok(active_sessions(&|game_id| {
    matched.get(&game_id).copied().unwrap_or(false)
  }))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn exit_event_requires_a_game_id() {
    let identity = LaunchIdentity {
      game_id: None,
      version_directory: Some("/v".to_string()),
      installation_path: "/v/Installation".to_string(),
    };
    assert!(identity.exited_event(Some(0), 10, true).is_none());

    let identity = LaunchIdentity {
      game_id: Some(7),
      ..identity
    };
    let event = identity.exited_event(Some(1), 1500, false).unwrap();
    assert_eq!(event.game_id, 7);
    assert_eq!(event.version_directory, "/v");
    assert_eq!(event.exit_code, Some(1));
    assert_eq!(event.ran_ms, 1500);
    assert!(!event.launched_running);
  }

  #[test]
  fn sessions_report_their_credited_minutes() {
    record_session_started(900_101, "/games/a", 1_000, 5);
    let active = active_sessions(&|id| id == 900_101);
    assert!(active.iter().any(|session| session.game_id == 900_101
      && session.version_directory == "/games/a"
      && session.started_at == 1_000));

    let (version_directory, minutes) = record_session_ended(900_101, 12);
    assert_eq!(version_directory, "/games/a");
    assert_eq!(minutes, 7);
    assert!(!active_sessions(&|_| true)
      .iter()
      .any(|session| session.game_id == 900_101));
  }

  #[test]
  fn unmatched_sessions_are_not_active() {
    record_session_started(900_102, "/games/b", 2_000, 0);
    assert!(!active_sessions(&|id| id != 900_102)
      .iter()
      .any(|session| session.game_id == 900_102));
    record_session_ended(900_102, 0);
  }

  #[test]
  fn session_payload_is_camel_case() {
    let json = serde_json::to_value(GameSessionEvent {
      game_id: 3,
      version_directory: "/v".to_string(),
      state: GameSessionState::Ended,
      minutes: Some(4),
    })
    .unwrap();
    assert_eq!(json["gameId"], 3);
    assert_eq!(json["versionDirectory"], "/v");
    assert_eq!(json["state"], "ended");
    assert_eq!(json["minutes"], 4);
  }
}
