//! Command model shared by the command line, `playstash://` deep links, the
//! IPC pipe/socket, the jump list and the tray (WP1).
//!
//! Everything in here is pure and unit-tested. The wire format is the one the
//! WPF client (`Models/CommandOptions.cs`) and the Playnite extension use:
//! `playstash://<action>?gameid=5&minimized=True`, parsed tolerantly.

use std::fmt;

/// URI scheme registered for deep links.
pub(crate) const URI_SCHEME: &str = "playstash";

/// What a command asks PlayStash to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Action {
  /// Show the main window, optionally a specific game or page.
  #[default]
  Show,
  /// Install a game.
  Install,
  /// Uninstall a game.
  Uninstall,
  /// Start a game, or install it if necessary.
  Start,
  /// Stop a game. Not supported (PlayStash does not track running games).
  Stop,
  /// A one-line query from another program (Playnite). Never touches the UI.
  Query,
}

impl Action {
  const ALL: [Action; 6] = [
    Action::Show,
    Action::Install,
    Action::Uninstall,
    Action::Start,
    Action::Stop,
    Action::Query,
  ];

  /// Lowercase wire name.
  pub(crate) fn as_str(self) -> &'static str {
    match self {
      Action::Show => "show",
      Action::Install => "install",
      Action::Uninstall => "uninstall",
      Action::Start => "start",
      Action::Stop => "stop",
      Action::Query => "query",
    }
  }

  /// Parses an action name case-insensitively. Like .NET `Enum.TryParse`, the
  /// numeric value of a defined member is accepted as well.
  pub(crate) fn parse(value: &str) -> Option<Action> {
    let value = value.trim();
    if let Ok(index) = value.parse::<usize>() {
      return Action::ALL.get(index).copied();
    }
    Action::ALL
      .iter()
      .copied()
      .find(|action| action.as_str().eq_ignore_ascii_case(value))
  }
}

impl fmt::Display for Action {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str(self.as_str())
  }
}

/// A parsed command (WPF `CommandOptions`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct CommandOptions {
  pub action: Action,
  pub minimized: Option<bool>,
  pub game_id: Option<i64>,
  /// Version to install (`playstash://install?gameid=..&versionid=..`, the
  /// "Download in desktop app" links of the web frontend).
  pub version_id: Option<i64>,
  pub jump_list_command: Option<i32>,
  pub auto_install: Option<bool>,
  pub confirm: Option<bool>,
  pub query: Option<String>,
  /// The command came from a `playstash://` URI handed over by the OS (a
  /// browser link, a desktop shortcut). Such commands always confirm.
  pub is_protocol: bool,
  /// The process was started by the OS autostart entry (`--autostart`).
  /// Never serialized.
  pub autostart: bool,
}

impl CommandOptions {
  pub(crate) fn show() -> Self {
    Self::default()
  }

  /// Browser links can never silently remove games: a protocol invocation
  /// always asks for confirmation. Local CLI and pipe clients keep control.
  pub(crate) fn apply_protocol_safety(&mut self) {
    if self.is_protocol {
      self.confirm = Some(true);
    }
  }
}

/// Result of parsing a URI: unknown actions fall back to Show and are
/// reported so the caller can show "Invalid action: X".
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedUri {
  pub options: CommandOptions,
  pub invalid_action: Option<String>,
}

/// Tolerant boolean parse: `True`/`true`/`FALSE`/`1`/`0`.
pub(crate) fn parse_bool(value: &str) -> Option<bool> {
  let value = value.trim();
  if value.eq_ignore_ascii_case("true") || value == "1" {
    Some(true)
  } else if value.eq_ignore_ascii_case("false") || value == "0" {
    Some(false)
  } else {
    None
  }
}

fn parse_int<T: std::str::FromStr>(value: &str) -> Option<T> {
  let value = value.trim();
  let value = value.strip_prefix('+').unwrap_or(value);
  value.parse::<T>().ok()
}

