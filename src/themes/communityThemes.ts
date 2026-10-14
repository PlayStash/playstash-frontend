/**
 * Community themes from GitHub (`PlayStash/playstash-community-themes`,
 * folder `v1`), fetched like the WPF client: unauthenticated contents API,
 * entries whose name starts with `_` are skipped, each `download_url` is
 * downloaded and validated, failures are skipped silently.
 */
import { isTauriDesktop } from "@/utils/tauri";
import { installThemeFile, newThemeFileName } from "./themeFiles";
import {
  parseThemeXaml,
  THEME_MAX_OVERLAY_BYTES,
  ThemeValidationError,
  THEME_ERRORS,
  tryParseThemeXaml,
  type ThemeDefinition,
} from "./xamlTheme";

export const COMMUNITY_THEMES_API =
  "https://api.github.com/repos/PlayStash/playstash-community-themes/contents/v1";
export const COMMUNITY_THEMES_REPOSITORY =
  "https://github.com/PlayStash/playstash-community-themes";

export interface CommunityTheme {
  /** The theme's `download_url`. */
  url: string;
  definition: ThemeDefinition;
}

interface ContentEntry {
  name?: unknown;
  download_url?: unknown;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Unauthenticated GET: through Rust on desktop (user agent, no CORS),
 * through `fetch` on the web (GitHub serves CORS headers).
 */
export async function fetchPublicBytes(url: string): Promise<Uint8Array> {
  if (isTauriDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const response = await invoke<{ bytesBase64: string }>("github_fetch", {
      url,
    });
    return base64ToBytes(response.bytesBase64);
  }
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchPublicText(url: string): Promise<string> {
  const bytes = await fetchPublicBytes(url);
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/** Filters a GitHub contents listing like the WPF client. */
export function communityDownloadUrls(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  return (entries as ContentEntry[]).flatMap((entry) => {
    if (typeof entry?.name !== "string" || entry.name.startsWith("_")) {
      return [];
    }
    if (typeof entry.download_url !== "string" || !entry.download_url) {
      return [];
    }
    return [entry.download_url];
  });
}

/** Loads and validates the community theme list. */
export async function loadCommunityThemes(): Promise<CommunityTheme[]> {
  let entries: unknown;
  try {
    entries = JSON.parse(await fetchPublicText(COMMUNITY_THEMES_API));
  } catch {
    return [];
  }
  const urls = communityDownloadUrls(entries);
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const definition = tryParseThemeXaml(await fetchPublicText(url));
        return definition ? { url, definition } : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((theme): theme is CommunityTheme => theme !== null);
}

/** Resolves the overlay path relative to the theme's `download_url`. */
export function overlayUrlFor(downloadUrl: string, relPath: string): string {
  const base = new URL(downloadUrl);
  const encoded = relPath
    .split(/[/\\]/)
    .map((part) => encodeURIComponent(part))
    .join("/");
  const resolved = new URL(encoded, `${base.origin}${base.pathname}`);
  // Keep the query (raw.githubusercontent.com tokens of private repos).
  resolved.search = base.search;
  return resolved.toString();
}

/**
 * "Install Theme": downloads and validates the theme again, writes it as
 * `Theme-<guid>.xaml` and also downloads a schema-2 overlay image (WPF
 * skipped it, so such themes failed to load). Returns path and definition.
 */
export async function installCommunityTheme(
  theme: CommunityTheme,
): Promise<{ path: string; definition: ThemeDefinition }> {
  const content = await fetchPublicText(theme.url);
  const definition = parseThemeXaml(content);
  let overlay: { relPath: string; bytes: Uint8Array } | null = null;
  if (definition.overlay) {
    const bytes = await fetchPublicBytes(
      overlayUrlFor(theme.url, definition.overlay),
    );
    if (bytes.length > THEME_MAX_OVERLAY_BYTES) {
      throw new ThemeValidationError(THEME_ERRORS.imageTooLarge);
    }
    overlay = { relPath: definition.overlay, bytes };
  }
  const path = await installThemeFile({
    fileName: newThemeFileName(),
    content,
    overlay,
  });
  return { path, definition };
}
