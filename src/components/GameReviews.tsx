import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { getErrorMessage } from "@/utils/apiError";
import { Button } from "./tailwind/button";
import { Textarea } from "./tailwind/textarea";
import { translate, useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
interface Review {
  id: number;
  username: string;
  rating: number;
  comment: string;
  mine: boolean;
  updated_at: string;
}
interface Reviews {
  reviews: Review[];
  my_review: Review | null;
  average_rating: number | null;
  total: number;
  page: number;
  limit: number;
}
export function GameReviews({ gameId }: { gameId: number }) {
  const { authFetch, serverUrl, user } = useAuth();
  const { showAlert } = useAlertDialog();
  const { t } = useTranslation();
  const [data, setData] = useState<Reviews | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(
    async (initialize = false) => {
      setLoading(true);
      try {
        const response = await authFetch(
          `${serverUrl}/api/games/${gameId}/reviews?page=${page}&limit=10`,
        );
        if (!response.ok)
          throw new Error(
            await getErrorMessage(response, translate("reviews.loadFailed")),
          );
        const next: Reviews = await response.json();
        setData(next);
        if (initialize) {
          setRating(next.my_review?.rating || 5);
          setComment(next.my_review?.comment || "");
        }
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [authFetch, serverUrl, gameId, page],
  );
  useEffect(() => {
    void load(true);
  }, [load]);
  const save = async (remove = false) => {
    if (
      remove &&
      !(await showAlert({
        title: t("reviews.removeConfirm"),
        affirmativeText: t("reviews.removeConfirmAction"),
        negativeText: t("reviews.keep"),
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await authFetch(
        `${serverUrl}/api/games/${gameId}/reviews/me`,
        {
          method: remove ? "DELETE" : "PUT",
          headers: { "Content-Type": "application/json" },
          ...(remove ? {} : { body: JSON.stringify({ rating, comment }) }),
        },
      );
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, t("reviews.saveFailed")),
        );
      await load(true);
      setConsent(false);
      setMessage(remove ? t("reviews.removed") : t("reviews.published"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4">
      <p className="text-sm text-ps-muted">
        {data?.average_rating != null
          ? fillTemplate(t("reviews.summary"), {
              average: data.average_rating.toFixed(1),
              total: data.total,
            })
          : t("reviews.noRatings")}
      </p>
      <div className="space-y-3 rounded-xl bg-ps-panel-soft p-4">
        <h4 className="font-medium">{t("reviews.yourReview")}</h4>
        <label className="block text-sm text-ps-muted">
          {t("reviews.rating")}
          <select
            className="mt-1 block min-h-11 rounded-lg bg-ps-panel px-3 text-ps-text"
            value={rating}
            disabled={busy}
            onChange={(event) => setRating(Number(event.target.value))}
          >
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {fillTemplate(
                  t(value === 1 ? "reviews.stars.one" : "reviews.stars.other"),
                  { n: value },
                )}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-ps-muted">
          {t("reviews.comment")}
          <Textarea
            rows={4}
            maxLength={4000}
            value={comment}
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-5 accent-indigo-500"
            checked={consent}
            disabled={busy}
            onChange={(event) => setConsent(event.target.checked)}
          />
          {fillTemplate(t("reviews.consent"), {
            username: user?.username ?? "",
          })}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            color="indigo"
            disabled={busy || !consent}
            onClick={() => void save()}
          >
            {data?.my_review ? t("reviews.update") : t("reviews.publish")}
          </Button>
          {data?.my_review && (
            <Button outline disabled={busy} onClick={() => void save(true)}>
              {t("reviews.removeMine")}
            </Button>
          )}
        </div>
      </div>
      {loading && <p role="status">{t("reviews.loading")}</p>}
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-red-400">{error}</p>
          <Button outline onClick={() => void load()}>
            {t("reviews.reload")}
          </Button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {data?.reviews.map((review) => (
        <article key={review.id} className="border-t border-ps-line pt-3">
          <p className="text-sm font-medium">
            {review.username} · {review.rating}/5{" "}
            {review.mine ? `· ${t("reviews.you")}` : ""}
          </p>
          {review.comment && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">
              {review.comment}
            </p>
          )}
          <time className="text-xs text-ps-muted">
            {new Date(review.updated_at).toLocaleDateString()}
          </time>
        </article>
      ))}
      {data && data.total > data.limit && (
        <div className="flex items-center gap-3">
          <Button
            outline
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            {t("common.previous")}
          </Button>
          <span>{fillTemplate(t("reviews.page"), { page })}</span>
          <Button
            outline
            disabled={page * data.limit >= data.total || loading}
            onClick={() => setPage(page + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </section>
  );
}
