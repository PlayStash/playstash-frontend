import { useEffect, useState } from "react";
import { Button } from "@tw/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@tw/dialog";
import { Text } from "@tw/text";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "@/i18n";
import {
  adoptLegacyInstallations,
  scanLegacyInstallations,
  type AdoptionMode,
  type AdoptionResult,
  type LegacyInstallation,
} from "@/utils/legacyInstalls";

type Phase = "scanning" | "review" | "adopting" | "done" | "error";

/**
 * "Adopt N legacy installations": games installed by the WPF client are moved
 * (or linked in place) into the current folder layout so they show as
 * installed. Needs a login to resolve the server versions.
 */
export function LegacyInstallsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { serverUrl, authFetch } = useAuth();
  const [phase, setPhase] = useState<Phase>("scanning");
  const [installations, setInstallations] = useState<LegacyInstallation[]>([]);
  const [result, setResult] = useState<AdoptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase("scanning");
    setResult(null);
    setError(null);
    scanLegacyInstallations()
      .then((found) => {
        if (cancelled) return;
        setInstallations(found);
        setPhase("review");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const adopt = async (mode: AdoptionMode) => {
    setPhase("adopting");
    try {
      setResult(
        await adoptLegacyInstallations(installations, mode, {
          serverUrl,
          authFetch,
        }),
      );
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="xl">
      <DialogTitle>
        {t("accounts.legacyInstalls.title").replace(
          "{count}",
          String(installations.length),
        )}
      </DialogTitle>
      <DialogDescription>
        {t("accounts.legacyInstalls.description")}
      </DialogDescription>
      <DialogBody className="space-y-3">
        {(phase === "scanning" || phase === "adopting") && <Spinner />}
        {phase === "review" && (
          <>
            {installations.length ? (
              <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-ps-text">
                {installations.map((installation) => (
                  <li key={installation.path}>{installation.title}</li>
                ))}
              </ul>
            ) : (
              <Text>{t("accounts.legacyInstalls.none")}</Text>
            )}
            {installations.length > 0 && (
              <Text>{t("accounts.legacyInstalls.modes")}</Text>
            )}
          </>
        )}
        {phase === "done" && result && (
          <>
            <Text>
              {t("accounts.legacyInstalls.done").replace(
                "{count}",
                String(result.adopted.length),
              )}
            </Text>
            {result.skipped.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-ps-muted">
                {result.skipped.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {phase === "error" && (
          <div
            className="rounded-2xl bg-rose-500/10 px-3 py-2 text-sm text-rose-500"
            role="alert"
          >
            {error}
          </div>
        )}
      </DialogBody>
      <DialogActions>
        {phase === "review" && installations.length > 0 ? (
          <>
            <Button plain onClick={onClose}>
              {t("accounts.common.cancel")}
            </Button>
            <Button outline onClick={() => void adopt("link")}>
              {t("accounts.legacyInstalls.keep")}
            </Button>
            <Button color="indigo" onClick={() => void adopt("move")}>
              {t("accounts.legacyInstalls.move")}
            </Button>
          </>
        ) : (
          <Button
            color="indigo"
            disabled={phase === "scanning" || phase === "adopting"}
            onClick={onClose}
          >
            {t("accounts.common.close")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
