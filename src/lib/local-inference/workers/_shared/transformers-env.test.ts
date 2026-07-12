import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initTransformersEnv } from './transformers-env';

function fakeEnv(withWasm = true) {
  return {
    backends: withWasm ? { onnx: { wasm: {} as Record<string, unknown> } } : {},
    allowRemoteModels: undefined as unknown,
    allowLocalModels: undefined as unknown,
    useBrowserCache: undefined as unknown,
    useCustomCache: undefined as unknown,
    customCache: undefined as unknown,
  };
}

describe('initTransformersEnv', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('sets the four transformers.js flags and a customCache bridge', () => {
    const env = fakeEnv();
    initTransformersEnv(env, { fileUrls: { 'config.json': 'blob:x' } });
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.useBrowserCache).toBe(false);
    expect(env.useCustomCache).toBe(true);
    expect(typeof (env.customCache as { match?: unknown }).match).toBe('function');
  });

  it('disables the wasm proxy when the backend exists', () => {
    const env = fakeEnv();
    initTransformersEnv(env, { fileUrls: {} });
    expect((env.backends as { onnx: { wasm: { proxy?: boolean } } }).onnx.wasm.proxy).toBe(false);
  });

  it('sets wasmPaths only when ortWasmBaseUrl is provided', () => {
    const a = fakeEnv();
    initTransformersEnv(a, { fileUrls: {}, ortWasmBaseUrl: 'https://host/wasm/ort/' });
    expect((a.backends as { onnx: { wasm: { wasmPaths?: string } } }).onnx.wasm.wasmPaths).toBe('https://host/wasm/ort/');

    const b = fakeEnv();
    initTransformersEnv(b, { fileUrls: {} });
    expect((b.backends as { onnx: { wasm: { wasmPaths?: string } } }).onnx.wasm.wasmPaths).toBeUndefined();
  });

  it('does not throw when the wasm backend is absent, still sets flags', () => {
    const env = fakeEnv(false);
    expect(() => initTransformersEnv(env, { fileUrls: {}, ortWasmBaseUrl: 'x' })).not.toThrow();
    expect(env.useCustomCache).toBe(true);
  });
});
