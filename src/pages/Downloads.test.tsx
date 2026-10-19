// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const mocks = vi.hoisted(() => ({
  downloads: {} as Record<number, unknown>,
  deleteDownloadCard: vi.fn(async (gameId: number) => {
    void gameId;
  }),
  showAlert: vi.fn(async () => true),
  confirmPipeline: vi.fn(async () => true),
}));

vi.mock("@/context/DownloadContext", () => ({
  useDownloads: () => ({
    downloads: mocks.downloads,
    deleteDownloadCard: mocks.deleteDownloadCard,
  }),
}));
vi.mock("@/context/AlertDialogContext", () => ({
  useAlertDialog: () => ({ showAlert: mocks.showAlert }),
}));
vi.mock("@/components/downloads/pipelineDialogStore", () => ({
  confirmPipeline: mocks.confirmPipeline,
}));
vi.mock("@/components/downloads/DownloadCard", () => ({
  DownloadCard: ({ download }: { download: { gameId: number } }) => (
    <div data-testid="card">{download.gameId}</div>
  ),
}));

import Downloads from "./Downloads";

describe("Downloads page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloads = {
      1: { gameId: 1, status: "completed", extractionStatus: "completed" },
      2: { gameId: 2, status: "downloading" },
      3: { gameId: 3, status: "completed", extractionStatus: "extracting" },
      4: { gameId: 4, status: "aborted" },
    };
  });
  afterEach(cleanup);

  it("Delete all skips active cards", async () => {
    render(
      <MemoryRouter>
        <Downloads />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete all Downloads" }),
    );

    await waitFor(() =>
      expect(mocks.showAlert).toHaveBeenCalledWith({
        title:
          "Can not delete during the download, extraction, installing process",
      }),
    );
    expect(mocks.confirmPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Are you sure you want to delete all canceled and completed downloads?\n\nThis cannot be undone.",
      }),
    );
    expect(mocks.deleteDownloadCard.mock.calls.map(([id]) => id)).toEqual([
      4, 1,
    ]);
  });

  it("deletes nothing when the confirmation is declined", async () => {
    mocks.confirmPipeline.mockResolvedValueOnce(false);
    render(
      <MemoryRouter>
        <Downloads />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete all Downloads" }),
    );
    await waitFor(() => expect(mocks.confirmPipeline).toHaveBeenCalled());
    expect(mocks.deleteDownloadCard).not.toHaveBeenCalled();
  });

  it("shows the empty state", () => {
    mocks.downloads = {};
    render(
      <MemoryRouter>
        <Downloads />
      </MemoryRouter>,
    );
    expect(screen.getByText("No downloads")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Delete all Downloads" }),
    ).toBeNull();
  });
});
