import type { Page } from '@playwright/test';
import { baseStorage, newUserData, type Sokuji } from '../support/app';
import { fakeOpenAi } from '../support/openai';
import { meeting, seedHistory } from '../support/seed';
import { expect, test } from '../support/test';

/** When the record started: a record nobody renamed is named by it, in the History list and in the question. */
const STARTED = new Date(Date.now() - 3_600_000).setSeconds(0, 0);

/** A three-minute record in History, and an OpenAI key that is the user's own: notes are written by OpenAI. */
function withARecord() {
  const userData = newUserData();
  seedHistory(userData, [{ id: 'e2e-0002-bbbb', startedAt: STARTED, durationMs: 180_000, sentences: meeting(18) }]);
  return { userData, seed: { storage: { ...baseStorage('fake'), 'settings.openai.apiKey': 'sk-e2e-not-a-real-key' } } };
}

const openTheRecord = async (page: Page) => {
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('[data-record] .history-row__open').first().click();
};

/** The window's close button, as the user presses it: the window is asked to close and the app decides. */
const closeTheWindow = (sokuji: Sokuji) => sokuji.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });

/** Quitting the app itself (⌘Q on macOS, the Quit menu item elsewhere): closing the last window does not end the app on
 *  macOS, so the quit is asked of the app. It asks the same question first. */
const quitTheApp = (sokuji: Sokuji) => sokuji.app.evaluate(({ app }) => { app.quit(); });

test('closing the app while notes are being written asks first: Stay keeps writing, Quit stops that version', async ({ launchApp }) => {
  const { userData, seed } = withARecord();
  const sokuji = await launchApp({ userData, seed });
  const openai = await fakeOpenAi(sokuji);
  // OpenAI never answers: the notes stay in the middle of being written.
  openai.answerChat(() => ({ hang: true }));
  const { page } = sokuji;
  await openTheRecord(page);
  await page.getByRole('button', { name: 'Write notes' }).click();
  await page.getByRole('group', { name: 'Before notes are written' }).getByRole('button', { name: 'Write notes' }).click();
  const notes = page.getByRole('region', { name: 'Notes' });
  await expect(notes.getByRole('status')).toContainText('Writing notes');
  await expect.poll(() => openai.requests.length).toBeGreaterThan(0);

  // Closing asks, naming the record the notes are for: this one has no title of its own, so by when it started.
  await closeTheWindow(sokuji);
  const question = page.getByRole('alertdialog');
  const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(STARTED);
  await expect(question).toHaveText(new RegExp(`^Notes are being written for “${when}”\\. Quit anyway\\? They will be marked cancelled\\.`));

  // Stay: the app and the notes being written stay as they were.
  await question.getByRole('button', { name: 'Stay' }).click();
  await expect(question).toBeHidden();
  await expect(notes.getByRole('status')).toContainText('Writing notes');
  expect(sokuji.app.process().exitCode).toBeNull();

  // Quitting the app asks the same question; Quit: the app ends.
  const child = sokuji.app.process();
  const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  await quitTheApp(sokuji);
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Quit' }).click();
  await ended;

  // Opened again, the version that was being written is there, stopped, and notes can be written again.
  const again = await launchApp({ userData });
  await openTheRecord(again.page);
  const reopened = again.page.getByRole('region', { name: 'Notes' });
  await expect(reopened.getByText('Writing these notes was stopped.')).toBeVisible();
  await expect(reopened.getByRole('button', { name: 'Write notes' })).toBeVisible();
  expect(sokuji.errors).toEqual([]);
  expect(again.errors).toEqual([]);
});
