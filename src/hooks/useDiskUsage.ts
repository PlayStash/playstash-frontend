import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isTauriApp } from "@/utils/tauri";

export interface DiskUsageData {
  total: number;
  free: number;
  currentGameSize: number;
  otherGamesSize: number;
  unmanagedData: number;
}

/**
 * Fetches the disk-usage breakdown for a download location (root path),
 * powered by the `get_disk_usage` Tauri command. When `currentVersionDir` is
 * provided, the size of that specific game version is reported separately so
 * it can be highlighted in the "This Game" slice of the donut chart.
 */
export function useDiskUsage(
  rootPath: string | null | undefined,
  currentVersionDir: string | null | undefined,
): {
  data: DiskUsageData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<DiskUsageData | null>(null);
  // The last finished request, keyed by its inputs; `loading` and `error` are
  // derived from it so the effect never sets state synchronously.
  const [settled, setSettled] = useState<{
    key: string;
    error: string | null;
  } | null>(null);
  // The refetch in flight (if any), keyed by its inputs so a refetch for an
  // old root never keeps the current one in a loading state.
  const [refetching, setRefetching] = useState<{
    key: string;
    id: number;
  } | null>(null);
  const requestKey =
    isTauriApp() && rootPath ? `${rootPath}|${currentVersionDir ?? ""}` : null;
  // The latest inputs, so a slow refetch can tell whether it is still current.
  const latestKeyRef = useRef(requestKey);
  const refetchIdRef = useRef(0);
  useLayoutEffect(() => {
    latestKeyRef.current = requestKey;
  }, [requestKey]);

  const loadDiskUsage = useCallback(async (): Promise<DiskUsageData> => {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<any>("get_disk_usage", {
      selectedRoot: rootPath,
      currentVersionDir: currentVersionDir || null,
    });
    return {
      total: Number(result.total || 0),
      free: Number(result.free || 0),
      currentGameSize: Number(result.currentGameSize || 0),
      otherGamesSize: Number(result.otherGamesSize || 0),
      unmanagedData: Number(result.unmanagedData || 0),
    };
  }, [rootPath, currentVersionDir]);

  const applyResult = useCallback(
    (key: string, promise: Promise<DiskUsageData>, isCurrent: () => boolean) =>
      promise.then(
        (value) => {
          if (!isCurrent()) return;
          setData(value);
          setSettled({ key, error: null });
        },
        (e: any) => {
          if (!isCurrent()) return;
          setData(null);
          setSettled({ key, error: e?.message ?? String(e) });
        },
      ),
    [],
  );

  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    void applyResult(requestKey, loadDiskUsage(), () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [requestKey, loadDiskUsage, applyResult]);

  const refetch = useCallback(() => {
    if (!requestKey) return;
    refetchIdRef.current += 1;
    const id = refetchIdRef.current;
    setRefetching({ key: requestKey, id });
    // Drop the result if the inputs changed while it was in flight; otherwise
    // the old root's usage would overwrite the current one.
    void applyResult(
      requestKey,
      loadDiskUsage(),
      () => latestKeyRef.current === requestKey,
    ).finally(() =>
      setRefetching((previous) => (previous?.id === id ? null : previous)),
    );
  }, [requestKey, loadDiskUsage, applyResult]);

  const current = requestKey && settled?.key === requestKey ? settled : null;
  const loading = !!requestKey && (!current || refetching?.key === requestKey);
  const error = current?.error ?? null;

  return { data: requestKey ? data : null, loading, error, refetch };
}
