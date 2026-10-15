import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { Button } from "@tw/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@tw/dialog";
import MarkdownContent from "@/components/MarkdownContent";
import { useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import { channelLabel, formatReleaseNotes } from "@/utils/updater";
import type { UpdateChannel } from "@/utils/updater";

export interface UpdatePromptInfo {
  version: string;
  currentVersion: string;
  channel: UpdateChannel;
  notes?: string | null;
  /**
   * "install": the signed update is downloaded and installed in the app.
   * "page": the update can only be installed manually from the release page.
   */
  mode: "install" | "page";
}

interface UpdatePromptDialogProps {
  prompt: UpdatePromptInfo | null;
  onAnswer: (accepted: boolean) => void;
}

/**
 * Proposes an app update: the new and the running version, the release notes
 * of the new version and "Update now" / "Later".
 */
export function UpdatePromptDialog({
  prompt,
  onAnswer,
}: UpdatePromptDialogProps) {
  const { t } = useTranslation();
  const notes = formatReleaseNotes(prompt?.notes);

  return (
    <Dialog open={!!prompt} onClose={() => onAnswer(false)} size="2xl">
      {prompt && (
        <>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDownTrayIcon className="size-5 text-ps-accent" />
            {fillTemplate(t("updater.available.title"), {
              version: prompt.version,
            })}
          </DialogTitle>
          <DialogDescription>
            {fillTemplate(t("updater.prompt.versions"), {
              version: prompt.version,
              current: prompt.currentVersion,
              channel: channelLabel(prompt.channel),
            })}
          </DialogDescription>
          <DialogBody>
            <h3 className="mb-2 text-sm font-semibold text-ps-text">
              {t("updater.prompt.notesTitle")}
            </h3>
            <div
              data-testid="update-release-notes"
              className="max-h-[45vh] overflow-y-auto rounded-xl border border-ps-line bg-ps-panel-soft p-4"
            >
              {notes ? (
                <MarkdownContent content={notes} />
              ) : (
                <p className="text-sm text-ps-muted">
                  {t("updater.prompt.noNotes")}
                </p>
              )}
            </div>
            <p className="mt-4 text-sm text-ps-text">
              {prompt.mode === "install"
                ? t("updater.prompt.question")
                : t("updater.prompt.pageQuestion")}
            </p>
          </DialogBody>
          <DialogActions>
            <Button plain onClick={() => onAnswer(false)}>
              {t("updater.later")}
            </Button>
            <Button color="indigo" autoFocus onClick={() => onAnswer(true)}>
              {prompt.mode === "install"
                ? t("updater.updateNow")
                : t("updater.openDownloadPage")}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

export default UpdatePromptDialog;
