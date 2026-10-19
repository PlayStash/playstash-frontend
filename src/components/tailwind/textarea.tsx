import * as Headless from "@headlessui/react";
import clsx from "clsx";
import React, { forwardRef } from "react";

export const Textarea = forwardRef(function Textarea(
  {
    className,
    textareaClassName,
    resizable = true,
    ...props
  }: {
    className?: string;
    textareaClassName?: string;
    resizable?: boolean;
  } & Omit<Headless.TextareaProps, "as" | "className">,
  ref: React.ForwardedRef<HTMLTextAreaElement>,
) {
  return (
    <span
      data-slot="control"
      className={clsx([
        className,
        // Basic layout
        "relative block w-full",
        // Focus ring (matches Input)
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-transparent after:ring-inset focus-within:after:ring-2 focus-within:after:ring-ps-accent-cool",
        // Disabled state
        "has-data-disabled:opacity-50",
      ])}
    >
      <Headless.Textarea
        ref={ref}
        {...props}
        className={clsx([
          textareaClassName,
          // Basic layout
          "relative block h-full w-full appearance-none rounded-md px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3.25)-1px)] sm:py-[calc(--spacing(1.75)-1px)]",
          // Typography: 16px on touch devices so iOS never zooms; compact
          // 14px only with a fine pointer.
          "text-base/6 text-ps-text placeholder:text-ps-muted sm:pointer-fine:text-sm/6",
          // Border and fill share the Input field treatment
          "border border-ps-line-strong",
          "bg-ps-shell",
          // Long text scrolls inside the field without dragging the page
          "overscroll-contain",
          // Hide default focus styles
          "focus:outline-hidden",
          // System scrollbars and resize handle follow the theme
          "dark:scheme-dark",
          // Invalid state
          "data-invalid:border-red-500 data-invalid:data-hover:border-red-500 dark:data-invalid:border-red-600 dark:data-invalid:data-hover:border-red-600",
          // Disabled state
          "disabled:border-transparent disabled:bg-ps-panel-soft",
          // Resizable
          resizable ? "resize-y" : "resize-none",
        ])}
      />
    </span>
  );
});
