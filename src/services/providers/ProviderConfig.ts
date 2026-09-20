import type { TransportType } from './ProviderDescriptor';
import type { SegmentationOffer } from '../../lib/segmentation/segmentationMode';

export interface LanguageOption {
  name: string;
  value: string;
  englishName: string;
}

export interface VoiceOption {
  name: string;
  value: string;
}

export interface ModelOption {
  id: string;
  type: 'realtime' | 'text' | 'multimodal';
}

export interface TurnDetectionConfig {
  modes: string[];
  hasThreshold: boolean;
  hasPrefixPadding: boolean;
  hasSilenceDuration: boolean;
  hasSemanticEagerness: boolean;
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ProviderCapabilities {
  // Core features
  hasTemplateMode: boolean;
  hasTurnDetection: boolean;
  hasVoiceSettings: boolean;
  hasNoiseReduction: boolean;
  hasModelConfiguration: boolean;
  textOnlyCapability: 'always' | 'optional' | 'never'; // 'always': inherently text-only, 'optional': user can toggle, 'never': not supported

  // Turn detection specific
  turnDetection: TurnDetectionConfig;

  // Supported ranges
  temperatureRange: { min: number; max: number; step: number };
  maxTokensRange: { min: number; max: number; step: number };

  // Reasoning effort (only applies to specific models, e.g. gpt-realtime-2).
  // When true, the provider config must also list `reasoningEfforts`. UI
  // gates rendering on this flag plus the currently-selected model.
  hasReasoningEffort?: boolean;

  // Whether this provider's session can carry a transcription keyword glossary.
  // Model support is not sufficient on its own: OpenAI Translate runs
  // `gpt-live-transcribe`, which accepts `keywords` in a voice-agent session,
  // but the /v1/realtime/translations endpoint rejects the field outright. UI
  // gates the glossary input on this flag plus the selected model, so that
  // provider does not render a control that could never take effect.
  hasTranscriptKeywords?: boolean;

  // ── S1 capability flags (spec: 2026-08-13-mainpanel-provider-seams) ──
  // Optional: only descriptors that deviate from the default declare them.
  // Kizuna twins and OpenAI-Compatible inherit via their `...base` spread.

  /** Speech-mode names from THIS provider's settings vocabulary that send
   *  audio only while the user holds Space. Encodes that 'Disabled' is
   *  OpenAI's spelling of push-to-talk. Undefined ⇒ no push-gated modes. */
  pushGatedModes?: string[];

  /** Provider accepts typed text input into a live session. Undefined ⇒ no. */
  supportsTextInput?: boolean;

  /** Text typed while the AI is responding is queued and flushed after
   *  response.done (capacity 1). Undefined ⇒ sent immediately. */
  queuesTextWhileResponding?: boolean;

  /** System instructions come from the local prompt template
   *  (getProcessedLocalPrompt) instead of the shared builder. Undefined ⇒ shared. */
  usesLocalPromptTemplate?: boolean;

  /** How a push-to-talk segment is finalized on release. Undefined ⇒
   *  { response: 'voice-gated' }: createResponse() only when enough voiced
   *  chunks were captured, otherwise skip.
   *  - silenceTailFrames: 100 ms zero frames appended first so a server/local
   *    VAD detects end-of-speech.
   *  - 'always': createResponse() unconditionally (local Silero VAD — for
   *    streaming ASR it flushes the pending utterance; for offline ASR it is
   *    harmless, the silence frames handle it).
   *  - 'server-decides': no client call; the server's own VAD closes the turn.
   *  - 'voice-gated-cancel': like the default, but too-little speech actively
   *    cancels the turn (cancelPttTurn) so no response is generated for silence. */
  pttFinalization?: {
    silenceTailFrames?: number;
    response: 'always' | 'server-decides' | 'voice-gated' | 'voice-gated-cancel';
  };

  /** Transport this provider must run on, overriding the user preference. */
  forcedTransport?: TransportType;

  /** Which segmentation choices this provider offers; the three fields are
   *  documented on `SegmentationOffer`, the type this IS, so the capability
   *  cannot drift from what the mode resolvers take. Absent means the default
   *  `{ pause: false, auto: true, sizes: false }`: a provider whose
   *  boundaries a server decides. Read it through `resolveSegmentationOffer`
   *  below, never field by field, so that default is applied in exactly one
   *  place.
   *
   *  All three or none, deliberately — not a `Partial`. A half-declared
   *  `{ sizes: true }` would take `auto: true` from the default and describe
   *  `{ pause: false, auto: true, sizes: true }`, the one combination
   *  `segmentationForProvider` throws on, inside a `useMemo` during
   *  MainPanel's render. A white screen is not how a descriptor should learn
   *  it forgot a field. */
  segmentation?: SegmentationOffer;
}

/**
 * The segmentation choices a provider actually offers: what its descriptor
 * declared, or the default when it declared nothing. A descriptor declares
 * all three fields or none, so there is nothing to fill in field by field.
 *
 * The default describes a provider whose boundaries a server decides — no
 * silence timer of ours cuts its bubbles, and phase 1 cannot split a segment
 * the server already called final, so Auto is the only thing left. That is
 * the common case, which is why only the descriptors that deviate declare
 * anything; the resolved answer for every one of them is tabulated in
 * `descriptorRegistry.test.ts`, where a provider added later has to write its
 * row rather than inherit a default nobody thought about.
 */
export function resolveSegmentationOffer(caps: ProviderCapabilities): SegmentationOffer {
  const declared = caps.segmentation;
  return {
    pause: declared?.pause ?? false,
    auto: declared?.auto ?? true,
    sizes: declared?.sizes ?? false,
  };
}

export interface ProviderConfig {
  // Basic info
  id: 'openai' | 'gemini' | string;
  displayName: string;

  // API configuration
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  requiresAuth?: boolean; // True if this provider requires backend authentication
  supportsCustomEndpoint?: boolean; // True if this provider supports custom API endpoint
  customEndpointLabel?: string; // Label for custom endpoint input
  customEndpointPlaceholder?: string; // Placeholder for custom endpoint input
  
  // Supported options
  languages: LanguageOption[];
  // When defined, target language dropdown uses this restricted list instead of `languages`.
  // Used by providers that support a different (typically smaller) set of target languages
  // than source languages — e.g. gpt-realtime-translate has 13 target languages.
  targetLanguages?: LanguageOption[];
  voices: VoiceOption[];
  models: ModelOption[];
  noiseReductionModes: string[];
  transcriptModels: string[];
  reasoningEfforts?: ReasoningEffort[];

  // Capabilities
  capabilities: ProviderCapabilities;
}

 