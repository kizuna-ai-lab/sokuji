/**
 * Palabra AI's wire (survey §2.8; the owner's live probe, 2026-09-28/29):
 * the two ways to its streaming socket — the platform key straight in the
 * URL's query, or a REST session's publisher token (ruling 1) — the REST
 * requests, the task the socket is configured with, the audio going up, and
 * the server's messages read. Pure: no socket, no timer, no fetch.
 * `restHeaders`, `directUrl`, `readCreated` and `sessionUrl` are the only
 * readers of a credential: nothing they return is framed, worded or logged,
 * and `redact()` masks the query's `token` and a key's or a token's shape
 * wherever one reaches a sink anyway.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { PalabraConfig } from './config';
import type { PalabraCredentials } from './settings';

export const PALABRA_API = 'https://api.palabra.ai';
/** The REST sessions: listed by the check (`GET`), one deleted by its id (`DELETE`). */
export const SESSIONS_URL = `${PALABRA_API}/session-storage/sessions`;
/** Where the app pair's REST session is created (`POST`; ruling 1). */
export const CREATE_SESSION_URL = `${PALABRA_API}/session-storage/session`;
/** The streaming endpoint; the path's first segment is any URL-safe string, which spreads connections over its servers (the docs). */
export const STREAMING_BASE = 'wss://streaming.palabra.ai/streaming-api';
/** The create's body, as the old client and the probe sent it. */
export const CREATE_SESSION_BODY = JSON.stringify({ data: { intent: 'api' } });
/** The close Palabra sends past its connection limit — 20 a minute per key (the docs) — and after its own `SERVICE_TIMEOUT` (the owner's probe). */
export const POLICY_VIOLATION = 1008;

/** The REST headers for a credential (ruling 1): the platform key as a Bearer token, or the legacy app's pair as its two headers (`PalabraAIClient.ts:202-206`). */
export function restHeaders(k: PalabraCredentials): Record<string, string> {
  return k.kind === 'apiKey' ? { Authorization: `Bearer ${k.apiKey}` } : { ClientId: k.clientId, ClientSecret: k.clientSecret };
}

/** The platform key's socket (ruling 1): straight to the streaming endpoint, the key in the query; the server makes the session and cleans it up when the socket closes. */
export function directUrl(hash: string, k: Extract<PalabraCredentials, { kind: 'apiKey' }>): string {
  return `${STREAMING_BASE}/${hash}/v1/speech-to-speech/stream?token=${encodeURIComponent(k.apiKey)}`;
}

/** What a REST session's answer holds that the app pair's path uses. Its id is shaped as a JWT (the owner's probe), and the publisher is one: neither is framed. */
export interface CreatedSession {
  id: string;
  publisher: string;
  wsUrl: string;
}

/** A create's answer, `{ data: { id, publisher, ws_url, … } }`; null when it holds no socket to reach. */
export function readCreated(body: unknown): CreatedSession | null {
  const data = (body as { data?: unknown } | null)?.data as { id?: unknown; publisher?: unknown; ws_url?: unknown } | undefined;
  if (!data || typeof data.id !== 'string' || typeof data.publisher !== 'string' || typeof data.ws_url !== 'string') return null;
  return { id: data.id, publisher: data.publisher, wsUrl: data.ws_url };
}

/** The app pair's socket (ruling 1): the session's own address, the publisher token in its query. Throws on an address that is no URL. */
export function sessionUrl(created: CreatedSession): string {
  const url = new URL(created.wsUrl);
  url.searchParams.set('token', created.publisher);
  return url.toString();
}

/** One REST session, deleted by its id: only our own, never the account's others (the old delete-all ended the other leg of Both). */
export function sessionDeleteUrl(id: string): string {
  return `${SESSIONS_URL}/${encodeURIComponent(id)}`;
}

/** A REST refusal in Palabra's words: `HTTP <status>: <detail, else title, else ours>` — its envelope is `{ errors: [{ title, detail }] }`. */
export function restWords(status: number, body: unknown, fallback: string): string {
  const first = (body as { errors?: Array<{ title?: unknown; detail?: unknown }> } | null)?.errors?.[0];
  const said = typeof first?.detail === 'string' && first.detail ? first.detail : typeof first?.title === 'string' && first.title ? first.title : fallback;
  return `HTTP ${status}: ${said}`;
}

