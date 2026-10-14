//! Startup sound (WP7): the chosen audio file is stored in the settings
//! section `startup.json` and played once after login at volume 0.5 for at
//! most 10 seconds.
//!
//! On Windows the sound plays natively through `rodio`, which is not subject
//! to the webview's autoplay policy. Elsewhere (or when the format cannot be
//! decoded natively) the frontend falls back to an `<audio>` element fed by
//! `startup_sound_bytes`.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub(crate) const SECTION: &str = "startup";
pub(crate) const MAX_SOUND_BYTES: u64 = 20 * 1024 * 1024;
pub(crate) const SOUND_EXTENSIONS: [&str; 6] = ["mp3", "wav", "wma", "m4a", "ogg", "flac"];
#[allow(dead_code)] // Used by the Windows playback path only.
pub(crate) const PLAYBACK_LIMIT: std::time::Duration = std::time::Duration::from_secs(10);
#[allow(dead_code)] // Used by the Windows playback path only.
pub(crate) const PLAYBACK_VOLUME: f32 = 0.5;

#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct StartupSection {
  pub(crate) startup_sound: Option<String>,
}

pub(crate) const ERR_TOO_LARGE: &str = "Choose an audio file smaller than 20 MB.";

/// Validates a chosen sound file: absolute, an audio extension, a regular
/// file, at most 20 MiB.
pub(crate) fn validate_sound_file(path: &Path) -> Result<(), String> {
  let extension_ok = path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| SOUND_EXTENSIONS.iter().any(|candidate| ext.eq_ignore_ascii_case(candidate)))
    .unwrap_or(false);
  if !path.is_absolute() || !extension_ok {
    return Err("Choose an audio file (mp3, wav, wma, m4a, ogg, flac).".to_string());
  }
  let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
  if !metadata.is_file() {
    return Err("Choose an audio file (mp3, wav, wma, m4a, ogg, flac).".to_string());
  }
  if metadata.len() > MAX_SOUND_BYTES {
    return Err(ERR_TOO_LARGE.to_string());
  }
  Ok(())
}

fn stored_sound(app: &tauri::AppHandle) -> Option<String> {
  crate::settings::load_section::<StartupSection>(app, SECTION).startup_sound
}

#[tauri::command]
pub(crate) async fn startup_sound_get(app: tauri::AppHandle) -> Result<Option<String>, String> {
  Ok(stored_sound(&app))
}

#[tauri::command]
pub(crate) async fn startup_sound_set(app: tauri::AppHandle, path: String) -> Result<(), String> {
  validate_sound_file(Path::new(&path))?;
  crate::settings::update_section::<StartupSection, _>(&app, SECTION, |section| {
    section.startup_sound = Some(path);
  })
  .map(|_| ())
}

#[tauri::command]
pub(crate) async fn startup_sound_clear(app: tauri::AppHandle) -> Result<(), String> {
  crate::settings::update_section::<StartupSection, _>(&app, SECTION, |section| {
    section.startup_sound = None;
  })
  .map(|_| ())
}

