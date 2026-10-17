import {
  PlaystashGameTypeEnum,
  type PlaystashGameTypeEnum as GameType,
} from "@/api/models/PlaystashGame";
import { translate, type TranslationKey } from "@/i18n";

export type InstallViewMode = "portable" | "setup" | "undetected";

export type InstallCardState = {
  mode: InstallViewMode;
  forcedType: GameType;
  installerOptions: string[];
  selectedInstaller: string;
  loadingInstallers: boolean;
  installerLoadError?: string;
};

export const FORCE_INSTALL_TYPES: { label: TranslationKey; value: GameType }[] =
  [
    {
      label: "downloads.gameType.windowsSetup",
      value: PlaystashGameTypeEnum.windows_setup,
    },
    {
      label: "downloads.gameType.windowsPortable",
      value: PlaystashGameTypeEnum.windows_portable,
    },
    {
      label: "downloads.gameType.linuxPortable",
      value: PlaystashGameTypeEnum.linux_portable,
    },
  ];

const GAME_TYPE_LABELS: Record<string, TranslationKey> = {
  [PlaystashGameTypeEnum.undetectable]: "downloads.gameType.undetectable",
  [PlaystashGameTypeEnum.windows_setup]: "downloads.gameType.windowsSetup",
  [PlaystashGameTypeEnum.windows_portable]:
    "downloads.gameType.windowsPortable",
  [PlaystashGameTypeEnum.windows_software]:
    "downloads.gameType.windowsSoftware",
  [PlaystashGameTypeEnum.linux_portable]: "downloads.gameType.linuxPortable",
  [PlaystashGameTypeEnum.linux_software]: "downloads.gameType.linuxSoftware",
};

/** Display label of a game type, translated at call time. */
export function formatGameTypeLabel(gameType?: string) {
  if (!gameType) return translate("downloads.gameType.undetectable");
  const key = GAME_TYPE_LABELS[gameType];
  if (key) return translate(key);
  return gameType
    .replaceAll("_", " ")
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
  return (value || "").replaceAll("\\", "/").toLowerCase();
}

const WINDOWS_EXECUTABLE_EXTENSIONS = ["exe", "bat", "cmd", "com", "msi"];

/**
 * True when the relative path points to a Windows executable that needs
 * Proton/Wine (umu-launcher) to run on Linux.
 */
export function isWindowsExecutablePath(value?: string) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return WINDOWS_EXECUTABLE_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
}

/**
 * Common installer executable names. When a game has no configured/preferred
 * installer, we auto-pick a well-known setup name (e.g. setup.exe) instead of
 * whichever executable happened to come first alphabetically.
 */
const COMMON_INSTALLER_NAMES = [
  "setup",
  "install",
  "installer",
  "autorun",
  "autoplay",
  "start",
  "launcher",
  "setup64",
  "install64",
  "setup32",
  "install32",
];

/** Lower score = preferred. Exact common names rank first, then names that
 * merely contain "setup"/"install", then everything else. */
function installerPreferenceScore(option: string): number {
  const basename = normalizeRelativePath(option).split("/").pop() || "";
  const name = basename.replace(/\.(exe|msi|bat|cmd|com)$/i, "");
  if (COMMON_INSTALLER_NAMES.includes(name)) return 0;
  if (name.includes("setup") || name.includes("install")) return 1;
  return 2;
}

export function pickPreferredInstaller(options: string[], preferred?: string) {
  if (!options.length) return "";

  if (preferred && preferred.trim()) {
    const normalizedPreferred = normalizeRelativePath(preferred);
    const exactMatch = options.find(
      (option) => normalizeRelativePath(option) === normalizedPreferred,
    );
    if (exactMatch) return exactMatch;

    const suffixMatch = options.find((option) =>
      normalizeRelativePath(option).endsWith(normalizedPreferred),
    );
    if (suffixMatch) return suffixMatch;
  }

  // No configured/preferred installer matched — prefer a common setup name so
  // the correct installer is auto-selected rather than an arbitrary hit.
  return (
    options
      .slice()
      .sort(
        (a, b) => installerPreferenceScore(a) - installerPreferenceScore(b),
      )[0] ?? options[0]
  );
}

// Folders that only ship prerequisites (e.g. `_Redist`, `_CommonRedist`).
const PREREQUISITE_FOLDER =
  /^(_?common_?redist|_?redist(ributables?)?|directx|dotnet|vcredist|physx|prerequisites?|installers?|support)$/i;
// Prerequisite installers and helper tools that are never the game itself.
const HELPER_EXECUTABLE =
  /(vc_?redist|dxsetup|dxwebsetup|dotnetfx|ndp\d|oalinst|physx|xnafx|ue\d?prereq|windowsdesktop-runtime|unitycrashhandler|crashpad|crashreport|notification_helper|^unins\d*|^setup|^install)/i;

/** Lower is a better launch candidate: the game before helpers, shallow first. */
function launchPreferenceScore(path: string) {
  const parts = normalizeRelativePath(path).split("/");
  const name = parts[parts.length - 1].replace(/\.[^.]+$/, "");
  let score = parts.length;
  if (parts.slice(0, -1).some((part) => PREREQUISITE_FOLDER.test(part)))
    score += 1000;
  if (HELPER_EXECUTABLE.test(name)) score += 1000;
  // Ren'Py ships a 32-bit twin (`Game-32.exe`) next to the 64-bit game.
  if (/-32$/.test(name)) score += 1;
  return score;
}

/**
 * Resolve the launch executable to auto-select after installation.
 *
 * Prefers the game's configured `launch_executable` when it matches a real
 * candidate (case-insensitive, separator-normalized). When nothing is
 * configured or nothing matches, auto-detects the most likely game
 * executable: prerequisite installers (`_Redist/vcredist_x64.exe`) and helper
 * tools rank last, shallower files first, otherwise the listed order.
 */
export function pickPreferredExecutable(options: string[], preferred?: string) {
  if (!options.length) return "";

  if (preferred && preferred.trim()) {
    const normalizedPreferred = normalizeRelativePath(preferred);
    const exactMatch = options.find(
      (option) => normalizeRelativePath(option) === normalizedPreferred,
    );
    if (exactMatch) return exactMatch;
  }

  return options
    .map((option, index) => ({ option, index }))
    .sort(
      (a, b) =>
        launchPreferenceScore(a.option) - launchPreferenceScore(b.option) ||
        a.index - b.index,
    )[0].option;
}
