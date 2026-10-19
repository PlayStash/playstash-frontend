import { initializeI18n } from "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Also loads the global styles (index.css), for the launch log window too.
import { App } from "./App";
import { initializeThemes } from "./themes/themeManager";
import { applyZoom, getStoredZoom, registerZoomHotkeys } from "./utils/zoom";
import { registerReloadHotkey } from "./utils/reload";
import { registerStreamerModeHotkey } from "./utils/streamerMode";
import { registerExternalLinkHandler, isTauriApp } from "./utils/tauri";
import { isAnalyticsEnabled } from "./utils/analytics";
import { startMediaCacheMaintenance } from "./utils/mediaCache";
import { startFrontendDiagnostics } from "./utils/frontendDiagnostics";
import * as Swetrix from "swetrix";
import { LaunchLogWindow } from "./pages/LaunchLogWindow";

// The launch log window boots standalone: it renders its own document without
// the app providers, router, analytics or global hotkeys.
initializeI18n();
const isLaunchLogWindow = window.location.hash === "#launch-log";

if (isLaunchLogWindow) {
  createRoot(document.getElementById("root")!).render(<LaunchLogWindow />);
} else {
  // Apply the stored theme immediately to prevent a flash of the wrong theme
  initializeThemes();
  // Apply persisted zoom level (native webview zoom in Tauri, CSS zoom on web)
  void applyZoom(getStoredZoom());
  void startMediaCacheMaintenance();

  (window as any).global = window;

  const analyticsProjectId = import.meta.env
    .VITE_PLAYSTASH_ANALYTICS_PROJECT_ID;
  const analyticsApiUrl = import.meta.env.VITE_PLAYSTASH_ANALYTICS_API_URL;
  if (analyticsProjectId && analyticsApiUrl && isAnalyticsEnabled()) {
    Swetrix.init(analyticsProjectId, { apiURL: analyticsApiUrl });
    Swetrix.trackViews();
    Swetrix.trackErrors();
  }

  // Ctrl/Cmd + +/-/0 zoom hotkeys (browsers already handle these natively)
  if (isTauriApp()) {
    registerZoomHotkeys();
    // F5 reloads the app in the Tauri webview (packaged builds have no native F5)
    registerReloadHotkey();
    // Ctrl/Cmd+Shift+O toggles OPSEC/streamer mode
    registerStreamerModeHotkey();
    // Open every external link (target=_blank, http(s), mailto, tel) through
    // the native OS opener instead of being swallowed by the webview.
    registerExternalLinkHandler();
    // Feed the native watchdog so a UI freeze leaves a trace in the app log.
    startFrontendDiagnostics();
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
