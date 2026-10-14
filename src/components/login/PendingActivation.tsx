import { useEffect, useRef } from "react";
import { Button } from "@tw/button";
import { Heading } from "@tw/heading";
import { Text } from "@tw/text";
import { Spinner } from "@/components/Spinner";
import { useTranslation } from "@/i18n";

/** How often the login is retried while an account waits for approval (WPF: 5 s). */
export const ACTIVATION_POLL_MS = 5_000;

export type ActivationPollResult = "activated" | "pending" | "failed";

/**
 * "Your Account is pending Admin Approval" (HTTP 406). Retries the login every
 * 5 seconds while the screen is shown; a successful login continues it.
 */
export function PendingActivation({
  poll,
  onCancel,
}: {
  /** Retries the login. Resolves "activated" on success. */
  poll: () => Promise<ActivationPollResult>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        const result = await pollRef
          .current()
          .catch(() => "failed" as ActivationPollResult);
        if (!cancelled && result === "pending") schedule();
      }, ACTIVATION_POLL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div
      className="grid w-full max-w-sm grid-cols-1 gap-6"
      role="status"
      aria-live="polite"
    >
      <Heading>{t("accounts.pending.title")}</Heading>
      <Text>{t("accounts.pending.description")}</Text>
      <div className="flex justify-center py-2">
        <Spinner label={t("accounts.pending.checking")} />
      </div>
      <Button outline onClick={onCancel}>
        {t("accounts.common.back")}
      </Button>
    </div>
  );
}
