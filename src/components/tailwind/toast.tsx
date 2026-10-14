import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type React from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { DURATION_FAST, DURATION_SLOW, EASE_OUT } from "@/lib/motion";
import { isTauriApp } from "@/utils/tauri";

export type ToastTone = "info" | "success" | "warning" | "danger";

const tones: Record<
  ToastTone,
  {
    rail: string;
    icon: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  info: {
    rail: "bg-ps-accent",
    icon: "bg-ps-accent/15 text-ps-accent",
    Icon: InformationCircleIcon,
  },
  success: {
    rail: "bg-ps-success",
    icon: "bg-ps-success/15 text-ps-success",
    Icon: CheckCircleIcon,
  },
  warning: {
    rail: "bg-ps-warning",
    icon: "bg-ps-warning/15 text-ps-warning",
    Icon: ExclamationTriangleIcon,
  },
  danger: {
    rail: "bg-ps-danger",
    icon: "bg-ps-danger/15 text-ps-danger",
    Icon: XCircleIcon,
  },
};

/**
 * Non-blocking floating toast, aligned to PlayStash's design language.
 *
 * - Raised panel surface (`ps-panel-strong`) with a 1px cool border and the
 *   shared shell shadow, instead of a flat `bg-ps-panel` + generic `shadow-lg`.
 * - A left accent rail + tinted icon tile carry the semantic tone without
 *   relying on color alone (accessibility requirement).
 * - 16px surface radius and the project-wide easing curve / durations.
 * - Reduced-motion is handled globally via `MotionConfig reducedMotion="user"`.
 */
export function Toast({
  tone = "info",
  title,
  description,
  onDismiss,
  className,
  // ── WP7 appearance: begin ──
  action,
  // ── WP7 appearance: end ──
  ...props
}: {
  tone?: ToastTone;
  title: string;
  description?: string;
  onDismiss?: () => void;
  className?: string;
  // ── WP7 appearance: begin ──
  /** Optional text button next to the dismiss button (e.g. "Copy"). */
  action?: { label: string; onClick: () => void };
  // ── WP7 appearance: end ──
} & HTMLMotionProps<"div">) {
  const { rail, icon, Icon } = tones[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: DURATION_FAST } }}
      transition={{ duration: DURATION_SLOW, ease: EASE_OUT }}
      role="status"
      {...props}
      className={clsx(
        className,
        "pointer-events-auto fixed right-4 z-50 flex w-[min(90vw,360px)] items-start gap-2.5 overflow-hidden rounded-2xl border border-ps-line bg-ps-panel-strong py-3 pr-2 pl-4 shadow-(--shadow-shell)",
        // In the desktop app the custom window titlebar (36px) owns the top
        // right corner, so keep toasts below it instead of covering the
        // window controls.
        isTauriApp() ? "top-13" : "top-4",
      )}
    >
      {/* Accent rail: semantic tone signal (paired with the icon for a11y) */}
      <span className={clsx("absolute inset-y-0 left-0 w-0.75", rail)} />

      <span
        className={clsx(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          icon,
        )}
      >
        <Icon className="size-5" />
      </span>

      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-sm font-semibold tracking-[-0.01em] text-ps-text">
          {title}
        </p>
        {description && (
          <p className="mt-0.5 text-sm text-ps-muted">{description}</p>
        )}
      </div>

      {/* ── WP7 appearance: begin ── */}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="h-9 shrink-0 rounded-xl px-2.5 text-xs font-semibold text-ps-accent-cool transition-colors hover:bg-ps-panel-soft focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-accent-cool"
        >
          {action.label}
        </button>
      )}
      {/* ── WP7 appearance: end ── */}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-ps-muted transition-colors hover:bg-ps-panel-soft hover:text-ps-text focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-accent-cool"
        >
          <XMarkIcon className="size-4" />
          <span className="sr-only">Dismiss</span>
        </button>
      )}
    </motion.div>
  );
}

export default Toast;
