import { Badge } from "@/components/tailwind/badge";
import { Button } from "@/components/tailwind/button";
import { Divider } from "@tw/divider";
import { Heading, Subheading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { Text } from "@tw/text";
import { UserAvatar } from "@/components/UserAvatar";
import { Media } from "@/components/Media";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import BackButton from "@/components/BackButton";
import { UserEditorModal } from "@/components/admin/UserEditorModal";
import { formatDecimal } from "@/utils/number";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useAuthMediaUrl } from "@/hooks/useAuthMediaUrl";
import { getGameCoverMediaId } from "@/hooks/useGames";
import { getRoleLabel } from "@/utils/roles";
import { maskUser, useStreamerMode } from "@/utils/streamerMode";
import { PlaystashUserRoleEnum } from "@/api";
import "@/styles/workspaces.css";
import clsx from "clsx";
import {
  BookmarkIcon,
  CheckCircleIcon,
  ClockIcon,
  PencilSquareIcon,
  PlayCircleIcon,
  SparklesIcon,
  TrashIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { PlaystashGame, PlaystashUser, Progress } from "../api";
import { CommunityChatButton } from "@/components/GameChatButton";
import { translate, useTranslation, type TranslationKey } from "@/i18n";
import { formatMessage } from "@/utils/formatMessage";

type ProfileProgressSort = "last" | "time" | "title" | "state";

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

const PROGRESS_STATE_META: Record<
  string,
  { label: TranslationKey; tone: string; chip: keyof typeof badgeTones }
> = {
  UNPLAYED: {
    label: "community.progress.unplayed",
    tone: "text-ps-muted",
    chip: "zinc",
  },
  INFINITE: {
    label: "community.progress.ongoing",
    tone: "text-sky-400",
    chip: "blue",
  },
  PLAYING: {
    label: "community.progress.playing",
    tone: "text-emerald-400",
    chip: "green",
  },
  COMPLETED: {
    label: "community.progress.finished",
    tone: "text-violet-300",
    chip: "indigo",
  },
  ABORTED_TEMPORARY: {
    label: "community.progress.onHold",
    tone: "text-amber-400",
    chip: "amber",
  },
  ABORTED_PERMANENT: {
    label: "community.progress.dropped",
    tone: "text-rose-400",
    chip: "rose",
  },
};

const badgeTones = {
  zinc: true,
  blue: true,
  green: true,
  indigo: true,
  amber: true,
  rose: true,
} as const;

const PROFILE_FILTER_OPTIONS: { value: string; label: TranslationKey }[] = [
  { value: "all", label: "userProfile.filter.all" },
  { value: "PLAYING", label: "community.progress.playing" },
  { value: "INFINITE", label: "community.progress.ongoing" },
  { value: "COMPLETED", label: "community.progress.finished" },
  { value: "ABORTED_TEMPORARY", label: "community.progress.onHold" },
  { value: "ABORTED_PERMANENT", label: "community.progress.dropped" },
  { value: "UNPLAYED", label: "community.progress.unplayed" },
];

const PROFILE_SORT_OPTIONS: {
  value: ProfileProgressSort;
  label: TranslationKey;
}[] = [
  { value: "last", label: "userProfile.sort.last" },
  { value: "time", label: "userProfile.sort.time" },
  { value: "title", label: "userProfile.sort.title" },
  { value: "state", label: "userProfile.sort.state" },
];

function toTimestamp(value: unknown) {
  if (value == null || value === "") return -Infinity;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? -Infinity : date.getTime();
  }
  if (value instanceof Date) return value.getTime();
  return -Infinity;
}

/** Current interface language for date formatting outside of hooks. */
function currentLocale(): string {
  return (
    (typeof document !== "undefined" && document.documentElement.lang) || "en"
  );
}

function formatDate(value: unknown, fallback?: string) {
  const timestamp = toTimestamp(value);
  const empty = fallback ?? translate("community.never");
  if (timestamp === -Infinity) return empty;
  try {
    return new Date(timestamp).toLocaleDateString(currentLocale());
  } catch {
    return empty;
  }
}

function formatFullDateTime(value: unknown): string | null {
  const timestamp = toTimestamp(value);
  if (timestamp === -Infinity) return null;
  try {
    return new Date(timestamp).toLocaleString(currentLocale());
  } catch {
    return null;
  }
}

