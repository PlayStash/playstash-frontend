import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { activeAuditExceptions, auditIgnoreArgs } from "./audit-exceptions.mjs";

const config = {
  until: "2026-10-24",
  advisories: ["RUSTSEC-2026-0367", "not-an-id", "RUSTSEC-2026-0369"],
};

test("exceptions apply only until their date", () => {
  assert.deepEqual(activeAuditExceptions(config, "2026-10-17"), [
    "RUSTSEC-2026-0367",
    "RUSTSEC-2026-0369",
  ]);
  assert.deepEqual(activeAuditExceptions(config, "2026-10-24").length, 2);
  assert.deepEqual(activeAuditExceptions(config, "2026-10-25"), []);
  assert.deepEqual(
    activeAuditExceptions({ advisories: ["RUSTSEC-2026-0367"] }),
    [],
  );
  assert.deepEqual(activeAuditExceptions(null), []);
});

test("cargo audit arguments come from the file, none without it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "audit-exceptions-"));
  const file = path.join(dir, "audit-exceptions.json");
  assert.deepEqual(auditIgnoreArgs(file, "2026-10-17"), []);
  writeFileSync(file, JSON.stringify(config));
  assert.deepEqual(auditIgnoreArgs(file, "2026-10-17"), [
    "--ignore",
    "RUSTSEC-2026-0367",
    "--ignore",
    "RUSTSEC-2026-0369",
  ]);
});
