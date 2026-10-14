import type { ComponentType, ReactNode } from "react";
import {
  BigPictureStartupEffect,
  GameSessionProvider,
} from "@/context/GameSessionProvider";
import { CommunityProvider } from "@/context/CommunityContext";
import { DiscordPresenceEffect } from "@/hooks/useDiscordPresence";
import { SteamShortcutSyncEffect } from "@/hooks/useSteamShortcutSync";
import { DownloadFlowHost } from "@/components/downloads/DownloadFlowHost";
import { DuplicateInstallWatcher } from "@/components/downloads/DuplicateInstallWatcher";
import { AppearanceEffects } from "@/components/AppearanceEffects";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DesktopCommandProvider } from "@/context/DesktopCommandContext";
import {
  ConnectionNotices,
  LegacyImportPrompt,
  LegacyInstallsPrompt,
} from "@/components/login/AccountEffects";
import { CloudSaveSync } from "@/hooks/useCloudSaveSync";

/**
 * App-wide providers and background effects added by the feature packages.
 *
 * Mounted inside the router (see `main.tsx`), so everything here may use
 * navigation. Despite the name, entries are not gated automatically: each
 * provider or effect checks `isTauriApp()` itself when it is desktop-only.
 */

/** Wrappers, outermost first. Each one must render its `children`. */
const PROVIDERS: ComponentType<{ children: ReactNode }>[] = [
  DesktopCommandProvider,
  CommunityProvider,
  GameSessionProvider,
  // Crash screen around the routes and the package effects.
  ErrorBoundary,
];

/**
 * Components that only run hooks (e.g. `function CloudSaveSync() {
 * useCloudSaveSync(); return null; }`). They render inside all providers.
 */
const EFFECTS: ComponentType[] = [
  DiscordPresenceEffect,
  SteamShortcutSyncEffect,
  CloudSaveSync,
  BigPictureStartupEffect,
  // Hosts requestGameDownload (dialogs, auth, navigation).
  DownloadFlowHost,
  DuplicateInstallWatcher,
  ConnectionNotices,
  LegacyImportPrompt,
  LegacyInstallsPrompt,
  AppearanceEffects,
];

export function DesktopProviders({ children }: { children: ReactNode }) {
  const content = (
    <>
      {EFFECTS.map((Effect, index) => (
        <Effect key={index} />
      ))}
      {children}
    </>
  );
  return PROVIDERS.reduceRight<ReactNode>(
    (inner, Provider) => <Provider>{inner}</Provider>,
    content,
  );
}
