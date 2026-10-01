/**
 * Doubao AST 2.0's wire (survey §1.4–1.6): the socket URL with the
 * credentials in its query (ruling 2), the three client frames, and the
 * server's frames decoded at once. The protobuf codec is the generated one,
 * moved from the old client (F18); its declarations type every frame. Pure:
 * no socket, no timer. The URL carries a credential: it is never framed,
 * logged or put in an error (ruling 2), and `redact()` masks its three
 * credential parameters wherever it might reach a sink anyway.
 */
import { data as proto } from './proto/ast2-proto.js';
import type { Ast2Corpus, Ast2VoiceConfig } from './config';
import type { Ast2Credentials } from './settings';

const { TranslateRequest, TranslateResponse } = proto.speech.ast;

/** The protocol's events, named both ways (`EventType.SessionStarted === 150`). */
export const EventType = proto.speech.event.Type;
export type Ast2Response = proto.speech.ast.TranslateResponse;

export const AST2_ENDPOINT = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate';
/** Doubao AST 2.0's resource: the query's `api_resource_id`, and `requestMeta`'s endpoint and resource. */
export const AST2_RESOURCE_ID = 'volc.service_type.10053';
/** The success status, as HTTP's 200 (`VolcengineAST2Client.ts:555-557`); 0 or none reads the same. */
export const OK_STATUS = 20_000_000;

/**
 * The socket URL (ruling 2; the owner's probe, 2026-09-28): the legacy App
 * ID and Access Token as `api_app_key` / `api_access_key`, or the new
 * console's key as `api_key`, beside the resource id. A refused credential
 * is an HTTP 401 on the upgrade, which a browser sees only as a failed
 * socket.
 */
export function ast2Url(k: Ast2Credentials): string {
  const query = new URLSearchParams({ api_resource_id: AST2_RESOURCE_ID });
  if (k.kind === 'apiKey') {
    query.set('api_key', k.apiKey);
  } else {
    query.set('api_app_key', k.appKey);
    query.set('api_access_key', k.accessKey);
  }
  return `${AST2_ENDPOINT}?${query.toString()}`;
}

/** A socket that failed before it opened, online: what a wrong App ID, Access Token or API key gets — an HTTP 401 on the upgrade (measured 2026-09-28), which a browser cannot see. The check's and the start's words. */
export const REFUSED_UPGRADE = 'Doubao refused the connection before it opened: check the App ID and the Access Token, or the API key.';

/** A socket that failed before it opened while the device is offline (`navigator.onLine === false`): it says nothing about the credentials. The check's and the start's words. */
export const OFFLINE = 'The device is offline: Doubao could not be reached.';

/** One connection's ids: a session's, in every frame (`requestMeta`), and the connection's. */
export interface SessionIds { session: string; connection: string }

export interface StartSessionInput {
  ids: SessionIds;
  sequence: number;
  mode: 's2s' | 's2t';
  source: string;
  target: string;
  corpus?: Ast2Corpus;
  /** A fixed voice and its TTS resource (#577); absent, the speaker's voice is cloned. */
  voice?: Ast2VoiceConfig;
  /** The legacy App ID, sent in `requestMeta.AppKey` as the old client did (parity); the API key mode sends none (choice 5). */
  appKey?: string;
}

/**
 * `StartSession` (`VolcengineAST2Client.ts:462-526`): 16 kHz pcm in; in
 * `s2s`, 24 kHz Ogg Opus out, in the fixed voice the input names
 * (`speaker_id` with its `tts_resource_id`) or, without one, the speaker's
 * own voice cloned; in `s2t`, no target audio.
 */
export function startSessionFrame(o: StartSessionInput): Uint8Array {
  return TranslateRequest.encode({
    requestMeta: {
      Endpoint: AST2_RESOURCE_ID,
      ...(o.appKey ? { AppKey: o.appKey } : {}),
      ResourceID: AST2_RESOURCE_ID,
      ConnectionID: o.ids.connection,
      SessionID: o.ids.session,
      Sequence: o.sequence,
    },
    event: EventType.StartSession,
    user: { uid: 'sokuji-user', platform: 'web' },
    sourceAudio: { format: 'pcm', rate: 16_000, bits: 16, channel: 1 },
    request: {
      mode: o.mode,
      sourceLanguage: o.source,
      targetLanguage: o.target,
      ...(o.voice ? { speakerId: o.voice.speakerId, ttsResourceId: o.voice.ttsResourceId } : {}),
      ...(o.corpus ? { corpus: o.corpus } : {}),
    },
    ...(o.mode === 's2s' ? { targetAudio: { format: 'ogg_opus', rate: 24_000 } } : {}),
  }).finish();
}

/** One `TaskRequest`: a 16 kHz packet's own bytes (little-endian, as the platforms are). */
export function audioFrame(ids: SessionIds, sequence: number, pcm: Int16Array): Uint8Array {
  return TranslateRequest.encode({
    requestMeta: { SessionID: ids.session, ConnectionID: ids.connection, Sequence: sequence },
    event: EventType.TaskRequest,
    sourceAudio: { binaryData: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) },
  }).finish();
}

export function finishSessionFrame(ids: SessionIds, sequence: number): Uint8Array {
  return TranslateRequest.encode({
    requestMeta: { SessionID: ids.session, ConnectionID: ids.connection, Sequence: sequence },
    event: EventType.FinishSession,
  }).finish();
}

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, decoded at once (`binaryType = 'arraybuffer'`), so frames are handled in the order they came; throws when unreadable. */
export function decodeResponse(data: unknown): Ast2Response {
  if (!isArrayBuffer(data)) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  return TranslateResponse.decode(new Uint8Array(data));
}

/** An event's name for a frame: the enum's own, or its number. */
export function eventName(event: number): string {
  return (EventType as unknown as Record<number, string | undefined>)[event] ?? `event_${event}`;
}

export function isOk(status: number | null | undefined): boolean {
  return !status || status === OK_STATUS;
}

/**
 * A refusal's notice code (choice 4): Volcengine's 8-digit codes put the
 * client's faults in `4xxxxxxx` and the service's in `5xxxxxxx`; anything
 * else reads as the service's. Unverified against this endpoint: the live
 * test collects the codes it sends.
 */
export function statusFailureCode(status: number): 'client' | 'server' {
  return String(status).startsWith('4') ? 'client' : 'server';
}

/** A refusal in the words `notices.<code>` shows as its detail: the status and the server's own message. */
export function statusText(status: number | null | undefined, message: string | null | undefined): string {
  return `[Doubao ${status || 'no status'}] ${message || 'no message'}`;
}

/** An int64 as the codec hands it — a number, or a Long when the `long` package is present — as a number. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v && typeof (v as { toNumber?: unknown }).toNumber === 'function') return (v as { toNumber(): number }).toNumber();
  return undefined;
}
