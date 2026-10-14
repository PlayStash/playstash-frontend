/**
 * Automatic retry of failed downloads (WP5).
 *
 * After a download error the card resumes on its own: first after 10 s, and
 * the delay doubles after every failure (10, 20, 40 s, ...). The delay is not
 * reset by a manual retry within the session (like the old client); it is
 * reset once the download completes. Pausing, cancelling or deleting the card
 * stops the timer.
 */

export const AUTO_RETRY_INITIAL_DELAY_MS = 10_000;

/** Errors that must not be retried blindly: the session needs a new token. */
export function isAuthError(message: string | undefined | null): boolean {
  if (!message) return false;
  return /\b(401|403)\b/.test(message);
}

type TimerApi = {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const defaultTimers: TimerApi = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class DownloadAutoRetry {
  private readonly nextDelay = new Map<number, number>();
  private readonly timers = new Map<number, unknown>();
  private readonly autoAttempts = new Set<number>();

  constructor(
    private readonly resume: (gameId: number) => void,
    private readonly timerApi: TimerApi = defaultTimers,
  ) {}

  /**
   * Schedules the next automatic resume after an error. Returns the delay in
   * milliseconds. A timer that is already pending is replaced.
   */
  scheduleAfterError(gameId: number): number {
    this.clearTimer(gameId);
    const delay = this.nextDelay.get(gameId) ?? AUTO_RETRY_INITIAL_DELAY_MS;
    this.nextDelay.set(gameId, delay * 2);
    const handle = this.timerApi.setTimeout(() => {
      this.timers.delete(gameId);
      this.autoAttempts.add(gameId);
      this.resume(gameId);
    }, delay);
    this.timers.set(gameId, handle);
    return delay;
  }

  /**
   * True while the running attempt was started by the auto-retry, so a
   * failure is not the first error of this download.
   */
  isAutoRetryAttempt(gameId: number): boolean {
    return this.autoAttempts.has(gameId);
  }

  isScheduled(gameId: number): boolean {
    return this.timers.has(gameId);
  }

  /** Stops the pending retry (manual retry, pause, cancel, delete). */
  stop(gameId: number): void {
    this.clearTimer(gameId);
    this.autoAttempts.delete(gameId);
  }

  /** The download completed: forget the backoff for this card. */
  reset(gameId: number): void {
    this.stop(gameId);
    this.nextDelay.delete(gameId);
  }

  stopAll(): void {
    for (const gameId of [...this.timers.keys()]) this.stop(gameId);
    this.autoAttempts.clear();
  }

  private clearTimer(gameId: number): void {
    const handle = this.timers.get(gameId);
    if (handle !== undefined) {
      this.timerApi.clearTimeout(handle);
      this.timers.delete(gameId);
    }
  }
}
