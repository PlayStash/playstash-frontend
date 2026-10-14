import { isTauriApp } from "@/utils/tauri";
import { AUTH_REFRESH_STORAGE_KEY } from "@/utils/authConfig";
import {
  ensureVault,
  refreshTokenSecretKey,
  secureGet,
  secureRemove,
} from "@/utils/secureStore";

/**
 * Token storage abstraction.
 *
 * In the Tauri desktop app the refresh token is kept in a Stronghold vault —
 * an encrypted, cross-platform secret store (official Tauri plugin) that works
 * on Windows, macOS and Linux. This removes the token from the webview's
 * `localStorage`. The vault protects persisted data; frontend code with native
 * IPC access can still access the user's session and must remain trusted.
 *
 * Desktop profiles each keep their own token under
 * `refresh_token:<profileId>`; `setTokenProfile` selects the active one. Without
 * a profile (web build, or before the desktop migration) the single legacy
 * record `app_refresh_token` is used.
 *
 * On the plain web build we fall back to `localStorage`, which is the norm for
 * browser-delivered SPAs.
 *
 * We keep an in-memory cache so AuthContext can read the token synchronously;
 * writes update the cache immediately and persist in the background (still
 * awaited by callers so a close right after login doesn't lose the token).
 */
const NATIVE_TOKEN_BLOCKED_KEY = "app_native_token_blocked";

let activeProfileId: string | null = null;
let cachedRefreshToken: string | null = null;
let cacheLoaded = false;
let initPromise: Promise<void> | null = null;

function vaultKey(profileId: string | null = activeProfileId): string {
  return profileId
    ? refreshTokenSecretKey(profileId)
    : AUTH_REFRESH_STORAGE_KEY;
}

function blockedKey(profileId: string | null = activeProfileId): string {
  return profileId
    ? `${NATIVE_TOKEN_BLOCKED_KEY}:${profileId}`
    : NATIVE_TOKEN_BLOCKED_KEY;
}

function blockNativeRestore(blocked: boolean, profileId = activeProfileId) {
  try {
    if (blocked) localStorage.setItem(blockedKey(profileId), "true");
    else localStorage.removeItem(blockedKey(profileId));
  } catch {
    /* non-secret restore marker cannot be written */
  }
}

function isNativeRestoreBlocked(profileId = activeProfileId): boolean {
  try {
    return localStorage.getItem(blockedKey(profileId)) === "true";
  } catch {
    return false;
  }
}

function readLocal() {
  try {
    return localStorage.getItem(AUTH_REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLocal(token: string) {
  try {
    localStorage.setItem(AUTH_REFRESH_STORAGE_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

function clearLocal() {
  try {
    localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Selects whose refresh token the other functions read and write (desktop
 * profiles). `null` selects the legacy single-session record. Resets the
 * cache; call `initTokenStorage()` afterwards.
 */
export function setTokenProfile(profileId: string | null): void {
  if (profileId === activeProfileId && cacheLoaded) return;
  activeProfileId = profileId;
  cachedRefreshToken = null;
  cacheLoaded = false;
  initPromise = null;
}

export function getTokenProfile(): string | null {
  return activeProfileId;
}

/** Loads the refresh token into memory. Call once before reading it. */
export function initTokenStorage(): Promise<void> {
  // Deduplicate concurrent initialisations (e.g. bootstrap vs a component's
  // first authenticated request racing at startup).
  if (initPromise) return initPromise;
  const profileId = activeProfileId;
  initPromise = (async () => {
    if (cacheLoaded) return;
    let token: string | null = null;
    try {
      if (isTauriApp()) {
        clearLocal();
        if (!isNativeRestoreBlocked(profileId)) {
          const { store } = await ensureVault();
          const data = await store.get(vaultKey(profileId));
          token = data ? new TextDecoder().decode(data) : null;
        }
        clearLocal();
      } else {
        token = readLocal();
      }
    } catch (e) {
      console.warn("[tokenStorage] init failed", e);
      token = isTauriApp() ? null : readLocal();
      if (isTauriApp()) clearLocal();
    }
    // The active profile may have changed while the vault was loading.
    if (profileId !== activeProfileId) return;
    cachedRefreshToken = token;
    cacheLoaded = true;
  })();
  return initPromise;
}

/** Synchronous read of the cached refresh token. */
export function getRefreshToken(): string | null {
  return cachedRefreshToken;
}

/** Updates the cache and persists the token to secure storage. */
export async function setRefreshToken(token: string): Promise<void> {
  const profileId = activeProfileId;
  cachedRefreshToken = token;
  cacheLoaded = true;
  if (isTauriApp()) {
    clearLocal();
    blockNativeRestore(true, profileId);
  }
  try {
    if (isTauriApp()) {
      const { store, stronghold } = await ensureVault();
      await store.insert(
        vaultKey(profileId),
        Array.from(new TextEncoder().encode(token)),
      );
      await stronghold.save();
      blockNativeRestore(false, profileId);
    } else {
      writeLocal(token);
    }
  } catch (e) {
    // Keep the current session in memory, without silently persisting secrets
    // in plaintext when the native vault is unavailable.
    console.warn("[tokenStorage] persist failed; session remains in memory", e);
  }
}

/** Clears the cache and removes the token from secure storage. */
export async function removeRefreshToken(): Promise<void> {
  cachedRefreshToken = null;
  cacheLoaded = true;
  await removeStoredRefreshToken(activeProfileId);
}

/** Removes a (possibly inactive) profile's stored token. */
export async function removeStoredRefreshToken(
  profileId: string | null,
): Promise<void> {
  if (profileId === activeProfileId) cachedRefreshToken = null;
  clearLocal();
  if (isTauriApp()) blockNativeRestore(true, profileId);
  try {
    if (isTauriApp()) {
      const { store, stronghold } = await ensureVault();
      await store.remove(vaultKey(profileId));
      await stronghold.save();
    } else {
      clearLocal();
    }
  } catch (e) {
    console.warn("[tokenStorage] remove failed", e);
    clearLocal();
  }
}

/** Whether a profile has a stored (restorable) refresh token. */
export async function hasStoredRefreshToken(
  profileId: string,
): Promise<boolean> {
  if (profileId === activeProfileId && cacheLoaded) return !!cachedRefreshToken;
  if (isTauriApp() && isNativeRestoreBlocked(profileId)) return false;
  try {
    return !!(await secureGet(vaultKey(profileId)));
  } catch {
    return false;
  }
}

/**
 * Stores a token for a profile that may not be active (legacy import).
 * Throws when the vault fails.
 */
export async function storeRefreshTokenFor(
  profileId: string,
  token: string,
): Promise<void> {
  if (profileId === activeProfileId) {
    await setRefreshToken(token);
    return;
  }
  const { store, stronghold } = await ensureVault();
  await store.insert(
    vaultKey(profileId),
    Array.from(new TextEncoder().encode(token)),
  );
  await stronghold.save();
  blockNativeRestore(false, profileId);
}

/**
 * Moves the pre-profile session (`app_refresh_token`) to a desktop profile.
 * Returns whether a token was moved.
 */
export async function migrateLegacyRefreshToken(
  profileId: string,
): Promise<boolean> {
  if (!isTauriApp()) return false;
  if (isNativeRestoreBlocked(null)) return false;
  const token = await secureGet(AUTH_REFRESH_STORAGE_KEY);
  if (!token) return false;
  await storeRefreshTokenFor(profileId, token);
  await secureRemove(AUTH_REFRESH_STORAGE_KEY);
  return true;
}
