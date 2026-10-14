/**
 * Desktop shortcuts that start a game through PlayStash (WP1 contract).
 *
 * Thin wrappers around the Rust commands. The commands are Step 0 stubs that
 * reject with "not implemented" until WP1 fills them in.
 */
export type CreateDesktopShortcutResult = "created" | "exists";

export async function createDesktopShortcut(options: {
  gameId: number;
  title: string;
  iconPath?: string;
  ask?: boolean;
}): Promise<CreateDesktopShortcutResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CreateDesktopShortcutResult>(
    "create_desktop_shortcut",
    options,
  );
}

export async function removeDesktopShortcut(options: {
  title: string;
}): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_desktop_shortcut", options);
}

export async function desktopShortcutExists(options: {
  title: string;
}): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("desktop_shortcut_exists", options);
}
