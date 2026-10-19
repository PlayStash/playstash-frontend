import { createContext, useContext } from "react";

export interface UmuStatusInfo {
  installed: boolean;
  version: string | null;
  path: string | null;
  supportedPlatform: boolean;
}

export interface UmuContextValue {
  /** Reports whether umu-launcher is installed (or null when unavailable). */
  checkUmuStatus: () => Promise<UmuStatusInfo | null>;
  /** Installs umu-launcher, streaming progress into the overlay. */
  installUmu: (gameTitle?: string) => Promise<boolean>;
}

export const UmuContext = createContext<UmuContextValue | null>(null);

export const useUmu = () => {
  const ctx = useContext(UmuContext);
  if (!ctx) throw new Error("useUmu must be used within an UmuProvider");
  return ctx;
};
