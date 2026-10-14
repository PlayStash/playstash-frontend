// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  setBigPicture: vi.fn(),
  games: [] as any[],
}));

vi.mock("@/hooks/useInstalledGames", () => ({
  useInstalledGames: () => ({ installedGames: mocks.games, loading: false }),
}));
vi.mock("@/utils/launchInstalledGame", () => ({
  launchInstalledGame: mocks.launch,
}));
vi.mock("@/utils/bigPicture", () => ({ setBigPicture: mocks.setBigPicture }));
vi.mock("@/components/Media", () => ({ Media: () => null }));

import { BigPictureInstalled } from "./BigPictureInstalled";

vi.setConfig({ testTimeout: 20_000 });

const game = (gameId: number, title: string, lastPlayedAt: number) => ({
  gameId,
  gameTitle: title,
  gameMetadata: null,
  cachedMetadata: null,
  gameType: null,
  versionId: 1,
  versionName: "v1",
  installationDirectory: `/lib/${title}/Installation`,
  versionDirectory: `/lib/${title}`,
  installedAt: 0,
  lastPlayedAt,
});

describe("BigPictureInstalled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.games = [game(1, "Older", 10), game(2, "Newest", 20)];
    mocks.setBigPicture.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("lists the most recently played game first and preselects it", async () => {
    render(<BigPictureInstalled />);
    const tiles = await screen.findAllByTestId("big-picture-game");
    expect(tiles.map((tile) => tile.lastElementChild?.textContent)).toEqual([
      "Newest",
      "Older",
    ]);
    expect(tiles[0].getAttribute("aria-selected")).toBe("true");
  });

  it("launches once on Enter while a launch is running", async () => {
    let finish: (value: { ok: boolean }) => void = () => {};
    mocks.launch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<BigPictureInstalled />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: 2,
        source: "big-picture",
        showErrors: false,
      }),
    );
    await act(async () => finish({ ok: true }));
    expect(await screen.findByText("Newest was started.")).toBeTruthy();
  });

  it("shows the launch error in the status line", async () => {
    mocks.launch.mockResolvedValue({
      ok: false,
      message: "No valid Executable found",
    });
    render(<BigPictureInstalled />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    await waitFor(() =>
      expect(mocks.launch).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: 1 }),
      ),
    );
    expect(await screen.findByText("No valid Executable found")).toBeTruthy();
  });

  it("closes Big Picture on Escape", () => {
    render(<BigPictureInstalled />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(mocks.setBigPicture).toHaveBeenCalledWith(false);
  });

  it("plays on double-click", async () => {
    mocks.launch.mockResolvedValue({ ok: true });
    render(<BigPictureInstalled />);
    const tiles = await screen.findAllByTestId("big-picture-game");
    fireEvent.doubleClick(tiles[1]);
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: 1 }),
    );
  });

  it("shows the empty state", () => {
    mocks.games = [];
    render(<BigPictureInstalled />);
    expect(
      screen.getByText(
        "Install a game from the library to use fullscreen mode.",
      ),
    ).toBeTruthy();
  });
});
