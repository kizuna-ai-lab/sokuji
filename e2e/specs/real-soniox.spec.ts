import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { baseStorage, mainAction, REPO } from '../support/app';
import { readHistory } from '../support/history';
import { expect, test } from '../support/test';

const KEY = process.env.E2E_SONIOX_KEY ?? '';
const MINUTES = Number(process.env.E2E_LONG_MINUTES ?? 15);
const SESSION_MS = MINUTES * 60_000;
/** Nobody speaks for this long in the middle of the session. */
const SILENCE_MS = 75_000;

/**
 * The repository's eight Japanese sentences (scripts/dev/wire-probe/assets/ja): a word each must be heard, and a word
 * its English must carry. (`door.wav` ends with a stray sound that Soniox hears as a short sentence of its own; the
 * checks below count the expected words and do not mind it.)
 */
const SENTENCES = [
  { file: 'umbrella', heard: /傘/, said: /umbrella/i }, // 今日は雨が降りそうなので、傘を持っていきます。
  { file: 'door', heard: /ドア|扉/, said: /\bdoor/i }, // ドアを閉めてください。
  { file: 'meeting', heard: /会議/, said: /meeting/i }, // 明日の会議は午後三時に始まります。
  { file: 'book', heard: /本/, said: /\bbook/i }, // この本はとても面白かったです。
  { file: 'dinner', heard: /夕食|夕飯|晩ご飯/, said: /dinner|supper/i }, // 週末に家族と一緒に夕食を食べました。
  { file: 'cafe', heard: /カフェ/, said: /caf[eé]|coffee/i }, // 駅の近くに新しいカフェができました。
  { file: 'train', heard: /電車/, said: /\btrain/i }, // 電車が十分遅れています。
  { file: 'wait', heard: /待/, said: /\bwait|moment/i }, // 少々お待ちください。
];
/** The pause after each sentence, as a person leaves them: some short, some long. */
const PAUSES_MS = [2400, 400, 2200, 1800, 1400, 2000, 900, 3000];

/** A 16-bit mono WAV's samples as base64, and its sample rate. */
function clip(name: string): { pcm: string; rate: number } {
  const wav = fs.readFileSync(path.join(REPO, 'scripts/dev/wire-probe/assets/ja', `${name}.wav`));
  const rate = wav.readUInt32LE(24);
  let at = 12;
  while (wav.toString('latin1', at, at + 4) !== 'data') at += 8 + wav.readUInt32LE(at + 4);
  return { pcm: wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4)).toString('base64'), rate };
}

const say = (page: Page, { pcm, rate }: { pcm: string; rate: number }) => page.evaluate(
  ({ pcm, rate }) => (navigator.mediaDevices as MediaDevices & { __e2eSay(pcm: string, rate: number): Promise<void> }).__e2eSay(pcm, rate),
  { pcm, rate },
);

// The key is typed into the app: a trace would keep it.
test.use({ trace: 'off' });

