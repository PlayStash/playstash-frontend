import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { getErrorMessage } from "@/utils/apiError";
import { Button } from "@/components/tailwind/button";
import { Input } from "@/components/tailwind/input";
import { Textarea } from "@/components/tailwind/textarea";
import { Heading } from "@/components/tailwind/heading";

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
          await getErrorMessage(response, "Could not load game requests."),
        );
      setData(await response.json());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
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
          await getErrorMessage(response, "Could not update the request."),
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
        <Heading>Game requests</Heading>
        <p className="mt-2 text-sm text-ps-muted">
          Ask your library administrator to add a game. Updates appear here.
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
              setMessage("Request sent to your library administrator.");
            }
          });
        }}
      >
        <label className="block text-sm text-ps-muted">
          Game title
          <Input
            required
            maxLength={256}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block text-sm text-ps-muted">
          Note (optional)
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
            Hide my identity from the administrator
            <span className="block text-xs text-ps-muted">
              Avoid identifying information in the title or note. You can still
              receive status updates.
            </span>
          </span>
        </label>
        <Button color="indigo" type="submit" disabled={busy || !title.trim()}>
          Send request
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
          {admin && !mine ? "Administrator queue" : "Your requests"}{" "}
          {data
            ? `· ${data.open_count} open · ${data.unread_count} unread`
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
              Only my requests
            </label>
          )}
          <Button outline disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </div>
      {loading && !data && <p role="status">Loading requests…</p>}
      {data?.requests.map((request) => (
        <RequestRow
          key={request.id}
          request={request}
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
              title: "Cancel this request?",
              description: request.title,
              affirmativeText: "Cancel request",
              negativeText: "Keep request",
            }).then((confirmed) => {
              if (confirmed) void mutate(`/${request.id}`, "DELETE");
            })
          }
        />
      ))}
      {!loading && !data?.requests.length && !error && (
        <p className="surface-panel rounded-2xl p-5 text-ps-muted">
          No requests yet.
        </p>
      )}
      {data && data.total > data.limit && (
        <div className="flex items-center gap-3">
          <Button
            outline
            disabled={page === 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm">Page {page}</span>
          <Button
            outline
            disabled={page * data.limit >= data.total || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
function RequestRow({
  request,
  admin,
  busy,
  onUpdate,
  onSeen,
  onCancel,
}: {
  request: GameRequest;
  admin: boolean;
  busy: boolean;
  onUpdate: (status: GameRequest["status"], gameId?: number) => void;
  onSeen: () => void;
  onCancel: () => void;
}) {
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
              ? "Anonymous requester"
              : request.username || "Your request"}{" "}
            · Updated {new Date(request.updated_at).toLocaleString()}
          </p>
        </div>
        <span className="rounded-lg bg-ps-panel-soft px-3 py-1 text-sm capitalize">
          {request.status}
          {request.unread ? " · New update" : ""}
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
          Open added game
        </Link>
      )}
      {admin && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-ps-muted">
            Status
            <select
              className="mt-1 block min-h-11 rounded-lg bg-ps-panel px-3 text-ps-text"
              value={status}
              disabled={busy}
              onChange={(event) =>
                setStatus(event.target.value as GameRequest["status"])
              }
            >
              {["open", "approved", "fulfilled", "rejected"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          {status === "fulfilled" && (
            <label className="max-w-52 text-sm text-ps-muted">
              Added game ID (optional)
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
            Save status
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        {request.mine && request.unread && (
          <Button outline disabled={busy} onClick={onSeen}>
            Mark update as read
          </Button>
        )}
        {request.mine && request.status === "open" && (
          <Button outline disabled={busy} onClick={onCancel}>
            Cancel request
          </Button>
        )}
      </div>
    </article>
  );
}
