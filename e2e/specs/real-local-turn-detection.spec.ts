import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { baseStorage, mainAction, type Sokuji } from '../support/app';
import { readHistory, type StoredRecord } from '../support/history';
import { downloadNative } from '../support/native';
import { clip, PAUSES_MS, say, SENTENCES, type Clip } from '../support/speech';
import { expect, test } from '../support/test';

// Tagged @real: left out of `npm run e2e`, run by `npm run e2e:real`. A pass/fail check that the shared turn detection
// (kizuna-ai-lab/sokuji #869–#878) cuts real speech into turns for each local recognizer it serves, on the repository's
// eight Japanese sentences, in the real app with the real models:
//   1. automatic turns: the sentences said with a person's pauses are heard, and no turn comes out empty;
//   2. stop, then start again, with one unbroken utterance longer than the model's longest turn (every sentence said
//      back to back): the turn is cut where the limit is, and nothing is lost at the cut;
//   3. push-to-talk: each press is one turn, heard; a press with nothing said makes no turn.
// The translation and the voice are the E2E build's fakes (no model to download for them); only what is heard is judged.
// (`real-local-turns.spec.ts` is the before/after measurement of the same change; this is the regression check.)
//
// Environment:
//   E2E_LOCAL_PROFILE  an absolute path to a profile (user-data directory) holding the downloaded models; never deleted by
//                      this suite, and its name must not start with `sokuji-e2e-`. Created when missing.
//   E2E_LOCAL_PREPARE  1: download the recognizers into the profile through Local models and storage, instead of checking
//   E2E_LOCAL_ASR      a comma-separated subset of the recognizers below (default: all of them); Local Native's needs
//                      the native engine in resources/native (`npm run fetch:native`)
//
// Runbook (on a machine with a hardware WebGPU adapter; it opens Electron windows and downloads about 3.5 GB once):
//   npm run e2e:build
//   E2E_LOCAL_PREPARE=1 E2E_LOCAL_PROFILE=<dir> npm run e2e:real -- real-local-turn-detection
//   E2E_LOCAL_PROFILE=<dir> npm run e2e:real -- real-local-turn-detection

test.use({ trace: 'off', screenshot: 'off' });

const RECOGNIZERS = {
  // The WebGPU recognizers take the detector's segments (#873).
  'whisper-base-webgpu': { name: 'Whisper Base (WebGPU, 99+ languages)', webgpu: true },
  // The sherpa-onnx offline recognizers take its segments in their classic worker (#875).
  'sensevoice-int8': { name: 'SenseVoice (int8)', webgpu: false },
  'moonshine-base-ja-quant': { name: 'Moonshine Base JA (quantized)', webgpu: false },
  // Voxtral 4B takes the leg's audio with start, end and cancel marks (#876).
  'voxtral-mini-4b-webgpu': { name: 'Voxtral Mini 4B Realtime (WebGPU)', webgpu: true },
  // Local Native (the native engine, This device (Native)) takes the same audio and marks (#877).
  'native:whisper-base': { name: 'Whisper base', webgpu: false },
} as const;
type RecognizerId = keyof typeof RECOGNIZERS;

