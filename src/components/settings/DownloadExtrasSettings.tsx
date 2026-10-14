import { useEffect, useState } from "react";
import { Input } from "@tw/input";
import { Switch } from "@tw/switch";
import { Button } from "@tw/button";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation } from "@/i18n";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
} from "@/components/settings/SettingsPrimitives";
import type { SettingsSectionProps } from "@/settings/types";
import {
  getDefaultExtractionPassword,
  setDefaultExtractionPassword,
} from "@/utils/extractionPassword";
import {
  DOWNLOAD_PREFERENCES_EVENT,
  getMountIsoEnabled,
  setMountIsoEnabled,
} from "@/utils/downloadPreferences";

/**
 * Downloads → "Extraction" extras (WP5): the default extraction password
 * (kept encrypted) and "Mount ISO instead of extracting".
 */
export function DownloadExtrasSettings({ rowHighlight }: SettingsSectionProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [mountIso, setMountIso] = useState(getMountIsoEnabled);

  useEffect(() => {
    let cancelled = false;
    void getDefaultExtractionPassword().then((value) => {
      if (!cancelled) setPassword(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sync = () => setMountIso(getMountIsoEnabled());
    window.addEventListener(DOWNLOAD_PREFERENCES_EVENT, sync);
    return () => window.removeEventListener(DOWNLOAD_PREFERENCES_EVENT, sync);
  }, []);

  const savePassword = async () => {
    setSaving(true);
    try {
      await setDefaultExtractionPassword(password);
      void showAlert({ title: t("wp5.settings.passwordSaved") });
    } catch (error) {
      void showAlert({
        title: t("wp5.settings.passwordSaveFailed"),
        description: String(error),
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup caption={t("wp5.settings.extraction")}>
      <div
        id="setting-downloads-default-extraction-password"
        className={rowHighlight("downloads-default-extraction-password")}
      >
        <SettingsRow className="flex-wrap gap-y-2">
          <SettingsLabel
            title={t("wp5.settings.passwordTitle")}
            description={t("wp5.settings.passwordDescription")}
          />
          <form
            className="flex w-full items-center gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              void savePassword();
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              aria-label={t("wp5.settings.passwordTitle")}
              placeholder={t("wp5.settings.passwordPlaceholder")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="sm:w-56"
            />
            <Button type="submit" outline disabled={saving}>
              {t("wp5.settings.save")}
            </Button>
          </form>
        </SettingsRow>
      </div>
      <div
        id="setting-downloads-mount-iso"
        className={rowHighlight("downloads-mount-iso")}
      >
        <SettingsRow>
          <SettingsLabel
            title={t("wp5.settings.mountIsoTitle")}
            description={t("wp5.settings.mountIsoDescription")}
          />
          <Switch
            name="mountIso"
            color="indigo"
            aria-label={t("wp5.settings.mountIsoTitle")}
            checked={mountIso}
            onChange={(enabled: boolean) => {
              setMountIso(enabled);
              setMountIsoEnabled(enabled);
            }}
          />
        </SettingsRow>
      </div>
    </SettingsGroup>
  );
}

export default DownloadExtrasSettings;
