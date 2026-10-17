import "@/styles/downloads.css";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useDownloads, type ActiveDownload } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { Button } from "@/components/tailwind/button";
import { Badge } from "@/components/tailwind/badge";
import {
  Dropdown,
  DropdownButton,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@/components/tailwind/dropdown";
import { Media } from "@/components/Media";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { formatDecimal } from "@/utils/number";
import { isTauriApp } from "@/utils/tauri";
import { useShowMappedTitle } from "@/utils/mappedTitle";
import { PhaseSteps, type StepState } from "./PhaseSteps";
import { PhaseDetail } from "./PhaseDetail";
import { useInstallFlow } from "./useInstallFlow";
import { useTranslation, type TranslationKey } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import {
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ComputerDesktopIcon,
  EllipsisHorizontalIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

type ChipColor = "blue" | "green" | "red" | "amber";

function getStatusChip(download: ActiveDownload): {
  label: TranslationKey;
  color: ChipColor;
  icon: ComponentType<{ className?: string }>;
} {
  if (download.status === "downloading") {
    return {
      label: "downloads.status.downloading",
      color: "blue",
      icon: ArrowDownTrayIcon,
    };
  }
  if (download.status === "paused") {
    return {
      label: "downloads.status.paused",
      color: "amber",
      icon: PauseIcon,
    };
  }
  if (download.status === "error") {
    return {
      label: "downloads.status.failed",
      color: "red",
      icon: ExclamationTriangleIcon,
    };
  }
  if (download.status === "aborted") {
    return {
      label: "downloads.status.cancelled",
      color: "red",
      icon: XMarkIcon,
    };
  }
  if (
    download.installationStatus === "error" ||
    download.extractionStatus === "error"
  ) {
    return {
      label: "downloads.status.failed",
      color: "red",
      icon: ExclamationTriangleIcon,
    };
  }
  if (
    download.extractionStatus === "needs-password" ||
    download.extractionPasswordRequired
  ) {
    return {
      label: "downloads.detail.passwordNeeded",
      color: "amber",
      icon: ExclamationTriangleIcon,
    };
  }
  if (download.extractionStatus === "extracting") {
    return {
      label: "downloads.detail.extracting",
      color: "blue",
      icon: ArchiveBoxIcon,
    };
  }
  if (download.installationStatus === "completed") {
    return {
      label: "downloads.status.installed",
      color: "green",
      icon: CheckCircleIcon,
    };
  }
  if (
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running"
  ) {
    return {
      label: "downloads.status.installing",
      color: "blue",
      icon: ComputerDesktopIcon,
    };
  }
  if (download.extractionStatus === "completed") {
    return {
      label: "downloads.status.extracted",
      color: "blue",
      icon: ArchiveBoxIcon,
    };
  }
  return {
    label: "downloads.status.done",
    color: "green",
    icon: CheckCircleIcon,
  };
}

function getDownloadStepState(status: string): StepState {
  if (status === "completed") return "done";
  if (status === "downloading") return "active";
  if (status === "paused") return "active";
  if (status === "error" || status === "aborted") return "error";
  return "pending";
}

function getExtractionStepState(download: ActiveDownload): StepState {
  if (download.status !== "completed") return "pending";
  if (download.extractionStatus === "completed") return "done";
  if (download.extractionStatus === "extracting") return "active";
  if (
    download.extractionStatus === "error" ||
    download.extractionStatus === "needs-password"
  ) {
    return "error";
  }
  return "pending";
}

function getInstallationStepState(download: ActiveDownload): StepState {
  if (download.extractionStatus !== "completed") return "pending";
  if (download.installationStatus === "completed") return "done";
  if (
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running"
  ) {
    return "active";
  }
  if (download.installationStatus === "error") return "error";
  return "pending";
}

/**
 * Size of the card's Download and Extraction folders (hidden when 0).
 * Recomputed when the card is restored and whenever the download or
 * extraction state changes, not on every progress tick.
 */
function useFolderSize(download: ActiveDownload, isTauri: boolean) {
  const [size, setSize] = useState(0);
  const { gameId, downloadDirectory, extractionDirectory } = download;
  useEffect(() => {
    if (!isTauri || gameId <= 0) return;
    const paths = [downloadDirectory, extractionDirectory].filter(
      (path): path is string => !!path,
    );
    if (!paths.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = await invoke<number>("get_paths_size", { paths });
        if (!cancelled) setSize(bytes);
      } catch {
        if (!cancelled) setSize(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isTauri,
    gameId,
    downloadDirectory,
    extractionDirectory,
    download.status,
    download.extractionStatus,
    download.installationStatus,
    download.sourceFilesDeleted,
  ]);
  return size;
}

export function DownloadCard({
  download,
}: Readonly<{
  download: ActiveDownload;
  index?: number;
}>) {
  // Mapped (metadata) title or the game's own title, like the library.
  const showMappedTitle = useShowMappedTitle();
  const title =
    (showMappedTitle ? download.gameTitle : download.fileTitle) ||
    download.gameTitle;
  const {
    cancelDownload,
    pauseDownload,
    resumeDownload,
    deleteDownloadCard,
    retryDownload,
    openDownloadFolder,
    extractArchive,
    persistForcedGameType,
    formatBytes,
    formatSpeed,
  } = useDownloads();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const isTauri = isTauriApp();
  const [password, setPassword] = useState("");
  const folderSize = useFolderSize(download, isTauri);
  const {
    installState,
    openInstallFlow,
    closeInstallView,
    setUndetectedMode,
    updateInstallState,
  } = useInstallFlow(download);

  const downloadStep = getDownloadStepState(download.status);
  const extractionStep = getExtractionStepState(download);
  const installationStep = getInstallationStepState(download);
  const status = getStatusChip(download);

  const isExtracting = download.extractionStatus === "extracting";
  const needsPassword =
    download.extractionStatus === "needs-password" ||
    download.extractionPasswordRequired;
  const isInstalling =
    download.installationStatus === "copying" ||
    download.installationStatus === "launching" ||
    download.installationStatus === "running";
  const isInstalled = download.installationStatus === "completed";
  const isExtracted = download.extractionStatus === "completed";
  const isFailed = download.status === "error" || download.status === "aborted";
  const installViewOpen = installState !== null;

  const handleExtract = async () => {
    await extractArchive(download.gameId, password);
  };

  const handleDeleteCard = async () => {
    const confirmed = await showAlert({
      title: t("downloads.card.deleteTitle"),
      description: t("downloads.card.deleteMessage"),
      affirmativeText: t("pipeline.dialog.yes"),
      negativeText: t("pipeline.dialog.no"),
    });
    if (!confirmed) return;
    await deleteDownloadCard(download.gameId);
  };

  const steps = [
    {
      id: "download",
      label: t("downloads.step.download"),
      state: downloadStep,
      valueText:
        downloadStep === "active" && download.progress !== null
          ? `${formatDecimal(download.progress, 1)}%`
          : undefined,
    },
    {
      id: "extraction",
      label: t("downloads.step.extraction"),
      state: extractionStep,
      valueText:
        extractionStep === "active" &&
        download.extractionProgress !== null &&
        download.extractionProgress !== undefined
          ? `${formatDecimal(download.extractionProgress, 1)}%`
          : undefined,
    },
    {
      id: "installation",
      label: t("downloads.step.installation"),
      state: installationStep,
      valueText:
        installationStep === "active" &&
        download.installationProgress !== null &&
        download.installationProgress !== undefined
          ? `${formatDecimal(download.installationProgress, 1)}%`
          : undefined,
    },
  ];

  const primaryAction: ReactNode = (() => {
    if (installViewOpen) return null;

    if (download.status === "downloading") {
      return (
        <Button color="amber" onClick={() => pauseDownload(download.gameId)}>
          <PauseIcon className="h-4 w-4" aria-hidden="true" />
          {t("downloads.action.pause")}
        </Button>
      );
    }
    if (download.status === "paused") {
      return (
        <Button color="indigo" onClick={() => resumeDownload(download.gameId)}>
          <PlayIcon className="h-4 w-4" aria-hidden="true" />
          {t("downloads.action.resume")}
        </Button>
      );
    }
    if (isFailed) {
      return (
        <Button color="indigo" onClick={() => retryDownload(download.gameId)}>
          <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
          {t("downloads.action.tryAgain")}
        </Button>
      );
    }
    if (download.status === "completed" && !isExtracted) {
      return (
        <Button
          color={
            needsPassword || download.extractionStatus === "error"
              ? "amber"
              : "indigo"
          }
          onClick={() => void handleExtract()}
          disabled={isExtracting}
        >
          {isExtracting
            ? t("downloads.action.extracting")
            : download.extractionStatus === "completed"
              ? t("downloads.action.extractAgain")
              : needsPassword || download.extractionStatus === "error"
                ? t("downloads.action.retryExtraction")
                : t("downloads.action.startExtraction")}
        </Button>
      );
    }
    if (download.status === "completed" && isExtracted && isTauri) {
      if (isInstalling) {
        return (
          <Button color="indigo" disabled>
            {t("downloads.action.installing")}
          </Button>
        );
      }
      if (isInstalled) {
        return (
          <Button color="indigo" href={`/library/${download.gameId}`}>
            {t("downloads.action.goToGame")}
          </Button>
        );
      }
      return (
        <Button color="indigo" onClick={() => void openInstallFlow()}>
          {t("common.install")}
        </Button>
      );
    }
    return null;
  })();

  return (
    <article className="download-queue-item" data-status={download.status}>
      <div className="download-queue-cover">
        {(download.gameMetadata as any)?.cover ? (
          <Media
            media={(download.gameMetadata as any).cover}
            width={64}
            height={86}
            square
            fit="cover"
            alt={fillTemplate(t("downloads.card.coverAlt"), { title })}
            className="download-cover-image"
            gameId={download.gameId}
            mediaSlot="cover"
            fallback={
              <CoverPlaceholder
                title={title || t("downloads.card.gameFallback")}
                size="small"
                className="h-full w-full"
              />
            }
          />
        ) : (
          <CoverPlaceholder
            title={title || t("downloads.card.gameFallback")}
            size="small"
            className="h-full w-full"
          />
        )}
      </div>
      <div className="download-queue-main">
        <div className="download-item-heading">
          <h3 title={title || download.filename}>
            {title || download.filename}
          </h3>
          <Badge color={status.color}>
            <status.icon className="size-3.5" aria-hidden="true" />
            {t(status.label)}
          </Badge>
        </div>
        <p className="download-filename" title={download.filename}>
          {download.filename}
        </p>
        <div className="download-transfer-numbers">
          <span>
            {formatBytes(download.received)} /{" "}
            {download.total ? formatBytes(download.total) : t("common.unknown")}
          </span>
          {download.speedBps !== undefined &&
            download.status === "downloading" && (
              <strong>{formatSpeed(download.speedBps)}</strong>
            )}
          {folderSize > 0 && (
            <span title={t("pipeline.card.folderSize")}>
              {formatBytes(folderSize)}
            </span>
          )}
        </div>
        <div className="download-pipeline">
          <PhaseSteps steps={steps} />
        </div>
        <div className="download-current-phase">
          <PhaseDetail
            download={download}
            isTauri={isTauri}
            password={password}
            onPasswordChange={setPassword}
            installState={installState}
            onUpdateInstallState={updateInstallState}
            onCloseInstallView={closeInstallView}
            onSetUndetectedMode={setUndetectedMode}
            onForceInstall={() => {
              if (!installState) return;
              // The uninstall flow reads the forced type from the version config.
              void persistForcedGameType(
                download.gameId,
                installState.forcedType,
              );
              void openInstallFlow(installState.forcedType);
            }}
          />
        </div>
      </div>
      <div className="download-queue-actions">
        {primaryAction}
        <Dropdown>
          <DropdownButton
            as={Button}
            plain
            aria-label={t("downloads.card.moreActions")}
            title={t("downloads.card.moreActions")}
          >
            <EllipsisHorizontalIcon className="h-4 w-4" aria-hidden="true" />
          </DropdownButton>
          <DropdownMenu anchor="bottom end" className="min-w-48">
            {isTauri && (
              <DropdownItem
                onClick={() => void openDownloadFolder(download.gameId)}
                disabled={!download.downloadDirectory}
              >
                <FolderOpenIcon data-slot="icon" aria-hidden="true" />
                <DropdownLabel>
                  {t("downloads.action.openFolder")}
                </DropdownLabel>
              </DropdownItem>
            )}
            {isExtracted && !download.sourceFilesDeleted && (
              <DropdownItem onClick={() => void handleExtract()}>
                <ArchiveBoxIcon data-slot="icon" aria-hidden="true" />
                <DropdownLabel>
                  {t("downloads.action.extractAgain")}
                </DropdownLabel>
              </DropdownItem>
            )}
            {download.status === "downloading" && (
              <DropdownItem onClick={() => cancelDownload(download.gameId)}>
                <XMarkIcon data-slot="icon" aria-hidden="true" />
                <DropdownLabel>
                  {t("downloads.action.cancelDownload")}
                </DropdownLabel>
              </DropdownItem>
            )}
            {isInstalled && isTauri && (
              <DropdownItem onClick={() => void openInstallFlow()}>
                <ArrowPathIcon data-slot="icon" aria-hidden="true" />
                <DropdownLabel>
                  {t("downloads.action.installAgain")}
                </DropdownLabel>
              </DropdownItem>
            )}
            <DropdownDivider />
            <DropdownItem onClick={() => void handleDeleteCard()}>
              <TrashIcon data-slot="icon" aria-hidden="true" />
              <DropdownLabel>{t("common.delete")}</DropdownLabel>
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
    </article>
  );
}
