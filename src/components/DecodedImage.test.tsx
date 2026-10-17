// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecodedImage } from "./DecodedImage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function pendingDecode() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function decodedPixels(image: HTMLImageElement) {
  Object.defineProperty(image, "naturalWidth", {
    configurable: true,
    value: 640,
  });
}

describe("decoded image reveal", () => {
  it("waits for decoded pixels and does not replay on unrelated renders", async () => {
    const decoding = pendingDecode();
    const view = render(<DecodedImage src="blob:cover" alt="Cover" />);
    const image = view.getByAltText("Cover") as HTMLImageElement;
    decodedPixels(image);
    const decode = vi.fn(() => decoding.promise);
    Object.defineProperty(image, "decode", { value: decode });

    fireEvent.load(image);
    expect(image.style.opacity).toBe("0");
    await act(async () => decoding.resolve());
    expect(image.style.opacity).toBe("1");

    view.rerender(<DecodedImage src="blob:cover" alt="Renamed cover" />);
    expect(view.getByAltText("Renamed cover")).toBe(image);
    expect(image.style.opacity).toBe("1");
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("reveals an already complete cached image without a new load event", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
      true,
    );
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      640,
    );
    const view = render(<DecodedImage src="blob:cached" alt="Cached cover" />);
    const image = view.getByAltText("Cached cover");
    await waitFor(() => expect(image.style.opacity).toBe("1"));
  });

  it("ignores a stale decode after the source changes", async () => {
    const first = pendingDecode();
    const second = pendingDecode();
    const view = render(<DecodedImage src="blob:first" alt="Cover" />);
    const image = view.getByAltText("Cover") as HTMLImageElement;
    decodedPixels(image);
    Object.defineProperty(image, "decode", {
      value: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    });

    fireEvent.load(image);
    view.rerender(<DecodedImage src="blob:second" alt="Cover" />);
    await act(async () => first.resolve());
    expect(image.style.opacity).toBe("0");

    fireEvent.load(image);
    await act(async () => second.resolve());
    expect(image.style.opacity).toBe("1");
  });

  it("keeps a failed image hidden and preserves its retry handler", async () => {
    const decoding = pendingDecode();
    const retry = vi.fn();
    const view = render(
      <DecodedImage src="blob:failed" alt="Cover" onError={retry} />,
    );
    const image = view.getByAltText("Cover") as HTMLImageElement;
    decodedPixels(image);
    Object.defineProperty(image, "decode", { value: () => decoding.promise });

    fireEvent.load(image);
    fireEvent.error(image);
    await act(async () => decoding.resolve());
    expect(image.style.opacity).toBe("0");
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
