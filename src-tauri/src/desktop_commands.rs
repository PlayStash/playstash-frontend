//! Desktop command dispatch.
//!
//! Rust resolves CLI arguments, `playstash://` deep links, pipe messages,
//! jump-list entries and tray menu items into a [`CommandOptions`]. Whatever
//! Rust can do itself (show the window, exit, answer queries) happens here;
//! everything that needs the UI is emitted to the frontend as the
//! `desktop-command` event.
//!
//! Commands are queued until the frontend calls `desktop_commands_ready`
//! (after the auth bootstrap and once the router is mounted). The first
//! instance's own startup arguments go through the same queue.

use crate::cli::{Action, CommandOptions, ParsedArgs};
use crate::events::InstalledGameInfo;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Event that carries a [`DesktopCommand`] to the frontend.
pub(crate) const DESKTOP_COMMAND_EVENT: &str = "desktop-command";

/// Event that asks the frontend to confirm exiting while downloads run.
pub(crate) const DESKTOP_EXIT_REQUESTED_EVENT: &str = "desktop-exit-requested";

/// Jump-list command that exits the app.
const JUMP_LIST_EXIT: i32 = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DesktopCommandAction {
  Show,
  Install,
  Uninstall,
  Start,
}

/// Payload of the `desktop-command` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopCommand {
  pub id: String,
  pub action: DesktopCommandAction,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub game_id: Option<i64>,
  /// Version to install (web "Download in desktop app" links).
  #[serde(skip_serializing_if = "Option::is_none")]
  pub version_id: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub jump_list_command: Option<i32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub auto_install: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub confirm: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub minimized: Option<bool>,
  /// Whether the game is installed in one of the configured roots (only set
  /// when the command has a game id).
  #[serde(skip_serializing_if = "Option::is_none")]
  pub installed: Option<bool>,
}

// ── Ready gate ────────────────────────────────────────────────────────────

#[derive(Default)]
struct Gate {
  ready: bool,
  queue: VecDeque<CommandOptions>,
}

static GATE: OnceLock<(Mutex<Gate>, Condvar)> = OnceLock::new();

fn gate() -> &'static (Mutex<Gate>, Condvar) {
  GATE.get_or_init(|| (Mutex::new(Gate::default()), Condvar::new()))
}

/// Blocks until the frontend is ready for commands, at most `timeout`.
/// Pipe connections wait here before they are answered (like the WPF client).
pub(crate) fn wait_until_ready(timeout: Duration) -> bool {
  let (lock, condvar) = gate();
  let Ok(guard) = lock.lock() else {
    return false;
  };
  condvar
    .wait_timeout_while(guard, timeout, |gate| !gate.ready)
    .map(|(guard, _)| guard.ready)
    .unwrap_or(false)
}

// ── Startup command ───────────────────────────────────────────────────────

static STARTUP: OnceLock<Mutex<Option<ParsedArgs>>> = OnceLock::new();

/// Stores the arguments this (first) instance was started with.
pub(crate) fn set_startup_command(parsed: ParsedArgs) {
  let store = STARTUP.get_or_init(|| Mutex::new(None));
  if let Ok(mut startup) = store.lock() {
    *startup = Some(parsed);
  }
}

/// The startup command, parsed from the process arguments when the CLI
/// pre-dispatch did not run.
pub(crate) fn startup_command() -> ParsedArgs {
  let stored = STARTUP
    .get()
    .and_then(|store| store.lock().ok().and_then(|startup| startup.clone()));
  stored.unwrap_or_else(|| {
    let args: Vec<String> = std::env::args().skip(1).collect();
    crate::cli::parse_args(&args).unwrap_or(ParsedArgs {
      options: CommandOptions::show(),
      invalid_action: None,
    })
  })
}

// ── Desktop context pushed by the frontend ───────────────────────────────

/// What Rust needs to know about the frontend session to answer queries and
/// to decide whether a game is installed.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct DesktopContext {
  pub roots: Vec<String>,
  pub server_url: String,
  pub user_id: Option<i64>,
  pub access_token: Option<String>,
  /// Online and authenticated (not in offline mode).
  pub logged_in: bool,
}

static CONTEXT: OnceLock<Mutex<DesktopContext>> = OnceLock::new();

