import { describe, it, expect, vi } from 'vitest';
import type { i18n as I18n } from 'i18next';
import i18n from '../../locales';
import { languageOf, uiLanguage } from './uiLanguage';

function fakeI18n(language: string) {
  const handlers = new Set<() => void>();
  const fake = {
    language,
    on: (_event: string, handler: () => void) => { handlers.add(handler); },
    off: (_event: string, handler: () => void) => { handlers.delete(handler); },
  };
  return { fake: fake as unknown as Pick<I18n, 'language' | 'on' | 'off'>, handlers, change(next: string) { fake.language = next; handlers.forEach((h) => h()); } };
}

describe('languageOf', () => {
  it("reads the instance's current language", () => {
    expect(languageOf(fakeI18n('ja').fake).get()).toBe('ja');
  });

  it('notifies a subscribed listener once on a language change, and reads the new one', () => {
    const { fake, change } = fakeI18n('ja');
    const readable = languageOf(fake);
    const listener = vi.fn();
    readable.subscribe(listener);
    change('fr');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readable.get()).toBe('fr');
  });

  it('stops listening once unsubscribed', () => {
    const { fake, handlers, change } = fakeI18n('ja');
    const readable = languageOf(fake);
    const listener = vi.fn();
    const unsubscribe = readable.subscribe(listener);
    unsubscribe();
    expect(handlers.size).toBe(0);
    change('de');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('uiLanguage', () => {
  it("reads the app's own i18next instance", () => {
    expect(uiLanguage.get()).toBe(i18n.language);
  });
});
