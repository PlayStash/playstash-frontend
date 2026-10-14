/**
 * Data-only parser for PlayStash theme files (WPF `ResourceDictionary` XAML).
 *
 * Mirrors `Helper/ThemeDefinition.cs` of the WPF client: no XAML objects are
 * constructed, only a fixed set of keys and value types is accepted, and the
 * error messages are the WPF ones. File-system checks (file size on disk,
 * links, overlay location and size) live in Rust (`src-tauri/src/themes.rs`).
 */
import { translate, type TranslationKey } from "@/i18n";
import {
  parseWpfColor,
  THEME_COLOR_PATTERN,
  type ArgbColor,
} from "./wpfColors";

export const THEME_MAX_CHARACTERS = 65536;
/** Maximum theme file size on disk (`MaximumCharacters * 4`). */
export const THEME_MAX_FILE_BYTES = THEME_MAX_CHARACTERS * 4;
export const THEME_MAX_OVERLAY_BYTES = 16 * 1024 * 1024;
export const THEME_MAX_CHILDREN = 32;
export const THEME_OVERLAY_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".gif",
] as const;

const PRESENTATION_NS =
  "http://schemas.microsoft.com/winfx/2006/xaml/presentation";
const XAML_NS = "http://schemas.microsoft.com/winfx/2006/xaml";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const SYSTEM_NAMESPACES = new Set([
  "clr-namespace:System;assembly=mscorlib",
  "clr-namespace:System;assembly=System.Runtime",
]);

export const THEME_STRING_KEYS = [
  "Theme.Name",
  "Theme.DisplayName",
  "Theme.Description",
  "Theme.Author",
] as const;

export const THEME_COLOR_KEYS = [
  "PlayStash.Colors.Foreground",
  "PlayStash.Colors.Foreground2",
  "PlayStash.Colors.Background",
  "PlayStash.Colors.Background2",
  "PlayStash.Colors.Accent",
  "PlayStash.Colors.Accent2",
  "PlayStash.Colors.Accent3",
  "PlayStash.Colors.Accent4",
  "PlayStash.Colors.Border",
  "PlayStash.Colors.Blur",
] as const;

export type ThemeColorName =
  | "Foreground"
  | "Foreground2"
  | "Background"
  | "Background2"
  | "Accent"
  | "Accent2"
  | "Accent3"
  | "Accent4"
  | "Border"
  | "Blur";

export type ThemeColors = Record<ThemeColorName, ArgbColor>;

export const OVERLAY_KEY = "PlayStash.Images.Overlay";

/** WPF error texts, verbatim. */
const THEME_ERROR_KEYS = {
  tooLarge: "themes.error.tooLarge",
  dictionary: "themes.error.dictionary",
  noKey: "themes.error.noKey",
  duplicate: "themes.error.duplicate",
  imageNoPath: "themes.error.imageNoPath",
  imageFormat: "themes.error.imageFormat",
  schema: "themes.error.schema",
  unsupported: "themes.error.unsupported",
  localFiles: "themes.error.localFiles",
  imageTooLarge: "themes.error.imageTooLarge",
  unsafePath: "themes.error.unsafePath",
  unsafeWindowsPath: "themes.error.unsafeWindowsPath",
} as const satisfies Record<string, TranslationKey>;

/**
 * User-facing theme validation messages. Each property is translated when it
 * is read, so errors always use the current interface language.
 */
export const THEME_ERRORS = Object.defineProperties(
  {} as Record<keyof typeof THEME_ERROR_KEYS, string>,
  Object.fromEntries(
    Object.entries(THEME_ERROR_KEYS).map(([name, key]) => [
      name,
      { enumerable: true, get: () => translate(key) },
    ]),
  ),
);

export class ThemeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeValidationError";
  }
}

export interface ThemeDefinition {
  name: string;
  displayName: string;
  description: string;
  author: string;
  schemaVersion: number;
  version: number | null;
  colors: ThemeColors;
  /** Relative overlay image path (schema 2 only). */
  overlay: string | null;
}

const INVALID_PATH_CHARS = '<>:"|?*';
const RESERVED_DEVICES = new Set(["CON", "PRN", "AUX", "NUL"]);

/**
 * `SecurityPaths.ResolveArchiveEntry` without the final file-system
 * resolution: rejects rooted paths, control/illegal characters, `.`/`..`
 * segments, trailing dots/spaces and Windows device names.
 */
export function assertSafeRelativePath(entry: string): void {
  if (
    !entry.trim() ||
    entry.startsWith("/") ||
    entry.startsWith("\\") ||
    [...entry].some(
      (c) => c.charCodeAt(0) < 32 || INVALID_PATH_CHARS.includes(c),
    )
  ) {
    throw new ThemeValidationError(THEME_ERRORS.unsafePath);
  }
  const components = entry.replace(/[/\\]+$/, "").split(/[/\\]/);
  for (const component of components) {
    const device = component.split(".")[0].toUpperCase();
    if (
      component.length === 0 ||
      component === "." ||
      component === ".." ||
      component.endsWith(".") ||
      component.endsWith(" ") ||
      RESERVED_DEVICES.has(device) ||
      (device.length === 4 &&
        (device.startsWith("COM") || device.startsWith("LPT")) &&
        device[3] >= "0" &&
        device[3] <= "9")
    ) {
      throw new ThemeValidationError(THEME_ERRORS.unsafeWindowsPath);
    }
  }
}

/** Lowercase extension incl. the dot of the last path segment, or "". */
export function pathExtension(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 || (dot === 0 && name.length > 1)
    ? name.slice(dot).toLowerCase()
    : "";
}

function isOverlayExtension(path: string): boolean {
  return (THEME_OVERLAY_EXTENSIONS as readonly string[]).includes(
    pathExtension(path),
  );
}

