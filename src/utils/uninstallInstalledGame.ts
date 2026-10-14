/**
 * Shared uninstall path for installed games (WP4 contract, Step 0 stub).
 *
 * WP4 extracts the flow from GameSettings into this module. Pre-uninstall
 * hooks also run before a Wine prefix is deleted.
 */
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

/**
 * Uninstall a game. With `confirm: false` the portable/setup confirmation is
 * skipped (the uninstaller UI itself still shows). Resolves to whether the
 * game was uninstalled.
 */
export async function uninstallInstalledGame(options: {
  gameId: number;
  confirm: boolean;
}): Promise<boolean> {
  void options;
  throw new Error("uninstallInstalledGame is not implemented");
}
