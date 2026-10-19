import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import type { PlaystashUser, SavefileDto } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { getErrorMessage } from "@/utils/apiError";
import { formatBytes } from "@/utils/downloadFormat";
import { isTauriApp } from "@/utils/tauri";
import {
  formatTemplate,
  getInstallationId,
  getInstallationIds,
  listInstalledVersions,
  newestInstalledVersion,
} from "@/utils/cloudSaves";
import { Button } from "./tailwind/button";
import { Select } from "./tailwind/select";

const ADMIN_ROLE = 3;

interface UserOption {
  id: number;
  username: string;
}

function formatCreated(value: unknown): string {
  const date = new Date(value as string);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      });
}

/** The save versions stored for one user and game. */
async function fetchVersions(
  authFetch: (input: string, init?: RequestInit) => Promise<Response>,
  base: string,
  t: (key: TranslationKey) => string,
): Promise<SavefileDto[]> {
  const response = await authFetch(`${base}/versions`);
  if (!response.ok)
    throw new Error(
      await getErrorMessage(response, t("cloudSaves.versions.loadFailed")),
    );
  return (await response.json()) as SavefileDto[];
}

/**
 * Cloud save versions of a game (WPF "Cloud Save Versions"): admins pick any
 * user, everyone else sees their own archives. Works on web and desktop.
 */
