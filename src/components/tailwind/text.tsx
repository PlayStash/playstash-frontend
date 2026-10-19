import clsx from "clsx";
import { Link } from "./link";

export function Text({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"p">) {
  return (
    <p
      data-slot="text"
      {...props}
      className={clsx(className, "text-base/7 text-ps-muted sm:text-sm/6")}
    />
  );
}

export function TextLink({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link
      {...props}
      className={clsx(
        className,
        "underline decoration-ps-line-strong underline-offset-4 hover:decoration-ps-accent-cool",
      )}
    />
  );
}

export function Strong({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"strong">) {
  return <strong {...props} className={clsx(className, "font-semibold")} />;
}

export function Code({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"code">) {
  return (
    <code
      {...props}
      className={clsx(
        className,
        "rounded-md border border-ps-line bg-ps-panel-soft px-1.5 py-0.5 font-mono text-sm font-medium text-ps-text sm:text-[0.8125rem]",
      )}
    />
  );
}
