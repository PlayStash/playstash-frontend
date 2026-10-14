import { useState } from "react";
import { Button } from "@/components/tailwind/button";
import { Switch } from "@/components/tailwind/switch";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useAuth } from "@/context/AuthContext";
import { useIgnoreList } from "@/context/IgnoreListContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useTranslation } from "@/i18n";
import type { SettingsSectionProps } from "@/settings/types";
import { getErrorMessage } from "@/utils/apiError";
import {
  openFullscreenLibrary,
  setBigPictureOnStart,
  useBigPictureOnStart,
} from "@/utils/bigPictureInstalled";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
} from "./SettingsPrimitives";

/** The server's default ignore list: a JSON string array, empties removed. */
export function parseIgnoreFile(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Settings → Games (desktop): reset the ignored executables to the server
 * default and the fullscreen library (Big Picture) start option.
 */
export function GamesLaunchSettings({ rowHighlight }: SettingsSectionProps) {
  const { t } = useTranslation();
  const { serverUrl, authFetch } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { setIgnoreList } = useIgnoreList();
  const { showAlert } = useAlertDialog();
  const openOnStart = useBigPictureOnStart();
  const [resetting, setResetting] = useState(false);

  const resetIgnoreList = async () => {
    setResetting(true);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const response = await authFetch(`${base}/api/progresses/ignorefile`);
      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, t("ignoreList.resetFailed")),
        );
      }
      await setIgnoreList(parseIgnoreFile(await response.json()));
      void showAlert({ title: t("ignoreList.resetDone") });
    } catch (error) {
      void showAlert({
        title: t("ignoreList.resetFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <SettingsGroup
        id="setting-games-ignore-list-reset"
        className={rowHighlight("games-ignore-list-reset")}
        caption={t("ignoreList.caption")}
      >
        <SettingsRow>
          <SettingsLabel
            title={t("ignoreList.resetTitle")}
            description={t("ignoreList.resetDescription")}
          />
          <Button
            outline
            onClick={() => void resetIgnoreList()}
            disabled={resetting || !isOnline || !serverUrl}
          >
            {t("ignoreList.reset")}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        id="setting-games-fullscreen-library"
        className={rowHighlight("games-fullscreen-library")}
        caption={t("fullscreenLibrary.caption")}
      >
        <SettingsRow>
          <SettingsLabel
            title={t("fullscreenLibrary.onStart")}
            description={t("fullscreenLibrary.onStartDescription")}
          />
          <Switch
            name="bigPictureOnStart"
            color="indigo"
            aria-label={t("fullscreenLibrary.onStart")}
            checked={openOnStart}
            onChange={(value: boolean) => setBigPictureOnStart(value)}
          />
        </SettingsRow>
        <SettingsRow>
          <SettingsLabel title={t("fullscreenLibrary.open")} />
          <Button
            outline
            onClick={() => void openFullscreenLibrary().catch(() => undefined)}
          >
            {t("fullscreenLibrary.open")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
