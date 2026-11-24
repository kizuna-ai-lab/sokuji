/** Local Native's voice as a unit of its own: what it declares, the config it builds, and which configs it takes. */
import { describe, expect, it } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import { fakeNativeModels } from '../../lib/local-inference/native/nativeModels.testing';
import type { SharedSettings } from '../../lib/run/types';
import { createFakeNativeHost } from './fakeEngines';
import { LOCAL_NATIVE_DEFAULTS } from './settings';
import type { NativeVoiceConfig } from './speechSession';
import { admitNativeSpeech, areNativeSpeechConfigs, nativeSpeechUnit } from './speechUnit';

const JA_EN: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const resolved = (id: string | null, variant?: string) => (id ? { modelId: id, source: 'explicit' as const, ...(variant ? { variant } : {}) } : null);
const CATALOG = { 'tts-en': { id: 'tts-en', kind: 'tts', voice: { builtin: 'named', custom: 'clip' } } } as unknown as Record<string, NativeModelInfo>;
const facts = (tts: string | null = 'tts-en') => fakeNativeModels({
  resolve: () => ({ asr: null, translation: null, tts: resolved(tts, 'q8_0'), notes: [], prunes: [] }),
  catalog: () => CATALOG,
});
const shared = (over: Partial<SharedSettings> = {}): SharedSettings =>
  ({ pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 }, reversed: (d) => d.source === 'en', segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [], nativeModels: facts(), ...over });

describe("what Local Native's speech unit declares", () => {
  it('occupies speech alone, speaks optionally, and says no `speaks`', () => {
    const occupies = (stages: string[]) => nativeSpeechUnit.occupies(LOCAL_NATIVE_DEFAULTS, new Set(stages) as never);
    expect(occupies(['speech'])).toEqual(['speech']);
    expect(occupies(['translation', 'speech'])).toBeNull();
    const caps = nativeSpeechUnit.capabilities(LOCAL_NATIVE_DEFAULTS);
    expect(caps).toEqual({ speech: 'optional', turns: ['auto', 'manual'], turnOwner: 'either', boundaries: 'silence', textInput: false, faceToFace: false, participantSpeech: true });
    expect('speaks' in caps).toBe(false);
  });
});

describe('the config it builds', () => {
  it('a leg that does not speak is built silent', () => {
    expect(nativeSpeechUnit.build({ ...JA_EN, speech: false }, LOCAL_NATIVE_DEFAULTS, shared())).toEqual({ off: true });
  });

  it('a leg with no voice for its target is built silent, and says so when it opens', () => {
    expect(nativeSpeechUnit.build(JA_EN, LOCAL_NATIVE_DEFAULTS, shared({ nativeModels: facts(null) }))).toEqual({ off: true, unavailable: 'speaker_tts_missing' });
    const reverse = { ...JA_EN, direction: { source: 'en', target: 'ja' } };
    expect(nativeSpeechUnit.build(reverse, LOCAL_NATIVE_DEFAULTS, shared({ nativeModels: facts(null) }))).toEqual({ off: true, unavailable: 'participant_tts_missing' });
  });

  it("resolves the voice with its device, speed, voice and the catalog's capability", () => {
    const s = shared();
    const c = nativeSpeechUnit.build(JA_EN, { ...LOCAL_NATIVE_DEFAULTS, ttsDevice: 'gpu', ttsSpeed: 1.2, ttsVoice: 'builtin:Bella' }, s) as NativeVoiceConfig;
    expect(c).toEqual({ modelId: 'tts-en', variant: 'q8_0', device: 'gpu', speed: 1.2, voice: 'builtin:Bella', capability: expect.objectContaining({ builtin: 'named', custom: 'clip' }), host: s.nativeModels });
    expect(nativeSpeechUnit.describe(c)).toEqual({ ttsModel: 'tts-en' });
    expect(nativeSpeechUnit.describe({ off: true })).toEqual({});
  });
});

describe('admission', () => {
  const voice = (): NativeVoiceConfig => ({ modelId: 'tts-en', device: 'auto', speed: 1, voice: '', capability: null, host: createFakeNativeHost() });
  it("areNativeSpeechConfigs takes this unit's configs and no other unit's", () => {
    expect(areNativeSpeechConfigs({ speaker: voice() })).toBe(true);
    expect(areNativeSpeechConfigs({ speaker: { off: true } })).toBe(true);
    expect(areNativeSpeechConfigs({ speaker: { asr: {}, speed: 1, voice: '' } as never })).toBe(false);
    expect(areNativeSpeechConfigs({ speaker: { modelId: 'mt-a', instructions: '', coLoaded: {} } as never })).toBe(false);
    expect(areNativeSpeechConfigs({})).toBe(false);
  });

  it('refuses two legs and admits one', () => {
    expect(admitNativeSpeech({ speaker: voice() })).toBe(true);
    expect(admitNativeSpeech({ speaker: voice(), participant: voice() })).toEqual({ refused: "Local Native's voice reads one side at a time: choose Me or Other." });
  });
});
