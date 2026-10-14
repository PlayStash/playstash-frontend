import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/tailwind/button";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { Media } from "@/components/Media";
import { useInstalledGames } from "@/hooks/useInstalledGames";
import { useTranslation } from "@/i18n";
import { setBigPicture } from "@/utils/bigPicture";
import {
  bigPictureGames,
  displayTitle,
  moveGridIndex,
} from "@/utils/bigPictureInstalled";
import { launchInstalledGame } from "@/utils/launchInstalledGame";
import { useShowMappedTitle } from "@/utils/mappedTitle";

const ARROW_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const;
type ArrowKey = (typeof ARROW_KEYS)[number];

function coverMediaId(metadata: Record<string, any> | null): number {
  const id = metadata?.metadata?.cover?.id ?? metadata?.cover?.id;
  return typeof id === "number" ? id : Number(id) || 0;
}

/**
 * Big Picture home: the installed games as a controller-friendly grid.
 *
 * Arrow keys / D-pad / stick select, Enter / A play, Esc / B close Big
 * Picture, double-click plays. The root is a non-modal dialog so the gamepad
 * navigator keeps focus inside the grid and maps B to Escape.
 */
export function BigPictureInstalled({
  onClose,
}: {
  /** Leaves Big Picture (defaults to switching it off). */
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const showMappedTitle = useShowMappedTitle();
  const { installedGames, loading } = useInstalledGames();
  const games = useMemo(
    () => bigPictureGames(installedGames),
    [installedGames],
  );
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("");
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback(() => {
    if (onClose) onClose();
    else void setBigPicture(false).catch(() => undefined);
  }, [onClose]);

  useEffect(() => {
    if (selected >= games.length && games.length > 0) setSelected(0);
  }, [games.length, selected]);

  // Preselect the first game once the list arrives.
  useEffect(() => {
    if (games.length === 0) return;
    const active = document.activeElement;
    if (!gridRef.current?.contains(active)) {
      tileRefs.current[0]?.focus({ preventScroll: true });
    }
    // Only when the list first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length > 0]);

  const play = useCallback(
    async (index: number) => {
      const game = games[index];
      if (!game || launchingRef.current) return;
      launchingRef.current = true;
      setLaunching(true);
      setStatus(
        t("bigPicture.launching").replace(
          "{title}",
          displayTitle(game, showMappedTitle),
        ),
      );
      try {
        const result = await launchInstalledGame({
          gameId: game.gameId,
          source: "big-picture",
          installed: game,
          showErrors: false,
        });
        setStatus(
          result.ok
            ? t("bigPicture.launched").replace(
                "{title}",
                displayTitle(game, showMappedTitle),
              )
            : result.message || t("launch.failedTitle"),
        );
      } finally {
        launchingRef.current = false;
        setLaunching(false);
      }
    },
    [games, t, showMappedTitle],
  );

  const select = useCallback((index: number) => {
    setSelected(index);
    const tile = tileRefs.current[index];
    tile?.focus({ preventScroll: true });
    tile?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, []);

  const columns = useCallback(() => {
    const tiles = tileRefs.current.filter(Boolean) as HTMLButtonElement[];
    if (tiles.length < 2) return 1;
    const top = tiles[0].offsetTop;
    const index = tiles.findIndex((tile) => tile.offsetTop !== top);
    return index <= 0 ? tiles.length : index;
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void play(selected);
      return;
    }
    if ((ARROW_KEYS as readonly string[]).includes(event.key)) {
      event.preventDefault();
      select(
        moveGridIndex(selected, event.key as ArrowKey, columns(), games.length),
      );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t("bigPicture.installedTitle")}
      className="flex min-h-full flex-col gap-6"
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-ps-text">
          {t("bigPicture.installedTitle")}
        </h1>
        <Button outline onClick={close}>
          {t("bigPicture.close")}
        </Button>
      </div>

      {games.length === 0 ? (
        <p className="text-lg text-ps-muted">
          {loading ? t("bigPicture.loading") : t("bigPicture.empty")}
        </p>
      ) : (
        <div
          ref={gridRef}
          role="listbox"
          aria-label={t("bigPicture.installedTitle")}
          className="flex flex-wrap gap-4"
        >
          {games.map((game, index) => {
            const metadata = game.cachedMetadata ?? game.gameMetadata;
            const coverId = coverMediaId(metadata);
            const title = displayTitle(game, showMappedTitle);
            return (
              <button
                key={`${game.gameId}:${game.versionDirectory}`}
                ref={(element) => {
                  tileRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={index === selected}
                data-testid="big-picture-game"
                onFocus={() => setSelected(index)}
                onClick={(event) => {
                  // Keyboard / controller activation (no pointer) plays;
                  // a mouse click only selects, a double-click plays.
                  if (event.detail === 0) void play(index);
                  else setSelected(index);
                }}
                onDoubleClick={() => void play(index)}
                className={
                  "flex w-[196px] flex-col gap-3 rounded-xl p-2 text-left outline-none transition " +
                  (index === selected
                    ? "bg-ps-panel-strong ring-2 ring-ps-accent"
                    : "hover:bg-ps-panel-soft")
                }
              >
                <div className="h-[270px] w-[180px] overflow-hidden rounded-[8px] bg-ps-panel-soft">
                  {coverId > 0 ? (
                    <Media
                      media={
                        {
                          id: coverId,
                          created_at: new Date(0),
                          entity_version: 0,
                        } as any
                      }
                      gameId={game.gameId}
                      mediaSlot="cover"
                      width={180}
                      height={270}
                      fit="cover"
                      className="h-full w-full"
                      alt={title}
                      fallback={
                        <CoverPlaceholder
                          title={title}
                          className="h-full w-full"
                        />
                      }
                    />
                  ) : (
                    <CoverPlaceholder title={title} className="h-full w-full" />
                  )}
                </div>
                <span className="line-clamp-2 text-lg text-ps-text">
                  {title}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-auto space-y-3">
        <p className="text-lg text-ps-muted">{t("bigPicture.hint")}</p>
        <p role="status" className="min-h-6 text-sm text-ps-text">
          {status}
        </p>
        <Button
          color="indigo"
          onClick={() => void play(selected)}
          disabled={launching || games.length === 0}
        >
          {t("bigPicture.playSelected")}
        </Button>
      </div>
    </div>
  );
}
