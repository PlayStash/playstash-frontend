//! Save folders of games Ludusavi's manifest does not know.
//!
//! Paths use portable placeholders (`%LOCALAPPDATALOW%/Studio/Game`) so the
//! same entry works for every user and PC. They come from the server
//! (`save_paths` metadata), from this installation's game config, or are
//! detected from the game's engine layout or from the folders a play session
//! changed.

use std::collections::VecDeque;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

/// Key of the detected or chosen folders in `.playstash.game.config.json`.
pub(crate) const SAVE_PATHS_KEY: &str = "savepaths";

/// Placeholders and the Ludusavi placeholder each one stands for. The more
/// specific `%LOCALAPPDATALOW%` precedes `%LOCALAPPDATA%`.
const PLACEHOLDERS: [(&str, &str); 5] = [
  ("%LOCALAPPDATALOW%", "<winLocalAppDataLow>"),
  ("%LOCALAPPDATA%", "<winLocalAppData>"),
  ("%APPDATA%", "<winAppData>"),
  ("%DOCUMENTS%", "<winDocuments>"),
  ("%USERPROFILE%", "<home>"),
];
const INSTALL_DIR: &str = "%INSTALLDIR%";

/// Escapes glob characters of a literal path (globset bracket escaping).
pub(crate) fn glob_escape(path: &str) -> String {
  let mut escaped = String::new();
  for character in path.chars() {
    match character {
      '?' | '*' | '[' | ']' | '{' | '}' => {
        escaped.push('[');
        escaped.push(character);
        escaped.push(']');
      }
      _ => escaped.push(character),
    }
  }
  escaped
}

fn strip_prefix_ignore_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
  (value.len() >= prefix.len() && value.is_char_boundary(prefix.len()) && value[..prefix.len()].eq_ignore_ascii_case(prefix))
    .then(|| &value[prefix.len()..])
}

/// A save path as a Ludusavi file rule, or `None` for an empty or unsafe entry.
///
/// Placeholders become Ludusavi placeholders, `%INSTALLDIR%` and relative
/// paths the escaped installation folder; absolute paths are kept. A folder
/// rule covers everything below it.
pub(crate) fn to_ludusavi_rule(path: &str, installation_path: &str) -> Option<String> {
  let path = path.trim().replace('\\', "/");
  let path = path.trim_end_matches('/');
  if path.is_empty() || path.split('/').any(|part| part == "..") {
    return None;
  }
  for (placeholder, ludusavi) in PLACEHOLDERS {
    if let Some(rest) = strip_prefix_ignore_case(path, placeholder) {
      return Some(format!("{ludusavi}{rest}"));
    }
  }
  let installation = installation_path.trim().replace('\\', "/");
  let installation = installation.trim_end_matches('/');
  if let Some(rest) = strip_prefix_ignore_case(path, INSTALL_DIR) {
    return (!installation.is_empty()).then(|| format!("{}{rest}", glob_escape(installation)));
  }
  let absolute = path.starts_with('/') || path.as_bytes().get(1) == Some(&b':');
  if absolute {
    Some(path.to_string())
  } else if installation.is_empty() || path.contains('%') {
    None
  } else {
    Some(format!("{}/{path}", glob_escape(installation)))
  }
}

/// Folders a placeholder stands for on this machine (Windows layout).
fn known_folders(home: &Path) -> Vec<(&'static str, PathBuf)> {
  let app_data = home.join("AppData");
  vec![
    ("%LOCALAPPDATALOW%", app_data.join("LocalLow")),
    ("%LOCALAPPDATA%", app_data.join("Local")),
    ("%APPDATA%", app_data.join("Roaming")),
    ("%DOCUMENTS%", home.join("Documents")),
  ]
}

fn relative_to(path: &Path, base: &Path) -> Option<String> {
  let path = path.to_string_lossy().replace('\\', "/");
  let base = base.to_string_lossy().replace('\\', "/");
  let base = base.trim_end_matches('/');
  if base.is_empty() {
    return None;
  }
  let rest = strip_prefix_ignore_case(&path, base)?;
  (rest.is_empty() || rest.starts_with('/')).then(|| rest.to_string())
}

/// A folder on this machine in portable placeholder form: inside the
/// installation as `%INSTALLDIR%/...`, below the user's profile with the most
/// specific placeholder, anything else unchanged.
pub(crate) fn to_placeholder_path(path: &Path, home: &Path, installation: &Path) -> String {
  if !installation.as_os_str().is_empty() {
    if let Some(rest) = relative_to(path, installation) {
      return format!("{INSTALL_DIR}{rest}");
    }
  }
  for (placeholder, folder) in known_folders(home) {
    if let Some(rest) = relative_to(path, &folder) {
      return format!("{placeholder}{rest}");
    }
  }
  if let Some(rest) = relative_to(path, home) {
    return format!("%USERPROFILE%{rest}");
  }
  path.to_string_lossy().replace('\\', "/")
}

