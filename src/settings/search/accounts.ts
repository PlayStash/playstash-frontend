import type { SearchableSetting } from "@/settings/types";

/** Settings search entries for the account settings. */
export const accountsSearchEntries: SearchableSetting[] = [
  {
    id: "account-session",
    title: "settings.search.accountSession.title",
    description: "settings.search.accountSession.description",
    category: "account",
    keywords: [
      "logout",
      "log out",
      "sign out",
      "profile",
      "change profile",
      "switch account",
      "devices",
      "revoke",
      "session",
    ],
  },
  {
    id: "account-connection",
    title: "settings.search.accountConnection.title",
    description: "settings.search.accountConnection.description",
    category: "account",
    keywords: [
      "headers",
      "request headers",
      "cloudflare",
      "proxy",
      "client settings",
      "export",
      "connection",
      "server",
    ],
    desktopOnly: true,
  },
  {
    id: "account-legacy",
    title: "settings.search.accountLegacy.title",
    description: "settings.search.accountLegacy.description",
    category: "account",
    keywords: ["import", "legacy", "previous", "old client", "wpf", "migrate"],
    desktopOnly: true,
  },
];
