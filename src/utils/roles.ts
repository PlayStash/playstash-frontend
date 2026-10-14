// Role label helper (non-generated)
// Maps backend numeric roles to human-readable labels.
import { translate, type TranslationKey } from "@/i18n";

export const ROLE_LABELS: Record<number, TranslationKey> = {
  0: "admin.roles.guest",
  1: "admin.roles.user",
  2: "admin.roles.editor",
  3: "admin.roles.admin",
};

export function getRoleLabel(role: number | null | undefined): string {
  if (role === null || role === undefined) return "";
  const key = ROLE_LABELS[Number(role)];
  return key ? translate(key) : String(role);
}
