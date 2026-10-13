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
export function readRelease(repository, endpoint, request = api) {
  try {
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository || ""))
      throw new Error("Expected an owner/repository name.");
    const [owner, name] = repository.split("/");
    let release;
    if (endpoint.startsWith("tags/") && endpoint.length > 5) {
      const tag = endpoint.slice(5);
      // GraphQL includes pending draft tags. REST by ID supplies the same
      // complete metadata and asset shape as a published release lookup.
      const lookup = JSON.parse(
        request("graphql", [
          "-f",
          "query=query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){id release(tagName:$tag){databaseId isDraft}}}",
          "-f",
          `owner=${owner}`,
          "-f",
          `name=${name}`,
          "-f",
          `tag=${tag}`,
        ]),
      );
      const repo = lookup?.data?.repository;
      if (
        (Object.hasOwn(lookup, "errors") &&
          (!Array.isArray(lookup.errors) || lookup.errors.length > 0)) ||
        !repo ||
        typeof repo.id !== "string" ||
        !repo.id ||
        !Object.hasOwn(repo, "release")
      )
        throw new Error("The repository release query was not valid.");
      if (repo.release === null) return null;
      const found = repo.release;
      if (
        !Number.isSafeInteger(found?.databaseId) ||
        found.databaseId <= 0 ||
        typeof found.isDraft !== "boolean"
      )
        throw new Error("The release query returned invalid metadata.");
      release = JSON.parse(
        request(`repos/${repository}/releases/${found.databaseId}`),
      );
      if (
        release?.id !== found.databaseId ||
        release?.tag_name !== tag ||
        release?.draft !== found.isDraft
      )
        throw new Error("The release changed during lookup.");
    } else if (endpoint === "latest") {
      try {
        release = JSON.parse(request(`repos/${repository}/releases/latest`));
      } catch (error) {
        if (!String(error.stderr).includes("HTTP 404")) throw error;
        // A private or inaccessible repository also returns 404. Confirm
        // repository access before treating latest as an absent release.
        const repo = JSON.parse(request(`repos/${repository}`));
        if (
          !Number.isSafeInteger(repo?.id) ||
          repo.id <= 0 ||
          repo.full_name?.toLowerCase() !== repository.toLowerCase()
        )
          throw new Error("Could not confirm repository access.");
        return null;
      }
    } else {
      throw new Error("Unsupported release lookup.");
    }
    if (
      !Number.isSafeInteger(release?.id) ||
      release.id <= 0 ||
      typeof release.tag_name !== "string" ||
      !release.tag_name ||
      typeof release.draft !== "boolean" ||
      typeof release.target_commitish !== "string" ||
      !release.target_commitish ||
      !Array.isArray(release.assets)
    )
      throw new Error("The REST release metadata was not valid.");
    return release;
  } catch {
    throw new Error(
      "Could not authenticate/read valid GitHub release metadata; refusing to replace releases or updater channels.",
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
