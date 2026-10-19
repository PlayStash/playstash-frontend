import { Input } from "@tw/input";
import type { ActiveDownload } from "@/context/DownloadContext";
import { TransferMeter } from "./TransferMeter";
import { InstallFlow } from "./InstallFlow";
import type { InstallCardState } from "./install-utils";
import { ExclamationTriangleIcon, KeyIcon } from "@heroicons/react/24/outline";
import { formatDecimal } from "@/utils/number";
import { useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

type PhaseDetailProps = {
  download: ActiveDownload;
  isTauri: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  installState: InstallCardState | null;
  onUpdateInstallState: (patch: Partial<InstallCardState>) => void;
  onCloseInstallView: () => void;
  onSetUndetectedMode: () => void;
  onForceInstall: () => void;
};

function ErrorNote({ message }: Readonly<{ message: string }>) {
  return (
    <div className="flex items-start gap-2 text-xs text-ps-danger">
      <ExclamationTriangleIcon
        className="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
    </div>
  );
}

export function PhaseDetail({
  download,
  isTauri,
  password,
  onPasswordChange,
  installState,
  onUpdateInstallState,
  onCloseInstallView,
  onSetUndetectedMode,
  onForceInstall,
}: Readonly<PhaseDetailProps>) {
  const { t } = useTranslation();
  const isDownloadingOrPaused =
    download.status === "downloading" || download.status === "paused";
  const isFailed = download.status === "error" || download.status === "aborted";
  const isExtracting = download.extractionStatus === "extracting";
  const needsPassword =
    download.extractionStatus === "needs-password" ||
    download.extractionPasswordRequired;
  const isInstallCopyingOrLaunching =
    download.installationStatus === "copying" ||
    download.installationStatus === "launching";

  let extractionProgressText = t("downloads.detail.inProgress");
  if (
    download.extractionProgress !== null &&
    download.extractionProgress !== undefined
  ) {
    extractionProgressText = `${formatDecimal(download.extractionProgress, 1)}%`;
  }

  let installProgressText = t("downloads.detail.inProgress");
  if (
    download.installationStatus === "copying" &&
    download.installationProgress !== null &&
    download.installationProgress !== undefined
  ) {
    installProgressText = `${formatDecimal(download.installationProgress, 1)}%`;
  } else if (download.installationStatus === "launching") {
    installProgressText = t("downloads.detail.starting");
  }

  return (
    <div className="download-phase-detail">
      {installState ? (
        <InstallFlow
          download={download}
          installState={installState}
          onUpdate={onUpdateInstallState}
          onClose={onCloseInstallView}
          onSetUndetectedMode={onSetUndetectedMode}
          onForceInstall={onForceInstall}
        />
      ) : isDownloadingOrPaused ? (
        <TransferMeter
          label={t("downloads.detail.downloadProgress")}
          paused={download.status === "paused"}
          value={download.progress}
          valueText={
            download.status === "paused"
              ? t("downloads.status.paused")
              : `${formatDecimal(download.progress ?? 0, 1)}%`
          }
        />
      ) : isFailed ? (
        download.error ? (
          <ErrorNote message={download.error} />
        ) : (
          <p className="text-xs text-ps-muted">
            {download.status === "aborted"
              ? t("downloads.detail.cancelled")
              : t("downloads.detail.failed")}
          </p>
        )
      ) : download.status === "completed" ? (
        <div className="space-y-3">
          {needsPassword && (
            <div className="download-password-field">
              <label htmlFor={`archive-password-${download.gameId}`}>
                <KeyIcon className="size-4" aria-hidden="true" />
                {t("pipeline.password.title")}
              </label>
              <Input
                id={`archive-password-${download.gameId}`}
                type="password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder={t("downloads.detail.passwordPlaceholder")}
              />
            </div>
          )}
          {isExtracting && (
            <TransferMeter
              label={t("downloads.detail.extracting")}
              value={download.extractionProgress}
              valueText={extractionProgressText}
              currentFile={download.extractionCurrentFile}
            />
          )}
          {download.extractionNotice && (
            <p className="text-xs text-ps-muted" role="status">
              {download.extractionNotice}
            </p>
          )}
          {download.extractionError && (
            <ErrorNote message={download.extractionError} />
          )}
          {download.sourceFilesDeleted && (
            <p className="text-xs text-ps-muted">
              {t("downloads.detail.sourceDeleted")}
            </p>
          )}
          {download.extractionStatus === "completed" && isTauri && (
            <div className="space-y-2">
              {isInstallCopyingOrLaunching && (
                <TransferMeter
                  label={
                    download.installationStatus === "copying"
                      ? t("downloads.detail.installationCopy")
                      : t("downloads.detail.installerLaunch")
                  }
                  value={download.installationProgress}
                  valueText={installProgressText}
                  currentFile={download.installationCurrentFile}
                />
              )}
              <p className="text-xs text-ps-muted">
                {download.installationStatus === "completed"
                  ? t("downloads.detail.installReady")
                  : download.installationStatus === "copying"
                    ? t("downloads.detail.installCopying")
                    : download.installationStatus === "launching"
                      ? t("downloads.detail.installLaunching")
                      : download.installationStatus === "running"
                        ? t("downloads.detail.installRunning")
                        : download.sourceFilesDeleted
                          ? t("downloads.detail.sourceDeletedAfterInstall")
                          : t("downloads.detail.installStart")}
              </p>
              {download.installationStatus === "completed" &&
                download.installationDirectory && (
                  <p
                    className="truncate text-xs text-ps-muted"
                    title={download.installationDirectory}
                  >
                    {fillTemplate(t("downloads.detail.installedTo"), {
                      path: download.installationDirectory,
                    })}
                  </p>
                )}
            </div>
          )}
        </div>
      ) : null}
      {download.installationError && (
        <ErrorNote message={download.installationError} />
      )}
    </div>
  );
}
