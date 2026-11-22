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
  // The key's models: the notes' Automatic is the first of their preferences listed (text models, part C).
  openai.listModels(['gpt-5-mini', 'gpt-6-luna', 'gpt-realtime']);
  await writeNotes(sokuji.page);

  const notes = sokuji.page.getByRole('region', { name: 'Notes' });
  await expect(notes.getByRole('heading', { name: 'Fake notes title' })).toBeVisible({ timeout: 30_000 });
  await expect(notes.getByRole('button', { name: 'Fake topic' })).toBeVisible();
  await expect(notes.getByRole('button', { name: 'Fake point' })).toBeVisible();
  await expect(notes.getByRole('button', { name: 'Write a new version' })).toBeVisible();

  // What went out: the key's model list once (the notes model is Automatic), then chat requests, with the model the
  // notes were written with before; the first carried the record's eighteen sentences.
  expect(openai.requests[0].path).toBe('/models');
  const chats = openai.requests.slice(1);
  expect(chats.length).toBeGreaterThan(0);
  expect(new Set(chats.map((r) => r.path))).toEqual(new Set(['/chat/completions']));
  for (const request of chats) expect(request.body?.model).toBe('gpt-6-luna');
  expect(sentenceIds(chats[0])).toHaveLength(18);
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
  // A refusal another try cannot fix is asked once, not retried (after the key's model list, for Automatic).
  expect(openai.requests.filter((r) => r.path === '/chat/completions')).toHaveLength(1);
});
