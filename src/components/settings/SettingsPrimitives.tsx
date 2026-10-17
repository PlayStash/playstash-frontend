import clsx from "clsx";
import type { ComponentType, ReactNode } from "react";
import "@/styles/workspaces.css";

/** A named settings section with a flat, divided list of controls. */
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
    <div className={clsx("settings-group", className)} id={id}>
      {caption && <p className="settings-group-caption">{caption}</p>}
      {description && (
        <p className="settings-group-description">{description}</p>
      )}
      <div className="settings-group-content divide-y divide-ps-line">
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
        "settings-row flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3",
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
    <div className="settings-section-header">
      <span>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}
