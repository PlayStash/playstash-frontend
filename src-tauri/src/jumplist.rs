//! Windows taskbar jump list.
//!
//! Category "Actions": Library, Downloads, Community, Settings and Exit, each
//! `show --jumplistcommand=<n>` on the current executable. Category "Last
//! Played": up to five installed games (`start --gameid=<id>`), pushed by the
//! frontend (`useJumpList`) whenever the installed games change. On other
//! platforms the commands are no-ops.
// The entry builders only run on Windows (and in tests).
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

/// Most games in the "Last Played" category.
const MAX_GAMES: usize = 5;

/// A game entry pushed by the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JumpListGame {
  pub game_id: i64,
  pub title: String,
  /// Icon file (the configured launch `.exe`); the app icon when missing.
  #[serde(default)]
  pub icon_path: Option<String>,
}

static GAMES: OnceLock<Mutex<Vec<JumpListGame>>> = OnceLock::new();

fn games_store() -> &'static Mutex<Vec<JumpListGame>> {
  GAMES.get_or_init(|| Mutex::new(Vec::new()))
}

/// Keeps the order, drops games without a title and duplicate titles, and
/// caps the list at five entries.
pub(crate) fn select_games(games: &[JumpListGame]) -> Vec<JumpListGame> {
  let mut selected: Vec<JumpListGame> = Vec::new();
  for game in games {
    let title = game.title.trim();
    if game.game_id <= 0 || title.is_empty() || selected.iter().any(|existing| existing.title == title) {
      continue;
    }
    selected.push(JumpListGame {
      title: title.to_string(),
      ..game.clone()
    });
    if selected.len() == MAX_GAMES {
      break;
    }
  }
  selected
}

/// One jump-list entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JumpListEntry {
  pub title: String,
  pub description: String,
  pub arguments: String,
  pub icon_path: Option<String>,
}

/// The "Actions" entries in WPF order.
pub(crate) fn action_entries(labels: &crate::tray::TrayLabels) -> Vec<JumpListEntry> {
  [
    (&labels.library, &labels.library_description, 0),
    (&labels.downloads, &labels.downloads_description, 1),
    (&labels.community, &labels.community_description, 2),
    (&labels.settings, &labels.settings_description, 3),
    (&labels.exit, &labels.exit_description, 15),
  ]
  .into_iter()
  .map(|(title, description, command)| JumpListEntry {
    title: title.clone(),
    description: description.clone(),
    arguments: format!("show --jumplistcommand={command}"),
    icon_path: None,
  })
  .collect()
}

/// The "Last Played" entries.
pub(crate) fn game_entries(games: &[JumpListGame]) -> Vec<JumpListEntry> {
  select_games(games)
    .into_iter()
    .map(|game| {
      let icon_path = game
        .icon_path
        .filter(|path| path.to_ascii_lowercase().ends_with(".exe") && std::path::Path::new(path).is_file());
      JumpListEntry {
        description: game.title.clone(),
        title: game.title,
        arguments: format!("start --gameid={}", game.game_id),
        icon_path,
      }
    })
    .collect()
}

/// Builds the initial jump list (actions only).
pub(crate) fn init(app: &AppHandle) {
  refresh(app);
}

/// Rebuilds the jump list from the stored games and the current labels.
pub(crate) fn refresh(app: &AppHandle) {
  #[cfg(windows)]
  {
    let games = games_store().lock().map(|games| games.clone()).unwrap_or_default();
    let labels = crate::tray::labels();
    let app_id = app.config().identifier.clone();
    let Ok(exe) = tauri::utils::platform::current_exe() else {
      return;
    };
    let exe = dunce_path(&exe);
    std::thread::spawn(move || {
      let actions = action_entries(&labels);
      let recent = game_entries(&games);
      if let Err(error) = windows_impl::apply(
        &app_id,
        &exe,
        (&labels.actions_category, &actions),
        (&labels.last_played_category, &recent),
      ) {
        log::warn!("[jumplist] failed to update the jump list: {error}");
      }
    });
  }
  #[cfg(not(windows))]
  {
    let _ = app;
  }
}

