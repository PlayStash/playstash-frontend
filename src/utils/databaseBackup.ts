/**
 * Helpers for Administration → Backup & Restore Database
 * (`GET /api/admin/database/backup`, `POST /api/admin/database/restore`,
 * both guarded by the server's database password in `X-Database-Password`).
 */
export const DATABASE_BACKUP_PATH = "/api/admin/database/backup";
export const DATABASE_RESTORE_PATH = "/api/admin/database/restore";
export const DATABASE_PASSWORD_HEADER = "X-Database-Password";
/** Multipart field the restore endpoint reads the dump from. */
export const DATABASE_RESTORE_FIELD = "file";
export const DATABASE_BACKUP_EXTENSION = "db";

// Characters Windows, macOS or Linux do not allow in file names.
// eslint-disable-next-line no-control-regex
const INVALID_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local `YYYY-MM-DD_HH-MM-SS`; never contains `:` (invalid on Windows). */
export function fileTimestamp(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

/** `playstash_database_backup_2026-10-15_14-03-05.db` */
export function defaultBackupFileName(date: Date = new Date()): string {
  return `playstash_database_backup_${fileTimestamp(date)}.${DATABASE_BACKUP_EXTENSION}`;
}

/**
 * Makes `name` a valid file name on every desktop OS: invalid characters
 * become `-`, trailing dots and spaces are dropped and reserved Windows
 * device names are prefixed. Returns "" when nothing usable is left.
 */
export function sanitizeFileName(name: string): string {
  let cleaned = name
    .replace(INVALID_FILE_NAME_CHARACTERS, "-")
    .trim()
    .replace(/[. ]+$/, "");
  if (/^[-.\s]*$/.test(cleaned)) return "";
  if (RESERVED_WINDOWS_NAMES.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned.slice(0, 200);
}

/** File name from a `Content-Disposition` header (RFC 6266), if any. */
export function fileNameFromDisposition(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8|ISO-8859-1)?'[^']*'([^;]+)/i.exec(
    header,
  );
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // Malformed percent-encoding: fall back to the plain parameter.
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) return quoted[1].replace(/\\(.)/g, "$1");
  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** The server's backup file name (sanitized) or a timestamped default. */
export function backupFileName(
  disposition: string | null | undefined,
  date: Date = new Date(),
): string {
  const fromServer = sanitizeFileName(
    fileNameFromDisposition(disposition) ?? "",
  );
  return fromServer || defaultBackupFileName(date);
}

/** HTTP status from a desktop transfer error (`HTTP 401: ...`). */
export function httpStatusOf(error: unknown): number | null {
  const match = /\bHTTP (\d{3})\b/.exec(String(error ?? ""));
  return match ? Number(match[1]) : null;
}

/** Backend message from a desktop transfer error (`HTTP 406: <message>`). */
export function serverMessageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = /\bHTTP \d{3}(?::\s*(.*))?$/s.exec(text.trim());
  if (match) return match[1]?.trim() ?? "";
  return text.trim();
}
