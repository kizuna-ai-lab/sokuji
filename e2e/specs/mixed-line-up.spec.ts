import { baseStorage, mainAction } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

// A line-up of two services: the fake service transcribes and translates, the fake voice reads the translations.
// The stored line-up decides what runs, each translation is read aloud, and the record names who did each stage.
test('a session on the fake service with the fake voice reads each translation aloud, and its record names both', async ({ launchApp }) => {
  const sokuji = await launchApp({
    seed: {
      storage: {
        ...baseStorage('fake'),
        'settings.lineup': JSON.stringify({ version: 2, stages: { transcription: 'fake', translation: 'fake', speech: 'fake_voice', summarisation: null } }),
        // What is read aloud is kept for replay, so a row shows whether it has audio.
        'settings.common.keepReplayAudio': 'true',
      },
    },
  });
  const { page, userData } = sokuji;

  // Both services are loaded and ready before Start is offered.
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  // The fake service's script, through both of its exchanges: each translation appears while the session runs.
  // The voice is handed a translation when its row closes (the fake states no stable length before that).
  await expect(page.getByText('こんにちは、お元気ですか？').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('元気です。ありがとう。').first()).toBeVisible({ timeout: 30_000 });
  // Speech was made for each translation. The fake service's own audio is not used in this line-up, so a row's
  // audio is the voice's: a row can be replayed only once the voice's audio for it has arrived and its text is
  // final. (The record keeps no trace of what was read aloud: this is where it shows.)
  const replay = page.getByRole('button', { name: "Play this item's audio" });
  await expect(replay).toHaveCount(2, { timeout: 30_000 });
  await expect(replay.nth(0)).toBeEnabled({ timeout: 30_000 });
  await expect(replay.nth(1)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await sokuji.close();

  const stored = readHistory(userData);
  expect(stored).toHaveLength(1);
  expect(stored[0].state).toBe('closed');
  const services = JSON.parse(stored[0].services) as { provider: string; stages?: Record<string, string> };
  // The record's one provider is the one that transcribes; its stages name each service.
  expect(services.provider).toBe('fake');
  expect(services.stages).toEqual({ transcription: 'fake', translation: 'fake', speech: 'fake_voice' });
  expect(stored[0].sentences).toBeGreaterThan(0);
  // What was heard and what it was translated to are both kept.
  const kept = (side: 'source' | 'translation') => stored[0].segments.filter((segment) => segment.side === side).map((segment) => segment.text).join('\n');
  expect(kept('source')).toContain('Hello, how are you?');
  expect(kept('translation')).toContain('こんにちは、お元気ですか？');
  expect(sokuji.errors).toEqual([]);

  // Started again on the same state: the mixed line-up is still what is stored, and Start is offered.
  const again = await launchApp({ userData });
  await expect(mainAction(again.page)).toBeEnabled({ timeout: 30_000 });
  const lineUp = await again.page.evaluate(() => JSON.parse(localStorage.getItem('settings.lineup') ?? 'null') as { version: number; stages: Record<string, string | null> } | null);
  expect(lineUp).toEqual({ version: 2, stages: { transcription: 'fake', translation: 'fake', speech: 'fake_voice', summarisation: null } });
  await again.close();
});

const threeFakes = { transcription: 'fake_transcriber', translation: 'fake_translator', speech: 'fake_voice', summarisation: null };

/** A seed whose stored line-up is `stages`, with a fixed pair: a translator of its own takes no automatic source. */
const seedOf = (stages: Record<string, string | null>) => ({
  storage: {
    ...baseStorage('fake_transcriber'),
    'settings.lineup': JSON.stringify({ version: 2, stages }),
    'settings.common.sourceLanguage': 'en',
    'settings.common.targetLanguage': 'ja',
    // What is read aloud is kept for replay, so a row shows whether it has audio.
    'settings.common.keepReplayAudio': 'true',
  },
});

// A line-up of three services, one per stage: the fake transcriber hears, the fake translator translates what it
// heard, the fake voice reads the translations. The translator marks its answers with the target (`[ja] …`), so a
// row's translation is seen to be its own and not the transcriber's.
test('a session of three services, one per stage: the source and its translation are shown, the translation is read aloud, and the record names the three', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: seedOf(threeFakes) });
  const { page, userData } = sokuji;

  // All three services are loaded and ready before Start is offered.
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await mainAction(page).click();
  // What the transcriber heard, and what the translator made of it: the first sentence is translated while its
  // utterance goes on, the rest at the close; the second utterance whole, at its close.
  await expect(page.getByText('Hello. How are you today?').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\[ja\] Hello\./).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('I am fine, thank you.', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\[ja\] I am fine, thank you\./).first()).toBeVisible({ timeout: 30_000 });
  // Speech was made: a row can be replayed only once the voice's audio for it has arrived. Neither the transcriber
  // nor the translator makes audio, so what plays is the voice's.
  await expect(page.getByRole('button', { name: "Play this item's audio", disabled: false }).first()).toBeVisible({ timeout: 30_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await sokuji.close();

  const stored = readHistory(userData);
  expect(stored).toHaveLength(1);
  expect(stored[0].state).toBe('closed');
  const services = JSON.parse(stored[0].services) as { provider: string; stages?: Record<string, string>; models?: Record<string, string> };
  // The record's one provider is the one that transcribes; its stages name each service, and each names its model.
  expect(services.provider).toBe('fake_transcriber');
  expect(services.stages).toEqual({ transcription: 'fake_transcriber', translation: 'fake_translator', speech: 'fake_voice' });
  expect(services.models).toMatchObject({ asrModel: 'fake-transcriber', translationModel: 'fake-translator' });
  const kept = (side: 'source' | 'translation') => stored[0].segments.filter((segment) => segment.side === side).map((segment) => segment.text).join('\n');
  expect(kept('source')).toContain('Hello. How are you today?');
  expect(kept('source')).toContain('I am fine, thank you.');
  expect(kept('translation')).toContain('[ja] Hello.');
  expect(kept('translation')).toContain('[ja] I am fine, thank you.');
  expect(sokuji.errors).toEqual([]);
});

