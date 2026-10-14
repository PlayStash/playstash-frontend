/**
 * Yes/No confirmation through the app's alert dialog (bridged on `window`
 * by `GlobalAlertDialogBridge`), falling back to the native confirm.
 */
export async function confirmAction(options: {
  title: string;
  description?: string;
  affirmativeText: string;
  negativeText: string;
}): Promise<boolean> {
  if (typeof window !== "undefined" && window.showAlertDialog) {
    // With `negativeText` the alert is a modal, not a toast.
    return window.showAlertDialog(options);
  }
  return typeof window !== "undefined" && window.confirm(options.title);
}

/** A short toast through the app's alert dialog, if mounted. */
export function showToast(
  title: string,
  tone: "info" | "success" | "warning" | "danger" = "success",
): void {
  try {
    void window.showAlertDialog?.({ title, tone });
  } catch {
    /* no dialog bridge */
  }
}
