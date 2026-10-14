/**
 * Shared uninstall path for installed games.
 *
 * Used by Game Settings → Installation and by desktop commands (CLI
 * `uninstall`). Pre-uninstall hooks run once the uninstall is confirmed and
 * before anything is removed, which is also before the Wine prefix may be
 * deleted.
 */
import type { PlaystashGame } from "@/api";
import { PlaystashGameTypeEnum } from "@/api/models/PlaystashGame";
import { translate } from "@/i18n";
import { removeDesktopShortcut } from "@/utils/desktopShortcut";
import { formatBytes } from "@/utils/downloadFormat";
import { fillTemplate } from "@/utils/downloadPipeline";
import {
  configString,
  readGameConfig,
  updateGameConfig,
  type GameConfig,
} from "@/utils/gameConfig";
import { reportGameEvent } from "@/utils/gameEventReporter";
import {
  findInstalledGame,
  notifyInstalledGamesChanged,
} from "@/utils/installedGameLookup";
import { getRootPaths } from "@/utils/rootPaths";
import { tauriInvoke } from "@/utils/tauriInvoke";

export interface PreUninstallContext {
  gameId: number;
  versionId: number;
  versionDirectory: string;
  installationPath: string;
}

export type PreUninstallHook = (context: PreUninstallContext) => Promise<void>;

const preUninstallHooks = new Set<PreUninstallHook>();

/** Register a hook that runs before an uninstall. Returns an unregister function. */
export function registerPreUninstallHook(hook: PreUninstallHook): () => void {
  preUninstallHooks.add(hook);
  return () => {
    preUninstallHooks.delete(hook);
  };
}

/** Registered pre-uninstall hooks in registration order. */
export function getPreUninstallHooks(): PreUninstallHook[] {
  return Array.from(preUninstallHooks);
}

/** The installed version to remove, when the caller already knows it. */
export interface UninstallTarget {
  gameId: number;
  gameTitle?: string;
  gameType?: string | null;
  versionId: number;
  versionDirectory: string;
  installationDirectory: string;
  cachedMetadata?: Record<string, any> | null;
}

export interface UninstallInstalledGameOptions {
  gameId: number;
  /** Ask before uninstalling (the uninstaller's own UI always shows). */
  confirm: boolean;
  /** Skips the disk scan when the caller already resolved the version. */
  installed?: UninstallTarget | null;
  /** Server game (title, type and uninstaller metadata). */
  game?: PlaystashGame | null;
}

/** Install types that are removed by deleting the installation folder. */
export function isPortableInstallType(gameType?: string | null) {
  return (
    gameType === PlaystashGameTypeEnum.windows_portable ||
    gameType === PlaystashGameTypeEnum.linux_portable ||
    gameType === PlaystashGameTypeEnum.windows_software ||
    gameType === PlaystashGameTypeEnum.linux_software
  );
}

export function isSetupInstallType(gameType?: string | null) {
  return gameType === PlaystashGameTypeEnum.windows_setup;
}

/**
 * The install type the uninstall follows: a type the user forced during the
 * install (`forcedgametype`) wins over the recorded and the server type.
 */
export function effectiveInstallType(
  config: GameConfig,
  installedType?: string | null,
  serverType?: string | null,
): string | undefined {
  return (
    configString(config, "forcedgametype") ??
    (installedType?.trim() || undefined) ??
    (serverType?.trim() || undefined)
  );
}

/** Uninstaller exit codes that count as success (3010 = reboot required). */
export function isUninstallSuccessCode(code: number | null | undefined) {
  return code === null || code === undefined || code === 0 || code === 3010;
}

/** Exit code from a `launch_uninstall_executable` error, if it carries one. */
export function exitCodeFromError(error: unknown): number | null {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = /exited with code (-?\d+)/i.exec(text);
  return match ? Number(match[1]) : null;
}

function isAbsolutePath(path: string) {
  return /^([a-zA-Z]:[\\/]|\/|\\)/.test(path);
}

const invoke = tauriInvoke;

type AlertOptions = Parameters<NonNullable<Window["showAlertDialog"]>>[0];

/** Shows an alert; resolves `false` when no dialog host is mounted. */
async function alert(options: AlertOptions): Promise<boolean> {
  const show = typeof window !== "undefined" ? window.showAlertDialog : null;
  if (!show) return false;
  return show(options);
}

async function runPreUninstallHooks(context: PreUninstallContext) {
  for (const hook of getPreUninstallHooks()) {
    try {
      await hook(context);
    } catch (error) {
      console.warn("Pre-uninstall hook failed:", error);
    }
  }
}

/**
 * Removes now-empty per-version and per-game folders after an uninstall,
 * walking up from the version directory to the configured root location.
 */
export async function pruneEmptyVersionFolders(versionDirectory: string) {
  if (!versionDirectory) return;
  for (const root of getRootPaths()) {
    const rootPath = root.path;
    if (
      rootPath &&
      (versionDirectory === rootPath ||
        versionDirectory.startsWith(`${rootPath}/`) ||
        versionDirectory.startsWith(`${rootPath}\\`))
    ) {
      try {
        await invoke("remove_empty_directories", {
          path: versionDirectory,
          stopAt: rootPath,
        });
      } catch {
        // Best-effort cleanup; never block the uninstall.
      }
      return;
    }
  }
}

