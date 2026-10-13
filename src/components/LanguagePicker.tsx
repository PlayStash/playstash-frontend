import { Select } from "@tw/select";
import {
  setLanguage,
  supportedLanguages,
  useLanguagePreference,
  useTranslation,
  type LanguagePreference,
} from "@/i18n";

export function LanguagePicker() {
  const preference = useLanguagePreference();
  const { t } = useTranslation();
  return (
    <Select
      aria-label={t("language.title")}
      value={preference}
      onChange={(event) =>
        setLanguage(event.target.value as LanguagePreference)
      }
    >
      <option value="system">{t("language.system")}</option>
      {supportedLanguages.map(({ code, name }) => (
        <option key={code} value={code} lang={code}>
          {name}
        </option>
      ))}
    </Select>
  );
}
