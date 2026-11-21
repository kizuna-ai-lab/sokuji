/**
 * Soniox's `C`, `build` and `describe` (survey §2.7): the text side's
 * config, and the voice and speed its speech unit is built with. `build` never
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
  /** Both mode on one mixed socket (D23); read by `startBoth`. */
  sharedBoth: boolean;
  /** Face-to-face: two people at one microphone (slice 3). Absent: false. */
  faceToFace?: true;
  /** The participant's leg, unless speaker labels are off: its utterances carry their people, and its own socket asks for them (the shared socket always does, to tell the sides apart). */
  diarize: boolean;
  /**
   * The unit serves transcription alone (`buildSonioxAlone`): another unit translates what it hears. The socket is
   * asked for no translation, only source segments are said, and each states how much of it is final. Absent: the
   * socket transcribes and translates.
   */
  transcribesAlone?: true;
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
export function sonioxContext(words: SessionWords | undefined, o: { translations?: false } = {}): SonioxWireContext | undefined {
  // Without translations (a socket that transcribes alone): the entries count against the limit as terms alone.
  const entries = o.translations === false ? (words?.entries ?? []).map(({ translation: _translation, ...entry }) => entry) : words?.entries ?? [];
  const w = wordsFor('soniox', entries, words?.background ?? '');
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

/** What one leg's speech is asked with: its voice and its speaking speed. */
export interface SonioxTtsConfig { voice: string; speed: number }

/** A leg's own voice and speed: the participant's voice on the participant's leg. */
export function sonioxTts(context: SessionContext, s: SonioxSettings, shared: SharedSettings): SonioxTtsConfig {
  const speakerVoice = sonioxSpeakerVoice(s);
  // Chosen here, by leg: a lone leg's adapter session cannot tell which leg it serves.
  const voice = shared.reversed(context.direction) ? participantVoiceFor(s, speakerVoice) : speakerVoice;
  return { voice, speed: clampNumber(s.ttsSpeed, 0.7, 1.3, 1.0) };
}

/** The model a leg's speech names. */
export function describeSonioxTts(): { ttsModel: string } {
  return { ttsModel: SONIOX_TTS_MODEL };
}

/** One leg's config over the context its socket is sent. */
function configWith(wire: SonioxWireContext | undefined, context: SessionContext, s: SonioxSettings, shared: SharedSettings): SonioxConfig {
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
    // Face-to-face is one microphone: there is nothing to split.
    sharedBoth: sonioxSharedBoth(shared.faceToFace === true, s),
    ...(shared.faceToFace ? { faceToFace: true as const } : {}),
    // The participant's leg (D4). The context names no leg, so a pair into its
    // own language labels both: a lone voice stays unlabelled anyway.
    diarize: s.speakerLabels && shared.reversed(context.direction),
  };
}

export function buildSoniox(context: SessionContext, s: SonioxSettings, shared: SharedSettings): SonioxConfig {
  return configWith(sonioxContext(shared.words), context, s, shared);
}

/**
 * The config of the unit that transcribes alone (step 4, R9): the same socket and the same knobs, asked for no
 * translation. The word list's translations are left out, its terms and the background stay (R13). Never one
 * shared socket for Both and never face-to-face: a leg whose translation is another unit's has a socket of its
 * own. Agent text follows the rule of a socket that also translates, split Both's included: in a run of both
 * legs none is asked for (`startSplit` strips it there; here each leg is started on its own, so the builder does).
 */
export function buildSonioxAlone(context: SessionContext, s: SonioxSettings, shared: SharedSettings): SonioxConfig {
  const { stt: { agentText, ...stt }, diarize } = configWith(sonioxContext(shared.words, { translations: false }), context, s, shared);
  return { stt: { ...stt, ...(agentText && !shared.bothLegs ? { agentText } : {}) }, sharedBoth: false, diarize, transcribesAlone: true };
}

/** The text side's model. The speech model is the voice's to name (`describeSonioxTts`). */
export function describeSoniox(c: SonioxConfig): { asrModel?: string } {
  return { asrModel: c.stt.model };
}
