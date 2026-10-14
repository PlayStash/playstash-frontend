import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useActiveGames } from "@/hooks/useActiveGames";
import { resolveInstalledGameTitle } from "@/utils/gameTitles";
import { useIntegrationsSettings } from "@/utils/integrationsSettings";
import { isTauriApp } from "@/utils/tauri";

/**
 * Discord Rich Presence for the first running game (desktop, signed in).
 * Shows the game's metadata title with the session start time and clears the
 * presence when no game runs, the setting is turned off or the user signs
 * out. The WPF client never cleared it when the setting was turned off.
 */
export function useDiscordPresence(): void {
  const { user } = useAuth();
  const activeGames = useActiveGames();
  const { settings, loaded } = useIntegrationsSettings();
  const first = activeGames[0];
  const enabled =
    isTauriApp() && loaded && settings.syncDiscordPresence && !!user;
  const gameId = enabled ? (first?.gameId ?? null) : null;
  const versionDirectory = first?.versionDirectory ?? "";
  const startedAt = first?.startedAt ?? 0;
  const appId = settings.discordApplicationId;

  useEffect(() => {
    if (!isTauriApp()) return;
    let cancelled = false;
    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (gameId == null) {
        await invoke("discord_clear_presence");
        return;
      }
      const title = await resolveInstalledGameTitle(gameId, versionDirectory);
      if (cancelled) return;
      if (!title) {
        await invoke("discord_clear_presence");
        return;
      }
      await invoke("discord_set_presence", {
        appId,
        details: title,
        startedAtUnix: startedAt > 0 ? Math.floor(startedAt / 1000) : null,
      });
    })().catch((error) =>
      console.warn("Discord presence update failed:", error),
    );
    return () => {
      cancelled = true;
    };
  }, [gameId, versionDirectory, startedAt, appId]);
}

/** Effect-only component for `DesktopProviders`. */
export function DiscordPresenceEffect(): null {
  useDiscordPresence();
  return null;
}
