// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityProvider, useCommunity } from "./CommunityContext";
import { createSocketMock, type SocketMock } from "@/test/communitySocketMock";

const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  user: { id: 1, api_key: "key-1" } as { id: number; api_key?: string } | null,
  online: true,
  tauri: false,
  activeGames: [] as {
    gameId: number;
    versionDirectory: string;
    startedAt: number;
  }[],
  notify: vi.fn(async () => {}),
  focused: false,
  fetch: vi.fn(),
}));
vi.mock("socket.io-client", () => ({ io: mocks.io }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "http://library.test",
    user: mocks.user,
    authFetch: mocks.fetch,
  }),
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: mocks.online }),
}));
vi.mock("@/hooks/useActiveGames", () => ({
  useActiveGames: () => mocks.activeGames,
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => mocks.tauri }));
vi.mock("@/utils/gameSessions", () => ({
  onGameSession: async () => () => {},
  onGameExited: async () => () => {},
}));
vi.mock("@/utils/osNotify", () => ({
  notify: mocks.notify,
  isMainWindowFocused: async () => mocks.focused,
}));

let socket: SocketMock;
let community: ReturnType<typeof useCommunity>;

function Probe() {
  community = useCommunity();
  return (
    <div>
      <span data-testid="status">{community.status}</span>
      <span data-testid="presence">{community.presence}</span>
    </div>
  );
}

const mount = async () => {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(
      <CommunityProvider>
        <Probe />
      </CommunityProvider>,
    );
  });
  return result!;
};

const activityCalls = () =>
  socket.socket.emit.mock.calls
    .filter((call) => call[0] === "set-activity")
    .map((call) => call[1]);

describe("CommunityProvider", { timeout: 20_000 }, () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.user = { id: 1, api_key: "key-1" };
    mocks.online = true;
    mocks.tauri = false;
    mocks.activeGames = [];
    mocks.focused = false;
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 2, username: "Alice" }],
    });
    mocks.io.mockImplementation(() => {
      socket = createSocketMock();
      return socket.socket;
    });
  });
  afterEach(cleanup);

  it("connects only with an API key", async () => {
    mocks.user = { id: 1 };
    await mount();
    expect(mocks.io).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe(
      "An API key is required for community activity and chat.",
    );
    cleanup();
    mocks.user = { id: 1, api_key: "key-1" };
    await mount();
    expect(mocks.io).toHaveBeenCalledWith(
      "http://library.test",
      expect.objectContaining({
        auth: { api_key: "key-1" },
        autoConnect: false,
        reconnectionDelay: 5000,
      }),
    );
    expect(socket.socket.emit).toHaveBeenCalledWith("get-activities", {});
  });

  it("stays offline without a connection", async () => {
    mocks.online = false;
    await mount();
    expect(mocks.io).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe(
      "Community is offline.",
    );
  });

  it("publishes PLAYING with the running game, and the presence when invisible", async () => {
    mocks.tauri = true;
    mocks.activeGames = [
      { gameId: 7, versionDirectory: "/g/Versions/1", startedAt: 1 },
    ];
    await mount();
    expect(activityCalls()).toEqual([{ state: "PLAYING", game_id: 7 }]);
    act(() => community.setPresence("INVISIBLE"));
    expect(activityCalls().slice(-1)[0]).toEqual({
      state: "INVISIBLE",
      game_id: null,
    });
    act(() => community.setPresence("BUSY"));
    expect(activityCalls().slice(-1)[0]).toEqual({
      state: "PLAYING",
      game_id: 7,
    });
    // Republishes only on change.
    act(() => community.setPresence("BUSY"));
    expect(activityCalls()).toHaveLength(3);
  });

  it("never publishes PLAYING on the web build", async () => {
    mocks.activeGames = [
      { gameId: 7, versionDirectory: "/g/Versions/1", startedAt: 1 },
    ];
    await mount();
    expect(activityCalls()).toEqual([{ state: "ONLINE", game_id: null }]);
  });

  it("keeps the presence across remounts", async () => {
    await mount();
    act(() => community.setPresence("BUSY"));
    cleanup();
    await mount();
    expect(screen.getByTestId("presence").textContent).toBe("BUSY");
    expect(activityCalls()).toEqual([{ state: "BUSY", game_id: null }]);
  });

  it("shows reconnect status texts", async () => {
    await mount();
    expect(screen.getByTestId("status").textContent).toBe(
      "Connected to community.",
    );
    act(() => {
      socket.socket.connected = false;
      socket.fire("disconnect", "transport close");
    });
    expect(screen.getByTestId("status").textContent).toBe(
      "Community is unavailable. Reconnecting…",
    );
    expect(() => community.emit("chat-send", {})).toThrow(
      "Community is offline. Please wait for a connection.",
    );
    act(() => socket.fireManager("reconnect_attempt", 1));
    expect(screen.getByTestId("status").textContent).toBe(
      "Connecting to community…",
    );
    act(() => {
      socket.socket.connected = true;
      socket.fire("connect");
    });
    expect(screen.getByTestId("status").textContent).toBe(
      "Connected to community.",
    );
  });

  it("retries 5 s after the server drops the connection", async () => {
    vi.useFakeTimers();
    try {
      await mount();
      socket.socket.connect.mockClear();
      act(() => {
        socket.socket.connected = false;
        socket.fire("disconnect", "io server disconnect");
      });
      act(() => vi.advanceTimersByTime(4_999));
      expect(socket.socket.connect).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(socket.socket.connect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards events to subscribers and clears activities on disconnect", async () => {
    await mount();
    const listener = vi.fn();
    act(() => {
      community.on("chat-message", listener);
    });
    act(() => socket.fire("activities", [{ user_id: 2, state: "BUSY" }]));
    expect(community.activities.get(2)).toEqual({ state: "BUSY" });
    act(() => socket.fire("chat-message", { id: "1", user_id: 2, text: "Hi" }));
    expect(listener).toHaveBeenCalledWith({ id: "1", user_id: 2, text: "Hi" });
    act(() => socket.fire("disconnect", "transport close"));
    expect(community.activities.size).toBe(0);
  });

  it("raises chat toasts unless the open conversation is focused", async () => {
    mocks.tauri = true;
    localStorage.setItem("playstash_chat_notifications", "1");
    await mount();
    const message = {
      id: "m",
      user_id: 2,
      username: "Alice",
      text: "Hello",
      room: "lobby",
      created_at: "2026-10-14T12:00:00Z",
    };
    await act(async () => socket.fire("chat-message", message));
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "PlayStash — Alice", body: "Hello" }),
    );
    mocks.notify.mockClear();
    mocks.focused = true;
    act(() => community.setOpenConversation({ room: "lobby" }));
    await act(async () => socket.fire("chat-message", message));
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("raises activity toasts with the user name after the snapshot", async () => {
    mocks.tauri = true;
    localStorage.setItem("playstash_activity_notifications", "1");
    await mount();
    await act(async () =>
      socket.fire("activity", { user_id: 2, state: "BUSY" }),
    );
    expect(mocks.notify).not.toHaveBeenCalled();
    act(() => socket.fire("activities", [{ user_id: 2, state: "ONLINE" }]));
    await act(async () => socket.fire("remove-activity", { user_id: 2 }));
    await act(async () => {});
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "PlayStash Activity",
        body: "Alice: OFFLINE",
      }),
    );
  });
});