// The line-up page: a service chosen for translation alone leaves the transcription where it is. Soniox, which
// translates only what it transcribes, keeps transcribing for the translator chosen under it.
test('choosing the fake translator for translation keeps the service that transcribes', async ({ launchApp }) => {
  const sokuji = await launchApp({ seed: seedOf({ transcription: 'soniox', translation: 'soniox', speech: 'fake_voice', summarisation: null }) });
  const { page } = sokuji;
  const storedStages = () => page.evaluate(() => (JSON.parse(localStorage.getItem('settings.lineup') ?? 'null') as { stages: Record<string, string | null> } | null)?.stages ?? null);

  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Languages and line-up/ }).click();
  // Soniox's transcription and translation share a card; the translation has a choice of its own in it.
  const translation = page.getByRole('combobox', { name: 'Translation', exact: true });
  await expect(translation).toHaveValue('soniox');
  await translation.selectOption('fake_translator');
  await expect.poll(storedStages).toEqual({ transcription: 'soniox', translation: 'fake_translator', speech: 'fake_voice', summarisation: null });
  // A card each now: the transcription's own choice still says Soniox.
  const transcription = page.getByRole('combobox', { name: 'Transcription', exact: true });
  await expect(transcription).toHaveValue('soniox');

  // The fake transcriber for transcription: the translator stays.
  await transcription.selectOption('fake_transcriber');
  await expect.poll(storedStages).toEqual(threeFakes);
  // Another translator and back: the transcriber stays both times.
  await page.getByRole('combobox', { name: 'Translation', exact: true }).selectOption('bing');
  await expect.poll(storedStages).toEqual({ ...threeFakes, translation: 'bing' });
  await page.getByRole('combobox', { name: 'Translation', exact: true }).selectOption('fake_translator');
  await expect.poll(storedStages).toEqual(threeFakes);
  await expect(page.getByRole('combobox', { name: 'Transcription', exact: true })).toHaveValue('fake_transcriber');

  // The three services run: Start is offered.
  await page.keyboard.press('Escape');
  await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
  await sokuji.close();
});
