import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_RETRY_INITIAL_DELAY_MS,
  DownloadAutoRetry,
  isAuthError,
} from "./autoRetry";

describe("download auto-retry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resumes after 10, 20 and 40 seconds", () => {
    const resume = vi.fn();
    const retry = new DownloadAutoRetry(resume);

    expect(retry.scheduleAfterError(1)).toBe(AUTO_RETRY_INITIAL_DELAY_MS);
    vi.advanceTimersByTime(9_999);
    expect(resume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(retry.isAutoRetryAttempt(1)).toBe(true);

    expect(retry.scheduleAfterError(1)).toBe(20_000);
    vi.advanceTimersByTime(19_999);
    expect(resume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(resume).toHaveBeenCalledTimes(2);

    expect(retry.scheduleAfterError(1)).toBe(40_000);
    vi.advanceTimersByTime(40_000);
    expect(resume).toHaveBeenCalledTimes(3);
    expect(resume).toHaveBeenCalledWith(1);
  });

  it("stops after a pause or cancel", () => {
    const resume = vi.fn();
    const retry = new DownloadAutoRetry(resume);
    retry.scheduleAfterError(1);
    retry.stop(1);
    vi.advanceTimersByTime(60_000);
    expect(resume).not.toHaveBeenCalled();
    expect(retry.isScheduled(1)).toBe(false);
  });

  it("keeps the backoff after a manual retry and resets it on success", () => {
    const resume = vi.fn();
    const retry = new DownloadAutoRetry(resume);
    retry.scheduleAfterError(1);
    retry.stop(1); // manual retry
    expect(retry.isAutoRetryAttempt(1)).toBe(false);
    expect(retry.scheduleAfterError(1)).toBe(20_000);
    retry.reset(1); // completed
    expect(retry.scheduleAfterError(1)).toBe(10_000);
  });

  it("tracks each card separately", () => {
    const resume = vi.fn();
    const retry = new DownloadAutoRetry(resume);
    retry.scheduleAfterError(1);
    retry.scheduleAfterError(2);
    retry.stopAll();
    vi.advanceTimersByTime(60_000);
    expect(resume).not.toHaveBeenCalled();
  });

  it("recognizes rejected sessions", () => {
    expect(isAuthError("HTTP 401 Unauthorized")).toBe(true);
    expect(isAuthError("HTTP 403 Forbidden")).toBe(true);
    expect(isAuthError("Stream failed: connection reset")).toBe(false);
    expect(isAuthError("received 14010 bytes")).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});
