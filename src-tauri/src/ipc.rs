//! Single instance forwarding, the IPC server and the query API (WP1).
//!
//! Wire-compatible with the WPF client and the Playnite extension
//! (`PlayStash/playstash-playnite-integration`, `Helper/PipelineHelper.cs`):
//!
//! - Windows: the named pipe `\\.\pipe\PlayStash`, owned by the current user,
//!   with a DACL that only allows that user. Unix: the socket
//!   `$XDG_RUNTIME_DIR/playstash.sock` (else `<app data>/playstash.sock`),
//!   mode 0600.
//! - One message per connection: the client writes one UTF-8 line (Playnite
//!   writes it with a UTF-8 BOM and CRLF), the server answers queries with
//!   one line and closes the connection.
//! - Queries wait for the ready gate like the WPF client (Playnite polls
//!   `getappversion` until PlayStash answers). Other commands are queued by
//!   the dispatcher, so the connection is closed right away.

use crate::cli::{self, Action, CommandOptions, ParsedArgs};
use crate::desktop_commands::{self, DesktopContext};
use base64::Engine as _;
use std::io::{Read, Write};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Pipe name of the WPF client and the Playnite extension.
#[cfg(windows)]
pub(crate) const PIPE_NAME: &str = r"\\.\pipe\PlayStash";

/// The Tauri identifier (`tauri.conf.json`). The CLI pre-dispatch runs
/// before Tauri, so the app data directory is derived from it by hand.
#[cfg(unix)]
const APP_IDENTIFIER: &str = "com.playstash.playstash";

/// Longest accepted message (GetAllGames replies can be large, requests not).
const MAX_MESSAGE_BYTES: usize = 64 * 1024;

/// How long a query waits for the frontend to become ready.
const READY_TIMEOUT: Duration = Duration::from_secs(120);

// ── Query API ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Query {
  Exists,
  Downloaded,
  Installed,
  GetName,
  GetInstallDirectory,
  GetAppVersion,
  GetServerUrl,
  IsLoggedIn,
  GetAllGames,
}

impl Query {
  const ALL: [(Query, &'static str); 9] = [
    (Query::Exists, "Exists"),
    (Query::Downloaded, "Downloaded"),
    (Query::Installed, "Installed"),
    (Query::GetName, "GetName"),
    (Query::GetInstallDirectory, "GetInstallDirectory"),
    (Query::GetAppVersion, "GetAppVersion"),
    (Query::GetServerUrl, "GetServerUrl"),
    (Query::IsLoggedIn, "IsLoggedIn"),
    (Query::GetAllGames, "GetAllGames"),
  ];

  /// Case-insensitive name, or the numeric value (like .NET `Enum.TryParse`).
  pub(crate) fn parse(value: &str) -> Option<Query> {
    let value = value.trim();
    if let Ok(index) = value.parse::<usize>() {
      return Query::ALL.get(index).map(|(query, _)| *query);
    }
    Query::ALL
      .iter()
      .find(|(_, name)| name.eq_ignore_ascii_case(value))
      .map(|(query, _)| *query)
  }
}

/// An installed game as the query API sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InstalledSummary {
  pub title: String,
  pub install_directory: String,
}

/// Data the query API reads. The live implementation talks to the disk and
/// the server; tests use a fake.
pub(crate) trait QuerySource {
  fn installed(&self, game_id: i64) -> Option<InstalledSummary>;
  /// `GET {server}/api/games/{id}` (only while logged in).
  fn server_game(&self, game_id: i64) -> Option<serde_json::Value>;
  /// The offline cache (`offline-cache/games/<id>.json`).
  fn cached_game(&self, game_id: i64) -> Option<serde_json::Value>;
  /// A download card exists for the game (any state).
  fn has_download(&self, game_id: i64) -> bool;
  fn app_version(&self) -> String;
  fn server_url(&self) -> String;
  fn is_logged_in(&self) -> bool;
  /// Raw body of `GET {server}/api/games?limit=-1`.
  fn all_games(&self) -> Option<String>;
}

/// `metadata.title`, falling back to `title`.
pub(crate) fn title_from_json(value: &serde_json::Value) -> Option<String> {
  let non_empty = |value: Option<&serde_json::Value>| {
    value
      .and_then(|value| value.as_str())
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .map(str::to_string)
  };
  non_empty(value.get("metadata").and_then(|metadata| metadata.get("title"))).or_else(|| non_empty(value.get("title")))
}

fn bool_reply(value: bool) -> String {
  if value { "True" } else { "False" }.to_string()
}

