/**
 * Archive password order (pure).
 *
 * An encrypted archive is tried with, in order:
 * 1. a password the user typed on the card (if any),
 * 2. the game's `metadata.archive_password`,
 * 3. the default extraction password from the settings,
 * 4. a password prompt. If a saved password was tried and failed, the prompt
 *    says so ("The saved password did not work..."); the prompted password is
 *    tried once.
 *
 * Archives that are not encrypted ignore the password, so passing a saved
 * password up front is harmless.
 */

export type ExtractionAttemptOutcome =
  /** Extracted. */
  | "success"
  /** The archive is encrypted and the password was missing or wrong. */
  | "needs-password"
  /** Any other failure; the loop stops. */
  | "error";

export interface PasswordPromptRequest {
  title: string;
  message: string;
}

export interface PasswordPromptTexts {
  title: string;
  /** Shown when no saved password was available. */
  enterMessage: string;
  /** Shown after a saved password failed. */
  savedFailedMessage: string;
}

export const DEFAULT_PASSWORD_PROMPT_TEXTS: PasswordPromptTexts = {
  title: "Archive password",
  enterMessage: "Enter the password required to extract this archive.",
  savedFailedMessage:
    "The saved password did not work. Enter the archive password.",
};

export type PasswordLoopResult<T> =
  | { outcome: "success"; result: T }
  | { outcome: "error"; result: T }
  /** Every password failed, or the prompt was cancelled. */
  | { outcome: "wrong-password"; result: T | null; cancelled: boolean };

/** Saved passwords in try order, without blanks and duplicates. */
export function buildSavedPasswords(
  ...candidates: (string | null | undefined)[]
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

/** The prompt shown after the saved passwords (if any) were used up. */
export function passwordPromptFor(
  savedPasswordsTried: number,
  texts: PasswordPromptTexts = DEFAULT_PASSWORD_PROMPT_TEXTS,
): PasswordPromptRequest {
  return {
    title: texts.title,
    message:
      savedPasswordsTried > 0 ? texts.savedFailedMessage : texts.enterMessage,
  };
}

/**
 * Runs extraction attempts in password order until one succeeds, fails for a
 * different reason, or the prompted password fails too.
 *
 * `attempt(null)` means "no password". `prompt` resolves to the entered
 * password, or `null` when the user cancelled.
 */
export async function runPasswordAttempts<T>(options: {
  savedPasswords: string[];
  attempt: (password: string | null) => Promise<{
    outcome: ExtractionAttemptOutcome;
    result: T;
  }>;
  prompt: (request: PasswordPromptRequest) => Promise<string | null>;
  texts?: PasswordPromptTexts;
}): Promise<PasswordLoopResult<T>> {
  const { savedPasswords, attempt, prompt, texts } = options;
  let last: T | null = null;

  const candidates: (string | null)[] = savedPasswords.length
    ? savedPasswords
    : [null];
  for (const candidate of candidates) {
    const { outcome, result } = await attempt(candidate);
    if (outcome === "success") return { outcome, result };
    if (outcome === "error") return { outcome, result };
    last = result;
  }

  const entered = await prompt(passwordPromptFor(savedPasswords.length, texts));
  if (entered === null || entered === "") {
    return { outcome: "wrong-password", result: last, cancelled: true };
  }
  const { outcome, result } = await attempt(entered);
  if (outcome === "success" || outcome === "error") {
    return { outcome, result };
  }
  return { outcome: "wrong-password", result, cancelled: false };
}
