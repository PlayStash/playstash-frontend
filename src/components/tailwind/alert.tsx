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
          className="fixed inset-0 flex w-screen justify-center overflow-y-auto bg-ps-bg/70 px-2 py-2 transition-opacity duration-220 ease-(--ease-out) focus:outline-0 data-closed:opacity-0 data-leave:duration-150 motion-reduce:duration-100 sm:px-6 sm:py-8 lg:px-8 lg:py-16"
        />
      )}
      {isToast ? (
        <Headless.DialogPanel
          transition
          className={clsx(
            className,
            "fixed top-[calc(1rem+env(safe-area-inset-top,0px))] right-[calc(1rem+env(safe-area-inset-right,0px))] z-50 flex w-[220px] items-center gap-2 rounded-2xl bg-ps-panel-strong px-4 py-2 text-sm text-ps-text shadow-(--shadow-shell) ring-1 ring-ps-line sm:w-auto",
            "origin-top-right transition-[opacity,transform] duration-180 ease-(--ease-out) data-closed:[transform:translateY(-4px)_scale(.98)] data-closed:opacity-0 data-leave:duration-120 motion-reduce:transform-none motion-reduce:duration-100 motion-reduce:data-closed:transform-none",
            "pointer-events-auto",
          )}
        >
          {children}
        </Headless.DialogPanel>
      ) : (
        <div className="fixed inset-0 w-screen overflow-y-auto overscroll-contain pt-6 sm:pt-0">
          <div className="grid min-h-full grid-rows-[1fr_auto_1fr] justify-items-center p-8 sm:grid-rows-[1fr_auto_3fr] sm:p-4">
            <Headless.DialogPanel
              transition
              className={clsx(
                className,
                sizes[size],
                "row-start-2 w-full rounded-lg bg-ps-shell p-8 text-ps-text shadow-(--shadow-shell) ring-1 ring-ps-line sm:p-6 forced-colors:outline",
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
        "text-center text-base/6 font-semibold text-balance text-ps-text sm:text-left sm:text-sm/6 sm:text-wrap",
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
