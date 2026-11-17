import { baseStorage, mainAction } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

// A session is stored in History by itself, and is still there after a restart.
test('a session on the fake service is saved to History and survives a restart', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: { storage: baseStorage('fake') } });
  const { page, userData } = sokuji;

  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  // The fake service's script: its first line appears while the session runs.
  await expect(page.getByText('Hello, how are you?', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(8_000); // let the script play a few lines and the recording grow
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await sokuji.close();

  const stored = readHistory(userData);
  expect(stored).toHaveLength(1);
  expect(stored[0].state).toBe('closed');
  expect(stored[0].services).toContain('fake');
  expect(stored[0].sentences).toBeGreaterThan(0);
  expect(stored[0].tracks.map((track) => track.source)).toEqual(['speaker']);
  // The recording is on disk, whole, and about as long as the session.
  const [track] = stored[0].tracks;
  expect(track.fileBytes).toBe(track.bytes);
  expect(track.durationMs).toBeGreaterThan(6_000);
  // Sound, not silence: the injected microphone compresses to well over 16 kbit/s, silence to a fraction of that.
  // (What the samples are is the playback tests' business: they play the file.)
  expect((track.bytes * 8) / (track.durationMs / 1000)).toBeGreaterThan(16_000);
  expect(sokuji.errors).toEqual([]);

  // The same state, started again: the record is still there, and nothing new was made.
  const again = await launchApp({ userData });
  await expect(mainAction(again.page)).toBeEnabled({ timeout: 30_000 });
  await again.close();
  expect(readHistory(userData).map((record) => record.id)).toEqual(stored.map((record) => record.id));
});
