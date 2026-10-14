import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { PlaystashUser } from "../api";
import { AuthTokens } from "../types/AuthTokens";
import {
  AUTH_SERVER_STORAGE_KEY,
  getDevAutologinConfig,
  normalizeServerUrl,
} from "@/utils/authConfig";
import {
  getRefreshToken,
  initTokenStorage,
  migrateLegacyRefreshToken,
  removeRefreshToken,
  setRefreshToken,
  setTokenProfile,
} from "@/utils/tokenStorage";
import { isTauriApp } from "@/utils/tauri";
import {
  authenticatedRequestUrl,
  parseCachedUser,
  serializeCachedUser,
} from "@/utils/authSecurity";
import { useOnlineStatus } from "@/context/OfflineContext";
import { computeNextTokenRefresh, isAuthError } from "@/utils/authTokens";
import { initRequestHeaders, setServerContext } from "@/utils/requestHeaders";
import { serverFetch } from "@/utils/serverFetch";
import {
  createProfileId,
  getProfile,
  getProfilesState,
  loadProfiles,
  profilesEnabled,
  setCurrentProfileId,
  updateProfiles,
  upsertProfile,
  type Profile,
} from "@/utils/profiles";
import { runProfileSwitchEffects } from "@/utils/profileSession";
import { applyPendingConnection } from "@/utils/connectionFile";
import { ProfilesProvider } from "@/context/ProfilesContext";
import { translate } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

const AUTH_CACHED_USER_KEY = "app_cached_user";
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

function cachedUserKey(profileId: string | null): string {
  return profileId
    ? `${AUTH_CACHED_USER_KEY}:${profileId}`
    : AUTH_CACHED_USER_KEY;
}

interface LoginArgs {
  server: string;
  username: string;
  password: string;
  /** Desktop: the profile this login belongs to (created when missing). */
  profileId?: string;
}

interface LoginWithTokensOptions {
  /** Desktop: the profile this login belongs to (created when missing). */
  profileId?: string;
}

export interface LogoutResult {
  /** The server could not revoke the session; the local logout still happened. */
  revokeError?: string;
}

