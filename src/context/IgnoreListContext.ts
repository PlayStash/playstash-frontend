import { createContext, useContext } from "react";

export interface IgnoreListContextValue {
  ignoreList: string[];
  initialized: boolean;
  loading: boolean;
  error: string | null;
  setIgnoreList: (names: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

export const IgnoreListContext = createContext<IgnoreListContextValue | null>(
  null,
);

export function useIgnoreList() {
  const ctx = useContext(IgnoreListContext);
  if (!ctx) {
    throw new Error("useIgnoreList must be used within IgnoreListProvider");
  }
  return ctx;
}
