import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getErrorMessage } from "@/utils/apiError";
import { Button } from "../tailwind/button";
import { Input } from "../tailwind/input";
interface Rule {
  folder_prefix: string;
  tags: string[];
  enabled?: boolean;
}
interface RuleResult {
  rules: Rule[];
  applied_games: number;
  failed_games: number;
}
interface DraftRule {
  folder: string;
  tags: string;
  enabled: boolean;
}
export function normalizeFolderTagRules(drafts: DraftRule[]): Rule[] {
  return drafts.map((draft, index) => {
    const folder = draft.folder.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    const tags = [
      ...new Set(
        draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    if (
      !folder ||
      folder.startsWith("/") ||
      folder.includes(":") ||
      folder.split("/").some((part) => !part || part === ".." || part === ".")
    )
      throw new Error(
        `Rule ${index + 1}: enter a relative library folder without traversal.`,
      );
    if (!tags.length || tags.length > 20 || tags.some((tag) => tag.length > 64))
      throw new Error(
        `Rule ${index + 1}: enter 1–20 tags of at most 64 characters.`,
      );
    return { folder_prefix: folder, tags, enabled: draft.enabled };
  });
}
export function FolderTagRules() {
  const { serverUrl, authFetch } = useAuth();
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    void authFetch(`${serverUrl}/api/config/folder-tag-rules`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            await getErrorMessage(response, "Could not load folder rules."),
          );
        const data: RuleResult = await response.json();
        if (active) {
          setLoaded(true);
          setRules(
            data.rules.map((rule) => ({
              folder: rule.folder_prefix,
              tags: rule.tags.join(", "),
              enabled: rule.enabled !== false,
            })),
          );
          setError("");
        }
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
  }, [serverUrl, authFetch, reload]);
  const change = (index: number, update: Partial<DraftRule>) =>
    setRules((previous) =>
      previous.map((rule, position) =>
        position === index ? { ...rule, ...update } : rule,
      ),
    );
  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = normalizeFolderTagRules(rules);
      const response = await authFetch(
        `${serverUrl}/api/config/folder-tag-rules`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules: payload }),
        },
      );
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, "Could not save folder rules."),
        );
      const data: RuleResult = await response.json();
      setRules(
        data.rules.map((rule) => ({
          folder: rule.folder_prefix,
          tags: rule.tags.join(", "),
          enabled: rule.enabled !== false,
        })),
      );
      setMessage(
        `Rules saved. Refreshed ${data.applied_games} games.${data.failed_games ? ` ${data.failed_games} games could not be refreshed; reindex to retry.` : ""}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4">
      <p className="text-sm text-ps-muted">
        Apply tags automatically to games in a library folder and its
        descendants. Rules are stored on the server and apply to every game
        version, including future imports. Saving refreshes existing games.
      </p>
      {loading && <p role="status">Loading rules…</p>}
      {rules.map((rule, index) => (
        <div
          key={index}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-ps-line p-3"
        >
          <label className="min-w-44 flex-1 text-sm text-ps-muted">
            Library folder
            <Input
              maxLength={1024}
              placeholder="Classics/Arcade"
              value={rule.folder}
              disabled={busy}
              onChange={(event) =>
                change(index, { folder: event.target.value })
              }
            />
          </label>
          <label className="min-w-44 flex-1 text-sm text-ps-muted">
            Tags, separated by commas
            <Input
              value={rule.tags}
              disabled={busy}
              onChange={(event) => change(index, { tags: event.target.value })}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rule.enabled}
              disabled={busy}
              onChange={(event) =>
                change(index, { enabled: event.target.checked })
              }
            />
            Enabled
          </label>
          <Button
            outline
            disabled={busy}
            aria-label={`Remove rule ${index + 1}`}
            onClick={() =>
              setRules(rules.filter((_, position) => index !== position))
            }
          >
            Remove
          </Button>
        </div>
      ))}
      {!loading && !rules.length && !error && (
        <p className="text-sm text-ps-muted">No automatic tagging rules.</p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          outline
          disabled={busy || !loaded || rules.length >= 100}
          onClick={() =>
            setRules([...rules, { folder: "", tags: "", enabled: true }])
          }
        >
          Add rule
        </Button>
        <Button
          color="indigo"
          disabled={busy || !loaded}
          onClick={() => void save()}
        >
          {busy ? "Applying…" : "Save and apply rules"}
        </Button>
      </div>
      {error && (
        <div role="alert">
          <p className="text-sm text-red-400">{error}</p>
          {!loaded && (
            <Button
              outline
              disabled={loading}
              onClick={() => setReload(reload + 1)}
            >
              Reload rules
            </Button>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-ps-muted">
          {message}
        </p>
      )}
    </section>
  );
}
