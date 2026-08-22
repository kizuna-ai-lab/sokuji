import { ProviderConfig, ModelOption } from './ProviderConfig';
import { getTranslationSourceLanguages } from '../../lib/local-inference/modelManifest';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions, ParticipantNotice, ParticipantSessionResult, PreparePorts, PrepareOutcome } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, LocalInferenceSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { LocalInferenceClient } from '../clients/LocalInferenceClient';
import { createParticipantLocalInferenceConfig } from './localParticipantConfig';
import { guardAstCrossStage } from './astGuard';
import type { Selections } from '../../lib/local-inference/selection/types';
// localParticipantConfig.ts (imported above) already statically imports
// modelStore, so this introduces no new import-graph risk — mirrors
// LocalNativeProviderConfig.ts's static useNativeModelStore import.
import { useModelStore } from '../../stores/modelStore';
import i18n from '../../locales';

// Local Inference Settings
export interface LocalInferenceSettings {
  /** Per-direction model choices, keyed `src→tgt`. '' in any stage means auto. */
  selections: Selections;
  ttsSpeakerId: number;
  ttsSpeed: number;
  edgeTtsVoice: string;    // Edge TTS voice ShortName (e.g. 'en-US-AvaMultilingualNeural'), '' for auto-select
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
  vadThreshold: number;         // 0.0-1.0, default 0.3 (matching vad-web)
  vadNegativeThreshold: number; // 0.0-1.0, 0 = derive from vadThreshold (vad-web workers only)
  vadMinSilenceDuration: number; // seconds, default 1.4 (redemptionMs in vad-web)
  vadMinSpeechDuration: number;  // seconds, default 0.4 (matching vad-web)
  useTemplateMode: boolean;            // true = Simple (default), false = Advanced
  systemPrompt: string;                // Advanced-mode speaker prompt (default '')
  participantSystemPrompt: string;     // Advanced-mode participant prompt (default '', empty = fall back to speaker)
}

export const defaultLocalInferenceSettings: LocalInferenceSettings = {
  selections: {},
  ttsSpeakerId: 0,
  ttsSpeed: 1.0,
  edgeTtsVoice: '',  // Auto-select based on target language
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  turnDetectionMode: 'Auto',
  vadThreshold: 0.3,
  vadNegativeThreshold: 0,   // auto: vadThreshold - 0.15
  vadMinSilenceDuration: 1.4,
  vadMinSpeechDuration: 0.4,
  useTemplateMode: true,
  systemPrompt: '',
  participantSystemPrompt: '',
};

/**
 * Provider configuration for Local (Offline) inference.
 * Uses sherpa-onnx ASR + Opus-MT translation + Piper TTS.
 *
 * Languages are derived dynamically from the model manifest.
 */
