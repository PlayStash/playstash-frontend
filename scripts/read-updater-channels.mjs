import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
export function mergeExistingChannels(sources) {
  // The sources have an authoritative channel each: latest owns stable,
  // tags/unstable owns unstable. Aggregates may contain stale copies of the
  // other channel and currently have no publication timestamp to compare.
  const result = {};
  for (const source of sources)
    for (const channel of ["stable", "unstable"]) {
      const candidate = source[channel];
      if (!candidate) continue;
      if (
        !candidate.version ||
        !candidate.platforms ||
        typeof candidate.platforms !== "object"
      )
        throw new Error(`Invalid existing ${channel} updater manifest.`);
      if (!result[channel]) result[channel] = candidate;
    }
  if (sources[0]?.stable) result.stable = sources[0].stable;
  if (sources[1]?.unstable) result.unstable = sources[1].unstable;
  return result;
}
function api(endpoint, extra = []) {
  return execFileSync("gh", ["api", endpoint, ...extra], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
export function readRelease(repository, endpoint) {
  try {
    return JSON.parse(api(`repos/${repository}/releases/${endpoint}`));
  } catch (error) {
    if (String(error.stderr).includes("HTTP 404")) return null;
    throw new Error(
      "Could not authenticate/read existing GitHub release metadata; refusing to replace updater channels.",
    );
  }
}
async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY is required.");
  const sources = [];
  for (const endpoint of ["latest", "tags/unstable"]) {
    const release = readRelease(repository, endpoint);
    const asset = release?.assets?.find(
      (entry) => entry.name === "updater-channels.json",
    );
    if (!asset) {
      sources.push({});
      continue;
    }
    sources.push(
      JSON.parse(
        api(`repos/${repository}/releases/assets/${asset.id}`, [
          "-H",
          "Accept: application/octet-stream",
        ]),
      ),
    );
  }
  await writeFile(
    "existing-updater-channels.json",
    `${JSON.stringify(mergeExistingChannels(sources), null, 2)}\n`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
