import { useCallback, useMemo, useState } from "react";
import { FolderOpenIcon, TrashIcon } from "@heroicons/react/24/outline";
import type { PlaystashGame } from "@/api/models/PlaystashGame";
import DiskUsageChart from "@/components/DiskUsageChart";
import { Button } from "@/components/tailwind/button";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useDiskUsage } from "@/hooks/useDiskUsage";
import { getRootPaths } from "@/utils/rootPaths";
import { uninstallInstalledGame } from "@/utils/uninstallInstalledGame";
import type { SettingsInstalledGame } from "./types";
import { useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

interface Props {
  installedGame: SettingsInstalledGame;
  game: PlaystashGame;
  /** Called after a successful uninstall. */
  onUninstalled: () => void;
}

/**
 * Game Settings → Installation: where the game lives, open the folder,
 * uninstall (through the shared uninstall path) and the disk usage chart.
 */
export function InstallationTab({ installedGame, game, onUninstalled }: Props) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const [uninstalling, setUninstalling] = useState(false);

  // Resolve the download location (root path) that contains this installed
  // game, so the disk-usage donut can show how much of that volume it uses.
  const diskUsageRoot = useMemo(() => {
    for (const root of getRootPaths()) {
      const rootPath = root.path;
      if (
        rootPath &&
        (installedGame.versionDirectory === rootPath ||
          installedGame.versionDirectory.startsWith(`${rootPath}/`) ||
          installedGame.versionDirectory.startsWith(`${rootPath}\\`))
      ) {
        return root;
      }
    }
    return null;
  }, [installedGame.versionDirectory]);
  const { data: diskUsageData, loading: diskUsageLoading } = useDiskUsage(
    diskUsageRoot?.path,
    installedGame.versionDirectory,
  );

  const handleOpenInstallationDirectory = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_file_explorer", {
        path: installedGame.installationDirectory,
      });
    } catch (error: any) {
      await showAlert({
        title: t("common.error"),
        description: error?.message || String(error),
        affirmativeText: t("common.ok"),
      });
    }
  }, [installedGame.installationDirectory, showAlert, t]);

  const handleUninstallGame = useCallback(async () => {
    setUninstalling(true);
    try {
      const uninstalled = await uninstallInstalledGame({
        gameId: installedGame.gameId,
        confirm: true,
        game,
        installed: installedGame,
      });
      if (uninstalled) onUninstalled();
    } finally {
      setUninstalling(false);
    }
  }, [game, installedGame, onUninstalled]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-ps-text">
          {t("game.installation.title")}
        </h3>
        <p className="mt-2 text-sm text-ps-muted">
          {t("game.installation.description")}
        </p>
      </div>

      <div className="rounded-xl border border-ps-line bg-ps-panel-soft p-4">
        <div className="text-sm font-medium text-ps-text">
          {t("game.installation.installedTo")}
        </div>
        <div className="mt-3 rounded-lg border border-ps-line bg-ps-panel px-3 py-2 font-mono text-xs text-ps-text">
          {installedGame.installationDirectory}
        </div>
        {installedGame.versionName && (
          <p className="mt-3 text-xs text-ps-muted">
            {fillTemplate(t("game.installation.installedVersion"), {
              version: installedGame.versionName,
            })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          color="zinc"
          onClick={handleOpenInstallationDirectory}
          disabled={uninstalling}
        >
          <FolderOpenIcon className="w-4 h-4" />
          {t("game.installation.openDirectory")}
        </Button>
        <Button
          color="rose"
          onClick={handleUninstallGame}
          disabled={uninstalling}
        >
          <TrashIcon className="w-4 h-4" />
          {uninstalling
            ? t("game.installation.uninstalling")
            : t("game.installation.uninstall")}
        </Button>
      </div>

      <DiskUsageChart
        data={diskUsageData}
        loading={diskUsageLoading}
        gameTitle={
          game.metadata?.title || game.title || installedGame.gameTitle
        }
        rootPath={diskUsageRoot?.path}
      />
    </div>
  );
}
