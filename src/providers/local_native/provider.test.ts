import { describe, expect, it, vi } from 'vitest';
import { registerReleasedCatalog } from '../../lib/lineup/catalog.testing';
import { fakeNativeModels } from '../../lib/local-inference/native/nativeModels.testing';
import { fakeLocalModels } from '../../lib/local-inference/selection/localModels.testing';
import { compose } from '../../lib/plan/compose';
import { isRefusal, type RunPlan } from '../../lib/plan/types';
import { capabilitiesAlone } from '../../lib/plan/wholeUnit';
import { isPresent } from '../../lib/provider/presence';
import { LOCAL_NATIVE_DEBUG_KEY } from '../../utils/environment';
import type { LocalNativeConfig } from './config';
import { ONE_SIDE_AT_A_TIME } from './config';
import { createFakeNativeHost } from './fakeEngines';
import { localNativeProvider } from './provider';
import { LOCAL_NATIVE_DEFAULTS } from './settings';
import type { NativeSpeechConfig } from './speechSession';
import type { NativeTranslationConfig } from './translationSession';

registerReleasedCatalog();

const host = createFakeNativeHost();
/** One leg's config of each unit, told apart by shape alone. */
const WHOLE: LocalNativeConfig = {
  asr: { modelId: 'asr-a', device: 'auto' },
  vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 },
  limit: { maxSpeechSeconds: 19 },
  translation: { modelId: 'mt-a', device: 'auto', instructions: '', wrapTranscript: true },
  asrFirst: true,
  host,
};
const TRANSCRIBES: LocalNativeConfig = { ...WHOLE, translation: null, transcribesAlone: true };
const TRANSLATES: NativeTranslationConfig = { modelId: 'mt-a', device: 'auto', instructions: '', wrapTranscript: true, coLoaded: {}, host };
const VOICE: NativeSpeechConfig = { modelId: 'tts-a', device: 'auto', speed: 1, voice: '', capability: null, host };

const env = (over: Partial<Parameters<typeof isPresent>[1]> = {}) =>
  ({ platform: 'electron' as const, dev: false, enabled: new Set<string>(), kizuna: false, switchOn: () => false, ...over });

describe('localNativeProvider', () => {
  it("keeps the old enum's id and the old slice's storage prefix", () => {
    expect(localNativeProvider.id).toBe('local_native');
    expect(localNativeProvider.kind).toBe('local');
    expect(localNativeProvider.settings).toEqual({ key: 'localNative', defaults: LOCAL_NATIVE_DEFAULTS });
    expect(localNativeProvider.credentials.keys).toEqual([]);
  });

  it('is offered like any provider, on the desktop only: no flag, no tester switch', () => {
    expect(localNativeProvider.flagged).toBeUndefined();
    expect(localNativeProvider.testerSwitch).toBeUndefined();
    expect(isPresent(localNativeProvider, env())).toBe(true);
    expect(isPresent(localNativeProvider, env({ platform: 'web' }))).toBe(false);
    expect(isPresent(localNativeProvider, env({ platform: 'web', dev: true }))).toBe(false);
  });

  it('speaks optionally, takes typed text, decides its own boundaries, and offers both turn modes', () => {
    const caps = capabilitiesAlone(localNativeProvider, 'transcription');
    expect(caps).toMatchObject({ speech: 'optional', textInput: true, boundaries: 'provider', turns: ['auto', 'manual'] });
    expect(localNativeProvider.session?.admit).toBeTypeOf('function');
    expect(localNativeProvider.Engine).toBeTypeOf('function');
    expect(localNativeProvider.watchReadiness).toBeTypeOf('function');
  });

  it('declares four units: its whole session, its recognition, its translation and its voice (#578 ruling 17)', () => {
    expect(localNativeProvider.units.map((u) => u.id)).toEqual(['whole', 'transcription', 'translation', 'speech']);
  });

  it('a line-up all on Local Native runs its whole session', () => {
    const plan = compose({ transcription: 'local_native', translation: 'local_native', speech: 'local_native' }, { providers: [localNativeProvider], settings: () => undefined }) as RunPlan;
    expect(isRefusal(plan)).toBe(false);
    expect(plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([['local_native', 'whole', ['transcription', 'translation', 'speech']]]);
  });

  it('asks the native models it is handed when it watches (#578 ruling 18)', () => {
    const off = vi.fn();
    const watch = vi.fn(() => off);
    const onChange = vi.fn();
    expect(localNativeProvider.watchReadiness?.(onChange, fakeLocalModels(), fakeNativeModels({ watch }))).toBe(off);
    expect(watch).toHaveBeenCalledWith(onChange);
  });

  it('admit refuses two legs and admits one (#578 ruling 4)', () => {
    const one = {} as LocalNativeConfig;
    const shared = {} as never;
    expect(localNativeProvider.session?.admit?.({ speaker: one }, shared)).toBe(true);
    expect(localNativeProvider.session?.admit?.({ participant: one }, shared)).toBe(true);
    expect(localNativeProvider.session?.admit?.({ speaker: one, participant: one }, shared)).toEqual({ refused: ONE_SIDE_AT_A_TIME });
  });

  it('refuses two legs whatever unit the configs are, naming the unit (#578 rulings 4, 25)', () => {
    for (const [config, detail] of [[WHOLE, /^Local Native translates one side/], [TRANSCRIBES, /transcribes one side/], [TRANSLATES, /translation runs one side/], [VOICE, /voice reads one side/]] as const) {
      expect(localNativeProvider.session!.admit!({ speaker: config, participant: config } as never, {} as never)).toMatchObject({ refused: expect.stringMatching(detail) });
      expect(localNativeProvider.session!.admit!({ speaker: config } as never, {} as never)).toBe(true);
    }
  });
});
