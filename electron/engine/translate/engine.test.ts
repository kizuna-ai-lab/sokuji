// @vitest-environment node
/** The translation engine (ported from sidecar/tests/test_translate_engine.py): init through the resolver, the generation, delegation. */
import '../test/env';
import { afterEach, describe, expect, it } from 'vitest';
import type { Plan } from '../planner';
import { TranslateEngine, engineSeams, restoreEngineSeams, type TranslateBackendLike } from './engine';

const plan = (backend: string, device: string, computeType: string) => ({ backend, tier: device, device, computeType, artifact: 'x', rank: 1 } as unknown as Plan);

class RecordingBackend implements TranslateBackendLike {
  calls: unknown[][] = [];
  unloads = 0;
  cancels = 0;
  answer: [string, number] = ['hola->hi', 5];
  async translate(...args: unknown[]) {
    this.calls.push(args);
    const opts = args[4] as { onPartial?: (t: string) => void } | undefined;
    opts?.onPartial?.('Bon');
    opts?.onPartial?.('Bonjour.');
    return this.answer;
  }
  cancel() { this.cancels++; }
  async unload() { this.unloads++; }
}

const stub = (backends: RecordingBackend[], p = plan('native_translate', 'vulkan', 'q8_0'), notice: string | null = null, mem: number | null = null) => {
  engineSeams.resolveTranslate = async () => [p];
  engineSeams.loadMeasured = async () => [backends.shift()!, p, notice, mem];
  engineSeams.measureTps = async () => null;
};

afterEach(() => restoreEngineSeams());

describe('init', () => {
  it('loads through the resolver, records the plan, and translates with the languages', async () => {
    const b = new RecordingBackend();
    stub([b]);
    const eng = new TranslateEngine();
    await eng.init('qwen2.5-0.5b', 'ja', 'en', 'vulkan');
    expect(eng.resolved).toEqual({ backend: 'native_translate', device: 'vulkan', computeType: 'q8_0' });
    expect(eng.backend).toBe(b);
    const [out, ms] = await eng.translate('hola', '', true);
    expect(b.calls[0].slice(0, 4)).toEqual(['hola', '', 'ja', 'en']);
    expect((b.calls[0][4] as { wrap: boolean }).wrap).toBe(true);
    expect([out, ms >= 0]).toEqual(['hola->hi', true]);
  });

  it('frees the prior backend before loading the next', async () => {
    const [first, second] = [new RecordingBackend(), new RecordingBackend()];
    stub([first, second], plan('native_translate', 'cpu', 'float32'));
    const eng = new TranslateEngine();
    await eng.init('qwen2.5-0.5b', 'ja', 'en');
    await eng.init('qwen3-0.6b', 'ja', 'en');
    expect([first.unloads, eng.backend === second]).toEqual([1, true]);
  });

  it('the generation goes up with every init', async () => {
    stub([new RecordingBackend(), new RecordingBackend()]);
    const eng = new TranslateEngine();
    expect(eng.generation).toBe(0);
    await eng.init('qwen2.5-0.5b', 'ja', 'en');
    expect(eng.generation).toBe(1);
    await eng.init('qwen3-0.6b', 'ja', 'en');
    expect(eng.generation).toBe(2);
  });

  it('keeps the measured memory, the fallback reason and the tokens/s', async () => {
    stub([new RecordingBackend()], plan('native_translate', 'cpu', 'float32'), 'vulkan skipped (needs ~6.1 GiB, 2.1 GiB free); using CPU', 4_200_000_000);
    engineSeams.measureTps = async () => 41.27;
    const eng = new TranslateEngine();
    await eng.init('qwen3.5-2b', 'ja', 'en');
    expect(eng.resolved!.memoryBytes).toBe(4_200_000_000);
    expect(String(eng.resolved!.fallbackReason)).toContain('using CPU');
    expect(eng.resolved!.tokensPerSec).toBe(41.3);
  });
});

describe('translate', () => {
  it('delegates to the backend with the session languages', async () => {
    const eng = new TranslateEngine();
    const b = new RecordingBackend();
    b.answer = ['translated', 5];
    eng.backend = b;
    eng.src = 'Japanese';
    eng.tgt = 'English';
    const [out] = await eng.translate('hello', '', true);
    expect(b.calls[0].slice(0, 4)).toEqual(['hello', '', 'Japanese', 'English']);
    expect(out).toBe('translated');
  });

  it('passes onPartial through, every piece in order', async () => {
    const eng = new TranslateEngine();
    eng.backend = new RecordingBackend();
    const seen: string[] = [];
    await eng.translate('hello', '', false, { onPartial: (t) => seen.push(t) });
    expect(seen).toEqual(['Bon', 'Bonjour.']);
  });

  it('blank text is answered without the backend', async () => {
    const eng = new TranslateEngine();
    const b = new RecordingBackend();
    eng.backend = b;
    expect(await eng.translate('  \n')).toEqual(['', 0]);
    expect(b.calls).toEqual([]);
  });

  it('cancelActive reaches the backend; with nothing loaded it does nothing', () => {
    const eng = new TranslateEngine();
    eng.cancelActive();
    const b = new RecordingBackend();
    eng.backend = b;
    eng.cancelActive();
    expect(b.cancels).toBe(1);
  });
});

describe.skipIf(!process.env.SOKUJI_RUN_TRANSLATE_MODEL || !process.env.SOKUJI_NATIVE_DIR)('a real model', () => {
  it.each(['qwen3-0.6b', 'hy-mt2-1.8b', 'translategemma-4b'])('%s translates one sentence, with no think block', async (modelId) => {
    const { loadNative, useNative } = await import('../native');
    process.env.HF_HOME = process.env.SOKUJI_REAL_HF_HOME ?? `${process.env.HOME}/.cache/huggingface`;
    useNative(loadNative(process.env.SOKUJI_NATIVE_DIR!), process.env.SOKUJI_NATIVE_DIR!);
    const eng = new TranslateEngine();
    await eng.init(modelId, 'Spanish', 'English');
    const [out, ms] = await eng.translate('Hola, ¿cómo estás?');
    expect(out.length).toBeGreaterThan(0);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(out).not.toContain('<think>');
    await eng.close();
  });
});
