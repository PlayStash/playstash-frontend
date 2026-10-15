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
/**
 * What a stable build does with the release of its version:
 * - "create": no release yet, create a draft and publish it once complete.
 * - "resume": the draft of this commit exists (a re-run), finish it.
 * - "retarget": an unpublished draft of an earlier commit exists (its build
 *   failed or was superseded); it was never visible, so it is moved to this
 *   commit, its assets are replaced and it is published.
 * - "skip": the version is already published. Published versions are
 *   immutable; bump the version to publish a new release.
 */
export function stableReleasePlan(existing, commit) {
  if (!existing) return "create";
  if (existing.draft !== true) return "skip";
  return existing.target_commitish === commit ? "resume" : "retarget";
}
export function canPublishStable(existing, commit) {
  return stableReleasePlan(existing, commit) !== "skip";
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
/** Version and the release notes source must agree before anything ships. */
export async function readVersions(root = ".") {
  const read = (file) => readFile(`${root}/${file}`, "utf8");
  const pkg = JSON.parse(await read("package.json")).version;
  const tauri = JSON.parse(await read("src-tauri/tauri.conf.json")).version;
  const cargo = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(
    await read("src-tauri/Cargo.toml"),
  )?.[1];
  return { pkg, tauri, cargo };
}
export function validateVersions({ pkg, tauri, cargo }) {
  if (!/^\d+\.\d+\.\d+$/.test(pkg || ""))
    throw new Error(`package.json version must be MAJOR.MINOR.PATCH: ${pkg}`);
  // tauri.conf.json omits the version on purpose: Tauri then uses the
  // Cargo.toml version, which CI sets to the unstable build version.
  if (tauri !== undefined && tauri !== pkg)
    throw new Error(
      `src-tauri/tauri.conf.json version ${tauri} differs from package.json ${pkg}.`,
    );
  if (cargo !== pkg)
    throw new Error(
      `src-tauri/Cargo.toml version ${cargo} differs from package.json ${pkg}.`,
    );
}
async function main() {
  if (process.argv[2] === "--notes") {
    // Release notes for the updater feed: node scripts/plan-release.mjs --notes <out>
    const version = JSON.parse(await readFile("package.json", "utf8")).version;
    await writeFile(
      process.argv[3] || "release-notes.md",
      releaseNotes(await readFile("CHANGELOG.md", "utf8"), version),
    );
    return;
  }
  const versions = await readVersions();
  validateVersions(versions);
  const version = versions.pkg;
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
    } else {
      const plan = stableReleasePlan(existing, process.env.GITHUB_SHA);
      if (plan === "retarget") {
        // Remove the assets of the superseded build so the published release
        // only contains assets of this commit.
        for (const asset of existing.assets)
          execFileSync(
            "gh",
            ["release", "delete-asset", tag, asset.name, "--yes"],
            { stdio: "inherit" },
          );
        execFileSync(
          "gh",
          [
            "release",
            "edit",
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
      }
      publish = plan !== "skip";
      if (!publish)
        console.log(
          `::warning title=Release ${tag} is already published::Published releases are immutable: only workflow artifacts were built and the stable updater feed is unchanged. Bump the version in package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json and add a CHANGELOG.md section to publish a new release.`,
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
