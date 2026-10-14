import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/tailwind/button";
import { translate } from "@/i18n";
import { isTauriApp } from "@/utils/tauri";

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  copied: boolean;
}

/** Text copied by "Copy details". */
export function errorDetails(error: Error, componentStack: string): string {
  return [
    `${error.name}: ${error.message}`,
    error.stack ?? "",
    componentStack ? `Component stack:${componentStack}` : "",
    `Route: ${typeof location !== "undefined" ? location.pathname : ""}`,
    `Version: ${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "?"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Opens the folder of the app log file (desktop). */
export async function openLogFolder(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const logPath = await invoke<string | null>("get_diagnostics_log_path");
  if (!logPath) return;
  const folder = logPath.replace(/[/\\][^/\\]*$/, "");
  await invoke("open_in_file_explorer", { path: folder });
}

/**
 * Crash screen for render errors (WPF "unhandled error" window): shows the
 * message with Reload, Copy details and, on desktop, Open Log Folder. The
 * error is logged with `console.error`, which the desktop log captures.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: "",
    copied: false,
  };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Unhandled render error:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private copyDetails = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    try {
      await navigator.clipboard.writeText(errorDetails(error, componentStack));
      this.setState({ copied: true });
    } catch {
      // clipboard unavailable
    }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex min-h-dvh items-center justify-center bg-ps-bg p-6 text-ps-text"
      >
        <div className="surface-panel w-full max-w-xl space-y-4 rounded-3xl p-6">
          <h1 className="text-lg font-semibold">
            {translate("errorBoundary.title")}
          </h1>
          <pre className="max-h-60 overflow-auto rounded-xl bg-ps-panel-soft p-3 text-xs whitespace-pre-wrap break-words text-ps-muted">
            {error.message || String(error)}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button color="indigo" onClick={() => window.location.reload()}>
              {translate("errorBoundary.reload")}
            </Button>
            <Button outline onClick={() => void this.copyDetails()}>
              {copied
                ? translate("errorBoundary.copied")
                : translate("errorBoundary.copy")}
            </Button>
            {isTauriApp() && (
              <Button
                outline
                onClick={() =>
                  void openLogFolder().catch((cause) =>
                    console.error("Could not open the log folder:", cause),
                  )
                }
              >
                {translate("errorBoundary.openLogFolder")}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
