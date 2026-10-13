import type { PlaystashGame } from "@/api/models/PlaystashGame";

const GAME_UPDATED_EVENT = "playstash:game-updated";

export function emitGameUpdated(game: PlaystashGame): void {
  window.dispatchEvent(
    new CustomEvent<PlaystashGame>(GAME_UPDATED_EVENT, { detail: game }),
  );
}

export function onGameUpdated(
  callback: (game: PlaystashGame) => void,
): () => void {
  const listener = (event: Event) => {
    callback((event as CustomEvent<PlaystashGame>).detail);
  };
  window.addEventListener(GAME_UPDATED_EVENT, listener);
  return () => window.removeEventListener(GAME_UPDATED_EVENT, listener);
}