interface AuthContextValue {
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

const AuthContext = createContext<AuthContextValue | null>(null);

/** Updates the stored profile after a successful login (desktop). */
async function recordProfileLogin(
  profileId: string,
  server: string,
  me: PlaystashUser,
  details: { username?: string; sso: boolean },
): Promise<void> {
  const now = Date.now();
  await updateProfiles((state) => {
    const existing = getProfile(profileId);
    const profile: Profile = {
      id: profileId,
      createdAt: existing?.createdAt ?? now,
      ...existing,
      serverUrl: server,
      // Keep what the user typed (it may be an email); SSO profiles take the
      // account's username like the WPF client.
      username:
        (details.sso ? me.username : details.username?.trim()) ||
        existing?.username ||
        me.username,
      displayName: me.username,
      avatarMediaId: me.avatar?.id ?? null,
      sso: details.sso,
      userId: me.id,
      lastUsedAt: now,
    };
    const next = upsertProfile(state, profile);
    return next.rememberMe ? { ...next, lastProfileId: profileId } : next;
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [serverUrl, setServerUrl] = useState("");
  const [auth, setAuth] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<PlaystashUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [offlineBootstrap, setOfflineBootstrap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentProfileId, setCurrentProfileState] = useState<string | null>(
    null,
  );

  const bootstrapRanRef = useRef(false);

  const authRef = useRef<AuthTokens | null>(null);
  const serverRef = useRef("");
  const profileIdRef = useRef<string | null>(null);
  const nextTokenRefreshRef = useRef<Date | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  /** When true, ensureFreshToken is a no-op — used during offline mode */
  const offlineModeRef = useRef(false);
  /** Cooldown timestamp (ms) — skip refresh retries until after this time */
  const offlineRefreshCooldownRef = useRef(0);
  /** True while the initial bootstrap is still deciding session state. */
  const bootstrapInProgressRef = useRef(true);

  const { onReconnect } = useOnlineStatus();

  /**
   * Points the session at a server (and, on the desktop, a profile): the
   * token storage, the Rust server context for request headers and the
   * offline poller follow it.
   */
  function selectSession(server: string, profileId: string | null) {
    serverRef.current = server;
    setServerUrl(server);
    try {
      localStorage.setItem(AUTH_SERVER_STORAGE_KEY, server);
    } catch {
      /* storage unavailable */
    }
    if (profilesEnabled()) {
      setTokenProfile(profileId);
      if (profileIdRef.current !== profileId) {
        profileIdRef.current = profileId;
        setCurrentProfileState(profileId);
        setCurrentProfileId(profileId);
      }
    }
    void setServerContext(server);
    try {
      window.dispatchEvent(
        new CustomEvent(SERVER_CHANGED_EVENT, {
          detail: { serverUrl: server },
        }),
      );
    } catch {
      /* no window */
    }
  }

  function writeCachedUser(me: PlaystashUser) {
    // Always cache user for offline bootstrap (Tauri only)
    if (!isTauriApp()) return;
    try {
      localStorage.setItem(
        cachedUserKey(profileIdRef.current),
        serializeCachedUser(me),
      );
    } catch {
      /* ignore */
    }
  }

  function readCachedUser(): PlaystashUser | null {
    const raw = localStorage.getItem(cachedUserKey(profileIdRef.current));
    if (!raw) return null;
    try {
      return parseCachedUser(raw);
    } catch {
      localStorage.removeItem(cachedUserKey(profileIdRef.current));
      return null;
    }
  }

  async function loginBasicRequest(
    username: string,
    password: string,
  ): Promise<AuthTokens> {
    const res = await serverFetch(
      `${serverRef.current}/api/auth/basic/login`,
      {
        method: "GET",
        headers: {
          Authorization: "Basic " + btoa(`${username}:${password}`),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
      serverRef.current,
    );
    if (!res.ok)
      throw new AuthRequestError(
        fillTemplate(translate("auth.error.loginFailed"), {
          status: res.status,
          details: (await res.text()) || res.statusText,
        }),
        res.status,
      );
    return res.json();
  }
  async function refreshWithToken(refreshToken: string): Promise<AuthTokens> {
    const res = await serverFetch(
      `${serverRef.current}/api/auth/refresh`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + refreshToken,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "",
        signal: AbortSignal.timeout(10_000),
        redirect: "error",
      },
      serverRef.current,
    );
    if (!res.ok)
      throw new AuthRequestError(
        fillTemplate(translate("auth.error.refreshFailed"), {
          status: res.status,
          details: (await res.text()) || res.statusText,
        }),
        res.status,
      );
    return res.json();
  }
  async function fetchCurrentUser(): Promise<PlaystashUser> {
    const res = await authFetch(`${serverRef.current}/api/users/me`);
    if (!res.ok)
      throw new AuthRequestError(
        fillTemplate(translate("auth.error.currentUserFailed"), {
          status: res.status,
          details: (await res.text()) || res.statusText,
        }),
        res.status,
      );
    const me: PlaystashUser = await res.json();
    writeCachedUser(me);
    return me;
  }

  /** Bearer request to the selected server, with the additional headers. */
  function fetchWithToken(
    input: string,
    token: string | undefined,
    init?: RequestInit,
  ): Promise<Response> {
    const url = authenticatedRequestUrl(input, serverRef.current);
    const headers = new Headers(init?.headers);
    if (token && !headers.has("Authorization"))
      headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "*/*");
    return serverFetch(
      url,
      { ...init, headers, redirect: "error" },
      serverRef.current,
    );
  }

  const isTokenNearExpiry = useCallback(() => {
    const nxt = nextTokenRefreshRef.current;
    if (!nxt) return true;
    const threshold = Date.now() + 60_000;
    return nxt.getTime() <= threshold;
  }, []);
  const performRefresh = useCallback(() => {
    // Deduplicate concurrent refreshes. The backend rotates the refresh token
    // and replaces the stored hash on every successful refresh, so two
    // in-flight refreshes that both use the SAME old token cause the second to
    // be rejected ("Invalid or expired refresh token"), which callers treat as
    // a genuine auth failure and log the user out. Sharing one in-flight
    // refresh across every caller avoids that race.
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const promise = (async () => {
      // Ensure the cached refresh token is populated so concurrent 401
      // handlers sharing this in-flight refresh never read an empty cache.
      await initTokenStorage();
      const refreshToken = authRef.current?.refresh_token || getRefreshToken();
      if (!refreshToken) throw new Error("Missing refresh token");
      const data = await refreshWithToken(refreshToken);
      if (!data?.access_token)
        throw new Error("Refresh response missing access_token");
      const merged: AuthTokens = { ...(authRef.current || {}), ...data };
      authRef.current = merged;
      setAuth(merged);
      if (merged.refresh_token) await setRefreshToken(merged.refresh_token);
      nextTokenRefreshRef.current = computeNextTokenRefresh(
        merged.access_token,
      );
      offlineModeRef.current = false; // successfully refreshed, exit offline mode
    })();

    refreshInFlightRef.current = promise;
    const clear = () => {
      if (refreshInFlightRef.current === promise) {
        refreshInFlightRef.current = null;
      }
    };
    promise.then(clear, clear);

    return promise;
  }, []);

  /** Clears the in-memory session (tokens stay where they are). */
  function clearSessionState() {
    offlineModeRef.current = false;
    offlineRefreshCooldownRef.current = 0;
    authRef.current = null;
    nextTokenRefreshRef.current = null;
    setAuth(null);
    setUser(null);
    setOfflineBootstrap(false);
  }

  /**
   * Called whenever we have confirmed the current session is genuinely
   * invalid (the backend rejected the token and a refresh is not possible).
   * Clears all auth state and redirects the user to the login screen by
   * clearing `auth` — ProtectedRoute reacts to `auth === null` and navigates
   * to "/". We also record a user-facing message so the login page can
   * explain what happened.
   */
  const handleSessionExpired = useCallback(async () => {
    // During the initial bootstrap the AuthProvider owns the session lifecycle.
    // A concurrent request must not tear down the session (and erase the
    // refresh token) while the bootstrap is still deciding whether the session
    // is recoverable — e.g. on a transient network blip, or a token that was
    // rotated between checks. The bootstrap itself handles genuine auth errors.
    if (bootstrapInProgressRef.current) {
      console.log("[auth] handleSessionExpired suppressed during bootstrap");
      return;
    }
    console.log(
      "[auth] session expired — clearing auth and redirecting to login",
    );
    clearSessionState();
    await removeRefreshToken();
    localStorage.removeItem(cachedUserKey(profileIdRef.current));
    setError(translate("auth.error.sessionExpired"));
  }, []);

  const ensureFreshToken = useCallback(async () => {
    // In offline mode: try the refresh. If network fails, stay offline silently.
    // If it succeeds, performRefresh clears offlineModeRef and we exit offline mode.
    if (offlineModeRef.current) {
      console.log(
        "[auth] ensureFreshToken: offline mode, attempting refresh...",
      );
      // Cooldown: don't spam failed refresh attempts while truly offline
      if (Date.now() < offlineRefreshCooldownRef.current) {
        console.log(
          "[auth] ensureFreshToken: refresh cooldown active, skipping",
        );
        return;
      }
      try {
        await performRefresh();
        console.log(
          "[auth] ensureFreshToken: offline refresh SUCCEEDED, exiting offline mode",
        );
      } catch (e) {
        // Network down — set cooldown and stay offline
        console.log(
          "[auth] ensureFreshToken: offline refresh failed, cooldown 30s:",
          e instanceof Error ? e.message : String(e),
        );
        offlineRefreshCooldownRef.current = Date.now() + 30_000;
      }
      return;
    }
    // Normal online path
    if (!authRef.current?.access_token) {
      console.log("[auth] ensureFreshToken: no access_token");
      return;
    }
    if (!isTokenNearExpiry()) return;
    try {
      await performRefresh();
    } catch (e) {
      console.log(
        "[auth] normal refresh failed:",
        e instanceof Error ? e.message : String(e),
      );
      // If Tauri + stored creds exist, fall back to offline mode on any
      // failure (the reconnect handler will re-authenticate later).
      if (isTauriApp() && getRefreshToken()) {
        console.log("[auth] network failure, re-entering offline mode");
        offlineModeRef.current = true;
        offlineRefreshCooldownRef.current = Date.now() + 30_000;
      } else if (isAuthError(e)) {
        // Genuine auth failure — the refresh token was rejected. The
        // session is no longer valid, so send the user to the login screen.
        await handleSessionExpired();
      } else {
        // Transient network error. Keep the session intact and back off so
        // we don't hammer the endpoint while the server is unreachable.
        offlineRefreshCooldownRef.current = Date.now() + 30_000;
      }
    }
  }, [isTokenNearExpiry, performRefresh, handleSessionExpired]);

  /**
   * Authenticated fetch. Before issuing the request it ensures the access
   * token is fresh. If the backend still answers 401 (e.g. the token expired
   * in the window between the freshness check and the request, or the token
   * has been revoked), it refreshes once and retries. If the session truly
   * cannot be recovered it clears auth so the router sends the user to the
   * login screen instead of leaving every page stuck on 401 errors.
   *
   * Requests carry the additional request headers (desktop "Client
   * Settings"); see `serverFetch`.
   */
  const authFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      authenticatedRequestUrl(input, serverRef.current);
      await ensureFreshToken();
      let res = await fetchWithToken(
        input,
        authRef.current?.access_token,
        init,
      );

      if (res.status === 401) {
        // Token was rejected. Try refreshing once and replay the request.
        try {
          await performRefresh();
          const token = authRef.current?.access_token;
          res = await fetchWithToken(input, token, init);
        } catch (e) {
          // Refresh failed while handling the 401. Only force a logout for a
          // genuine auth error — a transient network problem should not
          // destroy a still-valid session.
          if (isAuthError(e)) await handleSessionExpired();
          return res;
        }
        if (res.status === 401) {
          // Even after a successful refresh the request was rejected, so the
          // session is genuinely invalid — send the user to login.
          await handleSessionExpired();
        }
      }

      return res;
    },
    [ensureFreshToken, performRefresh, handleSessionExpired],
  );

  /** Returns a fresh, valid access token (refreshing if needed), or null. */
  const getAccessToken = useCallback(async () => {
    try {
      await ensureFreshToken();
    } catch {
      // Ignore refresh failures; fall through to the currently held token.
    }
    return authRef.current?.access_token ?? null;
  }, [ensureFreshToken]);

  /** Desktop: the profile for a new login (existing id, or a new one). */
  function resolveProfileId(
    server: string,
    username: string,
    requested?: string,
  ): string | null {
    if (!profilesEnabled()) return null;
    if (requested) return requested;
    const name = username.trim().toLowerCase();
    const existing = getProfilesState().profiles.find(
      (profile) =>
        !!name &&
        profile.username.trim().toLowerCase() === name &&
        normalizeServerUrl(profile.serverUrl) === server,
    );
    return existing?.id ?? createProfileId();
  }

  /** Enters offline mode with the profile's cached user. Returns success. */
  function enterOfflineMode(refreshToken: string | null): boolean {
    const cachedUser = readCachedUser();
    if (!cachedUser) return false;
    writeCachedUser(cachedUser);
    console.log(
      "[auth] entering OFFLINE MODE with cached user:",
      cachedUser.username,
    );
    // Reconstruct minimal auth from stored refresh token
    offlineModeRef.current = true;
    authRef.current = {
      access_token: "",
      refresh_token: refreshToken ?? undefined,
    };
    // Push expiry 24h out so ensureFreshToken won't try to refresh
    nextTokenRefreshRef.current = new Date(Date.now() + 24 * 60 * 60 * 1000);
    setAuth(authRef.current);
    setUser(cachedUser);
    setOfflineBootstrap(true);
    return true;
  }

  async function afterLogin(
    me: PlaystashUser,
    details: { username?: string; sso: boolean },
  ) {
    const profileId = profileIdRef.current;
    if (profileId) {
      try {
        await recordProfileLogin(profileId, serverRef.current, me, details);
      } catch (e) {
        console.warn("[auth] updating the profile failed", e);
      }
    }
    try {
      await applyPendingConnection(serverRef.current);
    } catch (e) {
      console.warn("[auth] applying the imported connection failed", e);
    }
  }

  const loginBasic = useCallback(
    async ({ server, username, password, profileId }: LoginArgs) => {
      setError(null);
      setLoading(true);
      clearSessionState();
      const normalized = normalizeServerUrl(server);
      selectSession(
        normalized,
        resolveProfileId(normalized, username, profileId),
      );
      try {
        if (!server || !username || !password)
          throw new Error(translate("auth.error.fieldsRequired"));
        const authData = await loginBasicRequest(username, password);
        authRef.current = authData;
        setAuth(authData);
        if (authData.refresh_token)
          await setRefreshToken(authData.refresh_token);
        nextTokenRefreshRef.current = authData.access_token
          ? computeNextTokenRefresh(authData.access_token)
          : new Date();
        const me = await fetchCurrentUser();
        setUser(me);
        await afterLogin(me, { username, sso: false });
        return { auth: authData, user: me };
      } catch (e) {
        if (!isPendingActivationError(e)) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
        }
        authRef.current = null;
        setAuth(null);
        throw e;
      } finally {
        setLoading(false);
        bootstrapInProgressRef.current = false;
        setBootstrapping(false);
      }
    },
    [],
  );

