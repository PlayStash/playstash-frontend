import { useEffect, useState } from "react";
import {
  translate,
  useTranslation,
  type Locale,
  type TranslationKey,
} from "@/i18n";
import { formatMessage } from "@/utils/formatMessage";
import { formatUptime } from "@/utils/adminExtras";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { getErrorMessage } from "@/utils/apiError";
import { Button } from "../tailwind/button";
interface LogRecord {
  level: string;
  context?: string;
  timestamp?: string;
  message: string;
}
interface HealthState {
  summary: string;
  protocol: string;
}

/** `GET /api/status` (authenticated): status, uptime and health protocol. */
async function fetchHealth(
  serverUrl: string,
  authFetch: (input: string, init?: RequestInit) => Promise<Response>,
  locale: Locale,
): Promise<HealthState> {
  const tr = (key: TranslationKey) => translate(key, locale);
  try {
    const response = await authFetch(`${serverUrl}/api/status`);
    if (!response.ok)
      throw new Error(
        await getErrorMessage(response, tr("admin.diagnostics.statusFailed")),
      );
    const status = await response.json();
    return {
      summary: formatMessage(tr("admin.health.summary"), {
        status: String(status?.status ?? "?"),
        uptime: formatUptime(status?.uptime) ?? tr("admin.health.unavailable"),
      }),
      protocol:
        status?.protocol !== undefined && status?.protocol !== null
          ? JSON.stringify(status.protocol, null, 2)
          : tr("admin.health.noProtocol"),
    };
  } catch (cause) {
    return {
      summary: cause instanceof Error ? cause.message : String(cause),
      protocol: tr("admin.health.noProtocol"),
    };
  }
}

export function ServerDiagnostics() {
  const { serverUrl, authFetch } = useAuth();
  const { showAlert } = useAlertDialog();
  const { t, locale } = useTranslation();
  const [health, setHealth] = useState<HealthState | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  const loadHealth = async () => {
    if (!serverUrl) return;
    setHealthBusy(true);
    try {
      setHealth(await fetchHealth(serverUrl, authFetch, locale));
    } finally {
      setHealthBusy(false);
    }
  };

  // Initial (and server/session/language change) load; the result is only
  // stored from the async callback.
  useEffect(() => {
    if (!serverUrl) return;
    let active = true;
    void fetchHealth(serverUrl, authFetch, locale).then((next) => {
      if (active) setHealth(next);
    });
    return () => {
      active = false;
    };
  }, [serverUrl, authFetch, locale]);
  // Until the first status arrives the refresh button stays disabled.
  const healthPending = healthBusy || (!!serverUrl && health === null);
  const [logs, setLogs] = useState<LogRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const loadLogs = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await authFetch(`${serverUrl}/api/admin/logs`);
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, t("admin.diagnostics.logsFailed")),
        );
      setLogs(await response.json());
    } catch (cause) {
      setError(
        formatMessage(t("admin.logs.unavailable"), {
          msg: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  const recache = async () => {
    if (
      !(await showAlert({
        title: t("admin.diagnostics.recache.title"),
        description: t("admin.diagnostics.recache.description"),
        affirmativeText: t("admin.diagnostics.recache.confirm"),
        negativeText: t("common.cancel"),
      }))
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await authFetch(`${serverUrl}/api/metadata/recache`, {
        method: "POST",
      });
      if (!response.ok)
        throw new Error(
          await getErrorMessage(
            response,
            t("admin.diagnostics.recache.failed"),
          ),
        );
      const result = await response.json();
      setMessage(
        formatMessage(t("admin.diagnostics.recache.queued"), {
          count: result.queued_games,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4">
      <p className="text-sm text-ps-muted">
        {t("admin.diagnostics.description")}
      </p>
      <div className="space-y-2 rounded-xl bg-ps-panel-soft p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="font-medium text-ps-text">
            {health?.summary ?? t("admin.health.loading")}
          </p>
          <Button
            outline
            disabled={healthPending}
            onClick={() => void loadHealth()}
          >
            {t("admin.health.refresh")}
          </Button>
        </div>
        <details>
          <summary className="cursor-pointer text-ps-muted">
            {t("admin.health.protocol")}
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ps-text">
            {health?.protocol ?? ""}
          </pre>
        </details>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button outline disabled={busy} onClick={() => void loadLogs()}>
          {logs
            ? t("admin.diagnostics.refreshLogs")
            : t("admin.diagnostics.readLogs")}
        </Button>
        <Button outline disabled={busy} onClick={() => void recache()}>
          {t("admin.diagnostics.refreshMetadata")}
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-sm text-ps-muted">
          {t("admin.diagnostics.working")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-ps-muted">
          {message}
        </p>
      )}
      {logs && (
        <div
          className="max-h-96 space-y-3 overflow-auto rounded-xl bg-ps-panel-soft p-4 text-xs"
          aria-label={t("admin.diagnostics.logsLabel")}
        >
          {!logs.length && <p>{t("admin.logs.empty")}</p>}
          {logs.map((record, index) => (
            <article key={index}>
              <p className="text-ps-muted">
                {record.timestamp || ""} · {record.level}
                {record.context ? ` · ${record.context}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">
                {record.message}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
