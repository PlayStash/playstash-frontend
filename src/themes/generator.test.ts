// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildThemeXaml,
  colorFromPicker,
  fileBaseName,
  GENERATOR_DEFAULTS,
  generatePalette,
  onAccentColor,
  overlayFileNameFor,
} from "./generator";
import { parseThemeXaml } from "./xamlTheme";
import { parseWpfColor, toArgbHex } from "./wpfColors";

describe("generatePalette", () => {
  it("matches the WPF arithmetic for #FF6C67F0", () => {
    // R=108 G=103 B=240; (byte) truncates.
    expect(generatePalette("#FF6C67F0")).toEqual({
      background: "#FF090915", // 9.72, 9.27, 21.6
      surface: "#FF19182F", // 25.36, 24.51, 47.8
      foreground: "#FFF6F5FA",
      border: "#FF6965BF", // 105.2, 101.95, 191
    });
  });

  it("accepts every WPF color format and rejects garbage", () => {
    expect(generatePalette("#6C67F0")).toEqual(generatePalette("#FF6C67F0"));
    expect(generatePalette("White")?.border).toBe("#FFC8C8C8");
    expect(generatePalette("nope")).toBeNull();
    expect(generatePalette("")).toBeNull();
  });
});

describe("buildThemeXaml", () => {
  const input = {
    fileBaseName: "ThemeCustomDark",
    displayName: GENERATOR_DEFAULTS.name,
    author: "Local user",
    accent: GENERATOR_DEFAULTS.accent,
    background: GENERATOR_DEFAULTS.background,
    surface: GENERATOR_DEFAULTS.surface,
    foreground: GENERATOR_DEFAULTS.foreground,
    border: GENERATOR_DEFAULTS.border,
  };

  it("writes the WPF document shape", () => {
    const xml = buildThemeXaml(input);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<ResourceDictionary xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:system="clr-namespace:System;assembly=mscorlib" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">',
        '  <system:Int32 x:Key="Theme.SchemaVersion">2</system:Int32>',
        '  <system:Int32 x:Key="Theme.Version">1</system:Int32>',
        '  <system:String x:Key="Theme.Name">ThemeCustomDark</system:String>',
        '  <system:String x:Key="Theme.DisplayName">My PlayStash Theme</system:String>',
        '  <system:String x:Key="Theme.Description">Created with the PlayStash theme generator.</system:String>',
        '  <system:String x:Key="Theme.Author">Local user</system:String>',
        '  <Color x:Key="PlayStash.Colors.Background">#FF11101E</Color>',
        '  <Color x:Key="PlayStash.Colors.Background2">#FF171528</Color>',
        '  <Color x:Key="PlayStash.Colors.Foreground">#FFF6F5FA</Color>',
        '  <Color x:Key="PlayStash.Colors.Foreground2">#FFFFFFFF</Color>',
        '  <Color x:Key="PlayStash.Colors.Accent">#FF6C67F0</Color>',
        '  <Color x:Key="PlayStash.Colors.Accent2">#996C67F0</Color>',
        '  <Color x:Key="PlayStash.Colors.Accent3">#666C67F0</Color>',
        '  <Color x:Key="PlayStash.Colors.Accent4">#336C67F0</Color>',
        '  <Color x:Key="PlayStash.Colors.Border">#FF6660A9</Color>',
        '  <Color x:Key="PlayStash.Colors.Blur">#FF000000</Color>',
        "</ResourceDictionary>",
      ].join("\r\n"),
    );
    // The export is a valid theme file.
    expect(parseThemeXaml(xml).displayName).toBe("My PlayStash Theme");
  });

  it("adds the overlay and escapes text", () => {
    const xml = buildThemeXaml({
      ...input,
      displayName: "A & <B>",
      overlayFileName: "ThemeCustomDark-overlay.png",
    });
    expect(xml).toContain(
      '  <BitmapImage x:Key="PlayStash.Images.Overlay" UriSource="ThemeCustomDark-overlay.png" />',
    );
    const parsed = parseThemeXaml(xml);
    expect(parsed.displayName).toBe("A & <B>");
    expect(parsed.overlay).toBe("ThemeCustomDark-overlay.png");
  });

  it("uses black text on bright accents (luminance rule)", () => {
    expect(onAccentColor(parseWpfColor("#FFFFFF00")!)).toBe("#FF000000");
    expect(onAccentColor(parseWpfColor("#FF6C67F0")!)).toBe("#FFFFFFFF");
    // 0.2126*150 + 0.7152*150 + 0.0722*150 = 150 → not > 150 → white
    expect(onAccentColor(parseWpfColor("#FF969696")!)).toBe("#FFFFFFFF");
    const xml = buildThemeXaml({ ...input, accent: "#FFFFFF00" });
    expect(toArgbHex(parseThemeXaml(xml).colors.Foreground2)).toBe("#FF000000");
  });

  it("throws on invalid colors", () => {
    expect(() => buildThemeXaml({ ...input, border: "#XYZ" })).toThrow();
  });
});

describe("helpers", () => {
  it("formats picker colors and file names", () => {
    expect(colorFromPicker("#6c67f0")).toBe("#FF6C67F0");
    expect(fileBaseName("C:\\themes\\ThemeCustomDark.xaml")).toBe(
      "ThemeCustomDark",
    );
    expect(overlayFileNameFor("ThemeCustomDark", "/home/a/pic.JPG")).toBe(
      "ThemeCustomDark-overlay.JPG",
    );
  });
});
