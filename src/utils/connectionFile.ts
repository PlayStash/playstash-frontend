import { normalizeServerUrl } from "@/utils/authConfig";
import {
  getDefaultExtractionPassword,
  setDefaultExtractionPassword,
} from "@/utils/extractionPassword";

/**
 * Server connection files (WPF `ConnectionProfile`, schema 1): the server URL
 * plus installation preferences, shared by an admin with new users. Login
 * credentials, session tokens, API keys and request headers are never part
 * of it; the archive password only when the user opts in.
 */
export interface ConnectionFile {
  schema_version: 1;
  server_url: string;
  archive_password: string | null;
  auto_extract: boolean;
  auto_install_portable: boolean;
  auto_delete_portable_files: boolean;
}

/** Download pipeline keys the imported preferences are applied to ("1"/"0"). */
export const AUTO_EXTRACT_KEY = "tauri_auto_extract";
export const AUTO_INSTALL_KEY = "tauri_auto_install";
export const AUTO_DELETE_SOURCE_KEY = "tauri_auto_delete_source";
/** An imported file waiting for a login to its server. */
export const PENDING_CONNECTION_KEY = "playstash_pending_connection";

export const CONNECTION_FILE_NAME = "PlayStash-connection.json";
export const CONNECTION_FILE_FILTER = {
  name: "PlayStash connection",
  extensions: ["json"],
};

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Builds the file from the current installation preferences. */
export function buildConnectionFile(
  serverUrl: string,
  archivePassword: string | null,
  flags: {
    autoExtract: boolean;
    autoInstallPortable: boolean;
    autoDeletePortableFiles: boolean;
  } = {
    autoExtract: readFlag(AUTO_EXTRACT_KEY),
    autoInstallPortable: readFlag(AUTO_INSTALL_KEY),
    autoDeletePortableFiles: readFlag(AUTO_DELETE_SOURCE_KEY),
  },
): ConnectionFile {
  return {
    schema_version: 1,
    server_url: serverUrl,
    archive_password: archivePassword,
    auto_extract: flags.autoExtract,
    auto_install_portable: flags.autoInstallPortable,
    auto_delete_portable_files: flags.autoDeletePortableFiles,
  };
}

/** Indented JSON, like the WPF export. */
export function serializeConnectionFile(file: ConnectionFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Parses and validates a connection file. Throws "Unsupported connection
 * file." for anything but schema 1 and a message for an invalid server URL.
 */
export function parseConnectionFile(text: string): ConnectionFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Unsupported connection file.");
  }
  if (!raw || typeof raw !== "object" || raw.schema_version !== 1)
    throw new Error("Unsupported connection file.");
  const serverUrl =
    typeof raw.server_url === "string"
      ? normalizeServerUrl(raw.server_url)
      : "";
  if (!serverUrl)
    throw new Error(
      "Enter a valid HTTP or HTTPS server URL, such as https://server.example.",
    );
  const password = raw.archive_password;
  return {
    schema_version: 1,
    server_url: serverUrl,
    archive_password: typeof password === "string" ? password : null,
    auto_extract: raw.auto_extract === true,
    auto_install_portable: raw.auto_install_portable === true,
    auto_delete_portable_files: raw.auto_delete_portable_files === true,
  };
}

export function storePendingConnection(file: ConnectionFile): void {
  try {
    // Kept only until the next login; the archive password is moved into the
    // vault then.
    sessionStorage.setItem(PENDING_CONNECTION_KEY, JSON.stringify(file));
  } catch {
    /* storage unavailable */
  }
}

export function getPendingConnection(): ConnectionFile | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CONNECTION_KEY);
    return raw ? parseConnectionFile(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingConnection(): void {
  try {
    sessionStorage.removeItem(PENDING_CONNECTION_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Applies a pending import after a successful login, but only when the login
 * went to the imported server. The archive password becomes the default
 * extraction password of the profile that just logged in. Returns whether it
 * was applied.
 */
export async function applyPendingConnection(
  loggedInServer: string,
  setPassword: (password: string) => Promise<void> = (password) =>
    setDefaultExtractionPassword(password),
): Promise<boolean> {
  const pending = getPendingConnection();
  if (!pending) return false;
  if (normalizeServerUrl(loggedInServer) !== pending.server_url) return false;
  try {
    localStorage.setItem(AUTO_EXTRACT_KEY, pending.auto_extract ? "1" : "0");
    localStorage.setItem(
      AUTO_INSTALL_KEY,
      pending.auto_install_portable ? "1" : "0",
    );
    localStorage.setItem(
      AUTO_DELETE_SOURCE_KEY,
      pending.auto_delete_portable_files ? "1" : "0",
    );
  } catch {
    /* storage unavailable */
  }
  await setPassword(pending.archive_password ?? "");
  clearPendingConnection();
  return true;
}

/** The active profile's default archive password for an opt-in export. */
export async function readDefaultArchivePassword(): Promise<string | null> {
  return (await getDefaultExtractionPassword()) || null;
}