/// `HttpUtility.UrlDecode`: `+` is a space, `%XX` is a byte. Invalid escapes
/// are kept as they are.
pub(crate) fn url_decode(value: &str) -> String {
  let bytes = value.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut index = 0;
  while index < bytes.len() {
    match bytes[index] {
      b'+' => {
        out.push(b' ');
        index += 1;
      }
      b'%' if index + 2 < bytes.len() => {
        let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
        match hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
          Some(byte) => {
            out.push(byte);
            index += 3;
          }
          None => {
            out.push(b'%');
            index += 1;
          }
        }
      }
      byte => {
        out.push(byte);
        index += 1;
      }
    }
  }
  String::from_utf8_lossy(&out).into_owned()
}

/// `HttpUtility.UrlEncode`: unreserved characters stay, spaces become `+`.
pub(crate) fn url_encode(value: &str) -> String {
  url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn is_word_char(c: char) -> bool {
  c.is_alphanumeric() || c == '_'
}

/// Splits a URI with the WPF grammar
/// `^(?:[\w\-]+:/*)?(?<action>\w+)\/*\?*(?<params>.*)?$` into action and
/// parameters. Returns `None` when nothing matches.
fn split_uri(uri: &str) -> Option<(&str, &str)> {
  // `.` does not match a line break, so a message with an embedded newline
  // does not match at all.
  if uri.contains('\n') {
    return None;
  }

  // `(?<action>\w+)\/*\?*(?<params>.*)`
  fn split_action(rest: &str) -> Option<(&str, &str)> {
    let end = rest
      .char_indices()
      .find(|(_, c)| !is_word_char(*c))
      .map(|(index, _)| index)
      .unwrap_or(rest.len());
    if end == 0 {
      return None;
    }
    let params = rest[end..].trim_start_matches('/').trim_start_matches('?');
    Some((&rest[..end], params))
  }

  // With a scheme: `[\w-]+:` followed by any number of slashes.
  let scheme_end = uri
    .char_indices()
    .find(|(_, c)| !(is_word_char(*c) || *c == '-'))
    .map(|(index, _)| index)
    .unwrap_or(uri.len());
  if scheme_end > 0 && uri[scheme_end..].starts_with(':') {
    if let Some(split) = split_action(uri[scheme_end + 1..].trim_start_matches('/')) {
      return Some(split);
    }
  }

  // Without a scheme (the regex backtracks to this).
  split_action(uri)
}

/// Parses `playstash://<action>?param=value&...` (and every tolerated
/// variant). The result is not marked as a protocol invocation; callers set
/// `is_protocol` when the URI came from the OS.
pub(crate) fn parse_uri(uri: &str) -> ParsedUri {
  let mut options = CommandOptions::default();
  let mut invalid_action = None;
  let uri = uri.trim_end_matches(['\r', '\n']);

  let Some((action, params)) = split_uri(uri) else {
    return ParsedUri { options, invalid_action };
  };

  match Action::parse(action) {
    Some(parsed) => options.action = parsed,
    None => invalid_action = Some(action.to_string()),
  }

  for param in params.split('&').filter(|param| !param.is_empty()) {
    let Some((name, value)) = param.split_once('=') else {
      continue;
    };
    let name = url_decode(name.trim());
    let value = url_decode(value.trim());
    apply_param(&mut options, &name, &value);
  }

  ParsedUri { options, invalid_action }
}

/// Sets one named parameter. Invalid values are ignored.
fn apply_param(options: &mut CommandOptions, name: &str, value: &str) {
  match name.to_ascii_lowercase().as_str() {
    "minimized" => {
      if let Some(value) = parse_bool(value) {
        options.minimized = Some(value);
      }
    }
    "gameid" => {
      if let Some(value) = parse_int::<i64>(value) {
        options.game_id = Some(value);
      }
    }
    "versionid" => {
      if let Some(value) = parse_int::<i64>(value) {
        options.version_id = Some(value);
      }
    }
    "jumplistcommand" => {
      if let Some(value) = parse_int::<i32>(value) {
        options.jump_list_command = Some(value);
      }
    }
    "autoinstall" => {
      if let Some(value) = parse_bool(value) {
        options.auto_install = Some(value);
      }
    }
    "confirm" => {
      if let Some(value) = parse_bool(value) {
        options.confirm = Some(value);
      }
    }
    "query" => options.query = Some(value.to_string()),
    _ => {}
  }
}

/// Parses one line received over the pipe/socket. The legacy literal
/// `ShowMainWindow` maps to Show. Pipe messages are not protocol invocations,
/// so `confirm` stays as sent.
pub(crate) fn parse_pipe_message(line: &str) -> ParsedUri {
  let line = line.trim_start_matches('\u{feff}').trim();
  if line.eq_ignore_ascii_case("ShowMainWindow") {
    return ParsedUri { options: CommandOptions::show(), invalid_action: None };
  }
  parse_uri(line)
}

fn bool_text(value: bool) -> &'static str {
  if value {
    "True"
  } else {
    "False"
  }
}

