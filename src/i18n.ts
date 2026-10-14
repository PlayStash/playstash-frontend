import { useSyncExternalStore } from "react";
import coreEn from "./locales/core/en.json";
import coreDe from "./locales/core/de.json";
import wp1En from "./locales/wp1/en.json";
import wp1De from "./locales/wp1/de.json";
import wp2En from "./locales/wp2/en.json";
import wp2De from "./locales/wp2/de.json";
import wp3En from "./locales/wp3/en.json";
import wp3De from "./locales/wp3/de.json";
import wp4En from "./locales/wp4/en.json";
import wp4De from "./locales/wp4/de.json";
import wp5En from "./locales/wp5/en.json";
import wp5De from "./locales/wp5/de.json";
import wp6En from "./locales/wp6/en.json";
import wp6De from "./locales/wp6/de.json";
import wp7En from "./locales/wp7/en.json";
import wp7De from "./locales/wp7/de.json";

export type Locale = "en" | "de";
export type LanguagePreference = Locale | "system";
/**
 * Catalogs are split into namespaces (`src/locales/<ns>/{en,de}.json`) so
 * feature packages can add strings without touching the same file. Keys stay
 * flat and dotted; a key must live in exactly one namespace.
 */
export type TranslationKey = keyof (typeof coreEn &
  typeof wp1En &
  typeof wp2En &
  typeof wp3En &
  typeof wp4En &
  typeof wp5En &
  typeof wp6En &
  typeof wp7En);
type Catalog = Partial<Record<TranslationKey, string>>;
export const translationNamespaces: Record<
  string,
  { en: Catalog; de: Catalog }
> = {
  core: { en: coreEn, de: coreDe },
  wp1: { en: wp1En, de: wp1De },
  wp2: { en: wp2En, de: wp2De },
  wp3: { en: wp3En, de: wp3De },
  wp4: { en: wp4En, de: wp4De },
  wp5: { en: wp5En, de: wp5De },
  wp6: { en: wp6En, de: wp6De },
  wp7: { en: wp7En, de: wp7De },
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
