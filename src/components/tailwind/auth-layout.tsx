import type React from "react";
import WindowTitlebar from "../WindowTitlebar";
import { Logo } from "../Logo";
import { useTranslation } from "@/i18n";
import "@/styles/workspaces.css";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="auth-layout flex h-full min-h-0 flex-col">
      <WindowTitlebar />
      <main className="auth-workspace">
        <aside className="auth-identity" aria-label="PlayStash">
          <div className="auth-brand">
            <Logo height="h-8" alt="" />
            <span>PlayStash</span>
          </div>
          <div className="auth-product">
            <Logo height="h-24" alt="" />
            <p>{t("nav.library")}</p>
            <div>
              {t("nav.downloads")}
              <span aria-hidden="true"> / </span>
              {t("nav.community")}
            </div>
          </div>
          <p className="auth-version">
            PlayStash <span>v{__APP_VERSION__}</span>
          </p>
        </aside>
        <div className="auth-form-region">
          <div className="auth-form-content">{children}</div>
        </div>
      </main>
    </div>
  );
}
