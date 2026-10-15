//! Administration → Database Backup / Restore in the desktop app.
//!
//! The backup is streamed straight into the file the user picked and a
//! restore uploads the chosen file from disk, so neither is ever held in
//! memory (database dumps can be large). Both requests carry the database
//! password in `X-Database-Password` (backend `/api/admin/database/*`).

use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;

const PASSWORD_HEADER: &str = "X-Database-Password";
const RESTORE_FIELD: &str = "file";
const UPLOAD_CHUNK: usize = 256 * 1024;

fn http_client() -> Result<reqwest::Client, String> {
  // No total timeout: dumping or restoring a large database takes a while.
  reqwest::Client::builder()
    .connect_timeout(std::time::Duration::from_secs(30))
    .redirect(reqwest::redirect::Policy::none())
    .build()
    .map_err(|error| error.to_string())
}

fn request(
  builder: reqwest::RequestBuilder,
  url: &str,
  auth_header: &str,
  password: &str,
) -> Result<reqwest::RequestBuilder, String> {
  let password = reqwest::header::HeaderValue::from_str(password)
    .map_err(|_| "The database password contains characters that cannot be sent in a request header.".to_string())?;
  let mut builder = crate::net::server_request(builder, url).header(PASSWORD_HEADER, password);
  let auth_header = auth_header.trim();
  if !auth_header.is_empty() {
    builder = builder.header(reqwest::header::AUTHORIZATION, auth_header);
  }
  Ok(builder)
}

/// `HTTP <status>: <message>` with the backend's error message when the body
/// is a JSON error (`{ "message": "..." | ["..."] }`).
pub(crate) fn http_error(status: u16, body: &str) -> String {
  let message = serde_json::from_str::<serde_json::Value>(body)
    .ok()
    .and_then(|value| match value.get("message") {
      Some(serde_json::Value::String(text)) => Some(text.trim().to_string()),
      Some(serde_json::Value::Array(items)) => Some(
        items
          .iter()
          .filter_map(|item| item.as_str())
          .collect::<Vec<_>>()
          .join(" "),
      ),
      _ => None,
    })
    .filter(|text| !text.is_empty());
  match message {
    Some(message) => format!("HTTP {status}: {message}"),
    None => format!("HTTP {status}"),
  }
}

async fn error_from(response: reqwest::Response) -> String {
  let status = response.status().as_u16();
  let body = response.text().await.unwrap_or_default();
  http_error(status, &body)
}

fn absolute_file(path: &str) -> Result<PathBuf, String> {
  let path = PathBuf::from(path);
  if !path.is_absolute() || path.file_name().is_none() {
    return Err("Choose an absolute file path.".into());
  }
  Ok(path)
}

/// A file name that is safe inside the multipart `Content-Disposition`.
pub(crate) fn upload_file_name(path: &Path) -> String {
  let name: String = path
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_default()
    .chars()
    .map(|character| if character.is_control() || matches!(character, '"' | '\\') { '_' } else { character })
    .collect();
  if name.trim().is_empty() { "backup.db".into() } else { name }
}

