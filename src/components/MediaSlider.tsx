import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowsPointingOutIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/react/24/solid";
import { isTauriApp } from "@/utils/tauri";
import { useTranslation } from "@/i18n";
import { useAuth } from "@/context/AuthContext";
import { useAuthMediaUrl } from "@/hooks/useAuthMediaUrl";
import { serverMediaId } from "@/utils/serverMediaUrl";
import { fillTemplate } from "@/utils/downloadPipeline";
import {
  getMediaVolume,
  setMediaVolume,
  youtubeVolumeCommands,
} from "@/utils/mediaVolume";

/**
 * A screenshot. Images uploaded to the connected server (`/api/media/<id>`)
 * need the session, so they load through the authenticated media cache like
 * covers do; external URLs load directly.
 */
function SliderImage({ src, alt }: { src: string; alt: string }) {
  const { serverUrl } = useAuth();
  const mediaId = serverMediaId(src, serverUrl);
  const { url } = useAuthMediaUrl(mediaId, undefined, mediaId != null);
  const resolved = mediaId != null ? url : src;
  if (!resolved) return null;
  return (
    <img
      src={resolved}
      alt={alt}
      className="absolute inset-0 w-full h-full object-contain"
      draggable={false}
    />
  );
}

export interface ResolvedStream {
  video: string; // Direct video stream URL (mp4/webm) OR image URL when type === image/placeholder
  poster?: string; // Poster thumbnail URL (optional)
  originalUrl?: string; // Original YouTube (or other) URL for reference
  type?: string; // MIME type override for <source> or "image/placeholder" for screenshots
  title?: string; // Optional title / caption
}

export type MediaItem = string | ResolvedStream; // raw URL (YouTube or image) or resolved object

interface MediaSliderProps {
  trailers?: MediaItem[] | null; // YouTube or direct video links
  screenshots?: string[] | null; // Image URLs (merged after trailers)
  className?: string;
  aspect?: string; // Tailwind aspect ratio class e.g. 'aspect-video'
  autoPlay?: boolean;
  loop?: boolean;
}

