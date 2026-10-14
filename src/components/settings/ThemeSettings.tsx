import { useEffect, useRef, useState } from "react";
import * as Headless from "@headlessui/react";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  FolderOpenIcon,
  PaintBrushIcon,
  SwatchIcon,
  TrashIcon,
} from "@heroicons/react/16/solid";
import clsx from "clsx";
import { Button } from "@/components/tailwind/button";
import ThemeSelect from "@/components/ThemeSelect";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
  SettingsSectionHeader,
} from "@/components/settings/SettingsPrimitives";
import { ThemeGeneratorDialog } from "@/components/settings/ThemeGeneratorDialog";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useTranslation } from "@/i18n";
import type { SettingsSectionProps } from "@/settings/types";
import { formatMessage } from "@/utils/formatMessage";
import { openExternalUrl } from "@/utils/tauri";
import {
  COMMUNITY_THEMES_REPOSITORY,
  installCommunityTheme,
  loadCommunityThemes,
  type CommunityTheme,
} from "@/themes/communityThemes";
import {
  deleteInstalledTheme,
  installThemeFile,
  newThemeFileName,
  openThemesFolder,
} from "@/themes/themeFiles";
import {
  defaultSelection,
  fileSelection,
  selectTheme,
  useActiveTheme,
} from "@/themes/themeManager";
import {
  notifyThemeListChanged,
  useThemeOptions,
} from "@/themes/useThemeOptions";
import { listInstalledThemes } from "@/themes/themeFiles";
import { parseThemeXaml, themeErrorMessage } from "@/themes/xamlTheme";

/**
 * Themes category: installed themes (select, reload, uninstall, folder),
 * the theme generator and community themes.
 */
export function ThemeSettings({ rowHighlight, isTauri }: SettingsSectionProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const active = useActiveTheme();
  const { installed, reload } = useThemeOptions();
  const [reloading, setReloading] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  const selectedFile =
    active.selection.source !== "builtin"
      ? installed.find((theme) => theme.path === active.selection.path)
      : undefined;

  // A theme that failed to load (deleted/invalid file) is reported once.
  useEffect(() => {
    if (active.error && active.error !== lastErrorRef.current) {
      lastErrorRef.current = active.error;
      void showAlert({ title: active.error, tone: "danger" });
    }
  }, [active.error, showAlert]);

  const reloadList = async () => {
    setReloading(true);
    await reload();
    await new Promise((resolve) => setTimeout(resolve, 500));
    setReloading(false);
  };

  const uninstall = async () => {
    if (!selectedFile) return;
    try {
      await deleteInstalledTheme(selectedFile.path, selectedFile.definition);
      await selectTheme(defaultSelection());
      notifyThemeListChanged();
    } catch (error) {
      void showAlert({ title: themeErrorMessage(error), tone: "danger" });
    }
  };

  const openFolder = async () => {
    try {
      await openThemesFolder();
    } catch (error) {
      void showAlert({ title: themeErrorMessage(error), tone: "danger" });
    }
  };

  const importFile = async (file: File) => {
    try {
      const content = (await file.text()).replace(/^﻿/, "");
      const definition = parseThemeXaml(content);
      if (definition.overlay) {
        throw new Error(t("themes.import.overlayUnsupported"));
      }
      const path = await installThemeFile({
        fileName: newThemeFileName(),
        content,
      });
      notifyThemeListChanged();
      await selectTheme(fileSelection(path, definition));
      void showAlert({
        title: formatMessage(t("themes.community.installed"), {
          name: definition.displayName,
        }),
        tone: "success",
      });
    } catch (error) {
      void showAlert({ title: themeErrorMessage(error), tone: "danger" });
    }
  };

  return (
    <>
      <SettingsSectionHeader
        icon={SwatchIcon}
        title={t("themes.section.title")}
        description={t("themes.section.description")}
      />
      <SettingsGroup
        id="setting-themes-installed"
        className={rowHighlight("themes-installed")}
        caption={t("themes.installed.caption")}
      >
        <SettingsRow className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <SettingsLabel
            title={t("themes.installed.title")}
            description={t("themes.installed.description")}
          />
          <div className="flex w-full items-center gap-2 sm:w-80">
            <div className="min-w-0 flex-1">
              <ThemeSelect />
            </div>
            <Button
              outline
              aria-label={t("themes.reload")}
              title={t("themes.reload")}
              disabled={reloading}
              onClick={() => void reloadList()}
            >
              <ArrowPathIcon />
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow className="flex-wrap justify-end gap-2">
          {!isTauri && (
            <>
              <Button outline onClick={() => importInputRef.current?.click()}>
                <ArrowUpTrayIcon />
                {t("themes.import.button")}
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".xaml"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.target.value = "";
                }}
              />
            </>
          )}
          {isTauri && (
            <Button outline onClick={() => void openFolder()}>
              <FolderOpenIcon />
              {t("themes.openFolder")}
            </Button>
          )}
          <Button
            color="red"
            disabled={!selectedFile}
            onClick={() => void uninstall()}
          >
            <TrashIcon />
            {t("themes.uninstall")}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        id="setting-themes-generator"
        className={rowHighlight("themes-generator")}
      >
        <SettingsRow>
          <SettingsLabel
            title={t("themes.generator.title")}
            description={t("themes.generator.intro")}
          />
          <Button outline onClick={() => setGeneratorOpen(true)}>
            <PaintBrushIcon />
            {t("themes.generator.open")}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <CommunityThemes rowHighlight={rowHighlight} />

      <ThemeGeneratorDialog
        open={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
      />
    </>
  );
}

