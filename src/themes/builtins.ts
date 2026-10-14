/**
 * Built-in themes: the seven WPF theme files (parsed from the original XAML
 * so the values stay identical) plus the web-only "System" and
 * "Classic PlayStash web" options, which keep the existing look.
 */
import christmasDark from "./builtin/ThemeChristmasDark.xaml?raw";
import classicDark from "./builtin/ThemeClassicDark.xaml?raw";
import defaultDark from "./builtin/ThemeDefaultDark.xaml?raw";
import defaultLight from "./builtin/ThemeDefaultLight.xaml?raw";
import halloweenDark from "./builtin/ThemeHalloweenDark.xaml?raw";
import phalcodeDark from "./builtin/ThemePhalcodeDark.xaml?raw";
import phalcodeLight from "./builtin/ThemePhalcodeLight.xaml?raw";
import type { TranslationKey } from "@/i18n";
import { parseThemeXaml, type ThemeDefinition } from "./xamlTheme";

/** WPF file names in the WPF list order. */
export const BUILTIN_THEME_SOURCES: ReadonlyArray<[id: string, xaml: string]> =
  [
    ["ThemeDefaultDark", defaultDark],
    ["ThemeDefaultLight", defaultLight],
    ["ThemeClassicDark", classicDark],
    ["ThemePhalcodeDark", phalcodeDark],
    ["ThemePhalcodeLight", phalcodeLight],
    ["ThemeHalloweenDark", halloweenDark],
    ["ThemeChristmasDark", christmasDark],
  ];

/** Translated name and description of each built-in WPF theme. */
export const BUILTIN_THEME_TEXT: Readonly<
  Record<string, { name: TranslationKey; description: TranslationKey }>
> = {
  ThemeDefaultDark: {
    name: "themes.builtin.defaultDark.name",
    description: "themes.builtin.defaultDark.description",
  },
  ThemeDefaultLight: {
    name: "themes.builtin.defaultLight.name",
    description: "themes.builtin.defaultLight.description",
  },
  ThemeClassicDark: {
    name: "themes.builtin.classicDark.name",
    description: "themes.builtin.classicDark.description",
  },
  ThemePhalcodeDark: {
    name: "themes.builtin.phalcodeDark.name",
    description: "themes.builtin.phalcodeDark.description",
  },
  ThemePhalcodeLight: {
    name: "themes.builtin.phalcodeLight.name",
    description: "themes.builtin.phalcodeLight.description",
  },
  ThemeHalloweenDark: {
    name: "themes.builtin.halloweenDark.name",
    description: "themes.builtin.halloweenDark.description",
  },
  ThemeChristmasDark: {
    name: "themes.builtin.christmasDark.name",
    description: "themes.builtin.christmasDark.description",
  },
};

export interface BuiltinTheme {
  id: string;
  definition: ThemeDefinition;
}

let cache: BuiltinTheme[] | null = null;

export function getBuiltinThemes(): BuiltinTheme[] {
  if (!cache) {
    cache = BUILTIN_THEME_SOURCES.map(([id, xaml]) => ({
      id,
      definition: parseThemeXaml(xaml),
    }));
  }
  return cache;
}

export function getBuiltinTheme(id: string): BuiltinTheme | undefined {
  return getBuiltinThemes().find((theme) => theme.id === id);
}

/**
 * Pseudo themes that keep the current web palettes (`index.css`):
 * - `system` follows the OS and picks Default (Dark) or Default (Light)
 * - `classic-*` use the original PlayStash web palettes
 */
export const SYSTEM_THEME_ID = "system";
export const CLASSIC_THEME_IDS = {
  system: "classic-system",
  light: "classic-light",
  dark: "classic-dark",
} as const;

export type ClassicThemeId =
  (typeof CLASSIC_THEME_IDS)[keyof typeof CLASSIC_THEME_IDS];

export function isClassicThemeId(id: string): id is ClassicThemeId {
  return (Object.values(CLASSIC_THEME_IDS) as string[]).includes(id);
}

export const BUILTIN_AUTHOR = "Phalcode";
