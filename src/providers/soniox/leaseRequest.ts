/**
 * Kizuna AI's managed Soniox session-key request and the stream roles it
 * asks for (Stage 2 Kizuna Soniox, choice 19): the backend's matrix body
 * (`BE:config/soniox.ts:577-623`), in the order the old client sent it
 * (`ManagedSonioxSession.ts:707-711`), and its expansion into roles
 * (`BE:config/soniox.ts:372-393`). The floor (`kizunaBudget.ts`) prices
 * these roles and the lease (`lease.ts`) asks for them, so the two agree.
 * The request reads whether the plan asks this provider for speech, not
 * whether the run speaks: with another provider's voice it is a text-only
 * session's request. And where the plan asks this provider for speech
 * alone, another provider transcribing and translating, the request is the
 * voice-only one (`mode: 'voice_only'`): speech keys for the legs that
 * speak, and no transcription key.
 *
 * Participant speech is built and shipped off (ruling 2): with the flag
 * on, the body carries the participant's intent and the roles gain
 * `par_tts`; with it off, the body is byte for byte today's.
 */
import type { LegName } from '../../lib/conversation/types';
import { servesSpeech, servesTranscription } from '../../lib/plan/read';
import type { Payer, RunShape } from '../../lib/session/types';
import { asSonioxRegion, type SonioxRegion } from '../../lib/soniox/regions';
import { sonioxSharedBoth, type SonioxSettings } from './settings';

/**
 * The body field asking for the participant's speech stream: sokuji-backend
 * reads it by this name (`normalizeSessionShape`, sokuji-backend#94).
 */
export const PARTICIPANT_SPEECH_FIELD = 'participantSpeech';

export type SttRole = 'spk_stt' | 'par_stt' | 'mix_stt';
export type StreamRole = SttRole | 'spk_tts' | 'par_tts' | 'mix_tts';
export const STREAM_ROLES: readonly StreamRole[] = ['spk_stt', 'par_stt', 'mix_stt', 'spk_tts', 'par_tts', 'mix_tts'];
export const isSttRole = (role: StreamRole): role is SttRole => role.endsWith('_stt');
/** The speech roles a voice-only lease issues: one per leg that speaks, each with its own client reference. */
export type VoiceRole = 'spk_tts' | 'par_tts';
/** The audio a role carries — `spk` the microphone, `par` the far end, `mix` both — which pairs an STT key with its TTS key. */
export const sideOf = (role: StreamRole): string => role.slice(0, 3);

/** A session this provider transcribes and translates, speaking or not. */
export interface SessionLeaseRequest {
  mode: 'speaker' | 'participant' | 'both';
  /** The speaker's speech: `true` when there is none to speak, participant-only included. The backend defaults neither this nor `bothSplit`. */
  textOnly: boolean;
  bothSplit: boolean;
  region: SonioxRegion;
  /** Whether the participant speaks — present only while the participant-speech flag is on (ruling 2). */
  participantSpeaks?: boolean;
}

/** This provider's voice alone, under another provider's transcription and translation: speech keys only. */
export interface VoiceOnlyLeaseRequest {
  mode: 'voice_only';
  /** The legs that speak in this run. */
  legs: 'speaker' | 'participant' | 'both';
  region: SonioxRegion;
}

/** What a start asks the session-key route for, told apart by `mode`. */
export type LeaseRequest = SessionLeaseRequest | VoiceOnlyLeaseRequest;

/** Kizuna AI's Soniox as a plan names it: the provider this request, its floor and its voice claim are for. */
export const KIZUNA_SONIOX = { id: 'kizunaai_soniox' } as const;

/**
 * Whether this start asks Kizuna AI's Soniox for speech: its unit serves the plan's speech stage. With another
 * provider's voice (Edge, a local model, Soniox with an own key) it does not, however much the run speaks. A shape
 * that carries no plan is a session on Kizuna AI's Soniox alone.
 */
export function asksSpeech(shape: Partial<Pick<RunShape, 'plan'>>): boolean {
  return shape.plan === undefined || servesSpeech(shape.plan, KIZUNA_SONIOX);
}

/**
 * Whether the plan asks Kizuna AI's Soniox for its voice alone: it serves the speech stage and another provider
 * transcribes. A shape that carries no plan is a session on Kizuna AI's Soniox alone, so never this.
 */
export function asksVoiceAlone(shape: Partial<Pick<RunShape, 'plan'>>): boolean {
  return shape.plan !== undefined && servesSpeech(shape.plan, KIZUNA_SONIOX) && !servesTranscription(shape.plan, KIZUNA_SONIOX);
}

/**
 * Whether the plan asks Kizuna AI's Soniox to transcribe alone: it serves the transcription stage and another
 * provider translates. Each leg then has a connection of its own, since a connection that carries both legs has
 * one direction too many for the unit that translates. A shape that carries no plan is a session on Kizuna AI's
 * Soniox alone, so never this.
 */
export function asksTranscriptionAlone(shape: Partial<Pick<RunShape, 'plan'>>): boolean {
  return shape.plan !== undefined && servesTranscription(shape.plan, KIZUNA_SONIOX) && shape.plan.byStage.translation.provider.id !== KIZUNA_SONIOX.id;
}

/**
 * A session's request, for a plan that asks this provider to transcribe (`startRequest` tells which request a
 * start makes): its legs; the speaker's speech, when the plan asks this provider for it; split Both from
 * the settings `startBoth` reads; the settings' region; and, the flag on, whether the participant speaks through
 * this provider. A plan that gives speech to another provider makes it exactly a text-only session's request: no
 * speech role is asked for. A plan that gives translation to another provider changes nothing of the request but
 * this: Both is always split, whatever the settings say. With this provider's voice it is a speaking session's
 * request, transcription and speech roles alike.
 */
