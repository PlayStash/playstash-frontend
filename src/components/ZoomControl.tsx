import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/tailwind/button";
import { MinusIcon, PlusIcon } from "@heroicons/react/16/solid";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_CHANGE_EVENT,
  ZOOM_STEP,
  adjustZoom,
  getStoredZoom,
  resetZoomLevel,
  zoomPercent,
} from "@/utils/zoom";
import { useTranslation } from "@/i18n";

export default function ZoomControl({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(getStoredZoom);

  // Keep the displayed percentage in sync when zoom changes come from outside
  // this control (e.g. the Ctrl/Cmd + +/- hotkeys).
  useEffect(() => {
    const handleZoomChange = (event: Event) => {
      const detail = (event as CustomEvent<{ zoom: number }>).detail;
      if (detail && Number.isFinite(detail.zoom)) setZoom(detail.zoom);
    };
    window.addEventListener(ZOOM_CHANGE_EVENT, handleZoomChange);
    return () =>
      window.removeEventListener(ZOOM_CHANGE_EVENT, handleZoomChange);
  }, []);

  const handleStep = useCallback((delta: number) => {
    setZoom(adjustZoom(delta));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(resetZoomLevel());
  }, []);

  const pct = zoomPercent(zoom);

  return (
    <div className={clsx("flex items-center gap-1.5", className)}>
      <Button
        plain
        aria-label={t("appearance.zoom.out")}
        title={t("appearance.zoom.outTitle")}
        onClick={() => handleStep(-ZOOM_STEP)}
        disabled={zoom <= MIN_ZOOM}
      >
        <MinusIcon data-slot="icon" />
      </Button>
      <button
        type="button"
        onClick={handleReset}
        title={t("appearance.zoom.resetTitle")}
        className="min-w-12 rounded-xl px-2 py-1.5 text-center text-sm font-medium tabular-nums text-ps-muted transition-colors data-active:bg-ps-panel-soft data-hover:text-ps-text"
      >
        {pct}%
      </button>
      <Button
        plain
        aria-label={t("appearance.zoom.in")}
        title={t("appearance.zoom.inTitle")}
        onClick={() => handleStep(ZOOM_STEP)}
        disabled={zoom >= MAX_ZOOM}
      >
        <PlusIcon data-slot="icon" />
      </Button>
    </div>
  );
}