/// Answers a query with one line. Errors start with `error: `.
pub(crate) fn answer_query(options: &CommandOptions, source: &dyn QuerySource) -> String {
  let Some(query) = options.query.as_deref().and_then(Query::parse) else {
    return "error: invalid query".to_string();
  };
  let needs_game = matches!(
    query,
    Query::Exists | Query::Downloaded | Query::Installed | Query::GetName | Query::GetInstallDirectory
  );
  let game_id = options.game_id.unwrap_or_default();
  if needs_game && options.game_id.is_none() {
    return "error: no game id".to_string();
  }

  match query {
    Query::Exists => bool_reply(
      source.installed(game_id).is_some() || source.server_game(game_id).is_some() || source.cached_game(game_id).is_some(),
    ),
    Query::Downloaded => bool_reply(source.installed(game_id).is_some() || source.has_download(game_id)),
    Query::Installed => bool_reply(source.installed(game_id).is_some()),
    Query::GetName => source
      .installed(game_id)
      .map(|game| game.title)
      .or_else(|| source.server_game(game_id).as_ref().and_then(title_from_json))
      .or_else(|| source.cached_game(game_id).as_ref().and_then(title_from_json))
      .unwrap_or_else(|| "error: game not found".to_string()),
    Query::GetInstallDirectory => source
      .installed(game_id)
      .map(|game| game.install_directory)
      .unwrap_or_default(),
    Query::GetAppVersion => source.app_version(),
    Query::GetServerUrl => source.server_url(),
    Query::IsLoggedIn => bool_reply(source.is_logged_in()),
    Query::GetAllGames => source
      .all_games()
      .map(|body| base64::engine::general_purpose::STANDARD.encode(body.as_bytes()))
      .unwrap_or_default(),
  }
}

/// The query source of the running app.
struct LiveQuerySource {
  app: AppHandle,
  context: DesktopContext,
  installed: std::cell::OnceCell<Vec<crate::events::InstalledGameInfo>>,
}

impl LiveQuerySource {
  fn new(app: &AppHandle) -> Self {
    Self {
      app: app.clone(),
      context: desktop_commands::context(),
      installed: std::cell::OnceCell::new(),
    }
  }

  fn offline_cache_file(&self, game_id: i64) -> Option<std::path::PathBuf> {
    let dir = self.app.path().app_data_dir().ok()?;
    Some(dir.join("offline-cache").join("games").join(format!("{game_id}.json")))
  }

  fn server_base(&self) -> Option<String> {
    let base = self.context.server_url.trim().trim_end_matches('/');
    (self.context.logged_in && !base.is_empty()).then(|| base.to_string())
  }

  fn get(&self, url: String, timeout: Duration) -> Option<String> {
    crate::net::validate_http_url(&url).ok()?;
    let token = self.context.access_token.clone().filter(|token| !token.is_empty());
    tauri::async_runtime::block_on(async move {
      let client = reqwest::Client::builder().timeout(timeout).build().ok()?;
      let mut request = client.get(&url).header("Accept", "application/json");
      if let Some(token) = token {
        request = request.bearer_auth(token);
      }
      let request = crate::net::server_request(request, &url);
      let response = request.send().await.ok()?;
      if !response.status().is_success() {
        return None;
      }
      response.text().await.ok()
    })
  }
}

impl QuerySource for LiveQuerySource {
  fn installed(&self, game_id: i64) -> Option<InstalledSummary> {
    let games = self
      .installed
      .get_or_init(|| desktop_commands::installed_games(&self.context.roots));
    let game = games
      .iter()
      .filter(|game| game.game_id == game_id)
      .max_by_key(|game| game.installed_at)?;
    let title = self
      .cached_game(game_id)
      .as_ref()
      .and_then(title_from_json)
      .or_else(|| game.cached_metadata.as_ref().and_then(title_from_json))
      .unwrap_or_else(|| game.game_title.clone());
    Some(InstalledSummary {
      title,
      install_directory: game.installation_directory.clone(),
    })
  }

  fn server_game(&self, game_id: i64) -> Option<serde_json::Value> {
    let base = self.server_base()?;
    let body = self.get(format!("{base}/api/games/{game_id}"), Duration::from_secs(15))?;
    serde_json::from_str(&body).ok()
  }

  fn cached_game(&self, game_id: i64) -> Option<serde_json::Value> {
    let path = self.offline_cache_file(game_id)?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
  }

  fn has_download(&self, game_id: i64) -> bool {
    self.context.roots.iter().any(|root| {
      crate::downloads::recover_download_cards_blocking(root.clone())
        .map(|cards| cards.iter().any(|card| card.game_id == game_id))
        .unwrap_or(false)
    })
  }

  fn app_version(&self) -> String {
    self.app.package_info().version.to_string()
  }

  fn server_url(&self) -> String {
    self.context.server_url.trim().to_string()
  }

  fn is_logged_in(&self) -> bool {
    self.context.logged_in
  }

  fn all_games(&self) -> Option<String> {
    let base = self.server_base()?;
    self.get(format!("{base}/api/games?limit=-1"), Duration::from_secs(120))
  }
}

// ── Connection handling ───────────────────────────────────────────────────

