import { useEffect, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { Switch } from "@tw/switch";
import { Input } from "@tw/input";
import { Checkbox, CheckboxField } from "@tw/checkbox";
import { Label } from "@tw/fieldset";
import { Button } from "@/components/tailwind/button";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation } from "@/i18n";
import type { SettingsSectionProps } from "@/settings/types";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
} from "@/components/settings/SettingsPrimitives";
import {
  CLOUD_SAVES_CHANGE_EVENT,
  DEFAULT_CLOUD_SAVE_SETTINGS,
  formatTemplate,
  getCloudSaveSettings,
  getLudusaviStatus,
  setCloudSavesEnabled,
  setCustomManifests,
  setUsePrimaryManifest,
  type CloudSaveSettings as CloudSaveSettingsValue,
} from "@/utils/cloudSaves";

/** Settings → Integrations → Cloud Saves (desktop). */
export function CloudSaveSettings({ rowHighlight }: SettingsSectionProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const [settings, setSettings] = useState<CloudSaveSettingsValue>(
    DEFAULT_CLOUD_SAVE_SETTINGS,
  );
  const [rows, setRows] = useState<string[]>([]);
  const [toolMissing, setToolMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void getCloudSaveSettings()
      .then((value) => {
        setSettings(value);
        setRows(value.customManifests);
      })
      .catch(() => undefined);
    void getLudusaviStatus()
      .then((status) => setToolMissing(!status.available))
      .catch(() => undefined);
    const onChange = (event: Event) =>
      setSettings((event as CustomEvent<CloudSaveSettingsValue>).detail);
    window.addEventListener(CLOUD_SAVES_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CLOUD_SAVES_CHANGE_EVENT, onChange);
  }, []);

  const apply = async (update: () => Promise<CloudSaveSettingsValue>) => {
    try {
      setSettings(await update());
    } catch (error) {
      void showAlert({ title: String(error), tone: "danger" });
    }
  };

  const saveManifests = async () => {
    setSaving(true);
    try {
      const saved = await setCustomManifests(rows);
      setSettings(saved);
      setRows(saved.customManifests);
      void showAlert({
        title: t("cloudSaves.settings.saved"),
        tone: "success",
      });
    } catch (error) {
      void showAlert({ title: String(error), tone: "danger" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup
      id="setting-integrations-cloud-saves"
      caption={t("cloudSaves.settings.caption")}
      description={t("cloudSaves.settings.description")}
      className={rowHighlight("integrations-cloud-saves")}
    >
      <SettingsRow>
        <SettingsLabel
          title={t("cloudSaves.settings.sync")}
          description={
            toolMissing
              ? t("cloudSaves.status.toolMissing")
              : t("cloudSaves.settings.syncDescription")
          }
        />
        <Switch
          name="cloudSaves"
          color="indigo"
          aria-label={t("cloudSaves.settings.sync")}
          checked={settings.enabled}
          onChange={(enabled: boolean) =>
            void apply(() => setCloudSavesEnabled(enabled))
          }
        />
      </SettingsRow>
      <div
        id="setting-integrations-cloud-save-manifests"
        className={`space-y-3 px-4 py-3 ${rowHighlight("integrations-cloud-save-manifests")}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SettingsLabel title={t("cloudSaves.settings.manifests")} />
          <CheckboxField title={t("cloudSaves.settings.usePrimaryTooltip")}>
            <Checkbox
              color="indigo"
              name="usePrimaryManifest"
              checked={settings.usePrimaryManifest}
              onChange={(enabled: boolean) =>
                void apply(() => setUsePrimaryManifest(enabled))
              }
            />
            <Label>{t("cloudSaves.settings.usePrimary")}</Label>
          </CheckboxField>
        </div>
        {rows.length === 0 && (
          <p className="text-xs text-ps-muted">
            {t("cloudSaves.settings.noManifests")}
          </p>
        )}
        {rows.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={formatTemplate(
                t("cloudSaves.settings.manifestLabel"),
                {
                  n: index + 1,
                },
              )}
              placeholder={t("cloudSaves.settings.manifestPlaceholder")}
              value={value}
              onChange={(event) =>
                setRows((current) =>
                  current.map((entry, position) =>
                    position === index ? event.target.value : entry,
                  ),
                )
              }
            />
            <Button
              plain
              aria-label={t("cloudSaves.settings.remove")}
              title={t("cloudSaves.settings.remove")}
              onClick={() =>
                setRows((current) =>
                  current.filter((_, position) => position !== index),
                )
              }
            >
              <XMarkIcon />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            outline
            onClick={() => setRows((current) => [...current, ""])}
          >
            {t("cloudSaves.settings.add")}
          </Button>
          <Button
            color="indigo"
            disabled={saving}
            onClick={() => void saveManifests()}
          >
            {t("cloudSaves.settings.save")}
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
}
