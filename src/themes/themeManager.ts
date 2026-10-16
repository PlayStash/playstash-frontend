/**
 * Theme selection and application.
 *
 * The selection is persisted in localStorage `playstash_theme` (namespaced
 * per profile once a desktop profile is active) as
 * `{source: "builtin"|"file"|"community", id|path, displayName, colors?}`.
 * File themes also store their resolved colors so the theme can be applied
 * synchronously before the first render; the file is re-validated in the
 * background and the overlay image loaded.
 */
import { useSyncExternalStore } from "react";
import {
  CLASSIC_THEME_IDS,
  getBuiltinTheme,
  isClassicThemeId,
  SYSTEM_THEME_ID,
  type ClassicThemeId,
} from "./builtins";
import { isDarkTheme, THEME_TOKEN_NAMES, themeToTokens } from "./tokens";
import { loadThemeOverlay, readInstalledTheme } from "./themeFiles";
import {
  THEME_COLOR_KEYS,
  type ThemeColorName,
  type ThemeColors,
  type ThemeDefinition,
} from "./xamlTheme";
import { parseWpfColor, toArgbHex } from "./wpfColors";
import { profileScopedKey } from "@/utils/profiles";

export const THEME_STORAGE_KEY = "playstash_theme";
const LEGACY_DARK_MODE_KEY = "darkMode";
export const THEME_CHANGE_EVENT = "playstash:theme-change";

export type ThemeSource = "builtin" | "file" | "community";

export interface ThemeSelection {
  source: ThemeSource;
  /** Built-in id (`system`, `classic-*`, `ThemeDefaultDark`, ...). */
  id?: string;
  /** Installed theme path (file/community). */
  path?: string;
  displayName: string;
  /** Cached `#AARRGGBB` colors of a file theme (instant apply on boot). */
  colors?: Partial<Record<ThemeColorName, string>>;
}

export interface ActiveThemeState {
  selection: ThemeSelection;
  isDark: boolean;
  /** Object URL of the overlay image, if the theme has one. */
  overlayUrl: string | null;
  /** Error of the last apply (e.g. a deleted file); the default is shown. */
  error: string | null;
}

// ── Legacy dark-mode key (classic themes) ───────────────────────────────

type LegacyMode = "system" | "light" | "dark";

function readLegacyMode(): LegacyMode {
  try {
    const value = localStorage.getItem(LEGACY_DARK_MODE_KEY);
    if (value === "true") return "dark";
    if (value === "false") return "light";
  } catch {
    // storage unavailable
  }
  return "system";
}

function classicIdForMode(mode: LegacyMode): ClassicThemeId {
  return CLASSIC_THEME_IDS[mode];
}

function modeForClassicId(id: ClassicThemeId): LegacyMode {
  return id === CLASSIC_THEME_IDS.dark
    ? "dark"
    : id === CLASSIC_THEME_IDS.light
      ? "light"
      : "system";
}

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// ── Persistence ─────────────────────────────────────────────────────────

/** The default selection: the classic web palette in the legacy mode. */
export function defaultSelection(): ThemeSelection {
  const id = classicIdForMode(readLegacyMode());
  return { source: "builtin", id, displayName: "" };
}

function isSelection(value: unknown): value is ThemeSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as ThemeSelection;
  if (!["builtin", "file", "community"].includes(selection.source))
    return false;
  if (selection.source === "builtin") return typeof selection.id === "string";
  return typeof selection.path === "string" && selection.path.length > 0;
}

function readSelection(key: string): ThemeSelection | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The stored selection of the active profile, falling back to global. */
export function getStoredSelection(): ThemeSelection | null {
  const scoped = profileScopedKey(THEME_STORAGE_KEY);
  return (
    readSelection(scoped) ??
    (scoped !== THEME_STORAGE_KEY ? readSelection(THEME_STORAGE_KEY) : null)
  );
}

function writeSelection(selection: ThemeSelection): void {
  const value = JSON.stringify(selection);
  try {
    const scoped = profileScopedKey(THEME_STORAGE_KEY);
    localStorage.setItem(scoped, value);
    // The global key is what the next boot shows before a profile is known.
    if (scoped !== THEME_STORAGE_KEY) {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    }
    if (selection.source === "builtin" && selection.id) {
      if (isClassicThemeId(selection.id)) {
        const mode = modeForClassicId(selection.id);
        if (mode === "system") localStorage.removeItem(LEGACY_DARK_MODE_KEY);
        else
          localStorage.setItem(
            LEGACY_DARK_MODE_KEY,
            mode === "dark" ? "true" : "false",
          );
      }
    }
  } catch {
    // storage unavailable: the theme still applies for this session
  }
}