/// Reads one line (up to `\n`, or the end of the stream). A leading UTF-8 BOM
/// (written by .NET `StreamWriter` with `Encoding.UTF8`) and the line ending
/// are removed.
pub(crate) fn read_message<R: Read>(reader: &mut R) -> std::io::Result<String> {
  let mut bytes = Vec::new();
  let mut buffer = [0u8; 1024];
  loop {
    let read = match reader.read(&mut buffer) {
      Ok(0) => break,
      Ok(read) => read,
      // A closed pipe after the client wrote its line ends the message.
      Err(error) if !bytes.is_empty() && error.kind() == std::io::ErrorKind::BrokenPipe => break,
      Err(error) => return Err(error),
    };
    if let Some(newline) = buffer[..read].iter().position(|byte| *byte == b'\n') {
      bytes.extend_from_slice(&buffer[..newline]);
      break;
    }
    bytes.extend_from_slice(&buffer[..read]);
    if bytes.len() > MAX_MESSAGE_BYTES {
      return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "message too long"));
    }
  }
  let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
  let text = String::from_utf8_lossy(bytes);
  Ok(text.trim_end_matches(['\r', '\n']).to_string())
}

/// Waits for the ready gate while the client is still connected.
fn wait_for_ready_while_connected(disconnected: &dyn Fn() -> bool) -> bool {
  let started = std::time::Instant::now();
  while started.elapsed() < READY_TIMEOUT {
    if desktop_commands::wait_until_ready(Duration::from_millis(500)) {
      return true;
    }
    // Playnite gives up after 500 ms and polls again; do not keep a thread
    // per abandoned connection.
    if disconnected() {
      return false;
    }
  }
  false
}

/// Handles one client connection: one line in, at most one line out.
fn handle_connection<S: Read + Write>(
  app: &AppHandle,
  stream: &mut S,
  disconnected: &dyn Fn() -> bool,
) -> Option<()> {
  let message = read_message(stream).ok()?;
  if message.trim().is_empty() {
    return Some(());
  }
  let parsed = cli::parse_pipe_message(&message);
  if parsed.options.action != Action::Query {
    dispatch_parsed(app, parsed);
    return Some(());
  }

  if !wait_for_ready_while_connected(disconnected) {
    return Some(());
  }
  let source = LiveQuerySource::new(app);
  let reply = answer_query(&parsed.options, &source);
  if !reply.is_empty() {
    stream.write_all(reply.as_bytes()).ok()?;
    stream.write_all(b"\r\n").ok()?;
    stream.flush().ok()?;
  }
  Some(())
}

// ── Platform transport ────────────────────────────────────────────────────

/// Why connecting to a running instance failed.
#[derive(Debug)]
enum ConnectError {
  /// The pipe exists but belongs to another Windows user.
  #[cfg_attr(unix, allow(dead_code))]
  Foreign(String),
  Other(String),
}

