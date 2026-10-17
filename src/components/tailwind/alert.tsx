import * as Headless from "@headlessui/react";
import clsx from "clsx";
import type React from "react";
import { Text } from "./text";

const sizes = {
  xs: "sm:max-w-xs",
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
  "4xl": "sm:max-w-4xl",
  "5xl": "sm:max-w-5xl",
};

export function Alert({
  size = "md",
  className,
  children,
  variant = "modal",
  ...props
}: {
  size?: keyof typeof sizes;
  className?: string;
  children: React.ReactNode;
  variant?: "modal" | "toast";
} & Omit<Headless.DialogProps, "as" | "className">) {
  const isToast = variant === "toast";
  return (
    <Headless.Dialog {...props}>
      {!isToast && (
        <Headless.DialogBackdrop
          transition
          className="fixed inset-0 flex w-screen justify-center overflow-y-auto bg-zinc-950/15 px-2 py-2 transition-opacity duration-220 ease-(--ease-out) focus:outline-0 data-closed:opacity-0 data-leave:duration-150 motion-reduce:duration-100 sm:px-6 sm:py-8 lg:px-8 lg:py-16 dark:bg-zinc-950/50"
        />
      )}
      {isToast ? (
        <Headless.DialogPanel
          transition
          className={clsx(
            className,
            "fixed top-4 right-4 z-50 w-[220px] sm:w-auto rounded-md bg-white px-4 py-2 shadow-lg ring-1 ring-zinc-950/10 text-sm flex items-center gap-2 dark:bg-zinc-900 dark:ring-white/10",
            "origin-top-right transition-[opacity,transform] duration-180 ease-(--ease-out) data-closed:[transform:translateY(-4px)_scale(.98)] data-closed:opacity-0 data-leave:duration-120 motion-reduce:transform-none motion-reduce:duration-100 motion-reduce:data-closed:transform-none",
            "pointer-events-auto",
          )}
        >
          {children}
        </Headless.DialogPanel>
      ) : (
        <div className="fixed inset-0 w-screen overflow-y-auto pt-6 sm:pt-0">
          <div className="grid min-h-full grid-rows-[1fr_auto_1fr] justify-items-center p-8 sm:grid-rows-[1fr_auto_3fr] sm:p-4">
            <Headless.DialogPanel
              transition
              className={clsx(
                className,
                sizes[size],
                "row-start-2 w-full rounded-lg bg-white p-8 shadow-lg ring-1 ring-zinc-950/10 sm:rounded-lg sm:p-6 dark:bg-zinc-900 dark:ring-white/10 forced-colors:outline",
                "origin-center transition-[opacity,transform] duration-220 ease-(--ease-out) data-closed:[transform:translateY(6px)_scale(.98)] data-closed:opacity-0 data-leave:duration-150 motion-reduce:transform-none motion-reduce:duration-100 motion-reduce:data-closed:transform-none",
              )}
            >
              {children}
            </Headless.DialogPanel>
          </div>
        </div>
      )}
    </Headless.Dialog>
  );
}

export function AlertTitle({
  className,
  ...props
}: { className?: string } & Omit<
  Headless.DialogTitleProps,
  "as" | "className"
>) {
  return (
    <Headless.DialogTitle
      {...props}
      className={clsx(
        className,
        "text-center text-base/6 font-semibold text-balance text-zinc-950 sm:text-left sm:text-sm/6 sm:text-wrap dark:text-white",
      )}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: { className?: string } & Omit<
  Headless.DescriptionProps<typeof Text>,
  "as" | "className"
>) {
  return (
    <Headless.Description
      as={Text}
      {...props}
      className={clsx(className, "mt-2 text-center text-pretty sm:text-left")}
    />
  );
}

export function AlertBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={clsx(className, "mt-4")} />;
}

export function AlertActions({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        "mt-6 flex flex-col-reverse items-center justify-end gap-3 *:w-full sm:mt-4 sm:flex-row sm:*:w-auto",
      )}
    />
  );
}
