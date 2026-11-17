/**
 * Soniox's `C`, `build` and `describe` (survey §2.7). `build` never
 * refuses: an auto source with the participant leg is the gate's (D20).
 * The context is the app's word list (`wordsFor`), no longer Soniox's own
 * vocabulary settings.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { reportWarning } from '../../lib/diagnostics/report';
import { wordsFor } from '../../lib/words/forService';
import type { SessionWords, SharedSettings } from '../../lib/provider/types';
import { SONIOX_TTS_MODEL } from '../../lib/soniox/ttsCatalog';
import { participantVoiceFor, sonioxSharedBoth, sonioxSpeakerVoice, type SonioxSettings } from './settings';
import { SONIOX_STT_MODEL } from './sttStream';

/** The STT config frame's `context`, wire-shaped. */
export interface SonioxWireContext {
  terms?: string[];
  translation_terms?: Array<{ source: string; target: string }>;
  text?: string;
}

export interface SonioxConfig {
  stt: {
    model: string;
    /** Present when there is vocabulary or background; budgeted under Soniox's context limit. */
    context?: SonioxWireContext;
    endpointSensitivity: number;
    endpointLatencyAdjustmentLevel: number;
    endpointMaxDelayMs: number;
    /** Ask for agent text on this leg's socket: the speaker's leg, whose socket hears the microphone, in a run that speaks with the agent text setting on at Start (§4.3); split Both strips it (`startSplit`). Absent: off. */
    agentText?: true;
  };
  /** Present when this leg speaks, in this leg's own voice: the participant's leg in `participantVoice`. */
  tts?: { voice: string; speed: number };
  /** Both mode on one mixed socket (D23); read by `startBoth`. */
  sharedBoth: boolean;
  /** Face-to-face: two people at one microphone (slice 3). Absent: false. */
  faceToFace?: true;
  /** The participant's leg, unless speaker labels are off: its utterances carry their people, and its own socket asks for them (the shared socket always does, to tell the sides apart). */
  diarize: boolean;
}

export function clampNumber(value: unknown, min: number, max: number, dflt: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : dflt;
}

/**
 * The app's word list (spec §9) as Soniox's context, kept under its limit: the same for a live session and a file.
 * Absent when there is nothing to send. Its own old vocabulary is no longer read.
 */
export function sonioxContext(words: SessionWords | undefined): SonioxWireContext | undefined {
  const w = wordsFor('soniox', words?.entries ?? [], words?.background ?? '');
  if (w.leftOut > 0) {
    reportWarning('SonioxConfig', `The word list is over Soniox's context limit: ${w.leftOut} entries were left out`, { dedupeKey: 'soniox:context-budget' });
  }
  const wire: SonioxWireContext = {
    ...(w.terms ? { terms: w.terms } : {}),
    ...(w.translations ? { translation_terms: w.translations.map(([source, target]) => ({ source, target })) } : {}),
    ...(w.background ? { text: w.background } : {}),
  };
  return Object.keys(wire).length > 0 ? wire : undefined;
}

export function buildSoniox(context: SessionContext, s: SonioxSettings, shared: SharedSettings): SonioxConfig {
  const wire = sonioxContext(shared.words);
  const speakerVoice = sonioxSpeakerVoice(s);
  // Chosen here, by leg: a lone leg's adapter session cannot tell which leg it serves.
  const voice = shared.reversed(context.direction) ? participantVoiceFor(s, speakerVoice) : speakerVoice;
  return {
    stt: {
      model: SONIOX_STT_MODEL,
      ...(wire ? { context: wire } : {}),
      endpointSensitivity: clampNumber(s.endpointSensitivity, -1, 1, 0),
      endpointLatencyAdjustmentLevel: Math.round(clampNumber(s.endpointLatencyAdjustmentLevel, 0, 3, 0)),
      endpointMaxDelayMs: Math.round(clampNumber(s.endpointMaxDelayMs, 500, 3000, 2000)),
      // The narrow rule (spec 2026-11-05 §4.3): the flag alone made Soniox drop talk-over turns when speech echoed into the microphone, so only with the setting on.
      ...(!shared.reversed(context.direction) && shared.speaks === true && s.agentText === true ? { agentText: true as const } : {}),
    },
    ...(context.speech
      ? { tts: { voice, speed: clampNumber(s.ttsSpeed, 0.7, 1.3, 1.0) } }
      : {}),
    // Face-to-face is one microphone: there is nothing to split.
    sharedBoth: sonioxSharedBoth(shared.faceToFace === true, s),
    ...(shared.faceToFace ? { faceToFace: true as const } : {}),
    // The participant's leg (D4). The context names no leg, so a pair into its
    // own language labels both: a lone voice stays unlabelled anyway.
    diarize: s.speakerLabels && shared.reversed(context.direction),
  };
}

export function describeSoniox(c: SonioxConfig): { asrModel?: string; ttsModel?: string } {
  return { asrModel: c.stt.model, ...(c.tts ? { ttsModel: SONIOX_TTS_MODEL } : {}) };
}
