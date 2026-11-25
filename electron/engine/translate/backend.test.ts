// @vitest-environment node
/**
 * The translation backend (ported from sidecar/tests/test_translate_backend.py) over the fake addon: prompt dispatch,
 * streaming partials, the chatml fallback, the explicit device, and cancellation — the caller's signal, cancel(), and
 * unload() waiting for the calls it aborted (bounded by its deadline).
 */
import '../test/env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackendLoadError, makeBackend } from '../backends';
import { setNativeForTests } from '../native';
import { makeFakeNative, type FakeNative, type FakeTranslateOptions } from '../test/fakeNative';
import { NativeTranslateBackend, backendTimings } from './backend';

let fake: FakeNative;
let dir: string;
let gguf: string;
const useFake = (o: FakeTranslateOptions = {}) => {
  fake = makeFakeNative({ devices: [{ kind: 'vulkan' }, { kind: 'cpu' }], translate: o });
  setNativeForTests(fake);
};
const cfg = (promptFamily = 'qwen', disableThinking = false, appendNoThink = false) => ({ promptFamily, disableThinking, appendNoThink });
const loaded = async (config = cfg(), o: FakeTranslateOptions = {}) => {
  useFake(o);
  const b = makeBackend('native_translate') as NativeTranslateBackend;
  await b.load(gguf, 'cpu', 'q8_0', config);
  return { b, t: fake.translators.at(-1)! };
};
const last = () => fake.translators.at(-1)!.log.at(-1) as unknown[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-backend-'));
  gguf = path.join(dir, 'w.gguf');
  fs.writeFileSync(gguf, 'GGUF');
  useFake();
});
afterEach(() => {
  backendTimings.unloadDeadlineMs = 10_000;
  setNativeForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('prompt dispatch', () => {
  it('qwen: plain system + user, no flags', async () => {
    const { b } = await loaded();
    expect(await b.translate('hello', '', 'English', 'Chinese')).toEqual(['Bonjour.', 3]);
    const [kind, messages, , prefill] = last() as [string, Array<{ role: string; content: string }>, number, string | null];
    expect(kind).toBe('chat');
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('You are a translator');
    expect(messages[0].content).not.toContain('/no_think');
    expect([messages[1].role, messages[1].content, prefill]).toEqual(['user', 'hello', null]);
    await b.unload();
    expect(b.isLoaded).toBe(false);
  });

  it('qwen3: thinking off and /no_think', async () => {
    const { b } = await loaded(cfg('qwen', true, true));
    await b.translate('hi', '', 'en', 'zh');
    const [, messages, , prefill] = last() as [string, Array<{ content: string }>, number, string];
    expect(messages[0].content).toContain('/no_think');
    expect(prefill).toBe('<think>\n\n</think>\n\n');
  });

  it('qwen3.5: thinking off without /no_think', async () => {
    const { b } = await loaded(cfg('qwen', true, false));
    await b.translate('hi', '', 'en', 'zh');
    const [, messages, , prefill] = last() as [string, Array<{ content: string }>, number, string];
    expect(messages[0].content).not.toContain('/no_think');
    expect(prefill).toBe('<think>\n\n</think>\n\n');
  });

  it('hunyuan: one user message', async () => {
    const { b } = await loaded(cfg('hunyuan'));
    await b.translate('bonjour', '', 'French', 'English', { wrap: true });
    const [kind, messages, , prefill] = last() as [string, Array<{ role: string; content: string }>, number, string | null];
    expect(kind).toBe('chat');
    expect(messages.map((m) => m.role)).toEqual(['user']);
    expect(messages[0].content).toContain('into English');
    expect(messages[0].content).toContain('<transcript>bonjour</transcript>');
    expect(prefill).toBeNull();
  });

  it('gemma: complete() with the rendered prompt, 256 tokens', async () => {
    const { b } = await loaded(cfg('gemma'));
    await b.translate('hello', 'ignored-system-prompt', 'en', 'ja');
    const [kind, prompt, maxTokens] = last() as [string, string, number];
    expect(kind).toBe('complete');
    expect(prompt).toContain('<start_of_turn>user');
    expect(prompt).toContain('professional English (en) to Japanese (ja) translator');
    expect(maxTokens).toBe(256);
  });

  it('an empty or unknown family takes the qwen shape', async () => {
    const { b } = await loaded(cfg('some-future-family'));
    await b.translate('hello', '', 'English', 'French');
    let [kind, messages] = last() as [string, Array<{ role: string; content: string }>];
    expect([kind, messages[0].role, messages[1].content]).toEqual(['chat', 'system', 'hello']);
    expect(messages[0].content).toContain('You are a translator');
    await b.load(gguf, 'cpu', 'q8_0');
    await b.translate('hi', '', 'English', 'French');
    [kind, messages] = last() as [string, Array<{ role: string; content: string }>];
    expect(kind).toBe('chat');
    expect(messages[0].content).toContain('You are a translator');
  });
});

describe('streaming', () => {
  it('each partial is the cleaned text so far', async () => {
    const { b } = await loaded();
    const seen: string[] = [];
    expect(await b.translate('hello', '', 'en', 'fr', { onPartial: (t) => seen.push(t) })).toEqual(['Bonjour.', 3]);
    expect(seen).toEqual(['Bon', 'Bonjour', 'Bonjour.']);
  });

  it('a partial consumer that throws costs one partial, not the translation', async () => {
    const { b } = await loaded();
    const seen: string[] = [];
    let calls = 0;
    const flaky = (t: string) => {
      calls++;
      if (calls === 2) throw new Error('consumer broke');
      seen.push(t);
    };
    expect(await b.translate('hello', '', 'en', 'fr', { onPartial: flaky })).toEqual(['Bonjour.', 3]);
    expect(seen).toEqual(['Bon', 'Bonjour.']);
  });

  it('assembles a character split across token pieces', async () => {
    const { b } = await loaded(cfg(), { pieces: [[0xe3, 0x81], [0x82], 'い'] });
    const seen: string[] = [];
    expect(await b.translate('a', '', 'en', 'ja', { onPartial: (t) => seen.push(t) })).toEqual(['あい', 2]);
    expect(seen).toEqual(['あ', 'あい']);                                   // never a replacement character
  });
});

describe('the chat template fallback', () => {
  const unsupported = 'sk_translate_chat: chat template not supported by the legacy formatter (status -1)';

  it("an unknown template falls back to a chatml prompt through complete()", async () => {
    const { b, t } = await loaded(cfg(), { chatError: unsupported });
    expect(await b.translate('hi', '', 'en', 'zh')).toEqual(['Oui.', 1]);
    const complete = t.log.find((e) => (e as unknown[])[0] === 'complete') as [string, string];
    expect(complete[1]).toContain('<|im_start|>user');
  });

  it('carries the prefill through', async () => {
    const { b, t } = await loaded(cfg('qwen', true, true), { chatError: unsupported });
    await b.translate('hi', '', 'en', 'zh');
    const complete = t.log.find((e) => (e as unknown[])[0] === 'complete') as [string, string];
    expect(complete[1].endsWith('<think>\n\n</think>\n\n')).toBe(true);
  });

  it('any other chat failure propagates, with no fallback', async () => {
    const { b, t } = await loaded(cfg(), { chatError: 'sk_translate_chat: some other native failure (status -1)' });
    await expect(b.translate('hi', '', 'en', 'zh')).rejects.toThrow(/some other native failure/);
    expect(t.log.some((e) => (e as unknown[])[0] === 'complete')).toBe(false);
  });
});

describe('loading', () => {
  it('a device kind this process lacks is a BackendLoadError', async () => {
    const b = makeBackend('native_translate') as NativeTranslateBackend;
    await expect(b.load(gguf, 'nope', 'q4_k_m', cfg())).rejects.toBeInstanceOf(BackendLoadError);
  });

  it('a CPU plan passes the explicit CPU device, never none', async () => {
    const { t } = await loaded();
    expect(t.deviceIndex).toBe(1);
  });

  it('a GGUF missing from the cache is a BackendLoadError', async () => {
    const b = makeBackend('native_translate') as NativeTranslateBackend;
    await expect(b.load('org/repo/missing.gguf', 'cpu', 'q8_0', cfg())).rejects.toThrow(/not in the model cache/);
  });

  it('the registry has native_translate and none of the llama-server backends', () => {
    expect(makeBackend('native_translate')).toBeInstanceOf(NativeTranslateBackend);
    expect(() => makeBackend('llamacpp_qwen')).toThrow(BackendLoadError);
  });
});

describe('cancellation', () => {
  it('unload aborts a call in flight and waits for it before freeing the model', async () => {
    const { b, t } = await loaded(cfg(), { gated: true });
    const call = b.translate('hello', '', 'en', 'fr');
    await t.started;
    let unloaded = false;
    const unload = b.unload().then(() => { unloaded = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(unloaded).toBe(false);                                         // waiting for the call
    expect(t.log.some((e) => String((e as unknown[])[0]).startsWith('unload'))).toBe(false);   // the model not even asked yet
    t.release();                                                          // the call sees its abort at the next token
    await unload;
    expect(await call).toEqual(['', 0]);                                  // cancelled before any token: empty, not thrown
    expect(t.log.at(-1)).toEqual(['unload']);
    expect(b.isLoaded).toBe(false);
  });

  it("unload waits out its deadline when a call never ends, and lets go of the model", async () => {
    backendTimings.unloadDeadlineMs = 300;
    const { b } = await loaded(cfg(), { wedged: true });
    void b.translate('hello', '', 'en', 'fr');
    await fake.translators[0].started;
    const t0 = Date.now();
    await b.unload();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3000);
    expect(b.isLoaded).toBe(false);
  });

  it("cancel() aborts the latest call, which answers with what it had", async () => {
    const { b, t } = await loaded(cfg(), { gated: true });
    const call = b.translate('hello', '', 'en', 'fr');
    await t.started;
    b.cancel();
    t.release();
    expect(await call).toEqual(['', 0]);
    expect(b.inFlight).toBe(0);
  });

  it("the caller's signal aborts its own call", async () => {
    const { b, t } = await loaded(cfg(), { gated: true });
    const controller = new AbortController();
    const call = b.translate('hello', '', 'en', 'fr', { signal: controller.signal });
    await t.started;
    controller.abort();
    t.release();
    expect(await call).toEqual(['', 0]);
    expect(b.isLoaded).toBe(true);                                        // a cancel is not an unload
  });

  it('cancel with nothing in flight is a no-op; a finished call leaves nothing behind', async () => {
    const { b } = await loaded();
    b.cancel();
    expect(await b.translate('hello', '', 'en', 'fr')).toEqual(['Bonjour.', 3]);
    expect(b.inFlight).toBe(0);
  });
});
