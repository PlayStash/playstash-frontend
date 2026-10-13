// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { LanguagePicker } from "./components/LanguagePicker";
import {
  getLanguagePreference,
  initializeI18n,
  LANGUAGE_STORAGE_KEY,
  resolveLocale,
  setLanguage,
  translate,
  useTranslation,
} from "./i18n";
import english from "./locales/en.json";
import german from "./locales/de.json";

function NavigationLabel() {
  const { t } = useTranslation();
  return <span>{t("nav.library")}</span>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  initializeI18n();
});
afterEach(cleanup);

describe("interface language", () => {
  it("resolves regional and unsupported device languages", () => {
    expect(resolveLocale(["de-AT"])).toBe("de");
    expect(resolveLocale(["fr-FR", "de-DE"])).toBe("de");
    expect(resolveLocale(["ja-JP"])).toBe("en");
  });

  it("detects device language without persisting an override", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);
    initializeI18n();
    expect(document.documentElement.lang).toBe("de");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it("uses the stored choice before initial render", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "de");
    initializeI18n();
    expect(translate("nav.library")).toBe("Bibliothek");
    expect(document.documentElement.lang).toBe("de");
  });

  it("ignores an unsupported stored value", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "unsupported");
    initializeI18n();
    expect(getLanguagePreference()).toBe("system");
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to English and safely handles unknown keys", () => {
    expect(translate("app.name", "de")).toBe("PlayStash");
    expect(translate("future.label", "de")).toBe("future.label");
    expect(translate("__proto__", "de")).toBe("__proto__");
  });

  it("keeps catalog keys valid and translations nonempty", () => {
    for (const [key, value] of Object.entries(german)) {
      expect(Object.prototype.hasOwnProperty.call(english, key), key).toBe(
        true,
      );
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("updates mounted labels and the persisted picker immediately", () => {
    render(
      <>
        <LanguagePicker />
        <NavigationLabel />
      </>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "de" } });
    expect(screen.getByText("Bibliothek")).toBeDefined();
    expect(screen.getByRole("combobox").getAttribute("aria-label")).toBe(
      "Sprache der Oberfläche",
    );
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });

  it("synchronizes mounted labels when another tab changes language", () => {
    render(
      <>
        <LanguagePicker />
        <NavigationLabel />
      </>,
    );
    act(() => {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, "de");
      window.dispatchEvent(
        new StorageEvent("storage", { key: LANGUAGE_STORAGE_KEY }),
      );
    });
    expect(screen.getByText("Bibliothek")).toBeDefined();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
      "de",
    );
  });

  it("removes the override when following the device again", () => {
    setLanguage("de");
    setLanguage("system");
    expect(getLanguagePreference()).toBe("system");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.lang).toBe("en");
  });

  it("allows a session-only language when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setLanguage("de");
    expect(getLanguagePreference()).toBe("de");
    expect(translate("nav.library")).toBe("Bibliothek");
    expect(document.documentElement.lang).toBe("de");
  });
});
