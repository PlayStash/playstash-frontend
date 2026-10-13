import {
  PlaystashGameTypeEnum,
  type PlaystashGameTypeEnum as GameType,
} from "@/api/models/PlaystashGame";

export type InstallViewMode = "portable" | "setup" | "undetected";

export type InstallCardState = {
  mode: InstallViewMode;
  forcedType: GameType;
  installerOptions: string[];
  selectedInstaller: string;
  loadingInstallers: boolean;
  installerLoadError?: string;
};

export const FORCE_INSTALL_TYPES: { label: string; value: GameType }[] = [
  { label: "Windows Setup", value: PlaystashGameTypeEnum.windows_setup },
  { label: "Windows Portable", value: PlaystashGameTypeEnum.windows_portable },
  { label: "Linux Portable", value: PlaystashGameTypeEnum.linux_portable },
];

export function formatGameTypeLabel(gameType?: string) {
  if (!gameType) return "Undetectable";
  return gameType
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveInstallMode(gameType?: string): InstallViewMode {
  if (gameType === PlaystashGameTypeEnum.windows_setup) {
    return "setup";
  }

  if (
    gameType === PlaystashGameTypeEnum.windows_portable ||
    gameType === PlaystashGameTypeEnum.linux_portable ||
    gameType === PlaystashGameTypeEnum.windows_software ||
    gameType === PlaystashGameTypeEnum.linux_software
  ) {
    return "portable";
  }

  return "undetected";
}

export function normalizeRelativePath(value?: string) {
  return (value || "").replace(/\\/g, "/").toLowerCase();
}

export function pickPreferredInstaller(options: string[], preferred?: string) {
  if (!options.length) return "";
  if (!preferred) return options[0];

  const normalizedPreferred = normalizeRelativePath(preferred);
  const exactMatch = options.find(
    (option) => normalizeRelativePath(option) === normalizedPreferred,
  );
  if (exactMatch) return exactMatch;

  const suffixMatch = options.find((option) =>
    normalizeRelativePath(option).endsWith(normalizedPreferred),
  );
  return suffixMatch || options[0];
}
