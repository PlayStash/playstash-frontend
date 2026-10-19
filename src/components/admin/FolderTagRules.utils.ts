import { formatMessage } from "@/utils/formatMessage";
import { translate } from "@/i18n";
export interface Rule {
  folder_prefix: string;
  tags: string[];
  enabled?: boolean;
}
export interface RuleResult {
  rules: Rule[];
  applied_games: number;
  failed_games: number;
}
export interface DraftRule {
  folder: string;
  tags: string;
  enabled: boolean;
}
export function normalizeFolderTagRules(drafts: DraftRule[]): Rule[] {
  return drafts.map((draft, index) => {
    const folder = draft.folder.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    const tags = [
      ...new Set(
        draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    if (
      !folder ||
      folder.startsWith("/") ||
      folder.includes(":") ||
      folder.split("/").some((part) => !part || part === ".." || part === ".")
    )
      throw new Error(
        formatMessage(translate("admin.folderTags.error.folder"), {
          index: index + 1,
        }),
      );
    if (!tags.length || tags.length > 20 || tags.some((tag) => tag.length > 64))
      throw new Error(
        formatMessage(translate("admin.folderTags.error.tags"), {
          index: index + 1,
        }),
      );
    return { folder_prefix: folder, tags, enabled: draft.enabled };
  });
}
