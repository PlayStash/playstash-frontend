import { Dialog, DialogBody, DialogTitle } from "@/components/tailwind/dialog";
import { Button } from "@tw/button";
import { Description, Field, Label } from "@tw/fieldset";
import { useState } from "react";
import { useAlertDialog } from "../../context/AlertDialogContext";
import { useAuth } from "../../context/AuthContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { Input } from "../tailwind/input";
import { getErrorMessage } from "@/utils/apiError";
import { fillTemplate } from "@/utils/downloadPipeline";
import { serverFetch } from "@/utils/serverFetch";
import { isTauriDesktop } from "@/utils/tauri";
import {
  backupFileName,
  DATABASE_BACKUP_EXTENSION,
  DATABASE_BACKUP_PATH,
  DATABASE_PASSWORD_HEADER,
  DATABASE_RESTORE_FIELD,
  DATABASE_RESTORE_PATH,
  defaultBackupFileName,
  httpStatusOf,
  serverMessageOf,
} from "@/utils/databaseBackup";

interface BackupRestoreDialogProps {
  onClose: () => void;
}

type TabKey = "backup" | "restore";
type Translate = (key: TranslationKey) => string;

/** A failed backup/restore request: HTTP status and backend message. */
class TransferError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** User-facing message for a failed backup or restore. */
function describeFailure(
  error: unknown,
  t: Translate,
  fallback: TranslationKey,
): string {
  const status =
    error instanceof TransferError ? error.status : httpStatusOf(error);
  const message =
    error instanceof TransferError ? error.message : serverMessageOf(error);
  if (status === 401) return t("admin.backup.wrongPassword");
  if (status === 403) return t("admin.backup.forbidden");
  if (status === null && error instanceof TypeError)
    return fillTemplate(t("admin.backup.networkError"), {
      message: error.message,
    });
  return message || t(fallback);
}

function useDatabaseTransfer() {
  const { serverUrl, getAccessToken } = useAuth();
  const { t } = useTranslation();

  /** Server URL of an endpoint and the headers every request carries. */
  const prepare = async (path: string, password: string) => {
    if (!serverUrl) throw new Error(t("admin.backup.signInAgain"));
    const token = await getAccessToken();
    if (!token) throw new Error(t("admin.backup.signInAgain"));
    return {
      url: `${serverUrl.replace(/\/+$/, "")}${path}`,
      server: serverUrl,
      authHeader: `Bearer ${token}`,
      password,
    };
  };

  // Not `authFetch`: a wrong database password answers 401, which must not
  // be mistaken for an expired session (that would sign the admin out).
  const request = async (
    path: string,
    password: string,
    init: RequestInit,
    fallback: TranslationKey,
  ) => {
    const target = await prepare(path, password);
    const headers = new Headers(init.headers);
    headers.set("Authorization", target.authHeader);
    headers.set(DATABASE_PASSWORD_HEADER, password);
    headers.set("Accept", "*/*");
    const response = await serverFetch(
      target.url,
      { ...init, headers, redirect: "error" },
      target.server,
    );
    if (!response.ok)
      throw new TransferError(
        response.status,
        await getErrorMessage(response, t(fallback)),
      );
    return response;
  };

  return { prepare, request };
}

