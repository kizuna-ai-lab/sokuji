import type { Page } from '@playwright/test';
import { baseStorage, mainAction, type Sokuji } from '../support/app';
import { readHistory } from '../support/history';
import { fakeOpenAi, lastUserText, translationAnswer, type FakeOpenAi, type OpenAiRequest } from '../support/openai';
import { expect, test } from '../support/test';

// OpenAI's text model translating what another service heard (text models, part B). OpenAI is the test's fake, in
// the page's own network layer (`e2e/support/openai.ts`): it lists two models and answers each translation with the
// stretch it was asked, marked `訳: `. Nothing leaves the machine.

const LINE_UP = { transcription: 'fake_transcriber', translation: 'openai_text', speech: 'fake_voice', summarisation: null };
/** Not a key of any service. */
const KEY = 'sk-e2e-not-a-real-key';

/**
 * Starts the app on the line-up with no key, puts the fake OpenAI in place, then gives the key and loads the page
 * again: the app's first check of the text model is answered by the fake, never by OpenAI.
 */
async function startWithFakeOpenAi(launchApp: (options: { seed: { storage: Record<string, string> } }) => Promise<Sokuji>): Promise<{ sokuji: Sokuji; openai: FakeOpenAi }> {
  const sokuji = await launchApp({
    seed: {
      storage: {
        ...baseStorage('fake_transcriber'),
        'settings.lineup': JSON.stringify({ version: 2, stages: LINE_UP }),
        // A translator of its own takes no automatic source.
        'settings.common.sourceLanguage': 'en',
        'settings.common.targetLanguage': 'ja',
        // What is read aloud is kept for replay, so a row shows whether it has audio.
        'settings.common.keepReplayAudio': 'true',
      },
    },
  });
  const openai = await fakeOpenAi(sokuji);
  openai.answerChat(translationAnswer);
  await sokuji.page.evaluate((key) => localStorage.setItem('settings.openai.apiKey', key), KEY);
  await sokuji.page.reload();
  await sokuji.page.waitForLoadState('domcontentloaded');
  return { sokuji, openai };
}

const chats = (openai: FakeOpenAi): OpenAiRequest[] => openai.requests.filter((r) => r.path === '/chat/completions');

test("a session of the fake transcriber, OpenAI's text model and the fake voice: rows show the source and its translation, and the record names the three", async ({ launchApp }) => {
  const { sokuji, openai } = await startWithFakeOpenAi(launchApp);
  const { page, userData } = sokuji;

  // The text model is checked (its list, then its automatic model asked once) before Start is offered.
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  expect(openai.requests.map((r) => r.path).slice(0, 2)).toEqual(['/models', '/chat/completions']);
  await mainAction(page).click();
  await expect(page.getByText('Hello. How are you today?').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('訳: Hello.').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('I am fine, thank you.', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('訳: I am fine, thank you.').first()).toBeVisible({ timeout: 30_000 });
  // The voice read a translation: a row can be replayed once its audio arrived.
  await expect(page.getByRole('button', { name: "Play this item's audio", disabled: false }).first()).toBeVisible({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await sokuji.close();

  // What OpenAI was asked: the automatic model (the first text model listed), the lowest reasoning, the languages by
  // name in the system prompt, and the earlier stretch as a turn before the next one.
  const translations = chats(openai).filter((r) => lastUserText(r) !== 'Hi');
  expect(translations.length).toBeGreaterThanOrEqual(2);
  for (const request of translations) {
    expect(request.body).toMatchObject({ model: 'gpt-5.4-mini', reasoning_effort: 'none' });
    const messages = request.body!.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('from English into Japanese');
  }
  const last = translations[translations.length - 1].body!.messages as Array<{ role: string; content: string }>;
  expect(last.map((m) => m.role)).toEqual(['system', ...Array((last.length - 2) / 2).fill(['user', 'assistant']).flat(), 'user']);
  expect(openai.failures).toEqual([]);

  const stored = readHistory(userData);
  expect(stored).toHaveLength(1);
  expect(stored[0].state).toBe('closed');
  const services = JSON.parse(stored[0].services) as { provider: string; stages?: Record<string, string>; models?: Record<string, string> };
  expect(services.provider).toBe('fake_transcriber');
  expect(services.stages).toEqual({ transcription: 'fake_transcriber', translation: 'openai_text', speech: 'fake_voice' });
  expect(services.models).toMatchObject({ translationModel: 'gpt-5.4-mini' });
  const kept = (side: 'source' | 'translation') => stored[0].segments.filter((segment) => segment.side === side).map((segment) => segment.text).join('\n');
  expect(kept('source')).toContain('Hello. How are you today?');
  expect(kept('translation')).toContain('訳: Hello.');
  expect(sokuji.errors).toEqual([]);
});

/** The line-up page, and the Translation card's options unfolded. */
async function translationOptions(page: Page) {
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Languages and line-up/ }).click();
  const card = page.locator('.lineup-stage').filter({ has: page.getByRole('combobox', { name: 'Translation', exact: true }) });
  await expect(page.getByRole('combobox', { name: 'Translation', exact: true })).toHaveValue('openai_text');
  await card.getByRole('button', { name: 'OpenAI Text Model options' }).click();
  return card;
}

const storedSetting = (page: Page, field: string) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, `settings.openaiText.${field}`);

