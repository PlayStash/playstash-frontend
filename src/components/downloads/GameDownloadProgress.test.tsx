// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { useDownloads } from "@/context/DownloadContext";
import { GameDownloadProgress } from "./GameDownloadProgress";

vi.mock("@/context/DownloadContext", () => ({ useDownloads: vi.fn() }));

const actions = {
  pauseDownload: vi.fn(),
  resumeDownload: vi.fn(),
  cancelDownload: vi.fn(),
  formatBytes: (bytes: number) => `${bytes} B`,
  formatSpeed: (bps?: number) => `${bps} B/s`,
};

function renderWith(download: Record<string, unknown> | undefined) {
  vi.mocked(useDownloads).mockReturnValue({
    ...actions,
    downloads: download ? { 7: { gameId: 7, ...download } } : {},
  } as any);
  return render(
    <MemoryRouter>
      <GameDownloadProgress gameId={7} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders nothing without an active download for the game", () => {
  const { container } = renderWith(undefined);
  expect(container.textContent).toBe("");
  renderWith({ status: "completed", installationStatus: "completed" });
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("shows the download progress with pause and cancel", () => {
  renderWith({
    status: "downloading",
    progress: 42,
    received: 420,
    total: 1000,
    speedBps: 50,
  });
  expect(screen.getByText("42.0%")).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "42",
  );
  expect(screen.getByText("420 B / 1000 B · 50 B/s")).toBeTruthy();
  fireEvent.click(screen.getByText("Pause"));
  expect(actions.pauseDownload).toHaveBeenCalledWith(7);
  fireEvent.click(screen.getByText("Cancel Download"));
  expect(actions.cancelDownload).toHaveBeenCalledWith(7);
});

it("shows extraction and installation phases", () => {
  renderWith({
    status: "completed",
    extractionStatus: "extracting",
    extractionProgress: 10,
    extractionCurrentFile: "Game/data.pak",
  });
  // The folder truncates on its own so the file name stays readable.
  expect(screen.getByTitle("Game/data.pak").textContent).toBe("Game/data.pak");
  expect(screen.getByText("data.pak")).toBeTruthy();
  expect(screen.getByText("10.0%")).toBeTruthy();
  cleanup();
  renderWith({
    status: "completed",
    extractionStatus: "completed",
    installationStatus: "copying",
    installationProgress: 75,
  });
  expect(screen.getByText("75.0%")).toBeTruthy();
  expect(screen.queryByText("Pause")).toBeNull();
});

it("resumes a paused download", () => {
  renderWith({ status: "paused", progress: 5, received: 5, total: 100 });
  fireEvent.click(screen.getByText("Resume"));
  expect(actions.resumeDownload).toHaveBeenCalledWith(7);
});
