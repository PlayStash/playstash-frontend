import { useState } from "react";
import { useNavigate } from "react-router";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@tw/alert";
import { Button } from "@tw/button";
import { useAuth } from "@/context/AuthContext";
import { useProfiles } from "@/context/ProfilesContext";
import { useTranslation } from "@/i18n";
import type { SettingsSectionProps } from "@/settings/types";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
} from "@/components/settings/SettingsPrimitives";
import { ClientSettingsDialog } from "@/components/login/ClientSettingsDialog";
import { LegacyImportDialog } from "@/components/login/LegacyImportDialog";
import { LegacyInstallsDialog } from "@/components/login/LegacyInstallsDialog";
import { confirmAction, showToast } from "@/components/login/confirm";
import {
  CONNECTION_FILE_FILTER,
  CONNECTION_FILE_NAME,
  buildConnectionFile,
  readDefaultArchivePassword,
  serializeConnectionFile,
} from "@/utils/connectionFile";

type PasswordChoice = "yes" | "no" | "cancel";

/**
 * Settings → Account: change profile, logout (this device / all devices),
 * client settings, connection export and the legacy client import.
 */
export default function AccountSettings({
  rowHighlight,
  isTauri,
}: SettingsSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serverUrl, logout, logoutAllDevices } = useAuth();
  const profiles = useProfiles();
  const [busy, setBusy] = useState<string | null>(null);
  const [clientSettingsOpen, setClientSettingsOpen] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [legacyInstallsOpen, setLegacyInstallsOpen] = useState(false);
  const [passwordQuestion, setPasswordQuestion] = useState<
    ((choice: PasswordChoice) => void) | null
  >(null);
  const isWindows =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

  const handleChangeProfile = async () => {
    setBusy("change");
    try {
      await profiles.changeProfile();
      navigate("/", { replace: true });
    } finally {
      setBusy(null);
    }
  };

  const handleLogout = async (allDevices: boolean) => {
    const confirmed = await confirmAction({
      title: allDevices
        ? t("accounts.logout.allConfirm")
        : t("accounts.logout.confirm"),
      affirmativeText: t("accounts.common.yes"),
      negativeText: t("accounts.common.no"),
    });
    if (!confirmed) return;
    setBusy(allDevices ? "all" : "device");
    try {
      // A failed revoke is reported by the auth context; the local logout
      // always completes.
      await (allDevices ? logoutAllDevices() : logout());
      navigate("/", { replace: true });
    } finally {
      setBusy(null);
    }
  };

  const askIncludePassword = () =>
    new Promise<PasswordChoice>((resolve) => {
      setPasswordQuestion(() => (choice: PasswordChoice) => {
        setPasswordQuestion(null);
        resolve(choice);
      });
    });

  const handleExport = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: CONNECTION_FILE_NAME,
        filters: [CONNECTION_FILE_FILTER],
      });
      if (!path) return;
      const choice = await askIncludePassword();
      if (choice === "cancel") return;
      const password =
        choice === "yes" ? ((await readDefaultArchivePassword()) ?? "") : null;
      const file = buildConnectionFile(serverUrl, password);
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("fs_write_text_file", {
        path,
        content: serializeConnectionFile(file),
      });
      showToast(t("accounts.connection.exported"));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "danger");
    }
  };

  return (
    <>
      <SettingsGroup
        id="setting-account-session"
        caption={t("accounts.settings.session")}
        className={rowHighlight("account-session")}
      >
        {isTauri && profiles.enabled && (
          <SettingsRow>
            <SettingsLabel
              title={t("accounts.settings.changeProfile")}
              description={t("accounts.settings.changeProfileDescription")}
            />
            <Button
              outline
              disabled={!!busy}
              onClick={() => void handleChangeProfile()}
            >
              {t("accounts.settings.changeProfile")}
            </Button>
          </SettingsRow>
        )}
        <SettingsRow>
          <SettingsLabel
            title={t("accounts.logout.device")}
            description={t("accounts.logout.deviceDescription")}
          />
          <Button
            color="red"
            disabled={!!busy}
            onClick={() => void handleLogout(false)}
          >
            {t("accounts.logout.device")}
          </Button>
        </SettingsRow>
        <SettingsRow>
          <SettingsLabel
            title={t("accounts.logout.all")}
            description={t("accounts.logout.allDescription")}
          />
          <Button
            color="red"
            disabled={!!busy}
            onClick={() => void handleLogout(true)}
          >
            {t("accounts.logout.all")}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {isTauri && (
        <SettingsGroup
          id="setting-account-connection"
          caption={t("accounts.settings.connection")}
          className={rowHighlight("account-connection")}
        >
          <SettingsRow id="setting-account-headers">
            <SettingsLabel
              title={t("accounts.headers.title")}
              description={t("accounts.headers.description")}
            />
            <Button outline onClick={() => setClientSettingsOpen(true)}>
              {t("accounts.settings.edit")}
            </Button>
          </SettingsRow>
          <SettingsRow id="setting-account-export">
            <SettingsLabel
              title={t("accounts.connection.export")}
              description={t("accounts.connection.exportDescription")}
            />
            <Button outline onClick={() => void handleExport()}>
              {t("accounts.connection.exportButton")}
            </Button>
          </SettingsRow>
        </SettingsGroup>
      )}

      {isTauri && isWindows && (
        <SettingsGroup
          id="setting-account-legacy"
          caption={t("accounts.legacy.caption")}
          className={rowHighlight("account-legacy")}
        >
          <SettingsRow>
            <SettingsLabel
              title={t("accounts.legacy.title")}
              description={t("accounts.legacy.description")}
            />
            <Button outline onClick={() => setLegacyOpen(true)}>
              {t("accounts.legacy.import")}
            </Button>
          </SettingsRow>
          <SettingsRow>
            <SettingsLabel
              title={t("accounts.legacyInstalls.settingsTitle")}
              description={t("accounts.legacyInstalls.description")}
            />
            <Button outline onClick={() => setLegacyInstallsOpen(true)}>
              {t("accounts.legacyInstalls.open")}
            </Button>
          </SettingsRow>
        </SettingsGroup>
      )}

      {isTauri && (
        <>
          <ClientSettingsDialog
            open={clientSettingsOpen}
            onClose={() => setClientSettingsOpen(false)}
            onSaved={(text) => showToast(text)}
          />
          <LegacyImportDialog
            open={legacyOpen}
            onClose={() => setLegacyOpen(false)}
          />
          <LegacyInstallsDialog
            open={legacyInstallsOpen}
            onClose={() => setLegacyInstallsOpen(false)}
          />
          <Alert
            open={!!passwordQuestion}
            onClose={() => passwordQuestion?.("cancel")}
          >
            <AlertTitle>{t("accounts.connection.exportTitle")}</AlertTitle>
            <AlertDescription className="whitespace-pre-line">
              {t("accounts.connection.includePassword")}
            </AlertDescription>
            <AlertActions>
              <Button plain onClick={() => passwordQuestion?.("cancel")}>
                {t("accounts.common.cancel")}
              </Button>
              <Button outline onClick={() => passwordQuestion?.("yes")}>
                {t("accounts.common.yes")}
              </Button>
              <Button
                color="indigo"
                autoFocus
                onClick={() => passwordQuestion?.("no")}
              >
                {t("accounts.common.no")}
              </Button>
            </AlertActions>
          </Alert>
        </>
      )}
    </>
  );
}