/// Serializes to `playstash://<action>?minimized=..&gameid=..&...`. Only set
/// values are written; booleans are `True`/`False` like the WPF client.
pub(crate) fn serialize_uri(options: &CommandOptions) -> String {
  let mut params: Vec<(&str, String)> = Vec::new();
  if let Some(value) = options.minimized {
    params.push(("minimized", bool_text(value).to_string()));
  }
  if let Some(value) = options.game_id {
    params.push(("gameid", value.to_string()));
  }
  if let Some(value) = options.version_id {
    params.push(("versionid", value.to_string()));
  }
  if let Some(value) = options.jump_list_command {
    params.push(("jumplistcommand", value.to_string()));
  }
  if let Some(value) = options.auto_install {
    params.push(("autoinstall", bool_text(value).to_string()));
  }
  if let Some(value) = options.confirm {
    params.push(("confirm", bool_text(value).to_string()));
  }
  if let Some(value) = options.query.as_deref().filter(|value| !value.is_empty()) {
    params.push(("query", value.to_string()));
  }

  let mut uri = format!("{URI_SCHEME}://{}", options.action);
  if !params.is_empty() {
    uri.push('?');
    let joined: Vec<String> = params
      .into_iter()
      .map(|(name, value)| format!("{name}={}", url_encode(&value)))
      .collect();
    uri.push_str(&joined.join("&"));
  }
  uri
}

/// Why the command line could not be used. Shown as help (exit code 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CliError {
  /// The verb that was used, if any (for the usage line).
  pub verb: Option<String>,
  /// Whether the usage should use the URI form.
  pub from_uri: bool,
  /// What went wrong, or `None` when help was requested.
  pub message: Option<String>,
}

/// Result of parsing the process arguments; `invalid_action` is an unknown
/// action inside a `--uridata`/`playstash://` argument.
pub(crate) type ParsedArgs = ParsedUri;

const VERBS: [Action; 4] = [Action::Show, Action::Install, Action::Uninstall, Action::Start];

fn is_protocol_argument(value: &str) -> bool {
  value
    .get(..URI_SCHEME.len() + 1)
    .map(|prefix| prefix.eq_ignore_ascii_case(&format!("{URI_SCHEME}:")))
    .unwrap_or(false)
    || value.to_ascii_lowercase().contains("playstash://")
}

