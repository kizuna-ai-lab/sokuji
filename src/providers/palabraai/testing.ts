/**
 * The Palabra AI suites' fixtures: two credentials, the settings the suites
 * build from, the server's messages as the owner's live probe logged them
 * (2026-09-28/29: its shapes and texts, never a credential — the probe
 * redacted every one, and these are made up), and a REST server that
 * records what it is asked. Test-only: nothing but a test imports it (the
 * session-side guard's kit rule counts every provider's `testing.ts` as kit
 * and holds it to that), and the adapter's session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { flush } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { SharedSettings } from '../../lib/provider/types';
import { createPalabraAdapter, POLL_MS } from './adapter';
import { buildPalabra, type PalabraConfig } from './config';
import { PALABRA_DEFAULTS, type PalabraCredentials, type PalabraSettings } from './settings';

/** Shaped as a real platform key (`plbr_…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: Extract<PalabraCredentials, { kind: 'apiKey' }> = { kind: 'apiKey', apiKey: 'plbr_testKey0123456789abcdef' };
/** A legacy app pair. Neither value has a key's shape: the suites scan for them by value. */
export const APP: Extract<PalabraCredentials, { kind: 'app' }> = { kind: 'app', clientId: 'palabra-client-id-4f2a', clientSecret: 'palabra-client-secret-9c7e' };

