import type { SettingsSection } from "@/settings/types";
import { ThemeSettings } from "./ThemeSettings";
import {
  LibraryStartupSettings,
  StartupSoundSettings,
} from "./StartupExtrasSettings";
import { StorageSettings, UserCacheFolderSettings } from "./StorageSettings";

/**
 * Theme, startup, storage and developer sections, spread into
 * `CATEGORY_SECTIONS` (Settings.tsx).
 */
export const EXTRA_SECTIONS = {
  themes: [{ id: "themes", component: ThemeSettings }],
  startup: [
    { id: "library-startup", component: LibraryStartupSettings },
    {
      id: "startup-sound",
      component: StartupSoundSettings,
      desktopOnly: true,
    },
  ],
  storage: [{ id: "storage", component: StorageSettings }],
  developer: [
    {
      id: "user-cache-folder",
      component: UserCacheFolderSettings,
      desktopOnly: true,
    },
  ],
} satisfies Record<string, SettingsSection[]>;
