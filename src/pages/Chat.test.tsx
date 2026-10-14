// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Chat from "./Chat";
import { CommunityProvider } from "@/context/CommunityContext";
import { createSocketMock, type SocketMock } from "@/test/communitySocketMock";
import { clearGameTitleCache } from "@/utils/gameTitles";

const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("socket.io-client", () => ({ io: mocks.io }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "http://library.test",
    user: { id: 1, api_key: "local-test-key" },
    authFetch: mocks.fetch,
  }),
}));
vi.mock("@/context/OfflineContext", () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));
vi.mock("@/utils/tauri", () => ({ isTauriApp: () => false }));

let socket: SocketMock;
const emitted = (event: string) =>
  socket.socket.emit.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => call[1]);

describe("library chat", { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    clearGameTitleCache();
    mocks.fetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/api/games/7")
          ? { id: 7, title: "celeste", metadata: { title: "Celeste" } }
          : [
              { id: 1, username: "Me" },
              { id: 2, username: "Other user" },
            ],
    }));
    mocks.io.mockImplementation(() => {
      socket = createSocketMock();
      return socket.socket;
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const mount = async (path = "/chat", conversation = "lobby") => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <CommunityProvider>
            <Chat />
          </CommunityProvider>
        </MemoryRouter>,
      );
    });
    act(() => socket.fire("chat-history", { conversation, messages: [] }));
  };
  it("authenticates in the handshake and deduplicates named send replies/broadcasts as text", async () => {
    await mount();
    expect(mocks.io).toHaveBeenCalledWith(
      "http://library.test",
      expect.objectContaining({ auth: { api_key: "local-test-key" } }),
    );
    expect(emitted("chat-history")).toEqual([{ room: "lobby", limit: 100 }]);
    const message = {
      id: "message-id",
      user_id: 2,
      username: "Other user",
      text: "<img src=x onerror=alert(1)>",
      created_at: "2026-10-13T12:00:00Z",
      room: "lobby",
    };
    act(() => {
      socket.fire("chat-message", message);
      socket.fire("chat-sent", message);
    });
    expect(screen.getAllByText(message.text)).toHaveLength(1);
    expect(document.querySelector("img")).toBeNull();
  });
  it("retries an unconfirmed send with exactly the same UUID and clears it on named confirmation", async () => {
    await mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const sent = emitted("chat-send")[0];
    expect(sent).toMatchObject({
      room: "lobby",
      text: "Hello",
      client_message_id: expect.any(String),
    });
    act(() => vi.advanceTimersByTime(12_000));
    fireEvent.click(screen.getByRole("button", { name: "Retry same message" }));
    const sends = emitted("chat-send");
    expect(sends[1]).toEqual(sends[0]);
    act(() =>
      socket.fire("chat-sent", {
        id: "server-id",
        user_id: 1,
        username: "Me",
        text: "Hello",
        room: "lobby",
        created_at: "2026-10-13T12:00:00Z",
        client_message_id: sent.client_message_id,
      }),
    );
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });
  it("does not show a direct message belonging to another conversation and binds presence to the community", async () => {
    await mount();
    act(() =>
      socket.fire("chat-message", {
        id: "private",
        user_id: 2,
        recipient_user_id: 1,
        username: "Other user",
        text: "Private message",
        created_at: "2026-10-13T12:00:00Z",
      }),
    );
    expect(screen.queryByText("Private message")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Your status" }), {
      target: { value: "INVISIBLE" },
    });
    expect(emitted("set-activity").slice(-1)[0]).toEqual({
      state: "INVISIBLE",
      game_id: null,
    });
    expect(
      localStorage.getItem(
        "playstash:community-presence:http://library.test:1",
      ),
    ).toBe("INVISIBLE");
  });
  it("preselects This Game for ?room=game:7", async () => {
    await mount("/chat?room=game:7", "game:7");
    await act(async () => {});
    const conversation = screen.getByRole("combobox", {
      name: "Conversation",
    }) as HTMLSelectElement;
    expect(conversation.value).toBe("this-game");
    expect(
      screen.getByRole("option", { name: "This Game — Celeste" }),
    ).toBeTruthy();
    expect(emitted("chat-history")).toEqual([{ room: "game:7", limit: 100 }]);
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "GG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(emitted("chat-send")[0]).toMatchObject({
      room: "game:7",
      text: "GG",
    });
  });
  it("opens a direct conversation for ?user=2", async () => {
    await mount("/chat?user=2", "dm:1:2");
    expect(emitted("chat-history")).toEqual([
      { recipient_user_id: 2, limit: 100 },
    ]);
  });
  it("lists online activity with names and game titles", async () => {
    await mount();
    act(() =>
      socket.fire("activities", [
        { user_id: 2, state: "PLAYING", game_id: 7 },
        { user_id: 9, state: "BUSY" },
      ]),
    );
    await act(async () => {});
    const list = screen.getByRole("region", { name: "Online Activity" });
    expect(list.textContent).toContain("Other user");
    expect(list.textContent).toContain("PLAYING — Celeste");
    expect(list.textContent).toContain("User #9");
    act(() => {
      socket.socket.connected = false;
      socket.fire("disconnect", "transport close");
    });
    expect(list.textContent).toContain("Nobody is online right now.");
  });
});