  const loginWithTokens = useCallback(
    async (
      server: string,
      tokens: AuthTokens,
      options?: LoginWithTokensOptions,
    ) => {
      setError(null);
      setLoading(true);
      clearSessionState();
      const normalized = normalizeServerUrl(server);
      selectSession(
        normalized,
        profilesEnabled() ? (options?.profileId ?? createProfileId()) : null,
      );
      try {
        if (!tokens?.access_token)
          throw new Error(translate("auth.error.missingAccessToken"));
        authRef.current = tokens;
        setAuth(tokens);
        if (tokens.refresh_token) await setRefreshToken(tokens.refresh_token);
        nextTokenRefreshRef.current = computeNextTokenRefresh(
          tokens.access_token,
        );
        const me = await fetchCurrentUser();
        setUser(me);
        await afterLogin(me, { sso: true });
        return { auth: tokens, user: me };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        authRef.current = null;
        setAuth(null);
        throw e;
      } finally {
        setLoading(false);
        bootstrapInProgressRef.current = false;
        setBootstrapping(false);
      }
    },
    [],
  );

  const loginStoredSession = useCallback(async (profileId: string) => {
    const profile = getProfile(profileId);
    if (!profile) throw new Error(translate("auth.error.profileNotFound"));
    setError(null);
    setLoading(true);
    clearSessionState();
    selectSession(normalizeServerUrl(profile.serverUrl), profileId);
    try {
      await initTokenStorage();
      const storedRefresh = getRefreshToken();
      if (!storedRefresh) throw new CredentialsRequiredError();
      try {
        await performRefresh();
      } catch (e) {
        if (isPendingActivationError(e)) throw e;
        if (isAuthError(e)) {
          await removeRefreshToken();
          throw new CredentialsRequiredError(
            translate("auth.error.sessionExpired"),
          );
        }
        // Server unreachable: like the WPF client, open the profile offline
        // when it was set up before.
        if (isTauriApp() && enterOfflineMode(storedRefresh)) {
          const cached = readCachedUser();
          return { auth: authRef.current!, user: cached! };
        }
        throw e;
      }
      const me = await fetchCurrentUser();
      setUser(me);
      await afterLogin(me, { sso: profile.sso, username: profile.username });
      return { auth: authRef.current!, user: me };
    } catch (e) {
      if (
        !(e instanceof CredentialsRequiredError) &&
        !isPendingActivationError(e)
      )
        setError(e instanceof Error ? e.message : String(e));
      if (!offlineModeRef.current) {
        authRef.current = null;
        setAuth(null);
      }
      throw e;
    } finally {
      setLoading(false);
      bootstrapInProgressRef.current = false;
      setBootstrapping(false);
    }
  }, []);

