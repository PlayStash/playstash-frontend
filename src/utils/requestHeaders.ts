import { isTauriApp, isTauriDesktop } from "@/utils/tauri";

/**
 * Additional request headers ("Client Settings"), e.g. Cloudflare Access
 * service tokens or reverse-proxy credentials (WPF `AdditionalRequestHeaders`).
 *
 * They are global (not per profile), desktop only, and sent only to resources
 * of the configured PlayStash server: never to other hosts. Rust keeps the
 * persisted copy (settings section `connection.json`) and applies them to its
 * own server requests through `net::server_request`; this module mirrors them
 * in memory so `authFetch` and the socket.io client can read them synchronously.
 */
export interface RequestHeader {
  name: string;
  value: string;
}

export const REQUEST_HEADERS_CHANGE_EVENT = "playstash:request-headers-change";
/** "0" turns off routing server requests through the desktop app (see `serverFetch`). */
export const NATIVE_HTTP_STORAGE_KEY = "playstash_native_server_requests";

const FORBIDDEN_HEADER_NAMES = new Set([
  "authorization",
  "host",
  "cookie",
  "content-length",
]);
const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

let headers: RequestHeader[] = [];
let serverContext = "";
let loadPromise: Promise<void> | null = null;

/** Returns an error message for an invalid header name, or null. */
export function validateHeaderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || !TOKEN_PATTERN.test(trimmed))
    return `"${trimmed}" is not a valid header name.`;
  if (FORBIDDEN_HEADER_NAMES.has(trimmed.toLowerCase()))
    return `The header "${trimmed}" cannot be overridden.`;
  return null;
}

/** Returns an error message for an invalid header value, or null. */
export function validateHeaderValue(
  name: string,
  value: string,
): string | null {
  // Header values are visible ASCII plus spaces and tabs (fetch and reqwest
  // reject anything else).
  if (/[^\t\x20-\x7e]/.test(value.trim()))
    return `The value of "${name.trim()}" contains unsupported characters.`;
  return null;
}

/**
 * Drops rows with an empty name or value (like the WPF client), trims the
 * rest and validates them. Throws the first validation error.
 */
export function sanitizeRequestHeaders(list: RequestHeader[]): RequestHeader[] {
  const kept: RequestHeader[] = [];
  for (const entry of list) {
    const name = (entry.name ?? "").trim();
    const value = (entry.value ?? "").trim();
    if (!name || !value) continue;
    const error = validateHeaderName(name) ?? validateHeaderValue(name, value);
    if (error) throw new Error(error);
    kept.push({ name, value });
  }
  return kept;
}

/**
 * Mirrors the WPF `RequestTrust.IsServerResource` and Rust
 * `net::is_server_resource`: same scheme, host and port, no credentials, no
 * encoded slashes or dot segments, path equal to or below the server prefix.
 */
export function isServerResource(target: string, server: string): boolean {
  let base: URL;
  let request: URL;
  try {
    base = new URL(server);
    request = new URL(target);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(base.protocol)) return false;
  if (request.protocol !== base.protocol) return false;
  if (request.hostname.toLowerCase() !== base.hostname.toLowerCase())
    return false;
  if (request.port !== base.port) return false;
  if (request.username || request.password) return false;
  // Inspect the raw path: `URL` keeps `%2f` encoded but resolves dot segments.
  const rawPath = request.pathname;
  if (/%2f|%5c/i.test(rawPath) || rawPath.includes("\\")) return false;
  const hasDotSegment = rawPath.split("/").some((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === "." || decoded === "..";
    } catch {
      return true;
    }
  });
  if (hasDotSegment) return false;
  const prefix = base.pathname.replace(/\/+$/, "");
  return rawPath === prefix || rawPath.startsWith(`${prefix}/`);
}

function emitChange() {
  try {
    window.dispatchEvent(new CustomEvent(REQUEST_HEADERS_CHANGE_EVENT));
  } catch {
    /* no window (tests) */
  }
}

/** Current headers as a list (empty on the web build). */
export function getAdditionalRequestHeaderList(): RequestHeader[] {
  return isTauriApp() ? headers.map((entry) => ({ ...entry })) : [];
}

/**
 * Additional request headers sent with every request to the PlayStash server.
 * Applied inside `authFetch` and to the unauthenticated server calls; the
 * community socket uses them through `socketIoHeaderOptions`
 * (`serverSocketTransport.ts`).
 */
export function getAdditionalRequestHeaders(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of getAdditionalRequestHeaderList())
    result[entry.name] = entry.value;
  return result;
}

export function hasAdditionalRequestHeaders(): boolean {
  return getAdditionalRequestHeaderList().length > 0;
}

/**
 * The headers for `url`, but only when it is a resource of `server` (or of
 * the current server context when `server` is omitted).
 */
export function additionalHeadersFor(
  url: string,
  server: string = serverContext,
): Record<string, string> {
  if (!server || !isServerResource(url, server)) return {};
  return getAdditionalRequestHeaders();
}

/** Loads the persisted headers from Rust once (desktop). Safe to call often. */
export function initRequestHeaders(): Promise<void> {
  if (!isTauriApp()) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const loaded = await invoke<RequestHeader[]>(
          "get_additional_request_headers",
        );
        headers = Array.isArray(loaded) ? loaded : [];
        emitChange();
      } catch (error) {
        console.warn("[requestHeaders] loading failed", error);
      }
    })();
  }
  return loadPromise;
}

/**
 * Validates and stores the headers (desktop). Returns the saved list. Rows
 * with an empty name or value are dropped.
 */
export async function saveAdditionalRequestHeaders(
  list: RequestHeader[],
): Promise<RequestHeader[]> {
  const sanitized = sanitizeRequestHeaders(list);
  if (isTauriDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    headers = await invoke<RequestHeader[]>("set_additional_request_headers", {
      headers: sanitized,
    });
  } else {
    headers = sanitized;
  }
  emitChange();
  return getAdditionalRequestHeaderList();
}

/**
 * Tells Rust (and this module) which server the headers belong to. Called
 * whenever the active server changes.
 */
export async function setServerContext(serverUrl: string): Promise<void> {
  serverContext = serverUrl || "";
  if (!isTauriDesktop()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_server_context", { serverUrl: serverContext || null });
  } catch (error) {
    console.warn("[requestHeaders] set_server_context failed", error);
  }
}

export function getServerContext(): string {
  return serverContext;
}

/** Whether server requests are sent through the desktop app (default on). */
export function isNativeServerRequestsEnabled(): boolean {
  try {
    return localStorage.getItem(NATIVE_HTTP_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setNativeServerRequestsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(NATIVE_HTTP_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  emitChange();
}

/** Test helper: replaces the in-memory state. */
export function __setRequestHeadersForTests(
  list: RequestHeader[],
  server = "",
): void {
  headers = list;
  serverContext = server;
  loadPromise = null;
}
