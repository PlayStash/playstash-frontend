/**
 * OS notifications.
 *
 * Desktop only: notifications go through `tauri-plugin-notification` on the
 * Rust side (`os_notify`), which asks for permission on first use. On the web
 * build, or when anything fails, notifications are silently dropped, like the
 * WPF client's toasts.
 */
import { isTauriApp } from "@/utils/tauri";

export interface OsNotification {
  title: string;
  body: string;
  /** Absolute path of an image shown in the notification (best effort). */
  imagePath?: string;
  /** Notifications with the same tag replace each other (where supported). */
  tag?: string;
}

/** Show an OS notification. Never throws. */
export async function notify(notification: OsNotification): Promise<void> {
  if (!isTauriApp()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("os_notify", {
      title: notification.title,
      body: notification.body,
      imagePath: notification.imagePath ?? null,
      tag: notification.tag ?? null,
    });
  } catch (error) {
    console.warn("[osNotify] notification failed:", error);
  }
}

/** Whether the main window is visible and focused. */
export async function isMainWindowFocused(): Promise<boolean> {
  if (isTauriApp()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      const [focused, visible] = await Promise.all([
        window.isFocused(),
        window.isVisible(),
      ]);
      return focused && visible;
    } catch {
      // Simulated desktop mode or no window API: fall back to the document.
    }
  }
  return typeof document === "undefined" ? true : document.hasFocus();
}

let trackedRoute: string | null = null;

/**
 * Updates the route reported by {@link currentRoute}. Called by the router
 * listener in `DesktopCommandProvider`.
 */
export function setCurrentRoute(pathname: string): void {
  trackedRoute = pathname;
}

/** The current router path, e.g. `/chat`. */
export function currentRoute(): string {
  if (trackedRoute !== null) return trackedRoute;
  return typeof window === "undefined" ? "/" : window.location.pathname;
}
