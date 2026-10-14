import { useEffect, useState } from "react";
import {
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudIcon,
} from "@heroicons/react/24/outline";
import type { PlaystashGame } from "@/api";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { isTauriApp } from "@/utils/tauri";
import {
  CLOUD_SAVES_README_URL,
  backupCloudSave,
  buildCloudSaveRequest,
  cloudSaveMessageKey,
  cloudSaveSearchTitle,
  cloudSaveTone,
  formatTemplate,
  conflictDialog,
  matchCloudSaveTitle,
  restoreWithConflictPrompt,
  type CloudSaveOutcome,
} from "@/utils/cloudSaves";

/**
 * GameView row with manual cloud save restore/backup (WPF "Cloud Saves"
 * row). Shown on desktop for installed games Ludusavi knows (score > 0.9).
 */
export function CloudSaveRow({
  game,
  installed,
}: {
  game: PlaystashGame | null;
  installed: InstalledGameInfo | undefined;
}) {
  const { t } = useTranslation();
  const { serverUrl, user, getAccessToken } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { showAlert } = useAlertDialog();
  const [match, setMatch] = useState("");
  const [busy, setBusy] = useState<"restore" | "backup" | null>(null);
  const desktop = isTauriApp();
  const searchTitle = cloudSaveSearchTitle(game);
  const gameId = Number(game?.id ?? 0);
  const installationPath = installed?.installationDirectory ?? "";
  const isInstalled = Boolean(installed);

  useEffect(() => {
    if (!desktop || !gameId || !searchTitle || !isInstalled) {
      setMatch("");
      return;
    }
    let cancelled = false;
    matchCloudSaveTitle({ gameId, title: searchTitle, installationPath })
      .then((value) => {
        if (!cancelled) setMatch(value);
      })
      .catch(() => {
        if (!cancelled) setMatch("");
      });
    return () => {
      cancelled = true;
    };
  }, [desktop, gameId, searchTitle, installationPath, isInstalled]);

  if (!desktop || !installed || !match) return null;

  const notifyOutcome = (outcome: CloudSaveOutcome) => {
    const key = cloudSaveMessageKey(outcome);
    if (key) {
      void showAlert({ title: t(key), tone: cloudSaveTone(outcome.status) });
    }
  };
  const toast = (key: TranslationKey, tone: "info" | "warning" = "info") =>
    void showAlert({ title: t(key), tone });

  const request = async () => {
    const accessToken = await getAccessToken();
    if (!accessToken || !user?.id) return null;
    return buildCloudSaveRequest({
      gameId,
      versionDirectory: installed.versionDirectory,
      installationPath,
      title: searchTitle,
      serverUrl,
      userId: Number(user.id),
      accessToken,
    });
  };

  const restore = async () => {
    setBusy("restore");
    toast("cloudSaves.status.syncing");
    try {
      const payload = await request();
      if (!payload || !isOnline) {
        notifyOutcome({ status: "offline" });
        return;
      }
      const outcome = await restoreWithConflictPrompt(payload, {
        interactive: true,
        confirmUseCloud: (conflict) => showAlert(conflictDialog(conflict, t)),
      });
      notifyOutcome(outcome);
    } catch (error) {
      console.error("Cloud save restore failed:", error);
      notifyOutcome({ status: "restoreFailed" });
    } finally {
      setBusy(null);
    }
  };

  const backup = async () => {
    if (!isOnline) {
      notifyOutcome({ status: "offline" });
      return;
    }
    setBusy("backup");
    toast("cloudSaves.status.uploading");
    try {
      const payload = await request();
      notifyOutcome(
        payload ? await backupCloudSave(payload) : { status: "offline" },
      );
    } catch (error) {
      console.error("Cloud save backup failed:", error);
      notifyOutcome({ status: "backupFailed" });
    } finally {
      setBusy(null);
    }
  };

  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ps-text ring-1 ring-ps-line transition-colors hover:bg-ps-panel-soft disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="surface-panel flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3">
      <CloudIcon className="size-5 shrink-0 text-ps-accent" aria-hidden />
      <a
        href={CLOUD_SAVES_README_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-ps-accent hover:underline"
      >
        {t("cloudSaves.row.link")}
      </a>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy !== null}
          title={formatTemplate(t("cloudSaves.row.restoreTooltip"), { match })}
          onClick={() => void restore()}
        >
          <CloudArrowDownIcon className="size-4" aria-hidden />
          {t("cloudSaves.row.restore")}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy !== null}
          title={formatTemplate(t("cloudSaves.row.backupTooltip"), { match })}
          onClick={() => void backup()}
        >
          <CloudArrowUpIcon className="size-4" aria-hidden />
          {t("cloudSaves.row.backup")}
        </button>
      </div>
    </div>
  );
}
