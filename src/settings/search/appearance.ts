import type { SearchableSetting } from "@/settings/types";

/** Settings search entries for the themes, startup and storage settings. */
export const appearanceSearchEntries: SearchableSetting[] = [
  {
    id: "themes-installed",
    title: "themes.installed.title",
    description: "settings.search.themesInstalled.description",
    category: "themes",
    keywords: [
      "theme",
      "themes",
      "color",
      "colour",
      "dark",
      "light",
      "halloween",
      "christmas",
      "emerald",
      "smaragd",
      "uninstall",
      "folder",
      "xaml",
    ],
  },
  {
    id: "themes-generator",
    title: "themes.generator.title",
    description: "settings.search.themesGenerator.description",
    category: "themes",
    keywords: ["theme", "generator", "create", "palette", "export", "overlay"],
  },
  {
    id: "themes-community",
    title: "themes.community.title",
    description: "settings.search.themesCommunity.description",
    category: "themes",
    keywords: ["theme", "community", "install", "repository", "github"],
  },
  {
    id: "startup-library-autoload",
    title: "startup.autoload.title",
    category: "startup",
    keywords: ["library", "startup", "load", "autoload", "server"],
  },
  {
    id: "startup-library-retain",
    title: "startup.retain.title",
    category: "startup",
    keywords: ["library", "sort", "filter", "retain", "remember", "restart"],
  },
  {
    id: "startup-sound",
    title: "startup.sound.title",
    description: "settings.search.startupSound.description",
    category: "startup",
    keywords: ["sound", "startup", "audio", "music", "boot"],
    desktopOnly: true,
  },
  {
    id: "storage-image-cache",
    title: "storage.imageCache.title",
    description: "settings.search.storageImageCache.description",
    category: "storage",
    keywords: ["cache", "image", "offline", "clear", "storage", "size", "data"],
  },
  {
    id: "developer-user-cache-folder",
    title: "storage.userCacheFolder.title",
    category: "developer",
    keywords: ["folder", "cache", "data", "app data", "user"],
    desktopOnly: true,
  },
];
