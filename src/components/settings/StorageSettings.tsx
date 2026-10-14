import { useCallback, useEffect, useState } from "react";
import {
  CircleStackIcon,
  FolderOpenIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/tailwind/button";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
  SettingsSectionHeader,
} from "@/components/settings/SettingsPrimitives";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useInstalledGames } from "@/hooks/useInstalledGames";
import { useTranslation } from "@/i18n";
import type { SettingsSectionProps } from "@/settings/types";
import { clearImageCache } from "@/utils/mediaCache";
import { formatCacheSize } from "@/utils/cacheSize";

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

/** Bytes used by the browser image cache (IndexedDB), best effort. */
async function browserCacheBytes(): Promise<number> {
  try {
    const estimate = (await navigator.storage?.estimate?.()) as
      (StorageEstimate & { usageDetails?: { indexedDB?: number } }) | undefined;
    return estimate?.usageDetails?.indexedDB ?? estimate?.usage ?? 0;
  } catch {
    return 0;
  }
}

/** Storage category: cache sizes and clearing (Data tab of the WPF app). */
export function StorageSettings({
  rowHighlight,
  isTauri,
}: SettingsSectionProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const { installedGames } = useInstalledGames();
  const [imageBytes, setImageBytes] = useState<number | null>(null);
  const [offlineBytes, setOfflineBytes] = useState<number | null>(null);

  const refreshSizes = useCallback(async () => {
    let native = { imageBytes: 0, offlineBytes: 0 };
    if (isTauri) {
      try {
        native = await invoke<{ imageBytes: number; offlineBytes: number }>(
          "storage_cache_sizes",
        );
      } catch {
        // simulated desktop mode
      }
    }
    setImageBytes((await browserCacheBytes()) + native.imageBytes);
    setOfflineBytes(native.offlineBytes);
  }, [isTauri]);

  useEffect(() => {
    void refreshSizes();
  }, [refreshSizes]);

  const clearImages = async () => {
    try {
      await clearImageCache();
      void showAlert({ title: t("storage.imageCache.cleared") });
    } catch {
      void showAlert({ title: t("storage.imageCache.failed"), tone: "danger" });
    }
    void refreshSizes();
  };

  const clearOffline = async () => {
    const confirmed = await showAlert({
      title: t("storage.offlineCache.title"),
      description: t("storage.offlineCache.confirm"),
      affirmativeText: t("storage.yes"),
      negativeText: t("storage.no"),
      tone: "warning",
    });
    if (!confirmed) return;
    const all = await showAlert({
      title: t("storage.offlineCache.installedTitle"),
      description: t("storage.offlineCache.installedConfirm"),
      affirmativeText: t("storage.offlineCache.installedAll"),
      negativeText: t("storage.offlineCache.installedKeep"),
      tone: "warning",
    });
    try {
      await invoke<number>("storage_clear_offline_cache", {
        keepGameIds: installedGames.map((game) => game.gameId),
        all,
      });
      void showAlert({ title: t("storage.offlineCache.cleared") });
    } catch {
      void showAlert({
        title: t("storage.offlineCache.failed"),
        tone: "danger",
      });
    }
    void refreshSizes();
  };

  return (
    <>
      <SettingsSectionHeader
        icon={CircleStackIcon}
        title={t("storage.title")}
        description={t("storage.description")}
      />
      <SettingsGroup
        id="setting-storage-image-cache"
        className={rowHighlight("storage-image-cache")}
        caption={t("storage.caption")}
      >
        <SettingsRow>
          <SettingsLabel
            title={`${t("storage.imageCache.title")} ${formatCacheSize(imageBytes)}`}
            description={t("storage.imageCache.description")}
          />
          <Button outline onClick={() => void clearImages()}>
            <TrashIcon className="size-4" />
            {t("storage.imageCache.clear")}
          </Button>
        </SettingsRow>
        {isTauri && (
          <SettingsRow id="setting-storage-offline-cache">
            <SettingsLabel
              title={`${t("storage.offlineCache.label")} ${formatCacheSize(offlineBytes)}`}
              description={t("storage.offlineCache.description")}
            />
            <Button outline onClick={() => void clearOffline()}>
              <TrashIcon className="size-4" />
              {t("storage.offlineCache.clear")}
            </Button>
          </SettingsRow>
        )}
      </SettingsGroup>
    </>
  );
}

/** Developer category: open the app data ("user cache") folder (desktop). */
export function UserCacheFolderSettings({
  rowHighlight,
}: SettingsSectionProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  return (
    <SettingsGroup
      id="setting-developer-user-cache-folder"
      className={rowHighlight("developer-user-cache-folder")}
    >
      <SettingsRow>
        <SettingsLabel
          title={t("storage.userCacheFolder.title")}
          description={t("storage.userCacheFolder.description")}
        />
        <Button
          outline
          onClick={async () => {
            try {
              const dir = await invoke<string>("storage_app_data_dir");
              await invoke("open_in_file_explorer", { path: dir });
            } catch (error) {
              void showAlert({
                title: error instanceof Error ? error.message : String(error),
                tone: "danger",
              });
            }
          }}
        >
          <FolderOpenIcon className="size-4" />
          {t("storage.userCacheFolder.open")}
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}
