/**
 * OpenAI Translate's wire, spoken directly (survey §1.3–1.4): the URL and
 * its subprotocols, the two client frames the adapter sends, the server's
 * frames decoded, the heartbeat test, and a server `error` as a notice code
 * and words. The client frames are typed by the `openai` SDK's translation
 * types, imported for types only, so a frame that drifts from the SDK fails
 * the typecheck. Pure: no socket, no timer.
 */
import type {
  RealtimeError,
  RealtimeTranslationInputAudioBufferAppendEvent,
  RealtimeTranslationSessionUpdateEvent,
} from 'openai/resources/realtime/realtime';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { TranslateConfig } from './config';
import type { TranslateCredentials } from './settings';

/** Lifted to the contract at their third user (Stage 2 OpenAI Realtime, choice 1); re-exported, so this wire's importers are unchanged. */
export { base64ToPcm, pcmToBase64 } from '../../lib/contract/pcm64';

/** The translations endpoint (`OpenAITranslateGAClient.ts:23`); the model rides in its query, fixed at creation. */
export const TRANSLATE_WS_URL = 'wss://api.openai.com/v1/realtime/translations';

export function translateUrl(c: Pick<TranslateConfig, 'model'>): string {
  return `${TRANSLATE_WS_URL}?model=${encodeURIComponent(c.model)}`;
}

/**
 * The subprotocols a socket authenticates with (choice 3;
 * `OpenAITranslateGAClient.ts:698-709`): `realtime`, and the key as
 * `openai-insecure-api-key.<key>`, which a browser sets itself — no upgrade
 * header on any platform. Never the beta tag `openai-beta.realtime-v1`: the
 * endpoint refuses it ("Translation sessions are only available on the GA
 * API."). The one function of the session side that reads the key; what it
 * returns is never framed, worded or logged.
 */
export function translateProtocols(k: TranslateCredentials): string[] {
  return ['realtime', `openai-insecure-api-key.${k.apiKey}`];
}

/**
 * The session's configuration, sent once `session.created` arrives: the old
 * `buildSessionUpdate` (`OpenAITranslateGAClient.ts:197-217`), with the
 * transcription always set and `noise_reduction: null` for none, which the
 * SDK says turns it off (ruling 9).
 */
export function sessionUpdate(c: TranslateConfig): RealtimeTranslationSessionUpdateEvent {
  return {
    type: 'session.update',
    session: {
      audio: {
        // The language alone: `output.transcription` is refused as unknown, and the output transcript comes by default (`OpenAITranslateGAClient.test.ts:82-88`).
        output: { language: c.target },
        input: {
          // The model alone: `keywords`, `prompt`, `language`, `languages` and `delay` each came back `unknown_parameter` (probed 2026-08-01).
          transcription: { model: c.transcriptModel },
          noise_reduction: c.noiseReduction === null ? null : { type: c.noiseReduction },
        },
      },
    },
  };
}

/** One chunk as it goes up: 24 kHz PCM16 mono, the contract's own rate — no resampling (SDK: "base64-encoded 24 kHz PCM16 mono little-endian"). */
export function appendFrame(pcm: Int16Array): string {
  const frame: RealtimeTranslationInputAudioBufferAppendEvent = { type: 'session.input_audio_buffer.append', audio: pcmToBase64(pcm) };
  return JSON.stringify(frame);
}

/**
 * A server event as the adapter reads it: a JSON object with a string
 * `type`. The SDK's `RealtimeTranslationServerEvent` types the seven it
 * lists; the adapter reads each through its SDK type. The `.done` events the
 * old client handled are not among them (choice 18).
 */
export type ServerEvent = { type: string } & Record<string, unknown>;

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, decoded at once: text, or a binary frame read as an ArrayBuffer (choice 17). Throws when it is not a JSON object with a string `type`. */
export function decodeServerEvent(data: unknown): ServerEvent {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  if (typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('a server frame with no type');
  return parsed as ServerEvent;
}

/** The rate an output audio delta that names none is taken at: PCM16 at 24 kHz, the old client's default (`OpenAITranslateGAClient.ts:604`). */
export const OUTPUT_RATE = 24_000;

/**
 * A heartbeat: the all-zero frames the API sends between utterances
 * (`OpenAITranslateGAClient.ts:31-57`; commit `98149d35` measured content at
 * RMS 0.04–0.08 and heartbeats at exactly 0). Told apart by content, not by
 * length; it returns at the first sample that is not zero.
 */
export function isSilentFrame(pcm: Int16Array): boolean {
  for (let i = 0; i < pcm.length; i++) if (pcm[i] !== 0) return false;
  return true;
}

/** RMS over [0, 1] (the old `computeRms`), for the Logs' audio frames only. */
export function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length) / 32768;
}

/** A delta's `elapsed_ms` when it is a number, else null: framed on every delta (ruling 6), read for nothing else yet. */
export function elapsedMsOf(e: { elapsed_ms?: unknown }): number | null {
  return typeof e.elapsed_ms === 'number' ? e.elapsed_ms : null;
}

export type ErrorCode = 'auth' | 'rate_limit' | 'client' | 'server';

/**
 * A server `error` as a notice code (choice 9): OpenAI's codes for a bad key,
 * a rate limit and an exhausted quota first, then an invalid request, else
 * the service's. A hypothesis for this endpoint: the live test's
 * `session.error` frames settle it.
 */
export function errorCode(e: Partial<RealtimeError>): ErrorCode {
  if (e.code === 'invalid_api_key') return 'auth';
  if (e.code === 'rate_limit_exceeded' || e.code === 'insufficient_quota') return 'rate_limit';
  if (e.type === 'invalid_request_error') return 'client';
  return 'server';
}

/** A server `error` in OpenAI's own words, as the `{{detail}}` of `notices.<code>`: `[OpenAI <code, else type>] <message>`. */
export function errorWords(e: Partial<RealtimeError>): string {
  return `[OpenAI ${e.code || e.type || 'error'}] ${e.message || 'the server reported an error'}`;
}