#[cfg(windows)]
mod platform {
  use super::{ConnectError, PIPE_NAME};
  use std::fs::File;
  use std::os::windows::io::{AsRawHandle, FromRawHandle};
  use windows::core::{HSTRING, PWSTR};
  use windows::Win32::Foundation::{
    CloseHandle, LocalFree, ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, ERROR_SUCCESS, GENERIC_READ,
    GENERIC_WRITE, HANDLE, HLOCAL,
  };
  use windows::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1,
    SE_KERNEL_OBJECT,
  };
  use windows::Win32::Security::{
    GetTokenInformation, TokenUser, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES,
    TOKEN_QUERY, TOKEN_USER,
  };
  use windows::Win32::Storage::FileSystem::{
    CreateFileW, FlushFileBuffers, FILE_SHARE_NONE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX, SECURITY_IDENTIFICATION,
    SECURITY_SQOS_PRESENT,
  };
  use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, WaitNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
    PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
  };
  use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

  /// ReadWrite | CreateNewInstance | ReadPermissions | Synchronize, the
  /// rights of the WPF `PipeAccessRule`.
  const PIPE_USER_RIGHTS: u32 = 0x0012_019F;

  fn sid_to_string(sid: PSID) -> Result<String, String> {
    let mut text = PWSTR::null();
    unsafe {
      ConvertSidToStringSidW(sid, &mut text).map_err(|error| error.to_string())?;
      let value = text.to_string().map_err(|error| error.to_string());
      let _ = LocalFree(Some(HLOCAL(text.0 as _)));
      value
    }
  }

  /// SID of the user running this process, as a string.
  pub(super) fn current_user_sid() -> Result<String, String> {
    unsafe {
      let mut token = HANDLE::default();
      OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(|error| error.to_string())?;
      let mut length = 0u32;
      let _ = GetTokenInformation(token, TokenUser, None, 0, &mut length);
      // u64 storage keeps TOKEN_USER properly aligned.
      let mut buffer = vec![0u64; (length as usize).div_ceil(8).max(1)];
      let result = GetTokenInformation(
        token,
        TokenUser,
        Some(buffer.as_mut_ptr().cast()),
        (buffer.len() * 8) as u32,
        &mut length,
      );
      let _ = CloseHandle(token);
      result.map_err(|error| error.to_string())?;
      let user = &*(buffer.as_ptr() as *const TOKEN_USER);
      sid_to_string(user.User.Sid)
    }
  }

  /// Security attributes: owner = current user, a protected DACL that only
  /// allows the current user (like WPF `PipeTrust.CreateServer`).
  pub(super) struct PipeSecurity {
    attributes: SECURITY_ATTRIBUTES,
  }

  // The descriptor is never freed and only read by CreateNamedPipeW.
  unsafe impl Send for PipeSecurity {}

  impl PipeSecurity {
    pub(super) fn new() -> Result<Self, String> {
      let sid = current_user_sid()?;
      let sddl = format!("O:{sid}D:P(A;;0x{PIPE_USER_RIGHTS:08x};;;{sid})");
      let mut descriptor = PSECURITY_DESCRIPTOR::default();
      unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(&HSTRING::from(sddl), SDDL_REVISION_1, &mut descriptor, None)
          .map_err(|error| error.to_string())?;
      }
      Ok(Self {
        attributes: SECURITY_ATTRIBUTES {
          nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
          lpSecurityDescriptor: descriptor.0,
          bInheritHandle: false.into(),
        },
      })
    }
  }

  /// Creates a pipe instance and waits for a client.
  pub(super) fn accept(security: &PipeSecurity) -> Result<File, String> {
    unsafe {
      let handle = CreateNamedPipeW(
        &HSTRING::from(PIPE_NAME),
        PIPE_ACCESS_DUPLEX,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
        PIPE_UNLIMITED_INSTANCES,
        64 * 1024,
        64 * 1024,
        0,
        Some(&security.attributes),
      );
      if handle.is_invalid() {
        return Err(windows::core::Error::from_win32().to_string());
      }
      if let Err(error) = ConnectNamedPipe(handle, None) {
        if error.code() != ERROR_PIPE_CONNECTED.to_hresult() {
          let _ = CloseHandle(handle);
          return Err(error.to_string());
        }
      }
      Ok(File::from_raw_handle(handle.0))
    }
  }

  /// Whether the client closed its end of the pipe.
  pub(super) fn is_disconnected(file: &File) -> bool {
    use windows::Win32::System::Pipes::PeekNamedPipe;
    let mut available = 0u32;
    unsafe { PeekNamedPipe(HANDLE(file.as_raw_handle()), None, 0, None, Some(&mut available), None).is_err() }
  }

  /// Waits until the client has read everything before the handle closes.
  pub(super) fn flush(file: &File) {
    unsafe {
      let _ = FlushFileBuffers(HANDLE(file.as_raw_handle()));
    }
  }

  /// Connects to the running instance. `Ok(None)` when no server listens.
  pub(super) fn connect() -> Result<Option<File>, ConnectError> {
    let name = HSTRING::from(PIPE_NAME);
    for _ in 0..5 {
      let opened = unsafe {
        CreateFileW(
          &name,
          GENERIC_READ.0 | GENERIC_WRITE.0,
          FILE_SHARE_NONE,
          None,
          OPEN_EXISTING,
          SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
          None,
        )
      };
      match opened {
        Ok(handle) => {
          let file = unsafe { File::from_raw_handle(handle.0) };
          verify_owner(handle)?;
          return Ok(Some(file));
        }
        Err(error) if error.code() == ERROR_FILE_NOT_FOUND.to_hresult() => return Ok(None),
        Err(error) if error.code() == ERROR_PIPE_BUSY.to_hresult() => unsafe {
          let _ = WaitNamedPipeW(&name, 2000);
        },
        Err(error) => return Err(ConnectError::Other(error.to_string())),
      }
    }
    Err(ConnectError::Other("The PlayStash pipe is busy.".into()))
  }

  /// The pipe must be owned by the current user, not by whoever created a
  /// pipe with the same name first.
  fn verify_owner(handle: HANDLE) -> Result<(), ConnectError> {
    let mut owner = PSID::default();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    let status = unsafe {
      GetSecurityInfo(
        handle,
        SE_KERNEL_OBJECT,
        OWNER_SECURITY_INFORMATION,
        Some(&mut owner),
        None,
        None,
        None,
        Some(&mut descriptor),
      )
    };
    if status != ERROR_SUCCESS {
      return Err(ConnectError::Other(format!("Reading the pipe owner failed ({})", status.0)));
    }
    let owner_sid = sid_to_string(owner);
    unsafe {
      let _ = LocalFree(Some(HLOCAL(descriptor.0)));
    }
    let current = current_user_sid().map_err(ConnectError::Other)?;
    match owner_sid {
      Ok(owner_sid) if owner_sid == current => Ok(()),
      _ => Err(ConnectError::Foreign("The PlayStash pipe belongs to another Windows user.".into())),
    }
  }

  /// Native message box (no console in release builds).
  pub(super) fn message_box(title: &str, text: &str, error: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_ICONINFORMATION, MB_OK};
    let icon = if error { MB_ICONERROR } else { MB_ICONINFORMATION };
    unsafe {
      MessageBoxW(None, &HSTRING::from(text), &HSTRING::from(title), MB_OK | icon);
    }
  }

  /// Writes to the console of the calling shell when there is one.
  pub(super) fn attach_console() -> bool {
    use windows::Win32::System::Console::{AttachConsole, GetStdHandle, ATTACH_PARENT_PROCESS, STD_OUTPUT_HANDLE};
    unsafe {
      let redirected = GetStdHandle(STD_OUTPUT_HANDLE)
        .map(|handle| !handle.is_invalid() && !handle.0.is_null())
        .unwrap_or(false);
      redirected || AttachConsole(ATTACH_PARENT_PROCESS).is_ok()
    }
  }

  /// Taskbar grouping and the jump list use the bundle identifier, which
  /// the installer also sets on its shortcuts.
  pub(super) fn set_app_user_model_id(identifier: &str) {
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    unsafe {
      if let Err(error) = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(identifier)) {
        log::warn!("[ipc] failed to set the AppUserModelID: {error}");
      }
    }
  }
}