/// Parses the process arguments (without the executable path).
///
/// Supports the verbs `show`, `install`, `uninstall` and `start`, the legacy
/// `--action X` / `--uridata "<uri>"` options, `--key=value` and
/// `--key value`, case-insensitively. Unknown arguments are ignored. An
/// argument that is a `playstash://` URI is handled as `--uridata <uri>`.
pub(crate) fn parse_args<S: AsRef<str>>(args: &[S]) -> Result<ParsedArgs, CliError> {
  let args: Vec<&str> = args.iter().map(|arg| arg.as_ref()).collect();
  let error = |verb: Option<&str>, message: String| CliError {
    verb: verb.map(str::to_string),
    from_uri: false,
    message: Some(message),
  };

  // A deep link handed over by the OS: `playstash.exe "playstash://..."`.
  let first_is_uridata = args
    .first()
    .map(|arg| arg.to_ascii_lowercase().contains("--uridata"))
    .unwrap_or(false);
  if !first_is_uridata {
    if let Some(uri) = args.iter().find(|arg| is_protocol_argument(arg)) {
      let parsed = parse_uri(uri);
      let mut options = parsed.options;
      options.is_protocol = true;
      options.autostart = args.iter().any(|arg| arg.eq_ignore_ascii_case("--autostart"));
      options.apply_protocol_safety();
      return Ok(ParsedArgs { options, invalid_action: parsed.invalid_action });
    }
  }

  let mut options = CommandOptions::default();
  let mut invalid_action = None;
  let mut uridata: Option<String> = None;
  let mut index = 0;
  let mut verb: Option<Action> = None;
  let mut verb_name: Option<&str> = None;

  if let Some(first) = args.first() {
    if !first.starts_with('-') {
      if first.eq_ignore_ascii_case("help") {
        let verb = args.get(1).copied();
        return Err(CliError { verb: verb.map(str::to_string), from_uri: false, message: None });
      }
      if let Some(action) = VERBS.iter().copied().find(|action| action.as_str().eq_ignore_ascii_case(first)) {
        verb = Some(action);
        verb_name = Some(first);
      }
      index = 1;
    }
  }

  let mut explicit_auto_install = false;
  while index < args.len() {
    let arg = args[index];
    index += 1;
    let Some(option) = arg.strip_prefix("--") else {
      // Positional values and single-dash switches are unknown: ignore.
      continue;
    };
    let (name, inline_value) = match option.split_once('=') {
      Some((name, value)) => (name, Some(value)),
      None => (option, None),
    };
    let name = name.to_ascii_lowercase();

    // Value of a non-switch option: inline, or the next argument.
    let take_value = |index: &mut usize| -> Option<String> {
      if let Some(value) = inline_value {
        return Some(value.to_string());
      }
      let next = args.get(*index)?;
      if next.starts_with("--") {
        return None;
      }
      *index += 1;
      Some((*next).to_string())
    };
    // Value of a switch: inline, or the next argument when it is a boolean.
    let switch_value = |index: &mut usize| -> Result<bool, String> {
      if let Some(value) = inline_value {
        return parse_bool(value).ok_or_else(|| format!("Option '{name}' expects true or false, got '{value}'."));
      }
      if let Some(next) = args.get(*index).and_then(|next| parse_bool(next)) {
        *index += 1;
        return Ok(next);
      }
      Ok(true)
    };

    match name.as_str() {
      "help" => {
        return Err(CliError { verb: verb_name.map(str::to_string), from_uri: false, message: None })
      }
      "action" => {
        let value = take_value(&mut index).ok_or_else(|| error(verb_name, "Option 'action' requires a value.".into()))?;
        let action = Action::parse(&value)
          .ok_or_else(|| error(verb_name, format!("Option 'action' has an invalid value '{value}'.")))?;
        options.action = action;
      }
      "minimized" => {
        options.minimized = Some(switch_value(&mut index).map_err(|message| error(verb_name, message))?);
      }
      "autoinstall" => {
        options.auto_install = Some(switch_value(&mut index).map_err(|message| error(verb_name, message))?);
        explicit_auto_install = true;
      }
      "confirm" => {
        options.confirm = Some(switch_value(&mut index).map_err(|message| error(verb_name, message))?);
      }
      "autostart" => {
        options.autostart = switch_value(&mut index).map_err(|message| error(verb_name, message))?;
      }
      "gameid" => {
        let value = take_value(&mut index).ok_or_else(|| error(verb_name, "Option 'gameid' requires a value.".into()))?;
        let id = parse_int::<i64>(&value)
          .ok_or_else(|| error(verb_name, format!("Option 'gameid' has an invalid value '{value}'.")))?;
        options.game_id = Some(id);
      }
      "versionid" => {
        let value =
          take_value(&mut index).ok_or_else(|| error(verb_name, "Option 'versionid' requires a value.".into()))?;
        let id = parse_int::<i64>(&value)
          .ok_or_else(|| error(verb_name, format!("Option 'versionid' has an invalid value '{value}'.")))?;
        options.version_id = Some(id);
      }
      "jumplistcommand" => {
        let value = take_value(&mut index)
          .ok_or_else(|| error(verb_name, "Option 'jumplistcommand' requires a value.".into()))?;
        let command = parse_int::<i32>(&value)
          .ok_or_else(|| error(verb_name, format!("Option 'jumplistcommand' has an invalid value '{value}'.")))?;
        options.jump_list_command = Some(command);
      }
      "query" => {
        let value = take_value(&mut index).ok_or_else(|| error(verb_name, "Option 'query' requires a value.".into()))?;
        options.query = Some(value);
      }
      "uridata" => {
        let value = take_value(&mut index).ok_or_else(|| CliError {
          verb: verb_name.map(str::to_string),
          from_uri: true,
          message: Some("Option 'uridata' requires a value.".into()),
        })?;
        uridata = Some(value);
      }
      _ => {}
    }
  }

  if let Some(action) = verb {
    options.action = action;
  }

  // `--uridata` overrides whatever it sets (it is applied last in the WPF client).
  if let Some(uri) = uridata {
    let parsed = parse_uri(&uri);
    invalid_action = parsed.invalid_action.clone();
    let from_uri = parsed.options;
    if verb.is_none() && parsed.invalid_action.is_none() {
      options.action = from_uri.action;
    }
    options.minimized = from_uri.minimized.or(options.minimized);
    options.game_id = from_uri.game_id.or(options.game_id);
    options.version_id = from_uri.version_id.or(options.version_id);
    options.jump_list_command = from_uri.jump_list_command.or(options.jump_list_command);
    options.auto_install = from_uri.auto_install.or(options.auto_install);
    options.confirm = from_uri.confirm.or(options.confirm);
    options.query = from_uri.query.or(options.query);
    options.is_protocol = true;
  }

  if let Some(action) = verb {
    if matches!(action, Action::Install | Action::Uninstall | Action::Start) && options.game_id.is_none() {
      return Err(error(verb_name, "Required option 'gameid' is missing.".into()));
    }
    if action == Action::Start && !explicit_auto_install && options.auto_install.is_none() {
      // Documented default of `start`: install the game when necessary.
      options.auto_install = Some(true);
    }
  }

  options.apply_protocol_safety();
  Ok(ParsedArgs { options, invalid_action })
}