function formatPlaytime(minutes: number) {
  if (!minutes) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${formatDecimal(hours, hours < 10 ? 1 : 0)} h`;
}

function getDisplayName(user: PlaystashUser | null | undefined) {
  if (!user) return translate("profile.unknown");
  const fullName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return (
    fullName ||
    user.username ||
    formatMessage(translate("community.userFallback"), { id: user.id })
  );
}

function getUserHandle(user: PlaystashUser | null | undefined) {
  if (!user) return "unknown";
  return user.username || `user-${user.id}`;
}

function getAvatarFallback(user: PlaystashUser | null | undefined) {
  const source = getDisplayName(user)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="flex h-full w-full items-center justify-center bg-ps-panel-strong text-sm font-semibold text-ps-muted">
      {source || "PS"}
    </div>
  );
}

function getProgresses(user: PlaystashUser | null | undefined) {
  return Array.isArray(user?.progresses) ? user.progresses : [];
}

function getRecentProgresses(
  user: PlaystashUser | null | undefined,
  limit = 6,
) {
  return [...getProgresses(user)]
    .sort(
      (left, right) =>
        toTimestamp(right.last_played_at) - toTimestamp(left.last_played_at),
    )
    .slice(0, limit);
}

function getRecentWindowProgresses(
  user: PlaystashUser | null | undefined,
  sinceMs: number,
) {
  return getProgresses(user)
    .filter((progress) => toTimestamp(progress.last_played_at) >= sinceMs)
    .sort(
      (left, right) =>
        toTimestamp(right.last_played_at) - toTimestamp(left.last_played_at),
    );
}

function getBookmarkedGames(user: PlaystashUser | null | undefined) {
  return Array.isArray(user?.bookmarked_games) ? user.bookmarked_games : [];
}

function getPrimaryBackdropMediaId(user: PlaystashUser | null | undefined) {
  if (!user) return null;
  if (user.background?.id) return user.background.id;
  const fromRecentBackground = getRecentProgresses(user, 12).find(
    (progress) => progress.game?.metadata?.background?.id,
  );
  if (fromRecentBackground?.game?.metadata?.background?.id) {
    return fromRecentBackground.game.metadata.background.id;
  }
  const fromRecentCover = getRecentProgresses(user, 12)
    .map((progress) => getGameCoverMediaId(progress.game as PlaystashGame))
    .find(Boolean);
  if (fromRecentCover) return Number(fromRecentCover);
  const bookmarkCover = getBookmarkedGames(user)
    .map((game) => getGameCoverMediaId(game))
    .find(Boolean);
  return bookmarkCover ? Number(bookmarkCover) : null;
}

function getUserStats(user: PlaystashUser | null | undefined) {
  const progresses = getProgresses(user);
  const totalMinutes = progresses.reduce(
    (sum, progress) => sum + (Number(progress.minutes_played ?? 0) || 0),
    0,
  );
  const completed = progresses.filter(
    (progress) => progress.state === "COMPLETED",
  ).length;
  const playing = progresses.filter(
    (progress) => progress.state === "PLAYING" || progress.state === "INFINITE",
  ).length;
  return {
    tracked: progresses.length,
    totalMinutes,
    completed,
    playing,
    bookmarks: getBookmarkedGames(user).length,
    lastPlayed: getRecentProgresses(user, 1)[0]?.last_played_at,
  };
}

function getRoleBadgeColor(role?: string) {
  const numericRole = Number(role ?? 0);
  if (numericRole >= 3) return "amber" as const;
  if (numericRole >= 2) return "indigo" as const;
  return "zinc" as const;
}

function getProgressMeta(state?: string) {
  return (
    PROGRESS_STATE_META[state || "UNPLAYED"] || PROGRESS_STATE_META.UNPLAYED
  );
}

function GamePoster({
  game,
  title,
  width,
  height,
  className,
}: {
  game?: PlaystashGame | null;
  title: string;
  width: number;
  height: number;
  className?: string;
}) {
  const coverId = game ? getGameCoverMediaId(game) : null;
  const placeholderSize = width >= 120 ? "normal" : "small";
  return (
    <div
      className={clsx("community-poster", className)}
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {coverId ? (
        <Media
          media={{ id: Number(coverId) } as any}
          width={width}
          height={height}
          square
          alt={title}
          className="h-full w-full"
          gameId={game?.id}
          mediaSlot="cover"
          fallback={
            <CoverPlaceholder
              title={title}
              size={placeholderSize}
              className="h-full w-full"
            />
          }
        />
      ) : (
        <CoverPlaceholder
          title={title}
          size={placeholderSize}
          className="h-full w-full"
        />
      )}
    </div>
  );
}

function ProfileProgressCard({
  progress,
  onDelete,
}: {
  progress: Progress;
  onDelete?: (progressId: number, gameId: number, title: string) => void;
}) {
  const game = progress.game;
  const { t } = useTranslation();
  const title =
    game?.metadata?.title || game?.title || t("community.unknownGame");
  const meta = getProgressMeta(progress.state);
  return (
    <Link
      to={game?.id ? `/library/${game.id}` : "/library"}
      className="group relative block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ps-accent"
    >
      <article className="profile-progress h-full">
        <div className="flex gap-4">
          <GamePoster
            game={game || undefined}
            title={title}
            width={88}
            height={120}
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <h3 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold tracking-[-0.02em] text-ps-text">
                {title}
              </h3>
              <Badge color={meta.chip} className="shrink-0 self-start">
                {t(meta.label)}
              </Badge>
            </div>
            <div className="mt-3 min-w-0 space-y-2 text-sm text-ps-muted">
              <div className="flex min-w-0 items-center gap-2">
                <ClockIcon className="size-4 shrink-0 text-ps-accent-cool" />
                <span className="truncate">
                  {formatPlaytime(Number(progress.minutes_played ?? 0) || 0)}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <SparklesIcon className="size-4 shrink-0 text-ps-accent-cool" />
                <span
                  className="truncate"
                  title={
                    formatFullDateTime(progress.last_played_at) ?? undefined
                  }
                >
                  {formatMessage(t("community.lastPlayed"), {
                    date: formatDate(progress.last_played_at),
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const gid = (progress.game as any)?.id ?? (game as any)?.id ?? 0;
              onDelete(progress.id, gid, title);
            }}
            className="absolute right-2 bottom-2 inline-flex size-11 cursor-pointer touch-manipulation sm:size-10 items-center justify-center rounded-md text-ps-muted transition-colors hover:bg-ps-danger/10 hover:text-ps-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-accent-cool active:bg-ps-danger/15"
            aria-label={formatMessage(t("userProfile.delete.label"), { title })}
            title={formatMessage(t("userProfile.delete.label"), { title })}
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </article>
    </Link>
  );
}

export default function UserProfile() {
  const { serverUrl, authFetch, user: loggedIn } = useAuth();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const streamerMode = useStreamerMode();

  const [user, setUser] = useState<PlaystashUser | null>(null);
  const masked = streamerMode && user ? maskUser(user) : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [progressSearch, setProgressSearch] = useState("");
  const [progressFilter, setProgressFilter] = useState<string>("all");
  const [progressSort, setProgressSort] = useState<ProfileProgressSort>("last");

  const userId = id ? Number(id) : null;
  const currentUserId = (loggedIn as any)?.id ?? (loggedIn as any)?.ID ?? null;
  const currentUserRole = Number((loggedIn as any)?.role ?? 0);
  const isOwnProfile = userId === currentUserId;
  const isAdmin = currentUserRole >= Number(PlaystashUserRoleEnum._3);
  const canEdit = isOwnProfile || isAdmin;

  // Fixed for the page's lifetime; reading the clock during render is impure.
  const [recentCutoff] = useState(() => Date.now() - TWO_WEEKS_MS);

  useEffect(() => {
    if (!serverUrl || !userId || Number.isNaN(userId)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/users/${userId}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok)
          throw new Error(
            formatMessage(translate("userProfile.error.load"), {
              status: res.status,
            }),
          );
        const json = await res.json();
        if (!cancelled) setUser(json);
      } catch (e: any) {
        if (!cancelled)
          setError(e?.message || translate("userProfile.error.loadProfile"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, userId]);

  const stats = useMemo(() => getUserStats(user), [user]);
  const recent = useMemo(
    () => getRecentWindowProgresses(user, recentCutoff).slice(0, 8),
    [user, recentCutoff],
  );
  const bookmarks = useMemo(() => getBookmarkedGames(user).slice(0, 8), [user]);
  const allProgresses = useMemo(() => {
    const query = progressSearch.trim().toLowerCase();
    return getProgresses(user)
      .filter((progress) => {
        const title =
          progress.game?.metadata?.title ||
          progress.game?.title ||
          t("community.unknownGame");
        const matchesQuery = !query || title.toLowerCase().includes(query);
        const matchesState =
          progressFilter === "all" || progress.state === progressFilter;
        return matchesQuery && matchesState;
      })
      .sort((left, right) => {
        if (progressSort === "time") {
          return (
            Number(right.minutes_played ?? 0) - Number(left.minutes_played ?? 0)
          );
        }
        if (progressSort === "title") {
          const leftTitle =
            left.game?.metadata?.title ||
            left.game?.title ||
            t("community.unknownGame");
          const rightTitle =
            right.game?.metadata?.title ||
            right.game?.title ||
            t("community.unknownGame");
          return leftTitle.localeCompare(rightTitle);
        }
        if (progressSort === "state") {
          return t(getProgressMeta(left.state).label).localeCompare(
            t(getProgressMeta(right.state).label),
          );
        }
        return (
          toTimestamp(right.last_played_at) - toTimestamp(left.last_played_at)
        );
      });
  }, [user, progressSearch, progressFilter, progressSort, t]);

  const { url: backdropUrl } = useAuthMediaUrl(getPrimaryBackdropMediaId(user));

  // Another profile starts with fresh progress controls (reset during render).
  const [controlsUserId, setControlsUserId] = useState(userId);
  if (controlsUserId !== userId) {
    setControlsUserId(userId);
    setProgressSearch("");
    setProgressFilter("all");
    setProgressSort("last");
  }

  const handleDeleteProgress = useCallback(
    async (progressId: number, gameId: number, title?: string) => {
      if (!serverUrl || !userId || !gameId) return;

      const confirmed = await showAlert({
        title: t("userProfile.delete.title"),
        description: title
          ? formatMessage(t("userProfile.delete.description"), { title })
          : t("userProfile.delete.descriptionGeneric"),
        affirmativeText: t("common.delete"),
        negativeText: t("common.cancel"),
      });

      if (!confirmed) return;

      try {
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(
          `${base}/api/progresses/user/${userId}/game/${gameId}`,
          { method: "DELETE" },
        );
        if (!res.ok && res.status !== 204) {
          throw new Error(
            formatMessage(t("userProfile.delete.failedStatus"), {
              status: res.status,
            }),
          );
        }
        // Remove from local state
        setUser((prev) =>
          prev
            ? {
                ...prev,
                progresses: prev.progresses?.filter((p) => p.id !== progressId),
              }
            : prev,
        );
      } catch (err: any) {
        console.error("Failed to delete progress:", err);
        showAlert({
          title: t("userProfile.delete.failed"),
          description: err?.message || t("userProfile.delete.unknownError"),
        });
      }
    },
    [serverUrl, userId, authFetch, showAlert, t],
  );

  if (!serverUrl) {
    return (
      <div className="flex min-h-full flex-col gap-6">
        <Heading>{t("nav.community")}</Heading>
        <Divider className="border-ps-line/80" />
        <div className="border-y border-ps-line py-8 text-sm text-ps-muted">
          {t("community.noServer")}
        </div>
      </div>
    );
  }

  if (!userId || Number.isNaN(userId)) {
    return (
      <div className="flex min-h-full flex-col gap-6">
        <div className="flex flex-col gap-4">
          <BackButton />
          <Heading>{t("nav.community")}</Heading>
        </div>
        <Divider className="border-ps-line/80" />
        <div className="border-y border-ps-line py-8 text-sm text-ps-muted">
          {t("userProfile.invalidId")}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-full flex-col gap-6">
        <div className="flex flex-col gap-4">
          <BackButton />
          <Heading>{t("nav.community")}</Heading>
        </div>
        <Divider className="border-ps-line/80" />
        <div
          aria-hidden="true"
          className="h-64 animate-pulse border-y border-ps-line bg-ps-panel-soft motion-reduce:animate-none"
        />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex min-h-full flex-col gap-6">
        <div className="flex flex-col gap-4">
          <BackButton />
          <Heading>{t("nav.community")}</Heading>
        </div>
        <Divider className="border-ps-line/80" />
        <div className="border-y border-ps-line py-8 text-sm text-ps-muted">
          {error || t("userProfile.notFound")}
        </div>
      </div>
    );
  }

  return (
    <div className="ps-workspace flex min-h-full flex-col gap-6 overflow-x-hidden">
      <div className="flex flex-col gap-4">
        <BackButton />
        <div className="workspace-heading">
          <div className="min-w-0">
            <Heading>{t("nav.community")}</Heading>
            <Text>{t("userProfile.description")}</Text>
          </div>
          <CommunityChatButton className="ml-auto" />
          {canEdit && (
            <Button outline onClick={() => setShowEditProfile(true)}>
              <PencilSquareIcon className="size-4" />
              {t("profile.edit")}
            </Button>
          )}
        </div>
      </div>
      <section className="profile-header">
        {backdropUrl && (
          <img src={backdropUrl} alt="" className="profile-art" />
        )}
        <div className="profile-summary">
          <div className="flex w-full flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-end gap-4">
              <UserAvatar
                media={user.avatar}
                size={88}
                alt={masked?.displayName ?? getDisplayName(user)}
                fallback={getAvatarFallback(user)}
                seed={user?.id != null ? String(user.id) : undefined}
                className="bg-ps-panel-soft"
              />
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={getRoleBadgeColor(user.role)}>
                    {getRoleLabel(Number(user.role))}
                  </Badge>
                  {isOwnProfile && (
                    <Badge color="indigo">{t("userProfile.yourProfile")}</Badge>
                  )}
                  {!user.activated && (
                    <Badge color="rose">{t("userProfile.inactive")}</Badge>
                  )}
                </div>
                <div>
                  <h2
                    className="truncate text-2xl font-semibold tracking-[-0.03em] text-ps-text"
                    title={masked?.displayName ?? getDisplayName(user)}
                  >
                    {masked?.displayName ?? getDisplayName(user)}
                  </h2>
                  <p className="mt-1 truncate text-sm text-ps-muted">
                    @{masked?.handle ?? getUserHandle(user)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ps-muted">
                  <span
                    title={formatFullDateTime(user.created_at) ?? undefined}
                  >
                    {formatMessage(t("userProfile.joined"), {
                      date: formatDate(user.created_at, t("common.unknown")),
                    })}
                  </span>
                  <span
                    title={formatFullDateTime(stats.lastPlayed) ?? undefined}
                  >
                    {formatMessage(t("community.lastSeen"), {
                      date: formatDate(stats.lastPlayed, t("community.never")),
                    })}
                  </span>
                  <span>
                    {formatMessage(t("community.logged"), {
                      time: formatPlaytime(stats.totalMinutes),
                    })}
                  </span>
                </div>
              </div>
            </div>

            <div className="profile-statistics">
              {[
                {
                  icon: UserGroupIcon,
                  label: t("community.stat.tracked"),
                  value: stats.tracked,
                },
                {
                  icon: PlayCircleIcon,
                  label: t("community.stat.playing"),
                  value: stats.playing,
                },
                {
                  icon: CheckCircleIcon,
                  label: t("community.stat.finished"),
                  value: stats.completed,
                },
                {
                  icon: BookmarkIcon,
                  label: t("community.stat.bookmarks"),
                  value: stats.bookmarks,
                },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex min-w-0 items-center gap-2 text-xs text-ps-muted">
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate" title={item.label}>
                      {item.label}
                    </span>
                  </div>
                  <strong data-numeric>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-6">
        <section className="workspace-section">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Subheading>{t("userProfile.recent.title")}</Subheading>
              <Text>{t("userProfile.recent.description")}</Text>
            </div>
            <Badge color="zinc" className="shrink-0 whitespace-nowrap">
              {formatMessage(t("userProfile.recent.count"), {
                count: recent.length,
              })}
            </Badge>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {recent.length > 0 ? (
              recent.map((progress) => (
                <ProfileProgressCard
                  key={progress.id}
                  progress={progress}
                  onDelete={canEdit ? handleDeleteProgress : undefined}
                />
              ))
            ) : (
              <div className="col-span-full border-y border-ps-line py-6 text-sm text-ps-muted">
                {t("userProfile.recent.empty")}
              </div>
            )}
          </div>
        </section>

        <section className="workspace-section">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Subheading>{t("userProfile.all.title")}</Subheading>
              <Text>{t("userProfile.all.description")}</Text>
            </div>
            <Badge color="zinc" className="shrink-0 whitespace-nowrap">
              {formatMessage(
                t(
                  allProgresses.length === 1
                    ? "userProfile.all.matches.one"
                    : "userProfile.all.matches.other",
                ),
                { count: allProgresses.length },
              )}
            </Badge>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px] lg:items-end">
            <div className="w-full">
              <label
                htmlFor="profile-progress-search"
                className="mb-2 block text-xs font-medium text-ps-muted"
              >
                {t("userProfile.searchGames")}
              </label>
              <Input
                id="profile-progress-search"
                name="progressSearch"
                value={progressSearch}
                onChange={(event: any) => setProgressSearch(event.target.value)}
                placeholder={t("userProfile.searchPlaceholder")}
                clearable
                onClear={() => setProgressSearch("")}
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-ps-muted">
                {t("userProfile.filterByState")}
              </label>
              <Listbox
                name="progressFilter"
                value={progressFilter}
                onChange={(value: any) => setProgressFilter(String(value))}
              >
                {PROFILE_FILTER_OPTIONS.map((option) => (
                  <ListboxOption key={option.value} value={option.value}>
                    <ListboxLabel>{t(option.label)}</ListboxLabel>
                  </ListboxOption>
                ))}
              </Listbox>
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium text-ps-muted">
                {t("userProfile.sortBy")}
              </label>
              <Listbox
                name="progressSort"
                value={progressSort}
                onChange={(value: any) =>
                  setProgressSort(value as ProfileProgressSort)
                }
              >
                {PROFILE_SORT_OPTIONS.map((option) => (
                  <ListboxOption key={option.value} value={option.value}>
                    <ListboxLabel>{t(option.label)}</ListboxLabel>
                  </ListboxOption>
                ))}
              </Listbox>
            </div>
          </div>
          <div className="mt-5 overflow-x-hidden md:max-h-168 md:overflow-y-auto grid gap-4 md:grid-cols-2">
            {allProgresses.length > 0 ? (
              allProgresses.map((progress) => (
                <div key={`all-${progress.id}`}>
                  <ProfileProgressCard
                    progress={progress}
                    onDelete={canEdit ? handleDeleteProgress : undefined}
                  />
                </div>
              ))
            ) : (
              <div className="border-y border-ps-line py-6 text-sm text-ps-muted md:col-span-2">
                {t("userProfile.all.empty")}
              </div>
            )}
          </div>
        </section>

        <section className="workspace-section">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Subheading>{t("userProfile.bookmarks.title")}</Subheading>
              <Text>{t("userProfile.bookmarks.description")}</Text>
            </div>
            <Badge color="zinc" className="shrink-0 whitespace-nowrap">
              {formatMessage(t("userProfile.bookmarks.count"), {
                count: bookmarks.length,
              })}
            </Badge>
          </div>
          <div className="profile-bookmarks mt-5 flex gap-4 overflow-x-auto pb-2">
            {bookmarks.length > 0 ? (
              bookmarks.map((game) => {
                const title =
                  game.metadata?.title || game.title || t("community.game");
                return (
                  <Link
                    key={game.id}
                    to={`/library/${game.id}`}
                    className="group block w-37.5 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ps-accent"
                  >
                    <div className="text-ps-text">
                      <GamePoster
                        game={game}
                        title={title}
                        width={126}
                        height={170}
                      />
                      <div className="mt-3 line-clamp-2 text-sm font-medium break-words text-ps-text transition-colors group-hover:text-ps-accent-strong">
                        {title}
                      </div>
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="w-full border-y border-ps-line py-6 text-sm text-ps-muted">
                {t("userProfile.bookmarks.empty")}
              </div>
            )}
          </div>
        </section>
      </div>

      {showEditProfile && user && (
        <UserEditorModal
          key={user.id}
          user={user}
          onClose={() => setShowEditProfile(false)}
          onUserUpdated={(updatedUser: PlaystashUser) => {
            setUser(updatedUser);
            setShowEditProfile(false);
          }}
          self={isOwnProfile}
        />
      )}
    </div>
  );
}
