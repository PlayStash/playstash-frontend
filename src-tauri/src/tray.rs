//! System tray, close-to-tray and the translated native labels (WP1).
//!
//! Menu order matches the WPF client: Library, Downloads, Community,
//! Settings, Exit. The first four show the window and open their page through
//! the desktop command queue; Exit goes through the exit confirmation.
//! The labels are pushed by the frontend (`set_tray_labels`) and persisted in
//! the `tray` settings section so the next start already uses the language.

use crate::cli::CommandOptions;
use crate::desktop_commands;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const SECTION: &str = "tray";

/// Native strings that are shown outside the webview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct TrayLabels {
  pub library: String,
  pub downloads: String,
  pub community: String,
  pub settings: String,
  pub exit: String,
  pub library_description: String,
  pub downloads_description: String,
  pub community_description: String,
  pub settings_description: String,
  pub exit_description: String,
  pub actions_category: String,
  pub last_played_category: String,
  pub notice_title: String,
  pub notice_body: String,
  pub exit_confirm: String,
}

impl Default for TrayLabels {
  fn default() -> Self {
    Self {
      library: "Library".into(),
      downloads: "Downloads".into(),
      community: "Community".into(),
      settings: "Settings".into(),
      exit: "Exit".into(),
      library_description: "Open Library".into(),
      downloads_description: "Open Downloads".into(),
      community_description: "Open Community".into(),
      settings_description: "Open Settings".into(),
      exit_description: "Exit PlayStash".into(),
      actions_category: "Actions".into(),
      last_played_category: "Last Played".into(),
      notice_title: "Information".into(),
      notice_body: "PlayStash is still running in the background".into(),
      exit_confirm: "Downloads are still running in the background, are you sure you want to exit the app anyway?"
        .into(),
    }
  }
}

impl TrayLabels {
  /// Takes every non-empty label from `update`.
  fn merge(&mut self, update: &TrayLabelsUpdate) {
    let pairs: [(&mut String, &Option<String>); 15] = [
      (&mut self.library, &update.library),
      (&mut self.downloads, &update.downloads),
      (&mut self.community, &update.community),
      (&mut self.settings, &update.settings),
      (&mut self.exit, &update.exit),
      (&mut self.library_description, &update.library_description),
      (&mut self.downloads_description, &update.downloads_description),
      (&mut self.community_description, &update.community_description),
      (&mut self.settings_description, &update.settings_description),
      (&mut self.exit_description, &update.exit_description),
      (&mut self.actions_category, &update.actions_category),
      (&mut self.last_played_category, &update.last_played_category),
      (&mut self.notice_title, &update.notice_title),
      (&mut self.notice_body, &update.notice_body),
      (&mut self.exit_confirm, &update.exit_confirm),
    ];
    for (target, value) in pairs {
      if let Some(value) = value.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        *target = value.to_string();
      }
    }
  }
}

/// Partial label update from the frontend.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct TrayLabelsUpdate {
  pub library: Option<String>,
  pub downloads: Option<String>,
  pub community: Option<String>,
  pub settings: Option<String>,
  pub exit: Option<String>,
  pub library_description: Option<String>,
  pub downloads_description: Option<String>,
  pub community_description: Option<String>,
  pub settings_description: Option<String>,
  pub exit_description: Option<String>,
  pub actions_category: Option<String>,
  pub last_played_category: Option<String>,
  pub notice_title: Option<String>,
  pub notice_body: Option<String>,
  pub exit_confirm: Option<String>,
}

/// The persisted `tray` settings section.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct TraySection {
  /// The "still running in the background" notice was shown once.
  pub running_in_tray_notice_shown: bool,
  /// Autostart was re-enabled once so the `show --autostart` arguments are written.
  pub autostart_args_migrated: bool,
  pub labels: TrayLabels,
}

static LABELS: OnceLock<Mutex<TrayLabels>> = OnceLock::new();
/// Tray menu items by id, kept to update their labels.
type MenuItems = Vec<(String, MenuItem<Wry>)>;
static MENU_ITEMS: OnceLock<Mutex<MenuItems>> = OnceLock::new();

fn labels_store() -> &'static Mutex<TrayLabels> {
  LABELS.get_or_init(|| Mutex::new(TrayLabels::default()))
}

/// Current native labels.
pub(crate) fn labels() -> TrayLabels {
  labels_store().lock().map(|labels| labels.clone()).unwrap_or_default()
}

