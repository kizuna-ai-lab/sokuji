import { describe, it, expect, vi } from 'vitest';

class FakeTensor {
  constructor(public type: string, public data: unknown, public dims: number[]) {}
}

describe('pocketInferenceCore DI seam', () => {
  it('resampleTo24k: identity at 24kHz, length-scales otherwise', async () => {
    const { resampleTo24k } = await import('./pocketInferenceCore');
    const a = new Float32Array([0, 1, 0, -1]);
    expect(resampleTo24k(a, 24000)).toBe(a);
    expect(resampleTo24k(a, 12000).length).toBe(8);
  });

  it('parseNpyFloat32 reads a v1.0 little-endian float32 npy', async () => {
    const { parseNpyFloat32 } = await import('./pocketInferenceCore');
    const header = "{'descr': '<f4', 'fortran_order': False, 'shape': (2,),  }"; // padded to align data at 4-byte boundary
    const buf = new ArrayBuffer(10 + header.length + 8);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    u8.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59], 0); // \x93NUMPY
    dv.setUint8(6, 1); dv.setUint8(7, 0);
    dv.setUint16(8, header.length, true);
    for (let i = 0; i < header.length; i++) u8[10 + i] = header.charCodeAt(i);
    new Float32Array(buf, 10 + header.length, 2).set([1.5, -2.25]);
    expect(Array.from(parseNpyFloat32(buf))).toEqual([1.5, -2.25]);
  });

  it('throws a clear error if Tensor is not injected', async () => {
    vi.resetModules();
    const core = await import('./pocketInferenceCore');
    const meta = {
      flow_lm_state_manifest: [{ input_name: 's_in', output_name: 's_out', dtype: 'float32', shape: [1, 2], fill: 'zeros' }],
      mimi_state_manifest: [], latent_dim: 32,
    } as never;
    const fakeSession = { outputNames: ['o'], run: async () => ({}) };
    const sessions = { flowLmMain: fakeSession } as never;
    const voiceEmb = new FakeTensor('float32', new Float32Array(32), [1, 1, 32]) as never;
    await expect(core.buildVoiceConditionedState(sessions, meta, voiceEmb, null))
      .rejects.toThrow(/Tensor not injected/);
  });

  it('uses the injected Tensor ctor and threads manifest state', async () => {
    vi.resetModules();
    const core = await import('./pocketInferenceCore');
    core.setPocketTensor(FakeTensor as never);
    const meta = {
      flow_lm_state_manifest: [{ input_name: 's_in', output_name: 's_out', dtype: 'float32', shape: [1, 2], fill: 'zeros' }],
      mimi_state_manifest: [], latent_dim: 32,
    } as never;
    const sOut = new FakeTensor('float32', new Float32Array([9, 9]), [1, 2]);
    const flowLmMain = { outputNames: ['s_out'], run: async () => ({ s_out: sOut }) };
    const sessions = { flowLmMain } as never;
    const voiceEmb = new FakeTensor('float32', new Float32Array(32), [1, 1, 32]) as never;
    const state = await core.buildVoiceConditionedState(sessions, meta, voiceEmb, null);
    expect(state['s_in']).toBe(sOut);
  });
});
