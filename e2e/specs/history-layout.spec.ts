import type { ElectronApplication, Page } from '@playwright/test';
import { baseStorage, newUserData } from '../support/app';
import { meeting, seedHistory } from '../support/seed';
import { expect, test } from '../support/test';

const HOUR = 3_600_000;
/** Two ended records, the newer first in the list: no session to wait through. */
function twoRecords() {
  const userData = newUserData();
  const now = Date.now();
  seedHistory(userData, [
    { id: 'run-e2e-layout-older', startedAt: now - 2 * HOUR, durationMs: 60_000, sentences: meeting(6) },
    { id: 'run-e2e-layout-newer', startedAt: now - HOUR, durationMs: 60_000, sentences: meeting(6) },
  ]);
  return userData;
}
/** The app's settings, in an interface language (`i18nextLng`, where the app reads it from). */
const storage = (language = 'en') => ({ ...baseStorage('fake'), i18nextLng: language });

/** The window's page this wide (and 760 high), once the page has it. */
async function widthTo(app: ElectronApplication, page: Page, width: number) {
  await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w, 760), width);
  await page.waitForFunction((w) => window.innerWidth === w, width);
}
/** History, from the title bar's History button (found by its icon, in any language). */
const openHistory = (page: Page) => page.locator('.title-bar__action:has(svg.lucide-history)').click();
const rows = (page: Page) => page.locator('.history-list [data-record]');
const openRow = async (page: Page, n: number) => {
  await rows(page).nth(n).locator('.history-row__open').click();
  await expect(page.locator('.record-page__transcript .record-row').first()).toBeVisible();
};

/** Where the record page's title and its buttons are, and whether either is cut. */
const head = (page: Page) => page.evaluate(() => {
  const box = (el: Element) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  const buttons = [...document.querySelectorAll<HTMLElement>('.record-page__actions button')].filter((b) => b.offsetParent !== null);
  const title = document.querySelector<HTMLElement>('.record-page__title > span')!;
  return {
    width: window.innerWidth,
    title: { ...box(title), cut: title.scrollWidth > title.clientWidth, fontSize: parseFloat(getComputedStyle(title).fontSize) },
    buttons: buttons.map((b) => {
      const icon = b.querySelector('svg');
      return { ...box(b), cut: b.scrollWidth > b.clientWidth + 1, iconOnly: !b.textContent?.trim(), icon: icon ? box(icon) : null };
    }),
  };
});
type Box = { left: number; right: number; top: number; bottom: number };
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The record page's buttons: one height, set evenly apart, an icon alone centred; none cut, none off the window. Export
 *  and More at least: on a page too narrow for two columns the panels are tabs, and their switches give way (#792). */
function expectEvenButtons(layout: Awaited<ReturnType<typeof head>>) {
  expect(layout.buttons.length).toBeGreaterThanOrEqual(2);
  for (const b of layout.buttons) {
    expect(b.height).toBeCloseTo(30, 0);
    expect(b.cut).toBe(false);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(layout.width);
    if (b.iconOnly && b.icon) {
      expect(Math.abs((b.icon.left + b.icon.right) / 2 - (b.left + b.right) / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs((b.icon.top + b.icon.bottom) / 2 - (b.top + b.bottom) / 2)).toBeLessThanOrEqual(1);
    }
  }
  // Side by side on a row, 8 px apart.
  const byRow = new Map<number, typeof layout.buttons>();
  for (const b of layout.buttons) byRow.set(Math.round(b.top), [...(byRow.get(Math.round(b.top)) ?? []), b]);
  for (const row of byRow.values()) {
    const sorted = [...row].sort((a, b) => a.left - b.left);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].left - sorted[i - 1].right).toBeCloseTo(8, 0);
  }
}

