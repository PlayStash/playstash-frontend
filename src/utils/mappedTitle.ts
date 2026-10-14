/**
 * Mapped title preference (WPF `ShowMappedTitle`, default on): show the
 * provider (metadata) title or the file title of a game.
 */
import { useSyncExternalStore } from "react";

export const SHOW_MAPPED_TITLE_KEY = "playstash_show_mapped_title";
export const MAPPED_TITLE_CHANGE_EVENT = "playstash:mapped-title-change";

interface TitledGame {
  title?: string | null;
  release_date?: Date | string | null;
  metadata?: {
    title?: string | null;
    release_date?: Date | string | null;
  } | null;
}

export function getShowMappedTitle(): boolean {
  try {
    return localStorage.getItem(SHOW_MAPPED_TITLE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setShowMappedTitle(show: boolean): void {
  try {
    localStorage.setItem(SHOW_MAPPED_TITLE_KEY, show ? "true" : "false");
  } catch {
    // storage unavailable: the change is lost on reload
  }
  try {
    window.dispatchEvent(
      new CustomEvent(MAPPED_TITLE_CHANGE_EVENT, { detail: { show } }),
    );
  } catch {
    // events unavailable
  }
}

/** `show && metadata.title ? metadata.title : game.title`. */
export function displayTitle(
  game: TitledGame | null | undefined,
  show: boolean = getShowMappedTitle(),
): string {
  if (!game) return "";
  const mapped = game.metadata?.title;
  if (show && mapped) return mapped;
  return game.title || mapped || "";
}

function yearOf(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

/**
 * Year shown next to the title: ` (YYYY)` from the mapped release date when
 * the mapped title is shown, otherwise from the game's own release date.
 */
export function titleYearSuffix(
  game: TitledGame | null | undefined,
  show: boolean = getShowMappedTitle(),
): string {
  if (!game) return "";
  const year = yearOf(
    show && game.metadata?.title
      ? (game.metadata?.release_date ?? game.release_date)
      : game.release_date,
  );
  return year === null ? "" : ` (${year})`;
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SHOW_MAPPED_TITLE_KEY || event.key === null) listener();
  };
  window.addEventListener(MAPPED_TITLE_CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MAPPED_TITLE_CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Live value of the mapped-title preference. */
export function useShowMappedTitle(): boolean {
  return useSyncExternalStore(subscribe, getShowMappedTitle, () => true);
}

/** The title to display for a game, following the preference. */
export function useMappedTitle(game: TitledGame | null | undefined): string {
  return displayTitle(game, useShowMappedTitle());
}
