// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  activityNotification,
  activityPayload,
  applyActivityEvent,
  chatNotification,
  getCommunityNotificationsEnabled,
  loadPresence,
  normalizePresence,
  presenceStorageKey,
  savePresence,
  setCommunityNotificationsEnabled,
  truncateNotificationText,
  type ActivityEntry,
  type ChatNotificationInput,
} from "./communityNotifications";

const roomMessage = {
  user_id: 2,
  username: "Alice",
  text: "Hello",
  room: "lobby",
};

function chat(overrides: Partial<ChatNotificationInput> = {}) {
  return chatNotification({
    message: roomMessage,
    ownUserId: 1,
    presence: "ONLINE",
    enabled: true,
    windowFocused: false,
    openConversation: null,
    ...overrides,
  });
}

describe("presence", () => {
  beforeEach(() => localStorage.clear());

  it("normalizes unknown values to ONLINE", () => {
    expect(normalizePresence("BUSY")).toBe("BUSY");
    expect(normalizePresence("INVISIBLE")).toBe("INVISIBLE");
    expect(normalizePresence("PLAYING")).toBe("ONLINE");
    expect(normalizePresence(null)).toBe("ONLINE");
  });

  it("persists per server and user", () => {
    savePresence("https://a.test/", 5, "BUSY");
    expect(localStorage.getItem(presenceStorageKey("https://a.test", 5))).toBe(
      "BUSY",
    );
    expect(loadPresence("https://a.test", 5)).toBe("BUSY");
    expect(loadPresence("https://a.test", 6)).toBe("ONLINE");
    expect(loadPresence("https://b.test", 5)).toBe("ONLINE");
  });
});

describe("activity payload", () => {
  it("publishes PLAYING with the game unless invisible", () => {
    expect(activityPayload("ONLINE", 7)).toEqual({
      state: "PLAYING",
      game_id: 7,
    });
    expect(activityPayload("BUSY", 7)).toEqual({
      state: "PLAYING",
      game_id: 7,
    });
    expect(activityPayload("INVISIBLE", 7)).toEqual({
      state: "INVISIBLE",
      game_id: null,
    });
    expect(activityPayload("BUSY", null)).toEqual({
      state: "BUSY",
      game_id: null,
    });
  });
});

describe("notification settings", () => {
  beforeEach(() => localStorage.clear());

  it("default to off and store 1/0", () => {
    expect(getCommunityNotificationsEnabled("chat")).toBe(false);
    expect(getCommunityNotificationsEnabled("activity")).toBe(false);
    setCommunityNotificationsEnabled("chat", true);
    expect(localStorage.getItem("playstash_chat_notifications")).toBe("1");
    expect(getCommunityNotificationsEnabled("chat")).toBe(true);
    setCommunityNotificationsEnabled("activity", false);
    expect(localStorage.getItem("playstash_activity_notifications")).toBe("0");
  });
});

describe("chat notifications", () => {
  it("shows the sender and text", () => {
    expect(chat()).toEqual({ title: "PlayStash — Alice", body: "Hello" });
  });

  it("truncates after 160 characters with an ellipsis", () => {
    const text = "x".repeat(161);
    expect(chat({ message: { ...roomMessage, text } })?.body).toBe(
      `${"x".repeat(160)}…`,
    );
    expect(truncateNotificationText("y".repeat(160))).toBe("y".repeat(160));
  });

  it("is suppressed while invisible, when disabled or for own messages", () => {
    expect(chat({ presence: "INVISIBLE" })).toBeNull();
    expect(chat({ enabled: false })).toBeNull();
    expect(chat({ ownUserId: 2 })).toBeNull();
  });

  it("is suppressed only when the window is focused on that room", () => {
    const open = { room: "lobby" };
    expect(chat({ windowFocused: true, openConversation: open })).toBeNull();
    expect(
      chat({ windowFocused: false, openConversation: open }),
    ).not.toBeNull();
    expect(
      chat({ windowFocused: true, openConversation: { room: "game:3" } }),
    ).not.toBeNull();
    expect(
      chat({ windowFocused: true, openConversation: { recipient_user_id: 2 } }),
    ).not.toBeNull();
  });

  it("matches direct messages by sender", () => {
    const direct = { ...roomMessage, room: undefined, recipient_user_id: 1 };
    expect(
      chat({
        message: direct,
        windowFocused: true,
        openConversation: { recipient_user_id: 2 },
      }),
    ).toBeNull();
    expect(
      chat({
        message: direct,
        windowFocused: true,
        openConversation: { recipient_user_id: 3 },
      }),
    ).not.toBeNull();
    expect(
      chat({
        message: direct,
        windowFocused: true,
        openConversation: { room: "lobby" },
      }),
    ).not.toBeNull();
  });
});

