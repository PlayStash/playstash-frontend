import { isTauriApp } from "@/utils/tauri";
import { getCurrentProfileId } from "@/utils/profiles";
import { secureGet, secureRemove, secureSet } from "@/utils/secureStore";

/**
 * Default extraction password: tried automatically when an archive is
 * encrypted and the game has no (working) archive password of its own.
 *
 * Like the WPF client it belongs to the login profile. It is a secret, so it
 * lives in the shared Stronghold vault (`secureStore`, record
 * `default_extraction_password:<profileId>`), never in localStorage. Without a
 * desktop profile the global record `default_extraction_password` is used.
 *
 * Every reader and writer goes through this module: the download pipeline,
 * Settings → Downloads, the connection export/import and the legacy import.
 */

export const EXTRACTION_PASSWORD_SECRET = "default_extraction_password";

const cache = new Map<string, string>();

/**
 * Vault record key of a profile's default extraction password. `undefined`
 * means the active profile, `null` the global record.
 */
export function extractionPasswordKey(
  profileId: string | null = getCurrentProfileId(),
): string {
  const id = profileId?.trim();
  return id
    ? `${EXTRACTION_PASSWORD_SECRET}:${id}`
    : EXTRACTION_PASSWORD_SECRET;
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
    const value = (await secureGet(key)) ?? "";
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
  if (password) await secureSet(key, password);
  else await secureRemove(key).catch(() => undefined);
  cache.set(key, password);
}

/** Removes a deleted profile's password (best effort). */
export async function removeDefaultExtractionPassword(
  profileId: string,
): Promise<void> {
  if (!isTauriApp()) return;
  const key = extractionPasswordKey(profileId);
  cache.delete(key);
  try {
    await secureRemove(key);
  } catch {
    /* no record, or the vault is unavailable */
  }
}

/** Test hook: forget the cached values. */
export function resetExtractionPasswordCache(): void {
  cache.clear();
}
