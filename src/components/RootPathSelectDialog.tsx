import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Button } from "@/components/tailwind/button";
import type { RootPathEntry } from "@/utils/rootPaths";
import { formatDriveSpace } from "@/utils/downloadPreferences";
import { useTranslation } from "@/i18n";
import {
  CheckCircleIcon,
  Cog6ToothIcon,
  ServerIcon,
} from "@heroicons/react/24/outline";

interface RootPathSelectDialogProps {
  open: boolean;
  gameTitle: string;
  rootPaths: RootPathEntry[];
  /** Root selected when the dialog opens (the last used one). */
  preselectId?: string | null;
  onSelect: (rootPath: string) => void;
  onClose: () => void;
  onGoToSettings: () => void;
}

/** Free bytes per root path; undefined while loading, null when unknown. */
function useFreeSpace(open: boolean, rootPaths: RootPathEntry[]) {
  const [freeSpace, setFreeSpace] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        rootPaths.map(async (root) => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const bytes = await invoke<number>("get_free_space", {
              path: root.path,
            });
            return [root.path, bytes] as const;
          } catch {
            return [root.path, null] as const;
          }
        }),
      );
      if (!cancelled) setFreeSpace(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, rootPaths]);
  return freeSpace;
}

export function RootPathSelectDialog({
  open,
  gameTitle,
  rootPaths,
  preselectId,
  onSelect,
  onClose,
  onGoToSettings,
}: RootPathSelectDialogProps) {
  const { t, locale } = useTranslation();
  const freeSpace = useFreeSpace(open, rootPaths);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial =
      rootPaths.find((root) => root.id === preselectId) ?? rootPaths[0];
    setSelectedId(initial?.id ?? null);
  }, [open, preselectId, rootPaths]);

  if (!open) return null;

  const selected = rootPaths.find((root) => root.id === selectedId);

  return (
    <Dialog open onClose={onClose} size="lg">
      <div className="flex items-start justify-between">
        <div>
          <DialogTitle>{t("pipeline.rootPicker.title")}</DialogTitle>
          <DialogDescription>
            {t("pipeline.rootPicker.description")} <strong>{gameTitle}</strong>
          </DialogDescription>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onGoToSettings();
          }}
          className="cursor-pointer rounded-xl p-2 text-ps-muted transition-colors hover:bg-ps-panel-soft hover:text-ps-text"
          aria-label={t("pipeline.rootPicker.settings")}
          title={t("pipeline.rootPicker.settings")}
        >
          <Cog6ToothIcon className="h-5 w-5" />
        </button>
      </div>
      <DialogBody className="pt-3">
        <div
          className="space-y-2"
          role="radiogroup"
          aria-label={t("pipeline.rootPicker.title")}
        >
          {rootPaths.map((root) => {
            const isSelected = root.id === selectedId;
            const bytes = freeSpace[root.path];
            return (
              <button
                key={root.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelectedId(root.id)}
                onDoubleClick={() => onSelect(root.path)}
                className={clsx(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition-colors",
                  isSelected
                    ? "border-ps-accent bg-ps-panel-soft"
                    : "border-ps-line bg-ps-panel hover:border-ps-accent hover:bg-ps-panel-soft",
                )}
              >
                <ServerIcon className="h-6 w-6 shrink-0 text-ps-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ps-text">
                    {root.label || root.path}
                  </div>
                  <div
                    className="truncate text-xs text-ps-muted"
                    title={root.path}
                  >
                    {root.path}
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-ps-muted">
                  {bytes === undefined
                    ? ""
                    : bytes === null
                      ? t("pipeline.rootPicker.freeUnknown")
                      : `${formatDriveSpace(bytes, locale)} ${t("pipeline.rootPicker.free")}`}
                </span>
                {isSelected && (
                  <CheckCircleIcon
                    className="h-5 w-5 shrink-0 text-ps-accent"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          {t("pipeline.dialog.cancel")}
        </Button>
        <Button
          color="indigo"
          disabled={!selected}
          onClick={() => selected && onSelect(selected.path)}
        >
          {t("pipeline.rootPicker.proceed")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
