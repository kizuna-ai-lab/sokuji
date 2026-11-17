import { expect, test } from '@playwright/test';
import { baseStorage, launch, mainAction, removeUserData } from '../support/app';
import { readHistory } from '../support/history';

// A session is stored in History by itself, and is still there after a restart.
test('a session on the fake service is saved to History and survives a restart', async () => {
  const sokuji = await launch({ seed: { storage: baseStorage('fake') } });
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
  // The injected microphone was recorded: about as long as the session, and not the size of silence.
  expect(stored[0].tracks[0].durationMs).toBeGreaterThan(6_000);
  expect(stored[0].tracks[0].bytes).toBeGreaterThan(10_000);
  expect(sokuji.errors).toEqual([]);

  // The same state, started again: the record is still there, and nothing new was made.
  const again = await launch({ userData });
  await expect(mainAction(again.page)).toBeEnabled({ timeout: 30_000 });
  await again.close();
  expect(readHistory(userData).map((record) => record.id)).toEqual(stored.map((record) => record.id));
  removeUserData(userData);
});
