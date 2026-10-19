"use client";

import * as Headless from "@headlessui/react";
import clsx from "clsx";
import { useState } from "react";

export function Combobox<T>({
  options,
  displayValue,
  filter,
  anchor = "bottom",
  className,
  placeholder,
  autoFocus,
  "aria-label": ariaLabel,
  children,
  ...props
}: {
  options: T[];
  displayValue: (value: T | null) => string | undefined;
  filter?: (value: T, query: string) => boolean;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  children: (value: NonNullable<T>) => React.ReactElement;
} & Omit<Headless.ComboboxProps<T, false>, "as" | "multiple" | "children"> & {
    anchor?: "top" | "bottom";
  }) {
  const [query, setQuery] = useState("");

  const filteredOptions =
    query === ""
      ? options
      : options.filter((option) =>
          filter
            ? filter(option, query)
            : displayValue(option)?.toLowerCase().includes(query.toLowerCase()),
        );

  return (
    <Headless.Combobox
      {...props}
      multiple={false}
      virtual={{ options: filteredOptions }}
      onClose={() => setQuery("")}
    >
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
        <Headless.ComboboxInput
          autoFocus={autoFocus}
          data-slot="control"
          aria-label={ariaLabel}
          displayValue={(option: T) => displayValue(option) ?? ""}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className={clsx([
            className,
            // Basic layout
            "relative block w-full appearance-none rounded-md py-[calc(--spacing(2.5)-1px)] sm:py-[calc(--spacing(1.75)-1px)]",
            // Horizontal padding
            "pr-[calc(--spacing(10)-1px)] pl-[calc(--spacing(3.5)-1px)] sm:pr-[calc(--spacing(9)-1px)] sm:pl-[calc(--spacing(3)-1px)]",
            // Typography
            // 16px on touch devices so iOS never zooms; compact 14px with a mouse.
            "text-base/6 text-ps-text placeholder:text-ps-muted sm:pointer-fine:text-sm/6",
            // Border and fill share the Input field treatment
            "border border-ps-line-strong bg-ps-shell",
            // Hide default focus styles
            "focus:outline-hidden",
            // Invalid state
            "data-invalid:border-red-500 data-invalid:data-hover:border-red-500 dark:data-invalid:border-red-500 dark:data-invalid:data-hover:border-red-500",
            // Disabled state
            "data-disabled:border-transparent data-disabled:bg-ps-panel-soft",
            // System icons
            "dark:scheme-dark",
          ])}
        />
        <Headless.ComboboxButton className="group absolute inset-y-0 right-0 flex touch-manipulation items-center px-2">
          <svg
            className="size-5 stroke-ps-muted transition-[stroke] duration-150 group-data-hover:stroke-ps-text sm:size-4 forced-colors:stroke-[CanvasText]"
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
        </Headless.ComboboxButton>
      </span>
      <Headless.ComboboxOptions
        transition
        anchor={anchor}
        className={clsx(
          // Anchor positioning
          "[--anchor-gap:--spacing(2)] [--anchor-padding:--spacing(4)] sm:data-[anchor~=start]:[--anchor-offset:-4px]",
          // Base styles,
          "isolate min-w-[calc(var(--input-width)+8px)] scroll-py-1 rounded-lg p-1.5 select-none empty:invisible",
          // Invisible border that is only visible in `forced-colors` mode for accessibility purposes
          "outline outline-transparent focus:outline-hidden",
          // Handle scrolling when menu won't fit in viewport
          "overflow-y-auto overscroll-contain",
          // Popover background: flat panel, no glass (matches Dropdown)
          "surface-panel",
          // Shadows
          "shadow-[var(--shadow-shell)] ring-1 ring-ps-line",
          // Scale from the control, following the resolved (possibly flipped) placement.
          "origin-top data-[anchor~=top]:origin-bottom data-[anchor~=bottom]:data-[anchor~=start]:origin-top-left data-[anchor~=bottom]:data-[anchor~=end]:origin-top-right data-[anchor~=top]:data-[anchor~=start]:origin-bottom-left data-[anchor~=top]:data-[anchor~=end]:origin-bottom-right",
          // Retargetable enter and exit states keep rapid toggles continuous.
          "transition-[opacity,transform] duration-180 ease-(--ease-out) data-closed:[transform:scale(.98)] data-closed:opacity-0 data-leave:duration-120 motion-reduce:transform-none motion-reduce:duration-100 motion-reduce:data-closed:transform-none",
        )}
      >
        {({ option }) => children(option)}
      </Headless.ComboboxOptions>
    </Headless.Combobox>
  );
}

export function ComboboxOption<T>({
  children,
  className,
  ...props
}: { className?: string; children?: React.ReactNode } & Omit<
  Headless.ComboboxOptionProps<"div", T>,
  "as" | "className"
>) {
  let sharedClasses = clsx(
    // Base
    "flex min-w-0 items-center",
    // Icons
    "*:data-[slot=icon]:size-5 *:data-[slot=icon]:shrink-0 sm:*:data-[slot=icon]:size-4",
    "*:data-[slot=icon]:text-ps-muted group-data-focus/option:*:data-[slot=icon]:text-ps-on-accent",
    "forced-colors:*:data-[slot=icon]:text-[CanvasText] forced-colors:group-data-focus/option:*:data-[slot=icon]:text-[Canvas]",
    // Avatars
    "*:data-[slot=avatar]:-mx-0.5 *:data-[slot=avatar]:size-6 sm:*:data-[slot=avatar]:size-5",
  );

  return (
    <Headless.ComboboxOption
      {...props}
      className={clsx(
        // Basic layout
        "group/option grid w-full cursor-pointer grid-cols-[1fr_--spacing(5)] items-baseline gap-x-2 rounded-md py-2.5 pr-2 pl-3.5 sm:grid-cols-[1fr_--spacing(4)] sm:py-1.5 sm:pr-2 sm:pl-3",
        // Typography
        "text-base/6 text-ps-text sm:text-sm/6 forced-colors:text-[CanvasText]",
        // Focus: instant accent highlight, like Dropdown and Listbox
        "outline-hidden transition-none data-focus:bg-ps-accent data-focus:text-ps-on-accent",
        // Forced colors mode
        "forced-color-adjust-none forced-colors:data-focus:bg-[Highlight] forced-colors:data-focus:text-[HighlightText]",
        // Disabled
        "data-disabled:opacity-50",
      )}
    >
      <span className={clsx(className, sharedClasses)}>{children}</span>
      <svg
        className="relative col-start-2 hidden size-5 self-center stroke-current group-data-selected/option:inline sm:size-4"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 8.5l3 3L12 4"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Headless.ComboboxOption>
  );
}

export function ComboboxLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...props}
      className={clsx(
        className,
        "ml-2.5 truncate first:ml-0 sm:ml-2 sm:first:ml-0",
      )}
    />
  );
}

export function ComboboxDescription({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...props}
      className={clsx(
        className,
        "flex flex-1 overflow-hidden text-ps-muted group-data-focus/option:text-ps-on-accent before:w-2 before:min-w-0 before:shrink",
      )}
    >
      <span className="flex-1 truncate">{children}</span>
    </span>
  );
}
