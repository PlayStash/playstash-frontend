/**
 * Lazily imported `invoke` from `@tauri-apps/api/core`, loaded once and shared
 * (concurrent first calls wait for the same import instead of racing it).
 */
let core: Promise<typeof import("@tauri-apps/api/core")> | null = null;

export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  core ??= import("@tauri-apps/api/core");
  try {
    const { invoke } = await core;
    return await invoke<T>(command, args);
  } catch (error) {
    // A failed import must not stick; the next call retries it.
    if (!(await core.then(() => true).catch(() => false))) core = null;
    throw error;
  }
}