/// Usage text for a help request or a parse error.
pub(crate) fn usage_text(error: &CliError, executable: &str) -> String {
  let action = error.verb.clone().unwrap_or_else(|| "<action>".to_string());
  let mut text = String::new();
  if let Some(message) = &error.message {
    text.push_str("ERROR(S):\n  ");
    text.push_str(message);
    text.push_str("\n\n");
  }
  if error.from_uri {
    text.push_str(&format!("USAGE: {URI_SCHEME}://{action}?[param=value]&...\n\n"));
  } else {
    text.push_str(&format!("USAGE: {executable} {action} [param=value] ...\n\n"));
  }
  let dash = if error.from_uri { "" } else { "--" };
  text.push_str("ACTIONS:\n");
  text.push_str("  show        Show PlayStash, or optionally a specific game.\n");
  text.push_str("  install     Install a game from PlayStash.\n");
  text.push_str("  uninstall   Uninstall a game from PlayStash.\n");
  text.push_str("  start       Start a game, or install it if necessary.\n");
  text.push_str("\nPARAMETERS:\n");
  text.push_str(&format!("  {dash}gameid           The ID of the game (required for install, uninstall and start).\n"));
  text.push_str(&format!("  {dash}minimized        Keep PlayStash in the background.\n"));
  text.push_str(&format!("  {dash}autoinstall      Install the game if it is not installed yet (start, default true).\n"));
  text.push_str(&format!("  {dash}confirm          Ask before uninstalling (default true).\n"));
  text.push_str(&format!("  {dash}jumplistcommand  Open a page: 0 Library, 1 Downloads, 2 Community, 3 Settings, 15 Exit.\n"));
  text
}

