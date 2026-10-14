import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { getErrorMessage } from "@/utils/apiError";
import { Button } from "@/components/tailwind/button";
import { Input } from "@/components/tailwind/input";
import { Textarea } from "@/components/tailwind/textarea";
import { Heading } from "@/components/tailwind/heading";
import { useTranslation, type TranslationKey } from "@/i18n";
import { formatMessage } from "@/utils/formatMessage";

const STATUS_LABELS: Record<GameRequest["status"], TranslationKey> = {
  open: "requests.status.open",
  approved: "requests.status.approved",
  fulfilled: "requests.status.fulfilled",
  rejected: "requests.status.rejected",
};

interface GameRequest {
  id: number;
  title: string;
  note: string;
  anonymous: boolean;
  status: "open" | "approved" | "fulfilled" | "rejected";
  game_id?: number;
  username?: string;
  mine: boolean;
  unread: boolean;
  updated_at: string;
}
interface RequestsPage {
  requests: GameRequest[];
  total: number;
  page: number;
  limit: number;
  unread_count: number;
  open_count: number;
}
export default function Requests() {
  const { serverUrl, authFetch, user } = useAuth();
  const { showAlert } = useAlertDialog();
  const { t, locale } = useTranslation();
  const admin = Number(user?.role) >= 3;
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RequestsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch(
        `${serverUrl}/api/requests?page=${page}&limit=20${mine ? "&mine=true" : ""}`,
      );
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, t("requests.error.load")),
        );
      setData(await response.json());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, serverUrl, page, mine]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);
  const mutate = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const response = await authFetch(`${serverUrl}/api/requests${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, t("requests.error.update")),
        );
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <Heading>{t("nav.requests")}</Heading>
        <p className="mt-2 text-sm text-ps-muted">
          {t("requests.description")}
        </p>
      </div>
      <form
        className="surface-panel space-y-4 rounded-2xl p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void mutate("", "POST", {
            title: title.trim(),
            note,
            anonymous,
          }).then((saved) => {
            if (saved) {
              setTitle("");
              setNote("");
              setMessage(t("requests.sent"));
            }
          });
        }}
      >
        <label className="block text-sm text-ps-muted">
          {t("requests.gameTitle")}
          <Input
            required
            maxLength={256}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block text-sm text-ps-muted">
          {t("requests.note")}
          <Textarea
            rows={3}
            maxLength={4000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-5 accent-indigo-500"
            checked={anonymous}
            disabled={busy}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          <span>
            {t("requests.anonymous")}
            <span className="block text-xs text-ps-muted">
              {t("requests.anonymousHint")}
            </span>
          </span>
        </label>
        <Button color="indigo" type="submit" disabled={busy || !title.trim()}>
          {t("requests.send")}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-ps-muted">
          {message}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">
          {admin && !mine ? t("requests.adminQueue") : t("requests.mine")}{" "}
          {data
            ? formatMessage(t("requests.counts"), {
                open: data.open_count,
                unread: data.unread_count,
              })
            : ""}
        </h2>
        <div className="flex items-center gap-3">
          {admin && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={mine}
                onChange={(event) => {
                  setMine(event.target.checked);
                  setPage(1);
                }}
              />
              {t("requests.onlyMine")}
            </label>
          )}
          <Button outline disabled={loading} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>
      {loading && !data && <p role="status">{t("requests.loading")}</p>}
      {data?.requests.map((request) => (
        <RequestRow
          key={request.id}
          request={request}
          locale={locale}
          admin={admin}
          busy={busy}
          onUpdate={(status, gameId) =>
            void mutate(`/${request.id}`, "PATCH", {
              status,
              ...(gameId ? { game_id: gameId } : {}),
            })
          }
          onSeen={() => void mutate(`/${request.id}/seen`, "PUT")}
          onCancel={() =>
            void showAlert({
              title: t("requests.cancel.title"),
              description: request.title,
              affirmativeText: t("requests.cancel.confirm"),
              negativeText: t("requests.cancel.keep"),
            }).then((confirmed) => {
              if (confirmed) void mutate(`/${request.id}`, "DELETE");
            })
          }
        />
      ))}
      {!loading && !data?.requests.length && !error && (
        <p className="surface-panel rounded-2xl p-5 text-ps-muted">
          {t("requests.empty")}
        </p>
      )}
      {data && data.total > data.limit && (
        <div className="flex items-center gap-3">
          <Button
            outline
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            {t("common.previous")}
          </Button>
          <span className="text-sm">
            {formatMessage(t("requests.page"), { page })}
          </span>
          <Button
            outline
            disabled={page * data.limit >= data.total || loading}
            onClick={() => setPage(page + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
function RequestRow({
  request,
  locale,
  admin,
  busy,
  onUpdate,
  onSeen,
  onCancel,
}: {
  request: GameRequest;
  locale: string;
  admin: boolean;
  busy: boolean;
  onUpdate: (status: GameRequest["status"], gameId?: number) => void;
  onSeen: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(request.status);
  const [gameId, setGameId] = useState(
    request.game_id ? String(request.game_id) : "",
  );
  useEffect(() => {
    setStatus(request.status);
    setGameId(request.game_id ? String(request.game_id) : "");
  }, [request.status, request.game_id]);
  return (
    <article className="surface-panel space-y-3 rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{request.title}</h3>
          <p className="text-xs text-ps-muted">
            {request.anonymous
              ? t("requests.anonymousRequester")
              : request.username || t("requests.yourRequest")}{" "}
            ·{" "}
            {formatMessage(t("requests.updated"), {
              date: new Date(request.updated_at).toLocaleString(locale),
            })}
          </p>
        </div>
        <span className="rounded-lg bg-ps-panel-soft px-3 py-1 text-sm capitalize">
          {STATUS_LABELS[request.status]
            ? t(STATUS_LABELS[request.status])
            : request.status}
          {request.unread ? ` · ${t("requests.newUpdate")}` : ""}
        </span>
      </div>
      {request.note && (
        <p className="whitespace-pre-wrap break-words text-sm">
          {request.note}
        </p>
      )}
      {request.game_id && (
        <Link
          className="text-sm text-ps-accent-strong underline"
          to={`/library/${request.game_id}`}
        >
          {t("requests.openGame")}
        </Link>
      )}
      {admin && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-ps-muted">
            {t("requests.status")}
            <select
              className="mt-1 block min-h-11 rounded-lg bg-ps-panel px-3 text-ps-text"
              value={status}
              disabled={busy}
              onChange={(event) =>
                setStatus(event.target.value as GameRequest["status"])
              }
            >
              {(Object.keys(STATUS_LABELS) as GameRequest["status"][]).map(
                (value) => (
                  <option key={value} value={value}>
                    {t(STATUS_LABELS[value])}
                  </option>
                ),
              )}
            </select>
          </label>
          {status === "fulfilled" && (
            <label className="max-w-52 text-sm text-ps-muted">
              {t("requests.addedGameId")}
              <Input
                type="number"
                min={1}
                value={gameId}
                disabled={busy}
                onChange={(event) => setGameId(event.target.value)}
              />
            </label>
          )}
          <Button
            outline
            disabled={
              busy ||
              (!!gameId &&
                (!Number.isInteger(Number(gameId)) || Number(gameId) < 1))
            }
            onClick={() =>
              onUpdate(
                status,
                status === "fulfilled" && gameId ? Number(gameId) : undefined,
              )
            }
          >
            {t("requests.saveStatus")}
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        {request.mine && request.unread && (
          <Button outline disabled={busy} onClick={onSeen}>
            {t("requests.markRead")}
          </Button>
        )}
        {request.mine && request.status === "open" && (
          <Button outline disabled={busy} onClick={onCancel}>
            {t("requests.cancel.confirm")}
          </Button>
        )}
      </div>
    </article>
  );
}
