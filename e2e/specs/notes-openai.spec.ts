import type { Page } from '@playwright/test';
import { baseStorage, newUserData } from '../support/app';
import { fakeOpenAi, sentenceIds } from '../support/openai';
import { meeting, seedHistory } from '../support/seed';
import { expect, test } from '../support/test';

/** A three-minute record in History, and an OpenAI key that is the user's own: notes are written by OpenAI. */
function withARecord() {
  const userData = newUserData();
  seedHistory(userData, [{ id: 'e2e-0001-aaaa', startedAt: Date.now() - 3_600_000, durationMs: 180_000, sentences: meeting(18) }]);
  return { userData, seed: { storage: { ...baseStorage('fake'), 'settings.openai.apiKey': 'sk-e2e-not-a-real-key' } } };
}

/** The record's page, and Write notes confirmed. */
async function writeNotes(page: Page) {
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('[data-record] .history-row__open').first().click();
  await page.getByRole('button', { name: 'Write notes' }).click();
  // The first time, the app says what is sent and to whom.
  await page.getByRole('group', { name: 'Before notes are written' }).getByRole('button', { name: 'Write notes' }).click();
}

test('notes are written for a record with the user’s own OpenAI key', async ({ launchApp }) => {
  const sokuji = await launchApp(withARecord());
  const openai = await fakeOpenAi(sokuji);
  await writeNotes(sokuji.page);

  const notes = sokuji.page.getByRole('region', { name: 'Notes' });
  await expect(notes.getByRole('heading', { name: 'Fake notes title' })).toBeVisible({ timeout: 30_000 });
  await expect(notes.getByRole('button', { name: 'Fake topic' })).toBeVisible();
  await expect(notes.getByRole('button', { name: 'Fake point' })).toBeVisible();
  await expect(notes.getByRole('button', { name: 'Write a new version' })).toBeVisible();

  // What went out: chat requests only, and the first of them carried the record's eighteen sentences.
  expect(openai.requests.length).toBeGreaterThan(0);
  expect(new Set(openai.requests.map((r) => r.path))).toEqual(new Set(['/chat/completions']));
  expect(sentenceIds(openai.requests[0])).toHaveLength(18);
  expect(sokuji.errors).toEqual([]);
});

test('a key OpenAI refuses leaves no notes and shows OpenAI’s own words', async ({ launchApp }) => {
  const sokuji = await launchApp(withARecord());
  const openai = await fakeOpenAi(sokuji);
  openai.answerChat(() => ({ status: 401, message: 'Incorrect API key provided: sk-e2e. You can find your key in the dashboard.', code: 'invalid_api_key' }));
  await writeNotes(sokuji.page);

  const notes = sokuji.page.getByRole('region', { name: 'Notes' });
  await expect(notes.getByText('Incorrect API key provided', { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(notes.getByRole('heading', { name: 'Fake notes title' })).toHaveCount(0);
  // A refusal another try cannot fix is asked once, not retried.
  expect(openai.requests).toHaveLength(1);
});