/// `multipart/form-data` head and tail around the backup file bytes.
pub(crate) fn multipart_frame(boundary: &str, file_name: &str) -> (String, String) {
  (
    format!(
      "--{boundary}\r\nContent-Disposition: form-data; name=\"{RESTORE_FIELD}\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    ),
    format!("\r\n--{boundary}--\r\n"),
  )
}

/// Downloads a database backup into `path` (written to a `.partial` file
/// first, removed again when the download fails). Returns the bytes written.
#[tauri::command]
pub(crate) async fn database_backup_download(
  url: String,
  path: String,
  auth_header: String,
  password: String,
) -> Result<u64, String> {
  let parsed = crate::net::validate_http_url(&url)?;
  let target = absolute_file(&path)?;
  let client = http_client()?;
  let response = request(client.get(parsed), &url, &auth_header, &password)?
    .send()
    .await
    .map_err(|error| format!("Backup failed: {error}"))?;
  if !response.status().is_success() {
    return Err(error_from(response).await);
  }
  crate::cloud_saves::stream_to_file(response, &target).await
}

/// Uploads the backup file at `path` to the restore endpoint as multipart
/// field `file`, streamed from disk.
#[tauri::command]
pub(crate) async fn database_backup_restore(
  url: String,
  path: String,
  auth_header: String,
  password: String,
) -> Result<(), String> {
  let parsed = crate::net::validate_http_url(&url)?;
  let source = absolute_file(&path)?;
  let file = tokio::fs::File::open(&source)
    .await
    .map_err(|error| format!("Failed to open {}: {error}", source.display()))?;
  let length = file.metadata().await.map_err(|error| error.to_string())?.len();
  let boundary = format!("PlayStashRestore{}", crate::cloud_saves::new_uuid()?.replace('-', ""));
  let (head, tail) = multipart_frame(&boundary, &upload_file_name(&source));
  let content_length = head.len() as u64 + length + tail.len() as u64;
  let body = futures_util::stream::unfold(Some(file), |state| async move {
    let mut file = state?;
    let mut buffer = vec![0u8; UPLOAD_CHUNK];
    match file.read(&mut buffer).await {
      Ok(0) => None,
      Ok(read) => {
        buffer.truncate(read);
        Some((Ok::<Vec<u8>, std::io::Error>(buffer), Some(file)))
      }
      Err(error) => Some((Err(error), None)),
    }
  });
  let stream = futures_util::stream::once(async move { Ok::<Vec<u8>, std::io::Error>(head.into_bytes()) })
    .chain(body)
    .chain(futures_util::stream::once(async move { Ok::<Vec<u8>, std::io::Error>(tail.into_bytes()) }));
  let client = http_client()?;
  let response = request(client.post(parsed), &url, &auth_header, &password)?
    .header(reqwest::header::CONTENT_TYPE, format!("multipart/form-data; boundary={boundary}"))
    .header(reqwest::header::CONTENT_LENGTH, content_length)
    .body(reqwest::Body::wrap_stream(stream))
    .send()
    .await
    .map_err(|error| format!("Restore failed: {error}"))?;
  if !response.status().is_success() {
    return Err(error_from(response).await);
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn http_error_uses_the_backend_message() {
    assert_eq!(
      http_error(401, r#"{"message":"The database password provided in the X-Database-Password Header is incorrect.","statusCode":401}"#),
      "HTTP 401: The database password provided in the X-Database-Password Header is incorrect."
    );
    assert_eq!(http_error(400, r#"{"message":["file is required","x"]}"#), "HTTP 400: file is required x");
    assert_eq!(http_error(502, "<html>Bad gateway</html>"), "HTTP 502");
    assert_eq!(http_error(500, r#"{"message":"  "}"#), "HTTP 500");
  }

  #[test]
  fn upload_file_name_is_safe_for_the_multipart_header() {
    assert_eq!(upload_file_name(Path::new("/tmp/backup.db")), "backup.db");
    assert_eq!(upload_file_name(Path::new("/tmp/a\"b\nc.db")), "a_b_c.db");
    assert_eq!(upload_file_name(Path::new("/")), "backup.db");
  }

  #[test]
  fn multipart_frame_names_the_restore_field() {
    let (head, tail) = multipart_frame("B", "dump.db");
    assert_eq!(
      head,
      "--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dump.db\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    );
    assert_eq!(tail, "\r\n--B--\r\n");
  }

  #[test]
  fn rejects_relative_paths_and_unusable_passwords() {
    assert!(absolute_file("backup.db").is_err());
    let client = reqwest::Client::new();
    assert!(request(client.get("https://server.test"), "https://server.test", "", "bad\npassword").is_err());
  }
}