function isYouTube(url: string | undefined): boolean {
  if (!url) return false;
  return /^(https?:)?\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

function extractYouTubeId(url: string): string | null {
  try {
    const idMatch = url.match(/(?:v=|youtu\.be\/)"?([A-Za-z0-9_-]{11})/);
    if (idMatch && idMatch[1]) return idMatch[1];
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && v.length === 11) return v;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace(/\//g, "");
      if (id.length === 11) return id;
    }
    return null;
  } catch {
    return null;
  }
}

function useYoutubeEmbedBase(): string | null {
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauriApp()) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const value = await invoke<string | null>("youtube_embed_base");
        if (!cancelled) setBase(value);
      } catch {
        if (!cancelled) setBase(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return base;
}

export const MediaSlider: React.FC<MediaSliderProps> = ({
  trailers,
  screenshots,
  className = "",
  aspect = "aspect-video",
  autoPlay = false,
  loop = false,
}) => {
  const { t: tr } = useTranslation();
  // Merge trailers + screenshots list
  const rawList = useMemo(() => {
    const t = trailers || [];
    const s = (screenshots || []).map<ResolvedStream>((url) => ({
      video: url,
      poster: url,
      type: "image/placeholder",
      originalUrl: url,
    }));
    return [...t, ...s];
  }, [trailers, screenshots]);

  // Normalize list items into unified objects
  const resolved: ResolvedStream[] = useMemo(() => {
    const out: ResolvedStream[] = [];
    for (const item of rawList) {
      if (typeof item === "string") {
        out.push({
          video: item,
          originalUrl: item,
          poster: isImage(item) ? item : undefined,
        });
      } else {
        out.push(item);
      }
    }
    return out;
  }, [rawList]);

  const [index, setIndex] = useState(0);
  // Persisted media volume (default 0 = muted, like the WPF client).
  const [volume, setVolumeState] = useState(getMediaVolume);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  // The embed URL uses the volume at mount, so changing it never reloads
  // the player (later changes go through postMessage).
  const initialVolumeRef = useRef(volume);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const list = resolved;
  const current = list[index];

  const isImageOnly = useMemo(
    () => current && current.type === "image/placeholder",
    [current],
  );

  const isYT = !isImageOnly && isYouTube(current?.video);
  const ytId = isYT ? extractYouTubeId(current?.video || "") : null;
  const ytEmbedBase = useYoutubeEmbedBase();
  const ytEmbedUrl = ytId
    ? (() => {
        // In packaged Tauri builds the webview origin is tauri://localhost,
        // which sends no HTTP Referer, so YouTube rejects the embed with
        // Error 153. Serve the embed through a loopback http://127.0.0.1 page
        // (see src-tauri/src/youtube.rs) so it has a valid HTTP origin. In
        // dev/web we keep the direct embed, which works fine.
        if (ytEmbedBase) {
          const initial = initialVolumeRef.current;
          const params = new URLSearchParams({
            v: ytId,
            mute: initial > 0 ? "0" : "1",
            volume: String(Math.round(initial * 100)),
          });
          if (autoPlay) params.set("autoplay", "1");
          return `${ytEmbedBase}/embed?${params.toString()}`;
        }
        const params = new URLSearchParams({
          rel: "0",
          playsinline: "1",
          mute: initialVolumeRef.current > 0 ? "0" : "1",
          fs: "0",
          enablejsapi: "1",
          origin: window.location.origin,
          widget_referrer: window.location.href,
        });
        if (autoPlay) params.set("autoplay", "1");
        return `https://www.youtube.com/embed/${ytId}?${params.toString()}`;
      })()
    : null;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  /** Applies the volume to the video element and the YouTube player. */
  const applyVolume = useCallback(
    (value: number) => {
      const video = videoRef.current;
      if (video) {
        video.volume = value;
        video.muted = value === 0;
      }
      const frame = iframeRef.current?.contentWindow;
      if (!frame) return;
      try {
        if (ytEmbedBase) {
          frame.postMessage({ playstashVolume: Math.round(value * 100) }, "*");
        } else {
          for (const command of youtubeVolumeCommands(value)) {
            frame.postMessage(command, "*");
          }
        }
      } catch {
        // cross-origin frame not ready
      }
    },
    [ytEmbedBase],
  );

  const changeVolume = useCallback(
    (value: number) => {
      setVolumeState(value);
      setMediaVolume(value);
      applyVolume(value);
    },
    [applyVolume],
  );

  useEffect(() => {
    applyVolume(volumeRef.current);
  }, [index, applyVolume]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const next = useCallback(() => {
    setIndex((i) => (list.length === 0 ? 0 : (i + 1) % list.length));
  }, [list.length]);
  const prev = useCallback(() => {
    setIndex((i) =>
      list.length === 0 ? 0 : (i - 1 + list.length) % list.length,
    );
  }, [list.length]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      if (autoPlay && !isImageOnly && !isYT)
        videoRef.current.play().catch(() => {});
    }
  }, [index, autoPlay, isImageOnly, isYT]);

  const requestFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const fn: any =
      el.requestFullscreen ||
      (el as any).webkitRequestFullscreen ||
      (el as any).mozRequestFullScreen ||
      (el as any).msRequestFullscreen;
    try {
      fn && fn.call(el);
    } catch {}
  }, []);

  const exitFullscreen = useCallback(() => {
    const doc: any = document;
    const fn =
      document.exitFullscreen ||
      doc.webkitExitFullscreen ||
      doc.mozCancelFullScreen ||
      doc.msExitFullscreen;
    try {
      fn && fn.call(document);
    } catch {}
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) exitFullscreen();
    else requestFullscreen();
  }, [isFullscreen, exitFullscreen, requestFullscreen]);

  useEffect(() => {
    const handler = () => {
      const fsElement =
        (document as any).fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement;
      setIsFullscreen(!!fsElement && fsElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler as any);
    document.addEventListener("mozfullscreenchange", handler as any);
    document.addEventListener("MSFullscreenChange", handler as any);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler as any);
      document.removeEventListener("mozfullscreenchange", handler as any);
      document.removeEventListener("MSFullscreenChange", handler as any);
    };
  }, []);

  if (!list.length) {
    return (
      <div
        className={`relative w-full ${aspect} bg-ps-panel rounded-3xl flex items-center justify-center text-xs text-ps-muted ${className}`}
      >
        {tr("game.media.empty")}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${aspect} bg-black rounded-3xl overflow-hidden ${className}`}
    >
      {isImageOnly ? (
        <SliderImage
          src={current.poster || current.video}
          alt={current.title || tr("game.media.screenshot")}
        />
      ) : isYT && ytId ? (
        <iframe
          key={ytId}
          className="absolute inset-0 w-full h-full"
          src={ytEmbedUrl || undefined}
          title={current.title || tr("game.media.trailer")}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            // Re-apply the persisted volume once the player can listen.
            for (const delay of [500, 1500, 3000]) {
              setTimeout(() => applyVolume(volumeRef.current), delay);
            }
          }}
          // Native fullscreen intentionally disabled to use custom control
          ref={(el) => {
            iframeRef.current = el;
            // The loopback proxy page handles autoplay itself via the embed
            // URL, so only use the direct Iframe API postMessage fallback for
            // the non-proxy (dev/web) embed path.
            if (el && autoPlay && !ytEmbedBase) {
              // Attempt delayed play via YouTube Iframe API postMessage (minimal subset)
              setTimeout(() => {
                try {
                  el.contentWindow?.postMessage(
                    JSON.stringify({
                      event: "command",
                      func: "playVideo",
                      args: [],
                    }),
                    "*",
                  );
                } catch {}
              }, 500);
            }
          }}
        />
      ) : (
        <>
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain"
            controls
            playsInline
            muted={volume === 0}
            onLoadedMetadata={(event) => {
              event.currentTarget.volume = volumeRef.current;
              event.currentTarget.muted = volumeRef.current === 0;
            }}
            onVolumeChange={(event) => {
              const element = event.currentTarget;
              const next = element.muted ? 0 : element.volume;
              if (Math.abs(next - volumeRef.current) > 0.001) {
                setVolumeState(next);
                setMediaVolume(next);
              }
            }}
            loop={loop}
            poster={current?.poster}
            autoPlay={autoPlay && !isImageOnly && !isYT}
          >
            {current?.video && (
              <source src={current.video} type={current?.type || undefined} />
            )}
          </video>
        </>
      )}

      {list.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            className="absolute top-1/2 left-2 -translate-y-1/2 p-2.5 rounded-full bg-black/50 text-white transition-[background-color,scale] duration-150 ease-out hover:bg-black/70 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer touch-manipulation"
            aria-label={tr("game.media.previous")}
          >
            <ChevronLeftIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={next}
            className="absolute top-1/2 right-2 -translate-y-1/2 p-2.5 rounded-full bg-black/50 text-white transition-[background-color,scale] duration-150 ease-out hover:bg-black/70 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer touch-manipulation"
            aria-label={tr("game.media.next")}
          >
            <ChevronRightIcon className="w-5 h-5" />
          </button>
        </>
      )}

      <div
        className={`absolute left-0 right-0 pointer-events-none p-2 flex items-center justify-between text-[11px] text-white ${isImageOnly ? "bottom-0 bg-linear-to-t from-black/70 to-transparent" : "top-0 bg-linear-to-b from-black/70 to-transparent"}`}
      >
        <div>
          {fillTemplate(tr("game.media.position"), {
            index: index + 1,
            total: list.length,
          })}
        </div>
        <div className="flex items-center gap-2">
          {isYT && !ytId && (
            <span className="text-rose-300 pointer-events-none">
              {tr("game.media.unrecognizedYoutube")}
            </span>
          )}
          {!isImageOnly && (
            <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-1">
              <button
                type="button"
                onClick={() => changeVolume(volume > 0 ? 0 : 0.5)}
                className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                aria-label={
                  volume > 0 ? tr("game.media.mute") : tr("game.media.unmute")
                }
              >
                {volume > 0 ? (
                  <SpeakerWaveIcon className="w-4 h-4" />
                ) : (
                  <SpeakerXMarkIcon className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                aria-label={tr("game.media.volume")}
                onChange={(event) => changeVolume(Number(event.target.value))}
                className="h-1 w-20 cursor-pointer accent-white"
              />
            </div>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md bg-white/10 transition-[background-color,scale] duration-150 ease-out hover:bg-white/20 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-events-auto"
            aria-label={tr("game.media.toggleFullscreen")}
            title={
              isFullscreen
                ? tr("game.media.exitFullscreen")
                : tr("game.media.fullscreen")
            }
            aria-pressed={isFullscreen}
          >
            <ArrowsPointingOutIcon
              className={`w-4 h-4 transition-[rotate,scale] duration-200 ease-out ${isFullscreen ? "scale-90 rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>
    </div>
  );
};

function isImage(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url);
}

export default MediaSlider;
