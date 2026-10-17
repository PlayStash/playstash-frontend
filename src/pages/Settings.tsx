import { LanguagePicker } from "@/components/LanguagePicker";
import {
  translate,
  useTranslation,
  type Locale,
  type TranslationKey,
} from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import { PostInstallSettings } from "@/components/PostInstallSettings";
import { AccountPrivacySettings } from "@/components/AccountPrivacySettings";
import clsx from "clsx";
import { useSearchParams } from "react-router";
import { Heading } from "@tw/heading";
import { Input, InputGroup } from "@tw/input";
import {
  useDownloads,
  type SimulatedDownloadKind,
} from "@/context/DownloadContext";
import { useIgnoreList } from "@/context/IgnoreListContext";
import { GamesLaunchSettings } from "@/components/settings/GamesLaunchSettings";
import { useOnlineStatus } from "@/context/OfflineContext";
import { useAppUpdater } from "@/context/AppUpdaterContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { Switch } from "@tw/switch";
import { Text } from "@/components/tailwind/text";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  isTauriApp,
  isTauriDesktop,
  isDebugTauriOverride,
  setDebugTauriOverride,
} from "@/utils/tauri";
import {
  filterSearchableSettings,
  isAvailableOnPlatform,
  type PlatformFlags,
  searchResultCategories as searchResultCategoriesFn,
  searchSettings,
} from "@/utils/settingsSearch";
import { Button } from "@/components/tailwind/button";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import ThemeSelect from "@/components/ThemeSelect";
import ZoomControl from "@/components/ZoomControl";
import StreamerModeToggle from "@/components/StreamerModeToggle";
import BackButton from "@/components/BackButton";
import {
  SettingsGroup,
  SettingsLabel,
  SettingsRow,
  SettingsSectionHeader,
} from "@/components/settings/SettingsPrimitives";
import { SETTINGS_SEARCH_INDEX } from "@/settings/searchIndex";
import CommunitySettings from "@/components/settings/CommunitySettings";
import IntegrationsSettings from "@/components/settings/IntegrationsSettings";
import type {
  SearchableSetting,
  SettingsCategory,
  SettingsSection,
} from "@/settings/types";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { isAnalyticsEnabled, setAnalyticsEnabled } from "@/utils/analytics";
import { hasOpenOverlay, isEditableTarget } from "@/utils/overlay";
import { EXTRA_SECTIONS } from "@/components/settings/extraSections";
import {
  formatCpuMemoryLabel,
  formatDisplayLabel,
  formatMonitorsLabel,
  getRenderingDiagnostics,
  type RenderingDiagnostics,
} from "@/utils/rendering";
import { playSound } from "@/utils/audio";
import { VolumeControl } from "@/components/VolumeControl";
import {
  type RootPathEntry,
  getRootPaths,
  addRootPath,
  removeRootPath,
  updateRootPath,
  updateRootPathLabel,
} from "@/utils/rootPaths";
import { openLaunchLogWindow } from "@/utils/launchLog";
import {
  FolderArrowDownIcon,
  ComputerDesktopIcon,
  ShieldCheckIcon,
  SwatchIcon,
  ArrowPathIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  WrenchIcon,
  EyeSlashIcon,
  InformationCircleIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  PlusIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  FolderIcon,
  FolderOpenIcon,
  SpeakerWaveIcon,
  UserCircleIcon,
  PaintBrushIcon,
  UserGroupIcon,
  PuzzlePieceIcon,
  CircleStackIcon,
} from "@heroicons/react/24/outline";
import { DownloadExtrasSettings } from "@/components/settings/DownloadExtrasSettings";
import AccountSettings from "@/components/settings/AccountSettings";
import { CloudSaveSettings } from "@/components/settings/CloudSaveSettings";
import "@/styles/workspaces.css";

const AUTOSTART_MINIMIZED_KEY = "tauri_start_minimized";
const MINIMIZE_ON_GAME_LAUNCH_KEY = "tauri_minimize_on_game_launch";
const AUTO_EXTRACT_KEY = "tauri_auto_extract";
const AUTO_INSTALL_KEY = "tauri_auto_install";
const AUTO_DELETE_SOURCE_KEY = "tauri_auto_delete_source";
const DEV_TOOLS_KEY = "playstash_dev_tools_unlocked";

const SENSITIVE_KEY_PATTERN = /token|password|secret|auth|refresh|credential/i;

const SIMULATED_DOWNLOAD_KINDS: {
  kind: SimulatedDownloadKind;
  label: TranslationKey;
}[] = [
  {
    kind: "downloading",
    label: "settings.developer.simulateDownload.downloading",
  },
  { kind: "paused", label: "settings.developer.simulateDownload.paused" },
  { kind: "error", label: "settings.developer.simulateDownload.error" },
  { kind: "aborted", label: "settings.developer.simulateDownload.aborted" },
  {
    kind: "completed",
    label: "settings.developer.simulateDownload.completed",
  },
  {
    kind: "installing",
    label: "settings.developer.simulateDownload.installing",
  },
];

interface ThirdPartyLicense {
  name: string;
  version: string;
  licenses: string;
  repository: string | null;
  url: string | null;
  licenseText: string;
}

interface LicensesData {
  generatedAt: string;
  packages: ThirdPartyLicense[];
}

const CATEGORY_META: Record<
  SettingsCategory,
  {
    label: TranslationKey;
    description: TranslationKey;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  account: {
    label: "settings.category.account.label",
    description: "settings.category.account.description",
    icon: UserCircleIcon,
  },
  themes: {
    label: "settings.category.themes.label",
    description: "settings.category.themes.description",
    icon: PaintBrushIcon,
  },
  community: {
    label: "settings.category.community.label",
    description: "settings.category.community.description",
    icon: UserGroupIcon,
  },
  integrations: {
    label: "settings.category.integrations.label",
    description: "settings.category.integrations.description",
    icon: PuzzlePieceIcon,
  },
  storage: {
    label: "settings.category.storage.label",
    description: "settings.category.storage.description",
    icon: CircleStackIcon,
  },
  downloads: {
    label: "settings.category.downloads.label",
    description: "settings.category.downloads.description",
    icon: FolderArrowDownIcon,
  },
  appearance: {
    label: "settings.category.appearance.label",
    description: "settings.category.appearance.description",
    icon: SwatchIcon,
  },
  sound: {
    label: "settings.category.sound.label",
    description: "settings.category.sound.description",
    icon: SpeakerWaveIcon,
  },
  startup: {
    label: "settings.category.startup.label",
    description: "settings.category.startup.description",
    icon: ComputerDesktopIcon,
  },
  games: {
    label: "settings.category.games.label",
    description: "settings.category.games.description",
    icon: GamepadIcon,
  },
  privacy: {
    label: "settings.category.privacy.label",
    description: "settings.category.privacy.description",
    icon: ShieldCheckIcon,
  },
  about: {
    label: "settings.category.about.label",
    description: "settings.category.about.description",
    icon: InformationCircleIcon,
  },
  developer: {
    label: "settings.category.developer.label",
    description: "settings.category.developer.description",
    icon: WrenchIcon,
  },
};

/**
 * Categories with content built into this page. Every other category is only
 * listed while it has at least one visible registered section.
 */
const BUILT_IN_CATEGORIES = new Set<SettingsCategory>([
  "appearance",
  "sound",
  "downloads",
  "games",
  "startup",
  "privacy",
  "about",
  "developer",
]);

/** Settings list order, most to least used. */
const CATEGORY_ORDER: SettingsCategory[] = [
  "account",
  "appearance",
  "themes",
  "sound",
  "downloads",
  "games",
  "startup",
  "community",
  "integrations",
  "storage",
  "privacy",
  "about",
  "developer",
];

/**
 * Sections that feature packages add to a category. They render after the
 * category's built-in content, in this order. Components live in
 * `src/components/settings/`.
 */
const CATEGORY_SECTIONS: Record<SettingsCategory, SettingsSection[]> = {
  account: [{ id: "account", component: AccountSettings }],
  appearance: [],
  themes: [...EXTRA_SECTIONS.themes],
  sound: [],
  downloads: [
    {
      id: "download-extras",
      component: DownloadExtrasSettings,
      desktopOnly: true,
    },
  ],
  games: [
    {
      id: "games-launch",
      component: GamesLaunchSettings,
      desktopOnly: true,
    },
  ],
  startup: [...EXTRA_SECTIONS.startup],
  community: [
    { id: "community", component: CommunitySettings, desktopOnly: true },
  ],
  integrations: [
    {
      id: "integrations",
      component: IntegrationsSettings,
      desktopOnly: true,
    },
    { id: "cloud-saves", component: CloudSaveSettings, desktopOnly: true },
  ],
  storage: [...EXTRA_SECTIONS.storage],
  privacy: [],
  about: [],
  developer: [...EXTRA_SECTIONS.developer],
};

function visibleCategorySections(
  category: SettingsCategory,
  flags: PlatformFlags,
): SettingsSection[] {
  return CATEGORY_SECTIONS[category].filter((section) =>
    isAvailableOnPlatform(section, flags),
  );
}

/**
 * Gamepad icon in the Heroicons outline style (24x24, 1.5 stroke). Heroicons
 * has no native controller glyph, so this keeps the "Games" category on-theme.
 */
function GamepadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6.5 7h11a4.5 4.5 0 0 1 4.3 5.7l-.9 3A3.5 3.5 0 0 1 13.5 17l-.7-1h-1.6l-.7 1a3.5 3.5 0 0 1-7.4-1.3l-.9-3A4.5 4.5 0 0 1 6.5 7Z" />
      <path d="M8.5 10.5v3" />
      <path d="M7 12h3" />
      <circle cx="15.5" cy="11" r="1" />
      <circle cx="17.5" cy="13" r="1" />
    </svg>
  );
}

