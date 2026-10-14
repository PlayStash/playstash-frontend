import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
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

export function ServerDiagnostics() {
  const { serverUrl, authFetch } = useAuth();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthState | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  /** `GET /api/status` (authenticated): status, uptime and health protocol. */
  const loadHealth = useCallback(async () => {
    if (!serverUrl) return;
    setHealthBusy(true);
    try {
      const response = await authFetch(`${serverUrl}/api/status`);
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, "Could not read the server status."),
        );
      const status = await response.json();
      setHealth({
        summary: formatMessage(t("admin.health.summary"), {
          status: String(status?.status ?? "?"),
          uptime: formatUptime(status?.uptime) ?? t("admin.health.unavailable"),
        }),
        protocol:
          status?.protocol !== undefined && status?.protocol !== null
            ? JSON.stringify(status.protocol, null, 2)
            : t("admin.health.noProtocol"),
      });
    } catch (cause) {
      setHealth({
        summary: cause instanceof Error ? cause.message : String(cause),
        protocol: t("admin.health.noProtocol"),
      });
    } finally {
      setHealthBusy(false);
    }
  }, [serverUrl, authFetch, t]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);
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
          await getErrorMessage(response, "Could not read server logs."),
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
        title: "Refresh all game metadata?",
        description:
          "This contacts configured metadata providers for the entire library. Manual metadata and mappings are preserved. Large libraries may take time and provider limits still apply.",
        affirmativeText: "Queue refresh",
        negativeText: "Cancel",
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
          await getErrorMessage(response, "Could not queue metadata refresh."),
        );
      const result = await response.json();
      setMessage(
        `Queued metadata refresh for ${result.queued_games} games. The server processes it in the background; refresh the logs to inspect progress.`,
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
        Inspect recent server logs or refresh provider metadata for the library.
        Logs are filtered by the server; review their contents before sharing
        them.
      </p>
      <div className="space-y-2 rounded-xl bg-ps-panel-soft p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="font-medium text-ps-text">
            {health?.summary ?? t("admin.health.loading")}
          </p>
          <Button
            outline
            disabled={healthBusy}
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
          {logs ? "Refresh logs" : "Read server logs"}
        </Button>
        <Button outline disabled={busy} onClick={() => void recache()}>
          Refresh all metadata
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-sm text-ps-muted">
          Working…
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
          aria-label="Recent server logs"
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