test("the Translation card's model and reasoning: the list, a reasoning OpenAI refuses said before Start, a value and a model typed by hand", async ({ launchApp }) => {
  const { sokuji, openai } = await startWithFakeOpenAi(launchApp);
  const { page } = sokuji;
  openai.listModels(['gpt-5-mini', 'gpt-5.4', 'gpt-realtime', 'whisper-1']);
  // A reasoning the model does not take is refused the way OpenAI refuses it; anything else is answered.
  openai.answerChat((request) => (request.body?.reasoning_effort === 'high'
    ? { status: 400, message: "Unsupported value: 'reasoning_effort' does not support 'high' with this model." }
    : translationAnswer(request)));
  const card = await translationOptions(page);

  // The service's own text models, Automatic first, naming its preferred one.
  const model = card.getByRole('combobox', { name: 'Model' });
  await expect(model.locator('option')).toHaveText(['Automatic (gpt-5-mini)', 'gpt-5-mini', 'gpt-5.4'], { timeout: 30_000 });
  await model.selectOption('gpt-5.4');
  await expect.poll(() => storedSetting(page, 'translationModel')).toEqual({ listed: 'gpt-5.4', typed: '' });

  // A reasoning chosen is sent as it is: refused, the card says so in OpenAI's words, and Start is not offered.
  const reasoning = card.getByRole('combobox', { name: 'Reasoning effort' });
  await expect(reasoning).toHaveValue('lowest');
  await reasoning.selectOption('high');
  await expect.poll(() => storedSetting(page, 'translationReasoning')).toEqual({ level: 'high', typed: '' });
  await expect(card.getByText("The provider rejected the request: Unsupported value: 'reasoning_effort' does not support 'high' with this model.")).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('.lineup-stage__state').first()).toHaveText('Not ready');
  expect(chats(openai).some((r) => r.body?.model === 'gpt-5.4' && r.body?.reasoning_effort === 'high')).toBe(true);

  // A value typed wins over the list, sent as it is: answered, the card is ready again.
  await card.getByRole('textbox', { name: 'Or type a value, sent as it is' }).fill('medium');
  await expect.poll(() => storedSetting(page, 'translationReasoning')).toEqual({ level: 'high', typed: 'medium' });
  await expect(card.locator('.lineup-stage__state').first()).toHaveText('Ready', { timeout: 30_000 });
  expect(chats(openai).some((r) => r.body?.model === 'gpt-5.4' && r.body?.reasoning_effort === 'medium')).toBe(true);

  // A model's name typed wins over the list, and is what the check asks.
  await card.getByRole('textbox', { name: 'Or type a model name' }).fill('gpt-5.4-2026-01-01');
  await expect.poll(() => storedSetting(page, 'translationModel')).toEqual({ listed: 'gpt-5.4', typed: 'gpt-5.4-2026-01-01' });
  await expect(model).toBeDisabled();
  await expect.poll(() => chats(openai).some((r) => r.body?.model === 'gpt-5.4-2026-01-01'), { timeout: 30_000 }).toBe(true);
  expect(openai.failures).toEqual([]);
  await sokuji.close();
});
