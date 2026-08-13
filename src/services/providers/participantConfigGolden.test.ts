import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the remaining provider gates on — Kizuna/Palabra/Local-Native feature
// flags plus Electron/Extension platform detection — so ALL descriptors
// register regardless of build env. Copied from descriptorRegistry.test.ts.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));

// The two local-provider re-resolution helpers read model-readiness store
// state that a plain settings slice can't steer into every outcome shape
// (success / no_asr / memory_exceeded / translationAvailable-false /
// asrFallback). Mocked here — same pattern as participantConfig.test.ts —
// so the "mocked-local variants" describe block below can hit each branch
// deterministically. Both the fixture and the descriptor import this same
// module, so whatever the mock returns, old and new see identical results.
vi.mock('./localParticipantConfig', () => ({
  createParticipantLocalInferenceConfig: vi.fn(),
  createParticipantLocalNativeConfig: vi.fn(),
}));

import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import type { SessionConfig } from '../interfaces/IClient';
import type {
  VolcengineAST2SessionConfig,
  VolcengineSTSessionConfig,
  LocalInferenceSessionConfig,
  LocalNativeSessionConfig,
  OpenAITranslateSessionConfig,
  OpenAISessionConfig,
  TranslateTargetLanguage,
  ZoomAISessionConfig,
  SonioxSessionConfig,
  PalabraAISessionConfig,
  GeminiSessionConfig,
} from '../interfaces/IClient';
import { reverseTranscriptionDirection } from './openaiTranscriptionContext';
import { reverseGeminiTranslationDirection } from './geminiTranslateModel';
import { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from './localParticipantConfig';
import type { ParticipantNotice } from './ProviderDescriptor';

import { defaultOpenAISettings } from './OpenAIProviderConfig';
import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
import { defaultGeminiSettings } from './GeminiProviderConfig';
import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
import { defaultVolcengineSTSettings } from './VolcengineSTProviderConfig';
import { defaultZoomAISettings } from './ZoomAIProviderConfig';
import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
import { defaultKizunaOpenaiTranslateSettings } from './KizunaAIOpenAITranslateProviderConfig';
import { defaultKizunaVolcengineAst2Settings } from './KizunaAIVolcengineAST2ProviderConfig';
import { defaultKizunaSonioxSettings } from './KizunaAISonioxProviderConfig';
import { defaultSonioxSettings } from './SonioxProviderConfig';

const mockedLocalInference = vi.mocked(createParticipantLocalInferenceConfig);
const mockedLocalNative = vi.mocked(createParticipantLocalNativeConfig);

// Map each provider's settingsSliceKey to its per-module default settings
// slice — copied from descriptorRegistry.test.ts (same imports), so
// buildSessionConfig/buildParticipantSessionConfig can be exercised for
// every registered provider.
const DEFAULTS_BY_SLICE: Record<string, unknown> = {
  openai: defaultOpenAISettings,
  openaiCompatible: defaultOpenAICompatibleSettings,
  openaiTranslate: defaultOpenAITranslateSettings,
  gemini: defaultGeminiSettings,
  palabraai: defaultPalabraAISettings,
  volcengineST: defaultVolcengineSTSettings,
  zoomAI: defaultZoomAISettings,
  volcengineAST2: defaultVolcengineAST2Settings,
  localInference: defaultLocalInferenceSettings,
  localNative: defaultLocalNativeSettings,
  kizunaOpenaiTranslate: defaultKizunaOpenaiTranslateSettings,
  kizunaVolcengineAst2: defaultKizunaVolcengineAst2Settings,
  kizunaSoniox: defaultKizunaSonioxSettings,
  soniox: defaultSonioxSettings,
};

// Benign default return values so the two local providers don't hit an
// unconfigured vi.fn() (→ undefined → throws on `.success`) inside the tests
// below that aren't specifically targeting them (the main loop, the gemini
// case, the swap-provider cases). Since the fixture and the descriptor call
// the SAME mocked function, whatever it returns, old and new see identical
// results — the specific values here are otherwise arbitrary.
mockedLocalInference.mockReturnValue({
  success: true,
  config: { provider: 'local_inference', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalInferenceSessionConfig,
  status: {
    asrAvailable: true, asrModelId: 'sensevoice-int8', asrFallback: false,
    asrOriginalModelId: 'sensevoice-int8', translationAvailable: true, translationModelId: 'opus-mt-en-ja',
  },
});
mockedLocalNative.mockReturnValue({
  success: true, translationAvailable: true,
  config: { provider: 'local_native', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalNativeSessionConfig,
});

/**
 * VERBATIM copy of the body of `createParticipantSessionConfig` from
 * src/components/MainPanel/MainPanel.tsx (grep "Helper to create session
 * config for participant mode"), with EXACTLY five mechanical adaptations —
 * enumerated in task-6-report.md. This function is the oracle: a mismatch
 * against `buildParticipantSessionConfig` means the bug is in the descriptor
 * overrides (Tasks 2-5) — fix THERE, never by adjusting this fixture.
 */
function oldCreateParticipantSessionConfig(
  provider: Provider,
  slice: unknown,
  swappedInstructions: string,
  shell: { textOnly: boolean; keepReplayAudio: boolean },
  notices: ParticipantNotice[],
): SessionConfig | null {
  const cfg = ProviderConfigFactory.getDescriptor(provider).buildSessionConfig(slice, swappedInstructions);
  (cfg as SessionConfig).textOnly = shell.textOnly;
  (cfg as SessionConfig).keepReplayAudio = shell.keepReplayAudio;
  const baseConfig = cfg;
  const config = {
    ...baseConfig,
    textOnly: true,
    // Override turn detection to use semantic VAD for participant audio (OpenAI-compatible)
    turnDetection: {
      type: 'semantic_vad' as const,
      createResponse: true,
      interruptResponse: false,
      eagerness: 'high',
    },
    // Force Auto mode for Gemini participant (no PTT for participant)
    ...(baseConfig.provider === 'gemini' ? { turnDetectionMode: 'Auto' as const } : {}),
  };

  // Gemini's dialogue models need nothing here: their direction rides in the
  // system instruction, which was already swapped above. A Live Translate
  // session does, because its `translationConfig.targetLanguageCode`
  // overrules that instruction — left alone, the participant session would
  // translate the other party's speech into the language they are already
  // speaking. No-op when no translationConfig is present.
  if (config.provider === 'gemini') {
    reverseGeminiTranslationDirection(config as GeminiSessionConfig);
  }

  // OpenAI Translate carries language direction only in `audio.output.language`
  // (not system instructions — translate doesn't accept instructions). Swap
  // targetLanguage to settings.sourceLanguage so the participant client
  // translates "their speech → user's language" instead of mirroring the
  // speaker's direction. If the user picked a sourceLanguage outside the
  // 13 supported targets, the swap may produce an invalid target — the UI
  // already warns about this combination, and the API will surface a clear
  // error if the user proceeds anyway.
  if (config.provider === 'openai_translate') {
    const tConfig = config as OpenAITranslateSessionConfig;
    const oldTarget: TranslateTargetLanguage = tConfig.targetLanguage;
    const oldSource: string | undefined = tConfig.sourceLanguage;
    // Cast: type-system can't validate at this layer; runtime gating is
    // the UI warning + API error message.
    tConfig.targetLanguage = (oldSource ?? oldTarget) as TranslateTargetLanguage;
    tConfig.sourceLanguage = oldTarget;
  }

  // OpenAI (and its compatible/Kizuna twins) carry the direction in
  // `instructions`, already reversed above — except for the transcription
  // hint, which is built from the user's source language. The participant
  // speaks the configured *target* language, so leaving the hint alone would
  // point their ASR at the wrong language, i.e. actively worse than sending
  // no hint at all. Rebuild it around the reversed direction; the glossary
  // carries over, since proper nouns are the same either way.
  if (config.provider === 'openai' || config.provider === 'cometapi') {
    reverseTranscriptionDirection(config as OpenAISessionConfig);
  }

  // Volcengine providers carry language direction in explicit config fields
  // (not system instructions), so we must swap sourceLanguage/targetLanguage
  // for the participant session to reverse the translation direction.
  if (config.provider === 'volcengine_ast2') {
    const ast2 = config as VolcengineAST2SessionConfig;
    [ast2.sourceLanguage, ast2.targetLanguage] = [ast2.targetLanguage, ast2.sourceLanguage];
  } else if (config.provider === 'soniox') {
    // Soniox carries direction in sourceLanguage/targetLanguage; reverse it so the
    // participant translates the other party's speech into the user's language.
    const sx = config as SonioxSessionConfig;
    [sx.sourceLanguage, sx.targetLanguage] = [sx.targetLanguage, sx.sourceLanguage];
  } else if (config.provider === 'palabraai') {
    // PalabraAI ignores `instructions` entirely — set_task carries the direction
    // in pipeline.transcription.source_language and
    // pipeline.translations[0].target_language, built from these two fields. Without
    // this swap the participant session transcribes the other party's speech under
    // the *user's* language and "translates" it back to the other party's language,
    // so the other party's own language comes out on both lines.
    //
    // The two fields use different code spaces (targets carry region suffixes like
    // en-us, sources don't), but the API strips the suffix before validating a
    // source, so a plain swap holds for every target we offer. In the other
    // direction five source languages aren't valid targets (eu, ga, mn, mt, ug);
    // picking one of those makes the reversed task fail with the API's
    // VALIDATION_ERROR, which arrives as a data message and surfaces through
    // handleError rather than throwing out of connect().
    const pa = config as PalabraAISessionConfig;
    [pa.sourceLanguage, pa.targetLanguage] = [pa.targetLanguage, pa.sourceLanguage];
  } else if (config.provider === 'local_native') {
    // Native ASR/translate carry the translation direction in
    // sourceLanguage/targetLanguage AND in the chosen model ids (a directional
    // Opus model bakes the direction in; a source-specific ASR only handles one
    // language). Reverse the direction and re-resolve both models for the
    // reversed pair — see createParticipantLocalNativeConfig.
    const result = createParticipantLocalNativeConfig(config as LocalNativeSessionConfig);

    if (!result.success) {
      notices.push({ channel: 'error', message: result.detail });
      return null;
    }

    if (!result.translationAvailable) {
      notices.push({ channel: 'warning', message: `No translation model for ${result.config.sourceLanguage} → ${result.config.targetLanguage} — transcription only` });
    }

    return result.config;
  } else if (config.provider === 'volcengine_st') {
    const st = config as VolcengineSTSessionConfig;
    const oldSource = st.sourceLanguage;
    st.sourceLanguage = st.targetLanguages[0] || oldSource;
    st.targetLanguages = [oldSource];
  } else if (config.provider === 'zoom_ai') {
    const z = config as ZoomAISessionConfig;
    const oldSource = z.sourceLanguage;
    z.sourceLanguage = z.targetLanguages[0] || oldSource;
    z.targetLanguages = [oldSource];
  } else if (config.provider === 'local_inference') {
    const localConfig = config as LocalInferenceSessionConfig;
    const result = createParticipantLocalInferenceConfig(localConfig);

    if (!result.success) {
      const channel: ParticipantNotice['channel'] = result.reason === 'memory_exceeded' ? 'warning' : 'error';
      notices.push({ channel, message: result.detail });
      return null;
    }

    if (!result.status.translationAvailable) {
      notices.push({ channel: 'warning', message: `No translation model for ${localConfig.targetLanguage} → ${localConfig.sourceLanguage} — transcription only` });
    }

    if (result.status.asrFallback) {
      notices.push({ channel: 'info', message: `Using ${result.status.asrModelId} instead of ${result.status.asrOriginalModelId} for ASR` });
    }

    return result.config;
  }

  return config;
}

describe('GOLDEN: buildParticipantSessionConfig ≡ old createParticipantSessionConfig', () => {
  const shell = { textOnly: false, keepReplayAudio: false };

  it('produces identical config and notices for every registered descriptor on default slices', () => {
    expect(ProviderConfigFactory.getAvailableProviders().length).toBe(14);
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = DEFAULTS_BY_SLICE[d.settingsSliceKey];
      const oldNotices: ParticipantNotice[] = [];
      const oldConfig = oldCreateParticipantSessionConfig(id, slice, 'swapped-instr', shell, oldNotices);
      const res = d.buildParticipantSessionConfig(slice, 'swapped-instr', { keepReplayAudio: shell.keepReplayAudio });
      expect(res.config, `config equal for ${id}`).toEqual(oldConfig);
      expect(res.notices, `notices equal for ${id}`).toEqual(oldNotices);
    }
  });

  // Controller addition resolving a review note: a Push-to-Talk slice is the
  // discriminating input that proves the Auto-forcing override actually
  // forces — a slice already defaulting to Auto can't tell "forced" apart
  // from "forwarded".
  it('gemini: Push-to-Talk in the slice is still forced to Auto for the participant', () => {
    const id = Provider.GEMINI;
    const d = ProviderConfigFactory.getDescriptor(id);
    const slice = { ...defaultGeminiSettings, turnDetectionMode: 'Push-to-Talk' as const };
    const oldNotices: ParticipantNotice[] = [];
    const oldConfig = oldCreateParticipantSessionConfig(id, slice, 'swapped-instr', shell, oldNotices);
    const res = d.buildParticipantSessionConfig(slice, 'swapped-instr', { keepReplayAudio: shell.keepReplayAudio });
    expect(res.config).toEqual(oldConfig);
    expect(res.notices).toEqual(oldNotices);
    // Sanity: this input actually discriminates — both sides must have
    // forced Auto, not merely forwarded the slice's Push-to-Talk mode.
    expect((res.config as (GeminiSessionConfig & { turnDetectionMode?: string }) | null)?.turnDetectionMode).toBe('Auto');
  });

  it('non-default-direction slices exercise the swap providers against real values', () => {
    const cases: Array<[Provider, unknown]> = [
      [Provider.SONIOX, { ...defaultSonioxSettings, sourceLanguage: 'zh', targetLanguage: 'en' }],
      [Provider.VOLCENGINE_AST2, { ...defaultVolcengineAST2Settings, sourceLanguage: 'ja', targetLanguage: 'ko' }],
      [Provider.PALABRA_AI, { ...defaultPalabraAISettings, sourceLanguage: 'en', targetLanguage: 'es-mx' }],
      [Provider.OPENAI_TRANSLATE, { ...defaultOpenAITranslateSettings, sourceLanguage: 'ja', targetLanguage: 'en' }],
    ];
    for (const [id, slice] of cases) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const oldNotices: ParticipantNotice[] = [];
      const oldConfig = oldCreateParticipantSessionConfig(id, slice, 'swapped-instr', shell, oldNotices);
      const res = d.buildParticipantSessionConfig(slice, 'swapped-instr', { keepReplayAudio: shell.keepReplayAudio });
      expect(res.config, `config equal for ${id}`).toEqual(oldConfig);
      expect(res.notices, `notices equal for ${id}`).toEqual(oldNotices);
    }
  });
});

describe('GOLDEN: mocked-local variants (same mock drives both the fixture and the descriptor)', () => {
  const shell = { textOnly: false, keepReplayAudio: false };

  beforeEach(() => {
    mockedLocalInference.mockReset();
    mockedLocalNative.mockReset();
  });

  function assertGolden(id: Provider, slice: unknown) {
    const d = ProviderConfigFactory.getDescriptor(id);
    const oldNotices: ParticipantNotice[] = [];
    const oldConfig = oldCreateParticipantSessionConfig(id, slice, 'swapped-instr', shell, oldNotices);
    const res = d.buildParticipantSessionConfig(slice, 'swapped-instr', { keepReplayAudio: shell.keepReplayAudio });
    expect(res.config, `config equal for ${id}`).toEqual(oldConfig);
    expect(res.notices, `notices equal for ${id}`).toEqual(oldNotices);
  }

  it('local_inference: success, translation available, no ASR fallback → config passthrough, no notices', () => {
    mockedLocalInference.mockReturnValue({
      success: true,
      config: { provider: 'local_inference', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalInferenceSessionConfig,
      status: {
        asrAvailable: true, asrModelId: 'sensevoice-int8', asrFallback: false,
        asrOriginalModelId: 'sensevoice-int8', translationAvailable: true, translationModelId: 'opus-mt-en-ja',
      },
    });
    assertGolden(Provider.LOCAL_INFERENCE, defaultLocalInferenceSettings);
  });

  it("local_inference: failure reason 'memory_exceeded' → null config + warning notice", () => {
    mockedLocalInference.mockReturnValue({
      success: false, reason: 'memory_exceeded',
      detail: 'Total RAM ~5000MB exceeds budget ~4000MB (device memory: 4GB)',
    });
    assertGolden(Provider.LOCAL_INFERENCE, defaultLocalInferenceSettings);
  });

  it("local_inference: failure reason 'no_asr' → null config + error notice", () => {
    mockedLocalInference.mockReturnValue({
      success: false, reason: 'no_asr', detail: 'No ASR model available for en',
    });
    assertGolden(Provider.LOCAL_INFERENCE, defaultLocalInferenceSettings);
  });

  it('local_inference: translationAvailable false → warning notice from the target → source template', () => {
    mockedLocalInference.mockReturnValue({
      success: true,
      config: { provider: 'local_inference' } as LocalInferenceSessionConfig,
      status: {
        asrAvailable: true, asrModelId: 'sensevoice-int8', asrFallback: false,
        asrOriginalModelId: 'sensevoice-int8', translationAvailable: false, translationModelId: null,
      },
    });
    assertGolden(Provider.LOCAL_INFERENCE, { ...defaultLocalInferenceSettings, sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  it('local_inference: asrFallback → info notice from the exact template', () => {
    mockedLocalInference.mockReturnValue({
      success: true,
      config: { provider: 'local_inference' } as LocalInferenceSessionConfig,
      status: {
        asrAvailable: true, asrModelId: 'sensevoice-int8', asrFallback: true,
        asrOriginalModelId: 'whisper-large', translationAvailable: true, translationModelId: 'opus-mt-ja-en',
      },
    });
    assertGolden(Provider.LOCAL_INFERENCE, defaultLocalInferenceSettings);
  });

  it('local_native: success, translation available → config passthrough, no notices', () => {
    mockedLocalNative.mockReturnValue({
      success: true, translationAvailable: true,
      config: { provider: 'local_native', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalNativeSessionConfig,
    });
    assertGolden(Provider.LOCAL_NATIVE, defaultLocalNativeSettings);
  });

  it('local_native: failure → null config + error notice', () => {
    mockedLocalNative.mockReturnValue({
      success: false, reason: 'no_asr', detail: 'No ASR model available for en',
    });
    assertGolden(Provider.LOCAL_NATIVE, defaultLocalNativeSettings);
  });

  it('local_native: translationAvailable false → warning notice from the source → target template (direction differs from local_inference)', () => {
    mockedLocalNative.mockReturnValue({
      success: true, translationAvailable: false,
      config: { provider: 'local_native', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalNativeSessionConfig,
    });
    assertGolden(Provider.LOCAL_NATIVE, defaultLocalNativeSettings);
  });
});