export class LocalInferenceProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'localInference';
  readonly supportsWebRTC = false;

  // LocalInference has no credentials by design — settingsStore's LOCAL_INFERENCE
  // arm short-circuits validateApiKey before extractCredentials is ever called
  // (gates on modelStore instead), so this always reports ok with an empty primary.
  async extractCredentials(_slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    return { ok: true, primary: '' };
  }

  peekPrimaryCredential(): string {
    return '';
  }

  createClient(_creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new LocalInferenceClient();
  }

  // Readiness for LOCAL_INFERENCE is model-based, not credential-based: settingsStore's
  // LOCAL_INFERENCE arm short-circuits before ever calling this (it gates on modelStore,
  // settingsStore.ts:1206-1271, untouched by this plan).
  async validateAndFetchModels(_creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    return { validation: { valid: false, message: 'local inference readiness is model-based', validating: false }, models: [] };
  }

  /** Pre-start model-readiness revalidation. validateApiKey is the single
   *  authority for session readiness — auto-select, model readiness, key
   *  validation — and it must run as the STORE action (its isApiKeyValid
   *  write is what closes the Start gate and flips the subtitle window to
   *  'blocked' on failure), so it arrives here through ports.revalidate. */
  async prepareToStart(_slice: unknown, ports: PreparePorts): Promise<PrepareOutcome> {
    const result = await ports.revalidate();
    if (result.valid) return { ok: true };
    return {
      ok: false,
      message: result.message
        || i18n.t('settings.localInferenceModelsRequired', 'Required models not available for selected language pair.'),
    };
  }

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as LocalInferenceSettings;
    // Selections is the only source now: resolve() already folds explicit-vs-
    // auto, language compatibility, download status, and hardware gating into
    // a single verdict per stage — the ad hoc "current if still compatible,
    // else first language match" TTS fallback and the translation `||`
    // fallback this replaced never considered readiness at all; they only
    // worked because validateApiKey's now-removed corrections kept the flat
    // fields in sync with the resolver beforehand.
    const rawResolved = useModelStore.getState().resolve(
      settings.sourceLanguage, settings.targetLanguage, settings.selections);
    // AST cross-stage guard: an explicit translation pick that is really an
    // AST-capable ASR model only stays AST-eligible if it also matches the
    // resolved ASR — otherwise it would reach LocalInferenceClient as a
    // translationModelId with no ASR match, silently falling out of AST mode
    // into a real TranslationEngine built against AST-only files. See
    // astGuard.ts.
    const resolved = guardAstCrossStage(
      settings.sourceLanguage, settings.targetLanguage, settings.selections, rawResolved);

    // wrapTranscript must match the instructions actually in use. The default prompt
    // (buildDefaultLocalPrompt) references "<transcript> tags", so if the instructions
    // came from it, the user message MUST be wrapped. This catches the Advanced-mode
    // empty-field fallback case where the selector quietly returns the default prompt
    // but settings.useTemplateMode is still false.
    const defaultFwd = buildDefaultLocalPrompt(settings.sourceLanguage, settings.targetLanguage);
    const defaultRev = buildDefaultLocalPrompt(settings.targetLanguage, settings.sourceLanguage);
    const instructionsAreDefault = systemInstructions === defaultFwd || systemInstructions === defaultRev;
    const wrapTranscript = settings.useTemplateMode || instructionsAreDefault;

    return {
      provider: 'local_inference',
      model: 'local-asr-translate',
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      // asrModelId is non-optional on LocalInferenceSessionConfig — a missing
      // resolution becomes '' exactly like the old empty-string field did; the
      // Start gate already blocks a session whose speaker ASR can't resolve.
      asrModelId: resolved.asr?.modelId ?? '',
      translationModelId: resolved.translation?.modelId,
      ttsModelId: resolved.tts?.modelId,
      ttsSpeakerId: settings.ttsSpeakerId,
      ttsSpeed: settings.ttsSpeed,
      edgeTtsVoice: settings.edgeTtsVoice || undefined,
      vadThreshold: settings.vadThreshold,
      vadNegativeThreshold: settings.vadNegativeThreshold,
      vadMinSilenceDuration: settings.vadMinSilenceDuration,
      vadMinSpeechDuration: settings.vadMinSpeechDuration,
      turnDetectionMode: settings.turnDetectionMode,
      wrapTranscript,
    } as LocalInferenceSessionConfig;
  }

  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult {
    const base = super.buildParticipantSessionConfig(slice, swappedInstructions, shell);
    const localConfig = base.config as LocalInferenceSessionConfig;
    const result = createParticipantLocalInferenceConfig(localConfig, (slice as LocalInferenceSettings).selections);

    if (!result.success) {
      const channel: ParticipantNotice['channel'] = result.reason === 'memory_exceeded' ? 'warning' : 'error';
      return { config: null, notices: [{ channel, message: result.detail }] };
    }

    const notices: ParticipantNotice[] = [];

    if (!result.translationAvailable) {
      notices.push({ channel: 'warning', message: `No translation model for ${localConfig.targetLanguage} → ${localConfig.sourceLanguage} — transcription only` });
    }

    return { config: result.config, notices };
  }

  private static readonly MODELS: ModelOption[] = [
    { id: 'local-asr-translate', type: 'realtime' },
  ];

  getConfig(): ProviderConfig {
    return {
      id: 'local_inference',
      displayName: 'Local (Offline)',

      apiKeyLabel: '',
      apiKeyPlaceholder: '',

      languages: getTranslationSourceLanguages(),
      voices: [],
      models: LocalInferenceProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: false,
        hasTurnDetection: false,
        hasVoiceSettings: false,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        textOnlyCapability: 'optional',

        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: false,
          hasSemanticEagerness: false,
        },

        temperatureRange: { min: 0.0, max: 1.0, step: 0.1 },
        maxTokensRange: { min: 1, max: 4096, step: 1 },

        pushGatedModes: ['Push-to-Talk', 'Push-to-Translate'],
        supportsTextInput: true,
        usesLocalPromptTemplate: true,
        // Silero VAD needs a 700 ms silence tail to detect end-of-speech;
        // createResponse always follows — for streaming ASR it flushes the
        // pending utterance, for offline ASR it is harmless.
        pttFinalization: { silenceTailFrames: 7, response: 'always' },
      },
    };
  }
}
