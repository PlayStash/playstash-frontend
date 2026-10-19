import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getErrorMessage } from "@/utils/apiError";
import { formatMessage } from "@/utils/formatMessage";
import { translate, useTranslation } from "@/i18n";
import {
  normalizeFolderTagRules,
  type DraftRule,
  type RuleResult,
} from "./FolderTagRules.utils";
import { Button } from "../tailwind/button";
import { Input } from "../tailwind/input";
export function FolderTagRules() {
  const { serverUrl, authFetch } = useAuth();
  const { t } = useTranslation();
  const [rules, setRules] = useState<DraftRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Reset the loading flags while rendering whenever a new load starts
  // (server, session or reload request changed) instead of inside the effect.
  const [request, setRequest] = useState({ serverUrl, authFetch, reload });
  if (
    request.serverUrl !== serverUrl ||
    request.authFetch !== authFetch ||
    request.reload !== reload
  ) {
    setRequest({ serverUrl, authFetch, reload });
    setLoading(true);
    setLoaded(false);
  }
  useEffect(() => {
    let active = true;
    void authFetch(`${serverUrl}/api/config/folder-tag-rules`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            await getErrorMessage(
              response,
              translate("admin.folderTags.loadFailed"),
            ),
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
          await getErrorMessage(response, t("admin.folderTags.saveFailed")),
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
        formatMessage(
          t(
            data.failed_games
              ? "admin.folderTags.savedWithFailures"
              : "admin.folderTags.saved",
          ),
          { applied: data.applied_games, failed: data.failed_games },
        ),
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
        {t("admin.folderTags.description")}
      </p>
      {loading && <p role="status">{t("admin.folderTags.loading")}</p>}
      {rules.map((rule, index) => (
        <div
          key={index}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-ps-line p-3"
        >
          <label className="min-w-44 flex-1 text-sm text-ps-muted">
            {t("admin.folderTags.folder")}
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
            {t("admin.folderTags.tags")}
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
            {t("common.enabled")}
          </label>
          <Button
            outline
            disabled={busy}
            aria-label={formatMessage(t("admin.folderTags.removeRule"), {
              index: index + 1,
            })}
            onClick={() =>
              setRules(rules.filter((_, position) => index !== position))
            }
          >
            {t("common.remove")}
          </Button>
        </div>
      ))}
      {!loading && !rules.length && !error && (
        <p className="text-sm text-ps-muted">{t("admin.folderTags.empty")}</p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          outline
          disabled={busy || !loaded || rules.length >= 100}
          onClick={() =>
            setRules([...rules, { folder: "", tags: "", enabled: true }])
          }
        >
          {t("admin.folderTags.add")}
        </Button>
        <Button
          color="indigo"
          disabled={busy || !loaded}
          onClick={() => void save()}
        >
          {busy ? t("admin.folderTags.applying") : t("admin.folderTags.save")}
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
              {t("admin.folderTags.reload")}
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