/** C# `int.TryParse` (NumberStyles.Integer) on already trimmed text. */
function parseInt32(text: string): number | null {
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return null;
  if (value > 2147483647 || value < -2147483648) return null;
  return value === 0 ? 0 : value;
}

function elementChildren(node: Element): Element[] {
  return Array.from(node.childNodes).filter(
    (child): child is Element => child.nodeType === 1,
  );
}

function isNamespaceDeclaration(attribute: Attr): boolean {
  return (
    attribute.namespaceURI === XMLNS_NS ||
    attribute.name === "xmlns" ||
    attribute.name.startsWith("xmlns:")
  );
}

/**
 * Parses and validates theme XAML. Throws {@link ThemeValidationError} with
 * the WPF message on the first violation.
 */
export function parseThemeXaml(xml: string): ThemeDefinition {
  if (xml.length > THEME_MAX_CHARACTERS) {
    throw new ThemeValidationError(THEME_ERRORS.tooLarge);
  }
  // DTDs are prohibited (WPF: DtdProcessing.Prohibit). Reject before parsing
  // so no entity is ever expanded.
  if (/<!DOCTYPE/i.test(xml)) {
    throw new ThemeValidationError(THEME_ERRORS.dictionary);
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    throw new ThemeValidationError(THEME_ERRORS.dictionary);
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new ThemeValidationError(THEME_ERRORS.dictionary);
  }
  const root = doc.documentElement;
  if (
    !root ||
    root.namespaceURI !== PRESENTATION_NS ||
    root.localName !== "ResourceDictionary" ||
    Array.from(root.attributes).some((a) => !isNamespaceDeclaration(a)) ||
    elementChildren(root).length > THEME_MAX_CHILDREN
  ) {
    throw new ThemeValidationError(THEME_ERRORS.dictionary);
  }

  const values = new Map<string, string | number>();
  let overlay: string | null = null;

  for (const node of elementChildren(root)) {
    const key = node.getAttributeNS(XAML_NS, "Key");
    if (key === null || !node.hasAttributeNS(XAML_NS, "Key")) {
      throw new ThemeValidationError(THEME_ERRORS.noKey);
    }
    const isBitmap =
      node.namespaceURI === PRESENTATION_NS && node.localName === "BitmapImage";
    const badAttribute = Array.from(node.attributes).some(
      (a) =>
        !isNamespaceDeclaration(a) &&
        !(a.namespaceURI === XAML_NS && a.localName === "Key") &&
        !(isBitmap && a.namespaceURI === null && a.localName === "UriSource"),
    );
    if (
      elementChildren(node).length > 0 ||
      badAttribute ||
      values.has(key) ||
      (key === OVERLAY_KEY && overlay !== null)
    ) {
      throw new ThemeValidationError(THEME_ERRORS.duplicate);
    }
    const text = (node.textContent ?? "").trim();
    const systemType = SYSTEM_NAMESPACES.has(node.namespaceURI ?? "");
    const int =
      systemType && node.localName === "Int32" ? parseInt32(text) : null;

    if (
      systemType &&
      node.localName === "String" &&
      (THEME_STRING_KEYS as readonly string[]).includes(key) &&
      text.length <= 2048
    ) {
      values.set(key, text);
    } else if (
      systemType &&
      node.localName === "Int32" &&
      (key === "Theme.SchemaVersion" || key === "Theme.Version") &&
      int !== null &&
      int >= 0
    ) {
      values.set(key, int);
    } else if (
      node.namespaceURI === PRESENTATION_NS &&
      node.localName === "Color" &&
      (THEME_COLOR_KEYS as readonly string[]).includes(key) &&
      THEME_COLOR_PATTERN.test(text) &&
      parseWpfColor(text) !== null
    ) {
      values.set(key, text);
    } else if (isBitmap && key === OVERLAY_KEY && text.length === 0) {
      const relative = node.getAttribute("UriSource");
      if (relative === null) {
        throw new ThemeValidationError(THEME_ERRORS.imageNoPath);
      }
      assertSafeRelativePath(relative);
      if (!isOverlayExtension(relative)) {
        throw new ThemeValidationError(THEME_ERRORS.imageFormat);
      }
      overlay = relative;
    } else {
      throw new ThemeValidationError(THEME_ERRORS.unsupported);
    }
  }

  const schema = values.get("Theme.SchemaVersion");
  if (
    typeof schema !== "number" ||
    schema < 1 ||
    schema > 2 ||
    THEME_STRING_KEYS.some((key) => !values.has(key)) ||
    THEME_COLOR_KEYS.some((key) => !values.has(key)) ||
    (overlay !== null && schema !== 2)
  ) {
    throw new ThemeValidationError(THEME_ERRORS.schema);
  }

  const colors = Object.fromEntries(
    THEME_COLOR_KEYS.map((key) => [
      key.slice("PlayStash.Colors.".length),
      parseWpfColor(String(values.get(key)))!,
    ]),
  ) as ThemeColors;
  const version = values.get("Theme.Version");

  return {
    name: String(values.get("Theme.Name")),
    displayName: String(values.get("Theme.DisplayName")),
    description: String(values.get("Theme.Description")),
    author: String(values.get("Theme.Author")),
    schemaVersion: schema,
    version: typeof version === "number" ? version : null,
    colors,
    overlay,
  };
}

/** Like {@link parseThemeXaml} but returns `null` instead of throwing. */
export function tryParseThemeXaml(xml: string): ThemeDefinition | null {
  try {
    return parseThemeXaml(xml);
  } catch {
    return null;
  }
}

/** Human-readable message for any error thrown while handling themes. */
export function themeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
