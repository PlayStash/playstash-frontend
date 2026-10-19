import clsx from "clsx";
import { hashedPalette } from "./coverPalette";

/** A quiet, theme-aware fallback when the server has no game artwork. */
export default function CoverPlaceholder({
  title,
  size = "normal",
  className,
}: {
  title: string;
  size?: "small" | "normal" | "large";
  className?: string;
}) {
  const palette = hashedPalette(title);
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const sizeClasses = {
    small: {
      title: "text-[0.55rem]",
      initials: "text-lg mb-0.5",
      padding: "p-1.5",
    },
    normal: {
      title: "text-[0.65rem]",
      initials: "text-xl mb-1",
      padding: "p-2",
    },
    large: {
      title: "text-sm",
      initials: "text-3xl mb-2",
      padding: "p-3",
    },
  };

  return (
    <div
      className={clsx(
        "flex h-full w-full flex-col items-center justify-center rounded-[inherit] border text-center",
        sizeClasses[size].padding,
        className,
      )}
      style={{ background: palette.bg, borderColor: palette.border }}
    >
      <div
        className={clsx(
          "font-semibold tracking-[-0.025em] text-ps-text",
          sizeClasses[size].initials,
        )}
      >
        {initials}
      </div>
      <div
        className={clsx(
          "line-clamp-2 max-w-[90%] font-medium text-ps-muted",
          sizeClasses[size].title,
        )}
      >
        {title}
      </div>
    </div>
  );
}