export function leaseRequest(
  shape: Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech' | 'faceToFace'> & Partial<Pick<RunShape, 'plan'>>,
  s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>,
  participantSpeech: boolean,
): SessionLeaseRequest {
  const both = shape.legs.length === 2;
  const speech = asksSpeech(shape);
  return {
    mode: both ? 'both' : shape.legs[0] === 'participant' ? 'participant' : 'speaker',
    textOnly: !speech || !shape.legs.includes('speaker') || shape.textOnly,
    // Must agree with the adapter's `config.sharedBoth` (`startBoth`): both read the settings the run built from,
    // and face-to-face is always one shared stream (`buildSoniox`).
    // Transcription alone is never one shared stream: each leg's own unit translates what its own connection heard.
    bothSplit: both && (asksTranscriptionAlone(shape) || !sonioxSharedBoth(shape.faceToFace === true, s)),
    region: asSonioxRegion(s.region),
    ...(participantSpeech ? { participantSpeaks: speech && shape.legs.includes('participant') && shape.participantSpeech } : {}),
  };
}

/**
 * The voice-only request of a plan that asks this provider for speech alone: the legs that speak in this run. The
 * speaker's leg speaks unless the run is text-only; the participant's speaks under the rule a session's request
 * reads (the flag on, the leg in the run, its speech switched on). Null when no leg would speak: there is nothing
 * to lease.
 */
export function voiceOnlyRequest(
  shape: Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech'>,
  s: Pick<SonioxSettings, 'region'>,
  participantSpeech: boolean,
): VoiceOnlyLeaseRequest | null {
  const speaker = shape.legs.includes('speaker') && !shape.textOnly;
  const participant = participantSpeech && shape.legs.includes('participant') && shape.participantSpeech;
  if (!speaker && !participant) return null;
  let legs: VoiceOnlyLeaseRequest['legs'] = 'participant';
  if (speaker && participant) legs = 'both';
  else if (speaker) legs = 'speaker';
  return { mode: 'voice_only', legs, region: asSonioxRegion(s.region) };
}

/**
 * What this start asks the session-key route for: the voice-only request where the plan asks this provider for
 * its voice alone, a session's request otherwise. Null when nothing is asked at all: a voice alone in a run where
 * no leg speaks.
 */
export function startRequest(
  shape: Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech' | 'faceToFace'> & Partial<Pick<RunShape, 'plan'>>,
  s: Pick<SonioxSettings, 'region' | 'bothModeSharedSession'>,
  participantSpeech: boolean,
): LeaseRequest | null {
  return asksVoiceAlone(shape) ? voiceOnlyRequest(shape, s, participantSpeech) : leaseRequest(shape, s, participantSpeech);
}

/**
 * The JSON body. A session's: today's four fields, always and in today's order; then the participant's intent, only
 * while the flag is on. A voice alone: its mode, the legs that speak and the region. Then who pays, only for an
 * organization member.
 */
export function requestBody(r: LeaseRequest, payer?: Payer): Record<string, unknown> {
  if (r.mode === 'voice_only') return { mode: r.mode, legs: r.legs, region: r.region, ...(payer === undefined ? {} : { payer }) };
  return {
    mode: r.mode,
    textOnly: r.textOnly,
    bothSplit: r.bothSplit,
    region: r.region,
    ...(r.participantSpeaks === undefined ? {} : { [PARTICIPANT_SPEECH_FIELD]: r.participantSpeaks }),
    ...(payer === undefined ? {} : { payer }),
  };
}

/** The speech roles a voice-only request is issued: one per leg that speaks. */
function voiceRoles(r: VoiceOnlyLeaseRequest): VoiceRole[] {
  return [...(r.legs === 'participant' ? [] : ['spk_tts' as const]), ...(r.legs === 'speaker' ? [] : ['par_tts' as const])];
}

/** The roles a request is minted: a session's expansion, with `par_tts` where the participant speaks; a voice alone's speech roles, and no other. */
export function requestedRoles(r: LeaseRequest): StreamRole[] {
  if (r.mode === 'voice_only') return voiceRoles(r);
  const participantTts: StreamRole[] = r.participantSpeaks ? ['par_tts'] : [];
  if (r.mode === 'both' && !r.bothSplit) return ['mix_stt', ...(r.textOnly ? [] : ['mix_tts' as const]), ...participantTts];
  const speaker: StreamRole[] = r.mode === 'participant' ? [] : ['spk_stt', ...(r.textOnly ? [] : ['spk_tts' as const])];
  const participant: StreamRole[] = r.mode === 'speaker' ? [] : ['par_stt', ...participantTts];
  return [...speaker, ...participant];
}

/** The STT role a leg of a session runs on; null for shared Both's participant, which rides the speaker's mixed socket. */
export function roleFor(r: SessionLeaseRequest, leg: LegName): SttRole | null {
  if (r.mode === 'both' && !r.bothSplit) return leg === 'speaker' ? 'mix_stt' : null;
  return leg === 'speaker' ? 'spk_stt' : 'par_stt';
}

/** The speech role a leg's voice runs on under a voice-only lease; null for a leg that does not speak in this run. */
export function voiceRoleFor(r: VoiceOnlyLeaseRequest, leg: LegName): VoiceRole | null {
  const role: VoiceRole = leg === 'speaker' ? 'spk_tts' : 'par_tts';
  return voiceRoles(r).includes(role) ? role : null;
}
