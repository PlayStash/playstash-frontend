import { useCallback, useEffect, useRef, useState } from "react";
import type { LaunchProfileDto } from "@/api";
import type { PlaystashGame } from "@/api/models/PlaystashGame";
import { isWindowsExecutablePath } from "@/components/downloads/install-utils";
import { Button } from "@/components/tailwind/button";
import { Label } from "@/components/tailwind/fieldset";
import { Input } from "@/components/tailwind/input";
import {
  Listbox,
  ListboxLabel,
  ListboxOption,
} from "@/components/tailwind/listbox";
import { Switch, SwitchField } from "@/components/tailwind/switch";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useUmu, type UmuStatusInfo } from "@/context/UmuContext";
import { useTranslation } from "@/i18n";
import {
  createDesktopShortcut,
  desktopShortcutExists,
  removeDesktopShortcut,
} from "@/utils/desktopShortcut";
import {
  configString,
  readGameConfig,
  updateGameConfig,
  type GameConfig,
} from "@/utils/gameConfig";
import { isTauriApp } from "@/utils/tauri";
import { EmulatorLaunchDialog } from "./EmulatorLaunchDialog";
import type { SettingsInstalledGame } from "./types";
import { tauriInvoke } from "@/utils/tauriInvoke";

interface Props {
  installedGame: SettingsInstalledGame;
  game: PlaystashGame;
}

interface LaunchExecutableScan {
  executables: string[];
  nonExecutableScripts: string[];
  truncated: boolean;
}

/** How often a re-opened executable list may trigger another scan. */
const RESCAN_THROTTLE_MS = 1500;

