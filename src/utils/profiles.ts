import { isTauriApp, isTauriDesktop } from "@/utils/tauri";
import { normalizeServerUrl } from "@/utils/authConfig";

/**
 * Desktop login profiles: several servers and accounts (WPF `ProfileManager`).
 *
 * The list and the global login options are stored by Rust in
 * `<app_data_dir>/profiles.json` (or `localStorage` `playstash_profiles` when
 * Rust is unavailable, e.g. the simulated desktop mode). Refresh tokens live
 * in the vault (`refresh_token:<profileId>`, see `tokenStorage.ts`). Passwords
 * are never stored: a profile without a valid token asks for the password.
 *
 * This module is the single source of truth shared by `AuthContext` (session)
 * and `ProfilesContext` (UI). Other packages read the active profile with
 * `getCurrentProfileId()` / `profileScopedKey()` and listen to
 * `PROFILE_CHANGED_EVENT`.
 */
export interface Profile {
  id: string;
  /** Normalized server URL. */
  serverUrl: string;
  /** Username or email used to sign in (SSO: the username from `/users/me`). */
  username: string;
  displayName?: string | null;
  avatarMediaId?: number | null;
  sso: boolean;
  userId?: number | null;
  createdAt: number;
  lastUsedAt: number;
}

export interface ProfilesState {
  profiles: Profile[];
  /** WPF "Remember Me": log into `lastProfileId` at startup. */
  rememberMe: boolean;
  lastProfileId: string | null;
  /** The pre-profile session was moved into a profile. */
  legacySessionMigrated: boolean;
  /** The "import from the previous client" question was answered. */
  legacyImportOffered: boolean;
}

/** Dispatched on `window` with `detail: {profileId, previousProfileId}` (the theme manager listens). */
export const PROFILE_CHANGED_EVENT = "playstash:profile-changed";
export const PROFILES_STORAGE_KEY = "playstash_profiles";
const PROFILE_NAMESPACE_PREFIX = "playstash:profile:";

export const EMPTY_PROFILES_STATE: ProfilesState = {
  profiles: [],
  rememberMe: false,
  lastProfileId: null,
  legacySessionMigrated: false,
  legacyImportOffered: false,
};

/** Profiles are a desktop feature; the web build keeps its single session. */
export function profilesEnabled(): boolean {
  return isTauriApp();
}

