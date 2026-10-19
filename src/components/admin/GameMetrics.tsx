import { useEffect, useState } from "react";
import type { GameClientEventDto, GameMetricsSummaryDto } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { translate, useTranslation, type TranslationKey } from "@/i18n";
import { Button } from "../tailwind/button";
const EVENT_TYPE_LABELS: Record<string, TranslationKey> = {
  downloaded: "admin.metrics.type.downloaded",
  installed: "admin.metrics.type.installed",
  uninstalled: "admin.metrics.type.uninstalled",
  played: "admin.metrics.type.played",
};
interface MetricsPage {
  summary: GameMetricsSummaryDto;
  events: GameClientEventDto[];
}
async function fetchMetricsPage(
  authFetch: (input: string, init?: RequestInit) => Promise<Response>,
  serverUrl: string,
  gameId: number,
  failedMessage: string,
  beforeId?: number,
): Promise<MetricsPage> {
  const before = beforeId !== undefined ? `&before_id=${beforeId}` : "";
  const responses = await Promise.all([
    authFetch(`${serverUrl}/api/game/${gameId}/metrics`),
    authFetch(`${serverUrl}/api/game/${gameId}/events?limit=25${before}`),
  ]);
  if (responses.some((response) => !response.ok))
    throw new Error(failedMessage);
  const [summary, events] = await Promise.all(
    responses.map((response) => response.json()),
  );
  return { summary, events };
}
export function GameMetrics({ gameId }: { gameId: number }) {
  const { serverUrl, authFetch } = useAuth();
  const { t, locale } = useTranslation();
  const [summary, setSummary] = useState<GameMetricsSummaryDto | null>(null);
  const [events, setEvents] = useState<GameClientEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // A new automatic load starts: flag it while rendering, not in the effect.
  const [request, setRequest] = useState({ gameId, serverUrl, authFetch });
  if (
    request.gameId !== gameId ||
    request.serverUrl !== serverUrl ||
    request.authFetch !== authFetch
  ) {
    setRequest({ gameId, serverUrl, authFetch });
    setLoading(true);
    setError("");
  }
  useEffect(() => {
    let active = true;
    fetchMetricsPage(
      authFetch,
      serverUrl,
      gameId,
      translate("admin.metrics.loadFailed", locale),
    )
      .then((page) => {
        if (!active) return;
        setSummary(page.summary);
        setEvents(page.events);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gameId, serverUrl, authFetch, locale]);
  const load = async (more = false) => {
    setLoading(true);
    setError("");
    try {
      const page = await fetchMetricsPage(
        authFetch,
        serverUrl,
        gameId,
        t("admin.metrics.loadFailed"),
        more && events.length ? events[events.length - 1].id : undefined,
      );
      setSummary(page.summary);
      setEvents(more ? [...events, ...page.events] : page.events);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="space-y-4">
      <p className="text-xs text-ps-muted">{t("admin.metrics.description")}</p>
      {summary && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["downloaded", "installed", "uninstalled", "played"] as const).map(
            (type) => (
              <div key={type} className="rounded-xl bg-ps-panel-soft p-3">
                <dt className="capitalize text-xs text-ps-muted">
                  {t(EVENT_TYPE_LABELS[type])}
                </dt>
                <dd className="text-lg font-semibold">{summary[type]}</dd>
              </div>
            ),
          )}
        </dl>
      )}
      {events.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-ps-muted">
                <th className="py-2">{t("admin.metrics.action")}</th>
                <th>{t("admin.metrics.user")}</th>
                <th>{t("common.version")}</th>
                <th>{t("admin.metrics.when")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-ps-line">
                  <td className="py-2 capitalize">
                    {EVENT_TYPE_LABELS[event.type]
                      ? t(EVENT_TYPE_LABELS[event.type])
                      : event.type}
                  </td>
                  <td>{event.user_id}</td>
                  <td>{event.version_id || "—"}</td>
                  <td>{new Date(event.occurred_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <p role="status">{t("admin.metrics.loading")}</p>}
      {!loading && !events.length && !error && (
        <p className="text-ps-muted">{t("admin.metrics.empty")}</p>
      )}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button outline disabled={loading} onClick={() => void load()}>
          {t("common.refresh")}
        </Button>
        {events.length >= 25 && (
          <Button outline disabled={loading} onClick={() => void load(true)}>
            {t("admin.metrics.loadOlder")}
          </Button>
        )}
      </div>
    </section>
  );
}
