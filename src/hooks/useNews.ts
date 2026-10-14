import { useAuth } from "@/context/AuthContext";
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

  const checkNews = useCallback(
    async (
      key: string,
      newsText: string,
      setNews: (nr: NewsResult) => void,
    ) => {
      if (!newsText.trim()) {
        setNews({ content: newsText, error: null, isNew: false });
        return;
      }
      const newHash = await hashText(newsText);
      const storedHash = localStorage.getItem(key);
      const isNew = storedHash ? storedHash !== newHash : false;
      setNews({ content: newsText, error: null, isNew });
    },
    [],
  );

  const fetchPlayStashNews = useCallback(async () => {
    try {
      await checkNews("hash_playstash_news", releaseNotes, setPlayStashNews);
    } catch (error: any) {
      setPlayStashNews({
        content: "",
        error: error.message || "Failed to load PlayStash news",
        isNew: false,
      });
    }
  }, [checkNews]);

  const fetchServerNews = useCallback(async () => {
    if (!serverUrl) {
      setServerNews({
        content: "No server connected.",
        error: null,
        isNew: false,
      });
      return;
    }
    try {
      const base = serverUrl.replace(/\/$/, "");
      const res = await authFetch(base + "/api/config/news?_=" + Date.now());
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const text = await res.text();
      await checkNews("hash_server_news", text, setServerNews);
    } catch (error: any) {
      setServerNews({
        content: "",
        error: error.message || "Failed to load Server news",
        isNew: false,
      });
    }
  }, [authFetch, serverUrl, checkNews]);

  const fetchAllNews = useCallback(() => {
    fetchPlayStashNews();
    fetchServerNews();
  }, [fetchPlayStashNews, fetchServerNews]);

  const updateServerNews = useCallback(
    async (content: string) => {
      if (!serverUrl) throw new Error("No server connected.");

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
    fetchAllNews();
  }, [fetchAllNews]);

  // Re-check the server news every hour while logged in (WPF), so the
  // unread badge appears without a restart.
  const loggedIn = !!user;
  useEffect(() => {
    if (!loggedIn) return;
    const id = window.setInterval(
      () => void fetchServerNews(),
      NEWS_CHECK_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [loggedIn, fetchServerNews]);

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
