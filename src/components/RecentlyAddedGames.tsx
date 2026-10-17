import { useMemo } from "react";
import { useGames } from "@/hooks/useGames";
import { SectionExpander } from "./SectionExpander";
import GameCard from "./GameCard";
import { Button } from "./tailwind/button";
import { useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

/** Games added in the last week, narrowed by the library search text. */
export function RecentlyAddedGames({ search = "" }: { search?: string }) {
  const { t } = useTranslation();
  const addedSince = useMemo(
    () => new Date(Date.now() - 7 * 86400000).toISOString(),
    [],
  );
  const { games, count, loading, error, loadMore, hasMore } = useGames({
    search,
    sortBy: "created_at",
    order: "DESC",
    limit: 20,
    addedSince,
  });
  return (
    <SectionExpander
      title={fillTemplate(t("library.recent.title"), { count })}
      defaultOpen
    >
      {error && (
        <p role="alert" className="text-sm text-ps-danger">
          {error}
        </p>
      )}
      {!loading && !error && games.length === 0 && (
        <p className="p-4 text-sm text-ps-muted">
          {search.trim()
            ? t("library.recent.noMatch")
            : t("library.recent.empty")}
        </p>
      )}
      <div className="flex gap-5 overflow-x-auto py-2 pb-4">
        {games.map((game) => (
          <div className="w-40 shrink-0" key={game.id}>
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
  );
}
