// src/components/Settings/sections/interfaceLanguages.ts
//
// The languages Sokuji's own menus and buttons can be shown in — not the
// languages it can translate between, which is a separate and far more
// frequently changed setting.
//
// This list used to live inside LanguageSection's function body, rebuilt on
// every render, alongside a 12-entry "simplified" variant shown in Simple
// mode. Both are gone: the control now sits in Help at the weight of a link,
// so the reason to shorten it — sparing a prominent setting's worth of
// attention — no longer applies, while failing to find your own language in
// it stays as bad as it ever was.
//
// One entry per directory under src/locales. locales.consistency.test.ts
// guards that correspondence.
export interface InterfaceLanguage {
  value: string;
  label: string;
}

// Ordered by speaker population, which is why English leads and Finnish
// trails; it is not alphabetical in any of the labels' own scripts.
export const INTERFACE_LANGUAGES: InterfaceLanguage[] = [
  { value: 'en', label: 'English' },
  { value: 'zh_CN', label: '中文 (简体)' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'ar', label: 'العربية' },
  { value: 'bn', label: 'বাংলা' },
  { value: 'pt_BR', label: 'Português (Brasil)' },
  { value: 'ru', label: 'Русский' },
  { value: 'ja', label: '日本語' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ko', label: '한국어' },
  { value: 'fa', label: 'فارسی' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'it', label: 'Italiano' },
  { value: 'th', label: 'ไทย' },
  { value: 'pl', label: 'Polski' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'zh_TW', label: '中文 (繁體)' },
  { value: 'pt_PT', label: 'Português (Portugal)' },
  { value: 'uk', label: 'Українська' },
  { value: 'ta', label: 'தமிழ்' },
  { value: 'te', label: 'తెలుగు' },
  { value: 'he', label: 'עברית' },
  { value: 'fil', label: 'Filipino' },
  { value: 'sv', label: 'Svenska' },
  { value: 'fi', label: 'Suomi' },
];
