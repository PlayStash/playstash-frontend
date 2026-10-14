/**
 * Read and merge-write a version's `.playstash.game.config.json` (desktop).
 *
 * Writes always merge into the existing file so keys owned by other features
 * (umu overrides, install flags, forced type, ...) survive.
 */
import { tauriInvoke } from "@/utils/tauriInvoke";
export const GAME_CONFIG_FILE = ".playstash.game.config.json";

export type GameConfig = Record<string, unknown> & {
  launchexecutable?: string;
  launchparameters?: string;
  launchasadmin?: boolean;
  umugameid?: string;
  umustore?: string;
  umuprotonpath?: string;
  umuwineprefix?: string;
  /** Absolute path of a user-chosen emulator (Emulator / ROM launch). */
  emulatorexecutable?: string;
  /** ROM path relative to the installation directory. */
  emulatorrom?: string;
  /** Emulator argument template containing `$ROM`. */
  emulatorarguments?: string;
  /** Install type forced by the user during install (overrides game.type). */
  forcedgametype?: string;
  /** Unix ms of the last launch through PlayStash. */
  lastlaunchedat?: number;
};

export async function gameConfigPath(versionDirectory: string) {
  const { join } = await import("@tauri-apps/api/path");
  return join(versionDirectory, GAME_CONFIG_FILE);
}

/** The parsed config, or `{}` when it is missing or unreadable. */
export async function readGameConfig(
  versionDirectory: string,
): Promise<GameConfig> {
  const path = await gameConfigPath(versionDirectory);
  try {
    if (!(await tauriInvoke<boolean>("fs_path_exists", { path }))) return {};
    const parsed = JSON.parse(
      await tauriInvoke<string>("fs_read_text_file", { path }),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as GameConfig)
      : {};
  } catch {
    return {};
  }
}

/**
 * Applies `patch` to a config: `undefined` (or an empty string) removes a key,
 * anything else sets it.
 */
export function mergeGameConfig(
  current: GameConfig,
  patch: Partial<Record<keyof GameConfig, unknown>>,
): GameConfig {
  const next: GameConfig = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Merges `patch` into the version config and writes it back. */
export async function updateGameConfig(
  versionDirectory: string,
  patch: Partial<Record<keyof GameConfig, unknown>>,
): Promise<GameConfig> {
  const path = await gameConfigPath(versionDirectory);
  const next = mergeGameConfig(await readGameConfig(versionDirectory), patch);
  await tauriInvoke("fs_write_text_file", {
    path,
    content: JSON.stringify(next, null, 2),
  });
  return next;
}

/** Trimmed non-empty string value of a config key. */
export function configString(
  config: GameConfig,
  key: keyof GameConfig,
): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