/** Path relative to the installation, with the platform's separators. */
export function relativePathForCopy(
  relative: string,
  windows: boolean,
): string {
  const normalized = relative.replace(/[\\/]+/g, "/").replace(/^\/+/, "");
  return windows ? normalized.replace(/\//g, "\\") : normalized;
}

/** Absolute path of an executable inside the installation. */
export function joinInstallPath(root: string, relative: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  return [root.replace(/[\\/]+$/, ""), ...parts].join(separator);
}

/** Keeps the selected executable in a freshly scanned list. */
export function mergeExecutableList(
  scanned: string[],
  selected: string,
): string[] {
  return selected && !scanned.includes(selected)
    ? [selected, ...scanned]
    : scanned;
}

function isWindowsHost() {
  return (
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
  );
}

const invoke = tauriInvoke;

/**
 * Game Settings → Launch Options: executable, parameters, admin and umu
 * overrides (auto-saved), server launch profiles, emulator launch, copying
 * the executable path and the desktop shortcut.
 */
export function LaunchOptionsTab({ installedGame, game }: Props) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const { checkUmuStatus, installUmu } = useUmu();
  const gameTitle =
    game.metadata?.title || game.title || installedGame.gameTitle || "Game";
  const launchProfiles: LaunchProfileDto[] =
    game.metadata?.launch_profiles ?? [];

  const [launchExecutables, setLaunchExecutables] = useState<string[]>([]);
  const [launchScanTruncated, setLaunchScanTruncated] = useState(false);
  const [selectedLaunchExe, setSelectedLaunchExe] = useState<string>("");
  const [nonExecutableScripts, setNonExecutableScripts] = useState<string[]>(
    [],
  );
  const [makingExecutable, setMakingExecutable] = useState(false);
  const [launchParams, setLaunchParams] = useState<string>("");
  const [launchAsAdmin, setLaunchAsAdmin] = useState<boolean>(false);
  const [umuGameId, setUmuGameId] = useState<string>("");
  const [umuStore, setUmuStore] = useState<string>("");
  const [umuProtonPath, setUmuProtonPath] = useState<string>("");
  const [umuWinePrefix, setUmuWinePrefix] = useState<string>("");
  const [protonBuilds, setProtonBuilds] = useState<
    { name: string; path: string; source: string }[]
  >([]);
  const [resolvedPrefixPath, setResolvedPrefixPath] = useState<string | null>(
    null,
  );
  const [loadingLaunchOptions, setLoadingLaunchOptions] = useState(false);
  const launchOptionsLoadedRef = useRef(false);
  const savedExeRef = useRef<string | null>(null);
  const lastScanRef = useRef(0);
  const [config, setConfig] = useState<GameConfig>({});
  const [selectedProfile, setSelectedProfile] = useState("");
  const [emulatorOpen, setEmulatorOpen] = useState(false);
  const [creatingShortcut, setCreatingShortcut] = useState(false);

  // umu-launcher (Wine/Proton) status for Windows executables on Linux.
  const [umuStatus, setUmuStatus] = useState<UmuStatusInfo | null>(null);
  const [installingUmu, setInstallingUmu] = useState(false);
  const isLinux =
    isTauriApp() &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Linux");
  const isWindowsLaunchExe =
    isLinux && isWindowsExecutablePath(selectedLaunchExe);
  const emulatorExecutable = configString(config, "emulatorexecutable");

  const applyScan = useCallback(
    (result: LaunchExecutableScan, keep: string) => {
      setLaunchExecutables(mergeExecutableList(result.executables, keep));
      setNonExecutableScripts(result.nonExecutableScripts);
      setLaunchScanTruncated(!!result.truncated);
    },
    [],
  );

  // Load the launch options when the tab opens.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadingLaunchOptions(true);
      try {
        const status = await checkUmuStatus();
        if (!cancelled) setUmuStatus(status);

        const [result, raw] = await Promise.all([
          invoke<LaunchExecutableScan>("list_launch_executables", {
            installationPath: installedGame.installationDirectory,
          }),
          readGameConfig(installedGame.versionDirectory),
        ]);
        if (cancelled) return;
        const exe =
          typeof raw.launchexecutable === "string" ? raw.launchexecutable : "";
        applyScan(result, exe);
        lastScanRef.current = Date.now();
        setConfig(raw);
        setSelectedLaunchExe(exe);
        savedExeRef.current = exe;
        setLaunchParams(
          typeof raw.launchparameters === "string" ? raw.launchparameters : "",
        );
        setLaunchAsAdmin(!!raw.launchasadmin);
        setUmuGameId(configString(raw, "umugameid") ?? "");
        setUmuStore(configString(raw, "umustore") ?? "");
        setUmuProtonPath(configString(raw, "umuprotonpath") ?? "");
        setUmuWinePrefix(configString(raw, "umuwineprefix") ?? "");
        launchOptionsLoadedRef.current = true;
      } catch (err) {
        console.error("Failed to load launch options:", err);
      } finally {
        if (!cancelled) setLoadingLaunchOptions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    installedGame.installationDirectory,
    installedGame.versionDirectory,
    checkUmuStatus,
    applyScan,
  ]);

  // List the Proton builds the user already has installed (compatibilitytools.d),
  // so PROTONPATH does not have to be typed from memory.
  useEffect(() => {
    if (!isTauriApp()) return;
    let cancelled = false;
    (async () => {
      try {
        const builds =
          await invoke<{ name: string; path: string; source: string }[]>(
            "list_proton_builds",
          );
        if (!cancelled) setProtonBuilds(builds);
      } catch {
        if (!cancelled) setProtonBuilds([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Show where this game's Wine/Proton prefix actually lives (Linux/umu), so
  // the per-game override field does not have to guess a path.
  useEffect(() => {
    if (!isTauriApp() || !installedGame.versionDirectory) {
      setResolvedPrefixPath(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const info = await invoke<{ path: string | null }>(
          "resolve_game_wine_prefix",
          {
            versionDirectory: installedGame.versionDirectory,
            gameId: installedGame.gameId,
            umuGameId: umuGameId || null,
            perGamePrefix: umuWinePrefix || null,
          },
        );
        if (!cancelled) setResolvedPrefixPath(info?.path ?? null);
      } catch {
        if (!cancelled) setResolvedPrefixPath(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    installedGame.versionDirectory,
    installedGame.gameId,
    umuGameId,
    umuWinePrefix,
  ]);

  /** Re-scans the installation each time the executable list opens. */
  const rescanExecutables = useCallback(async () => {
    if (!launchOptionsLoadedRef.current) return;
    const now = Date.now();
    if (now - lastScanRef.current < RESCAN_THROTTLE_MS) return;
    lastScanRef.current = now;
    try {
      const result = await invoke<LaunchExecutableScan>(
        "list_launch_executables",
        { installationPath: installedGame.installationDirectory },
      );
      applyScan(result, selectedLaunchExe);
    } catch (error) {
      console.warn("Re-scanning the executables failed:", error);
    }
  }, [applyScan, installedGame.installationDirectory, selectedLaunchExe]);

  const handleMakeExecutable = useCallback(async () => {
    setMakingExecutable(true);
    try {
      await invoke("make_script_executable", {
        installationPath: installedGame.installationDirectory,
        relativePaths: nonExecutableScripts,
      });
      // Refresh the list so the newly executable scripts appear.
      const result = await invoke<LaunchExecutableScan>(
        "list_launch_executables",
        { installationPath: installedGame.installationDirectory },
      );
      applyScan(result, selectedLaunchExe);
    } catch (err) {
      console.error("Failed to make scripts executable:", err);
    } finally {
      setMakingExecutable(false);
    }
  }, [
    applyScan,
    installedGame.installationDirectory,
    nonExecutableScripts,
    selectedLaunchExe,
  ]);

  const handleInstallUmu = useCallback(async () => {
    setInstallingUmu(true);
    try {
      const ok = await installUmu(gameTitle);
      if (ok) {
        setUmuStatus(await checkUmuStatus());
      } else {
        await showAlert({
          title: "Failed to install umu-launcher",
          description:
            "umu-launcher could not be installed. Check your connection and try again.",
          affirmativeText: "OK",
        });
      }
    } finally {
      setInstallingUmu(false);
    }
  }, [installUmu, checkUmuStatus, showAlert, gameTitle]);

  /** Absolute path of the executable Play starts (emulator or game). */
  const launchTargetPath = useCallback(
    (exe: string) =>
      emulatorExecutable ||
      (exe ? joinInstallPath(installedGame.installationDirectory, exe) : ""),
    [emulatorExecutable, installedGame.installationDirectory],
  );

  /**
   * A changed executable means a new icon: an existing desktop shortcut is
   * recreated without asking.
   */
  const refreshDesktopShortcut = useCallback(
    async (exe: string) => {
      try {
        if (!(await desktopShortcutExists({ title: gameTitle }))) return;
        await removeDesktopShortcut({ title: gameTitle });
        await createDesktopShortcut({
          gameId: installedGame.gameId,
          title: gameTitle,
          iconPath: launchTargetPath(exe) || undefined,
          ask: false,
        });
      } catch (error) {
        console.warn("Updating the desktop shortcut failed:", error);
      }
    },
    [gameTitle, installedGame.gameId, launchTargetPath],
  );

  const persistLaunchOptions = useCallback(
    async (
      exe: string,
      params: string,
      runAsAdmin: boolean,
      gameIdOverride: string,
      store: string,
      protonPath: string,
      winePrefix: string,
    ) => {
      try {
        const next = await updateGameConfig(installedGame.versionDirectory, {
          launchexecutable: exe || undefined,
          launchparameters: params.trim() || undefined,
          launchasadmin: runAsAdmin || undefined,
          umugameid: gameIdOverride.trim() || undefined,
          umustore: store.trim() || undefined,
          umuprotonpath: protonPath.trim() || undefined,
          umuwineprefix: winePrefix.trim() || undefined,
        });
        setConfig(next);
        if (savedExeRef.current !== null && savedExeRef.current !== exe) {
          savedExeRef.current = exe;
          void refreshDesktopShortcut(exe);
        }
      } catch (err) {
        console.error("Failed to save launch options:", err);
      }
    },
    [installedGame.versionDirectory, refreshDesktopShortcut],
  );

  // Auto-save launch options on change (debounced)
  useEffect(() => {
    if (!launchOptionsLoadedRef.current) return;
    const timeout = setTimeout(() => {
      void persistLaunchOptions(
        selectedLaunchExe,
        launchParams,
        launchAsAdmin,
        umuGameId,
        umuStore,
        umuProtonPath,
        umuWinePrefix,
      );
    }, 500);
    return () => clearTimeout(timeout);
  }, [
    selectedLaunchExe,
    launchParams,
    launchAsAdmin,
    umuGameId,
    umuStore,
    umuProtonPath,
    umuWinePrefix,
    persistLaunchOptions,
  ]);

  const handleSelectProfile = useCallback(
    async (name: string) => {
      setSelectedProfile(name);
      const profile = launchProfiles.find((entry) => entry.name === name);
      if (!profile) return;
      const inside = await invoke<{ relative: string } | null>(
        "resolve_path_inside",
        {
          path: joinInstallPath(
            installedGame.installationDirectory,
            profile.executable,
          ),
          root: installedGame.installationDirectory,
        },
      ).catch(() => null);
      if (!inside) {
        void showAlert({ title: t("launchOptions.profileNotFound") });
        return;
      }
      setLaunchExecutables((list) =>
        mergeExecutableList(list, inside.relative),
      );
      setSelectedLaunchExe(inside.relative);
      setLaunchParams(profile.parameters ?? "");
    },
    [installedGame.installationDirectory, launchProfiles, showAlert, t],
  );

  const handleCopyExecutablePath = useCallback(async () => {
    if (!selectedLaunchExe) return;
    try {
      await navigator.clipboard.writeText(
        relativePathForCopy(selectedLaunchExe, isWindowsHost()),
      );
      void showAlert({ title: t("launchOptions.copiedPath") });
    } catch (error) {
      void showAlert({
        title: t("launchOptions.copyFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [selectedLaunchExe, showAlert, t]);

  const handleCreateDesktopIcon = useCallback(async () => {
    setCreatingShortcut(true);
    try {
      const result = await createDesktopShortcut({
        gameId: installedGame.gameId,
        title: gameTitle,
        iconPath: launchTargetPath(selectedLaunchExe) || undefined,
        ask: true,
      });
      if (result === "exists") {
        void showAlert({ title: t("launchOptions.shortcutExists") });
      }
    } catch (error) {
      void showAlert({
        title: t("launchOptions.shortcutFailed"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCreatingShortcut(false);
    }
  }, [
    gameTitle,
    installedGame.gameId,
    launchTargetPath,
    selectedLaunchExe,
    showAlert,
    t,
  ]);

  const handleOpenEmulator = useCallback(async () => {
    const exists = await invoke<boolean>("fs_path_exists", {
      path: installedGame.installationDirectory,
    }).catch(() => false);
    if (!exists) {
      void showAlert({ title: t("launch.installFirst") });
      return;
    }
    setConfig(await readGameConfig(installedGame.versionDirectory));
    setEmulatorOpen(true);
  }, [
    installedGame.installationDirectory,
    installedGame.versionDirectory,
    showAlert,
    t,
  ]);

  const handleEmulatorSaved = useCallback(
    (next: GameConfig) => {
      setConfig(next);
      // The emulator dialog rewrote the launch parameters: show them here so
      // the auto-save does not write the old value back.
      setLaunchParams(
        typeof next.launchparameters === "string" ? next.launchparameters : "",
      );
      void refreshDesktopShortcut(selectedLaunchExe);
    },
    [refreshDesktopShortcut, selectedLaunchExe],
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-ps-text">Launch Options</h3>
        <p className="mt-1 text-sm text-ps-muted">
          Configure how this game is launched when you click the play button.
        </p>
      </div>

      {loadingLaunchOptions ? (
        <div className="text-sm text-ps-muted">Loading executables…</div>
      ) : (
        <>
          {launchProfiles.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-ps-muted mb-1">
                {t("launchOptions.serverProfile")}
              </label>
              <Listbox
                name="serverLaunchProfile"
                value={selectedProfile}
                onChange={(value: any) =>
                  void handleSelectProfile(String(value))
                }
                aria-label={t("launchOptions.serverProfile")}
              >
                <ListboxOption value="">
                  <ListboxLabel>
                    {t("launchOptions.serverProfileNone")}
                  </ListboxLabel>
                </ListboxOption>
                {launchProfiles.map((profile) => (
                  <ListboxOption key={profile.name} value={profile.name}>
                    <ListboxLabel>{profile.name}</ListboxLabel>
                  </ListboxOption>
                ))}
              </Listbox>
            </div>
          )}

          {/* Launch Executable Picker */}
          <div>
            <label className="block text-sm font-medium text-ps-muted mb-1">
              Launch Executable
            </label>
            {launchExecutables.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-ps-muted">
                  No executables found in the installation folder.
                </p>
                {nonExecutableScripts.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      Found {nonExecutableScripts.length}{" "}
                      {nonExecutableScripts.length === 1
                        ? "shell script"
                        : "shell scripts"}{" "}
                      that is missing the executable (
                      <code className="font-mono">+x</code>) permission.
                    </p>
                    <Button
                      color="amber"
                      onClick={handleMakeExecutable}
                      disabled={makingExecutable}
                      className="mt-3"
                    >
                      {makingExecutable
                        ? "Making executable…"
                        : "Make executable"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div
                onPointerDownCapture={() => void rescanExecutables()}
                onKeyDownCapture={(event) => {
                  if (
                    ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)
                  )
                    void rescanExecutables();
                }}
              >
                <Listbox
                  name="launchExe"
                  value={selectedLaunchExe}
                  onChange={(v: any) => setSelectedLaunchExe(String(v))}
                >
                  <ListboxOption value="">
                    <ListboxLabel>-- Select executable --</ListboxLabel>
                  </ListboxOption>
                  {launchExecutables.map((exe) => (
                    <ListboxOption key={exe} value={exe}>
                      <ListboxLabel>{exe}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>
            )}
            <p className="mt-1 text-xs text-ps-muted">
              {t("launchOptions.executableHint")}
            </p>
            {launchScanTruncated && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                This installation folder is very large — the scan stopped early,
                so some executables may be missing.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                outline
                onClick={() => void handleCopyExecutablePath()}
                disabled={!selectedLaunchExe}
              >
                {t("launchOptions.copyPath")}
              </Button>
              <Button outline onClick={() => void handleOpenEmulator()}>
                {t("launchOptions.configureEmulator")}
              </Button>
            </div>
            {emulatorExecutable && (
              <div className="mt-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
                <p className="text-sm text-indigo-700 dark:text-indigo-300">
                  {t("launchOptions.emulatorActive")}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-ps-text">
                  {emulatorExecutable}
                </p>
              </div>
            )}
          </div>

          {isWindowsLaunchExe && (
            <>
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
                <p className="text-sm text-indigo-700 dark:text-indigo-300">
                  This is a Windows executable — it will be run with
                  umu-launcher (Wine/Proton) on Linux.
                </p>
                {!umuStatus?.installed && (
                  <Button
                    color="indigo"
                    onClick={() => void handleInstallUmu()}
                    disabled={installingUmu}
                    className="mt-3"
                  >
                    {installingUmu
                      ? "Installing umu-launcher…"
                      : "Install umu-launcher"}
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-ps-muted mb-1">
                    Game ID (GAMEID)
                  </label>
                  <Input
                    name="umuGameId"
                    value={umuGameId}
                    onChange={(e: any) => setUmuGameId(e.target.value)}
                    placeholder="umu-default"
                  />
                  <p className="mt-1 text-xs text-ps-muted">
                    Optional umu-database ID so protonfixes apply automatically.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ps-muted mb-1">
                    Store (STORE)
                  </label>
                  <Input
                    name="umuStore"
                    value={umuStore}
                    onChange={(e: any) => setUmuStore(e.target.value)}
                    placeholder="e.g. gog, epic, ubisoft-connect"
                  />
                  <p className="mt-1 text-xs text-ps-muted">
                    Storefront used together with GAMEID to look up fixes.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ps-muted mb-1">
                    Proton (PROTONPATH)
                  </label>
                  <Input
                    name="umuProtonPath"
                    value={umuProtonPath}
                    onChange={(e: any) => setUmuProtonPath(e.target.value)}
                    placeholder="UMU-Proton"
                  />
                  {protonBuilds.length > 0 && (
                    <div className="mt-2">
                      <Listbox
                        name="umuProtonBuild"
                        value=""
                        onChange={(value: any) =>
                          setUmuProtonPath(String(value))
                        }
                      >
                        <ListboxOption value="">
                          <ListboxLabel>
                            -- Installed Proton builds --
                          </ListboxLabel>
                        </ListboxOption>
                        {protonBuilds.map((build) => (
                          <ListboxOption key={build.path} value={build.name}>
                            <ListboxLabel>{build.name}</ListboxLabel>
                          </ListboxOption>
                        ))}
                      </Listbox>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-ps-muted">
                    Proton directory, version name (GE-Proton9-5) or codename
                    (GE-Proton).
                    {protonBuilds.length === 0 &&
                      " Builds installed in compatibilitytools.d (e.g. via ProtonUp-Qt) are offered here for selection."}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-ps-muted mb-1">
                    Wine Prefix (WINEPREFIX)
                  </label>
                  <Input
                    name="umuWinePrefix"
                    value={umuWinePrefix}
                    onChange={(e: any) => setUmuWinePrefix(e.target.value)}
                    placeholder="Automatic (per game)"
                  />
                  <p className="mt-1 text-xs text-ps-muted">
                    Leave empty to let PlayStash use its own folder per game
                    (named like the game's install folder) inside the
                    Wine/Proton Prefix Directory from the settings.
                    {resolvedPrefixPath && (
                      <>
                        {" "}
                        Currently:{" "}
                        <button
                          type="button"
                          className="underline decoration-dotted hover:text-ps-text"
                          title="Copy path"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                resolvedPrefixPath,
                              );
                              await showAlert({
                                title: "Prefix path copied",
                                description: resolvedPrefixPath,
                                affirmativeText: "OK",
                              });
                            } catch {
                              await showAlert({
                                title: "Wine/Proton prefix",
                                description: resolvedPrefixPath,
                                affirmativeText: "OK",
                              });
                            }
                          }}
                        >
                          {resolvedPrefixPath}
                        </button>{" "}
                        <button
                          type="button"
                          className="underline decoration-dotted hover:text-ps-text"
                          onClick={async () => {
                            try {
                              await invoke("open_in_file_explorer", {
                                path: resolvedPrefixPath,
                              });
                            } catch (error: any) {
                              await showAlert({
                                title: "Could not open the prefix folder",
                                description: error?.message || String(error),
                                affirmativeText: "OK",
                              });
                            }
                          }}
                        >
                          Open folder
                        </button>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Launch Parameters */}
          <div>
            <label className="block text-sm font-medium text-ps-muted mb-1">
              Launch Parameters
            </label>
            <Input
              name="launchParams"
              value={launchParams}
              onChange={(e: any) => setLaunchParams(e.target.value)}
              placeholder="e.g. -fullscreen -width 1920"
            />
            <p className="mt-1 text-xs text-ps-muted">
              Optional command-line arguments passed to the executable.
            </p>
          </div>

          {/* Run as Admin */}
          <div>
            <SwitchField>
              <Switch
                name="launchAsAdmin"
                color="indigo"
                aria-label="Run as Administrator"
                checked={launchAsAdmin}
                onChange={(v: boolean) => setLaunchAsAdmin(v)}
              />
              <Label>Run as Administrator</Label>
            </SwitchField>
            <p className="mt-1 ml-0 text-xs text-ps-muted">
              Launch the game with elevated privileges (UAC on Windows, root
              prompt on Linux).
            </p>
          </div>

          {/* Desktop Icon */}
          <div>
            <h4 className="text-sm font-semibold text-ps-text">
              {t("launchOptions.desktopIcon")}
            </h4>
            <p className="mt-1 text-xs text-ps-muted">
              {t("launchOptions.desktopIconHint")}
            </p>
            <Button
              outline
              className="mt-3"
              onClick={() => void handleCreateDesktopIcon()}
              disabled={creatingShortcut}
            >
              {t("launchOptions.createDesktopIcon")}
            </Button>
          </div>
        </>
      )}

      <EmulatorLaunchDialog
        open={emulatorOpen}
        onClose={() => setEmulatorOpen(false)}
        installationDirectory={installedGame.installationDirectory}
        versionDirectory={installedGame.versionDirectory}
        config={config}
        onSaved={handleEmulatorSaved}
      />
    </div>
  );
}