/// Expands a placeholder path to a folder on this machine (for display and
/// existence checks).
pub(crate) fn expand_placeholder_path(path: &str, home: &Path, installation: &Path) -> Option<PathBuf> {
  let path = path.trim().replace('\\', "/");
  let join = |base: &Path, rest: &str| base.join(rest.trim_start_matches('/'));
  if let Some(rest) = strip_prefix_ignore_case(&path, INSTALL_DIR) {
    return (!installation.as_os_str().is_empty()).then(|| join(installation, rest));
  }
  for (placeholder, folder) in known_folders(home) {
    if let Some(rest) = strip_prefix_ignore_case(&path, placeholder) {
      return Some(join(&folder, rest));
    }
  }
  if let Some(rest) = strip_prefix_ignore_case(&path, "%USERPROFILE%") {
    return Some(join(home, rest));
  }
  let candidate = PathBuf::from(&path);
  (candidate.is_absolute() && !path.contains('%')).then_some(candidate)
}

// ── Engine layouts ──────────────────────────────────────────────────────────

/// Files below `root`, breadth first, at most `max_depth` folders deep.
fn walk(root: &Path, max_depth: usize, max_entries: usize) -> Vec<(PathBuf, usize)> {
  let mut found = Vec::new();
  let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
  while let Some((dir, depth)) = queue.pop_front() {
    let Ok(entries) = fs::read_dir(&dir) else { continue };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
      if found.len() >= max_entries {
        return found;
      }
      let Ok(kind) = entry.file_type() else { continue };
      if kind.is_symlink() {
        continue;
      }
      let path = entry.path();
      if kind.is_dir() && depth < max_depth {
        queue.push_back((path.clone(), depth + 1));
      }
      found.push((path, depth));
    }
  }
  found
}

