//! Network + binary-file utility commands that bypass browser CORS and
//! plugin-fs scope restrictions. Used for cross-origin image downloads and
//! reading files dropped from external apps (e.g. dragging an image out of a
//! browser), which WebView2 does not expose through the DOM DataTransfer API.

use base64::Engine as _;
use serde::Serialize;
use futures_util::StreamExt;
use std::io::Read;
use std::path::Path;

const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;

pub(crate) fn validate_http_url(value: &str) -> Result<url::Url, String> {
  let url = url::Url::parse(value).map_err(|error| format!("Invalid URL: {error}"))?;
  if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
    return Err("Only HTTP(S) URLs without embedded credentials are allowed.".into());
  }
  Ok(url)
}

fn append_image_bytes(bytes: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
  if chunk.len() > MAX_IMAGE_BYTES.saturating_sub(bytes.len()) {
    return Err("Image exceeds the 32 MiB limit.".into());
  }
  bytes.extend_from_slice(chunk);
  Ok(())
}

#[derive(Serialize)]
pub(crate) struct FetchedBytes {
  /// Base64 so the bytes never become a JSON array of numbers over IPC.
  bytes_base64: String,
  content_type: String,
}

fn encode_base64(bytes: &[u8]) -> String {
  base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Fetch a URL natively (no CORS). Used to download images pasted/dropped as
/// URLs that the browser cannot `fetch` cross-origin (e.g. img.itch.zone).
#[tauri::command]
pub(crate) async fn fetch_url_bytes(url: String) -> Result<FetchedBytes, String> {
  let url = validate_http_url(&url)?;
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .redirect(reqwest::redirect::Policy::limited(5))
    .build().map_err(|error| error.to_string())?;
  let resp = client
    .get(url)
    .header("Accept", "image/*,*/*;q=0.8")
    .send()
    .await
    .map_err(|e| format!("fetch_url_bytes request failed: {e}"))?;
  if !resp.status().is_success() {
    return Err(format!("fetch_url_bytes HTTP {}", resp.status()));
  }
  let content_type = resp
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("application/octet-stream")
    .to_string();
  if resp.content_length().map(|length| length > MAX_IMAGE_BYTES as u64).unwrap_or(false) {
    return Err("Image exceeds the 32 MiB limit.".into());
  }
  let mut bytes = Vec::new();
  let mut stream = resp.bytes_stream();
  while let Some(chunk) = stream.next().await {
    append_image_bytes(&mut bytes, &chunk.map_err(|error| error.to_string())?)?;
  }
  Ok(FetchedBytes {
    bytes_base64: encode_base64(&bytes),
    content_type,
  })
}

/// Read a file's raw bytes by absolute path. Bypasses plugin-fs scope so we
/// can read temp files handed to us by Tauri's native drag-drop handling.
///
/// Returns Base64: the previous `Vec<u8>` was serialised as a JSON array of
/// numbers, which made a multi-MB image a multi-million-entry array on the
/// renderer's main thread.
#[tauri::command]
pub(crate) async fn fs_read_binary_file(path: String) -> Result<String, String> {
  let path = Path::new(&path);
  let extension = path.extension().and_then(|extension| extension.to_str()).unwrap_or("").to_ascii_lowercase();
  if !path.is_absolute() || !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg") {
    return Err("Only absolute image-file paths can be read.".into());
  }
  let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
  if !file.metadata().map_err(|error| error.to_string())?.is_file() {
    return Err("Image source must be a regular file.".into());
  }
  let mut bytes = Vec::new();
  file.take(MAX_IMAGE_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
  if bytes.len() > MAX_IMAGE_BYTES { return Err("Image exceeds the 32 MiB limit.".into()); }
  Ok(encode_base64(&bytes))
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn rejects_unsupported_schemes_and_embedded_credentials() {
    for input in ["file:///etc/passwd", "ftp://host/image.png", "https://user:secret@host/image.png", "invalid"] {
      assert!(validate_http_url(input).is_err());
    }
    assert!(validate_http_url("https://host/image.png").is_ok());
    assert!(validate_http_url("http://localhost:8080/image.png").is_ok());
  }
  #[test]
  fn caps_streamed_images_even_without_a_content_length() {
    let mut bytes = vec![0; MAX_IMAGE_BYTES - 1];
    append_image_bytes(&mut bytes, &[1]).unwrap();
    assert!(append_image_bytes(&mut bytes, &[2]).is_err());
    assert_eq!(bytes.len(), MAX_IMAGE_BYTES);
  }
}