function CommunityThemes({
  rowHighlight,
}: Pick<SettingsSectionProps, "rowHighlight">) {
  const { t } = useTranslation();
  const { showAlert } = useAlertDialog();
  const [themes, setThemes] = useState<CommunityTheme[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CommunityTheme | null>(null);
  const [installing, setInstalling] = useState(false);

  const load = async () => {
    setLoading(true);
    setThemes([]);
    setSelected(null);
    try {
      setThemes(await loadCommunityThemes());
    } finally {
      setLoading(false);
    }
  };

  const install = async () => {
    if (!selected) {
      void showAlert({ title: t("themes.community.noneSelected") });
      return;
    }
    setInstalling(true);
    try {
      const { definition } = await installCommunityTheme(selected);
      notifyThemeListChanged();
      const installedThemes = await listInstalledThemes();
      const match = installedThemes.find(
        (theme) => theme.definition.displayName === definition.displayName,
      );
      if (match) await selectTheme(fileSelection(match.path, match.definition));
      void showAlert({
        title: formatMessage(t("themes.community.installed"), {
          name: definition.displayName,
        }),
        tone: "success",
      });
    } catch (error) {
      void showAlert({ title: themeErrorMessage(error), tone: "danger" });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <SettingsGroup
      id="setting-themes-community"
      className={rowHighlight("themes-community")}
      caption={t("themes.community.caption")}
    >
      <SettingsRow className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <SettingsLabel
          title={t("themes.community.title")}
          description={t("themes.community.description")}
        />
        <div className="flex w-full items-center gap-2 sm:w-80">
          <div className="min-w-0 flex-1">
            <Headless.Listbox
              value={selected}
              onChange={setSelected}
              by={(a: CommunityTheme | null, b: CommunityTheme | null) =>
                a?.url === b?.url
              }
            >
              <Headless.ListboxButton
                onClick={() => {
                  if (themes === null && !loading) void load();
                }}
                className="relative block w-full truncate rounded-2xl border border-ps-line bg-ps-panel-strong py-1.5 pr-8 pl-3 text-left text-sm/6 text-ps-text shadow-sm focus:outline-hidden data-focus:ring-2 data-focus:ring-ps-accent-cool"
              >
                {selected?.definition.displayName ??
                  (themes === null
                    ? t("themes.community.clickToLoad")
                    : loading
                      ? t("themes.community.loading")
                      : themes.length === 0
                        ? t("themes.community.empty")
                        : t("themes.community.choose"))}
              </Headless.ListboxButton>
              <Headless.ListboxOptions
                anchor="bottom end"
                className="surface-panel z-50 max-h-[min(28rem,70vh)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-[1.25rem] p-1.5 shadow-[var(--shadow-shell)] ring-1 ring-ps-line [--anchor-gap:--spacing(1)] focus:outline-hidden"
              >
                {loading && (
                  <div className="px-3 py-2 text-sm text-ps-muted">
                    {t("themes.community.loading")}
                  </div>
                )}
                {(themes ?? []).map((theme) => (
                  <Headless.ListboxOption
                    key={theme.url}
                    value={theme}
                    className={clsx(
                      "group/option flex cursor-pointer flex-col gap-0.5 rounded-xl px-3 py-2 text-ps-text",
                      "data-focus:bg-ps-accent data-focus:text-ps-on-accent data-selected:ring-1 data-selected:ring-ps-accent",
                    )}
                  >
                    <span className="truncate text-sm font-semibold">
                      {theme.definition.displayName}
                    </span>
                    <span
                      className="truncate text-xs text-ps-muted group-data-focus/option:text-ps-on-accent/80"
                      title={theme.definition.description}
                    >
                      {theme.definition.description}
                    </span>
                    <span className="text-[10px] text-ps-muted group-data-focus/option:text-ps-on-accent/80">
                      {formatMessage(t("themes.author"), {
                        author: theme.definition.author,
                      })}
                    </span>
                  </Headless.ListboxOption>
                ))}
              </Headless.ListboxOptions>
            </Headless.Listbox>
          </div>
          <Button
            outline
            aria-label={t("themes.reload")}
            title={t("themes.reload")}
            disabled={loading}
            onClick={() => void load()}
          >
            <ArrowPathIcon />
          </Button>
        </div>
      </SettingsRow>
      <SettingsRow className="flex-wrap justify-end gap-2">
        <Button
          outline
          onClick={() => void openExternalUrl(COMMUNITY_THEMES_REPOSITORY)}
        >
          <ArrowTopRightOnSquareIcon />
          {t("themes.community.openRepository")}
        </Button>
        <Button
          color="indigo"
          disabled={installing}
          onClick={() => void install()}
        >
          {t("themes.community.install")}
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}
