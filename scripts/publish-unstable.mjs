import { execFileSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { readRelease } from "./read-updater-channels.mjs";
import { stagedReleaseVersion } from "./plan-release.mjs";
const [tag, buildVersion] = process.argv.slice(2);
if (!tag || !buildVersion || !tag.startsWith("unstable-"))
  throw new Error("Expected staged unstable release tag and build version.");
const repository = process.env.GITHUB_REPOSITORY;
const staged = readRelease(repository, `tags/${tag}`);
if (!staged || staged.target_commitish !== process.env.GITHUB_SHA)
  throw new Error("The staged release does not belong to this build commit.");
const dir = path.resolve("unstable-promotion");
await mkdir(dir, { recursive: true });
execFileSync("gh", ["release", "download", tag, "--dir", dir, "--clobber"], {
  stdio: "inherit",
});
const names = await readdir(dir);
for (const expected of [
  "playstash-frontend.zip",
  "Dockerfile.runtime",
  "nginx.runtime.conf",
  "start-runtime.sh",
  "unstable.json",
  "updater-channels.json",
])
  if (!names.includes(expected))
    throw new Error(`Incomplete staged release: ${expected} is missing.`);
// A rerun can reuse the immutable first attempt instead of its newly computed
// version. Promotion and cleanup must describe the signed assets being reused.
const version = stagedReleaseVersion(
  JSON.parse(await readFile(path.join(dir, "unstable.json"), "utf8")),
  buildVersion,
);
const notesPath = path.join(dir, "release-notes.md");
await writeFile(notesPath, staged.body || "");
// The full platform matrix has completed. Publish this immutable build before
// its feed can direct clients to it; no assets of this build are changed after.
if (staged.draft)
  execFileSync(
    "gh",
    ["release", "edit", tag, "--draft=false", "--prerelease", "--latest=false"],
    { stdio: "inherit" },
  );
if (!readRelease(repository, "tags/unstable"))
  execFileSync(
    "gh",
    [
      "release",
      "create",
      "unstable",
      "--draft",
      "--prerelease",
      "--target",
      process.env.GITHUB_SHA,
      "--title",
      `PlayStash ${version} · Unstable`,
      "--notes-file",
      notesPath,
    ],
    { stdio: "inherit" },
  );
const assets = names
  .filter((name) => !["unstable.json", "updater-channels.json"].includes(name))
  .map((name) => path.join(dir, name));
execFileSync("gh", ["release", "upload", "unstable", ...assets, "--clobber"], {
  stdio: "inherit",
});
execFileSync(
  "gh",
  [
    "release",
    "upload",
    "unstable",
    path.join(dir, "updater-channels.json"),
    "--clobber",
  ],
  { stdio: "inherit" },
);
// Keep the previous feed usable if any earlier promotion step fails.
execFileSync(
  "gh",
  [
    "release",
    "upload",
    "unstable",
    path.join(dir, "unstable.json"),
    "--clobber",
  ],
  { stdio: "inherit" },
);
execFileSync(
  "gh",
  [
    "release",
    "edit",
    "unstable",
    "--draft=false",
    "--prerelease",
    "--latest=false",
    "--target",
    process.env.GITHUB_SHA,
    "--title",
    `PlayStash ${version} · Unstable`,
    "--notes-file",
    notesPath,
  ],
  { stdio: "inherit" },
);
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `published_version=${version}\n`);
