import "@/styles/downloads.css";
import { useDownloads } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { DownloadCard } from "@/components/downloads/DownloadCard";
import { confirmPipeline } from "@/components/downloads/pipelineDialogStore";
import { Heading } from "@tw/heading";
import { Text } from "@tw/text";
import { Button } from "@tw/button";
import { ArrowDownTrayIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { deleteAllDownloadCards, isCardBusy } from "@/utils/downloadPipeline";

export default function Downloads() {
  const { downloads, deleteDownloadCard } = useDownloads();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const [deletingAll, setDeletingAll] = useState(false);
  const downloadArray = useMemo(() => Object.values(downloads), [downloads]);

  const queue = useMemo(
    () =>
      [...downloadArray].sort((a, b) => {
        const priority = (download: typeof a) =>
          isCardBusy(download)
            ? 0
            : download.status === "paused"
              ? 1
              : download.status === "error" ||
                  download.extractionStatus === "error" ||
                  download.installationStatus === "error"
                ? 2
                : 3;
        return (
          priority(a) - priority(b) || (b.startedAt || 0) - (a.startedAt || 0)
        );
      }),
    [downloadArray],
  );
  const phaseCounts = useMemo(
    () => ({
      download: downloadArray.filter((item) => item.status === "downloading")
        .length,
      extraction: downloadArray.filter(
        (item) => item.extractionStatus === "extracting",
      ).length,
      installation: downloadArray.filter((item) =>
        ["copying", "launching", "running"].includes(
          item.installationStatus || "",
        ),
      ).length,
    }),
    [downloadArray],
  );

  const handleDeleteAll = async () => {
    const confirmed = await confirmPipeline({
      title: t("pipeline.deleteAll.title"),
      message: t("pipeline.deleteAll.message"),
      confirmText: t("pipeline.dialog.yes"),
      cancelText: t("pipeline.dialog.no"),
      tone: "danger",
    });
    if (!confirmed) return;
    setDeletingAll(true);
    try {
      const { skipped } = await deleteAllDownloadCards(
        downloadArray,
        deleteDownloadCard,
      );
      if (skipped > 0) void showAlert({ title: t("pipeline.delete.busy") });
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="downloads-page">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Heading>{t("nav.downloads")}</Heading>
          <Text className="max-w-2xl">{t("downloads.page.description")}</Text>
        </div>
        {downloadArray.length > 0 && (
          <Button
            plain
            onClick={() => void handleDeleteAll()}
            disabled={deletingAll}
            aria-label={t("pipeline.deleteAll.button")}
            title={t("pipeline.deleteAll.button")}
            className="shrink-0 text-ps-danger!"
          >
            <TrashIcon className="h-5 w-5 text-ps-danger!" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t("pipeline.deleteAll.button")}
            </span>
          </Button>
        )}
      </div>
      {downloadArray.length > 0 && (
        <div
          className="download-queue-summary"
          role="group"
          aria-label={t("downloads.step.phases")}
        >
          {(
            [
              ["downloads.step.download", phaseCounts.download],
              ["downloads.step.extraction", phaseCounts.extraction],
              ["downloads.step.installation", phaseCounts.installation],
            ] as const
          ).map(([label, count]) => (
            <span key={label} data-idle={count === 0 || undefined}>
              {t(label)}
              <strong>{count}</strong>
            </span>
          ))}
        </div>
      )}

      {downloadArray.length > 0 && (
        <div className="download-queue">
          {queue.map((download, index) => (
            <DownloadCard
              key={download.gameId}
              download={download}
              index={index}
            />
          ))}
        </div>
      )}

      {downloadArray.length === 0 && (
        <div className="download-empty">
          <div className="download-empty-icon">
            <ArrowDownTrayIcon
              className="size-7 text-ps-muted"
              aria-hidden="true"
            />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-ps-text">
            {t("pipeline.downloads.empty")}
          </h3>
          <p className="mt-1 text-sm text-ps-muted">
            {t("downloads.page.emptyHint")}
          </p>
          <Button outline href="/library" className="mt-6">
            {t("nav.library")}
          </Button>
        </div>
      )}
    </div>
  );
}
