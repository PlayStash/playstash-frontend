import {
  CredentialsRequiredError,
  isPendingActivationError,
  useAuth,
} from "@/context/AuthContext";
import { useProfiles } from "@/context/ProfilesContext";
import {
  AUTH_SERVER_STORAGE_KEY,
  DEFAULT_SERVER_URL,
  detectBackendServedWebUi,
  getDevAutologinConfig,
  normalizeServerUrl,
} from "@/utils/authConfig";
import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Checkbox, CheckboxField } from "@tw/checkbox";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useNavigate } from "react-router";
import { Status } from "../api";
import { applyTheme, getStoredTheme } from "@/utils/theme";
import { isTauriApp } from "@/utils/tauri";
import { useTranslation } from "@/i18n";
import { findDuplicateProfile, type Profile } from "@/utils/profiles";
import { setServerContext } from "@/utils/requestHeaders";
import { serverFetch } from "@/utils/serverFetch";
import {
  isServerOutdated,
  isServerVersionOutdated,
} from "@/utils/serverVersion";
import {
  CONNECTION_FILE_FILTER,
  parseConnectionFile,
  storePendingConnection,
} from "@/utils/connectionFile";
import { ProfilePicker } from "@/components/login/ProfilePicker";
import { ProfileEditor } from "@/components/login/ProfileEditor";
import { ClientSettingsDialog } from "@/components/login/ClientSettingsDialog";
import {
  PendingActivation,
  type ActivationPollResult,
} from "@/components/login/PendingActivation";
import { IncompatibleServerDialog } from "@/components/login/IncompatibleServerDialog";
import { confirmAction, showToast } from "@/components/login/confirm";

const SSO_PENDING_SERVER_KEY = "app_sso_pending_server";
/** Desktop: the profile an SSO redirect belongs to. */
const SSO_PENDING_PROFILE_KEY = "app_sso_pending_profile";

function consumeSsoCallback() {
  try {
    const loc = window.location;
    const hash = loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash;
    const unsafeLegacyUrl = /(?:access_token|refresh_token)=/.test(
      loc.search + loc.pathname,
    );
    if (!unsafeLegacyUrl && !/(?:access_token|refresh_token)=/.test(hash))
      return null;
    // This runs during initialization, before any effects can start requests.
    window.history.replaceState({}, document.title, loc.origin + "/login");
    const pendingServer = sessionStorage.getItem(SSO_PENDING_SERVER_KEY);
    const pendingProfile = sessionStorage.getItem(SSO_PENDING_PROFILE_KEY);
    sessionStorage.removeItem(SSO_PENDING_SERVER_KEY);
    sessionStorage.removeItem(SSO_PENDING_PROFILE_KEY);
    if (unsafeLegacyUrl || !pendingServer) return null;
    const server = normalizeServerUrl(pendingServer);
    const params = new URLSearchParams(hash);
    const access_token = params.get("access_token") || "";
    if (!server || !access_token) return null;
    return {
      server,
      profileId: pendingProfile || undefined,
      tokens: {
        access_token,
        refresh_token: params.get("refresh_token") || undefined,
      },
    };
  } catch {
    return null;
  }
}

type Step = "loading" | "picker" | "signin" | "edit" | "pending";

