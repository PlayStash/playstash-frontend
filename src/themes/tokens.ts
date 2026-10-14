/**
 * Maps the 10 colors of a WPF theme onto the `--color-ps-*` CSS variables,
 * the only theming surface of the frontend (WP7 contract).
 */
import type { ThemeColors } from "./xamlTheme";
import { mixColors, relativeLuminance, toCssColor } from "./wpfColors";

/** Every CSS variable a theme sets. Classic themes remove all of them. */
export const THEME_TOKEN_NAMES = [
  "--color-ps-bg",
  "--color-ps-shell",
  "--color-ps-panel",
  "--color-ps-panel-strong",
  "--color-ps-panel-soft",
  "--color-ps-text",
  "--color-ps-muted",
  "--color-ps-on-accent",
  "--color-ps-accent",
  "--color-ps-accent-strong",
  "--color-ps-accent-cool",
  "--color-ps-accent-hover",
  "--color-ps-accent-pressed",
  "--color-ps-accent-disabled",
  "--color-ps-line",
  "--color-ps-line-strong",
  "--color-ps-blur",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

/** Opacity of WPF's `PlayStash.Brushes.Blur`. */
export const BLUR_OPACITY = 0.7;

export function themeToTokens(
  colors: ThemeColors,
): Record<ThemeTokenName, string> {
  const accent = toCssColor(colors.Accent);
  const border = toCssColor(colors.Border);
  return {
    "--color-ps-bg": toCssColor(colors.Background),
    "--color-ps-shell": toCssColor(colors.Background),
    "--color-ps-panel": toCssColor(colors.Background2),
    "--color-ps-panel-strong": toCssColor(
      mixColors(colors.Background2, colors.Foreground, 0.08),
    ),
    "--color-ps-panel-soft": toCssColor(
      mixColors(colors.Background2, colors.Foreground, 0.04),
    ),
    "--color-ps-text": toCssColor(colors.Foreground),
    "--color-ps-muted": toCssColor(colors.Foreground, 0.6),
    "--color-ps-on-accent": toCssColor(colors.Foreground2),
    "--color-ps-accent": accent,
    "--color-ps-accent-strong": accent,
    "--color-ps-accent-cool": accent,
    "--color-ps-accent-hover": toCssColor(colors.Accent2),
    "--color-ps-accent-pressed": toCssColor(colors.Accent3),
    "--color-ps-accent-disabled": toCssColor(colors.Accent4),
    "--color-ps-line": border,
    "--color-ps-line-strong": border,
    "--color-ps-blur": toCssColor(colors.Blur, BLUR_OPACITY),
  };
}

/** Dark when the background's relative luminance is below 0.5. */
export function isDarkTheme(colors: ThemeColors): boolean {
  return relativeLuminance(colors.Background) < 0.5;
}
