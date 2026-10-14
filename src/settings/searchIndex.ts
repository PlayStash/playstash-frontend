import type { SearchableSetting } from "@/settings/types";
import { coreSearchEntries } from "@/settings/search/core";
import { wp1SearchEntries } from "@/settings/search/wp1";
import { wp2SearchEntries } from "@/settings/search/wp2";
import { wp3SearchEntries } from "@/settings/search/wp3";
import { wp4SearchEntries } from "@/settings/search/wp4";
import { wp5SearchEntries } from "@/settings/search/wp5";
import { wp6SearchEntries } from "@/settings/search/wp6";
import { wp7SearchEntries } from "@/settings/search/wp7";

/**
 * Flat index of every individual setting, used by the settings search bar to
 * surface results that map back to their owning category. Each feature
 * package keeps its entries in its own `search/<wp>.ts` file.
 */
export const SETTINGS_SEARCH_INDEX: SearchableSetting[] = [
  ...coreSearchEntries,
  ...wp1SearchEntries,
  ...wp2SearchEntries,
  ...wp3SearchEntries,
  ...wp4SearchEntries,
  ...wp5SearchEntries,
  ...wp6SearchEntries,
  ...wp7SearchEntries,
];