#[cfg(unix)]
mod platform {
  use super::{ConnectError, APP_IDENTIFIER};
  use std::os::unix::net::{UnixListener, UnixStream};
  use std::path::PathBuf;

  fn data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
      return home.map(|home| home.join("Library").join("Application Support"));
    }
    std::env::var_os("XDG_DATA_HOME")
      .map(PathBuf::from)
      .filter(|dir| dir.is_absolute())
      .or_else(|| home.map(|home| home.join(".local").join("share")))
  }

  /// `$XDG_RUNTIME_DIR/playstash.sock`, else `<app data>/playstash.sock`.
  pub(super) fn socket_path() -> Option<PathBuf> {
    if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from) {
      if runtime.is_absolute() && runtime.is_dir() {
        return Some(runtime.join("playstash.sock"));
      }
    }
    data_dir().map(|dir| dir.join(APP_IDENTIFIER).join("playstash.sock"))
  }

  pub(super) fn bind() -> Result<UnixListener, String> {
    use std::os::unix::fs::PermissionsExt;
    let path = socket_path().ok_or("No directory for the PlayStash socket")?;
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if path.exists() {
      if UnixStream::connect(&path).is_ok() {
        return Err("Another PlayStash instance owns the socket".into());
      }
      // A stale socket from a crashed instance.
      let _ = std::fs::remove_file(&path);
    }
    let listener = UnixListener::bind(&path).map_err(|error| error.to_string())?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
    Ok(listener)
  }

  /// Whether the client closed its end of the socket. The request line was
  /// already read, so a stray extra byte may be consumed here.
  pub(super) fn is_disconnected(stream: &UnixStream) -> bool {
    use std::io::Read;
    if stream.set_nonblocking(true).is_err() {
      return true;
    }
    let mut byte = [0u8; 1];
    let mut reader = stream;
    let closed = match reader.read(&mut byte) {
      Ok(0) => true,
      Ok(_) => false,
      Err(error) => error.kind() != std::io::ErrorKind::WouldBlock,
    };
    let _ = stream.set_nonblocking(false);
    closed
  }

  pub(super) fn connect() -> Result<Option<UnixStream>, ConnectError> {
    let Some(path) = socket_path() else {
      return Ok(None);
    };
    match UnixStream::connect(&path) {
      Ok(stream) => Ok(Some(stream)),
      Err(error)
        if matches!(
          error.kind(),
          std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
        ) =>
      {
        Ok(None)
      }
      Err(error) => Err(ConnectError::Other(error.to_string())),
    }
  }
}

/// Starts the IPC server on a background thread.
fn start_server(app: AppHandle) {
  #[cfg(windows)]
  std::thread::spawn(move || {
    let security = match platform::PipeSecurity::new() {
      Ok(security) => security,
      Err(error) => {
        log::error!("[ipc] cannot build the pipe security descriptor: {error}");
        return;
      }
    };
    let mut failures = 0u32;
    loop {
      match platform::accept(&security) {
        Ok(mut file) => {
          failures = 0;
          let app = app.clone();
          std::thread::spawn(move || {
            let probe = file.try_clone();
            let disconnected = move || probe.as_ref().map(platform::is_disconnected).unwrap_or(true);
            let _ = handle_connection(&app, &mut file, &disconnected);
            platform::flush(&file);
          });
        }
        Err(error) => {
          // For example another Windows user owns the pipe name.
          if failures == 0 {
            log::warn!("[ipc] pipe server error: {error}");
          }
          failures = failures.saturating_add(1);
          std::thread::sleep(Duration::from_secs(if failures > 5 { 10 } else { 1 }));
        }
      }
    }
  });

  #[cfg(unix)]
  std::thread::spawn(move || {
    let listener = match platform::bind() {
      Ok(listener) => listener,
      Err(error) => {
        log::warn!("[ipc] socket server not started: {error}");
        return;
      }
    };
    for stream in listener.incoming() {
      let Ok(mut stream) = stream else {
        continue;
      };
      let app = app.clone();
      std::thread::spawn(move || {
        let probe = stream.try_clone();
        let disconnected = move || probe.as_ref().map(platform::is_disconnected).unwrap_or(true);
        let _ = handle_connection(&app, &mut stream, &disconnected);
      });
    }
  });
}

