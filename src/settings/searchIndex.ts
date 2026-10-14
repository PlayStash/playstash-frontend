import type { SearchableSetting } from "@/settings/types";
import { coreSearchEntries } from "@/settings/search/core";
import { osIntegrationSearchEntries } from "@/settings/search/osIntegration";
import { communitySearchEntries } from "@/settings/search/community";
import { cloudSavesSearchEntries } from "@/settings/search/cloudSaves";
import { launchSearchEntries } from "@/settings/search/launch";
import { downloadsSearchEntries } from "@/settings/search/downloads";
import { accountsSearchEntries } from "@/settings/search/accounts";
import { appearanceSearchEntries } from "@/settings/search/appearance";

/**
 * Flat index of every individual setting, used by the settings search bar to
 * surface results that map back to their owning category. Each settings area
 * keeps its entries in its own `search/<area>.ts` file.
 */
export const SETTINGS_SEARCH_INDEX: SearchableSetting[] = [
  ...coreSearchEntries,
  ...osIntegrationSearchEntries,
  ...communitySearchEntries,
  ...cloudSavesSearchEntries,
  ...launchSearchEntries,
  ...downloadsSearchEntries,
  ...accountsSearchEntries,
  ...appearanceSearchEntries,
];
