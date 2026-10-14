import { useRef, useState } from "react";
import { Button } from "@/components/tailwind/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Input } from "@/components/tailwind/input";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation, type TranslationKey } from "@/i18n";
import { isTauriApp } from "@/utils/tauri";
import {
  buildThemeXaml,
  colorFromPicker,
  fileBaseName,
  GENERATOR_DEFAULT_FILE_NAME,
  GENERATOR_DEFAULTS,
  GENERATOR_OVERLAY_EXTENSIONS,
  generatePalette,
  overlayFileNameFor,
} from "@/themes/generator";
import { getThemesDirectory, installThemeFile } from "@/themes/themeFiles";
import { fileSelection, selectTheme } from "@/themes/themeManager";
import { notifyThemeListChanged } from "@/themes/useThemeOptions";
import { parseWpfColor, toRgbHex } from "@/themes/wpfColors";
import { parseThemeXaml } from "@/themes/xamlTheme";

type ColorField = "accent" | "background" | "surface" | "foreground" | "border";

const ROWS: { field: ColorField; label: TranslationKey }[] = [
  { field: "accent", label: "themes.generator.mainColor" },
  { field: "background", label: "themes.generator.background" },
  { field: "surface", label: "themes.generator.surface" },
  { field: "foreground", label: "themes.generator.text" },
  { field: "border", label: "themes.generator.borders" },
];

/** Overlay picked for the export: a desktop path or a web File. */
type OverlayChoice = { name: string; path?: string; file?: File } | null;

