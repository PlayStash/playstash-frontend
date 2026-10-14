/**
 * Shared launch path for installed games (WP4 contract, Step 0 stub).
 *
 * Used by GameView, GameCard, Big Picture, desktop commands (CLI `start`,
 * jump list) and integrations. WP4 fills in the body.
 */
import type { LaunchProfileDto, PlaystashGame } from "@/api";

export type LaunchSource =
  | "game-view"
  | "game-card"
  | "big-picture"
  | "cli"
  | "jump-list"
  | "integration";

export interface LaunchResult {
  ok: boolean;
  message?: string;
}

export interface PreLaunchContext {
  gameId: number;
  versionId: number;
  versionDirectory: string;
  installationPath: string;
  game: PlaystashGame | null;
  umuWinePrefix?: string;
}

export type PreLaunchHookResult = void | { abort: true; message: string };
export type PreLaunchHook = (
  context: PreLaunchContext,
) => Promise<PreLaunchHookResult>;

const preLaunchHooks = new Map<string, PreLaunchHook>();

/**
 * Register a hook that runs before every launch, in registration order. A hook
 * may abort the launch with a message. Registering the same name again
 * replaces the hook. Returns a function that unregisters it.
 */
export function registerPreLaunchHook(
  name: string,
  hook: PreLaunchHook,
): () => void {
  preLaunchHooks.set(name, hook);
  return () => {
    if (preLaunchHooks.get(name) === hook) preLaunchHooks.delete(name);
  };
}

/** Registered pre-launch hooks in registration order. */
export function getPreLaunchHooks(): [string, PreLaunchHook][] {
  return Array.from(preLaunchHooks.entries());
}

export async function launchInstalledGame(options: {
  gameId: number;
  profile?: LaunchProfileDto;
  source: LaunchSource;
}): Promise<LaunchResult> {
  void options;
  throw new Error("launchInstalledGame is not implemented");
}
