// TTS: ttsLoad and Tts, on the model's worker thread. Mirrors native/tests/test_tts.cpp.
//
//   SK_TEST_TTS_SUPERTONIC_DIR   supertonic-3 (streaming, presets, no cloning)
//   SK_TEST_TTS_MOSS_DIR         moss-tts-nano (offline, one call per synth, voice cloning)
// Tests that need them are skipped when they are unset.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { loadAddon, nativeDir } from './helpers.mjs';

const sk = loadAddon();
// Four threads, as test_tts.cpp: node --test runs the test files in parallel, beside
// asr.test.mjs at half the cores and two more files at two each.
sk.init({ moduleDir: nativeDir(), threads: 4 });

const env = process.env;
const skip = env.SK_TEST_TTS_SUPERTONIC_DIR ? false : 'SK_TEST_TTS_SUPERTONIC_DIR is not set';
const skipMoss = env.SK_TEST_TTS_MOSS_DIR ? false : 'SK_TEST_TTS_MOSS_DIR is not set';
const noop = () => {};

// The explicit CPU device, as test_tts.cpp: null leaves audio.cpp's own default, which on a
// GPU lane would run these tests on the GPU.
const CPU = sk.devices().find((d) => d.kind === 'cpu')?.index;

// Supertonic splits text into chunks of up to 300 codepoints and streams one chunk per piece,
// so "Hello world" is a single chunk. These two texts (test_tts.cpp's) are two chunks each.
const LONG = 'Hello from the parity gate. This sentence is intentionally long enough to span more than ' +
  'one streaming chunk, so the cancel-and-resume test can exercise a genuine multi-chunk pull ' +
  'loop end to end, matching the exact chunk boundaries audio.cpp itself produces for an ' +
  'ordinary paragraph of prose sent through this interface.';
const LONG_CANCEL = 'A longer sentence, long enough that a second streaming chunk would surely follow after the ' +
  'first one, is used here to make sure the callback returning false actually interrupts the ' +
  'pull loop before the remaining audio chunks are ever produced, rather than merely finishing ' +
  'a synthesis run that was always going to be a single chunk anyway.';

/** Runs synth, collecting every onAudio call: { chunks: [{ pcm, rate, channels }], samples }. */
async function collect(tts, text, language) {
  const chunks = [];
  await tts.synth(text, language, 1.0, { onAudio: (pcm, rate, channels) => chunks.push({ pcm, rate, channels }) });
  return { chunks, samples: chunks.reduce((n, c) => n + c.pcm.length, 0) };
}

// The supertonic model the tests share. 'unload is idempotent ...' unloads it, so it comes last.
let st = null;
before(async () => {
  if (!skip) st = await sk.ttsLoad(env.SK_TEST_TTS_SUPERTONIC_DIR, CPU, { family: 'supertonic' });
});
after(async () => {
  if (st) await st.unload();
});

test('supertonic: capabilities and presets', { skip }, async () => {
  const caps = st.capabilities;
  assert.deepEqual({ ...caps }, { streaming: true, clones: false, transcriptRequired: false, sampleRate: 44100 });
  assert.ok(Object.isFrozen(caps));
  assert.equal(st.capabilities, caps);   // the same object every time
  const presets = await st.presets();
  assert.ok(presets.length >= 10 && presets.includes('M1'), JSON.stringify(presets));
  assert.ok(presets.every((p) => typeof p === 'string' && p.length > 0));
});

test('supertonic: an unknown preset rejects; a known one is then accepted', { skip }, async () => {
  await assert.rejects(st.setPreset('NO_SUCH'), (e) =>
    e.name === 'NativeError' && e.status === -1 &&
    /^sk_tts_set_preset: .*unknown preset 'NO_SUCH'.* \(status -1\)$/.test(e.message));
  await st.setPreset((await st.presets())[0]);
  await st.setPreset('M1');
});

test('supertonic: a long text streams in more than one chunk at the model rate', { skip }, async () => {
  await st.setPreset('M1');
  const { chunks, samples } = await collect(st, LONG, 'en');
  assert.ok(chunks.length > 1, `${chunks.length} chunk(s)`);
  for (const c of chunks) {
    assert.ok(c.pcm instanceof Float32Array);
    assert.equal(c.rate, st.capabilities.sampleRate);
    assert.equal(c.channels, 1);
  }
  assert.ok(samples > 0.2 * st.capabilities.sampleRate, `${samples} samples`);
});

