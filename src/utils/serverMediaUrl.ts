/**
 * Media id of `url` when it points at the media API of the connected server
 * (`<server>/api/media/<id>`), else null. Such images need the session to
 * load, unlike external screenshot URLs.
 */
export function serverMediaId(
  url: string | null | undefined,
  serverUrl: string | null | undefined,
): number | null {
  if (!url || !serverUrl) return null;
  try {
    const server = new URL(serverUrl);
    const target = new URL(url, server);
    if (target.origin !== server.origin) return null;
    const base = server.pathname.replace(/\/+$/, "");
    const match = new RegExp(`^${escapeRegExp(base)}/api/media/(\\d+)/?$`).exec(
      target.pathname,
    );
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
