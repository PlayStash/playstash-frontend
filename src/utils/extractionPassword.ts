import { isTauriApp } from "@/utils/tauri";

/**
 * Default extraction password (WP5): tried automatically when an archive is
 * encrypted and the game has no (working) archive password of its own.
 *
 * The password is a secret, so it is kept encrypted in a Stronghold vault,
 * never in localStorage. It uses its own snapshot file (`pipeline.hold`): the
 * Stronghold plugin keys open vaults by snapshot path and re-initialising a
 * path that is already open would drop the loaded clients of the auth token
 * storage (`vault.hold`). Same auto-unlock password as the token vault.
 *
 * Records are keyed per profile (`extraction_password:<profileId>`) once
 * profiles exist (WP6 passes the current profile id), and fall back to the
 * global key `extraction_password` until then. WP6's connection import writes
 * the secret through {@link setDefaultExtractionPassword}.
 */

const SNAPSHOT_FILE = "pipeline.hold";
const CLIENT_NAME = "playstash-pipeline";
const BASE_KEY = "extraction_password";

interface PipelineVault {
  store: import("@tauri-apps/plugin-stronghold").Store;
  stronghold: import("@tauri-apps/plugin-stronghold").Stronghold;
}

let vaultPromise: Promise<PipelineVault> | null = null;
const cache = new Map<string, string>();

export function extractionPasswordKey(profileId?: string | null): string {
  const id = profileId?.trim();
  return id ? `${BASE_KEY}:${id}` : BASE_KEY;
}

async function openVault(): Promise<PipelineVault> {
  if (!vaultPromise) {
    vaultPromise = (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { appDataDir, join } = await import("@tauri-apps/api/path");
      const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
      const vaultPath = await join(await appDataDir(), SNAPSHOT_FILE);
      const password = await invoke<string>("get_or_create_vault_password");
      const stronghold = await Stronghold.load(vaultPath, password);
      let client;
      try {
        client = await stronghold.loadClient(CLIENT_NAME);
      } catch {
        client = await stronghold.createClient(CLIENT_NAME);
      }
      return { store: client.getStore(), stronghold };
    })();
    vaultPromise.catch(() => {
      vaultPromise = null;
    });
  }
  return vaultPromise;
}

/** The stored default extraction password, or "" when none is set. */
export async function getDefaultExtractionPassword(
  profileId?: string | null,
): Promise<string> {
  if (!isTauriApp()) return "";
  const key = extractionPasswordKey(profileId);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const { store } = await openVault();
    const data = await store.get(key);
    const value = data ? new TextDecoder().decode(data) : "";
    cache.set(key, value);
    return value;
  } catch (error) {
    console.warn("[extractionPassword] read failed", error);
    return "";
  }
}

/**
 * Stores the default extraction password (an empty string removes it).
 * Throws when the vault cannot be written.
 */
export async function setDefaultExtractionPassword(
  password: string,
  profileId?: string | null,
): Promise<void> {
  if (!isTauriApp()) return;
  const key = extractionPasswordKey(profileId);
  const { store, stronghold } = await openVault();
  if (password) {
    await store.insert(key, Array.from(new TextEncoder().encode(password)));
  } else {
    await store.remove(key).catch(() => null);
  }
  await stronghold.save();
  cache.set(key, password);
}

/** Test hook: forget the cached vault and values. */
export function resetExtractionPasswordCache(): void {
  cache.clear();
  vaultPromise = null;
}
