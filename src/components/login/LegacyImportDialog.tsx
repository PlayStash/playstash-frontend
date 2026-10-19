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
import { useTranslation } from "@/i18n";
import {
  importLegacyData,
  scanLegacyData,
  type LegacyImportReport,
  type LegacyScan,
} from "@/utils/legacyImport";
import { LEGACY_INSTALLS_PENDING_KEY } from "@/utils/legacyInstalls";

type Phase = "scanning" | "review" | "importing" | "done" | "error";

/**
 * Imports profiles and settings of the previous (WPF) PlayStash client.
 * Windows only; values protected for another Windows user are skipped.
 */
export function LegacyImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: (report: LegacyImportReport | null) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("scanning");
  const [scan, setScan] = useState<LegacyScan | null>(null);
  const [report, setReport] = useState<LegacyImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Every opening starts a fresh scan.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPhase("scanning");
      setReport(null);
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    scanLegacyData()
      .then((result) => {
        if (cancelled) return;
        setScan(result);
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

  const runImport = async () => {
    if (!scan) return;
    setPhase("importing");
    try {
      const result = await importLegacyData(scan);
      setReport(result);
      if (result.roots.length) {
        try {
          localStorage.setItem(LEGACY_INSTALLS_PENDING_KEY, "1");
        } catch {
          /* storage unavailable */
        }
      }
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const skipped =
    phase === "done" ? (report?.skipped ?? []) : (scan?.skipped ?? []);

  return (
    <Dialog open={open} onClose={() => onClose(report)} size="xl">
      <DialogTitle>{t("accounts.legacy.title")}</DialogTitle>
      <DialogDescription>{t("accounts.legacy.description")}</DialogDescription>
      <DialogBody className="space-y-3">
        {(phase === "scanning" || phase === "importing") && <Spinner />}
        {phase === "review" && scan && (
          <Text>
            {scan.profiles.length
              ? t("accounts.legacy.found").replace(
                  "{count}",
                  String(scan.profiles.length),
                )
              : t("accounts.legacy.none")}
          </Text>
        )}
        {phase === "done" && report && (
          <Text>
            {t("accounts.legacy.done")
              .replace("{profiles}", String(report.profiles))
              .replace("{sessions}", String(report.sessionsRestored))}
          </Text>
        )}
        {phase === "done" && report?.roots.length ? (
          <Text>{t("accounts.legacy.installsLater")}</Text>
        ) : null}
        {skipped.length > 0 && (phase === "review" || phase === "done") && (
          <details className="text-sm text-ps-muted">
            <summary className="cursor-pointer">
              {t("accounts.legacy.skipped").replace(
                "{count}",
                String(skipped.length),
              )}
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {skipped.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </details>
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
        {phase === "review" && scan?.profiles.length ? (
          <>
            <Button plain onClick={() => onClose(null)}>
              {t("accounts.common.cancel")}
            </Button>
            <Button color="indigo" onClick={() => void runImport()}>
              {t("accounts.legacy.import")}
            </Button>
          </>
        ) : (
          <Button
            color="indigo"
            disabled={phase === "scanning" || phase === "importing"}
            onClick={() => onClose(report)}
          >
            {t("accounts.common.close")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