test('supertonic: abort after the first chunk rejects -5; the next synth still succeeds', { skip }, async () => {
  const ac = new AbortController(); let n = 0;
  await assert.rejects(st.synth(LONG_CANCEL, 'en', 1.0, { signal: ac.signal, onAudio: () => { if (++n === 1) ac.abort(); } }),
    (e) => e.name === 'NativeError' && e.status === -5 && /^sk_tts_synth: .*cancelled \(status -5\)$/.test(e.message));
  // The second chunk's callback found the flag set: it returned false and delivered nothing.
  assert.equal(n, 1);
  const { chunks, samples } = await collect(st, 'Still working after a cancel.', 'en');
  assert.ok(chunks.length > 0 && samples > 0);
});

test('onAudio never runs after the promise settles', { skip }, async () => {
  const run = async () => {
    const chunks = []; let settled = false, late = 0;
    const p = st.synth('Hello world', 'en', 1.0, { onAudio: (pcm) => { if (settled) late++; chunks.push(pcm); } });
    p.then(() => { settled = true; }, noop);
    await p;
    const calls = chunks.length;
    await sleep(50);
    assert.equal(chunks.length, calls);
    assert.equal(late, 0);
    return chunks;
  };
  const a = await run();
  assert.ok(a.length > 0);
  // Synthesis is deterministic (seed 0), so a second run gives the same samples: the arrays the
  // first run handed out are copies, not views the next run overwrote.
  const b = await run();
  const flat = (chunks) => Float32Array.from(chunks.flatMap((c) => [...c]));
  assert.ok(flat(a).some((x) => Math.abs(x) > 0.01));   // speech, not silence
  assert.deepEqual(flat(a), flat(b));
  assert.equal(new Set([...a, ...b].map((c) => c.buffer)).size, a.length + b.length);   // no buffer shared
});

test('a call made from inside onAudio queues behind the synth: no deadlock', { skip }, async () => {
  // The header's per-handle lock is not recursive; onAudio runs on the JS thread, not inside it.
  let inner = null;
  await st.synth('Hello world', 'en', 1.0, { onAudio: () => { inner ??= st.presets(); } });
  assert.ok((await inner).includes('M1'));
});

test('an aborted signal rejects with CANCELLED before running', { skip }, async () => {
  const ac = new AbortController(); ac.abort();
  let n = 0;
  await assert.rejects(st.synth('Hello world', 'en', 1.0, { signal: ac.signal, onAudio: () => n++ }),
    (e) => e.name === 'NativeError' && e.status === -5 &&
      e.message === 'sk_tts_synth: cancelled before it started (status -5)');
  assert.equal(n, 0);
});

test('a throwing onAudio rejects: NativeError -5 with the thrown value as cause', { skip }, async () => {
  // As in the Python binding, where an exception in on_chunk cancels the request (SK_ERR_CANCELLED).
  const boom = new Error('boom');
  await assert.rejects(st.synth('Hello world', 'en', 1.0, { onAudio: () => { throw boom; } }), (e) =>
    e.name === 'NativeError' && e.status === -5 && e.cause === boom &&
    /^sk_tts_synth: .*cancelled.* \(status -5\)$/.test(e.message));
  const { samples } = await collect(st, 'Hello world', 'en');
  assert.ok(samples > 0);   // the model is still usable
});

test('the library refuses a clone, a bad speed and a bad sample rate with its own errors', { skip }, async () => {
  await assert.rejects(st.setVoice(new Float32Array(24000), 24000, null), (e) =>
    e.name === 'NativeError' && e.status === -1 &&
    /^sk_tts_set_voice: .*does not support voice cloning \(status -1\)$/.test(e.message));
  await assert.rejects(st.setVoice(new Float32Array(0), 24000, null), (e) => e.status === -1);
  await assert.rejects(st.setVoice(new Float32Array(10), 0, null), (e) => e.status === -1);
  await assert.rejects(st.synth('Hello', 'en', 0, { onAudio: noop }), (e) =>
    e.name === 'NativeError' && e.status === -1 &&
    e.message === 'sk_tts_synth: sk_tts_synth: speed must be positive (status -1)');
});

