import { useEffect, useState } from "react";
import type { GameClientEventDto, GameMetricsSummaryDto } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { Button } from "../tailwind/button";
const EVENT_TYPE_LABELS: Record<string, TranslationKey> = {
  downloaded: "admin.metrics.type.downloaded",
  installed: "admin.metrics.type.installed",
  uninstalled: "admin.metrics.type.uninstalled",
  played: "admin.metrics.type.played",
};
export function GameMetrics({ gameId }: { gameId: number }) {
  const { serverUrl, authFetch } = useAuth();
  const { t } = useTranslation();
  const [summary, setSummary] = useState<GameMetricsSummaryDto | null>(null);
  const [events, setEvents] = useState<GameClientEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async (more = false) => {
    setLoading(true);
    setError("");
    try {
      const before =
        more && events.length
          ? `&before_id=${events[events.length - 1].id}`
          : "";
      const responses = await Promise.all([
        authFetch(`${serverUrl}/api/game/${gameId}/metrics`),
        authFetch(`${serverUrl}/api/game/${gameId}/events?limit=25${before}`),
      ]);
      if (responses.some((response) => !response.ok))
        throw new Error(t("admin.metrics.loadFailed"));
      const [nextSummary, nextEvents] = await Promise.all(
        responses.map((response) => response.json()),
      );
      setSummary(nextSummary);
      setEvents(more ? [...events, ...nextEvents] : nextEvents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [gameId, serverUrl]);
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
