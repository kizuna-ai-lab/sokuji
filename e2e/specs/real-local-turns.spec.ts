import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { baseStorage, mainAction, REPO, type Sokuji } from '../support/app';
import { readHistory } from '../support/history';
import { clip, PAUSES_MS, say, SENTENCES } from '../support/speech';
import { expect, test } from '../support/test';

// Tagged @real, so it is left out of `npm run e2e` and run only by `npm run e2e:real`. It measures what the shared turn
// detection changes for the local recognizers, on the repository's eight Japanese sentences: how many are heard and
// translated, where each segment starts and ends, and how long after the clip ends the text appears. It is run on a
// build from before the change and on a build from after it, with the same models, settings and clips, and
// `scripts/dev/turn-fixtures/compare-runs.mjs` judges the two sets of runs.
//
// A step ships only if each median is no worse than before by more than the before side's own run-to-run spread.
//
// Environment:
//   E2E_LOCAL_ASR      one of whisper-base-webgpu, sensevoice-int8, voxtral-mini-4b-webgpu
//   E2E_LOCAL_PROFILE  an absolute path to the profile (user-data directory) to run on. It holds the downloaded models and
//                      is never deleted by this suite; its name must not start with `sokuji-e2e-` (those are deleted
//                      when a test passes). Created when missing.
//   E2E_LOCAL_OUT      the folder the results are written to: one `<model>-run<N>.json` per run
//   E2E_RUNS           runs per model (default 5)
//   E2E_LOCAL_PREPARE  1: run the one-time download test instead of the measurements
//   E2E_LOCAL_TAIL_MS  how long to wait after the last sentence for its text (default 20000)
//
// Runbook. Every step builds with vite, opens Electron windows or downloads models: do it only with the machine's
// owner at hand, never from CI.
//   1. Before: `git worktree add <dir> 17642a804`, then `npm ci` in it. Copy this spec, e2e/support/history.ts,
//      e2e/support/app.ts and scripts/dev/turn-fixtures/compare-runs.mjs in, uncommitted. Run `npm run e2e:build`.
//   2. Prepare, once per profile and model:
//        E2E_LOCAL_PREPARE=1 E2E_LOCAL_PROFILE=<dir> E2E_LOCAL_ASR=whisper-base-webgpu npm run e2e:real -- real-local-turns
//      It downloads the recognizer and the ja-en translation model through Local models and storage into the profile.
//      Roughly 0.3 GB for Whisper base plus the translation model (Qwen 2.5 0.5B, about 0.5 GB), 0.25 GB for SenseVoice, about 2.8 GB for Voxtral 4B.
//   3. Measure, five runs per model, on the before build:
//        E2E_LOCAL_OUT=<before> E2E_LOCAL_PROFILE=<dir> E2E_LOCAL_ASR=whisper-base-webgpu npm run e2e:real -- real-local-turns
//   4. After: the same in the branch's worktree (`npm ci`, `npm run e2e:build`), with E2E_LOCAL_OUT=<after> and the same
//      profile.
//   5. `node scripts/dev/turn-fixtures/compare-runs.mjs <before> <after>`. Its table goes into the pull request's
//      description. A FAIL on Whisper blocks the step. A software adapter there (this spec stops with "software WebGPU
//      adapter") means repeating 1-5 for Whisper on a machine with a hardware WebGPU adapter.
//
// Latency is the segment's `opened_at` minus the time the clip ended. Whisper and SenseVoice send no partial text, so a
// segment opens when its final text arrives. `opened_at` is on the run's clock, which is `Date.now()` (the session is
// built with `realClock`), the same clock this spec reads; a segment outside the run's own time fails the spec.

test.use({ trace: 'off', screenshot: 'off' });

const MODELS = {
  'whisper-base-webgpu': { name: 'Whisper Base (WebGPU, 99+ languages)', webgpu: true },
  'sensevoice-int8': { name: 'SenseVoice (int8)', webgpu: false },
  'voxtral-mini-4b-webgpu': { name: 'Voxtral Mini 4B Realtime (WebGPU)', webgpu: true },
} as const;
type ModelId = keyof typeof MODELS;
// Opus-MT ja → en, which this spec first used, has left the catalogue: the smallest translation model that remains.
const TRANSLATION_MODEL = { id: 'qwen2.5-0.5b-translation', name: 'Qwen 2.5 0.5B (multilingual, WebGPU)' };

const ASR = process.env.E2E_LOCAL_ASR ?? '';
const PROFILE = process.env.E2E_LOCAL_PROFILE ?? '';
const OUT = process.env.E2E_LOCAL_OUT ?? '';
const RUNS = Number(process.env.E2E_RUNS ?? 5);
const PREPARE = process.env.E2E_LOCAL_PREPARE === '1';
const TAIL_MS = Number(process.env.E2E_LOCAL_TAIL_MS ?? 20_000);

const isModel = (id: string): id is ModelId => Object.prototype.hasOwnProperty.call(MODELS, id);

