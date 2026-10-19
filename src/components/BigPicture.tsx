import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useGamepad } from "@/context/GamepadContext";
import { setBigPicture, useBigPicture } from "@/utils/bigPicture";
import { Button } from "./tailwind/button";
import { Logo } from "./Logo";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { BigPictureInstalled } from "./BigPictureInstalled";
import { useTranslation } from "@/i18n";
import {
  setBigPictureHome,
  useBigPictureHome,
} from "@/utils/bigPictureInstalled";

/** Shows the installed-games home until the user navigates somewhere. */
function useInstalledHome() {
  const home = useBigPictureHome();
  const location = useLocation();
  const firstKey = useRef(location.key);
  // Big Picture always opens on the installed games.
  useEffect(() => setBigPictureHome(true), []);
  useEffect(() => {
    if (location.key !== firstKey.current) {
      firstKey.current = location.key;
      setBigPictureHome(false);
    }
  }, [location.key]);
  return home;
}
export function BigPictureButton() {
  const active = useBigPicture();
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  return (
    <div className="space-y-1">
      <Button
        outline
        onClick={() => void setBigPicture(!active).catch(() => setError(true))}
      >
        {active ? t("bigPicture.exit") : t("bigPicture.enter")}
      </Button>
      {error && (
        <p role="status" className="text-xs text-ps-muted">
          {t("bigPicture.fullscreenUnavailable")}
        </p>
      )}
    </div>
  );
}
export function BigPictureShell({ children }: { children: ReactNode }) {
  const { connected } = useGamepad();
  const { t } = useTranslation();
  const showInstalled = useInstalledHome();
  return (
    <div
      data-big-picture="true"
      className="flex h-full flex-col bg-ps-bg text-ps-text"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ps-line bg-ps-shell px-5 py-4">
        <Logo variant="sidebar" height="h-6" />
        <nav
          aria-label={t("bigPicture.navigation")}
          className="flex flex-wrap gap-3"
        >
          {(
            [
              ["/library", "nav.library"],
              ["/downloads", "nav.downloads"],
              ["/requests", "bigPicture.nav.requests"],
              ["/chat", "nav.chat"],
              ["/settings", "nav.settings"],
            ] as const
          ).map(([href, label]) => (
            <Button key={href} outline href={href}>
              {t(label)}
            </Button>
          ))}
          <Button
            {...(showInstalled
              ? { color: "indigo" as const }
              : { outline: true })}
            onClick={() => setBigPictureHome(true)}
          >
            {t("bigPicture.installedTitle")}
          </Button>
          <BigPictureButton />
        </nav>
      </header>
      <div className="flex-1 overflow-auto p-4 sm:p-8" data-scroll-container="">
        {showInstalled ? <BigPictureInstalled /> : children}
      </div>
      <footer className="flex flex-wrap justify-between gap-3 border-t border-ps-line bg-ps-shell px-5 py-3 text-sm text-ps-muted">
        <span>
          {connected
            ? t("bigPicture.controllerConnected")
            : t("bigPicture.controllerHint")}
        </span>
        <span>{t("bigPicture.controls")}</span>
        <Link to="/library" className="text-ps-accent-strong">
          {t("nav.library")}
        </Link>
      </footer>
    </div>
  );
}
