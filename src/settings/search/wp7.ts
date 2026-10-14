import type { SearchableSetting } from "@/settings/types";

/** Settings search entries owned by WP7 (appearance). */
export const wp7SearchEntries: SearchableSetting[] = [
  {
    id: "themes-installed",
    title: "Installed Themes",
    description: "Choose, reload or uninstall a theme.",
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
      "phalcode",
      "uninstall",
      "folder",
      "xaml",
    ],
  },
  {
    id: "themes-generator",
    title: "Create a Theme",
    description: "Generate a palette from a main color and export a theme.",
    category: "themes",
    keywords: ["theme", "generator", "create", "palette", "export", "overlay"],
  },
  {
    id: "themes-community",
    title: "Community Themes",
    description: "Install themes shared by the community.",
    category: "themes",
    keywords: ["theme", "community", "install", "repository", "github"],
  },
  {
    id: "startup-library-autoload",
    title: "Auto-Load Library from Server on Startup",
    category: "startup",
    keywords: ["library", "startup", "load", "autoload", "server"],
  },
  {
    id: "startup-library-retain",
    title: "Retain Sorting and Filter preferences after restart",
    category: "startup",
    keywords: ["library", "sort", "filter", "retain", "remember", "restart"],
  },
  {
    id: "startup-sound",
    title: "Startup Sound",
    description: "Play a sound when PlayStash starts.",
    category: "startup",
    keywords: ["sound", "startup", "audio", "music", "boot"],
    desktopOnly: true,
  },
  {
    id: "storage-image-cache",
    title: "Image cache",
    description: "Cache sizes and clearing the image and offline caches.",
    category: "storage",
    keywords: ["cache", "image", "offline", "clear", "storage", "size", "data"],
  },
  {
    id: "developer-user-cache-folder",
    title: "Open User Cache Folder",
    category: "developer",
    keywords: ["folder", "cache", "data", "app data", "user"],
    desktopOnly: true,
  },
];
