import type { SearchableSetting } from "@/settings/types";

/** Settings search entries for the cloud save settings. */
export const cloudSavesSearchEntries: SearchableSetting[] = [
  {
    id: "integrations-cloud-saves",
    title: "cloudSaves.settings.sync",
    description: "settings.search.integrationsCloudSaves.description",
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
    title: "cloudSaves.settings.manifests",
    description: "settings.search.integrationsCloudSaveManifests.description",
    category: "integrations",
    keywords: ["ludusavi", "manifest", "primary", "custom", "cloud", "save"],
    desktopOnly: true,
  },
];
