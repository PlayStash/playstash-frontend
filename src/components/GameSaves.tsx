import { useCallback, useEffect, useState } from "react";
import type { SavefileDto } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { getErrorMessage } from "@/utils/apiError";
import { formatBytes } from "@/utils/downloadFormat";
import { isTauriApp } from "@/utils/tauri";
import { Button } from "./tailwind/button";
export function GameSaves({ gameId }: { gameId: number }) {
  const { user, authFetch, serverUrl, getAccessToken } = useAuth();
  const { showAlert } = useAlertDialog();
  const [versions, setVersions] = useState<SavefileDto[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const base = `${serverUrl}/api/savefiles/user/${user?.id}/game/${gameId}`;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(`${base}/versions`);
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, "Could not load save archives."),
        );
      setVersions(await response.json());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [base, authFetch]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const downloadUrl = (version: SavefileDto) =>
    `${base}/versions/${encodeURIComponent(version.filename)}`;
  const download = (version: SavefileDto) =>
    run(async () => {
      const response = await authFetch(downloadUrl(version));
      if (!response.ok)
        throw new Error(
          await getErrorMessage(
            response,
            "Could not download the save archive.",
          ),
        );
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = version.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus("Save archive downloaded.");
    });
  const restore = (version: SavefileDto) =>
    run(async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const directory = await open({
        directory: true,
        multiple: false,
        title: "Choose the game's save folder",
      });
      if (typeof directory !== "string") return;
      if (
        !(await showAlert({
          title: "Restore this save archive?",
          description: `Files in ${directory} can be overwritten by this archive. Choose the game's actual save folder and keep a copy of files you want to retain.`,
          affirmativeText: "Restore and overwrite files",
          negativeText: "Cancel",
        }))
      )
        return;
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again to restore a save.");
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_game_addon", {
        gameId,
        downloadUrl: downloadUrl(version),
        accessToken: token,
        archiveName: version.filename,
        installationPath: directory,
        password: null,
        overwriteConfirmed: true,
      });
      setStatus("Save archive restored into the selected folder.");
    });
  const remove = async (version: SavefileDto) => {
    if (
      !(await showAlert({
        title: "Delete this save version?",
        description: `${version.filename} will be permanently removed from the server. Other save versions are retained.`,
        affirmativeText: "Delete save version",
        negativeText: "Keep version",
      }))
    )
      return;
    await run(async () => {
      const response = await authFetch(downloadUrl(version), {
        method: "DELETE",
      });
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, "Could not delete the save version."),
        );
      await load();
      setStatus("Save version deleted.");
    });
  };
  return (
    <section className="space-y-4">
      <p className="text-sm text-ps-muted">
        Your versioned ZIP save archives. Upload a ZIP containing paths relative
        to the game's save folder; restore only after choosing that folder.
      </p>
      <form
        className="space-y-3 rounded-xl bg-ps-panel-soft p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!file) return;
          void run(async () => {
            if (!file.name.toLowerCase().endsWith(".zip"))
              throw new Error("Choose a ZIP save archive.");
            const body = new FormData();
            body.append("file", file);
            const response = await authFetch(base, { method: "POST", body });
            if (!response.ok)
              throw new Error(
                await getErrorMessage(
                  response,
                  "Could not upload the save archive.",
                ),
              );
            await load();
            setFile(null);
            setStatus("New save version uploaded.");
          });
        }}
      >
        <label className="block text-sm text-ps-muted">
          ZIP save archive
          <input
            type="file"
            accept=".zip,application/zip"
            className="mt-2 block w-full text-sm"
            disabled={busy}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        <Button color="indigo" type="submit" disabled={busy || !file}>
          Upload new version
        </Button>
      </form>
      {loading && <p role="status">Loading save versions…</p>}
      {versions.map((version) => (
        <article
          key={version.filename}
          className="space-y-2 rounded-xl bg-ps-panel-soft p-4"
        >
          <p className="break-all font-medium">{version.filename}</p>
          <p className="text-xs text-ps-muted">
            {new Date(version.created_at).toLocaleString()} ·{" "}
            {formatBytes(version.size)}
            {version.installation_id
              ? ` · Installation ${version.installation_id}`
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              outline
              disabled={busy}
              onClick={() => void download(version)}
            >
              Download
            </Button>
            {isTauriApp() && (
              <Button
                outline
                disabled={busy}
                onClick={() => void restore(version)}
              >
                Restore to save folder
              </Button>
            )}
            <Button
              outline
              disabled={busy}
              onClick={() => void remove(version)}
            >
              Delete version
            </Button>
          </div>
        </article>
      ))}
      {!loading && !versions.length && !error && (
        <p className="text-ps-muted">No save archives uploaded yet.</p>
      )}
      {busy && <p role="status">Working on your save archive…</p>}
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-red-400">{error}</p>
          <Button outline disabled={busy} onClick={() => void load()}>
            Reload save versions
          </Button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
