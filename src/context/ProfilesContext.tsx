import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import { normalizeServerUrl } from "@/utils/authConfig";
import {
  clearProfileNamespace,
  createProfileId,
  findDuplicateProfile,
  getCurrentProfileId,
  getProfile,
  getProfilesState,
  isProfilesLoaded,
  loadProfiles,
  profilesEnabled,
  removeProfileFromState,
  sortProfiles,
  subscribeProfiles,
  updateProfiles,
  upsertProfile,
  type Profile,
} from "@/utils/profiles";
import { removeStoredRefreshToken } from "@/utils/tokenStorage";
import { isTauriDesktop } from "@/utils/tauri";

export interface ProfileDraft {
  serverUrl: string;
  username: string;
  sso: boolean;
}

interface ProfilesContextValue {
  /** Profiles exist in the desktop app only. */
  enabled: boolean;
  loaded: boolean;
  /** Most recently used first. */
  profiles: Profile[];
  rememberMe: boolean;
  lastProfileId: string | null;
  currentProfileId: string | null;
  setRememberMe: (rememberMe: boolean) => Promise<void>;
  /** "Save": stores a profile without logging in. */
  createProfile: (draft: ProfileDraft) => Promise<Profile>;
  /**
   * Edits server and username. A changed server keeps the profile id but
   * drops its session, so the next login asks for the password.
   */
  editProfile: (
    profileId: string,
    changes: { serverUrl: string; username: string },
  ) => Promise<Profile>;
  /** Removes the profile, its vault record, cached data and profile folder. */
  deleteProfile: (profileId: string) => Promise<void>;
  /** "Change Profile": local logout, back to the picker. */
  changeProfile: () => Promise<void>;
}

const DISABLED: ProfilesContextValue = {
  enabled: false,
  loaded: true,
  profiles: [],
  rememberMe: false,
  lastProfileId: null,
  currentProfileId: null,
  setRememberMe: async () => {},
  createProfile: async () => {
    throw new Error("Profiles are only available in the desktop app.");
  },
  editProfile: async () => {
    throw new Error("Profiles are only available in the desktop app.");
  },
  deleteProfile: async () => {},
  changeProfile: async () => {},
};

const ProfilesContext = createContext<ProfilesContextValue>(DISABLED);

function useProfilesSnapshot() {
  return useSyncExternalStore(
    subscribeProfiles,
    getProfilesState,
    getProfilesState,
  );
}

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const enabled = profilesEnabled();
  const { logoutLocal } = useAuth();
  const state = useProfilesSnapshot();
  const loaded = useSyncExternalStore(
    subscribeProfiles,
    isProfilesLoaded,
    isProfilesLoaded,
  );
  const currentProfileId = useSyncExternalStore(
    subscribeProfiles,
    getCurrentProfileId,
    getCurrentProfileId,
  );

  useEffect(() => {
    if (enabled) void loadProfiles();
  }, [enabled]);

  const setRememberMe = useCallback(async (rememberMe: boolean) => {
    await updateProfiles((current) => ({
      ...current,
      rememberMe,
      // WPF stores the last profile only while remember me is on.
      lastProfileId: rememberMe ? current.lastProfileId : null,
    }));
  }, []);

  const createProfile = useCallback(async (draft: ProfileDraft) => {
    const serverUrl = normalizeServerUrl(draft.serverUrl);
    if (!serverUrl) throw new Error("Enter the server URL.");
    const username = draft.username.trim();
    if (!draft.sso && !username) throw new Error("Username is not set");
    if (
      username &&
      findDuplicateProfile(getProfilesState().profiles, serverUrl, username)
    )
      throw new Error("Profile with this name already exists");
    const now = Date.now();
    const profile: Profile = {
      id: createProfileId(),
      serverUrl,
      username,
      displayName: null,
      avatarMediaId: null,
      sso: draft.sso,
      userId: null,
      createdAt: now,
      lastUsedAt: 0,
    };
    await updateProfiles((current) => upsertProfile(current, profile));
    return profile;
  }, []);

  const editProfile = useCallback(
    async (
      profileId: string,
      changes: { serverUrl: string; username: string },
    ) => {
      const existing = getProfile(profileId);
      if (!existing) throw new Error("User Profile not found");
      const serverUrl = normalizeServerUrl(changes.serverUrl);
      if (!serverUrl) throw new Error("Enter the server URL.");
      const username = changes.username.trim();
      if (!existing.sso && !username) throw new Error("Username is not set");
      if (
        username &&
        findDuplicateProfile(
          getProfilesState().profiles,
          serverUrl,
          username,
          profileId,
        )
      )
        throw new Error("Profile with this name already exists");
      const serverChanged =
        serverUrl !== normalizeServerUrl(existing.serverUrl);
      const usernameChanged =
        username.toLowerCase() !== existing.username.trim().toLowerCase();
      const next: Profile = {
        ...existing,
        serverUrl,
        username: username || existing.username,
        ...(serverChanged
          ? { userId: null, avatarMediaId: null, displayName: null }
          : {}),
      };
      // The session belongs to the old server/account: require a new login.
      if (serverChanged || usernameChanged) {
        await removeStoredRefreshToken(profileId);
        try {
          localStorage.removeItem(`app_cached_user:${profileId}`);
        } catch {
          /* storage unavailable */
        }
      }
      await updateProfiles((current) => upsertProfile(current, next));
      return next;
    },
    [],
  );

  const deleteProfile = useCallback(async (profileId: string) => {
    await updateProfiles((current) =>
      removeProfileFromState(current, profileId),
    );
    await removeStoredRefreshToken(profileId);
    clearProfileNamespace(profileId);
    try {
      localStorage.removeItem(`app_cached_user:${profileId}`);
      localStorage.removeItem(`app_native_token_blocked:${profileId}`);
    } catch {
      /* storage unavailable */
    }
    if (isTauriDesktop()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_profile_data", { profileId });
      } catch (error) {
        console.warn("[profiles] deleting the profile folder failed", error);
      }
    }
  }, []);

  const changeProfile = useCallback(() => logoutLocal(), [logoutLocal]);

  const value = useMemo<ProfilesContextValue>(
    () =>
      enabled
        ? {
            enabled,
            loaded,
            profiles: sortProfiles(state.profiles),
            rememberMe: state.rememberMe,
            lastProfileId: state.lastProfileId,
            currentProfileId,
            setRememberMe,
            createProfile,
            editProfile,
            deleteProfile,
            changeProfile,
          }
        : DISABLED,
    [
      enabled,
      loaded,
      state,
      currentProfileId,
      setRememberMe,
      createProfile,
      editProfile,
      deleteProfile,
      changeProfile,
    ],
  );

  return (
    <ProfilesContext.Provider value={value}>
      {children}
    </ProfilesContext.Provider>
  );
}

/** Desktop login profiles. Outside the provider (tests, web) profiles are disabled. */
export function useProfiles(): ProfilesContextValue {
  return useContext(ProfilesContext);
}
