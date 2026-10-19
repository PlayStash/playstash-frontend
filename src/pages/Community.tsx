import { Badge } from "@/components/tailwind/badge";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Text } from "@tw/text";
import { UserAvatar } from "@/components/UserAvatar";
import { Media } from "@/components/Media";
import { useAuth } from "@/context/AuthContext";
import { formatDecimal } from "@/utils/number";
import { getGameCoverMediaId } from "@/hooks/useGames";
import { getRoleLabel } from "@/utils/roles";
import clsx from "clsx";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { maskUser, useStreamerMode } from "@/utils/streamerMode";
import type { PlaystashGame, PlaystashUser } from "../api";
import { CommunityChatButton } from "@/components/GameChatButton";
import { translate, useTranslation } from "@/i18n";
import { formatMessage } from "@/utils/formatMessage";
import "@/styles/workspaces.css";

type UserDetailsMap = Record<number, PlaystashUser>;

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeUser<T>(user: T): T {
  if (!user || typeof user !== "object") return user;

  const candidate = user as T & { role?: unknown };
  if (typeof candidate.role === "number") {
    return { ...candidate, role: String(candidate.role) } as T;
  }

  return user;
}

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

function getBookmarkedGames(user: PlaystashUser | null | undefined) {
  return Array.isArray(user?.bookmarked_games) ? user.bookmarked_games : [];
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

function NetworkUserCard({
  user,
  isCurrentUser,
}: {
  user: PlaystashUser;
  isCurrentUser: boolean;
}) {
  const { t } = useTranslation();
  const stats = getUserStats(user);
  const recent = getRecentProgresses(user, 3);
  const streamerMode = useStreamerMode();
  const masked = streamerMode ? maskUser(user) : null;
  const displayName = masked?.displayName ?? getDisplayName(user);
  const handle = masked?.handle ?? getUserHandle(user);

  return (
    <Link
      to={`/community/${user.id}`}
      className="group block min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ps-accent"
    >
      <article className="community-member relative flex h-full flex-col">
        <div className="relative flex flex-1 flex-col">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <UserAvatar
                media={user.avatar}
                size={56}
                alt={displayName}
                fallback={getAvatarFallback(user)}
                seed={String(user.id)}
                className="bg-ps-panel-soft"
              />
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h3
                    className="min-w-0 max-w-full truncate text-base font-semibold tracking-[-0.02em] text-ps-text"
                    title={displayName}
                  >
                    {displayName}
                  </h3>
                  {isCurrentUser && (
                    <Badge color="indigo" className="shrink-0">
                      {t("community.you")}
                    </Badge>
                  )}
                  <Badge
                    color={getRoleBadgeColor(user.role)}
                    className="shrink-0"
                  >
                    {getRoleLabel(Number(user.role))}
                  </Badge>
                </div>
                <div
                  className="truncate text-sm text-ps-muted"
                  title={`@${handle}`}
                >
                  @{handle}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ps-muted">
                  <span
                    title={formatFullDateTime(stats.lastPlayed) ?? undefined}
                  >
                    {formatMessage(t("community.lastSeen"), {
                      date: formatDate(stats.lastPlayed),
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

            <ArrowRightIcon
              className="size-4 shrink-0 text-ps-muted transition-[color,translate] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-ps-accent motion-reduce:transition-colors motion-reduce:group-hover:translate-x-0"
              aria-hidden="true"
            />
          </div>

          <div className="community-member-stats">
            {[
              { label: t("community.stat.tracked"), value: stats.tracked },
              { label: t("community.stat.current"), value: stats.playing },
              { label: t("community.stat.finished"), value: stats.completed },
              { label: t("community.stat.saved"), value: stats.bookmarks },
            ].map((item) => (
              <div key={item.label}>
                <p title={item.label}>{item.label}</p>
                <strong data-numeric>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="mt-auto">
            <div className="mb-3 text-xs font-medium text-ps-muted">
              {t("community.recentlyPlayed")}
            </div>
            <div className="flex gap-2 overflow-hidden">
              {recent.length > 0 ? (
                recent.map((progress) => {
                  const game = progress.game;
                  const title =
                    game?.metadata?.title || game?.title || t("community.game");
                  return (
                    <GamePoster
                      key={progress.id}
                      game={game || undefined}
                      title={title}
                      width={80}
                      height={108}
                      className="shrink-0"
                    />
                  );
                })
              ) : (
                <div className="flex h-27 w-full items-center border border-dashed border-ps-line px-4 text-sm text-ps-muted">
                  {t("community.freshProfile")}
                </div>
              )}
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

export default function Community() {
  const { serverUrl, authFetch, user: loggedIn } = useAuth();
  const { t } = useTranslation();

  const [users, setUsers] = useState<PlaystashUser[]>([]);
  const [detailsById, setDetailsById] = useState<UserDetailsMap>({});
  const [loading, setLoading] = useState(false);
  const [detailsDone, setDetailsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const currentUserId = (loggedIn as any)?.id ?? (loggedIn as any)?.ID ?? null;
  const recentCutoff = useMemo(() => Date.now() - TWO_WEEKS_MS, []);

  // Restore scroll position when returning from a user profile.
  useScrollRestoration("community_scroll_position", users.length > 0);

  const fetchUserDetail = useCallback(
    async (userId: number) => {
      if (!serverUrl) return null;
      const base = serverUrl.replace(/\/+$/, "");
      const res = await authFetch(`${base}/api/users/${userId}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Failed to load user ${userId} (${res.status})`);
      }
      return normalizeUser<PlaystashUser>(await res.json());
    },
    [serverUrl, authFetch],
  );

  useEffect(() => {
    let cancelled = false;

    if (!serverUrl) {
      setUsers([]);
      setDetailsById({});
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/users`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok)
          throw new Error(
            formatMessage(translate("community.error.loadUsers"), {
              status: res.status,
            }),
          );
        const rawUsers: PlaystashUser[] = await res.json();
        if (cancelled) return;

        const activeUsers = rawUsers
          .map((entry) => normalizeUser(entry))
          .filter((entry) => !entry.deleted_at)
          .sort((left, right) => {
            if (left.id === currentUserId) return -1;
            if (right.id === currentUserId) return 1;
            return getDisplayName(left).localeCompare(getDisplayName(right));
          });

        setUsers(activeUsers);
        // No users → nothing to await; details `useEffect` keeps the gate
        // closed below otherwise.
        setDetailsDone(activeUsers.length === 0);
      } catch (fetchError: any) {
        if (!cancelled) {
          setError(
            fetchError?.message || translate("community.error.loadNetwork"),
          );
          setDetailsDone(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, currentUserId]);

  // The list is ordered by activity (last played) which is only known once
  // per-user details have loaded. Gate the grid on `detailsDone` so the card
  // order is final on first paint — otherwise the list re-sorts a second
  // after loading and the content visibly shifts.
  useEffect(() => {
    let cancelled = false;

    // An empty user list at mount must NOT open the gate — the fetch might
    // still be in flight and `detailsDone` would let the grid render in
    // alphabetical order before activity details arrive.
    if (users.length === 0) return;

    const missingIds = users
      .map((entry) => entry.id)
      .filter((userId) => !detailsById[userId]);

    if (!missingIds.length) {
      setDetailsDone(true);
      return;
    }

    (async () => {
      const results = await Promise.allSettled(
        missingIds.map((userId) => fetchUserDetail(userId)),
      );
      if (cancelled) return;

      setDetailsById((previous) => {
        const next = { ...previous };
        for (const result of results) {
          if (result.status === "fulfilled" && result.value?.id) {
            next[result.value.id] = result.value;
          }
        }
        return next;
      });
      setDetailsDone(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [users, detailsById, fetchUserDetail]);

  const members = useMemo(
    () =>
      users
        .map((entry) => detailsById[entry.id] || entry)
        .sort((left, right) => {
          if (left.id === currentUserId) return -1;
          if (right.id === currentUserId) return 1;
          const leftRecent = toTimestamp(getUserStats(left).lastPlayed);
          const rightRecent = toTimestamp(getUserStats(right).lastPlayed);
          if (leftRecent !== rightRecent) return rightRecent - leftRecent;
          return getDisplayName(left).localeCompare(getDisplayName(right));
        }),
    [users, detailsById, currentUserId],
  );

  const filteredMembers = useMemo(() => {
    if (!userSearch.trim()) return members;
    const q = userSearch.toLowerCase();
    return members.filter((m) => {
      const name = getDisplayName(m).toLowerCase();
      const handle = getUserHandle(m).toLowerCase();
      return name.includes(q) || handle.includes(q);
    });
  }, [members, userSearch]);

  const networkStats = useMemo(() => {
    const totalMinutes = members.reduce(
      (sum, member) => sum + getUserStats(member).totalMinutes,
      0,
    );
    const recentlyActiveMembers = members.filter(
      (member) => toTimestamp(getUserStats(member).lastPlayed) >= recentCutoff,
    ).length;

    return {
      members: members.length,
      recentlyActiveMembers,
      totalMinutes,
    };
  }, [members, recentCutoff]);

  if (!serverUrl) {
    return (
      <div className="ps-workspace flex min-h-full flex-col gap-6">
        <Heading>{t("nav.community")}</Heading>
        <Divider className="border-ps-line/80" />
        <div className="border-y border-ps-line py-8 text-sm text-ps-muted">
          {t("community.noServer")}
        </div>
      </div>
    );
  }

  return (
    <div className="ps-workspace flex min-h-full flex-col gap-6">
      <div className="workspace-heading">
        <div className="space-y-2">
          <Heading>{t("nav.community")}</Heading>
          <Text className="max-w-2xl">{t("community.description")}</Text>
        </div>
        <div className="flex flex-wrap gap-3">
          <CommunityChatButton />
          <span className="data-chip">
            <strong data-numeric>{networkStats.members}</strong>
            {t("community.members")}
          </span>
          <span className="data-chip">
            <strong data-numeric>{networkStats.recentlyActiveMembers}</strong>
            {t("community.activeTwoWeeks")}
          </span>
          <span className="data-chip">
            <strong>{formatPlaytime(networkStats.totalMinutes)}</strong>
            {t("community.loggedTime")}
          </span>
        </div>
      </div>
      <div className="w-full max-w-sm">
        <label
          htmlFor="community-member-search"
          className="mb-2 block text-xs font-medium text-ps-muted"
        >
          {t("community.searchMembers")}
        </label>
        <Input
          id="community-member-search"
          name="userSearch"
          value={userSearch}
          onChange={(e: any) => setUserSearch(e.target.value)}
          placeholder={t("community.searchPlaceholder")}
          clearable
          onClear={() => setUserSearch("")}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md bg-ps-danger/10 px-4 py-3 text-sm break-words text-ps-danger"
        >
          {error}
        </div>
      )}

      {loading || !detailsDone ? (
        <div className="community-members">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="h-80 animate-pulse border-b border-ps-line bg-ps-panel-soft motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : filteredMembers.length > 0 ? (
        <div className="community-members">
          {filteredMembers.map((member) => (
            <div key={member.id}>
              <NetworkUserCard
                user={member}
                isCurrentUser={member.id === currentUserId}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="border-y border-ps-line py-8 text-sm text-ps-muted">
          {userSearch.trim()
            ? t("community.noMatches")
            : t("community.noMembers")}
        </div>
      )}
    </div>
  );
}