export function GameSaves({
  gameId,
  gameTitle,
}: {
  gameId: number;
  gameTitle?: string;
}) {
  const { user, authFetch, serverUrl, getAccessToken } = useAuth();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  // `t` changes identity every render; effects read the latest one.
  const tRef = useRef(t);
  useLayoutEffect(() => {
    tRef.current = t;
  });
  const desktop = isTauriApp();
  const currentUserId = Number(user?.id ?? 0);
  const isAdmin = Number(user?.role) >= ADMIN_ROLE;
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(0);
  const [versions, setVersions] = useState<SavefileDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const apiBase = serverUrl.replace(/\/+$/, "");
  const base = selectedUserId
    ? `${apiBase}/api/savefiles/user/${selectedUserId}/game/${gameId}`
    : "";

  // Users: every user for admins, only the signed-in user otherwise. A new
  // session (or server) selects the signed-in user again.
  const username = user?.username ?? "";
  const [usersFor, setUsersFor] = useState<{
    apiBase: string;
    authFetch: typeof authFetch;
    currentUserId: number;
    isAdmin: boolean;
    username: string;
  } | null>(null);
  if (
    !usersFor ||
    usersFor.apiBase !== apiBase ||
    usersFor.authFetch !== authFetch ||
    usersFor.currentUserId !== currentUserId ||
    usersFor.isAdmin !== isAdmin ||
    usersFor.username !== username
  ) {
    setUsersFor({ apiBase, authFetch, currentUserId, isAdmin, username });
    if (!currentUserId) {
      setUsers([]);
      setSelectedUserId(0);
    } else {
      setSelectedUserId(currentUserId);
      if (!isAdmin) setUsers([{ id: currentUserId, username }]);
    }
  }

  useEffect(() => {
    if (!currentUserId || !isAdmin) return;
    const self: UserOption = { id: currentUserId, username };
    let cancelled = false;
    void (async () => {
      try {
        const response = await authFetch(`${apiBase}/api/users`);
        if (!response.ok)
          throw new Error(
            await getErrorMessage(
              response,
              tRef.current("cloudSaves.versions.usersFailed"),
            ),
          );
        const list = ((await response.json()) as PlaystashUser[])
          .filter((entry) => Number(entry?.id) > 0)
          .map((entry) => ({ id: Number(entry.id), username: entry.username }));
        if (!cancelled)
          setUsers(
            list.some((entry) => entry.id === currentUserId)
              ? list
              : [self, ...list],
          );
      } catch (cause) {
        if (!cancelled) {
          setUsers([self]);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, authFetch, currentUserId, isAdmin, username]);

  // The versions list follows the selected user; no user means no list.
  const [versionsFor, setVersionsFor] = useState<{
    base: string;
    authFetch: typeof authFetch;
  } | null>(null);
  if (
    !versionsFor ||
    versionsFor.base !== base ||
    versionsFor.authFetch !== authFetch
  ) {
    setVersionsFor({ base, authFetch });
    if (base) {
      setLoading(true);
    } else {
      setVersions([]);
      setLoading(false);
    }
  }
  // Only uses state setters, so it is stable and safe as an effect dependency.
  const showVersions = useCallback((list: SavefileDto[]) => {
    setVersions(Array.isArray(list) ? list : []);
    setSelected((current) =>
      list.some((version) => version.filename === current) ? current : null,
    );
    setError("");
  }, []);

  const load = async () => {
    if (!base) {
      setVersions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      showVersions(await fetchVersions(authFetch, base, tRef.current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    fetchVersions(authFetch, base, tRef.current)
      .then((list) => {
        if (!cancelled) showVersions(list);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base, authFetch, showVersions]);

  // Installation ids of this game on this device ("this device" marker).
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void listInstalledVersions()
      .then((installed) =>
        getInstallationIds(
          installed
            .filter((version) => version.gameId === gameId)
            .map((version) => version.versionDirectory),
        ),
      )
      .then((ids) => {
        if (!cancelled) setLocalIds(ids);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [desktop, gameId]);

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

  const selectedVersion = useMemo(
    () => versions.find((version) => version.filename === selected) ?? null,
    [versions, selected],
  );
  const versionUrl = (version: SavefileDto) =>
    `${base}/versions/${encodeURIComponent(version.filename)}`;

  const requireSelection = (): SavefileDto | null => {
    if (!selectedVersion) setStatus(t("cloudSaves.versions.selectFirst"));
    return selectedVersion;
  };

  const download = () => {
    const version = requireSelection();
    if (!version) return;
    void run(async () => {
      if (desktop) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({
          defaultPath: version.filename,
          filters: [
            {
              name: t("cloudSaves.versions.archiveFilter"),
              extensions: ["zip"],
            },
          ],
        });
        if (typeof path !== "string" || !path) return;
        const token = await getAccessToken();
        if (!token) throw new Error(t("cloudSaves.versions.signInAgain"));
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("download_to_file", {
          url: versionUrl(version),
          path,
          authHeader: `Bearer ${token}`,
        });
      } else {
        const response = await authFetch(versionUrl(version));
        if (!response.ok)
          throw new Error(
            await getErrorMessage(
              response,
              t("cloudSaves.versions.downloadFailed"),
            ),
          );
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = version.filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setStatus(t("cloudSaves.versions.downloaded"));
    });
  };

  const restoreToFolder = () => {
    const version = requireSelection();
    if (!version) return;
    void run(async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const directory = await open({
        directory: true,
        multiple: false,
        title: t("cloudSaves.versions.restoreFolderTitle"),
      });
      if (typeof directory !== "string") return;
      if (
        !(await showAlert({
          title: t("cloudSaves.versions.restoreConfirmTitle"),
          description: formatTemplate(t("cloudSaves.versions.restoreConfirm"), {
            folder: directory,
          }),
          affirmativeText: t("cloudSaves.versions.restoreConfirmAction"),
          negativeText: t("cloudSaves.versions.cancel"),
        }))
      )
        return;
      const token = await getAccessToken();
      if (!token) throw new Error(t("cloudSaves.versions.signInAgain"));
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_game_addon", {
        gameId,
        downloadUrl: versionUrl(version),
        accessToken: token,
        archiveName: version.filename,
        installationPath: directory,
        password: null,
        overwriteConfirmed: true,
      });
      setStatus(t("cloudSaves.versions.restored"));
    });
  };

  const remove = async () => {
    const version = requireSelection();
    if (!version) return;
    if (
      !(await showAlert({
        title: t("cloudSaves.versions.deleteTitle"),
        description: formatTemplate(t("cloudSaves.versions.deleteConfirm"), {
          filename: version.filename,
        }),
        affirmativeText: t("cloudSaves.versions.deleteAction"),
        negativeText: t("cloudSaves.versions.cancel"),
        tone: "danger",
      }))
    )
      return;
    await run(async () => {
      const response = await authFetch(versionUrl(version), {
        method: "DELETE",
      });
      if (!response.ok)
        throw new Error(
          await getErrorMessage(
            response,
            t("cloudSaves.versions.deleteFailed"),
          ),
        );
      await load();
    });
  };

  const upload = () => {
    if (!file || !base) return;
    void run(async () => {
      if (!file.name.toLowerCase().endsWith(".zip"))
        throw new Error(t("cloudSaves.versions.chooseZip"));
      const headers: Record<string, string> = {};
      if (desktop) {
        try {
          const newest = newestInstalledVersion(
            await listInstalledVersions(),
            gameId,
          );
          if (newest) {
            headers["X-Installation-Id"] = await getInstallationId(
              newest.versionDirectory,
            );
          }
        } catch {
          // Uploading without an installation id is still valid.
        }
      }
      const body = new FormData();
      body.append("file", file);
      const response = await authFetch(base, {
        method: "POST",
        body,
        headers,
      });
      if (!response.ok)
        throw new Error(
          await getErrorMessage(
            response,
            t("cloudSaves.versions.uploadFailed"),
          ),
        );
      await load();
      setFile(null);
      setStatus(t("cloudSaves.versions.uploaded"));
    });
  };

  const disabled = busy || loading;
  const summary = loading
    ? t("cloudSaves.versions.loading")
    : versions.length === 0
      ? t("cloudSaves.versions.empty")
      : formatTemplate(t("cloudSaves.versions.count"), { n: versions.length });

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        {gameTitle && (
          <h3 className="text-base font-semibold text-ps-text">
            {formatTemplate(t("cloudSaves.versions.title"), {
              title: gameTitle,
            })}
          </h3>
        )}
        <p className="text-sm text-ps-muted">
          {t("cloudSaves.versions.intro")}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-48 flex-1 text-sm text-ps-muted">
          {t("cloudSaves.versions.user")}
          <Select
            className="mt-1"
            name="cloudSaveUser"
            value={selectedUserId ? String(selectedUserId) : ""}
            disabled={!isAdmin || disabled}
            onChange={(event) => setSelectedUserId(Number(event.target.value))}
          >
            {users.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.username}
              </option>
            ))}
          </Select>
        </label>
        <Button outline disabled={disabled} onClick={() => void load()}>
          {t("cloudSaves.versions.refresh")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-ps-line">
        <table className="w-full min-w-120 text-left text-sm">
          <thead className="bg-ps-panel-soft text-xs uppercase tracking-wide text-ps-muted">
            <tr>
              <th className="w-10 px-3 py-2">
                <span className="sr-only">
                  {t("cloudSaves.versions.select")}
                </span>
              </th>
              <th className="px-3 py-2">{t("cloudSaves.versions.created")}</th>
              <th className="px-3 py-2">{t("cloudSaves.versions.archive")}</th>
              <th className="px-3 py-2">{t("cloudSaves.versions.size")}</th>
              <th className="px-3 py-2">
                {t("cloudSaves.versions.installation")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ps-line">
            {versions.map((version) => {
              const isSelected = version.filename === selected;
              const thisDevice =
                !!version.installation_id &&
                localIds.includes(version.installation_id);
              return (
                <tr
                  key={version.filename}
                  className={clsx(
                    "cursor-pointer",
                    isSelected ? "bg-ps-panel-soft" : "hover:bg-ps-panel-soft",
                  )}
                  onClick={() => setSelected(version.filename)}
                >
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name="cloudSaveVersion"
                      aria-label={version.filename}
                      checked={isSelected}
                      onChange={() => setSelected(version.filename)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {formatCreated(version.created_at)}
                  </td>
                  <td className="break-all px-3 py-2 font-medium">
                    {version.filename}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2 tabular-nums"
                    title={`${version.size} B`}
                  >
                    {formatBytes(version.size)}
                  </td>
                  <td className="break-all px-3 py-2 text-xs text-ps-muted">
                    {version.installation_id || "—"}
                    {thisDevice && (
                      <span className="ml-1 font-medium text-ps-accent">
                        ({t("cloudSaves.versions.thisDevice")})
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p role="status" className="text-sm text-ps-muted">
        {summary}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button outline disabled={disabled} onClick={download}>
          {t("cloudSaves.versions.download")}
        </Button>
        <Button outline disabled={disabled} onClick={() => void remove()}>
          {t("cloudSaves.versions.delete")}
        </Button>
        {desktop && (
          <Button outline disabled={disabled} onClick={restoreToFolder}>
            {t("cloudSaves.versions.restoreToFolder")}
          </Button>
        )}
      </div>

      <form
        className="space-y-3 rounded-xl bg-ps-panel-soft p-4"
        onSubmit={(event) => {
          event.preventDefault();
          upload();
        }}
      >
        <label className="block text-sm text-ps-muted">
          {t("cloudSaves.versions.uploadLabel")}
          <input
            type="file"
            accept=".zip,application/zip"
            className="mt-2 block w-full text-sm"
            disabled={busy || !base}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        <p className="text-xs text-ps-muted">
          {t("cloudSaves.versions.uploadHint")}
        </p>
        <Button color="indigo" type="submit" disabled={busy || !file || !base}>
          {t("cloudSaves.versions.upload")}
        </Button>
      </form>

      {busy && <p role="status">{t("cloudSaves.versions.working")}</p>}
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-red-400">{error}</p>
          <Button outline disabled={busy} onClick={() => void load()}>
            {t("cloudSaves.versions.reload")}
          </Button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
