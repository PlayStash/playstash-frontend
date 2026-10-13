import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getErrorMessage } from "@/utils/apiError";
import { Switch } from "./tailwind/switch";

export function AccountPrivacySettings() {
  const { serverUrl, authFetch, user, refreshCurrentUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (
    field: "report_game_metrics" | "share_restricted_activity",
    value: boolean,
  ) => {
    setBusy(true);
    setError("");
    try {
      const response = await authFetch(`${serverUrl}/api/users/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, "Could not save privacy settings."),
        );
      await refreshCurrentUser();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!user) return null;
  return (
    <div className="space-y-4 p-5">
      <div
        id="setting-privacy-game-metrics"
        className="flex items-start justify-between gap-4"
      >
        <label htmlFor="report-game-metrics" className="text-sm">
          <span className="block font-medium text-ps-text">
            Report completed game actions
          </span>
          <span className="block text-ps-muted">
            Share downloads, installations, uninstalls and launches with your
            library administrator. Queued reports are discarded when disabled.
          </span>
        </label>
        <Switch
          id="report-game-metrics"
          color="indigo"
          checked={user.report_game_metrics !== false}
          disabled={busy}
          onChange={(value) => void save("report_game_metrics", value)}
        />
      </div>
      <div
        id="setting-privacy-restricted-activity"
        className="flex items-start justify-between gap-4"
      >
        <label htmlFor="share-restricted-activity" className="text-sm">
          <span className="block font-medium text-ps-text">
            Share restricted game activity
          </span>
          <span className="block text-ps-muted">
            Allow administrators to see your activity for games with restricted
            access. Disabled by default.
          </span>
        </label>
        <Switch
          id="share-restricted-activity"
          color="indigo"
          checked={user.share_restricted_activity === true}
          disabled={busy}
          onChange={(value) => void save("share_restricted_activity", value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