/// Menu entries: id, label and the jump-list command it opens (`None` = Exit).
fn menu_entries(labels: &TrayLabels) -> [(&'static str, String, Option<i32>); 5] {
  [
    ("tray-library", labels.library.clone(), Some(0)),
    ("tray-downloads", labels.downloads.clone(), Some(1)),
    ("tray-community", labels.community.clone(), Some(2)),
    ("tray-settings", labels.settings.clone(), Some(3)),
    ("tray-exit", labels.exit.clone(), None),
  ]
}

/// Builds the tray icon and its menu.
pub(crate) fn init(app: &AppHandle) -> tauri::Result<()> {
  let section: TraySection = crate::settings::load_section(app, SECTION);
  if let Ok(mut labels) = labels_store().lock() {
    *labels = section.labels.clone();
  }

  let mut items = Vec::new();
  let mut menu = MenuBuilder::new(app);
  for (id, label, _) in menu_entries(&section.labels) {
    let item = MenuItemBuilder::with_id(id, label).build(app)?;
    menu = menu.item(&item);
    items.push((id.to_string(), item));
  }
  let menu = menu.build()?;
  let _ = MENU_ITEMS.set(Mutex::new(items));

  let mut builder = TrayIconBuilder::with_id("playstash-tray").tooltip("PlayStash").menu(&menu);
  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }
  // Windows: the menu opens on right click, a double click shows the window.
  if cfg!(windows) {
    builder = builder.show_menu_on_left_click(false);
  }

  builder
    .on_menu_event(|app, event| {
      let id = event.id.as_ref();
      let Some((_, _, command)) = menu_entries(&labels()).into_iter().find(|(entry, _, _)| *entry == id) else {
        return;
      };
      match command {
        Some(page) => {
          desktop_commands::reveal_main_window(app);
          desktop_commands::submit(
            app,
            CommandOptions {
              jump_list_command: Some(page),
              ..CommandOptions::show()
            },
          );
        }
        None => desktop_commands::request_exit(app),
      }
    })
    .on_tray_icon_event(|tray, event| {
      let toggle = match event {
        TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => cfg!(windows),
        TrayIconEvent::Click {
          button: MouseButton::Left,
          button_state: MouseButtonState::Up,
          ..
        } => !cfg!(windows),
        _ => false,
      };
      if toggle {
        toggle_main_window(tray.app_handle());
      }
    })
    .build(app)?;

  Ok(())
}

/// Shows a hidden or minimized window, hides a visible one.
fn toggle_main_window(app: &AppHandle) {
  let Some(window) = app.get_webview_window("main") else {
    return;
  };
  let visible = window.is_visible().unwrap_or(false);
  let minimized = window.is_minimized().unwrap_or(false);
  if visible && !minimized {
    let _ = window.hide();
  } else {
    desktop_commands::reveal_main_window(app);
  }
}

/// Closing the window hides it to the tray. The first time (per install) an
/// OS notification tells the user that PlayStash keeps running.
pub(crate) fn attach_close_to_tray(app: &AppHandle) {
  let Some(window) = app.get_webview_window("main") else {
    return;
  };
  let handle = app.clone();
  let window_handle = window.clone();
  window.on_window_event(move |event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
      api.prevent_close();
      let _ = window_handle.hide();
      show_tray_notice_once(&handle);
    }
  });
}

fn show_tray_notice_once(app: &AppHandle) {
  let mut first_time = false;
  let result = crate::settings::update_section::<TraySection, _>(app, SECTION, |section| {
    if !section.running_in_tray_notice_shown {
      section.running_in_tray_notice_shown = true;
      first_time = true;
    }
  });
  if let Err(error) = result {
    log::warn!("[tray] failed to persist the tray notice flag: {error}");
  }
  if first_time {
    let labels = labels();
    crate::notifications::show(app, &labels.notice_title, &labels.notice_body, None);
  }
}

/// Re-enables autostart once so entries written by older builds (without
/// arguments) get the `show --autostart` arguments.
pub(crate) fn migrate_autostart_args(app: &AppHandle) {
  use tauri_plugin_autostart::ManagerExt;
  let section: TraySection = crate::settings::load_section(app, SECTION);
  if section.autostart_args_migrated {
    return;
  }
  let autolaunch = app.autolaunch();
  if autolaunch.is_enabled().unwrap_or(false) {
    if let Err(error) = autolaunch.disable().and_then(|_| autolaunch.enable()) {
      log::warn!("[tray] failed to rewrite the autostart entry: {error}");
      return;
    }
  }
  let _ = crate::settings::update_section::<TraySection, _>(app, SECTION, |section| {
    section.autostart_args_migrated = true;
  });
}

/// Updates the native labels (tray menu, jump list, notices) after the
/// frontend language changed.
#[tauri::command]
pub(crate) async fn set_tray_labels(app: AppHandle, labels: TrayLabelsUpdate) -> Result<(), String> {
  let merged = {
    let mut current = labels_store().lock().map_err(|_| "Tray labels lock poisoned".to_string())?;
    let mut next = current.clone();
    next.merge(&labels);
    if next == *current {
      return Ok(());
    }
    *current = next.clone();
    next
  };

  if let Some(items) = MENU_ITEMS.get() {
    if let Ok(items) = items.lock() {
      for (id, label, _) in menu_entries(&merged) {
        if let Some((_, item)) = items.iter().find(|(item_id, _)| item_id == id) {
          let _ = item.set_text(label);
        }
      }
    }
  }

  crate::settings::update_section::<TraySection, _>(&app, SECTION, |section| {
    section.labels = merged.clone();
  })?;
  crate::jumplist::refresh(&app);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn merges_only_non_empty_labels() {
    let mut labels = TrayLabels::default();
    labels.merge(&TrayLabelsUpdate {
      library: Some("Bibliothek".into()),
      exit: Some("  ".into()),
      ..Default::default()
    });
    assert_eq!(labels.library, "Bibliothek");
    assert_eq!(labels.exit, "Exit");
  }

  #[test]
  fn menu_order_matches_the_wpf_client() {
    let ids: Vec<&str> = menu_entries(&TrayLabels::default()).iter().map(|(id, _, _)| *id).collect();
    assert_eq!(ids, ["tray-library", "tray-downloads", "tray-community", "tray-settings", "tray-exit"]);
  }
}