/** The task a leg runs (the owner's probe's `set_task`, which every run started with). */
export interface SetTaskMessage {
  message_type: 'set_task';
  data: {
    input_stream: { content_type: 'audio'; source: { type: 'ws'; format: 'pcm_s16le'; sample_rate: number; channels: 1 } };
    output_stream: { content_type: 'audio'; target: { type: 'ws'; format: 'pcm_s16le' } } | null;
    pipeline: {
      transcription: { source_language: string; detectable_languages: string[]; segment_confirmation_silence_threshold: number; sentence_splitter: { enabled: boolean } };
      translations: Array<{
        target_language: string;
        translate_partial_transcriptions: boolean;
        speech_generation: {
          voice_cloning: false;
          voice_id: string;
          voice_timbre_detection: { enabled: false; high_timbre_voices: string[]; low_timbre_voices: string[] };
        };
      }>;
      translation_queue_configs: { global: { desired_queue_level_ms: number; max_queue_level_ms: number; auto_tempo: boolean } };
      allowed_message_types: string[];
    };
  };
}

/**
 * The task (survey §2.7): 24 kHz pcm in, the contract's own rate — no
 * resampling — and 24 kHz pcm out, over this socket. A leg that does not
 * speak sends `output_stream: null` and gets the text alone (ruling 7; the
 * owner's follow-up probe). Timbre detection is always off, so the voice
 * picked is the voice heard (ruling 10). The old client's `verification`
 * block, marked a work in progress in the docs, is not sent; the probe ran
 * without it.
 */
export function setTask(c: PalabraConfig): SetTaskMessage {
  return {
    message_type: 'set_task',
    data: {
      input_stream: { content_type: 'audio', source: { type: 'ws', format: 'pcm_s16le', sample_rate: SAMPLE_RATE, channels: 1 } },
      output_stream: c.speech ? { content_type: 'audio', target: { type: 'ws', format: 'pcm_s16le' } } : null,
      pipeline: {
        transcription: {
          source_language: c.source,
          detectable_languages: [],
          segment_confirmation_silence_threshold: c.silenceThreshold,
          sentence_splitter: { enabled: c.sentenceSplitter },
        },
        translations: [{
          target_language: c.target,
          translate_partial_transcriptions: c.translatePartials,
          speech_generation: {
            voice_cloning: false,
            voice_id: c.voiceId,
            voice_timbre_detection: { enabled: false, high_timbre_voices: ['default_high'], low_timbre_voices: ['default_low'] },
          },
        }],
        translation_queue_configs: { global: { desired_queue_level_ms: c.queue.desiredMs, max_queue_level_ms: c.queue.maxMs, auto_tempo: c.queue.autoTempo } },
        allowed_message_types: ['translated_transcription', 'partial_transcription', 'partial_translated_transcription', 'validated_transcription'],
      },
    },
  };
}

/** Asks whether the task runs: answered by `current_task`, or `NOT_FOUND` until it does (the docs; the probe's `get_task`). */
export const GET_TASK = { message_type: 'get_task', data: { exclude_hidden: true } } as const;

/** Ends the task at once, what is still being translated dropped — "drop the pipeline and disconnect immediately, without processing the tail" (the docs): Stop's, sent best-effort before the close (ruling 13). */
export const END_TASK = { message_type: 'end_task', data: { force: true } } as const;

/** One chunk as it goes up: base64 of little-endian 24 kHz pcm (the docs: a payload of 1 KB to 512 KB; a 320 ms chunk is 20 480 characters). */
export function inputAudio(pcm: Int16Array): string {
  return JSON.stringify({ message_type: 'input_audio_data', data: { data: pcmToBase64(pcm) } });
}

/** A server message: its type, and its `data` as an object — a `data` that is itself JSON text is read (the Python SDK's note; `PalabraAIClient.ts:864`). */
export interface PalabraMessage {
  type: string;
  data: Record<string, unknown>;
}

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, read at once: text, or a binary frame as an ArrayBuffer. Throws when it is no JSON object with a string `message_type`. */
export function decodeMessage(data: unknown): PalabraMessage {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  const type = (parsed as { message_type?: unknown }).message_type;
  if (typeof type !== 'string') throw new Error('a server frame with no message_type');
  let body = (parsed as { data?: unknown }).data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // A string that is no JSON: read as no data.
    }
  }
  return { type, data: body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {} };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** A sentence's id or part as a string: the audio carries its part as "0", the text as 0 (the owner's probe). */
const idOf = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);