// Tagged @real: talks to Soniox itself with a key from E2E_SONIOX_KEY, so it is left out of `npm run e2e` and run
// with `npm run e2e:real`. A meeting-length session of real speech with a long silence in the middle, for what the
// fake service cannot show: the key accepted in Settings, the connection held through the silence and the minutes,
// the words heard and translated before and after it.
test(`@real a ${MINUTES}-minute Soniox session hears and translates speech before and after a long silence`, async ({ launchApp }) => {
  test.skip(!KEY, 'E2E_SONIOX_KEY is not set');
  test.setTimeout(SESSION_MS + 5 * 60_000);
  const clips = SENTENCES.map((s) => clip(s.file));
  const sokuji = await launchApp({
    seed: {
      storage: {
        ...baseStorage('soniox'),
        'settings.lineup': JSON.stringify({ transcription: 'soniox', translation: 'soniox', speech: null, summarisation: null }),
        'settings.common.sourceLanguage': 'ja',
        'settings.common.targetLanguage': 'en',
        'e2e.mic': 'speech',
      },
    },
  });
  const { page, userData } = sokuji;

  try {
    // The key goes in the way a user puts it in: Settings, Accounts and keys, Soniox.
    await page.locator('[data-tour="settings-button"]').click();
    await page.getByRole('navigation').getByRole('button', { name: /^Accounts and keys/ }).click();
    await page.getByRole('group', { name: 'Soniox', exact: true }).getByRole('button', { name: 'Add key' }).click();
    await page.getByPlaceholder('Soniox API key').fill(KEY);
    await page.getByRole('button', { name: 'Save and find its region' }).click();
    await expect(page.locator('.soniox-key__line')).toContainText(/Key works · Belongs to /, { timeout: 60_000 });
    await page.keyboard.press('Escape');
    // Finding the key's region asks every region, and the ones the key does not belong to refuse it: those refusals are expected.
    expect(sokuji.errors.filter((e) => !/status of 401/.test(e))).toEqual([]);
    sokuji.errors.length = 0;

    await expect(mainAction(page)).toBeEnabled({ timeout: 30_000 });
    await mainAction(page).click();
    await page.waitForTimeout(3_000); // the session connecting
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;

    // Rounds of the eight sentences; once, near the middle, nobody speaks for over a minute.
    const silenceFrom = Math.max(45_000, SESSION_MS * 0.4);
    let silence: { from: number; to: number } | null = null;
    const spoken: { sentence: number; at: number }[] = [];
    let checkedAt = 0;
    while (elapsed() < SESSION_MS - 15_000) {
      if (!silence && elapsed() >= silenceFrom) {
        const from = elapsed();
        await page.waitForTimeout(SILENCE_MS);
        silence = { from, to: elapsed() };
        await expect(mainAction(page)).toBeEnabled(); // still in session after the silence
      }
      for (let i = 0; i < SENTENCES.length && elapsed() < SESSION_MS - 15_000; i++) {
        spoken.push({ sentence: i, at: elapsed() });
        await say(page, clips[i]);
        await page.waitForTimeout(PAUSES_MS[i]);
      }
      if (spoken.length === SENTENCES.length) await expect(page.getByText(/umbrella/i).first()).toBeVisible({ timeout: 20_000 }); // the first round is on the screen
      if (elapsed() - checkedAt > 60_000) { checkedAt = elapsed(); await expect(mainAction(page)).toBeEnabled(); }
    }
    expect(silence, 'the session was long enough for the silence').not.toBeNull();
    await page.waitForTimeout(8_000); // the last sentence's translation arriving

    await mainAction(page).click();
    await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
    const ranMs = elapsed();
    expect(sokuji.errors).toEqual([]);
    await sokuji.close();

    expect(readHistory(userData)).toHaveLength(1);
    const [record] = readHistory(userData);
    expect(record.state).toBe('closed');
    const [track] = record.tracks;
    expect(track.fileBytes).toBe(track.bytes);
    expect(Math.abs(track.durationMs - ranMs)).toBeLessThan(15_000);

    // What was said is in the record, heard and translated: nine in ten of the sentences, a real service being what it is.
    const text = (side: 'source' | 'translation', from = 0, to = Infinity) => record.segments.filter((x) => x.side === side && x.openedAt >= from && x.openedAt < to).map((x) => x.text).join('\n');
    const count = (source: string, word: RegExp) => source.match(new RegExp(word.source, `${word.flags.replace('g', '')}g`))?.length ?? 0;
    let heard = 0;
    let translated = 0;
    SENTENCES.forEach((s, i) => {
      const times = spoken.filter((x) => x.sentence === i).length;
      heard += Math.min(times, count(text('source'), s.heard));
      translated += Math.min(times, count(text('translation'), s.said));
    });
    test.info().annotations.push({ type: 'sentences said / heard / translated', description: `${spoken.length} / ${heard} / ${translated}` });
    expect(heard).toBeGreaterThanOrEqual(Math.floor(spoken.length * 0.9));
    expect(translated).toBeGreaterThanOrEqual(Math.floor(spoken.length * 0.9));

    // Nothing was made up while nobody spoke (a few seconds either side belong to the sentences around it).
    const quietFrom = startedAt + silence!.from + 10_000;
    const quietTo = startedAt + silence!.to - 5_000;
    expect(record.segments.filter((x) => x.openedAt > quietFrom && x.openedAt < quietTo).map((x) => x.text)).toEqual([]);
    // And after the silence the service still hears and translates: what was said after it is there.
    const saidAfter = SENTENCES.filter((_, i) => spoken.some((x) => x.sentence === i && x.at >= silence!.to));
    const after = saidAfter.filter((s) => s.heard.test(text('source', quietTo)) && s.said.test(text('translation', quietTo)));
    expect(saidAfter.length, 'sentences said after the silence').toBeGreaterThanOrEqual(3);
    expect(after.length).toBeGreaterThanOrEqual(saidAfter.length - 1);
  } finally {
    // The app keeps the key in its settings: whatever happened, it does not stay on disk. The rest of a failed
    // run's directory (the history, the recording) is left to be looked at.
    await sokuji.kill();
    fs.rmSync(path.join(userData, 'Local Storage'), { recursive: true, force: true });
  }
});
