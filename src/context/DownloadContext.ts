import { createContext, useContext } from "react";
import type { GameMetadata } from "@/api/models/GameMetadata";
import type { PlaystashGameTypeEnum } from "@/api/models/PlaystashGame";

type InstallationStatus =
  "idle" | "copying" | "launching" | "running" | "completed" | "error";

export interface ActiveDownload {
  gameId: number;
  versionId: number;
  /** Metadata title first; also names the install folder, so it is stable. */
  gameTitle: string;
  /** The game's own (file) title, shown when mapped titles are turned off. */
  fileTitle?: string;
  gameMetadata?: GameMetadata;
  gameType?: PlaystashGameTypeEnum;
  versionName?: string;
  filename: string;
  downloadDirectory?: string;
  extractionDirectory?: string;
  installationDirectory?: string;
  versionDirectory?: string;
  downloadRootPath?: string;
  downloadedFilePath?: string;
  received: number;
  total: number | null;
  progress: number | null;
  abortController: AbortController;
  startedAt: number;
  speedBps?: number;
  status: "downloading" | "paused" | "completed" | "error" | "aborted";
  error?: string;
  cachedMetadata?: Record<string, any> | null;
  extractionStatus?:
    "idle" | "extracting" | "completed" | "error" | "needs-password";
  extractionProgress?: number | null;
  extractionCurrentFile?: string;
  extractionError?: string;
  extractionPasswordRequired?: boolean;
  installationStatus?: InstallationStatus;
  installationProgress?: number | null;
  installationCurrentFile?: string;
  installationError?: string;
  installationExitCode?: number | null;
  sourceFilesDeleted?: boolean;
  fileWriter?: { close(): Promise<void>; abort(): Promise<void> };
  /** Extract and install this card automatically (CLI `--autoinstall`). */
  autoInstall?: boolean;
  /** Mount root of the ISO used instead of the extraction folder. */
  isoMountPath?: string;
  /** Informational extraction state, e.g. "ISO mounted at E:\". */
  extractionNotice?: string;
  /** The last error was 401/403: resume once a fresh token arrives. */
  awaitingAuth?: boolean;
}

export type SimulatedDownloadKind =
  "downloading" | "paused" | "error" | "aborted" | "completed" | "installing";

export interface DownloadContextValue {
  downloads: Record<number, ActiveDownload>;
  startDownload: (params: {
    gameId: number;
    versionId: number;
    versionName?: string;
    gameTitle: string;
    fileTitle?: string;
    gameMetadata?: GameMetadata;
    gameType?: PlaystashGameTypeEnum;
    filename: string;
    downloadRootPath?: string;
    /** Extract and install automatically, regardless of the global toggles. */
    autoInstall?: boolean;
  }) => void;
  cancelDownload: (gameId: number) => void;
  /** Cancels every running download (used on app exit / logout). */
  cancelAllDownloads: () => void;
  /**
   * Asks before installing over an existing installation of this game in the
   * same version folder. Resolves to false when the user cancelled.
   */
  confirmInstallOverwrite: (gameId: number) => Promise<boolean>;
  /** Persists a game type the user forced in the install flow. */
  persistForcedGameType: (
    gameId: number,
    gameType: PlaystashGameTypeEnum,
  ) => Promise<void>;
  pauseDownload: (gameId: number) => void;
  resumeDownload: (gameId: number) => void;
  deleteDownloadCard: (gameId: number) => Promise<void>;
  retryDownload: (gameId: number) => void;
  openDownloadFolder: (gameId: number) => Promise<void>;
  extractArchive: (gameId: number, password?: string) => Promise<void>;
  listInstallExecutables: (gameId: number) => Promise<string[]>;
  copyInstallationFiles: (gameId: number) => Promise<void>;
  launchInstallationExecutable: (
    gameId: number,
    installerRelativePath: string,
  ) => Promise<void>;
  resetInstallationState: (gameId: number) => void;
  speedLimitKB: number;
  setSpeedLimitKB: (v: number) => void;
  /** Dev-only: inject a fake download card to preview UI states */
  simulateDownload: (kind: SimulatedDownloadKind) => void;
  formatBytes: (bytes: number) => string;
  formatSpeed: (bps?: number) => string;
  formatKBps: (bps?: number) => string;
  formatLimit: (kbPerSec: number) => string;
}

export const DownloadContext = createContext<DownloadContextValue | null>(null);

export function useDownloads() {
  const ctx = useContext(DownloadContext);
  if (!ctx)
    throw new Error("useDownloads must be used within DownloadProvider");
  return ctx;
}
