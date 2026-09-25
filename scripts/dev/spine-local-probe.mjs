#!/usr/bin/env node
/**
 * Plays a live LocalInference session in headless Chromium (plan 1e-2 task
 * 9): the real registered provider (task 8), fed a real English ASR model
 * and a real English→Japanese translation model, listening to a recorded
 * wav through Chromium's fake-audio-capture device. Passes once the
 * conversation list draws at least one source row with text and at least
 * one translation row with text.
 *
 * Models (the smallest CPU-capable/WASM entries in modelManifest.ts, so this
 * probe never needs WebGPU or a GPU-only model to pass — everything runs on
 * the CPU that runs headless Chromium):
 *
 *   - ASR: `moonshine-tiny-en-quant` — English-only, sherpa-onnx/WASM
 *     (no `requiredDevice`, no `asrWorkerType`, so it defaults to the
 *     sherpa-onnx CPU worker), ~44.9 MB (`asrFiles(44_900_404, 355)`). The
 *     smallest English-capable ASR entry in the whole manifest by a wide
 *     margin — every English-capable entry under ~65 MB either requires
 *     WebGPU (`whisper-tiny-en-webgpu`, …) or isn't this small.
 *
 *   - Translation: `opus-mt-en-jap` — English → Japanese, Opus-MT/ONNX,
 *     ~94.3 MB total (`translationFiles(1_377, 293, 5_068_572, 281,
 *     43_312_542, 50_550_704)`, no `requiredDevice`). The ONLY CPU-capable
 *     en→ja translation entry in the manifest: every multilingual
 *     alternative (Qwen 2.5/3/3.5, Hunyuan MT, TranslateGemma) is
 *     `requiredDevice: 'webgpu'`, so there is no smaller CPU choice to
 *     compare it against — "smallest" here just means "the one that exists".
 *
 * Auto-resolution note: downloading these two is not by itself enough to
 * make LocalInference use them for this session. `resolveStage`'s `byRank`
 * ranks a `recommended` candidate first regardless of download state, and
 * the manifest's two always-ready cloud fallbacks — Bing Translator and Edge
 * TTS — are both `recommended`; Bing supports en/ja, so an un-pinned
 * translation stage would resolve to a network call to Bing instead of this
 * probe's downloaded WASM model. Task 9's `&models=`/`&pair=` handling in
 * `SpinePreview.tsx` downloads each id and then pins it as the explicit pick
 * for its own stage on the `&pair=` direction, so the translation this probe
 * checks for is actually produced by `opus-mt-en-jap`'s WASM engine.
 *
 * WAV format: `--use-file-for-fake-audio-capture`'s requirements were
 * checked empirically against this Chromium build — a throwaway
 * getUserMedia + ScriptProcessor page served over http://localhost (the flag
 * needs a real capture; an insecure origin like about:blank/data: refuses
 * one) — and `benchmark/test-speech-silence-speech.wav` (mono, 16-bit PCM,
 * 24 kHz) played back with a ~1.0 peak amplitude untouched. No conversion or
 * resampling is needed.
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-local-probe.mjs [url] [seconds]
 *
 * Default url: http://localhost:5199/?preview=spine&provider=localInference
 * &capture=device&autostart=1&models=moonshine-tiny-en-quant,opus-mt-en-jap
 * &pair=en:ja
 *
 * `&models=` / `&pair=` write the profile's LocalInference selections and pair (the app's own keys): open them in the probe's own profile, never a real one.
 *
 * Default seconds: 600 (10 minutes) — a first run downloads ~140 MB and
 * compiles two WASM engines; every later run against the same profile
 * directory (below) finds both models already downloaded and is much
 * faster.
 *
 * The browser profile is `$CLAUDE_JOB_DIR/tmp/spine-local-probe-profile`
 * when `CLAUDE_JOB_DIR` is set (the running job's own temp dir), else
 * `os.tmpdir()/spine-local-probe-profile` — resolved at run time, never a
 * literal path, so a downloaded model's IndexedDB entry survives a re-run of
 * THIS run's job (an interrupted or failed probe does not pay the download
 * again), and a different job or machine gets its own, unrelated profile
 * instead of silently reusing (or missing) someone else's. Passed to
 * headless.mjs's `withPage` as `userDataDir`, which neither creates nor
 * deletes it — this script creates it once, up front.
 *
 * Exits 1 when the wait times out before both a non-empty source row and a
 * non-empty translation row are drawn, printing the preview's own
 * start-failure line (`SessionControls`' `state.lastEnd`) when one is
 * showing, and whatever rows did get drawn either way.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, sleep, withPage } from './headless.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const WAV = join(REPO_ROOT, 'benchmark', 'test-speech-silence-speech.wav');
const DEFAULT_MODELS = 'moonshine-tiny-en-quant,opus-mt-en-jap';
const url = process.argv[2]
  ?? `http://localhost:5199/?preview=spine&provider=localInference&capture=device&autostart=1&models=${DEFAULT_MODELS}&pair=en:ja`;
const seconds = Number(process.argv[3] ?? 600);

const jobTmpDir = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, 'tmp') : tmpdir();
const PROFILE_DIR = join(jobTmpDir, 'spine-local-probe-profile');
mkdirSync(PROFILE_DIR, { recursive: true });

// `.lang-badge`'s `src`/`tr` class and `.row-text` mirror spine-surface-probe.mjs's
// own reading of the same conversation list. The phase line is SessionControls'
// own text node, found via the Start/Stop button rather than a class (both
// `.settings-section` and `.validation-message.error` are reused by other
// components on this page — LocalSettingsControls' TTS section and
// CredentialForm's readiness message respectively — so `lastEnd` is picked out
// by excluding CredentialForm's copy, which lives under `#provider-section`).
const READ = `(() => {
  const rows = [...document.querySelectorAll('.conversation-display .conversation-row')].map((r) => {
    const badge = r.querySelector('.lang-badge');
    return {
      side: badge?.classList.contains('src') ? 'src' : badge?.classList.contains('tr') ? 'tr' : '',
      text: (r.querySelector('.row-text')?.textContent ?? '').trim(),
    };
  });
  const startStop = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start' || b.textContent.trim() === 'Stop');
  const lastEnd = [...document.querySelectorAll('.validation-message.error')].find((el) => !el.closest('#provider-section'))?.textContent ?? null;
  return { rows, phase: (startStop?.nextElementSibling?.textContent ?? '').trim(), lastEnd };
})()`;

if (!existsSync(WAV)) {
  console.log(`FAIL: no wav at ${WAV}`);
  process.exit(1);
}

process.exitCode = await withPage(url, async (send) => {
  let last = { rows: [], phase: '', lastEnd: null };
  let sourceSeen = false;
  let translationSeen = false;
  for (let waited = 0; waited < seconds * 1000 && !(sourceSeen && translationSeen); waited += 3000) {
    await sleep(3000);
    const now = await evaluate(send, READ);
    if (!now) continue;
    const phaseChanged = now.phase !== last.phase;
    last = now;
    sourceSeen ||= last.rows.some((r) => r.side === 'src' && r.text.length > 0);
    translationSeen ||= last.rows.some((r) => r.side === 'tr' && r.text.length > 0);
    // Print on every phase change (idle -> starting (loading: …) -> running
    // -> …) plus roughly every 15s regardless, so a long first-run download
    // still shows the probe is alive.
    if (phaseChanged || waited % 15000 < 3000) {
      console.log(`${Math.round(waited / 1000)}s — phase: ${last.phase || '?'} · rows: ${last.rows.length}${last.lastEnd ? ` · lastEnd: ${last.lastEnd}` : ''}`);
    }
  }

  console.log(`rows drawn: ${last.rows.length}`);
  for (const row of last.rows) console.log(`  ${row.side || '?'} | ${row.text}`);

  if (sourceSeen && translationSeen) return 0;
  console.log(`FAIL: source row with text seen: ${sourceSeen} · translation row with text seen: ${translationSeen}`);
  if (last.lastEnd) console.log(`FAIL: the preview's lastEnd: ${last.lastEnd}`);
  return 1;
}, {
  port: 9334,
  userDataDir: PROFILE_DIR,
  flags: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
  ],
});
