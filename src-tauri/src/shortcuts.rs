//! Desktop shortcuts that start a game through PlayStash (WP1).
//!
//! - Windows: `<Desktop>\<name>.url` pointing at `playstash://start?gameid=<id>`
//!   (identical to the WPF `DesktopHelper`).
//! - Linux: `<Desktop>/<name>.desktop` running `<app> start --gameid=<id>`.
//! - macOS: `~/Desktop/<name>.webloc` with the deep link.
//!
//! The confirmation ("Do you want to create a desktop shortcut for …?") is
//! asked by the frontend, which owns the dialogs.

use std::path::{Path, PathBuf};

/// The deep link a shortcut opens.
pub(crate) fn start_uri(game_id: i64) -> String {
  format!("{}://start?gameid={game_id}", crate::cli::URI_SCHEME)
}

fn trim_trailing_dots_and_spaces(value: &str) -> &str {
  value.trim_end_matches(['.', ' '])
}

/// A file name for a game title, safe on every platform (WPF
/// `SecurityPaths.SafeFileName`).
///
/// Control characters and `<>:"|?*/\` become `_`; the name is trimmed, loses
/// trailing dots, is capped at 120 characters; empty, `.` and `..` become
/// "Game"; Windows device names (CON, PRN, AUX, NUL, COM0-9, LPT0-9, checked
/// before the first `.`) get a `_` prefix.
pub(crate) fn safe_file_name(title: &str) -> String {
  let replaced: String = title
    .chars()
    .map(|c| if (c as u32) < 32 || "<>:\"|?*/\\".contains(c) { '_' } else { c })
    .collect();
  let mut name = trim_trailing_dots_and_spaces(replaced.trim()).to_string();
  if name.chars().count() > 120 {
    let capped: String = name.chars().take(120).collect();
    name = trim_trailing_dots_and_spaces(&capped).to_string();
  }
  if name.is_empty() || name == "." || name == ".." {
    return "Game".to_string();
  }
  let device = name.split('.').next().unwrap_or("").to_ascii_uppercase();
  let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
    || (device.len() == 4
      && (device.starts_with("COM") || device.starts_with("LPT"))
      && device.as_bytes()[3].is_ascii_digit());
  if reserved {
    name.insert(0, '_');
  }
  name
}

/// Windows `.url` file (CRLF line endings, forward slashes in the icon path).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn url_shortcut_content(game_id: i64, icon_path: Option<&str>) -> String {
  let mut content = String::from("[InternetShortcut]\r\n");
  content.push_str(&format!("URL={}\r\n", start_uri(game_id)));
  content.push_str("IconIndex=0\r\n");
  content.push_str(&format!("IconFile={}\r\n", icon_path.unwrap_or("").replace('\\', "/")));
  content
}

/// Escapes a value for the `Exec` key of a `.desktop` file.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn desktop_exec_quote(value: &str) -> String {
  let escaped = value
    .replace('\\', "\\\\\\\\")
    .replace('"', "\\\\\"")
    .replace('`', "\\\\`")
    .replace('$', "\\\\$");
  format!("\"{escaped}\"")
}

/// Linux `.desktop` entry that starts the game through PlayStash.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn desktop_entry_content(game_id: i64, title: &str, exe: &str, icon: &str) -> String {
  let name = title.replace(['\r', '\n'], " ");
  format!(
    "[Desktop Entry]\nType=Application\nVersion=1.0\nName={name}\nComment=Start {name} with PlayStash\nExec={} start --gameid={game_id}\nIcon={icon}\nTerminal=false\nCategories=Game;\n",
    desktop_exec_quote(exe)
  )
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn xml_escape(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
}

/// macOS `.webloc` (a property list with the URL).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn webloc_content(game_id: i64) -> String {
  format!(
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>URL</key>\n\t<string>{}</string>\n</dict>\n</plist>\n",
    xml_escape(&start_uri(game_id))
  )
}

/// Shortcut file extension of this platform.
fn extension() -> &'static str {
  if cfg!(windows) {
    "url"
  } else if cfg!(target_os = "macos") {
    "webloc"
  } else {
    "desktop"
  }
}

/// The user's desktop directory (follows OneDrive/XDG redirection).
fn desktop_dir() -> Result<PathBuf, String> {
  #[cfg(windows)]
  {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
      let path = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None).map_err(|error| error.to_string())?;
      let text = path.to_string().map_err(|error| error.to_string());
      CoTaskMemFree(Some(path.0 as _));
      text.map(PathBuf::from)
    }
  }
  #[cfg(target_os = "linux")]
  {
    let from_xdg = std::process::Command::new("xdg-user-dir")
      .arg("DESKTOP")
      .output()
      .ok()
      .filter(|output| output.status.success())
      .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
      .filter(|path| !path.is_empty())
      .map(PathBuf::from);
    from_xdg
      .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Desktop")))
      .ok_or_else(|| "No desktop directory".to_string())
  }
  #[cfg(all(unix, not(target_os = "linux")))]
  {
    std::env::var_os("HOME")
      .map(|home| PathBuf::from(home).join("Desktop"))
      .ok_or_else(|| "No desktop directory".to_string())
  }
}

fn shortcut_path(title: &str) -> Result<PathBuf, String> {
  Ok(desktop_dir()?.join(format!("{}.{}", safe_file_name(title), extension())))
}

/// The path PlayStash is started from (the AppImage itself when packaged so).
#[cfg(target_os = "linux")]
fn app_executable(app: &tauri::AppHandle) -> Result<String, String> {
  use tauri::Manager;
  if let Some(appimage) = app.env().appimage {
    return Ok(appimage.to_string_lossy().into_owned());
  }
  tauri::utils::platform::current_exe()
    .map(|exe| exe.to_string_lossy().into_owned())
    .map_err(|error| error.to_string())
}

