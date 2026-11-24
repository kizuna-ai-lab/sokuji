import { describe, expect, it, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  ensure: vi.fn(),
  resolve: vi.fn(),
  listVoices: vi.fn(),
  hardware: vi.fn(),
  voiceStoreFor: vi.fn(),
}));
vi.mock('./nativeModelStore', async () => {
  const { create } = await import('zustand');
  const useNativeModelStore = create(() => ({
    sidecarStatus: 'idle' as string,
    bundleStatus: 'unknown' as string,
    catalog: {} as Record<string, unknown>,
    statuses: {} as Record<string, string>,
    sizes: {} as Record<string, number>,
    asrResolved: null as unknown,
    translationResolved: null as unknown,
    ttsResolved: null as unknown,
    ensureSelectionReady: (read: () => unknown) => fake.ensure(read),
    resolve: (src: string, tgt: string, selections: unknown) => fake.resolve(src, tgt, selections),
    setAsrResolved: (r: unknown) => useNativeModelStore.setState({ asrResolved: r }),
    setTranslationResolved: (r: unknown) => useNativeModelStore.setState({ translationResolved: r }),
    setTtsResolved: (r: unknown) => useNativeModelStore.setState({ ttsResolved: r }),
  }));
  return {
    useNativeModelStore,
    nativeListTtsVoices: (model: string) => fake.listVoices(model),
    nativeHardwareInfo: () => fake.hardware(),
  };
});
vi.mock('../lib/local-inference/native/nativeVoiceStores', () => ({
  voiceStoreFor: (custom: string, modelId: string) => fake.voiceStoreFor(custom, modelId),
}));

import { useNativeModelStore, type NativeModelStatus } from './nativeModelStore';
import { nativeModels, nativeReadinessKey } from './nativeModels';
import type { NativeReadinessInput } from '../lib/local-inference/native/nativeCatalog';

const INPUT: NativeReadinessInput = {
  selection: { sourceLanguage: 'ja', targetLanguage: 'en' }, selections: {}, mode: 'speaker', textOnly: false,
};

beforeEach(() => {
  for (const f of Object.values(fake)) f.mockReset();
  useNativeModelStore.setState({ sidecarStatus: 'ready', bundleStatus: 'ready', catalog: {}, statuses: {}, sizes: {}, asrResolved: null, translationResolved: null, ttsResolved: null });
});

describe('nativeModels', () => {
  it('resolve, catalog and sizes read the native model store when asked', () => {
    const result = { asr: null, translation: null, tts: null, notes: [], prunes: [] };
    fake.resolve.mockReturnValue(result);
    useNativeModelStore.setState({ catalog: { a: { id: 'a' } } as never, sizes: { a: 42 } });
    const selections = { 'ja→en': {} } as never;
    expect(nativeModels.resolve('ja', 'en', selections)).toBe(result);
    expect(fake.resolve).toHaveBeenCalledWith('ja', 'en', selections);
    expect(nativeModels.catalog()).toEqual({ a: { id: 'a' } });
    expect(nativeModels.sizes()).toEqual({ a: 42 });
    // Read when asked, not when the port was made.
    useNativeModelStore.setState({ sizes: { a: 43 } });
    expect(nativeModels.sizes()).toEqual({ a: 43 });
  });

  it('ensureSelectionReady hands the store the caller\'s input, and rejects with the abort reason when the signal fires first', async () => {
    fake.ensure.mockImplementation(async (read: () => NativeReadinessInput) => ({ ready: true, reason: 'ready', notes: [], seen: read() }));
    const read = () => INPUT;
    await expect(nativeModels.ensureSelectionReady(read)).resolves.toMatchObject({ ready: true, seen: INPUT });
    fake.ensure.mockReturnValue(new Promise(() => {}));
    const ac = new AbortController();
    const checking = nativeModels.ensureSelectionReady(read, ac.signal);
    ac.abort(new Error('cancelled'));
    await expect(checking).rejects.toThrow('cancelled');
    const gone = new AbortController();
    gone.abort(new Error('already'));
    await expect(nativeModels.ensureSelectionReady(read, gone.signal)).rejects.toThrow('already');
  });

  it("files each stage's plan where the library's badges read it (#578 ruling 14)", () => {
    nativeModels.plan('asr', { model: 'asr-a', device: 'vulkan', backend: 'ggml', rtf: 0.2 });
    nativeModels.plan('translation', { model: 'mt-a', device: 'cpu', tokensPerSec: 30, fallbackReason: 'vram' });
    nativeModels.plan('tts', { model: 'tts-a', device: 'cpu' });
    const s = useNativeModelStore.getState();
    expect(s.asrResolved).toMatchObject({ model: 'asr-a', device: 'vulkan', backend: 'ggml', rtf: 0.2 });
    expect(s.translationResolved).toMatchObject({ model: 'mt-a', device: 'cpu', tokensPerSec: 30, fallbackReason: 'vram' });
    expect(s.ttsResolved).toMatchObject({ model: 'tts-a', device: 'cpu' });
  });

  it('listVoices, voiceStore and hardware reach the store\'s management socket and the clip stores', async () => {
    const voices = [{ id: 'alba', name: 'Alba' }];
    const store = { list: vi.fn(), resolveApply: vi.fn() };
    const hw = { type: 'hardware_info_result' };
    fake.listVoices.mockResolvedValue(voices);
    fake.voiceStoreFor.mockReturnValue(store);
    fake.hardware.mockResolvedValue(hw);
    await expect(nativeModels.listVoices('pocket-tts-en')).resolves.toBe(voices);
    expect(fake.listVoices).toHaveBeenCalledWith('pocket-tts-en');
    expect(nativeModels.voiceStore('clip', 'qwen3-tts-0.6b')).toBe(store);
    expect(fake.voiceStoreFor).toHaveBeenCalledWith('clip', 'qwen3-tts-0.6b');
    await expect(nativeModels.hardware()).resolves.toBe(hw);
  });
});

