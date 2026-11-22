import type { Page } from '@playwright/test';
import { baseStorage, newUserData } from '../support/app';
import { readNotes } from '../support/history';
import { fakeOpenAi, notesAnswer, sentenceIds, type FakeOpenAi, type OpenAiRequest } from '../support/openai';
import { meeting, seedHistory } from '../support/seed';
import { expect, test } from '../support/test';

// The notes after a session written by OpenAI's text model with the user's own key (text models, part C), with the
// notes model and reasoning chosen for it. OpenAI is the test's fake, in the page's own network layer
// (`e2e/support/openai.ts`): it lists the models a test gives it and answers every notes request. Nothing leaves the
// machine.

/** Not a key of any service. */
const KEY = 'sk-e2e-not-a-real-key';
const RECORD = 'e2e-0001-cccc';

/** A three-minute record in History, OpenAI's key, OpenAI writing the notes, and the settings given. */
function withARecord(settings: Record<string, unknown> = {}) {
  const userData = newUserData();
  seedHistory(userData, [{ id: RECORD, startedAt: Date.now() - 3_600_000, durationMs: 180_000, sentences: meeting(18) }]);
  const storage: Record<string, string> = {
    ...baseStorage('fake'),
    'settings.lineup': JSON.stringify({ version: 2, stages: { transcription: 'fake', translation: 'fake', speech: 'fake', summarisation: 'openai' } }),
    'settings.openai.apiKey': KEY,
  };
  for (const [field, value] of Object.entries(settings)) storage[`settings.openaiText.${field}`] = JSON.stringify(value);
  return { userData, seed: { storage } };
}

/** The record's page, and Write notes confirmed. */
async function writeNotes(page: Page) {
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('[data-record] .history-row__open').first().click();
  await page.getByRole('button', { name: 'Write notes' }).click();
  // The first time, the app says what is sent and to whom.
  await page.getByRole('group', { name: 'Before notes are written' }).getByRole('button', { name: 'Write notes' }).click();
}

const chats = (openai: FakeOpenAi): OpenAiRequest[] => openai.requests.filter((r) => r.path === '/chat/completions');
const notesWritten = async (page: Page) => {
  const notes = page.getByRole('region', { name: 'Notes' });
  await expect(notes.getByRole('heading', { name: 'Fake notes title' })).toBeVisible({ timeout: 30_000 });
  await expect(notes.getByRole('button', { name: 'Write a new version' })).toBeVisible();
  return notes;
};

test('notes written by OpenAI\'s text model with the notes model and reasoning chosen for it: what was asked, and who wrote them', async ({ launchApp }) => {
  const sokuji = await launchApp(withARecord({ notesModel: { listed: '', typed: 'gpt-6-sol' }, notesReasoning: { level: 'high', typed: '' } }));
  const openai = await fakeOpenAi(sokuji);
  await writeNotes(sokuji.page);
  const notes = await notesWritten(sokuji.page);
  // The record's notes say who wrote them.
  await expect(notes.getByText('Written by OpenAI with gpt-6-sol')).toBeVisible();

  // The model and the reasoning chosen, sent as they are to every call; a JSON object asked for; no model list asked
  // (a model is chosen). The first call carried the record's eighteen sentences, with the room high reasoning needs.
  expect(new Set(openai.requests.map((r) => r.path))).toEqual(new Set(['/chat/completions']));
  expect(chats(openai).length).toBeGreaterThan(0);
  for (const request of chats(openai)) {
    expect(request.body).toMatchObject({ model: 'gpt-6-sol', reasoning_effort: 'high', response_format: { type: 'json_object' } });
  }
  expect(sentenceIds(chats(openai)[0])).toHaveLength(18);
  expect(chats(openai)[0].body?.max_completion_tokens).toBe(32_000 + 6_144);
  expect(openai.failures).toEqual([]);
  expect(sokuji.errors).toEqual([]);
  await sokuji.close();

  // History keeps the service beside the model.
  const [version] = readNotes(sokuji.userData);
  expect(version).toMatchObject({ recordId: RECORD, state: 'complete', title: 'Fake notes title', writtenBy: { kind: 'sokuji', model: 'gpt-6-sol', service: 'openai' } });
});

