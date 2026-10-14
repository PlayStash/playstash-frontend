/**
 * Shared launch path for installed games (WP4 contract).
 *
 * Used by GameView, GameCard, Big Picture, desktop commands (CLI `start`,
 * jump list) and integrations. Errors are shown as alerts unless the caller
 * passes `showErrors: false`; the result always carries the message.
 */
import type { LaunchProfileDto, PlaystashGame } from "@/api";
import { translate } from "@/i18n";
import {
  configString,
  readGameConfig,
  updateGameConfig,
  type GameConfig,
} from "@/utils/gameConfig";
import { reportGameEvent } from "@/utils/gameEventReporter";
import {
  GAME_SESSION_EVENT,
  type GameSessionEvent,
} from "@/utils/gameSessions";
import { findInstalledGame } from "@/utils/installedGameLookup";
import { tauriInvoke } from "@/utils/tauriInvoke";

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

/** The installed version to launch, when the caller already knows it. */
export interface LaunchTarget {
  gameId?: number;
  versionId: number;
  versionDirectory: string;
  installationDirectory: string;
  gameTitle?: string;
  cachedMetadata?: Record<string, any> | null;
}

export interface LaunchInstalledGameOptions {
  gameId: number;
  profile?: LaunchProfileDto;
  source: LaunchSource;
  /** Skips the disk scan when the caller already resolved the version. */
  installed?: LaunchTarget | null;
  /** Server game (title and metadata fallbacks); cached metadata otherwise. */
  game?: PlaystashGame | null;
  /** Show failures as alerts (default). Big Picture shows them inline. */
  showErrors?: boolean;
}

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

/** What `launch_game` runs: a relative or an absolute (emulator) executable. */
export interface ResolvedLaunchCommand {
  executable?: string;
  absoluteExecutable?: string;
  parameters?: string;
}

/**
 * Executable and parameters precedence:
 * profile executable > emulator (absolute) > configured executable >
 * server `launch_executable`; parameters: profile > configured >
 * server `launch_parameters`.
 */
export function resolveLaunchCommand(
  profile: LaunchProfileDto | undefined,
  config: GameConfig,
  metadata?: { launch_executable?: string; launch_parameters?: string } | null,
): ResolvedLaunchCommand {
  const profileExe = profile?.executable?.trim();
  const emulator = configString(config, "emulatorexecutable");
  const configured = configString(config, "launchexecutable");
  const serverExe = metadata?.launch_executable?.trim() || undefined;

  const result: ResolvedLaunchCommand = {};
  if (profileExe) result.executable = profileExe;
  else if (emulator) result.absoluteExecutable = emulator;
  else if (configured) result.executable = configured;
  else if (serverExe) result.executable = serverExe;

  const parameters = profile
    ? profile.parameters
    : (configString(config, "launchparameters") ??
      (metadata?.launch_parameters || undefined));
  if (parameters?.trim()) result.parameters = parameters.trim();
  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

const invoke = tauriInvoke;

async function pathExists(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>("fs_path_exists", { path });
  } catch {
    return false;
  }
}

/** Runs the pre-launch hooks in order. Returns an abort message, if any. */
async function runPreLaunchHooks(
  context: PreLaunchContext,
): Promise<string | null> {
  for (const [name, hook] of getPreLaunchHooks()) {
    try {
      const result = await hook(context);
      if (result && result.abort) return result.message;
    } catch (error) {
      console.warn(`Pre-launch hook "${name}" failed:`, error);
    }
  }
  return null;
}

/** First non-ignored executable of the installation (WPF auto-detection). */
async function detectLaunchExecutable(
  installationPath: string,
): Promise<string | undefined> {
  try {
    const scan = await invoke<{ executables: string[] }>(
      "list_launch_executables",
      { installationPath },
    );
    return scan?.executables?.find((exe) => exe.trim().length > 0);
  } catch (error) {
    console.warn("Detecting the launch executable failed:", error);
    return undefined;
  }
}

