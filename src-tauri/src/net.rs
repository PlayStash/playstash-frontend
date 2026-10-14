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

// Additional request headers ("Client Settings") and the server context they
// are scoped to. Every Rust request to the PlayStash server is built through
// `server_request`, which adds the headers only when the request targets the
// configured server (same scheme, host, port and path prefix). They are never
// sent to any other host.
pub(crate) use request_headers::*;

pub(crate) mod request_headers {
  use serde::{Deserialize, Serialize};
  use std::sync::{OnceLock, RwLock};

  /// Header names the user may not override: they carry the session, select
  /// the virtual host or are managed by the HTTP client itself.
  const FORBIDDEN_HEADERS: &[&str] = &["authorization", "host", "cookie", "content-length"];
  const CONNECTION_SECTION: &str = "connection";

  #[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase", default)]
  pub(crate) struct RequestHeaderEntry {
    pub name: String,
    pub value: String,
  }

  /// Rust settings section `connection.json`.
  #[derive(Clone, Debug, Default, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase", default)]
  struct ConnectionSection {
    additional_request_headers: Vec<RequestHeaderEntry>,
    server_url: String,
  }

  #[derive(Default)]
  struct ServerContext {
    server: Option<url::Url>,
    headers: Vec<(reqwest::header::HeaderName, reqwest::header::HeaderValue)>,
  }

