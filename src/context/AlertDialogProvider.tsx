import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import {
  CheckIcon,
  ClipboardIcon,
  CommandLineIcon,
} from "@heroicons/react/24/outline";
import {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertBody,
  AlertActions,
} from "@tw/alert";
import { Button } from "@tw/button";
import { Toast } from "@tw/toast";
import { isTauriApp } from "@/utils/tauri";
import { translate, useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import {
  AlertDialogContext,
  useAlertDialog,
  type AlertDialogContextValue,
  type AlertDialogRequest,
} from "@/context/AlertDialogContext";

/**
 * Terminal-style block that shows raw process output with a copy button.
 */
function ConsoleOutput({ log }: { log: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); keep the button inert.
    }
  }, [log]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <AlertBody>
      <div className="flex items-center gap-2 rounded-t-lg border border-b-0 border-zinc-200 bg-zinc-950 px-3 py-2 dark:border-zinc-800">
        <CommandLineIcon className="size-3.5 text-zinc-400" />
        <span className="text-xs font-medium tracking-wide text-zinc-400">
          {t("shell.console.title")}
        </span>
        <button
          type="button"
          aria-label={t("shell.console.copyAriaLabel")}
          onClick={() => void copy()}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
        >
          {copied ? (
            <CheckIcon className="size-3.5 text-emerald-400" />
          ) : (
            <ClipboardIcon className="size-3.5" />
          )}
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <pre className="max-h-48 overflow-y-auto rounded-b-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-xs leading-5 whitespace-pre-wrap wrap-break-word text-zinc-200 dark:border-zinc-800">
        {log}
      </pre>
    </AlertBody>
  );
}

/**
 * Provider renders a single alert dialog at a time; subsequent calls are queued.
 */
export const AlertDialogProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queueRef = useRef<AlertDialogRequest[]>([]);
  const idRef = useRef(0);
  /** The alert on screen; rendered from state, mirrored for synchronous checks. */
  const [active, setActive] = useState<AlertDialogRequest | null>(null);
  const activeRef = useRef<AlertDialogRequest | null>(null);

  const dequeue = useCallback(() => {
    if (activeRef.current) return; // already showing one
    const next = queueRef.current.shift() || null;
    activeRef.current = next;
    setActive(next);
  }, []);

  const handleClose = useCallback(
    (result: boolean) => {
      if (activeRef.current) {
        activeRef.current.resolve(result);
        activeRef.current = null;
        setActive(null);
        // small timeout ensures state commit before pulling next
        setTimeout(() => dequeue(), 0);
      }
    },
    [dequeue],
  );

  // Auto-close after 4 seconds for toast notifications only. The cleanup
  // cancels the timer as soon as this alert is closed or replaced.
  useEffect(() => {
    if (!active || active.description || active.negativeText) return;
    const timer = window.setTimeout(() => handleClose(true), 4000);
    return () => window.clearTimeout(timer);
  }, [active, handleClose]);

  const showAlert = useCallback<AlertDialogContextValue["showAlert"]>(
    ({
      title,
      description,
      log,
      affirmativeText = translate("common.confirm"),
      negativeText,
      tone,
      action,
    }) => {
      return new Promise<boolean>((resolve) => {
        const request: AlertDialogRequest = {
          id: ++idRef.current,
          title,
          description,
          log,
          affirmativeText,
          negativeText,
          tone,
          action,
          resolve,
        };
        queueRef.current.push(request);
        dequeue();
      });
    },
    [dequeue],
  );

  const value: AlertDialogContextValue = { showAlert };

  // Use modal variant for confirmation dialogs (with description/negativeText), toast for simple notifications
  const isConfirmationDialog =
    active && (active.description || active.negativeText);
  const variant = isConfirmationDialog ? "modal" : "toast";

  return (
    <AlertDialogContext.Provider value={value}>
      {children}
      {variant === "toast" ? (
        // Toast notifications - render outside Dialog to avoid blocking interactions
        <AnimatePresence>
          {active && (
            <Toast
              tone={active.tone}
              title={active.title}
              description={active.description}
              onDismiss={() => handleClose(true)}
              action={
                active.action ?? {
                  label: translate("toast.copy"),
                  onClick: () => {
                    void navigator.clipboard
                      ?.writeText(active.title)
                      .catch(() => {});
                  },
                }
              }
            />
          )}
        </AnimatePresence>
      ) : (
        // Modal dialogs - use Alert component
        <Alert
          open={!!active}
          onClose={(open: boolean) => {
            if (!open) {
              handleClose(false);
            }
          }}
          variant="modal"
        >
          {active && (
            <>
              <AlertTitle>{active.title}</AlertTitle>
              {active.description && (
                <AlertDescription>{active.description}</AlertDescription>
              )}
              {active.log && <ConsoleOutput log={active.log} />}
              <AlertActions>
                {active.negativeText && (
                  <Button plain onClick={() => handleClose(false)}>
                    {active.negativeText}
                  </Button>
                )}
                <Button onClick={() => handleClose(true)} autoFocus>
                  {active.affirmativeText || translate("common.confirm")}
                </Button>
              </AlertActions>
            </>
          )}
        </Alert>
      )}
    </AlertDialogContext.Provider>
  );
};

/** Exposes `showAlert` as `window.showAlertDialog` for non-hook callers. */
export const GlobalAlertDialogBridge: React.FC = () => {
  const { showAlert } = useAlertDialog();
  useEffect(() => {
    window.showAlertDialog = showAlert;
  }, [showAlert]);

  // Surface game launch failures captured in the Tauri backend (a game that
  // exits immediately with console output, e.g. a missing prerequisite). The
  // full log is shown in the launch log window (which opens automatically);
  // only if that fails, fall back to the dialog so a crash is never silent.
  useEffect(() => {
    if (!isTauriApp()) return;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{
          gameTitle: string;
          exitCode?: number | null;
          message: string;
        }>("game-launch-failed", (event) => {
          const { gameTitle, exitCode, message } = event.payload;
          void (async () => {
            try {
              const { openLaunchLogWindow } = await import("@/utils/launchLog");
              await openLaunchLogWindow();
            } catch {
              await showAlert({
                title: fillTemplate(translate("shell.gameExited.title"), {
                  title: gameTitle,
                }),
                description:
                  exitCode != null
                    ? fillTemplate(
                        translate("shell.gameExited.descriptionWithCode"),
                        { code: exitCode },
                      )
                    : translate("shell.gameExited.description"),
                log: message,
                affirmativeText: translate("common.ok"),
              });
            }
          })();
        });
      } catch {
        // Non-Tauri environments won't have the IPC bridge; ignore.
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [showAlert]);

  return null;
};

export default AlertDialogProvider;
