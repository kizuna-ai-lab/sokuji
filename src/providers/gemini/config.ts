/**
 * Gemini's `C`, `build` and `describe` (survey §2.7). One builder for both
 * legs: the participant is the same call on the reversed direction, so its
 * prompt, its Live Translate target and its voice follow from `context` —
 * the old participant overrides (`GeminiProviderConfig.ts:101-130`,
 * `geminiTranslateModel.ts:85-105`) are gone. The participant speaks when
 * its switch is on (ruling 5): `context.speech` says so.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { clampSegmentPauseMs, segmentPauseMs } from '../../lib/segmentation/segmentationMode';
import {
  effectiveGeminiModel, geminiActivityHandling, geminiLanguageName, geminiLanguages, geminiTextInMarks, GEMINI_DEFAULTS, GEMINI_DEFAULT_VOICE,
  GEMINI_MAX_TOKENS_RANGE, GEMINI_TEMPERATURE_RANGE, GEMINI_TRANSLATE_TARGETS, GEMINI_VAD_PREFIX_RANGE, GEMINI_VAD_SILENCE_RANGE,
  isGeminiTranslateModel, type GeminiActivityHandling, type GeminiSettings,
} from './settings';

export interface GeminiConfig {
  /** The Live model: `effectiveGeminiModel` over this run's own check (F2). */
  model: string;
  /** A dialogue model ends its turns; Live Translate has none (survey §0.1). */
  kind: 'dialogue' | 'translate';
  /** This direction's prompt (ruling 4); absent when blank. */
  instructions?: string;
  /** A dialogue leg that speaks: a prebuilt voice. */
  voice?: string;
  /** Dialogue only: 0..2. */
  temperature?: number;
  /** Dialogue only, when not unlimited: 1..8192. */
  maxOutputTokens?: number;
  /** Live Translate only: the target, one of its own 78 codes as the pair holds it, which pins its output language (Gemini/AST2 follow-up, ruling 6). */
  translationTargetCode?: string;
  /** Manual turns: the client marks activity. Auto: the server detects it, with the user's knobs — the participant too (survey §1.9). */
  activity:
    | { manual: true }
    | { manual: false; start: 'high' | 'low'; end: 'high' | 'low'; silenceMs: number; prefixMs: number };
  /** What speech does to a response still playing, by the model's family (Gemini/AST2 follow-up, ruling 5; choice 9). */
  activityHandling: GeminiActivityHandling;
  /** Typed text sent alone under manual turns: wrapped in activity marks, by the model's family — a 3.x model refuses them with no audio (the owner's text probe, 2026-09-30). */
  textInMarks: boolean;
  /** Transcription only (`context.translate === false`): no translation or voice asked for, and the model's output is ignored. */
  transcribeOnly?: boolean;
  /** Live Translate only: each side's silence timer (the old continuous segmentation) and the mid-sentence deferral (choice 7). */
  silence?: { sourceMs: number; translationMs: number; deferMidSentence: boolean };
}

const clamp = (v: number, min: number, max: number, fallback: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Gemini Live cannot be told to produce nothing (native-audio models require AUDIO), so a dialogue model is told to stay silent. */
const TRANSCRIBE_ONLY_INSTRUCTIONS = 'You are a silent transcriber. Never answer, translate or speak; produce no output.';

export function buildGemini(context: SessionContext, s: GeminiSettings, shared: SharedSettings): GeminiConfig | ProviderRefusal {
  const model = effectiveGeminiModel(s, shared.models);
  // A guard: the runner builds only after a ready answer, whose list is never empty (survey §2.7).
  if (!model) return { refused: 'No Gemini Live model is available to this key.', code: 'models_required' };
  const kind = isGeminiTranslateModel(model) ? 'translate' : 'dialogue';
  const dialogue = kind === 'dialogue';
  const transcribeOnly = context.translate === false;
  const { source, target } = context.direction;
  // The offer follows the saved model; a saved dialogue model the check no longer lists runs as the default, Live Translate,
  // whose targets are fewer: such a target is refused in words, never sent (Gemini/AST2 follow-up, choice 18).
  if (!dialogue && !transcribeOnly && !GEMINI_TRANSLATE_TARGETS.some((o) => o.value === target)) {
    return { refused: `Live Translate does not translate into ${geminiLanguageName(target)}: choose another language, or a dialogue model.` };
  }
  // The participant's direction reads Other's prompt, as LocalInference's builder does (`localInference/config.ts:47-56`).
  const instructions = transcribeOnly ? TRANSCRIBE_ONLY_INSTRUCTIONS : resolveInstructions(s, { participant: shared.reversed(context.direction), source: geminiLanguageName(source), target: geminiLanguageName(target) });
  const activity: GeminiConfig['activity'] = context.turns === 'manual'
    ? { manual: true }
    : {
        manual: false,
        start: s.vadStartSensitivity,
        end: s.vadEndSensitivity,
        silenceMs: Math.round(clamp(s.vadSilenceDurationMs, GEMINI_VAD_SILENCE_RANGE.min, GEMINI_VAD_SILENCE_RANGE.max, GEMINI_DEFAULTS.vadSilenceDurationMs)),
        prefixMs: Math.round(clamp(s.vadPrefixPaddingMs, GEMINI_VAD_PREFIX_RANGE.min, GEMINI_VAD_PREFIX_RANGE.max, GEMINI_DEFAULTS.vadPrefixPaddingMs)),
      };
  return {
    model,
    kind,
    ...(instructions.trim() ? { instructions } : {}),
    // Live Translate reproduces the speaker's own voice and ignores a voice (`geminiTranslateModel.ts:25-27`); neither kind is voiced for a leg that does not speak.
    ...(dialogue && context.speech && !transcribeOnly ? { voice: s.voice || GEMINI_DEFAULT_VOICE } : {}),
    ...(dialogue ? { temperature: clamp(s.temperature, GEMINI_TEMPERATURE_RANGE.min, GEMINI_TEMPERATURE_RANGE.max, GEMINI_DEFAULTS.temperature) } : {}),
    // Every knob falls back to its default on a non-finite value; the
    // default here is 'inf' (unlimited), so a non-finite maxTokens omits
    // the field rather than sending some clamped number (fix round 1).
    ...(dialogue && s.maxTokens !== 'inf' && Number.isFinite(s.maxTokens)
      ? { maxOutputTokens: Math.round(clamp(s.maxTokens, GEMINI_MAX_TOKENS_RANGE.min, GEMINI_MAX_TOKENS_RANGE.max, GEMINI_MAX_TOKENS_RANGE.max)) }
      : {}),
    ...(transcribeOnly ? { transcribeOnly: true } : {}),
    ...(dialogue ? {} : {
      ...(transcribeOnly ? {} : { translationTargetCode: geminiLanguages.wire.toWire(target) }),
      silence: {
        sourceMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.sourceSeconds)),
        translationMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.translationSeconds)),
        deferMidSentence: shared.segmentation.mode === 'sentences',
      },
    }),
    activity,
    activityHandling: geminiActivityHandling(model),
    textInMarks: geminiTextInMarks(model),
  };
}

/** One model does all three stages: named once, as the translation model (choice 6). */
export function describeGemini(c: GeminiConfig): { translationModel: string } {
  return { translationModel: c.model };
}
