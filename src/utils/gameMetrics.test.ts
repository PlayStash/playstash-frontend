import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardPendingGameEvents,
  enqueueGameEvent,
  flushGameEvents,
} from "./gameMetrics";
describe("durable lifecycle events", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("reports a reinstallation while ignoring a repeated completion callback", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    enqueueGameEvent("queue", "installed-path", 7, "installed", 2);
    enqueueGameEvent("queue", "installed-path", 7, "installed", 2);
    await flushGameEvents("queue", "http://server", fetch);
    enqueueGameEvent("queue", "uninstall-1", 7, "uninstalled", 2);
    enqueueGameEvent("queue", "installed-path", 7, "installed", 2);
    await flushGameEvents("queue", "http://server", fetch);
    expect(
      fetch.mock.calls.map((call) => JSON.parse(call[1].body).type),
    ).toEqual(["installed", "uninstalled", "installed"]);
  });
  it("retries the persisted UUID and doesn't repeat a completed action", async () => {
    enqueueGameEvent("queue", "install-1", 7, "installed", 2);
    const offline = vi.fn().mockRejectedValue(new Error("Offline"));
    await flushGameEvents("queue", "http://server", offline);
    const first = JSON.parse(offline.mock.calls[0][1].body);
    const online = vi.fn().mockResolvedValue(new Response("{}"));
    await flushGameEvents("queue", "http://server", online);
    expect(JSON.parse(online.mock.calls[0][1].body).event_id).toBe(
      first.event_id,
    );
    enqueueGameEvent("queue", "install-1", 7, "installed", 2);
    await flushGameEvents("queue", "http://server", online);
    expect(online).toHaveBeenCalledTimes(1);
  });
  it("drops pending actions on opt-out and isolates accounts", async () => {
    enqueueGameEvent("user-a", "download-1", 1, "downloaded");
    enqueueGameEvent("user-b", "download-1", 1, "downloaded");
    discardPendingGameEvents("user-a");
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    await flushGameEvents("user-a", "http://server", fetch);
    expect(fetch).not.toHaveBeenCalled();
    await flushGameEvents("user-b", "http://server", fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
