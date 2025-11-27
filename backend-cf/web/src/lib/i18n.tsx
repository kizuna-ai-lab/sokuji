/**
 * Internationalization (i18n) System
 *
 * Simple i18n implementation using React Context for documentation pages.
 * Supports: English, Chinese, Japanese, Korean
 */

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

export type Locale = 'en' | 'zh' | 'ja' | 'ko';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Translation type
type Translations = Record<string, string>;

// Import translations
import en from '../locales/docs/en';
import zh from '../locales/docs/zh';
import ja from '../locales/docs/ja';
import ko from '../locales/docs/ko';

const translations: Record<Locale, Translations> = {
  en,
  zh,
  ja,
  ko,
};

// Language display names
export const localeNames: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
};

// Detect browser language
function detectBrowserLocale(): Locale {
  const browserLang = navigator.language.toLowerCase();

  if (browserLang.startsWith('zh')) return 'zh';
  if (browserLang.startsWith('ja')) return 'ja';
  if (browserLang.startsWith('ko')) return 'ko';

  return 'en';
}

// Get stored locale from localStorage
function getStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem('docs-locale');
    if (stored && ['en', 'zh', 'ja', 'ko'].includes(stored)) {
      return stored as Locale;
    }
  } catch {
    // localStorage not available
  }
  return null;
}

// Store locale to localStorage
function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem('docs-locale', locale);
  } catch {
    // localStorage not available
  }
}

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    return getStoredLocale() || detectBrowserLocale();
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    storeLocale(newLocale);
    // Update document lang attribute
    document.documentElement.lang = newLocale;
  }, []);

  // Set initial document lang
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback((key: string, fallback?: string): string => {
    const localeTranslations = translations[locale];
    const value = localeTranslations?.[key];

    if (value !== undefined) {
      return value;
    }

    // Fallback to English
    const englishValue = translations.en?.[key];
    if (englishValue !== undefined) {
      return englishValue;
    }

    // Return fallback or key
    return fallback || key;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useTranslation() {
  const { t, locale } = useI18n();
  return { t, locale };
}
