/**
 * OS notifications for the download pipeline, shown through the shared
 * `notify` helper. Like the old client they only appear when the user does
 * not already look at the Downloads page: the main window is not focused, or
 * another page is open.
 */
import { translate } from "@/i18n";
import {
  currentRoute as defaultCurrentRoute,
  isMainWindowFocused as defaultIsMainWindowFocused,
  notify as defaultNotify,
  type OsNotification,
} from "@/utils/osNotify";

export type DownloadNotificationKind =
  | "download-failed"
  | "download-complete"
  | "extraction-complete"
  | "extraction-failed";

const TITLE_KEYS = {
  "download-failed": "pipeline.notify.downloadFailed",
  "download-complete": "pipeline.notify.downloadComplete",
  "extraction-complete": "pipeline.notify.extractionComplete",
  "extraction-failed": "pipeline.notify.extractionFailed",
} as const;

export function isDownloadsRoute(route: string): boolean {
  const path = route.split(/[?#]/)[0].replace(/\/+$/, "");
  return path === "/downloads";
}

/** Notify unless the focused main window shows the Downloads page. */
export function shouldShowDownloadNotification(
  windowFocused: boolean,
  route: string,
): boolean {
  return !windowFocused || !isDownloadsRoute(route);
}

export interface DownloadNotificationDeps {
  notify: (notification: OsNotification) => Promise<void>;
  isMainWindowFocused: () => Promise<boolean>;
  currentRoute: () => string;
}

const defaultDeps: DownloadNotificationDeps = {
  notify: defaultNotify,
  isMainWindowFocused: defaultIsMainWindowFocused,
  currentRoute: defaultCurrentRoute,
};

/** Shows the notification for a pipeline event if the rules allow it. */
export async function notifyDownloadEvent(
  event: {
    kind: DownloadNotificationKind;
    gameId: number;
    gameTitle: string;
    imagePath?: string;
  },
  deps: DownloadNotificationDeps = defaultDeps,
): Promise<boolean> {
  try {
    const focused = await deps.isMainWindowFocused();
    if (!shouldShowDownloadNotification(focused, deps.currentRoute())) {
      return false;
    }
    await deps.notify({
      title: translate(TITLE_KEYS[event.kind]),
      body: event.gameTitle,
      imagePath: event.imagePath,
      tag: `download-${event.gameId}-${event.kind}`,
    });
    return true;
  } catch {
    return false;
  }
}