const PROFILE = process.env.E2E_LOCAL_PROFILE ?? '';
const PREPARE = process.env.E2E_LOCAL_PREPARE === '1';
const CHOSEN = (process.env.E2E_LOCAL_ASR ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const chosen = (Object.keys(RECOGNIZERS) as RecognizerId[]).filter((id) => CHOSEN.length === 0 || CHOSEN.includes(id));

const sources = (record: StoredRecord) => record.segments.filter((s) => s.side === 'source');

/**
 * Whether a sentence's audio reached the recognizer, told by any of several of its words: small models mishear one word
 * (傘 as 草, 夕食 as 有職) though the turn that carried it was cut right, and that is the model's accuracy, not the
 * turn detection's. SenseVoice, given no language, writes this Japanese in Chinese characters without kana (会议, 午后,
 * 电车; v0.51.2 did the same, before the shared turn detection), so those forms count too. In the order of `SENTENCES`.
 */
const TRACES: readonly RegExp[] = [/雨|降|傘|かさ/, /ドア|閉め/, /会議|会议|午後|午后/, /本|面白/, /家族|週末|周末|夕食|夕飯/, /カフェ|駅/, /電車|电车|遅れ|送れ|送/, /待/];
if (TRACES.length !== SENTENCES.length) throw new Error('one trace per sentence');

/** How many of the sentences said (by index, once per time said) left a trace in the record's heard text. */
function heard(record: StoredRecord, spoken: readonly number[]): number {
  const text = sources(record).map((s) => s.text).join('\n');
  return TRACES.reduce((n, trace, i) => {
    const times = spoken.filter((said) => said === i).length;
    const found = text.match(new RegExp(trace.source, 'g'))?.length ?? 0;
    return n + Math.min(times, found);
  }, 0);
}

/** How long a session is given, once the last sentence is said, for its last turn to come out. */
const TAIL_MS = 20_000;
/** At most one sentence in eight may leave no trace: small models on short clips. */
const ALLOWED_MISSES = 1;

const NATIVE = 'native:';
const isNative = (asr: RecognizerId) => asr.startsWith(NATIVE);

/** This device (either engine) transcribes; the E2E build's fake translator translates and its fake voice reads; the
 * speaker's leg only ("Me"), which needs no virtual devices. */
const storage = (asr: RecognizerId, turnMode: 'auto' | 'push-to-talk'): Record<string, string> => {
  const provider = isNative(asr) ? 'local_native' : 'local_inference';
  const selections = JSON.stringify({ 'ja→en': { asr: { modelId: asr.replace(NATIVE, '') }, translation: { modelId: '' }, tts: { modelId: '' } } });
  return {
    ...baseStorage(provider),
    'settings.lineup': JSON.stringify({ version: 2, stages: { transcription: provider, translation: 'fake_translator', speech: 'fake_voice', summarisation: null } }),
    'audio.mode': 'speaker',
    'settings.common.sourceLanguage': 'ja',
    'settings.common.targetLanguage': 'en',
    [isNative(asr) ? 'settings.localNative.selections' : 'settings.localInference.selections']: selections,
    'settings.common.turnMode': turnMode,
    'settings.common.pushKey': 'Space',
    'e2e.mic': 'speech',
  };
};

/** The profile to run on, checked: absolute, and named so that this suite never deletes it. */
function profileDir(): string {
  if (!path.isAbsolute(PROFILE)) throw new Error('E2E_LOCAL_PROFILE must be an absolute path');
  if (path.basename(PROFILE).startsWith('sokuji-e2e-')) throw new Error('E2E_LOCAL_PROFILE must not be named sokuji-e2e-*: such a directory is deleted when a test passes');
  fs.mkdirSync(PROFILE, { recursive: true });
  return PROFILE;
}

/** A profile seeded by an earlier launch keeps its settings: the ones this run depends on are written each time. */
async function applySettings(sokuji: Sokuji, entries: Record<string, string>): Promise<void> {
  const changed = await sokuji.page.evaluate((wanted) => {
    let differs = false;
    for (const [key, value] of Object.entries(wanted)) {
      if (localStorage.getItem(key) !== value) { localStorage.setItem(key, value); differs = true; }
    }
    return differs;
  }, entries);
  if (!changed) return;
  await sokuji.app.evaluate(({ session }) => session.defaultSession.flushStorageData());
  await sokuji.page.reload();
  await sokuji.page.waitForLoadState('domcontentloaded');
}

/** Starts a session and waits until it is on (the recognizer loading first can take minutes). */
async function start(page: Page): Promise<void> {
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toContainText(/End session/i, { timeout: 10 * 60_000 });
}

/** Ends the session and waits until a new one can start. */
async function stop(page: Page): Promise<void> {
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  await expect(mainAction(page)).not.toContainText(/End session/i, { timeout: 60_000 });
}

/** Two clips' samples one after the other, as one clip (same rate). */
function joined(clips: readonly Clip[]): Clip {
  const rate = clips[0].rate;
  if (clips.some((c) => c.rate !== rate)) throw new Error('the clips differ in sample rate');
  return { rate, pcm: Buffer.concat(clips.map((c) => Buffer.from(c.pcm, 'base64'))).toString('base64') };
}

/** A clip of silence, `ms` long, at `rate`. */
const silence = (ms: number, rate: number): Clip => ({ rate, pcm: Buffer.alloc(Math.round((ms / 1000) * rate) * 2).toString('base64') });



test('@real local turn detection: download the recognizers into the profile', async ({ launchApp }) => {
  test.skip(!PREPARE, 'E2E_LOCAL_PREPARE=1 is not set');
  test.skip(!PROFILE, 'E2E_LOCAL_PROFILE is not set');
  test.setTimeout(90 * 60_000);
  const sokuji = await launchApp({ userData: profileDir(), seed: { storage: storage(chosen[0], 'auto') } });
  const { page } = sokuji;
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Local models and storage/ }).click();
  for (const id of chosen.filter((asr) => !isNative(asr))) {
    await page.getByRole('tab', { name: /WASM\/WebGPU engine/ }).click();
    // A model neither on disk nor recommended waits under an "N more" fold.
    for (const more of await page.getByRole('button', { name: /^\d+ more/, expanded: false }).all()) await more.click().catch(() => {});
    const { name } = RECOGNIZERS[id];
    const download = page.getByRole('button', { name: `Download: ${name}` });
    await expect(download.or(page.locator('.model-card--downloaded', { hasText: name })).first(), `${name} is listed`).toBeVisible({ timeout: 60_000 });
    if (await download.count() > 0) await download.first().click();
    await expect(page.locator('.model-card--downloaded', { hasText: name }).first(), `${name} is downloaded`).toBeVisible({ timeout: 40 * 60_000 });
  }
  for (const id of chosen.filter(isNative)) await downloadNative(page, id.replace(NATIVE, ''));
  await sokuji.close();
});

