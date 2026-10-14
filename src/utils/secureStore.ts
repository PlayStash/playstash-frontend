import { isTauriApp } from "@/utils/tauri";

/**
 * Secret storage shared by the desktop features.
 *
 * In the desktop app secrets live in the Stronghold vault (`vault.hold` in the
 * app data dir, unlocked with the per-install password from Rust). On the web
 * build they fall back to `localStorage`, the norm for browser SPAs.
 *
 * Record keys used today:
 * - `app_refresh_token`: the pre-profile session (web, and desktop before migration)
 * - `refresh_token:<profileId>`: each desktop profile's session (WP6)
 * - `default_extraction_password`: the default archive password (WP5)
 */
interface VaultHandle {
  store: import("@tauri-apps/plugin-stronghold").Store;
  stronghold: import("@tauri-apps/plugin-stronghold").Stronghold;
}

const VAULT_PATH = "vault.hold";
const CLIENT_NAME = "playstash";
const WEB_PREFIX = "playstash_secret:";

/** WP5 default extraction password (also written by connection import / legacy import). */
export const EXTRACTION_PASSWORD_SECRET = "default_extraction_password";

/** Vault record key of a profile's refresh token. */
export function refreshTokenSecretKey(profileId: string): string {
  return `refresh_token:${profileId}`;
}

let vaultReady: Promise<VaultHandle> | null = null;

/** Opens (once) the Stronghold vault. Desktop only. */
export async function ensureVault(): Promise<VaultHandle> {
  if (!vaultReady) {
    vaultReady = (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { appDataDir } = await import("@tauri-apps/api/path");
      const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
      const dir = await appDataDir();
      const password = await invoke<string>("get_or_create_vault_password");
      const stronghold = await Stronghold.load(
        `${dir}/${VAULT_PATH}`,
        password,
      );
      let client;
      try {
        client = await stronghold.loadClient(CLIENT_NAME);
      } catch {
        client = await stronghold.createClient(CLIENT_NAME);
      }
      return { store: client.getStore(), stronghold };
    })();
    // If the vault can't be initialised, drop the cached promise so a later
    // call can retry.
    vaultReady.catch(() => {
      vaultReady = null;
    });
  }
  return vaultReady;
}

/** Reads a secret; `null` when it is missing. Throws when the vault fails. */
export async function secureGet(key: string): Promise<string | null> {
  if (!isTauriApp()) {
    try {
      return localStorage.getItem(WEB_PREFIX + key);
    } catch {
      return null;
    }
  }
  const { store } = await ensureVault();
  const data = await store.get(key);
  return data ? new TextDecoder().decode(data) : null;
}

/** Stores a secret and persists the vault. Throws when the vault fails. */
export async function secureSet(key: string, value: string): Promise<void> {
  if (!isTauriApp()) {
    localStorage.setItem(WEB_PREFIX + key, value);
    return;
  }
  const { store, stronghold } = await ensureVault();
  await store.insert(key, Array.from(new TextEncoder().encode(value)));
  await stronghold.save();
}

/** Removes a secret and persists the vault. Throws when the vault fails. */
export async function secureRemove(key: string): Promise<void> {
  if (!isTauriApp()) {
    try {
      localStorage.removeItem(WEB_PREFIX + key);
    } catch {
      /* storage unavailable */
    }
    return;
  }
  const { store, stronghold } = await ensureVault();
  await store.remove(key);
  await stronghold.save();
}

/** `secureStore.get/set/remove(key)` (WP5 contract name). */
export const secureStore = {
  get: secureGet,
  set: secureSet,
  remove: secureRemove,
};
