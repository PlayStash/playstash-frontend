import { useMemo } from "react";
import { useGames } from "@/hooks/useGames";
import { SectionExpander } from "./SectionExpander";
import GameCard from "./GameCard";
import { Button } from "./tailwind/button";

export function RecentlyAddedGames() {
  const addedSince = useMemo(
    () => new Date(Date.now() - 7 * 86400000).toISOString(),
    [],
  );
  const { games, count, loading, error, loadMore, hasMore } = useGames({
    search: "",
    sortBy: "created_at",
    order: "DESC",
    limit: 20,
    addedSince,
  });
  return (
    <SectionExpander
      title={`Recently Added · Last 7 days (${count})`}
      defaultOpen
    >
      {error && (
        <p role="alert" className="text-sm text-ps-danger">
          {error}
        </p>
      )}
      {!loading && !error && games.length === 0 && (
        <p className="p-4 text-sm text-ps-muted">
          No games added in the last week.
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
          Loading recently added games…
        </p>
      )}
      {hasMore && (
        <Button outline onClick={() => void loadMore()} disabled={loading}>
          Load more recently added games
        </Button>
      )}
    </SectionExpander>
  );
}
