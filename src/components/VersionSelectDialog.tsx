import { GameVersion } from "@/api/models/GameVersion";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tw/table";
import { CheckIcon } from "@heroicons/react/24/solid";
import { Button } from "@tw/button";
import { useMemo, useState } from "react";
import { formatDecimal } from "@/utils/number";
import { useTranslation, type TranslationKey } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

const GAME_TYPE_LABEL: Record<string, TranslationKey> = {
  WINDOWS_SETUP: "gameView.type.windowsSetup",
  WINDOWS_PORTABLE: "gameView.type.windowsPortable",
  LINUX_PORTABLE: "gameView.type.linuxPortable",
};

interface VersionSelectDialogProps {
  open: boolean;
  gameTitle: string;
  versions: GameVersion[];
  onSelect: (version: GameVersion) => void;
  onClose: () => void;
}

type SortKey = "version" | "indexed_at" | "type" | "early_access" | "size";

export function VersionSelectDialog({
  open,
  gameTitle,
  versions,
  onSelect,
  onClose,
}: VersionSelectDialogProps) {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<SortKey>("indexed_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const toSizeNumber = (size: string) => {
    const parsed = Number(size);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatSize = (rawSize: string) => {
    const bytes = toSizeNumber(rawSize);
    if (bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    const precision = value < 10 ? 2 : value < 100 ? 1 : 0;
    return `${formatDecimal(value, precision)} ${units[unitIndex]}`;
  };

  const formatGameType = (type: string) =>
    GAME_TYPE_LABEL[type]
      ? t(GAME_TYPE_LABEL[type])
      : type
          .replace(/_/g, " ")
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase());

  const formatIndexedAt = (value: Date) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  };

  const sortedVersions = useMemo(() => {
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return [...versions].sort((left, right) => {
      let compareValue = 0;

      if (sortBy === "version") {
        compareValue = (left.version || "").localeCompare(
          right.version || "",
          undefined,
          {
            sensitivity: "base",
            numeric: true,
          },
        );
      } else if (sortBy === "indexed_at") {
        compareValue =
          new Date(left.indexed_at).getTime() -
          new Date(right.indexed_at).getTime();
      } else if (sortBy === "type") {
        compareValue = left.type.localeCompare(right.type, undefined, {
          sensitivity: "base",
        });
      } else if (sortBy === "early_access") {
        compareValue = Number(left.early_access) - Number(right.early_access);
      } else if (sortBy === "size") {
        compareValue = toSizeNumber(left.size) - toSizeNumber(right.size);
      }

      return compareValue * multiplier;
    });
  }, [versions, sortBy, sortDirection]);

  const handleSort = (nextSortBy: SortKey) => {
    if (sortBy === nextSortBy) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(nextSortBy);
    setSortDirection("asc");
  };

  const sortIndicator = (key: SortKey) => {
    if (sortBy !== key) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  };

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} size="5xl">
      <DialogTitle>{t("game.versionSelect.title")}</DialogTitle>
      <DialogDescription>
        {fillTemplate(t("game.versionSelect.description"), {
          title: gameTitle,
        })}
      </DialogDescription>
      <DialogBody className="pt-3">
        <Table className="[--gutter:--spacing(3)] max-h-[55vh] overflow-y-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ps-panel [&::-webkit-scrollbar-thumb]:rounded-full [scrollbar-color:var(--color-ps-line)_transparent]">
          <TableHead>
            <TableRow>
              <TableHeader className="sticky top-0 z-10 bg-ps-panel">
                <button
                  type="button"
                  onClick={() => handleSort("version")}
                  className="inline-flex items-center gap-1 cursor-pointer"
                >
                  {t("common.version")} {sortIndicator("version")}
                </button>
              </TableHeader>
              <TableHeader className="sticky top-0 z-10 bg-ps-panel">
                <button
                  type="button"
                  onClick={() => handleSort("indexed_at")}
                  className="inline-flex items-center gap-1 cursor-pointer"
                >
                  {t("game.versionSelect.dateAdded")}{" "}
                  {sortIndicator("indexed_at")}
                </button>
              </TableHeader>
              <TableHeader className="sticky top-0 z-10 bg-ps-panel">
                <button
                  type="button"
                  onClick={() => handleSort("type")}
                  className="inline-flex items-center gap-1 cursor-pointer"
                >
                  {t("game.versionSelect.gameType")} {sortIndicator("type")}
                </button>
              </TableHeader>
              <TableHeader className="sticky top-0 z-10 bg-ps-panel text-center">
                <button
                  type="button"
                  onClick={() => handleSort("early_access")}
                  className="inline-flex items-center gap-1 cursor-pointer"
                >
                  {t("gameView.earlyAccess")} {sortIndicator("early_access")}
                </button>
              </TableHeader>
              <TableHeader className="sticky top-0 z-10 bg-ps-panel">
                <button
                  type="button"
                  onClick={() => handleSort("size")}
                  className="inline-flex items-center gap-1 cursor-pointer"
                >
                  {t("common.size")} {sortIndicator("size")}
                </button>
              </TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedVersions.map((version) => (
              <TableRow
                key={version.id}
                className="cursor-pointer hover:bg-ps-panel-soft"
                onClick={() => onSelect(version)}
              >
                <TableCell>
                  <span
                    className="block max-w-100 overflow-hidden text-ellipsis whitespace-nowrap"
                    title={`(${version.id}) ${version.version || t("game.versionSelect.unspecified")}`}
                  >
                    {version.version || t("game.versionSelect.unspecified")}
                  </span>
                </TableCell>
                <TableCell>{formatIndexedAt(version.indexed_at)}</TableCell>
                <TableCell>{formatGameType(version.type)}</TableCell>
                <TableCell className="text-center">
                  {version.early_access ? (
                    <span
                      className="inline-flex items-center justify-center"
                      title={t("gameView.earlyAccess")}
                    >
                      <CheckIcon className="h-4 w-4" />
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{formatSize(version.size)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default VersionSelectDialog;
