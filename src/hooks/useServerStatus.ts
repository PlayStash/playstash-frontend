import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { translate } from "@/i18n";
import { fillTemplate } from "@/utils/downloadPipeline";
import { serverFetch } from "@/utils/serverFetch"; // sends the additional request headers

export interface ServerInfo {
  status: string;
  version: string;
  server_uuid?: string;
  registration_enabled: boolean;
  required_registration_fields: string[];
  available_authentication_methods: string[];
}

interface UseServerStatusResult {
  info: ServerInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useServerStatus(): UseServerStatusResult {
  const { serverUrl } = useAuth();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [nonce, setNonce] = useState(0);
  // The last finished request; `loading` and `error` are derived from it, so
  // the effect never sets state synchronously.
  const [settled, setSettled] = useState<{
    key: string;
    error: string | null;
  } | null>(null);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const requestKey = serverUrl ? `${nonce}:${serverUrl}` : null;

  useEffect(() => {
    if (!serverUrl || !requestKey) return;
    const base = serverUrl.replace(/\/+$/, "");
    let cancelled = false;
    (async () => {
      try {
        const res = await serverFetch(`${base}/api/status`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok)
          throw new Error(
            fillTemplate(translate("shell.serverStatus.failed"), {
              status: res.status,
              detail: (await res.text()) || res.statusText,
            }),
          );
        const data = await res.json();
        if (cancelled) return;
        setInfo(data);
        setSettled({ key: requestKey, error: null });
      } catch (e) {
        if (!cancelled)
          setSettled({
            key: requestKey,
            error: e instanceof Error ? e.message : String(e),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, requestKey]);

  const current = settled?.key === requestKey ? settled : null;
  return {
    info,
    loading: requestKey !== null && !current,
    error: current?.error ?? null,
    refresh,
  };
}
