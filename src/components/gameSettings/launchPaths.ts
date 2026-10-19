/** Path relative to the installation, with the platform's separators. */
export function relativePathForCopy(
  relative: string,
  windows: boolean,
): string {
  const normalized = relative.replace(/[\\/]+/g, "/").replace(/^\/+/, "");
  return windows ? normalized.replace(/\//g, "\\") : normalized;
}

/** Absolute path of an executable inside the installation. */
export function joinInstallPath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  return [root.replace(/[\\/]+$/, ""), ...parts].join(separator);
}

/** Keeps the selected executable in a freshly scanned list. */
export function mergeExecutableList(
  scanned: string[],
  selected: string,
): string[] {
  return selected && !scanned.includes(selected)
    ? [selected, ...scanned]
    : scanned;
}
