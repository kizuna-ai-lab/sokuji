import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
import { createParticipantLocalInferenceConfig } from './localParticipantConfig';
import { guardAstCrossStage } from './astGuard';
import { useModelStore } from '../../stores/modelStore';
import { directionKey, type Selections } from '../../lib/local-inference/selection/types';
import type { LocalInferenceSessionConfig } from '../interfaces/IClient';

// Reproduces the AST cross-stage hazard: 'granite-speech' is an AST-capable
// ASR model (astLanguages covers ja transcribe / en translate — see
// modelManifest.ts). Explicitly picking it as the TRANSLATION stage for
// ja→en, while the ASR stage resolves (auto or explicit) to a DIFFERENT
// model, must not reach the session config as translationModelId — it would
// fail LocalInferenceClient's `translationModelId === asrModelId` AST check
// and construct a real TranslationEngine against Granite's AST-only files.
describe('AST cross-stage guard', () => {
  const dir = directionKey('ja', 'en');

  beforeEach(() => {
    // Real (unmocked) modelManifest + modelStore — exercises the actual
    // resolver, not a stub.
    useModelStore.setState({
      modelStatuses: {
        'sensevoice-int8': 'downloaded',
        'opus-mt-ja-en': 'downloaded',
        'opus-mt-en-jap': 'downloaded',
        'granite-speech': 'downloaded',
      },
      webgpuAvailable: true,
      deviceFeatures: [],
    });
  });

  describe('guardAstCrossStage (unit)', () => {
    // Injected in place of a static useModelStore import — see astGuard.ts's
    // doc comment: the pure function takes re-resolution as a parameter so a
    // store can apply it (modelStore.ts's ensureSelectionReady) without
    // creating an import cycle.
    const reResolve = (masked: Selections) => useModelStore.getState().resolve('ja', 'en', masked);

    it('masks the explicit AST-capable translation pick back to auto when it does not match the resolved ASR', () => {
      const selections: Selections = {
        [dir]: { asr: { modelId: '' }, translation: { modelId: 'granite-speech' }, tts: { modelId: '' } },
      };
      const resolved = useModelStore.getState().resolve('ja', 'en', selections);
      // Sanity: reproduces the hazard before the guard runs.
      expect(resolved.translation?.modelId).toBe('granite-speech');
      expect(resolved.asr?.modelId).not.toBe('granite-speech');

      // What auto would pick with nothing explicit for translation — the
      // manifest excludes AST-capable entries from auto-eligibility
      // (candidates.wasm.ts), so this can never be granite-speech.
      const autoOnly = useModelStore.getState().resolve('ja', 'en', {});

      const guarded = guardAstCrossStage('ja', 'en', selections, resolved, reResolve);
      expect(guarded.translation).toEqual(autoOnly.translation);
      expect(guarded.translation?.modelId).not.toBe('granite-speech');
      expect(guarded.translation?.source).toBe('auto');
      expect(guarded.asr).toEqual(resolved.asr);
    });

    it('emits a note naming the masked id and its auto replacement when it rewrites', () => {
      const selections: Selections = {
        [dir]: { asr: { modelId: '' }, translation: { modelId: 'granite-speech' }, tts: { modelId: '' } },
      };
      const resolved = useModelStore.getState().resolve('ja', 'en', selections);
      const autoOnly = useModelStore.getState().resolve('ja', 'en', {});

      const guarded = guardAstCrossStage('ja', 'en', selections, resolved, reResolve);

      const note = guarded.notes.find((n) => n.stage === 'translation' && n.from === 'granite-speech');
      expect(note).toBeDefined();
      expect(note).toMatchObject({
        direction: dir, stage: 'translation', from: 'granite-speech',
        to: autoOnly.translation?.modelId ?? null, reason: 'lang-incompatible',
      });
      // The rewrite must not silently drop any note the initial resolution
      // already carried — it is APPENDED, not a replacement of `notes`.
      expect(guarded.notes.length).toBe(resolved.notes.length + 1);
    });

    it('passes AST mode through untouched when the translation selection matches the resolved ASR', () => {
      const selections: Selections = {
        [dir]: { asr: { modelId: 'granite-speech' }, translation: { modelId: 'granite-speech' }, tts: { modelId: '' } },
      };
      const resolved = useModelStore.getState().resolve('ja', 'en', selections);
      expect(resolved.asr?.modelId).toBe('granite-speech');
      expect(resolved.translation?.modelId).toBe('granite-speech');

      const guarded = guardAstCrossStage('ja', 'en', selections, resolved, reResolve);
      expect(guarded).toEqual(resolved);
    });
  });

  describe('LocalInferenceProviderConfig.buildSessionConfig (speaker direction)', () => {
    it('reports the auto translation pick, not the AST-capable ASR id, in the built config', () => {
      const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
      const autoOnly = useModelStore.getState().resolve('ja', 'en', {});
      const slice = {
        ...defaultLocalInferenceSettings,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        selections: {
          [dir]: { asr: { modelId: '' }, translation: { modelId: 'granite-speech' }, tts: { modelId: '' } },
        },
      };
      const config = d.buildSessionConfig(slice, 'instructions') as LocalInferenceSessionConfig;
      expect(config.translationModelId).toBe(autoOnly.translation?.modelId);
      expect(config.translationModelId).not.toBe('granite-speech');
      expect(config.asrModelId).not.toBe('granite-speech');
    });

    it('healthy case: an explicit Granite pick that matches the resolved ASR stays AST (translationModelId === asrModelId)', () => {
      const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
      const slice = {
        ...defaultLocalInferenceSettings,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        selections: {
          [dir]: { asr: { modelId: 'granite-speech' }, translation: { modelId: 'granite-speech' }, tts: { modelId: '' } },
        },
      };
      const config = d.buildSessionConfig(slice, 'instructions') as LocalInferenceSessionConfig;
      expect(config.asrModelId).toBe('granite-speech');
      expect(config.translationModelId).toBe('granite-speech');
    });
  });

  describe('createParticipantLocalInferenceConfig (participant direction)', () => {
    it('reports the auto translation pick, not the AST-capable ASR id, in the built participant config', () => {
      // Participant direction is target→source, so the hazard is planted on
      // en→ja here — createParticipantLocalInferenceConfig reverses baseConfig's
      // languages to resolve it.
      const participantDir = directionKey('en', 'ja');
      const autoOnly = useModelStore.getState().resolve('en', 'ja', {});
      const baseConfig = {
        sourceLanguage: 'ja',
        targetLanguage: 'en',
      } as LocalInferenceSessionConfig;
      const selections: Selections = {
        [participantDir]: { asr: { modelId: '' }, translation: { modelId: 'granite-speech' }, tts: { modelId: '' } },
      };
      // granite-speech's astLanguages covers en transcribe / ja translate too
      // (modelManifest.ts), so it is AST-capable for en→ja as well.
      const result = createParticipantLocalInferenceConfig(baseConfig, selections);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.config.translationModelId).toBe(autoOnly.translation?.modelId);
        expect(result.config.translationModelId).not.toBe('granite-speech');
        expect(result.config.asrModelId).not.toBe('granite-speech');
      }
    });
  });
});
