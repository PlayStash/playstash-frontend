import * as Headless from "@headlessui/react";
import clsx from "clsx";
import { useTranslation } from "@/i18n";
import { formatMessage } from "@/utils/formatMessage";
import {
  isSameTheme,
  selectTheme,
  useActiveTheme,
} from "@/themes/themeManager";
import { useThemeOptions, type ThemeOption } from "@/themes/useThemeOptions";

/**
 * Theme picker: System, Classic PlayStash web, the seven built-in themes and
 * installed theme files. Each option shows its name, description and author.
 */
export default function ThemeSelect({ className }: { className?: string }) {
  const { t } = useTranslation();
  const active = useActiveTheme();
  const { options } = useThemeOptions();
  const current =
    options.find((option) => isSameTheme(option.selection, active.selection)) ??
    null;

  const handleChange = (option: ThemeOption | null) => {
    if (!option) return;
    void selectTheme(option.selection);
  };

  return (
    <Headless.Listbox
      value={current}
      onChange={handleChange}
      by={(a: ThemeOption | null, b: ThemeOption | null) => a?.key === b?.key}
    >
      <Headless.ListboxButton
        aria-label={t("themes.picker.label")}
        className={clsx(
          className,
          "group relative block w-full rounded-2xl border border-ps-line bg-ps-panel-strong py-[calc(--spacing(2.5)-1px)] pr-8 pl-3.5 text-left text-base/6 text-ps-text shadow-sm focus:outline-hidden data-focus:ring-2 data-focus:ring-ps-accent-cool sm:py-1.5 sm:pl-3 sm:text-sm/6",
        )}
      >
        <span className="block truncate">
          {current?.displayName ??
            active.selection.displayName ??
            t("themes.classic.name")}
        </span>
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <svg
            className="size-4 stroke-ps-muted"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
          >
            <path
              d="M5.75 10.75L8 13L10.25 10.75"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10.25 5.25L8 3L5.75 5.25"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </Headless.ListboxButton>
      <Headless.ListboxOptions
        anchor="bottom end"
        transition
        className="surface-panel isolate z-50 max-h-[min(28rem,70vh)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-[1.25rem] p-1.5 shadow-[var(--shadow-shell)] ring-1 ring-ps-line [--anchor-gap:--spacing(1)] focus:outline-hidden transition-opacity duration-100 data-closed:opacity-0"
      >
        {options.map((option) => (
          <Headless.ListboxOption
            key={option.key}
            value={option}
            className="group/option flex cursor-pointer flex-col gap-0.5 rounded-xl px-3 py-2 text-ps-text data-focus:bg-ps-accent data-focus:text-ps-on-accent data-selected:ring-1 data-selected:ring-ps-accent"
          >
            <span className="truncate text-sm font-semibold">
              {option.displayName}
            </span>
            {option.description && (
              <span
                className="truncate text-xs text-ps-muted group-data-focus/option:text-ps-on-accent/80"
                title={option.description}
              >
                {option.description}
              </span>
            )}
            <span className="text-[10px] text-ps-muted group-data-focus/option:text-ps-on-accent/80">
              {formatMessage(t("themes.author"), { author: option.author })}
            </span>
          </Headless.ListboxOption>
        ))}
      </Headless.ListboxOptions>
    </Headless.Listbox>
  );
}
