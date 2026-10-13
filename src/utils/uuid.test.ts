import { afterEach, expect, it, vi } from "vitest";
import { createUuid } from "./uuid";
afterEach(() => vi.unstubAllGlobals());
it("creates valid UUID v4 IDs on a local HTTP browser without randomUUID", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(0xff);
      return bytes;
    },
  });
  expect(createUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
});
