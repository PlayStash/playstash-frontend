//! "Mount ISO instead of extracting".
//!
//! A downloaded `.iso` can be attached as a virtual drive instead of being
//! unpacked. The game is then installed straight from the mounted volume. The
//! image stays mounted until the user unmounts it, like in the old client.
//!
//! - Windows: PowerShell `Mount-DiskImage`. The image path goes through the
//!   `PLAYSTASH_MOUNT_ISO` environment variable, never through the script
//!   text, so a crafted file name cannot inject PowerShell code.
//! - macOS: `hdiutil attach -nobrowse -plist`.
//! - Linux: `udisksctl loop-setup` + `udisksctl mount` (needs udisks2; may be
//!   unavailable inside sandboxes, the frontend then falls back to extraction).

use std::path::{Path, PathBuf};
#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Hides the console window of the helper process on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// PowerShell script that attaches the image (or reuses an existing mount)
/// and prints its drive letter. The image path is read from the environment.
#[cfg(windows)]
const WINDOWS_MOUNT_SCRIPT: &str = "$diskImage = Get-DiskImage -ImagePath $env:PLAYSTASH_MOUNT_ISO -ErrorAction Stop; \
if (-not $diskImage.Attached) { $diskImage = Mount-DiskImage -ImagePath $env:PLAYSTASH_MOUNT_ISO -PassThru -ErrorAction Stop }; \
($diskImage | Get-Volume).DriveLetter";

/// Checks that `path` is an existing, absolute `.iso` file.
fn validate_iso_path(path: &Path) -> Result<PathBuf, String> {
  if !path.is_absolute() {
    return Err("The ISO path must be absolute.".to_string());
  }
  let is_iso = path
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.eq_ignore_ascii_case("iso"))
    .unwrap_or(false);
  if !is_iso {
    return Err("Only .iso images can be mounted.".to_string());
  }
  let metadata = std::fs::metadata(path).map_err(|error| format!("ISO not found: {error}"))?;
  if !metadata.is_file() {
    return Err("The ISO path is not a file.".to_string());
  }
  Ok(path.to_path_buf())
}

#[cfg(any(windows, test))]
/// Turns the PowerShell output (the drive letter, possibly surrounded by
/// blank lines) into a mount root such as `E:\`.
pub(crate) fn parse_windows_drive_letter(stdout: &str) -> Option<String> {
  let letter = stdout
    .lines()
    .map(str::trim)
    .rfind(|line| !line.is_empty())?;
  let mut chars = letter.chars();
  let first = chars.next()?;
  if chars.next().is_some() || !first.is_ascii_alphabetic() {
    return None;
  }
  Some(format!("{}:\\", first.to_ascii_uppercase()))
}

#[cfg(any(target_os = "macos", test))]
fn decode_xml_entities(value: &str) -> String {
  value
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&apos;", "'")
    .replace("&amp;", "&")
}

#[cfg(any(target_os = "macos", test))]
/// Extracts the first `mount-point` from `hdiutil attach -plist` output.
pub(crate) fn parse_hdiutil_mount_point(plist: &str) -> Option<String> {
  let key_index = plist.find("<key>mount-point</key>")?;
  let rest = &plist[key_index + "<key>mount-point</key>".len()..];
  let start = rest.find("<string>")? + "<string>".len();
  let end = rest[start..].find("</string>")? + start;
  let value = decode_xml_entities(rest[start..end].trim());
  if value.is_empty() {
    None
  } else {
    Some(value)
  }
}

#[cfg(any(target_os = "linux", test))]
/// Extracts the loop device from `udisksctl loop-setup` output, e.g.
/// `Mapped file /games/x.iso as /dev/loop0.`
pub(crate) fn parse_udisks_loop_device(stdout: &str) -> Option<String> {
  let index = stdout.rfind(" as /dev/")?;
  let device = stdout[index + 4..]
    .split_whitespace()
    .next()?
    .trim_end_matches('.')
    .to_string();
  if device.len() > "/dev/".len() {
    Some(device)
  } else {
    None
  }
}

#[cfg(any(target_os = "linux", test))]
/// Extracts the mount path from `udisksctl mount` output
/// (`Mounted /dev/loop0 at /run/media/me/GAME.`) or from the "already mounted"
/// error (``... is already mounted at `/run/media/me/GAME'.``).
pub(crate) fn parse_udisks_mount_path(output: &str) -> Option<String> {
  if let Some(index) = output.find("already mounted at ") {
    let rest = &output[index + "already mounted at ".len()..];
    let rest = rest.trim_start_matches(['`', '\'', '"']);
    let end = rest.find(['\'', '`', '"', '\n']).unwrap_or(rest.len());
    let path = rest[..end].trim().trim_end_matches('.');
    return if path.is_empty() { None } else { Some(path.to_string()) };
  }
  let index = output.find(" at ")?;
  let line = output[index + 4..].lines().next()?.trim();
  let path = line.trim_end_matches('.').trim();
  if path.starts_with('/') {
    Some(path.to_string())
  } else {
    None
  }
}

#[cfg(windows)]
fn mount_platform(iso: &Path) -> Result<String, String> {
  let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
  let powershell = PathBuf::from(system_root)
    .join("System32")
    .join("WindowsPowerShell")
    .join("v1.0")
    .join("powershell.exe");
  let output = Command::new(powershell)
    .args(["-NoProfile", "-NonInteractive", "-Command", WINDOWS_MOUNT_SCRIPT])
    .env("PLAYSTASH_MOUNT_ISO", iso)
    .creation_flags(CREATE_NO_WINDOW)
    .output()
    .map_err(|error| format!("Could not start PowerShell: {error}"))?;
  let stdout = String::from_utf8_lossy(&output.stdout);
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(first_line(&stderr).unwrap_or_else(|| "Mount-DiskImage failed.".to_string()));
  }
  parse_windows_drive_letter(&stdout)
    .ok_or_else(|| "The mounted image has no drive letter.".to_string())
}

