import { ProviderConfig, ModelOption } from './ProviderConfig';
import { getTranslationSourceLanguages, getManifestEntry, getTtsModelsForLanguage, getTranslationModel } from '../../lib/local-inference/modelManifest';
import { buildDefaultLocalPrompt } from '../../lib/local-inference/prompts';
import { BaseProviderDescriptor, Credentials, CredentialCtx, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, LocalInferenceSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { LocalInferenceClient } from '../clients/LocalInferenceClient';

// Local Inference Settings
export interface LocalInferenceSettings {
  asrModel: string;
  translationModel: string; // '' (auto) | 'opus-mt-ja-en' | ...
  ttsModel: string;        // '' (auto) | 'piper-en' | 'piper-de'
  ttsSpeakerId: number;
  ttsSpeed: number;
  edgeTtsVoice: string;    // Edge TTS voice ShortName (e.g. 'en-US-AvaMultilingualNeural'), '' for auto-select
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
  vadThreshold: number;         // 0.0-1.0, default 0.3 (matching vad-web)
  vadMinSilenceDuration: number; // seconds, default 1.4 (redemptionMs in vad-web)
  vadMinSpeechDuration: number;  // seconds, default 0.4 (matching vad-web)
  useTemplateMode: boolean;            // true = Simple (default), false = Advanced
  systemPrompt: string;                // Advanced-mode speaker prompt (default '')
  participantSystemPrompt: string;     // Advanced-mode participant prompt (default '', empty = fall back to speaker)
}

export const defaultLocalInferenceSettings: LocalInferenceSettings = {
  asrModel: 'sensevoice-int8',
  translationModel: '',  // Auto-select based on language pair
  ttsModel: '',  // Auto-select based on target language
  ttsSpeakerId: 0,
  ttsSpeed: 1.0,
  edgeTtsVoice: '',  // Auto-select based on target language
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  turnDetectionMode: 'Auto',
  vadThreshold: 0.3,
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

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as LocalInferenceSettings;
    // Auto-select TTS model: use current if it supports the target language, otherwise find a matching one
    const currentTtsEntry = settings.ttsModel ? getManifestEntry(settings.ttsModel) : undefined;
    const isTtsCompatible = currentTtsEntry && (currentTtsEntry.multilingual || currentTtsEntry.languages.includes(settings.targetLanguage));
    const ttsModelId = isTtsCompatible ? settings.ttsModel : (getTtsModelsForLanguage(settings.targetLanguage)[0]?.id);

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
      asrModelId: settings.asrModel,
      translationModelId: settings.translationModel || getTranslationModel(settings.sourceLanguage, settings.targetLanguage)?.id,
      ttsModelId,
      ttsSpeakerId: settings.ttsSpeakerId,
      ttsSpeed: settings.ttsSpeed,
      edgeTtsVoice: settings.edgeTtsVoice || undefined,
      vadThreshold: settings.vadThreshold,
      vadMinSilenceDuration: settings.vadMinSilenceDuration,
      vadMinSpeechDuration: settings.vadMinSpeechDuration,
      turnDetectionMode: settings.turnDetectionMode,
      wrapTranscript,
    } as LocalInferenceSessionConfig;
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
      },
    };
  }
}