test('moss_tts_nano: offline, one onAudio call per synth; a cloned voice', { skip: skipMoss }, async (t) => {
  const moss = await sk.ttsLoad(env.SK_TEST_TTS_MOSS_DIR, CPU, { family: 'moss_tts_nano', language: null });
  try {
    const caps = moss.capabilities;
    assert.equal(caps.streaming, false);
    assert.equal(caps.clones, true);
    assert.deepEqual(await moss.presets(), []);   // no preset list for this family

    // R23/R39 (test_tts.cpp): moss samples its stop decision, so one prompt may run to the
    // 10 s cap on some build; a greedy regression caps both.
    const check = (out, what) => {
      assert.equal(out.chunks.length, 1, `${what}: ${out.chunks.length} calls`);
      const { pcm, rate, channels } = out.chunks[0];
      assert.ok(pcm.length > 0 && rate > 0 && channels > 0, `${what}: ${pcm.length} samples, ${rate} Hz, ${channels} ch`);
      assert.equal(pcm.length % channels, 0);   // interleaved frames
      const seconds = pcm.length / channels / rate;
      t.diagnostic(`${what}: ${pcm.length} samples, ${rate} Hz, ${channels} channel(s), ${seconds.toFixed(3)} s`);
      if (seconds >= 10) t.diagnostic(`WARNING: ${what} hit the cap (R23 sampling variance on this build?)`);
      return seconds >= 10;
    };
    const plain = await collect(moss, 'Hello from MOSS.', null);
    assert.equal(plain.chunks[0]?.rate, 48000);
    const capped = check(plain, 'moss synth');

    // test_tts.cpp's reference clip: 1 s of a full-scale 440 Hz sine at 24 kHz, mono.
    const ref = new Float32Array(24000);
    for (let i = 0; i < ref.length; i++) ref[i] = Math.sin((2 * Math.PI * 440 * i) / 24000);
    await moss.setVoice(ref, 24000, 'test');
    const cloneCapped = check(await collect(moss, 'Hello again.', null), 'moss clone synth');
    assert.ok(!(capped && cloneCapped), 'moss ran away on both prompts: greedy regression?');
  } finally {
    await moss.unload();
  }
});

test('a missing directory rejects with a NativeError naming it', async () => {
  await assert.rejects(sk.ttsLoad('/nonexistent-tts-dir', null, { family: 'supertonic' }),
    (e) => e.name === 'NativeError' && e.status === -4 &&
      /^sk_tts_load: .*nonexistent-tts-dir.* \(status -4\)$/.test(e.message));
});

test('an unknown family rejects with INVALID_ARGUMENT', async () => {
  await assert.rejects(sk.ttsLoad('/nonexistent-tts-dir', null, { family: 'nope' }),
    (e) => e.name === 'NativeError' && e.status === -1 &&
      /^sk_tts_load: .*unknown family 'nope'.* \(status -1\)$/.test(e.message));
});

test('bad load arguments throw TypeError synchronously', () => {
  assert.throws(() => sk.ttsLoad(5, null, { family: 'supertonic' }), TypeError);
  assert.throws(() => sk.ttsLoad('/x', 'auto', { family: 'supertonic' }), TypeError);
  assert.throws(() => sk.ttsLoad('/x', null), TypeError);                           // family is required
  assert.throws(() => sk.ttsLoad('/x', null, { family: 5 }), TypeError);
  assert.throws(() => sk.ttsLoad('/x', null, { family: 'supertonic', language: 5 }), TypeError);
});

test('bad call arguments throw TypeError synchronously', { skip }, () => {
  const onAudio = noop;
  assert.throws(() => st.synth(5, 'en', 1, { onAudio }), TypeError);
  assert.throws(() => st.synth('x', 5, 1, { onAudio }), TypeError);
  assert.throws(() => st.synth('x', 'en', 'fast', { onAudio }), TypeError);
  assert.throws(() => st.synth('x', 'en', 1, {}), TypeError);                       // onAudio is required
  assert.throws(() => st.synth('x', 'en', 1, { onAudio, signal: {} }), TypeError);
  assert.throws(() => st.setVoice([0.1, 0.2], 24000, null), TypeError);
  assert.throws(() => st.setVoice(new Float32Array(2), 1.5, null), TypeError);
  assert.throws(() => st.setVoice(new Float32Array(2), 24000, 5), TypeError);
  assert.throws(() => st.setPreset(5), TypeError);
});

test('unload is idempotent; later calls reject with NOT_INITIALISED', { skip }, async () => {
  const u = st.unload();
  assert.equal(st.unload(), u);
  await u;
  const unloaded = (what) => (e) =>
    e.name === 'NativeError' && e.status === -2 && e.message === `${what}: model is unloaded (status -2)`;
  await assert.rejects(st.presets(), unloaded('sk_tts_presets'));
  await assert.rejects(st.setVoice(new Float32Array(2), 24000, null), unloaded('sk_tts_set_voice'));
  await assert.rejects(st.setPreset('M1'), unloaded('sk_tts_set_preset'));
  await assert.rejects(st.synth('x', 'en', 1, { onAudio: noop }), unloaded('sk_tts_synth'));
});
