import { Fetch, type ManagerOptions } from "socket.io-client";
import { serverFetch } from "@/utils/serverFetch";
import { getAdditionalRequestHeaders } from "@/utils/requestHeaders";

/**
 * socket.io HTTP long-polling through `serverFetch`.
 *
 * Browser WebSockets cannot carry custom headers, so with additional request
 * headers (e.g. Cloudflare Access service tokens) the community connection
 * must poll. Polling from the webview with those headers is a cross-origin
 * request with custom headers, which needs a CORS preflight that such proxies
 * reject (the OPTIONS request carries no credentials) and that the PlayStash
 * server does not allow for arbitrary header names either. This transport
 * sends every poll and write through `serverFetch`, which routes requests to
 * the configured server through Rust (`server_fetch`) when headers are
 * configured: no preflight, and the headers are added there like for every
 * other server request (WPF `SocketIoTransport`).
 *
 * The transport keeps the name `polling`, so the server sees a standard
 * engine.io polling client.
 */
export class ServerPolling extends Fetch {
  override doPoll(): void {
    this.request()
      .then((response) => {
        if (!response.ok) {
          this.onError("fetch read error", response.status, response);
          return;
        }
        return response.text().then((data) => this.onData(data));
      })
      .catch((error) => {
        this.onError("fetch read error", error);
      });
  }

  override doWrite(data: string, callback: () => void): void {
    this.request(data)
      .then((response) => {
        if (!response.ok) {
          this.onError("fetch write error", response.status, response);
          return;
        }
        callback();
      })
      .catch((error) => {
        this.onError("fetch write error", error);
      });
  }

  private request(data?: string): Promise<Response> {
    const isPost = data !== undefined;
    const { extraHeaders } = this.opts as {
      extraHeaders?: Record<string, string>;
    };
    const headers = new Headers(extraHeaders);
    if (isPost) headers.set("content-type", "text/plain;charset=UTF-8");
    return serverFetch(this.uri(), {
      method: isPost ? "POST" : "GET",
      body: isPost ? data : null,
      headers,
      credentials: "omit",
    });
  }
}

/**
 * socket.io options for the community connection: with additional request
 * headers, the polling transport above (headers sent by `serverFetch`);
 * otherwise the defaults (WebSocket upgrade allowed).
 */
export function socketIoHeaderOptions(): Partial<ManagerOptions> {
  const extraHeaders = getAdditionalRequestHeaders();
  if (!Object.keys(extraHeaders).length) return {};
  return { extraHeaders, transports: [ServerPolling], upgrade: false };
}
