import { Dialog, DialogBody, DialogTitle } from "@/components/tailwind/dialog";
import { Label } from "@headlessui/react";
import { Button } from "@tw/button";
import { useRef, useState } from "react";
import { useAlertDialog } from "../../context/AlertDialogContext";
import { useAuth } from "../../context/AuthContext";
import { useTranslation } from "@/i18n";
import { Field } from "../tailwind/fieldset";
import { Input } from "../tailwind/input";

interface BackupRestoreDialogProps {
  onClose: () => void;
}

type TabKey = "backup" | "restore";

const Backup = () => {
  const { serverUrl, authFetch } = useAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();

  const startBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password)
      return showAlert({
        title: t("admin.backup.noPassword.title"),
        description: t("admin.backup.noPassword.description"),
        affirmativeText: t("common.ok"),
      });

    setLoading(true);
    try {
      if (!serverUrl) return null;
      const base = serverUrl.replace(/\/+$/, "");
      const response = await authFetch(`${base}/api/admin/database/backup`, {
        method: "GET",
        headers: {
          "X-Database-Password": password,
        },
      });

      if (!response.ok) {
        throw new Error(
          ((await response.json()) as any).message ||
            t("admin.backup.backupFailedUnknown"),
        );
      }

      // Get filename from Content-Disposition header or default
      const disposition = response.headers.get("Content-Disposition");
      let filename = "backup.db";
      if (disposition) {
        const match = disposition.match(/filename="?(.+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const blob = await response.blob();

      // Trigger file download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      showAlert({
        title: t("admin.backup.backupFailed"),
        description: error.message,
        affirmativeText: t("common.ok"),
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
        <Input
          type="password"
          name="Database Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={loading || !password.length}>
        {loading ? t("admin.backup.backingUp") : t("admin.backup.startBackup")}
      </Button>
    </form>
  );
};

const Restore = () => {
  const { serverUrl, authFetch } = useAuth();
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const startRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file)
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

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);

      if (!serverUrl) return null;
      const base = serverUrl.replace(/\/+$/, "");
      const response = await authFetch(`${base}/api/admin/database/restore`, {
        method: "POST",
        headers: {
          "X-Database-Password": password,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(
          ((await response.json()) as any).message ||
            t("admin.backup.restoreFailedUnknown"),
        );
      }

      return showAlert({
        title: t("admin.backup.restored"),
        affirmativeText: t("common.ok"),
      });
    } catch (error: any) {
      showAlert({
        title: t("admin.backup.restoreFailed"),
        description: error.message,
        affirmativeText: t("common.ok"),
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
        <Input
          type="file"
          name="Backup File"
          required
          onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
          ref={fileInputRef}
        />
      </Field>
      <Field>
        <Label>{t("admin.backup.databasePassword")}</Label>
        <Input
          type="password"
          name="Database Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={loading || !password.length}>
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
