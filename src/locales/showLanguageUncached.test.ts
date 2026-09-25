import { afterAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import i18n, { changeLanguageWithLoad, showLanguageUncached } from './index';

/**
 * Vitest isolates modules per file, so turning the language detector's cache
 * off here (a one-way switch, plan 1e-4 ruling 5) touches no other test file.
 */
describe('showLanguageUncached', () => {
  let setItem: MockInstance;

  afterAll(() => {
    setItem.mockRestore();
    localStorage.removeItem('i18nextLng');
  });

  it("shows a language without writing it to this document's storage (controller ruling M11)", async () => {
    // 1. The control: the ordinary path does cache, so the assertions below mean something.
    await changeLanguageWithLoad('de');
    expect(localStorage.getItem('i18nextLng')).toBe('de');

    // 2. showLanguageUncached switches this document without writing storage.
    setItem = vi.spyOn(Storage.prototype, 'setItem');
    await showLanguageUncached('ja');
    expect(i18n.language).toBe('ja');
    expect(localStorage.getItem('i18nextLng')).toBe('de');
    expect(setItem.mock.calls.filter(([key]) => key === 'i18nextLng')).toEqual([]);

    // 3. The cache stays off for the rest of the document's life: even the ordinary path no longer writes.
    await changeLanguageWithLoad('fr');
    expect(i18n.language).toBe('fr');
    expect(localStorage.getItem('i18nextLng')).toBe('de');
  });
});