#[cfg(target_os = "macos")]
fn mount_platform(iso: &Path) -> Result<String, String> {
  let output = Command::new("hdiutil")
    .args(["attach", "-nobrowse", "-plist"])
    .arg(iso)
    .output()
    .map_err(|error| format!("Could not start hdiutil: {error}"))?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(first_line(&stderr).unwrap_or_else(|| "hdiutil attach failed.".to_string()));
  }
  parse_hdiutil_mount_point(&String::from_utf8_lossy(&output.stdout))
    .ok_or_else(|| "hdiutil did not report a mount point.".to_string())
}

#[cfg(target_os = "linux")]
fn mount_platform(iso: &Path) -> Result<String, String> {
  let setup = Command::new("udisksctl")
    .args(["loop-setup", "-r", "-f"])
    .arg(iso)
    .output()
    .map_err(|error| format!("Could not start udisksctl: {error}"))?;
  let setup_stdout = String::from_utf8_lossy(&setup.stdout);
  if !setup.status.success() {
    let stderr = String::from_utf8_lossy(&setup.stderr);
    return Err(first_line(&stderr).unwrap_or_else(|| "udisksctl loop-setup failed.".to_string()));
  }
  let device = parse_udisks_loop_device(&setup_stdout)
    .ok_or_else(|| "udisksctl did not report a loop device.".to_string())?;

  // udisks may auto-mount the new loop device; the "already mounted" error
  // then carries the mount path.
  let mount = Command::new("udisksctl")
    .args(["mount", "-b", &device])
    .output()
    .map_err(|error| format!("Could not start udisksctl: {error}"))?;
  let combined = format!(
    "{}\n{}",
    String::from_utf8_lossy(&mount.stdout),
    String::from_utf8_lossy(&mount.stderr)
  );
  parse_udisks_mount_path(&combined).ok_or_else(|| {
    first_line(&String::from_utf8_lossy(&mount.stderr))
      .unwrap_or_else(|| "udisksctl mount failed.".to_string())
  })
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn mount_platform(_iso: &Path) -> Result<String, String> {
  Err("Mounting ISO images is not supported on this platform.".to_string())
}

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
fn first_line(text: &str) -> Option<String> {
  text
    .lines()
    .map(str::trim)
    .find(|line| !line.is_empty())
    .map(str::to_string)
}

/// Mounts the ISO at `iso_path` and returns the mount root (e.g. `E:\` or
/// `/Volumes/GAME`).
#[tauri::command]
pub(crate) async fn mount_iso(iso_path: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let iso = validate_iso_path(Path::new(&iso_path))?;
    let mount_root = mount_platform(&iso)?;
    if !Path::new(&mount_root).exists() {
      return Err(format!("The mount point {mount_root} is not accessible."));
    }
    Ok(mount_root)
  })
  .await
  .map_err(|error| format!("Mounting the ISO failed: {error}"))?
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_the_windows_drive_letter() {
    assert_eq!(parse_windows_drive_letter("E\r\n"), Some("E:\\".to_string()));
    assert_eq!(parse_windows_drive_letter("\r\n\r\nf\r\n\r\n"), Some("F:\\".to_string()));
    assert_eq!(parse_windows_drive_letter(""), None);
    assert_eq!(parse_windows_drive_letter("EF"), None);
    assert_eq!(parse_windows_drive_letter("1"), None);
  }

  #[test]
  fn parses_the_hdiutil_mount_point() {
    let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>system-entities</key>
  <array>
    <dict>
      <key>dev-entry</key>
      <string>/dev/disk4</string>
      <key>potentially-mountable</key>
      <false/>
    </dict>
    <dict>
      <key>dev-entry</key>
      <string>/dev/disk4s1</string>
      <key>mount-point</key>
      <string>/Volumes/My Game &amp; More</string>
    </dict>
  </array>
</dict>
</plist>"#;
    assert_eq!(
      parse_hdiutil_mount_point(plist),
      Some("/Volumes/My Game & More".to_string())
    );
    assert_eq!(parse_hdiutil_mount_point("<plist></plist>"), None);
  }

  #[test]
  fn parses_udisksctl_output() {
    assert_eq!(
      parse_udisks_loop_device("Mapped file /games/x.iso as /dev/loop12.\n"),
      Some("/dev/loop12".to_string())
    );
    assert_eq!(parse_udisks_loop_device("Error setting up loop device"), None);
    assert_eq!(
      parse_udisks_mount_path("Mounted /dev/loop12 at /run/media/me/GAME_DISC\n"),
      Some("/run/media/me/GAME_DISC".to_string())
    );
    assert_eq!(
      parse_udisks_mount_path("Mounted /dev/loop12 at /media/GAME.\n"),
      Some("/media/GAME".to_string())
    );
    assert_eq!(
      parse_udisks_mount_path(
        "Error mounting /dev/loop12: GDBus.Error:org.freedesktop.UDisks2.Error.AlreadyMounted: Device /dev/loop12 is already mounted at `/run/media/me/GAME'.\n"
      ),
      Some("/run/media/me/GAME".to_string())
    );
    assert_eq!(parse_udisks_mount_path("Error: not authorized"), None);
  }

  #[test]
  fn rejects_non_iso_and_relative_paths() {
    assert!(validate_iso_path(Path::new("game.iso")).is_err());
    let absolute = std::env::temp_dir().join("playstash-not-an-image.zip");
    assert!(validate_iso_path(&absolute).is_err());
    let missing = std::env::temp_dir().join("playstash-missing-image.iso");
    assert!(validate_iso_path(&missing).is_err());
  }
}
