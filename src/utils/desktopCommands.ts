/**
 * Desktop commands from the CLI, `playstash://` deep links, the IPC pipe
 * (Playnite), the jump list and the tray (WP1 contract).
 *
 * Rust emits {@link DESKTOP_COMMAND_EVENT} and queues commands until the
 * frontend calls {@link markDesktopCommandsReady}. WP1's
 * `DesktopCommandProvider` listens and dispatches them.
 */
export const DESKTOP_COMMAND_EVENT = "desktop-command";

/** Rust asks the frontend to confirm exiting while downloads still run. */
export const DESKTOP_EXIT_REQUESTED_EVENT = "desktop-exit-requested";

export type DesktopCommandAction = "show" | "install" | "uninstall" | "start";

export interface DesktopCommand {
  id: string;
  action: DesktopCommandAction;
  gameId?: number;
  /** Version to install (web "Download in desktop app" links). */
  versionId?: number;
  jumpListCommand?: number;
  autoInstall?: boolean;
  confirm?: boolean;
  minimized?: boolean;
  /** Whether Rust found the game in the configured install roots. */
  installed?: boolean;
}

/** Ready gate: the frontend can handle queued desktop commands now. */
export async function markDesktopCommandsReady(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("desktop_commands_ready");
}

/**
 * Closes the ready gate again (logout, profile switch): commands queue until
 * the next {@link markDesktopCommandsReady}.
 */
export async function markDesktopCommandsNotReady(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("desktop_commands_not_ready");
}
