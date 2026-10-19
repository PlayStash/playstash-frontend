import { useEffect, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "@/i18n";

function subscribeVisibility(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}
const isVisible = () => document.visibilityState !== "hidden";

export function PageLoader() {
  const [visible, setVisible] = useState(false);
  const reduceMotion = useReducedMotion();
  const pageVisible = useSyncExternalStore(
    subscribeVisibility,
    isVisible,
    () => false,
  );
  const { t } = useTranslation();

  useEffect(() => {
    // Avoid a flash for fast imports. Never wait for the animation to finish.
    const timer = window.setTimeout(() => setVisible(true), 160);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-full min-h-full items-center justify-center">
      {visible && (
        <div role="status" className="flex flex-col items-center gap-3 py-12">
          <img
            src={
              reduceMotion !== false || !pageVisible
                ? "/motion/playstash-load-still.webp"
                : "/motion/playstash-load.webp"
            }
            alt=""
            width={96}
            height={96}
            className="size-24"
            draggable={false}
            onError={(event) => {
              const image = event.currentTarget;
              if (!image.src.endsWith("/playstash-logo.png"))
                image.src = "/playstash-logo.png";
            }}
          />
          <span className="flex items-center gap-2 text-xs text-ps-muted">
            <span
              aria-hidden="true"
              className="size-3 animate-spin rounded-full border border-ps-accent border-t-transparent motion-reduce:animate-none"
              style={{ animationPlayState: pageVisible ? "running" : "paused" }}
            />
            {t("common.loading")}
          </span>
        </div>
      )}
    </div>
  );
}
