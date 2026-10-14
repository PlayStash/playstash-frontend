// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBuiltinTheme } from "./builtins";
import { isDarkTheme, THEME_TOKEN_NAMES, themeToTokens } from "./tokens";
import {
  applySelection,
  builtinSelection,
  getActiveTheme,
  selectTheme,
  setShowDefaultTheme,
  THEME_STORAGE_KEY,
} from "./themeManager";

const colors = (id: string) => getBuiltinTheme(id)!.definition.colors;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.classList.remove("dark");
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as any;
});

describe("themeToTokens", () => {
  it("maps the WPF colors onto the ps tokens", () => {
    const tokens = themeToTokens(colors("ThemeDefaultDark"));
    expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
    expect(tokens["--color-ps-bg"]).toBe("rgba(17, 16, 30, 1)");
    expect(tokens["--color-ps-shell"]).toBe(tokens["--color-ps-bg"]);
    expect(tokens["--color-ps-panel"]).toBe("rgba(23, 21, 40, 1)");
    // Background2 mixed 8% / 4% toward Foreground
    expect(tokens["--color-ps-panel-strong"]).toBe("rgba(41, 39, 57, 1)");
    expect(tokens["--color-ps-panel-soft"]).toBe("rgba(32, 30, 48, 1)");
    expect(tokens["--color-ps-text"]).toBe("rgba(246, 245, 250, 1)");
    expect(tokens["--color-ps-muted"]).toBe("rgba(246, 245, 250, 0.6)");
    expect(tokens["--color-ps-on-accent"]).toBe("rgba(246, 245, 250, 1)");
    expect(tokens["--color-ps-accent"]).toBe("rgba(79, 70, 175, 1)");
    expect(tokens["--color-ps-accent-strong"]).toBe(
      tokens["--color-ps-accent"],
    );
    expect(tokens["--color-ps-accent-hover"]).toBe("rgba(79, 70, 175, 0.6)");
    expect(tokens["--color-ps-accent-pressed"]).toBe("rgba(79, 70, 175, 0.4)");
    expect(tokens["--color-ps-accent-disabled"]).toBe("rgba(79, 70, 175, 0.2)");
    expect(tokens["--color-ps-line"]).toBe("rgba(102, 96, 169, 1)");
    expect(tokens["--color-ps-line-strong"]).toBe(tokens["--color-ps-line"]);
    expect(tokens["--color-ps-blur"]).toBe("rgba(0, 0, 0, 0.7)");
  });

  it("keeps a transparent blur transparent", () => {
    expect(themeToTokens(colors("ThemeChristmasDark"))["--color-ps-blur"]).toBe(
      "rgba(0, 0, 0, 0)",
    );
  });
});

describe("isDarkTheme", () => {
  it("derives the dark class from the background luminance", () => {
    expect(isDarkTheme(colors("ThemeDefaultDark"))).toBe(true);
    expect(isDarkTheme(colors("ThemeDefaultLight"))).toBe(false);
    expect(isDarkTheme(colors("ThemePhalcodeLight"))).toBe(false);
    expect(isDarkTheme(colors("ThemeChristmasDark"))).toBe(true);
    expect(isDarkTheme(colors("ThemeHalloweenDark"))).toBe(true);
  });
});

describe("theme application", () => {
  it("applies a built-in theme and persists it", async () => {
    await selectTheme(
      builtinSelection("ThemePhalcodeLight", "Phalcode (Light)"),
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-ps-accent")).toBe(
      "rgba(18, 174, 132, 1)",
    );
    expect(root.classList.contains("dark")).toBe(false);
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toMatchObject({
      source: "builtin",
      id: "ThemePhalcodeLight",
    });
    await selectTheme(builtinSelection("ThemeHalloweenDark"));
    expect(root.classList.contains("dark")).toBe(true);
  });

  it("classic themes remove all token overrides", async () => {
    await applySelection(builtinSelection("ThemeDefaultDark"));
    await selectTheme(builtinSelection("classic-dark"));
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-ps-bg")).toBe("");
    expect(root.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("darkMode")).toBe("true");
  });

  it("system follows the OS with Default (Dark)/(Light)", async () => {
    await selectTheme(builtinSelection("system"));
    expect(
      document.documentElement.style.getPropertyValue("--color-ps-bg"),
    ).toBe("rgba(226, 225, 239, 1)");
  });

  it("shows the default while logged out and restores on login", async () => {
    await selectTheme(builtinSelection("ThemeClassicDark"));
    setShowDefaultTheme(true);
    expect(getActiveTheme().selection.id).toBe("classic-system");
    setShowDefaultTheme(false);
    expect(getActiveTheme().selection.id).toBe("ThemeClassicDark");
  });
});
