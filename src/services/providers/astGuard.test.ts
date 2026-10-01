import { describe, it, expect, beforeEach } from 'vitest';
import { guardAstCrossStage } from './astGuard';
import { useModelStore } from '../../stores/modelStore';
import { directionKey, type Selections } from '../../lib/local-inference/selection/types';

// Reproduces the AST cross-stage hazard: 'granite-speech' is an AST-capable
// ASR model (astLanguages covers ja transcribe / en translate — see
// modelManifest.ts). Explicitly picking it as the TRANSLATION stage for
// ja→en, while the ASR stage resolves (auto or explicit) to a DIFFERENT
// model, must not reach the session config as translationModelId — it would
// fail the AST check (`providers/localInference/config.ts`: the translation
// id equals the ASR id) and construct a real TranslationEngine against
// Granite's AST-only files.
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
    // doc comment: the pure function takes re-resolution as a parameter, and
    // its callers (the LocalInference provider's config.ts and check.ts) pass
    // one bound to the direction, as this does.
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
});