async function setInstallationFinished(versionDirectory: string) {
  try {
    // Only an existing config is updated; a missing one stays missing.
    const config = await readGameConfig(versionDirectory);
    if (Object.keys(config).length === 0) return;
    await updateGameConfig(versionDirectory, { installationfinished: false });
  } catch (error) {
    console.warn("Updating the installation flag failed:", error);
  }
}

/**
 * After an uninstall, detect any files/folders the uninstaller left behind
 * and offer to delete them so the version folder is fully cleaned up.
 */
async function cleanupLeftoverFiles(versionDirectory: string) {
  if (!versionDirectory) return;
  const hasLeftovers = await invoke<boolean>("fs_has_leftover_content", {
    path: versionDirectory,
  });
  if (!hasLeftovers) return;

  const confirmed = await alert({
    title: translate("uninstall.leftover.title"),
    description: translate("uninstall.leftover.description"),
    affirmativeText: translate("common.delete"),
    negativeText: translate("uninstall.leftover.keep"),
  });
  if (!confirmed) return;

  await invoke("fs_remove", { path: versionDirectory, recursive: true });
  // Walk up from the version folder's parent so now-empty game/version
  // containers are cleaned up too.
  await pruneEmptyVersionFolders(versionDirectory.replace(/[\\/][^\\/]+$/, ""));
}

/**
 * Offers to delete the game's Wine/Proton prefix (Linux, umu/Proton). Opt-in:
 * prefixes can contain local saves, so "keep" is the pre-focused answer, and
 * only prefixes inside PlayStash's prefix directory are offered at all.
 */
async function offerPrefixCleanup(
  versionDirectory: string,
  gameId: number,
  config: GameConfig,
) {
  try {
    const info = await invoke<{
      path: string | null;
      exists: boolean;
      isPrefix: boolean;
      managed: boolean;
      sizeBytes: number | null;
    }>("resolve_game_wine_prefix", {
      versionDirectory,
      gameId,
      umuGameId: configString(config, "umugameid") ?? null,
      perGamePrefix: configString(config, "umuwineprefix") ?? null,
    });
    if (!info?.path || !info.exists || !info.isPrefix || !info.managed) return;

    const size = info.sizeBytes ? ` (${formatBytes(info.sizeBytes)})` : "";
    const keepPrefix = await alert({
      title: translate("uninstall.prefix.title"),
      description: fillTemplate(translate("uninstall.prefix.description"), {
        path: info.path,
        size,
      }),
      affirmativeText: translate("uninstall.prefix.keep"),
      negativeText: translate("uninstall.prefix.delete"),
      tone: "warning",
    });
    if (keepPrefix) return;

    await invoke("delete_game_wine_prefix", {
      path: info.path,
      perGamePrefix: configString(config, "umuwineprefix") ?? null,
    });
  } catch (error) {
    console.warn("Wine/Proton prefix cleanup skipped:", error);
  }
}

/** Finds the configured uninstaller (absolute, or contained in a path). */
async function resolveConfiguredUninstaller(
  installationDirectory: string,
  configured: string,
): Promise<string | null> {
  if (isAbsolutePath(configured)) {
    return (await invoke<boolean>("fs_path_exists", { path: configured }))
      ? configured
      : null;
  }
  try {
    return await invoke<string | null>("find_uninstaller_executable", {
      installationPath: installationDirectory,
      needle: configured,
    });
  } catch {
    return null;
  }
}

/** Steps shared by both uninstall kinds once the files are gone. */
async function finishUninstall(
  target: UninstallTarget,
  title: string,
  config: GameConfig,
) {
  await setInstallationFinished(target.versionDirectory);
  reportGameEvent(target.gameId, "uninstalled", target.versionId);
  // Clean up the empty per-version / per-game folders left behind.
  await pruneEmptyVersionFolders(target.versionDirectory);
  // Offer to delete any leftover files the uninstaller left behind.
  await cleanupLeftoverFiles(target.versionDirectory).catch((error) =>
    console.warn("Leftover cleanup failed:", error),
  );
  // ... and the (optional) Wine/Proton prefix of the game.
  await offerPrefixCleanup(target.versionDirectory, target.gameId, config);
  try {
    await removeDesktopShortcut({ title });
  } catch {
    // No shortcut, or shortcuts are not supported here.
  }
  notifyInstalledGamesChanged();
  void alert({
    title: translate("uninstall.done"),
    affirmativeText: translate("common.ok"),
  });
}

/**
 * Uninstall a game. With `confirm: false` the portable/setup confirmation is
 * skipped (the uninstaller UI itself still shows). Resolves to whether the
 * game was uninstalled.
 */