/// `\\?\C:\...` paths do not work in shell links.
#[cfg(windows)]
fn dunce_path(path: &std::path::Path) -> String {
  let text = path.to_string_lossy();
  text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

/// Replaces the "Last Played" games.
#[tauri::command]
pub(crate) async fn set_jump_list_games(app: AppHandle, games: Vec<JumpListGame>) -> Result<(), String> {
  {
    let mut stored = games_store().lock().map_err(|_| "Jump list lock poisoned".to_string())?;
    if *stored == games {
      return Ok(());
    }
    *stored = games;
  }
  refresh(&app);
  Ok(())
}

/// Removes the "Last Played" games (logout).
#[tauri::command]
pub(crate) async fn reset_jump_list_games(app: AppHandle) -> Result<(), String> {
  {
    let mut stored = games_store().lock().map_err(|_| "Jump list lock poisoned".to_string())?;
    stored.clear();
  }
  refresh(&app);
  Ok(())
}

#[cfg(windows)]
mod windows_impl {
  use super::JumpListEntry;
  use std::collections::HashSet;
  use windows::core::{Interface, HSTRING, PWSTR};
  use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
  use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
  use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemAlloc, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
  };
  use windows::Win32::System::Variant::VT_LPWSTR;
  use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
  use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
  use windows::Win32::UI::Shell::{
    DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink,
  };

  /// A `VT_LPWSTR` PROPVARIANT (the type `PKEY_Title` expects).
  unsafe fn string_variant(value: &str) -> windows::core::Result<PROPVARIANT> {
    let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let memory = CoTaskMemAlloc(wide.len() * 2) as *mut u16;
    if memory.is_null() {
      return Err(windows::core::Error::from_hresult(windows::Win32::Foundation::E_OUTOFMEMORY));
    }
    std::ptr::copy_nonoverlapping(wide.as_ptr(), memory, wide.len());
    let mut variant = PROPVARIANT::default();
    (*variant.Anonymous.Anonymous).vt = VT_LPWSTR;
    (*variant.Anonymous.Anonymous).Anonymous.pwszVal = PWSTR(memory);
    Ok(variant)
  }

  unsafe fn shell_link(exe: &str, entry: &JumpListEntry) -> windows::core::Result<IShellLinkW> {
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
    link.SetPath(&HSTRING::from(exe))?;
    link.SetArguments(&HSTRING::from(entry.arguments.as_str()))?;
    link.SetDescription(&HSTRING::from(entry.description.as_str()))?;
    let icon = entry.icon_path.as_deref().unwrap_or(exe);
    link.SetIconLocation(&HSTRING::from(icon), 0)?;
    let store: IPropertyStore = link.cast()?;
    let mut title = string_variant(&entry.title)?;
    let result = store.SetValue(&PKEY_Title, &title).and_then(|_| store.Commit());
    let _ = PropVariantClear(&mut title);
    result?;
    Ok(link)
  }

  /// Arguments of the links the user removed from the jump list. Adding one
  /// of them again makes `AppendCategory` fail.
  unsafe fn removed_arguments(removed: &IObjectArray) -> HashSet<String> {
    let mut arguments = HashSet::new();
    let count = removed.GetCount().unwrap_or(0);
    for index in 0..count {
      let Ok(link) = removed.GetAt::<IShellLinkW>(index) else {
        continue;
      };
      let mut buffer = [0u16; 1024];
      if link.GetArguments(&mut buffer).is_ok() {
        let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        arguments.insert(String::from_utf16_lossy(&buffer[..end]));
      }
    }
    arguments
  }

  unsafe fn collection(
    exe: &str,
    entries: &[JumpListEntry],
    removed: &HashSet<String>,
  ) -> windows::core::Result<Option<IObjectArray>> {
    let collection: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
    let mut added = 0;
    for entry in entries.iter().filter(|entry| !removed.contains(&entry.arguments)) {
      collection.AddObject(&shell_link(exe, entry)?)?;
      added += 1;
    }
    if added == 0 {
      return Ok(None);
    }
    Ok(Some(collection.cast()?))
  }

  pub(super) fn apply(
    app_id: &str,
    exe: &str,
    actions: (&str, &[JumpListEntry]),
    recent: (&str, &[JumpListEntry]),
  ) -> windows::core::Result<()> {
    unsafe {
      let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
      let result = (|| {
        let list: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
        list.SetAppID(&HSTRING::from(app_id))?;
        let mut slots = 0u32;
        let removed: IObjectArray = list.BeginList(&mut slots)?;
        let removed = removed_arguments(&removed);
        for (category, entries) in [actions, recent] {
          if let Some(items) = collection(exe, entries, &removed)? {
            if let Err(error) = list.AppendCategory(&HSTRING::from(category), &items) {
              log::warn!("[jumplist] category {category} not added: {error}");
            }
          }
        }
        list.CommitList()
      })();
      if initialized {
        CoUninitialize();
      }
      result
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn game(id: i64, title: &str) -> JumpListGame {
    JumpListGame {
      game_id: id,
      title: title.into(),
      icon_path: None,
    }
  }

  #[test]
  fn selects_five_games_without_duplicate_titles() {
    let games = vec![
      game(1, "A"),
      game(2, "A"),
      game(3, " "),
      game(4, "B"),
      game(5, "C"),
      game(6, "D"),
      game(7, "E"),
      game(8, "F"),
    ];
    let titles: Vec<String> = select_games(&games).into_iter().map(|game| game.title).collect();
    assert_eq!(titles, ["A", "B", "C", "D", "E"]);
  }

  #[test]
  fn builds_entries_like_the_wpf_client() {
    let actions = action_entries(&crate::tray::TrayLabels::default());
    let arguments: Vec<&str> = actions.iter().map(|entry| entry.arguments.as_str()).collect();
    assert_eq!(
      arguments,
      [
        "show --jumplistcommand=0",
        "show --jumplistcommand=1",
        "show --jumplistcommand=2",
        "show --jumplistcommand=3",
        "show --jumplistcommand=15"
      ]
    );
    let games = game_entries(&[JumpListGame {
      game_id: 9,
      title: "Game".into(),
      icon_path: Some("/missing/game.exe".into()),
    }]);
    assert_eq!(games[0].arguments, "start --gameid=9");
    // A missing or non-exe icon falls back to the app icon.
    assert_eq!(games[0].icon_path, None);
  }
}
