// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Chat from "./Chat";
const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  emit: vi.fn(),
  fetch: vi.fn(),
  handlers: {} as Record<string, (...args: any[]) => void>,
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
describe("library chat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 2, username: "Other user" }],
    });
    mocks.handlers = {};
    mocks.io.mockImplementation(() => ({
      connected: true,
      on: (event: string, handler: (...args: any[]) => void) => {
        mocks.handlers[event] = handler;
      },
      emit: mocks.emit,
      connect: () => mocks.handlers.connect?.(),
      disconnect: vi.fn(),
    }));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const mount = async () => {
    await act(async () => {
      render(<Chat />);
    });
    act(() =>
      mocks.handlers["chat-history"]({ conversation: "lobby", messages: [] }),
    );
  };
  it("authenticates in the handshake and deduplicates named send replies/broadcasts as text", async () => {
    await mount();
    expect(mocks.io).toHaveBeenCalledWith(
      "http://library.test",
      expect.objectContaining({ auth: { api_key: "local-test-key" } }),
    );
    const message = {
      id: "message-id",
      user_id: 2,
      username: "Other user",
      text: "<img src=x onerror=alert(1)>",
      created_at: "2026-10-13T12:00:00Z",
      room: "lobby",
    };
    act(() => {
      mocks.handlers["chat-message"](message);
      mocks.handlers["chat-sent"](message);
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
    const sent = mocks.emit.mock.calls.find(
      (call) => call[0] === "chat-send",
    )?.[1];
    expect(sent).toMatchObject({
      room: "lobby",
      text: "Hello",
      client_message_id: expect.any(String),
    });
    act(() => vi.advanceTimersByTime(12_000));
    fireEvent.click(screen.getByRole("button", { name: "Retry same message" }));
    const sends = mocks.emit.mock.calls.filter(
      (call) => call[0] === "chat-send",
    );
    expect(sends[1][1]).toEqual(sends[0][1]);
    act(() =>
      mocks.handlers["chat-sent"]({
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
  it("does not show a direct message belonging to another conversation", async () => {
    await mount();
    act(() =>
      mocks.handlers["chat-message"]({
        id: "private",
        user_id: 2,
        recipient_user_id: 1,
        username: "Other user",
        text: "Private message",
        created_at: "2026-10-13T12:00:00Z",
      }),
    );
    expect(screen.queryByText("Private message")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "My visibility" }), {
      target: { value: "INVISIBLE" },
    });
    expect(mocks.emit).toHaveBeenCalledWith("set-activity", {
      state: "INVISIBLE",
    });
  });
});