// ── Resolution ──────────────────────────────────────────────────────────

export function colorsToHex(
  colors: ThemeColors,
): Record<ThemeColorName, string> {
  return Object.fromEntries(
    Object.entries(colors).map(([name, color]) => [name, toArgbHex(color)]),
  ) as Record<ThemeColorName, string>;
}

function colorsFromHex(
  cached: Partial<Record<ThemeColorName, string>> | undefined,
): ThemeColors | null {
  if (!cached) return null;
  const out: Partial<ThemeColors> = {};
  for (const key of THEME_COLOR_KEYS) {
    const name = key.slice("PlayStash.Colors.".length) as ThemeColorName;
    const parsed = cached[name] ? parseWpfColor(cached[name]!) : null;
    if (!parsed) return null;
    out[name] = parsed;
  }
  return out as ThemeColors;
}

/**
 * Colors of a built-in selection, `null` for classic themes (CSS defaults).
 * `system` follows the OS with Default (Dark) / Default (Light).
 */
export function builtinColors(id: string): ThemeColors | null {
  if (id === SYSTEM_THEME_ID) {
    const theme = getBuiltinTheme(
      prefersDark() ? "ThemeDefaultDark" : "ThemeDefaultLight",
    );
    return theme?.definition.colors ?? null;
  }
  return getBuiltinTheme(id)?.definition.colors ?? null;
}

// ── DOM application ─────────────────────────────────────────────────────

function setDarkClass(isDark: boolean): void {
  document.documentElement.classList.toggle("dark", isDark);
  try {
    window.dispatchEvent(
      new CustomEvent("darkMode", { detail: { darkMode: isDark } }),
    );
  } catch {
    // events unavailable
  }
}

function applyTokens(colors: ThemeColors | null): void {
  const root = document.documentElement;
  if (!colors) {
    for (const name of THEME_TOKEN_NAMES) root.style.removeProperty(name);
    root.removeAttribute("data-ps-theme");
    return;
  }
  const tokens = themeToTokens(colors);
  for (const name of THEME_TOKEN_NAMES) {
    root.style.setProperty(name, tokens[name]);
  }
  root.setAttribute("data-ps-theme", "custom");
}

// ── Store ───────────────────────────────────────────────────────────────

let state: ActiveThemeState = {
  selection: {
    source: "builtin",
    id: CLASSIC_THEME_IDS.system,
    displayName: "",
  },
  isDark: false,
  overlayUrl: null,
  error: null,
};
let applyGeneration = 0;
/** While logged out the default theme is shown (the stored one is kept). */
let showDefault = false;
/** Temporary classic mode forced by a page (login shows the device theme). */
let forcedClassicMode: LegacyMode | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<ActiveThemeState>): void {
  if (next.overlayUrl !== undefined && state.overlayUrl !== next.overlayUrl) {
    if (state.overlayUrl) URL.revokeObjectURL(state.overlayUrl);
  }
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
  } catch {
    // events unavailable
  }
}