fn context_store() -> &'static Mutex<DesktopContext> {
  CONTEXT.get_or_init(|| Mutex::new(DesktopContext::default()))
}

/// Snapshot of the desktop context. The install roots fall back to the
/// time tracker configuration when the frontend has not pushed any yet.
pub(crate) fn context() -> DesktopContext {
  let mut context = context_store().lock().map(|context| context.clone()).unwrap_or_default();
  if context.roots.is_empty() {
    if let Ok(tracker) = crate::state::tracker_config().lock() {
      if let Some(tracker) = tracker.as_ref() {
        context.roots = tracker.download_paths.clone();
        if context.server_url.is_empty() {
          context.server_url = tracker.server_url.clone();
        }
      }
    }
  }
  context
}

/// Stores the session details Rust needs for the query API and for the
/// "is this game installed" checks.
#[tauri::command]
pub(crate) async fn set_desktop_context(context: DesktopContext) -> Result<(), String> {
  let mut current = context_store().lock().map_err(|_| "Desktop context lock poisoned".to_string())?;
  *current = context;
  Ok(())
}

// ── Installed games ───────────────────────────────────────────────────────

/// Every installed game version over the configured roots.
pub(crate) fn installed_games(roots: &[String]) -> Vec<InstalledGameInfo> {
  let mut seen = std::collections::HashSet::new();
  let mut games = Vec::new();
  for root in roots.iter().filter(|root| !root.trim().is_empty()) {
    let Ok(found) = crate::games::list_installed_games_blocking(root.clone()) else {
      continue;
    };
    for game in found {
      if game.game_id > 0 && seen.insert((game.game_id, game.version_directory.clone())) {
        games.push(game);
      }
    }
  }
  games
}

/// The newest installed version of a game.
pub(crate) fn find_installed(roots: &[String], game_id: i64) -> Option<InstalledGameInfo> {
  installed_games(roots)
    .into_iter()
    .filter(|game| game.game_id == game_id)
    .max_by_key(|game| game.installed_at)
}

// ── Dispatch ──────────────────────────────────────────────────────────────

/// What Rust does for a command before handing it to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Plan {
  pub show_window: bool,
  pub emit: Option<DesktopCommandAction>,
}

/// The WPF `HandleCommand` decision table. An explicit `minimized` value
/// overrides whether the window is shown.
pub(crate) fn plan(options: &CommandOptions, installed: bool) -> Plan {
  let has_game = options.game_id.is_some();
  let (show_window, emit) = match options.action {
    Action::Show => {
      let emit = (has_game || options.jump_list_command.is_some()).then_some(DesktopCommandAction::Show);
      (true, emit)
    }
    Action::Install => (has_game, has_game.then_some(DesktopCommandAction::Install)),
    Action::Uninstall => (has_game, has_game.then_some(DesktopCommandAction::Uninstall)),
    // An installed game starts without showing the window.
    Action::Start => (has_game && !installed, has_game.then_some(DesktopCommandAction::Start)),
    Action::Stop | Action::Query => (false, None),
  };
  let show_window = match options.minimized {
    Some(minimized) => !minimized,
    None => show_window,
  };
  Plan { show_window, emit }
}

static COMMAND_ID: AtomicU64 = AtomicU64::new(1);

/// Hands a command to the dispatcher. Commands that need the frontend are
/// queued until it is ready.
pub(crate) fn submit(app: &AppHandle, options: CommandOptions) {
  match options.action {
    Action::Query => {
      // Queries are answered over the pipe; a query at cold start has nobody
      // to answer to.
      log::info!("[desktop-command] ignoring a query without a pipe client");
      return;
    }
    Action::Stop => {
      log::info!("[desktop-command] stop is not supported");
      return;
    }
    _ => {}
  }

  // Exit from the jump list must work even before login.
  if options.action == Action::Show && options.jump_list_command == Some(JUMP_LIST_EXIT) {
    request_exit(app);
    return;
  }

  let run_now = {
    let Ok(mut gate) = gate().0.lock() else {
      return;
    };
    if gate.ready {
      true
    } else {
      gate.queue.push_back(options.clone());
      false
    }
  };
  if run_now {
    process(app.clone(), options);
  }
}

