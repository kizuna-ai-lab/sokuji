// Batch ASR on the per-handle worker thread.
//
//   SK_TEST_ASR_GGUF     whisper-tiny (any batch ASR GGUF that transcribes jfk.wav)
//   SK_TEST_SAMPLE_WAV   jfk.wav
// Tests that need them are skipped when either is unset.
import assert from 'node:assert/strict';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, test } from 'node:test';
import { jfk, loadAddon, nativeDir } from './helpers.mjs';

const sk = loadAddon();
// Half the cores per model: 'two models run at the same time' runs two models at once, and
// ggml's spinning thread pools collapse when their threads together outnumber the cores
// (20 cores, 12 threads each: 15 s for two JFK runs, 0.5 s at 10 each).
sk.init({ moduleDir: nativeDir(), threads: Math.max(1, Math.floor(availableParallelism() / 2)) });

const env = process.env;
const skip = env.SK_TEST_ASR_GGUF && env.SK_TEST_SAMPLE_WAV ? false : 'SK_TEST_ASR_GGUF or SK_TEST_SAMPLE_WAV is not set';
const JFK = /ask not what your country can do for you/;

// One model shared by the tests that do not load their own.
let shared = null;
function model() {
  shared ??= sk.asrLoad(env.SK_TEST_ASR_GGUF, null);
  return shared;
}
after(async () => {
  if (shared) await (await shared).unload();
});

test('transcribes JFK', { skip }, async () => {
  const m = await sk.asrLoad(env.SK_TEST_ASR_GGUF, null);
  assert.equal(m.capabilities.nativeSampleRate, 16000);
  let polls = 0, ticks = 0; const t = setInterval(() => ticks++, 5);
  const text = await m.run(jfk(), 'en', { onProgress: () => polls++ });
  clearInterval(t);
  assert.match(text.toLowerCase(), JFK);
  assert.ok(polls > 0 && ticks > 0, `polls ${polls}, ticks ${ticks}`);   // progress arrived; JS thread was free
  await m.unload();
});

test('capabilities decode as the Python binding does', { skip }, async () => {
  // whisper-tiny through the Python binding: AsrCaps(languages=('af', 'am', ...) x99,
  // supports_streaming=False, supports_language_detect=True, native_sample_rate=16000, arch='whisper')
  const caps = (await model()).capabilities;
  assert.equal(caps.arch, 'whisper');
  assert.equal(caps.supportsStreaming, false);
  assert.equal(caps.supportsLanguageDetect, true);
  assert.equal(caps.nativeSampleRate, 16000);
  assert.equal(caps.languages.length, 99);
  assert.deepEqual(caps.languages.slice(0, 2), ['af', 'am']);
  assert.ok(Object.isFrozen(caps) && Object.isFrozen(caps.languages));
  assert.equal((await model()).capabilities, caps);   // the same object every time
});

test('empty PCM resolves to empty text', { skip }, async () => {
  const m = await model();
  assert.equal(await m.run(new Float32Array(0), 'en'), '');
});

test('30 s of audio transcribes', { skip }, async () => {
  const m = await model();
  const one = jfk(), long = new Float32Array(480000);
  for (let i = 0; i < long.length; i += one.length) long.set(one.subarray(0, Math.min(one.length, long.length - i)), i);
  assert.ok((await m.run(long, 'en')).length > 0);
});

test('an aborted signal rejects with CANCELLED before running', { skip }, async () => {
  const m = await model();
  const ac = new AbortController(); ac.abort();
  let polls = 0;
  await assert.rejects(m.run(jfk(), 'en', { signal: ac.signal, onProgress: () => polls++ }),
    (e) => e.name === 'NativeError' && e.status === -5);
  assert.equal(polls, 0);
});

test('abort mid-run cancels at the next decode step', { skip }, async () => {
  const m = await model();
  const ac = new AbortController();
  const p = m.run(jfk(), 'en', { signal: ac.signal, onProgress: () => ac.abort() });
  await assert.rejects(p, (e) => e.status === -5 && /cancelled by the callback/.test(e.message));
});

test('a throwing onProgress cancels the run and rejects with what it threw', { skip }, async () => {
  const m = await model();
  const boom = new Error('boom');
  await assert.rejects(m.run(jfk(), 'en', { onProgress: () => { throw boom; } }), (e) => e === boom);
  assert.match((await m.run(jfk(), 'en')).toLowerCase(), JFK);   // the model is still usable
});

test('a missing file rejects with NOT_FOUND and the right message', async () => {
  await assert.rejects(sk.asrLoad('/nonexistent.gguf', null),
    (e) => e.name === 'NativeError' && e.status === -4 && /^sk_asr_load: .*nonexistent\.gguf/.test(e.message));
});

test('the error text belongs to the failing call, not an earlier one', async () => {
  await assert.rejects(sk.asrLoad('/first-missing.gguf', null));
  await assert.rejects(sk.asrLoad('/second-missing.gguf', null), /second-missing/);
});

test('loads a model from a non-ASCII directory', { skip }, async (t) => {
  // A Windows user named 山田 has C:\Users\山田\AppData\... in every model path.
  const root = mkdtempSync(join(tmpdir(), 'sokuji-asr-'));
  try {
    const dir = join(root, 'モデル 山田');
    mkdirSync(dir);
    const path = join(dir, basename(env.SK_TEST_ASR_GGUF));
    try { linkSync(env.SK_TEST_ASR_GGUF, path); } catch { copyFileSync(env.SK_TEST_ASR_GGUF, path); }
    let m;
    try {
      m = await sk.asrLoad(path, null);
    } catch (e) {
      assert.equal(e.name, 'NativeError', String(e));   // a clear error is acceptable; a crash is not
      t.diagnostic(`non-ASCII path: rejected with ${e.message}`);
      return;
    }
    t.diagnostic('non-ASCII path: loaded and transcribed');
    assert.match((await m.run(jfk(), 'en')).toLowerCase(), JFK);
    await m.unload();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two models run at the same time', { skip }, async () => {
  const [a, b] = await Promise.all([sk.asrLoad(env.SK_TEST_ASR_GGUF, null), sk.asrLoad(env.SK_TEST_ASR_GGUF, null)]);
  // Each run's first progress event comes before either run finishes: the two overlapped.
  const first = [], done = [];
  const go = (m, i) => m.run(jfk(), 'en', { onProgress: () => { first[i] ??= performance.now(); } })
    .then((text) => { done[i] = performance.now(); return text; });
  const texts = await Promise.all([go(a, 0), go(b, 1)]);
  for (const text of texts) assert.match(text.toLowerCase(), JFK);
  assert.ok(Math.max(...first) < Math.min(...done), `first progress ${first}, done ${done}`);
  await Promise.all([a.unload(), b.unload()]);
});
