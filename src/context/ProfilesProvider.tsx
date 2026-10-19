import {
  useCallback,
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
import { removeDefaultExtractionPassword } from "@/utils/extractionPassword";
import { isTauriDesktop } from "@/utils/tauri";
import { translate } from "@/i18n";
import {
  DISABLED,
  ProfilesContext,
  type ProfileDraft,
  type ProfilesContextValue,
} from "@/context/ProfilesContext";

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
    if (!serverUrl) throw new Error(translate("accounts.form.serverRequired"));
    const username = draft.username.trim();
    if (!draft.sso && !username)
      throw new Error(translate("accounts.form.usernameRequired"));
    if (
      username &&
      findDuplicateProfile(getProfilesState().profiles, serverUrl, username)
    )
      throw new Error(translate("accounts.form.duplicate"));
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
      if (!existing) throw new Error(translate("auth.error.profileNotFound"));
      const serverUrl = normalizeServerUrl(changes.serverUrl);
      if (!serverUrl)
        throw new Error(translate("accounts.form.serverRequired"));
      const username = changes.username.trim();
      if (!existing.sso && !username)
        throw new Error(translate("accounts.form.usernameRequired"));
      if (
        username &&
        findDuplicateProfile(
          getProfilesState().profiles,
          serverUrl,
          username,
          profileId,
        )
      )
        throw new Error(translate("accounts.form.duplicate"));
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
    await removeDefaultExtractionPassword(profileId);
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
