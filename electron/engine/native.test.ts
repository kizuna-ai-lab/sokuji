// @vitest-environment node
/** native.ts: the one module that touches the addon (ported from sidecar/tests/test_native.py), over the fake addon. */
import './test/env';
import { afterEach, describe, expect, it } from 'vitest';
import { BackendLoadError } from './backends';
import { deviceFor, devices, loadNative, module, setNativeForTests } from './native';
import { makeFakeNative } from './test/fakeNative';

afterEach(() => {
  delete process.env.SOKUJI_NATIVE_THREADS;
  setNativeForTests(null);
});

describe('native', () => {
  it('initialises the addon once, with the thread policy and a log sink', () => {
    process.env.SOKUJI_NATIVE_THREADS = '6';
    const fake = makeFakeNative({ devices: [{ kind: 'cpu', description: 'CPU' }] });
    setNativeForTests(fake);
    expect(module()).toBe(module());
    expect(fake.inits).toEqual([{ threads: 6, onLog: true }]);
  });

  it('deviceFor picks the first device of a kind, and names a kind it lacks', () => {
    setNativeForTests(makeFakeNative({ devices: [{ kind: 'vulkan', description: 'NVIDIA GB10', memTotal: 1 << 30, memFree: 1 << 29 }, { kind: 'cpu', description: 'CPU' }] }));
    expect(deviceFor('vulkan').description).toBe('NVIDIA GB10');
    expect(deviceFor('cpu').index).toBe(1);
    expect(() => deviceFor('metal')).toThrow(BackendLoadError);
    expect(() => deviceFor('metal')).toThrow('no metal device in this process');
    expect(devices().map((d) => d.kind)).toEqual(['vulkan', 'cpu']);
  });

  it('with no addon loaded, asking for it throws', () => {
    setNativeForTests(null);
    expect(() => module()).toThrow(/not loaded/);
  });

  it('loadNative names the file it could not load', () => {
    expect(() => loadNative('/nonexistent')).toThrow(/sokuji_native_node/);
  });
});
