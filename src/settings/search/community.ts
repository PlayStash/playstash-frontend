import type { SearchableSetting } from "@/settings/types";

/** Settings search entries for the community and integration settings. */
export const communitySearchEntries: SearchableSetting[] = [
  {
    id: "community-chat-notifications",
    title: "communitySettings.chat",
    description: "settings.search.communityChatNotifications.description",
    category: "community",
    keywords: ["chat", "message", "notification", "toast", "alert", "dm"],
    desktopOnly: true,
  },
  {
    id: "community-activity-notifications",
    title: "communitySettings.activity",
    description: "settings.search.communityActivityNotifications.description",
    category: "community",
    keywords: ["activity", "presence", "online", "playing", "notification"],
    desktopOnly: true,
  },
  {
    id: "integrations-steam-shortcuts",
    title: "integrations.steam.sync",
    description: "integrations.steam.description",
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
    title: "settings.search.integrationsSteamRestore.title",
    description: "settings.search.integrationsSteamRestore.description",
    category: "integrations",
    keywords: ["steam", "backup", "restore", "shortcuts.vdf"],
    desktopOnly: true,
  },
  {
    id: "integrations-discord-id",
    title: "integrations.discord.applicationId",
    description: "settings.search.integrationsDiscordId.description",
    category: "integrations",
    keywords: ["discord", "application", "client", "id", "rich presence"],
    desktopOnly: true,
  },
  {
    id: "integrations-discord-presence",
    title: "integrations.discord.sync",
    description: "settings.search.integrationsDiscordPresence.description",
    category: "integrations",
    keywords: ["discord", "presence", "rich presence", "status", "playing"],
    desktopOnly: true,
  },
  {
    id: "integrations-playnite",
    title: "settings.search.integrationsPlaynite.title",
    description: "settings.search.integrationsPlaynite.description",
    category: "integrations",
    keywords: ["playnite", "extension", "plugin", "launcher"],
    desktopOnly: true,
  },
];
