/**
 * The list of selectable themes (pseudo themes, the seven built-ins and the
 * installed theme files), shared by the Appearance picker and Themes page.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import {
  BUILTIN_THEME_TEXT,
  CLASSIC_THEME_IDS,
  getBuiltinThemes,
  SYSTEM_THEME_ID,
} from "./builtins";
import { listInstalledThemes, type InstalledTheme } from "./themeFiles";
import {
  builtinSelection,
  fileSelection,
  type ThemeSelection,
} from "./themeManager";
import type { ThemeDefinition } from "./xamlTheme";

export interface ThemeOption {
  key: string;
  displayName: string;
  description: string;
  author: string;
  selection: ThemeSelection;
  /** Installed theme file (can be uninstalled). */
  installed?: InstalledTheme;
}

export const THEME_LIST_CHANGED_EVENT = "playstash:theme-list-changed";

/** Tells every theme list to reload (after install/uninstall/export). */
export function notifyThemeListChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(THEME_LIST_CHANGED_EVENT));
  } catch {
    // events unavailable
  }
}

export function optionKey(selection: ThemeSelection): string {
  return selection.source === "builtin"
    ? `builtin:${selection.id}`
    : `file:${selection.path}`;
}

function definitionOption(
  key: string,
  definition: ThemeDefinition,
  selection: ThemeSelection,
  installed?: InstalledTheme,
): ThemeOption {
  return {
    key,
    displayName: definition.displayName,
    description: definition.description,
    author: definition.author,
    selection,
    installed,
  };
}

export function useThemeOptions() {
  const { t } = useTranslation();
  const [installed, setInstalled] = useState<InstalledTheme[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setInstalled(await listInstalledThemes());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener(THEME_LIST_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(THEME_LIST_CHANGED_EVENT, onChange);
  }, [reload]);

  const pseudo: ThemeOption[] = [
    {
      key: `builtin:${SYSTEM_THEME_ID}`,
      displayName: t("themes.system.name"),
      description: t("themes.system.description"),
      author: "PlayStash",
      selection: builtinSelection(SYSTEM_THEME_ID, t("themes.system.name")),
    },
    {
      key: `builtin:${CLASSIC_THEME_IDS.system}`,
      displayName: t("themes.classic.name"),
      description: t("themes.classic.description"),
      author: "PlayStash",
      selection: builtinSelection(
        CLASSIC_THEME_IDS.system,
        t("themes.classic.name"),
      ),
    },
    {
      key: `builtin:${CLASSIC_THEME_IDS.light}`,
      displayName: t("themes.classicLight.name"),
      description: t("themes.classicLight.description"),
      author: "PlayStash",
      selection: builtinSelection(
        CLASSIC_THEME_IDS.light,
        t("themes.classicLight.name"),
      ),
    },
    {
      key: `builtin:${CLASSIC_THEME_IDS.dark}`,
      displayName: t("themes.classicDark.name"),
      description: t("themes.classicDark.description"),
      author: "PlayStash",
      selection: builtinSelection(
        CLASSIC_THEME_IDS.dark,
        t("themes.classicDark.name"),
      ),
    },
  ];
  const builtins = getBuiltinThemes().map((theme) => {
    const text = BUILTIN_THEME_TEXT[theme.id];
    const definition = text
      ? {
          ...theme.definition,
          displayName: t(text.name),
          description: t(text.description),
        }
      : theme.definition;
    return definitionOption(
      `builtin:${theme.id}`,
      definition,
      builtinSelection(theme.id, definition.displayName),
    );
  });
  const files = installed.map((theme) =>
    definitionOption(
      `file:${theme.path}`,
      theme.definition,
      fileSelection(theme.path, theme.definition),
      theme,
    ),
  );

  return {
    options: [...pseudo, ...builtins, ...files],
    installed,
    loading,
    reload,
  };
}
