// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderTagRules, normalizeFolderTagRules } from "./FolderTagRules";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    serverUrl: "https://library.test",
    authFetch: mocks.fetch,
  }),
}));
afterEach(cleanup);
describe("automatic folder tags", () => {
  it("normalizes slashes and deduplicates tags while preserving disabled rules", () => {
    expect(
      normalizeFolderTagRules([
        {
          folder: "Classics\\Arcade/",
          tags: "Arcade, Retro, Arcade",
          enabled: false,
        },
      ]),
    ).toEqual([
      {
        folder_prefix: "Classics/Arcade",
        tags: ["Arcade", "Retro"],
        enabled: false,
      },
    ]);
  });
  it("rejects absolute paths and traversal before submitting", () => {
    for (const folder of [
      "/etc",
      "C:/games",
      "Games/../Private",
      "Games//Arcade",
    ])
      expect(() =>
        normalizeFolderTagRules([{ folder, tags: "Retro", enabled: true }]),
      ).toThrow(/relative library folder/);
  });
  it("cannot overwrite existing server rules when loading fails", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "Unavailable" }),
      text: async () => "Unavailable",
    });
    render(<FolderTagRules />);
    await screen.findByRole("alert");
    expect(
      (
        screen.getByRole("button", {
          name: "Save and apply rules",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Add rule" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
