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
