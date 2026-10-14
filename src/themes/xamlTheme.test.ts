// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BUILTIN_THEME_SOURCES, getBuiltinThemes } from "./builtins";
import {
  assertSafeRelativePath,
  parseThemeXaml,
  THEME_ERRORS,
  tryParseThemeXaml,
} from "./xamlTheme";
import { toArgbHex } from "./wpfColors";

const HEADER =
  '<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:system="clr-namespace:System;assembly=mscorlib">';

const COLORS: Record<string, string> = {
  Foreground: "#FFF6F5FA",
  Foreground2: "#FFF6F5FA",
  Background: "#FF11101E",
  Background2: "#FF171528",
  Accent: "#FF4F46AF",
  Accent2: "#994F46AF",
  Accent3: "#664F46AF",
  Accent4: "#334F46AF",
  Border: "#FF6660A9",
  Blur: "Black",
};

function theme({
  schema = "1",
  colors = COLORS,
  extra = "",
  omit = [] as string[],
} = {}): string {
  const entries = [
    `<system:Int32 x:Key="Theme.SchemaVersion">${schema}</system:Int32>`,
    '<system:Int32 x:Key="Theme.Version">1</system:Int32>',
    '<system:String x:Key="Theme.Name">ThemeTestDark</system:String>',
    '<system:String x:Key="Theme.DisplayName">Test (Dark)</system:String>',
    '<system:String x:Key="Theme.Description">A test theme.</system:String>',
    '<system:String x:Key="Theme.Author">Tester</system:String>',
    ...Object.entries(colors)
      .filter(([name]) => !omit.includes(name))
      .map(
        ([name, value]) =>
          `<Color x:Key="PlayStash.Colors.${name}">${value}</Color>`,
      ),
  ];
  return `${HEADER}\n${entries.join("\n")}\n${extra}\n</ResourceDictionary>`;
}

function expectError(xml: string, message: string) {
  expect(() => parseThemeXaml(xml)).toThrow(message);
}

