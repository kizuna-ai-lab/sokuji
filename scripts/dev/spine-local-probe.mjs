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
 * &pair=en:ja&cut=off
 *
 * `&cut=off` pins the stored display cut: both modes share one browser
 * profile (below) and `--sentences`' `&cut=sentences:1` persists in it, so
 * without the pin a default run after a `--sentences` run would run the
 * stream shape instead of the one-job-per-final check it describes.
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
 *
 * `--sentences`: task 5's live check of LocalInference's sentence-cut jobs
 * (plan 1e-2b) instead of the default per-final check above. It plays the
 * same wav with its deliberate mid-file silence cut down to ~200 ms and ~2 s
 * of silence appended at its end (built once per run into a fixture beside
 * the browser profile, from the source wav's own header — nothing is
 * hard-coded about its layout), so the two spoken parts arrive as one
 * utterance instead of two, and that utterance ends at every loop of
 * Chromium's fake capture: the file's own edges hold under 0.2 s of quiet,
 * short of the VAD's 1.4 s minimum silence, so without the appended pause an
 * utterance ended only at the VAD's cap and the first rows took minutes. The
 * URL swaps the default one's `&cut=off` for `&cut=sentences:1&punctuation=1`:
 * `&punctuation=1` downloads the punctuation pack (~400 MB) into the probe's
 * profile before autostart — slow on a first run against a fresh profile,
 * fast against a profile that already has it. Passes once at least two
 * source rows and at least two translation rows have drawn text AND
 * SpinePreview's seal-count probe (`[data-probe="seals"]`) shows at least one
 * `local.segmentation.seal` frame with reason `sentences` — the seal count is
 * what proves the sentence cut made the rows, not the VAD (a VAD-only cut
 * would also draw two-plus rows for two spoken parts, seal count or no).
 * Without this flag the probe runs the default check above: its own url, the
 * wav as it is, the single-row pass bar.
 *
 *   node scripts/dev/spine-local-probe.mjs --sentences
 *   node scripts/dev/spine-local-probe.mjs --sentences [url] [seconds]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, sleep, withPage } from './headless.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const WAV = join(REPO_ROOT, 'benchmark', 'test-speech-silence-speech.wav');
const DEFAULT_MODELS = 'moonshine-tiny-en-quant,opus-mt-en-jap';

const argv = process.argv.slice(2);
const sentences = argv.includes('--sentences');
const positional = argv.filter((a) => a !== '--sentences');

const jobTmpDir = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, 'tmp') : tmpdir();
const PROFILE_DIR = join(jobTmpDir, 'spine-local-probe-profile');
mkdirSync(PROFILE_DIR, { recursive: true });

const BASE_URL = `http://localhost:5199/?preview=spine&provider=localInference&capture=device&autostart=1&models=${DEFAULT_MODELS}&pair=en:ja`;
// Each mode names its own cut: the stored one persists in the shared profile.
const DEFAULT_URL = `${BASE_URL}&cut=off`;
const SENTENCES_URL = `${BASE_URL}&cut=sentences:1&punctuation=1`;

const url = positional[0] ?? (sentences ? SENTENCES_URL : DEFAULT_URL);
const seconds = Number(positional[1] ?? 600);

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

// Extends READ with the seal counts SpinePreview exposes for this check
// (task 5, plan 1e-2b rulings 11-12): `reason:count` pairs parsed back into
// an object, e.g. `{ sentences: 2 }`.
const READ_SENTENCES = `(() => {
  const base = (${READ});
  const sealsText = (document.querySelector('[data-probe="seals"]')?.textContent ?? '').trim();
  const seals = {};
  if (sealsText && sealsText !== '-') {
    for (const part of sealsText.split(',')) {
      const [reason, count] = part.split(':');
      if (reason) seals[reason] = Number(count) || 0;
    }
  }
  return { ...base, seals };
})()`;

/**
 * Reads a mono 16-bit PCM WAV's `fmt `/`data` chunks (walking every chunk by
 * its own size, so an intervening chunk — this file carries a `LIST` between
 * them — is skipped rather than assumed away) and returns its samples and
 * sample rate. Throws on anything else: this probe's fixture-building has no
 * use for a format it would have to guess at.
 */
function readWavPcm16Mono(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = size;
    }
    // Chunks are word-aligned: an odd-sized body is followed by one pad byte.
    offset = body + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error(`${path}: missing fmt or data chunk`);
  if (fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`${path}: expected 16-bit mono PCM, got format=${fmt.audioFormat} channels=${fmt.channels} bits=${fmt.bitsPerSample}`);
  }
  const samples = new Int16Array(dataLength / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(dataOffset + i * 2);
  return { samples, sampleRate: fmt.sampleRate };
}

/** Writes `samples` as a mono 16-bit PCM WAV at `sampleRate`. */
function writeWavPcm16Mono(path, samples, sampleRate) {
  const dataLength = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate = sampleRate * blockAlign
  header.writeUInt16LE(2, 32); // block align = channels(1) * bitsPerSample(16)/8
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);
  const body = Buffer.alloc(dataLength);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(samples[i], i * 2);
  writeFileSync(path, Buffer.concat([header, body]));
}

