import type { SearchableSetting } from "@/settings/types";

/** Settings search entries owned by WP5 (download-pipeline). */
export const wp5SearchEntries: SearchableSetting[] = [
  {
    id: "downloads-default-extraction-password",
    title: "Default extraction password",
    description:
      "Set a password that will automatically be tried when extracting games",
    category: "downloads",
    keywords: ["password", "archive", "extract", "encrypted", "7z", "rar"],
    desktopOnly: true,
  },
  {
    id: "downloads-mount-iso",
    title: "Mount ISO instead of extracting",
    description: "Mount .iso downloads as a drive and install from it",
    category: "downloads",
    keywords: ["iso", "mount", "disc", "image", "drive", "extract"],
    desktopOnly: true,
  },
];
