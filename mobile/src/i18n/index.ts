import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { CATALOGS } from './catalogs';
import { pickLanguage } from './pickLanguage';

export { pickLanguage, CATALOGS };

// The device's language, from the desktop's 30 catalogs: only the picked one
// and English (the fallback) are loaded.
export async function initI18n(): Promise<void> {
  const lng = pickLanguage(getLocales().map((l) => l.languageTag), Object.keys(CATALOGS));
  // A catalog that fails to load (a broken chunk) falls back to English rather than raw keys.
  const [picked, en] = await Promise.all([CATALOGS[lng]().catch(() => CATALOGS.en()), CATALOGS.en()]);
  const resources: Record<string, { translation: Record<string, unknown> }> = { en: { translation: en.default } };
  if (lng !== 'en') resources[lng] = { translation: picked.default };
  await i18next.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    resources,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}