/** Shaped as the JWTs the probe logged — the id and the publisher alike — and made up: `{"sub":"<who>","room":"test"}`, base64url. */
const JWT = (payload: string) => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.c2lnbmF0dXJlLW9mLXRoZS10ZXN0LXRva2Vu`;
export const SESSION_ID = JWT('eyJzdWIiOiJzZXNzaW9uIiwicm9vbSI6InRlc3QifQ');
export const PUBLISHER = JWT('eyJzdWIiOiJwdWJsaXNoZXIiLCJyb29tIjoidGVzdCJ9');
/** The probe's `ws_url` host: `streaming.palabra.ai`, eight hex digits, the speech-to-speech path. */
export const SESSION_WS_URL = 'wss://streaming.palabra.ai/streaming-api/bc6ae467/v1/speech-to-speech/stream';
/** A create's answer, as the probe's keys listed it: `publisher, subscriber, webrtc_room_name, webrtc_url, ws_url, intent, id, organization`. */
export const CREATED_BODY = {
  ok: true,
  data: {
    publisher: PUBLISHER,
    subscriber: [JWT('eyJzdWIiOiJzdWJzY3JpYmVyIiwicm9vbSI6InRlc3QifQ')],
    webrtc_room_name: 'room-test',
    webrtc_url: 'wss://streaming.palabra.ai/livekit/',
    ws_url: SESSION_WS_URL,
    intent: 'api',
    id: SESSION_ID,
    organization: 'org-test',
  },
};

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en' && d.target === 'ja',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
export const MANUAL_CTX: SessionContext = { ...AUTO_CTX, turns: 'manual' };

/** A leg's config: the defaults, patched. A refusal is a fixture bug, not a case any suite means to build — it throws loudly rather than hiding behind a cast. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<PalabraSettings> = {}): PalabraConfig {
  const c = buildPalabra(context, { ...PALABRA_DEFAULTS, ...patch }, SHARED);
  if ('refused' in c) throw new Error(c.refused);
  return c;
}

/** `samples` of 24 kHz pcm16 as an audio chunk carries it: base64 of little-endian Int16. */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The probe's first sentence, ja → en (`translate-direct-ja-en`). */
export const JA = 'リアルタイム翻訳へようこそ、自然な会話をお手伝いします。';
export const EN = "Welcome to real-time translation. I'm here to help you have natural conversations.";
export const SENTENCE = '1a0e9048dfeed5a3';

const message = (message_type: string, data: unknown) => JSON.stringify({ message_type, data });
const transcription = (id: string, text: string, o: { part?: number; language?: string; start?: number; end?: number } = {}) => ({
  transcription: {
    transcription_id: id,
    ...(o.part === undefined ? {} : { translation_part_id: o.part }),
    language: o.language ?? (o.part === undefined ? 'ja' : 'en'),
    text,
    segments: [{ text, start: o.start ?? 0.32, end: o.end ?? 5.66, start_timestamp: 1_790_615_783.549207, end_timestamp: 1_790_615_788.889207, words: [{ word: text, start: o.start ?? 0.32, end: o.end ?? 5.66 }] }],
  },
});

/** The server's messages, by name, as the probe logged them: JSON text frames, `{ message_type, data }`. */
export const SERVER = {
  currentTask: (status = 'running') => message('current_task', {
    input_stream: { content_type: 'audio', source: { type: 'ws', format: 'pcm_s16le', sample_rate: 24_000, channels: 1 } },
    output_stream: { content_type: 'audio', target: { type: 'ws', format: 'pcm_s16le' } },
    pipeline: {},
    task_status: status,
  }),
  notFound: () => message('error', { code: 'NOT_FOUND', desc: 'No active task found', param: null }),
  /** The probe's refused threshold, word for word. */
  thresholdRefused: () => message('error', {
    code: 'VALIDATION_ERROR',
    desc: "ValidationError(model='SetTaskRequestMessage', errors=[{'loc': ('pipeline', 'transcription', 'segment_confirmation_silence_threshold'), 'msg': 'ensure this value is greater than or equal to 0.3', 'type': 'value_error.number.not_ge', 'ctx': {'limit_value': 0.3}}])",
    param: null,
  }),
  /** The probe's refused buffer, word for word. */
  queueRefused: () => message('error', {
    code: 'VALIDATION_ERROR',
    desc: "ValidationError(model='SetTaskRequestMessage', errors=[{'loc': ('pipeline', 'translation_queue_configs', 'global', '__root__'), 'msg': '`max_queue_level_ms` must be greater than `desired_queue_level_ms`', 'type': 'value_error'}])",
    param: null,
  }),
  /** The follow-up probe's timeout, 9.95 s after the last chunk, word for word; a close 1008 follows. */
  serviceTimeout: () => message('error', { code: 'SERVICE_TIMEOUT', desc: 'No input audio received for 10s. Use the pause_task command for intentional pauses.', param: null }),
  error: (code: string, desc: string) => message('error', { code, desc, param: null }),
  /** The probe's `bn` warning, word for word. */
  voiceNotFound: () => message('warning', { code: 'VOICE_NOT_FOUND', message: "Voice ID 'default_low' is not available, using default voice" }),
  warning: (code: string, text: string) => message('warning', { code, message: text }),
  partial: (text: string, id = SENTENCE, end?: number) => message('partial_transcription', transcription(id, text, { end })),
  validated: (text = JA, id = SENTENCE) => message('validated_transcription', transcription(id, text)),
  translationPartial: (text: string, id = SENTENCE, part = 0) => message('partial_translated_transcription', transcription(id, text, { part })),
  translated: (text = EN, id = SENTENCE, part = 0) => message('translated_transcription', transcription(id, text, { part })),
  /** A chunk of speech: 200 ms by default, its part a string as the probe saw it ("0"). */
  audio: (o: { id?: string; part?: string | number; samples?: number; last?: boolean } = {}) => message('output_audio_data', {
    transcription_id: o.id ?? SENTENCE,
    translation_part_id: o.part ?? '0',
    language: 'en',
    last_chunk: o.last ?? false,
    data: b64(o.samples ?? 4_800),
    chunk_generation_delta: null,
  }),
  endOfStream: () => message('end_of_stream', {}),
  /** A message by its type alone. */
  bare: (type: string) => message(type, {}),
  /** The data field sent as JSON text, as the Python SDK notes it can come. */
  doubleEncoded: (type: string, data: unknown) => JSON.stringify({ message_type: type, data: JSON.stringify(data) }),
};

/** One REST call as the fake server saw it. */
export interface RestCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  keepalive?: boolean;
  signal?: AbortSignal;
}

/** How the fake answers a request: its script's answer, a failed fetch, one that waits for its signal, or one held until `answer()`. */
export type RestAnswer = 'ok' | 'offline' | 'hang' | 'later' | number;

const aborted = (signal: AbortSignal) => signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');

/**
 * A response whose body reads as a browser's does: once the request's
 * signal has aborted, reading it rejects — "If the request is aborted after
 * the fetch() call has been fulfilled but before the response body has been
 * read, then attempting to read the response body will reject with an
 * AbortError exception" (MDN, fetch()). A body that ignored the signal hid
 * a leaked session (choice 9). Checked twice: before the read starts, and
 * again once it settles — a read already under way when the abort lands
 * rejects too, since `signal.aborted` is already true by the time our own
 * `.then` runs, whatever the native call's own microtask count (fix round 1,
 * M3b).
 */
function honouring(response: Response, signal: AbortSignal | undefined): Response {
  if (!signal) return response;
  const guard = <T>(read: () => Promise<T>) => (): Promise<T> => {
    if (signal.aborted) return Promise.reject(aborted(signal));
    return read().then((v) => (signal.aborted ? Promise.reject(aborted(signal)) : v));
  };
  return Object.assign(response, { json: guard(response.json.bind(response)), text: guard(response.text.bind(response)) });
}

/** A REST refusal's title, by its status — a browser-true envelope, not always the platform key's 401 (fix round 1, M3d). */
const STATUS_TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
};
const statusTitle = (status: number): string => STATUS_TITLES[status] ?? `HTTP ${status}`;

/**
 * An immediate answer, settled on a microtask that re-checks `signal.aborted`
 * — an `'ok'` or a status answer resolved `fetch()`'s own promise
 * synchronously, so a signal aborted in the same tick (after `fetch()` was
 * called, before this promise's continuation ran) went unnoticed; a browser
 * rejects it (fix round 1, M3a). `'hang'` and `'later'` need no such check:
 * their promise only ever settles from the abort listener or `answer()`.
 */
const settleNow = (make: () => Response, signal: AbortSignal | undefined): Promise<Response> =>
  Promise.resolve().then(() => (signal?.aborted ? Promise.reject(aborted(signal)) : honouring(make(), signal)));

/**
 * A fake of Palabra's REST server that behaves as a browser's fetch: `fetch`
 * answers from a script and records every call; an aborted request rejects,
 * and so does reading an answer's body once its request is aborted.
 * `create` answers the session create — `'ok'` (201, `CREATED_BODY`), a
 * status with Palabra's error envelope, `'offline'` (a failed fetch),
 * `'hang'` (an answer that waits for its signal) or `'later'` (held until
 * `answer()`, rejected if aborted first); the delete answers 204; the list
 * answers `list`.
 */
export function fakeRest(o: { create?: RestAnswer; list?: RestAnswer; remove?: RestAnswer } = {}) {
  const calls: RestCall[] = [];
  const held: Array<() => void> = [];
  const answer = (how: RestAnswer, ok: () => Response, signal: AbortSignal | undefined): Promise<Response> => {
    if (how === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    if (how === 'hang' || how === 'later') {
      return new Promise<Response>((resolve, reject) => {
        if (how === 'later') held.push(() => resolve(honouring(ok(), signal)));
        signal?.addEventListener('abort', () => reject(aborted(signal)), { once: true });
      });
    }
    if (how === 'ok') return settleNow(ok, signal);
    return settleNow(() => new Response(JSON.stringify({ ok: false, errors: [{ title: statusTitle(how), detail: `Refused with ${how}.` }] }), { status: how }), signal);
  };
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const call: RestCall = {
      method: init.method ?? 'GET',
      url: String(input),
      // A browser normalises header names to lowercase (the `Headers` API);
      // recording the raw object hid a case mismatch a real fetch would not
      // have (fix round 1, M3c). Read `RestCall.headers` by the lowercase
      // name, as the adapter's suite does (`clientid`, `content-type`).
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      ...(typeof init.body === 'string' ? { body: init.body } : {}),
      ...(init.keepalive === undefined ? {} : { keepalive: init.keepalive }),
      ...(init.signal ? { signal: init.signal } : {}),
    };
    calls.push(call);
    if (init.signal?.aborted) return Promise.reject(aborted(init.signal));
    if (call.method === 'POST') return answer(o.create ?? 'ok', () => new Response(JSON.stringify(CREATED_BODY), { status: 201 }), init.signal ?? undefined);
    if (call.method === 'DELETE') return answer(o.remove ?? 'ok', () => new Response(null, { status: 204 }), init.signal ?? undefined);
    return answer(o.list ?? 'ok', () => new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 }), init.signal ?? undefined);
  };
  return {
    fetch,
    calls,
    of: (method: string) => calls.filter((c) => c.method === method),
    /** Answers every request held as `'later'`, in order. */
    answer: () => { for (const go of held.splice(0)) go(); },
  };
}

/** A Palabra leg started over `FakeSocket`s and the fake REST server, on a tracked virtual clock; nothing opened yet. The platform key's socket exists at once; the app pair's once its create is answered (a flush). */
export function startPalabra(o: {
  context?: SessionContext;
  patch?: Partial<PalabraSettings>;
  credentials?: PalabraCredentials;
  rest?: Parameters<typeof fakeRest>[0];
  /** A test's own answers in front of the fake server: what it passes on reaches `rest`, and is recorded there. */
  fetch?: (rest: ReturnType<typeof fakeRest>) => (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  online?: boolean;
} = {}) {
  const sockets = fakeSockets();
  const rest = fakeRest(o.rest);
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const config = configFor(context, o.patch);
  const adapter = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: o.fetch ? o.fetch(rest) : rest.fetch, newId: () => 'test-hash', online: () => o.online ?? true });
  const starting = adapter.start({ context, config, credentials: o.credentials ?? KEY, clock, signal: controller.signal }, events);
  const socket = () => sockets.last();
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The payloads of the frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  /** What the client sent on the leg's socket, parsed. */
  const sent = () => socket().sentJson<{ message_type: string; data: Record<string, unknown> }>();
  /** The pcm of every chunk sent, in order. */
  const appended = () => sent().filter((m) => m.message_type === 'input_audio_data').map((m) => base64ToPcm(m.data.data as string));
  /** The log without its frames: what L1 folds. */
  const content = () => log.filter((e) => e.kind !== 'frame');
  return { sockets, rest, clock, timers, log, controller, config, starting, socket, of, frames, sent, appended, content };
}

/** Started, opened, the task set and found running: the start resolved. */
export async function livePalabra(o?: Parameters<typeof startPalabra>[0]) {
  const h = startPalabra(o);
  // The app pair's socket waits for its create's answer.
  await flush();
  h.socket().open();
  h.clock.advance(POLL_MS);
  h.socket().receive(SERVER.currentTask());
  const session = await h.starting;
  return { ...h, session };
}
