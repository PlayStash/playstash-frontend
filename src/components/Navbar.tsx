import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import {
  ChevronDownIcon,
  Cog6ToothIcon,
  NewspaperIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
  LifebuoyIcon,
  CodeBracketIcon,
  BugAntIcon,
} from "@heroicons/react/20/solid";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { isTauriApp } from "@/utils/tauri";
import { maskUser, useStreamerMode } from "@/utils/streamerMode";
import { useTranslation } from "@/i18n";
import { useNews } from "@/hooks/useNews";
import {
  Dropdown,
  DropdownButton,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import { Logo } from "./Logo";
import { UserAvatar } from "./UserAvatar";
import { NewsDialog } from "./news/NewsDialog";
import { UserEditorModal } from "./admin/UserEditorModal";

export function Navbar() {
  const { user, logout } = useAuth();
  const { isOnline } = useOnlineStatus();
  const isTauri = isTauriApp();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const streamerMode = useStreamerMode();
  const { hasNewNews } = useNews();
  const [badgeVisible, setBadgeVisible] = useState(hasNewNews);
  useEffect(() => {
    if (hasNewNews) setBadgeVisible(true);
  }, [hasNewNews]);
  const [showNews, setShowNews] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const masked = streamerMode && user ? maskUser(user) : null;
  const username =
    masked?.displayName ?? user?.username ?? t("profile.unknown");
  const unavailable = isTauri && !isOnline;
  const isAdmin = Number(user?.role) >= 3;

  return (
    <>
      <div className="app-topbar flex min-w-0 flex-1 items-center">
        <Link
          to="/library"
          className="app-brand shrink-0"
          aria-label="PlayStash"
        >
          <Logo variant="brand" height="h-6" wrapperClassName="w-36" />
        </Link>
        <nav
          className="app-primary-navigation hidden min-w-0 self-stretch lg:flex"
          aria-label={t("shell.navigation.primary")}
        >
          <NavLink to="/library" className="app-nav-link">
            {t("nav.library")}
          </NavLink>
          <NavLink
            to="/community"
            className="app-nav-link"
            aria-disabled={unavailable || undefined}
            onClick={unavailable ? (e) => e.preventDefault() : undefined}
          >
            {t("nav.community")}
          </NavLink>
          {isTauri && (
            <NavLink to="/downloads" className="app-nav-link">
              {t("nav.downloads")}
            </NavLink>
          )}
          <NavLink to="/chat" className="app-nav-link">
            {t("nav.chat")}
          </NavLink>
          <NavLink to="/requests" className="app-nav-link">
            {t("nav.requests")}
          </NavLink>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {unavailable && (
            <span className="app-offline-indicator">
              {t("shell.navbar.offline")}
            </span>
          )}
          <button
            type="button"
            className="app-icon-button relative hidden sm:inline-flex"
            aria-label={t("nav.news")}
            onClick={() => setShowNews(true)}
          >
            <NewspaperIcon className="size-5" />
            {badgeVisible && (
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-ps-accent" />
            )}
          </button>
          <Dropdown>
            <DropdownButton as="button" className="app-profile-button">
              <UserAvatar
                media={user?.avatar}
                size={28}
                alt=""
                seed={user?.id != null ? String(user.id) : undefined}
              />
              <span className="hidden max-w-36 truncate sm:block">
                {username}
              </span>
              <ChevronDownIcon className="size-3.5 text-ps-muted" />
            </DropdownButton>
            <DropdownMenu anchor="bottom end" className="min-w-60">
              <DropdownItem
                href={user?.id ? `/community/${user.id}` : "/community"}
              >
                <UserCircleIcon />
                <DropdownLabel>{t("profile.mine")}</DropdownLabel>
              </DropdownItem>
              <DropdownItem onClick={() => setShowEditProfile(true)}>
                <UserCircleIcon />
                <DropdownLabel>{t("profile.edit")}</DropdownLabel>
              </DropdownItem>
              <DropdownItem href="/settings">
                <Cog6ToothIcon />
                <DropdownLabel>{t("nav.settings")}</DropdownLabel>
              </DropdownItem>
              {isAdmin && (
                <DropdownItem href="/admin" disabled={unavailable}>
                  <ShieldCheckIcon />
                  <DropdownLabel>{t("nav.admin")}</DropdownLabel>
                </DropdownItem>
              )}
              <DropdownDivider />
              <DropdownItem onClick={() => setShowNews(true)}>
                <NewspaperIcon />
                <DropdownLabel>{t("nav.news")}</DropdownLabel>
              </DropdownItem>
              <DropdownItem
                href="https://github.com/PlayStash/playstash-frontend#readme"
                target="_blank"
              >
                <BookOpenIcon />
                <DropdownLabel>{t("nav.docs")}</DropdownLabel>
              </DropdownItem>
              <DropdownItem
                href="https://github.com/PlayStash/playstash-frontend/issues"
                target="_blank"
              >
                <LifebuoyIcon />
                <DropdownLabel>{t("nav.support")}</DropdownLabel>
              </DropdownItem>
              <DropdownItem
                href="https://github.com/orgs/PlayStash/repositories"
                target="_blank"
              >
                <CodeBracketIcon />
                <DropdownLabel>{t("nav.github")}</DropdownLabel>
              </DropdownItem>
              <DropdownItem
                href="https://github.com/PlayStash/playstash-frontend/issues/new/choose"
                target="_blank"
              >
                <BugAntIcon />
                <DropdownLabel>{t("nav.bugReport")}</DropdownLabel>
              </DropdownItem>
              <DropdownDivider />
              <DropdownItem
                onClick={() => {
                  void logout();
                  navigate("/library", { replace: true });
                }}
              >
                <ArrowRightStartOnRectangleIcon />
                <DropdownLabel>{t("profile.logout")}</DropdownLabel>
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
      </div>
      {showNews && (
        <NewsDialog
          onClose={() => {
            setShowNews(false);
            setBadgeVisible(false);
          }}
        />
      )}
      {showEditProfile && user && (
        <UserEditorModal
          self
          user={user}
          onClose={() => setShowEditProfile(false)}
        />
      )}
    </>
  );
}
