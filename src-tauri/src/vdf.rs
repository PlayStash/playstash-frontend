//! Binary and text VDF helpers for Steam's `shortcuts.vdf` and
//! `loginusers.vdf` (pure, no I/O).
//!
//! Binary layout: every item is a type byte, a NUL-terminated UTF-8 key and the
//! value. A map ends with `0x08`. `shortcuts.vdf` wraps the shortcut list in a
//! root `{ "shortcuts": { "0": {...}, "1": {...} } }` map.

use std::fmt;

const TYPE_MAP: u8 = 0x00;
const TYPE_STRING: u8 = 0x01;
const TYPE_INT32: u8 = 0x02;
const TYPE_FLOAT32: u8 = 0x03;
const TYPE_POINTER: u8 = 0x04;
const TYPE_COLOR: u8 = 0x06;
const TYPE_UINT64: u8 = 0x07;
const TYPE_MAP_END: u8 = 0x08;
const TYPE_INT64: u8 = 0x0A;

/// The key that wraps the shortcut list in `shortcuts.vdf`.
pub(crate) const SHORTCUTS_ROOT_KEY: &str = "shortcuts";

/// An ordered binary VDF map. Steam keeps its own key order, so a `Vec` is
/// used instead of a hash map; keys are unique within a map.
pub(crate) type VdfMap = Vec<(String, VdfValue)>;

/// One binary VDF value. Only `Map`, `String` and `Int32` appear in
/// `shortcuts.vdf`; the other types are preserved verbatim so a file written
/// by a newer Steam client is never dropped as "corrupt".
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum VdfValue {
  Map(VdfMap),
  String(String),
  Int32(u32),
  /// Raw bits of a 32-bit float (`0x03`).
  Float32(u32),
  /// `0x04` pointer value.
  Pointer(u32),
  /// `0x06` color value.
  Color(u32),
  UInt64(u64),
  Int64(i64),
}

impl VdfValue {
  pub(crate) fn as_str(&self) -> Option<&str> {
    match self {
      VdfValue::String(value) => Some(value),
      _ => None,
    }
  }

  pub(crate) fn as_map(&self) -> Option<&VdfMap> {
    match self {
      VdfValue::Map(map) => Some(map),
      _ => None,
    }
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum VdfError {
  UnexpectedEof,
  UnknownType(u8),
  NulInString(String),
}

impl fmt::Display for VdfError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      VdfError::UnexpectedEof => write!(formatter, "Unexpected end of the VDF file"),
      VdfError::UnknownType(value) => write!(formatter, "Unexpected VDF item type: {value:#04x}"),
      VdfError::NulInString(value) => {
        write!(formatter, "Strings in VDF files cannot contain NUL characters: {value:?}")
      }
    }
  }
}

/// Looks up a key in a map (exact match).
#[cfg(test)]
pub(crate) fn map_get<'a>(map: &'a VdfMap, key: &str) -> Option<&'a VdfValue> {
  map.iter().find(|(name, _)| name == key).map(|(_, value)| value)
}

/// Looks up a key in a map, ignoring ASCII case. Steam itself is not
/// consistent about the case of shortcut keys (`AppName` vs `appname`).
pub(crate) fn map_get_ignore_case<'a>(map: &'a VdfMap, key: &str) -> Option<&'a VdfValue> {
  map
    .iter()
    .find(|(name, _)| name.eq_ignore_ascii_case(key))
    .map(|(_, value)| value)
}

struct Reader<'a> {
  bytes: &'a [u8],
  offset: usize,
}

impl<'a> Reader<'a> {
  fn byte(&mut self) -> Result<u8, VdfError> {
    let value = *self.bytes.get(self.offset).ok_or(VdfError::UnexpectedEof)?;
    self.offset += 1;
    Ok(value)
  }

  fn take<const N: usize>(&mut self) -> Result<[u8; N], VdfError> {
    let end = self.offset.checked_add(N).ok_or(VdfError::UnexpectedEof)?;
    let slice = self.bytes.get(self.offset..end).ok_or(VdfError::UnexpectedEof)?;
    self.offset = end;
    let mut out = [0u8; N];
    out.copy_from_slice(slice);
    Ok(out)
  }

