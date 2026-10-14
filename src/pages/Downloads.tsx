import { useDownloads } from "@/context/DownloadContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { DownloadCard } from "@/components/downloads/DownloadCard";
import { confirmPipeline } from "@/components/downloads/PipelineDialogs";
import { Heading } from "@tw/heading";
import { Text } from "@tw/text";
import { Divider } from "@tw/divider";
import { Button } from "@tw/button";
import { ArrowDownTrayIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { deleteAllDownloadCards } from "@/utils/downloadPipeline";

export default function Downloads() {
  const { downloads, deleteDownloadCard } = useDownloads();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const [deletingAll, setDeletingAll] = useState(false);
  const downloadArray = useMemo(() => Object.values(downloads), [downloads]);

  const handleDeleteAll = async () => {
    const confirmed = await confirmPipeline({
      title: t("wp5.deleteAll.title"),
      message: t("wp5.deleteAll.message"),
      confirmText: t("wp5.dialog.yes"),
      cancelText: t("wp5.dialog.no"),
      tone: "danger",
    });
    if (!confirmed) return;
    setDeletingAll(true);
    try {
      const { skipped } = await deleteAllDownloadCards(
        downloadArray,
        deleteDownloadCard,
      );
      if (skipped > 0) void showAlert({ title: t("wp5.delete.busy") });
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Heading>Downloads</Heading>
          <Text className="max-w-2xl">
            Track active, queued, and completed game downloads.
          </Text>
        </div>
        {downloadArray.length > 0 && (
          <Button
            plain
            onClick={() => void handleDeleteAll()}
            disabled={deletingAll}
            aria-label={t("wp5.deleteAll.button")}
            title={t("wp5.deleteAll.button")}
            className="shrink-0 text-ps-danger!"
          >
            <TrashIcon className="h-5 w-5 text-ps-danger!" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t("wp5.deleteAll.button")}
            </span>
          </Button>
        )}
      </div>
      <Divider className="border-ps-line/80" />

      {downloadArray.length > 0 && (
        <div className="space-y-4">
          {downloadArray.map((download, index) => (
            <DownloadCard
              key={download.gameId}
              download={download}
              index={index}
            />
          ))}
        </div>
      )}

      {downloadArray.length === 0 && (
        <div className="surface-panel-soft rounded-3xl px-6 py-16 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-ps-line bg-ps-panel">
            <ArrowDownTrayIcon
              className="size-7 text-ps-muted"
              aria-hidden="true"
            />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-ps-text">
            {t("wp5.downloads.empty")}
          </h3>
          <p className="mt-1 text-sm text-ps-muted">
            Start downloading games from your library
          </p>
        </div>
      )}
    </div>
  );
}