export function createProfileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The host (and port / path) shown on profile cards. */
export function profileHost(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.host}${path}`;
  } catch {
    return serverUrl;
  }
}

export function sameServer(a: string, b: string): boolean {
  const left = normalizeServerUrl(a);
  return !!left && left === normalizeServerUrl(b);
}

/** WPF "Profile with this name already exists": same username and server. */
export function findDuplicateProfile(
  profiles: Profile[],
  serverUrl: string,
  username: string,
  ignoreId?: string,
): Profile | undefined {
  const name = username.trim().toLowerCase();
  if (!name) return undefined;
  return profiles.find(
    (profile) =>
      profile.id !== ignoreId &&
      profile.username.trim().toLowerCase() === name &&
      sameServer(profile.serverUrl, serverUrl),
  );
}

export function upsertProfile(
  state: ProfilesState,
  profile: Profile,
): ProfilesState {
  const exists = state.profiles.some((entry) => entry.id === profile.id);
  return {
    ...state,
    profiles: exists
      ? state.profiles.map((entry) =>
          entry.id === profile.id ? profile : entry,
        )
      : [...state.profiles, profile],
  };
}

export function removeProfileFromState(
  state: ProfilesState,
  profileId: string,
): ProfilesState {
  return {
    ...state,
    profiles: state.profiles.filter((profile) => profile.id !== profileId),
    lastProfileId:
      state.lastProfileId === profileId ? null : state.lastProfileId,
  };
}

/** Profiles sorted for the picker: most recently used first. */
export function sortProfiles(profiles: Profile[]): Profile[] {
  return [...profiles].sort(
    (a, b) =>
      (b.lastUsedAt || 0) - (a.lastUsedAt || 0) ||
      a.username.localeCompare(b.username),
  );
}

function normalizeState(raw: unknown): ProfilesState {
  const value = (
    raw && typeof raw === "object" ? raw : {}
  ) as Partial<ProfilesState>;
  const profiles = Array.isArray(value.profiles)
    ? value.profiles.filter(
        (profile): profile is Profile =>
          !!profile &&
          typeof profile.id === "string" &&
          typeof profile.serverUrl === "string" &&
          typeof profile.username === "string",
      )
    : [];
  const lastProfileId =
    typeof value.lastProfileId === "string" &&
    profiles.some((profile) => profile.id === value.lastProfileId)
      ? value.lastProfileId
      : null;
  return {
    profiles,
    rememberMe: value.rememberMe === true,
    lastProfileId,
    legacySessionMigrated: value.legacySessionMigrated === true,
    legacyImportOffered: value.legacyImportOffered === true,
  };
}

// ── Store ───────────────────────────────────────────────────────────────────

let state: ProfilesState = EMPTY_PROFILES_STATE;
let loaded = false;
let loadPromise: Promise<ProfilesState> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();
let currentProfileId: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

async function readPersisted(): Promise<ProfilesState> {
  if (isTauriDesktop()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return normalizeState(await invoke("get_profiles_state"));
    } catch (error) {
      console.warn("[profiles] loading from Rust failed", error);
    }
  }
  try {
    return normalizeState(
      JSON.parse(localStorage.getItem(PROFILES_STORAGE_KEY) || "{}"),
    );
  } catch {
    return { ...EMPTY_PROFILES_STATE };
  }
}

async function writePersisted(next: ProfilesState): Promise<ProfilesState> {
  if (isTauriDesktop()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return normalizeState(
        await invoke("save_profiles_state", { state: next }),
      );
    } catch (error) {
      console.warn("[profiles] saving to Rust failed", error);
      throw error;
    }
  }
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function subscribeProfiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProfilesState(): ProfilesState {
  return state;
}

export function isProfilesLoaded(): boolean {
  return loaded;
}

/** Loads the persisted profiles once. */
export function loadProfiles(): Promise<ProfilesState> {
  if (!loadPromise) {
    loadPromise = readPersisted().then((next) => {
      state = next;
      loaded = true;
      notify();
      return next;
    });
  }
  return loadPromise;
}

/**
 * Serialized read-modify-write. The in-memory state updates immediately; the
 * write is persisted in order.
 */
export function updateProfiles(
  change: (current: ProfilesState) => ProfilesState,
): Promise<ProfilesState> {
  const run = async () => {
    await loadProfiles();
    const next = normalizeState(change(state));
    state = next;
    notify();
    const saved = await writePersisted(next);
    state = saved;
    notify();
    return saved;
  };
  const result = writeChain.then(run, run);
  writeChain = result.catch(() => undefined);
  return result;
}

export function getProfile(
  profileId: string | null | undefined,
): Profile | undefined {
  if (!profileId) return undefined;
  return state.profiles.find((profile) => profile.id === profileId);
}

/** The active desktop profile id, or null (web build / logged out). */
export function getCurrentProfileId(): string | null {
  return currentProfileId;
}

/** Sets the active profile and announces the change. */
export function setCurrentProfileId(profileId: string | null): void {
  if (profileId === currentProfileId) return;
  const previousProfileId = currentProfileId;
  currentProfileId = profileId;
  notify();
  try {
    window.dispatchEvent(
      new CustomEvent(PROFILE_CHANGED_EVENT, {
        detail: { profileId, previousProfileId },
      }),
    );
  } catch {
    /* no window (tests) */
  }
}

/**
 * A localStorage key namespaced to a profile, for user-scoped settings that
 * must not leak between accounts. Falls back to the plain key without a
 * profile (web build).
 */
export function profileScopedKey(
  key: string,
  profileId: string | null = currentProfileId,
): string {
  return profileId ? `${PROFILE_NAMESPACE_PREFIX}${profileId}:${key}` : key;
}

/** Removes every localStorage key of a profile's namespace. */
export function clearProfileNamespace(profileId: string): void {
  try {
    const prefix = `${PROFILE_NAMESPACE_PREFIX}${profileId}:`;
    const doomed: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* storage unavailable */
  }
}

/** Test helper. */
export function __resetProfilesForTests(
  next: ProfilesState = EMPTY_PROFILES_STATE,
): void {
  state = next;
  loaded = false;
  loadPromise = null;
  writeChain = Promise.resolve();
  currentProfileId = null;
  listeners.clear();
}