describe("activity notifications", () => {
  const snapshot = applyActivityEvent(new Map(), false, "activities", [
    { user_id: 2, state: "ONLINE" },
    { user_id: 1, state: "ONLINE" },
    { user_id: 3, state: "PLAYING", game_id: 9 },
  ]);

  const notifyFor = (
    event: "activity" | "remove-activity",
    payload: unknown,
    options: Partial<Parameters<typeof activityNotification>[0]> = {},
    base: { activities: Map<number, ActivityEntry>; snapshot: boolean } = {
      activities: snapshot.activities,
      snapshot: true,
    },
  ) =>
    activityNotification({
      update: applyActivityEvent(
        base.activities,
        base.snapshot,
        event,
        payload,
      ),
      snapshotReceived: base.snapshot,
      ownUserId: 1,
      presence: "ONLINE",
      enabled: true,
      ...options,
    });

  it("reads the snapshot with game ids", () => {
    expect(snapshot.snapshotReceived).toBe(true);
    expect(snapshot.activities.get(3)).toEqual({ state: "PLAYING", gameId: 9 });
  });

  it("notifies a changed state with the user name", () => {
    expect(
      notifyFor("activity", { user_id: 2, state: "BUSY" }, { username: "Bob" }),
    ).toEqual({ title: "PlayStash Activity", body: "Bob: BUSY" });
    expect(notifyFor("activity", { user_id: 2, state: "BUSY" })?.body).toBe(
      "User #2: BUSY",
    );
  });

  it("treats remove-activity as OFFLINE", () => {
    const update = applyActivityEvent(
      snapshot.activities,
      true,
      "remove-activity",
      { user_id: 2 },
    );
    expect(update.activities.has(2)).toBe(false);
    expect(update.changed).toEqual({ userId: 2, state: "OFFLINE" });
    expect(notifyFor("remove-activity", { user_id: 2 })?.body).toBe(
      "User #2: OFFLINE",
    );
  });

  it("stays silent before the first snapshot", () => {
    expect(
      notifyFor(
        "activity",
        { user_id: 2, state: "BUSY" },
        {},
        { activities: new Map(), snapshot: false },
      ),
    ).toBeNull();
  });

  it("stays silent without a change, for yourself, invisible or disabled", () => {
    expect(notifyFor("activity", { user_id: 2, state: "ONLINE" })).toBeNull();
    expect(notifyFor("activity", { user_id: 1, state: "BUSY" })).toBeNull();
    expect(
      notifyFor(
        "activity",
        { user_id: 2, state: "BUSY" },
        { presence: "INVISIBLE" },
      ),
    ).toBeNull();
    expect(
      notifyFor("activity", { user_id: 2, state: "BUSY" }, { enabled: false }),
    ).toBeNull();
  });

  it("defaults a missing state to ONLINE", () => {
    const update = applyActivityEvent(new Map(), true, "activity", {
      user_id: 4,
    });
    expect(update.activities.get(4)).toEqual({ state: "ONLINE" });
  });
});
