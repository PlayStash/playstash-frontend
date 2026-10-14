/**
 * OS notifications (WP1 contract, Step 0 stub).
 *
 * WP1 replaces the bodies with `tauri-plugin-notification`, window focus
 * checks and a router listener that keeps the current route up to date.
 * Until then notifications are silently dropped.
 */
export interface OsNotification {
  title: string;
  body: string;
  /** Absolute path of an image shown in the notification. */
  imagePath?: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
}

/** Show an OS notification. Never throws. */
export async function notify(notification: OsNotification): Promise<void> {
  void notification;
}

/** Whether the main window is visible and focused. */
export async function isMainWindowFocused(): Promise<boolean> {
  return typeof document === "undefined" ? true : document.hasFocus();
}

/** The current router path, e.g. `/chat`. */
export function currentRoute(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}