/** Row that opens an external URL in the default browser (Tauri) or a new tab (web). */
function AboutLinkRow({
  title,
  value,
  href,
}: {
  title: string;
  value: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-h-12 w-full cursor-pointer items-center justify-between gap-x-4 px-4 py-2.5 text-left transition-colors hover:bg-ps-panel-soft"
    >
      <SettingsLabel title={title} />
      <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-medium text-ps-accent">
        <span className="truncate">{value}</span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-ps-muted" />
      </span>
    </a>
  );
}

interface SystemInfo {
  platform: string;
  os: string;
  architecture: string;
  language: string;
  screen: string;
  userAgent: string;
}

function collectSystemInfo(isTauri: boolean): SystemInfo {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const uaData = (nav as any)?.userAgentData as
    { platform?: string; architecture?: string; mobile?: boolean } | undefined;

  const os = (uaData?.platform || nav?.platform || "Unknown").trim();
  const architecture = (uaData?.architecture || "").trim();
  const screen =
    typeof window !== "undefined"
      ? `${window.screen.width}x${window.screen.height}`
      : "Unknown";

  return {
    platform: isTauri ? "desktop" : "web",
    os,
    architecture,
    language: nav?.language || "Unknown",
    screen,
    userAgent: nav?.userAgent || "Unknown",
  };
}

/** A search entry with its title and description translated for display. */
type LocalizedSearchableSetting = Omit<
  SearchableSetting,
  "title" | "description"
> & { title: string; description?: string };

/**
 * Translate a search entry for the current locale. The English title and
 * description stay searchable as hidden aliases, so English queries keep
 * working in every language.
 */
function localizeSearchEntry(
  entry: SearchableSetting,
  locale: Locale,
): LocalizedSearchableSetting {
  const title = translate(entry.title, locale);
  const description = entry.description
    ? translate(entry.description, locale)
    : undefined;
  const englishAliases =
    locale === "en"
      ? []
      : [
          translate(entry.title, "en"),
          entry.description ? translate(entry.description, "en") : "",
        ]
          .filter(Boolean)
          .map((text) => text.toLowerCase());
  return {
    ...entry,
    title,
    description,
    keywords: [...entry.keywords, ...englishAliases],
  };
}

