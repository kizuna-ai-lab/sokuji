import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { baseStorage, mainAction, REPO } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

/**
 * What a crash right after Start leaves: a record still open with nothing said in it, and its folder with the start
 * of a recording. Written with the app's own store while the app is not running.
 */
function leaveAnEmptyRecordOpen(userData: string, id: string) {
  const nodeRequire = createRequire(__filename);
  const { openHistory } = nodeRequire(path.join(REPO, 'electron/history-store.js')) as {
    openHistory(o: { dir: string }): { openRecord(o: unknown): void; close(): void };
  };
  const store = openHistory({ dir: path.join(userData, 'history') });
  try {
    store.openRecord({
      id, startedAt: Date.now(), mode: 'both', myLanguage: 'en', targetLanguage: 'ja', services: { provider: 'fake', models: {} }, appVersion: '0.0.0-e2e',
    });
  } finally {
    store.close();
  }
  const folder = path.join(userData, 'history', 'records', id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'speaker.opus'), Buffer.from('OggS'));
}

const recordFolders = (userData: string) => {
  const dir = path.join(userData, 'history', 'records');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

// A session the app was killed in is there after the restart, ended, with what it had said; a record left open with
// nothing in it is cleared away with its folder; no folder is left without a record.
test('after a crash, a session comes back ended with what it had, and an empty record is cleared away', async ({ launchApp }) => {
  const first = await launchApp({ seed: { storage: baseStorage('fake') } });
  const { page, userData } = first;
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(page.getByText('Click Start to begin real-time translation')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('こんにちは、お元気ですか？').first()).toBeVisible({ timeout: 30_000 });
  // In History while it runs: the record is there, in progress, its first exchange already kept.
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const rows = page.locator('.history-list [data-record]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('In progress');
  await expect(rows.first().locator('.history-tag', { hasText: 'Transcript' })).toBeVisible();
  // The settings were seeded seconds ago, and Chromium writes the page's storage to disk in batches: a kill now
  // would lose them and the restart would open the setup wizard. A user's settings are long on disk by now.
  await first.app.evaluate(({ session }) => session.defaultSession.flushStorageData());
  expect(first.errors).toEqual([]);
  await first.kill();

  const empty = 'run-e2e-empty-after-crash';
  leaveAnEmptyRecordOpen(userData, empty);
  expect(recordFolders(userData)).toContain(empty);

  const again = await launchApp({ userData });
  await expect(mainAction(again.page)).toBeEnabled({ timeout: 30_000 });
  await again.page.getByRole('button', { name: 'History', exact: true }).click();
  const after = again.page.locator('.history-list [data-record]');
  await expect(after).toHaveCount(1);
  await expect(after.first()).not.toContainText('In progress');
  await expect(after.first().locator('.history-tag', { hasText: 'Transcript' })).toBeVisible();
  await after.first().locator('.history-row__open').click();
  const transcript = again.page.locator('.record-page__transcript');
  await expect(transcript.getByText('Hello, how are you?')).toBeVisible();
  await expect(transcript.getByText('こんにちは、お元気ですか？')).toBeVisible();
  expect(again.errors).toEqual([]);
  await again.close();

  const stored = readHistory(userData);
  expect(stored.map((r) => r.state)).toEqual(['closed']);
  expect(stored[0].sentences).toBeGreaterThan(0);
  // Every folder belongs to a record, and every recording a record names is on disk.
  expect(recordFolders(userData)).toEqual(stored.map((r) => r.id).sort());
  for (const track of stored[0].tracks) expect(track.fileBytes, track.file).not.toBeNull();
});
