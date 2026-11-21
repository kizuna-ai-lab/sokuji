import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheck = vi.fn();
const mockWatchReadiness = vi.fn();
vi.mock('./check', () => ({
  checkLocalInference: (...args: unknown[]) => mockCheck(...args),
  // Wrapped, not a direct reference: this factory is invoked as soon as
  // something imports './check' (via this test file's own hoisted `vi.mock`
  // call), which happens before `mockWatchReadiness` (declared above, but
  // after the hoisted call) is assigned — a direct reference here would
  // throw a TDZ ReferenceError.
  watchLocalInferenceReadiness: (onChange: () => void) => mockWatchReadiness(onChange),
}));

const mockBuild = vi.fn();
const mockDescribe = vi.fn();
const mockAdmit = vi.fn();
const mockFits = vi.fn();
vi.mock('./config', () => ({
  buildLocalInference: (...args: unknown[]) => mockBuild(...args),
  describeLocalInference: (...args: unknown[]) => mockDescribe(...args),
  admitLocalInference: (...args: unknown[]) => mockAdmit(...args),
  fitsBudget: (...args: unknown[]) => mockFits(...args),
}));

import { compose } from '../../lib/plan/compose';
import { RUN_STAGES } from '../../lib/lineup/types';
import { unitsOf, wholePlan } from '../../lib/plan/wholeUnit';
import type { RunPlan } from '../../lib/plan/types';
import { localInferenceProvider } from './provider';
import { sonioxProvider } from '../soniox/provider';
import { localSpeechUnit } from './speechUnit';
import { localTranslationUnit } from './translationUnit';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';
import { PROVIDERS } from '../registry';
import { LocalInferenceEngineSummary } from './LocalInferenceEngineSummary';
import { LocalInferenceVoiceSummary } from './LocalInferenceVoiceSummary';
import { LocalInferenceTurnDetectionControls, LocalInferenceTurnDetectionHelp, LocalInferenceTurnDetectionSummary } from './LocalInferenceTurnDetection';

const noAuth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  mockCheck.mockReset();
  mockWatchReadiness.mockReset();
  mockBuild.mockReset();
  mockDescribe.mockReset();
  mockAdmit.mockReset();
  mockFits.mockReset();
});