  /** Restores the selected session at startup (refresh, else offline mode). */
  async function restoreSession(storedRefresh: string) {
    offlineModeRef.current = false;

    // Safety: force offline bootstrap if network calls hang > 15s
    const safetyTimer = isTauriApp()
      ? setTimeout(() => {
          console.log("[bootstrap] SAFETY TIMER FIRED — forcing offline");
          enterOfflineMode(storedRefresh);
          bootstrapInProgressRef.current = false;
          setBootstrapping(false);
        }, 15_000)
      : null;

    try {
      console.log("[bootstrap] trying performRefresh...");
      // Route the bootstrap refresh through the single-flight performRefresh
      // so any concurrent refresh (e.g. downloads resuming at launch hitting
      // a 401 while auth is still null) shares the SAME in-flight call. The
      // backend rotates the refresh token on every successful refresh, so
      // two refreshes using the same old token race: the loser gets
      // "Invalid or expired refresh token" and is mistaken for a genuine
      // auth failure, logging the user out on reload. performRefresh also
      // persists the rotated token and updates the expiry.
      await performRefresh();
      console.log("[bootstrap] refresh succeeded, fetching user...");
      const me = await fetchCurrentUser();
      setUser(me);
      const profile = getProfile(profileIdRef.current);
      if (profile)
        await afterLogin(me, { sso: profile.sso, username: profile.username });
    } catch (e) {
      console.log(
        "[bootstrap] refresh/fetch failed:",
        e instanceof Error ? e.message : String(e),
      );
      // In Tauri mode: if refresh fails (likely network error), try offline bootstrap
      if (isTauriApp() && !isAuthError(e)) {
        if (!enterOfflineMode(storedRefresh)) {
          // No cached user yet — keep refresh token so next online launch auto-logs in.
          console.log(
            "[bootstrap] no cached user, clearing auth (login page expected)",
          );
          authRef.current = null;
          setAuth(null);
        }
      } else if (isAuthError(e)) {
        // The stored refresh token was rejected by the backend — the session
        // is genuinely invalid, so clear it and send the user to login.
        console.log(
          "[bootstrap] refresh rejected (auth error), clearing session",
        );
        await removeRefreshToken();
        authRef.current = null;
        setAuth(null);
      } else {
        // Transient network error (server unreachable, timeout, offline).
        // Keep the refresh token so the session can be restored on the next
        // successful load, but land on the login screen for now.
        console.log(
          "[bootstrap] transient network error, keeping refresh token",
        );
        authRef.current = null;
        setAuth(null);
      }
    } finally {
      if (safetyTimer) clearTimeout(safetyTimer);
    }
  }

