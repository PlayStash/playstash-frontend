// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPendingConnection,
  buildConnectionFile,
  getPendingConnection,
  parseConnectionFile,
  serializeConnectionFile,
  storePendingConnection,
} from "./connectionFile";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("connection export", () => {
  it("writes the WPF schema with the opt-in archive password", () => {
    localStorage.setItem("tauri_auto_extract", "1");
    localStorage.setItem("tauri_auto_install", "0");
    localStorage.setItem("tauri_auto_delete_source", "1");
    const file = buildConnectionFile("https://server.example", "secret");
    expect(JSON.parse(serializeConnectionFile(file))).toEqual({
      schema_version: 1,
      server_url: "https://server.example",
      archive_password: "secret",
      auto_extract: true,
      auto_install_portable: false,
      auto_delete_portable_files: true,
    });
    expect(serializeConnectionFile(file)).toContain('\n  "server_url"');
  });

  it("omits the password when the user answers No", () => {
    const file = buildConnectionFile("https://server.example", null);
    expect(file.archive_password).toBeNull();
    const text = serializeConnectionFile(file);
    expect(text).not.toMatch(/token|api_key|header/i);
  });
});

describe("connection import", () => {
  it("rejects other schema versions and invalid files", () => {
    expect(() =>
      parseConnectionFile('{"schema_version":2,"server_url":"https://a"}'),
    ).toThrow("Unsupported connection file.");
    expect(() => parseConnectionFile("not json")).toThrow(
      "Unsupported connection file.",
    );
    expect(() => parseConnectionFile('{"server_url":"https://a"}')).toThrow(
      "Unsupported connection file.",
    );
  });

  it("rejects invalid URLs and normalizes valid ones", () => {
    for (const url of [
      "ftp://server",
      "https://user:pw@server",
      "https://server/?x=1",
      "",
    ]) {
      expect(() =>
        parseConnectionFile(
          JSON.stringify({ schema_version: 1, server_url: url }),
        ),
      ).toThrow(/valid HTTP or HTTPS/);
    }
    const parsed = parseConnectionFile(
      JSON.stringify({
        schema_version: 1,
        server_url: "server.example/",
        auto_extract: true,
      }),
    );
    expect(parsed.server_url).toBe("https://server.example");
    expect(parsed.auto_extract).toBe(true);
    expect(parsed.auto_install_portable).toBe(false);
    expect(parsed.archive_password).toBeNull();
  });

  it("applies only after a login to the same normalized server", async () => {
    storePendingConnection(
      parseConnectionFile(
        JSON.stringify({
          schema_version: 1,
          server_url: "https://server.example",
          archive_password: null,
          auto_extract: true,
          auto_install_portable: true,
          auto_delete_portable_files: false,
        }),
      ),
    );
    const setPassword = vi.fn().mockResolvedValue(undefined);
    expect(
      await applyPendingConnection("https://other.example", setPassword),
    ).toBe(false);
    expect(localStorage.getItem("tauri_auto_extract")).toBeNull();
    expect(setPassword).not.toHaveBeenCalled();
    expect(getPendingConnection()).not.toBeNull();

    expect(
      await applyPendingConnection("https://server.example/", setPassword),
    ).toBe(true);
    expect(localStorage.getItem("tauri_auto_extract")).toBe("1");
    expect(localStorage.getItem("tauri_auto_install")).toBe("1");
    expect(localStorage.getItem("tauri_auto_delete_source")).toBe("0");
    expect(setPassword).toHaveBeenCalledWith("");
    expect(getPendingConnection()).toBeNull();
  });
});
