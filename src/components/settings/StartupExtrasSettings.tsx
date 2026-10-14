import { useEffect, useState } from "react";
import { BookOpenIcon, MusicalNoteIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/tailwind/button";
import { Switch } from "@/components/tailwind/switch";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
  SettingsSectionHeader,
} from "@/components/settings/SettingsPrimitives";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation } from "@/i18n";
import type { SettingsSectionProps } from "@/settings/types";
import {
  getLibraryAutoload,
  getLibraryRetain,
  setLibraryAutoload,
  setLibraryRetain,
} from "@/utils/libraryPreferences";
import {
  clearStartupSound,
  getStartupSound,
  setStartupSound,
  STARTUP_SOUND_EXTENSIONS,
  STARTUP_SOUND_MAX_BYTES,
} from "@/utils/startupSound";

/** Startup category: library startup behaviour (all platforms). */
export function LibraryStartupSettings({ rowHighlight }: SettingsSectionProps) {
  const { t } = useTranslation();
  const [autoload, setAutoload] = useState(getLibraryAutoload);
  const [retain, setRetain] = useState(getLibraryRetain);

  return (
    <>
      <SettingsSectionHeader
        icon={BookOpenIcon}
        title={t("startup.library.title")}
        description={t("startup.library.description")}
      />
      <SettingsGroup
        id="setting-startup-library-autoload"
        className={rowHighlight("startup-library-autoload")}
      >
        <SettingsRow>
          <SettingsLabel
            title={t("startup.autoload.title")}
            description={t("startup.autoload.description")}
          />
          <Switch
            name="libraryAutoload"
            color="indigo"
            aria-label={t("startup.autoload.title")}
            checked={autoload}
            onChange={(value: boolean) => {
              setAutoload(value);
              setLibraryAutoload(value);
            }}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        id="setting-startup-library-retain"
        className={rowHighlight("startup-library-retain")}
      >
        <SettingsRow>
          <SettingsLabel
            title={t("startup.retain.title")}
            description={t("startup.retain.description")}
          />
          <Switch
            name="libraryRetain"
            color="indigo"
            aria-label={t("startup.retain.title")}
            checked={retain}
            onChange={(value: boolean) => {
              setRetain(value);
              setLibraryRetain(value);
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

/** Startup category: startup sound (desktop). */
export function StartupSoundSettings({ rowHighlight }: SettingsSectionProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const [sound, setSound] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStartupSound()
      .then((value) => {
        if (!cancelled) setSound(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        filters: [
          {
            name: t("startup.sound.audio"),
            extensions: [...STARTUP_SOUND_EXTENSIONS],
          },
        ],
      });
      if (typeof picked !== "string") return;
      try {
        const { stat } = await import("@tauri-apps/plugin-fs");
        const info = await stat(picked);
        if (info.size > STARTUP_SOUND_MAX_BYTES) {
          void showAlert({ title: t("startup.sound.tooLarge") });
          return;
        }
      } catch {
        // the Rust side validates the size again
      }
      await setStartupSound(picked);
      setSound(picked);
      void showAlert({ title: t("startup.sound.selected") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void showAlert({
        title: message.includes("20 MB")
          ? t("startup.sound.tooLarge")
          : message,
      });
    }
  };

  const disable = async () => {
    try {
      await clearStartupSound();
      setSound(null);
      void showAlert({ title: t("startup.sound.disabled") });
    } catch (error) {
      void showAlert({
        title: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <SettingsGroup
      id="setting-startup-sound"
      className={rowHighlight("startup-sound")}
      caption={t("startup.sound.caption")}
    >
      <SettingsRow className="flex-wrap">
        <SettingsLabel
          title={t("startup.sound.title")}
          description={
            sound ? sound.split(/[/\\]/).pop() : t("startup.sound.description")
          }
        />
        <div className="flex shrink-0 gap-2">
          <Button outline onClick={() => void choose()}>
            <MusicalNoteIcon className="size-4" />
            {t("startup.sound.choose")}
          </Button>
          <Button outline disabled={!sound} onClick={() => void disable()}>
            {t("startup.sound.disable")}
          </Button>
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}
