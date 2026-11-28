// Handle lifetimes: unload, finalizers, environment teardown and process exit.
//
//   SK_TEST_ASR_GGUF / SK_TEST_ASR_STREAM_GGUF / SK_TEST_TRANSLATE_GGUF /
//   SK_TEST_TTS_SUPERTONIC_DIR / SK_TEST_TTS_MOSS_DIR   the models the other suites use
//   SK_TEST_SAMPLE_WAV                                  jfk.wav
// Tests that need them are skipped when they are unset. The tests that end a process or an
// environment (process.exit, a terminated Worker, a collected handle) run it in a child.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { chunks, jfk, loadAddon, nativeDir, threadCount, cpuDevice } from './helpers.mjs';

const sk = loadAddon();
const logLines = [];
sk.init({ moduleDir: nativeDir(), threads: 4, onLog: (level, message) => logLines.push({ level, message }) });
const collectedWarnings = () => logLines.filter((l) => /collected without unload/.test(l.message));

const env = process.env;
const have = (...names) => (names.every((n) => env[n]) ? false : `${names.filter((n) => !env[n]).join(', ')} is not set`);
const skipAsr = have('SK_TEST_ASR_GGUF', 'SK_TEST_SAMPLE_WAV');
const skipStream = have('SK_TEST_ASR_STREAM_GGUF', 'SK_TEST_SAMPLE_WAV');
const skipTranslate = have('SK_TEST_TRANSLATE_GGUF');
const skipTts = have('SK_TEST_TTS_SUPERTONIC_DIR');
const skipMoss = have('SK_TEST_TTS_MOSS_DIR');
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const noop = () => {};
// A child that hangs (a worker that never joins, a native call that never returns) must fail
// its test, not the CI job's six-hour limit. Generous: the slowest child waits out an offline
// synth on the CPU, and GitHub's macOS arm64 runner is a VM whose GPU cannot run the TTS families.
// Since ggml 1.1.1 an F16 model on an ARM CPU (supertonic here) multiplies with F32 activations
// instead of native FP16 arithmetic — more accurate, about 3x slower — and that runner's synth went
// past the old 120 s (owner, 2026-11-28: keep the accuracy, widen the bound).
const CHILD_TIMEOUT_MS = 300_000;

// ---- unload ---------------------------------------------------------------------------------

test('unload is idempotent and later calls reject with NOT_INITIALISED', { skip: skipAsr }, async () => {
  const m = await sk.asrLoad(env.SK_TEST_ASR_GGUF, cpuDevice());
  const u = m.unload();
  assert.equal(m.unload(), u);
  await u;
  await m.unload();
  await assert.rejects(m.run(jfk(), 'en'), (e) =>
    e.name === 'NativeError' && e.status === -2 && e.message === 'sk_asr_run: model is unloaded (status -2)');
});

test('unload cancels queued runs', { skip: skipAsr }, async () => {
  const m = await sk.asrLoad(env.SK_TEST_ASR_GGUF, cpuDevice());
  const a = m.run(jfk(), 'en'), b = m.run(jfk(), 'en');
  const u = m.unload();
  const [ra, rb] = await Promise.allSettled([a, b]);
  await u;
  // b was still queued behind a: it never starts. a had been handed to the worker a moment
  // before the unload: it is stopped at its next decode step, or never started either.
  assert.equal(rb.status, 'rejected');
  assert.equal(rb.reason.status, -5);
  assert.match(rb.reason.message, /cancelled before it started/);
  assert.equal(ra.status, 'rejected');
  assert.equal(ra.reason.status, -5);
});

test('unload stops the running run at its next callback', { skip: skipAsr }, async () => {
  const m = await sk.asrLoad(env.SK_TEST_ASR_GGUF, cpuDevice());
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const run = m.run(jfk(), 'en', { onProgress: () => started() });
  await running;
  const u = m.unload();
  await assert.rejects(run, (e) => e.name === 'NativeError' && e.status === -5 && /cancelled by the callback/.test(e.message));
  await u;
  await assert.rejects(m.run(jfk(), 'en'), (e) => e.status === -2);
});

