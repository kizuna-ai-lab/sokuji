/**
 * Kizuna AI's managed Soniox session-key request and the stream roles it
 * asks for (Stage 2 Kizuna Soniox, choice 19): the backend's matrix body
 * (`BE:config/soniox.ts:577-623`), in the order the old client sent it
 * (`ManagedSonioxSession.ts:707-711`), and its expansion into roles
 * (`BE:config/soniox.ts:372-393`). The floor (`kizunaBudget.ts`) prices
 * these roles and the lease (`lease.ts`) asks for them, so the two agree.
 *
 * Participant speech is built and shipped off (ruling 2): with the flag
 * on, the body carries the participant's intent and the roles gain
 * `par_tts`; with it off, the body is byte for byte today's.
 */
import type { LegName } from '../../lib/conversation/types';
import type { RunShape } from '../../lib/session/types';
import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
import type { SonioxSettings } from './settings';

/**
 * The body field asking for the participant's speech stream. The backend
 * reads fields by name and ignores unknown ones
 * (`BE:routes/soniox.ts:254-280`), but the name is its choice when it
 * mints `par_tts`: confirm it then ("turning it on", roadmap).
 */
export const PARTICIPANT_SPEECH_FIELD = 'participantSpeech';

export type SttRole = 'spk_stt' | 'par_stt' | 'mix_stt';
export type StreamRole = SttRole | 'spk_tts' | 'par_tts' | 'mix_tts';
export const STREAM_ROLES: readonly StreamRole[] = ['spk_stt', 'par_stt', 'mix_stt', 'spk_tts', 'par_tts', 'mix_tts'];
export const isSttRole = (role: StreamRole): role is SttRole => role.endsWith('_stt');
/** The audio a role carries — `spk` the microphone, `par` the far end, `mix` both — which pairs an STT key with its TTS key. */
export const sideOf = (role: StreamRole): string => role.slice(0, 3);

export interface LeaseRequest {
  mode: 'speaker' | 'participant' | 'both';
  /** The speaker's speech: `true` when there is none to speak, participant-only included. The backend defaults neither this nor `bothSplit`. */
  textOnly: boolean;
  bothSplit: boolean;
  region: SonioxRegion;
  /** Whether the participant speaks — present only while the participant-speech flag is on (ruling 2). */
  participantSpeaks?: boolean;
}

/** This start's request: its legs; the speaker's speech; split Both from the settings `startBoth` reads; the settings' region; and, the flag on, whether the participant speaks. */
export function leaseRequest(
  shape: Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech' | 'faceToFace'>,
  s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>,
  participantSpeech: boolean,
): LeaseRequest {
  const both = shape.legs.length === 2;
  return {
    mode: both ? 'both' : shape.legs[0] === 'participant' ? 'participant' : 'speaker',
    textOnly: !shape.legs.includes('speaker') || shape.textOnly,
    // Must agree with the adapter's `config.sharedBoth` (`startBoth`): both read the settings the run built from,
    // and face-to-face is always one shared stream (`buildSoniox`).
    bothSplit: both && !shape.faceToFace && !s.bothModeSharedSession,
    region: asSonioxRegion(s.region),
    ...(participantSpeech ? { participantSpeaks: shape.legs.includes('participant') && shape.participantSpeech } : {}),
  };
}

/** The JSON body: today's four fields, always and in today's order; then the participant's intent, only while the flag is on. */
export function requestBody(r: LeaseRequest): Record<string, unknown> {
  return {
    mode: r.mode,
    textOnly: r.textOnly,
    bothSplit: r.bothSplit,
    region: r.region,
    ...(r.participantSpeaks === undefined ? {} : { [PARTICIPANT_SPEECH_FIELD]: r.participantSpeaks }),
  };
}

/** The roles a request is minted: the backend's expansion today, and `par_tts` where the participant speaks (the future role). */
export function requestedRoles(r: LeaseRequest): StreamRole[] {
  const participantTts: StreamRole[] = r.participantSpeaks ? ['par_tts'] : [];
  if (r.mode === 'both' && !r.bothSplit) return ['mix_stt', ...(r.textOnly ? [] : ['mix_tts' as const]), ...participantTts];
  const speaker: StreamRole[] = r.mode === 'participant' ? [] : ['spk_stt', ...(r.textOnly ? [] : ['spk_tts' as const])];
  const participant: StreamRole[] = r.mode === 'speaker' ? [] : ['par_stt', ...participantTts];
  return [...speaker, ...participant];
}

/** The STT role a leg runs on; null for shared Both's participant, which rides the speaker's mixed socket. */
export function roleFor(r: LeaseRequest, leg: LegName): SttRole | null {
  if (r.mode === 'both' && !r.bothSplit) return leg === 'speaker' ? 'mix_stt' : null;
  return leg === 'speaker' ? 'spk_stt' : 'par_stt';
}
