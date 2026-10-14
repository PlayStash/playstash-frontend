import { describe, expect, it, vi } from "vitest";
import {
  buildSavedPasswords,
  DEFAULT_PASSWORD_PROMPT_TEXTS,
  passwordPromptFor,
  runPasswordAttempts,
  type ExtractionAttemptOutcome,
} from "./passwordOrder";

/** Attempt stub: succeeds only with `correct`. */
function attemptWith(correct: string | null) {
  return vi.fn(async (password: string | null) => ({
    outcome: (password === correct
      ? "success"
      : "needs-password") as ExtractionAttemptOutcome,
    result: { password },
  }));
}

describe("archive password order", () => {
  it("tries metadata, then the default password, without blanks or duplicates", () => {
    expect(buildSavedPasswords("meta", "default")).toEqual(["meta", "default"]);
    expect(buildSavedPasswords("", "default")).toEqual(["default"]);
    expect(buildSavedPasswords("same", "same")).toEqual(["same"]);
    expect(buildSavedPasswords(undefined, null, "  ")).toEqual([]);
  });

  it("uses the metadata password first", async () => {
    const attempt = attemptWith("meta");
    const prompt = vi.fn();
    const result = await runPasswordAttempts({
      savedPasswords: ["meta", "default"],
      attempt,
      prompt,
    });
    expect(result.outcome).toBe("success");
    expect(attempt.mock.calls.map(([pw]) => pw)).toEqual(["meta"]);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("falls back to the default password", async () => {
    const attempt = attemptWith("default");
    const result = await runPasswordAttempts({
      savedPasswords: ["meta", "default"],
      attempt,
      prompt: vi.fn(),
    });
    expect(result.outcome).toBe("success");
    expect(attempt.mock.calls.map(([pw]) => pw)).toEqual(["meta", "default"]);
  });

  it("prompts after a saved password failed and retries once", async () => {
    const attempt = attemptWith("typed");
    const prompt = vi.fn(async () => "typed");
    const result = await runPasswordAttempts({
      savedPasswords: ["default"],
      attempt,
      prompt,
    });
    expect(result.outcome).toBe("success");
    expect(prompt).toHaveBeenCalledWith({
      title: "Archive password",
      message: "The saved password did not work. Enter the archive password.",
    });
    expect(attempt.mock.calls.map(([pw]) => pw)).toEqual(["default", "typed"]);
  });

  it("asks for the password when nothing is saved", async () => {
    const attempt = attemptWith("typed");
    const prompt = vi.fn(async () => "typed");
    await runPasswordAttempts({ savedPasswords: [], attempt, prompt });
    expect(attempt.mock.calls.map(([pw]) => pw)).toEqual([null, "typed"]);
    expect(prompt).toHaveBeenCalledWith({
      title: "Archive password",
      message: "Enter the password required to extract this archive.",
    });
  });

  it("does not prompt for archives without a password", async () => {
    const attempt = attemptWith(null);
    const prompt = vi.fn();
    const result = await runPasswordAttempts({
      savedPasswords: [],
      attempt,
      prompt,
    });
    expect(result.outcome).toBe("success");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("ends with a wrong password when the prompt is cancelled", async () => {
    const result = await runPasswordAttempts({
      savedPasswords: ["default"],
      attempt: attemptWith("other"),
      prompt: vi.fn(async () => null),
    });
    expect(result).toMatchObject({
      outcome: "wrong-password",
      cancelled: true,
    });
  });

  it("ends with a wrong password when the prompted password fails too", async () => {
    const attempt = attemptWith("other");
    const result = await runPasswordAttempts({
      savedPasswords: [],
      attempt,
      prompt: vi.fn(async () => "typed"),
    });
    expect(result).toMatchObject({
      outcome: "wrong-password",
      cancelled: false,
    });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("stops on other errors", async () => {
    const attempt = vi.fn(async () => ({
      outcome: "error" as ExtractionAttemptOutcome,
      result: { message: "corrupt" },
    }));
    const prompt = vi.fn();
    const result = await runPasswordAttempts({
      savedPasswords: ["a", "b"],
      attempt,
      prompt,
    });
    expect(result.outcome).toBe("error");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("builds the prompt texts", () => {
    expect(passwordPromptFor(0).message).toBe(
      DEFAULT_PASSWORD_PROMPT_TEXTS.enterMessage,
    );
    expect(passwordPromptFor(2).message).toBe(
      DEFAULT_PASSWORD_PROMPT_TEXTS.savedFailedMessage,
    );
  });
});
