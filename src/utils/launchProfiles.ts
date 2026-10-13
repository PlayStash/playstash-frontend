import type { LaunchProfileDto } from "@/api";

export function validateLaunchProfiles(
  profiles: LaunchProfileDto[],
): string | null {
  for (const profile of profiles) {
    const path = profile.executable.replace(/\\/g, "/");
    if (
      !profile.name.trim() ||
      !path ||
      path.startsWith("/") ||
      path.includes(":") ||
      path.split("/").some((part) => part === "..")
    ) {
      return "Every profile needs a name and an executable path inside the installation.";
    }
  }
  return null;
}

export function moveSelectedAddon(
  ids: string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const next = [...ids];
  const index = next.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
