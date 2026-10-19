"use client";

import * as Headless from "@headlessui/react";
import {
  Bars3Icon,
  XMarkIcon,
  QueueListIcon,
} from "@heroicons/react/24/outline";
import React, { useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/i18n";
import WindowTitlebar from "../WindowTitlebar";

const desktopQuery = "(min-width: 1024px)";
function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches;

function NavigationDrawer({
  open,
  close,
  label,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  close: () => void;
  label: string;
}>) {
  const { t } = useTranslation();
  return (
    <Headless.Dialog
      open={open}
      onClose={close}
      aria-label={label}
      className="relative z-50 lg:hidden"
    >
      <Headless.DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 transition-opacity duration-240 ease-(--ease-out) data-closed:opacity-0 data-leave:duration-180 motion-reduce:duration-100"
      />
      <Headless.DialogPanel
        transition
        className="fixed inset-y-0 left-0 flex w-[min(88vw,calc(320px+env(safe-area-inset-left,0px)))] flex-col bg-ps-shell pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] shadow-(--shadow-shell) transition-[opacity,transform] duration-240 ease-(--ease-out) data-closed:[transform:translateX(-100%)] data-closed:opacity-0 data-leave:duration-180 motion-reduce:transform-none motion-reduce:duration-100 motion-reduce:data-closed:transform-none"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-ps-line px-4">
          <span className="text-sm font-semibold text-ps-text">{label}</span>
          <Headless.CloseButton
            className="app-icon-button"
            aria-label={t("shell.navigation.close")}
          >
            <XMarkIcon className="size-5" />
          </Headless.CloseButton>
        </div>
        <div
          className="min-h-0 flex-1 overscroll-contain"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) close();
          }}
        >
          {children}
        </div>
      </Headless.DialogPanel>
    </Headless.Dialog>
  );
}

export function SidebarLayout({
  navbar,
  sidebar,
  secondaryNavigation,
  fullWidth = false,
  fullBleed = false,
  children,
}: React.PropsWithChildren<{
  navbar: React.ReactNode;
  sidebar: React.ReactNode;
  secondaryNavigation?: React.ReactNode;
  fullWidth?: boolean;
  fullBleed?: boolean;
}>) {
  const [showSidebar, setShowSidebar] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const { t } = useTranslation();
  const location = useLocation();
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    () => true,
  );

  // Navigating closes the mobile sidebar and library drawers.
  const routeKey = `${location.pathname}${location.search}`;
  const [shownRoute, setShownRoute] = useState(routeKey);
  if (routeKey !== shownRoute) {
    setShownRoute(routeKey);
    setShowSidebar(false);
    setShowLibrary(false);
  }

  return (
    <div className="app-shell flex h-full min-h-0 w-full flex-col bg-ps-bg text-ps-text">
      <WindowTitlebar />
      <a href="#main-content" className="app-skip-link">
        {t("shell.navigation.skip")}
      </a>
      <header className="app-header flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => setShowSidebar(true)}
          className="app-icon-button ml-2 shrink-0 lg:hidden"
          aria-label={t("shell.navigation.open")}
        >
          <Bars3Icon className="size-5" />
        </button>
        {navbar}
      </header>
      <NavigationDrawer
        open={showSidebar}
        close={() => setShowSidebar(false)}
        label={t("shell.navigation.open")}
      >
        {sidebar}
      </NavigationDrawer>
      <div className="flex min-h-0 flex-1">
        {secondaryNavigation && (
          <>
            {desktop && (
              <aside
                className="app-library-column flex min-h-0 shrink-0 flex-col"
                aria-label={t("nav.library")}
              >
                <div className="min-h-0 flex-1">{secondaryNavigation}</div>
                <Link
                  to="/settings"
                  className="flex min-h-12 items-center gap-2 border-t border-ps-line px-5 text-xs text-ps-muted hover:bg-ps-panel hover:text-ps-text active:bg-ps-panel active:text-ps-text"
                >
                  <Cog6ToothIcon className="size-4" />
                  {t("nav.settings")}
                </Link>
              </aside>
            )}
            {!desktop && (
              <NavigationDrawer
                open={showLibrary}
                close={() => setShowLibrary(false)}
                label={t("nav.library")}
              >
                {secondaryNavigation}
              </NavigationDrawer>
            )}
          </>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
        >
          {secondaryNavigation && (
            <div className="flex shrink-0 border-b border-ps-line bg-ps-shell px-3 py-1.5 lg:hidden">
              <button
                type="button"
                className="app-library-toggle"
                onClick={() => setShowLibrary(true)}
              >
                <QueueListIcon className="size-4" />
                {t("shell.library.browse")}
              </button>
            </div>
          )}
          <div
            className={`app-scroll-area min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain ${fullBleed ? "" : "app-page-padding"}`}
            data-scroll-container=""
          >
            <div
              className={
                fullWidth || fullBleed
                  ? "min-h-full w-full"
                  : "mx-auto min-h-full w-full max-w-[1480px]"
              }
            >
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
