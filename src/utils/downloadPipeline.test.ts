import { describe, expect, it, vi } from "vitest";
import {
  deleteAllDownloadCards,
  fillTemplate,
  installSourceDirectory,
  isCardBusy,
  isInstalledAt,
  isIsoFile,
  resumePositionAfterError,
} from "./downloadPipeline";
import {
  applyAutoInstallDefault,
  AUTO_INSTALL_KEY,
  formatDriveSpace,
} from "./downloadPreferences";
import {
  formatDuplicateInstallations,
  rootSetKey,
} from "./duplicateInstallations";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

describe("download pipeline helpers", () => {
  it("fills templates without interpreting replacement patterns", () => {
    expect(
      fillTemplate("'{title}' at {path}", { title: "A$&B", path: "/x" }),
    ).toBe("'A$&B' at /x");
    expect(fillTemplate("{missing}", {})).toBe("{missing}");
  });

  it("detects ISO files", () => {
    expect(isIsoFile("C:/dl/Game.ISO")).toBe(true);
    expect(isIsoFile("C:/dl/game.iso.zip")).toBe(false);
    expect(isIsoFile(undefined)).toBe(false);
  });

  it("installs from the mounted ISO when there is one", () => {
    expect(
      installSourceDirectory({
        isoMountPath: "E:\\",
        extractionDirectory: "/x",
      }),
    ).toBe("E:\\");
    expect(installSourceDirectory({ extractionDirectory: "/x" })).toBe("/x");
  });

  it("finds an installation in the same version folder", () => {
    const installed = [
      {
        gameId: 7,
        versionDirectory: "C:\\Games\\PlayStash\\A\\Versions\\v1\\",
        installationDirectory:
          "C:\\Games\\PlayStash\\A\\Versions\\v1\\Installation",
      },
      { gameId: 8, versionDirectory: "C:/Games/PlayStash/B/Versions/v1" },
    ];
    expect(
      isInstalledAt(installed, 7, "c:/games/playstash/a/versions/v1")
        ?.installationDirectory,
    ).toContain("Installation");
    expect(
      isInstalledAt(installed, 7, "C:/Games/PlayStash/A/Versions/v2"),
    ).toBeNull();
    expect(
      isInstalledAt(installed, 9, "C:/Games/PlayStash/B/Versions/v1"),
    ).toBeNull();
  });

  it("never resumes past the bytes on disk", () => {
    expect(resumePositionAfterError(500, 300)).toBe(300);
    expect(resumePositionAfterError(500, 800)).toBe(500);
    expect(resumePositionAfterError(500, null)).toBe(500);
    expect(resumePositionAfterError(-1, 10)).toBe(0);
  });

  it("treats running phases as busy", () => {
    expect(isCardBusy({ status: "downloading" })).toBe(true);
    expect(
      isCardBusy({ status: "completed", extractionStatus: "extracting" }),
    ).toBe(true);
    expect(
      isCardBusy({ status: "completed", installationStatus: "running" }),
    ).toBe(true);
    expect(isCardBusy({ status: "paused" })).toBe(false);
    expect(isCardBusy({ status: "error" })).toBe(false);
  });

  it("deletes all idle cards from last to first", async () => {
    const order: number[] = [];
    const result = await deleteAllDownloadCards(
      [
        { gameId: 1, status: "completed" },
        { gameId: 2, status: "downloading" },
        { gameId: 3, status: "aborted" },
      ],
      vi.fn(async (id: number) => {
        order.push(id);
      }),
    );
    expect(order).toEqual([3, 1]);
    expect(result).toEqual({ deleted: 2, skipped: 1 });
  });
});

describe("download preferences", () => {
  it("formats drive space like the old location picker", () => {
    expect(formatDriveSpace(0, "en-US")).toBe("0.0 B");
    expect(formatDriveSpace(400, "en-US")).toBe("400.0 B");
    expect(formatDriveSpace(600, "en-US")).toBe("600.0 B");
    expect(formatDriveSpace(1536, "en-US")).toBe("1.5 KB");
    expect(formatDriveSpace(512.3 * 1024 ** 3, "en-US")).toBe("512.3 GB");
    expect(formatDriveSpace(2 * 1024 ** 4, "en-US")).toBe("2.0 TB");
  });

  it("turns auto-install on for fresh installations only", () => {
    const fresh = memoryStorage();
    applyAutoInstallDefault(fresh);
    expect(fresh.getItem(AUTO_INSTALL_KEY)).toBe("1");

    const existing = memoryStorage({ tauri_download_paths: "[]" });
    applyAutoInstallDefault(existing);
    expect(existing.getItem(AUTO_INSTALL_KEY)).toBe("0");

    const chosen = memoryStorage({
      tauri_download_paths: "[]",
      [AUTO_INSTALL_KEY]: "1",
    });
    applyAutoInstallDefault(chosen);
    expect(chosen.getItem(AUTO_INSTALL_KEY)).toBe("1");

    // Applied once: a later change by the user is never overwritten.
    fresh.removeItem(AUTO_INSTALL_KEY);
    applyAutoInstallDefault(fresh);
    expect(fresh.getItem(AUTO_INSTALL_KEY)).toBeNull();
  });
});

describe("duplicate installations", () => {
  it("formats one paragraph per installed copy", () => {
    expect(
      formatDuplicateInstallations([
        {
          gameId: 1,
          gameTitle: "Game",
          installations: [
            {
              root: "C:/",
              installationDirectory: "C:/a",
              versionDirectory: "C:/v",
            },
            {
              root: "D:/",
              installationDirectory: "D:/a",
              versionDirectory: "D:/v",
            },
          ],
        },
      ]),
    ).toBe(
      "'Game' is already installed at:\nC:/a\n\n'Game' is already installed at:\nD:/a",
    );
  });

  it("only changes when roots are added or removed", () => {
    expect(rootSetKey(["b", "a"])).toBe(rootSetKey(["a", "b", "a"]));
    expect(rootSetKey(["a"])).not.toBe(rootSetKey(["a", "b"]));
  });
});
