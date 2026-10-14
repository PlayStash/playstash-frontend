import type { ComponentType } from "react";

export type SettingsCategory =
  | "account"
  | "appearance"
  | "themes"
  | "sound"
  | "downloads"
  | "games"
  | "startup"
  | "community"
  | "integrations"
  | "storage"
  | "privacy"
  | "about"
  | "developer";

export interface SearchableSetting {
  /** Stable identifier, also used as the scroll/highlight target. */
  id: string;
  title: string;
  description?: string;
  category: SettingsCategory;
  keywords: string[];
  /** Only shown in the desktop (Tauri) app. Hidden from search on the web build. */
  desktopOnly?: boolean;
  /** Only shown on the web build. Hidden from search in the real desktop app. */
  webOnly?: boolean;
  /** Only shown on Linux (Tauri). Hidden from search elsewhere. */
  linuxOnly?: boolean;
}

/** Props every settings section component receives from the Settings page. */
export interface SettingsSectionProps {
  /**
   * Highlight class for the setting a search result scrolled to. Use it as
   * `<SettingsGroup id="setting-<id>" className={rowHighlight("<id>")}>`
   * with the same `<id>` as the search index entry.
   */
  rowHighlight: (searchableId: string) => string;
  /** Real Tauri or the dev override (`isTauriApp()`). */
  isTauri: boolean;
  /** Real Tauri only (`isTauriDesktop()`). */
  isDesktopApp: boolean;
  isLinux: boolean;
}

/**
 * A settings section registered by a feature package. Sections render at the
 * end of their category, in registration order. A category that has no
 * built-in content is only listed while at least one of its sections is
 * visible on the current platform.
 */
export interface SettingsSection {
  /** Unique id, e.g. "wp2-community". */
  id: string;
  component: ComponentType<SettingsSectionProps>;
  /** Only shown in the desktop (Tauri) app, including the dev override. */
  desktopOnly?: boolean;
  /** Only shown on the web build. */
  webOnly?: boolean;
  /** Only shown on Linux (Tauri). */
  linuxOnly?: boolean;
}
