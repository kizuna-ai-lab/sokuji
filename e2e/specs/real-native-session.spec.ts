import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { baseStorage, mainAction, type Sokuji } from '../support/app';
import { readHistory, type StoredRecord } from '../support/history';
import { downloadNative } from '../support/native';
import { clip, PAUSES_MS, say, SENTENCES } from '../support/speech';
import { expect, test } from '../support/test';

// Tagged @real: left out of `npm run e2e`, run by `npm run e2e:real`. Whole sessions on the native engine (This device
// (Native), the Node addon of kizuna-ai-lab/sokuji #881–#883) with real models, in the real app:
//   1. all three stages on the native engine (Japanese → English): what is said is heard, translated and read aloud,
//      with the engine kept off the network (HF_HUB_OFFLINE) once its models are on disk;
//   2. another service transcribes (the E2E build's fake transcriber, English), the native engine translates into
//      Japanese and reads it aloud: the engine's translation and speech beside another service's transcription.
// Small models keep it quick: Whisper base, Qwen 2.5 0.5B, Pocket TTS (English) and MOSS-TTS-Nano (about 1.2 GB).
//
// Environment:
//   E2E_NATIVE_PROFILE  an absolute path to a profile holding the native models; never deleted by this suite, and its
//                       name must not start with `sokuji-e2e-`. Created when missing.
//   E2E_NATIVE_PREPARE  1: download the models into the profile through Local models and storage, instead of the sessions
//
// Runbook (the native engine must be in resources/native: `npm run fetch:native`):
//   npm run e2e:build
//   E2E_NATIVE_PREPARE=1 E2E_NATIVE_PROFILE=<dir> npm run e2e:real -- real-native-session
//   E2E_NATIVE_PROFILE=<dir> npm run e2e:real -- real-native-session

test.use({ trace: 'off', screenshot: 'off' });

const PROFILE = process.env.E2E_NATIVE_PROFILE ?? '';
const PREPARE = process.env.E2E_NATIVE_PREPARE === '1';
const MODELS = { asr: 'whisper-base', translation: 'qwen2.5-0.5b', ttsEn: 'pocket-tts-en', ttsJa: 'moss-tts-nano' } as const;
/** How long the session's output must stay the same (as many rows, as many of them with audio) to count as finished. */
const QUIET_MS = 30_000;
/** How long, once the last sentence is said, the session is given to finish: past it, the test fails. */
const SETTLE_MS = 10 * 60_000;

/** The profile to run on, checked: absolute, and named so that this suite never deletes it. */
function profileDir(): string {
  if (!path.isAbsolute(PROFILE)) throw new Error('E2E_NATIVE_PROFILE must be an absolute path');
  if (path.basename(PROFILE).startsWith('sokuji-e2e-')) throw new Error('E2E_NATIVE_PROFILE must not be named sokuji-e2e-*: such a directory is deleted when a test passes');
  fs.mkdirSync(PROFILE, { recursive: true });
  return PROFILE;
}

/** The speaker's leg only ("Me", which needs no virtual devices), what is read aloud kept for replay. */
const storage = (o: { stages: Record<string, string | null>; source: string; target: string; tts: string }): Record<string, string> => ({
  ...baseStorage('local_native'),
  'settings.lineup': JSON.stringify({ version: 2, stages: o.stages }),
  'settings.common.sourceLanguage': o.source,
  'settings.common.targetLanguage': o.target,
  'settings.localNative.selections': JSON.stringify({
    [`${o.source}→${o.target}`]: { asr: { modelId: MODELS.asr }, translation: { modelId: MODELS.translation }, tts: { modelId: o.tts } },
  }),
  'settings.common.turnMode': 'auto',
  'settings.common.keepReplayAudio': 'true',
  'audio.mode': 'speaker',
  'e2e.mic': 'speech',
});
const allNative = storage({ stages: { transcription: 'local_native', translation: 'local_native', speech: 'local_native', summarisation: null }, source: 'ja', target: 'en', tts: MODELS.ttsEn });
const nativeTextAndVoice = storage({ stages: { transcription: 'fake_transcriber', translation: 'local_native', speech: 'local_native', summarisation: null }, source: 'en', target: 'ja', tts: MODELS.ttsJa });

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

const side = (record: StoredRecord, which: 'source' | 'translation') => record.segments.filter((s) => s.side === which);

/**
 * Waits for the session to finish what it was given: the rows that can be read aloud, and how many of them have their
 * audio, stop changing for `QUIET_MS`. Translation and speech take one turn at a time, so a fixed wait ends too early on
 * a slower machine. A row whose speech failed keeps no audio for good, so not every row need have it: the assertions
 * judge how many do. Fails past `SETTLE_MS`. Returns how many rows were read aloud.
 */
async function settled(page: Page): Promise<number> {
  const rows = page.getByRole('button', { name: "Play this item's audio" });
  const spoken = page.getByRole('button', { name: "Play this item's audio", disabled: false });
  const deadline = Date.now() + SETTLE_MS;
  let seen = '';
  let since = Date.now();
  for (;;) {
    const [all, ready] = [await rows.count(), await spoken.count()];
    if (`${all}/${ready}` !== seen) { seen = `${all}/${ready}`; since = Date.now(); }
    if (all > 0 && Date.now() - since >= QUIET_MS) return ready;
    if (Date.now() > deadline) throw new Error(`the session did not finish: ${ready} of ${all} rows read aloud`);
    await page.waitForTimeout(1_000);
  }
}
/** A sentence's audio reached the recognizer, told by any of its words (a small model mishears one now and then). */
const TRACES: readonly RegExp[] = [/雨|降り|傘|かさ/, /ドア|閉め/, /会議|午後/, /本|面白/, /家族|週末|夕食|夕飯/, /カフェ|駅/, /電車|遅れ|送れ/, /待/];

