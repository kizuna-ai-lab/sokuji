import type { Page } from '@playwright/test';
import { baseStorage, newUserData } from '../support/app';
import { meeting, seedHistory } from '../support/seed';
import { expect, test } from '../support/test';

/** Words that are names, not English left untranslated. */
const NAMES = new Set(['Sokuji', 'Kizuna', 'AI', 'OpenAI', 'Soniox', 'KB', 'MB', 'GB', 'fake']);

/**
 * The words in Latin letters on the screen's own interface, leaving out what the user's records say (the seeded
 * transcript is English) and the names above.
 */
const latinWords = (page: Page, root: string, skip: string[]) => page.evaluate(({ root, skip }) => {
  const words: string[] = [];
  const walker = document.createTreeWalker(document.querySelector(root)!, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement!;
    if (skip.some((s) => el.closest(s)) || !el.checkVisibility()) continue;
    words.push(...(node.textContent?.match(/[A-Za-z]{2,}/g) ?? []));
  }
  const top = document.querySelector<HTMLElement>(root)!;
  // The root's own attributes too (a menu's aria-label is on the menu itself).
  for (const el of [top, ...top.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder]')]) {
    if (skip.some((s) => el.closest(s)) || !el.checkVisibility()) continue;
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      const value = el.getAttribute(attr) ?? '';
      // A folder's path (the History folder's, on its button) is the disk's, not the interface's.
      if (/^([A-Za-z]:)?[\\/]/.test(value)) continue;
      words.push(...(value.match(/[A-Za-z]{2,}/g) ?? []));
    }
  }
  return words;
}, { root, skip });

/** Visible elements that run past the window's edges: each element matching `root`, and everything in it. */
const offTheWindow = (page: Page, root: string) => page.evaluate((root) => [...document.querySelectorAll<HTMLElement>(`${root}, ${root} *`)]
  .filter((el) => el.checkVisibility() && el.getClientRects().length > 0)
  .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.left < -1 || b.right > window.innerWidth + 1); })
  .map((el) => `${el.tagName.toLowerCase()}.${el.className}`), root);

// History in Chinese, Japanese and Arabic: its own words are all in the language, and nothing runs off the window.
for (const language of ['zh_CN', 'ja', 'ar']) {
  test(`History speaks ${language} throughout and fits the window`, async ({ launchApp }) => {
    const userData = newUserData();
    seedHistory(userData, [{ id: 'run-e2e-languages', startedAt: Date.now() - 3_600_000, durationMs: 60_000, sentences: meeting(6) }]);
    const sokuji = await launchApp({ userData, seed: { storage: { ...baseStorage('fake'), i18nextLng: language } } });
    const { page, app } = sokuji;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 760));
    await page.waitForFunction(() => window.innerWidth === 1000);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(language.replace('_', '-'));

    // The list.
    await page.locator('.title-bar__action:has(svg.lucide-history)').click();
    await expect(page.locator('.history-list [data-record]')).toHaveCount(1);
    // The seeded record has no title of its own: the one shown is the app's ("Session at …"), and is checked too.
    expect((await latinWords(page, '[data-testid="history-list"]', [])).filter((w) => !NAMES.has(w))).toEqual([]);
    expect(await offTheWindow(page, '[data-testid="history-list"]')).toEqual([]);

    // The record page, its menus open.
    await page.locator('.history-row__open').first().click();
    await expect(page.locator('.record-page__transcript .record-row').first()).toBeVisible();
    const record = ['.record-page__transcript'];
    expect((await latinWords(page, '.record-page', record)).filter((w) => !NAMES.has(w))).toEqual([]);
    expect(await offTheWindow(page, '.record-page')).toEqual([]);
    await page.locator('.record-page__more > button').click();
    expect((await latinWords(page, '.record-page__menu', [])).filter((w) => !NAMES.has(w))).toEqual([]);
    expect(await offTheWindow(page, '.record-page__menu')).toEqual([]);
    await page.keyboard.press('Escape');
    // The Export menu opens in a layer of its own, outside the record page.
    await page.locator('.record-page__actions button:has(svg.lucide-download)').click();
    await expect(page.locator('[role="menu"]')).toBeVisible();
    expect((await latinWords(page, '[role="menu"]', [])).filter((w) => !/^(txt|json|srt|vtt|md|opus)$/.test(w) && !NAMES.has(w))).toEqual([]);
    expect(await offTheWindow(page, '[role="menu"]')).toEqual([]);
    expect(sokuji.errors).toEqual([]);
  });
}
