import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageCode } from './code';
import { languageLabel } from './label';

/**
 * Names codes in the language the UI is shown in. Many suites mock
 * `react-i18next` with `t` alone: no `i18n` reads as English.
 */
export function useLanguageLabel(): (code: LanguageCode) => string {
  const { t, i18n } = useTranslation() as { t: (key: string, fallback?: string) => string; i18n?: { language?: string } };
  const ui = i18n?.language ?? 'en';
  const auto = t('common.autoDetect', 'Auto Detect');
  return useCallback((code: LanguageCode) => languageLabel(code, ui, auto), [ui, auto]);
}