fn write_shortcut(app: &tauri::AppHandle, path: &Path, game_id: i64, title: &str, icon_path: Option<&str>) -> Result<(), String> {
  #[cfg(windows)]
  {
    let _ = (app, title);
    std::fs::write(path, url_shortcut_content(game_id, icon_path)).map_err(|error| error.to_string())
  }
  #[cfg(target_os = "linux")]
  {
    use std::os::unix::fs::PermissionsExt;
    let exe = app_executable(app)?;
    // `.exe` icons are not usable on Linux; fall back to the app icon.
    let icon = icon_path
      .filter(|path| {
        let lower = path.to_ascii_lowercase();
        [".png", ".svg", ".xpm", ".ico", ".jpg", ".jpeg"].iter().any(|ext| lower.ends_with(ext))
      })
      .unwrap_or("playstash");
    std::fs::write(path, desktop_entry_content(game_id, title, &exe, icon)).map_err(|error| error.to_string())?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).map_err(|error| error.to_string())?;
    // GNOME only launches trusted desktop files (best effort).
    let _ = std::process::Command::new("gio")
      .args(["set", &path.to_string_lossy(), "metadata::trusted", "true"])
      .output();
    Ok(())
  }
  #[cfg(all(unix, not(target_os = "linux")))]
  {
    let _ = (app, title, icon_path);
    std::fs::write(path, webloc_content(game_id)).map_err(|error| error.to_string())
  }
}

/// Creates a desktop shortcut for a game. Returns `"created"`, or `"exists"`
/// when a shortcut with that title is already there. `ask` is handled by the
/// frontend before it calls this command.
#[tauri::command]
pub(crate) async fn create_desktop_shortcut(
  app: tauri::AppHandle,
  game_id: i64,
  title: String,
  icon_path: Option<String>,
  ask: Option<bool>,
) -> Result<String, String> {
  let _ = ask;
  tauri::async_runtime::spawn_blocking(move || {
    let path = shortcut_path(&title)?;
    if path.exists() {
      return Ok("exists".to_string());
    }
    write_shortcut(&app, &path, game_id, &title, icon_path.as_deref().filter(|icon| !icon.trim().is_empty()))
      .map(|_| "created".to_string())
      .map_err(|error| {
        log::warn!("[shortcuts] creating {} failed: {error}", path.display());
        error
      })
  })
  .await
  .map_err(|error| error.to_string())?
}

/// Removes the desktop shortcut for a game title. Errors are logged and
/// swallowed, like the WPF client.
#[tauri::command]
pub(crate) async fn remove_desktop_shortcut(title: String) -> Result<(), String> {
  let _ = tauri::async_runtime::spawn_blocking(move || {
    let Ok(path) = shortcut_path(&title) else {
      return;
    };
    if path.is_file() {
      if let Err(error) = std::fs::remove_file(&path) {
        log::warn!("[shortcuts] removing {} failed: {error}", path.display());
      }
    }
  })
  .await;
  Ok(())
}

/// Whether a desktop shortcut for a game title exists.
#[tauri::command]
pub(crate) async fn desktop_shortcut_exists(title: String) -> Result<bool, String> {
  Ok(
    tauri::async_runtime::spawn_blocking(move || shortcut_path(&title).map(|path| path.is_file()).unwrap_or(false))
      .await
      .unwrap_or(false),
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn safe_file_names() {
    assert_eq!(safe_file_name("Half-Life 2: Episode One"), "Half-Life 2_ Episode One");
    assert_eq!(safe_file_name("a<b>c\"d|e?f*g/h\\i"), "a_b_c_d_e_f_g_h_i");
    assert_eq!(safe_file_name("tab\there"), "tab_here");
    assert_eq!(safe_file_name("  Game...  "), "Game");
    assert_eq!(safe_file_name("Title. ."), "Title");
    assert_eq!(safe_file_name(""), "Game");
    assert_eq!(safe_file_name("..."), "Game");
    assert_eq!(safe_file_name("."), "Game");
    assert_eq!(safe_file_name("CON"), "_CON");
    assert_eq!(safe_file_name("con.txt"), "_con.txt");
    assert_eq!(safe_file_name("COM1"), "_COM1");
    assert_eq!(safe_file_name("lpt9.game"), "_lpt9.game");
    assert_eq!(safe_file_name("COM10"), "COM10");
    assert_eq!(safe_file_name("Console"), "Console");
    let long = format!("{}. end", "x".repeat(118));
    assert_eq!(safe_file_name(&long), "x".repeat(118));
    assert_eq!(safe_file_name(&"y".repeat(200)).len(), 120);
  }

  #[test]
  fn url_file_uses_crlf_and_forward_slashes() {
    let content = url_shortcut_content(5, Some(r"C:\Games\Game\game.exe"));
    assert_eq!(
      content,
      "[InternetShortcut]\r\nURL=playstash://start?gameid=5\r\nIconIndex=0\r\nIconFile=C:/Games/Game/game.exe\r\n"
    );
    assert!(!content.replace("\r\n", "").contains('\n'));
  }

  #[test]
  fn desktop_entry_and_webloc() {
    let entry = desktop_entry_content(5, "My Game", "/opt/Play Stash/playstash", "playstash");
    assert!(entry.contains("Exec=\"/opt/Play Stash/playstash\" start --gameid=5\n"));
    assert!(entry.contains("Name=My Game\n"));
    assert!(entry.starts_with("[Desktop Entry]\nType=Application\n"));
    assert!(webloc_content(7).contains("<string>playstash://start?gameid=7</string>"));
  }
}
