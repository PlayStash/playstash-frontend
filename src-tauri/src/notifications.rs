//! OS notifications (WP1), the infrastructure behind `src/utils/osNotify.ts`.
//!
//! Like the WPF `ToastMessageHelper`, every error is swallowed (and logged):
//! a notification must never break the feature that triggered it.

use tauri::AppHandle;
use tauri_plugin_notification::{NotificationExt, PermissionState};

/// Shows a notification. `image_path` is used as the notification icon when
/// it points at an existing file (best effort; how it renders depends on the
/// platform).
pub(crate) fn show(app: &AppHandle, title: &str, body: &str, image_path: Option<&str>) {
  let notification = app.notification();

  // Permission is requested lazily, on the first notification.
  match notification.permission_state() {
    Ok(PermissionState::Granted) => {}
    _ => match notification.request_permission() {
      Ok(PermissionState::Granted) => {}
      Ok(state) => {
        log::info!("[notify] notifications are not permitted ({state:?})");
        return;
      }
      Err(error) => {
        log::warn!("[notify] permission request failed: {error}");
        return;
      }
    },
  }

  let mut builder = notification.builder().title(title).body(body);
  if let Some(path) = image_path.map(str::trim).filter(|path| !path.is_empty()) {
    if std::path::Path::new(path).is_file() {
      builder = builder.icon(path.to_string());
    }
  }
  if let Err(error) = builder.show() {
    log::warn!("[notify] failed to show a notification: {error}");
  }
}

/// Shows an OS notification. `tag` is accepted for API symmetry; the
/// desktop notification backends have no replace-by-tag support.
#[tauri::command]
pub(crate) async fn os_notify(
  app: AppHandle,
  title: String,
  body: String,
  image_path: Option<String>,
  tag: Option<String>,
) -> Result<(), String> {
  let _ = tag;
  show(&app, &title, &body, image_path.as_deref());
  Ok(())
}
