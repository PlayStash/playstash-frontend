import {
  ArrowPathIcon,
  MinusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { isTauriApp } from "@/utils/tauri";
import { useTranslation } from "@/i18n";

async function minimizeWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

async function toggleMaximizeWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}

async function closeWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

function reloadWindow() {
  // Reload the current page like F5 (the Tauri webview has no native F5).
  window.location.reload();
}

const controlButtonClassName =
  "flex w-11 cursor-pointer items-center justify-center text-ps-muted transition-colors hover:bg-ps-panel hover:text-ps-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ps-accent";

export default function WindowTitlebar() {
  const { t } = useTranslation();
  // Only rendered inside the Tauri desktop shell; hidden in plain browser mode.
  if (!isTauriApp()) {
    return null;
  }

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-9 shrink-0 select-none items-stretch justify-end bg-ps-shell"
    >
      <div className="flex items-stretch">
        <button
          type="button"
          aria-label={t("common.refresh")}
          onClick={() => reloadWindow()}
          className={controlButtonClassName}
        >
          <ArrowPathIcon className="size-4" />
        </button>
        <div className="my-2 w-px bg-ps-line" aria-hidden="true" />
        <button
          type="button"
          aria-label={t("shell.titlebar.minimize")}
          onClick={() => void minimizeWindow()}
          className={controlButtonClassName}
        >
          <MinusIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("shell.titlebar.maximize")}
          onClick={() => void toggleMaximizeWindow()}
          className={controlButtonClassName}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
            <rect
              x="3.5"
              y="3.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => void closeWindow()}
          className={`${controlButtonClassName} hover:bg-red-500 hover:text-white`}
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
    </header>
  );
}
