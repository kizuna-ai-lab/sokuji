/**
 * OpenAI Live's wire (the old client's, and the owner's probe, `live.mts`): the
 * endpoint and its upgrade headers, the client frames the adapter sends, and
 * the server's events as the probe recorded them. The installed `openai` SDK
 * (6.39.1) has no Live types, so the frames are typed here by hand (ruling
 * 9). Pure: no socket, no timer.
 */
import type { UpgradeHeaders } from '../../lib/contract/headerSocket';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { OpenAIError } from '../../lib/provider/openaiWire';
import type { LiveConfig } from './config';
import type { LiveCredentials } from './settings';

export { base64ToPcm } from '../../lib/contract/pcm64';
/** OpenAI's decoder and error words, lifted at this third user (ruling 9; choice 4). */
export { decodeServerEvent, errorCode, errorWords, type OpenAIError, type ServerEvent } from '../../lib/provider/openaiWire';

/** No query, no subprotocol: the key rides in the upgrade's header (`OpenAILiveClient.ts:44`). */
export const LIVE_WS_URL = 'wss://api.openai.com/v1/live/sessions';

/**
 * The upgrade's headers (ruling 7; U9): a real `Authorization: Bearer` — the
 * subprotocol is refused, 401 `missing_authorization` — and no `Origin`,
 * which every browser adds and the endpoint answers with 403. The one
 * function of the session side that reads the key; what it returns goes to
 * the header seam alone, never a frame, a word or a log.
 */
export function liveHeaders(k: LiveCredentials): UpgradeHeaders {
  return { set: { Authorization: `Bearer ${k.apiKey}` }, remove: ['Origin'] };
}

/** The first frame (`OpenAILiveClient.ts:100-109`): PCM16 at 24 kHz both ways, the contract's own rate. */
export interface SessionStart {
  type: 'session.start';
  event_id: string;
  session: {
    model: string;
    instructions: string;
    audio: { format: { type: 'audio/pcm'; rate: 24000 }; output: { voice: string } };
    /** `{ type: 'client' }`: `null` is refused, `invalid_type` (U12). */
    delegation: { type: 'client' };
  };
}

export function sessionStart(c: Pick<LiveConfig, 'model' | 'instructions' | 'voice'>, eventId: string): SessionStart {
  return {
    type: 'session.start',
    event_id: eventId,
    session: {
      model: c.model,
      instructions: c.instructions,
      audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: c.voice } },
      delegation: { type: 'client' },
    },
  };
}

/** One chunk as it goes up: base64 of little-endian Int16, as it came (parity). */
export function appendFrame(pcm: Int16Array): string {
  return JSON.stringify({ type: 'session.input_audio.append', audio: pcmToBase64(pcm) });
}

/** A push-to-talk release and press (ruling 5; U2'): acknowledged `session.input_audio.muted` / `.unmuted`, the pending translation finishing while muted. */
export function muteFrame(eventId: string): { type: 'session.input_audio.mute'; event_id: string } {
  return { type: 'session.input_audio.mute', event_id: eventId };
}

export function unmuteFrame(eventId: string): { type: 'session.input_audio.unmute'; event_id: string } {
  return { type: 'session.input_audio.unmute', event_id: eventId };
}

/** The graceful end (ruling 8; U7: `session.closed`, `close_requested`, 0.73 s later), sent at Stop just before the close. */
export const SESSION_CLOSE = { type: 'session.close' } as const;

/** `session.started`: the session's id and its expiry, in seconds since the epoch — two hours on (U7). */
export interface SessionStartedEvent { type: 'session.started'; session?: { id?: unknown; expires_at?: unknown } }
/** A transcript delta: its text and its stamps — the input's on the session's timeline, the output's on its own sample clock (U4, U5). */
export interface TranscriptDeltaEvent { type: string; delta?: unknown; start_ms?: unknown; end_ms?: unknown }
/** An output audio delta: base64 PCM16 at 24 kHz and nothing else — no stamp (U4). */
export interface OutputAudioDeltaEvent { type: 'session.output_audio.delta'; delta?: unknown }
/** About every 15 s, the seconds billed so far. */
export interface UsageUpdatedEvent { type: 'session.usage.updated'; usage?: { seconds?: unknown } }
/** Why the session ended — `close_requested`, `expired`, `content`, `remote_hangup`, `connection_lost` — and the seconds billed. */
export interface SessionClosedEvent { type: 'session.closed'; reason?: unknown; usage?: { seconds?: unknown } }
export interface ErrorEvent { type: 'error'; error?: OpenAIError }

/** A stamp as a number, else null. */
export function stampOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
