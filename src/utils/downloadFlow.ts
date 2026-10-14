/**
 * Reusable download flow (WP5 contract, Step 0 stub): root pick, version
 * pick, free-space check and overwrite confirmation, then queue the download.
 * Used by GameView, GameCard and desktop commands (CLI `install`).
 */
export type RequestGameDownloadResult = "queued" | "cancelled" | "error";

export async function requestGameDownload(options: {
  gameId: number;
  background?: boolean;
  autoInstall?: boolean;
  versionId?: number;
}): Promise<RequestGameDownloadResult> {
  void options;
  throw new Error("requestGameDownload is not implemented");
}
