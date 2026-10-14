// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyApiKeyButton } from "./CopyApiKeyButton";

afterEach(() => {
  cleanup();
  delete window.showAlertDialog;
});

describe("CopyApiKeyButton", () => {
  it("is hidden without an api key", () => {
    render(<CopyApiKeyButton apiKey={undefined} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("copies the key and confirms with a toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    window.showAlertDialog = vi.fn().mockResolvedValue(true);
    render(<CopyApiKeyButton apiKey="key-123" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy API Key" }));
    });
    expect(writeText).toHaveBeenCalledWith("key-123");
    expect(window.showAlertDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Copied API Key to Clipboard" }),
    );
  });
});