/// Whether the main window starts hidden for the given startup command.
///
/// - Started by autostart: hidden only when "start minimized" is enabled.
/// - An explicit `minimized` value decides on its own.
/// - `start --gameid` launches without the window; the command handler shows
///   it again when the game is not installed, and the frontend shows it when
///   a login is required.
pub(crate) fn should_start_hidden(options: &CommandOptions, start_minimized: bool) -> bool {
  if options.autostart {
    return start_minimized;
  }
  if let Some(minimized) = options.minimized {
    return minimized;
  }
  options.action == Action::Start && options.game_id.is_some()
}

#[cfg(test)]
mod tests {
  use super::*;

  fn uri(value: &str) -> CommandOptions {
    let parsed = parse_uri(value);
    assert_eq!(parsed.invalid_action, None, "{value}");
    parsed.options
  }

  #[test]
  fn parses_every_accepted_uri_form() {
    for value in [
      "playstash:start?gameid=1",
      "playstash://start?gameid=1",
      "playstash://start/?gameid=1",
      "playstash://///start/////?gameid=1",
      "foo-2://start?gameid=1",
      "start?gameid=1",
      "PlayStash://START?GAMEID=1",
    ] {
      let options = uri(value);
      assert_eq!(options.action, Action::Start, "{value}");
      assert_eq!(options.game_id, Some(1), "{value}");
    }
    for value in ["playstash:install", "playstash://install", "install"] {
      let options = uri(value);
      assert_eq!(options.action, Action::Install, "{value}");
      assert_eq!(options.game_id, None, "{value}");
    }
  }

  #[test]
  fn parses_params_case_insensitively_and_tolerantly() {
    let options = uri("playstash://show?Minimized=True&GameId=7&JumpListCommand=2&AutoInstall=1&confirm=false&Query=GetName");
    assert_eq!(options.minimized, Some(true));
    assert_eq!(options.game_id, Some(7));
    assert_eq!(options.jump_list_command, Some(2));
    assert_eq!(options.auto_install, Some(true));
    assert_eq!(options.confirm, Some(false));
    assert_eq!(options.query.as_deref(), Some("GetName"));

    for value in ["True", "true", "1", " TRUE "] {
      assert_eq!(uri(&format!("show?minimized={value}")).minimized, Some(true), "{value}");
    }
    assert_eq!(uri("show?minimized=yes").minimized, None);
    assert_eq!(uri("show?gameid=abc").game_id, None);
    assert_eq!(uri("show?gameid= 12 ").game_id, Some(12));
    // Entries without `=` and empty entries are skipped.
    let options = uri("show?gameid&&gameid=3&unknown=1");
    assert_eq!(options.game_id, Some(3));
    // Values are URL-decoded; the first `=` splits.
    assert_eq!(uri("query?query=Get%20Name").query.as_deref(), Some("Get Name"));
    assert_eq!(uri("query?query=a+b=c").query.as_deref(), Some("a b=c"));
  }

