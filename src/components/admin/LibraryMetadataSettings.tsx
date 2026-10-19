import { useState } from "react";
import type { LaunchProfileDto, PlaystashGame } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { emitGameUpdated } from "@/utils/gameUpdates";
import { getErrorMessage } from "@/utils/apiError";
import { formatMessage } from "@/utils/formatMessage";
import { useTranslation } from "@/i18n";
import { validateLaunchProfiles } from "@/utils/launchProfiles";
import { Button } from "../tailwind/button";
import { Input } from "../tailwind/input";
import { Textarea } from "../tailwind/textarea";

function copyProfiles(game: PlaystashGame): LaunchProfileDto[] {
  return (
    game.metadata?.launch_profiles?.map((profile) => ({ ...profile })) || []
  );
}

export function LibraryMetadataSettings({
  game,
  onGameUpdated,
}: {
  game: PlaystashGame;
  onGameUpdated: (game: PlaystashGame) => void;
}) {
  const { serverUrl, authFetch } = useAuth();
  const { t } = useTranslation();
  const [password, setPassword] = useState(
    () => game.metadata?.archive_password || "",
  );
  const [minimum, setMinimum] = useState(
    () => game.metadata?.system_requirements_minimum || "",
  );
  const [recommended, setRecommended] = useState(
    () => game.metadata?.system_requirements_recommended || "",
  );
  const [profiles, setProfiles] = useState<LaunchProfileDto[]>(() =>
    copyProfiles(game),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Re-sync the draft while rendering when the game or its metadata changes.
  const [synced, setSynced] = useState({
    id: game.id,
    metadata: game.metadata,
  });
  if (synced.id !== game.id || synced.metadata !== game.metadata) {
    setSynced({ id: game.id, metadata: game.metadata });
    setPassword(game.metadata?.archive_password || "");
    setMinimum(game.metadata?.system_requirements_minimum || "");
    setRecommended(game.metadata?.system_requirements_recommended || "");
    setProfiles(copyProfiles(game));
  }
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
          await getErrorMessage(
            response,
            t("admin.libraryDefaults.saveFailed"),
          ),
        );
      const updated = await response.json();
      onGameUpdated(updated);
      emitGameUpdated(updated);
      setMessage(t("admin.libraryDefaults.saved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4 rounded-2xl border border-ps-line p-4">
      <div>
        <h4 className="font-semibold text-ps-text">
          {t("admin.libraryDefaults.title")}
        </h4>
        <p className="text-sm text-ps-muted">
          {t("admin.libraryDefaults.description")}
        </p>
      </div>
      <label className="block text-sm text-ps-muted">
        {t("admin.libraryDefaults.archivePassword")}
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
          {t("admin.libraryDefaults.minimum")}
          <Textarea
            rows={4}
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="text-sm text-ps-muted">
          {t("admin.libraryDefaults.recommended")}
          <Textarea
            rows={4}
            value={recommended}
            onChange={(event) => setRecommended(event.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <div className="space-y-3">
        <h5 className="text-sm font-medium text-ps-text">
          {t("admin.libraryDefaults.launchProfiles")}
        </h5>
        {profiles.map((profile, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-xl bg-ps-panel-soft p-3 sm:grid-cols-2"
          >
            <Input
              aria-label={formatMessage(
                t("admin.libraryDefaults.profileName"),
                {
                  index: index + 1,
                },
              )}
              placeholder={t("admin.libraryDefaults.namePlaceholder")}
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
              aria-label={formatMessage(
                t("admin.libraryDefaults.profileExecutable"),
                { index: index + 1 },
              )}
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
              aria-label={formatMessage(
                t("admin.libraryDefaults.profileArguments"),
                { index: index + 1 },
              )}
              placeholder={t("admin.libraryDefaults.argumentsPlaceholder")}
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
              {formatMessage(t("admin.libraryDefaults.removeProfile"), {
                index: index + 1,
              })}
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
          {t("admin.libraryDefaults.addProfile")}
        </Button>
      </div>
      <Button color="indigo" disabled={busy} onClick={() => void save()}>
        {busy ? t("common.saving") : t("admin.libraryDefaults.save")}
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