  /**
   * Desktop: moves the pre-profile single session into a profile once, so
   * existing users keep logging in automatically.
   */
  async function migrateLegacySession(): Promise<void> {
    const state = getProfilesState();
    if (state.legacySessionMigrated) return;
    const storedServer = normalizeServerUrl(
      localStorage.getItem(AUTH_SERVER_STORAGE_KEY) || "",
    );
    let migrated: Profile | null = null;
    if (storedServer && !state.profiles.length) {
      const id = createProfileId();
      try {
        if (await migrateLegacyRefreshToken(id)) {
          let cached: PlaystashUser | null = null;
          try {
            const raw = localStorage.getItem(AUTH_CACHED_USER_KEY);
            cached = raw ? parseCachedUser(raw) : null;
            if (raw) {
              localStorage.setItem(cachedUserKey(id), raw);
              localStorage.removeItem(AUTH_CACHED_USER_KEY);
            }
          } catch {
            cached = null;
          }
          const now = Date.now();
          migrated = {
            id,
            serverUrl: storedServer,
            username: cached?.username ?? "",
            displayName: cached?.username ?? null,
            avatarMediaId: cached?.avatar?.id ?? null,
            sso: false,
            userId: cached?.id ?? null,
            createdAt: now,
            lastUsedAt: now,
          };
        }
      } catch (e) {
        console.warn("[auth] migrating the previous session failed", e);
        return;
      }
    }
    await updateProfiles((current) => {
      const base = { ...current, legacySessionMigrated: true };
      if (!migrated) return base;
      // The previous client always logged in automatically: keep that.
      return {
        ...upsertProfile(base, migrated),
        rememberMe: true,
        lastProfileId: migrated.id,
      };
    });
  }

