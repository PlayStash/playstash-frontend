import { useCallback, useEffect, useRef, useState } from "react";
import type { ImgHTMLAttributes } from "react";

/** Reveal pixels when they are ready, rather than when a blob URL is assigned. */
export function DecodedImage({
  src,
  style,
  onLoad,
  onError,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const decodeRequest = useRef(0);
  const [readySource, setReadySource] = useState<string | undefined>();

  const reveal = useCallback(async (image: HTMLImageElement) => {
    const source = image.getAttribute("src");
    const request = ++decodeRequest.current;
    // The load event already guarantees usable pixels. decode() additionally
    // keeps large artwork from appearing halfway through its first paint.
    try {
      await image.decode?.();
    } catch {
      // Some image formats/engines reject decode() despite a successful load.
    }
    if (
      request === decodeRequest.current &&
      imageRef.current === image &&
      // Still the rendered source (src may have changed while decoding).
      source === image.getAttribute("src") &&
      image.naturalWidth > 0
    ) {
      setReadySource(source ?? undefined);
    }
  }, []);

  useEffect(() => {
    const image = imageRef.current;
    // Cached images can complete before React attaches their load handler.
    if (image?.complete && image.naturalWidth > 0) void reveal(image);
    return () => {
      decodeRequest.current += 1;
    };
  }, [src, reveal]);

  return (
    <img
      {...props}
      ref={imageRef}
      src={src}
      style={{
        ...style,
        opacity: src && readySource === src ? 1 : 0,
        transition: "opacity 280ms var(--ease-out)",
      }}
      onLoad={(event) => {
        void reveal(event.currentTarget);
        onLoad?.(event);
      }}
      onError={(event) => {
        decodeRequest.current += 1;
        setReadySource(undefined);
        onError?.(event);
      }}
    />
  );
}
