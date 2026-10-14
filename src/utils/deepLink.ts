/**
 * `playstash://` deep links and desktop command handling (WP1).
 *
 * The URI grammar itself is parsed in Rust (`cli.rs`); this module builds
 * links and turns a {@link DesktopCommand} into UI actions. The handler is
 * kept free of React so it can be tested with plain fakes.
 */
import type { DesktopCommand } from "@/utils/desktopCommands";
import type { LaunchResult } from "@/utils/launchInstalledGame";
import type { RequestGameDownloadResult } from "@/utils/downloadFlow";

export const DEEP_LINK_SCHEME = "playstash";

/** Jump-list / tray page commands (WPF `MainControl` order). */
export const JUMP_LIST_ROUTES: Readonly<Record<number, string>> = {
  0: "/library",
  1: "/downloads",
  2: "/community",
  3: "/settings",
  4: "/admin",
};

/** Jump-list command that exits the app (handled in Rust). */
export const JUMP_LIST_EXIT = 15;

/** Smallest role that may open the administration page. */
const ADMIN_ROLE = 3;

/**
 * Route for a jump-list command, or `null` when there is none or the user may
 * not open it (Administration needs role 3).
 */
export function jumpListRoute(
  command: number,
  role: number | null | undefined,
): string | null {
  const route = JUMP_LIST_ROUTES[command];
  if (!route) return null;
  if (command === 4 && !(Number(role) >= ADMIN_ROLE)) return null;
  return route;
}

/** The game page route. */
export function gameRoute(gameId: number): string {
  return `/library/${gameId}`;
}

/** A desktop deep link, e.g. `playstash://show?gameid=5`. */
export function buildDeepLink(
  action: DesktopCommand["action"],
  params: Record<string, string | number | boolean | undefined> = {},
): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(
          typeof value === "boolean"
            ? value
              ? "True"
              : "False"
            : String(value),
        )}`,
    )
    .join("&");
  return `${DEEP_LINK_SCHEME}://${action}${query ? `?${query}` : ""}`;
}

/** What the command handler needs from the app. */
export interface DesktopCommandDeps {
  navigate: (path: string) => void;
  /** Role of the signed-in user (3 = admin). */
  userRole: () => number | null | undefined;
  /** Whether the game exists on the server or in the offline cache. */
  gameExists: (gameId: number) => Promise<boolean>;
  /** Shows an error message to the user. */
  alert: (message: string) => Promise<void> | void;
  /** Translated "Game with ID {id} not found". */
  gameNotFoundMessage: (gameId: number) => string;
  requestGameDownload: (options: {
    gameId: number;
    background?: boolean;
    autoInstall?: boolean;
    versionId?: number;
  }) => Promise<RequestGameDownloadResult>;
  uninstallInstalledGame: (options: {
    gameId: number;
    confirm: boolean;
  }) => Promise<boolean>;
  launchInstalledGame: (options: {
    gameId: number;
    source: "cli";
  }) => Promise<LaunchResult>;
}

export interface DesktopCommandOutcome {
  ok: boolean;
  message?: string;
}

/**
 * Runs a desktop command (WPF `PipeServiceHandler.HandleCommand`; Rust has
 * already shown the window when the command needs it).
 *
 * - show: open the jump-list page and/or the game page.
 * - install: queue the download (background with `minimized`) and open
 *   Downloads; an installed game opens its page.
 * - uninstall: uninstall an installed game (confirm unless `confirm` is
 *   false); otherwise open its page.
 * - start: launch an installed game without navigating; otherwise install it
 *   (`autoInstall`) or open its page.
 */
export async function runDesktopCommand(
  command: DesktopCommand,
  deps: DesktopCommandDeps,
): Promise<DesktopCommandOutcome> {
  const gameId =
    typeof command.gameId === "number" && Number.isFinite(command.gameId)
      ? command.gameId
      : undefined;
  const installed = command.installed === true;

  const showGame = async (id: number): Promise<DesktopCommandOutcome> => {
    if (installed || (await deps.gameExists(id))) {
      deps.navigate(gameRoute(id));
      return { ok: true };
    }
    const message = deps.gameNotFoundMessage(id);
    await deps.alert(message);
    return { ok: false, message };
  };

  const install = async (
    id: number,
    autoInstall: boolean,
  ): Promise<DesktopCommandOutcome> => {
    const result = await deps.requestGameDownload({
      gameId: id,
      background: command.minimized === true,
      autoInstall,
      ...(command.versionId !== undefined
        ? { versionId: command.versionId }
        : {}),
    });
    if (result === "error") return { ok: false, message: "download failed" };
    deps.navigate("/downloads");
    return { ok: true };
  };

  switch (command.action) {
    case "show": {
      let outcome: DesktopCommandOutcome = { ok: true };
      if (typeof command.jumpListCommand === "number") {
        const route = jumpListRoute(command.jumpListCommand, deps.userRole());
        if (route) deps.navigate(route);
        else outcome = { ok: false, message: "page not available" };
      }
      if (gameId !== undefined) outcome = await showGame(gameId);
      return outcome;
    }
    case "install":
      if (gameId === undefined) return { ok: false, message: "no game id" };
      if (installed) return showGame(gameId);
      return install(gameId, command.autoInstall === true);
    case "uninstall": {
      if (gameId === undefined) return { ok: false, message: "no game id" };
      if (!installed) return showGame(gameId);
      const confirm = command.confirm !== false;
      // With a confirmation, show the game page so the user sees which game
      // is about to be removed.
      if (confirm) deps.navigate(gameRoute(gameId));
      const removed = await deps.uninstallInstalledGame({ gameId, confirm });
      return removed ? { ok: true } : { ok: false, message: "not uninstalled" };
    }
    case "start": {
      if (gameId === undefined) return { ok: false, message: "no game id" };
      if (installed) {
        const result = await deps.launchInstalledGame({
          gameId,
          source: "cli",
        });
        return result.ok
          ? { ok: true }
          : { ok: false, message: result.message ?? "launch failed" };
      }
      if (command.autoInstall === true) return install(gameId, true);
      return showGame(gameId);
    }
    default:
      return { ok: false, message: "unsupported action" };
  }
}