  fn context() -> &'static RwLock<ServerContext> {
    static CONTEXT: OnceLock<RwLock<ServerContext>> = OnceLock::new();
    CONTEXT.get_or_init(Default::default)
  }

  /// RFC 7230 `token` characters.
  fn is_token_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
  }

  /// Validates one header. Returns the parsed pair or a user-facing message.
  pub(crate) fn validate_header(
    name: &str,
    value: &str,
  ) -> Result<(reqwest::header::HeaderName, reqwest::header::HeaderValue), String> {
    let name = name.trim();
    if name.is_empty() || !name.bytes().all(is_token_char) {
      return Err(format!("\"{name}\" is not a valid header name."));
    }
    if FORBIDDEN_HEADERS.iter().any(|forbidden| forbidden.eq_ignore_ascii_case(name)) {
      return Err(format!("The header \"{name}\" cannot be overridden."));
    }
    let value = value.trim();
    if value.bytes().any(|byte| byte == b'\r' || byte == b'\n' || byte == 0) {
      return Err(format!("The value of \"{name}\" must be a single line."));
    }
    let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
      .map_err(|_| format!("\"{name}\" is not a valid header name."))?;
    let header_value = reqwest::header::HeaderValue::from_str(value)
      .map_err(|_| format!("The value of \"{name}\" contains unsupported characters."))?;
    Ok((header_name, header_value))
  }

  /// Drops entries with an empty name or value (like the WPF client) and
  /// validates the rest.
  pub(crate) fn sanitize_headers(entries: Vec<RequestHeaderEntry>) -> Result<Vec<RequestHeaderEntry>, String> {
    let mut kept = Vec::new();
    for entry in entries {
      let name = entry.name.trim().to_string();
      let value = entry.value.trim().to_string();
      if name.is_empty() || value.is_empty() {
        continue;
      }
      validate_header(&name, &value)?;
      kept.push(RequestHeaderEntry { name, value });
    }
    Ok(kept)
  }

  /// Parses a server base URL: http(s), a host, no credentials, query or fragment.
  pub(crate) fn parse_server_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value.trim()).map_err(|error| format!("Invalid server URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https")
      || url.host_str().map(str::is_empty).unwrap_or(true)
      || !url.username().is_empty()
      || url.password().is_some()
      || url.query().is_some()
      || url.fragment().is_some()
    {
      return Err("Enter a valid HTTP or HTTPS server URL, such as https://server.example.".into());
    }
    Ok(url)
  }

  /// Mirrors the WPF `RequestTrust.IsServerResource`: same scheme, host and
  /// port, no credentials, no encoded slashes or dot segments, and a path
  /// equal to or below the server's path prefix.
  pub(crate) fn is_server_resource(server: &url::Url, target: &url::Url) -> bool {
    if !matches!(server.scheme(), "http" | "https") || server.scheme() != target.scheme() {
      return false;
    }
    match (server.host_str(), target.host_str()) {
      (Some(a), Some(b)) if a.eq_ignore_ascii_case(b) => {}
      _ => return false,
    }
    if server.port_or_known_default() != target.port_or_known_default() {
      return false;
    }
    if !target.username().is_empty() || target.password().is_some() {
      return false;
    }
    let raw_path = target.path();
    let lowered = raw_path.to_ascii_lowercase();
    if lowered.contains("%2f") || lowered.contains("%5c") || raw_path.contains('\\') {
      return false;
    }
    let has_dot_segment = raw_path.split('/').any(|segment| {
      let decoded = urlencoding::decode(segment).map(|value| value.into_owned()).unwrap_or_default();
      decoded == "." || decoded == ".."
    });
    if has_dot_segment {
      return false;
    }
    let prefix = server.path().trim_end_matches('/');
    raw_path == prefix || raw_path.starts_with(&format!("{prefix}/"))
  }

  fn apply_to_context(server_url: &str, headers: &[RequestHeaderEntry]) {
    let server = if server_url.trim().is_empty() { None } else { parse_server_url(server_url).ok() };
    let parsed = headers
      .iter()
      .filter_map(|entry| validate_header(&entry.name, &entry.value).ok())
      .collect();
    if let Ok(mut guard) = context().write() {
      guard.server = server;
      guard.headers = parsed;
    }
  }

  /// Adds the additional request headers to `builder` when `url` is a
  /// resource of the configured server. All Rust server requests use this.
  pub(crate) fn server_request(builder: reqwest::RequestBuilder, url: &str) -> reqwest::RequestBuilder {
    let Ok(target) = url::Url::parse(url) else { return builder };
    let Ok(guard) = context().read() else { return builder };
    let Some(server) = guard.server.as_ref() else { return builder };
    if guard.headers.is_empty() || !is_server_resource(server, &target) {
      return builder;
    }
    guard
      .headers
      .iter()
      .fold(builder, |builder, (name, value)| builder.header(name.clone(), value.clone()))
  }

  /// Loads the persisted headers and server into memory. Called from setup,
  /// so requests started before the webview loads already carry them.
  pub(crate) fn load_connection_context(app: &tauri::AppHandle) {
    let section: ConnectionSection = crate::settings::load_section(app, CONNECTION_SECTION);
    apply_to_context(&section.server_url, &section.additional_request_headers);
  }

  /// Stores the additional request headers (global, not secret: the WPF
  /// client kept them in plain text as well). Returns the saved list.
  #[tauri::command]
  pub(crate) async fn set_additional_request_headers(
    app: tauri::AppHandle,
    headers: Vec<RequestHeaderEntry>,
  ) -> Result<Vec<RequestHeaderEntry>, String> {
    let headers = sanitize_headers(headers)?;
    let saved = crate::settings::update_section::<ConnectionSection, _>(&app, CONNECTION_SECTION, |section| {
      section.additional_request_headers = headers.clone();
    })?;
    apply_to_context(&saved.server_url, &saved.additional_request_headers);
    Ok(saved.additional_request_headers)
  }

  #[tauri::command]
  pub(crate) async fn get_additional_request_headers(app: tauri::AppHandle) -> Vec<RequestHeaderEntry> {
    crate::settings::load_section::<ConnectionSection>(&app, CONNECTION_SECTION).additional_request_headers
  }

  /// Sets the server the additional headers belong to (the active profile's
  /// server). An empty value clears it.
  #[tauri::command]
  pub(crate) async fn set_server_context(app: tauri::AppHandle, server_url: Option<String>) -> Result<(), String> {
    let server_url = server_url.unwrap_or_default();
    let normalized = if server_url.trim().is_empty() {
      String::new()
    } else {
      parse_server_url(&server_url)?.as_str().trim_end_matches('/').to_string()
    };
    let saved = crate::settings::update_section::<ConnectionSection, _>(&app, CONNECTION_SECTION, |section| {
      section.server_url = normalized.clone();
    })?;
    apply_to_context(&saved.server_url, &saved.additional_request_headers);
    Ok(())
  }

  fn native_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
      return Ok(client);
    }
    let client = reqwest::Client::builder()
      .redirect(reqwest::redirect::Policy::none())
      .connect_timeout(std::time::Duration::from_secs(30))
      .build()
      .map_err(|error| error.to_string())?;
    Ok(CLIENT.get_or_init(|| client))
  }

  /// Headers the webview may not set on a proxied request (the HTTP client
  /// manages them).
  fn is_managed_header(name: &str) -> bool {
    ["host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade"]
      .iter()
      .any(|managed| managed.eq_ignore_ascii_case(name.trim()))
  }

  #[derive(Serialize)]
  #[serde(rename_all = "camelCase")]
  struct NativeResponseMeta {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    url: String,
  }

  /// Packs the response as `[u32 BE meta length][meta JSON][body]`, so the
  /// body crosses the IPC boundary as raw bytes instead of a JSON array.
  pub(crate) fn pack_response(meta_json: &[u8], body: &[u8]) -> Vec<u8> {
    let mut packed = Vec::with_capacity(4 + meta_json.len() + body.len());
    packed.extend_from_slice(&(meta_json.len() as u32).to_be_bytes());
    packed.extend_from_slice(meta_json);
    packed.extend_from_slice(body);
    packed
  }

  /// Sends a request to the configured server from Rust instead of the
  /// webview. Used by `authFetch` when additional request headers are
  /// configured: custom headers on a cross-origin webview request trigger a
  /// CORS preflight, which reverse proxies such as Cloudflare Access reject.
  /// Only resources of the configured server are allowed.
  #[tauri::command]
  pub(crate) async fn server_fetch(
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body_base64: Option<String>,
  ) -> Result<tauri::ipc::Response, String> {
    use base64::Engine as _;
    let target = super::validate_http_url(&url)?;
    let allowed = context()
      .read()
      .ok()
      .and_then(|guard| guard.server.as_ref().map(|server| is_server_resource(server, &target)))
      .unwrap_or(false);
    if !allowed {
      return Err("Native requests must target the configured PlayStash server.".into());
    }
    let method = reqwest::Method::from_bytes(method.trim().to_ascii_uppercase().as_bytes())
      .map_err(|_| "Unsupported HTTP method.".to_string())?;
    let mut builder = native_client()?.request(method, target.clone());
    for (name, value) in headers {
      if is_managed_header(&name) {
        continue;
      }
      let name = reqwest::header::HeaderName::from_bytes(name.trim().as_bytes())
        .map_err(|_| "Invalid request header name.".to_string())?;
      let value = reqwest::header::HeaderValue::from_str(&value)
        .map_err(|_| "Invalid request header value.".to_string())?;
      builder = builder.header(name, value);
    }
    if let Some(body) = body_base64 {
      let bytes = base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|_| "Invalid request body.".to_string())?;
      builder = builder.body(bytes);
    }
    let response = server_request(builder, target.as_str())
      .send()
      .await
      .map_err(|error| format!("Request failed: {error}"))?;
    let status = response.status();
    let meta = NativeResponseMeta {
      status: status.as_u16(),
      status_text: status.canonical_reason().unwrap_or("").to_string(),
      headers: response
        .headers()
        .iter()
        .filter_map(|(name, value)| value.to_str().ok().map(|value| (name.as_str().to_string(), value.to_string())))
        .collect(),
      url: response.url().to_string(),
    };
    let body = response.bytes().await.map_err(|error| format!("Reading the response failed: {error}"))?;
    let meta_json = serde_json::to_vec(&meta).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(pack_response(&meta_json, &body)))
  }

  #[cfg(test)]
  mod tests {
    use super::*;

    fn url(value: &str) -> url::Url {
      url::Url::parse(value).unwrap()
    }

    #[test]
    fn server_resources_require_same_scheme_host_port_and_prefix() {
      let server = url("https://games.example.com/playstash");
      assert!(is_server_resource(&server, &url("https://games.example.com/playstash")));
      assert!(is_server_resource(&server, &url("https://GAMES.example.com/playstash/api/games")));
      assert!(is_server_resource(&server, &url("https://games.example.com:443/playstash/api")));
      assert!(!is_server_resource(&server, &url("http://games.example.com/playstash/api")));
      assert!(!is_server_resource(&server, &url("https://games.example.com:8443/playstash/api")));
      assert!(!is_server_resource(&server, &url("https://evil.example.com/playstash/api")));
      assert!(!is_server_resource(&server, &url("https://games.example.com/playstashx/api")));
      assert!(!is_server_resource(&server, &url("https://games.example.com/other")));
      assert!(!is_server_resource(&server, &url("https://user:pw@games.example.com/playstash/api")));
      assert!(!is_server_resource(&server, &url("https://games.example.com/playstash%2fapi")));
      assert!(!is_server_resource(&server, &url("https://games.example.com/playstash/api%2F..%2Fx")));
      assert!(!is_server_resource(&server, &url("https://games.example.com/playstash/a%5cb")));
    }

    #[test]
    fn root_servers_match_every_path_on_the_origin() {
      let server = url("http://localhost:8080");
      assert!(is_server_resource(&server, &url("http://localhost:8080/api/status")));
      assert!(!is_server_resource(&server, &url("http://localhost:8081/api/status")));
      assert!(!is_server_resource(&server, &url("https://localhost:8080/api/status")));
    }

    #[test]
    fn dot_segments_cannot_escape_the_prefix() {
      let server = url("https://host/sub");
      // The URL parser resolves "..", so this lands outside the prefix.
      assert!(!is_server_resource(&server, &url("https://host/sub/../api")));
      assert!(!is_server_resource(&server, &url("https://host/sub/%2e%2e/api")));
    }

    #[test]
    fn headers_are_validated_and_empty_entries_dropped() {
      let entries = vec![
        RequestHeaderEntry { name: "CF-Access-Client-Id".into(), value: "abc".into() },
        RequestHeaderEntry { name: "".into(), value: "x".into() },
        RequestHeaderEntry { name: "X-Empty".into(), value: " ".into() },
      ];
      let kept = sanitize_headers(entries).unwrap();
      assert_eq!(kept, vec![RequestHeaderEntry { name: "CF-Access-Client-Id".into(), value: "abc".into() }]);
      for name in ["Authorization", "host", "COOKIE", "Content-Length", "Bad Header", "x:y", "ü"] {
        assert!(validate_header(name, "v").is_err(), "{name} must be rejected");
      }
      assert!(validate_header("X-Ok", "line\nbreak").is_err());
      assert!(validate_header("X-Ok", "value").is_ok());
    }

    #[test]
    fn server_request_adds_headers_only_for_server_resources() {
      apply_to_context(
        "https://games.example.com/ps",
        &[RequestHeaderEntry { name: "X-Proxy-Key".into(), value: "secret".into() }],
      );
      let client = reqwest::Client::new();
      let inside_url = "https://games.example.com/ps/api/x";
      let inside = server_request(client.get(inside_url), inside_url).build().unwrap();
      assert_eq!(inside.headers().get("x-proxy-key").unwrap(), "secret");
      for outside in [
        "https://games.example.com:444/ps/api/x",
        "https://games.example.com/other",
        "https://cdn.example.com/ps/api/x",
        "https://games.example.com/ps%2fapi",
        "http://games.example.com/ps/api/x",
      ] {
        let request = server_request(client.get(outside), outside).build().unwrap();
        assert!(request.headers().get("x-proxy-key").is_none(), "{outside}");
      }
      apply_to_context("", &[]);
    }

    #[test]
    fn server_urls_must_be_plain_http_bases() {
      assert!(parse_server_url("https://host/sub").is_ok());
      for invalid in ["ftp://host", "https://u:p@host", "https://host/?q=1", "https://host/#x", "nope"] {
        assert!(parse_server_url(invalid).is_err(), "{invalid}");
      }
    }

    #[test]
    fn packs_meta_and_body() {
      let packed = pack_response(b"{}", b"body");
      assert_eq!(&packed[..4], &2u32.to_be_bytes());
      assert_eq!(&packed[4..6], b"{}");
      assert_eq!(&packed[6..], b"body");
    }
  }
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
