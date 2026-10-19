import { useTranslation } from "@/i18n";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { Logo } from "@components/Logo";
import {
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
  BugAntIcon,
  CodeBracketIcon,
  ChatBubbleLeftRightIcon,
  ChevronUpIcon,
  LifebuoyIcon,
  NewspaperIcon,
  ShieldExclamationIcon,
  Squares2X2Icon,
  UserGroupIcon,
  UserIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/16/solid";
import { Cog6ToothIcon } from "@heroicons/react/20/solid";
import { Badge } from "@tw/badge";
import { isTauriApp } from "@/utils/tauri";
import {
  Dropdown,
  DropdownButton,
  DropdownDivider,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
} from "@tw/dropdown";
import {
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
  SidebarSpacer,
  Sidebar as TailwindSidebar,
} from "@tw/sidebar";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { PlaystashUserRoleEnum } from "../api";
import { useNews } from "../hooks/useNews";
import { UserEditorModal } from "./admin/UserEditorModal";
import { NewsDialog } from "./news/NewsDialog";
import { maskUser, useStreamerMode } from "@/utils/streamerMode";

export function Sidebar() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showNews, setShowNews] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const streamerMode = useStreamerMode();
  const masked = streamerMode && user ? maskUser(user) : null;
  const username =
    masked?.displayName ?? (user?.username || t("profile.unknown"));
  const email = masked?.email ?? (user?.email || "");
  const avatar = user?.avatar;
  const userAvatarSeed = user?.id != null ? String(user.id) : undefined;
  const { hasNewNews } = useNews();
  const [badgeVisible, setBadgeVisible] = useState(hasNewNews);
  // New news shows the badge again (closing the dialog hides it).
  const [seenNewNews, setSeenNewNews] = useState(hasNewNews);
  if (hasNewNews !== seenNewNews) {
    setSeenNewNews(hasNewNews);
    if (hasNewNews) setBadgeVisible(true);
  }

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    void logout();
    navigate("/library", { replace: true });
  };
  const handleCloseNewsDialog = () => {
    setShowNews(false);
    setBadgeVisible(false);
  };

  const roleVal = user?.role;
  const isAdmin = Number(roleVal) >= Number(PlaystashUserRoleEnum._3);
  const isTauri = isTauriApp();
  const { isOnline } = useOnlineStatus();
  const isCurrentPath = (path: string) => {
    if (path === "/library") {
      return (
        location.pathname === "/library" ||
        location.pathname.startsWith("/library/")
      );
    }

    return (
      location.pathname === path || location.pathname.startsWith(`${path}/`)
    );
  };

  return (
    <>
      <TailwindSidebar>
        <SidebarHeader>
          <Logo variant="sidebar" height="h-4" />
        </SidebarHeader>
        <SidebarBody>
          <SidebarSection>
            <SidebarItem href="/chat" current={isCurrentPath("/chat")}>
              <ChatBubbleLeftRightIcon />
              <SidebarLabel>{t("nav.chat")}</SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/requests" current={isCurrentPath("/requests")}>
              <BookOpenIcon />
              <SidebarLabel>{t("nav.requests")}</SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/library" current={isCurrentPath("/library")}>
              <Squares2X2Icon />
              <SidebarLabel className="flex justify-between w-full">
                {t("nav.library")}
              </SidebarLabel>
            </SidebarItem>
            {isTauri && (
              <SidebarItem
                href="/downloads"
                current={isCurrentPath("/downloads")}
              >
                <ArrowDownTrayIcon />
                <SidebarLabel className="flex justify-between w-full">
                  {t("nav.downloads")}
                </SidebarLabel>
              </SidebarItem>
            )}
            <SidebarItem
              href={isTauri && !isOnline ? undefined : "/community"}
              current={isCurrentPath("/community")}
              onClick={
                isTauri && !isOnline
                  ? (e: React.MouseEvent) => e.preventDefault()
                  : undefined
              }
              className={
                isTauri && !isOnline ? "opacity-40 cursor-not-allowed" : ""
              }
            >
              <UserGroupIcon />
              <SidebarLabel className="flex justify-between w-full">
                {t("nav.community")}
              </SidebarLabel>
            </SidebarItem>
            <SidebarItem href="/settings" current={isCurrentPath("/settings")}>
              <Cog6ToothIcon />
              <SidebarLabel className="flex justify-between w-full">
                {t("nav.settings")}
              </SidebarLabel>
            </SidebarItem>
            {isAdmin ? (
              <SidebarItem
                href={isTauri && !isOnline ? undefined : "/admin"}
                current={isCurrentPath("/admin")}
                onClick={
                  isTauri && !isOnline
                    ? (e: React.MouseEvent) => e.preventDefault()
                    : undefined
                }
                className={
                  isTauri && !isOnline ? "opacity-40 cursor-not-allowed" : ""
                }
              >
                <ShieldExclamationIcon />
                <SidebarLabel>{t("nav.admin")}</SidebarLabel>
              </SidebarItem>
            ) : (
              <SidebarItem
                href="#"
                onClick={(e) => e.preventDefault()}
                className="hidden cursor-not-allowed"
              >
                <ShieldExclamationIcon />
                <SidebarLabel>{t("nav.admin")}</SidebarLabel>
              </SidebarItem>
            )}
          </SidebarSection>

          <SidebarSpacer />
          <SidebarSection>
            <SidebarItem
              href="https://github.com/PlayStash/playstash-frontend#readme"
              target="_blank"
            >
              <BookOpenIcon />
              <SidebarLabel>{t("nav.docs")}</SidebarLabel>
            </SidebarItem>
            <SidebarItem
              href="https://github.com/PlayStash/playstash-frontend/issues"
              target="_blank"
            >
              <LifebuoyIcon />
              <SidebarLabel>{t("nav.support")}</SidebarLabel>
            </SidebarItem>
            <SidebarItem
              href="https://github.com/orgs/PlayStash/repositories"
              target="_blank"
            >
              <CodeBracketIcon />
              <SidebarLabel>{t("nav.github")}</SidebarLabel>
            </SidebarItem>
            <SidebarItem
              href="https://github.com/PlayStash/playstash-frontend/issues/new/choose"
              target="_blank"
            >
              <BugAntIcon />
              <SidebarLabel>{t("nav.bugReport")}</SidebarLabel>
            </SidebarItem>
            <SidebarItem
              onClick={(e: any) => {
                e.preventDefault();
                setShowNews(true);
              }}
            >
              <NewspaperIcon />
              <SidebarLabel className="flex justify-between w-full items-center">
                {t("nav.news")}
                {badgeVisible && (
                  <Badge
                    color="amber"
                    className="ml-2 motion-safe:animate-pulse"
                  >
                    {t("nav.new")}
                  </Badge>
                )}
              </SidebarLabel>
            </SidebarItem>
          </SidebarSection>
        </SidebarBody>
        <SidebarFooter>
          <Dropdown>
            <DropdownButton as={SidebarItem}>
              <span className="flex min-w-0 items-center gap-3">
                <UserAvatar
                  media={avatar}
                  size={40}
                  alt={username}
                  seed={userAvatarSeed}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm/5 font-medium text-ps-text">
                    {username}
                  </span>
                  {email && (
                    <span className="block truncate text-xs/5 font-normal text-ps-muted">
                      {email}
                    </span>
                  )}
                </span>
              </span>
              <ChevronUpIcon />
            </DropdownButton>
            <DropdownMenu className="min-w-64" anchor="top start">
              <DropdownItem
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowEditProfile(true);
                }}
              >
                <UserIcon />
                <DropdownLabel>{t("profile.edit")}</DropdownLabel>
              </DropdownItem>
              <DropdownDivider />
              <DropdownItem
                href={user?.id ? `/community/${user.id}` : "/community"}
              >
                <UserIcon />
                <DropdownLabel>{t("profile.mine")}</DropdownLabel>
              </DropdownItem>
              <DropdownDivider />
              <DropdownItem href="#" onClick={handleLogout}>
                <ArrowRightStartOnRectangleIcon />
                <DropdownLabel>{t("profile.logout")}</DropdownLabel>
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </SidebarFooter>
      </TailwindSidebar>
      {showNews && <NewsDialog onClose={handleCloseNewsDialog} />}
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
