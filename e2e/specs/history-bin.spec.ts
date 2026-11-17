import type { Page } from '@playwright/test';
import { baseStorage, mainAction } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

/** A session on the fake service, started and through its first exchange. The panel keeps the last session's text
 * until a new one starts and empties it, so the wait is for the empty panel first and then for this session's own
 * translated sentence. */
async function startASession(page: Page) {
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('Click Start to begin real-time translation')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('こんにちは、お元気ですか？').first()).toBeVisible({ timeout: 30_000 });
}

/** A short session on the fake service, ended. */
async function recordASession(page: Page) {
  await startASession(page);
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
}

const nav = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'History' }).getByRole('button', { name });
const countOf = async (page: Page, name: RegExp) => (await nav(page, name).locator('small').textContent()) ?? '';
const rows = (page: Page) => page.locator('.history-list [data-record]');

// Records go to the bin from Select, come back from it, and are deleted for good from it; a session still running
// cannot be selected; the bin says how long it keeps records, and deleting for good says it cannot be undone.
test('records go to the bin and back, are deleted for good, and a running session cannot be binned', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: { storage: baseStorage('fake') } });
  const { page, userData } = sokuji;
  await recordASession(page);
  await recordASession(page);
  // A third session, still running while History is open.
  await startASession(page);

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByText('In progress')).toBeVisible();

  // Select: the running session has no box to tick, and clicking it selects nothing; the two ended ones go to the bin.
  await page.getByRole('button', { name: 'Select records' }).click();
  const boxes = page.getByRole('checkbox', { name: /^Select “/ });
  await expect(boxes).toHaveCount(2);
  const running = rows(page).filter({ hasText: 'In progress' });
  await running.locator('.history-row__open').click();
  await expect(page.getByText('0 selected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move to bin', exact: true })).toBeDisabled();
  for (const box of await boxes.all()) await box.check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Move to bin', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(await countOf(page, /^Bin/)).toBe('2');

  // The bin: it says how long it keeps records; one comes back to the list.
  await nav(page, /^Bin/).click();
  await expect(page.getByText('Records in the bin are deleted for good after 30 days.')).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await rows(page).first().getByRole('button', { name: 'Restore' }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(await countOf(page, /^All records/)).toBe('2');

  // Deleted for good: the question says it cannot be brought back; Cancel keeps it, Delete does not.
  await rows(page).first().getByRole('button', { name: 'Delete for good' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete for good' });
  await expect(confirm).toContainText('Delete 1 record for good? Its transcript and recording cannot be brought back.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().getByRole('button', { name: 'Delete for good' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('The bin is empty.')).toBeVisible();

  // The restored record goes to the bin again, and Empty bin takes it.
  await nav(page, /^All records/).click();
  await page.getByRole('button', { name: 'Select records' }).click();
  await expect(boxes).toHaveCount(1);
  await boxes.first().check();
  await page.getByRole('button', { name: 'Move to bin', exact: true }).click();
  await nav(page, /^Bin/).click();
  await page.getByRole('button', { name: 'Empty bin' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('The bin is empty.')).toBeVisible();

  // Back to the session, which ends; only it is left in the store.
  await page.getByRole('button', { name: 'Back to the session' }).click();
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  expect(sokuji.errors).toEqual([]);
  await sokuji.close();
  const stored = readHistory(userData);
  expect(stored).toHaveLength(1);
  expect(stored[0].state).toBe('closed');
});
