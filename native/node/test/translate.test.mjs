// Translation: translateLoad and Translator, on the translator's worker thread.
//
//   SK_TEST_TRANSLATE_GGUF   Qwen3-0.6B Q8_0 (a GGUF chat model whose template the library renders)
// Tests that need it are skipped when it is unset.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { loadAddon, nativeDir, cpuDevice } from './helpers.mjs';

const sk = loadAddon();
// Two threads: node --test runs the test files in parallel, and asr.test.mjs runs two models
// at half the cores each beside this file; more threads here oversubscribe the cores and
// ggml's spinning pools collapse (Task 3's finding). The library's log lines are kept for
// the test that reads llama.cpp's own report of the context it created.
const logLines = [];
sk.init({ moduleDir: nativeDir(), threads: 2, onLog: (_level, message) => logLines.push(message) });

const env = process.env;
const skip = env.SK_TEST_TRANSLATE_GGUF ? false : 'SK_TEST_TRANSLATE_GGUF is not set';
const PREFILL = '<think>\n\n</think>\n\n';   // Qwen3: an empty think block, so the answer comes first
const noop = () => {};

// The translator the tests share. 'unload is idempotent ...' unloads it, so it comes last.
let tr = null;
before(async () => {
  if (!skip) tr = await sk.translateLoad(env.SK_TEST_TRANSLATE_GGUF, cpuDevice(), { nCtx: 2048 });
});
after(async () => {
  if (tr) await tr.unload();
});

test('chat produces text', { skip }, async () => {
  const tr = await sk.translateLoad(env.SK_TEST_TRANSLATE_GGUF, cpuDevice(), {});
  try {
    const dec = new TextDecoder('utf-8', { fatal: false }); let out = '';
    await tr.chat([{ role: 'user', content: 'Translate to French: Good morning' }], { maxTokens: 32, assistantPrefill: PREFILL },
                  { onToken: (b) => { out += dec.decode(b, { stream: true }); } });
    out += dec.decode();
    assert.ok(out.trim().length > 0);
  } finally {
    await tr.unload();
  }
});

test('Japanese output survives pieces that split characters', { skip }, async (t) => {
  const dec = new TextDecoder('utf-8', { fatal: false }); let out = '';
  let split = 0;   // pieces that are not whole UTF-8 on their own
  await tr.chat([{ role: 'user', content: 'Translate to Japanese: Good morning' }], { maxTokens: 32, assistantPrefill: PREFILL },
                { onToken: (b) => {
                  try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { split++; }
                  out += dec.decode(b, { stream: true });
                } });
  out += dec.decode();
  t.diagnostic(`output ${JSON.stringify(out)}; ${split} piece(s) split a character`);
  assert.ok(!out.includes('�') && /[぀-ヿ一-鿿]/.test(out), out);
});

test('rare characters arrive split across pieces and reassemble', { skip }, async (t) => {
  // Pieces are the raw bytes of each token. Rare kanji are several byte-level tokens each, so
  // echoing them usually makes pieces that end inside a character, but whether the model
  // does that is the model's choice, not the addon's: try a few prompts, and when none of them
  // splits, skip with a diagnostic instead of failing on model output. What must always hold is
  // that the pieces reassemble into valid text.
  const prompts = ['Repeat exactly: 齉龘靐龖', 'Repeat exactly: 龘龘龘靐靐靐', 'Copy this text: 爨籲鬱馨'];
  const tries = [];
  for (const content of prompts) {
    const dec = new TextDecoder('utf-8', { fatal: false }); let out = '';
    let split = 0;
    await tr.chat([{ role: 'user', content }], { maxTokens: 32, assistantPrefill: PREFILL },
                  { onToken: (b) => {
                    try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { split++; }
                    out += dec.decode(b, { stream: true });
                  } });
    out += dec.decode();
    assert.ok(!out.includes('\uFFFD'), `pieces did not reassemble into valid text: ${JSON.stringify(out)}`);
    tries.push(`${JSON.stringify(out)}: ${split} split`);
    if (split > 0) {
      assert.ok(/[\u4e00-\u9fff]/.test(out), out);
      return;
    }
  }
  t.skip(`the model produced no piece that splits a character (${tries.join('; ')})`);
});

test('complete produces text', { skip }, async () => {
  const dec = new TextDecoder('utf-8', { fatal: false }); let out = '';
  await tr.complete('Hello', { maxTokens: 8 }, { onToken: (b) => { out += dec.decode(b, { stream: true }); } });
  out += dec.decode();
  assert.ok(out.length > 0);
});

test('abort after the first token cancels', { skip }, async () => {
  const ac = new AbortController(); let n = 0;
  await assert.rejects(tr.chat([{ role: 'user', content: 'Count to fifty' }], { maxTokens: 256 },
    { signal: ac.signal, onToken: () => { if (++n === 1) ac.abort(); } }), (e) => e.status === -5);
  assert.ok(n < 256);
});

test('an aborted signal rejects with CANCELLED before running', { skip }, async () => {
  const ac = new AbortController(); ac.abort();
  let n = 0;
  await assert.rejects(tr.complete('Hello', { maxTokens: 8 }, { signal: ac.signal, onToken: () => n++ }),
    (e) => e.name === 'NativeError' && e.status === -5 &&
      e.message === 'sk_translate_complete: cancelled before it started (status -5)');
  assert.equal(n, 0);
});