test('@real native session: download the models into the profile', async ({ launchApp }) => {
  test.skip(!PREPARE, 'E2E_NATIVE_PREPARE=1 is not set');
  test.skip(!PROFILE, 'E2E_NATIVE_PROFILE is not set');
  test.setTimeout(60 * 60_000);
  const sokuji = await launchApp({ userData: profileDir(), seed: { storage: allNative } });
  await applySettings(sokuji, allNative);
  const { page } = sokuji;
  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Local models and storage/ }).click();
  for (const id of Object.values(MODELS)) await downloadNative(page, id);
  await sokuji.close();
});

test('@real native session: all three stages on the native engine hear, translate and read aloud, off the network', async ({ launchApp }) => {
  test.skip(PREPARE, 'E2E_NATIVE_PREPARE=1: the download test runs instead');
  test.skip(!PROFILE, 'E2E_NATIVE_PROFILE is not set');
  test.setTimeout(20 * 60_000);
  const userData = profileDir();
  const known = new Set(readHistory(userData).map((record) => record.id));
  // The engine never reaches the hub: what a session needs is on disk.
  const sokuji = await launchApp({ userData, seed: { storage: allNative }, env: { HF_HUB_OFFLINE: '1' } });
  await applySettings(sokuji, allNative);
  const { page } = sokuji;

  await expect(mainAction(page)).toBeEnabled({ timeout: 5 * 60_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toContainText(/End session/i, { timeout: 10 * 60_000 });
  for (let i = 0; i < SENTENCES.length; i++) {
    await say(page, clip(SENTENCES[i].file));
    await page.waitForTimeout(PAUSES_MS[i]);
  }
  // Read aloud: a row can be replayed once the voice's audio for it has arrived.
  const spoken = await settled(page);
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  await sokuji.close();

  const fresh = readHistory(userData).filter((record) => !known.has(record.id));
  expect(fresh).toHaveLength(1);
  const [record] = fresh;
  const services = JSON.parse(record.services) as { stages?: Record<string, string> };
  expect(services.stages).toEqual({ transcription: 'local_native', translation: 'local_native', speech: 'local_native' });
  const heardText = side(record, 'source').map((s) => s.text).join('\n');
  const heard = TRACES.filter((trace) => trace.test(heardText)).length;
  const translations = side(record, 'translation').filter((s) => /[A-Za-z]{3,}/.test(s.text));
  // What the translations say: each sentence's English gist (`said`), told by a word a small model keeps.
  const english = translations.map((s) => s.text).join('\n');
  const meant = SENTENCES.filter((sentence) => sentence.said.test(english)).length;
  test.info().annotations.push({
    type: 'native session',
    description: `${heard} of ${SENTENCES.length} heard in ${side(record, 'source').length} turns, ${translations.length} English translations saying ${meant} of the sentences, ${spoken} read aloud`,
  });
  expect(heard, 'what is said is heard').toBeGreaterThanOrEqual(SENTENCES.length - 1);
  expect(translations.length, 'each turn is translated into English').toBeGreaterThanOrEqual(side(record, 'source').length - 1);
  // One sentence may be lost to recognition and one to a small model's wording (傘 as "raincoats").
  expect(meant, 'the translations say what was said').toBeGreaterThanOrEqual(SENTENCES.length - 2);
  expect(spoken, 'the translations are read aloud').toBeGreaterThanOrEqual(Math.min(3, translations.length));
  expect(sokuji.errors).toEqual([]);
});

test("@real native session: the native engine translates and reads aloud another service's transcription", async ({ launchApp }) => {
  test.skip(PREPARE, 'E2E_NATIVE_PREPARE=1: the download test runs instead');
  test.skip(!PROFILE, 'E2E_NATIVE_PROFILE is not set');
  test.setTimeout(20 * 60_000);
  const userData = profileDir();
  const known = new Set(readHistory(userData).map((record) => record.id));
  const sokuji = await launchApp({ userData, seed: { storage: nativeTextAndVoice } });
  await applySettings(sokuji, nativeTextAndVoice);
  const { page } = sokuji;

  await expect(mainAction(page)).toBeEnabled({ timeout: 5 * 60_000 });
  await mainAction(page).click();
  // The fake transcriber's script (English), translated by the native engine into Japanese and read aloud.
  await expect(page.getByText('Hello. How are you today?').first()).toBeVisible({ timeout: 10 * 60_000 });
  await expect(page.getByRole('button', { name: "Play this item's audio", disabled: false }).first()).toBeVisible({ timeout: 5 * 60_000 });
  await mainAction(page).click();
  await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
  await sokuji.close();

  const fresh = readHistory(userData).filter((record) => !known.has(record.id));
  expect(fresh).toHaveLength(1);
  const services = JSON.parse(fresh[0].services) as { stages?: Record<string, string> };
  expect(services.stages).toEqual({ transcription: 'fake_transcriber', translation: 'local_native', speech: 'local_native' });
  const japanese = side(fresh[0], 'translation').filter((s) => /[぀-ヿ一-鿿]/.test(s.text));
  test.info().annotations.push({ type: 'translations', description: japanese.map((s) => s.text).join(' / ') });
  expect(japanese.length, 'the transcription is translated into Japanese').toBeGreaterThanOrEqual(1);
  // "Hello. How are you today?" and "I am fine, thank you.", told by a word a small model keeps.
  expect(japanese.map((s) => s.text).join('\n'), 'the translation says what was said').toMatch(/こんにちは|今日|元気/);
  expect(sokuji.errors).toEqual([]);
});
