import { useEffect, useState } from "react";
import type { LaunchProfileDto, PackageAssetDto } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { isTauriApp } from "@/utils/tauri";
import { formatBytes } from "@/utils/downloadFormat";
import { moveSelectedAddon } from "@/utils/launchProfiles";
import { Button } from "./tailwind/button";
import { Input } from "./tailwind/input";

type Asset = PackageAssetDto;
interface Recipe {
  executable: string;
  parameters?: string;
}
interface GamePackage {
  manifest?: { install?: Recipe; launch_profiles?: LaunchProfileDto[] } | null;
  extras: Asset[];
  addons: Asset[];
}

export function PackageContents({
  gameId,
  installationPath,
  archivePassword,
  launchProfiles,
  onLaunch,
  onRecipe,
}: {
  gameId: number;
  installationPath?: string;
  archivePassword?: string;
  launchProfiles?: LaunchProfileDto[];
  onLaunch: (event: React.MouseEvent, profile: LaunchProfileDto) => void;
  onRecipe: (recipe: Recipe) => void;
}) {
  const { serverUrl, authFetch, getAccessToken } = useAuth();
  const { isOnline } = useOnlineStatus();
  const { showAlert } = useAlertDialog();
  const [contents, setContents] = useState<GamePackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(archivePassword || "");
  const [status, setStatus] = useState("");
  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await authFetch(
        `${serverUrl}/api/game/${gameId}/package`,
        { signal },
      );
      if (response.status === 404) {
        setContents({ extras: [], addons: [] });
        return;
      }
      if (!response.ok)
        throw new Error(
          `Could not load package contents (${response.status}).`,
        );
      setContents(await response.json());
    } catch (cause) {
      if (!signal?.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };
  useEffect(() => {
    setSelected([]);
    setStatus("");
    setPassword(archivePassword || "");
    if (!isOnline) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [gameId, serverUrl, isOnline]);
  const urlFor = (asset: Asset) =>
    `${serverUrl}/api/game/${gameId}/package/assets/${encodeURIComponent(asset.id)}`;
  const download = async (asset: Asset) => {
    setBusy(true);
    setError("");
    setStatus(`Downloading ${asset.title}…`);
    try {
      const response = await authFetch(urlFor(asset));
      if (!response.ok)
        throw new Error(`Download failed (${response.status}).`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = asset.path.split(/[/\\]/).pop() || asset.title;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(`Downloaded ${asset.title}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    if (!installationPath || !selected.length) return;
    const confirmed = await showAlert({
      title: "Apply selected addons?",
      description: `These addons will be applied in the displayed order to ${installationPath}. They can overwrite existing game files. Back up files you want to keep.`,
      affirmativeText: "Apply and overwrite files",
      negativeText: "Cancel",
    });
    if (!confirmed) return;
    setBusy(true);
    setError("");
    let completed = 0;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const id of selected) {
        const asset = contents?.addons.find((item) => item.id === id);
        if (!asset) continue;
        setStatus(
          `Applying ${completed + 1}/${selected.length}: ${asset.title}…`,
        );
        const token = await getAccessToken();
        if (!token) throw new Error("Sign in again before downloading addons.");
        await invoke("install_game_addon", {
          gameId,
          downloadUrl: urlFor(asset),
          accessToken: token,
          archiveName: asset.path.split(/[/\\]/).pop(),
          installationPath,
          password: password || null,
          overwriteConfirmed: true,
        });
        completed++;
      }
      setStatus(`Applied ${completed} addon${completed === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (cause) {
      setStatus(`Stopped after ${completed} completed addons.`);
      setError(
        `${cause instanceof Error ? cause.message : String(cause)} Files already applied remain installed.`,
      );
    } finally {
      setBusy(false);
    }
  };
  const profiles = launchProfiles?.length
    ? launchProfiles
    : contents?.manifest?.launch_profiles || [];
  return (
    <section className="space-y-4 text-sm">
      {profiles.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-ps-text">Launch profiles</h4>
          <div className="flex flex-wrap gap-2">
            {profiles.map((profile, index) => (
              <Button
                key={`${profile.name}-${index}`}
                outline
                disabled={!isTauriApp() || !installationPath || busy}
                onClick={(event) => onLaunch(event, profile)}
              >
                {profile.name}
              </Button>
            ))}
          </div>
          <p className="text-xs text-ps-muted">
            Profiles run when selected in the desktop app.
          </p>
        </div>
      )}
      {loading && (
        <p role="status" className="text-ps-muted">
          Loading package contents…
        </p>
      )}
      {!isOnline && (
        <p className="text-ps-muted">
          Connect to the server to view extras and addons.
        </p>
      )}
      {contents?.manifest?.install && (
        <div className="space-y-2">
          <h4 className="font-medium text-ps-text">Package installer</h4>
          <p className="break-all text-ps-muted">
            {contents.manifest.install.executable}{" "}
            {contents.manifest.install.parameters}
          </p>
          <Button
            outline
            disabled={busy || !isTauriApp()}
            onClick={() => onRecipe(contents.manifest!.install!)}
          >
            Use recipe for next download
          </Button>
        </div>
      )}
      {!!contents?.extras.length && (
        <div className="space-y-2">
          <h4 className="font-medium text-ps-text">Extras</h4>
          {contents.extras.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-ps-panel-soft p-3"
            >
              <div className="min-w-0">
                <p className="break-words">{asset.title}</p>
                <p className="text-xs text-ps-muted">
                  {asset.kind} · {formatBytes(Number(asset.size))}
                </p>
              </div>
              <Button
                outline
                disabled={busy}
                onClick={() => void download(asset)}
              >
                Download
              </Button>
            </div>
          ))}
        </div>
      )}
      {!!contents?.addons.length && (
        <div className="space-y-3">
          <h4 className="font-medium text-ps-text">Optional addons</h4>
          {contents.addons.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-ps-panel-soft p-3"
            >
              <label className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-indigo-500"
                  checked={selected.includes(asset.id)}
                  disabled={busy}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, asset.id]
                        : selected.filter((id) => id !== asset.id),
                    )
                  }
                />
                <span className="min-w-0 break-words">
                  {asset.title}
                  <span className="block text-xs text-ps-muted">
                    {asset.kind} · {formatBytes(Number(asset.size))}
                  </span>
                </span>
              </label>
              <Button
                outline
                disabled={busy}
                onClick={() => void download(asset)}
              >
                Download
              </Button>
            </div>
          ))}
          {selected.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-medium">Installation order</h5>
              <ol className="space-y-2">
                {selected.map((id, index) => (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0 break-words">
                      {index + 1}.{" "}
                      {contents.addons.find((asset) => asset.id === id)?.title}
                    </span>
                    <span className="flex gap-1">
                      <Button
                        outline
                        disabled={busy || index === 0}
                        aria-label={`Move addon ${index + 1} up`}
                        onClick={() =>
                          setSelected(moveSelectedAddon(selected, id, -1))
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        outline
                        disabled={busy || index === selected.length - 1}
                        aria-label={`Move addon ${index + 1} down`}
                        onClick={() =>
                          setSelected(moveSelectedAddon(selected, id, 1))
                        }
                      >
                        ↓
                      </Button>
                    </span>
                  </li>
                ))}
              </ol>
              <label className="block text-ps-muted">
                Archive password (if needed)
                <Input
                  type="password"
                  autoComplete="off"
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <Button
                color="indigo"
                disabled={busy || !isTauriApp() || !installationPath}
                onClick={() => void install()}
              >
                {busy ? "Applying addons…" : "Apply selected addons"}
              </Button>
            </div>
          )}
          {(!isTauriApp() || !installationPath) && (
            <p className="text-xs text-ps-muted">
              Install the game in the desktop app to apply addons automatically.
              Downloads remain available.
            </p>
          )}
        </div>
      )}
      {!loading &&
        !error &&
        isOnline &&
        !contents?.extras.length &&
        !contents?.addons.length && (
          <p className="text-ps-muted">
            No extras or addons provided for this game.
          </p>
        )}
      {error && (
        <div role="alert" className="space-y-2 text-red-400">
          <p>{error}</p>
          {!busy && (
            <Button outline onClick={() => void load()}>
              Reload package contents
            </Button>
          )}
        </div>
      )}
      {status && (
        <p role="status" className="text-ps-muted">
          {status}
        </p>
      )}
    </section>
  );
}
