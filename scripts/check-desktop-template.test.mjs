import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getFileInfo } from "prettier";

test("Linux launcher remains a valid Desktop Entry and is excluded from HTML formatting", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const template = path.join(root, "src-tauri/linux/playstash.desktop.hbs");
  const lines = (await readFile(template, "utf8")).trim().split(/\r?\n/);
  assert.equal(lines.shift(), "[Desktop Entry]");
  const fields = new Map();
  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z0-9-]*)=(.+)$/.exec(line);
    assert.ok(match, `Invalid Desktop Entry record: ${line}`);
    assert.ok(
      !fields.has(match[1]),
      `Duplicate Desktop Entry key: ${match[1]}`,
    );
    fields.set(match[1], match[2]);
  }
  for (const field of [
    "Name",
    "Type",
    "Exec",
    "Icon",
    "Terminal",
    "Categories",
  ])
    assert.ok(
      fields.has(field),
      `Required Desktop Entry key is missing: ${field}`,
    );
  assert.equal(fields.get("Type"), "Application");
  assert.equal(fields.get("Terminal"), "false");
  assert.equal(
    (
      await getFileInfo(template, {
        ignorePath: path.join(root, ".prettierignore"),
      })
    ).ignored,
    true,
  );
});