export default function Settings() {
  const { t, locale } = useTranslation();
  const {
    speedLimitKB,
    setSpeedLimitKB,
    formatSpeed,
    formatLimit,
    simulateDownload,
  } = useDownloads() as any;
  const kbValue = speedLimitKB;
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean>(() => {
    return isAnalyticsEnabled();
  });
  const [rootPaths, setRootPaths] = useState<RootPathEntry[]>(() =>
    getRootPaths(),
  );
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(
    null,
  );
  const [startMinimized, setStartMinimized] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTOSTART_MINIMIZED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [minimizeOnGameLaunch, setMinimizeOnGameLaunch] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem(MINIMIZE_ON_GAME_LAUNCH_KEY) === "1";
      } catch {
        return false;
      }
    },
  );
  const [alwaysShowLaunchLogs, setAlwaysShowLaunchLogs] =
    useState<boolean>(false);
  const [verboseDiagnostics, setVerboseDiagnostics] = useState<boolean>(false);
  const [autoExtract, setAutoExtract] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_EXTRACT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [autoInstall, setAutoInstall] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_INSTALL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [autoDeleteSource, setAutoDeleteSource] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_DELETE_SOURCE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const isTauri = isTauriApp();
  const isDesktopApp = isTauriDesktop();
  const isLinux =
    isTauri &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Linux");
  const systemInfo = collectSystemInfo(isTauri);
  const { ignoreList, setIgnoreList } = useIgnoreList();
  const [winePrefixBase, setWinePrefixBase] = useState<string | null>(null);
  const { forceOffline, setForceOffline } = useOnlineStatus();
  const { showAlert } = useAlertDialog();
  const {
    updateChannel,
    updaterEnabled,
    updaterReady,
    isChecking: isCheckingUpdates,
    isInstalling: isInstallingUpdate,
    availableVersion,
    errorText: updaterErrorText,
    statusText: updaterStatusText,
    setUpdateChannel,
    checkForUpdates,
  } = useAppUpdater();
  const [newIgnore, setNewIgnore] = useState("");
  const [ignoreSearch, setIgnoreSearch] = useState("");
  // Deep-link support: `/settings?section=downloads` opens a specific section.
  const [searchParams] = useSearchParams();
  // The account opens first; `null` opens settings search and the area index.
  const [activeCategory, setActiveCategory] = useState<SettingsCategory | null>(
    "account",
  );
  useEffect(() => {
    const raw = searchParams.get("section");
    // Map legacy section names to the reorganized categories so old
    // deep links (e.g. `?section=desktop`) keep working.
    const legacy: Record<string, SettingsCategory> = {
      desktop: "startup",
      general: "startup",
      library: "downloads",
      ignore: "games",
    };
    const section = (raw && legacy[raw]) || (raw as SettingsCategory | null);
    const available =
      !!section &&
      section in CATEGORY_META &&
      (BUILT_IN_CATEGORIES.has(section) ||
        visibleCategorySections(section, { isTauri, isDesktopApp, isLinux })
          .length > 0);
    setActiveCategory(available ? section : "account");
  }, [searchParams, isTauri, isDesktopApp, isLinux]);
  // Settings search: free-text query, the matched settings, and the target we
  // scroll/highlight to when a result is chosen.
  const [searchQuery, setSearchQuery] = useState("");
  const [scrollToSetting, setScrollToSetting] = useState<string | null>(null);
  const [highlightedSetting, setHighlightedSetting] = useState<string | null>(
    null,
  );

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const platformFlags = { isTauri, isDesktopApp, isLinux };
  // On the web build, desktop-only settings don't exist, so never suggest them.
  const searchableSettings = filterSearchableSettings(
    SETTINGS_SEARCH_INDEX,
    platformFlags,
  );
  const localizedSearchIndex = useMemo(
    () =>
      SETTINGS_SEARCH_INDEX.map((entry) => localizeSearchEntry(entry, locale)),
    [locale],
  );
  const searchResults = searchSettings(
    localizedSearchIndex,
    searchQuery,
    platformFlags,
  );

  // Categories that contain at least one matching setting, shown while
  // searching so the user can still jump straight to a whole area.
  const searchResultCategories = searchResultCategoriesFn(searchResults);

  const isSearching = trimmedQuery.length > 0;

  const openSearchResult = (result: LocalizedSearchableSetting) => {
    setActiveCategory(result.category);
    setScrollToSetting(result.id);
    setHighlightedSetting(result.id);
    setSearchQuery("");
  };

  /** Subtle flash used when a search result scrolls a setting into view. */
  const rowHighlight = (searchableId: string) =>
    highlightedSetting === searchableId ? "bg-ps-accent/10" : "";

  // When a search result opens a category, wait for it to render, then scroll
  // the target setting into view and flash a highlight ring around it.
  useEffect(() => {
    if (!activeCategory || !scrollToSetting) return;
    const id = `setting-${scrollToSetting}`;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      window.setTimeout(() => setHighlightedSetting(null), 1600);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeCategory, scrollToSetting]);

  // ESC exits a drilled-in settings category back to the all-settings view.
  // Open Headless UI overlays and editable inputs handle their own Escape
  // first, so those take precedence over leaving the category.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (hasOpenOverlay() || isEditableTarget(event)) return;
      setActiveCategory((current) => (current !== null ? null : current));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const [licensesOpen, setLicensesOpen] = useState(false);
  const [licenseData, setLicenseData] = useState<LicensesData | null>(null);
  const [expandedLicense, setExpandedLicense] = useState<string | null>(null);
  const [licenseExpanded, setLicenseExpanded] = useState(false);
  const [playStashLicense, setPlayStashLicense] = useState<string | null>(null);
  const [devToolsUnlocked, setDevToolsUnlocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DEV_TOOLS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const versionClickCount = useRef(0);
  const versionClickTimer = useRef<number | null>(null);
  const [editingRootId, setEditingRootId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  // ── Rendering / GPU / display diagnostics + WebKitGTK settings ────────
  const [renderingDiagnostics, setRenderingDiagnostics] =
    useState<RenderingDiagnostics | null>(null);
  const [webkitSmoothScroll, setWebkitSmoothScroll] = useState(true);
  const [webkitHwAccel, setWebkitHwAccel] = useState("OnDemand");
  const [webkitSupported, setWebkitSupported] = useState(false);

  // Load rendering diagnostics when the About category is open (it shows the
  // system diagnostics), and also when Appearance is open (it shows the
  // WebKitGTK rendering toggles).
  const renderingCategoryActive =
    activeCategory === "about" || activeCategory === "appearance";
  useEffect(() => {
    if (!renderingCategoryActive) return;
    let cancelled = false;
    (async () => {
      const diag = await getRenderingDiagnostics();
      if (cancelled) return;
      setRenderingDiagnostics(diag);
      if (diag.webkit) {
        setWebkitSupported(true);
        setWebkitSmoothScroll(diag.webkit.smooth_scroll);
        setWebkitHwAccel(diag.webkit.hardware_acceleration_policy);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [renderingCategoryActive]);

  // Initialize autostart state from the Tauri plugin
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        const { isEnabled } = await import("@tauri-apps/plugin-autostart");
        const enabled = await isEnabled();
        if (!cancelled) setAutostartEnabled(enabled);
      } catch (e) {
        console.error("Failed to check autostart status:", e);
        if (!cancelled) setAutostartEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  // Load the Wine/Proton prefix base directory from the Rust backend config.
  useEffect(() => {
    if (!isTauri || !isLinux) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const value = await invoke<string | null>("get_default_wine_prefix");
        if (!cancelled) setWinePrefixBase(value ?? null);
      } catch (e) {
        console.error("Failed to load default Wine prefix:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  // Sync startMinimized to Rust backend config file
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_start_minimized", { minimized: startMinimized });
      } catch (e) {
        console.error("Failed to sync start minimized preference:", e);
      }
    })();
  }, [startMinimized, isTauri]);

  // Persist startMinimized to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTOSTART_MINIMIZED_KEY, startMinimized ? "1" : "0");
    } catch {
      console.warn("Failed to persist start minimized preference");
    }
  }, [startMinimized]);

  // Sync minimizeOnGameLaunch to the Rust backend config file
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_minimize_on_game_launch", {
          minimizeOnLaunch: minimizeOnGameLaunch,
        });
      } catch (e) {
        console.error("Failed to sync minimize on game launch preference:", e);
      }
    })();
  }, [minimizeOnGameLaunch, isTauri]);

  // Persist minimizeOnGameLaunch to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        MINIMIZE_ON_GAME_LAUNCH_KEY,
        minimizeOnGameLaunch ? "1" : "0",
      );
    } catch {
      console.warn("Failed to persist minimize on game launch preference");
    }
  }, [minimizeOnGameLaunch]);

  // Load and persist the "always show launch logs" setting (desktop only).
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        setAlwaysShowLaunchLogs(
          await invoke<boolean>("get_always_show_launch_logs"),
        );
      } catch (e) {
        console.error("Failed to load launch log preference:", e);
      }
    })();
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_always_show_launch_logs", {
          enabled: alwaysShowLaunchLogs,
        });
      } catch (e) {
        console.error("Failed to sync launch log preference:", e);
      }
    })();
  }, [alwaysShowLaunchLogs, isTauri]);

  // Load and persist the verbose diagnostics logging setting (desktop only).
  // The stored value must be read before the sync effect may write, otherwise
  // the initial `false` state would overwrite it.
  const diagnosticsLoadedRef = useRef(false);
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const stored = await invoke<boolean>("get_diagnostics_verbose");
        if (!cancelled) setVerboseDiagnostics(stored);
      } catch (e) {
        console.error("Failed to load diagnostics logging preference:", e);
      } finally {
        diagnosticsLoadedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri || !diagnosticsLoadedRef.current) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_diagnostics_verbose", {
          enabled: verboseDiagnostics,
        });
      } catch (e) {
        console.error("Failed to sync diagnostics logging preference:", e);
      }
    })();
  }, [verboseDiagnostics, isTauri]);

  // Persist auto-flow settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_EXTRACT_KEY, autoExtract ? "1" : "0");
    } catch {
      console.warn("Failed to persist auto-extract preference");
    }
  }, [autoExtract]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_INSTALL_KEY, autoInstall ? "1" : "0");
    } catch {
      console.warn("Failed to persist auto-install preference");
    }
  }, [autoInstall]);

  useEffect(() => {
    try {
      localStorage.setItem(
        AUTO_DELETE_SOURCE_KEY,
        autoDeleteSource ? "1" : "0",
      );
    } catch {
      console.warn("Failed to persist auto-delete preference");
    }
  }, [autoDeleteSource]);

  const handleSpeedChange = (raw: number) => {
    if (Number.isNaN(raw) || raw <= 0) {
      setSpeedLimitKB(0);
    } else {
      setSpeedLimitKB(raw);
    }
  };

  const handleAddRootPath = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: translate("settings.downloads.locations.dialogTitle"),
      });
      if (selected && typeof selected === "string") {
        const updated = addRootPath(selected);
        setRootPaths(updated);

        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { join } = await import("@tauri-apps/api/path");
          const playStashRoot = await join(selected, "PlayStash");
          await invoke("fs_create_dir_all", { path: playStashRoot });
        } catch {
          // Folder creation is best-effort; settings save succeeded
        }
      }
    } catch (error) {
      console.error("Error selecting download folder:", error);
    }
  };

  const handleBrowseRootPath = async (id: string) => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: translate("settings.downloads.locations.dialogTitle"),
      });
      if (selected && typeof selected === "string") {
        const updated = updateRootPath(id, selected);
        setRootPaths(updated);

        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const { join } = await import("@tauri-apps/api/path");
          const playStashRoot = await join(selected, "PlayStash");
          await invoke("fs_create_dir_all", { path: playStashRoot });
        } catch {
          // Folder creation is best-effort
        }
      }
    } catch (error) {
      console.error("Error re-selecting download folder:", error);
    }
  };

  const handleRemoveRootPath = (id: string) => {
    const updated = removeRootPath(id);
    setRootPaths(updated);
  };

  const handleOpenRootPath = async (root: RootPathEntry) => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_file_explorer", { path: root.path });
    } catch (error) {
      console.error("Failed to open download folder:", error);
    }
  };

  const handleLabelChange = (id: string, label: string) => {
    const updated = updateRootPathLabel(id, label);
    setRootPaths(updated);
  };

  const startRenameRootPath = (root: RootPathEntry) => {
    setEditingRootId(root.id);
    setEditingLabel(root.label);
  };

  const commitRenameRootPath = (id: string) => {
    if (editingRootId !== id) return;
    handleLabelChange(id, editingLabel);
    setEditingRootId(null);
    setEditingLabel("");
  };

  const cancelRenameRootPath = () => {
    setEditingRootId(null);
    setEditingLabel("");
  };

  const handleAddIgnore = async () => {
    const name = newIgnore.trim();
    if (!name) return;
    const exists = ignoreList.some(
      (existing) => existing.toLowerCase() === name.toLowerCase(),
    );
    if (exists) {
      setNewIgnore("");
      return;
    }
    await setIgnoreList([...ignoreList, name]);
    setNewIgnore("");
  };

  const handleRemoveIgnore = async (name: string) => {
    await setIgnoreList(ignoreList.filter((existing) => existing !== name));
  };

  const persistWinePrefix = async (value: string | null) => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_default_wine_prefix", { prefix: value });
    } catch (e) {
      console.error("Failed to save default Wine prefix:", e);
    }
  };

  const handleSelectWinePrefix = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: translate("settings.games.winePrefix.dialogTitle"),
      });
      if (selected && typeof selected === "string") {
        setWinePrefixBase(selected);
        await persistWinePrefix(selected);
      }
    } catch (error) {
      console.error("Error selecting Wine prefix directory:", error);
    }
  };

  const handleClearWinePrefix = async () => {
    setWinePrefixBase(null);
    await persistWinePrefix(null);
  };

  const handleCopySettingsDump = async () => {
    const settings: Record<string, string | null> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        settings[key] = SENSITIVE_KEY_PATTERN.test(key)
          ? "[redacted]"
          : localStorage.getItem(key);
      }
    } catch {
      // localStorage unavailable
    }
    let logPath: string | null = null;
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        logPath = await invoke<string | null>("get_diagnostics_log_path");
      } catch {
        // Older builds may not expose the log path.
      }
    }
    const dump = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        platform: isTauri ? "desktop" : "web",
        version: __APP_VERSION__,
        system: systemInfo,
        rendering: await getRenderingDiagnostics().catch(() => null),
        appLogPath: logPath,
        settings,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(dump);
      await showAlert({
        title: t("settings.developer.settingsDump.copied"),
        tone: "success",
      });
    } catch {
      try {
        const blob = new Blob([dump], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `playstash-settings-${new Date()
          .toISOString()
          .slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        await showAlert({
          title: t("settings.developer.settingsDump.downloaded"),
          tone: "success",
        });
      } catch {
        await showAlert({
          title: t("settings.developer.settingsDump.failed"),
          tone: "danger",
        });
      }
    }
  };

  const handleOpenDevTools = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_devtools");
    } catch (e) {
      console.error("Failed to open DevTools", e);
      await showAlert({
        title: t("settings.developer.devtools.errorTitle"),
        description: t("settings.developer.devtools.errorDescription"),
        tone: "warning",
      });
    }
  };

  const handleSetWebkitSmoothScroll = async (value: boolean) => {
    if (!webkitSupported) return;
    const previous = webkitSmoothScroll;
    setWebkitSmoothScroll(value);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_webkit_smooth_scrolling", { enabled: value });
      setRenderingDiagnostics((d) =>
        d?.webkit ? { ...d, webkit: { ...d.webkit, smooth_scroll: value } } : d,
      );
    } catch (error) {
      console.error("Failed to set WebKit smooth scrolling", error);
      setWebkitSmoothScroll(previous);
    }
  };

  const handleSetWebkitHwAccel = async (value: string) => {
    if (!webkitSupported) return;
    const previous = webkitHwAccel;
    setWebkitHwAccel(value);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_webkit_hardware_acceleration_policy", {
        policy: value,
      });
      setRenderingDiagnostics((d) =>
        d?.webkit
          ? {
              ...d,
              webkit: { ...d.webkit, hardware_acceleration_policy: value },
            }
          : d,
      );
    } catch (error) {
      console.error("Failed to set WebKit hardware acceleration policy", error);
      setWebkitHwAccel(previous);
    }
  };

  const osLabel = (() => {
    const os = renderingDiagnostics?.os;
    if (!os) return t("common.loading");
    const base =
      os.long_os_version || `${os.name} ${os.os_version}`.trim() || os.name;
    return `${base} (${os.arch})`;
  })();
  const displayLabel = renderingDiagnostics
    ? formatDisplayLabel(renderingDiagnostics.display)
    : t("common.loading");
  const monitorsLabel = renderingDiagnostics
    ? formatMonitorsLabel(renderingDiagnostics.monitors ?? [])
    : t("common.loading");
  const gpuLabel = (() => {
    const gl = renderingDiagnostics?.webgl;
    if (gl == null) return t("common.loading");
    if (!gl.supported) return t("settings.about.unavailable");
    return `${gl.renderer ?? t("common.unknown")}${gl.webgl2 ? " · WebGL2" : " · WebGL1"}`;
  })();
  const webgpuLabel = (() => {
    const wgpu = renderingDiagnostics?.webgpu;
    if (wgpu == null) return t("common.loading");
    if (!wgpu.supported) return t("settings.about.unavailable");
    const parts = [
      wgpu.vendor,
      wgpu.architecture,
      wgpu.description,
      wgpu.device,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : t("settings.about.available");
  })();
  const cpuMemoryLabel = renderingDiagnostics
    ? formatCpuMemoryLabel(renderingDiagnostics.system)
    : t("common.loading");

  const ignoreQuery = ignoreSearch.trim().toLowerCase();
  const filteredIgnoreList = ignoreQuery
    ? ignoreList.filter((name) => name.toLowerCase().includes(ignoreQuery))
    : ignoreList;

  const openLicenses = async () => {
    if (!licenseData) {
      try {
        const mod = await import("@/generated/third-party-licenses.json");
        setLicenseData(mod.default as unknown as LicensesData);
      } catch (e) {
        console.error("Failed to load license data:", e);
        return;
      }
    }
    setLicensesOpen(true);
  };

  const togglePlayStashLicense = async () => {
    if (!playStashLicense) {
      try {
        const mod = await import("../../LICENSE?raw");
        setPlayStashLicense(mod.default as string);
      } catch (e) {
        console.error("Failed to load PlayStash license:", e);
        return;
      }
    }
    setLicenseExpanded((v) => !v);
  };

  // Hidden dev-tools unlock: 5 quick clicks on the version number (like
  // Android's build-number taps) reveal the Developer Tools section.
  const handleVersionClick = () => {
    versionClickCount.current += 1;
    if (versionClickTimer.current !== null) {
      window.clearTimeout(versionClickTimer.current);
    }
    versionClickTimer.current = window.setTimeout(() => {
      versionClickCount.current = 0;
    }, 1500);
    if (versionClickCount.current >= 5) {
      versionClickCount.current = 0;
      if (devToolsUnlocked) {
        setDevToolsUnlocked(false);
        try {
          localStorage.removeItem(DEV_TOOLS_KEY);
        } catch {
          // localStorage unavailable
        }
        void showAlert({
          title: t("settings.developer.locked"),
          tone: "warning",
        });
      } else {
        setDevToolsUnlocked(true);
        try {
          localStorage.setItem(DEV_TOOLS_KEY, "1");
        } catch {
          // localStorage unavailable
        }
        playSound("unlock");
        void showAlert({
          title: t("settings.developer.unlocked"),
          tone: "success",
        });
      }
    }
  };

  useEffect(() => {
    return () => {
      if (versionClickTimer.current !== null) {
        window.clearTimeout(versionClickTimer.current);
      }
    };
  }, []);

  // Flat category list (no group captions); desktop-only entries stay hidden for web users.
  // Category nav order; desktop-only General leads, Developer sits at the end.
  // Ordered most → least used by a typical user. Desktop-only categories are
  // interleaved; on web the desktop ones simply drop out.
  const isBuiltInCategoryVisible = (id: SettingsCategory) => {
    if (!BUILT_IN_CATEGORIES.has(id)) return false;
    if (id === "games" || id === "startup") return isTauri;
    if (id === "developer") return import.meta.env.DEV || devToolsUnlocked;
    return true;
  };
  // Developer Tools stay hidden until unlocked, even with package sections.
  const categorySections = (id: SettingsCategory) =>
    id === "developer" && !isBuiltInCategoryVisible(id)
      ? []
      : visibleCategorySections(id, platformFlags);
  // Categories without built-in content only appear once a package adds a
  // section that is visible on this platform.
  const navCategories = CATEGORY_ORDER.filter(
    (id) => isBuiltInCategoryVisible(id) || categorySections(id).length > 0,
  );
  const activeSections = activeCategory ? categorySections(activeCategory) : [];

  // During search, present categories in the same order as the nav list.
  const orderedSearchCategories = navCategories.filter((c) =>
    searchResultCategories.includes(c),
  );

  const renderCategoryRow = (id: SettingsCategory) => {
    const meta = CATEGORY_META[id];
    const Icon = meta.icon;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setActiveCategory(id)}
        className="settings-overview-link group"
      >
        <span>
          <Icon className="size-4" />
        </span>
        <SettingsLabel
          title={t(meta.label)}
          description={t(meta.description)}
        />
        <ChevronRightIcon className="size-4 shrink-0 text-ps-muted" />
      </button>
    );
  };

  const speedLimitControl = (
    <div className="flex shrink-0 items-center gap-2">
      <div className="relative w-28 [&_input]:pr-10">
        <Input
          type="number"
          min={0}
          value={kbValue}
          onChange={(e: any) =>
            handleSpeedChange(parseInt(e.target.value || "0", 10))
          }
          placeholder="0"
          aria-label={t("settings.downloads.speedLimit.ariaLabel")}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ps-muted">
          KB/s
        </span>
      </div>
      {speedLimitKB > 0 && (
        <span className="rounded-full bg-ps-panel-soft px-2 py-0.5 text-[11px] font-medium text-ps-muted ring-1 ring-ps-line">
          {formatLimit(speedLimitKB)}
        </span>
      )}
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="ps-workspace flex min-h-full flex-col gap-6">
        <div className="workspace-heading">
          <div className="space-y-2">
            <Heading>{t("nav.settings")}</Heading>
            <Text className="max-w-2xl">{t("settings.page.subtitle")}</Text>
          </div>
          {activeCategory !== null && (
            <BackButton onClick={() => setActiveCategory(null)} />
          )}
        </div>
        <div className="settings-workspace">
          <nav className="settings-navigation" aria-label={t("nav.settings")}>
            <button
              type="button"
              aria-current={activeCategory === null ? "page" : undefined}
              onClick={() => setActiveCategory(null)}
            >
              <MagnifyingGlassIcon />
              {t("settings.search.ariaLabel")}
            </button>
            {navCategories.map((id) => {
              const Icon = CATEGORY_META[id].icon;
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={activeCategory === id ? "page" : undefined}
                  onClick={() => {
                    setSearchQuery("");
                    setActiveCategory(id);
                  }}
                >
                  <Icon />
                  {t(CATEGORY_META[id].label)}
                </button>
              );
            })}
          </nav>
          <div className="settings-content">
            <AnimatePresence mode="wait" initial={false}>
              {activeCategory === null ? (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                  className="space-y-6"
                >
                  <SettingsGroup>
                    <SettingsRow>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <InputGroup>
                            <MagnifyingGlassIcon data-slot="icon" />
                            <Input
                              type="search"
                              value={searchQuery}
                              onChange={(e: any) =>
                                setSearchQuery(e.target.value)
                              }
                              onKeyDown={(e: any) => {
                                if (e.key === "Escape") {
                                  setSearchQuery("");
                                }
                              }}
                              placeholder={t("settings.search.placeholder")}
                              aria-label={t("settings.search.ariaLabel")}
                            />
                          </InputGroup>
                        </div>
                        {isSearching && (
                          <button
                            type="button"
                            onClick={() => setSearchQuery("")}
                            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-ps-muted transition-colors hover:bg-ps-panel-soft hover:text-ps-text"
                            aria-label={t("settings.search.clear")}
                          >
                            <XMarkIcon className="size-4" />
                          </button>
                        )}
                      </div>
                    </SettingsRow>
                  </SettingsGroup>

                  {isSearching ? (
                    <>
                      <SettingsGroup
                        caption={t("settings.search.results")}
                        description={
                          searchResults.length > 0
                            ? fillTemplate(
                                t(
                                  searchResults.length === 1
                                    ? "settings.search.resultCount.one"
                                    : "settings.search.resultCount.other",
                                ),
                                {
                                  count: searchResults.length,
                                  query: searchQuery.trim(),
                                },
                              )
                            : undefined
                        }
                      >
                        {searchResults.length === 0 ? (
                          <SettingsRow>
                            <div className="flex items-center gap-2 text-sm text-ps-muted">
                              <MagnifyingGlassIcon className="size-4 shrink-0" />
                              {fillTemplate(t("settings.search.empty"), {
                                query: searchQuery.trim(),
                              })}
                            </div>
                          </SettingsRow>
                        ) : (
                          searchResults.map((result, i) => (
                            <motion.button
                              key={result.id}
                              type="button"
                              onClick={() => openSearchResult(result)}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{
                                delay: 0.02 + i * 0.02,
                                duration: 0.16,
                                ease: [0.23, 1, 0.32, 1],
                              }}
                              className="group flex min-h-12 w-full cursor-pointer items-center justify-between gap-x-4 px-4 py-2.5 text-left transition-colors hover:bg-ps-panel-soft"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-ps-text">
                                  {result.title}
                                </p>
                                {result.description && (
                                  <p className="mt-0.5 text-xs leading-5 text-ps-muted">
                                    {result.description}
                                  </p>
                                )}
                                <p className="mt-0.5 text-[11px] font-medium text-ps-accent">
                                  {t(CATEGORY_META[result.category].label)}
                                </p>
                              </div>
                              <ChevronRightIcon className="size-4 shrink-0 text-ps-muted transition-transform group-hover:translate-x-0.5" />
                            </motion.button>
                          ))
                        )}
                      </SettingsGroup>

                      {searchResultCategories.length > 0 && (
                        <SettingsGroup caption={t("settings.search.areas")}>
                          {orderedSearchCategories.map(renderCategoryRow)}
                        </SettingsGroup>
                      )}
                    </>
                  ) : (
                    <SettingsGroup>
                      {navCategories.map(renderCategoryRow)}
                    </SettingsGroup>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key={activeCategory}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                  className="space-y-6"
                >
                  {activeCategory === "downloads" && (
                    <>
                      <SettingsSectionHeader
                        icon={FolderArrowDownIcon}
                        title={t("settings.category.downloads.label")}
                        description={t("settings.downloads.description")}
                      />

                      {isTauri && (
                        <SettingsGroup
                          id="setting-downloads-locations"
                          className={rowHighlight("downloads-locations")}
                          caption={t("settings.downloads.locations.caption")}
                          description={t(
                            "settings.downloads.locations.description",
                          )}
                        >
                          {rootPaths.length === 0 && (
                            <SettingsRow>
                              <div className="flex items-center gap-2 text-sm text-ps-muted">
                                <FolderIcon className="size-4 shrink-0" />
                                {t("settings.downloads.locations.empty")}
                              </div>
                            </SettingsRow>
                          )}

                          {rootPaths.map((root) => {
                            const displayLabel =
                              root.label.trim() ||
                              root.path.split(/[\\/]/).filter(Boolean).pop() ||
                              t("settings.downloads.locations.unnamed");
                            const isRenaming = editingRootId === root.id;
                            return (
                              <SettingsRow key={root.id}>
                                <div className="min-w-0 flex-1">
                                  {isRenaming ? (
                                    <Input
                                      type="text"
                                      value={editingLabel}
                                      autoFocus
                                      onChange={(e: any) =>
                                        setEditingLabel(e.target.value)
                                      }
                                      onBlur={() =>
                                        commitRenameRootPath(root.id)
                                      }
                                      onKeyDown={(e: any) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          commitRenameRootPath(root.id);
                                        } else if (e.key === "Escape") {
                                          cancelRenameRootPath();
                                        }
                                      }}
                                      placeholder={t(
                                        "settings.downloads.locations.labelPlaceholder",
                                      )}
                                      className="[&_input]:h-9 [&_input]:py-1 [&_input]:text-sm [&_input]:rounded-md"
                                      aria-label={t(
                                        "settings.downloads.locations.labelAria",
                                      )}
                                    />
                                  ) : (
                                    <div className="flex min-w-0 items-center gap-1.5">
                                      <span className="min-w-0 truncate text-sm font-medium text-ps-text">
                                        {displayLabel}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          startRenameRootPath(root)
                                        }
                                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ps-muted transition-colors hover:bg-ps-panel-soft hover:text-ps-text cursor-pointer"
                                        aria-label={fillTemplate(
                                          t(
                                            "settings.downloads.locations.rename",
                                          ),
                                          { name: displayLabel },
                                        )}
                                      >
                                        <PencilSquareIcon className="size-3.5" />
                                      </button>
                                    </div>
                                  )}
                                  <p
                                    className="mt-0.5 truncate text-xs text-ps-muted"
                                    title={root.path}
                                  >
                                    {root.path}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    type="button"
                                    color="zinc"
                                    className="text-xs"
                                    onClick={() =>
                                      void handleOpenRootPath(root)
                                    }
                                    title={t(
                                      "settings.downloads.locations.openTitle",
                                    )}
                                  >
                                    <FolderOpenIcon className="size-3.5" />
                                    {t("common.open")}
                                  </Button>
                                  <Button
                                    type="button"
                                    color="zinc"
                                    className="text-xs"
                                    onClick={() =>
                                      handleBrowseRootPath(root.id)
                                    }
                                  >
                                    <FolderArrowDownIcon className="size-3.5" />
                                    {t("settings.downloads.locations.choose")}
                                  </Button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRemoveRootPath(root.id)
                                    }
                                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ps-muted transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                                    aria-label={t(
                                      "settings.downloads.locations.remove",
                                    )}
                                  >
                                    <XMarkIcon className="size-4" />
                                  </button>
                                </div>
                              </SettingsRow>
                            );
                          })}

                          <button
                            type="button"
                            onClick={handleAddRootPath}
                            className="flex min-h-12 w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-ps-accent transition-colors hover:bg-ps-panel-soft cursor-pointer"
                          >
                            <PlusIcon className="size-4" />
                            {t("settings.downloads.locations.add")}
                          </button>
                        </SettingsGroup>
                      )}

                      <SettingsGroup
                        id="setting-downloads-speed-limit"
                        className={rowHighlight("downloads-speed-limit")}
                        caption={t("settings.downloads.speed.caption")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.downloads.speedLimit.title")}
                            description={t(
                              "settings.downloads.speedLimit.description",
                            )}
                          />
                          {speedLimitControl}
                        </SettingsRow>
                      </SettingsGroup>

                      {isTauri && (
                        <SettingsGroup
                          caption={t("settings.downloads.after.caption")}
                        >
                          <PostInstallSettings />
                          <SettingsRow
                            id="setting-downloads-auto-extract"
                            className={rowHighlight("downloads-auto-extract")}
                          >
                            <SettingsLabel
                              title={t("settings.downloads.autoExtract.title")}
                              description={t(
                                "settings.downloads.autoExtract.description",
                              )}
                            />
                            <Switch
                              name="autoExtract"
                              color="indigo"
                              aria-label={t(
                                "settings.downloads.autoExtract.ariaLabel",
                              )}
                              checked={autoExtract}
                              onChange={(v: boolean) => setAutoExtract(v)}
                            />
                          </SettingsRow>
                          <SettingsRow
                            id="setting-downloads-auto-install"
                            className={rowHighlight("downloads-auto-install")}
                          >
                            <SettingsLabel
                              title={t("settings.downloads.autoInstall.title")}
                              description={t(
                                "settings.downloads.autoInstall.description",
                              )}
                            />
                            <Switch
                              name="autoInstall"
                              color="indigo"
                              aria-label={t(
                                "settings.downloads.autoInstall.ariaLabel",
                              )}
                              checked={autoInstall}
                              onChange={(v: boolean) => setAutoInstall(v)}
                            />
                          </SettingsRow>
                          <SettingsRow
                            id="setting-downloads-auto-delete-source"
                            className={rowHighlight(
                              "downloads-auto-delete-source",
                            )}
                          >
                            <SettingsLabel
                              title={t(
                                "settings.downloads.autoDeleteSource.title",
                              )}
                              description={t(
                                "settings.downloads.autoDeleteSource.description",
                              )}
                            />
                            <Switch
                              name="autoDeleteSource"
                              color="indigo"
                              aria-label={t(
                                "settings.downloads.autoDeleteSource.ariaLabel",
                              )}
                              checked={autoDeleteSource}
                              onChange={(v: boolean) => setAutoDeleteSource(v)}
                            />
                          </SettingsRow>
                        </SettingsGroup>
                      )}
                    </>
                  )}

                  {activeCategory === "startup" && isTauri && (
                    <>
                      <SettingsSectionHeader
                        icon={ComputerDesktopIcon}
                        title={t("settings.category.startup.label")}
                        description={t("settings.startup.description")}
                      />
                      <SettingsGroup
                        id="setting-startup-autostart"
                        className={rowHighlight("startup-autostart")}
                        caption={t("settings.startup.onLogin.caption")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.startup.autostart.title")}
                            description={t(
                              "settings.startup.autostart.description",
                            )}
                          />
                          <Switch
                            name="autostart"
                            color="indigo"
                            aria-label={t(
                              "settings.startup.autostart.ariaLabel",
                            )}
                            checked={autostartEnabled ?? false}
                            disabled={autostartEnabled === null}
                            onChange={async (v: boolean) => {
                              setAutostartEnabled(v);
                              try {
                                const { enable, disable } =
                                  await import("@tauri-apps/plugin-autostart");
                                if (v) {
                                  await enable();
                                } else {
                                  await disable();
                                  // Force start-minimized off when autostart is disabled
                                  setStartMinimized(false);
                                }
                              } catch (e) {
                                console.error("Failed to update autostart:", e);
                                setAutostartEnabled(!v); // Revert on failure
                              }
                            }}
                          />
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-startup-start-minimized"
                        className={rowHighlight("startup-start-minimized")}
                        caption={t("settings.caption.window")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.startup.startMinimized.title")}
                            description={t(
                              "settings.startup.startMinimized.description",
                            )}
                          />
                          <Switch
                            name="startMinimized"
                            color="indigo"
                            aria-label={t(
                              "settings.startup.startMinimized.ariaLabel",
                            )}
                            checked={startMinimized}
                            disabled={!autostartEnabled}
                            onChange={(v: boolean) => setStartMinimized(v)}
                          />
                        </SettingsRow>
                      </SettingsGroup>
                    </>
                  )}

                  {activeCategory === "games" && isTauri && (
                    <>
                      <SettingsSectionHeader
                        icon={GamepadIcon}
                        title={t("settings.category.games.label")}
                        description={t("settings.games.description")}
                      />
                      <SettingsGroup
                        id="setting-games-minimize-on-launch"
                        className={rowHighlight("games-minimize-on-launch")}
                        caption={t("settings.games.whilePlaying.caption")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.games.minimizeOnLaunch.title")}
                            description={t(
                              "settings.games.minimizeOnLaunch.description",
                            )}
                          />
                          <Switch
                            name="minimizeOnGameLaunch"
                            color="indigo"
                            aria-label={t(
                              "settings.games.minimizeOnLaunch.title",
                            )}
                            checked={minimizeOnGameLaunch}
                            onChange={(v: boolean) =>
                              setMinimizeOnGameLaunch(v)
                            }
                          />
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-games-ignore-list"
                        className={rowHighlight("games-ignore-list")}
                        caption={t("settings.games.ignoreList.caption")}
                        description={t("settings.games.ignoreList.description")}
                      >
                        {ignoreList.length === 0 && (
                          <SettingsRow>
                            <div className="flex items-center gap-2 text-sm text-ps-muted">
                              <EyeSlashIcon className="size-4 shrink-0" />
                              {t("settings.games.ignoreList.empty")}
                            </div>
                          </SettingsRow>
                        )}
                        {ignoreList.length > 0 && (
                          <SettingsRow>
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <InputGroup>
                                  <MagnifyingGlassIcon data-slot="icon" />
                                  <Input
                                    type="search"
                                    value={ignoreSearch}
                                    onChange={(e: any) =>
                                      setIgnoreSearch(e.target.value)
                                    }
                                    placeholder={t(
                                      "settings.games.ignoreList.searchPlaceholder",
                                    )}
                                    aria-label={t(
                                      "settings.games.ignoreList.searchAria",
                                    )}
                                  />
                                </InputGroup>
                              </div>
                              <span className="shrink-0 whitespace-nowrap text-xs text-ps-muted">
                                {fillTemplate(
                                  t("settings.games.ignoreList.count"),
                                  {
                                    shown: filteredIgnoreList.length,
                                    total: ignoreList.length,
                                  },
                                )}
                              </span>
                            </div>
                          </SettingsRow>
                        )}
                        {filteredIgnoreList.length === 0 &&
                          ignoreList.length > 0 && (
                            <SettingsRow>
                              <div className="flex items-center gap-2 text-sm text-ps-muted">
                                <MagnifyingGlassIcon className="size-4 shrink-0" />
                                {fillTemplate(
                                  t("settings.games.ignoreList.noMatches"),
                                  {
                                    query: ignoreSearch.trim(),
                                  },
                                )}
                              </div>
                            </SettingsRow>
                          )}
                        {filteredIgnoreList.length > 0 && (
                          <div className="max-h-80 divide-y divide-ps-line overflow-y-auto">
                            {filteredIgnoreList.map((name) => (
                              <SettingsRow key={name}>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ps-text">
                                  {name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveIgnore(name)}
                                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ps-muted transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                                  aria-label={fillTemplate(
                                    t("settings.games.ignoreList.remove"),
                                    { name },
                                  )}
                                >
                                  <XMarkIcon className="size-4" />
                                </button>
                              </SettingsRow>
                            ))}
                          </div>
                        )}
                        <SettingsRow>
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <Input
                              type="text"
                              value={newIgnore}
                              onChange={(e: any) =>
                                setNewIgnore(e.target.value)
                              }
                              onKeyDown={(e: any) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddIgnore();
                                }
                              }}
                              placeholder={t(
                                "settings.games.ignoreList.placeholder",
                              )}
                              className="min-w-0 flex-1"
                              aria-label={t(
                                "settings.games.ignoreList.inputAria",
                              )}
                            />
                            <Button
                              type="button"
                              color="indigo"
                              className="shrink-0 px-3"
                              onClick={handleAddIgnore}
                            >
                              <PlusIcon className="size-4" />
                              {t("common.add")}
                            </Button>
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-games-launch-logs"
                        className={rowHighlight("games-launch-logs")}
                        caption={t("settings.games.launchLogs.title")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t(
                              "settings.games.alwaysShowLaunchLogs.title",
                            )}
                            description={t(
                              "settings.games.alwaysShowLaunchLogs.description",
                            )}
                          />
                          <Switch
                            name="alwaysShowLaunchLogs"
                            color="indigo"
                            aria-label={t(
                              "settings.games.alwaysShowLaunchLogs.title",
                            )}
                            checked={alwaysShowLaunchLogs}
                            onChange={(v: boolean) =>
                              setAlwaysShowLaunchLogs(v)
                            }
                          />
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.games.launchLogs.title")}
                            description={t(
                              "settings.games.launchLogs.description",
                            )}
                          />
                          <Button
                            type="button"
                            color="indigo"
                            className="shrink-0 px-3"
                            onClick={async () => {
                              try {
                                await openLaunchLogWindow();
                              } catch (e) {
                                console.error("Failed to open launch log", e);
                              }
                            }}
                          >
                            {t("common.open")}
                          </Button>
                        </SettingsRow>
                      </SettingsGroup>

                      {isLinux && (
                        <SettingsGroup
                          id="setting-games-wine-prefix"
                          className={rowHighlight("games-wine-prefix")}
                          caption="Wine / Proton"
                          description={t(
                            "settings.games.winePrefix.description",
                          )}
                        >
                          <SettingsRow>
                            <SettingsLabel
                              title={t("settings.games.winePrefix.title")}
                              description={t(
                                "settings.games.winePrefix.titleDescription",
                              )}
                            />
                            <Button
                              outline
                              onClick={() => void handleSelectWinePrefix()}
                            >
                              <FolderOpenIcon className="size-4" />
                              {t("settings.games.winePrefix.choose")}
                            </Button>
                          </SettingsRow>
                          {winePrefixBase && (
                            <SettingsRow>
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm text-ps-muted">
                                  {winePrefixBase}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleClearWinePrefix()}
                                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ps-muted transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                                  aria-label={t(
                                    "settings.games.winePrefix.clear",
                                  )}
                                >
                                  <XMarkIcon className="size-4" />
                                </button>
                              </div>
                            </SettingsRow>
                          )}
                        </SettingsGroup>
                      )}
                    </>
                  )}

                  {activeCategory === "privacy" && (
                    <>
                      <SettingsSectionHeader
                        icon={ShieldCheckIcon}
                        title={t("settings.category.privacy.label")}
                        description={t("settings.privacy.description")}
                      />
                      <SettingsGroup>
                        <AccountPrivacySettings />
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.privacy.analytics.title")}
                            description={t(
                              isTauri
                                ? "settings.privacy.analytics.descriptionDesktop"
                                : "settings.privacy.analytics.descriptionWeb",
                            )}
                          />
                          <Switch
                            name="analyticsConsent"
                            color="indigo"
                            aria-label={t(
                              "settings.privacy.analytics.ariaLabel",
                            )}
                            checked={analyticsConsent}
                            onChange={(v: boolean) => {
                              setAnalyticsEnabled(v);
                              setAnalyticsConsent(v);
                            }}
                          />
                        </SettingsRow>
                      </SettingsGroup>
                    </>
                  )}

                  {activeCategory === "appearance" && (
                    <>
                      <SettingsSectionHeader
                        icon={SwatchIcon}
                        title={t("appearance.title")}
                        description={t("appearance.description")}
                      />
                      <SettingsGroup
                        id="setting-appearance-language"
                        className={rowHighlight("appearance-language")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("language.title")}
                            description={t("language.description")}
                          />
                          <div className="w-44 shrink-0">
                            <LanguagePicker />
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-appearance-theme"
                        className={rowHighlight("appearance-theme")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("appearance.theme")}
                            description={t("appearance.themeDescription")}
                          />
                          <div className="w-40 shrink-0">
                            <ThemeSelect />
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-appearance-zoom"
                        className={rowHighlight("appearance-zoom")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("appearance.zoom")}
                            description={t("appearance.zoomDescription")}
                          />
                          <div className="w-44 shrink-0">
                            <ZoomControl />
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-appearance-streamer-mode"
                        className={rowHighlight("appearance-streamer-mode")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.appearance.streamerMode.title")}
                            description={t(
                              "settings.appearance.streamerMode.description",
                            )}
                          />
                          <div className="shrink-0">
                            <StreamerModeToggle />
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      {webkitSupported && renderingDiagnostics?.webkit && (
                        <SettingsGroup
                          id="setting-rendering-smooth-scroll"
                          className={clsx(
                            rowHighlight("rendering-smooth-scroll"),
                            rowHighlight("rendering-hw-accel"),
                          )}
                          caption={t("settings.appearance.rendering.caption")}
                        >
                          <SettingsRow>
                            <SettingsLabel
                              title={t(
                                "settings.appearance.smoothScroll.title",
                              )}
                              description={t(
                                "settings.appearance.smoothScroll.description",
                              )}
                            />
                            <Switch
                              name="webkitSmoothScroll"
                              color="indigo"
                              aria-label={t(
                                "settings.appearance.smoothScroll.ariaLabel",
                              )}
                              checked={webkitSmoothScroll}
                              onChange={(v: boolean) =>
                                void handleSetWebkitSmoothScroll(v)
                              }
                            />
                          </SettingsRow>
                          <SettingsRow id="setting-rendering-hw-accel">
                            <SettingsLabel
                              title={t("settings.appearance.hwAccel.title")}
                              description={t(
                                "settings.appearance.hwAccel.description",
                              )}
                            />
                            <div className="w-36 shrink-0">
                              <Listbox
                                name="webkitHwAccel"
                                value={webkitHwAccel}
                                onChange={(v) =>
                                  void handleSetWebkitHwAccel(String(v))
                                }
                              >
                                <ListboxOption value="Never">
                                  <ListboxLabel>
                                    {t("settings.appearance.hwAccel.never")}
                                  </ListboxLabel>
                                </ListboxOption>
                                <ListboxOption value="OnDemand">
                                  <ListboxLabel>
                                    {t("settings.appearance.hwAccel.onDemand")}
                                  </ListboxLabel>
                                </ListboxOption>
                                <ListboxOption value="Always">
                                  <ListboxLabel>
                                    {t("settings.appearance.hwAccel.always")}
                                  </ListboxLabel>
                                </ListboxOption>
                              </Listbox>
                            </div>
                          </SettingsRow>
                        </SettingsGroup>
                      )}
                    </>
                  )}

                  {activeCategory === "sound" && (
                    <>
                      <SettingsSectionHeader
                        icon={SpeakerWaveIcon}
                        title={t("settings.category.sound.label")}
                        description={t("settings.sound.description")}
                      />
                      <SettingsGroup
                        id="setting-sound-volume"
                        className={rowHighlight("sound-volume")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.sound.volume.title")}
                            description={t("settings.sound.volume.description")}
                          />
                          <div className="w-44 shrink-0">
                            <VolumeControl />
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-sound-test"
                        className={rowHighlight("sound-test")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.sound.test.title")}
                            description={t("settings.sound.test.description")}
                          />
                          <Button
                            color="zinc"
                            onClick={() => void playSound("pop")}
                            className="shrink-0"
                          >
                            <SpeakerWaveIcon
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                            {t("settings.sound.test.play")}
                          </Button>
                        </SettingsRow>
                      </SettingsGroup>
                    </>
                  )}

                  {activeCategory === "developer" &&
                    (import.meta.env.DEV || devToolsUnlocked) && (
                      <>
                        <SettingsSectionHeader
                          icon={ExclamationTriangleIcon}
                          title={t("settings.category.developer.label")}
                          description={t(
                            "settings.category.developer.description",
                          )}
                        />
                        <SettingsGroup
                          id="setting-developer-open-devtools"
                          className={rowHighlight("developer-open-devtools")}
                          caption={t("settings.caption.window")}
                        >
                          <SettingsRow>
                            <SettingsLabel
                              title={t("settings.developer.devtools.title")}
                              description={t(
                                "settings.developer.devtools.description",
                              )}
                            />
                            <Button
                              type="button"
                              color="indigo"
                              className="shrink-0"
                              onClick={() => void handleOpenDevTools()}
                            >
                              {t("settings.developer.devtools.button")}
                            </Button>
                          </SettingsRow>
                        </SettingsGroup>

                        {!isDesktopApp && (
                          <SettingsGroup
                            id="setting-developer-simulate-desktop"
                            className={rowHighlight(
                              "developer-simulate-desktop",
                            )}
                          >
                            <SettingsRow>
                              <SettingsLabel
                                title={t(
                                  "settings.developer.simulateDesktop.title",
                                )}
                                description={t(
                                  "settings.developer.simulateDesktop.description",
                                )}
                              />
                              <Switch
                                name="simulateDesktop"
                                color="indigo"
                                aria-label={t(
                                  "settings.developer.simulateDesktop.ariaLabel",
                                )}
                                checked={isDebugTauriOverride()}
                                onChange={(v: boolean) => {
                                  setDebugTauriOverride(v);
                                  window.location.reload();
                                }}
                              />
                            </SettingsRow>
                          </SettingsGroup>
                        )}

                        <SettingsGroup
                          id="setting-developer-simulate-outage"
                          className={rowHighlight("developer-simulate-outage")}
                          caption={t("settings.developer.network.caption")}
                        >
                          <SettingsRow>
                            <SettingsLabel
                              title={t(
                                "settings.developer.simulateOutage.title",
                              )}
                              description={t(
                                "settings.developer.simulateOutage.description",
                              )}
                            />
                            <Switch
                              name="simulateOutage"
                              color="indigo"
                              aria-label={t(
                                "settings.developer.simulateOutage.ariaLabel",
                              )}
                              checked={forceOffline}
                              onChange={(v: boolean) => setForceOffline(v)}
                            />
                          </SettingsRow>
                        </SettingsGroup>

                        <SettingsGroup
                          id="setting-developer-toasts"
                          className={rowHighlight("developer-toasts")}
                          caption={t("settings.developer.toasts.caption")}
                        >
                          <SettingsRow>
                            <SettingsLabel
                              title={t("settings.developer.toasts.title")}
                              description={t(
                                "settings.developer.toasts.description",
                              )}
                            />
                          </SettingsRow>
                          <SettingsRow>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                color="zinc"
                                onClick={() =>
                                  void showAlert({
                                    title: t(
                                      "settings.developer.toasts.infoToast",
                                    ),
                                    tone: "info",
                                  })
                                }
                              >
                                {t("settings.developer.toasts.info")}
                              </Button>
                              <Button
                                color="zinc"
                                onClick={() =>
                                  void showAlert({
                                    title: t(
                                      "settings.developer.toasts.successToast",
                                    ),
                                    tone: "success",
                                  })
                                }
                              >
                                {t("settings.developer.toasts.success")}
                              </Button>
                              <Button
                                color="zinc"
                                onClick={() =>
                                  void showAlert({
                                    title: t(
                                      "settings.developer.toasts.warningToast",
                                    ),
                                    tone: "warning",
                                  })
                                }
                              >
                                {t("settings.developer.toasts.warning")}
                              </Button>
                              <Button
                                color="zinc"
                                onClick={() =>
                                  void showAlert({
                                    title: t(
                                      "settings.developer.toasts.dangerToast",
                                    ),
                                    tone: "danger",
                                  })
                                }
                              >
                                {t("settings.developer.toasts.danger")}
                              </Button>
                            </div>
                          </SettingsRow>
                        </SettingsGroup>

                        <SettingsGroup
                          id="setting-developer-simulate-download"
                          className={rowHighlight(
                            "developer-simulate-download",
                          )}
                          caption={t("settings.category.downloads.label")}
                        >
                          <SettingsRow>
                            <SettingsLabel
                              title={t(
                                "settings.developer.simulateDownload.title",
                              )}
                              description={t(
                                "settings.developer.simulateDownload.description",
                              )}
                            />
                          </SettingsRow>
                          <SettingsRow>
                            <div className="flex flex-wrap gap-2">
                              {SIMULATED_DOWNLOAD_KINDS.map(
                                ({ kind, label }) => (
                                  <Button
                                    key={kind}
                                    type="button"
                                    color="zinc"
                                    className="px-3"
                                    onClick={() => simulateDownload(kind)}
                                  >
                                    {t(label)}
                                  </Button>
                                ),
                              )}
                            </div>
                          </SettingsRow>
                        </SettingsGroup>

                        <SettingsGroup
                          id="setting-developer-build-info"
                          className={rowHighlight("developer-build-info")}
                          caption={t("settings.developer.buildInfo.caption")}
                        >
                          <SettingsRow>
                            <SettingsLabel title={t("common.version")} />
                            <span className="shrink-0 font-mono text-xs text-ps-text">
                              {__APP_VERSION__}
                            </span>
                          </SettingsRow>
                          <SettingsRow>
                            <SettingsLabel
                              title={t("settings.developer.buildInfo.channel")}
                            />
                            <span className="shrink-0 font-mono text-xs text-ps-muted">
                              {__BUILD_CHANNEL__}
                            </span>
                          </SettingsRow>
                          <SettingsRow>
                            <SettingsLabel
                              title={t(
                                "settings.developer.buildInfo.environment",
                              )}
                            />
                            <span className="shrink-0 font-mono text-xs text-ps-muted">
                              {import.meta.env.MODE} ·{" "}
                              {isTauri ? "desktop" : "web"}
                            </span>
                          </SettingsRow>
                        </SettingsGroup>

                        <SettingsGroup
                          id="setting-developer-settings-dump"
                          className={rowHighlight("developer-settings-dump")}
                          caption={t("settings.developer.diagnostics.caption")}
                        >
                          <SettingsRow>
                            <SettingsLabel
                              title={t("settings.developer.settingsDump.title")}
                              description={t(
                                "settings.developer.settingsDump.description",
                              )}
                            />
                            <Button
                              type="button"
                              color="indigo"
                              className="shrink-0"
                              onClick={() => void handleCopySettingsDump()}
                            >
                              <ClipboardDocumentIcon className="size-4" />
                              {t("common.copy")}
                            </Button>
                          </SettingsRow>
                          <SettingsRow>
                            <SettingsLabel
                              title={t(
                                "settings.developer.verboseLogging.title",
                              )}
                              description={t(
                                "settings.developer.verboseLogging.description",
                              )}
                            />
                            <Switch
                              name="verboseDiagnostics"
                              color="indigo"
                              aria-label={t(
                                "settings.developer.verboseLogging.title",
                              )}
                              checked={verboseDiagnostics}
                              onChange={(v: boolean) =>
                                setVerboseDiagnostics(v)
                              }
                            />
                          </SettingsRow>
                        </SettingsGroup>
                      </>
                    )}

                  {activeCategory === "about" && (
                    <>
                      <SettingsSectionHeader
                        icon={InformationCircleIcon}
                        title={t("settings.category.about.label")}
                        description={t("settings.about.description")}
                      />
                      <SettingsGroup
                        id="setting-about-version"
                        className={rowHighlight("about-version")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.about.version.title")}
                          />
                          <button
                            type="button"
                            onClick={handleVersionClick}
                            title={t("settings.about.version.tooltip")}
                            className="inline-flex shrink-0 cursor-pointer items-center rounded-md bg-ps-panel-soft px-2 py-1 font-mono text-xs text-ps-text ring-1 ring-ps-line transition-colors hover:ring-ps-line-strong"
                          >
                            v{__APP_VERSION__}
                          </button>
                        </SettingsRow>
                        <AboutLinkRow
                          title={t("settings.about.authors")}
                          value="PlayStash"
                          href="https://github.com/PlayStash"
                        />
                        <div
                          id="setting-about-license"
                          className={rowHighlight("about-license")}
                        >
                          <button
                            type="button"
                            onClick={() => void togglePlayStashLicense()}
                            aria-expanded={licenseExpanded}
                            className="group flex min-h-12 w-full cursor-pointer items-center justify-between gap-x-4 px-4 py-2.5 text-left transition-colors hover:bg-ps-panel-soft"
                          >
                            <SettingsLabel
                              title={t("settings.about.license.title")}
                            />
                            <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-medium text-ps-accent">
                              <span className="truncate">CC BY-NC-SA 4.0</span>
                              <ChevronRightIcon
                                className={clsx(
                                  "size-3.5 shrink-0 text-ps-muted transition-transform",
                                  licenseExpanded && "rotate-90",
                                )}
                              />
                            </span>
                          </button>
                          {licenseExpanded && playStashLicense && (
                            <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap wrap-break-word border-t border-ps-line bg-ps-panel-soft/60 px-4 py-3 font-mono text-xs leading-5 text-ps-muted">
                              {playStashLicense}
                            </pre>
                          )}
                        </div>
                        <AboutLinkRow
                          title={t("settings.about.metadataProviders")}
                          value="IGDB"
                          href="https://www.igdb.com"
                        />
                        <div
                          id="setting-about-open-source-licenses"
                          className={rowHighlight("about-open-source-licenses")}
                        >
                          <button
                            type="button"
                            onClick={() => void openLicenses()}
                            className="group flex min-h-12 w-full cursor-pointer items-center justify-between gap-x-4 px-4 py-2.5 text-left transition-colors hover:bg-ps-panel-soft"
                          >
                            <SettingsLabel
                              title={t(
                                "settings.about.openSourceLicenses.title",
                              )}
                            />
                            <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-sm font-medium text-ps-accent">
                              <span className="truncate">
                                {licenseData
                                  ? fillTemplate(
                                      t(
                                        "settings.about.openSourceLicenses.count",
                                      ),
                                      { count: licenseData.packages.length },
                                    )
                                  : t("settings.about.openSourceLicenses.view")}
                              </span>
                              <ChevronRightIcon className="size-3.5 shrink-0 text-ps-muted" />
                            </span>
                          </button>
                        </div>
                      </SettingsGroup>

                      <SettingsGroup
                        id="setting-about-system"
                        className={rowHighlight("about-system")}
                        caption={t("settings.about.system.caption")}
                      >
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.about.os.title")}
                            description={t("settings.about.os.description")}
                          />
                          <span className="min-w-0 max-w-[55%] text-right font-mono text-xs text-ps-muted">
                            {osLabel}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.about.display.title")}
                            description={t(
                              "settings.about.display.description",
                            )}
                          />
                          <span className="min-w-0 max-w-[55%] text-right font-mono text-xs text-ps-muted wrap-break-word">
                            {displayLabel}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.about.monitors.title")}
                            description={t(
                              "settings.about.monitors.description",
                            )}
                          />
                          <span className="min-w-0 max-w-[55%] text-right font-mono text-xs text-ps-muted">
                            {monitorsLabel}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel
                            title="GPU (WebGL)"
                            description={t("settings.about.gpu.description")}
                          />
                          <span className="min-w-0 max-w-[55%] text-right font-mono text-xs text-ps-muted">
                            {gpuLabel}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel title="WebGPU" />
                          <span className="min-w-0 text-right font-mono text-xs text-ps-muted">
                            {webgpuLabel}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.about.cpuMemory.title")}
                            description={t(
                              "settings.about.cpuMemory.description",
                            )}
                          />
                          <span className="min-w-0 max-w-[55%] text-right font-mono text-xs text-ps-muted wrap-break-word">
                            {cpuMemoryLabel}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel title={t("settings.about.platform")} />
                          <span className="min-w-0 text-right font-mono text-xs text-ps-muted">
                            {systemInfo.platform}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel title={t("settings.about.language")} />
                          <span className="min-w-0 text-right font-mono text-xs text-ps-muted">
                            {systemInfo.language}
                          </span>
                        </SettingsRow>
                        <SettingsRow>
                          <SettingsLabel
                            title={t("settings.about.userAgent")}
                          />
                          <span className="min-w-0 max-w-[55%] break-all text-right font-mono text-xs text-ps-muted">
                            {systemInfo.userAgent}
                          </span>
                        </SettingsRow>
                        {webkitSupported && renderingDiagnostics?.webkit && (
                          <SettingsRow>
                            <SettingsLabel
                              title="WebGL (WebKit)"
                              description={t(
                                "settings.about.webkitWebgl.description",
                              )}
                            />
                            <span className="min-w-0 text-right font-mono text-xs text-ps-muted">
                              {renderingDiagnostics.webkit.webgl_enabled
                                ? t("common.enabled")
                                : t("common.disabled")}
                            </span>
                          </SettingsRow>
                        )}
                      </SettingsGroup>

                      {isTauri && (
                        <>
                          <SettingsGroup
                            id="setting-about-updates"
                            className={rowHighlight("about-updates")}
                            caption={t("settings.about.updates.caption")}
                          >
                            {availableVersion && !isInstallingUpdate && (
                              <SettingsRow>
                                <SettingsLabel
                                  title={t(
                                    "settings.about.availableUpdate.title",
                                  )}
                                  description={t(
                                    "settings.about.availableUpdate.description",
                                  )}
                                />
                                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-ps-accent/15 px-2 py-1 font-mono text-xs font-medium text-ps-accent-strong ring-1 ring-ps-accent/25">
                                  <SparklesIcon className="size-3.5" />v
                                  {availableVersion}
                                </span>
                              </SettingsRow>
                            )}

                            <SettingsRow>
                              <SettingsLabel
                                title={t("settings.about.updateChannel.title")}
                                description={t(
                                  "settings.about.updateChannel.description",
                                )}
                              />
                              <div className="w-36 shrink-0">
                                <Listbox
                                  name="updateChannel"
                                  value={updateChannel}
                                  onChange={setUpdateChannel}
                                >
                                  <ListboxOption value="stable">
                                    <ListboxLabel>
                                      {t("settings.about.updateChannel.stable")}
                                    </ListboxLabel>
                                  </ListboxOption>
                                  {devToolsUnlocked && (
                                    <>
                                      <ListboxOption value="unstable">
                                        <ListboxLabel>
                                          {t(
                                            "settings.about.updateChannel.unstable",
                                          )}
                                        </ListboxLabel>
                                      </ListboxOption>
                                    </>
                                  )}
                                </Listbox>
                              </div>
                            </SettingsRow>

                            <SettingsRow>
                              <SettingsLabel
                                title={t("settings.about.autoUpdate.title")}
                                description={
                                  updaterErrorText
                                    ? updaterErrorText
                                    : updaterStatusText ||
                                      (updaterReady
                                        ? updaterEnabled
                                          ? t(
                                              updateChannel === "unstable"
                                                ? "settings.about.autoUpdate.enabledUnstable"
                                                : "settings.about.autoUpdate.enabledStable",
                                            )
                                          : t(
                                              "settings.about.autoUpdate.notConfigured",
                                            )
                                        : t(
                                            "settings.about.autoUpdate.checking",
                                          ))
                                }
                              />
                              {updaterErrorText ? (
                                <ExclamationTriangleIcon className="size-4 shrink-0 text-red-400" />
                              ) : (
                                <span
                                  className={clsx(
                                    "size-2.5 shrink-0 rounded-full",
                                    updaterEnabled
                                      ? "bg-ps-success"
                                      : "bg-ps-muted/60",
                                  )}
                                />
                              )}
                            </SettingsRow>
                          </SettingsGroup>

                          <SettingsGroup
                            id="setting-about-check-updates"
                            className={rowHighlight("about-updates")}
                          >
                            <SettingsRow>
                              <SettingsLabel
                                title={t("settings.about.checkUpdates.title")}
                                description={t(
                                  "settings.about.checkUpdates.description",
                                )}
                              />
                              <Button
                                type="button"
                                color="indigo"
                                className="shrink-0"
                                disabled={
                                  !updaterReady ||
                                  isCheckingUpdates ||
                                  isInstallingUpdate
                                }
                                onClick={() =>
                                  void checkForUpdates({ manual: true })
                                }
                              >
                                <ArrowPathIcon
                                  className={
                                    isCheckingUpdates
                                      ? "size-4 animate-spin motion-reduce:animate-none"
                                      : "size-4"
                                  }
                                />
                                {isCheckingUpdates
                                  ? t("settings.about.checkUpdates.checking")
                                  : isInstallingUpdate
                                    ? t("settings.about.checkUpdates.updating")
                                    : t("settings.about.checkUpdates.button")}
                              </Button>
                            </SettingsRow>
                          </SettingsGroup>
                        </>
                      )}
                    </>
                  )}

                  {activeCategory !== null &&
                    activeSections.length > 0 &&
                    !isBuiltInCategoryVisible(activeCategory) && (
                      <SettingsSectionHeader
                        icon={CATEGORY_META[activeCategory].icon}
                        title={t(CATEGORY_META[activeCategory].label)}
                        description={t(
                          CATEGORY_META[activeCategory].description,
                        )}
                      />
                    )}
                  {activeSections.map(({ id, component: Section }) => (
                    <Section
                      key={id}
                      rowHighlight={rowHighlight}
                      isTauri={isTauri}
                      isDesktopApp={isDesktopApp}
                      isLinux={isLinux}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <Dialog
        open={licensesOpen}
        onClose={() => setLicensesOpen(false)}
        size="3xl"
        className="h-[min(85vh,850px)]! flex flex-col"
      >
        <div className="flex items-start justify-between gap-4">
          <DialogTitle>
            {t("settings.about.openSourceLicenses.title")}
          </DialogTitle>
          <button
            type="button"
            onClick={() => setLicensesOpen(false)}
            aria-label={t("settings.licenses.close")}
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-ps-muted transition-colors hover:bg-ps-panel-soft hover:text-ps-text"
          >
            <XMarkIcon className="size-5" />
          </button>
        </div>
        <DialogDescription>
          {fillTemplate(t("settings.licenses.description"), {
            count: licenseData?.packages.length ?? "…",
          })}
        </DialogDescription>
        <DialogBody className="flex-1 min-h-0 overflow-y-auto">
          {licenseData ? (
            <div className="divide-y divide-ps-line overflow-hidden rounded-md border border-ps-line bg-ps-panel-strong">
              {licenseData.packages.map((pkg) => {
                const key = `${pkg.name}@${pkg.version}`;
                const expanded = expandedLicense === key;
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => setExpandedLicense(expanded ? null : key)}
                      aria-expanded={expanded}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ps-panel-soft"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm text-ps-text">
                          {pkg.name}
                        </span>
                        <span className="block text-xs text-ps-muted">
                          v{pkg.version}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-md bg-ps-panel-soft px-2 py-0.5 text-[11px] text-ps-muted ring-1 ring-ps-line">
                          {pkg.licenses}
                        </span>
                        <ChevronRightIcon
                          className={clsx(
                            "size-3.5 shrink-0 text-ps-muted transition-transform",
                            expanded && "rotate-90",
                          )}
                        />
                      </span>
                    </button>
                    {expanded && (
                      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap wrap-break-word border-t border-ps-line bg-ps-panel-soft/60 px-4 py-3 font-mono text-xs leading-5 text-ps-muted">
                        {pkg.licenseText || t("settings.licenses.noText")}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Text className="text-sm text-ps-muted">
              {t("settings.licenses.loading")}
            </Text>
          )}
        </DialogBody>
      </Dialog>
    </MotionConfig>
  );
}