/// Sends one message to the running instance and, for queries, returns the
/// reply line.
fn send<S: Read + Write>(stream: &mut S, options: &CommandOptions) -> std::io::Result<Option<String>> {
  let message = cli::serialize_uri(options);
  stream.write_all(message.as_bytes())?;
  stream.write_all(b"\r\n")?;
  stream.flush()?;
  if options.action != Action::Query {
    return Ok(None);
  }
  let reply = read_message(stream)?;
  Ok(Some(reply.trim_matches(['\r', '\n']).to_string()))
}

fn executable_name() -> String {
  std::env::current_exe()
    .ok()
    .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
    .unwrap_or_else(|| if cfg!(windows) { "playstash.exe" } else { "playstash" }.to_string())
}

/// Shows a message where a GUI process can: a message box on Windows,
/// standard error elsewhere.
fn native_message(title: &str, text: &str, error: bool) {
  #[cfg(windows)]
  {
    if cfg!(debug_assertions) {
      eprintln!("{title}: {text}");
    }
    platform::message_box(title, text, error);
  }
  #[cfg(not(windows))]
  {
    let _ = error;
    eprintln!("{title}:\n{text}");
  }
}

fn print_query_result(result: &str) {
  #[cfg(windows)]
  {
    if platform::attach_console() {
      let mut stdout = std::io::stdout();
      let _ = writeln!(stdout, "{result}");
      let _ = stdout.flush();
    } else if !result.is_empty() {
      platform::message_box("Query Result", result, false);
    }
  }
  #[cfg(not(windows))]
  println!("{result}");
}

/// CLI pre-dispatch, called from `main` before the Tauri builder runs.
///
/// Parses the arguments (help on errors, exit code 1). When PlayStash is
/// already running, the command is forwarded over the pipe/socket and this
/// process exits (queries print the reply). Otherwise the command is stored
/// as the startup command and the app starts.
pub fn predispatch() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let parsed = match cli::parse_args(&args) {
    Ok(parsed) => parsed,
    Err(error) => {
      native_message("Help", &cli::usage_text(&error, &executable_name()), false);
      std::process::exit(1);
    }
  };

  let result = platform::connect();
  match result {
    Ok(Some(mut stream)) => {
      if let Some(action) = parsed.invalid_action.as_deref() {
        native_message("Error", &format!("Invalid action: {action}"), true);
      }
      match send(&mut stream, &parsed.options) {
        Ok(Some(reply)) => print_query_result(&reply),
        Ok(None) => {}
        Err(error) => {
          native_message("PlayStash", &format!("Sending the command to PlayStash failed: {error}"), true);
          std::process::exit(1);
        }
      }
      std::process::exit(0);
    }
    Ok(None) => {}
    Err(ConnectError::Foreign(message)) => {
      // Another Windows user's instance owns the pipe name. Queries have
      // nobody to ask; anything else starts normally (the single-instance
      // plugin still forwards to an instance of this user).
      if parsed.options.action == Action::Query {
        native_message("PlayStash", &message, true);
        std::process::exit(1);
      }
      eprintln!("{message}");
    }
    Err(ConnectError::Other(message)) => {
      if parsed.options.action == Action::Query {
        native_message("PlayStash", &message, true);
        std::process::exit(1);
      }
      eprintln!("PlayStash IPC: {message}");
    }
  }

  desktop_commands::set_startup_command(parsed);
}

/// Second instance that slipped past the pre-dispatch (for example while the
/// first instance was still starting): its arguments arrive through the
/// single-instance plugin.
pub(crate) fn handle_second_instance(app: &AppHandle, argv: &[String]) {
  let args = argv.get(1..).unwrap_or_default();
  match cli::parse_args(args) {
    Ok(parsed) => dispatch_parsed(app, parsed),
    Err(_) => desktop_commands::reveal_main_window(app),
  }
}

fn dispatch_parsed(app: &AppHandle, parsed: ParsedArgs) {
  if let Some(action) = parsed.invalid_action.as_deref() {
    desktop_commands::show_invalid_action(app, action);
  }
  let options = parsed.options;
  // A plain "show" (double click on the app icon) reveals the window right
  // away, even before login.
  if options.action == Action::Show && options.game_id.is_none() && options.jump_list_command.is_none() {
    if options.minimized != Some(true) {
      desktop_commands::reveal_main_window(app);
    }
    return;
  }
  desktop_commands::submit(app, options);
}

