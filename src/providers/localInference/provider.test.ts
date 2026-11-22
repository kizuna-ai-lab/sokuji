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

import { compose, type ComposeInput } from '../../lib/plan/compose';
import { CAPS } from '../../lib/lineup/catalog';
import { RUN_STAGES } from '../../lib/lineup/types';
import type { ProviderCaps } from '../../lib/lineup/types';
import { unitsOf, wholePlan } from '../../lib/plan/wholeUnit';
import { choiceInput } from '../../lib/plan/choice';
import { separateStages } from '../../lib/plan/compositeStages';
import { isRefusal, type PlanRefusal, type RunPlan } from '../../lib/plan/types';
import type { AnyProvider } from '../../lib/provider/types';
import { bingProvider } from '../bing/provider';
import { edgeProvider } from '../edge/provider';
import { localInferenceProvider } from './provider';
import { sonioxProvider } from '../soniox/provider';
import { fakeTranslatorProvider } from '../fake/translator';
import { fakeVoiceProvider } from '../fake/voice';
import { localSpeechUnit } from './speechUnit';
import { localTranscriptionUnit } from './transcriptionUnit';
import { localTranslationUnit } from './translationUnit';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';
import { PROVIDERS, RELEASED } from '../registry';
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
    // Its recognition alone counts its recognition models only, never the whole session's budget.
    mockFits.mockReturnValue(true);
    const alone = (modelId: string) => ({ asr: { modelId, streaming: false }, vad: {}, translation: { kind: 'none' }, transcribesAlone: true });
    expect(localInferenceProvider.session?.admit?.({ speaker: alone('asr-en'), participant: alone('asr-ja') } as never)).toBe(true);
    expect(mockFits).toHaveBeenLastCalledWith(['asr-en', 'asr-ja']);
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
    // Bing and Edge are providers of their own, with units of their own: offered beside this device.
    const settingsOf = (id: string) => (id === 'local_inference' ? LOCAL_INFERENCE_DEFAULTS : (id === 'edge' ? edgeProvider.settings.defaults : (bingProvider.settings as { defaults?: unknown } | undefined)?.defaults));
    const offeredWithBingAndEdge: ComposeInput = { providers: [localInferenceProvider, bingProvider as AnyProvider, edgeProvider as AnyProvider], settings: settingsOf };
    const unitsOfPlan = (plan: RunPlan | PlanRefusal) => (isRefusal(plan) ? plan : plan.units.map((u) => [u.provider.id, u.unit.id, u.stages]));

    it('are the whole of it, as a provider with one unit has, its recognition alone, its translation alone, and its voice', () => {
      const [whole, transcription, translation, voice] = localInferenceProvider.units!;
      expect(localInferenceProvider.units).toHaveLength(4);
      expect(transcription).toBe(localTranscriptionUnit);
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
      const lineUp = { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference' };
      expect(compose(lineUp, offered)).toEqual(alone);
      expect(compose(lineUp, offeredWithBingAndEdge)).toEqual(alone);
    });

    it('Bing and Edge are providers of their own: this device with them is three units, not one whole session', () => {
      const plan = compose({ transcription: 'local_inference', translation: 'bing', speech: 'edge' }, offeredWithBingAndEdge) as RunPlan;
      expect(unitsOfPlan(plan)).toEqual([['local_inference', 'transcription', ['transcription']], ['bing', 'translation', ['translation']], ['edge', 'speech', ['speech']]]);
      expect(plan.byStage.transcription.unit).toBe(localTranscriptionUnit);
    });

    it('a local translation model and Edge: this device serves transcription and translation, beside Edge', () => {
      const plan = compose({ transcription: 'local_inference', translation: 'local_inference', speech: 'edge' }, offeredWithBingAndEdge);
      expect(unitsOfPlan(plan)).toEqual([['local_inference', 'whole', ['transcription', 'translation']], ['edge', 'speech', ['speech']]]);
    });

    it('Bing and a local voice: this device transcribes and speaks, around Bing', () => {
      const plan = compose({ transcription: 'local_inference', translation: 'bing', speech: 'local_inference' }, offeredWithBingAndEdge);
      expect(unitsOfPlan(plan)).toEqual([['local_inference', 'transcription', ['transcription']], ['bing', 'translation', ['translation']], ['local_inference', 'speech', ['speech']]]);
    });

    it('every line-up of this device, Bing and Edge composes to the units of each provider; one that names no option for a stage is incomplete', () => {
      const ids = ['local_inference', 'bing', 'edge'];
      const composed: string[] = [];
      for (const transcription of ids) for (const translation of ids) for (const speech of ids) {
        const lineUp = { transcription, translation, speech };
        const plan = compose(lineUp, offeredWithBingAndEdge);
        if (isRefusal(plan)) {
          // Bing only translates and Edge only speaks: such a line-up names no option for some stage.
          expect(plan.refused, JSON.stringify(lineUp)).toBe('lineup_incomplete');
          continue;
        }
        composed.push(`${translation}/${speech}`);
      }
      expect(composed.sort()).toEqual(['bing/edge', 'bing/local_inference', 'local_inference/edge', 'local_inference/local_inference']);
    });

    it('its recognition unit serves transcription alone, and transcription with anything else is another unit or none', () => {
      expect(localTranscriptionUnit.occupies(LOCAL_INFERENCE_DEFAULTS, new Set(['transcription']))).toEqual(['transcription']);
      for (const with_ of [['translation'], ['speech'], ['translation', 'speech']] as const) {
        expect(localTranscriptionUnit.occupies(LOCAL_INFERENCE_DEFAULTS, new Set(['transcription', ...with_]))).toBeNull();
      }
    });

    it('with another provider translating, it transcribes alone: its recognition unit beside the other\'s translation, and a voice of either', () => {
      // A test catalog: no released option translates another provider's transcription yet (the text models do).
      const catalog: ProviderCaps[] = [
        ...CAPS,
        { id: 'fake_translator', stages: ['translation'], host: 'fake_translator', account: 'none', voiceAlone: false, takesVoice: true },
        { id: 'fake_voice', stages: ['speech'], host: 'fake_voice', account: 'none', voiceAlone: true, takesVoice: false },
      ];
      const input: ComposeInput = {
        providers: [localInferenceProvider, bingProvider as AnyProvider, edgeProvider as AnyProvider, fakeTranslatorProvider as AnyProvider, fakeVoiceProvider as AnyProvider],
        settings: (id) => (id === 'local_inference' ? LOCAL_INFERENCE_DEFAULTS : settingsOf(id)),
        catalog,
      };
      const shape = (plan: RunPlan | PlanRefusal) => (isRefusal(plan) ? plan : plan.units.map((u) => [u.provider.id, u.unit.id, u.stages]));
      const voiceElsewhere = compose({ transcription: 'local_inference', translation: 'fake_translator', speech: 'fake_voice' }, input);
      expect(shape(voiceElsewhere)).toEqual([['local_inference', 'transcription', ['transcription']], ['fake_translator', 'translator', ['translation']], ['fake_voice', 'voice', ['speech']]]);
      expect((voiceElsewhere as RunPlan).byStage.transcription.unit).toBe(localTranscriptionUnit);
      expect(separateStages(voiceElsewhere as RunPlan)).not.toBeNull();
      for (const speech of ['edge', 'local_inference']) {
        const plan = compose({ transcription: 'local_inference', translation: 'fake_translator', speech }, input) as RunPlan;
        expect(shape(plan), speech).toEqual([['local_inference', 'transcription', ['transcription']], ['fake_translator', 'translator', ['translation']], [speech, 'speech', ['speech']]]);
        if (speech === 'local_inference') expect(plan.byStage.speech.unit).toBe(localSpeechUnit);
        expect(separateStages(plan)).not.toBeNull();
      }
      // This device translating as well is the whole unit again, whoever speaks; Bing translating is a unit of its own.
      expect(shape(compose({ transcription: 'local_inference', translation: 'local_inference', speech: 'fake_voice' }, input))).toEqual([['local_inference', 'whole', ['transcription', 'translation']], ['fake_voice', 'voice', ['speech']]]);
      expect(shape(compose({ transcription: 'local_inference', translation: 'bing', speech: 'fake_voice' }, input))).toEqual([['local_inference', 'transcription', ['transcription']], ['bing', 'translation', ['translation']], ['fake_voice', 'voice', ['speech']]]);
    });

    it('no line-up that ran changes, and the ones that newly run are this device transcribing for a text model: every triple of the catalog, with and without its recognition unit', () => {
      const released = choiceInput(RELEASED, {});
      const local = released.providers.find((p) => p.id === 'local_inference')!;
      const before = { ...local, units: unitsOf(local).filter((u) => u !== localTranscriptionUnit) } as AnyProvider;
      const without: ComposeInput = { ...released, providers: released.providers.map((p) => (p === local ? before : p)) };
      const shape = (plan: RunPlan | PlanRefusal) => (isRefusal(plan) ? plan : plan.units.map((u) => [u.provider.id, u.unit.id, u.stages]));
      const textModels = ['openai_text', 'gemini_text', 'openai_compatible'];
      const reworded: string[] = [];
      const newlyRun: string[] = [];
      for (const t of CAPS) for (const tl of CAPS) for (const sp of CAPS) {
        const lineUp = { transcription: t.id, translation: tl.id, speech: sp.id };
        const label = JSON.stringify(lineUp);
        const now = compose(lineUp, released);
        const then = compose(lineUp, without);
        if (!isRefusal(then)) {
          // No line-up that ran runs otherwise, and none of them takes the recognition unit.
          expect(isRefusal(now), label).toBe(false);
          expect(shape(now), label).toEqual(shape(then));
          if (!isRefusal(now)) expect(now.units.some((u) => u.unit === localTranscriptionUnit), label).toBe(false);
        } else if (!isRefusal(now)) {
          // What newly runs (text models, part B): this device transcribing alone for a text model, which was refused
          // as this device having no unit for transcription alone.
          expect(t.id, label).toBe('local_inference');
          expect([...textModels, 'bing'], label).toContain(tl.id);
          expect(then, label).toEqual({ refused: 'lineup_no_unit', stage: 'transcription' });
          expect(now.byStage.transcription.unit, label).toBe(localTranscriptionUnit);
          newlyRun.push(`${tl.id}/${sp.id}`);
        } else if (JSON.stringify(now) !== JSON.stringify(then)) {
          reworded.push(`${tl.id}/${sp.id}`);
          // This device transcribing, and an end-to-end provider translating or (beside a text model) speaking: the
          // refusal is now the one any transcriber that stands alone meets there (the end-to-end provider's stages go
          // together), where it was that this device had no unit. `choose` never makes such a line-up: it moves an
          // end-to-end provider's stages together (the walk of every reachable line-up in `choose.test.ts`).
          expect(t.id, label).toBe('local_inference');
          expect(tl.joint ?? sp.joint, label).toEqual(['transcription', 'translation', 'speech']);
          expect(then, label).toEqual({ refused: 'lineup_no_unit', stage: 'transcription' });
          expect(now, label).toEqual({ refused: 'lineup_stage_split', stage: 'transcription' });
        }
      }
      // Each end-to-end provider, under each option that speaks (one that does not leaves the line-up incomplete);
      // and each text model, under each end-to-end provider's voice.
      const endToEnd = CAPS.filter((c) => c.joint?.includes('translation'));
      const speaking = CAPS.filter((c) => c.stages.includes('speech'));
      expect(reworded.sort()).toEqual([
        ...endToEnd.flatMap((tl) => speaking.map((sp) => `${tl.id}/${sp.id}`)),
        ...[...textModels, 'bing'].flatMap((tl) => endToEnd.map((sp) => `${tl}/${sp.id}`)),
      ].sort());
      // Each text model, under each voice that stands alone.
      const alone = CAPS.filter((c) => c.stages.includes('speech') && c.voiceAlone).map((c) => c.id);
      expect(newlyRun.sort()).toEqual([...textModels, 'bing'].flatMap((model) => alone.map((voice) => `${model}/${voice}`)).sort());
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
        expect(compose({ transcription: 'soniox', translation, speech: 'soniox' }, { providers: [soniox, localInferenceProvider, bingProvider as AnyProvider], settings: () => undefined })).toEqual({ refused: 'lineup_no_unit', stage: 'transcription' });
      }
    });

    it("Soniox transcribing alone hands it the translation: its translation unit, and its voice where the line-up gives it speech too", () => {
      const given = { providers: [sonioxProvider, localInferenceProvider, bingProvider as AnyProvider, edgeProvider as AnyProvider], settings: (id: string) => (id === 'soniox' ? sonioxProvider.settings.defaults : settingsOf(id)) };
      const shape = (plan: unknown) => (plan as RunPlan).units.map((u) => [u.provider.id, u.unit.id, u.stages]);
      for (const translation of ['bing', 'local_inference']) {
        const translator = translation === 'bing' ? 'bing' : 'local_inference';
        expect(shape(compose({ transcription: 'soniox', translation, speech: 'soniox' }, given)))
          .toEqual([['soniox', 'transcription', ['transcription']], [translator, 'translation', ['translation']], ['soniox', 'tts', ['speech']]]);
        for (const speech of ['edge', 'local_inference']) {
          const plan = compose({ transcription: 'soniox', translation, speech }, given) as RunPlan;
          expect(shape(plan)).toEqual([['soniox', 'transcription', ['transcription']], [translator, 'translation', ['translation']], [speech, 'speech', ['speech']]]);
          if (translation === 'local_inference') expect(plan.byStage.translation.unit).toBe(localTranslationUnit);
          if (speech === 'local_inference') expect(plan.byStage.speech.unit).toBe(localSpeechUnit);
        }
      }
    });

    it('asked for speech alone, it answers its voice', () => {
      const text = { id: 'stt', occupies: (_s: unknown, want: ReadonlySet<string>) => (want.size === 2 && !want.has('speech') ? ['transcription', 'translation'] : null) };
      const soniox = { id: 'soniox', units: [text] } as any;
      for (const speech of ['edge', 'local_inference']) {
        const plan = compose({ transcription: 'soniox', translation: 'soniox', speech }, { providers: [soniox, localInferenceProvider, edgeProvider as AnyProvider], settings: () => undefined }) as RunPlan;
        expect(plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([['soniox', 'stt', ['transcription', 'translation']], [speech, 'speech', ['speech']]]);
        if (speech === 'local_inference') expect(plan.byStage.speech.unit).toBe(localSpeechUnit);
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
