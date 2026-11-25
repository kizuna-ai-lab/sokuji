// Streaming ASR: AsrModel.openStream and AsrStream, on the model's worker thread.
//
//   SK_TEST_ASR_STREAM_GGUF  moonshine-streaming-tiny (a streaming ASR GGUF, English)
//   SK_TEST_SAMPLE_WAV       jfk.wav
//   SK_TEST_ASR_GGUF         whisper-tiny (a batch-only model; one test)
// Tests that need them are skipped when they are unset.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chunks, jfk, loadAddon, nativeDir, cpuDevice } from './helpers.mjs';

const sk = loadAddon();
// Two threads: node --test runs the test files in parallel, and asr.test.mjs runs two models
// at half the cores each beside this file, so more threads here oversubscribe the cores and
// ggml's spinning pools collapse (20 cores, half here as well: JFK feeds 1.4 s alone, up to
// 11 s beside asr.test.mjs; two threads: 2-3 s, steady). The streaming model is tiny.
sk.init({ moduleDir: nativeDir(), threads: 2 });

const env = process.env;
const skip = env.SK_TEST_ASR_STREAM_GGUF && env.SK_TEST_SAMPLE_WAV
  ? false : 'SK_TEST_ASR_STREAM_GGUF or SK_TEST_SAMPLE_WAV is not set';
const skipBatch = env.SK_TEST_ASR_GGUF ? false : 'SK_TEST_ASR_GGUF is not set';
const JFK = /ask not what your country/;

// The model the tests share. 'unload closes an open stream' unloads it, so it comes last.
let m = null;
before(async () => {
  if (!skip) m = await sk.asrLoad(env.SK_TEST_ASR_STREAM_GGUF, cpuDevice());
});
after(async () => {
  if (m) await m.unload();
});

test('streams JFK in 0.5 s chunks', { skip }, async () => {
  const m = await sk.asrLoad(env.SK_TEST_ASR_STREAM_GGUF, cpuDevice());
  assert.ok(m.capabilities.supportsStreaming);
  const s = m.openStream('en'); let last = { committed: '', tentative: '' };
  for (const chunk of chunks(jfk(), 8000)) last = await s.feed(chunk);
  assert.ok(last.committed.length + last.tentative.length > 0);
  assert.match((await s.finalize()).toLowerCase(), /ask not what your country/);
  s.close();                                   // idempotent after finalize
  await m.unload();
});

test('a second open stream is refused', { skip }, () => {
  const s = m.openStream(null);
  assert.throws(() => m.openStream(null), /already open/);
  assert.throws(() => m.openStream('en'), (e) => e.name === 'NativeError' && e.status === -1 &&
    e.message === 'sk_asr_stream_open: a stream is already open on this model (status -1)');
  s.close();
});

test('feed after close rejects', { skip }, async () => {
  const s = m.openStream(null);
  s.close();
  await assert.rejects(s.feed(new Float32Array(160)), (e) => e.status === -1);
});

test('feeds queued without awaiting run in call order; finalize closes the stream', { skip }, async () => {
  const s = m.openStream('en');
  const feeds = chunks(jfk(), 8000).map((c) => s.feed(c));   // all queued at once
  const final = s.finalize();
  const texts = await Promise.all(feeds);
  for (let i = 1; i < texts.length; i++) {
    // committed is append-only, so each feed's copy shows its own moment, in order
    assert.ok(texts[i].committed.startsWith(texts[i - 1].committed), `feed ${i}: ${JSON.stringify(texts.slice(i - 1, i + 1))}`);
  }
  assert.match((await final).toLowerCase(), JFK);
  await assert.rejects(s.feed(new Float32Array(160)), (e) => e.name === 'NativeError' && e.status === -1 &&
    e.message === 'sk_asr_stream_feed: stream is closed (status -1)');
  await assert.rejects(s.finalize(), (e) => e.name === 'NativeError' && e.status === -1 &&
    e.message === 'sk_asr_stream_finalize: stream is closed (status -1)');
  s.close();
  const s2 = m.openStream(null);                  // the model's one stream is free again
  assert.equal(typeof (await s2.feed(new Float32Array(160))).committed, 'string');
  s2.close();
});

test('the stream is open in the library from openStream to close, in call order', { skip }, async () => {
  const s = m.openStream('en');
  await assert.rejects(m.run(jfk(), 'en'), (e) => e.name === 'NativeError' && e.status === -1 &&
    /a stream is open on this model/.test(e.message));
  s.close();
  assert.match((await m.run(jfk(), 'en')).toLowerCase(), JFK);   // queued behind the close
});

test('an open the library refuses rejects the stream calls with its NativeError', { skip }, async () => {
  const s = m.openStream('xx');                  // not a language: refused on the worker thread
  const refused = (e) => e.name === 'NativeError' && e.status === -1 &&
    /^sk_asr_stream_open: .*unsupported language \(status -1\)$/.test(e.message);
  await assert.rejects(s.feed(new Float32Array(160)), refused);
  await assert.rejects(s.finalize(), refused);
  s.close();
  const s2 = m.openStream('en');
  await s2.feed(new Float32Array(160));
  s2.close();
});

test('finalize with an aborted signal rejects -5 and still closes the stream', { skip }, async () => {
  const s = m.openStream(null);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(s.finalize({ signal: ac.signal }), (e) => e.name === 'NativeError' && e.status === -5);
  await assert.rejects(s.feed(new Float32Array(160)), (e) => e.status === -1);
  m.openStream(null).close();                    // the slot is free
});

test('openStream on a batch-only model throws NativeError -1', { skip: skipBatch }, async () => {
  const w = await sk.asrLoad(env.SK_TEST_ASR_GGUF, cpuDevice());
  try {
    assert.equal(w.capabilities.supportsStreaming, false);
    assert.throws(() => w.openStream('en'), (e) => e.name === 'NativeError' && e.status === -1 &&
      e.message === 'sk_asr_stream_open: this model does not support streaming (status -1)');
  } finally {
    await w.unload();
  }
});

test('unload closes an open stream', { skip }, async () => {
  const s = m.openStream(null);
  await m.unload();
  await assert.rejects(s.feed(new Float32Array(160)));
  await assert.rejects(s.feed(new Float32Array(160)), (e) => e.name === 'NativeError' && e.status === -2 &&
    e.message === 'sk_asr_stream_feed: model is unloaded (status -2)');
  await assert.rejects(s.finalize(), (e) => e.status === -2);
  assert.throws(() => m.openStream(null), (e) => e.name === 'NativeError' && e.status === -2 &&
    e.message === 'sk_asr_stream_open: model is unloaded (status -2)');
  s.close(); s.close();                          // idempotent
});