/** The settings both builds run on: this device transcribes and translates, the pair is ja to en, and no turn detection key is set, so both builds use their defaults. */
const storage = (asr: ModelId): Record<string, string> => ({
  ...baseStorage('local_inference'),
  // Bare, not the stored form: the app runs the stored provider (see real-soniox.spec.ts).
  'settings.lineup': JSON.stringify({ transcription: 'local_inference', translation: 'local_inference', speech: null, summarisation: null }),
  'settings.common.sourceLanguage': 'ja',
  'settings.common.targetLanguage': 'en',
  'settings.localInference.selections': JSON.stringify({ 'ja→en': { asr: { modelId: asr }, translation: { modelId: TRANSLATION_MODEL.id }, tts: { modelId: '' } } }),
  'e2e.mic': 'speech',
});

/** The profile to run on, checked: absolute, and named so that this suite never deletes it. */
function profileDir(): string {
  if (!path.isAbsolute(PROFILE)) throw new Error('E2E_LOCAL_PROFILE must be an absolute path');
  if (path.basename(PROFILE).startsWith('sokuji-e2e-')) throw new Error('E2E_LOCAL_PROFILE must not be named sokuji-e2e-*: such a directory is deleted when a test passes');
  fs.mkdirSync(PROFILE, { recursive: true });
  return PROFILE;
}

/**
 * A profile that was seeded by an earlier launch keeps its settings (the launch seeds only a first run), and the models
 * it holds serve every recognizer. So the settings this run depends on are written here every time, and the page is
 * loaded again when one differed.
 */
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

/** What `checkWebGPU` in src/utils/webgpu.ts asks of the page, as a self-contained script (a function from this file would carry the runner's helpers). */
const ADAPTER_PROBE = `(async () => {
  const gpu = navigator.gpu;
  if (!gpu) return { available: false, softwareOnly: false };
  let adapter = null;
  for (let attempt = 0; attempt < 4 && !adapter; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 150));
    adapter = await gpu.requestAdapter();
  }
  if (!adapter) return { available: false, softwareOnly: false };
  const info = adapter.info || {};
  const fields = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
  const softwareOnly = Object.values(fields).some((value) => typeof value === 'string' && /swiftshader|lavapipe|llvmpipe|softpipe|software/i.test(value));
  return { available: true, softwareOnly, ...fields, features: adapter.features.has('shader-f16') ? ['shader-f16'] : [] };
})()`;

interface Adapter { available: boolean; softwareOnly: boolean; vendor?: string; architecture?: string; device?: string; description?: string; features?: string[] }

/** The page's WebGPU adapter. A recognizer that runs on WebGPU is not measured on a CPU rasteriser or without an adapter: the numbers would say nothing about a user's machine. */
async function checkAdapter(sokuji: Sokuji, asr: ModelId): Promise<Adapter> {
  const adapter = (await sokuji.page.evaluate(ADAPTER_PROBE)) as Adapter;
  if (MODELS[asr].webgpu && (!adapter.available || adapter.softwareOnly)) {
    throw new Error(`software WebGPU adapter: measure on another machine (${asr}; adapter: ${JSON.stringify(adapter)})`);
  }
  return adapter;
}

