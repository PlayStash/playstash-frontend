// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: true,
  desktop: false,
  invoke: vi.fn(),
}));
vi.mock("@/utils/tauri", () => ({
  isTauriApp: () => mocks.tauri,
  isTauriDesktop: () => mocks.desktop,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  __setRequestHeadersForTests,
  additionalHeadersFor,
  getAdditionalRequestHeaders,
  isServerResource,
  sanitizeRequestHeaders,
  saveAdditionalRequestHeaders,
  socketIoHeaderOptions,
  validateHeaderName,
} from "./requestHeaders";
import { serverFetch, unpackNativeResponse } from "./serverFetch";

const SERVER = "https://games.example.com/playstash";
const HEADERS = [{ name: "CF-Access-Client-Id", value: "abc" }];

beforeEach(() => {
  mocks.tauri = true;
  mocks.desktop = false;
  mocks.invoke.mockReset();
  __setRequestHeadersForTests(HEADERS, SERVER);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("isServerResource", () => {
  it("accepts the server and its sub paths only", () => {
    expect(isServerResource(`${SERVER}`, SERVER)).toBe(true);
    expect(isServerResource(`${SERVER}/api/games`, SERVER)).toBe(true);
    expect(
      isServerResource("https://GAMES.example.com:443/playstash/api", SERVER),
    ).toBe(true);
  });

  it("rejects other origins, ports, prefixes and encoded tricks", () => {
    for (const url of [
      "http://games.example.com/playstash/api",
      "https://games.example.com:8443/playstash/api",
      "https://evil.example.com/playstash/api",
      "https://games.example.com/playstashx/api",
      "https://games.example.com/other",
      "https://user:pw@games.example.com/playstash/api",
      "https://games.example.com/playstash%2fapi",
      "https://games.example.com/playstash/a%5cb",
      "https://games.example.com/playstash/../api",
      "not a url",
    ]) {
      expect(isServerResource(url, SERVER), url).toBe(false);
    }
  });
});

describe("header validation", () => {
  it("rejects forbidden and malformed names", () => {
    for (const name of [
      "Authorization",
      "host",
      "COOKIE",
      "Content-Length",
      "Bad Header",
      "x:y",
      "",
    ]) {
      expect(validateHeaderName(name), name).not.toBeNull();
    }
    expect(validateHeaderName("X-Proxy-Key")).toBeNull();
  });

  it("drops rows with an empty name or value and throws on invalid ones", () => {
    expect(
      sanitizeRequestHeaders([
        { name: " X-A ", value: " 1 " },
        { name: "", value: "x" },
        { name: "X-B", value: "  " },
      ]),
    ).toEqual([{ name: "X-A", value: "1" }]);
    expect(() =>
      sanitizeRequestHeaders([{ name: "Authorization", value: "x" }]),
    ).toThrow(/cannot be overridden/);
    expect(() =>
      sanitizeRequestHeaders([{ name: "X-A", value: "ü" }]),
    ).toThrow();
  });
});

describe("applying the headers", () => {
  it("adds them only for server resources", () => {
    expect(additionalHeadersFor(`${SERVER}/api/status`)).toEqual({
      "CF-Access-Client-Id": "abc",
    });
    expect(additionalHeadersFor("https://cdn.example.com/x.png")).toEqual({});
    expect(additionalHeadersFor("https://games.example.com/elsewhere")).toEqual(
      {},
    );
  });

  it("are never applied on the web build", () => {
    mocks.tauri = false;
    expect(getAdditionalRequestHeaders()).toEqual({});
    expect(socketIoHeaderOptions()).toEqual({});
  });

  it("forces the polling transport for socket.io", () => {
    expect(socketIoHeaderOptions()).toEqual({
      extraHeaders: { "CF-Access-Client-Id": "abc" },
      transports: ["polling"],
    });
  });

  it("serverFetch sends them to the server and never to other hosts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await serverFetch(`${SERVER}/api/status`, {
      headers: { Accept: "application/json" },
    });
    let headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("CF-Access-Client-Id")).toBe("abc");
    expect(headers.get("Accept")).toBe("application/json");

    await serverFetch("https://other.example.com/api/status", {});
    expect(fetchMock.mock.calls[1][1]).toEqual({});
    headers = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(headers.get("CF-Access-Client-Id")).toBeNull();
  });

  it("routes through Rust in the desktop app and rebuilds the response", async () => {
    mocks.desktop = true;
    const meta = new TextEncoder().encode(
      JSON.stringify({
        status: 200,
        statusText: "OK",
        headers: [["content-type", "application/json"]],
        url: "",
      }),
    );
    const body = new TextEncoder().encode('{"ok":true}');
    const packed = new Uint8Array(4 + meta.length + body.length);
    new DataView(packed.buffer).setUint32(0, meta.length);
    packed.set(meta, 4);
    packed.set(body, 4 + meta.length);
    mocks.invoke.mockResolvedValue(packed.buffer);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await serverFetch(`${SERVER}/api/games`, {
      method: "POST",
      body: "payload",
      headers: { Authorization: "Bearer t" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true });
    const [command, args] = mocks.invoke.mock.calls[0];
    expect(command).toBe("server_fetch");
    expect(args.method).toBe("POST");
    expect(atob(args.bodyBase64)).toBe("payload");
    const sent = new Map(args.headers as [string, string][]);
    expect(sent.get("authorization")).toBe("Bearer t");
    expect(sent.get("cf-access-client-id")).toBe("abc");
  });

  it("unpacks the native response layout", () => {
    const packed = new Uint8Array([0, 0, 0, 2, 123, 125, 104, 105]);
    const { meta, body } = unpackNativeResponse(packed);
    expect(meta).toEqual({});
    expect(new TextDecoder().decode(body)).toBe("hi");
  });
});

describe("saving", () => {
  it("persists through Rust in the desktop app", async () => {
    mocks.desktop = true;
    mocks.invoke.mockResolvedValue([{ name: "X-A", value: "1" }]);
    const saved = await saveAdditionalRequestHeaders([
      { name: "X-A", value: "1" },
      { name: "", value: "" },
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "set_additional_request_headers",
      {
        headers: [{ name: "X-A", value: "1" }],
      },
    );
    expect(saved).toEqual([{ name: "X-A", value: "1" }]);
  });
});