fn file_name_lower(path: &Path) -> String {
  path.file_name().map(|name| name.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

fn install_relative(installation: &Path, path: &Path) -> String {
  format!("{INSTALL_DIR}{}", relative_to(path, installation).unwrap_or_default())
}

/// Ren'Py's `config.save_directory` from a game's `options.rpy`.
fn renpy_save_directory(game_dir: &Path) -> Option<String> {
  let text = fs::read_to_string(game_dir.join("options.rpy")).ok()?;
  text.lines().find_map(|line| {
    let line = line.trim();
    let rest = line.strip_prefix("define config.save_directory").or_else(|| line.strip_prefix("config.save_directory"))?;
    let value = rest.trim_start().strip_prefix('=')?.trim();
    let value = value.trim_matches(|c| c == '"' || c == '\'');
    let valid = !value.is_empty() && value != "None" && !value.contains(['/', '\\', '.']);
    valid.then(|| value.to_string())
  })
}

fn compact(value: &str) -> String {
  value.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn push_unique(paths: &mut Vec<String>, path: String) {
  if !paths.iter().any(|known| known.eq_ignore_ascii_case(&path)) {
    paths.push(path);
  }
}

/// Save folders read from the game's engine layout: Unity (`app.info`),
/// Unreal (`<Project>/Saved/SaveGames`), Ren'Py, RPG Maker, Wolf RPG and save
/// folders shipped next to the game.
pub(crate) fn detect_engine_save_paths(installation: &Path, home: &Path) -> Vec<String> {
  let mut paths = Vec::new();
  let entries = walk(installation, 4, 40_000);
  for (path, _) in &entries {
    let name = file_name_lower(path);
    let parent = path.parent().unwrap_or(installation);
    if name == "app.info" && file_name_lower(parent).ends_with("_data") {
      // Unity: first line company, second line product.
      if let Ok(text) = fs::read_to_string(path) {
        let mut lines = text.lines().map(str::trim);
        if let (Some(company), Some(product)) = (lines.next(), lines.next()) {
          let safe = |part: &str| !part.is_empty() && !part.contains(['/', '\\']) && part != "..";
          if safe(company) && safe(product) {
            push_unique(&mut paths, format!("%LOCALAPPDATALOW%/{company}/{product}"));
          }
        }
      }
    } else if name.ends_with("-shipping.exe") && file_name_lower(parent) == "win64" {
      // Unreal: <Project>/Binaries/Win64/<Project>-Win64-Shipping.exe
      if let Some(project) = parent.parent().and_then(Path::parent).and_then(Path::file_name) {
        push_unique(&mut paths, format!("%LOCALAPPDATA%/{}/Saved/SaveGames", project.to_string_lossy()));
      }
    } else if name == "renpy" && path.is_dir() && parent.join("game").is_dir() {
      let game_dir = parent.join("game");
      push_unique(&mut paths, install_relative(installation, &game_dir.join("saves")));
      if let Some(directory) = renpy_save_directory(&game_dir) {
        push_unique(&mut paths, format!("%APPDATA%/RenPy/{directory}"));
      } else {
        // Without options.rpy: the folder Ren'Py created for this game.
        let stems: Vec<String> = fs::read_dir(parent)
          .map(|items| {
            items
              .flatten()
              .filter_map(|item| {
                let file = item.file_name().to_string_lossy().to_string();
                let stem = file.strip_suffix(".exe")?.trim_end_matches("-32").to_string();
                (!stem.is_empty()).then(|| compact(&stem))
              })
              .collect()
          })
          .unwrap_or_default();
        if let Ok(items) = fs::read_dir(home.join("AppData").join("Roaming").join("RenPy")) {
          for item in items.flatten() {
            let folder = item.file_name().to_string_lossy().to_string();
            if stems.iter().any(|stem| stem.len() >= 4 && compact(&folder).starts_with(stem.as_str())) {
              push_unique(&mut paths, format!("%APPDATA%/RenPy/{folder}"));
            }
          }
        }
      }
    } else if name == "system.json" && file_name_lower(parent) == "data" {
      // RPG Maker MV (www/data) and MZ (data): saves beside the data folder.
      if let Some(root) = parent.parent() {
        push_unique(&mut paths, install_relative(installation, &root.join("save")));
      }
    } else if matches!(name.as_str(), "game.rgss3a" | "game.rgss2a" | "game.rgssad") {
      // RPG Maker VX Ace / VX / XP: Save01.rvdata2 next to the game.
      push_unique(&mut paths, format!("{}/Save*", install_relative(installation, parent)));
    } else if name == "data.wolf" {
      push_unique(&mut paths, install_relative(installation, &parent.join("Save")));
    } else if path.is_dir() && matches!(name.as_str(), "saves" | "save" | "savedata" | "savegames") {
      let in_engine_data = path.components().any(|part| matches!(part, Component::Normal(name) if name.to_string_lossy().eq_ignore_ascii_case("renpy")));
      if !in_engine_data {
        push_unique(&mut paths, install_relative(installation, path));
      }
    }
  }
  paths
}

// ── Folders changed by a play session ───────────────────────────────────────

/// Folders that change for reasons other than a game's saves.
const NOISE: [&str; 24] = [
  "microsoft", "google", "mozilla", "packages", "temp", "crashdumps", "nvidia", "nvidia corporation", "amd", "intel",
  "playstash", "discord", "steam", "epic games", "epicgameslauncher", "d3dscache", "unity", "renpy", "programs",
  "comms", "connecteddevicesplatform", "squirreltemp", "electron", "gamevault",
];

fn modified_since(dir: &Path, since: std::time::SystemTime) -> bool {
  walk(dir, 4, 2_000).iter().any(|(path, _)| {
    path.is_file() && fs::metadata(path).and_then(|meta| meta.modified()).map(|time| time >= since).unwrap_or(false)
  })
}

fn matches_hint(name: &str, hints: &[String]) -> bool {
  let name = compact(name);
  name.len() >= 3 && hints.iter().any(|hint| hint.len() >= 4 && (name.contains(hint.as_str()) || hint.contains(name.as_str())))
}

/// Folders below the usual save locations that changed since `since_ms` and
/// whose name matches the game (title words, executable or folder names).
pub(crate) fn detect_session_save_paths(home: &Path, installation: &Path, since_ms: i64, hints: &[String]) -> Vec<String> {
  let Some(since) = u64::try_from(since_ms.saturating_sub(5_000)).ok().map(|ms| UNIX_EPOCH + Duration::from_millis(ms)) else {
    return Vec::new();
  };
  let mut hints: Vec<String> = hints.iter().map(|hint| compact(hint)).filter(|hint| hint.len() >= 4).collect();
  hints.sort();
  hints.dedup();
  let app_data = home.join("AppData");
  let roots = [
    app_data.join("LocalLow"),
    app_data.join("Roaming"),
    app_data.join("Local"),
    home.join("Documents"),
    home.join("Documents").join("My Games"),
    home.join("Saved Games"),
  ];
  let mut paths = Vec::new();
  for root in roots {
    let Ok(first) = fs::read_dir(&root) else { continue };
    for first in first.flatten() {
      let first_name = first.file_name().to_string_lossy().to_string();
      if !first.path().is_dir() || NOISE.contains(&first_name.to_ascii_lowercase().as_str()) {
        continue;
      }
      // Company/Product layouts: prefer the matching product folder.
      let mut matched_child = false;
      if let Ok(second) = fs::read_dir(first.path()) {
        for second in second.flatten() {
          let name = second.file_name().to_string_lossy().to_string();
          if second.path().is_dir() && matches_hint(&name, &hints) && modified_since(&second.path(), since) {
            push_unique(&mut paths, to_placeholder_path(&second.path(), home, installation));
            matched_child = true;
          }
        }
      }
      if !matched_child && matches_hint(&first_name, &hints) && modified_since(&first.path(), since) {
        push_unique(&mut paths, to_placeholder_path(&first.path(), home, installation));
      }
    }
  }
  paths
}

/// Words that identify a game on disk: its title, the executables' names and
/// the installation folder name.
pub(crate) fn name_hints(title: &str, installation: &Path) -> Vec<String> {
  let mut hints = vec![title.to_string()];
  hints.extend(title.split(|c: char| !c.is_alphanumeric()).filter(|word| word.len() >= 5).map(str::to_string));
  if let Some(name) = installation.file_name() {
    hints.push(name.to_string_lossy().to_string());
  }
  for (path, _) in walk(installation, 2, 5_000) {
    let name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    if let Some(stem) = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")) {
      let lower = stem.to_ascii_lowercase();
      if !lower.contains("unitycrashhandler") && !lower.contains("redist") && !lower.starts_with("unins") {
        hints.push(stem.trim_end_matches("-32").to_string());
      }
    }
  }
  hints
}

// ── Game config ─────────────────────────────────────────────────────────────

/// Save folders stored in this installation's game config.
pub(crate) fn read_local_save_paths(config: Option<&serde_json::Map<String, serde_json::Value>>) -> Vec<String> {
  config
    .and_then(|config| config.get(SAVE_PATHS_KEY))
    .and_then(|value| value.as_array())
    .map(|values| {
      values
        .iter()
        .filter_map(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
    })
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
  use super::*;

  struct Scratch(PathBuf);

  impl Scratch {
    fn new(label: &str) -> Self {
      let path = std::env::temp_dir().join(format!("playstash-save-paths-{label}-{}", crate::cloud_saves::new_uuid().unwrap()));
      fs::create_dir_all(&path).unwrap();
      Self(path)
    }
    fn write(&self, relative: &str, content: &str) {
      let path = self.0.join(relative);
      fs::create_dir_all(path.parent().unwrap()).unwrap();
      fs::write(path, content).unwrap();
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn converts_placeholders_to_ludusavi_rules() {
    let install = "C:/Games/My [Game]";
    assert_eq!(to_ludusavi_rule("%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing", install).unwrap(), "<winLocalAppDataLow>/PinkySoul/ExquisiteFishing");
    assert_eq!(to_ludusavi_rule("%localappdata%\\Game\\Saved\\", install).unwrap(), "<winLocalAppData>/Game/Saved");
    assert_eq!(to_ludusavi_rule("%APPDATA%/RenPy/x", install).unwrap(), "<winAppData>/RenPy/x");
    assert_eq!(to_ludusavi_rule("%DOCUMENTS%/My Games/x", install).unwrap(), "<winDocuments>/My Games/x");
    assert_eq!(to_ludusavi_rule("%USERPROFILE%/.game", install).unwrap(), "<home>/.game");
    assert_eq!(to_ludusavi_rule("%INSTALLDIR%/www/save", install).unwrap(), "C:/Games/My [[]Game[]]/www/save");
    assert_eq!(to_ludusavi_rule("save", install).unwrap(), "C:/Games/My [[]Game[]]/save");
    assert_eq!(to_ludusavi_rule("D:\\Saves\\Game", install).unwrap(), "D:/Saves/Game");
    assert!(to_ludusavi_rule("  ", install).is_none());
    assert!(to_ludusavi_rule("%APPDATA%/../secret", install).is_none());
    assert!(to_ludusavi_rule("%UNKNOWN%/x", install).is_none());
    assert!(to_ludusavi_rule("%INSTALLDIR%/save", "").is_none());
  }

  #[test]
  fn converts_folders_to_placeholders_and_back() {
    let home = Path::new("C:/Users/Ada");
    let install = Path::new("D:/PlayStash/Game/Installation");
    let low = Path::new("C:/Users/Ada/AppData/LocalLow/PinkySoul/ExquisiteFishing");
    assert_eq!(to_placeholder_path(low, home, install), "%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing");
    assert_eq!(to_placeholder_path(Path::new("C:/Users/Ada/AppData/Local/G/Saved"), home, install), "%LOCALAPPDATA%/G/Saved");
    assert_eq!(to_placeholder_path(Path::new("D:/PlayStash/Game/Installation/www/save"), home, install), "%INSTALLDIR%/www/save");
    assert_eq!(to_placeholder_path(Path::new("C:/Users/Ada/.game"), home, install), "%USERPROFILE%/.game");
    assert_eq!(to_placeholder_path(Path::new("E:/Saves"), home, install), "E:/Saves");
    assert_eq!(expand_placeholder_path("%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing", home, install).unwrap(), home.join("AppData").join("LocalLow").join("PinkySoul/ExquisiteFishing"));
    assert_eq!(expand_placeholder_path("%INSTALLDIR%/save", home, install).unwrap(), install.join("save"));
  }

  #[test]
  fn detects_engine_layouts() {
    let home = Scratch::new("home");
    let unity = Scratch::new("unity");
    unity.write("Exquisite Fishing/ExquisiteFishing_Data/app.info", "PinkySoul\nExquisiteFishing");
    assert_eq!(detect_engine_save_paths(&unity.0, &home.0), vec!["%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing"]);

    let unreal = Scratch::new("unreal");
    unreal.write("Game/MomGotStuck/Binaries/Win64/MomGotStuck-Win64-Shipping.exe", "MZ");
    assert_eq!(detect_engine_save_paths(&unreal.0, &home.0), vec!["%LOCALAPPDATA%/MomGotStuck/Saved/SaveGames"]);

    let renpy = Scratch::new("renpy");
    renpy.write("SexBot/renpy/__init__.py", "");
    renpy.write("SexBot/game/options.rpy", "define config.save_directory = \"SexBot-1689\"\n");
    assert_eq!(detect_engine_save_paths(&renpy.0, &home.0), vec!["%INSTALLDIR%/SexBot/game/saves", "%APPDATA%/RenPy/SexBot-1689"]);

    let mv = Scratch::new("rpgmv");
    mv.write("Game/www/data/System.json", "{}");
    assert_eq!(detect_engine_save_paths(&mv.0, &home.0), vec!["%INSTALLDIR%/Game/www/save"]);

    let ace = Scratch::new("vxace");
    ace.write("Game/Game.rgss3a", "");
    assert_eq!(detect_engine_save_paths(&ace.0, &home.0), vec!["%INSTALLDIR%/Game/Save*"]);
  }

  #[test]
  fn finds_renpy_folders_without_options() {
    let home = Scratch::new("home-renpy");
    fs::create_dir_all(home.0.join("AppData/Roaming/RenPy/SexBot-1234567")).unwrap();
    fs::create_dir_all(home.0.join("AppData/Roaming/RenPy/Other-1")).unwrap();
    let game = Scratch::new("renpy-noopt");
    game.write("SexBot/renpy/__init__.py", "");
    game.write("SexBot/game/script.rpyc", "");
    game.write("SexBot/SexBot.exe", "MZ");
    game.write("SexBot/SexBot-32.exe", "MZ");
    assert!(detect_engine_save_paths(&game.0, &home.0).contains(&"%APPDATA%/RenPy/SexBot-1234567".to_string()));
  }

  #[test]
  fn detects_folders_changed_by_a_session() {
    let home = Scratch::new("home-session");
    let install = Scratch::new("install-session");
    let start = std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
    home.write("AppData/LocalLow/PinkySoul/ExquisiteFishing/sav_0", "save");
    home.write("AppData/LocalLow/Unity/cache.bin", "noise");
    home.write("AppData/Local/OtherApp/state", "unrelated");
    let hints = vec!["Exquisite Fishing".to_string(), "ExquisiteFishing".to_string()];
    assert_eq!(
      detect_session_save_paths(&home.0, &install.0, start, &hints),
      vec!["%LOCALAPPDATALOW%/PinkySoul/ExquisiteFishing"]
    );
    assert!(detect_session_save_paths(&home.0, &install.0, start + 3_600_000, &hints).is_empty());
  }

  #[test]
  fn reads_local_save_paths() {
    let config: serde_json::Map<String, serde_json::Value> =
      serde_json::from_str(r#"{"savepaths":["%APPDATA%/G"," ",7]}"#).unwrap();
    assert_eq!(read_local_save_paths(Some(&config)), vec!["%APPDATA%/G"]);
    assert!(read_local_save_paths(None).is_empty());
  }
}