/** The commit the build under test was made from, for the results file. */
function buildCommit(): string {
  try { return execFileSync('git', ['rev-parse', '--short=9', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

interface Measured { file: string; heard: boolean; translated: boolean; startMs: number | null; endMs: number | null; latencyMs: number | null }

test(`@real prepare: downloads the models of ${ASR || 'the chosen recognizer'} into the profile`, async ({ launchApp }) => {
  test.skip(!PREPARE, 'E2E_LOCAL_PREPARE=1 is not set');
  expect(isModel(ASR), `E2E_LOCAL_ASR is one of ${Object.keys(MODELS).join(', ')}`).toBe(true);
  const asr = ASR as ModelId;
  test.setTimeout(45 * 60_000);
  const sokuji = await launchApp({ userData: profileDir(), seed: { storage: storage(asr) } });
  const { page } = sokuji;
  await applySettings(sokuji, storage(asr));
  await checkAdapter(sokuji, asr);

  await page.locator('[data-tour="settings-button"]').click();
  await page.getByRole('navigation').getByRole('button', { name: /^Local models and storage/ }).click();
  // Where the native engine is offered the page opens on its tab: these models are the WASM/WebGPU engine's.
  const webgpuTab = page.getByRole('tab', { name: /WASM\/WebGPU engine/ });
  if (await webgpuTab.count() > 0) await webgpuTab.click();
  for (const { name } of [MODELS[asr], TRANSLATION_MODEL]) {
    // Two catalogue entries carry the translation model's name: both are downloaded (a second or two of clicking, 50 MB more).
    const download = page.getByRole('button', { name: `Download: ${name}` });
    for (let clicks = 0; clicks < 4 && await download.count() > 0; clicks++) {
      await download.first().click();
      await page.waitForTimeout(500);
    }
    await expect(page.locator('.model-card--downloaded', { hasText: name }).first(), `${name} is downloaded`).toBeVisible({ timeout: 40 * 60_000 });
  }
});

for (let run = 1; run <= RUNS; run++) {
  test(`@real ${ASR || 'local recognizer'}: run ${run} of ${RUNS} on the Japanese sentences`, async ({ launchApp }) => {
    test.skip(PREPARE, 'E2E_LOCAL_PREPARE=1: the download test runs instead');
    test.skip(!ASR || !PROFILE || !OUT, 'E2E_LOCAL_ASR, E2E_LOCAL_PROFILE and E2E_LOCAL_OUT are not all set');
    expect(isModel(ASR), `E2E_LOCAL_ASR is one of ${Object.keys(MODELS).join(', ')}`).toBe(true);
    const asr = ASR as ModelId;
    test.setTimeout(25 * 60_000);
    // This run's result from an earlier batch must not outlive a rerun that fails: the comparison would read it as new.
    // Only this model's file for this run goes; other models share the folder.
    fs.rmSync(path.join(OUT as string, `${asr}-run${run}.json`), { force: true });

    const userData = profileDir();
    const known = new Set(readHistory(userData).map((record) => record.id));
    const clips = SENTENCES.map((s) => clip(s.file));
    const sokuji = await launchApp({ userData, seed: { storage: storage(asr) } });
    const { page } = sokuji;
    await applySettings(sokuji, storage(asr));
    const adapter = await checkAdapter(sokuji, asr);

    await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
    await mainAction(page).click();
    // The recognizer loading comes first, and can take minutes: the session is on when the button offers to end it.
    await expect(mainAction(page)).toContainText(/End session/i, { timeout: 10 * 60_000 });
    const runStartedAt = Date.now();

    const clipEndedAt: number[] = [];
    const clipStartedAt: number[] = [];
    for (let i = 0; i < SENTENCES.length; i++) {
      clipStartedAt.push(Date.now());
      await say(page, clips[i]);
      clipEndedAt.push(Date.now());
      await page.waitForTimeout(PAUSES_MS[i]);
    }
    await page.waitForTimeout(TAIL_MS); // the last sentence being recognized and translated

    await mainAction(page).click();
    await expect(mainAction(page)).toBeEnabled({ timeout: 60_000 });
    const runEndedAt = Date.now();
    await sokuji.close();

    const fresh = readHistory(userData).filter((record) => !known.has(record.id));
    expect(fresh, 'the run left one new record in the profile').toHaveLength(1);
    const { segments } = fresh[0];
    for (const segment of segments) {
      expect(segment.openedAt, 'a segment opened within the run, on Date.now()\'s clock').toBeGreaterThan(runStartedAt - 5 * 60_000);
      expect(segment.openedAt).toBeLessThan(runEndedAt + 5 * 60_000);
    }

    // The spans are in ms from the record's start, which is when the session began starting; the clips begin once the
    // recognizer has loaded. Exported boundaries are measured from the run's start, so load time never shifts them.
    const loadMs = runStartedAt - fresh[0].startedAt;
    const sources = segments.filter((segment) => segment.side === 'source');
    const heardText = sources.map((segment) => segment.text).join('\n');
    const saidText = segments.filter((segment) => segment.side === 'translation').map((segment) => segment.text).join('\n');
    const sentences: Measured[] = SENTENCES.map((sentence, i) => {
      // The first source segment that carries the sentence's word and opened once its clip had begun.
      const segment = sources.find((candidate) => candidate.openedAt >= clipStartedAt[i] && sentence.heard.test(candidate.text));
      const spoken = fresh[0].heard.find((candidate) => candidate.startMs - loadMs >= clipStartedAt[i] - runStartedAt - 3000 && sentence.heard.test(candidate.text));
      return {
        file: sentence.file,
        heard: sentence.heard.test(heardText),
        translated: sentence.said.test(saidText),
        // The turn boundaries are the sentence the session cut for this clip (a local recognizer's segments carry no timing).
        // Only a span the audio gave (`given`) is a boundary; one estimated from where the sentence arrived is not.
        startMs: spoken?.timeKind === 'given' ? spoken.startMs - loadMs : null,
        endMs: spoken?.timeKind === 'given' ? spoken.endMs - loadMs : null,
        latencyMs: segment ? segment.openedAt - clipEndedAt[i] : null,
      };
    });

    fs.mkdirSync(OUT, { recursive: true });
    const result = { build: buildCommit(), model: asr, run, adapter, sentences };
    fs.writeFileSync(path.join(OUT, `${asr}-run${run}.json`), `${JSON.stringify(result, null, 2)}\n`);
    test.info().annotations.push({
      type: 'sentences heard / translated',
      description: `${sentences.filter((s) => s.heard).length} / ${sentences.filter((s) => s.translated).length} of ${SENTENCES.length}`,
    });
  });
}
