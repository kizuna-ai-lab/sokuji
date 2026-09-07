import { describe, it, expect, vi } from 'vitest';
import { needsShaderF16, bindCheckedWebGpuAdapter, acquireWebGpuAdapter } from './shaderF16Gate';

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
    await expect(bindCheckedWebGpuAdapter(undefined, 'q4f16', 'Cohere Transcribe', adapterWith()))
      .rejects.toThrow(/does not support the WebGPU "shader-f16" feature/);
  });

  it('names the model, so the message is actionable without the stack', async () => {
    await expect(bindCheckedWebGpuAdapter(undefined, 'q4f16', 'Cohere Transcribe', adapterWith()))
      .rejects.toThrow(/Cohere Transcribe/);
  });

  it('allows an f16 variant when the adapter offers the feature', async () => {
    await expect(bindCheckedWebGpuAdapter(undefined, 'q4f16', 'Voxtral', adapterWith('shader-f16')))
      .resolves.toBeUndefined();
  });

  it('never blocks a non-f16 variant, whatever the adapter says', async () => {
    await expect(bindCheckedWebGpuAdapter(undefined, 'q4', 'Voxtral', adapterWith())).resolves.toBeUndefined();
  });

  // The gate exists to make one specific failure legible. It must not become a
  // second, worse way to report "no GPU here" — that has its own path.
  it('stays out of the way when there is no WebGPU at all', async () => {
    await expect(bindCheckedWebGpuAdapter(undefined, 'q4f16', 'Voxtral', undefined)).resolves.toBeUndefined();
  });

  it('stays out of the way when no adapter is returned', async () => {
    await expect(bindCheckedWebGpuAdapter(undefined, 'q4f16', 'Voxtral', { requestAdapter: async () => null }))
      .resolves.toBeUndefined();
  });

  it('stays out of the way when requesting an adapter throws', async () => {
    await expect(bindCheckedWebGpuAdapter(undefined, 'q4f16', 'Voxtral', {
      requestAdapter: async () => { throw new Error('device lost'); },
    })).resolves.toBeUndefined();
  });
});

