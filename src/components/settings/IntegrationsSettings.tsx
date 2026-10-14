import { useEffect, useRef, useState } from "react";
import { Switch } from "@tw/switch";
import { Input } from "@tw/input";
import { Button } from "@/components/tailwind/button";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
} from "@/components/settings/SettingsPrimitives";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation } from "@/i18n";
import type { SettingsSectionProps } from "@/settings/types";
import {
  updateIntegrationsSettings,
  useIntegrationsSettings,
} from "@/utils/integrationsSettings";
import { openExternalUrl } from "@/utils/tauri";

export const PLAYNITE_EXTENSION_URL =
  "https://github.com/PlayStash/playstash-playnite-integration";

/** Saving the Discord id waits for a typing pause (WPF saved per keystroke). */
const DISCORD_ID_SAVE_DELAY_MS = 500;

async function invokeSteam<T>(command: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command);
}

/** Settings → Integrations: Steam shortcuts, Discord presence, Playnite. */
export default function IntegrationsSettings({
  rowHighlight,
}: SettingsSectionProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const { settings, loaded } = useIntegrationsSettings();
  const [discordId, setDiscordId] = useState(settings.discordApplicationId);
  const editedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show the stored id once loaded, unless the user is typing.
  useEffect(() => {
    if (!editedRef.current) setDiscordId(settings.discordApplicationId);
  }, [settings.discordApplicationId]);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const save = (patch: Parameters<typeof updateIntegrationsSettings>[0]) =>
    updateIntegrationsSettings(patch).catch((error) => {
      void showAlert({
        title: t("integrations.saveFailed"),
        description: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    });

  const onDiscordIdChange = (value: string) => {
    editedRef.current = true;
    setDiscordId(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void save({ discordApplicationId: value }).finally(() => {
        editedRef.current = false;
      });
    }, DISCORD_ID_SAVE_DELAY_MS);
  };

  const onSteamToggle = async (enabled: boolean) => {
    await save({ syncSteamShortcuts: enabled });
    // Turning the sync on syncs right away (the background sync mounts);
    // turning it off removes every PlayStash shortcut.
    if (!enabled)
      await invokeSteam<number>("steam_remove_shortcuts").catch((error) =>
        console.warn("Removing Steam shortcuts failed:", error),
      );
  };

  const onRestoreBackup = async () => {
    const confirmed = await showAlert({
      title: t("integrations.steam.restoreTitle"),
      description: t("integrations.steam.restoreConfirm"),
      affirmativeText: t("integrations.steam.restore"),
      negativeText: t("integrations.cancel"),
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      const restored = await invokeSteam<boolean>("steam_restore_backup");
      void showAlert({
        title: restored
          ? t("integrations.steam.restored")
          : t("integrations.steam.noBackup"),
        tone: restored ? "success" : "warning",
      });
    } catch (error) {
      void showAlert({
        title: t("integrations.steam.restoreFailed"),
        description: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    }
  };

  return (
    <>
      <SettingsGroup
        caption={t("integrations.steam.caption")}
        description={t("integrations.steam.description")}
      >
        <SettingsRow
          id="setting-integrations-steam-shortcuts"
          className={rowHighlight("integrations-steam-shortcuts")}
        >
          <SettingsLabel title={t("integrations.steam.sync")} />
          <Switch
            name="syncSteamShortcuts"
            color="indigo"
            aria-label={t("integrations.steam.sync")}
            checked={settings.syncSteamShortcuts}
            disabled={!loaded}
            onChange={(value: boolean) => void onSteamToggle(value)}
          />
        </SettingsRow>
        <SettingsRow
          id="setting-integrations-steam-restore"
          className={rowHighlight("integrations-steam-restore")}
        >
          <SettingsLabel
            title={t("integrations.steam.restoreTitle")}
            description={t("integrations.steam.restoreDescription")}
          />
          <Button color="red" onClick={() => void onRestoreBackup()}>
            {t("integrations.steam.restore")}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        caption={t("integrations.discord.caption")}
        description={t("integrations.discord.description")}
      >
        <SettingsRow
          id="setting-integrations-discord-id"
          className={rowHighlight("integrations-discord-id")}
        >
          <SettingsLabel title={t("integrations.discord.applicationId")} />
          <div className="w-full max-w-xs">
            <Input
              name="discordApplicationId"
              inputMode="numeric"
              autoComplete="off"
              aria-label={t("integrations.discord.applicationId")}
              placeholder={t("integrations.discord.applicationId")}
              value={discordId}
              disabled={!loaded}
              onChange={(event) => onDiscordIdChange(event.target.value)}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          id="setting-integrations-discord-presence"
          className={rowHighlight("integrations-discord-presence")}
        >
          <SettingsLabel title={t("integrations.discord.sync")} />
          <Switch
            name="syncDiscordPresence"
            color="indigo"
            aria-label={t("integrations.discord.sync")}
            checked={settings.syncDiscordPresence}
            disabled={!loaded}
            onChange={(value: boolean) =>
              void save({ syncDiscordPresence: value })
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup caption={t("integrations.playnite.caption")}>
        <SettingsRow
          id="setting-integrations-playnite"
          className={rowHighlight("integrations-playnite")}
        >
          <SettingsLabel title={t("integrations.playnite.description")} />
          <Button
            outline
            onClick={() => void openExternalUrl(PLAYNITE_EXTENSION_URL)}
          >
            {t("integrations.playnite.link")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