  #[test]
  fn invalid_action_falls_back_to_show() {
    let parsed = parse_uri("playstash://explode?gameid=5");
    assert_eq!(parsed.invalid_action.as_deref(), Some("explode"));
    assert_eq!(parsed.options.action, Action::Show);
    assert_eq!(parsed.options.game_id, Some(5));
    assert_eq!(parse_uri("playstash://").invalid_action.as_deref(), Some("playstash"));
    // Nothing matches: defaults, no dialog.
    let parsed = parse_uri("-?");
    assert_eq!(parsed.invalid_action, None);
    assert_eq!(parsed.options, CommandOptions::default());
  }

  #[test]
  fn numeric_actions_and_query_action() {
    assert_eq!(uri("3?gameid=1").action, Action::Start);
    assert_eq!(uri("playstash://query?query=installed&gameid=2").action, Action::Query);
    assert!(parse_uri("9").invalid_action.is_some());
  }

  #[test]
  fn protocol_uris_force_confirm_but_pipe_messages_do_not() {
    let parsed = parse_args(&["playstash://uninstall?gameid=5&confirm=false"]).unwrap();
    assert!(parsed.options.is_protocol);
    assert_eq!(parsed.options.confirm, Some(true));
    assert_eq!(parsed.options.action, Action::Uninstall);

    let parsed = parse_args(&["--uridata", "playstash://uninstall?gameid=5&confirm=false"]).unwrap();
    assert!(parsed.options.is_protocol);
    assert_eq!(parsed.options.confirm, Some(true));

    let pipe = parse_pipe_message("playstash://uninstall?gameid=5&minimized=true&confirm=false");
    assert!(!pipe.options.is_protocol);
    assert_eq!(pipe.options.confirm, Some(false));
  }

  #[test]
  fn show_main_window_and_bom_are_handled() {
    assert_eq!(parse_pipe_message("ShowMainWindow").options, CommandOptions::show());
    assert_eq!(parse_pipe_message("showmainwindow\r\n").options, CommandOptions::show());
    let parsed = parse_pipe_message("\u{feff}playstash://Query?Query=installed\r\n");
    assert_eq!(parsed.options.action, Action::Query);
    assert_eq!(parsed.options.query.as_deref(), Some("installed"));
  }

  #[test]
  fn serialize_round_trips() {
    let options = CommandOptions {
      action: Action::Start,
      minimized: Some(true),
      game_id: Some(42),
      version_id: Some(7),
      jump_list_command: Some(3),
      auto_install: Some(false),
      confirm: Some(true),
      query: Some("Get Name&x".into()),
      is_protocol: false,
      autostart: false,
    };
    let serialized = serialize_uri(&options);
    assert_eq!(
      serialized,
      "playstash://start?minimized=True&gameid=42&versionid=7&jumplistcommand=3&autoinstall=False&confirm=True&query=Get+Name%26x"
    );
    assert_eq!(parse_uri(&serialized).options, options);
    assert_eq!(serialize_uri(&CommandOptions::show()), "playstash://show");
  }

  #[test]
  fn argv_with_raw_uri_is_treated_as_uridata() {
    let parsed = parse_args(&["playstash://start?gameid=5"]).unwrap();
    assert_eq!(parsed.options.action, Action::Start);
    assert_eq!(parsed.options.game_id, Some(5));
    assert!(parsed.options.is_protocol);
    // A URI start has no autoinstall default.
    assert_eq!(parsed.options.auto_install, None);

    let parsed = parse_args(&["playstash:show?gameid=9"]).unwrap();
    assert_eq!(parsed.options.game_id, Some(9));

    // "Download in desktop app" link of the web frontend.
    let parsed = parse_args(&["playstash://install?gameid=5&versionid=12"]).unwrap();
    assert_eq!(parsed.options.action, Action::Install);
    assert_eq!(parsed.options.version_id, Some(12));

    let parsed = parse_args(&["playstash://nope"]).unwrap();
    assert_eq!(parsed.invalid_action.as_deref(), Some("nope"));
    assert_eq!(parsed.options.action, Action::Show);
  }

