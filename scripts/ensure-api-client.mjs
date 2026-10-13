import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_SPEC_PATH = path.resolve("api-spec/playstash.openapi.json");
const API_DIR = path.resolve("src/api");
const MARKER = path.join(API_DIR, ".api-spec-hash");

async function readSpec() {
  const localPath = process.env.PLAYSTASH_API_SPEC_PATH?.trim();
  if (localPath) return readFile(path.resolve(localPath), "utf8");
  const specUrl = process.env.PLAYSTASH_API_SPEC_URL?.trim();
  if (specUrl) {
    const response = await fetch(specUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch PlayStash API spec (${response.status}).`,
      );
    }
    return response.text();
  }
  return readFile(DEFAULT_SPEC_PATH, "utf8");
}

async function generateApiClient(spec, hash) {
  const temporaryDir = await mkdtemp(path.join(tmpdir(), "playstash-openapi-"));
  const inputPath = path.join(temporaryDir, "openapi.yaml");
  const outputDir = path.join(temporaryDir, "client");
  try {
    // Generate from the exact content that was hashed, including local overrides.
    await writeFile(inputPath, spec, "utf8");
    const cliJs = path.resolve(
      "node_modules/@openapitools/openapi-generator-cli/main.js",
    );
    const args = [
      "generate",
      "-g",
      "typescript-fetch",
      "-i",
      inputPath,
      "-o",
      outputDir,
      "--global-property",
      "models,supportingFiles",
      "-p",
      "enumPropertyNaming=snake_case",
      "-p",
      "modelPropertyNaming=snake_case",
    ];
    const result = spawnSync(process.execPath, [cliJs, ...args], {
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error("PlayStash API client generation failed.");
    for (const file of [
      "runtime.ts",
      "models/PlaystashGame.ts",
      "models/PlaystashUser.ts",
    ]) {
      if (!existsSync(path.join(outputDir, file))) {
        throw new Error(
          `API schema did not generate the required PlayStash model: ${file}`,
        );
      }
    }
    // Keep an existing client intact until generation has succeeded.
    await writeFile(
      path.join(outputDir, ".api-spec-hash"),
      `${hash}\n`,
      "utf8",
    );
    await rm(API_DIR, { recursive: true, force: true });
    await mkdir(path.dirname(API_DIR), { recursive: true });
    await cp(outputDir, API_DIR, { recursive: true });
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

async function main() {
  const spec = await readSpec();
  const hash = createHash("sha256")
    .update("playstash-client-v1\n")
    .update(spec)
    .digest("hex");
  const markerMatches =
    existsSync(MARKER) && (await readFile(MARKER, "utf8")).trim() === hash;
  const apiExists = [
    "runtime.ts",
    "models/PlaystashGame.ts",
    "models/PlaystashUser.ts",
  ].every((file) => existsSync(path.join(API_DIR, file)));
  if (markerMatches && apiExists) {
    console.log("PlayStash API client is up to date, skipping generation.");
    return;
  }
  console.log("Generating PlayStash API client...");
  await generateApiClient(spec, hash);
  console.log("PlayStash API client generated.");
}

// Allow pending Windows DNS completions to drain instead of calling process.exit().
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await globalThis[Symbol.for("undici.globalDispatcher.1")]?.close?.();
}