  useEffect(() => {
    // Guard against React StrictMode double-mount.
    if (bootstrapRanRef.current) return;
    bootstrapRanRef.current = true;

    (async () => {
      let storedRefresh: string | null = null;
      let storedServer: string | null = null;
      if (profilesEnabled()) {
        await initRequestHeaders();
        try {
          await loadProfiles();
          await migrateLegacySession();
        } catch (e) {
          console.warn("[bootstrap] loading profiles failed", e);
        }
        const state = getProfilesState();
        const last = state.rememberMe
          ? getProfile(state.lastProfileId)
          : undefined;
        if (last) {
          selectSession(normalizeServerUrl(last.serverUrl), last.id);
          await initTokenStorage();
          storedRefresh = getRefreshToken();
          storedServer = last.serverUrl;
        }
      } else {
        await initTokenStorage();
        storedRefresh = getRefreshToken();
        storedServer = localStorage.getItem(AUTH_SERVER_STORAGE_KEY);
      }
      console.log(
        "[bootstrap] storedRefresh:",
        !!storedRefresh,
        "storedServer:",
        !!storedServer,
        "isTauri:",
        isTauriApp(),
      );
      if (!storedRefresh || !storedServer) {
        const devAutologin = getDevAutologinConfig();
        if (!devAutologin) {
          bootstrapInProgressRef.current = false;
          setBootstrapping(false);
          return;
        }

        setLoading(true);
        setError(null);
        selectSession(
          devAutologin.server,
          resolveProfileId(devAutologin.server, devAutologin.username),
        );
        try {
          const tokens = await loginBasicRequest(
            devAutologin.username,
            devAutologin.password,
          );
          if (!tokens.access_token) {
            throw new Error("No access_token in dev autologin response");
          }
          authRef.current = tokens;
          setAuth(tokens);
          if (tokens.refresh_token) {
            await setRefreshToken(tokens.refresh_token);
          }
          nextTokenRefreshRef.current = computeNextTokenRefresh(
            tokens.access_token,
          );
          const me = await fetchCurrentUser();
          setUser(me);
          await afterLogin(me, {
            username: devAutologin.username,
            sso: false,
          });
        } catch (e) {
          authRef.current = null;
          setAuth(null);
          setUser(null);
          nextTokenRefreshRef.current = null;
          await removeRefreshToken();
          setError(e instanceof Error ? e.message : "Dev autologin failed.");
        } finally {
          setLoading(false);
          bootstrapInProgressRef.current = false;
          setBootstrapping(false);
        }
        return;
      }
      if (!profilesEnabled())
        selectSession(normalizeServerUrl(storedServer), null);

      try {
        await restoreSession(storedRefresh);
      } finally {
        console.log(
          "[bootstrap] done, bootstrapping=false, authRef:",
          !!authRef.current,
        );
        bootstrapInProgressRef.current = false;
        setBootstrapping(false);
      }
    })();
  }, []);

