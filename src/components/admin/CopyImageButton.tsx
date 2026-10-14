import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation } from "@/i18n";
import { copyImageToClipboard } from "@/utils/copyImage";

/**
 * Hover button that copies an image as PNG ("Copy Image to Clipboard").
 * The parent needs `relative group/copy`.
 */
export function CopyImageButton({ src }: { src: string }) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  return (
    <button
      type="button"
      title={t("images.copyToClipboard")}
      aria-label={t("images.copyToClipboard")}
      onClick={async () => {
        try {
          await copyImageToClipboard(src);
          void showAlert({ title: t("images.copied"), tone: "success" });
        } catch (error) {
          void showAlert({
            title: t("images.copyFailed"),
            description: error instanceof Error ? error.message : String(error),
            tone: "danger",
          });
        }
      }}
      className="absolute top-1.5 right-1.5 z-10 rounded-lg bg-ps-panel-strong/90 p-1.5 text-ps-text opacity-0 shadow-sm ring-1 ring-ps-line transition-opacity group-hover/copy:opacity-100 focus-visible:opacity-100"
    >
      <ClipboardDocumentIcon className="size-4" />
    </button>
  );
}