describe('localInferenceProvider', () => {
  it('identifies itself: local, on every platform, with no credentials to fill or read', () => {
    expect(localInferenceProvider.id).toBe('local_inference');
    expect(localInferenceProvider.kind).toBe('local');
    expect(localInferenceProvider.platforms).toEqual(['electron', 'extension', 'web']);
    expect(localInferenceProvider.settings.key).toBe('localInference');
    expect(localInferenceProvider.settings.defaults).toBe(LOCAL_INFERENCE_DEFAULTS);
    expect(localInferenceProvider.credentials.keys).toEqual([]);
    expect(localInferenceProvider.credentials.fields(LOCAL_INFERENCE_DEFAULTS)).toEqual([]);
    expect(localInferenceProvider.credentials.read({}, noAuth)).toEqual({});
  });

  it("links its setup guide (today's TUTORIAL_URLS value, as a literal — never imported from src/services)", () => {
    expect(localInferenceProvider.guideUrl).toBe('https://sokuji.kizuna.ai/docs/tutorials/local-inference-setup');
  });

  it('offers optional speech, text input, provider-cut boundaries, and both turn modes', () => {
    expect(localInferenceProvider.speech).toBe('optional');
    expect(localInferenceProvider.textInput(LOCAL_INFERENCE_DEFAULTS)).toBe(true);
    expect(localInferenceProvider.boundaries(LOCAL_INFERENCE_DEFAULTS)).toBe('provider');
    expect(localInferenceProvider.turns(LOCAL_INFERENCE_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('has an admit hook, the memory budget', () => {
    expect(localInferenceProvider.session?.admit).toBeDefined();
    mockAdmit.mockReturnValue(true);
    expect(localInferenceProvider.session?.admit?.({})).toBe(true);
    expect(mockAdmit).toHaveBeenCalledWith({});
  });

  it("admits its voice's configs on their own: the voice models alone, never the whole session's budget", () => {
    const voice = { modelId: 'tts-en', speakerId: 0, speed: 1 };
    mockFits.mockReturnValue(true);
    expect(localInferenceProvider.session?.admit?.({ speaker: voice, participant: { off: true } } as never)).toBe(true);
    expect(mockFits).toHaveBeenCalledWith(['tts-en']);
    mockFits.mockReturnValue(false);
    expect(localInferenceProvider.session?.admit?.({ speaker: voice, participant: { ...voice, modelId: 'tts-ja' } } as never))
      .toEqual({ refused: 'The models need more memory than this device has.', code: 'memory_exceeded' });
    expect(mockFits).toHaveBeenLastCalledWith(['tts-en', 'tts-ja']);
    expect(mockAdmit).not.toHaveBeenCalled();
    // The whole session's configs name a recognition model: its own admission, with whatever it answers.
    const whole = { speaker: { asr: { modelId: 'asr', streaming: false }, tts: voice } };
    const adjusted = { configs: { participant: {} } };
    mockAdmit.mockReturnValue(adjusted);
    expect(localInferenceProvider.session?.admit?.(whole as never)).toBe(adjusted);
    expect(mockAdmit).toHaveBeenCalledWith(whole);
  });

  describe('its units', () => {
    const offered = { providers: [localInferenceProvider], settings: () => LOCAL_INFERENCE_DEFAULTS };

    it('are the whole of it, as a provider with one unit has, its translation alone, and its voice', () => {
      const [whole, translation, voice] = localInferenceProvider.units!;
      expect(localInferenceProvider.units).toHaveLength(3);
      expect(translation).toBe(localTranslationUnit);
      expect(localInferenceProvider.units).toBe(localInferenceProvider.units);
      expect(unitsOf(localInferenceProvider)).toBe(localInferenceProvider.units);
      expect(voice).toBe(localSpeechUnit);
      expect(whole.id).toBe('whole');
      expect(whole.start).toBe(localInferenceProvider.start);
      expect(whole.describe).toBe(localInferenceProvider.describe);
      expect(whole.startSpeech).toBeUndefined();
      expect(whole.capabilities(LOCAL_INFERENCE_DEFAULTS)).toEqual({
        speech: 'optional', turns: ['auto', 'manual'], turnOwner: 'either', boundaries: 'provider', textInput: true, faceToFace: false, participantSpeech: true,
      });
      const context = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' } as any;
      mockBuild.mockReturnValue({ built: true });
      expect(whole.build(context, LOCAL_INFERENCE_DEFAULTS, {} as any)).toEqual({ built: true });
      expect(mockBuild).toHaveBeenCalledWith(context, LOCAL_INFERENCE_DEFAULTS, {});
    });

    it('a line-up that is all on this device runs on the whole unit, as before', () => {
      const [whole] = localInferenceProvider.units!;
      const alone = wholePlan(localInferenceProvider);
      expect(alone.units).toEqual([{ provider: localInferenceProvider, unit: whole, stages: RUN_STAGES }]);
      for (const lineUp of [
        { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference' },
        { transcription: 'local_inference', translation: 'bing', speech: 'edge' },
        { transcription: 'local_inference', translation: 'local_inference', speech: 'edge' },
        { transcription: 'local_inference', translation: 'bing', speech: 'local_inference' },
      ]) {
        expect(compose(lineUp, offered), JSON.stringify(lineUp)).toEqual(alone);
      }
    });

    it('its translation unit serves translation alone, and translation with speech is two units', () => {
      expect(localTranslationUnit.occupies(LOCAL_INFERENCE_DEFAULTS, new Set(['translation']))).toEqual(['translation']);
      expect(localTranslationUnit.occupies(LOCAL_INFERENCE_DEFAULTS, new Set(['translation', 'speech']))).toBeNull();
      expect(localSpeechUnit.occupies(LOCAL_INFERENCE_DEFAULTS, new Set(['translation', 'speech']))).toBeNull();
    });

    it('a provider that only transcribes together with its translation cannot hand this device the translation: it has no unit for what is left to it', () => {
      const text = { id: 'stt', occupies: (_s: unknown, want: ReadonlySet<string>) => (want.size === 2 && !want.has('speech') ? ['transcription', 'translation'] : null) };
      const soniox = { id: 'soniox', units: [text] } as any;
      for (const translation of ['bing', 'local_inference']) {
        expect(compose({ transcription: 'soniox', translation, speech: 'soniox' }, { providers: [soniox, localInferenceProvider], settings: () => undefined })).toEqual({ refused: 'lineup_no_unit', stage: 'transcription' });
      }
    });

    it("Soniox transcribing alone hands it the translation: its translation unit, and its voice where the line-up gives it speech too", () => {
      const given = { providers: [sonioxProvider, localInferenceProvider], settings: (id: string) => (id === 'soniox' ? sonioxProvider.settings.defaults : LOCAL_INFERENCE_DEFAULTS) };
      const shape = (plan: unknown) => (plan as RunPlan).units.map((u) => [u.provider.id, u.unit.id, u.stages]);
      for (const translation of ['bing', 'local_inference']) {
        expect(shape(compose({ transcription: 'soniox', translation, speech: 'soniox' }, given)))
          .toEqual([['soniox', 'transcription', ['transcription']], ['local_inference', 'translation', ['translation']], ['soniox', 'tts', ['speech']]]);
        for (const speech of ['edge', 'local_inference']) {
          const plan = compose({ transcription: 'soniox', translation, speech }, given) as RunPlan;
          expect(shape(plan)).toEqual([['soniox', 'transcription', ['transcription']], ['local_inference', 'translation', ['translation']], ['local_inference', 'speech', ['speech']]]);
          expect(plan.byStage.translation.unit).toBe(localTranslationUnit);
          expect(plan.byStage.speech.unit).toBe(localSpeechUnit);
        }
      }
    });

    it('asked for speech alone, it answers its voice', () => {
      const text = { id: 'stt', occupies: (_s: unknown, want: ReadonlySet<string>) => (want.size === 2 && !want.has('speech') ? ['transcription', 'translation'] : null) };
      const soniox = { id: 'soniox', units: [text] } as any;
      for (const speech of ['edge', 'local_inference']) {
        const plan = compose({ transcription: 'soniox', translation: 'soniox', speech }, { providers: [soniox, localInferenceProvider], settings: () => undefined }) as RunPlan;
        expect(plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([['soniox', 'stt', ['transcription', 'translation']], ['local_inference', 'speech', ['speech']]]);
        expect(plan.byStage.speech.unit).toBe(localSpeechUnit);
      }
    });
  });

  it('delegates build() to buildLocalInference', () => {
    const context = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' } as any;
    const shared = {} as any;
    mockBuild.mockReturnValue({ refused: 'no' });
    const result = localInferenceProvider.build(context, LOCAL_INFERENCE_DEFAULTS, shared);
    expect(mockBuild).toHaveBeenCalledWith(context, LOCAL_INFERENCE_DEFAULTS, shared);
    expect(result).toEqual({ refused: 'no' });
  });

  it('delegates describe() to describeLocalInference', () => {
    const config = { asr: { modelId: 'x', streaming: false } } as any;
    mockDescribe.mockReturnValue({ asrModel: 'x' });
    const result = localInferenceProvider.describe(config);
    expect(mockDescribe).toHaveBeenCalledWith(config);
    expect(result).toEqual({ asrModel: 'x' });
  });

  it("check answers from checkLocalInference, given the provider's settings and context", async () => {
    const ctx = { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] as const };
    mockCheck.mockResolvedValue({ ok: true });
    const result = await localInferenceProvider.check({}, LOCAL_INFERENCE_DEFAULTS, ctx);
    expect(mockCheck).toHaveBeenCalledWith(LOCAL_INFERENCE_DEFAULTS, ctx);
    expect(result).toEqual({ ok: true });
  });

  it('follows the managed twins in the registry (Stage 2 Kizuna Soniox, ruling 6; Kizuna Qwen is flagged, so a release hides it)', () => {
    expect(PROVIDERS.slice(0, 3).map((p) => p.id)).toEqual(['kizunaai_soniox', 'kizunaai_qwen', 'local_inference']);
  });

  it('shows its EngineSummary under the picker', () => {
    expect(localInferenceProvider.EngineSummary).toBe(LocalInferenceEngineSummary);
  });

  it("tunes automatic turn detection with its VAD: TurnDetection's Summary, Controls and Help", () => {
    expect(localInferenceProvider.TurnDetection).toEqual({
      Summary: LocalInferenceTurnDetectionSummary,
      Controls: LocalInferenceTurnDetectionControls,
      Help: LocalInferenceTurnDetectionHelp,
    });
  });

  it('delegates watchReadiness() to watchLocalInferenceReadiness', () => {
    const off = vi.fn();
    mockWatchReadiness.mockReturnValue(off);
    const onChange = vi.fn();
    const result = localInferenceProvider.watchReadiness?.(onChange);
    expect(mockWatchReadiness).toHaveBeenCalledWith(onChange);
    expect(result).toBe(off);
  });

  it('names its voices in the Speech block, and picks them in its engine (#619)', () => {
    expect(localInferenceProvider.VoiceSummary).toBe(LocalInferenceVoiceSummary);
    expect(localInferenceProvider.voicesInEngine).toBe(true);
  });
});
