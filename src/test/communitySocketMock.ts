import { vi } from "vitest";

/**
 * Minimal socket.io client double: records handlers per event (several per
 * event, like the real client), `emit` calls and lets tests fire events.
 */
export function createSocketMock() {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  const managerHandlers: Record<string, ((...args: any[]) => void)[]> = {};
  const socket = {
    connected: false,
    active: true,
    emit: vi.fn(),
    on: (event: string, handler: (...args: any[]) => void) => {
      (handlers[event] ??= []).push(handler);
      return socket;
    },
    connect: vi.fn(() => {
      socket.connected = true;
      fire("connect");
      return socket;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      return socket;
    }),
    io: {
      on: (event: string, handler: (...args: any[]) => void) => {
        (managerHandlers[event] ??= []).push(handler);
      },
    },
  };
  function fire(event: string, ...args: any[]) {
    for (const handler of handlers[event] ?? []) handler(...args);
  }
  function fireManager(event: string, ...args: any[]) {
    for (const handler of managerHandlers[event] ?? []) handler(...args);
  }
  return { socket, handlers, fire, fireManager };
}

export type SocketMock = ReturnType<typeof createSocketMock>;
