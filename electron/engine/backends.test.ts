// @vitest-environment node
/** The backend registry and its shared result type (ported from sidecar/tests/test_backends.py). */
import './test/env';
import { describe, expect, it } from 'vitest';
import { AsrResult, BackendLoadError, makeBackend, registerBackend } from './backends';

describe('backends', () => {
  it('an unknown backend is a load error', () => {
    expect(() => makeBackend('nope')).toThrow(BackendLoadError);
    expect(() => makeBackend('nope')).toThrow('unknown backend: nope');
  });

  it('a registered backend is made by its name', async () => {
    class Dummy {
      static readonly NAME = 'dummy_test';
      readonly NAME = Dummy.NAME;
      loaded = false;
      async load(_ref: string, _device: string, _computeType: string) { this.loaded = true; }
      async transcribe(_samples: Float32Array, _language: string | null) { return new AsrResult('x'); }
      async unload() { this.loaded = false; }
      get isLoaded() { return this.loaded; }
    }
    registerBackend(Dummy);
    const b = makeBackend('dummy_test') as Dummy;
    expect(b.NAME).toBe('dummy_test');
    await b.load('m', 'cpu', 'int8');
    expect(b.isLoaded).toBe(true);
    expect((await b.transcribe(new Float32Array(4), null)).text).toBe('x');
  });

  it('an ASR result has no language unless given one', () => {
    const r = new AsrResult('hello');
    expect(r.text).toBe('hello');
    expect(r.language).toBeNull();
  });

  it('a load error keeps its reason', () => {
    const e = new BackendLoadError('no vulkan device in this process');
    expect(e.reason).toBe('no vulkan device in this process');
    expect(e.message).toBe('no vulkan device in this process');
    expect(e).toBeInstanceOf(Error);
  });
});
