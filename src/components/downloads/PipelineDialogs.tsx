import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Alert,
  AlertActions,
  AlertBody,
  AlertDescription,
  AlertTitle,
} from "@tw/alert";
import { Button } from "@tw/button";
import { Input } from "@tw/input";
import { useTranslation } from "@/i18n";

/**
 * Modal dialogs of the download pipeline: confirmations with
 * multi-line messages and the archive password prompt.
 *
 * The global `showAlert` collapses line breaks and has no text input, and
 * the download context sits outside its provider, so the pipeline keeps a
 * small queue of its own. `PipelineDialogHost` is rendered once by the
 * download provider.
 */

export interface PipelineDialogRequest {
  title: string;
  message: string;
  confirmText?: string;
  /** Omit for an info dialog with a single button. */
  cancelText?: string;
  /** Shows a password field; the entered value is returned. */
  passwordInput?: { placeholder?: string };
  tone?: "default" | "danger";
}

export interface PipelineDialogResult {
  confirmed: boolean;
  value: string;
}

interface QueuedRequest extends PipelineDialogRequest {
  id: number;
  resolve: (result: PipelineDialogResult) => void;
}

let queue: QueuedRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current(): QueuedRequest | null {
  return queue[0] ?? null;
}

/** Queues a dialog and resolves once the user answered it. */
export function showPipelineDialog(
  request: PipelineDialogRequest,
): Promise<PipelineDialogResult> {
  return new Promise((resolve) => {
    queue = [...queue, { ...request, id: nextId++, resolve }];
    emit();
  });
}

/** Yes/No confirmation. Resolves to true on the confirm button. */
export async function confirmPipeline(
  request: Omit<PipelineDialogRequest, "passwordInput">,
): Promise<boolean> {
  const result = await showPipelineDialog(request);
  return result.confirmed;
}

/** Password prompt. Resolves to the password, or null when cancelled. */
export async function promptPipelinePassword(request: {
  title: string;
  message: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
}): Promise<string | null> {
  const result = await showPipelineDialog({
    title: request.title,
    message: request.message,
    confirmText: request.confirmText,
    cancelText: request.cancelText,
    passwordInput: { placeholder: request.placeholder },
  });
  return result.confirmed ? result.value : null;
}

function settle(id: number, result: PipelineDialogResult) {
  const request = queue.find((entry) => entry.id === id);
  queue = queue.filter((entry) => entry.id !== id);
  emit();
  request?.resolve(result);
}

/** Test hook: drop every pending dialog. */
export function resetPipelineDialogs() {
  for (const request of queue) request.resolve({ confirmed: false, value: "" });
  queue = [];
  emit();
}

export function PipelineDialogHost() {
  const { t } = useTranslation();
  const active = useSyncExternalStore(subscribe, current, current);
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [active?.id]);

  if (!active) return null;

  const confirm = () => settle(active.id, { confirmed: true, value });
  const cancel = () => settle(active.id, { confirmed: false, value: "" });

  return (
    <Alert
      open
      onClose={() => (active.cancelText ? cancel() : confirm())}
      size="md"
    >
      <AlertTitle>{active.title}</AlertTitle>
      <AlertDescription className="whitespace-pre-line">
        {active.message}
      </AlertDescription>
      {active.passwordInput && (
        <AlertBody>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (value) confirm();
            }}
          >
            <Input
              type="password"
              autoFocus
              aria-label={active.title}
              value={value}
              placeholder={active.passwordInput.placeholder}
              onChange={(event) => setValue(event.target.value)}
            />
          </form>
        </AlertBody>
      )}
      <AlertActions>
        {active.cancelText && (
          <Button plain onClick={cancel}>
            {active.cancelText}
          </Button>
        )}
        <Button
          color={active.tone === "danger" ? "red" : "indigo"}
          onClick={confirm}
          disabled={!!active.passwordInput && !value}
          autoFocus={!active.passwordInput}
        >
          {active.confirmText || t("pipeline.dialog.ok")}
        </Button>
      </AlertActions>
    </Alert>
  );
}
