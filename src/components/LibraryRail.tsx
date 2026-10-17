import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  ArrowPathIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  StarIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { getGameCoverMediaId, useGames } from "@/hooks/useGames";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useTranslation } from "@/i18n";
import {
  isLibraryLoadAllowed,
  LIBRARY_PREFERENCES_EVENT,
  requestLibraryLoad,
} from "@/utils/libraryPreferences";
import { displayTitle, useShowMappedTitle } from "@/utils/mappedTitle";
import { fillTemplate } from "@/utils/downloadPipeline";
import { Media } from "./Media";
import { Button } from "./tailwind/button";
import "@/styles/library.css";

/** Persistent library navigation, shared by the collection and game pages. */
export function LibraryRail({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const { serverUrl } = useAuth();
  const { isOnline } = useOnlineStatus();
  const location = useLocation();
  const showMappedTitle = useShowMappedTitle();
  const [search, setSearch] = useState("");
  const [loadAllowed, setLoadAllowed] = useState(isLibraryLoadAllowed);
  const [browserSearch, setBrowserSearch] = useState(location.search);
  const deferredSearch = useDebouncedValue(search.trim(), 250);

  useEffect(() => {
    if (location.pathname === "/library") setBrowserSearch(location.search);
    setLoadAllowed(isLibraryLoadAllowed());
  }, [location.search, location.pathname]);

  useEffect(() => {
    const syncLoad = () => setLoadAllowed(isLibraryLoadAllowed());
    const syncLocation = () => setBrowserSearch(window.location.search);
    window.addEventListener("playstash:library-load-requested", syncLoad);
    window.addEventListener(LIBRARY_PREFERENCES_EVENT, syncLoad);
    window.addEventListener("playstash:library-location-change", syncLocation);
    return () => {
      window.removeEventListener("playstash:library-load-requested", syncLoad);
      window.removeEventListener(LIBRARY_PREFERENCES_EVENT, syncLoad);
      window.removeEventListener(
        "playstash:library-location-change",
        syncLocation,
      );
    };
  }, []);

  const enableLoading = () => {
    requestLibraryLoad();
    setLoadAllowed(true);
    window.dispatchEvent(new Event("playstash:library-load-requested"));
  };
  const bookmarked = new URLSearchParams(browserSearch).get("bookmarked");
  const favorites = bookmarked === "mine" || bookmarked === "1";
  const { games, count, loading, error, loadMore, hasMore, refetch } = useGames(
    {
      search: deferredSearch,
      sortBy: "sort_title",
      order: "ASC",
      limit: 100,
      bookmarkFilter: favorites ? "mine" : "all",
      enabled: loadAllowed && isOnline,
    },
  );
  const orderedGames = useMemo(() => {
    const collator = new Intl.Collator(locale, {
      sensitivity: "base",
      numeric: true,
    });
    return [...games].sort((a, b) =>
      collator.compare(
        displayTitle(a, showMappedTitle),
        displayTitle(b, showMappedTitle),
      ),
    );
  }, [games, locale, showMappedTitle]);
  const selectedId = /^\/library\/(\d+)/.exec(location.pathname)?.[1];

  return (
    <aside
      className={clsx("ps-library-rail", className)}
      aria-label={t("library.rail.title")}
    >
      <div className="ps-library-rail-head">
        <div className="ps-library-rail-heading">
          <h2>{t("library.rail.title")}</h2>
          {loadAllowed && serverUrl && (
            <span>{count.toLocaleString(locale)}</span>
          )}
        </div>
        <div className="ps-library-rail-search">
          <MagnifyingGlassIcon aria-hidden="true" />
          <input
            type="search"
            value={search}
            aria-label={t("library.rail.search")}
            placeholder={t("library.rail.search")}
            disabled={!serverUrl}
            onChange={(event) => {
              setSearch(event.target.value);
              if (event.target.value.trim() && !loadAllowed) enableLoading();
            }}
          />
          {search && (
            <button
              type="button"
              aria-label={t("common.clear")}
              onClick={() => setSearch("")}
            >
              <XMarkIcon aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <nav
        className="ps-library-rail-collections"
        aria-label={t("library.categories.category")}
      >
        <Link
          to="/library"
          onClick={onNavigate}
          className={clsx(!selectedId && !favorites && "is-current")}
          aria-current={!selectedId && !favorites ? "page" : undefined}
        >
          <Squares2X2Icon aria-hidden="true" />
          <span>{t("library.categories.allGames")}</span>
        </Link>
        <Link
          to="/library?bookmarked=mine"
          onClick={() => {
            enableLoading();
            onNavigate?.();
          }}
          className={clsx(favorites && "is-current")}
          aria-current={!selectedId && favorites ? "page" : undefined}
        >
          <StarIcon aria-hidden="true" />
          <span>{t("library.rail.favorites")}</span>
        </Link>
      </nav>
      <div className="ps-library-rail-list-label">
        <span>{t("library.rail.alphabetical")}</span>
        <button
          type="button"
          aria-label={t("library.reload")}
          title={t("library.reload")}
          disabled={!serverUrl || loading || !isOnline}
          onClick={() => {
            if (!loadAllowed) enableLoading();
            else void refetch();
          }}
        >
          <ArrowPathIcon
            className={clsx(loading && "motion-safe:animate-spin")}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="ps-library-rail-scroll">
        {!serverUrl && (
          <p className="ps-library-rail-message">{t("library.noServer")}</p>
        )}
        {serverUrl && !isOnline && (
          <p className="ps-library-rail-message">
            {t("library.offline.unavailable")}
          </p>
        )}
        {serverUrl && isOnline && !loadAllowed && (
          <div className="ps-library-rail-message">
            <p>{t("library.notLoaded")}</p>
            <Button outline onClick={enableLoading}>
              {t("library.loadNow")}
            </Button>
          </div>
        )}
        {error && (
          <div className="ps-library-rail-message" role="alert">
            <p className="text-ps-danger">{error}</p>
            <Button outline onClick={() => void refetch()}>
              {t("library.reload")}
            </Button>
          </div>
        )}
        <ul className="ps-library-rail-games">
          {orderedGames.map((game) => {
            const title =
              displayTitle(game, showMappedTitle) ||
              t("gameCard.fallbackTitle");
            const coverId = getGameCoverMediaId(game);
            const selected = selectedId === String(game.id);
            return (
              <li key={game.id}>
                <Link
                  to={`/library/${game.id}`}
                  onClick={onNavigate}
                  className={clsx(selected && "is-current")}
                  aria-current={selected ? "page" : undefined}
                  title={title}
                  aria-label={title}
                >
                  {coverId ? (
                    <Media
                      media={{
                        id: Number(coverId),
                        created_at: new Date(0),
                        entity_version: 0,
                      }}
                      width={25}
                      height={35}
                      square
                      fit="cover"
                      alt=""
                      gameId={game.id}
                      mediaSlot="cover"
                      className="ps-library-rail-thumbnail"
                      fallback={
                        <span className="ps-library-rail-initial">
                          {title.charAt(0)}
                        </span>
                      }
                    />
                  ) : (
                    <span className="ps-library-rail-initial">
                      {title.charAt(0)}
                    </span>
                  )}
                  <span className="ps-library-rail-game-title">{title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {loadAllowed &&
          serverUrl &&
          isOnline &&
          !loading &&
          !error &&
          !games.length && (
            <p className="ps-library-rail-message">{t("library.empty")}</p>
          )}
        {loading && (
          <p className="ps-library-rail-message" role="status">
            {t("library.loadingMore")}
          </p>
        )}
        {hasMore && (
          <div className="ps-library-rail-more">
            <Button outline disabled={loading} onClick={() => void loadMore()}>
              {t("library.rail.loadMore")}
            </Button>
          </div>
        )}
      </div>
      {loadAllowed && serverUrl && (
        <p className="ps-library-rail-footer">
          {fillTemplate(t("library.rail.showing"), {
            loaded: games.length,
            total: count,
          })}
        </p>
      )}
    </aside>
  );
}
