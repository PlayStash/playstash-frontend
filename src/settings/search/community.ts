import type { SearchableSetting } from "@/settings/types";

/** Settings search entries for the community and integration settings. */
export const communitySearchEntries: SearchableSetting[] = [
  {
    id: "community-chat-notifications",
    title: "Show notifications for new chat messages",
    description: "Desktop notifications for chat messages",
    category: "community",
    keywords: ["chat", "message", "notification", "toast", "alert", "dm"],
    desktopOnly: true,
  },
  {
    id: "community-activity-notifications",
    title: "Show notifications when community activity changes",
    description: "Desktop notifications when friends go online or play",
    category: "community",
    keywords: ["activity", "presence", "online", "playing", "notification"],
    desktopOnly: true,
  },
  {
    id: "integrations-steam-shortcuts",
    title: "Sync Steam shortcuts",
    description:
      "Add installed games to Steam as non-Steam shortcuts. Restart Steam to see changes.",
    category: "integrations",
    keywords: [
      "steam",
      "shortcut",
      "non-steam",
      "library",
      "big picture",
      "deck",
    ],
    desktopOnly: true,
  },
  {
    id: "integrations-steam-restore",
    title: "Restore Steam shortcuts backup",
    description: "Reset shortcuts.vdf to the backup made before the first sync",
    category: "integrations",
    keywords: ["steam", "backup", "restore", "shortcuts.vdf"],
    desktopOnly: true,
  },
  {
    id: "integrations-discord-id",
    title: "Discord Application ID",
    description: "The Discord application used for Rich Presence",
    category: "integrations",
    keywords: ["discord", "application", "client", "id", "rich presence"],
    desktopOnly: true,
  },
  {
    id: "integrations-discord-presence",
    title: "Sync Discord presence",
    description: "Show the game you are playing in Discord",
    category: "integrations",
    keywords: ["discord", "presence", "rich presence", "status", "playing"],
    desktopOnly: true,
  },
  {
    id: "integrations-playnite",
    title: "Playnite extension",
    description: "Connect your PlayStash library using the Playnite extension",
    category: "integrations",
    keywords: ["playnite", "extension", "plugin", "launcher"],
    desktopOnly: true,
  },
];