test('unload with a stream open and its feeds queued settles every call', { skip: skipStream }, async () => {
  const m = await sk.asrLoad(env.SK_TEST_ASR_STREAM_GGUF, cpuDevice());
  const s = m.openStream('en');
  const feeds = chunks(jfk(), 8000).map((c) => s.feed(c));   // all queued at once
  const u = m.unload();
  const settled = await Promise.allSettled(feeds);
  await u;
  for (const r of settled) assert.ok(r.status === 'fulfilled' || r.reason.status === -5, String(r.reason));
  assert.equal(settled.at(-1).status, 'rejected');   // the last of 22 feeds cannot have started
  await assert.rejects(s.feed(new Float32Array(160)), (e) => e.status === -2);
  await assert.rejects(s.finalize(), (e) => e.status === -2);
  assert.throws(() => m.openStream(null), (e) => e.status === -2);
});

test('unload stops a running translation at its next token', { skip: skipTranslate }, async () => {
  const t = await sk.translateLoad(env.SK_TEST_TRANSLATE_GGUF, cpuDevice(), { nCtx: 2048 });
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const chat = t.chat([{ role: 'user', content: 'Write a long story about a lighthouse.' }], { maxTokens: 512 },
                      { onToken: () => started() });
  await running;
  const queued = t.complete('Once upon a time', { maxTokens: 8 }, { onToken: noop });
  const u = t.unload();
  await assert.rejects(chat, (e) => e.status === -5);
  await assert.rejects(queued, (e) => e.status === -5 && /cancelled before it started/.test(e.message));
  await u;
  await assert.rejects(t.complete('x', {}, { onToken: noop }), (e) => e.status === -2);
});

test('unload stops a streaming synth at its next chunk', { skip: skipTts }, async () => {
  const cpu = sk.devices().find((d) => d.kind === 'cpu')?.index;
  const tts = await sk.ttsLoad(env.SK_TEST_TTS_SUPERTONIC_DIR, cpu, { family: 'supertonic' });
  const text = 'Hello from the parity gate. '.repeat(14);   // 392 codepoints: two chunks (300 at most each)
  let started;
  const first = new Promise((resolve) => { started = resolve; });
  const synth = tts.synth(text, 'en', 1, { onAudio: () => started() });
  await first;
  const queued = tts.presets();
  const u = tts.unload();
  await assert.rejects(synth, (e) => e.status === -5);
  await assert.rejects(queued, (e) => e.status === -5);
  await u;
  await assert.rejects(tts.presets(), (e) => e.status === -2);
});

// ---- finalizers -----------------------------------------------------------------------------

/** Runs a fixture under --expose-gc and returns its one JSON line. */
function runDropped(kind) {
  const r = spawnSync(process.execPath, ['--expose-gc', fixture('dropped-handle.mjs'), kind], { env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });
  assert.equal(r.status, 0, `status ${r.status}, signal ${r.signal}${r.error ? `, ${r.error.message}` : ''}: ${r.stderr}`);
  return { ...JSON.parse(r.stdout.trim().split('\n').at(-1)), stderr: r.stderr };
}

for (const [kind, name, skip] of [['asr', 'AsrModel', skipAsr], ['translate', 'Translator', skipTranslate], ['tts', 'Tts', skipTts]]) {
  test(`a dropped ${name} is unloaded by its finalizer, with a warning naming it`, { skip }, () => {
    const r = runDropped(kind);
    assert.equal(r.collected, true, JSON.stringify(r));
    assert.equal(r.warnings.length, 1, JSON.stringify(r.warnings));
    assert.match(r.warnings[0].message, new RegExp(`^${name}\\(.+\\) was collected without unload\\(\\)`));
    assert.match(r.stderr, /was collected without unload\(\)/);   // and, as every warning, on stderr
    // The model's own thread freed it and ended: it is not left behind...
    if (r.baseline !== null) assert.equal(r.threadsAfter, r.baseline, JSON.stringify(r));
    // ...and the JS thread was not the one that freed it (200-250 ms for a 0.6B LLM there).
    assert.ok(r.maxStallMs < 100, `the JS thread stalled for ${r.maxStallMs} ms`);
  });
}

test('an unloaded handle that is dropped does not warn', { skip: skipAsr }, () => {
  const r = runDropped('asr-unloaded');
  assert.deepEqual(r.warnings, []);
  if (r.baseline !== null) assert.equal(r.threadsAfter, r.baseline, JSON.stringify(r));
});