export function Login() {
  const { t } = useTranslation();
  const { loginBasic, loginWithTokens, loginStoredSession, loading, error } =
    useAuth();
  const profiles = useProfiles();
  const desktop = profiles.enabled;
  const navigate = useNavigate();
  const [ssoCallback] = useState(consumeSsoCallback);
  const ssoCallbackConsumed = useRef(false);
  const devAutologin = getDevAutologinConfig();
  const [step, setStep] = useState<Step>(desktop ? "loading" : "signin");
  const [server, setServer] = useState(() => {
    return (
      localStorage.getItem(AUTH_SERVER_STORAGE_KEY) ||
      devAutologin?.server ||
      DEFAULT_SERVER_URL
    );
  });
  const [confirmedServer, setConfirmedServer] = useState<string | null>(() => {
    if (desktop) return null;
    const initialServer =
      localStorage.getItem(AUTH_SERVER_STORAGE_KEY) || devAutologin?.server;
    return initialServer ? normalizeServerUrl(initialServer) : null;
  });
  const [username, setUsername] = useState(() => devAutologin?.username || "");
  const [password, setPassword] = useState(() => devAutologin?.password || "");
  const [useSso, setUseSso] = useState(false);
  const ssoPopupRef = useRef<Window | null>(null);
  const [serverStatus, setServerStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [backendServed, setBackendServed] = useState(false);
  /** Desktop: the stored profile being signed into (server/username locked). */
  const [signinProfile, setSigninProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [incompatibleOpen, setIncompatibleOpen] = useState(false);
  const [clientSettingsOpen, setClientSettingsOpen] = useState(false);
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [pendingPoll, setPendingPoll] = useState<
    (() => Promise<ActivationPollResult>) | null
  >(null);
  const [submitting, setSubmitting] = useState(false);

  // Force device theme on login page (visual only — never persisted, so a
  // reload here can't wipe the user's saved theme); restore the stored
  // preference on leave.
  useEffect(() => {
    const stored = getStoredTheme();
    applyTheme("system", false);
    return () => applyTheme(stored, false);
  }, []);

  // Desktop: start on the profile picker, or the sign-in form without profiles.
  const initialStepChosen = useRef(false);
  useEffect(() => {
    if (!desktop || !profiles.loaded || initialStepChosen.current) return;
    initialStepChosen.current = true;
    setStep(profiles.profiles.length ? "picker" : "signin");
  }, [desktop, profiles.loaded, profiles.profiles.length]);

  const basicAuthAvailable =
    serverStatus?.available_authentication_methods?.includes("basic") ?? true;
  const ssoAvailable =
    serverStatus?.available_authentication_methods?.includes("sso") ?? true;
  const noAuthAvailable = !basicAuthAvailable && !ssoAvailable;

  // Refs for focus trap
  const serverRef = useRef<HTMLInputElement | null>(null);
  const userRef = useRef<HTMLInputElement | null>(null);
  const passRef = useRef<HTMLInputElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Auto-focus server field on mount if not confirmed
    if (step === "signin" && !confirmedServer) {
      serverRef.current?.focus();
    }
  }, [confirmedServer, step]);

  useEffect(() => {
    let cancelled = false;
    detectBackendServedWebUi().then((served) => {
      if (cancelled) return;
      setBackendServed(served);
      if (served) {
        const origin = window.location.origin;
        setServer(origin);
        setConfirmedServer(normalizeServerUrl(origin));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!confirmedServer) {
      setServerStatus(null);
      setStatusError(false);
      return;
    }
    const normalized = normalizeServerUrl(confirmedServer);
    if (!normalized) {
      setServerStatus(null);
      return;
    }

    setStatusLoading(true);
    setStatusError(false);
    const controller = new AbortController();

    (async () => {
      try {
        // The confirmed server is the one being configured: its additional
        // request headers (desktop "Client Settings") apply from here on.
        if (desktop) await setServerContext(normalized);
        const res = await serverFetch(
          `${normalized}/api/status`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
          normalized,
        );
        if (res.ok) {
          const data = await res.json();
          setServerStatus(data);
        } else {
          setServerStatus(null);
          setStatusError(true);
        }
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setServerStatus(null);
          setStatusError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setStatusLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [confirmedServer, desktop]);

  useEffect(() => {
    if (serverStatus) {
      if (ssoAvailable && !basicAuthAvailable) {
        setUseSso(true);
      } else if (!ssoAvailable && basicAuthAvailable) {
        setUseSso(false);
      }
    }
  }, [serverStatus, ssoAvailable, basicAuthAvailable]);

  // Only consume a fragment callback in the tab that initiated the redirect.
  useEffect(() => {
    if (!ssoCallback || ssoCallbackConsumed.current) return;
    ssoCallbackConsumed.current = true;
    void (async () => {
      try {
        if (desktop)
          await loginWithTokens(ssoCallback.server, ssoCallback.tokens, {
            profileId: ssoCallback.profileId,
          });
        else await loginWithTokens(ssoCallback.server, ssoCallback.tokens);
        navigate("/library", { replace: true });
      } catch {
        // The URL is already scrubbed even if authentication fails.
      }
    })();
  }, [ssoCallback, loginWithTokens, navigate, desktop]);

  // Receive the tokens handed back by the SSO popup (web flow). Only trust a
  // message that originates from the configured server origin.
  useEffect(() => {
    const expectedServer = confirmedServer
      ? normalizeServerUrl(confirmedServer)
      : "";
    if (!expectedServer) return;
    const expectedOrigin = new URL(expectedServer).origin;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return;
      if (!ssoPopupRef.current || event.source !== ssoPopupRef.current) return;
      const data = event.data as
        | { type?: string; access_token?: string; refresh_token?: string }
        | undefined;
      if (!data || data.type !== "playstash:sso") return;
      const accessToken = data.access_token;
      if (typeof accessToken !== "string" || !accessToken) return;
      const refreshToken = data.refresh_token;
      if (refreshToken !== undefined && typeof refreshToken !== "string")
        return;
      ssoPopupRef.current = null;
      void (async () => {
        try {
          await loginWithTokens(expectedServer, {
            access_token: accessToken,
            refresh_token: refreshToken ?? undefined,
          });
          navigate("/library", { replace: true });
        } catch {
          // ignore - context will show error
        }
      })();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [confirmedServer, loginWithTokens, navigate]);

  const resetForm = useCallback(() => {
    setSigninProfile(null);
    setUsername("");
    setPassword("");
    setUseSso(false);
    setMessage(null);
  }, []);

  /** Runs a login; HTTP 406 switches to the pending-activation screen. */
  const runLogin = useCallback(
    async (attempt: () => Promise<unknown>) => {
      try {
        await attempt();
        navigate("/library", { replace: true });
        return true;
      } catch (e) {
        if (!isPendingActivationError(e)) throw e;
        setPendingPoll(() => async () => {
          try {
            await attempt();
            setPendingPoll(null);
            navigate("/library", { replace: true });
            return "activated" as const;
          } catch (retryError) {
            if (isPendingActivationError(retryError)) return "pending" as const;
            setPendingPoll(null);
            setStep(desktop && profiles.profiles.length ? "picker" : "signin");
            setMessage(
              retryError instanceof Error
                ? retryError.message
                : String(retryError),
            );
            return "failed" as const;
          }
        });
        setStep("pending");
        return false;
      }
    },
    [navigate, desktop, profiles.profiles.length],
  );

  const handleContinue = (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    if (!server.trim()) return;
    const normalized = normalizeServerUrl(server);
    if (!normalized) {
      setMessage(t("accounts.form.invalidServer"));
      return;
    }
    setMessage(null);
    setServer(normalized);
    setConfirmedServer(normalized);
  };

  const handleChangeServer = () => {
    setConfirmedServer(null);
    setServerStatus(null);
  };

  /** WPF ValidateSignInData. Returns an error message or null. */
  const validateSignIn = (forLogin: boolean): string | null => {
    const normalized = normalizeServerUrl(confirmedServer || server);
    if (!normalized) return t("accounts.form.serverRequired");
    if (
      desktop &&
      !signinProfile &&
      !useSso &&
      findDuplicateProfile(profiles.profiles, normalized, username)
    )
      return t("accounts.form.duplicate");
    if (forLogin && (statusError || !serverStatus))
      return t("accounts.form.unreachable");
    if (!useSso) {
      if (!username.trim()) return t("accounts.form.usernameRequired");
      if (forLogin && !password) return t("accounts.form.passwordRequired");
    }
    return null;
  };

  /** Desktop "Save": stores the profile without logging in. */
  const handleSaveOnly = async () => {
    const problem = validateSignIn(false);
    if (problem) {
      setMessage(problem);
      return;
    }
    try {
      await profiles.createProfile({
        serverUrl: normalizeServerUrl(confirmedServer || server),
        username,
        sso: useSso,
      });
      resetForm();
      setStep("picker");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const startSso = (normalized: string, profileId?: string) => {
    // Remember which server this login belongs to: the identity provider
    // redirects back to us and, in the desktop app, that lands on the app's
    // own origin, where the server URL cannot be derived from window.location.
    localStorage.setItem(AUTH_SERVER_STORAGE_KEY, normalized);
    const loginUrl = `${normalized}/api/auth/oauth2/login?client_origin=${encodeURIComponent(
      window.location.origin,
    )}`;
    // On the web, run the flow in a popup so the main window never
    // navigates away; the backend hands the tokens back via postMessage
    // instead of putting them in the URL. In the desktop app (and if the
    // popup is blocked) fall back to a full redirect — the backend returns
    // the window to our own origin, keeping the Tauri IPC / ACL intact.
    if (!isTauriApp() && window.location.origin === normalized) {
      const popup = window.open(
        loginUrl,
        "playstash-sso",
        "popup,width=520,height=680",
      );
      if (popup) {
        ssoPopupRef.current = popup;
        return;
      }
    }
    sessionStorage.setItem(SSO_PENDING_SERVER_KEY, normalized);
    if (profileId) sessionStorage.setItem(SSO_PENDING_PROFILE_KEY, profileId);
    window.location.href = loginUrl;
  };

  /** "Save and Login" (Enter). */
  const onSubmit = async (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    if (submitting) return;
    setMessage(null);
    const problem = validateSignIn(true);
    if (problem) {
      setMessage(problem);
      return;
    }
    const normalized = normalizeServerUrl(confirmedServer || server);
    // Version gate: the probe already fetched /api/status for this server.
    if (serverStatus && isServerVersionOutdated(serverStatus.version)) {
      setIncompatibleOpen(true);
      return;
    }
    if (useSso) {
      startSso(normalized, signinProfile?.id);
      return;
    }
    setSubmitting(true);
    try {
      let profileId = signinProfile?.id;
      if (desktop && !profileId) {
        // Like the WPF client the profile is saved first; a failed login
        // keeps it, so a retry signs into the same profile.
        const created = await profiles.createProfile({
          serverUrl: normalized,
          username,
          sso: false,
        });
        profileId = created.id;
        setSigninProfile(created);
      }
      await runLogin(() =>
        loginBasic(
          desktop
            ? { server: normalized, username, password, profileId }
            : { server: normalized, username, password },
        ),
      );
    } catch {
      // error handled in context
    } finally {
      setSubmitting(false);
    }
  };

  /** Desktop: open the sign-in form for a stored profile (password needed). */
  const openProfileSignin = (profile: Profile, reason?: string) => {
    setSigninProfile(profile);
    setServer(profile.serverUrl);
    setConfirmedServer(profile.serverUrl);
    setUsername(profile.username);
    setPassword("");
    setUseSso(profile.sso);
    setMessage(reason ?? null);
    setStep("signin");
  };

  const handleSelectProfile = async (profile: Profile) => {
    setBusyProfileId(profile.id);
    setMessage(null);
    try {
      await setServerContext(profile.serverUrl);
      if (await isServerOutdated(profile.serverUrl)) {
        setIncompatibleOpen(true);
        return;
      }
      try {
        await runLogin(() => loginStoredSession(profile.id));
      } catch (e) {
        if (e instanceof CredentialsRequiredError) {
          if (profile.sso) startSso(profile.serverUrl, profile.id);
          else openProfileSignin(profile, e.message);
          return;
        }
        setMessage(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusyProfileId(null);
    }
  };

  const handleDeleteProfile = async (profile: Profile) => {
    const name = profile.username || profile.serverUrl;
    const confirmed = await confirmAction({
      title: t("accounts.picker.deleteConfirm").replace("{name}", name),
      affirmativeText: t("accounts.common.yes"),
      negativeText: t("accounts.common.no"),
    });
    if (!confirmed) return;
    await profiles.deleteProfile(profile.id);
    if (profiles.profiles.length <= 1) {
      resetForm();
      setStep("signin");
    }
  };

  const handleImportConnection = async () => {
    setMessage(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [CONNECTION_FILE_FILTER],
      });
      if (!selected || Array.isArray(selected)) return;
      const { invoke } = await import("@tauri-apps/api/core");
      const text = await invoke<string>("fs_read_text_file", {
        path: selected,
      });
      const connection = parseConnectionFile(text);
      storePendingConnection(connection);
      setSigninProfile(null);
      setServer(connection.server_url);
      setConfirmedServer(connection.server_url);
      setStep("signin");
      setNotice(t("accounts.connection.imported"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleTrapKey: React.KeyboardEventHandler = (e) => {
    if (e.key !== "Tab") return;
    // Build current focusable list (skip disabled)
    const elems = [
      serverRef.current,
      userRef.current,
      passRef.current,
      submitRef.current,
    ].filter(
      (el): el is HTMLInputElement | HTMLButtonElement =>
        !!el && !(el as HTMLInputElement | HTMLButtonElement).disabled,
    );
    if (elems.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const currentIndex = elems.findIndex((el) => el === active);
    if (e.shiftKey) {
      // Shift+Tab on first -> go to last
      if (currentIndex === 0 || active == null) {
        e.preventDefault();
        elems[elems.length - 1]!.focus();
      }
    } else if (currentIndex === elems.length - 1) {
      // Tab on last -> go to first
      e.preventDefault();
      elems[0]!.focus();
    }
  };

  const dialogs = (
    <>
      <IncompatibleServerDialog
        open={incompatibleOpen}
        onClose={() => setIncompatibleOpen(false)}
      />
      {desktop && (
        <ClientSettingsDialog
          open={clientSettingsOpen}
          onClose={() => setClientSettingsOpen(false)}
          onSaved={(text) => showToast(text)}
        />
      )}
    </>
  );

  if (step === "loading") return <>{dialogs}</>;

  if (step === "pending" && pendingPoll) {
    return (
      <>
        {dialogs}
        <PendingActivation
          poll={pendingPoll}
          onCancel={() => {
            setPendingPoll(null);
            setStep(desktop && profiles.profiles.length ? "picker" : "signin");
          }}
        />
      </>
    );
  }

  if (step === "picker" && desktop) {
    return (
      <>
        {dialogs}
        <div className="grid w-full max-w-md grid-cols-1 gap-6">
          <div tabIndex={-1} aria-hidden="true">
            <Logo variant="brand" height="h-10 sm:h-14" gap="gap-3" />
          </div>
          {(message || error) && (
            <div
              className="rounded-2xl bg-red-500/10 px-3 py-2 text-sm text-red-500"
              role="alert"
            >
              {message || error}
            </div>
          )}
          <ProfilePicker
            profiles={profiles.profiles}
            rememberMe={profiles.rememberMe}
            busyProfileId={busyProfileId}
            onSelect={(profile) => void handleSelectProfile(profile)}
            onEdit={(profile) => {
              setEditing(profile);
              setStep("edit");
            }}
            onDelete={(profile) => void handleDeleteProfile(profile)}
            onNewProfile={() => {
              resetForm();
              setConfirmedServer(null);
              setStep("signin");
            }}
            onClientSettings={() => setClientSettingsOpen(true)}
            onRememberMeChange={(value) => void profiles.setRememberMe(value)}
          />
        </div>
      </>
    );
  }

  if (step === "edit" && desktop && editing) {
    return (
      <>
        {dialogs}
        <ProfileEditor
          profile={editing}
          onCancel={() => setStep("picker")}
          onSave={async (changes) => {
            await profiles.editProfile(editing.id, changes);
            setEditing(null);
            setStep("picker");
          }}
        />
      </>
    );
  }

  const shownError = message || error;
  const lockedProfile = desktop && !!signinProfile;

  return (
    <>
      {dialogs}
      <form
        onSubmit={confirmedServer ? onSubmit : handleContinue}
        onKeyDown={handleTrapKey}
        className="grid w-full max-w-sm grid-cols-1 gap-6"
      >
        <div tabIndex={-1} aria-hidden="true">
          <Logo variant="brand" height="h-10 sm:h-14" gap="gap-3" />
        </div>
        <div className="space-y-3">
          <Heading tabIndex={-1}>{t("accounts.signin.title")}</Heading>
          <Text>{t("accounts.signin.description")}</Text>
        </div>

        {notice && (
          <div
            className="rounded-2xl bg-ps-accent/10 px-3 py-2 text-sm text-ps-text"
            role="status"
          >
            {notice}
          </div>
        )}

        {!confirmedServer && !backendServed && (
          <div className="grid grid-cols-1 gap-6 animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none">
            <Field>
              <Label>{t("accounts.form.server")}</Label>
              <Input
                type="text"
                name="server"
                required
                value={server}
                onChange={(e) => setServer(e.target.value)}
                // Only trim whitespace on blur; do NOT auto-inject protocol into the visible field
                onBlur={() => setServer((s) => s.trim())}
                autoComplete="url"
                ref={serverRef}
                tabIndex={1}
                autoFocus
              />
            </Field>
            {message && (
              <Text className="-mt-4 text-xs text-rose-400" role="alert">
                {message}
              </Text>
            )}
            <Button type="submit" className="w-full">
              {t("accounts.form.continue")}
            </Button>
          </div>
        )}

        {confirmedServer && (
          <div className="grid grid-cols-1 gap-6 animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none">
            <Field>
              <Label>{t("accounts.form.server")}</Label>
              <div data-slot="control" className="flex gap-2">
                <Input
                  name="server_display"
                  value={confirmedServer}
                  disabled
                  className="flex-1"
                />
                {!backendServed && !lockedProfile && (
                  <Button
                    type="button"
                    outline
                    onClick={handleChangeServer}
                    className="shrink-0"
                  >
                    {t("accounts.form.change")}
                  </Button>
                )}
              </div>
            </Field>

            {statusLoading && <Text>{t("accounts.form.connecting")}</Text>}

            {statusError && (
              <Text className="text-xs text-rose-400 -mt-4">
                {t("accounts.form.connectFailed")}
              </Text>
            )}

            {!statusLoading && !statusError && (
              <>
                {basicAuthAvailable && !useSso && (
                  <Field>
                    <Label>{t("accounts.form.username")}</Label>
                    <Input
                      name="username"
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={lockedProfile}
                      ref={userRef}
                      tabIndex={2}
                    />
                  </Field>
                )}
                {basicAuthAvailable && !useSso && (
                  <Field>
                    <Label>{t("accounts.form.password")}</Label>
                    <Input
                      type="password"
                      name="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      ref={passRef}
                      tabIndex={3}
                      autoFocus={lockedProfile}
                    />
                  </Field>
                )}
                {ssoAvailable && basicAuthAvailable && !lockedProfile && (
                  <CheckboxField className="cursor-pointer select-none">
                    <Checkbox
                      id="login-sso"
                      name="useSso"
                      color="indigo"
                      className="cursor-pointer"
                      checked={useSso}
                      onChange={(checked: boolean) => setUseSso(!!checked)}
                    />
                    <Label htmlFor="login-sso" className="cursor-pointer">
                      {t("accounts.form.sso")}
                    </Label>
                  </CheckboxField>
                )}
                {noAuthAvailable && (
                  <div
                    className="rounded-2xl bg-rose-500/10 px-3 py-2 text-sm text-rose-500"
                    role="alert"
                  >
                    {t("accounts.form.noAuth")}
                  </div>
                )}
                {shownError && (
                  <div
                    className="-mt-2 rounded-2xl bg-red-500/10 px-3 py-2 text-sm text-red-500"
                    role="alert"
                  >
                    {shownError}
                  </div>
                )}
                {!noAuthAvailable && (
                  <div className="flex gap-3">
                    {desktop && !lockedProfile && (
                      <Button
                        type="button"
                        outline
                        className="flex-1"
                        disabled={loading || submitting}
                        onClick={() => void handleSaveOnly()}
                      >
                        {t("accounts.common.save")}
                      </Button>
                    )}
                    <Button
                      type="submit"
                      className="flex-1"
                      disabled={loading || submitting}
                      tabIndex={4}
                      ref={submitRef}
                    >
                      {loading || submitting
                        ? useSso
                          ? t("accounts.form.preparingSso")
                          : t("accounts.form.authenticating")
                        : useSso
                          ? t("accounts.form.continueSso")
                          : desktop && !lockedProfile
                            ? t("accounts.form.saveAndLogin")
                            : t("accounts.form.login")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {desktop && (
          <div className="flex flex-wrap gap-3">
            {profiles.profiles.length > 0 && (
              <Button
                type="button"
                plain
                onClick={() => {
                  resetForm();
                  setNotice(null);
                  setStep("picker");
                }}
              >
                {t("accounts.signin.backToProfiles")}
              </Button>
            )}
            <Button
              type="button"
              plain
              onClick={() => void handleImportConnection()}
            >
              {t("accounts.connection.import")}
            </Button>
            <Button
              type="button"
              plain
              onClick={() => setClientSettingsOpen(true)}
            >
              {t("accounts.clientSettings")}
            </Button>
          </div>
        )}

        <Text tabIndex={-1} aria-hidden="true">
          {t("accounts.signin.noAccount")}{" "}
          <TextLink href="/register" tabIndex={-1} aria-hidden="true">
            <Strong>{t("accounts.signin.signUp")}</Strong>
          </TextLink>
        </Text>
      </form>
    </>
  );
}