test('a throwing onToken cancels: NativeError -5 with the thrown value as cause', { skip }, async () => {
  // As in the Python binding, where an exception in on_token cancels the request (SK_ERR_CANCELLED).
  const boom = new Error('boom'); let n = 0;
  await assert.rejects(tr.chat([{ role: 'user', content: 'Count to fifty' }], { maxTokens: 256 },
    { onToken: () => { n++; throw boom; } }), (e) =>
    e.name === 'NativeError' && e.status === -5 && e.cause === boom &&
    /^sk_translate_chat: .*cancelled \(status -5\)$/.test(e.message));
  assert.equal(n, 1);   // the pieces still queued behind the throw are dropped
  let out = 0;
  await tr.complete('Hello', { maxTokens: 4 }, { onToken: (b) => { out += b.length; } });
  assert.ok(out > 0);   // the translator is still usable
});

test('each piece is its own Uint8Array copy, all delivered before the promise settles', { skip }, async () => {
  const run = async () => {
    const pieces = []; let settled = false, late = 0;
    const p = tr.complete('The capital of France is', { maxTokens: 16 },
      { onToken: (b) => { if (settled) late++; pieces.push(b); } });
    p.then(() => { settled = true; }, noop);
    await p;
    await sleep(50);
    assert.equal(late, 0);
    return pieces;
  };
  const a = await run();
  assert.ok(a.length > 0);
  assert.ok(a.every((b) => b instanceof Uint8Array));
  assert.equal(new Set(a.map((b) => b.buffer)).size, a.length);   // no buffer is shared or reused
  // Greedy decoding is deterministic, so a second run gives the same bytes: the pieces the
  // first run handed out were not overwritten by the pieces that came after them.
  assert.deepEqual(Buffer.concat(a), Buffer.concat(await run()));
});

test('nCtx and flashAttn reach the library; both default to 0', { skip }, async () => {
  // llama.cpp logs the context it creates ("llama_context: n_ctx = 512", "... flash_attn =
  // disabled"); n_ctx 0 is the library's 4096 and flash_attn 0 llama.cpp's own default, auto.
  const contextOf = async (...args) => {
    const from = logLines.length;
    const t = await sk.translateLoad(env.SK_TEST_TRANSLATE_GGUF, cpuDevice(), ...args);
    try {
      const value = (re) => logLines.slice(from).map((l) => re.exec(l)?.[1]).find((v) => v !== undefined);
      // The log lines travel on their own thread-safe function: they may land after the load.
      for (let i = 0; i < 200 && value(/^llama_context: flash_attn\s+= (\w+)$/) === undefined; i++) await sleep(10);
      return { nCtx: value(/^llama_context: n_ctx\s+= (\d+)$/),
               flashAttn: value(/^llama_context: flash_attn\s+= (\w+)$/) };
    } finally {
      await t.unload();
    }
  };
  assert.deepEqual(await contextOf(), { nCtx: '4096', flashAttn: 'auto' });
  assert.deepEqual(await contextOf({ nCtx: 512, flashAttn: 2 }), { nCtx: '512', flashAttn: 'disabled' });
  assert.deepEqual(await contextOf({ nCtx: 512, flashAttn: 1 }), { nCtx: '512', flashAttn: 'enabled' });
});

test('a missing file rejects with a NativeError naming it', async () => {
  await assert.rejects(sk.translateLoad('/nonexistent.gguf', null),
    (e) => e.name === 'NativeError' && e.status === -3 &&
      /^sk_translate_load: .*nonexistent\.gguf \(status -3\)$/.test(e.message));
});

test('bad load arguments throw TypeError synchronously', () => {
  assert.throws(() => sk.translateLoad(5, null), TypeError);
  assert.throws(() => sk.translateLoad('/x.gguf', 'auto'), TypeError);
  assert.throws(() => sk.translateLoad('/x.gguf', null, 5), TypeError);
  assert.throws(() => sk.translateLoad('/x.gguf', null, { nCtx: 1.5 }), TypeError);
  assert.throws(() => sk.translateLoad('/x.gguf', null, { flashAttn: 3 }), TypeError);
});

test('bad chat and complete arguments throw TypeError synchronously', { skip }, () => {
  const onToken = noop;
  assert.throws(() => tr.chat('hi', {}, { onToken }), TypeError);
  assert.throws(() => tr.chat([null], {}, { onToken }), TypeError);
  assert.throws(() => tr.chat([{ role: 'user' }], {}, { onToken }), TypeError);
  assert.throws(() => tr.chat([], 5, { onToken }), TypeError);
  assert.throws(() => tr.chat([], { maxTokens: 'many' }, { onToken }), TypeError);
  assert.throws(() => tr.chat([], { assistantPrefill: 5 }, { onToken }), TypeError);
  assert.throws(() => tr.chat([], {}, {}), TypeError);   // onToken is required
  assert.throws(() => tr.complete(5, {}, { onToken }), TypeError);
  assert.throws(() => tr.complete('x', { maxTokens: 2 ** 31 }, { onToken }), TypeError);
  assert.throws(() => tr.complete('x', {}, { onToken, signal: {} }), TypeError);
});

test('unload is idempotent; later calls reject with NOT_INITIALISED', { skip }, async () => {
  const u = tr.unload();
  assert.equal(tr.unload(), u);
  await u;
  await assert.rejects(tr.chat([{ role: 'user', content: 'hi' }], {}, { onToken: noop }), (e) =>
    e.name === 'NativeError' && e.status === -2 &&
    e.message === 'sk_translate_chat: model is unloaded (status -2)');
  await assert.rejects(tr.complete('hi', {}, { onToken: noop }), (e) =>
    e.name === 'NativeError' && e.status === -2 &&
    e.message === 'sk_translate_complete: model is unloaded (status -2)');
});
