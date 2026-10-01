import { describe, expect, it, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock('../../stores/nativeModelStore', async () => {
  const { create } = await import('zustand');
  const useNativeModelStore = create(() => ({
    sidecarStatus: 'idle' as string,
    bundleStatus: 'unknown' as string,
    catalog: {} as Record<string, unknown>,
    statuses: {} as Record<string, string>,
    ensureSelectionReady: (read: () => unknown) => fake.ensure(read),
  }));
  return { useNativeModelStore };
});

import { useNativeModelStore } from '../../stores/nativeModelStore';
import { checkLocalNative, NATIVE_READINESS_CODES, watchLocalNativeReadiness } from './check';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

const pair = { source: 'ja', target: 'en' };

beforeEach(() => {
  fake.ensure.mockReset();
  useNativeModelStore.setState({ sidecarStatus: 'ready', bundleStatus: 'ready', catalog: {}, statuses: {} });
});

describe('checkLocalNative', () => {
  it('hands the facade the pair, its own selections, the legs as a mode, and never text-only (#578 ruling 16)', async () => {
    let seen: unknown;
    fake.ensure.mockImplementation(async (read: () => unknown) => { seen = read(); return { ready: true, reason: 'ready', notes: [] }; });
    const selections = { 'ja→en': { asr: { modelId: 'a' }, translation: { modelId: '' }, tts: { modelId: '' } } };
    await expect(checkLocalNative({ ...LOCAL_NATIVE_DEFAULTS, selections }, { pair, legs: ['participant'] })).resolves.toEqual({ ok: true });
    expect(seen).toEqual({ selection: { sourceLanguage: 'ja', targetLanguage: 'en' }, selections, mode: 'participant', textOnly: false });
  });

  it('says why by a code for every reason (#578 ruling 5)', async () => {
    for (const [reason, code] of Object.entries(NATIVE_READINESS_CODES)) {
      fake.ensure.mockResolvedValueOnce({ ready: false, reason, notes: [] });
      const r = await checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'] });
      expect(r, reason).toMatchObject({ ok: false, code });
      expect((r as { reason: string }).reason.length, reason).toBeGreaterThan(0);
    }
  });

  it('rejects with the reason when the start that asked is cancelled', async () => {
    fake.ensure.mockReturnValue(new Promise(() => {}));
    const ac = new AbortController();
    const checking = checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'], signal: ac.signal });
    ac.abort(new Error('cancelled'));
    await expect(checking).rejects.toThrow('cancelled');
  });
});

describe('watchLocalNativeReadiness', () => {
  it('calls back when what readiness reads changes', () => {
    const onChange = vi.fn();
    const off = watchLocalNativeReadiness(onChange);
    useNativeModelStore.setState({ statuses: { a: 'ready' } });
    useNativeModelStore.setState({ sidecarStatus: 'unavailable' });
    useNativeModelStore.setState({ bundleStatus: 'absent' });
    useNativeModelStore.setState({ catalog: { a: {} } } as never);
    expect(onChange).toHaveBeenCalledTimes(4);
    off();
    useNativeModelStore.setState({ statuses: { a: 'absent' } });
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('a refresh that changes nothing does not call back (Review Focus 2)', () => {
    useNativeModelStore.setState({ statuses: { a: 'ready', b: 'absent' } });
    const onChange = vi.fn();
    const off = watchLocalNativeReadiness(onChange);
    // `refresh` always writes a new object; the same content must not re-check, or check → refresh → check loops.
    useNativeModelStore.setState({ statuses: { b: 'absent', a: 'ready' } });
    useNativeModelStore.setState({ sidecarStatus: 'ready' });
    expect(onChange).not.toHaveBeenCalled();
    off();
  });
});