/** "Create a Theme" (port of the WPF ThemeGeneratorUserControl). */
export function ThemeGeneratorDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { showAlert } = useAlertDialog();
  const [name, setName] = useState<string>(GENERATOR_DEFAULTS.name);
  const [nameError, setNameError] = useState(false);
  const [colors, setColors] = useState<Record<ColorField, string>>({
    accent: GENERATOR_DEFAULTS.accent,
    background: GENERATOR_DEFAULTS.background,
    surface: GENERATOR_DEFAULTS.surface,
    foreground: GENERATOR_DEFAULTS.foreground,
    border: GENERATOR_DEFAULTS.border,
  });
  const [overlay, setOverlay] = useState<OverlayChoice>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const setColor = (field: ColorField, value: string) =>
    setColors((previous) => ({ ...previous, [field]: value }));

  const generate = () => {
    const palette = generatePalette(colors.accent);
    if (!palette) {
      setStatus(t("themes.generator.invalidMain"));
      return;
    }
    setColors((previous) => ({ ...previous, ...palette }));
    setStatus(t("themes.generator.generated"));
  };

  const chooseOverlay = async () => {
    if (isTauriApp()) {
      try {
        const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
        const picked = await openDialog({
          multiple: false,
          filters: [
            {
              name: t("themes.generator.images"),
              extensions: [...GENERATOR_OVERLAY_EXTENSIONS],
            },
          ],
        });
        if (typeof picked === "string") {
          setOverlay({
            name: picked.split(/[/\\]/).pop() ?? picked,
            path: picked,
          });
        }
        return;
      } catch {
        // fall back to the browser file input (dev override)
      }
    }
    fileInputRef.current?.click();
  };

  const offerApply = async (path: string, xml: string) => {
    notifyThemeListChanged();
    const apply = await showAlert({
      title: t("themes.generator.applyTitle"),
      description: t("themes.generator.applyDescription"),
      affirmativeText: t("themes.generator.applyConfirm"),
      negativeText: t("themes.generator.applyCancel"),
    });
    if (apply) await selectTheme(fileSelection(path, parseThemeXaml(xml)));
  };

  const exportTheme = async () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    if (ROWS.some(({ field }) => !parseWpfColor(colors[field]))) {
      setStatus(t("themes.generator.invalidColors"));
      return;
    }
    const author = user?.username || "Local user";
    setBusy(true);
    try {
      if (isTauriApp()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        let defaultPath = GENERATOR_DEFAULT_FILE_NAME;
        try {
          const dir = await getThemesDirectory(true);
          defaultPath = `${dir}${dir.includes("\\") ? "\\" : "/"}${GENERATOR_DEFAULT_FILE_NAME}`;
        } catch {
          // keep the bare file name
        }
        const target = await save({
          defaultPath,
          filters: [
            { name: t("themes.generator.fileType"), extensions: ["xaml"] },
          ],
        });
        if (!target) return;
        const path = /\.xaml$/i.test(target) ? target : `${target}.xaml`;
        const base = fileBaseName(path);
        const xml = buildThemeXaml({
          fileBaseName: base,
          displayName: name,
          author,
          ...colors,
          overlayFileName: overlay?.path
            ? overlayFileNameFor(base, overlay.path)
            : null,
        });
        const { invoke } = await import("@tauri-apps/api/core");
        const written = await invoke<string>("theme_export", {
          path,
          content: xml,
          overlaySource: overlay?.path ?? null,
        });
        setStatus(t("themes.generator.exported"));
        await offerApply(written, xml);
        return;
      }

      // Web: download the file and keep a copy in the browser theme store.
      const base = fileBaseName(GENERATOR_DEFAULT_FILE_NAME);
      const overlayName = overlay?.file
        ? overlayFileNameFor(base, overlay.file.name)
        : null;
      const xml = buildThemeXaml({
        fileBaseName: base,
        displayName: name,
        author,
        ...colors,
        overlayFileName: overlayName,
      });
      const url = URL.createObjectURL(
        new Blob([xml], { type: "application/xaml+xml" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = GENERATOR_DEFAULT_FILE_NAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const path = await installThemeFile({
        fileName: GENERATOR_DEFAULT_FILE_NAME,
        content: xml,
        overlay:
          overlay?.file && overlayName
            ? {
                relPath: overlayName,
                bytes: new Uint8Array(await overlay.file.arrayBuffer()),
              }
            : null,
      });
      setStatus(t("themes.generator.exported"));
      await offerApply(path, xml);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="2xl">
      <DialogTitle>{t("themes.generator.title")}</DialogTitle>
      <DialogDescription>{t("themes.generator.intro")}</DialogDescription>
      <DialogBody className="space-y-4">
        <div>
          <Input
            aria-label={t("themes.generator.name")}
            value={name}
            invalid={nameError}
            onChange={(event) => setName(event.target.value)}
          />
          {nameError && (
            <p className="mt-1 text-xs text-ps-danger">
              {t("themes.generator.required")}
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:items-center">
          {ROWS.map(({ field, label }) => {
            const parsed = parseWpfColor(colors[field]);
            return (
              <div key={field} className="contents">
                <label
                  htmlFor={`theme-generator-${field}`}
                  className="text-sm text-ps-text"
                >
                  {t(label)}
                </label>
                <div className="flex items-center gap-2">
                  <div className="w-40">
                    <Input
                      id={`theme-generator-${field}`}
                      value={colors[field]}
                      invalid={!parsed}
                      onChange={(event) => setColor(field, event.target.value)}
                    />
                  </div>
                  <input
                    type="color"
                    aria-label={`${t(label)} ${t("themes.generator.pick")}`}
                    title={t("themes.generator.pick")}
                    value={parsed ? toRgbHex(parsed) : "#000000"}
                    onChange={(event) =>
                      setColor(field, colorFromPicker(event.target.value))
                    }
                    className="h-9 w-12 cursor-pointer rounded-lg border border-ps-line bg-ps-panel-strong p-1"
                  />
                  {field === "accent" && (
                    <Button outline onClick={generate}>
                      {t("themes.generator.generate")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-2">
          <Button outline onClick={() => void chooseOverlay()}>
            {t("themes.generator.chooseOverlay")}
          </Button>
          <p className="text-sm text-ps-muted">
            {overlay?.name ?? t("themes.generator.noOverlay")}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={GENERATOR_OVERLAY_EXTENSIONS.map((ext) => `.${ext}`).join(
              ",",
            )}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setOverlay({ name: file.name, file });
              event.target.value = "";
            }}
          />
        </div>
        {status && (
          <p role="status" className="text-sm text-ps-muted">
            {status}
          </p>
        )}
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          {t("themes.generator.close")}
        </Button>
        <Button
          color="indigo"
          disabled={busy}
          onClick={() => void exportTheme()}
        >
          {t("themes.generator.export")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
