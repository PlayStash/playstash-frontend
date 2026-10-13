# Interface languages

Choose **Settings → Appearance → Interface language** to follow the device language or select English or German. The choice is stored on this device and updates translated controls immediately. Other tabs follow changes to the stored preference. The document language also follows the selected interface language, including native form controls.

This is an initial translation foundation. Navigation, the profile menu, and appearance/language labels are translated. Other pages, game/server content, error messages, and dynamic client messages are not fully translated yet. Missing entries fall back to English. Unsupported device languages use English.

Local UTF-8 catalogs live in `src/locales/en.json` and `src/locales/de.json`. English defines stable semantic keys; additional catalogs can omit entries during translation. Add new source entries to English, provide translated entries where available, and use `useTranslation().t(...)` in React components or `translate(...)` outside components. Do not translate usernames, game metadata, API enum values, or technical identifiers.

New supported languages require registration in `src/i18n.ts` as well as their catalog. Run the language tests after adding entries. Catalogs ship with the frontend and work offline; no external translation service is required.
