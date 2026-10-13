import { useState } from "react";
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
export function ServerDiagnostics() {
  const { serverUrl, authFetch } = useAuth();
  const { showAlert } = useAlertDialog();
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
      setError(cause instanceof Error ? cause.message : String(cause));
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
          {!logs.length && <p>No recent log records.</p>}
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