// The record page's buttons are one height and evenly spaced; in a narrow window, in languages with long words, they
// stay whole and clickable, and the title alone gives way: on one line, cut short, clear of the buttons.
for (const language of ['ta', 'de']) {
  test(`the record page's buttons stay whole and even, and a long title gives way, in a narrow window (${language})`, async ({ launchApp }) => {
    const sokuji = await launchApp({ userData: twoRecords(), seed: { storage: storage(language) } });
    const { page, app } = sokuji;
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(language);
    await widthTo(app, page, 1200);
    await openHistory(page);
    await openRow(page, 0);
    // A long title, as a user might give one.
    await page.locator('.record-page__title').click();
    await page.keyboard.type('Quarterly planning with the regional sales leads, the product team and the support desk');
    await page.keyboard.press('Enter');
    await expect(page.locator('.record-page__title > span')).toContainText('Quarterly planning');

    expectEvenButtons(await head(page));
    for (const width of [900, 690, 610]) {
      await widthTo(app, page, width);
      const layout = await head(page);
      expectEvenButtons(layout);
      // The title: one line, cut short rather than pushing the buttons, and never under them.
      expect(layout.title.height).toBeLessThan(layout.title.fontSize * 2);
      expect(layout.title.cut).toBe(true);
      for (const b of layout.buttons) expect(overlaps(layout.title, b), `${width}px`).toBe(false);
    }
    // Still clickable at the narrowest: "More" opens its menu.
    await page.locator('.record-page__more > button').click();
    await expect(page.locator('.record-page__menu')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(sokuji.errors).toEqual([]);
  });
}

// A row lights up as a whole: over its empty space, over its text, and reached with the keyboard; the button inside
// adds no change of its own.
test('a History row lights up as a whole, under the pointer and from the keyboard', async ({ launchApp }) => {
  const sokuji = await launchApp({ userData: twoRecords(), seed: { storage: storage() } });
  const { page } = sokuji;
  await openHistory(page);
  const row = rows(page).first();
  const open = row.locator('.history-row__open');
  const looks = () => row.evaluate((li) => {
    const button = li.querySelector('.history-row__open')!;
    return { row: getComputedStyle(li).backgroundColor, outline: getComputedStyle(li).outlineStyle, button: getComputedStyle(button).backgroundColor };
  });
  await page.mouse.move(1, 1);
  const resting = await looks();

  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  const overSpace = await looks();
  expect(overSpace.row).not.toBe(resting.row);

  await open.hover();
  const overText = await looks();
  expect(overText.row).toBe(overSpace.row);
  expect(overText.button).toBe('rgba(0, 0, 0, 0)');

  // From the keyboard: the whole row is marked, the button inside is not on its own.
  await page.mouse.move(1, 1);
  await open.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(open).toBeFocused();
  const focused = await looks();
  expect(focused.outline).toBe('solid');
  expect(focused.button).toBe('rgba(0, 0, 0, 0)');
  expect(sokuji.errors).toEqual([]);
});

// The edit panel (named "Edit" since #792) is open at first; closed, it stays closed for the next record and after a
// restart. The notes column's divider drags between 240 px and 60 % of the window.
test('the edit panel stays as it was left, and the notes column drags between its limits', async ({ launchApp }) => {
  const userData = twoRecords();
  const first = await launchApp({ userData, seed: { storage: storage() } });
  const { page, app } = first;
  await widthTo(app, page, 1200);
  await openHistory(page);
  await openRow(page, 0);
  const panel = page.getByRole('complementary', { name: 'Edit', exact: true });
  const sideSwitch = page.getByRole('button', { name: 'Edit', exact: true });
  await expect(panel).toBeVisible();
  await expect(sideSwitch).toHaveAttribute('aria-pressed', 'true');
  await sideSwitch.click();
  await expect(panel).toBeHidden();
  await expect(sideSwitch).toHaveAttribute('aria-pressed', 'false');

  // Another record, then this one again: still closed.
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await openRow(page, 1);
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await openRow(page, 0);
  await expect(panel).toBeHidden();

  // The notes column's divider: as far as it goes each way.
  const divider = page.getByRole('separator', { name: 'Resize the notes' });
  const notesWidth = () => page.locator('.record-page__notes-col').evaluate((el) => el.getBoundingClientRect().width);
  const drag = async (dx: number) => {
    const b = (await divider.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  await drag(-2_000);
  expect(await notesWidth()).toBeCloseTo(240, 0);
  await drag(2_000);
  const widest = await notesWidth();
  expect(widest).toBeGreaterThan(240);
  expect(widest).toBeLessThanOrEqual(0.6 * 1200);
  expect(first.errors).toEqual([]);
  await first.close();

  // After a restart: the edit panel still closed.
  const again = await launchApp({ userData });
  await openHistory(again.page);
  await openRow(again.page, 0);
  await expect(again.page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(again.page.getByRole('complementary', { name: 'Edit', exact: true })).toBeHidden();
  expect(again.errors).toEqual([]);
});

// A sentence's buttons ("Change speaker") stay hidden until the sentence is pointed at. A row's last sentence gets no
// empty line under it for them at any width (the transcript column is swept across the two-column layout's widths, with
// sentences of many lengths, one to three to a row), and shown, they cover no text.
test('a sentence\'s hidden buttons add no empty line under it', async ({ launchApp }) => {
  const userData = newUserData();
  const words = 'the quick brown fox jumps over a lazy dog and keeps running far away from the river bank'.split(' ');
  seedHistory(userData, [{
    id: 'run-e2e-layout-lines', startedAt: Date.now() - HOUR, durationMs: 300_000,
    sentences: Array.from({ length: 30 }, (_, i) => {
      // Rows of one, two and three sentences: a segment's sentences, on one side.
      const segment = Math.floor(i / 6) * 3 + [0, 1, 1, 2, 2, 2][i % 6];
      return {
        side: segment % 2 === 0 ? 'mine' as const : 'other' as const,
        text: `${words.slice(0, 3 + ((i * 7) % 15)).join(' ')} ${i + 1}.`,
        startMs: i * 10_000,
        endMs: i * 10_000 + 9_000,
        segmentId: `seg-${segment}`,
      };
    }),
  }]);
  const { page, app } = await launchApp({ userData, seed: { storage: storage() } });
  await widthTo(app, page, 900);
  await openHistory(page);
  await openRow(page, 0);
  await page.mouse.move(1, 1);
  const extra: string[] = [];
  for (let width = 641; width <= 880; width += 3) {
    await widthTo(app, page, width);
    // A line of a row with no sentence's text on it.
    const lonely = await page.evaluate(() => [...document.querySelectorAll('.record-row__text')].filter((row) => {
      const tops = (rects: DOMRectList | DOMRect[]) => new Set([...rects].map((r) => Math.round(r.top)));
      const text = new Set<number>();
      const lines = new Set<number>();
      for (const sentence of row.querySelectorAll('.record-sentence')) {
        const range = document.createRange();
        range.selectNodeContents(sentence.firstChild!);
        for (const t of tops(range.getClientRects())) text.add(t);
        for (const t of tops(sentence.getClientRects())) lines.add(t);
      }
      return [...lines].some((t) => !text.has(t));
    }).length);
    if (lonely > 0) extra.push(`${width}px: ${lonely}`);
  }
  expect(extra).toEqual([]);

  // Pointed at, the buttons take their room again, after the text: the text stays where it was, under the pointer.
  const moved: string[] = [];
  const misplaced: string[] = [];
  const covering: string[] = [];
  for (const width of [641, 700, 760, 820, 880]) {
    await widthTo(app, page, width);
    const count = await page.locator('.record-sentence').count();
    for (let i = 0; i < count; i++) {
      const sentence = page.locator('.record-sentence').nth(i);
      await sentence.scrollIntoViewIfNeeded();
      const lastLine = () => sentence.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild!);
        const rects = [...range.getClientRects()];
        const r = rects[rects.length - 1];
        return { x: r.right - 2, y: r.top + r.height / 2, top: r.top, right: r.right };
      });
      const before = await lastLine();
      await page.mouse.move(before.x, before.y);
      const after = await lastLine();
      const hovered = await sentence.evaluate((el) => el.matches(':hover'));
      if (after.top !== before.top || after.right !== before.right || !hovered) moved.push(`${width}px #${i + 1}`);
      // Shown, the button is on the sentence's last line, after its text, inside the row.
      const button = await sentence.evaluate((el) => {
        const b = el.querySelector('.record-sentence__menu-button')!.getBoundingClientRect();
        const row = el.closest('.record-row__text')!.getBoundingClientRect();
        return { left: b.left, right: b.right, middle: b.top + b.height / 2, rowRight: row.right };
      });
      if (button.left < after.right - 1 || button.right > button.rowRight + 1 || Math.abs(button.middle - after.y) > after.y - after.top) {
        misplaced.push(`${width}px #${i + 1}`);
      }
      // Nor over the next sentence of its row.
      const covers = await sentence.evaluate((el) => {
        const next = el.nextElementSibling;
        if (!next?.classList.contains('record-sentence')) return false;
        const b = el.querySelector('.record-sentence__menu-button')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(next.firstChild!);
        return [...range.getClientRects()].some((r) => b.left < r.right - 1 && r.left < b.right - 1 && b.top < r.bottom - 1 && r.top < b.bottom - 1);
      });
      if (covers) covering.push(`${width}px #${i + 1}`);
    }
    await page.mouse.move(1, 1);
  }
  expect(moved).toEqual([]);
  expect(misplaced).toEqual([]);
  expect(covering).toEqual([]);
});
