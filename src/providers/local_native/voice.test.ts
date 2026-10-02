import { describe, expect, it, vi } from 'vitest';
import type { NativeVoiceStore } from '../../lib/local-inference/native/nativeVoiceStores';
import type { NativeHost } from './host';
import type { LocalNativeConfig } from './config';
import type { NativeTtsLike, NativeTtsReady } from './engines';
import { applyVoice, voiceClipMissing } from './voice';

type TtsConfig = NonNullable<LocalNativeConfig['tts']>;
const tts = (over: Partial<TtsConfig> = {}): TtsConfig => ({ modelId: 'tts-a', device: 'auto', speed: 1, voice: '', capability: null, ...over });
const ready = (over: Partial<NativeTtsReady> = {}): NativeTtsReady => ({ sampleRate: 24000, streaming: false, clones: false, ...over });

function store(clips: Array<{ id: number; hasTranscript?: boolean }>, failList = false): NativeVoiceStore {
  return {
    kind: 'clip',
    capability: {} as NativeVoiceStore['capability'],
    list: vi.fn(async () => { if (failList) throw new Error('idb'); return clips.map((c) => ({ name: `clip ${c.id}`, ...c })); }),
    onImport: vi.fn(), rename: vi.fn(), delete: vi.fn(),
    resolveApply: vi.fn(async (id: number) => ({ kind: 'clip' as const, audio: new Float32Array([id]), sampleRate: 24000, transcript: `t${id}` })),
  };
}
function host(over: Partial<NativeHost> = {}): NativeHost {
  return { listVoices: vi.fn(async () => []), voiceStore: vi.fn(() => null), hardware: vi.fn(async () => null), plan: vi.fn(), ...over };
}
function engine(): NativeTtsLike & { setVoice: ReturnType<typeof vi.fn>; setReferenceVoice: ReturnType<typeof vi.fn> } {
  return {
    init: vi.fn(), generate: vi.fn(), dispose: vi.fn(), onError: null, onClosed: null,
    setVoice: vi.fn(async () => {}), setReferenceVoice: vi.fn(async () => {}),
  } as never;
}
const cloneOnly = { builtin: 'none' as const, custom: 'clip' as const, required: true };

describe('voiceClipMissing', () => {
  it('a clone-only model with no usable clip cannot speak', async () => {
    expect(await voiceClipMissing(tts({ capability: cloneOnly }), host({ voiceStore: () => store([]) }))).toBe(true);
    expect(await voiceClipMissing(tts({ capability: { ...cloneOnly, transcriptRequired: true } }), host({ voiceStore: () => store([{ id: 1 }]) }))).toBe(true);
    expect(await voiceClipMissing(tts({ capability: cloneOnly }), host({ voiceStore: () => store([], true) }))).toBe(true);
  });
  it('a clip, a model that speaks unset, or an unknown capability is not gated', async () => {
    expect(await voiceClipMissing(tts({ capability: cloneOnly }), host({ voiceStore: () => store([{ id: 1 }]) }))).toBe(false);
    expect(await voiceClipMissing(tts({ capability: { builtin: 'named', custom: 'clip', required: false } }), host())).toBe(false);
    expect(await voiceClipMissing(tts({ capability: null }), host())).toBe(false);
  });
});

describe('applyVoice', () => {
  it('applies a stored built-in voice the model lists', async () => {
    const e = engine();
    const voices = [{ name: 'Bella', language: 'en', curated: true, unstable: false, default: false }];
    const r = await applyVoice(e, tts({ voice: 'builtin:Bella', capability: { builtin: 'named', custom: 'none' } }), 'en', ready(), host({ listVoices: async () => voices }));
    expect(e.setVoice).toHaveBeenCalledWith('Bella');
    expect(r).toEqual({ voice: 'builtin:Bella' });
  });

  it('applies a stored custom clip by its reference audio and transcript', async () => {
    const e = engine();
    const r = await applyVoice(e, tts({ voice: 'custom:3', capability: cloneOnly }), 'en', ready(), host({ voiceStore: () => store([{ id: 3 }]) }));
    expect(e.setReferenceVoice).toHaveBeenCalledWith(new Float32Array([3]), 24000, 't3');
    expect(r).toEqual({ voice: 'custom:3' });
  });

  it('a custom clip no longer usable is substituted, and says so (R35)', async () => {
    const e = engine();
    const r = await applyVoice(e, tts({ voice: 'custom:9', capability: cloneOnly }), 'en', ready(), host({ voiceStore: () => store([{ id: 3 }]) }));
    expect(r).toEqual({ voice: 'custom:3', substituted: { from: '9', to: '3' } });
  });

  it('with no catalog entry, reads the init reply\'s clones', async () => {
    const listVoices = vi.fn(async () => []);
    await applyVoice(engine(), tts({ capability: null }), 'en', ready({ clones: true }), host({ listVoices }));
    expect(listVoices).toHaveBeenCalledWith('tts-a');
  });
});
