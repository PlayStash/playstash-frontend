import { useEffect, useState } from "react";
import type { PlaystashGame } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { getErrorMessage } from "@/utils/apiError";
import { emitGameUpdated } from "@/utils/gameUpdates";
import { Button } from "../tailwind/button";
import { Input } from "../tailwind/input";
import { Switch } from "../tailwind/switch";
export function GameAccessSettings({
  game,
  onGameUpdated,
}: {
  game: PlaystashGame;
  onGameUpdated: (game: PlaystashGame) => void;
}) {
  const { serverUrl, authFetch } = useAuth();
  const { users, loading, error: usersError, refresh } = useAdminUsers();
  const [restricted, setRestricted] = useState(!!game.access_restricted);
  const [allowed, setAllowed] = useState(game.allowed_user_ids || []);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setRestricted(!!game.access_restricted);
    setAllowed(game.allowed_user_ids || []);
  }, [game.id, game.access_restricted, game.allowed_user_ids]);
  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await authFetch(`${serverUrl}/api/games/${game.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_restricted: restricted,
          allowed_user_ids: allowed,
        }),
      });
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, "Could not save access rights."),
        );
      const updated = await response.json();
      onGameUpdated(updated);
      emitGameUpdated(updated);
      setMessage("Access rights saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-2xl border border-ps-line p-4">
      <div className="flex items-center justify-between gap-4">
        <label
          htmlFor="restrict-game-access"
          className="font-medium text-ps-text"
        >
          Restrict game access
        </label>
        <Switch
          id="restrict-game-access"
          color="indigo"
          checked={restricted}
          disabled={busy}
          onChange={setRestricted}
        />
      </div>
      <p className="text-sm text-ps-muted">
        Restricted games are visible only to administrators and the selected
        users. With no selected users, only administrators have access.
      </p>
      {restricted && (
        <>
          <Input
            aria-label="Find allowed users"
            placeholder="Find users…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="max-h-60 overflow-y-auto space-y-2">
            {loading ? (
              <p role="status">Loading users…</p>
            ) : (
              users
                .filter((user) =>
                  user.username.toLowerCase().includes(search.toLowerCase()),
                )
                .map((user) => (
                  <label
                    key={user.id}
                    className="flex items-center gap-3 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-5 accent-indigo-500"
                      disabled={busy}
                      checked={allowed.includes(user.id)}
                      onChange={(event) =>
                        setAllowed(
                          event.target.checked
                            ? [...allowed, user.id]
                            : allowed.filter((id) => id !== user.id),
                        )
                      }
                    />
                    {user.username}
                  </label>
                ))
            )}
          </div>
          {usersError && (
            <div role="alert">
              <p className="text-red-400">{usersError}</p>
              <Button outline onClick={() => refresh()}>
                Reload users
              </Button>
            </div>
          )}
        </>
      )}
      <Button
        color="indigo"
        disabled={busy || loading || (!!usersError && restricted)}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save access rights"}
      </Button>
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
    </section>
  );
}