  fn string(&mut self) -> Result<String, VdfError> {
    let rest = self.bytes.get(self.offset..).ok_or(VdfError::UnexpectedEof)?;
    let length = rest.iter().position(|byte| *byte == 0).ok_or(VdfError::UnexpectedEof)?;
    // Same as .NET `Encoding.UTF8.GetString`: invalid sequences become U+FFFD.
    let value = String::from_utf8_lossy(&rest[..length]).into_owned();
    self.offset += length + 1;
    Ok(value)
  }

  fn map(&mut self, depth: usize) -> Result<VdfMap, VdfError> {
    // Guard against stack exhaustion on hostile input.
    if depth > 64 {
      return Err(VdfError::UnknownType(TYPE_MAP));
    }
    let mut map = VdfMap::new();
    loop {
      let kind = self.byte()?;
      if kind == TYPE_MAP_END {
        return Ok(map);
      }
      let key = self.string()?;
      let value = match kind {
        TYPE_MAP => VdfValue::Map(self.map(depth + 1)?),
        TYPE_STRING => VdfValue::String(self.string()?),
        TYPE_INT32 => VdfValue::Int32(u32::from_le_bytes(self.take::<4>()?)),
        TYPE_FLOAT32 => VdfValue::Float32(u32::from_le_bytes(self.take::<4>()?)),
        TYPE_POINTER => VdfValue::Pointer(u32::from_le_bytes(self.take::<4>()?)),
        TYPE_COLOR => VdfValue::Color(u32::from_le_bytes(self.take::<4>()?)),
        TYPE_UINT64 => VdfValue::UInt64(u64::from_le_bytes(self.take::<8>()?)),
        TYPE_INT64 => VdfValue::Int64(i64::from_le_bytes(self.take::<8>()?)),
        other => return Err(VdfError::UnknownType(other)),
      };
      // Later duplicates overwrite earlier ones, like the WPF dictionary.
      if let Some(slot) = map.iter_mut().find(|(name, _)| *name == key) {
        slot.1 = value;
      } else {
        map.push((key, value));
      }
    }
  }
}

/// Parses a binary VDF document into its root map.
pub(crate) fn read_binary(bytes: &[u8]) -> Result<VdfMap, VdfError> {
  Reader { bytes, offset: 0 }.map(0)
}

fn write_string(out: &mut Vec<u8>, value: &str) -> Result<(), VdfError> {
  if value.contains('\0') {
    return Err(VdfError::NulInString(value.to_string()));
  }
  out.extend_from_slice(value.as_bytes());
  out.push(0);
  Ok(())
}

fn write_map(out: &mut Vec<u8>, map: &VdfMap) -> Result<(), VdfError> {
  for (key, value) in map {
    let (kind, payload): (u8, Option<Vec<u8>>) = match value {
      VdfValue::Map(_) => (TYPE_MAP, None),
      VdfValue::String(_) => (TYPE_STRING, None),
      VdfValue::Int32(number) => (TYPE_INT32, Some(number.to_le_bytes().to_vec())),
      VdfValue::Float32(bits) => (TYPE_FLOAT32, Some(bits.to_le_bytes().to_vec())),
      VdfValue::Pointer(number) => (TYPE_POINTER, Some(number.to_le_bytes().to_vec())),
      VdfValue::Color(number) => (TYPE_COLOR, Some(number.to_le_bytes().to_vec())),
      VdfValue::UInt64(number) => (TYPE_UINT64, Some(number.to_le_bytes().to_vec())),
      VdfValue::Int64(number) => (TYPE_INT64, Some(number.to_le_bytes().to_vec())),
    };
    out.push(kind);
    write_string(out, key)?;
    match value {
      VdfValue::Map(nested) => write_map(out, nested)?,
      VdfValue::String(text) => write_string(out, text)?,
      _ => out.extend_from_slice(&payload.unwrap_or_default()),
    }
  }
  out.push(TYPE_MAP_END);
  Ok(())
}

/// Serialises a root map (including its final `0x08`).
pub(crate) fn write_binary(map: &VdfMap) -> Result<Vec<u8>, VdfError> {
  let mut out = Vec::new();
  write_map(&mut out, map)?;
  Ok(out)
}