/** A transcription or translation message's content (the four text messages). */
export interface Transcription {
  /** The sentence (`transcription_id`), the same on all four kinds and on its audio. */
  id?: string;
  /** Which part of the sentence's translation (`translation_part_id`), on a translation only. */
  part?: string;
  language?: string;
  text: string;
  /** The first segment's times, seconds from the stream's start: the Logs' alone. */
  start?: number;
  end?: number;
}

export function transcriptionOf(data: Record<string, unknown>): Transcription {
  const t = (data.transcription ?? {}) as Record<string, unknown>;
  const first = Array.isArray(t.segments) ? (t.segments[0] as Record<string, unknown> | undefined) : undefined;
  return {
    id: idOf(t.transcription_id),
    part: idOf(t.translation_part_id),
    language: str(t.language),
    text: str(t.text) ?? '',
    start: num(first?.start),
    end: num(first?.end),
  };
}

/** A chunk of translated speech (`output_audio_data`): 24 kHz mono pcm, 200 ms a chunk, a sentence's last marked (the owner's probe). */
export interface OutputAudio {
  id?: string;
  part?: string;
  last: boolean;
  /** The base64 pcm; anything but a string is no audio. */
  audio: unknown;
}

export function outputAudioOf(data: Record<string, unknown>): OutputAudio {
  return { id: idOf(data.transcription_id), part: idOf(data.translation_part_id), last: data.last_chunk === true, audio: data.data };
}

/** An `error` message (the probe: `{ code, desc, param }`; the docs add `msg`). */
export interface PalabraError {
  code?: string;
  desc?: string;
  msg?: string;
  param?: unknown;
}

export function errorOf(data: Record<string, unknown>): PalabraError {
  return { code: str(data.code), desc: str(data.desc), msg: str(data.msg), param: data.param };
}

/** A `warning` message: `{ code, message }` (the probe's `VOICE_NOT_FOUND`; the docs' `AUDIO_STREAM_*`). */
export function warningOf(data: Record<string, unknown>): { code?: string; message?: string } {
  return { code: str(data.code), message: str(data.message) };
}

/** A `current_task`'s status: `running`, `paused` or `unknown` (the docs). */
export function taskStatusOf(data: Record<string, unknown>): string | undefined {
  return str(data.task_status);
}

/** What `get_task` answers until the task runs: expected, never a failure (ruling 4). */
export const NOT_FOUND = 'NOT_FOUND';
/** The server stops a stream that sent no audio for 10 s (the owner's follow-up probe), then closes 1008. */
export const SERVICE_TIMEOUT = 'SERVICE_TIMEOUT';
/** The voice the task asked for is not available, and another speaks (the probe's `bn`): the `voice_fallback` notice (ruling 11). */
export const VOICE_NOT_FOUND = 'VOICE_NOT_FOUND';

/**
 * A pydantic `ValidationError(...)`'s messages, each after the field it
 * names — `segment_confirmation_silence_threshold: ensure this value is
 * greater than or equal to 0.3` — joined by "; ". Null when `desc` holds
 * none: the words then fall back to `desc` whole (survey §6).
 */
export function validationWords(desc: string | undefined): string | null {
  if (!desc) return null;
  const words: string[] = [];
  const entry = /'loc': \(([^)]*)\), 'msg': (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  for (let m = entry.exec(desc); m !== null; m = entry.exec(desc)) {
    const fields = m[1].split(',').map((f) => f.trim().replace(/^'|'$/g, '')).filter((f) => f !== '' && f !== '__root__');
    const message = m[2] ?? m[3] ?? '';
    words.push(fields.length > 0 ? `${fields[fields.length - 1]}: ${message}` : message);
  }
  return words.length > 0 ? words.join('; ') : null;
}

/** An `error` in Palabra's words, the `{{detail}}` of `notices.<code>` (ruling 11): `[Palabra <code>] <its message>`. */
export function errorWords(e: PalabraError): string {
  return `[Palabra ${e.code || 'error'}] ${validationWords(e.desc) || e.msg || e.desc || 'the server reported an error'}`;
}

/** An `error` as a notice code: a task Palabra refused is the request's (`client`); anything else the service's (`server`). A hypothesis past the probe's codes: the live test's `session.error` frames settle it. */
export function errorCode(e: PalabraError): 'client' | 'server' {
  return e.code === 'VALIDATION_ERROR' ? 'client' : 'server';
}
