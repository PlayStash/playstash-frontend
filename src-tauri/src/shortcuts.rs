//! Desktop shortcuts that start a game through PlayStash (WP1 contract stub
//! from Step 0). WP1 creates a Windows `.url` / Linux `.desktop` file that
//! points at the `playstash://start?gameid=<id>` deep link.

const NOT_IMPLEMENTED: &str = "Desktop shortcuts are not implemented yet.";

/// Creates a desktop shortcut for a game. Returns `"created"`, or `"exists"`
/// when a shortcut with that title is already there. With `ask`, the frontend
/// has to confirm with the user first (the dialog belongs in JS).
#[tauri::command]
pub(crate) async fn create_desktop_shortcut(
  _app: tauri::AppHandle,
  game_id: i64,
  title: String,
  icon_path: Option<String>,
  ask: Option<bool>,
) -> Result<String, String> {
  let _ = (game_id, title, icon_path, ask);
  Err(NOT_IMPLEMENTED.to_string())
}

/// Removes the desktop shortcut for a game title.
#[tauri::command]
pub(crate) async fn remove_desktop_shortcut(_app: tauri::AppHandle, title: String) -> Result<(), String> {
  let _ = title;
  Err(NOT_IMPLEMENTED.to_string())
}

/// Whether a desktop shortcut for a game title exists.
#[tauri::command]
pub(crate) async fn desktop_shortcut_exists(_app: tauri::AppHandle, title: String) -> Result<bool, String> {
  let _ = title;
  Err(NOT_IMPLEMENTED.to_string())
}
