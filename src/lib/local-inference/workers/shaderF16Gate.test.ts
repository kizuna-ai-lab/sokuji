import { describe, it, expect } from 'vitest';
import { needsShaderF16, assertShaderF16Supported } from './shaderF16Gate';

const adapterWith = (...features: string[]) => ({
  requestAdapter: async () => ({ features: { has: (n: string) => features.includes(n) } }),
});

describe('needsShaderF16', () => {
  it('recognises the string dtypes the workers pass', () => {
    expect(needsShaderF16('q4f16')).toBe(true);
    expect(needsShaderF16('fp16')).toBe(true);
    expect(needsShaderF16('q4')).toBe(false);
    expect(needsShaderF16('int8')).toBe(false);
  });

  it('recognises a per-module record, since one f16 graph still needs the feature', () => {
    expect(needsShaderF16({ audio_encoder: 'fp16', decoder_model_merged: 'q4' })).toBe(true);
    expect(needsShaderF16({ audio_encoder: 'q4', decoder_model_merged: 'q4' })).toBe(false);
  });

  it('treats an absent dtype as not needing it', () => {
    expect(needsShaderF16(undefined)).toBe(false);
    expect(needsShaderF16(null)).toBe(false);
  });
});

describe('assertShaderF16Supported', () => {
  it('refuses an f16 variant when this worker\'s adapter lacks the feature', async () => {
    await expect(assertShaderF16Supported('q4f16', 'Cohere Transcribe', adapterWith()))
      .rejects.toThrow(/does not support the WebGPU "shader-f16" feature/);
  });

  it('names the model, so the message is actionable without the stack', async () => {
    await expect(assertShaderF16Supported('q4f16', 'Cohere Transcribe', adapterWith()))
      .rejects.toThrow(/Cohere Transcribe/);
  });

  it('allows an f16 variant when the adapter offers the feature', async () => {
    await expect(assertShaderF16Supported('q4f16', 'Voxtral', adapterWith('shader-f16')))
      .resolves.toBeUndefined();
  });

  it('never blocks a non-f16 variant, whatever the adapter says', async () => {
    await expect(assertShaderF16Supported('q4', 'Voxtral', adapterWith())).resolves.toBeUndefined();
  });

  // The gate exists to make one specific failure legible. It must not become a
  // second, worse way to report "no GPU here" — that has its own path.
  it('stays out of the way when there is no WebGPU at all', async () => {
    await expect(assertShaderF16Supported('q4f16', 'Voxtral', undefined)).resolves.toBeUndefined();
  });

  it('stays out of the way when no adapter is returned', async () => {
    await expect(assertShaderF16Supported('q4f16', 'Voxtral', { requestAdapter: async () => null }))
      .resolves.toBeUndefined();
  });

  it('stays out of the way when requesting an adapter throws', async () => {
    await expect(assertShaderF16Supported('q4f16', 'Voxtral', {
      requestAdapter: async () => { throw new Error('device lost'); },
    })).resolves.toBeUndefined();
  });
});