/**
 * Builds the `--sentences` fixture: `sourcePath`'s longest low-amplitude run
 * (the deliberate gap between its two spoken parts, found by amplitude —
 * every natural pause inside either spoken part is far shorter) cut down to
 * `targetSilenceMs`, so the two parts arrive close enough together to read
 * as one utterance, then `trailingSilenceMs` of silence appended, so each
 * loop of the fake capture ends that utterance. Node only: no ffmpeg/sox
 * dependency.
 */
function buildSentencesFixture(sourcePath, outPath, targetSilenceMs, trailingSilenceMs) {
  const { samples, sampleRate } = readWavPcm16Mono(sourcePath);
  const windowMs = 20;
  const windowSamples = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const windowCount = Math.floor(samples.length / windowSamples);
  let peakAll = 0;
  const peaks = new Array(windowCount);
  for (let w = 0; w < windowCount; w++) {
    let peak = 0;
    const base = w * windowSamples;
    for (let i = 0; i < windowSamples; i++) peak = Math.max(peak, Math.abs(samples[base + i]));
    peaks[w] = peak;
    peakAll = Math.max(peakAll, peak);
  }
  const threshold = peakAll * 0.05;
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let w = 0; w <= windowCount; w++) {
    const silent = w < windowCount && peaks[w] < threshold;
    if (silent) {
      if (runStart < 0) runStart = w;
    } else if (runStart >= 0) {
      const len = w - runStart;
      if (len > bestLen) { bestLen = len; bestStart = runStart; }
      runStart = -1;
    }
  }
  if (bestStart < 0) throw new Error(`${sourcePath}: no silent gap found between the two spoken parts`);

  const gapStart = bestStart * windowSamples;
  const gapEnd = (bestStart + bestLen) * windowSamples;
  const targetSamples = Math.round((sampleRate * targetSilenceMs) / 1000);
  const cutAt = Math.min(gapEnd, gapStart + targetSamples);

  const head = samples.subarray(0, cutAt);
  const tail = samples.subarray(gapEnd);
  const trailingSamples = Math.round((sampleRate * trailingSilenceMs) / 1000);
  // Zero-filled: the appended samples are the silence.
  const fixture = new Int16Array(head.length + tail.length + trailingSamples);
  fixture.set(head, 0);
  fixture.set(tail, head.length);

  writeWavPcm16Mono(outPath, fixture, sampleRate);
  console.log(`--sentences fixture: gap ${Math.round((bestLen * windowMs))}ms at ${Math.round((gapStart / sampleRate) * 1000)}ms cut to ${Math.round(((cutAt - gapStart) / sampleRate) * 1000)}ms, ${trailingSilenceMs}ms of silence appended (${outPath})`);
}

if (!existsSync(WAV)) {
  console.log(`FAIL: no wav at ${WAV}`);
  process.exit(1);
}

let audioFile = WAV;
if (sentences) {
  audioFile = join(jobTmpDir, 'spine-local-probe-sentences.wav');
  buildSentencesFixture(WAV, audioFile, 200, 2000);
}

/** The default check: at least one source row and one translation row with text. */
async function runDefaultCheck(send) {
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
}

/**
 * `--sentences`: at least two source rows and two translation rows with
 * text, AND at least one `sentences` seal — the seal count is what proves
 * the sentence cut (not the VAD) made the rows.
 */
async function runSentencesCheck(send) {
  let last = { rows: [], phase: '', lastEnd: null, seals: {} };
  let sourceRows = 0;
  let translationRows = 0;
  let sentenceSeals = 0;
  for (
    let waited = 0;
    waited < seconds * 1000 && !(sourceRows >= 2 && translationRows >= 2 && sentenceSeals >= 1);
    waited += 3000
  ) {
    await sleep(3000);
    const now = await evaluate(send, READ_SENTENCES);
    if (!now) continue;
    const phaseChanged = now.phase !== last.phase;
    last = now;
    sourceRows = last.rows.filter((r) => r.side === 'src' && r.text.length > 0).length;
    translationRows = last.rows.filter((r) => r.side === 'tr' && r.text.length > 0).length;
    sentenceSeals = last.seals.sentences ?? 0;
    if (phaseChanged || waited % 15000 < 3000) {
      console.log(`${Math.round(waited / 1000)}s — phase: ${last.phase || '?'} · rows: ${last.rows.length} · seals: ${JSON.stringify(last.seals)}${last.lastEnd ? ` · lastEnd: ${last.lastEnd}` : ''}`);
    }
  }

  console.log(`rows drawn: ${last.rows.length}`);
  for (const row of last.rows) console.log(`  ${row.side || '?'} | ${row.text}`);
  console.log(`seal counts: ${JSON.stringify(last.seals)}`);

  if (sourceRows >= 2 && translationRows >= 2 && sentenceSeals >= 1) return 0;
  console.log(`FAIL: source rows with text: ${sourceRows} (need >=2) · translation rows with text: ${translationRows} (need >=2) · sentences seals: ${sentenceSeals} (need >=1)`);
  if (last.lastEnd) console.log(`FAIL: the preview's lastEnd: ${last.lastEnd}`);
  return 1;
}

process.exitCode = await withPage(url, (send) => (sentences ? runSentencesCheck(send) : runDefaultCheck(send)), {
  port: 9334,
  userDataDir: PROFILE_DIR,
  flags: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${audioFile}`,
  ],
});
