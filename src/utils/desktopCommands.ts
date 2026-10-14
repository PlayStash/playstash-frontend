/**
 * Desktop commands from the CLI, `playstash://` deep links, the jump list and
 * the tray (WP1 contract, Step 0 stub).
 *
 * Rust emits {@link DESKTOP_COMMAND_EVENT} and queues commands until the
 * frontend calls {@link markDesktopCommandsReady}. WP1's
 * `DesktopCommandProvider` listens and dispatches them.
 */
export const DESKTOP_COMMAND_EVENT = "desktop-command";

export type DesktopCommandAction = "show" | "install" | "uninstall" | "start";

export interface DesktopCommand {
  id: string;
  action: DesktopCommandAction;
  gameId?: number;
  jumpListCommand?: number;
  autoInstall?: boolean;
  confirm?: boolean;
  minimized?: boolean;
}

/** Ready gate: the frontend can handle queued desktop commands now. */
export async function markDesktopCommandsReady(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("desktop_commands_ready");
}
