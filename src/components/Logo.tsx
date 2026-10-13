import { useIsDark } from "@/utils/theme";
import { SidebarItem } from "./tailwind/sidebar";

type LogoVariant = "logo" | "text" | "brand" | "sidebar";

interface LogoProps {
  variant?: LogoVariant;
  alt?: string;
  className?: string;
  wrapperClassName?: string;
  height?: string; // e.g. "h-8"
  gap?: string; // e.g. "gap-2"
}

export function Logo({
  variant = "logo",
  alt = "PlayStash",
  className = "",
  wrapperClassName = "",
  height = "h-8",
  gap = "gap-2",
}: LogoProps) {
  const isDark = useIsDark();

  const srcText = `/logo-text-${isDark ? "dark" : "light"}.svg`;

  if (variant === "brand") {
    return (
      <div className={`flex min-w-0 items-center ${gap} ${wrapperClassName}`}>
        <img
          src="/playstash-logo.png"
          alt=""
          className={`ps-logo-image aspect-square w-auto shrink-0 object-contain ${height} ${className}`}
        />
        <img
          key={srcText}
          src={srcText}
          alt={alt}
          className={`ps-logo-image min-w-0 flex-1 object-contain object-left ${height} ${className}`}
        />
      </div>
    );
  }

  if (variant === "sidebar") {
    return (
      <SidebarItem href="/">
        <img
          src="/playstash-logo.png"
          alt={alt}
          className={`ps-logo-image ${height} ${className}`}
        />
        <img
          key={srcText}
          src={srcText}
          alt={`${alt} text`}
          className={`ps-logo-image ${height} ${className}`}
        />
      </SidebarItem>
    );
  }

  let src = "";
  switch (variant) {
    case "text":
      src = srcText;
      break;
    default:
      src = "/playstash-logo.png";
  }

  return (
    <img
      key={src}
      src={src}
      alt={alt}
      className={`ps-logo-image ${height} ${className}`}
    />
  );
}
