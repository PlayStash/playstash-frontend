import { Link } from "react-router";
import { useDownloads, type ActiveDownload } from "@/context/DownloadContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { isCardBusy } from "@/utils/downloadPipeline";
import { Button } from "../tailwind/button";
import { TransferMeter } from "./TransferMeter";

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
      file:
        download.installationStatus === "copying"
          ? download.installationCurrentFile
          : undefined,
      detail:
        download.installationStatus === "copying"
          ? undefined
          : t("downloads.detail.installRunning"),
    };
  }
  if (download.extractionStatus === "extracting") {
    return {
      label: t("downloads.detail.extracting"),
      value: download.extractionProgress,
      valueText: percent(download.extractionProgress),
      file: download.extractionCurrentFile,
      detail: undefined,
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
    file: undefined,
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
      className="surface-panel-soft space-y-3 rounded-lg p-4"
    >
      <TransferMeter
        value={phase.value}
        label={phase.label}
        valueText={phase.valueText}
        currentFile={phase.file}
        detail={phase.detail}
        paused={download.status === "paused"}
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
          className="inline-flex min-h-11 items-center self-center rounded-sm text-sm text-ps-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-accent-cool sm:min-h-10"
        >
          {t("gameView.download.showInDownloads")}
        </Link>
      </div>
    </section>
  );
}
