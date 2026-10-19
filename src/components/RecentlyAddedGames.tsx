import { useState } from "react";
import { useGames } from "@/hooks/useGames";
import { SectionExpander } from "./SectionExpander";
import GameCard from "./GameCard";
import { Button } from "./tailwind/button";
import { useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

/** Games added in the last week, narrowed by the library search text. */
export function RecentlyAddedGames({ search = "" }: { search?: string }) {
  const { t, locale } = useTranslation();
  // Fixed when the section mounts, so the query key stays stable.
  const [addedSince] = useState(() =>
    new Date(Date.now() - 7 * 86400000).toISOString(),
  );
  const { games, count, loading, error, loadMore, hasMore, refetch } = useGames(
    {
      search,
      sortBy: "created_at",
      order: "DESC",
      limit: 20,
      addedSince,
    },
  );
  return (
    <section className="ps-library-recent">
      <SectionExpander
        title={fillTemplate(t("library.recent.title"), {
          count: count.toLocaleString(locale),
        })}
        defaultOpen
      >
        {error && (
          <div role="alert" className="py-3 text-sm break-words text-ps-danger">
            <p>{error}</p>
            <Button outline className="mt-3" onClick={() => void refetch()}>
              {t("library.reload")}
            </Button>
          </div>
        )}
        {!loading && !error && games.length === 0 && (
          <p className="p-4 text-sm text-ps-muted">
            {search.trim()
              ? t("library.recent.noMatch")
              : t("library.recent.empty")}
          </p>
        )}
        <div className="ps-library-recent-shelf">
          {games.map((game) => (
            <div key={game.id}>
              <GameCard game={game} sortBy="created_at" />
            </div>
          ))}
        </div>
        {loading && (
          <p role="status" className="text-sm text-ps-muted">
            {t("library.recent.loading")}
          </p>
        )}
        {hasMore && (
          <Button outline onClick={() => void loadMore()} disabled={loading}>
            {t("library.recent.loadMore")}
          </Button>
        )}
      </SectionExpander>
    </section>
  );
}
