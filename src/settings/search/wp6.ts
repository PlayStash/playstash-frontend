import type { SearchableSetting } from "@/settings/types";

/** Settings search entries owned by WP6 (accounts). */
export const wp6SearchEntries: SearchableSetting[] = [
  {
    id: "account-session",
    title: "Logout and profiles",
    description: "Change profile, log out from this device or from all devices",
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
    title: "Additional request headers and server connection",
    description:
      "Headers sent with every server request, export of the server connection",
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
    title: "Import from the previous PlayStash client",
    description: "Profiles, settings and installed games of PlayStash 1.x",
    category: "account",
    keywords: ["import", "legacy", "previous", "old client", "wpf", "migrate"],
    desktopOnly: true,
  },
];
