import { useEffect, useState } from "react";
import { Button } from "@/components/tailwind/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Input } from "@/components/tailwind/input";
import { useTranslation } from "@/i18n";
import {
  configString,
  updateGameConfig,
  type GameConfig,
} from "@/utils/gameConfig";
import { tauriInvoke } from "@/utils/tauriInvoke";

interface PathInside {
  relative: string;
  absolute: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  installationDirectory: string;
  versionDirectory: string;
  /** The current version config (prefills the fields). */
  config: GameConfig;
  /** Called with the written config after a save or a reset. */
  onSaved: (config: GameConfig) => void;
}

const ROM_PLACEHOLDER = "$ROM";

/** Emulator arguments with `$ROM` replaced by the quoted absolute ROM path. */
export function buildEmulatorParameters(
  argumentsTemplate: string,
  romPath: string,
): string {
  return argumentsTemplate.split(ROM_PLACEHOLDER).join(`"${romPath}"`);
}

function joinPath(base: string, relative: string): string {
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const parts = relative.split("/").filter(Boolean);
  return [base.replace(/[\\/]+$/, ""), ...parts].join(separator);
}

function platform(): "windows" | "mac" | "other" {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (agent.includes("Windows")) return "windows";
  if (agent.includes("Mac")) return "mac";
  return "other";
}

const invoke = tauriInvoke;

/**
 * "Emulator / ROM Launch": runs a user-installed emulator with a ROM from
 * this game's installation. It configures the ordinary Play button, desktop
 * shortcut and Steam launch, and playtime is tracked for the emulator while
 * it runs this ROM.
 */
export function EmulatorLaunchDialog({
  open,
  onClose,
  installationDirectory,
  versionDirectory,
  config,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const [emulator, setEmulator] = useState("");
  const [rom, setRom] = useState("");
  const [args, setArgs] = useState(ROM_PLACEHOLDER);
  const [status, setStatus] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const romRelative = configString(config, "emulatorrom");
    setEmulator(configString(config, "emulatorexecutable") ?? "");
    setRom(romRelative ? joinPath(installationDirectory, romRelative) : "");
    setArgs(configString(config, "emulatorarguments") ?? ROM_PLACEHOLDER);
    setStatus(null);
    // Prefill once per opening; later config changes come from this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const browseEmulator = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({
        directory: false,
        multiple: false,
        title: t("emulator.executable"),
        filters:
          platform() === "windows"
            ? [{ name: t("emulator.executableFilter"), extensions: ["exe"] }]
            : undefined,
      });
      if (typeof selected === "string" && selected) setEmulator(selected);
    } catch (error) {
      console.warn("Choosing the emulator failed:", error);
    }
  };

  const browseRom = async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({
        directory: false,
        multiple: false,
        defaultPath: installationDirectory,
        title: t("emulator.rom"),
      });
      if (typeof selected === "string" && selected) setRom(selected);
    } catch (error) {
      console.warn("Choosing the ROM failed:", error);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const emulatorPath = emulator.trim()
        ? await invoke<string | null>("resolve_emulator_executable", {
            path: emulator.trim(),
          }).catch(() => null)
        : null;
      if (!emulatorPath) {
        setStatus({ text: t("emulator.errorExecutable"), error: true });
        return;
      }

      const romInside = rom.trim()
        ? await invoke<PathInside | null>("resolve_path_inside", {
            path: rom.trim(),
            root: installationDirectory,
          }).catch(() => null)
        : null;
      if (!romInside) {
        setStatus({ text: t("emulator.errorRom"), error: true });
        return;
      }

      if (!args.includes(ROM_PLACEHOLDER)) {
        setStatus({ text: t("emulator.errorArguments"), error: true });
        return;
      }

      const next = await updateGameConfig(versionDirectory, {
        emulatorexecutable: emulatorPath,
        emulatorrom: romInside.relative,
        emulatorarguments: args,
        launchparameters: buildEmulatorParameters(args, romInside.absolute),
      });
      setEmulator(emulatorPath);
      setStatus({ text: t("emulator.saved"), error: false });
      onSaved(next);
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const useNative = async () => {
    setSaving(true);
    try {
      const romRelative = configString(config, "emulatorrom");
      const template = configString(config, "emulatorarguments");
      const generated =
        romRelative && template
          ? buildEmulatorParameters(
              template,
              joinPath(installationDirectory, romRelative),
            )
          : undefined;
      const parameters = configString(config, "launchparameters");
      const next = await updateGameConfig(versionDirectory, {
        emulatorexecutable: undefined,
        emulatorrom: undefined,
        emulatorarguments: undefined,
        // The emulator arguments replaced the launch parameters; drop them
        // unless the user changed them since.
        ...(parameters !== undefined && parameters === generated
          ? { launchparameters: undefined }
          : {}),
      });
      setEmulator("");
      setRom("");
      setArgs(ROM_PLACEHOLDER);
      setStatus({ text: t("emulator.nativeRestored"), error: false });
      onSaved(next);
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : String(error),
        error: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const emulatorActive = !!configString(config, "emulatorexecutable");

  return (
    <Dialog open={open} onClose={onClose} size="3xl">
      <DialogTitle>{t("emulator.title")}</DialogTitle>
      <DialogDescription>{t("emulator.description")}</DialogDescription>
      <DialogBody className="space-y-5">
        <div>
          <label
            htmlFor="emulator-executable"
            className="mb-1 block text-sm font-medium text-ps-muted"
          >
            {t("emulator.executable")}
          </label>
          <div className="flex gap-2">
            <Input
              id="emulator-executable"
              name="emulatorExecutable"
              value={emulator}
              readOnly
              className="min-w-0 flex-1"
            />
            <Button outline onClick={() => void browseEmulator()}>
              {t("emulator.browse")}
            </Button>
          </div>
        </div>
        <div>
          <label
            htmlFor="emulator-rom"
            className="mb-1 block text-sm font-medium text-ps-muted"
          >
            {t("emulator.rom")}
          </label>
          <div className="flex gap-2">
            <Input
              id="emulator-rom"
              name="emulatorRom"
              value={rom}
              readOnly
              className="min-w-0 flex-1"
            />
            <Button outline onClick={() => void browseRom()}>
              {t("emulator.browse")}
            </Button>
          </div>
        </div>
        <div>
          <label
            htmlFor="emulator-arguments"
            className="mb-1 block text-sm font-medium text-ps-muted"
          >
            {t("emulator.arguments")}
          </label>
          <Input
            id="emulator-arguments"
            name="emulatorArguments"
            value={args}
            onChange={(event) => setArgs(event.target.value)}
          />
        </div>
        {status && (
          <p
            role="status"
            className={
              status.error
                ? "text-sm text-red-600 dark:text-red-400"
                : "text-sm text-ps-muted"
            }
          >
            {status.text}
          </p>
        )}
      </DialogBody>
      <DialogActions>
        {emulatorActive && (
          <Button outline onClick={() => void useNative()} disabled={saving}>
            {t("emulator.useNative")}
          </Button>
        )}
        <Button plain onClick={onClose}>
          {t("emulator.close")}
        </Button>
        <Button color="indigo" onClick={() => void save()} disabled={saving}>
          {t("emulator.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
