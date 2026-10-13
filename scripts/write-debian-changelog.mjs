import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [version] = process.argv.slice(2);

if (!version) {
  console.error("Usage: node scripts/write-debian-changelog.mjs <version>");
  process.exit(1);
}

const changelogPath = path.join(process.cwd(), "src-tauri", "debian-changelog");
const notes =
  process.env.PLAYSTASH_UPDATER_NOTES?.trim() ||
  "PlayStash frontend package build.";
const maintainer =
  process.env.PLAYSTASH_DEBIAN_MAINTAINER?.trim() ||
  "PlayStash Maintainers <maintainers@playstash.invalid>";
if (!/^[^\r\n<>]+ <[^\s<>@]+@[^\s<>@]+>$/.test(maintainer)) {
  throw new Error("PLAYSTASH_DEBIAN_MAINTAINER must use Name <email> format.");
}
const date = new Date().toUTCString().replace("GMT", "+0000");

const existing = await readFile(changelogPath, "utf8").catch(() => "");

// Debian changelogs list newest entries first. If the top entry already
// matches the version we are building (e.g. a stable build whose committed
// changelog already carries that entry), leave it untouched.
const topVersion = existing.match(/^playstash \(([^)]+)\)/)?.[1];
if (topVersion === version) {
  console.log(`debian-changelog already has an entry for ${version}; skipping`);
  process.exit(0);
}

const entry = [
  `playstash (${version}) unstable; urgency=medium`,
  "",
  `  * ${notes}`,
  "",
  ` -- ${maintainer}  ${date}`,
  "",
  "",
].join("\n");

await writeFile(changelogPath, `${entry}${existing}`);

console.log(`Wrote debian-changelog entry for ${version}`);