/** Settings, Languages and line-up, and the Notes card's options unfolded. */
async function notesOptions(page: Page) {
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Languages and line-up/ }).click();
  const card = page.locator('.lineup-stage').filter({ has: page.getByRole('combobox', { name: 'Notes', exact: true }) });
  await expect(page.getByRole('combobox', { name: 'Notes', exact: true })).toHaveValue('openai');
  await card.getByRole('button', { name: 'OpenAI Text Model options' }).click();
  return card;
}

const storedSetting = (page: Page, field: string) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, `settings.openaiText.${field}`);

test("the Notes card's model and reasoning: Automatic and Medium by default, a reasoning OpenAI refuses said on the card, then the notes written with the choice", async ({ launchApp }) => {
  const sokuji = await launchApp(withARecord());
  const { page } = sokuji;
  const openai = await fakeOpenAi(sokuji);
  openai.listModels(['gpt-5-mini', 'gpt-6-luna', 'gpt-realtime', 'whisper-1']);
  // A reasoning the model does not take is refused the way OpenAI refuses it; anything else is answered.
  openai.answerChat((request) => (request.body?.reasoning_effort === 'high'
    ? { status: 400, message: "Unsupported value: 'reasoning_effort' does not support 'high' with this model." }
    : notesAnswer(request)));
  const card = await notesOptions(page);

  // The key's text models, Automatic first naming the notes' own preference (the model the notes were written with
  // before); the notes' reasoning Medium; the card ready once its check (the list, then the model) answered.
  const model = card.getByRole('combobox', { name: 'Model' });
  await expect(model.locator('option')).toHaveText(['Automatic (gpt-6-luna)', 'gpt-5-mini', 'gpt-6-luna'], { timeout: 30_000 });
  const reasoning = card.getByRole('combobox', { name: 'Reasoning effort' });
  await expect(reasoning).toHaveValue('medium');
  await expect(card.locator('.lineup-stage__state').first()).toHaveText('Ready', { timeout: 30_000 });

  // A reasoning chosen is sent as it is: refused, the card says so in OpenAI's words.
  await reasoning.selectOption('high');
  await expect.poll(() => storedSetting(page, 'notesReasoning')).toEqual({ level: 'high', typed: '' });
  await expect(card.getByText("The provider rejected the request: Unsupported value: 'reasoning_effort' does not support 'high' with this model.")).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('.lineup-stage__state').first()).toHaveText('Not ready');

  // Another model and a reasoning it takes: ready again.
  await model.selectOption('gpt-5-mini');
  await reasoning.selectOption('low');
  await expect.poll(() => storedSetting(page, 'notesModel')).toEqual({ listed: 'gpt-5-mini', typed: '' });
  await expect.poll(() => storedSetting(page, 'notesReasoning')).toEqual({ level: 'low', typed: '' });
  await expect(card.locator('.lineup-stage__state').first()).toHaveText('Ready', { timeout: 30_000 });
  // The translation's own choice was left alone.
  expect(await storedSetting(page, 'translationReasoning')).toBeNull();
  await page.keyboard.press('Escape');

  const before = chats(openai).length;
  await writeNotes(page);
  await notesWritten(page);
  const written = chats(openai).slice(before);
  expect(written.length).toBeGreaterThan(0);
  for (const request of written) expect(request.body).toMatchObject({ model: 'gpt-5-mini', reasoning_effort: 'low', response_format: { type: 'json_object' } });
  expect(openai.failures).toEqual([]);
  await sokuji.close();
  expect(readNotes(sokuji.userData).map((n) => n.writtenBy)).toEqual([{ kind: 'sokuji', promptVersion: expect.anything(), model: 'gpt-5-mini', service: 'openai' }]);
});
