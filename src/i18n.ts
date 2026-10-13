import { useSyncExternalStore } from "react";
import english from "./locales/en.json";
import german from "./locales/de.json";

export type Locale = "en" | "de";
export type LanguagePreference = Locale | "system";
export type TranslationKey = keyof typeof english;
export const LANGUAGE_STORAGE_KEY = "playstash_interface_language";
export const supportedLanguages = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
] as const;
const catalogs: Record<Locale, Partial<Record<TranslationKey, string>>> = {
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