  // When coming back online after offline mode, re-authenticate
  useEffect(() => {
    if (!isTauriApp()) return;

    const unregister = onReconnect(async () => {
      console.log("[auth] reconnect callback fired, refreshing...");
      // Route through performRefresh so any concurrent 401-triggered refresh
      // shares the same in-flight call and we don't race the token rotation.
      // performRefresh also clears offlineModeRef on success.
      const storedRefresh = getRefreshToken();
      if (!storedRefresh) return;

      try {
        await performRefresh();
        // Re-fetch user data now that we're back online
        const me = await fetchCurrentUser();
        setUser(me);
        console.log("[auth] re-authenticated successfully");
      } catch (e) {
        console.log(
          "[auth] reconnect refresh failed, staying offline:",
          e instanceof Error ? e.message : String(e),
        );
      }
    });

    return unregister;
  }, [onReconnect, performRefresh]);

  /**
   * Clears the local session. `forget` also deletes the stored token and the
   * cached user (a real logout); without it the profile can log in again
   * without a password (Change Profile).
   */
  async function finishLocalLogout(forget: boolean) {
    const profileId = profileIdRef.current;
    clearSessionState();
    setError(null);
    if (forget) {
      await removeRefreshToken();
      localStorage.removeItem(cachedUserKey(profileId));
    }
    if (profilesEnabled()) {
      try {
        await updateProfiles((state) => ({ ...state, lastProfileId: null }));
      } catch (e) {
        console.warn("[auth] clearing the last profile failed", e);
      }
      profileIdRef.current = null;
      setCurrentProfileState(null);
      setTokenProfile(null);
      setCurrentProfileId(null);
      await runProfileSwitchEffects();
    }
  }

