import { describe, expect, it } from "vitest";
import {
  backupFileName,
  defaultBackupFileName,
  fileNameFromDisposition,
  httpStatusOf,
  sanitizeFileName,
  serverMessageOf,
} from "./databaseBackup";

const date = new Date(2026, 9, 15, 9, 5, 7);

describe("database backup file names", () => {
  it("builds a timestamped default name without colons", () => {
    expect(defaultBackupFileName(date)).toBe(
      "playstash_database_backup_2026-10-15_09-05-07.db",
    );
    expect(defaultBackupFileName(date)).not.toContain(":");
  });

  it("reads quoted, plain and RFC 5987 Content-Disposition names", () => {
    expect(
      fileNameFromDisposition(
        'attachment; filename="playstash_17.1.0_database_backup_2026-10-15T09-05-07-000Z.db"',
      ),
    ).toBe("playstash_17.1.0_database_backup_2026-10-15T09-05-07-000Z.db");
    expect(fileNameFromDisposition("attachment; filename=dump.db")).toBe(
      "dump.db",
    );
    expect(
      fileNameFromDisposition(
        "attachment; filename=\"x.db\"; filename*=UTF-8''sp%C3%A4t.db",
      ),
    ).toBe("spät.db");
    expect(fileNameFromDisposition(null)).toBeNull();
    expect(fileNameFromDisposition("attachment")).toBeNull();
  });

  it("sanitizes names that are invalid on Windows", () => {
    expect(sanitizeFileName("DB_Backup_15.10.2026 14:03:05.db")).toBe(
      "DB_Backup_15.10.2026 14-03-05.db",
    );
    expect(sanitizeFileName('a<b>c"d/e\\f|g?h*i.db')).toBe(
      "a-b-c-d-e-f-g-h-i.db",
    );
    expect(sanitizeFileName("backup.db. ")).toBe("backup.db");
    expect(sanitizeFileName("CON.db")).toBe("_CON.db");
    expect(sanitizeFileName("::")).toBe("");
  });

  it("falls back to the default name when the server sends none", () => {
    expect(backupFileName(null, date)).toBe(defaultBackupFileName(date));
    expect(backupFileName('attachment; filename=":"', date)).toBe(
      defaultBackupFileName(date),
    );
    expect(backupFileName('attachment; filename="a:b.db"', date)).toBe(
      "a-b.db",
    );
  });
});

describe("desktop transfer errors", () => {
  it("extracts the HTTP status and backend message", () => {
    const error =
      "HTTP 401: The database password provided in the X-Database-Password Header is incorrect.";
    expect(httpStatusOf(error)).toBe(401);
    expect(serverMessageOf(error)).toBe(
      "The database password provided in the X-Database-Password Header is incorrect.",
    );
    expect(httpStatusOf("HTTP 502")).toBe(502);
    expect(serverMessageOf("HTTP 502")).toBe("");
    expect(httpStatusOf("Backup failed: connection refused")).toBeNull();
    expect(serverMessageOf(new Error("Backup failed: refused"))).toBe(
      "Backup failed: refused",
    );
  });
});
