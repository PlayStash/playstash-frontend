import { useAuth } from "@/context/AuthContext";
import { translate } from "@/i18n";
import { useCallback, useEffect, useState } from "react";
import releaseNotes from "../../CHANGELOG.md?raw";

function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle
    .digest("SHA-256", encoder.encode(text))
    .then((hashBuffer) => {
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    });
}

/** Builds the news result, flagging it new when its hash changed. */
async function checkNews(key: string, newsText: string): Promise<NewsResult> {
  if (!newsText.trim()) return { content: newsText, error: null, isNew: false };
  const newHash = await hashText(newsText);
  const storedHash = localStorage.getItem(key);
  const isNew = storedHash ? storedHash !== newHash : false;
  return { content: newsText, error: null, isNew };
}

/** Server news re-check interval while logged in. */
export const NEWS_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface NewsResult {
  content: string;
  error: string | null;
  isNew: boolean;
}

export function useNews() {
  const { authFetch, serverUrl, user } = useAuth();
  const [playStashNews, setPlayStashNews] = useState<NewsResult | null>(null);
  const [serverNews, setServerNews] = useState<NewsResult | null>(null);

  const loadPlayStashNews = useCallback(async (): Promise<NewsResult> => {
    try {
      return await checkNews("hash_playstash_news", releaseNotes);
    } catch (error: any) {
      return {
        content: "",
        error: error.message || translate("news.error.playstash"),
        isNew: false,
      };
    }
  }, []);

  const loadServerNews = useCallback(async (): Promise<NewsResult> => {
    if (!serverUrl) {
      return {
        content: translate("news.noServer"),
        error: null,
        isNew: false,
      };
    }
    try {
      const base = serverUrl.replace(/\/$/, "");
      const res = await authFetch(base + "/api/config/news?_=" + Date.now());
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const text = await res.text();
      return await checkNews("hash_server_news", text);
    } catch (error: any) {
      return {
        content: "",
        error: error.message || translate("news.error.server"),
        isNew: false,
      };
    }
  }, [authFetch, serverUrl]);

  const fetchAllNews = useCallback(() => {
    void loadPlayStashNews().then(setPlayStashNews);
    void loadServerNews().then(setServerNews);
  }, [loadPlayStashNews, loadServerNews]);

  const updateServerNews = useCallback(
    async (content: string) => {
      if (!serverUrl) throw new Error(translate("news.noServer"));

      const base = serverUrl.replace(/\/$/, "");
      const res = await authFetch(base + "/api/config/news", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        throw new Error(
          (await res.text()) || `${res.status} ${res.statusText}`,
        );
      }

      const hash = content.trim() ? await hashText(content) : "";
      localStorage.setItem("hash_server_news", hash);
      setServerNews({ content, error: null, isNew: false });
    },
    [authFetch, serverUrl],
  );

  useEffect(() => {
    let cancelled = false;
    void loadPlayStashNews().then((news) => {
      if (!cancelled) setPlayStashNews(news);
    });
    void loadServerNews().then((news) => {
      if (!cancelled) setServerNews(news);
    });
    return () => {
      cancelled = true;
    };
  }, [loadPlayStashNews, loadServerNews]);

  // Re-check the server news every hour while logged in (WPF), so the
  // unread badge appears without a restart.
  const loggedIn = !!user;
  useEffect(() => {
    if (!loggedIn) return;
    const id = window.setInterval(
      () => void loadServerNews().then(setServerNews),
      NEWS_CHECK_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [loggedIn, loadServerNews]);

  const hasNewNews =
    (playStashNews?.isNew ?? false) || (serverNews?.isNew ?? false);
  const markNewsAsRead = useCallback(() => {
    if (playStashNews?.content) localStorage.setItem("hash_playstash_news", "");
    if (serverNews?.content) localStorage.setItem("hash_server_news", "");
    if (playStashNews?.content) {
      hashText(playStashNews.content).then((hash) =>
        localStorage.setItem("hash_playstash_news", hash),
      );
    }
    if (serverNews?.content) {
      hashText(serverNews.content).then((hash) =>
        localStorage.setItem("hash_server_news", hash),
      );
    }
  }, [playStashNews, serverNews]);

  return {
    playStashNews,
    serverNews,
    fetchAllNews,
    hasNewNews,
    markNewsAsRead,
    updateServerNews,
  };
}
