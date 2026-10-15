/**
 * Minimal SemVer 2.0 parsing and ordering shared by the client update check
 * and the client/server compatibility gate.
 *
 * Accepts `1.2.3`, `v1.2`, `17.2.3-unstable.15.1` and `17.0.0-beta.1+build`;
 * missing minor/patch parts count as 0 and build metadata is ignored.
 */
export interface ParsedVersion {
  parts: [number, number, number];
  prerelease: string[];
}

export function parseVersion(raw: string): ParsedVersion | null {
  const match =
    /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.\d+)?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i.exec(
      raw.trim(),
    );
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // A release ranks above its prereleases (semver §11).
  if (!a.length || !b.length) return b.length - a.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff) return diff;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/** SemVer precedence of two parsed versions; returns <0, 0 or >0. */
export function compareParsedVersions(
  a: ParsedVersion,
  b: ParsedVersion,
): number {
  for (let index = 0; index < 3; index++) {
    const diff = a.parts[index] - b.parts[index];
    if (diff) return diff;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Compares two version strings by SemVer precedence and returns -1, 0 or 1.
 * An unparseable version never counts as newer or older (0).
 */
export function compareVersionStrings(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  return Math.sign(compareParsedVersions(a, b));
}