/// Bytes of the stored sound (Base64) for the webview fallback player.
#[tauri::command]
pub(crate) async fn startup_sound_bytes(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let Some(path) = stored_sound(&app) else {
    return Ok(None);
  };
  let path = std::path::PathBuf::from(path);
  if validate_sound_file(&path).is_err() {
    return Ok(None);
  }
  let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
  Ok(Some(base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(windows)]
mod native {
  use super::{PLAYBACK_LIMIT, PLAYBACK_VOLUME};
  use std::sync::atomic::{AtomicU64, Ordering};
  use std::time::{Duration, Instant};

  /// Generation counter: bumping it stops the running playback thread.
  static GENERATION: AtomicU64 = AtomicU64::new(0);

  pub(super) fn stop() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
  }

  /// Plays the file on a dedicated thread (the output stream is not `Send`).
  /// Resolves once decoding started, so the caller knows whether to fall back.
  pub(super) fn play(path: std::path::PathBuf) -> Result<(), String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
      let started = (|| -> Result<_, String> {
        let (stream, handle) = rodio::OutputStream::try_default().map_err(|error| error.to_string())?;
        let file = std::fs::File::open(&path).map_err(|error| error.to_string())?;
        let decoder = rodio::Decoder::new(std::io::BufReader::new(file)).map_err(|error| error.to_string())?;
        let sink = rodio::Sink::try_new(&handle).map_err(|error| error.to_string())?;
        sink.set_volume(PLAYBACK_VOLUME);
        sink.append(decoder);
        Ok((stream, sink))
      })();
      match started {
        Ok((_stream, sink)) => {
          let _ = ready_tx.send(Ok(()));
          let deadline = Instant::now() + PLAYBACK_LIMIT;
          while Instant::now() < deadline && !sink.empty() && GENERATION.load(Ordering::SeqCst) == generation {
            std::thread::sleep(Duration::from_millis(50));
          }
          sink.stop();
        }
        Err(error) => {
          let _ = ready_tx.send(Err(error));
        }
      }
    });
    ready_rx
      .recv_timeout(Duration::from_secs(5))
      .map_err(|_| "Startup sound did not start.".to_string())?
  }
}

/// Plays the stored startup sound natively. Returns `"played"`, `"none"` when
/// no (valid) sound is configured, or `"fallback"` when the webview should
/// play it instead.
#[tauri::command]
pub(crate) async fn startup_sound_play(app: tauri::AppHandle) -> Result<String, String> {
  let Some(path) = stored_sound(&app) else {
    return Ok("none".to_string());
  };
  let path = std::path::PathBuf::from(path);
  if validate_sound_file(&path).is_err() {
    return Ok("none".to_string());
  }
  play_native(path).await
}

#[cfg(windows)]
async fn play_native(path: std::path::PathBuf) -> Result<String, String> {
  let result = tauri::async_runtime::spawn_blocking(move || native::play(path))
    .await
    .map_err(|error| error.to_string())?;
  Ok(match result {
    Ok(()) => "played".to_string(),
    Err(error) => {
      log::warn!("Native startup sound playback failed, using the webview: {error}");
      "fallback".to_string()
    }
  })
}

#[cfg(not(windows))]
async fn play_native(_path: std::path::PathBuf) -> Result<String, String> {
  Ok("fallback".to_string())
}

#[tauri::command]
pub(crate) async fn startup_sound_stop() -> Result<(), String> {
  #[cfg(windows)]
  native::stop();
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn sound_files_need_an_absolute_audio_path() {
    assert!(validate_sound_file(Path::new("relative.mp3")).is_err());
    let dir = std::env::temp_dir();
    let missing = dir.join("playstash-missing-startup-sound.mp3");
    assert!(validate_sound_file(&missing).is_err());
    let not_audio = dir.join("playstash-startup-sound.txt");
    assert!(validate_sound_file(&not_audio).is_err());
  }

  #[test]
  fn sound_files_over_20_mib_are_rejected() {
    let path = std::env::temp_dir().join(format!("playstash-startup-sound-{}.wav", std::process::id()));
    let file = std::fs::File::create(&path).unwrap();
    file.set_len(MAX_SOUND_BYTES + 1).unwrap();
    drop(file);
    assert_eq!(validate_sound_file(&path).unwrap_err(), ERR_TOO_LARGE);
    std::fs::File::create(&path).unwrap().set_len(1024).unwrap();
    assert!(validate_sound_file(&path).is_ok());
    let _ = std::fs::remove_file(&path);
  }

  #[test]
  fn section_defaults_to_no_sound() {
    let section: StartupSection = serde_json::from_str("{}").unwrap();
    assert_eq!(section, StartupSection::default());
    let section: StartupSection = serde_json::from_str(r#"{"startupSound":"C:\\a.mp3"}"#).unwrap();
    assert_eq!(section.startup_sound.as_deref(), Some("C:\\a.mp3"));
  }
}