const Backup = () => {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const { prepare, request } = useDatabaseTransfer();
  const desktop = isTauriDesktop();

  const startBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password)
      return showAlert({
        title: t("admin.backup.noPassword.title"),
        description: t("admin.backup.noPassword.description"),
        affirmativeText: t("common.ok"),
      });

    setResult(null);
    try {
      if (desktop) {
        // Desktop: pick the target first, then stream the backup into it.
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({
          title: t("admin.backup.saveDialogTitle"),
          defaultPath: defaultBackupFileName(),
          filters: [
            {
              name: t("admin.backup.fileFilter"),
              extensions: [DATABASE_BACKUP_EXTENSION],
            },
          ],
        });
        if (typeof path !== "string" || !path) return;
        setLoading(true);
        const target = await prepare(DATABASE_BACKUP_PATH, password);
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke<number>("database_backup_download", {
          url: target.url,
          path,
          authHeader: target.authHeader,
          password,
        });
        setResult(fillTemplate(t("admin.backup.saved"), { path }));
      } else {
        setLoading(true);
        const response = await request(
          DATABASE_BACKUP_PATH,
          password,
          { method: "GET" },
          "admin.backup.backupFailedUnknown",
        );
        const filename = backupFileName(
          response.headers.get("Content-Disposition"),
        );
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setResult(fillTemplate(t("admin.backup.downloaded"), { filename }));
      }
    } catch (error) {
      await showAlert({
        title: t("admin.backup.backupFailed"),
        description: describeFailure(
          error,
          t,
          "admin.backup.backupFailedUnknown",
        ),
        affirmativeText: t("common.ok"),
        tone: "danger",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={startBackup}>
      <p>{t("admin.backup.backupDescription")}</p>
      <Field>
        <Label>{t("admin.backup.databasePassword")}</Label>
        <Description>{t("admin.backup.passwordHint")}</Description>
        <Input
          type="password"
          name="backup-database-password"
          autoComplete="off"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={loading || !password.length}>
        {loading ? t("admin.backup.backingUp") : t("admin.backup.startBackup")}
      </Button>
      {result && (
        <p role="status" className="text-sm break-all text-ps-success">
          {result}
        </p>
      )}
    </form>
  );
};

/** The backup to restore: a file on disk (desktop) or a browser `File`. */
type RestoreSource = { name: string; path?: string; file?: File };

const Restore = () => {
  const [password, setPassword] = useState("");
  const [source, setSource] = useState<RestoreSource | null>(null);
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const { prepare, request } = useDatabaseTransfer();
  const desktop = isTauriDesktop();

  const chooseDesktopFile = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: t("admin.backup.fileFilter"),
          extensions: [DATABASE_BACKUP_EXTENSION],
        },
      ],
    });
    if (typeof path !== "string" || !path) return;
    setSource({ name: path.split(/[\\/]/).pop() || path, path });
  };

  const startRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!source)
      return showAlert({
        title: t("admin.backup.noFile.title"),
        description: t("admin.backup.noFile.description"),
        affirmativeText: t("common.ok"),
      });
    if (!password)
      return showAlert({
        title: t("admin.backup.noPassword.title"),
        description: t("admin.backup.noPassword.description"),
        affirmativeText: t("common.ok"),
      });

    const confirmed = await showAlert({
      title: t("admin.backup.confirmRestore.title"),
      description: fillTemplate(t("admin.backup.confirmRestore.description"), {
        file: source.name,
      }),
      affirmativeText: t("admin.backup.confirmRestore.action"),
      negativeText: t("common.cancel"),
      tone: "danger",
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      if (source.path) {
        const target = await prepare(DATABASE_RESTORE_PATH, password);
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("database_backup_restore", {
          url: target.url,
          path: source.path,
          authHeader: target.authHeader,
          password,
        });
      } else if (source.file) {
        const formData = new FormData();
        formData.append(DATABASE_RESTORE_FIELD, source.file, source.file.name);
        await request(
          DATABASE_RESTORE_PATH,
          password,
          { method: "POST", body: formData },
          "admin.backup.restoreFailedUnknown",
        );
      }

      await showAlert({
        title: t("admin.backup.restored"),
        description: t("admin.backup.restoredDescription"),
        affirmativeText: t("common.ok"),
      });
    } catch (error) {
      await showAlert({
        title: t("admin.backup.restoreFailed"),
        description: describeFailure(
          error,
          t,
          "admin.backup.restoreFailedUnknown",
        ),
        affirmativeText: t("common.ok"),
        tone: "danger",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={startRestore}>
      <p>{t("admin.backup.restoreDescription")}</p>
      <Field>
        <Label>{t("admin.backup.file")}</Label>
        {desktop ? (
          <div className="mt-2 flex items-center gap-3">
            <Button
              type="button"
              outline
              onClick={() => void chooseDesktopFile()}
            >
              {t("admin.backup.chooseFile")}
            </Button>
            <span className="min-w-0 truncate text-sm text-ps-muted">
              {source?.name ?? t("admin.backup.noFileChosen")}
            </span>
          </div>
        ) : (
          <Input
            type="file"
            name="backup-file"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setSource(file ? { name: file.name, file } : null);
            }}
          />
        )}
      </Field>
      <Field>
        <Label>{t("admin.backup.databasePassword")}</Label>
        <Description>{t("admin.backup.passwordHint")}</Description>
        <Input
          type="password"
          name="restore-database-password"
          autoComplete="off"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        color="red"
        disabled={loading || !password.length || !source}
      >
        {loading ? t("admin.backup.restoring") : t("admin.backup.startRestore")}
      </Button>
    </form>
  );
};

export function BackupRestoreDialog({ onClose }: BackupRestoreDialogProps) {
  const [tab, setTab] = useState<TabKey>("backup");
  const { t } = useTranslation();

  return (
    <Dialog
      open
      onClose={onClose}
      size="3xl"
      className="!h-[min(70vh,650px)] flex flex-col"
    >
      <DialogTitle className="flex items-center justify-between gap-4 pb-1">
        <span>{t("admin.backup.title")}</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-ps-line text-ps-muted hover:text-ps-text hover:bg-ps-panel-soft"
          aria-label={t("common.close")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
          >
            <path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" />
            <path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" />
          </svg>
        </button>
      </DialogTitle>
      <div className="px-6 mt-1 flex gap-2 border-b border-ps-line text-sm">
        <button
          type="button"
          onClick={() => setTab("backup")}
          className={
            "px-3 py-2 border-b-2 transition-colors " +
            (tab === "backup"
              ? "border-ps-accent text-ps-accent"
              : "border-transparent text-ps-muted hover:text-ps-text")
          }
        >
          {t("admin.backup.tab.backup")}
        </button>
        <button
          type="button"
          onClick={() => setTab("restore")}
          className={
            "px-3 py-2 border-b-2 transition-colors " +
            (tab === "restore"
              ? "border-ps-accent text-ps-accent"
              : "border-transparent text-ps-muted hover:text-ps-text")
          }
        >
          {t("admin.backup.tab.restore")}
        </button>
      </div>
      <DialogBody className="pt-4 overflow-y-auto flex-1 min-h-0">
        {tab === "backup" ? <Backup /> : <Restore />}
      </DialogBody>
    </Dialog>
  );
}

export default BackupRestoreDialog;
