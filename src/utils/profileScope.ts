/**
 * Active profile id for per-profile preferences (themes, artwork search
 * providers). WP6 owns profiles and announces switches with the window
 * event `playstash:profile-changed` (`detail: { profileId }`); until a
 * profile is known, global keys are used.
 */

export const PROFILE_CHANGED_EVENT = "playstash:profile-changed";

let activeProfileId: string | null = null;
const listeners = new Set<(profileId: string | null) => void>();

/** Profile ids are used in file paths, so only a safe subset is accepted. */
export function normalizeProfileId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value))
    value = String(value);
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

export function getActiveProfileId(): string | null {
  return activeProfileId;
}

export function setActiveProfileId(value: unknown): void {
  const next = normalizeProfileId(value);
  if (next === activeProfileId) return;
  activeProfileId = next;
  listeners.forEach((listener) => listener(next));
}

export function onActiveProfileChange(
  listener: (profileId: string | null) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `key` for the global scope, `key:<profileId>` inside a profile. */
export function profileScopedKey(key: string): string {
  return activeProfileId ? `${key}:${activeProfileId}` : key;
}

/** Reads the profile id from a `playstash:profile-changed` event. */
export function profileIdFromEvent(event: Event): string | null {
  const detail = (event as CustomEvent).detail as
    { profileId?: unknown; id?: unknown } | string | number | null | undefined;
  if (detail && typeof detail === "object") {
    return normalizeProfileId(detail.profileId ?? detail.id);
  }
  return normalizeProfileId(detail);
}
