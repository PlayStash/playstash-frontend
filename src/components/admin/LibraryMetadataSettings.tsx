import { useEffect, useState } from "react";
import type { LaunchProfileDto, PlaystashGame } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { emitGameUpdated } from "@/utils/gameUpdates";
import { getErrorMessage } from "@/utils/apiError";
import { validateLaunchProfiles } from "@/utils/launchProfiles";
import { Button } from "../tailwind/button";
import { Input } from "../tailwind/input";
import { Textarea } from "../tailwind/textarea";

export function LibraryMetadataSettings({
  game,
  onGameUpdated,
}: {
  game: PlaystashGame;
  onGameUpdated: (game: PlaystashGame) => void;
}) {
  const { serverUrl, authFetch } = useAuth();
  const [password, setPassword] = useState("");
  const [minimum, setMinimum] = useState("");
  const [recommended, setRecommended] = useState("");
  const [profiles, setProfiles] = useState<LaunchProfileDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setPassword(game.metadata?.archive_password || "");
    setMinimum(game.metadata?.system_requirements_minimum || "");
    setRecommended(game.metadata?.system_requirements_recommended || "");
    setProfiles(
      game.metadata?.launch_profiles?.map((profile) => ({ ...profile })) || [],
    );
  }, [game.id, game.metadata]);
  const save = async () => {
    const invalid = validateLaunchProfiles(profiles);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await authFetch(`${serverUrl}/api/games/${game.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_metadata: {
            archive_password: password,
            system_requirements_minimum: minimum,
            system_requirements_recommended: recommended,
            launch_profiles: profiles,
          },
        }),
      });
      if (!response.ok)
        throw new Error(
          await getErrorMessage(response, "Could not save library defaults."),
        );
      const updated = await response.json();
      onGameUpdated(updated);
      emitGameUpdated(updated);
      setMessage("Library defaults saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-ps-line p-4">
      <div>
        <h4 className="font-semibold text-ps-text">Library defaults</h4>
        <p className="text-sm text-ps-muted">
          Shared with users who can access this game. Empty values clear a saved
          default.
        </p>
      </div>
      <label className="block text-sm text-ps-muted">
        Archive password
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-ps-muted">
          Minimum requirements · Markdown
          <Textarea
            rows={4}
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="text-sm text-ps-muted">
          Recommended requirements · Markdown
          <Textarea
            rows={4}
            value={recommended}
            onChange={(event) => setRecommended(event.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <div className="space-y-3">
        <h5 className="text-sm font-medium text-ps-text">Launch profiles</h5>
        {profiles.map((profile, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-xl bg-ps-panel-soft p-3 sm:grid-cols-2"
          >
            <Input
              aria-label={`Profile ${index + 1} name`}
              placeholder="Single player"
              value={profile.name}
              disabled={busy}
              onChange={(event) =>
                setProfiles(
                  profiles.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
            <Input
              aria-label={`Profile ${index + 1} executable`}
              placeholder="bin/game.exe"
              value={profile.executable}
              disabled={busy}
              onChange={(event) =>
                setProfiles(
                  profiles.map((item, i) =>
                    i === index
                      ? { ...item, executable: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <Input
              aria-label={`Profile ${index + 1} arguments`}
              placeholder="Arguments (optional)"
              value={profile.parameters || ""}
              disabled={busy}
              onChange={(event) =>
                setProfiles(
                  profiles.map((item, i) =>
                    i === index
                      ? { ...item, parameters: event.target.value }
                      : item,
                  ),
                )
              }
            />
            <Button
              outline
              disabled={busy}
              onClick={() =>
                setProfiles(profiles.filter((_, i) => i !== index))
              }
            >
              Remove profile {index + 1}
            </Button>
          </div>
        ))}
        <Button
          outline
          disabled={busy}
          onClick={() =>
            setProfiles([...profiles, { name: "", executable: "" }])
          }
        >
          Add launch profile
        </Button>
      </div>
      <Button color="indigo" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save library defaults"}
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
