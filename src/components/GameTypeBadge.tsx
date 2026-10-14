import {
  ArchiveBoxIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
} from "@heroicons/react/24/outline";
import { useTranslation, type TranslationKey } from "@/i18n";

const labels: Record<string, TranslationKey> = {
  WINDOWS_SETUP: "library.installed.type.windowsSetup",
  WINDOWS_PORTABLE: "library.installed.type.windowsPortable",
  LINUX_PORTABLE: "library.installed.type.linuxPortable",
};

export function GameTypeBadge({ type }: { type?: string }) {
  const { t } = useTranslation();
  const labelKey = labels[String(type).toUpperCase()];
  if (!labelKey) return null;
  const label = t(labelKey);
  const setup = String(type).toUpperCase() === "WINDOWS_SETUP";
  const linux = String(type).toUpperCase() === "LINUX_PORTABLE";
  const InstallIcon = setup ? Cog6ToothIcon : ArchiveBoxIcon;
  return (
    <span
      title={label}
      aria-label={label}
      className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/80 p-1.5 text-white"
    >
      {linux ? (
        <ComputerDesktopIcon className="size-4" aria-hidden="true" />
      ) : (
        <svg
          viewBox="0 0 20 20"
          className="size-4 fill-current"
          aria-hidden="true"
        >
          <path d="M2 3h7v6H2zm9 0h7v6h-7zM2 11h7v6H2zm9 0h7v6h-7z" />
        </svg>
      )}
      <InstallIcon className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
