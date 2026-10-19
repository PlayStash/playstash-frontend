import { createContext, useContext } from "react";
import type { Profile } from "@/utils/profiles";
import { translate } from "@/i18n";

export interface ProfileDraft {
  serverUrl: string;
  username: string;
  sso: boolean;
}

export interface ProfilesContextValue {
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

export const DISABLED: ProfilesContextValue = {
  enabled: false,
  loaded: true,
  profiles: [],
  rememberMe: false,
  lastProfileId: null,
  currentProfileId: null,
  setRememberMe: async () => {},
  createProfile: async () => {
    throw new Error(translate("auth.error.desktopOnly"));
  },
  editProfile: async () => {
    throw new Error(translate("auth.error.desktopOnly"));
  },
  deleteProfile: async () => {},
  changeProfile: async () => {},
};

export const ProfilesContext = createContext<ProfilesContextValue>(DISABLED);

/** Desktop login profiles. Outside the provider (tests, web) profiles are disabled. */
export function useProfiles(): ProfilesContextValue {
  return useContext(ProfilesContext);
}
