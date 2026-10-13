import { appendFile, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readRelease } from "./read-updater-channels.mjs";

export function releaseNotes(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = changelog.match(
    new RegExp(`^## ${escaped}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"),
  );
  if (!section) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  return section[1].replace(/^Status:.*\n/gm, "").trim() + "\n";
}
export function validateVersionTag(ref, version) {
  if (ref.startsWith("refs/tags/") && ref !== `refs/tags/v${version}`)
    throw new Error(`Version tag must be v${version}, matching package.json.`);
}
export function canPublishStable(existing, commit) {
  return (
    !existing ||
    (existing.draft === true && existing.target_commitish === commit)
  );
}
export function stagingTag(commit, runId) {
  if (!/^[a-f0-9]{40}$/i.test(commit || "") || !/^\d+$/.test(runId || ""))
    throw new Error(
      "A build commit and workflow run ID are required for unstable staging.",
    );
  return `unstable-${commit.slice(0, 12)}-${runId}`;
}
export function stagedReleaseVersion(manifest, buildVersion) {
  const version = manifest?.version;
  if (
    !/^\d+\.\d+\.\d+-unstable\.\d+\.\d+$/.test(version || "") ||
    version.split("-")[0] !== buildVersion.split("-")[0]
  )
    throw new Error("The staged unstable feed has an invalid build version.");
  return version;
}
async function main() {
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  validateVersionTag(process.env.GITHUB_REF || "", version);
  await writeFile(
    "release-notes.md",
    releaseNotes(await readFile("CHANGELOG.md", "utf8"), version),
  );
  const isDev = process.env.GITHUB_REF === "refs/heads/dev";
  const tag = isDev
    ? stagingTag(process.env.GITHUB_SHA, process.env.GITHUB_RUN_ID)
    : `v${version}`;
  let publish = false;
  let publishUnstable = false,
    uploadDraft = false;
  const existing = readRelease(process.env.GITHUB_REPOSITORY, `tags/${tag}`);
  if (isDev) {
    if (!existing) {
      execFileSync(
        "gh",
        [
          "release",
          "create",
          tag,
          "--draft",
          "--prerelease",
          "--target",
          process.env.GITHUB_SHA,
          "--title",
          `PlayStash ${version} · Unstable build`,
          "--notes-file",
          "release-notes.md",
        ],
        { stdio: "inherit" },
      );
      uploadDraft = true;
    } else {
      if (existing.target_commitish !== process.env.GITHUB_SHA)
        throw new Error(
          "The unstable staging release belongs to a different commit.",
        );
      uploadDraft = existing.draft === true;
    }
    publishUnstable = true;
  } else {
    if (!existing) {
      execFileSync(
        "gh",
        [
          "release",
          "create",
          tag,
          "--draft",
          "--target",
          process.env.GITHUB_SHA,
          "--title",
          `PlayStash ${version}`,
          "--notes-file",
          "release-notes.md",
        ],
        { stdio: "inherit" },
      );
      publish = true;
    } else if (canPublishStable(existing, process.env.GITHUB_SHA)) {
      publish = true;
    } else {
      console.log(
        `Release ${tag} already exists; only workflow artifacts will be built. Published version assets and updater feeds remain unchanged.`,
      );
    }
    uploadDraft = publish;
  }
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `publish_stable=${publish}\npublish_unstable=${publishUnstable}\nupload_draft=${uploadDraft}\nrelease_tag=${tag}\n`,
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
