use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Clone, Default, Deserialize, Serialize)]
pub(crate) struct PostInstallConfig {
  pub script: Option<String>,
  #[serde(default)]
  pub arguments: Vec<String>,
}

#[tauri::command]
pub(crate) fn get_post_install_config(app: tauri::AppHandle) -> PostInstallConfig {
  crate::settings::load_settings(&app).post_install
}

#[tauri::command]
pub(crate) fn set_post_install_config(app: tauri::AppHandle, config: PostInstallConfig) -> Result<(), String> {
  if let Some(script) = config.script.as_ref() {
    let path = PathBuf::from(script);
    if !path.is_absolute() || !path.is_file() { return Err("Choose an existing script using its absolute path.".into()); }
  }
  let mut settings = crate::settings::load_settings(&app);
  settings.post_install = config;
  crate::settings::save_settings(&app, &settings)
}

fn expand_arguments(arguments: &[String], installation_path: &str) -> Vec<String> {
  arguments.iter().map(|argument| argument.replace("%F", installation_path)).collect()
}

#[tauri::command]
pub(crate) async fn run_post_install_script(app: tauri::AppHandle, installation_path: String, version_directory: String) -> Result<(), String> {
  let config = crate::settings::load_settings(&app).post_install;
  let Some(script) = config.script else { return Ok(()); };
  tauri::async_runtime::spawn_blocking(move || {
    let install = PathBuf::from(&installation_path).canonicalize().map_err(|error| error.to_string())?;
    let version = PathBuf::from(&version_directory).canonicalize().map_err(|error| error.to_string())?;
    if !install.is_dir() || !version.is_dir() { return Err("Installation folders are unavailable.".into()); }
    let metadata: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(version.join(".playstash.game.config.json")).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    if metadata.get("installationfinished").and_then(|value| value.as_bool()) != Some(true) { return Err("The installation has not completed.".into()); }
    let marker = version.join(".playstash.post-install.json");
    let handle = match std::fs::OpenOptions::new().write(true).create_new(true).open(&marker) {
      Ok(handle) => handle,
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
      Err(error) => return Err(error.to_string()),
    };
    drop(handle);
    std::fs::write(&marker, r#"{"status":"started"}"#).map_err(|error| error.to_string())?;
    let mut command = if script.to_lowercase().ends_with(".ps1") {
      let mut command = Command::new("powershell.exe"); command.args(["-NoProfile", "-NonInteractive", "-File", &script]); command
    } else if script.to_lowercase().ends_with(".sh") {
      let mut command = Command::new("sh"); command.arg(&script); command
    } else { Command::new(&script) };
    command.args(expand_arguments(&config.arguments, &installation_path)).current_dir(&install).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let result = command.status().map_err(|error| error.to_string()).and_then(|status| if status.success() { Ok(()) } else { Err(format!("Post-install script exited with {status}.")) });
    let state = if result.is_ok() { "completed" } else { "failed" };
    std::fs::write(&marker, serde_json::json!({"status":state}).to_string()).map_err(|error| error.to_string())?;
    result
  }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn installation_paths_remain_single_literal_arguments() {
    assert_eq!(expand_arguments(&["%F".into(), "--path=%F".into()], "/games/My Game; echo nope"), vec!["/games/My Game; echo nope", "--path=/games/My Game; echo nope"]);
  }
}
