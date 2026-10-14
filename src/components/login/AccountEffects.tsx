import { useEffect, useRef, useState } from "react";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useTranslation } from "@/i18n";
import { isTauriApp } from "@/utils/tauri";
import {
  getProfilesState,
  loadProfiles,
  updateProfiles,
} from "@/utils/profiles";
import { isLegacyImportAvailable } from "@/utils/legacyImport";
import { LEGACY_INSTALLS_PENDING_KEY } from "@/utils/legacyInstalls";
import { LegacyImportDialog } from "@/components/login/LegacyImportDialog";
import { LegacyInstallsDialog } from "@/components/login/LegacyInstallsDialog";

/**
 * Connection notices (WPF app bar): "back online" when the server becomes
 * reachable again, and "offline mode" when the app started without the
 * server. Desktop only (offline mode exists only there).
 */
export function ConnectionNotices() {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const { isOnline } = useOnlineStatus();
  const { offlineBootstrap, auth } = useAuth();
  const wasOnline = useRef(isOnline);
  const announcedOffline = useRef(false);

  useEffect(() => {
    if (!isTauriApp()) return;
    if (offlineBootstrap && !announcedOffline.current) {
      announcedOffline.current = true;
      void showAlert({
        title: t("accounts.connection.offline"),
        tone: "warning",
      });
    }
  }, [offlineBootstrap, showAlert, t]);

  useEffect(() => {
    if (!isTauriApp()) return;
    if (isOnline && !wasOnline.current && auth) {
      void showAlert({
        title: t("accounts.connection.online"),
        tone: "success",
      });
    }
    wasOnline.current = isOnline;
  }, [isOnline, auth, showAlert, t]);

  return null;
}

/**
 * First run on Windows: offer to import the previous (WPF) client's profiles
 * and settings, once.
 */
export function LegacyImportPrompt() {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const [open, setOpen] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    if (!isTauriApp() || asked.current) return;
    asked.current = true;
    void (async () => {
      await loadProfiles();
      if (getProfilesState().legacyImportOffered) return;
      if (!(await isLegacyImportAvailable())) return;
      const accepted = await showAlert({
        title: t("accounts.legacy.offer"),
        description: t("accounts.legacy.offerDescription"),
        affirmativeText: t("accounts.common.yes"),
        negativeText: t("accounts.common.no"),
      });
      await updateProfiles((state) => ({
        ...state,
        legacyImportOffered: true,
      }));
      if (accepted) setOpen(true);
    })();
  }, [showAlert, t]);

  return <LegacyImportDialog open={open} onClose={() => setOpen(false)} />;
}

/** After an import: offer the legacy installations once the user is logged in. */
export function LegacyInstallsPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isTauriApp() || !user) return;
    try {
      if (localStorage.getItem(LEGACY_INSTALLS_PENDING_KEY) === "1")
        setOpen(true);
    } catch {
      /* storage unavailable */
    }
  }, [user]);

  return (
    <LegacyInstallsDialog
      open={open}
      onClose={() => {
        try {
          localStorage.removeItem(LEGACY_INSTALLS_PENDING_KEY);
        } catch {
          /* storage unavailable */
        }
        setOpen(false);
      }}
    />
  );
}
