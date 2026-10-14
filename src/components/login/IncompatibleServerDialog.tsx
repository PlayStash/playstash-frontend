import { Alert, AlertActions, AlertDescription, AlertTitle } from "@tw/alert";
import { Button } from "@tw/button";
import { useTranslation } from "@/i18n";
import { openExternalUrl } from "@/utils/tauri";
import { MIN_SERVER_VERSION, SERVER_RELEASES_URL } from "@/utils/serverVersion";

/**
 * Shown when the server is older than `MIN_SERVER_VERSION`; the login is
 * aborted (WPF "CLIENT-SERVER-INCOMPATIBILITY DETECTED").
 */
export function IncompatibleServerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert open={open} onClose={onClose} size="lg">
      <AlertTitle>{t("accounts.incompatible.title")}</AlertTitle>
      <AlertDescription>
        {t("accounts.incompatible.description").replace(
          "{version}",
          MIN_SERVER_VERSION,
        )}
      </AlertDescription>
      <AlertActions>
        <Button plain onClick={onClose}>
          {t("accounts.common.cancel")}
        </Button>
        <Button
          color="indigo"
          onClick={() => {
            void openExternalUrl(SERVER_RELEASES_URL);
            onClose();
          }}
        >
          {t("accounts.incompatible.update")}
        </Button>
      </AlertActions>
    </Alert>
  );
}
