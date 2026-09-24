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
 * Default seconds: 600 (10 minutes) — a first run downloads ~140 MB and
 * compiles two WASM engines; every later run against the same profile
 * directory (below) finds both models already downloaded and is much
 * faster.
 *
 * Unlike headless.mjs's `withPage`, the browser profile here is a FIXED
 * directory under this job's own temp dir, not a fresh `mkdtempSync` one per
 * run — so a downloaded model's IndexedDB entry survives a re-run: an
 * interrupted or failed probe does not pay the download again.
 *
 * Exits 1 when the wait times out before both a non-empty source row and a
 * non-empty translation row are drawn, printing the preview's own
 * start-failure line (`SessionControls`' `state.lastEnd`) when one is
 * showing, and whatever rows did get drawn either way.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { evaluate, sleep } from './headless.mjs';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const WAV = join(REPO_ROOT, 'benchmark', 'test-speech-silence-speech.wav');
const DEFAULT_MODELS = 'moonshine-tiny-en-quant,opus-mt-en-jap';
const url = process.argv[2]
  ?? `http://localhost:5199/?preview=spine&provider=localInference&capture=device&autostart=1&models=${DEFAULT_MODELS}&pair=en:ja`;
const seconds = Number(process.argv[3] ?? 600);

// A fixed path under the job's own temp dir (not node:os#tmpdir, and not
// mkdtempSync'd fresh) so IndexedDB — and with it every model this probe has
// already downloaded — survives a re-run.
const PROFILE_DIR = join('/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp', 'spine-local-probe-profile');
mkdirSync(PROFILE_DIR, { recursive: true });

async function pageSocketUrl(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error('chromium did not come up');
}

/**
 * Like headless.mjs's `withPage`, but on `PROFILE_DIR` instead of a fresh
 * profile per call (see the header comment) — everything else matches it.
 */
async function withPersistentPage(pageUrl, fn, { port = 9334, flags = [] } = {}) {
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const build = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
  if (!build) throw new Error(`no Playwright chromium under ${cache}`);
  const browser = spawn(join(cache, build, 'chrome-linux', 'chrome'), [
    '--headless', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', ...flags,
    `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE_DIR}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await pageSocketUrl(port));
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    let nextId = 0;
    const waiting = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++nextId;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    try {
      await send('Page.enable');
      await send('Page.navigate', { url: pageUrl });
      return await fn(send);
    } finally {
      ws.close();
    }
  } finally {
    browser.kill();
  }
}

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

process.exitCode = await withPersistentPage(url, async (send) => {
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
  flags: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
  ],
});