describe('bindCheckedWebGpuAdapter — binding the runtime to the checked adapter', () => {
  const gpuOf = (adapter: any) => ({ requestAdapter: vi.fn().mockResolvedValue(adapter) });
  const withF16 = () => ({ id: 'A', features: { has: (n: string) => n === 'shader-f16' } });
  const withoutF16 = () => ({ id: 'B', features: { has: () => false } });

  it('hands the runtime the very adapter it checked', async () => {
    const adapter = withF16();
    const env: any = { webgpu: {} };
    await bindCheckedWebGpuAdapter(env, 'q4f16', 'Voxtral', gpuOf(adapter));
    // Identity, not equality: the whole point is that no second request can
    // slip a different GPU between the check and the device.
    expect(env.webgpu.adapter).toBe(adapter);
  });

  it('binds even when the dtype needs no f16, so the gate is sound next time', async () => {
    const adapter = withoutF16();
    const env: any = { webgpu: {} };
    await bindCheckedWebGpuAdapter(env, 'q4', 'Voxtral', gpuOf(adapter));
    expect(env.webgpu.adapter).toBe(adapter);
  });

  it('requests one adapter, not one per concern', async () => {
    const gpu = gpuOf(withF16());
    await bindCheckedWebGpuAdapter({ webgpu: {} } as any, 'q4f16', 'Voxtral', gpu);
    expect(gpu.requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('reuses an adapter the runtime already holds instead of requesting another', async () => {
    // Setting `adapter` only has effect before the first session, so once one
    // is there it is what the runtime will use — check THAT, not a fresh one.
    const bound = withoutF16();
    const gpu = gpuOf(withF16());
    const env: any = { webgpu: { adapter: bound } };
    await expect(bindCheckedWebGpuAdapter(env, 'q4f16', 'Voxtral', gpu))
      .rejects.toThrow(/shader-f16/);
    expect(gpu.requestAdapter).not.toHaveBeenCalled();
    expect(env.webgpu.adapter).toBe(bound);
  });

  it('still refuses an f16 variant when the bound adapter lacks the feature', async () => {
    const env: any = { webgpu: {} };
    await expect(bindCheckedWebGpuAdapter(env, 'q4f16', 'Cohere Transcribe', gpuOf(withoutF16())))
      .rejects.toThrow(/Cohere Transcribe/);
  });

  it('survives a runtime env that exposes no webgpu section', async () => {
    // transformers.js types `backends.onnx` as Partial<Env>, so `webgpu` can be
    // absent. Degrade to checking without binding rather than throwing.
    const adapter = withoutF16();
    await expect(bindCheckedWebGpuAdapter({} as any, 'q4f16', 'Voxtral', gpuOf(adapter)))
      .rejects.toThrow(/shader-f16/);
    await expect(bindCheckedWebGpuAdapter(undefined, 'q4', 'Voxtral', gpuOf(adapter)))
      .resolves.toBeUndefined();
  });

  it('binds nothing and throws nothing when there is no adapter to be had', async () => {
    const env: any = { webgpu: {} };
    await expect(bindCheckedWebGpuAdapter(env, 'q4f16', 'Voxtral', { requestAdapter: async () => null }))
      .resolves.toBeUndefined();
    expect(env.webgpu.adapter).toBeUndefined();

    const env2: any = { webgpu: {} };
    await expect(bindCheckedWebGpuAdapter(env2, 'q4f16', 'Voxtral', undefined))
      .resolves.toBeUndefined();
    expect(env2.webgpu.adapter).toBeUndefined();
  });

  it('binds nothing when requesting an adapter throws', async () => {
    const env: any = { webgpu: {} };
    await expect(bindCheckedWebGpuAdapter(env, 'q4f16', 'Voxtral', {
      requestAdapter: async () => { throw new Error('device lost'); },
    })).resolves.toBeUndefined();
    expect(env.webgpu.adapter).toBeUndefined();
  });
});

describe('acquireWebGpuAdapter — one question, one answer', () => {
  const gpuOf = (...answers: any[]) => {
    const fn = vi.fn();
    answers.forEach(a => (a instanceof Error ? fn.mockRejectedValueOnce(a) : fn.mockResolvedValueOnce(a)));
    return { requestAdapter: fn };
  };
  const withF16 = () => ({ id: 'A', features: { has: (n: string) => n === 'shader-f16' } });

  it('remembers the adapter on the runtime env', async () => {
    const adapter = withF16();
    const env: any = { webgpu: {} };
    expect(await acquireWebGpuAdapter(env, gpuOf(adapter))).toBe(adapter);
    expect(env.webgpu.adapter).toBe(adapter);
  });

  it('asks once however many times it is called', async () => {
    const gpu = gpuOf(withF16(), withF16());
    const env: any = { webgpu: {} };
    const first = await acquireWebGpuAdapter(env, gpu);
    const second = await acquireWebGpuAdapter(env, gpu);
    expect(second).toBe(first);
    expect(gpu.requestAdapter).toHaveBeenCalledTimes(1);
  });

  // The regression this exists for: whisper decided `device = 'webgpu'` from
  // its OWN adapter request, then the gate requested a second one. A second
  // request coming back empty made the gate return silently while the model
  // loaded on the GPU anyway, unchecked. Sharing the acquisition removes the
  // second request, so the empty answer can no longer happen between them.
  it('leaves no second request to fail between the availability check and the gate', async () => {
    const gpu = gpuOf(withF16(), null);          // a second call would answer null
    const env: any = { webgpu: {} };

    const available = !!(await acquireWebGpuAdapter(env, gpu));
    expect(available).toBe(true);

    await bindCheckedWebGpuAdapter(env, 'q4f16', 'Whisper', gpu);
    expect(gpu.requestAdapter).toHaveBeenCalledTimes(1);
  });

  it('reports no GPU without remembering anything', async () => {
    const env: any = { webgpu: {} };
    expect(await acquireWebGpuAdapter(env, { requestAdapter: async () => null })).toBeNull();
    expect(await acquireWebGpuAdapter(env, undefined)).toBeNull();
    expect(await acquireWebGpuAdapter(env, { requestAdapter: async () => { throw new Error('lost'); } })).toBeNull();
    expect(env.webgpu.adapter).toBeUndefined();
  });
});