describe('nativeReadinessKey', () => {
  it('reads a running download as absent: its start re-checks nothing, its completion does (#578)', () => {
    const keyWith = (status: NativeModelStatus) =>
      nativeReadinessKey({ sidecarStatus: 'ready', bundleStatus: 'ready', catalog: {}, statuses: { 'asr-a': status } } as never);
    expect(keyWith('downloading')).toBe(keyWith('absent'));
    expect(keyWith('downloading')).not.toBe(keyWith('ready'));
  });
});

describe('nativeModels.watch', () => {
  it('calls back when what readiness reads changes', () => {
    const onChange = vi.fn();
    const off = nativeModels.watch(onChange);
    useNativeModelStore.setState({ statuses: { a: 'ready' } });
    useNativeModelStore.setState({ sidecarStatus: 'unavailable' });
    useNativeModelStore.setState({ bundleStatus: 'absent' });
    useNativeModelStore.setState({ catalog: { a: {} } } as never);
    expect(onChange).toHaveBeenCalledTimes(4);
    off();
    useNativeModelStore.setState({ statuses: { a: 'absent' } });
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('a refresh that changes nothing does not call back', () => {
    useNativeModelStore.setState({ statuses: { a: 'ready', b: 'absent' } });
    const onChange = vi.fn();
    const off = nativeModels.watch(onChange);
    // `refresh` always writes a new object; the same content must not re-check, or check → refresh → check loops.
    useNativeModelStore.setState({ statuses: { b: 'absent', a: 'ready' } });
    useNativeModelStore.setState({ sidecarStatus: 'ready' });
    expect(onChange).not.toHaveBeenCalled();
    off();
  });

  it('a start that fails ends where it began: no call back (#578)', () => {
    useNativeModelStore.setState({ sidecarStatus: 'unavailable', bundleStatus: 'mismatch' });
    const onChange = vi.fn();
    const off = nativeModels.watch(onChange);
    // A check's own engine start: what moves while it is starting is not a settled answer.
    useNativeModelStore.setState({ sidecarStatus: 'starting' });
    useNativeModelStore.setState({ bundleStatus: 'ready' });
    useNativeModelStore.setState({ bundleStatus: 'mismatch' });
    useNativeModelStore.setState({ sidecarStatus: 'unavailable' });
    expect(onChange).not.toHaveBeenCalled();
    off();
  });

  it('a start that succeeds calls back once, when the sidecar is ready', () => {
    useNativeModelStore.setState({ sidecarStatus: 'idle', bundleStatus: 'unknown' });
    const onChange = vi.fn();
    const off = nativeModels.watch(onChange);
    useNativeModelStore.setState({ sidecarStatus: 'starting' });
    useNativeModelStore.setState({ bundleStatus: 'ready' });
    expect(onChange).not.toHaveBeenCalled();
    useNativeModelStore.setState({ sidecarStatus: 'ready' });
    expect(onChange).toHaveBeenCalledTimes(1);
    off();
  });
});
