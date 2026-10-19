import { createContext, useContext } from "react";
import type { PlaystashUser } from "../api";
import type { AuthTokens } from "../types/AuthTokens";
import { translate } from "@/i18n";

/** Dispatched when the active server changes (OfflineContext re-targets its poller). */
export const SERVER_CHANGED_EVENT = "playstash:server-changed";

/** An HTTP error from an authentication endpoint, with its status code. */
export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

/** A stored profile has no usable session: the password must be entered. */
export class CredentialsRequiredError extends Error {
  constructor(message = translate("auth.error.signInAgain")) {
    super(message);
    this.name = "CredentialsRequiredError";
  }
}

/** HTTP 406: the account exists but an admin has not activated it yet. */
export function isPendingActivationError(error: unknown): boolean {
  return error instanceof AuthRequestError && error.status === 406;
}

export interface LoginArgs {
  server: string;
  username: string;
  password: string;
  /** Desktop: the profile this login belongs to (created when missing). */
  profileId?: string;
}

export interface LoginWithTokensOptions {
  /** Desktop: the profile this login belongs to (created when missing). */
  profileId?: string;
}

export interface LogoutResult {
  /** The server could not revoke the session; the local logout still happened. */
  revokeError?: string;
}

export interface AuthContextValue {
  serverUrl: string;
  auth: AuthTokens | null;
  user: PlaystashUser | null;
  error: string | null;
  loading: boolean;
  bootstrapping: boolean;
  /** True when the app started in offline mode (cached credentials used) */
  offlineBootstrap: boolean;
  /** Desktop: the active login profile (null on the web build or when logged out). */
  currentProfileId: string | null;
  loginBasic: (
    args: LoginArgs,
  ) => Promise<{ auth: AuthTokens; user: PlaystashUser }>;
  /** Directly initialize auth state from already obtained tokens (e.g. SSO redirect). */
  loginWithTokens: (
    server: string,
    tokens: AuthTokens,
    options?: LoginWithTokensOptions,
  ) => Promise<{ auth: AuthTokens; user: PlaystashUser }>;
  /**
   * Desktop: logs into a stored profile with its saved session. Throws
   * `CredentialsRequiredError` when the password must be entered.
   */
  loginStoredSession: (
    profileId: string,
  ) => Promise<{ auth: AuthTokens; user: PlaystashUser }>;
  /** "Logout from this Device": revokes the session on the server, then logs out locally. */
  logout: () => Promise<LogoutResult>;
  /** "Logout from all Devices": revokes every session of the account. */
  logoutAllDevices: () => Promise<LogoutResult>;
  /** "Change Profile": local logout that keeps the server session (desktop). */
  logoutLocal: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Returns a fresh, valid access token (refreshing if needed), or null. */
  getAccessToken: () => Promise<string | null>;
  refreshCurrentUser: () => Promise<PlaystashUser | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
