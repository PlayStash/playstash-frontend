/**
 * Game session and exit events.
 *
 * `game-session` comes from the time tracker (survives launcher hand-off),
 * `game-exited` from the launch monitors. Both are emitted by
 * Rust (`game_sessions.rs`).
 */
export const GAME_SESSION_EVENT = "game-session";
export const GAME_EXITED_EVENT = "game-exited";

export interface GameSessionEvent {
  gameId: number;
  versionDirectory: string;
  state: "started" | "ended";
  /** Session minutes credited, set when the session ended. */
  minutes?: number;
}

export interface GameExitedEvent {
  gameId: number;
  versionDirectory: string;
  installationPath: string;
  exitCode?: number;
  ranMs: number;
  launchedRunning: boolean;
}

export interface ActiveGameSession {
  gameId: number;
  versionDirectory: string;
  /** Unix epoch milliseconds. */
  startedAt: number;
}

/** Subscribe to `game-session`. Resolves to the unlisten function. */
export async function onGameSession(
  callback: (event: GameSessionEvent) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<GameSessionEvent>(GAME_SESSION_EVENT, (event) =>
    callback(event.payload),
  );
}

/** Subscribe to `game-exited`. Resolves to the unlisten function. */
export async function onGameExited(
  callback: (event: GameExitedEvent) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<GameExitedEvent>(GAME_EXITED_EVENT, (event) =>
    callback(event.payload),
  );
}

/** Games the tracker currently sees running. */
export async function getActiveGameSessions(): Promise<ActiveGameSession[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ActiveGameSession[]>("get_active_game_sessions");
}
