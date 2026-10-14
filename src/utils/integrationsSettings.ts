/**
 * Steam and Discord integration settings, stored by Rust in the settings
 * section `integrations.json` (desktop only).
 */
import { useEffect, useState } from "react";
import { isTauriApp } from "@/utils/tauri";

export interface IntegrationsSettings {
  discordApplicationId: string;
  syncDiscordPresence: boolean;
  syncSteamShortcuts: boolean;
}

export const DEFAULT_INTEGRATIONS_SETTINGS: IntegrationsSettings = {
  discordApplicationId: "",
  syncDiscordPresence: false,
  syncSteamShortcuts: false,
};

export const INTEGRATIONS_SETTINGS_EVENT =
  "playstash:integrations-settings-change";

let cached: IntegrationsSettings | null = null;

function publish(settings: IntegrationsSettings): void {
  cached = settings;
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent<IntegrationsSettings>(INTEGRATIONS_SETTINGS_EVENT, {
        detail: settings,
      }),
    );
}

export async function loadIntegrationsSettings(): Promise<IntegrationsSettings> {
  if (!isTauriApp()) return DEFAULT_INTEGRATIONS_SETTINGS;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const settings = {
      ...DEFAULT_INTEGRATIONS_SETTINGS,
      ...(await invoke<Partial<IntegrationsSettings>>(
        "get_integrations_settings",
      )),
    };
    cached = settings;
    return settings;
  } catch {
    return cached ?? DEFAULT_INTEGRATIONS_SETTINGS;
  }
}

/** Saves the given fields and notifies every `useIntegrationsSettings`. */
export async function updateIntegrationsSettings(
  patch: Partial<IntegrationsSettings>,
): Promise<IntegrationsSettings> {
  const { invoke } = await import("@tauri-apps/api/core");
  const settings = {
    ...DEFAULT_INTEGRATIONS_SETTINGS,
    ...(await invoke<Partial<IntegrationsSettings>>(
      "set_integrations_settings",
      { patch },
    )),
  };
  publish(settings);
  return settings;
}

/** Current settings plus whether they were loaded from disk yet. */
export function useIntegrationsSettings(): {
  settings: IntegrationsSettings;
  loaded: boolean;
} {
  const [state, setState] = useState(() => ({
    settings: cached ?? DEFAULT_INTEGRATIONS_SETTINGS,
    loaded: cached !== null,
  }));
  useEffect(() => {
    let active = true;
    void loadIntegrationsSettings().then((settings) => {
      if (active) setState({ settings, loaded: true });
    });
    const onChange = (event: Event) =>
      setState({
        settings: (event as CustomEvent<IntegrationsSettings>).detail,
        loaded: true,
      });
    window.addEventListener(INTEGRATIONS_SETTINGS_EVENT, onChange);
    return () => {
      active = false;
      window.removeEventListener(INTEGRATIONS_SETTINGS_EVENT, onChange);
    };
  }, []);
  return state;
}
