import type { Page } from '@playwright/test';
import { baseStorage, mainAction } from '../support/app';
import { expect, test } from '../support/test';

const BACKGROUND = 'Weekly sync of the Sokuji team: release plan and the new word list.';

async function openWordList(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: /^Word list and background/ }).click();
  await expect(page.getByRole('button', { name: 'Add a row' })).toBeVisible();
}

const writtenCells = (page: Page) => page.getByLabel(/^Written as \d+$/);

/** Fills one cell and leaves it: a row is saved when a cell is left. */
async function fill(page: Page, label: string, value: string) {
  const cell = page.getByLabel(label, { exact: true });
  await cell.fill(value);
  await cell.blur();
}

// The word list and the session background are kept by the app itself: what was typed, removed or left without a
// written form is what the app shows after it is closed and started again on the same state.
test('the word list and the session background are still there after the app is restarted', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: { storage: baseStorage('fake') } });
  const { page, userData } = sokuji;
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await openWordList(page);

  // Three rows: a full one, one to be removed, and one with a translation but no written form.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add a row' }).click();
  await fill(page, 'Written as 1', 'Sokuji');
  await fill(page, 'Translation 1', 'ソクジ');
  await fill(page, 'Often heard as 1', 'so cookie');
  await fill(page, 'Written as 2', 'Kizuna');
  await fill(page, 'Translation 3', 'no written form');
  await page.getByLabel('Session background').fill(BACKGROUND);
  await page.getByLabel('Session background').blur();

  // Removing a row takes effect at once: the third row moves up.
  await page.getByRole('button', { name: 'Remove 2' }).click();
  await expect(writtenCells(page)).toHaveCount(2);
  await expect(page.getByLabel('Written as 2', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Translation 2', { exact: true })).toHaveValue('no written form');

  await sokuji.close();

  // The same state, started again.
  const again = await launchApp({ userData });
  await expect(mainAction(again.page)).toBeEnabled({ timeout: 30_000 });
  await openWordList(again.page);

  // The full row, as typed; the removed row and the row with no written form are gone.
  await expect(again.page.getByLabel('Written as 1', { exact: true })).toHaveValue('Sokuji');
  await expect(again.page.getByLabel('Translation 1', { exact: true })).toHaveValue('ソクジ');
  await expect(again.page.getByLabel('Often heard as 1', { exact: true })).toHaveValue('so cookie');
  await expect(writtenCells(again.page)).toHaveCount(1);
  await expect(again.page.getByLabel('Session background')).toHaveValue(BACKGROUND);

  expect(sokuji.errors).toEqual([]);
  expect(again.errors).toEqual([]);
});
