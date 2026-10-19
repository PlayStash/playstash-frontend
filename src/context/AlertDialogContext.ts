import { createContext, useContext } from "react";
import type { ToastTone } from "@tw/toast";

// Shape of a queued alert request
export interface AlertDialogRequest {
  id: number;
  title: string;
  description?: string;
  /** Optional raw process/console output rendered in a terminal-style block. */
  log?: string;
  affirmativeText?: string;
  negativeText?: string;
  tone?: ToastTone;
  /** Toast action; title-only toasts default to "Copy" (WPF "Copy Message"). */
  action?: { label: string; onClick: () => void };
  resolve: (value: boolean) => void;
}

export interface AlertDialogContextValue {
  showAlert: (options: {
    title: string;
    description?: string;
    log?: string;
    affirmativeText?: string;
    negativeText?: string;
    tone?: ToastTone;
    action?: { label: string; onClick: () => void };
  }) => Promise<boolean>;
}

export const AlertDialogContext = createContext<
  AlertDialogContextValue | undefined
>(undefined);

export const useAlertDialog = () => {
  const ctx = useContext(AlertDialogContext);
  if (!ctx)
    throw new Error(
      "useAlertDialog must be used within an AlertDialogProvider",
    );
  return ctx;
};

// Optional convenience imperative API attached to window for non-hook usage (e.g., outside React tree)
declare global {
  interface Window {
    showAlertDialog?: AlertDialogContextValue["showAlert"];
  }
}