export async function uninstallInstalledGame(
  options: UninstallInstalledGameOptions,
): Promise<boolean> {
  const target =
    options.installed ??
    (await findInstalledGame(options.gameId).catch(() => null));
  if (!target) {
    await alert({
      title: translate("launch.installFirst"),
      affirmativeText: translate("common.ok"),
    });
    return false;
  }

  const cached = (target.cachedMetadata ?? null) as PlaystashGame | null;
  const game = options.game ?? cached;
  const title =
    game?.metadata?.title ||
    game?.title ||
    target.gameTitle ||
    translate("gameView.fallbackTitle");
  const config = await readGameConfig(target.versionDirectory);
  const installType = effectiveInstallType(config, target.gameType, game?.type);
  const hookContext: PreUninstallContext = {
    gameId: target.gameId,
    versionId: target.versionId,
    versionDirectory: target.versionDirectory,
    installationPath: target.installationDirectory,
  };

  if (isPortableInstallType(installType)) {
    if (options.confirm) {
      const confirmed = await alert({
        title: fillTemplate(translate("uninstall.confirm"), { title }),
        affirmativeText: translate("common.yes"),
        negativeText: translate("common.no"),
      });
      if (!confirmed) return false;
    }

    try {
      await runPreUninstallHooks(hookContext);
      if (
        await invoke<boolean>("fs_path_exists", {
          path: target.installationDirectory,
        })
      ) {
        await invoke("fs_remove", {
          path: target.installationDirectory,
          recursive: true,
        });
      }
      await finishUninstall(target, title, config);
      return true;
    } catch (error) {
      await alert({
        title: translate("common.error"),
        description:
          (error instanceof Error ? error.message : String(error)) ||
          translate("uninstall.failed"),
        affirmativeText: translate("common.ok"),
      });
      return false;
    }
  }

  if (isSetupInstallType(installType)) {
    const configuredUninstaller =
      game?.metadata?.uninstaller_executable?.trim();

    if (options.confirm) {
      const confirmed = await alert(
        configuredUninstaller
          ? {
              title: fillTemplate(translate("uninstall.confirmQuoted"), {
                title,
              }),
              affirmativeText: translate("common.yes"),
              negativeText: translate("common.no"),
            }
          : {
              title: fillTemplate(translate("uninstall.confirmQuoted"), {
                title,
              }),
              description: translate("uninstall.setupHint"),
              affirmativeText: translate("common.yes"),
              negativeText: translate("common.no"),
            },
      );
      if (!confirmed) return false;
    }

    let executablePath = configuredUninstaller
      ? await resolveConfiguredUninstaller(
          target.installationDirectory,
          configuredUninstaller,
        )
      : null;

    if (!executablePath) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        defaultPath: target.installationDirectory,
        title: translate("uninstall.selectExecutable"),
        filters: [
          {
            name: translate("uninstall.executablesFilter"),
            extensions: ["exe", "msi", "bat", "cmd", "com"],
          },
        ],
      });
      if (typeof selected !== "string" || !selected) {
        await alert({ title: translate("uninstall.noExecutable") });
        return false;
      }
      if (options.confirm) {
        const fileName = selected.split(/[\\/]/).pop() || selected;
        const confirmed = await alert({
          title: translate("uninstall.confirmExecutable").replace(
            "{fileName}",
            fileName,
          ),
          affirmativeText: translate("common.yes"),
          negativeText: translate("common.no"),
        });
        if (!confirmed) return false;
      }
      executablePath = selected;
    }

    let exitCode: number | null = null;
    try {
      await runPreUninstallHooks(hookContext);
      exitCode = await invoke<number | null>("launch_uninstall_executable", {
        versionDirectory: target.versionDirectory,
        executablePath,
        workingDirectory: target.installationDirectory,
        argumentList: game?.metadata?.uninstaller_parameters || null,
        umuGameId: configString(config, "umugameid") ?? null,
        umuStore: configString(config, "umustore") ?? null,
        umuProtonPath: configString(config, "umuprotonpath") ?? null,
        umuWinePrefix: configString(config, "umuwineprefix") ?? null,
      });
    } catch (error) {
      const code = exitCodeFromError(error);
      await alert({
        title: translate("common.error"),
        description:
          code !== null && !isUninstallSuccessCode(code)
            ? translate("uninstall.exitCode").replace("{code}", String(code))
            : (error instanceof Error ? error.message : String(error)) ||
              translate("uninstall.runFailed"),
        affirmativeText: translate("common.ok"),
      });
      return false;
    }

    // An elevated uninstaller reports its exit code instead of failing.
    if (!isUninstallSuccessCode(exitCode)) {
      await alert({
        title: translate("common.error"),
        description: translate("uninstall.exitCode").replace(
          "{code}",
          String(exitCode),
        ),
        affirmativeText: translate("common.ok"),
      });
      return false;
    }

    try {
      await finishUninstall(target, title, config);
    } catch (error) {
      console.warn("Post-uninstall cleanup failed:", error);
    }
    return true;
  }

  await alert({
    title: translate("uninstall.unsupportedTitle"),
    description: translate("uninstall.unsupported"),
    affirmativeText: translate("common.ok"),
  });
  return false;
}