describe("parseThemeXaml", () => {
  it("parses every built-in WPF theme", () => {
    expect(BUILTIN_THEME_SOURCES).toHaveLength(7);
    const themes = getBuiltinThemes();
    expect(themes.map((t) => t.definition.displayName)).toEqual([
      "Default (Dark)",
      "Default (Light)",
      "Classic (Dark)",
      "Phalcode (Dark)",
      "Phalcode (Light)",
      "Halloween (Dark)",
      "Christmas (Dark)",
    ]);
    for (const { definition } of themes) {
      expect(definition.author).toBe("Phalcode");
      expect(definition.schemaVersion).toBe(1);
      expect(definition.overlay).toBeNull();
      const accent = definition.colors.Accent;
      expect(definition.colors.Accent2).toEqual({ ...accent, a: 0x99 });
      expect(definition.colors.Accent3).toEqual({ ...accent, a: 0x66 });
      expect(definition.colors.Accent4).toEqual({ ...accent, a: 0x33 });
    }
    const defaultDark = themes[0].definition;
    expect(defaultDark.name).toBe("ThemePlayStashDark");
    expect(toArgbHex(defaultDark.colors.Background)).toBe("#FF11101E");
    expect(toArgbHex(defaultDark.colors.Blur)).toBe("#FF000000");
    expect(defaultDark.description).toBe(
      "The default PlayStash theme, reflecting the 2024 PlayStash rebrand with dark tones.",
    );
    const christmas = themes[6].definition;
    expect(toArgbHex(christmas.colors.Blur)).toBe("#00000000");
    expect(toArgbHex(christmas.colors.Border)).toBe("#FFB39800");
  });

  it("accepts a valid file and the System.Runtime namespace", () => {
    expect(parseThemeXaml(theme()).displayName).toBe("Test (Dark)");
    const runtime = theme().replace(
      "assembly=mscorlib",
      "assembly=System.Runtime",
    );
    expect(parseThemeXaml(runtime).version).toBe(1);
  });

  it("rejects a document type definition", () => {
    const xml = `<!DOCTYPE x [<!ENTITY a "b">]>\n${theme()}`;
    expectError(xml, THEME_ERRORS.dictionary);
  });

  it("rejects files that are too large", () => {
    expectError(
      theme({ extra: `<!--${"x".repeat(65536)}-->` }),
      THEME_ERRORS.tooLarge,
    );
  });

  it("rejects more than 32 child elements", () => {
    const extra = Array.from(
      { length: 17 },
      (_, i) => `<system:String x:Key="Extra${i}">x</system:String>`,
    ).join("");
    expectError(theme({ extra }), THEME_ERRORS.dictionary);
  });

  it("rejects a wrong root element and extra root attributes", () => {
    expectError(
      theme().replace(/ResourceDictionary/g, "Grid"),
      THEME_ERRORS.dictionary,
    );
    expectError(
      theme().replace("<ResourceDictionary ", '<ResourceDictionary a="b" '),
      THEME_ERRORS.dictionary,
    );
  });

  it("rejects a missing color", () => {
    expectError(theme({ omit: ["Border"] }), THEME_ERRORS.schema);
  });

  it("rejects a missing key and duplicate keys", () => {
    expectError(
      theme({ extra: "<Color>#FFFFFFFF</Color>" }),
      THEME_ERRORS.noKey,
    );
    expectError(
      theme({
        extra: '<Color x:Key="PlayStash.Colors.Border">#FF000000</Color>',
      }),
      THEME_ERRORS.duplicate,
    );
  });

  it("rejects extra attributes and nested elements", () => {
    expectError(
      theme().replace(
        '<Color x:Key="PlayStash.Colors.Blur">',
        '<Color x:Key="PlayStash.Colors.Blur" Opacity="1">',
      ),
      THEME_ERRORS.duplicate,
    );
    expectError(
      theme().replace(
        '<Color x:Key="PlayStash.Colors.Blur">Black',
        '<Color x:Key="PlayStash.Colors.Blur"><x:Null/>',
      ),
      THEME_ERRORS.duplicate,
    );
  });

  it("rejects bad colors and unknown color names", () => {
    expectError(
      theme({ colors: { ...COLORS, Accent: "#12345" } }),
      THEME_ERRORS.unsupported,
    );
    expectError(
      theme({ colors: { ...COLORS, Accent: "NotAColor" } }),
      THEME_ERRORS.unsupported,
    );
    expectError(
      theme({ colors: { ...COLORS, Accent: "rgb(1,2,3)" } }),
      THEME_ERRORS.unsupported,
    );
    const named = parseThemeXaml(
      theme({ colors: { ...COLORS, Accent: "indianred" } }),
    );
    expect(toArgbHex(named.colors.Accent)).toBe("#FFCD5C5C");
    const short = parseThemeXaml(
      theme({ colors: { ...COLORS, Accent: "#8ABC" } }),
    );
    expect(toArgbHex(short.colors.Accent)).toBe("#88AABBCC");
  });

  it("rejects unsupported keys, types and schema versions", () => {
    expectError(
      theme({ extra: '<system:String x:Key="Other">x</system:String>' }),
      THEME_ERRORS.unsupported,
    );
    expectError(theme({ schema: "3" }), THEME_ERRORS.schema);
    expectError(theme({ schema: "-1" }), THEME_ERRORS.unsupported);
  });

  const overlay = (path: string) =>
    `<BitmapImage x:Key="PlayStash.Images.Overlay" UriSource="${path}" />`;

  it("accepts an overlay only with schema 2", () => {
    expect(
      parseThemeXaml(theme({ schema: "2", extra: overlay("img/overlay.png") }))
        .overlay,
    ).toBe("img/overlay.png");
    expectError(
      theme({ schema: "1", extra: overlay("overlay.png") }),
      THEME_ERRORS.schema,
    );
  });

  it("rejects unsafe or unsupported overlay paths", () => {
    expectError(
      theme({ schema: "2", extra: overlay("../x.png") }),
      THEME_ERRORS.unsafeWindowsPath,
    );
    expectError(
      theme({ schema: "2", extra: overlay("/x.png") }),
      THEME_ERRORS.unsafePath,
    );
    expectError(
      theme({ schema: "2", extra: overlay("C:\\x.png") }),
      THEME_ERRORS.unsafePath,
    );
    expectError(
      theme({ schema: "2", extra: overlay("overlay.svg") }),
      THEME_ERRORS.imageFormat,
    );
    expectError(
      theme({
        schema: "2",
        extra: '<BitmapImage x:Key="PlayStash.Images.Overlay" />',
      }),
      THEME_ERRORS.imageNoPath,
    );
  });

  it("returns null from tryParseThemeXaml for invalid input", () => {
    expect(tryParseThemeXaml("not xml")).toBeNull();
    expect(tryParseThemeXaml(theme())).not.toBeNull();
  });
});

describe("assertSafeRelativePath", () => {
  it("accepts nested relative paths and rejects device names", () => {
    expect(() => assertSafeRelativePath("a/b.png")).not.toThrow();
    for (const bad of ["CON.png", "lpt1.png", "a/./b.png", "x.png.", ""]) {
      expect(() => assertSafeRelativePath(bad)).toThrow();
    }
  });
});
