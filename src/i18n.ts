import { useSyncExternalStore } from "react";
import coreEn from "./locales/core/en.json";
import coreDe from "./locales/core/de.json";
import osIntegrationEn from "./locales/osIntegration/en.json";
import osIntegrationDe from "./locales/osIntegration/de.json";
import communityEn from "./locales/community/en.json";
import communityDe from "./locales/community/de.json";
import cloudSavesEn from "./locales/cloudSaves/en.json";
import cloudSavesDe from "./locales/cloudSaves/de.json";
import launchEn from "./locales/launch/en.json";
import launchDe from "./locales/launch/de.json";
import downloadsEn from "./locales/downloads/en.json";
import downloadsDe from "./locales/downloads/de.json";
import accountsEn from "./locales/accounts/en.json";
import accountsDe from "./locales/accounts/de.json";
import appearanceEn from "./locales/appearance/en.json";
import appearanceDe from "./locales/appearance/de.json";
import commonEn from "./locales/common/en.json";
import commonDe from "./locales/common/de.json";
import settingsEn from "./locales/settings/en.json";
import settingsDe from "./locales/settings/de.json";
import gameEditorEn from "./locales/gameEditor/en.json";
import gameEditorDe from "./locales/gameEditor/de.json";
import adminEn from "./locales/admin/en.json";
import adminDe from "./locales/admin/de.json";
import libraryEn from "./locales/library/en.json";
import libraryDe from "./locales/library/de.json";
import gameEn from "./locales/game/en.json";
import gameDe from "./locales/game/de.json";
import shellEn from "./locales/shell/en.json";
import shellDe from "./locales/shell/de.json";

export type Locale = "en" | "de";
export type LanguagePreference = Locale | "system";
/**
 * Catalogs are split into namespaces (`src/locales/<ns>/{en,de}.json`) so
 * feature areas can add strings without touching the same file. Keys stay
 * flat and dotted; a key must live in exactly one namespace.
 */
export type TranslationKey = keyof (typeof coreEn &
  typeof osIntegrationEn &
  typeof communityEn &
  typeof cloudSavesEn &
  typeof launchEn &
  typeof downloadsEn &
  typeof accountsEn &
  typeof appearanceEn &
  typeof commonEn &
  typeof settingsEn &
  typeof gameEditorEn &
  typeof adminEn &
  typeof libraryEn &
  typeof gameEn &
  typeof shellEn);
type Catalog = Partial<Record<TranslationKey, string>>;
export const translationNamespaces: Record<
  string,
  { en: Catalog; de: Catalog }
> = {
  core: { en: coreEn, de: coreDe },
  osIntegration: { en: osIntegrationEn, de: osIntegrationDe },
  community: { en: communityEn, de: communityDe },
  cloudSaves: { en: cloudSavesEn, de: cloudSavesDe },
  launch: { en: launchEn, de: launchDe },
  downloads: { en: downloadsEn, de: downloadsDe },
  accounts: { en: accountsEn, de: accountsDe },
  appearance: { en: appearanceEn, de: appearanceDe },
  common: { en: commonEn, de: commonDe },
  settings: { en: settingsEn, de: settingsDe },
  gameEditor: { en: gameEditorEn, de: gameEditorDe },
  admin: { en: adminEn, de: adminDe },
  library: { en: libraryEn, de: libraryDe },
  game: { en: gameEn, de: gameDe },
  shell: { en: shellEn, de: shellDe },
};
const english = Object.assign(
  {},
  ...Object.values(translationNamespaces).map((catalog) => catalog.en),
) as Record<TranslationKey, string>;
const german = Object.assign(
  {},
  ...Object.values(translationNamespaces).map((catalog) => catalog.de),
) as Catalog;
export const LANGUAGE_STORAGE_KEY = "playstash_interface_language";
export const supportedLanguages = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
] as const;
const catalogs: Record<Locale, Catalog> = {
  en: english,
  de: german,
};
let locale: Locale = "en";
let memoryPreference: LanguagePreference | undefined;
const listeners = new Set<() => void>();

export function getLanguagePreference(): LanguagePreference {
  if (memoryPreference !== undefined) return memoryPreference;
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (value === "en" || value === "de") return value;
  } catch {
    // Language selection also works in memory when storage is unavailable.
  }
  return "system";
}

export function resolveLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === "en" || base === "de") return base;
  }
  return "en";
}

function preferredLocale(preference: LanguagePreference): Locale {
  if (preference !== "system") return preference;
  return resolveLocale(
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language],
  );
}

function applyLocale(next: Locale): void {
  locale = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((listener) => listener());
}

/** Apply a saved choice before rendering. Automatic detection does not overwrite it. */
export function initializeI18n(): void {
  memoryPreference = undefined;
  applyLocale(preferredLocale(getLanguagePreference()));
}

export function setLanguage(preference: LanguagePreference): void {
  if (!["en", "de", "system"].includes(preference)) return;
  memoryPreference = preference;
  try {
    if (preference === "system") localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Continue with the current session's choice.
  }
  applyLocale(preferredLocale(preference));
}

function onStorage(event: StorageEvent): void {
  if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return;
  memoryPreference = undefined;
  initializeI18n();
}

function subscribe(listener: () => void): () => void {
  if (!listeners.size && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}

export function translate(key: string, language: Locale = locale): string {
  if (!Object.prototype.hasOwnProperty.call(english, key)) return key;
  const entry = key as TranslationKey;
  return catalogs[language][entry] ?? english[entry] ?? key;
}

export function useTranslation() {
  const language = useSyncExternalStore(
    subscribe,
    () => locale,
    () => "en" as Locale,
  );
  return {
    locale: language,
    t: (key: TranslationKey) => translate(key, language),
  };
}

export function useLanguagePreference(): LanguagePreference {
  return useSyncExternalStore(
    subscribe,
    () => memoryPreference ?? getLanguagePreference(),
    () => "system",
  );
}