  #[test]
  fn parses_verbs_and_options() {
    let parsed = parse_args(&["start", "--gameid=5"]).unwrap().options;
    assert_eq!(parsed.action, Action::Start);
    assert_eq!(parsed.game_id, Some(5));
    assert_eq!(parsed.auto_install, Some(true));
    assert!(!parsed.is_protocol);

    let parsed = parse_args(&["START", "--GameId", "5", "--autoinstall=false"]).unwrap().options;
    assert_eq!(parsed.auto_install, Some(false));

    let parsed = parse_args(&["start", "--gameid", "5", "--autoinstall", "false"]).unwrap().options;
    assert_eq!(parsed.auto_install, Some(false));

    let parsed = parse_args(&["show", "--minimized"]).unwrap().options;
    assert_eq!(parsed.action, Action::Show);
    assert_eq!(parsed.minimized, Some(true));

    let parsed = parse_args(&["show", "--minimized=false", "--jumplistcommand=2"]).unwrap().options;
    assert_eq!(parsed.minimized, Some(false));
    assert_eq!(parsed.jump_list_command, Some(2));

    let parsed = parse_args(&["show", "--autostart"]).unwrap().options;
    assert!(parsed.autostart);

    let parsed = parse_args(&["install", "--gameid", "8"]).unwrap().options;
    assert_eq!(parsed.action, Action::Install);
    assert_eq!(parsed.auto_install, None);

    let parsed = parse_args(&["uninstall", "--gameid=8", "--confirm=false"]).unwrap().options;
    assert_eq!(parsed.action, Action::Uninstall);
    assert_eq!(parsed.confirm, Some(false));

    // Legacy option forms.
    let parsed = parse_args(&["--action", "Query", "--query", "GetAppVersion"]).unwrap().options;
    assert_eq!(parsed.action, Action::Query);
    assert_eq!(parsed.query.as_deref(), Some("GetAppVersion"));
    let parsed = parse_args(&["--uridata", "start?gameid=3"]).unwrap().options;
    assert_eq!(parsed.action, Action::Start);
    assert_eq!(parsed.game_id, Some(3));

    // Unknown arguments are ignored.
    let parsed = parse_args(&["--foo", "bar", "-psn_0_1", "--gameid=4"]).unwrap().options;
    assert_eq!(parsed.action, Action::Show);
    assert_eq!(parsed.game_id, Some(4));
    assert_eq!(parse_args::<&str>(&[]).unwrap().options, CommandOptions::default());
  }

  #[test]
  fn reports_help_and_errors() {
    let error = parse_args(&["start"]).unwrap_err();
    assert_eq!(error.verb.as_deref(), Some("start"));
    assert!(error.message.unwrap().contains("gameid"));
    assert!(parse_args(&["install", "--gameid=abc"]).is_err());
    assert!(parse_args(&["--action", "fly"]).is_err());
    let help = parse_args(&["--help"]).unwrap_err();
    assert_eq!(help.message, None);
    assert!(usage_text(&help, "playstash.exe").contains("USAGE: playstash.exe <action> [param=value] ..."));
    let uri_help = CliError { verb: Some("start".into()), from_uri: true, message: None };
    assert!(usage_text(&uri_help, "x").contains("USAGE: playstash://start?[param=value]&..."));
  }

  #[test]
  fn start_hidden_rules() {
    let autostart = parse_args(&["show", "--autostart"]).unwrap().options;
    assert!(should_start_hidden(&autostart, true));
    assert!(!should_start_hidden(&autostart, false));
    let manual = CommandOptions::show();
    assert!(!should_start_hidden(&manual, true));
    let minimized = parse_args(&["playstash://show?minimized=True"]).unwrap().options;
    assert!(should_start_hidden(&minimized, false));
    let start = parse_args(&["start", "--gameid=5"]).unwrap().options;
    assert!(should_start_hidden(&start, false));
    let start_shown = parse_args(&["start", "--gameid=5", "--minimized=false"]).unwrap().options;
    assert!(!should_start_hidden(&start_shown, false));
  }
}
