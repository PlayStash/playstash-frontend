import type { ComponentType, ReactNode } from "react";
// ── WP4 launch: begin ──
import {
  BigPictureStartupEffect,
  GameSessionProvider,
} from "@/context/GameSessionProvider";
// ── WP4 launch: end ──
// ── WP2 community: begin ──
import { CommunityProvider } from "@/context/CommunityContext";
import { DiscordPresenceEffect } from "@/hooks/useDiscordPresence";
import { SteamShortcutSyncEffect } from "@/hooks/useSteamShortcutSync";
// ── WP2 community: end ──

/**
 * App-wide providers and background effects added by the feature packages.
 *
 * Mounted inside the router (see `main.tsx`), so everything here may use
 * navigation. Despite the name, entries are not gated automatically: each
 * provider or effect checks `isTauriApp()` itself when it is desktop-only.
 *
 * Add entries only inside your own package block.
 */

/** Wrappers, outermost first. Each one must render its `children`. */
const PROVIDERS: ComponentType<{ children: ReactNode }>[] = [
  // ── WP1 os-integration: begin ──
  // ── WP1 os-integration: end ──
  // ── WP2 community: begin ──
  CommunityProvider,
  // ── WP2 community: end ──
  // ── WP3 cloud-saves: begin ──
  // ── WP3 cloud-saves: end ──
  // ── WP4 launch: begin ──
  GameSessionProvider,
  // ── WP4 launch: end ──
  // ── WP5 download-pipeline: begin ──
  // ── WP5 download-pipeline: end ──
  // ── WP6 accounts: begin ──
  // ── WP6 accounts: end ──
  // ── WP7 appearance: begin ──
  // ── WP7 appearance: end ──
];

/**
 * Components that only run hooks (e.g. `function CloudSaveSync() {
 * useCloudSaveSync(); return null; }`). They render inside all providers.
 */
const EFFECTS: ComponentType[] = [
  // ── WP1 os-integration: begin ──
  // ── WP1 os-integration: end ──
  // ── WP2 community: begin ──
  DiscordPresenceEffect,
  SteamShortcutSyncEffect,
  // ── WP2 community: end ──
  // ── WP3 cloud-saves: begin ──
  // ── WP3 cloud-saves: end ──
  // ── WP4 launch: begin ──
  BigPictureStartupEffect,
  // ── WP4 launch: end ──
  // ── WP5 download-pipeline: begin ──
  // ── WP5 download-pipeline: end ──
  // ── WP6 accounts: begin ──
  // ── WP6 accounts: end ──
  // ── WP7 appearance: begin ──
  // ── WP7 appearance: end ──
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
