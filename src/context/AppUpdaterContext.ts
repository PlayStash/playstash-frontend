import { createContext, useContext } from "react";
import type { UpdateChannel } from "@/utils/updater";

export interface CheckForUpdatesOptions {
  manual?: boolean;
}

export interface AppUpdaterContextValue {
  updateChannel: UpdateChannel;
  updaterEnabled: boolean;
  updaterReady: boolean;
  isChecking: boolean;
  isInstalling: boolean;
  availableVersion: string | null;
  errorText: string | null;
  statusText: string | null;
  setUpdateChannel: (channel: UpdateChannel) => void;
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<void>;
}

export const AppUpdaterContext = createContext<
  AppUpdaterContextValue | undefined
>(undefined);

export function useAppUpdater() {
  const context = useContext(AppUpdaterContext);

  if (!context) {
    throw new Error("useAppUpdater must be used within an AppUpdaterProvider");
  }

  return context;
}
