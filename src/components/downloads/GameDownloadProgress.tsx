import { Link } from "react-router";
import { useDownloads, type ActiveDownload } from "@/context/DownloadContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { isCardBusy } from "@/utils/downloadPipeline";
import { Button } from "../tailwind/button";
import { ProgressBar } from "../tailwind/progress";

/** Label, percentage and detail of the phase a download card is in. */
function currentPhase(
  download: ActiveDownload,
  t: (key: TranslationKey) => string,
  formatBytes: (bytes: number) => string,
  formatSpeed: (bps: number) => string,
) {
  const percent = (value: number | null | undefined) =>
    typeof value === "number" ? `${value.toFixed(1)}%` : undefined;
  if (
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running"
  ) {
    return {
      label: t("downloads.status.installing"),
      value: download.installationProgress,
      valueText: percent(download.installationProgress),
      detail:
        download.installationStatus === "copying"
          ? download.installationCurrentFile
          : t("downloads.detail.installRunning"),
    };
  }
  if (download.extractionStatus === "extracting") {
    return {
      label: t("downloads.detail.extracting"),
      value: download.extractionProgress,
      valueText: percent(download.extractionProgress),
      detail: download.extractionCurrentFile,
    };
  }
  const bytes = `${formatBytes(download.received)}${
    download.total ? ` / ${formatBytes(download.total)}` : ""
  }`;
  return {
    label:
      download.status === "paused"
        ? t("downloads.status.paused")
        : t("downloads.status.downloading"),
    value: download.progress,
    valueText: percent(download.progress),
    detail:
      download.status === "downloading" && download.speedBps
        ? `${bytes} · ${formatSpeed(download.speedBps)}`
        : bytes,
  };
}

/**
 * Progress of the running download, extraction or installation of one game,
 * shown on its game page. Renders nothing while the game has no active card.
 */
export function GameDownloadProgress({ gameId }: { gameId: number }) {
  const { t } = useTranslation();
  const {
    downloads,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    formatBytes,
    formatSpeed,
  } = useDownloads();
  const download = downloads[gameId];
  if (!download || (!isCardBusy(download) && download.status !== "paused"))
    return null;

  const phase = currentPhase(download, t, formatBytes, formatSpeed);
  const downloading = download.status === "downloading";
  return (
    <section
      aria-label={t("downloads.step.phases")}
      className="surface-panel-soft space-y-3 rounded-2xl p-4"
    >
      <ProgressBar
        value={phase.value}
        label={phase.label}
        valueText={phase.valueText}
        currentFile={phase.detail}
      />
      <div className="flex flex-wrap gap-2">
        {downloading && (
          <Button outline onClick={() => pauseDownload(gameId)}>
            {t("downloads.action.pause")}
          </Button>
        )}
        {download.status === "paused" && (
          <Button color="indigo" onClick={() => resumeDownload(gameId)}>
            {t("downloads.action.resume")}
          </Button>
        )}
        {(downloading || download.status === "paused") && (
          <Button outline onClick={() => cancelDownload(gameId)}>
            {t("downloads.action.cancelDownload")}
          </Button>
        )}
        <Link
          to="/downloads"
          className="self-center text-sm text-ps-accent hover:underline"
        >
          {t("gameView.download.showInDownloads")}
        </Link>
      </div>
    </section>
  );
}
