import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { Button } from "@tw/button";
import { useTranslation } from "@/i18n";
import { showToast } from "@/components/login/confirm";

/**
 * "Copy API Key" in the user editor. Shown only when the server returned the
 * edited user's `api_key` (the server decides who may see it).
 */
export function CopyApiKeyButton({ apiKey }: { apiKey?: string | null }) {
  const { t } = useTranslation();
  if (apiKey === undefined || apiKey === null) return null;
  return (
    <Button
      type="button"
      outline
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(apiKey);
          showToast(t("accounts.apiKey.copied"));
        } catch (error) {
          showToast(
            error instanceof Error ? error.message : String(error),
            "danger",
          );
        }
      }}
    >
      <ClipboardDocumentIcon />
      {t("accounts.apiKey.copy")}
    </Button>
  );
}
