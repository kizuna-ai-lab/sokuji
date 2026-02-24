import { LanguageOption } from '../services/providers/ProviderConfig';

/** Shared language display name registry — single source of truth for code → display name */
export const LANGUAGE_OPTIONS: Record<string, LanguageOption> = {
  af: { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
  ar: { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  bat: { name: 'Baltic', value: 'bat', englishName: 'Baltic Languages' },
  cs: { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  da: { name: 'Dansk', value: 'da', englishName: 'Danish' },
  de: { name: 'Deutsch', value: 'de', englishName: 'German' },
  en: { name: 'English', value: 'en', englishName: 'English' },
  es: { name: 'Español', value: 'es', englishName: 'Spanish' },
  fi: { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  fr: { name: 'Français', value: 'fr', englishName: 'French' },
  hi: { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  hu: { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  id: { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  it: { name: 'Italiano', value: 'it', englishName: 'Italian' },
  ja: { name: '日本語', value: 'ja', englishName: 'Japanese' },
  ko: { name: '한국어', value: 'ko', englishName: 'Korean' },
  mul: { name: 'Multiple', value: 'mul', englishName: 'Multiple Languages' },
  nl: { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  no: { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  pl: { name: 'Polski', value: 'pl', englishName: 'Polish' },
  ro: { name: 'Română', value: 'ro', englishName: 'Romanian' },
  ru: { name: 'Русский', value: 'ru', englishName: 'Russian' },
  sv: { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  tr: { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  uk: { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  vi: { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  xh: { name: 'isiXhosa', value: 'xh', englishName: 'Xhosa' },
  zh: { name: '中文', value: 'zh', englishName: 'Chinese' },
};

/** Look up a LanguageOption by code, with fallback to code as display name */
export function getLanguageOption(code: string): LanguageOption {
  return LANGUAGE_OPTIONS[code] || { name: code, value: code, englishName: code };
}
