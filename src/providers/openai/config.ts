/**
 * OpenAI Realtime's `C`, `build` and `describe` (survey §2.10). One builder
 * for both legs: the participant is the same call on the reversed
 * direction, so its prompt (Other's, in Advanced mode) and its
 * transcription hint follow from `context` — the old participant overrides
 * (`OpenAIProviderConfig.ts:174-189`, `ProviderDescriptor.ts:389-407`) are
 * gone. Its automatic detection is the user's own (ruling 4), and it speaks
 * when its switch is on (ruling 15): `context.speech` says so.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import {
  effectiveRealtimeModel, realtimeLanguageName, REALTIME_DEFAULTS, REALTIME_DEFAULT_VOICE, REALTIME_MAX_TOKENS_RANGE, REALTIME_PREFIX_RANGE,
  REALTIME_SILENCE_RANGE, REALTIME_THRESHOLD_RANGE, takesReasoning, type NoiseReduction, type ReasoningEffort, type RealtimeSettings,
} from './settings';
import { buildTranscriptionHint, type TranscriptionHint } from './transcription';

/** Automatic detection as the wire takes it (`openAIRealtimeSession.ts:13-41`); the adapter adds `create_response: true, interrupt_response: false`. */
export type TurnDetection =
  | { type: 'server_vad'; threshold: number; prefixPaddingMs: number; silenceDurationMs: number }
  | { type: 'semantic_vad'; eagerness: 'auto' | 'low' | 'medium' | 'high' };

export interface RealtimeConfig {
  /** The effective model (`effectiveRealtimeModel` over this run's own check, F2), in the socket's `?model=`. */
  model: string;
  /** This direction's prompt: the session's, and the drift anchor's (ruling 2). */
  instructions: string;
  /** Audio out, or text only: `context.speech`. */
  modalities: ['audio'] | ['text'];
  /** A leg that speaks: a prebuilt voice. */
  voice?: string;
  maxTokens: number | 'inf';
  /** Manual turns: `null`, the client commits. Auto: the user's mechanism and knobs, the participant's too (ruling 4). */
  turnDetection: TurnDetection | null;
  /** From this direction's source (D17): the participant's hint is for the language it hears. */
  transcription: TranscriptionHint;
  /** Transcription only (`context.translate === false`): no response is ever created, so nothing translates or speaks; only the input transcription runs. */
  transcribeOnly: boolean;
  /** `null` turns it off (ruling 16). */
  noiseReduction: 'near_field' | 'far_field' | null;
  /** A `gpt-realtime-2*` model only. */
  reasoningEffort?: ReasoningEffort;
  /** WebSocket only (ruling 12; choice 18): the owner abandoned WebRTC for this provider (2026-09-29). It reaches `info.transport`, which analytics reports. */
  transport: 'websocket';
}

/** Sent only because the session wants instructions; no response is ever asked for under it. */
export const TRANSCRIBE_ONLY_INSTRUCTIONS = 'Transcription only. Do not respond.';

const NOISE: Readonly<Record<NoiseReduction, RealtimeConfig['noiseReduction']>> = {
  None: null,
  'Near field': 'near_field',
  'Far field': 'far_field',
};

const clamp = (v: number, range: { min: number; max: number }, fallback: number) => (Number.isFinite(v) ? Math.min(range.max, Math.max(range.min, v)) : fallback);

export function buildRealtime(context: SessionContext, s: RealtimeSettings, shared: SharedSettings): RealtimeConfig | ProviderRefusal {
  const model = effectiveRealtimeModel(s, shared.models);
  // A guard: the runner builds only after a ready answer, whose list is never empty.
  if (!model) return { refused: 'No OpenAI Realtime model is available to this key.', code: 'models_required' };
  const { source, target } = context.direction;
  // The participant's direction reads Other's prompt, as Gemini's and LocalInference's builders do.
  const instructions = resolveInstructions(s, { participant: shared.reversed(context.direction), source: realtimeLanguageName(source), target: realtimeLanguageName(target) });
  const transcribeOnly = context.translate === false;
  const turnDetection: TurnDetection | null = context.turns === 'manual'
    ? null
    : s.turnDetectionMode === 'Semantic'
      ? { type: 'semantic_vad', eagerness: s.semanticEagerness.toLowerCase() as 'auto' | 'low' | 'medium' | 'high' }
      : {
          type: 'server_vad',
          threshold: clamp(s.threshold, REALTIME_THRESHOLD_RANGE, REALTIME_DEFAULTS.threshold),
          // Seconds as stored, milliseconds on the wire (`openAIRealtimeSession.ts:31-35`).
          prefixPaddingMs: Math.round(clamp(s.prefixPadding, REALTIME_PREFIX_RANGE, REALTIME_DEFAULTS.prefixPadding) * 1000),
          silenceDurationMs: Math.round(clamp(s.silenceDuration, REALTIME_SILENCE_RANGE, REALTIME_DEFAULTS.silenceDuration) * 1000),
        };
  return {
    model,
    instructions: transcribeOnly ? TRANSCRIBE_ONLY_INSTRUCTIONS : instructions,
    modalities: context.speech && !transcribeOnly ? ['audio'] : ['text'],
    transcribeOnly,
    ...(context.speech && !transcribeOnly ? { voice: s.voice || REALTIME_DEFAULT_VOICE } : {}),
    // Every knob falls back to its default on a value that is not a finite number; maxTokens' default is 'inf' (unlimited).
    maxTokens: s.maxTokens === 'inf' || !Number.isFinite(s.maxTokens) ? 'inf' : Math.round(clamp(s.maxTokens, REALTIME_MAX_TOKENS_RANGE, REALTIME_MAX_TOKENS_RANGE.max)),
    turnDetection,
    transcription: buildTranscriptionHint(s.transcriptModel, source, s.transcriptKeywords),
    noiseReduction: NOISE[s.noiseReduction],
    ...(takesReasoning(model) ? { reasoningEffort: s.reasoningEffort } : {}),
    // Every session runs over WebSocket (ruling 12): a stored `transportType`, `webrtc` included, is not read into `S`.
    transport: 'websocket',
  };
}

/** Two models: the translation's and the source transcript's (choice 20); the old start event named neither. */
export function describeRealtime(c: RealtimeConfig): { translationModel: string; asrModel: string } {
  return { translationModel: c.model, asrModel: c.transcription.model };
}