fn process(app: AppHandle, options: CommandOptions) {
  tauri::async_runtime::spawn(async move {
    let installed = match options.game_id {
      Some(game_id) => {
        let roots = context().roots;
        tauri::async_runtime::spawn_blocking(move || find_installed(&roots, game_id).is_some())
          .await
          .unwrap_or(false)
      }
      None => false,
    };

    let plan = plan(&options, installed);
    if plan.show_window {
      reveal_main_window(&app);
    }
    let Some(action) = plan.emit else {
      return;
    };
    let command = DesktopCommand {
      id: format!("cmd-{}", COMMAND_ID.fetch_add(1, Ordering::Relaxed)),
      action,
      game_id: options.game_id,
      version_id: options.version_id,
      jump_list_command: options.jump_list_command,
      auto_install: options.auto_install,
      confirm: options.confirm,
      minimized: options.minimized,
      installed: options.game_id.map(|_| installed),
    };
    log::info!("[desktop-command] {} {:?} game={:?}", command.id, command.action, command.game_id);
    if let Err(error) = app.emit(DESKTOP_COMMAND_EVENT, &command) {
      log::warn!("[desktop-command] failed to emit {}: {error}", command.id);
    }
  });
}

/// Shows, restores and focuses the main window.
pub(crate) fn reveal_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

/// Shows the native "Invalid action: X" error.
pub(crate) fn show_invalid_action(app: &AppHandle, action: &str) {
  use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
  app
    .dialog()
    .message(format!("Invalid action: {action}"))
    .title("Error")
    .kind(MessageDialogKind::Error)
    .show(|_| {});
}

/// Ready gate: the frontend can now receive `desktop-command` events. Runs
/// every queued command.
#[tauri::command]
pub(crate) async fn desktop_commands_ready(app: AppHandle) -> Result<(), String> {
  let queued: Vec<CommandOptions> = {
    let (lock, condvar) = gate();
    let mut gate = lock.lock().map_err(|_| "Command gate lock poisoned".to_string())?;
    gate.ready = true;
    condvar.notify_all();
    gate.queue.drain(..).collect()
  };
  for options in queued {
    process(app.clone(), options);
  }
  Ok(())
}

/// Closes the ready gate again (logout, profile switch). Commands queue
/// until the next `desktop_commands_ready`.
#[tauri::command]
pub(crate) async fn desktop_commands_not_ready() -> Result<(), String> {
  let mut gate = gate().0.lock().map_err(|_| "Command gate lock poisoned".to_string())?;
  gate.ready = false;
  Ok(())
}

/// The frontend finished a desktop command (logged for diagnostics).
#[tauri::command]
pub(crate) async fn desktop_command_done(id: String, ok: bool, message: Option<String>) -> Result<(), String> {
  if ok {
    log::info!("[desktop-command] {id} done");
  } else {
    log::warn!("[desktop-command] {id} failed: {}", message.unwrap_or_default());
  }
  Ok(())
}

/// Shows, restores and focuses the main window.
#[tauri::command]
pub(crate) async fn show_main_window(app: AppHandle) -> Result<(), String> {
  reveal_main_window(&app);
  Ok(())
}

// ── Exit ──────────────────────────────────────────────────────────────────

static FRONTEND_ATTACHED: AtomicBool = AtomicBool::new(false);

/// The frontend listens for `desktop-exit-requested` from now on.
#[tauri::command]
pub(crate) async fn desktop_frontend_attached() -> Result<(), String> {
  FRONTEND_ATTACHED.store(true, Ordering::Relaxed);
  Ok(())
}

/// Whether any download is still transferring data.
pub(crate) fn has_running_downloads() -> bool {
  crate::state::control_flags()
    .lock()
    .map(|flags| {
      flags
        .values()
        .any(|flag| flag.load(Ordering::Relaxed) == crate::state::DOWNLOAD_CONTROL_RUNNING)
    })
    .unwrap_or(false)
}

/// Whether a download is running (answers the exit confirmation check).
#[tauri::command]
pub(crate) async fn has_active_downloads() -> Result<bool, String> {
  Ok(has_running_downloads())
}

