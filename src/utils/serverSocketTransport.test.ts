// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(),
}));
vi.mock("@/utils/tauri", () => ({
  isTauriApp: () => mocks.tauri,
  isTauriDesktop: () => mocks.tauri,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { __setRequestHeadersForTests } from "./requestHeaders";
import { ServerPolling, socketIoHeaderOptions } from "./serverSocketTransport";

const SERVER = "https://games.example.com";

function packed(status: number, body: string): ArrayBuffer {
  const meta = new TextEncoder().encode(
    JSON.stringify({ status, statusText: "", headers: [], url: "" }),
  );
  const data = new TextEncoder().encode(body);
  const out = new Uint8Array(4 + meta.length + data.length);
  new DataView(out.buffer).setUint32(0, meta.length);
  out.set(meta, 4);
  out.set(data, 4 + meta.length);
  return out.buffer;
}

function transport() {
  return new ServerPolling({
    hostname: "games.example.com",
    secure: true,
    port: "443",
    path: "/socket.io/",
    query: { EIO: "4", transport: "polling" },
    extraHeaders: { "CF-Access-Client-Id": "abc" },
    socket: {},
  });
}

beforeEach(() => {
  mocks.tauri = true;
  mocks.invoke.mockReset();
  __setRequestHeadersForTests(
    [{ name: "CF-Access-Client-Id", value: "abc" }],
    SERVER,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("socketIoHeaderOptions", () => {
  it("uses the defaults without additional headers", () => {
    __setRequestHeadersForTests([], SERVER);
    expect(socketIoHeaderOptions()).toEqual({});
    mocks.tauri = false;
    expect(socketIoHeaderOptions()).toEqual({});
  });

  it("polls through the server transport with the headers", () => {
    expect(socketIoHeaderOptions()).toEqual({
      extraHeaders: { "CF-Access-Client-Id": "abc" },
      transports: [ServerPolling],
      upgrade: false,
    });
  });
});

describe("ServerPolling", () => {
  it("keeps the engine.io transport name", () => {
    expect(transport().name).toBe("polling");
  });

  it("sends polls and writes from Rust instead of the webview", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.invoke.mockResolvedValue(packed(200, "ok"));
    const polling = transport();
    const onData = vi.spyOn(polling, "onData").mockImplementation(() => {});
    polling.doPoll();
    await vi.waitFor(() => expect(onData).toHaveBeenCalledWith("ok"));

    const callback = vi.fn();
    polling.doWrite("4hello", callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());

    expect(fetchMock).not.toHaveBeenCalled();
    const [[pollCommand, poll], [, write]] = mocks.invoke.mock.calls;
    expect(pollCommand).toBe("server_fetch");
    expect(poll.method).toBe("GET");
    expect(poll.url).toMatch(
      /^https:\/\/games\.example\.com\/socket\.io\/\?EIO=4&transport=polling/,
    );
    expect(new Map(poll.headers).get("cf-access-client-id")).toBe("abc");
    expect(write.method).toBe("POST");
    expect(atob(write.bodyBase64)).toBe("4hello");
  });

  it("reports HTTP errors to engine.io", async () => {
    mocks.invoke.mockResolvedValue(packed(403, "denied"));
    const polling = transport();
    const onError = vi.fn();
    polling.on("error", onError);
    polling.doPoll();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
