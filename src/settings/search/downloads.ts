import type { SearchableSetting } from "@/settings/types";

/** Settings search entries for the download pipeline settings. */
export const downloadsSearchEntries: SearchableSetting[] = [
  {
    id: "downloads-default-extraction-password",
    title: "pipeline.settings.passwordTitle",
    description:
      "settings.search.downloadsDefaultExtractionPassword.description",
    category: "downloads",
    keywords: ["password", "archive", "extract", "encrypted", "7z", "rar"],
    desktopOnly: true,
  },
  {
    id: "downloads-mount-iso",
    title: "settings.search.downloadsMountIso.title",
    description: "settings.search.downloadsMountIso.description",
    category: "downloads",
    keywords: ["iso", "mount", "disc", "image", "drive", "extract"],
    desktopOnly: true,
  },
];
