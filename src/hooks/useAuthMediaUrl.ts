import { useAuth } from "@/context/AuthContext";
import { useOnlineStatus } from "@/context/OfflineContext";
import {
  GameMediaOwner,
  invalidateMedia,
  resolveApiMediaBlob,
} from "@/utils/mediaCache";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export function useAuthMediaUrl(
  mediaId?: number | string | null,
  owner?: GameMediaOwner,
  enabled = true,
) {
  const { authFetch, serverUrl } = useAuth();
  const { isOnline } = useOnlineStatus();
  const [url, setUrl] = useState<string | null>(null);
  // The last fetch that finished (or failed), identified by media id and the
  // refresh nonce it was made for. `loading` and `error` are derived from it,
  // so the fetch effect never has to set state synchronously.
  const [settled, setSettled] = useState<{
    mediaId: number;
    nonce: number;
    error: string | null;
  } | null>(null);
  // Media whose cache entry is being invalidated before a decode retry.
  const [retryingMediaId, setRetryingMediaId] = useState<number | null>(null);
  // Media that failed to decode even after the retry.
  const [decodeFailedMediaId, setDecodeFailedMediaId] = useState<number | null>(
    null,
  );
  const [refreshRequest, setRefreshRequest] = useState<{
    mediaId: number;
    nonce: number;
  } | null>(null);
  // Keep the latest online/auth refs so the fetch effect doesn't restart on
  // connectivity or token churn (which caused flicker/reloops).
  const isOnlineRef = useRef(isOnline);
  const authFetchRef = useRef(authFetch);
  useLayoutEffect(() => {
    isOnlineRef.current = isOnline;
    authFetchRef.current = authFetch;
  }, [isOnline, authFetch]);

  // Track the object URL currently handed to the <img> and any URLs that were
  // replaced but must stay alive until the browser has finished with them.
  // Revoking a URL while the <img> still references it is what surfaces as
  // "blob error ... failed to load the resource".
  const currentUrlRef = useRef<string | null>(null);
  const revokeTimersRef = useRef<Map<string, number>>(new Map());
  // The media id the current object URL (`currentUrlRef`) belongs to, or null
  // when no URL is shown (e.g. the last fetch failed).
  const loadedMediaIdRef = useRef<number | null>(null);
  const decodeRetryMediaIdRef = useRef<number | null>(null);
  const ownerGameId = owner?.gameId;
  const ownerSlot = owner?.slot;

  // Revoke everything on unmount (the <img> is gone by then, so it's safe).
  useEffect(
    () => () => {
      for (const [url, timer] of revokeTimersRef.current) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      revokeTimersRef.current.clear();
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
    },
    [],
  );

  // Revoke a replaced URL only after a safe delay (so a lazily-decoding <img>
  // has already switched to the new src), never synchronously.
  const scheduleRevoke = useCallback((url: string, delayMs = 10_000) => {
    const existing = revokeTimersRef.current.get(url);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      revokeTimersRef.current.delete(url);
      URL.revokeObjectURL(url);
    }, delayMs);
    revokeTimersRef.current.set(url, timer);
  }, []);

  useEffect(() => {
    // Defer the actual fetch until the element is near the viewport. This
    // prevents a long/infinite list from issuing a burst of blob requests for
    // images the user hasn't scrolled to yet. Once `enabled` flips true it
    // stays true, so re-enabling always fetches fresh for the current media.
    if (!enabled) {
      loadedMediaIdRef.current = null;
      return;
    }

    const numericId = Number(mediaId);
    if (!numericId || !serverUrl) {
      loadedMediaIdRef.current = null;
      return;
    }

    // Avoid tearing down an already-loaded image on unrelated dep churn (e.g.
    // the online flag or authFetch identity changing). Only reload when the
    // media changes or a refresh was explicitly requested for this media.
    // `loadedMediaIdRef` is cleared whenever a fetch fails, so this only
    // short-circuits while the shown URL really belongs to this media.
    if (
      loadedMediaIdRef.current === numericId &&
      currentUrlRef.current !== null &&
      refreshRequest?.mediaId !== numericId
    ) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const nonce =
      refreshRequest?.mediaId === numericId ? refreshRequest.nonce : 0;

    const isAbortError = (error: unknown) =>
      (error as { name?: string } | null)?.name === "AbortError";
    const load = () =>
      resolveApiMediaBlob({
        serverUrl,
        mediaId: numericId,
        authFetch: authFetchRef.current,
        owner:
          ownerGameId && ownerSlot
            ? { gameId: ownerGameId, slot: ownerSlot }
            : undefined,
        forceRefresh: refreshRequest?.mediaId === numericId,
        allowTauriFallback: !isOnlineRef.current,
        signal: controller.signal,
      });

    (async () => {
      try {
        let blob: Blob;
        try {
          blob = await load();
        } catch (firstError) {
          // An abort we didn't cause (e.g. from a request shared with another
          // consumer) is worth one retry before it counts as a failure.
          if (cancelled || !isAbortError(firstError)) throw firstError;
          blob = await load();
        }
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        const previous = currentUrlRef.current;
        currentUrlRef.current = objectUrl;
        loadedMediaIdRef.current = numericId;
        setUrl(objectUrl);
        setSettled({ mediaId: numericId, nonce, error: null });
        setDecodeFailedMediaId(null);

        if (previous && previous !== objectUrl) {
          scheduleRevoke(previous);
        }
      } catch (caughtError) {
        // Our own cleanup aborted this fetch (unmount or media change): that's
        // expected, so don't surface it. Any other failure, including an abort
        // we didn't cause, must still settle so `loading` clears.
        if (cancelled) return;
        // The shown URL no longer belongs to any media, so switching back to
        // a previously loaded media must fetch it again.
        loadedMediaIdRef.current = null;
        if (currentUrlRef.current) {
          scheduleRevoke(currentUrlRef.current);
          currentUrlRef.current = null;
        }
        setUrl(null);
        setSettled({
          mediaId: numericId,
          nonce,
          error: isAbortError(caughtError)
            ? "Failed to load image"
            : caughtError instanceof Error
              ? caughtError.message
              : "Failed to load image",
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    mediaId,
    serverUrl,
    ownerGameId,
    ownerSlot,
    refreshRequest,
    scheduleRevoke,
    enabled,
  ]);

  useEffect(() => {
    decodeRetryMediaIdRef.current = null;
  }, [mediaId]);

  const retryAfterDecodeError = useCallback(() => {
    const numericId = Number(mediaId);
    if (!numericId || !serverUrl) return;

    if (decodeRetryMediaIdRef.current === numericId) {
      setDecodeFailedMediaId(numericId);
      return;
    }

    decodeRetryMediaIdRef.current = numericId;
    setRetryingMediaId(numericId);
    void invalidateMedia(serverUrl, numericId).finally(() => {
      setRetryingMediaId(null);
      setRefreshRequest({ mediaId: numericId, nonce: Date.now() });
    });
  }, [mediaId, serverUrl]);

  const numericId = Number(mediaId);
  const hasSource = !!numericId && !!serverUrl;
  const requestedNonce =
    refreshRequest?.mediaId === numericId ? refreshRequest.nonce : 0;
  const current =
    hasSource &&
    settled?.mediaId === numericId &&
    settled.nonce === requestedNonce
      ? settled
      : null;
  const loading =
    enabled && hasSource && (!current || retryingMediaId === numericId);
  const error = !hasSource
    ? null
    : (current?.error ??
      (decodeFailedMediaId === numericId ? "Failed to decode image" : null));

  return {
    url: hasSource ? url : null,
    error,
    loading,
    retryAfterDecodeError,
  };
}
