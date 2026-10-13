import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("./ensure-api-client.mjs", import.meta.url),
);

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "playstash-api-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "api-spec"), { recursive: true });
  await writeFile(
    path.join(dir, "api-spec/playstash.openapi.json"),
    '{"title":"bundled"}',
  );
  const cliDir = path.join(
    dir,
    "node_modules/@openapitools/openapi-generator-cli",
  );
  await mkdir(cliDir, { recursive: true });
  await writeFile(
    path.join(cliDir, "main.js"),
    `
    const fs = require("node:fs");
    const path = require("node:path");
    const args = process.argv.slice(2);
    const input = args[args.indexOf("-i") + 1];
    const output = args[args.indexOf("-o") + 1];
    if (process.env.TEST_GENERATOR_FAIL) process.exit(1);
    fs.mkdirSync(path.join(output, "models"), { recursive: true });
    for (const file of ["runtime.ts", "models/PlaystashGame.ts", "models/PlaystashUser.ts"])
      fs.writeFileSync(path.join(output, file), "export {};\\n");
    fs.writeFileSync("generated-input.txt", fs.readFileSync(input));
  `,
  );
  const run = (overrides = {}) =>
    spawnSync(process.execPath, [scriptPath], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PLAYSTASH_API_SPEC_URL: "",
        PLAYSTASH_API_SPEC_PATH: "",
        ...overrides,
      },
    });
  return { dir, run };
}

test("generates from the bundled schema and skips an unchanged complete client", async (t) => {
  const { dir, run } = await fixture(t);
  assert.equal(run().status, 0);
  assert.equal(
    await readFile(path.join(dir, "generated-input.txt"), "utf8"),
    '{"title":"bundled"}',
  );
  const second = run({ TEST_GENERATOR_FAIL: "1" });
  assert.equal(second.status, 0);
  assert.match(second.stdout, /skipping generation/);
});

test("generates from the configured local path instead of a URL", async (t) => {
  const { dir, run } = await fixture(t);
  const specPath = path.join(dir, "local.json");
  await writeFile(specPath, '{"title":"local override"}');
  const result = run({
    PLAYSTASH_API_SPEC_PATH: specPath,
    PLAYSTASH_API_SPEC_URL: "https://invalid.example",
  });
  assert.equal(result.status, 0);
  assert.equal(
    await readFile(path.join(dir, "generated-input.txt"), "utf8"),
    '{"title":"local override"}',
  );
});

test("a missing configured schema fails without silently fetching another schema", async (t) => {
  const { dir, run } = await fixture(t);
  const result = run({
    PLAYSTASH_API_SPEC_PATH: path.join(dir, "missing.json"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
});

test("a failed regeneration preserves the previous API client", async (t) => {
  const { dir, run } = await fixture(t);
  assert.equal(run().status, 0);
  const marker = await readFile(
    path.join(dir, "src/api/.api-spec-hash"),
    "utf8",
  );
  await writeFile(
    path.join(dir, "api-spec/playstash.openapi.json"),
    '{"title":"changed"}',
  );
  assert.notEqual(run({ TEST_GENERATOR_FAIL: "1" }).status, 0);
  assert.equal(
    await readFile(path.join(dir, "src/api/.api-spec-hash"), "utf8"),
    marker,
  );
  assert.equal(
    await readFile(path.join(dir, "src/api/runtime.ts"), "utf8"),
    "export {};\n",
  );
});
