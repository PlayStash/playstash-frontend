//! Discord Rich Presence over the local Discord IPC socket/pipe.
//!
//! One background worker owns the single IPC client, so a Discord client that
//! does not answer can never block a Tauri command. The frontend only sends
//! the desired state (`discord_set_presence` / `discord_clear_presence`); the
//! worker connects lazily, recreates the client when the application id
//! changes, retries a failed presence every 30 s (for example when Discord is
//! started after the game) and logs errors instead of surfacing them.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const ENV_APPLICATION_ID: &str = "PLAYSTASH_DISCORD_APPLICATION_ID";
const BUTTON_LABEL: &str = "What's PlayStash?";
const BUTTON_URL: &str = "https://github.com/PlayStash/playstash-app#readme";
const RETRY_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Presence {
  pub app_id: String,
  pub details: String,
  pub started_at_unix: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Desired {
  Presence(Presence),
  Clear,
}

/// The application id to use: the setting, else the environment variable. It
/// must parse as a `u64` snowflake, otherwise presence is disabled.
pub(crate) fn resolve_application_id(setting: &str, env: Option<String>) -> Option<String> {
  let setting = setting.trim();
  let candidate = if setting.is_empty() {
    env.map(|value| value.trim().to_string()).unwrap_or_default()
  } else {
    setting.to_string()
  };
  candidate.parse::<u64>().ok().map(|_| candidate)
}

fn sender() -> &'static Mutex<Sender<Desired>> {
  static SENDER: OnceLock<Mutex<Sender<Desired>>> = OnceLock::new();
  SENDER.get_or_init(|| {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
      .name("discord-presence".into())
      .spawn(move || worker(rx))
      .map_err(|error| log::warn!("[discord] Failed to start the presence worker: {error}"))
      .ok();
    Mutex::new(tx)
  })
}

fn send(desired: Desired) {
  if let Ok(tx) = sender().lock() {
    let _ = tx.send(desired);
  }
}

struct Connection {
  app_id: String,
  client: DiscordIpcClient,
}

fn connect(app_id: &str) -> Result<Connection, String> {
  let mut client = DiscordIpcClient::new(app_id).map_err(|error| error.to_string())?;
  client.connect().map_err(|error| error.to_string())?;
  Ok(Connection { app_id: app_id.to_string(), client })
}

/// Reads Discord's reply to the last command so the pipe never fills up, and
/// turns an `ERROR` event into an error.
fn read_reply(client: &mut DiscordIpcClient) -> Result<(), String> {
  let (_, reply) = client.recv().map_err(|error| error.to_string())?;
  if reply.get("evt").and_then(|value| value.as_str()) == Some("ERROR") {
    let message = reply
      .pointer("/data/message")
      .and_then(|value| value.as_str())
      .unwrap_or("Discord rejected the presence");
    return Err(message.to_string());
  }
  Ok(())
}

fn apply(connection: &mut Option<Connection>, desired: &Desired) -> Result<(), String> {
  match desired {
    Desired::Clear => {
      // Nothing to clear without a live connection: Discord drops the
      // presence by itself when the IPC connection goes away.
      if let Some(current) = connection.as_mut() {
        current.client.clear_activity().map_err(|error| error.to_string())?;
        read_reply(&mut current.client)?;
      }
      Ok(())
    }
    Desired::Presence(presence) => {
      if connection.as_ref().is_some_and(|current| current.app_id != presence.app_id) {
        if let Some(mut previous) = connection.take() {
          let _ = previous.client.close();
        }
      }
      if connection.is_none() {
        *connection = Some(connect(&presence.app_id)?);
      }
      let current = connection.as_mut().expect("connected above");
      let mut payload = activity::Activity::new()
        .details(&presence.details)
        .buttons(vec![activity::Button::new(BUTTON_LABEL, BUTTON_URL)]);
      if let Some(start) = presence.started_at_unix {
        payload = payload.timestamps(activity::Timestamps::new().start(start));
      }
      current.client.set_activity(payload).map_err(|error| error.to_string())?;
      read_reply(&mut current.client)
    }
  }
}

fn worker(rx: Receiver<Desired>) {
  let mut connection: Option<Connection> = None;
  let mut pending: Option<Desired> = None;
  loop {
    let next = if pending.is_some() {
      match rx.recv_timeout(RETRY_INTERVAL) {
        Ok(desired) => Some(desired),
        Err(RecvTimeoutError::Timeout) => None,
        Err(RecvTimeoutError::Disconnected) => return,
      }
    } else {
      match rx.recv() {
        Ok(desired) => Some(desired),
        Err(_) => return,
      }
    };
    let mut desired = match next {
      Some(desired) => desired,
      None => pending.take().expect("retrying a pending presence"),
    };
    // Only the latest state matters.
    while let Ok(newer) = rx.try_recv() {
      desired = newer;
    }
    pending = None;
    if let Err(error) = apply(&mut connection, &desired) {
      log::warn!("[discord] Rich presence update failed: {error}");
      if let Some(mut broken) = connection.take() {
        let _ = broken.client.close();
      }
      if matches!(desired, Desired::Presence(_)) {
        pending = Some(desired);
      }
    }
  }
}

/// Shows `details` (the game title) as the current Discord activity. Does
/// nothing when no valid application id is configured.
#[tauri::command]
pub(crate) async fn discord_set_presence(
  app_id: Option<String>,
  details: String,
  started_at_unix: Option<i64>,
) -> Result<bool, String> {
  let Some(app_id) = resolve_application_id(app_id.as_deref().unwrap_or(""), std::env::var(ENV_APPLICATION_ID).ok())
  else {
    send(Desired::Clear);
    return Ok(false);
  };
  let details = details.trim();
  if details.is_empty() {
    send(Desired::Clear);
    return Ok(false);
  }
  // Discord limits `details` to 128 characters.
  let details: String = details.chars().take(128).collect();
  send(Desired::Presence(Presence { app_id, details, started_at_unix }));
  Ok(true)
}

/// Clears the Discord activity.
#[tauri::command]
pub(crate) async fn discord_clear_presence() -> Result<(), String> {
  send(Desired::Clear);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn application_id_prefers_the_setting_and_requires_a_number() {
    assert_eq!(resolve_application_id(" 123 ", Some("456".into())), Some("123".into()));
    assert_eq!(resolve_application_id("", Some("456".into())), Some("456".into()));
    assert_eq!(resolve_application_id("", None), None);
    assert_eq!(resolve_application_id("abc", Some("456".into())), None);
    assert_eq!(resolve_application_id("", Some("-1".into())), None);
    assert_eq!(resolve_application_id("18446744073709551615", None), Some("18446744073709551615".into()));
    assert_eq!(resolve_application_id("18446744073709551616", None), None);
  }
}