/// Exits right away when no download is running. Otherwise shows the window
/// and asks first: in the frontend (which then cancels the downloads and
/// calls `exit_app`), or natively when the frontend is not attached.
pub(crate) fn request_exit(app: &AppHandle) {
  if !has_running_downloads() {
    exit(app);
    return;
  }
  reveal_main_window(app);
  if FRONTEND_ATTACHED.load(Ordering::Relaxed) && app.emit(DESKTOP_EXIT_REQUESTED_EVENT, ()).is_ok() {
    return;
  }

  use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
  let handle = app.clone();
  app
    .dialog()
    .message(crate::tray::labels().exit_confirm)
    .title("PlayStash")
    .buttons(MessageDialogButtons::YesNo)
    .show(move |yes| {
      if yes {
        cancel_running_downloads();
        exit(&handle);
      }
    });
}

fn cancel_running_downloads() {
  if let Ok(flags) = crate::state::control_flags().lock() {
    for flag in flags.values() {
      flag.store(crate::state::DOWNLOAD_CONTROL_CANCEL, Ordering::Relaxed);
    }
  }
}

/// Kills tracked child processes and exits.
pub(crate) fn exit(app: &AppHandle) {
  crate::children::kill_all();
  app.exit(0);
}

/// Exits the app (after the frontend confirmed and cancelled downloads).
#[tauri::command]
pub(crate) async fn exit_app(app: AppHandle) -> Result<(), String> {
  exit(&app);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::cli::parse_args;

  fn options(args: &[&str]) -> CommandOptions {
    parse_args(args).unwrap().options
  }

  #[test]
  fn show_plans() {
    let plain = plan(&CommandOptions::show(), false);
    assert_eq!(plain, Plan { show_window: true, emit: None });
    let page = plan(&options(&["show", "--jumplistcommand=2"]), false);
    assert_eq!(page.emit, Some(DesktopCommandAction::Show));
    let game = plan(&options(&["show", "--gameid=4"]), false);
    assert_eq!(game, Plan { show_window: true, emit: Some(DesktopCommandAction::Show) });
    let hidden = plan(&options(&["show", "--minimized=true"]), false);
    assert!(!hidden.show_window);
  }

  #[test]
  fn start_plans() {
    let installed = plan(&options(&["start", "--gameid=5"]), true);
    assert_eq!(installed, Plan { show_window: false, emit: Some(DesktopCommandAction::Start) });
    let missing = plan(&options(&["start", "--gameid=5"]), false);
    assert_eq!(missing, Plan { show_window: true, emit: Some(DesktopCommandAction::Start) });
    let shown = plan(&options(&["start", "--gameid=5", "--minimized=false"]), true);
    assert!(shown.show_window);
  }

  #[test]
  fn install_uninstall_stop_and_query_plans() {
    let install = plan(&options(&["install", "--gameid=5"]), false);
    assert_eq!(install, Plan { show_window: true, emit: Some(DesktopCommandAction::Install) });
    let background = plan(&options(&["playstash://install?gameid=5&minimized=true"]), false);
    assert_eq!(background, Plan { show_window: false, emit: Some(DesktopCommandAction::Install) });
    let uninstall = plan(&options(&["uninstall", "--gameid=5"]), true);
    assert_eq!(uninstall.emit, Some(DesktopCommandAction::Uninstall));
    let no_game = plan(&options(&["--action", "install"]), false);
    assert_eq!(no_game, Plan { show_window: false, emit: None });
    let stop = plan(&options(&["--action", "stop", "--gameid=5"]), true);
    assert_eq!(stop, Plan { show_window: false, emit: None });
    let query = plan(&options(&["--action", "query"]), true);
    assert_eq!(query.emit, None);
  }

  #[test]
  fn command_payload_is_camel_case() {
    let command = DesktopCommand {
      id: "cmd-1".into(),
      action: DesktopCommandAction::Start,
      game_id: Some(5),
      version_id: None,
      jump_list_command: None,
      auto_install: Some(true),
      confirm: None,
      minimized: None,
      installed: Some(false),
    };
    let json = serde_json::to_value(&command).unwrap();
    assert_eq!(
      json,
      serde_json::json!({"id": "cmd-1", "action": "start", "gameId": 5, "autoInstall": true, "installed": false})
    );
  }
}
