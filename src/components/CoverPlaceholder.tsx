import clsx from "clsx";

export const coverPalettes = [
  {
    bg: "var(--color-ps-panel-strong)",
    border: "var(--color-ps-line)",
  },
  {
    bg: "color-mix(in srgb, var(--color-ps-accent) 8%, var(--color-ps-panel))",
    border: "var(--color-ps-line)",
  },
  {
    bg: "var(--color-ps-panel-soft)",
    border: "var(--color-ps-line)",
  },
  {
    bg: "color-mix(in srgb, var(--color-ps-accent) 13%, var(--color-ps-shell))",
    border: "var(--color-ps-line)",
  },
] as const;

export function hashedPalette(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return coverPalettes[Math.abs(hash) % coverPalettes.length];
}

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
