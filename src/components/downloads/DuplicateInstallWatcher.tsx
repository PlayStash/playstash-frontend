import { useEffect, useRef } from "react";
import { translate } from "@/i18n";
import { isTauriApp } from "@/utils/tauri";
import { getRootPaths, ROOT_PATHS_CHANGE_EVENT } from "@/utils/rootPaths";
import {
  formatDuplicateInstallations,
  rootSetKey,
  scanDuplicateInstallations,
} from "@/utils/duplicateInstallations";
import { confirmPipeline } from "./PipelineDialogs";

/**
 * Shows "Duplicate game installation detected" after a download location was
 * added or removed and a game turns out to be installed in several of them.
 */
export function DuplicateInstallWatcher() {
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauriApp()) return;
    lastKeyRef.current = rootSetKey(getRootPaths().map((root) => root.path));
    let cancelled = false;

    const onChange = () => {
      const roots = getRootPaths().map((root) => root.path);
      const key = rootSetKey(roots);
      // Label edits also fire the event; only added/removed roots count.
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      void (async () => {
        try {
          const duplicates = await scanDuplicateInstallations(roots);
          if (cancelled || !duplicates.length) return;
          await confirmPipeline({
            title: translate("pipeline.duplicates.title"),
            message: formatDuplicateInstallations(
              duplicates,
              translate("pipeline.duplicates.entry"),
            ),
            confirmText: translate("pipeline.dialog.ok"),
          });
        } catch (error) {
          console.warn("Duplicate installation scan failed:", error);
        }
      })();
    };

    window.addEventListener(ROOT_PATHS_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(ROOT_PATHS_CHANGE_EVENT, onChange);
    };
  }, []);

  return null;
}
