import type { SettingsSection } from "@/settings/types";
import { ThemeSettings } from "./ThemeSettings";
import {
  LibraryStartupSettings,
  StartupSoundSettings,
} from "./StartupExtrasSettings";
import { StorageSettings, UserCacheFolderSettings } from "./StorageSettings";

/** WP7 settings sections, spread into `CATEGORY_SECTIONS` (Settings.tsx). */
export const WP7_SECTIONS = {
  themes: [{ id: "wp7-themes", component: ThemeSettings }],
  startup: [
    { id: "wp7-library-startup", component: LibraryStartupSettings },
    {
      id: "wp7-startup-sound",
      component: StartupSoundSettings,
      desktopOnly: true,
    },
  ],
  storage: [{ id: "wp7-storage", component: StorageSettings }],
  developer: [
    {
      id: "wp7-user-cache-folder",
      component: UserCacheFolderSettings,
      desktopOnly: true,
    },
  ],
} satisfies Record<string, SettingsSection[]>;