test('a dropped AsrStream is closed: the model can open another and run again', { skip: skipStream }, () => {
  const r = runDropped('stream');
  assert.equal(r.freed, true, JSON.stringify(r));
  assert.match(r.text, /ask not what your country/);
  assert.deepEqual(r.warnings, []);
});

// ---- environment teardown ------------------------------------------------------------------

/** Starts a Worker that leaves work in flight, terminates it once it reports 'running'. */
async function terminated(kind) {
  const worker = new Worker(fixture('teardown-worker.mjs'), { workerData: { kind } });
  const failed = new Promise((_, reject) => worker.once('error', reject));
  await Promise.race([new Promise((resolve) => worker.once('message', resolve)), failed]);
  await sleep(50);
  const t0 = performance.now();
  await Promise.race([worker.terminate(), failed]);
  return performance.now() - t0;
}

// Terminating a Worker ends its environment while its handles are alive: the cleanup hook
// stops and joins their threads, then the handles are finalized (an open stream's model and the
// stream forgetting each other). Rounds repeat: the first one starts the process's own threads.
for (const [kind, label, skip] of [
  ['asr-run', 'a run in flight', skipAsr],
  ['stream-open', 'an open stream', skipStream],
  ['translate-run', 'a translation in flight', skipTranslate],
]) {
  test(`terminating a Worker with ${label} stops its threads and leaves the process healthy`, { skip }, async (t) => {
    await sk.asrLoad('/nonexistent.gguf', null).catch(noop);   // the process-wide worker exists before we count
    await terminated(kind);
    const threads = threadCount();
    for (let round = 0; round < 3; round++) {
      const ms = await terminated(kind);
      t.diagnostic(`round ${round}: terminate took ${ms.toFixed(0)} ms`);
      if (threads !== null) assert.equal(threadCount(), threads, `round ${round}`);
    }
    // A handle finalized as its environment ends is not a leak: no warning for it.
    await sleep(200);
    assert.deepEqual(collectedWarnings(), []);
    // The addon still works in this environment.
    await assert.rejects(sk.asrLoad('/nonexistent.gguf', null), (e) => e.name === 'NativeError' && e.status === -4);
  });
}

// ---- process exit ---------------------------------------------------------------------------

/** Runs exit-mid-run.mjs; returns the child's result and how long it took. */
function exitMidRun(kind, mode, code = 0) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [fixture('exit-mid-run.mjs'), kind, mode, String(code)], { env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS });
  return { r, ms: performance.now() - t0 };
}

function assertExitedWith(r, code) {
  assert.equal(r.signal, null, `killed by ${r.signal}: ${r.stderr}`);
  assert.equal(r.status, code, r.stderr);
  assert.match(r.stdout, /^exiting$/m);   // it got as far as process.exit
  assert.doesNotMatch(r.stderr, /AddressSanitizer|runtime error|terminate called|Segmentation/);
}

// process.exit() skips the environment's cleanup hooks: ggml's compute threads must be stopped
// by the addon's own exit handler, or they run on into static destruction (a crash about one
// run in ten before it existed).
test('exits cleanly while a run is in flight', { skip: skipAsr }, () => {
  for (let i = 0; i < 5; i++) {
    const { r } = exitMidRun('asr', 'delay');
    assertExitedWith(r, 0);   // the fixture starts a 30 s run, then process.exit(0) after 50 ms
  }
});

test('exits with the code it was asked for, from inside the run\'s own callback', { skip: skipAsr }, () => {
  assertExitedWith(exitMidRun('asr', 'callback', 7).r, 7);
});

test('exits cleanly while a translation is in flight', { skip: skipTranslate }, () => {
  assertExitedWith(exitMidRun('translate', 'callback').r, 0);
  assertExitedWith(exitMidRun('translate', 'delay').r, 0);
});

test('exits cleanly while a streaming synth is in flight', { skip: skipTts }, () => {
  assertExitedWith(exitMidRun('tts', 'callback').r, 0);
  assertExitedWith(exitMidRun('tts', 'delay').r, 0);
});

// moss decodes the whole utterance before its one callback and the library checks for a cancel
// only between chunks: the exit waits for that synth, but it does finish, and cleanly.
test('exits cleanly while an offline synth is in flight, once that synth is done', { skip: skipMoss }, (t) => {
  const { r, ms } = exitMidRun('tts-offline', 'delay');
  t.diagnostic(`exit took ${(ms / 1000).toFixed(1)} s`);
  assertExitedWith(r, 0);
});
