/**
 * Desktop shortcuts that start a game through PlayStash (WP1 contract).
 *
 * Windows gets a `.url` file, Linux a `.desktop` entry and macOS a `.webloc`,
 * all starting the game through `playstash://start?gameid=<id>` (or
 * `playstash start --gameid=<id>`). The shortcut name is the game title made
 * safe for file names, so callers identify shortcuts by title.
 */
import { translate } from "@/i18n";

/**
 * `"exists"`: a shortcut with that title is already on the desktop; show
 * {@link desktopShortcutExistsMessage}. `"cancelled"`: the user said no to
 * the `ask` confirmation.
 */
export type CreateDesktopShortcutResult = "created" | "exists" | "cancelled";

/** "Desktop shortcut already exists", for callers that got `"exists"`. */
export function desktopShortcutExistsMessage(): string {
  return translate("wp1.shortcut.exists");
}

export async function createDesktopShortcut(options: {
  gameId: number;
  title: string;
  /** Icon file, usually the configured launch executable. */
  iconPath?: string;
  /** Ask "Do you want to create a desktop shortcut for …?" first. */
  ask?: boolean;
}): Promise<CreateDesktopShortcutResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  if (options.ask) {
    if (await desktopShortcutExists({ title: options.title })) return "exists";
    const confirm =
      typeof window === "undefined" ? undefined : window.showAlertDialog;
    if (confirm) {
      const accepted = await confirm({
        title: translate("wp1.shortcut.confirm").replace(
          "{title}",
          options.title,
        ),
        affirmativeText: translate("wp1.common.yes"),
        negativeText: translate("wp1.common.no"),
      });
      if (!accepted) return "cancelled";
    }
  }
  return invoke<CreateDesktopShortcutResult>("create_desktop_shortcut", {
    gameId: options.gameId,
    title: options.title,
    iconPath: options.iconPath ?? null,
    ask: options.ask ?? false,
  });
}

/** Removes the shortcut for a title. Errors are logged, never thrown. */
export async function removeDesktopShortcut(options: {
  title: string;
}): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("remove_desktop_shortcut", options);
  } catch (error) {
    console.warn("[desktopShortcut] removing the shortcut failed:", error);
  }
}

export async function desktopShortcutExists(options: {
  title: string;
}): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("desktop_shortcut_exists", options);
}
