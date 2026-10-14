import { isTauriDesktop } from "@/utils/tauri";
import {
  additionalHeadersFor,
  getServerContext,
  hasAdditionalRequestHeaders,
  isNativeServerRequestsEnabled,
  isServerResource,
} from "@/utils/requestHeaders";

/**
 * `fetch` for requests to the PlayStash server.
 *
 * - Adds the additional request headers when `url` is a resource of `server`
 *   (default: the current server context). Never for other hosts.
 * - In the desktop app with additional headers configured, the request is
 *   sent from Rust (`server_fetch`) instead of the webview. Custom headers on
 *   a cross-origin webview request trigger a CORS preflight, which reverse
 *   proxies such as Cloudflare Access reject. Rust only proxies resources of
 *   the server context, so the context must be set first (`setServerContext`).
 *   Trade-off: the response is buffered (no streaming) and an aborted request
 *   is only abandoned, not cancelled on the wire.
 */
export async function serverFetch(
  url: string,
  init: RequestInit = {},
  server: string = getServerContext(),
): Promise<Response> {
  const extra = additionalHeadersFor(url, server);
  if (!Object.keys(extra).length) return fetch(url, init);

  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(extra)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const merged: RequestInit = { ...init, headers };
  if (shouldUseNativeFetch(url, server)) return nativeFetch(url, merged);
  return fetch(url, merged);
}

export function shouldUseNativeFetch(url: string, server: string): boolean {
  return (
    isTauriDesktop() &&
    hasAdditionalRequestHeaders() &&
    isNativeServerRequestsEnabled() &&
    !!server &&
    server === getServerContext() &&
    isServerResource(url, server)
  );
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

interface NativeResponseMeta {
  status: number;
  statusText: string;
  headers: [string, string][];
  url: string;
}

/** Unpacks `[u32 BE meta length][meta JSON][body]` from `server_fetch`. */
export function unpackNativeResponse(packed: Uint8Array): {
  meta: NativeResponseMeta;
  body: Uint8Array;
} {
  const view = new DataView(
    packed.buffer,
    packed.byteOffset,
    packed.byteLength,
  );
  const metaLength = view.getUint32(0);
  const meta = JSON.parse(
    new TextDecoder().decode(packed.subarray(4, 4 + metaLength)),
  ) as NativeResponseMeta;
  return { meta, body: packed.subarray(4 + metaLength) };
}

async function nativeFetch(url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw abortError();
  const request = new Request(url, init);
  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD"
      ? null
      : new Uint8Array(await request.arrayBuffer());
  const headers: [string, string][] = [];
  request.headers.forEach((value, name) => headers.push([name, value]));

  const { invoke } = await import("@tauri-apps/api/core");
  const call = invoke<ArrayBuffer | number[]>("server_fetch", {
    url: request.url,
    method,
    headers,
    bodyBase64: body && body.length ? encodeBase64(body) : null,
  });
  const raw = await (signal
    ? Promise.race([
        call,
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(abortError()), {
            once: true,
          }),
        ),
      ])
    : call);
  const packed =
    raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw);
  const { meta, body: responseBody } = unpackNativeResponse(packed);
  if (
    meta.status >= 300 &&
    meta.status < 400 &&
    (init.redirect === "error" || init.redirect === undefined)
  ) {
    // The webview would follow or reject the redirect; Rust never follows
    // one (credentials must not leave the server). Match `redirect: "error"`.
    throw new TypeError(
      "Failed to fetch: the server answered with a redirect.",
    );
  }
  if (meta.status < 200 || meta.status > 599)
    throw new TypeError(`Failed to fetch: unexpected status ${meta.status}.`);
  const nullBody = method === "HEAD" || [204, 205, 304].includes(meta.status);
  return new Response(nullBody ? null : (responseBody as BodyInit), {
    status: meta.status,
    statusText: meta.statusText,
    headers: meta.headers,
  });
}