/// Reads `shortcuts.vdf` and strips the `shortcuts` wrapper. An empty file is
/// an empty shortcut list.
pub(crate) fn read_shortcuts(bytes: &[u8]) -> Result<VdfMap, VdfError> {
  if bytes.is_empty() {
    return Ok(VdfMap::new());
  }
  let root = read_binary(bytes)?;
  match root.first() {
    Some((key, VdfValue::Map(shortcuts))) if key.eq_ignore_ascii_case(SHORTCUTS_ROOT_KEY) => {
      Ok(shortcuts.clone())
    }
    _ => Ok(root),
  }
}

/// Writes a shortcut list wrapped in the `shortcuts` root map.
pub(crate) fn write_shortcuts(shortcuts: &VdfMap) -> Result<Vec<u8>, VdfError> {
  write_binary(&vec![(SHORTCUTS_ROOT_KEY.to_string(), VdfValue::Map(shortcuts.clone()))])
}

// ── Text VDF (KeyValues) ────────────────────────────────────────────────────

/// A text VDF node: either a quoted string or a nested block.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum TextVdf {
  Value(String),
  Block(Vec<(String, TextVdf)>),
}

fn text_tokens(input: &str) -> Vec<String> {
  // Tokens: quoted strings (with `\"`/`\\` escapes), bare words, `{` and `}`.
  // `//` comments run to the end of the line. `#include`-style directives and
  // conditionals (`[$WIN32]`) are skipped.
  let mut tokens = Vec::new();
  let mut chars = input.chars().peekable();
  while let Some(&character) = chars.peek() {
    match character {
      c if c.is_whitespace() => {
        chars.next();
      }
      '/' => {
        chars.next();
        if chars.peek() == Some(&'/') {
          for next in chars.by_ref() {
            if next == '\n' {
              break;
            }
          }
        }
      }
      '{' | '}' => {
        tokens.push(character.to_string());
        chars.next();
      }
      '[' => {
        for next in chars.by_ref() {
          if next == ']' {
            break;
          }
        }
      }
      '"' => {
        chars.next();
        let mut value = String::new();
        while let Some(next) = chars.next() {
          match next {
            '\\' => match chars.next() {
              Some('n') => value.push('\n'),
              Some('t') => value.push('\t'),
              Some(other) => value.push(other),
              None => break,
            },
            '"' => break,
            other => value.push(other),
          }
        }
        tokens.push(format!("\"{value}"));
      }
      _ => {
        let mut value = String::new();
        while let Some(&next) = chars.peek() {
          if next.is_whitespace() || next == '{' || next == '}' || next == '"' {
            break;
          }
          value.push(next);
          chars.next();
        }
        tokens.push(format!("\"{value}"));
      }
    }
  }
  tokens
}

fn parse_text_block(tokens: &[String], index: &mut usize, depth: usize) -> Vec<(String, TextVdf)> {
  let mut entries = Vec::new();
  while *index < tokens.len() {
    let token = &tokens[*index];
    if token == "}" {
      *index += 1;
      break;
    }
    if token == "{" {
      // A block without a key: skip it.
      *index += 1;
      if depth < 64 {
        parse_text_block(tokens, index, depth + 1);
      }
      continue;
    }
    let key = token[1..].to_string();
    *index += 1;
    let Some(next) = tokens.get(*index) else { break };
    if next == "{" {
      *index += 1;
      let block = if depth < 64 { parse_text_block(tokens, index, depth + 1) } else { Vec::new() };
      entries.push((key, TextVdf::Block(block)));
    } else if next == "}" {
      entries.push((key, TextVdf::Value(String::new())));
    } else {
      entries.push((key, TextVdf::Value(next[1..].to_string())));
      *index += 1;
    }
  }
  entries
}

/// Parses a text VDF document into its top-level entries. Malformed input
/// yields whatever could be read; this parser never fails.
pub(crate) fn parse_text(input: &str) -> Vec<(String, TextVdf)> {
  let tokens = text_tokens(input.trim_start_matches('\u{feff}'));
  let mut index = 0;
  parse_text_block(&tokens, &mut index, 0)
}

