import { Button } from "@/components/tailwind/button";
import { Badge } from "@/components/tailwind/badge";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { useDownloads, type ActiveDownload } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { TransferMeter } from "./TransferMeter";
import type { PlaystashGameTypeEnum as GameType } from "@/api/models/PlaystashGame";
import {
  ClipboardDocumentIcon,
  ComputerDesktopIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { formatDecimal } from "@/utils/number";
import { Switch } from "@tw/switch";
import { useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import {
  getCreateDesktopShortcutEnabled,
  setCreateDesktopShortcutEnabled,
} from "@/utils/downloadPreferences";
import {
  FORCE_INSTALL_TYPES,
  formatGameTypeLabel,
  type InstallCardState,
} from "./install-utils";

type InstallFlowProps = {
  download: ActiveDownload;
  installState: InstallCardState;
  onUpdate: (patch: Partial<InstallCardState>) => void;
  onClose: () => void;
  onSetUndetectedMode: () => void;
  onForceInstall: () => void;
};

export function InstallFlow({
  download,
  installState,
  onUpdate,
  onClose,
  onSetUndetectedMode,
  onForceInstall,
}: Readonly<InstallFlowProps>) {
  const {
    copyInstallationFiles,
    launchInstallationExecutable,
    confirmInstallOverwrite,
  } = useDownloads();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const [createShortcut, setCreateShortcut] = useState(
    getCreateDesktopShortcutEnabled,
  );

  const handleCreateShortcutChange = (enabled: boolean) => {
    setCreateShortcut(enabled);
    setCreateDesktopShortcutEnabled(enabled);
  };

  /** Installs after the "already installed" check. */
  const startInstall = async (run: () => Promise<void>) => {
    if (!(await confirmInstallOverwrite(download.gameId))) return;
    await run();
  };

  const gameTypeLabel = formatGameTypeLabel(
    installState.mode === "undetected"
      ? installState.forcedType
      : download.gameType || installState.forcedType,
  );
  const installationBusy =
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running";

  const copyProgressText =
    download.installationProgress !== null &&
    download.installationProgress !== undefined
      ? `${formatDecimal(download.installationProgress, 1)}%`
      : t("downloads.detail.inProgress");

  const handleCopyInstallPath = async (path?: string) => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      await showAlert({ title: t("pipeline.install.copiedDirectory") });
    } catch {
      await showAlert({
        title: t("downloads.install.copyPathFailed"),
        description: path,
      });
    }
  };

  // On Linux, Windows installers run under wine/umu where the install
  // directory must be a Windows path (drive X: maps to $HOME). Resolve it so
  // the user pastes a path the installer can actually use.
  const isLinux =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Linux");
  const [windowsInstallPath, setWindowsInstallPath] = useState("");
  const windowsPathResolvedRef = useRef(false);

  useEffect(() => {
    if (!isLinux || installState.mode !== "setup") return;
    if (!download.installationDirectory || windowsPathResolvedRef.current)
      return;
    windowsPathResolvedRef.current = true;
    import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<string>("resolve_windows_install_path", {
          installationPath: download.installationDirectory,
        }),
      )
      .then(setWindowsInstallPath)
      .catch(() => {});
  }, [isLinux, installState.mode, download.installationDirectory]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ComputerDesktopIcon
            className="size-5 shrink-0 text-ps-accent"
            aria-hidden="true"
          />
          <span className="truncate text-sm font-semibold text-ps-text">
            {t("downloads.step.installation")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge color="indigo">{gameTypeLabel}</Badge>
          {download.installationStatus === "running" && (
            <Badge color="blue">{t("downloads.detail.running")}</Badge>
          )}
          {download.installationStatus === "copying" && (
            <Badge color="blue">{t("downloads.detail.copying")}</Badge>
          )}
          <Button plain onClick={onSetUndetectedMode}>
            <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
            {t("common.edit")}
          </Button>
        </div>
      </div>

      {installState.mode === "portable" && (
        <div className="space-y-4">
          <p className="text-sm text-ps-muted">
            {t("downloads.install.portableHint")}
          </p>

          {download.installationStatus === "copying" && (
            <TransferMeter
              label={t("downloads.install.copyProgress")}
              value={download.installationProgress}
              valueText={copyProgressText}
              currentFile={download.installationCurrentFile}
            />
          )}
        </div>
      )}

      {installState.mode === "setup" && (
        <div className="space-y-4">
          <ol className="list-decimal space-y-1.5 pl-4 text-sm text-ps-muted marker:text-ps-muted">
            <li>{t("downloads.install.setupStep1")}</li>
          </ol>

          <Listbox
            value={installState.selectedInstaller}
            onChange={(value) =>
              onUpdate({ selectedInstaller: String(value || "") })
            }
            placeholder={
              installState.loadingInstallers
                ? t("downloads.install.scanning")
                : t("downloads.install.selectInstaller")
            }
            aria-label={t("downloads.install.installerExecutable")}
            disabled={installState.loadingInstallers}
          >
            {installState.installerOptions.map((option) => (
              <ListboxOption key={option} value={option}>
                <ListboxLabel>{option}</ListboxLabel>
              </ListboxOption>
            ))}
          </Listbox>

          <ol
            start={2}
            className="list-decimal space-y-1.5 pl-4 text-sm text-ps-muted marker:text-ps-muted"
          >
            <li>{t("downloads.install.setupStep2")}</li>
            <li>{t("downloads.install.setupStep3")}</li>
            <li>{t("downloads.install.setupStep4")}</li>
          </ol>

          <div className="surface-panel-soft rounded-md p-3">
            {windowsInstallPath ? (
              <div className="space-y-2">
                <p className="text-xs text-ps-muted">
                  {t("downloads.install.enterPath")}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <p
                    className="min-w-0 flex-1 truncate font-mono text-sm text-ps-text"
                    title={windowsInstallPath}
                  >
                    {windowsInstallPath}
                  </p>
                  <Button
                    color="indigo"
                    title={t("pipeline.install.copyToClipboard")}
                    onClick={() =>
                      void handleCopyInstallPath(windowsInstallPath)
                    }
                  >
                    <ClipboardDocumentIcon
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    {t("downloads.install.copyPath")}
                  </Button>
                </div>
                <p
                  className="truncate font-mono text-xs text-ps-muted"
                  title={download.installationDirectory}
                >
                  {fillTemplate(t("downloads.install.onDisk"), {
                    path: download.installationDirectory ?? "",
                  })}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p
                  className="min-w-0 flex-1 truncate font-mono text-xs text-ps-muted"
                  title={download.installationDirectory}
                >
                  {download.installationDirectory ||
                    t("downloads.install.noPath")}
                </p>
                <Button
                  color="zinc"
                  title={t("pipeline.install.copyToClipboard")}
                  onClick={() =>
                    void handleCopyInstallPath(download.installationDirectory)
                  }
                  disabled={!download.installationDirectory}
                >
                  <ClipboardDocumentIcon
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  {t("downloads.install.copyPath")}
                </Button>
              </div>
            )}
          </div>

          {installState.installerLoadError && (
            <p className="text-xs text-ps-danger [overflow-wrap:anywhere]">
              {installState.installerLoadError}
            </p>
          )}
        </div>
      )}

      {installState.mode === "undetected" && (
        <div className="space-y-4">
          <p className="text-sm text-ps-muted">
            {t("downloads.install.undetectedHint")}
          </p>

          <Listbox
            value={installState.forcedType}
            onChange={(value) => onUpdate({ forcedType: value as GameType })}
            aria-label={t("downloads.install.forcedType")}
          >
            {FORCE_INSTALL_TYPES.map((option) => (
              <ListboxOption key={option.value} value={option.value}>
                <ListboxLabel>{t(option.label)}</ListboxLabel>
              </ListboxOption>
            ))}
          </Listbox>
        </div>
      )}

      {download.installationError && (
        <div className="text-xs text-ps-danger [overflow-wrap:anywhere]">
          {download.installationError}
        </div>
      )}

      {installState.mode !== "undetected" && !installationBusy && (
        <label className="flex items-center justify-between gap-3 text-sm text-ps-text">
          <span>{t("pipeline.install.createShortcut")}</span>
          <Switch
            color="indigo"
            name="createDesktopShortcut"
            aria-label={t("pipeline.install.createShortcut")}
            checked={createShortcut}
            onChange={handleCreateShortcutChange}
          />
        </label>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button color="zinc" onClick={onClose}>
          {t("common.cancel")}
        </Button>

        <div className="flex items-center gap-2">
          {download.installationStatus === "running" && (
            <span className="text-xs font-medium text-ps-accent">
              {t("downloads.detail.running")}
            </span>
          )}

          {installState.mode === "portable" && (
            <Button
              color="indigo"
              onClick={() =>
                void startInstall(() => copyInstallationFiles(download.gameId))
              }
              disabled={installationBusy}
            >
              {download.installationStatus === "copying"
                ? t("downloads.action.installing")
                : t("common.install")}
            </Button>
          )}

          {installState.mode === "setup" && (
            <Button
              color="indigo"
              onClick={() =>
                void startInstall(() =>
                  launchInstallationExecutable(
                    download.gameId,
                    installState.selectedInstaller,
                  ),
                )
              }
              disabled={
                installationBusy ||
                installState.loadingInstallers ||
                !installState.selectedInstaller
              }
            >
              {download.installationStatus === "launching"
                ? t("downloads.install.launching")
                : t("common.install")}
            </Button>
          )}

          {installState.mode === "undetected" && (
            <Button color="indigo" onClick={onForceInstall}>
              {t("downloads.install.force")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
