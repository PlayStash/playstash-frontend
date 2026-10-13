import { createUuid } from "./uuid";
export type GameEventType =
  "downloaded" | "installed" | "uninstalled" | "played";
export interface GameEvent {
  event_id: string;
  type: GameEventType;
  version_id?: number;
  occurred_at: string;
  minutes_played?: number;
}
interface QueueEntry {
  key: string;
  gameId: number;
  event: GameEvent;
}
interface Queue {
  pending: QueueEntry[];
  completed: string[];
  installationCycles: Record<string, string>;
}
const active = new Map<string, Promise<void>>();

function read(key: string): Queue {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (Array.isArray(value?.pending) && Array.isArray(value?.completed))
      return { ...value, installationCycles: value.installationCycles || {} };
  } catch {}
  return { pending: [], completed: [], installationCycles: {} };
}
function write(key: string, value: Queue): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function enqueueGameEvent(
  storageKey: string,
  key: string,
  gameId: number,
  type: GameEventType,
  versionId?: number,
): void {
  const queue = read(storageKey);
  const installation = `${gameId}:${versionId || ""}`;
  if (type === "installed") {
    const cycle = (queue.installationCycles[installation] ||= createUuid());
    key = `${key}:${cycle}`;
  }
  if (type === "uninstalled") delete queue.installationCycles[installation];
  if (
    queue.completed.includes(key) ||
    queue.pending.some((entry) => entry.key === key)
  )
    return;
  queue.pending.push({
    key,
    gameId,
    event: {
      event_id: createUuid(),
      type,
      version_id: versionId,
      occurred_at: new Date().toISOString(),
      ...(type === "played" ? { minutes_played: 0 } : {}),
    },
  });
  write(storageKey, queue);
}
export function discardPendingGameEvents(storageKey: string): void {
  const queue = read(storageKey);
  queue.pending = [];
  write(storageKey, queue);
}
export function flushGameEvents(
  storageKey: string,
  serverUrl: string,
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  const running = active.get(storageKey);
  if (running) return running;
  const task = (async () => {
    for (const entry of read(storageKey).pending) {
      try {
        const response = await authFetch(
          `${serverUrl}/api/game/${entry.gameId}/events`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry.event),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) {
          if (response.status === 404 || response.status === 403) {
            /* Inaccessible/deleted games cannot be reported. */
          } else break;
        }
        const current = read(storageKey);
        current.pending = current.pending.filter(
          (item) => item.event.event_id !== entry.event.event_id,
        );
        current.completed = [...current.completed, entry.key].slice(-2000);
        write(storageKey, current);
      } catch {
        break;
      }
    }
  })().finally(() => active.delete(storageKey));
  active.set(storageKey, task);
  return task;
}
