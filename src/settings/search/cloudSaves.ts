import type { SearchableSetting } from "@/settings/types";

/** Settings search entries for the cloud save settings. */
export const cloudSavesSearchEntries: SearchableSetting[] = [
  {
    id: "integrations-cloud-saves",
    title: "Sync cloud saves",
    description: "Back up and restore save files through your PlayStash server",
    category: "integrations",
    keywords: [
      "cloud",
      "save",
      "saves",
      "savegame",
      "backup",
      "restore",
      "sync",
      "ludusavi",
    ],
    desktopOnly: true,
  },
  {
    id: "integrations-cloud-save-manifests",
    title: "Custom Ludusavi Manifests",
    description: "Use Primary Manifest, custom manifest files or URLs",
    category: "integrations",
    keywords: ["ludusavi", "manifest", "primary", "custom", "cloud", "save"],
    desktopOnly: true,
  },
];