for (const asr of chosen) {
  test(`@real local turn detection: ${asr} cuts automatic turns, a turn longer than its limit, and push-to-talk presses`, async ({ launchApp }) => {
    test.skip(PREPARE, 'E2E_LOCAL_PREPARE=1: the download test runs instead');
    test.skip(!PROFILE, 'E2E_LOCAL_PROFILE is not set');
    test.setTimeout(30 * 60_000);
    const userData = profileDir();
    const known = new Set(readHistory(userData).map((record) => record.id));
    const clips = SENTENCES.map((s) => clip(s.file));
    const all = SENTENCES.map((_, i) => i);

    const sokuji = await launchApp({ userData, seed: { storage: storage(asr, 'auto') } });
    const { page } = sokuji;
    await applySettings(sokuji, storage(asr, 'auto'));
    if (RECOGNIZERS[asr].webgpu) {
      const gpu = await page.evaluate(async () => {
        const adapter = await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu?.requestAdapter();
        return adapter ? Object.values(adapter.info ?? {}).join(' ') : null;
      });
      test.skip(gpu === null || /swiftshader|lavapipe|llvmpipe|softpipe|software/i.test(gpu), `no hardware WebGPU adapter (${gpu})`);
    }

    // 1. Automatic turns: the sentences with a person's pauses.
    await start(page);
    for (let i = 0; i < clips.length; i++) {
      await say(page, clips[i]);
      await page.waitForTimeout(PAUSES_MS[i]);
    }
    await page.waitForTimeout(TAIL_MS);
    await stop(page);

    // 2. Stop, then start again: one unbroken utterance, every sentence back to back, twice (about a minute), longer than
    //    any of these models' longest turn (30 s at most).
    await start(page);
    await say(page, joined([...clips, ...clips]));
    await page.waitForTimeout(TAIL_MS);
    await stop(page);

    // 3. Push-to-talk: three presses, a sentence each, then a press with nothing said.
    await applySettings(sokuji, storage(asr, 'push-to-talk'));
    await start(page);
    // The key goes to the page, not to a button that kept focus.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    // The meeting, the book and the wait: sentences every one of these models hears (SenseVoice loses the door's).
    const pressed = [2, 3, 7];
    for (const i of pressed) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(300);
      await say(page, clips[i]);
      await page.waitForTimeout(500);
      await page.keyboard.up('Space');
      await page.waitForTimeout(6_000);
    }
    await page.keyboard.down('Space');
    await say(page, silence(1_500, clips[0].rate));
    await page.keyboard.up('Space');
    await page.waitForTimeout(TAIL_MS);
    await stop(page);
    await sokuji.close();

    const fresh = readHistory(userData).filter((record) => !known.has(record.id)).sort((a, b) => a.startedAt - b.startedAt);
    expect(fresh, 'three sessions, three new records').toHaveLength(3);
    const [auto, long, ptt] = fresh;

    const autoHeard = heard(auto, all);
    test.info().annotations.push({ type: 'automatic turns', description: `${autoHeard} of ${all.length} heard in ${sources(auto).length} turns` });
    expect(autoHeard, 'automatic turns: the sentences are heard').toBeGreaterThanOrEqual(all.length - ALLOWED_MISSES);
    expect(sources(auto).length, 'automatic turns: the pauses cut the speech into several turns').toBeGreaterThanOrEqual(4);
    for (const record of fresh) expect(sources(record).filter((s) => s.text.trim() === ''), 'no turn comes out empty').toHaveLength(0);

    const twice = [...all, ...all];
    const longHeard = heard(long, twice);
    test.info().annotations.push({ type: 'one long turn', description: `${longHeard} of ${twice.length} heard in ${sources(long).length} turns` });
    expect(longHeard, 'one long turn: nothing is lost where it is cut').toBeGreaterThanOrEqual(twice.length - 2 * ALLOWED_MISSES);
    expect(sources(long).length, 'one long turn: cut at the model\'s limit').toBeGreaterThanOrEqual(2);

    const pttHeard = heard(ptt, pressed);
    test.info().annotations.push({ type: 'push-to-talk', description: `${pttHeard} of ${pressed.length} presses heard in ${sources(ptt).length} turns` });
    expect(pttHeard, 'push-to-talk: each press is heard').toBe(pressed.length);
    expect(sources(ptt).length, 'push-to-talk: one turn per press, none for the press with nothing said').toBe(pressed.length);
  });
}
