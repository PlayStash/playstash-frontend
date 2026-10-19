import { useState, useSyncExternalStore } from "react";
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
import {
  currentPipelineDialog,
  settlePipelineDialog,
  subscribePipelineDialogs,
} from "./pipelineDialogStore";

export function PipelineDialogHost() {
  const { t } = useTranslation();
  const active = useSyncExternalStore(
    subscribePipelineDialogs,
    currentPipelineDialog,
    currentPipelineDialog,
  );
  // The typed password belongs to one dialog; the next one starts empty.
  const [entry, setEntry] = useState({ id: 0, value: "" });

  if (!active) return null;

  const value = entry.id === active.id ? entry.value : "";
  const setValue = (next: string) => setEntry({ id: active.id, value: next });

  const confirm = () =>
    settlePipelineDialog(active.id, { confirmed: true, value });
  const cancel = () =>
    settlePipelineDialog(active.id, { confirmed: false, value: "" });

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
