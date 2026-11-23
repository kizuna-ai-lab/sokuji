import { describe, expect, it, vi } from 'vitest';
import type { NativeReadinessInput } from '../../lib/local-inference/native/nativeCatalog';
import { fakeNativeModels } from '../../lib/local-inference/native/nativeModels.testing';
import { checkLocalNative, NATIVE_READINESS_CODES } from './check';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

const pair = { source: 'ja', target: 'en' };

describe('checkLocalNative', () => {
  it('hands the gate the pair, its own selections, the legs as a mode, and never text-only (#578 ruling 16)', async () => {
    let seen: NativeReadinessInput | undefined;
    const nativeModels = fakeNativeModels({ ensureSelectionReady: async (read) => { seen = read(); return { ready: true, reason: 'ready', notes: [] }; } });
    const selections = { 'ja→en': { asr: { modelId: 'a' }, translation: { modelId: '' }, tts: { modelId: '' } } };
    await expect(checkLocalNative({ ...LOCAL_NATIVE_DEFAULTS, selections }, { pair, legs: ['participant'], nativeModels })).resolves.toEqual({ ok: true });
    expect(seen).toEqual({ selection: { sourceLanguage: 'ja', targetLanguage: 'en' }, selections, mode: 'participant', textOnly: false });
  });

  it('says why by a code for every reason (#578 ruling 5)', async () => {
    for (const [reason, code] of Object.entries(NATIVE_READINESS_CODES)) {
      const nativeModels = fakeNativeModels({ ensureSelectionReady: async () => ({ ready: false, reason: reason as never, notes: [] }) });
      const r = await checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'], nativeModels });
      expect(r, reason).toMatchObject({ ok: false, code });
      expect((r as { reason: string }).reason.length, reason).toBeGreaterThan(0);
    }
  });

  it("passes the start's signal to the gate", async () => {
    const ensureSelectionReady = vi.fn(async () => ({ ready: true as const, reason: 'ready' as const, notes: [] }));
    const signal = new AbortController().signal;
    await checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'], nativeModels: fakeNativeModels({ ensureSelectionReady }), signal });
    expect(ensureSelectionReady).toHaveBeenCalledWith(expect.any(Function), signal);
  });

  it("throws when not handed this device's native models", async () => {
    await expect(checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'] })).rejects.toThrow(/CheckContext\.nativeModels/);
  });
});
