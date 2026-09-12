import { ProviderConfig, ModelOption, VoiceOption } from './ProviderConfig';
import { BaseProviderDescriptor, Credentials, ClientOptions } from './ProviderDescriptor';
import { IClient, FilteredModel, SessionConfig, OpenAILiveSessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { OpenAILiveClient, LIVE_MODEL } from '../clients/OpenAILiveClient';
import { OpenAIProviderConfig } from './OpenAIProviderConfig';

// OpenAI Live settings (gpt-live-1 on the Live API, WebSocket only).
export interface OpenAILiveSettings {
  apiKey: string;
  // Both languages only render the interpreter template and drive the
  // participant swap; Live has no language field. 'auto' is allowed.
  sourceLanguage: string;
  targetLanguage: string;
  voice: string;
  // Client-side utterance segmentation in seconds (0.1–3.0). Live has no
  // per-response done events; transcript deltas inside one sentence can be
  // 1.5 s apart, hence the higher assistant default than translate's 0.5 s.
  userSilenceDuration: number;
  assistantSilenceDuration: number;
}

export const defaultOpenAILiveSettings: OpenAILiveSettings = {
  apiKey: '',
  sourceLanguage: 'en',
  targetLanguage: 'zh_CN',
  voice: 'marin',
  userSilenceDuration: 1.0,
  assistantSilenceDuration: 1.5,
};

/** The 10 Realtime voices plus the 12 Live added (English / Brazilian Portuguese). */
export const LIVE_VOICES: VoiceOption[] = [
  ...OpenAIProviderConfig.VOICES,
  { name: 'Quartz', value: 'quartz' },
  { name: 'Ripple', value: 'ripple' },
  { name: 'Vesper', value: 'vesper' },
  { name: 'Willow', value: 'willow' },
  { name: 'Stone', value: 'stone' },
  { name: 'Gleam', value: 'gleam' },
  { name: 'Meridian', value: 'meridian' },
  { name: 'Bossa', value: 'bossa' },
  { name: 'Tempo', value: 'tempo' },
  { name: 'Beacon', value: 'beacon' },
  { name: 'Delta', value: 'delta' },
  { name: 'Cinder', value: 'cinder' },
];

/**
 * OpenAI Live provider — gpt-live-1 as a simultaneous interpreter. Prompt-driven
 * (the rendered interpreter template is the whole control surface), full-duplex,
 * transcribes both sides natively, billed per session minute including silence.
 * Design: docs/superpowers/specs/2026-09-12-openai-live-provider-design.md
 */
export class OpenAILiveProviderConfig extends BaseProviderDescriptor {
  readonly settingsSliceKey: string = 'openaiLive';
  readonly supportsWebRTC: boolean = false;

  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new OpenAILiveClient(creds.primary);
  }

  async validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }> {
    if (!creds.ok) {
      return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
    }
    return OpenAILiveClient.validateApiKeyAndFetchModels(creds.primary);
  }

  latestRealtimeModel(models: FilteredModel[]): string {
    return models[0]?.id ?? LIVE_MODEL;
  }

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as OpenAILiveSettings;
    return {
      provider: 'openai_live',
      model: LIVE_MODEL,
      voice: settings.voice,
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      userSilenceDurationMs: Math.round(settings.userSilenceDuration * 1000),
      assistantSilenceDurationMs: Math.round(settings.assistantSilenceDuration * 1000),
    } as OpenAILiveSessionConfig;
  }

  private static readonly MODELS: ModelOption[] = [
    { id: LIVE_MODEL, type: 'realtime' },
  ];

  /**
   * Live has no language fields: a participant leg's direction is only the
   * rendered template with source and target swapped, and an `auto` source
   * renders as the literal word "auto" as that leg's target language. Saying
   * true puts Live behind the existing Start gate (`autoSourceParticipantBlocked`)
   * whenever a participant channel is in scope, which is what that gate is for.
   */
  reversesDirectionViaSourceLanguage(_model: string | null | undefined): boolean {
    return true;
  }

  getConfig(): ProviderConfig {
    return {
      id: 'openai_live',
      displayName: 'OpenAI Live',
      apiKeyLabel: 'OpenAI API Key',
      apiKeyPlaceholder: 'sk-...',

      languages: OpenAIProviderConfig.LANGUAGES,
      voices: LIVE_VOICES,
      models: OpenAILiveProviderConfig.MODELS,
      noiseReductionModes: [],
      transcriptModels: [],

      capabilities: {
        hasTemplateMode: true,
        hasTurnDetection: false,
        hasVoiceSettings: true,
        hasNoiseReduction: false,
        hasModelConfiguration: false,
        hasReasoningEffort: false,
        textOnlyCapability: 'never',

        // No server-side turn detection; only the client-side segmentation
        // sliders render (hasSilenceDuration), as for OpenAI Translate.
        turnDetection: {
          modes: [],
          hasThreshold: false,
          hasPrefixPadding: false,
          hasSilenceDuration: true,
          hasSemanticEagerness: false,
        },

        // Unused — the flags above hide the sections; required by the type.
        temperatureRange: { min: 0, max: 0, step: 0 },
        maxTokensRange: { min: 0, max: 0, step: 0 },
      },
    };
  }
}
