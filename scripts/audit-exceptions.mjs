#!/usr/bin/env node
/**
 * Temporary RustSec exceptions shared by `cargo audit` in CI and the patched
 * Ludusavi build (`scripts/build-ludusavi.mjs`).
 *
 * `tooling/audit-exceptions.json` lists advisories that may pass the audit
 * until a fixed date, with the reason. Without the file, or once `until` has
 * passed, nothing is ignored and the audit is strict again.
 *
 * CLI: prints the `--ignore <id>` arguments for `cargo audit`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tooling",
  "audit-exceptions.json",
);

/** Advisory ids that may still pass on `today` (an ISO date). */
export function activeAuditExceptions(
  config,
  today = new Date().toISOString().slice(0, 10),
) {
  if (!config || typeof config.until !== "string") return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.until) || today > config.until) {
    return [];
  }
  return (config.advisories ?? []).filter((id) =>
    /^RUSTSEC-\d{4}-\d{4}$/.test(id),
  );
}

export function readAuditExceptions(file = DEFAULT_FILE, today) {
  if (!existsSync(file)) return [];
  return activeAuditExceptions(JSON.parse(readFileSync(file, "utf8")), today);
}

/** `cargo audit` arguments ignoring the active exceptions. */
export function auditIgnoreArgs(file, today) {
  return readAuditExceptions(file, today).flatMap((id) => ["--ignore", id]);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const args = auditIgnoreArgs();
  if (args.length)
    console.error(
      `Temporary audit exceptions: ${args.filter((_, i) => i % 2).join(", ")}`,
    );
  console.log(args.join(" "));
}