/// A `playstash://` URL from the deep-link plugin (macOS open events).
fn handle_deep_link(app: &AppHandle, url: &str) {
  let parsed = cli::parse_uri(url);
  let mut options = parsed.options;
  options.is_protocol = true;
  options.apply_protocol_safety();
  dispatch_parsed(
    app,
    ParsedArgs {
      options,
      invalid_action: parsed.invalid_action,
    },
  );
}

/// WP1 setup: tray, close-to-tray, startup visibility, IPC server, deep
/// links, jump list, autostart arguments and the startup command.
pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  let handle = app.handle().clone();

  #[cfg(windows)]
  platform::set_app_user_model_id(&handle.config().identifier);

  crate::tray::init(&handle)?;
  crate::tray::attach_close_to_tray(&handle);

  // Startup visibility (F9): autostart only hides with "start minimized".
  let startup = desktop_commands::startup_command();
  let start_minimized = crate::settings::load_settings(&handle).start_minimized;
  if cli::should_start_hidden(&startup.options, start_minimized) {
    if let Some(window) = handle.get_webview_window("main") {
      let _ = window.hide();
    }
  }

  start_server(handle.clone());

  // Deep links: macOS delivers them as open events; on Windows and Linux they
  // arrive as arguments (pre-dispatch or the single-instance callback).
  {
    use tauri_plugin_deep_link::DeepLinkExt;
    let deep_link = handle.deep_link();
    #[cfg(windows)]
    if let Err(error) = deep_link.register_all() {
      log::warn!("[ipc] registering the playstash:// scheme failed: {error}");
    }
    #[cfg(target_os = "linux")]
    if handle.env().appimage.is_some() {
      if let Err(error) = deep_link.register_all() {
        log::warn!("[ipc] registering the playstash:// scheme failed: {error}");
      }
    }
    let link_handle = handle.clone();
    deep_link.on_open_url(move |event| {
      for url in event.urls() {
        handle_deep_link(&link_handle, url.as_str());
      }
    });
  }

  crate::jumplist::init(&handle);
  crate::tray::migrate_autostart_args(&handle);

  // The startup command goes through the ready gate like any other.
  if let Some(action) = startup.invalid_action.as_deref() {
    desktop_commands::show_invalid_action(&handle, action);
  }
  let mut options = startup.options;
  if options.autostart && options.minimized.is_none() {
    options.minimized = Some(start_minimized);
  }
  let plain_show = options.action == Action::Show && options.game_id.is_none() && options.jump_list_command.is_none();
  if !plain_show {
    desktop_commands::submit(&handle, options);
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::HashMap;

  #[derive(Default)]
  struct FakeSource {
    installed: HashMap<i64, InstalledSummary>,
    server: HashMap<i64, serde_json::Value>,
    cached: HashMap<i64, serde_json::Value>,
    downloads: Vec<i64>,
    logged_in: bool,
    all_games: Option<String>,
  }

  impl QuerySource for FakeSource {
    fn installed(&self, game_id: i64) -> Option<InstalledSummary> {
      self.installed.get(&game_id).cloned()
    }
    fn server_game(&self, game_id: i64) -> Option<serde_json::Value> {
      self.server.get(&game_id).cloned()
    }
    fn cached_game(&self, game_id: i64) -> Option<serde_json::Value> {
      self.cached.get(&game_id).cloned()
    }
    fn has_download(&self, game_id: i64) -> bool {
      self.downloads.contains(&game_id)
    }
    fn app_version(&self) -> String {
      "17.2.3".into()
    }
    fn server_url(&self) -> String {
      if self.logged_in { "https://playstash.example" } else { "" }.into()
    }
    fn is_logged_in(&self) -> bool {
      self.logged_in
    }
    fn all_games(&self) -> Option<String> {
      self.all_games.clone()
    }
  }

  fn source() -> FakeSource {
    let mut source = FakeSource {
      logged_in: true,
      all_games: Some(r#"{"data":[{"id":1}]}"#.into()),
      downloads: vec![3],
      ..Default::default()
    };
    source.installed.insert(
      1,
      InstalledSummary {
        title: "Installed Game".into(),
        install_directory: "C:\\Games\\PlayStash\\One\\Versions\\(1) v1\\Installation".into(),
      },
    );
    source
      .server
      .insert(2, serde_json::json!({"title": "raw", "metadata": {"title": "Server Game"}}));
    source.cached.insert(4, serde_json::json!({"title": "Cached Game"}));
    source
  }

  fn ask(uri: &str, source: &FakeSource) -> String {
    answer_query(&cli::parse_pipe_message(uri).options, source)
  }

  #[test]
  fn answers_every_query() {
    let source = source();
    assert_eq!(ask("playstash://query?query=Exists&gameid=1", &source), "True");
    assert_eq!(ask("playstash://query?query=exists&gameid=2", &source), "True");
    assert_eq!(ask("playstash://query?query=exists&gameid=4", &source), "True");
    assert_eq!(ask("playstash://query?query=exists&gameid=9", &source), "False");
    assert_eq!(ask("playstash://query?query=downloaded&gameid=1", &source), "True");
    assert_eq!(ask("playstash://query?query=downloaded&gameid=3", &source), "True");
    assert_eq!(ask("playstash://query?query=downloaded&gameid=2", &source), "False");
    assert_eq!(ask("playstash://Query?Query=installed&gameid=1", &source), "True");
    assert_eq!(ask("playstash://query?query=installed&gameid=2", &source), "False");
    assert_eq!(ask("playstash://query?query=getname&gameid=1", &source), "Installed Game");
    assert_eq!(ask("playstash://query?query=getname&gameid=2", &source), "Server Game");
    assert_eq!(ask("playstash://query?query=getname&gameid=4", &source), "Cached Game");
    assert_eq!(ask("playstash://query?query=getname&gameid=9", &source), "error: game not found");
    assert_eq!(
      ask("playstash://query?query=getinstalldirectory&gameid=1", &source),
      "C:\\Games\\PlayStash\\One\\Versions\\(1) v1\\Installation"
    );
    assert_eq!(ask("playstash://query?query=getinstalldirectory&gameid=2", &source), "");
    assert_eq!(ask("playstash://query?query=getappversion", &source), "17.2.3");
    assert_eq!(ask("playstash://query?query=getserverurl", &source), "https://playstash.example");
    assert_eq!(ask("playstash://query?query=isloggedin", &source), "True");
    assert_eq!(
      ask("playstash://query?query=getallgames", &source),
      base64::engine::general_purpose::STANDARD.encode(r#"{"data":[{"id":1}]}"#)
    );
  }

  #[test]
  fn reports_query_errors() {
    let mut source = source();
    assert_eq!(ask("playstash://query?query=fly", &source), "error: invalid query");
    assert_eq!(ask("playstash://query", &source), "error: invalid query");
    assert_eq!(ask("playstash://query?query=installed", &source), "error: no game id");
    assert_eq!(ask("playstash://query?query=getname", &source), "error: no game id");
    source.logged_in = false;
    source.all_games = None;
    assert_eq!(ask("playstash://query?query=isloggedin", &source), "False");
    assert_eq!(ask("playstash://query?query=getserverurl", &source), "");
    assert_eq!(ask("playstash://query?query=getallgames", &source), "");
    // Numeric query values work like .NET Enum.TryParse.
    assert_eq!(ask("playstash://query?query=5", &source), "17.2.3");
  }

  #[test]
  fn reads_one_line_and_strips_bom() {
    let mut input: &[u8] = b"\xEF\xBB\xBFplaystash://query?query=getappversion\r\nignored";
    assert_eq!(read_message(&mut input).unwrap(), "playstash://query?query=getappversion");
    let mut input: &[u8] = b"ShowMainWindow";
    assert_eq!(read_message(&mut input).unwrap(), "ShowMainWindow");
    let long = vec![b'a'; MAX_MESSAGE_BYTES + 2048];
    assert!(read_message(&mut long.as_slice()).is_err());
  }

  #[test]
  fn titles_prefer_metadata() {
    assert_eq!(
      title_from_json(&serde_json::json!({"title": "a", "metadata": {"title": " b "}})).as_deref(),
      Some("b")
    );
    assert_eq!(
      title_from_json(&serde_json::json!({"title": "a", "metadata": {"title": ""}})).as_deref(),
      Some("a")
    );
    assert_eq!(title_from_json(&serde_json::json!({})), None);
  }

  /// A full request/response over an in-memory duplex stream.
  struct Duplex {
    input: std::io::Cursor<Vec<u8>>,
    output: Vec<u8>,
  }
  impl Read for Duplex {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
      self.input.read(buf)
    }
  }
  impl Write for Duplex {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
      self.output.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
      Ok(())
    }
  }

  #[test]
  fn client_writes_one_crlf_line_and_reads_the_reply() {
    let mut stream = Duplex {
      input: std::io::Cursor::new(b"True\r\n".to_vec()),
      output: Vec::new(),
    };
    let options = cli::parse_pipe_message("playstash://query?query=installed&gameid=5").options;
    let reply = send(&mut stream, &options).unwrap();
    assert_eq!(reply.as_deref(), Some("True"));
    assert_eq!(stream.output, b"playstash://query?gameid=5&query=installed\r\n");

    let mut stream = Duplex {
      input: std::io::Cursor::new(Vec::new()),
      output: Vec::new(),
    };
    let options = cli::parse_args(&["start", "--gameid=5"]).unwrap().options;
    assert_eq!(send(&mut stream, &options).unwrap(), None);
    assert_eq!(stream.output, b"playstash://start?gameid=5&autoinstall=True\r\n");
  }
}
