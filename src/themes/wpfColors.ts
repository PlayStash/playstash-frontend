/**
 * WPF color parsing (`System.Windows.Media.ColorConverter`) for theme files.
 *
 * Theme files store colors as `#RGB`, `#ARGB`, `#RRGGBB`, `#AARRGGBB` or a
 * WPF color name (`Black`, `IndianRed`, ...). Names are matched
 * case-insensitively, exactly like WPF; unknown names are rejected.
 */

export interface ArgbColor {
  a: number;
  r: number;
  g: number;
  b: number;
}

/** `System.Windows.Media.Colors`, as `AARRGGBB` (141 entries). */
const WPF_NAMED_COLORS: Record<string, string> = {
  aliceblue: "FFF0F8FF",
  antiquewhite: "FFFAEBD7",
  aqua: "FF00FFFF",
  aquamarine: "FF7FFFD4",
  azure: "FFF0FFFF",
  beige: "FFF5F5DC",
  bisque: "FFFFE4C4",
  black: "FF000000",
  blanchedalmond: "FFFFEBCD",
  blue: "FF0000FF",
  blueviolet: "FF8A2BE2",
  brown: "FFA52A2A",
  burlywood: "FFDEB887",
  cadetblue: "FF5F9EA0",
  chartreuse: "FF7FFF00",
  chocolate: "FFD2691E",
  coral: "FFFF7F50",
  cornflowerblue: "FF6495ED",
  cornsilk: "FFFFF8DC",
  crimson: "FFDC143C",
  cyan: "FF00FFFF",
  darkblue: "FF00008B",
  darkcyan: "FF008B8B",
  darkgoldenrod: "FFB8860B",
  darkgray: "FFA9A9A9",
  darkgreen: "FF006400",
  darkkhaki: "FFBDB76B",
  darkmagenta: "FF8B008B",
  darkolivegreen: "FF556B2F",
  darkorange: "FFFF8C00",
  darkorchid: "FF9932CC",
  darkred: "FF8B0000",
  darksalmon: "FFE9967A",
  darkseagreen: "FF8FBC8F",
  darkslateblue: "FF483D8B",
  darkslategray: "FF2F4F4F",
  darkturquoise: "FF00CED1",
  darkviolet: "FF9400D3",
  deeppink: "FFFF1493",
  deepskyblue: "FF00BFFF",
  dimgray: "FF696969",
  dodgerblue: "FF1E90FF",
  firebrick: "FFB22222",
  floralwhite: "FFFFFAF0",
  forestgreen: "FF228B22",
  fuchsia: "FFFF00FF",
  gainsboro: "FFDCDCDC",
  ghostwhite: "FFF8F8FF",
  gold: "FFFFD700",
  goldenrod: "FFDAA520",
  gray: "FF808080",
  green: "FF008000",
  greenyellow: "FFADFF2F",
  honeydew: "FFF0FFF0",
  hotpink: "FFFF69B4",
  indianred: "FFCD5C5C",
  indigo: "FF4B0082",
  ivory: "FFFFFFF0",
  khaki: "FFF0E68C",
  lavender: "FFE6E6FA",
  lavenderblush: "FFFFF0F5",
  lawngreen: "FF7CFC00",
  lemonchiffon: "FFFFFACD",
  lightblue: "FFADD8E6",
  lightcoral: "FFF08080",
  lightcyan: "FFE0FFFF",
  lightgoldenrodyellow: "FFFAFAD2",
  lightgray: "FFD3D3D3",
  lightgreen: "FF90EE90",
  lightpink: "FFFFB6C1",
  lightsalmon: "FFFFA07A",
  lightseagreen: "FF20B2AA",
  lightskyblue: "FF87CEFA",
  lightslategray: "FF778899",
  lightsteelblue: "FFB0C4DE",
  lightyellow: "FFFFFFE0",
  lime: "FF00FF00",
  limegreen: "FF32CD32",
  linen: "FFFAF0E6",
  magenta: "FFFF00FF",
  maroon: "FF800000",
  mediumaquamarine: "FF66CDAA",
  mediumblue: "FF0000CD",
  mediumorchid: "FFBA55D3",
  mediumpurple: "FF9370DB",
  mediumseagreen: "FF3CB371",
  mediumslateblue: "FF7B68EE",
  mediumspringgreen: "FF00FA9A",
  mediumturquoise: "FF48D1CC",
  mediumvioletred: "FFC71585",
  midnightblue: "FF191970",
  mintcream: "FFF5FFFA",
  mistyrose: "FFFFE4E1",
  moccasin: "FFFFE4B5",
  navajowhite: "FFFFDEAD",
  navy: "FF000080",
  oldlace: "FFFDF5E6",
  olive: "FF808000",
  olivedrab: "FF6B8E23",
  orange: "FFFFA500",
  orangered: "FFFF4500",
  orchid: "FFDA70D6",
  palegoldenrod: "FFEEE8AA",
  palegreen: "FF98FB98",
  paleturquoise: "FFAFEEEE",
  palevioletred: "FFDB7093",
  papayawhip: "FFFFEFD5",
  peachpuff: "FFFFDAB9",
  peru: "FFCD853F",
  pink: "FFFFC0CB",
  plum: "FFDDA0DD",
  powderblue: "FFB0E0E6",
  purple: "FF800080",
  red: "FFFF0000",
  rosybrown: "FFBC8F8F",
  royalblue: "FF4169E1",
  saddlebrown: "FF8B4513",
  salmon: "FFFA8072",
  sandybrown: "FFF4A460",
  seagreen: "FF2E8B57",
  seashell: "FFFFF5EE",
  sienna: "FFA0522D",
  silver: "FFC0C0C0",
  skyblue: "FF87CEEB",
  slateblue: "FF6A5ACD",
  slategray: "FF708090",
  snow: "FFFFFAFA",
  springgreen: "FF00FF7F",
  steelblue: "FF4682B4",
  tan: "FFD2B48C",
  teal: "FF008080",
  thistle: "FFD8BFD8",
  tomato: "FFFF6347",
  transparent: "00FFFFFF",
  turquoise: "FF40E0D0",
  violet: "FFEE82EE",
  wheat: "FFF5DEB3",
  white: "FFFFFFFF",
  whitesmoke: "FFF5F5F5",
  yellow: "FFFFFF00",
  yellowgreen: "FF9ACD32",
};