export function getActiveTheme(): ActiveThemeState {
  return state;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveTheme(): ActiveThemeState {
  return useSyncExternalStore(subscribeTheme, getActiveTheme, getActiveTheme);
}

function effectiveSelection(): ThemeSelection {
  if (showDefault) return defaultSelection();
  return getStoredSelection() ?? defaultSelection();
}

function applyClassic(selection: ThemeSelection, id: ClassicThemeId): void {
  const mode = forcedClassicMode ?? modeForClassicId(id);
  const isDark = mode === "dark" || (mode === "system" && prefersDark());
  applyTokens(null);
  setDarkClass(isDark);
  setState({ selection, isDark, overlayUrl: null, error: null });
}

function applyColors(
  selection: ThemeSelection,
  colors: ThemeColors,
  overlayUrl: string | null = null,
): void {
  const isDark = isDarkTheme(colors);
  applyTokens(colors);
  setDarkClass(isDark);
  setState({ selection, isDark, overlayUrl, error: null });
}

/**
 * Applies a selection. File themes apply their cached colors at once and
 * are then re-read from disk (validation, current colors, overlay).
 */
export function applySelection(
  selection: ThemeSelection,
): Promise<ActiveThemeState> {
  const generation = ++applyGeneration;
  if (selection.source === "builtin") {
    const id = selection.id ?? CLASSIC_THEME_IDS.system;
    if (isClassicThemeId(id)) {
      applyClassic(selection, id);
    } else {
      const colors = builtinColors(id);
      if (colors) applyColors(selection, colors);
      else applyClassic(selection, classicIdForMode(readLegacyMode()));
    }
    return Promise.resolve(state);
  }

  const cached = colorsFromHex(selection.colors);
  if (cached) applyColors(selection, cached, state.overlayUrl);
  return (async () => {
    try {
      const definition = await readInstalledTheme(selection.path!);
      if (generation !== applyGeneration) return state;
      let overlayUrl: string | null = null;
      try {
        const blob = await loadThemeOverlay(selection.path!, definition);
        if (blob) overlayUrl = URL.createObjectURL(blob);
      } catch {
        overlayUrl = null;
      }
      if (generation !== applyGeneration) {
        if (overlayUrl) URL.revokeObjectURL(overlayUrl);
        return state;
      }
      applyColors(selection, definition.colors, overlayUrl);
      return state;
    } catch (error) {
      if (generation !== applyGeneration) return state;
      const fallback = defaultSelection();
      applyClassic(fallback, fallback.id as ClassicThemeId);
      setState({
        error: error instanceof Error ? error.message : String(error),
      });
      return state;
    }
  })();
}

/** Builds the selection for an installed theme (with cached colors). */
export function fileSelection(
  path: string,
  definition: ThemeDefinition,
  source: ThemeSource = "file",
): ThemeSelection {
  return {
    source,
    path,
    displayName: definition.displayName,
    colors: colorsToHex(definition.colors),
  };
}

export function builtinSelection(id: string, displayName = ""): ThemeSelection {
  return { source: "builtin", id, displayName };
}

/** Persists and applies a new selection. */
export function selectTheme(
  selection: ThemeSelection,
): Promise<ActiveThemeState> {
  // An explicit choice always wins over a temporary mode (login page).
  forcedClassicMode = null;
  writeSelection(selection);
  if (showDefault) return Promise.resolve(state);
  return applySelection(selection);
}

/** Re-applies the stored selection (boot, profile switch, login). */
export function reapplyStoredTheme(): Promise<ActiveThemeState> {
  forcedClassicMode = null;
  return applySelection(effectiveSelection());
}

/** Logout shows the default theme; login restores the stored one. */
export function setShowDefaultTheme(value: boolean): void {
  if (showDefault === value) return;
  showDefault = value;
  void applySelection(effectiveSelection());
}

/**
 * Legacy entry used by `applyTheme(mode, false)` (login/register pages
 * temporarily show the device theme): only affects classic themes, a chosen
 * theme stays visible.
 */
export function applyTemporaryClassicMode(mode: LegacyMode): void {
  const selection = effectiveSelection();
  if (
    selection.source === "builtin" &&
    selection.id &&
    isClassicThemeId(selection.id)
  ) {
    forcedClassicMode = mode;
    applyClassic(selection, selection.id);
    return;
  }
  forcedClassicMode = null;
  void applySelection(selection);
}

/** Legacy entry used by `applyTheme(mode)`: persists a classic theme. */
export function selectClassicMode(mode: LegacyMode): void {
  forcedClassicMode = null;
  void selectTheme(builtinSelection(classicIdForMode(mode)));
}

let mediaListenerInstalled = false;

/** Applies the stored theme before render and follows OS changes. */
export function initializeThemes(): void {
  void reapplyStoredTheme();
  if (mediaListenerInstalled) return;
  mediaListenerInstalled = true;
  try {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        const selection = state.selection;
        const followsOs =
          selection.source === "builtin" &&
          (selection.id === SYSTEM_THEME_ID ||
            selection.id === CLASSIC_THEME_IDS.system ||
            forcedClassicMode === "system");
        if (followsOs) void applySelection(selection);
      });
  } catch {
    // matchMedia unavailable
  }
}

/** True when the selection refers to the same theme. */
export function isSameTheme(a: ThemeSelection, b: ThemeSelection): boolean {
  if (a.source === "builtin" || b.source === "builtin") {
    return a.source === b.source && a.id === b.id;
  }
  return a.path === b.path;
}
