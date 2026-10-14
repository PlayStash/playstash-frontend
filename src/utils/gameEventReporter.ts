import type { GameEventType } from "@/utils/gameMetrics";

/**
 * Game metric reporting for code outside React (launch and uninstall paths,
 * also used by desktop commands). `GameSessionProvider` registers the
 * `useGameMetrics()` reporter of the signed-in user; without one, reports are
 * dropped (nobody is signed in).
 */
export type GameEventReporter = (
  gameId: number,
  type: GameEventType,
  versionId?: number,
) => void;

let reporter: GameEventReporter | null = null;

/** Registers the active reporter. Returns a function that removes it again. */
export function setGameEventReporter(next: GameEventReporter): () => void {
  reporter = next;
  return () => {
    if (reporter === next) reporter = null;
  };
}

export function reportGameEvent(
  gameId: number,
  type: GameEventType,
  versionId?: number,
): void {
  try {
    reporter?.(gameId, type, versionId);
  } catch (error) {
    console.warn("Reporting the game event failed:", error);
  }
}
