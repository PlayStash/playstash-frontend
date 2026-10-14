import { useSyncExternalStore } from "react";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import { setBigPicture } from "@/utils/bigPicture";
import {
  displayTitle as mappedDisplayTitle,
  getShowMappedTitle,
} from "@/utils/mappedTitle";

/** localStorage key: open the fullscreen library when the client starts. */
export const BIG_PICTURE_ON_START_KEY = "playstash_big_picture_on_start";
const ON_START_EVENT = "playstash:big-picture-on-start-change";
const HOME_EVENT = "playstash:big-picture-home-change";

export function readBigPictureOnStart(): boolean {
  try {
    return localStorage.getItem(BIG_PICTURE_ON_START_KEY) === "1";
  } catch {
    return false;
  }
}

export function setBigPictureOnStart(enabled: boolean): void {
  try {
    localStorage.setItem(BIG_PICTURE_ON_START_KEY, enabled ? "1" : "0");
  } catch {
    // The preference only lives for this session then.
  }
  window.dispatchEvent(new Event(ON_START_EVENT));
}

function subscribeOnStart(callback: () => void) {
  window.addEventListener(ON_START_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(ON_START_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useBigPictureOnStart(): boolean {
  return useSyncExternalStore(
    subscribeOnStart,
    readBigPictureOnStart,
    () => false,
  );
}

// Whether Big Picture shows its "Installed Games" home view (instead of the
// routed page). It is the view Big Picture opens with.
let showHome = true;

export function readBigPictureHome(): boolean {
  return showHome;
}

export function setBigPictureHome(next: boolean): void {
  if (showHome === next) return;
  showHome = next;
  window.dispatchEvent(new Event(HOME_EVENT));
}

function subscribeHome(callback: () => void) {
  window.addEventListener(HOME_EVENT, callback);
  return () => window.removeEventListener(HOME_EVENT, callback);
}

export function useBigPictureHome(): boolean {
  return useSyncExternalStore(subscribeHome, readBigPictureHome, () => true);
}

/** Opens Big Picture on its installed-games view. */
export async function openFullscreenLibrary(): Promise<void> {
  setBigPictureHome(true);
  await setBigPicture(true);
}

/**
 * Installed games for the fullscreen grid: the newest installed version per
 * game, most recently played (or installed) first.
 */
export function bigPictureGames(
  installed: InstalledGameInfo[],
): InstalledGameInfo[] {
  const newest = new Map<number, InstalledGameInfo>();
  for (const game of installed) {
    const existing = newest.get(game.gameId);
    if (!existing || Number(game.versionId) > Number(existing.versionId)) {
      newest.set(game.gameId, game);
    }
  }
  const recency = (game: InstalledGameInfo) =>
    Math.max(
      Number(game.lastPlayedAt) || 0,
      Number(game.lastLaunchedAt) || 0,
      Number(game.installedAt) || 0,
    );
  return Array.from(newest.values()).sort(
    (a, b) =>
      recency(b) - recency(a) || displayTitle(a).localeCompare(displayTitle(b)),
  );
}

/**
 * Title shown for an installed game: the cached server game, following the
 * mapped-title preference, else the install folder title.
 */
export function displayTitle(
  game: InstalledGameInfo,
  showMappedTitle: boolean = getShowMappedTitle(),
): string {
  const cached = game.cachedMetadata as
    { title?: string; metadata?: { title?: string } } | null | undefined;
  return (
    mappedDisplayTitle(cached, showMappedTitle) ||
    game.gameTitle ||
    "Game"
  ).trim();
}

/** Grid index after an arrow-key move, clamped to the list. */
export function moveGridIndex(
  index: number,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  columns: number,
  count: number,
): number {
  if (count <= 0) return 0;
  const step =
    key === "ArrowLeft"
      ? -1
      : key === "ArrowRight"
        ? 1
        : key === "ArrowUp"
          ? -Math.max(1, columns)
          : Math.max(1, columns);
  return Math.min(Math.max(index + step, 0), count - 1);
}
