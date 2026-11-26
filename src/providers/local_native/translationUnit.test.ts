/** Local Native's translation as a unit of its own: what it declares, the config it builds, and which configs it takes. */
import { describe, expect, it } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { fakeNativeModels } from '../../lib/local-inference/native/nativeModels.testing';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import type { SharedSettings } from '../../lib/run/types';
import { createFakeNativeHost } from './fakeEngines';
import { LOCAL_NATIVE_DEFAULTS } from './settings';
import type { NativeTranslationConfig } from './translationSession';
import { admitNativeTranslation, areNativeTranslationConfigs, nativeTranslates, nativeTranslationUnit } from './translationUnit';

const JA_EN: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' };
const resolved = (id: string | null, variant?: string) => (id ? { modelId: id, source: 'explicit' as const, ...(variant ? { variant } : {}) } : null);
const facts = fakeNativeModels({
  resolve: () => ({ asr: resolved('asr-ja'), translation: resolved('mt-a', 'q8_0'), tts: resolved('tts-en'), notes: [], prunes: [] }),
});
const SHARED: SharedSettings = { pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [], nativeModels: facts };

const config = (over: Partial<NativeTranslationConfig> = {}): NativeTranslationConfig =>
  ({ modelId: 'mt-a', device: 'auto', instructions: '', wrapTranscript: true, coLoaded: {}, host: createFakeNativeHost(), ...over });

describe("what Local Native's translation unit declares", () => {
  it('occupies translation alone; translates a fixed source into another language, and never `auto`', () => {
    const occupies = (stages: string[]) => nativeTranslationUnit.occupies(LOCAL_NATIVE_DEFAULTS, new Set(stages) as never);
    expect(occupies(['translation'])).toEqual(['translation']);
    expect(occupies(['translation', 'speech'])).toBeNull();
    expect(occupies(['transcription', 'translation'])).toBeNull();
    expect(nativeTranslates('ja', 'en')).toBe(true);
    expect(nativeTranslates('auto', 'en')).toBe(false);
    expect(nativeTranslates('ja', 'auto')).toBe(false);
    expect(nativeTranslates('en', 'en')).toBe(false);
    expect(nativeTranslationUnit.capabilities(LOCAL_NATIVE_DEFAULTS)).toMatchObject({ speech: 'never', textInput: false, faceToFace: false, translates: nativeTranslates });
  });
});

describe('the config it builds', () => {
  it("resolves the leg's translation model with its device, variant and prompt", () => {
    const c = nativeTranslationUnit.build(JA_EN, { ...LOCAL_NATIVE_DEFAULTS, translationDevice: 'cpu' }, SHARED) as NativeTranslationConfig;
    expect(c).toMatchObject({ modelId: 'mt-a', variant: 'q8_0', device: 'cpu', instructions: buildDefaultLocalPrompt('ja', 'en'), wrapTranscript: true, host: facts });
    expect(nativeTranslationUnit.describe(c)).toEqual({ translationModel: 'mt-a' });
  });

  it('refuses a direction with no translation model (native_translation_missing)', () => {
    const none = fakeNativeModels({ resolve: () => ({ asr: null, translation: null, tts: null, notes: [], prunes: [] }) });
    expect(nativeTranslationUnit.build(JA_EN, LOCAL_NATIVE_DEFAULTS, { ...SHARED, nativeModels: none })).toEqual({ refused: 'No translation model for ja → en.', code: 'native_translation_missing' });
  });

  it('refuses an auto source', () => {
    expect(nativeTranslationUnit.build({ ...JA_EN, direction: { source: 'auto', target: 'en' } }, LOCAL_NATIVE_DEFAULTS, SHARED)).toMatchObject({ refused: expect.any(String) });
  });

  it.each([
    // [lineUp TR, lineUp SP, shared.speaks, expected]
    ['local_native', 'local_native', true, { asrModel: 'asr-ja', ttsModel: 'tts-en' }],
    ['local_native', 'edge', true, { asrModel: 'asr-ja' }],
    ['soniox', 'local_native', true, { ttsModel: 'tts-en' }],
    ['soniox', 'local_native', false, {}],
  ] as const)('tells the sidecar the models the line-up co-loads: %s / %s, speaks %s (#578 ruling 22)', (tr, sp, speaks, expected) => {
    // The first two rows are defensive: a line-up with both stages on Local Native runs its whole unit (ruling 17).
    const c = nativeTranslationUnit.build(JA_EN, LOCAL_NATIVE_DEFAULTS, { ...SHARED, speaks, lineUp: { transcription: tr, translation: 'local_native', speech: sp, summarisation: null } as never });
    expect((c as NativeTranslationConfig).coLoaded).toEqual(expected);
  });

  it('with no line-up handed, co-loads nothing', () => {
    expect((nativeTranslationUnit.build(JA_EN, LOCAL_NATIVE_DEFAULTS, { ...SHARED, speaks: true }) as NativeTranslationConfig).coLoaded).toEqual({});
  });
});

describe('admission', () => {
  it("areNativeTranslationConfigs takes this unit's configs and no other unit's", () => {
    expect(areNativeTranslationConfigs({ speaker: config() })).toBe(true);
    expect(areNativeTranslationConfigs({ speaker: { asr: {}, instructions: '', coLoaded: {} } as never })).toBe(false);
    expect(areNativeTranslationConfigs({ speaker: { modelId: 'tts-a', voice: '' } as never })).toBe(false);
    expect(areNativeTranslationConfigs({})).toBe(false);
  });

  it('refuses two legs and admits one', () => {
    expect(admitNativeTranslation({ speaker: config() })).toBe(true);
    expect(admitNativeTranslation({ speaker: config(), participant: config() })).toEqual({ refused: "Local Native's translation runs one side at a time: choose Me or Other." });
  });
});
