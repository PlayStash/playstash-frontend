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
import { useTranslation } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";

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
  const { t } = useTranslation();
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
          fillTemplate(t("game.package.loadFailed"), {
            status: response.status,
          }),
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
    setStatus(
      fillTemplate(t("game.package.downloading"), { title: asset.title }),
    );
    try {
      const response = await authFetch(urlFor(asset));
      if (!response.ok)
        throw new Error(
          fillTemplate(t("game.package.downloadFailed"), {
            status: response.status,
          }),
        );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = asset.path.split(/[/\\]/).pop() || asset.title;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(
        fillTemplate(t("game.package.downloaded"), { title: asset.title }),
      );
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
      title: t("game.package.applyTitle"),
      description: fillTemplate(t("game.package.applyDescription"), {
        path: installationPath,
      }),
      affirmativeText: t("game.package.applyConfirm"),
      negativeText: t("common.cancel"),
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
          fillTemplate(t("game.package.applying"), {
            current: completed + 1,
            total: selected.length,
            title: asset.title,
          }),
        );
        const token = await getAccessToken();
        if (!token) throw new Error(t("game.package.signInAgain"));
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
      setStatus(
        fillTemplate(
          t(
            completed === 1
              ? "game.package.applied.one"
              : "game.package.applied.other",
          ),
          { n: completed },
        ),
      );
      setSelected([]);
    } catch (cause) {
      setStatus(fillTemplate(t("game.package.stopped"), { n: completed }));
      setError(
        fillTemplate(t("game.package.partiallyApplied"), {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
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
          <h4 className="font-medium text-ps-text">
            {t("game.package.launchProfiles")}
          </h4>
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
            {t("game.package.profilesHint")}
          </p>
        </div>
      )}
      {loading && (
        <p role="status" className="text-ps-muted">
          {t("game.package.loading")}
        </p>
      )}
      {!isOnline && (
        <p className="text-ps-muted">{t("game.package.offline")}</p>
      )}
      {contents?.manifest?.install && (
        <div className="space-y-2">
          <h4 className="font-medium text-ps-text">
            {t("game.package.installer")}
          </h4>
          <p className="break-all text-ps-muted">
            {contents.manifest.install.executable}{" "}
            {contents.manifest.install.parameters}
          </p>
          <Button
            outline
            disabled={busy || !isTauriApp()}
            onClick={() => onRecipe(contents.manifest!.install!)}
          >
            {t("game.package.useRecipe")}
          </Button>
        </div>
      )}
      {!!contents?.extras.length && (
        <div className="space-y-2">
          <h4 className="font-medium text-ps-text">
            {t("game.package.extras")}
          </h4>
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
                {t("common.download")}
              </Button>
            </div>
          ))}
        </div>
      )}
      {!!contents?.addons.length && (
        <div className="space-y-3">
          <h4 className="font-medium text-ps-text">
            {t("game.package.addons")}
          </h4>
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
                {t("common.download")}
              </Button>
            </div>
          ))}
          {selected.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-medium">{t("game.package.installOrder")}</h5>
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
                        aria-label={fillTemplate(t("game.package.moveUp"), {
                          n: index + 1,
                        })}
                        onClick={() =>
                          setSelected(moveSelectedAddon(selected, id, -1))
                        }
                      >
                        ↑
                      </Button>
                      <Button
                        outline
                        disabled={busy || index === selected.length - 1}
                        aria-label={fillTemplate(t("game.package.moveDown"), {
                          n: index + 1,
                        })}
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
                {t("game.package.archivePassword")}
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
                {busy
                  ? t("game.package.applyingAddons")
                  : t("game.package.applySelected")}
              </Button>
            </div>
          )}
          {(!isTauriApp() || !installationPath) && (
            <p className="text-xs text-ps-muted">
              {t("game.package.desktopOnly")}
            </p>
          )}
        </div>
      )}
      {!loading &&
        !error &&
        isOnline &&
        !contents?.extras.length &&
        !contents?.addons.length && (
          <p className="text-ps-muted">{t("game.package.empty")}</p>
        )}
      {error && (
        <div role="alert" className="space-y-2 text-red-400">
          <p>{error}</p>
          {!busy && (
            <Button outline onClick={() => void load()}>
              {t("game.package.reload")}
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
