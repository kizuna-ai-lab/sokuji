import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { baseStorage, mainAction } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

/** A session on the fake service through both of its exchanges, ended. The panel is empty first: the text found is this session's. */
async function recordASession(page: Page) {
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('Click Start to begin real-time translation')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('元気です。ありがとう。').first()).toBeVisible({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
}

const openTheRecord = async (page: Page) => {
  await page.locator('[data-record] .history-row__open').first().click();
  await expect(page.locator('.record-page__transcript .record-row').first()).toBeVisible();
};
/** The playback rate of the record's audio. */
const rate = (page: Page) => page.evaluate(() => (document.querySelector('.record-player audio') as HTMLAudioElement | null)?.playbackRate ?? null);
/** A size as History writes it ("29.1 KB"), in bytes. */
const bytesOf = (text: string) => {
  const [, n, unit] = text.match(/([\d.]+) (KB|MB|GB)/) ?? [];
  return Number(n) * 1024 ** (['KB', 'MB', 'GB'].indexOf(unit) + 1);
};

// The player's speed is a list of speeds with the current one shown; a choice applies at once and is kept for the
// next time a record is opened.
test('the speed chosen in the player applies at once and is kept when the record is opened again', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: { storage: baseStorage('fake') } });
  const { page } = sokuji;
  await recordASession(page);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await openTheRecord(page);

  const speed = page.getByRole('group', { name: 'Recording' }).getByRole('combobox', { name: 'Speed' });
  await expect(speed.locator('option')).toHaveText(['0.75×', '1×', '1.25×', '1.5×', '2×']);
  await expect(speed).toHaveValue('1');
  await speed.selectOption('1.5');
  await expect(speed).toHaveValue('1.5');
  expect(await rate(page)).toBe(1.5);

  await page.getByRole('button', { name: 'Back to the list' }).click();
  await openTheRecord(page);
  await expect(speed).toHaveValue('1.5');
  expect(await rate(page)).toBe(1.5);
  // Played, the recording runs at that speed.
  await page.getByRole('group', { name: 'Recording' }).getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => page.evaluate(() => (document.querySelector('.record-player audio') as HTMLAudioElement).currentTime), { timeout: 5_000 })
    .toBeGreaterThan(0.2);
  expect(await rate(page)).toBe(1.5);

  await speed.selectOption('1');
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await openTheRecord(page);
  await expect(speed).toHaveValue('1');
  expect(sokuji.errors).toEqual([]);
});

// "Delete the recording" asks first and says what stays; then the record keeps its transcript, has no player and no
// recording tag, the space History takes goes down by about the recording's size, and the file is gone from disk.
test('deleting only the recording keeps the transcript and frees its space', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: { storage: baseStorage('fake') } });
  const { page, userData } = sokuji;
  await recordASession(page);
  await page.getByRole('button', { name: 'History', exact: true }).click();

  const row = page.locator('[data-record]').first();
  const recordingTag = row.locator('.history-tag', { hasText: /^Recording · / });
  await expect(recordingTag).toBeVisible();
  const recordingBytes = bytesOf(await recordingTag.innerText());
  const space = page.locator('.history-nav__space span').first();
  await expect(space).toHaveText(/ in 1 record$/);
  const before = bytesOf(await space.innerText());

  await openTheRecord(page);
  const player = page.getByRole('group', { name: 'Recording' });
  await expect(player).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play from here' }).first()).toBeVisible();
  const sentences = await page.locator('.record-page__transcript .record-row').count();

  // Asked first; Cancel keeps the recording.
  const more = page.getByRole('button', { name: 'More', exact: true });
  const deleteItem = page.getByRole('menuitem', { name: 'Delete the recording' });
  const confirm = page.getByRole('alertdialog', { name: 'Delete the recording' });
  await more.click();
  await deleteItem.click();
  await expect(confirm).toHaveText(/Its transcript and notes stay\. The recording cannot be brought back\./);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(player).toBeVisible();

  await more.click();
  await deleteItem.click();
  await confirm.getByRole('button', { name: 'Delete' }).click();

  // The transcript stays; nothing is left to play, and the menu no longer offers it.
  await expect(player).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play from here' })).toHaveCount(0);
  await expect(page.locator('.record-page__transcript .record-row')).toHaveCount(sentences);
  await expect(page.locator('.record-page__transcript').getByText('I am fine. Thank you.')).toBeVisible();
  await more.click();
  await expect(deleteItem).toBeDisabled();
  await page.keyboard.press('Escape');

  // The list: a transcript and no recording; the space goes down by about the recording's size.
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await expect(row.locator('.history-tag', { hasText: 'Transcript' })).toBeVisible();
  await expect(recordingTag).toHaveCount(0);
  await expect.poll(async () => before - bytesOf(await space.innerText())).toBeGreaterThan(recordingBytes * 0.8);
  // Settings shows the same figure.
  const after = await space.innerText();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'History and notes' }).click();
  await expect(page.getByText(after, { exact: true })).toBeVisible();

  expect(sokuji.errors).toEqual([]);
  await sokuji.close();
  const [record] = readHistory(userData);
  expect(record.state).toBe('closed');
  expect(record.sentences).toBeGreaterThan(0);
  expect(record.tracks.every((track) => track.fileBytes === null)).toBe(true);
  const folder = path.join(userData, 'history', 'records', record.id);
  expect(fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith('.opus')) : []).toEqual([]);
});
