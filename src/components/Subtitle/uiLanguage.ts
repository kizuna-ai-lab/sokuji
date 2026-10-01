/**
 * The side panel's interface language, for the overlay's wire (plan 1e-4
 * ruling 5). The picker changes i18next directly (`HelpSection`), so no
 * store holds it; and the overlay cannot read it for itself — its
 * `localStorage` sits inside the meeting page.
 */
import type { i18n as I18n } from 'i18next';
import i18n from '../../locales';
import type { Readable } from '../../lib/view/conversationView';

/** An i18next instance's language as a `Readable`: its `language`, and its `languageChanged` event. */
export function languageOf(instance: Pick<I18n, 'language' | 'on' | 'off'>): Readable<string> {
  return {
    get: () => instance.language,
    subscribe(listener) {
      const handler = () => listener();
      instance.on('languageChanged', handler);
      return () => instance.off('languageChanged', handler);
    },
  };
}

/** The app's own interface language. */
export const uiLanguage: Readable<string> = languageOf(i18n);