  /**
   * Revokes the session on the server, then logs out locally. Like the WPF
   * client the stored token is deleted first; a failed revoke is reported but
   * the local logout always completes.
   */
  const revokeAndLogout = useCallback(
    async (path: "/api/auth/revoke" | "/api/auth/revoke/all") => {
      const server = serverRef.current;
      const accessToken = authRef.current?.access_token;
      const refreshToken =
        authRef.current?.refresh_token || getRefreshToken() || "";
      await removeRefreshToken();
      let revokeError: string | undefined;
      try {
        if (!server) throw new Error(translate("auth.error.notConnected"));
        if (!accessToken) throw new Error(translate("auth.error.offline"));
        const response = await fetchWithToken(`${server}${path}`, accessToken, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body:
            path === "/api/auth/revoke"
              ? JSON.stringify({ refresh_token: refreshToken })
              : "{}",
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            fillTemplate(translate("auth.error.logoutFailed"), {
              status: response.status,
              details: text || response.statusText,
            }),
          );
        }
      } catch (e) {
        revokeError = e instanceof Error ? e.message : String(e);
        console.warn("[auth] revoke failed", revokeError);
      }
      await finishLocalLogout(true);
      if (revokeError) {
        try {
          window.showAlertDialog?.({ title: revokeError, tone: "danger" });
        } catch {
          /* no dialog bridge */
        }
      }
      return { revokeError } satisfies LogoutResult;
    },
    [],
  );

  const logout = useCallback(
    () => revokeAndLogout("/api/auth/revoke"),
    [revokeAndLogout],
  );
  const logoutAllDevices = useCallback(
    () => revokeAndLogout("/api/auth/revoke/all"),
    [revokeAndLogout],
  );
  const logoutLocal = useCallback(() => finishLocalLogout(false), []);

  const refreshCurrentUser = useCallback(async () => {
    try {
      const me = await fetchCurrentUser();
      setUser(me);
      return me;
    } catch {
      return null;
    }
  }, []);

  const value: AuthContextValue = {
    serverUrl,
    auth,
    user,
    error,
    loading,
    bootstrapping,
    offlineBootstrap,
    currentProfileId,
    loginBasic,
    loginWithTokens,
    loginStoredSession,
    logout,
    logoutAllDevices,
    logoutLocal,
    authFetch,
    getAccessToken,
    refreshCurrentUser,
  };
  return (
    <AuthContext.Provider value={value}>
      <ProfilesProvider>{children}</ProfilesProvider>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
