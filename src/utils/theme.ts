import { useEffect, useState } from "react";
import {
  applyTemporaryClassicMode,
  getActiveTheme,
  selectClassicMode,
  subscribeTheme,
} from "@/themes/themeManager";

/**
 * Legacy light/dark mode of the classic web palette. The full theme system
 * (built-in, file and community themes) lives in `src/themes/`; these helpers
 * stay for callers that only switch the classic palette.
 */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "darkMode";

export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "true") return "dark";
    if (v === "false") return "light";
  } catch {
    // localStorage unavailable
  }
  return "system";
}

/**
 * Applies a classic theme mode. By default the explicit choice is persisted
 * (and becomes the selected theme). Pass `persist: false` for a temporary,
 * visual-only switch (e.g. the login page showing the device theme): it only
 * changes the classic palette and never erases the user's saved theme.
 */
export function applyTheme(mode: ThemeMode, persist = true): void {
  if (persist) selectClassicMode(mode);
  else applyTemporaryClassicMode(mode);
}

export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );

  useEffect(() => {
    const sync = () => setIsDark(getActiveTheme().isDark);
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { darkMode?: boolean } | undefined;
      if (typeof detail?.darkMode === "boolean") {
        setIsDark(detail.darkMode);
      }
    };
    setIsDark(document.documentElement.classList.contains("dark"));
    window.addEventListener("darkMode", onThemeChange);
    const unsubscribe = subscribeTheme(sync);
    return () => {
      window.removeEventListener("darkMode", onThemeChange);
      unsubscribe();
    };
  }, []);

  return isDark;
}