async function resolveWinePrefix(
  target: LaunchTarget,
  gameId: number,
  config: GameConfig,
): Promise<string | undefined> {
  const configured = configString(config, "umuwineprefix");
  if (
    typeof navigator === "undefined" ||
    !navigator.userAgent.includes("Linux")
  ) {
    return configured;
  }
  try {
    const info = await invoke<{ path: string | null }>(
      "resolve_game_wine_prefix",
      {
        versionDirectory: target.versionDirectory,
        gameId,
        umuGameId: configString(config, "umugameid") ?? null,
        perGamePrefix: configured ?? null,
      },
    );
    return info?.path ?? configured;
  } catch {
    return configured;
  }
}

async function emitLocalSessionStarted(event: GameSessionEvent) {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(GAME_SESSION_EVENT, event);
  } catch {
    // Listeners re-sync from the tracker anyway.
  }
}

async function runLaunch(
  options: LaunchInstalledGameOptions,
): Promise<LaunchResult> {
  const { gameId, profile } = options;
  const target =
    options.installed ?? (await findInstalledGame(gameId).catch(() => null));
  if (
    !target ||
    !target.installationDirectory ||
    !(await pathExists(target.installationDirectory))
  ) {
    return { ok: false, message: translate("launch.installFirst") };
  }

  const cached = (target.cachedMetadata ?? null) as PlaystashGame | null;
  const game = options.game ?? cached;
  const metadata = game?.metadata ?? null;
  const title =
    metadata?.title || game?.title || target.gameTitle?.trim() || "Game";

  const config = await readGameConfig(target.versionDirectory);

  const abortMessage = await runPreLaunchHooks({
    gameId,
    versionId: target.versionId,
    versionDirectory: target.versionDirectory,
    installationPath: target.installationDirectory,
    game,
    umuWinePrefix: await resolveWinePrefix(target, gameId, config),
  });
  if (abortMessage !== null) return { ok: false, message: abortMessage };

  const command = resolveLaunchCommand(profile, config, metadata);
  if (!command.executable && !command.absoluteExecutable) {
    const detected = await detectLaunchExecutable(target.installationDirectory);
    if (!detected) {
      return { ok: false, message: translate("launch.noExecutable") };
    }
    command.executable = detected;
    try {
      await updateGameConfig(target.versionDirectory, {
        launchexecutable: detected,
      });
    } catch (error) {
      console.warn("Saving the detected launch executable failed:", error);
    }
  }

  try {
    await invoke("launch_game", {
      gameTitle: title,
      gameId,
      versionDirectory: target.versionDirectory,
      installationPath: target.installationDirectory,
      executableRelativePath: command.executable ?? "",
      launchParameters: command.parameters ?? null,
      runAsAdmin: config.launchasadmin === true,
      umuGameId: configString(config, "umugameid") ?? null,
      umuStore: configString(config, "umustore") ?? null,
      umuProtonPath: configString(config, "umuprotonpath") ?? null,
      umuWinePrefix: configString(config, "umuwineprefix") ?? null,
      absoluteExecutable: command.absoluteExecutable ?? null,
    });
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  reportGameEvent(gameId, "played", target.versionId);
  await emitLocalSessionStarted({
    gameId,
    versionDirectory: target.versionDirectory,
    state: "started",
  });
  try {
    await invoke("set_last_played", {
      versionDirectory: target.versionDirectory,
      at: Date.now(),
    });
  } catch (error) {
    console.warn("Saving the launch time failed:", error);
  }
  return { ok: true };
}

const inFlight = new Map<number, Promise<LaunchResult>>();

/**
 * Launches the newest installed version of a game: runs the pre-launch hooks,
 * resolves executable and parameters (auto-detecting and saving one when none
 * is configured), starts it and records the launch. A second call for the
 * same game while one is starting joins the running one.
 */
export async function launchInstalledGame(
  options: LaunchInstalledGameOptions,
): Promise<LaunchResult> {
  const running = inFlight.get(options.gameId);
  if (running) return running;

  const launch = runLaunch(options)
    .catch((error): LaunchResult => ({
      ok: false,
      message: errorMessage(error),
    }))
    .then((result) => {
      if (!result.ok && result.message && options.showErrors !== false) {
        void window.showAlertDialog?.({
          title: translate("launch.failedTitle"),
          description: result.message,
        });
      }
      return result;
    })
    .finally(() => inFlight.delete(options.gameId));
  inFlight.set(options.gameId, launch);
  return launch;
}
