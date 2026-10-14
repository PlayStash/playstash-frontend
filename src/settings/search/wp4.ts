import type { SearchableSetting } from "@/settings/types";

/** Settings search entries owned by WP4 (launch). */
export const wp4SearchEntries: SearchableSetting[] = [
  {
    id: "games-ignore-list-reset",
    title: "Reset ignored executables",
    description:
      "Replace the ignored executables with the server's default list.",
    category: "games",
    keywords: ["ignore", "ignored", "executables", "reset", "default", "exe"],
    desktopOnly: true,
  },
  {
    id: "games-fullscreen-library",
    title: "Open fullscreen library when the client starts",
    description: "Start in Big Picture on the installed games.",
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
