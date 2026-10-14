import clsx from "clsx";
import type { ComponentType, ReactNode } from "react";

/**
 * Grouped settings list, iOS Settings style: a rounded container with
 * hairline dividers and a small uppercase group caption above it.
 */
export function SettingsGroup({
  caption,
  description,
  children,
  className,
  id,
}: {
  caption?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={clsx(className)} id={id}>
      {caption && (
        <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ps-muted">
          {caption}
        </p>
      )}
      {description && (
        <p className="mb-2 px-1 text-xs leading-5 text-ps-muted">
          {description}
        </p>
      )}
      <div className="divide-y divide-ps-line overflow-hidden rounded-2xl border border-ps-line bg-ps-panel-strong shadow-sm">
        {children}
      </div>
    </div>
  );
}

/** One row inside a settings group: label + description on the left, control on the right. */
export function SettingsRow({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={clsx(
        "flex min-h-12 items-center justify-between gap-x-4 px-4 py-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Left-hand label + optional description for a settings row. */
export function SettingsLabel({
  title,
  description,
  className,
}: {
  title: string;
  description?: string | null;
  className?: string;
}) {
  return (
    <div className={clsx("min-w-0 flex-1", className)}>
      <p className="text-sm font-medium text-ps-text">{title}</p>
      {description && (
        <p className="mt-0.5 text-xs leading-5 text-ps-muted">{description}</p>
      )}
    </div>
  );
}

/** Section heading shown above the groups of the active category. */
export function SettingsSectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ps-panel-soft text-ps-accent ring-1 ring-ps-line">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 pt-0.5">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-ps-text">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-xs text-ps-muted sm:text-sm">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
