import type { SearchableSetting } from "@/settings/types";

/** Settings search entries for the game launch settings. */
export const launchSearchEntries: SearchableSetting[] = [
  {
    id: "games-ignore-list-reset",
    title: "ignoreList.resetTitle",
    description: "settings.search.gamesIgnoreListReset.description",
    category: "games",
    keywords: ["ignore", "ignored", "executables", "reset", "default", "exe"],
    desktopOnly: true,
  },
  {
    id: "games-fullscreen-library",
    title: "fullscreenLibrary.onStart",
    description: "settings.search.gamesFullscreenLibrary.description",
    category: "games",
    keywords: [
      "big picture",
      "fullscreen",
      "controller",
      "gamepad",
      "startup",
      "installed",
    ],
    desktopOnly: true,
  },
];