/** Value shape allowed in a theme file (checked before name lookup). */
export const THEME_COLOR_PATTERN =
  /^(#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{4}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|[A-Za-z]{1,32})$/;

function fromHex8(hex: string): ArgbColor {
  return {
    a: parseInt(hex.slice(0, 2), 16),
    r: parseInt(hex.slice(2, 4), 16),
    g: parseInt(hex.slice(4, 6), 16),
    b: parseInt(hex.slice(6, 8), 16),
  };
}

/**
 * Parses a WPF color string. Returns `null` for anything WPF's
 * `ColorConverter` would reject. Surrounding whitespace is ignored.
 */
export function parseWpfColor(value: string): ArgbColor | null {
  const text = value.trim();
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
    switch (hex.length) {
      case 3:
        return fromHex8(`FF${[...hex].map((c) => c + c).join("")}`);
      case 4:
        return fromHex8([...hex].map((c) => c + c).join(""));
      case 6:
        return fromHex8(`FF${hex}`);
      case 8:
        return fromHex8(hex);
      default:
        return null;
    }
  }
  const named = WPF_NAMED_COLORS[text.toLowerCase()];
  return named ? fromHex8(named) : null;
}

function hex2(value: number): string {
  return Math.max(0, Math.min(255, Math.trunc(value)))
    .toString(16)
    .toUpperCase()
    .padStart(2, "0");
}

/** `#AARRGGBB`, uppercase, as WPF's `Color.ToString()` prints it. */
export function toArgbHex(color: ArgbColor): string {
  return `#${hex2(color.a)}${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
}

/** `#RRGGBB` (lowercase), for `<input type="color">`. */
export function toRgbHex(color: ArgbColor): string {
  return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`.toLowerCase();
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** CSS `rgba()` (alpha 0-1), optionally multiplied by `opacity`. */
export function toCssColor(color: ArgbColor, opacity = 1): string {
  const alpha = round((color.a / 255) * opacity, 3);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** Linear blend of two colors (including alpha); `amount` 0 = a, 1 = b. */
export function mixColors(
  a: ArgbColor,
  b: ArgbColor,
  amount: number,
): ArgbColor {
  const mix = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return {
    a: mix(a.a, b.a),
    r: mix(a.r, b.r),
    g: mix(a.g, b.g),
    b: mix(a.b, b.b),
  };
}

/** WCAG relative luminance (0-1) of the opaque RGB part. */
export function relativeLuminance(color: ArgbColor): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}
