use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

/// This module manages the auto-unlock password for the Stronghold vault.
///
/// The Stronghold vault (see `tauri-plugin-stronghold`) stores the auth refresh
/// token encrypted at rest. To unlock it automatically across restarts (so the
/// user stays logged in without re-entering a password), we keep a random vault
/// password in the app's local data directory, restricted to the current user.
///
/// This is a pragmatic cross-platform trade-off: Stronghold is the official
/// Tauri secret-store plugin and works on Windows, macOS and Linux, but it
/// requires a password to derive the encryption key. Persisting that password
/// in an owner-only file moves the token out of the webview's `localStorage`
/// and protects persisted data from casual inspection. Native frontend code
/// can access the vault through IPC, so this does not protect against injected
/// code in a trusted webview. For
/// stronger hardening this password could instead be stored in the OS keychain
/// (Keychain / Credential Manager / Secret Service) — the structure here is
/// isolated so that can be swapped in without touching the frontend.
fn vault_password_path(app: &tauri::AppHandle) -> PathBuf {
  app.path()
    .app_local_data_dir()
    .unwrap_or_else(|_| app.path().app_data_dir().unwrap())
    .join("vault-password")
}

fn generate_random_password() -> Result<String, String> {
  let mut bytes = [0u8; 32];
  getrandom::getrandom(&mut bytes).map_err(|error| format!("Secure randomness unavailable: {error}"))?;
  Ok(bytes.iter().map(|b| format!("{:02x}", b)).collect())
}

fn read_password(path: &Path) -> Result<String, String> {
  let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
  if !metadata.file_type().is_file() {
    return Err("Vault password must be a regular file, not a symbolic link.".into());
  }
  #[cfg(unix)]
  {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    if metadata.nlink() != 1 {
      return Err("Vault password must not have hard links.".into());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
  }
  let mut password = String::new();
  fs::File::open(path).map_err(|error| error.to_string())?
    .take(1024).read_to_string(&mut password).map_err(|error| error.to_string())?;
  let password = password.trim();
  if password.len() != 64 || !password.bytes().all(|byte| byte.is_ascii_hexdigit()) {
    return Err("Vault password is invalid; refusing to replace an existing secret.".into());
  }
  Ok(password.into())
}

fn create_or_read_password(path: &Path) -> Result<String, String> {
  if fs::symlink_metadata(path).is_ok() { return read_password(path); }
  let password = generate_random_password()?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  let mut options = fs::OpenOptions::new();
  options.write(true).create_new(true);
  // Restrict access at creation time, before any secret bytes reach disk.
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = match options.open(path) {
    Ok(file) => file,
    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return read_password(path),
    Err(error) => return Err(error.to_string()),
  };
  file.write_all(password.as_bytes()).and_then(|_| file.sync_all()).map_err(|error| error.to_string())?;
  Ok(password)
}

/// Returns the Stronghold vault password, creating and persisting it on first
/// run so the vault can be unlocked automatically on subsequent launches.
/// On Unix the file is restricted to its owner (mode 0600).
#[tauri::command]
pub(crate) fn get_or_create_vault_password(app: tauri::AppHandle) -> Result<String, String> {
  let path = vault_password_path(&app);

  create_or_read_password(&path)
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn creates_private_random_password_without_replacing_existing_secret() {
    let root = std::env::temp_dir().join(format!("playstash-vault-{}", generate_random_password().unwrap()));
    let path = root.join("password");
    let first = create_or_read_password(&path).unwrap();
    assert_eq!(first.len(), 64);
    assert_eq!(create_or_read_password(&path).unwrap(), first);
    #[cfg(unix)] {
      use std::os::unix::fs::PermissionsExt;
      assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    fs::write(&path, "invalid").unwrap();
    assert!(create_or_read_password(&path).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "invalid");
    fs::remove_dir_all(root).unwrap();
  }
  #[cfg(unix)]
  #[test]
  fn refuses_symlink_and_hardlink_secrets() {
    let root = std::env::temp_dir().join(format!("playstash-vault-links-{}", generate_random_password().unwrap()));
    fs::create_dir_all(&root).unwrap();
    let secret = root.join("secret");
    fs::write(&secret, generate_random_password().unwrap()).unwrap();
    let link = root.join("link");
    std::os::unix::fs::symlink(&secret, &link).unwrap();
    assert!(create_or_read_password(&link).is_err());
    fs::remove_file(&link).unwrap();
    fs::hard_link(&secret, &link).unwrap();
    assert!(create_or_read_password(&link).is_err());
    fs::remove_dir_all(root).unwrap();
  }
}
