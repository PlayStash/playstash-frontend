/**
 * Theme generator ("Create a Theme"), a port of the WPF
 * `ThemeGeneratorUserControl`: palette arithmetic and the exported XAML.
 */
import { parseWpfColor, toArgbHex, type ArgbColor } from "./wpfColors";

export const GENERATOR_DEFAULTS = {
  name: "My PlayStash Theme",
  accent: "#FF6C67F0",
  background: "#FF11101E",
  surface: "#FF171528",
  foreground: "#FFF6F5FA",
  border: "#FF6660A9",
} as const;

export const GENERATOR_DEFAULT_FILE_NAME = "ThemeCustomDark.xaml";
export const GENERATOR_DESCRIPTION =
  "Created with the PlayStash theme generator.";
export const GENERATOR_OVERLAY_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
] as const;

export interface GeneratorPalette {
  background: string;
  surface: string;
  foreground: string;
  border: string;
}

/** C# `(byte)(double)`: truncation toward zero, kept in byte range. */
function toByte(value: number): number {
  return Math.max(0, Math.min(255, Math.trunc(value)));
}

function scaled(main: ArgbColor, factor: number, offset: number): string {
  return toArgbHex({
    a: 255,
    r: toByte(main.r * factor + offset),
    g: toByte(main.g * factor + offset),
    b: toByte(main.b * factor + offset),
  });
}

/**
 * "Generate": derives the palette from the main color. Returns `null` when
 * the main color cannot be parsed.
 */
export function generatePalette(mainColor: string): GeneratorPalette | null {
  const main = parseWpfColor(mainColor);
  if (!main) return null;
  return {
    background: scaled(main, 0.09, 0),
    surface: scaled(main, 0.17, 7),
    foreground: "#FFF6F5FA",
    border: scaled(main, 0.65, 35),
  };
}

/** `#FF` + RRGGBB (uppercase) from an `<input type="color">` value. */
export function colorFromPicker(value: string): string {
  return `#FF${value.replace(/^#/, "").toUpperCase()}`;
}

export interface GeneratorExportInput {
  /** File name without `.xaml`, written as `Theme.Name`. */
  fileBaseName: string;
  displayName: string;
  author: string;
  accent: string;
  background: string;
  surface: string;
  foreground: string;
  border: string;
  /** Overlay file name next to the theme file, e.g. `Name-overlay.png`. */
  overlayFileName?: string | null;
}

export class GeneratorColorError extends Error {}

function readColor(value: string): ArgbColor {
  const color = parseWpfColor(value);
  if (!color) {
    throw new GeneratorColorError(
      `Token is not valid. ('${value}' is not a valid color.)`,
    );
  }
  return color;
}

/** Text content escaping as done by .NET's XmlWriter. */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/** Foreground2: black on bright accents, white otherwise (WPF rule). */
export function onAccentColor(accent: ArgbColor): string {
  return accent.r * 0.2126 + accent.g * 0.7152 + accent.b * 0.0722 > 150
    ? "#FF000000"
    : "#FFFFFFFF";
}

/**
 * The exported theme document, byte-for-byte shaped like WPF's
 * `XDocument.Save` output (UTF-8 declaration, 2-space indent, CRLF).
 */
export function buildThemeXaml(input: GeneratorExportInput): string {
  const accent = readColor(input.accent);
  const background = readColor(input.background);
  const foreground = readColor(input.foreground);
  const surface = readColor(input.surface);
  const border = readColor(input.border);
  const withAlpha = (alpha: number) => toArgbHex({ ...accent, a: alpha });

  const lines: string[] = [];
  const add = (
    type: "Int32" | "String" | "Color",
    key: string,
    value: string,
  ) => {
    const tag = type === "Color" ? "Color" : `system:${type}`;
    lines.push(`  <${tag} x:Key="${key}">${escapeText(value)}</${tag}>`);
  };
  add("Int32", "Theme.SchemaVersion", "2");
  add("Int32", "Theme.Version", "1");
  add("String", "Theme.Name", input.fileBaseName);
  add("String", "Theme.DisplayName", input.displayName);
  add("String", "Theme.Description", GENERATOR_DESCRIPTION);
  add("String", "Theme.Author", input.author);
  add("Color", "PlayStash.Colors.Background", toArgbHex(background));
  add("Color", "PlayStash.Colors.Background2", toArgbHex(surface));
  add("Color", "PlayStash.Colors.Foreground", toArgbHex(foreground));
  add("Color", "PlayStash.Colors.Foreground2", onAccentColor(accent));
  add("Color", "PlayStash.Colors.Accent", toArgbHex(accent));
  add("Color", "PlayStash.Colors.Accent2", withAlpha(153));
  add("Color", "PlayStash.Colors.Accent3", withAlpha(102));
  add("Color", "PlayStash.Colors.Accent4", withAlpha(51));
  add("Color", "PlayStash.Colors.Border", toArgbHex(border));
  add("Color", "PlayStash.Colors.Blur", "#FF000000");
  if (input.overlayFileName) {
    lines.push(
      `  <BitmapImage x:Key="PlayStash.Images.Overlay" UriSource="${escapeAttribute(input.overlayFileName)}" />`,
    );
  }
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ResourceDictionary xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:system="clr-namespace:System;assembly=mscorlib" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">',
    ...lines,
    "</ResourceDictionary>",
  ].join("\r\n");
}

/** File name of the copied overlay: `<theme file base>-overlay<.ext>`. */
export function overlayFileNameFor(
  fileBaseName: string,
  imagePath: string,
): string {
  const name = imagePath.split(/[/\\]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  return `${fileBaseName}-overlay${ext}`;
}

/** `Path.GetFileNameWithoutExtension`. */
export function fileBaseName(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
