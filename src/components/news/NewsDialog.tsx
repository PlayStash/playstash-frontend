import { PlaystashUserRoleEnum } from "@/api/models/PlaystashUser";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Textarea } from "@/components/tailwind/textarea";
import { useAuth } from "@/context/AuthContext";
import MarkdownContent from "@/components/MarkdownContent";
import { Button } from "@tw/button";
import { useEffect, useState } from "react";
import { useNews } from "../../hooks/useNews";
import { useTranslation } from "@/i18n";

interface NewsDialogProps {
  open?: boolean;
  onClose: () => void;
}

type TabKey = "playstash" | "server";

export function NewsDialog({ open = true, onClose }: NewsDialogProps) {
  const [tab, setTab] = useState<TabKey>("playstash");
  const [isEditingServerNews, setIsEditingServerNews] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { user, serverUrl } = useAuth();
  const { t } = useTranslation();
  const { playStashNews, serverNews, markNewsAsRead, updateServerNews } =
    useNews();
  const hasErr = tab === "playstash" ? playStashNews?.error : serverNews?.error;
  const content =
    tab === "playstash"
      ? (playStashNews?.content ?? t("news.loading.playstash"))
      : (serverNews?.content ?? t("news.loading.server"));
  const isAdmin = Number(user?.role) >= Number(PlaystashUserRoleEnum._3);
  const canEditServerNews = Boolean(serverUrl) && isAdmin && tab === "server";
  const showEditor = canEditServerNews && isEditingServerNews;

  useEffect(() => {
    if (open) markNewsAsRead();
  }, [open, markNewsAsRead]);

  // Outside the editor the draft follows the published server news.
  const publishedServerNews = serverNews?.content ?? "";
  if (!showEditor && draftContent !== publishedServerNews) {
    setDraftContent(publishedServerNews);
  }

  // Leaving the server tab ends an unsaved edit.
  const showPlayStashTab = () => {
    setTab("playstash");
    if (isEditingServerNews) {
      setIsEditingServerNews(false);
      setSaveError(null);
    }
  };

  const handleStartEditing = () => {
    setDraftContent(serverNews?.content ?? "");
    setSaveError(null);
    setIsEditingServerNews(true);
  };

  const handleCancelEditing = () => {
    setDraftContent(serverNews?.content ?? "");
    setSaveError(null);
    setIsEditingServerNews(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      await updateServerNews(draftContent);
      setIsEditingServerNews(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="3xl"
      className="!h-[min(85vh,850px)] flex flex-col"
    >
      <DialogTitle className="flex items-center justify-between gap-4 pb-1">
        <span>{t("nav.news")}</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ps-line text-ps-muted transition-[background-color,color,scale] duration-150 ease-(--ease-out) hover:bg-ps-panel-soft hover:text-ps-text active:scale-[0.97] active:bg-ps-panel-soft active:text-ps-text"
          aria-label={t("common.close")}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
            aria-hidden="true"
          >
            <path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" />
            <path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" />
          </svg>
        </button>
      </DialogTitle>
      <div className="px-6 mt-1 flex items-center gap-3 border-b border-ps-line text-sm">
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={tab === "playstash"}
            onClick={showPlayStashTab}
            className={
              "-mb-px min-h-11 px-3 py-2 border-b-2 transition-colors sm:min-h-0 " +
              (tab === "playstash"
                ? "border-ps-accent text-ps-accent"
                : "border-transparent text-ps-muted hover:text-ps-text")
            }
          >
            {t("news.tab.playstash")}
          </button>
          <button
            type="button"
            aria-pressed={tab === "server"}
            onClick={() => setTab("server")}
            className={
              "-mb-px min-h-11 px-3 py-2 border-b-2 transition-colors sm:min-h-0 " +
              (tab === "server"
                ? "border-ps-accent text-ps-accent"
                : "border-transparent text-ps-muted hover:text-ps-text")
            }
          >
            {t("news.tab.server")}
          </button>
        </div>
      </div>
      <DialogBody className="pt-4 overflow-y-auto flex-1 min-h-0">
        {!showEditor && hasErr && (
          <div role="alert" className="mb-4 text-sm text-ps-danger">
            {hasErr}
          </div>
        )}

        {showEditor ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-ps-line bg-ps-panel-soft px-4 py-3 text-xs text-ps-muted">
              {t("news.editorHint")}
            </div>

            {saveError && (
              <div role="alert" className="text-sm text-ps-danger">
                {saveError}
              </div>
            )}

            <Textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              resizable={false}
              textareaClassName="min-h-105"
              placeholder={t("news.placeholder")}
            />
          </div>
        ) : (
          <MarkdownContent content={content} />
        )}
      </DialogBody>
      <DialogActions>
        {showEditor ? (
          <>
            <Button
              type="button"
              onClick={handleCancelEditing}
              color="zinc"
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              color="indigo"
              disabled={saving}
            >
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </>
        ) : (
          <>
            {canEditServerNews && (
              <Button type="button" onClick={handleStartEditing} plain>
                {t("common.edit")}
              </Button>
            )}
            <Button type="button" onClick={onClose} color="zinc">
              {t("common.close")}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default NewsDialog;
