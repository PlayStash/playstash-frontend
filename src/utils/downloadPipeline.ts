/** Small pure helpers of the download pipeline. */

/** Replaces `{name}` placeholders in a translated template. */
export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Card fields that tell whether work is still running. */
export interface CardActivity {
  status: string;
  extractionStatus?: string;
  installationStatus?: string;
}

/** Download, extraction or installation still running on this card. */
export function isCardBusy(card: CardActivity): boolean {
  return (
    card.status === "downloading" ||
    card.extractionStatus === "extracting" ||
    card.installationStatus === "copying" ||
    card.installationStatus === "launching" ||
    card.installationStatus === "running"
  );
}

/**
 * "Delete all Downloads": deletes every card from last to first, skipping
 * cards that still have work running. Returns how many were skipped.
 */
export async function deleteAllDownloadCards<
  T extends CardActivity & { gameId: number },
>(
  cards: T[],
  deleteCard: (gameId: number) => Promise<void>,
): Promise<{ deleted: number; skipped: number }> {
  let deleted = 0;
  let skipped = 0;
  for (const card of [...cards].reverse()) {
    if (isCardBusy(card)) {
      skipped++;
      continue;
    }
    try {
      await deleteCard(card.gameId);
      deleted++;
    } catch {
      skipped++;
    }
  }
  return { deleted, skipped };
}

/** True for a `.iso` file name or path. */
export function isIsoFile(path: string | undefined | null): boolean {
  return !!path && /\.iso$/i.test(path.trim());
}

/**
 * Where install files come from: the mounted ISO when there is one,
 * otherwise the extraction folder.
 */
export function installSourceDirectory(card: {
  isoMountPath?: string;
  extractionDirectory?: string;
}): string | undefined {
  return card.isoMountPath || card.extractionDirectory || undefined;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export interface InstalledEntry {
  gameId?: number;
  game_id?: number;
  versionDirectory?: string;
  installationDirectory?: string;
}

/**
 * The installation of `gameId` that lives in `versionDirectory`, if the game
 * is installed there already.
 */
export function isInstalledAt(
  installed: InstalledEntry[],
  gameId: number,
  versionDirectory: string | undefined,
): InstalledEntry | null {
  if (!versionDirectory) return null;
  const target = normalizePath(versionDirectory);
  return (
    installed.find(
      (entry) =>
        Number(entry.gameId ?? entry.game_id ?? 0) === gameId &&
        !!entry.versionDirectory &&
        normalizePath(entry.versionDirectory) === target,
    ) ?? null
  );
}

/**
 * Resume position after an error: never past the bytes that are actually on
 * disk (a write may have failed after the last progress event).
 */
export function resumePositionAfterError(
  lastReceived: number,
  bytesOnDisk: number | null,
): number {
  const received = Number.isFinite(lastReceived)
    ? Math.max(0, lastReceived)
    : 0;
  if (bytesOnDisk === null || !Number.isFinite(bytesOnDisk)) return received;
  return Math.max(0, Math.min(received, bytesOnDisk));
}