/// Steam's offset between a 64-bit SteamID and the 32-bit account id used for
/// `userdata/<accountId>`.
const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;

/// Picks the account id of the most recently signed-in Steam user from the
/// contents of `config/loginusers.vdf`.
///
/// The user marked `MostRecent "1"` wins (key compared case-insensitively). If
/// no user is marked, the one with the highest `Timestamp` is used, and a
/// single user is used as is. The WPF client returned the raw SteamID64 in
/// that case, which pointed at a userdata folder that does not exist.
pub(crate) fn most_recent_steam_account_id(loginusers: &str) -> Option<u64> {
  let root = parse_text(loginusers);
  let users = root.iter().find_map(|(key, value)| match value {
    TextVdf::Block(users) if key.eq_ignore_ascii_case("users") => Some(users),
    _ => None,
  })?;
  let field = |entries: &Vec<(String, TextVdf)>, name: &str| -> Option<String> {
    entries.iter().find_map(|(key, value)| match value {
      TextVdf::Value(text) if key.eq_ignore_ascii_case(name) => Some(text.clone()),
      _ => None,
    })
  };
  let mut candidates: Vec<(u64, bool, u64)> = Vec::new();
  for (key, value) in users {
    let TextVdf::Block(entries) = value else { continue };
    let Ok(steam_id) = key.trim().parse::<u64>() else { continue };
    if steam_id < STEAM_ID64_BASE {
      continue;
    }
    let most_recent = field(entries, "MostRecent").is_some_and(|value| value.trim() == "1");
    let timestamp = field(entries, "Timestamp")
      .and_then(|value| value.trim().parse::<u64>().ok())
      .unwrap_or(0);
    candidates.push((steam_id, most_recent, timestamp));
  }
  let chosen = candidates
    .iter()
    .find(|(_, most_recent, _)| *most_recent)
    .or_else(|| candidates.iter().max_by_key(|(_, _, timestamp)| *timestamp))?;
  Some(chosen.0 - STEAM_ID64_BASE)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sample_shortcuts() -> VdfMap {
    vec![
      (
        "0".to_string(),
        VdfValue::Map(vec![
          ("appid".to_string(), VdfValue::Int32(4_098_766_851)),
          ("AppName".to_string(), VdfValue::String("Celeste".to_string())),
          ("Exe".to_string(), VdfValue::String("\"C:\\Games\\Celeste.exe\"".to_string())),
          ("IsHidden".to_string(), VdfValue::Int32(0)),
          ("tags".to_string(), VdfValue::Map(vec![("0".to_string(), VdfValue::String("Ünïcödé".to_string()))])),
        ]),
      ),
      (
        "1".to_string(),
        VdfValue::Map(vec![
          ("appid".to_string(), VdfValue::Int32(1)),
          ("LastPlayTime".to_string(), VdfValue::UInt64(u64::MAX - 1)),
          ("Score".to_string(), VdfValue::Float32(1.5f32.to_bits())),
          ("Delta".to_string(), VdfValue::Int64(-5)),
          ("tags".to_string(), VdfValue::Map(Vec::new())),
        ]),
      ),
    ]
  }

  #[test]
  fn binary_round_trip_preserves_everything() {
    let map = sample_shortcuts();
    let bytes = write_binary(&map).unwrap();
    assert_eq!(read_binary(&bytes).unwrap(), map);
  }

  #[test]
  fn shortcuts_wrapper_is_added_and_stripped() {
    let shortcuts = sample_shortcuts();
    let bytes = write_shortcuts(&shortcuts).unwrap();
    // 0x00 "shortcuts" 0x00 ... 0x08 (shortcuts end) 0x08 (root end)
    assert_eq!(bytes[0], TYPE_MAP);
    assert_eq!(&bytes[1..11], b"shortcuts\0");
    assert_eq!(&bytes[bytes.len() - 2..], &[TYPE_MAP_END, TYPE_MAP_END]);
    assert_eq!(read_shortcuts(&bytes).unwrap(), shortcuts);
    let root = read_binary(&bytes).unwrap();
    assert_eq!(root.len(), 1);
    assert_eq!(root[0].0, "shortcuts");
  }

  #[test]
  fn exact_bytes_of_a_minimal_entry() {
    let shortcuts = vec![(
      "0".to_string(),
      VdfValue::Map(vec![
        ("appid".to_string(), VdfValue::Int32(0x0102_0304)),
        ("AppName".to_string(), VdfValue::String("A".to_string())),
      ]),
    )];
    let mut expected = vec![0x00];
    expected.extend_from_slice(b"shortcuts\0");
    expected.push(0x00);
    expected.extend_from_slice(b"0\0");
    expected.push(0x02);
    expected.extend_from_slice(b"appid\0");
    expected.extend_from_slice(&[0x04, 0x03, 0x02, 0x01]);
    expected.push(0x01);
    expected.extend_from_slice(b"AppName\0A\0");
    expected.extend_from_slice(&[0x08, 0x08, 0x08]);
    assert_eq!(write_shortcuts(&shortcuts).unwrap(), expected);
  }

  #[test]
  fn empty_file_is_an_empty_list() {
    assert!(read_shortcuts(&[]).unwrap().is_empty());
    assert!(read_shortcuts(&[0x00, b's', b'h', b'o', b'r', b't', b'c', b'u', b't', b's', 0, 0x08, 0x08])
      .unwrap()
      .is_empty());
  }

  #[test]
  fn rejects_nul_in_strings_and_keys() {
    let value = vec![("AppName".to_string(), VdfValue::String("a\0b".to_string()))];
    assert!(matches!(write_binary(&value), Err(VdfError::NulInString(_))));
    let key = vec![("App\0Name".to_string(), VdfValue::Int32(1))];
    assert!(matches!(write_binary(&key), Err(VdfError::NulInString(_))));
  }

  #[test]
  fn truncated_or_unknown_input_is_an_error() {
    let bytes = write_shortcuts(&sample_shortcuts()).unwrap();
    assert_eq!(read_binary(&bytes[..bytes.len() - 1]), Err(VdfError::UnexpectedEof));
    assert_eq!(read_binary(&[0x05, b'a', 0]), Err(VdfError::UnknownType(0x05)));
  }

  #[test]
  fn case_insensitive_lookup() {
    let map = vec![("appname".to_string(), VdfValue::String("x".to_string()))];
    assert!(map_get(&map, "AppName").is_none());
    assert_eq!(map_get_ignore_case(&map, "AppName").and_then(VdfValue::as_str), Some("x"));
  }

  const LOGINUSERS: &str = r#""users"
{
	"76561198000000001"
	{
		"AccountName"		"first"
		"PersonaName"		"First 7656119"
		"RememberPassword"		"1"
		"MostRecent"		"0"
		"Timestamp"		"1700000000"
	}
	"76561198000000002"
	{
		"AccountName"		"second"
		"PersonaName"		"Second"
		"mostrecent"		"1"
		"Timestamp"		"1600000000"
	}
}
"#;

  #[test]
  fn loginusers_picks_the_most_recent_account() {
    assert_eq!(
      most_recent_steam_account_id(LOGINUSERS),
      Some(76_561_198_000_000_002 - STEAM_ID64_BASE)
    );
  }

  #[test]
  fn loginusers_without_marker_uses_latest_timestamp() {
    let input = LOGINUSERS.replace("\"mostrecent\"\t\t\"1\"", "\"mostrecent\"\t\t\"0\"");
    assert_eq!(
      most_recent_steam_account_id(&input),
      Some(76_561_198_000_000_001 - STEAM_ID64_BASE)
    );
  }

  #[test]
  fn loginusers_garbage_yields_none() {
    assert_eq!(most_recent_steam_account_id(""), None);
    assert_eq!(most_recent_steam_account_id("\"users\" { \"abc\" { } }"), None);
  }

  #[test]
  fn text_parser_handles_escapes_and_comments() {
    let parsed = parse_text("// comment\n\"a\" { \"b\" \"x\\\"y\" \"c\" { } }");
    assert_eq!(
      parsed,
      vec![(
        "a".to_string(),
        TextVdf::Block(vec![
          ("b".to_string(), TextVdf::Value("x\"y".to_string())),
          ("c".to_string(), TextVdf::Block(Vec::new())),
        ])
      )]
    );
  }
}
