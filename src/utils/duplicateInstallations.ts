/**
 * Duplicate installation detection: after a download location was
 * added or removed, a game installed under more than one location is
 * reported, like the old client did.
 */

export interface DuplicateInstallation {
  gameId: number;
  gameTitle: string;
  installations: {
    root: string;
    installationDirectory: string;
    versionDirectory: string;
  }[];
}

/** One paragraph per installed copy: `'{title}' is already installed at:\n{path}`. */
export function formatDuplicateInstallations(
  duplicates: DuplicateInstallation[],
  template = "'{title}' is already installed at:\n{path}",
): string {
  const paragraphs: string[] = [];
  for (const duplicate of duplicates) {
    for (const installation of duplicate.installations) {
      paragraphs.push(
        template
          .replace("{title}", () => duplicate.gameTitle)
          .replace("{path}", () => installation.installationDirectory),
      );
    }
  }
  return paragraphs.join("\n\n");
}

/** Normalized, sorted set of root paths, to detect real changes. */
export function rootSetKey(paths: string[]): string {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
    .sort()
    .join("\n");
}

export async function scanDuplicateInstallations(
  roots: string[],
): Promise<DuplicateInstallation[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DuplicateInstallation[]>("scan_duplicate_installations", {
    roots,
  });
}
