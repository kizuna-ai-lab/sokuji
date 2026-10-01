/**
 * The Doubao AST 2.0 suites' fixtures: credentials of both kinds, the
 * settings the adapter suites build from, the server's frames as the binary
 * frames it sends, what the client sent, decoded, and a leg started over
 * `FakeSocket`s. Test-only: nothing but a test imports it (the session-side
 * guard's kit rule counts every provider's `testing.ts` as kit and holds it
 * to that), and the adapter's session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { fakeSockets, type FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { SharedSettings } from '../../lib/provider/types';
import { createAst2Adapter } from './adapter';
import { buildAst2, type Ast2Config } from './config';
import { data as proto } from './proto/ast2-proto.js';
import { AST2_DEFAULTS, type Ast2Credentials, type Ast2Settings } from './settings';
import type { OggDecoder } from './speech';
import { EventType, OK_STATUS } from './wire';

/** The legacy mode's. The token is shaped as a key `redact()` masks (`sk-…`): a frame that carried it fails the kit's frame-secret rule. */
export const APP_KEY: Ast2Credentials = { kind: 'app', appKey: '1234567890', accessKey: 'sk-ast2token0123456' };
/** The new console's, shaped as `redact()`'s `key-…`. */
export const API_KEY: Ast2Credentials = { kind: 'apiKey', apiKey: 'key-ast2api0123456789' };

/** A browser that will not open the socket, as Chromium refuses one: a DOMException named SyntaxError, the URL with its credentials in the message. Stubbed as the global `WebSocket`. */
export class RefusingWebSocket {
  constructor(url: string) {
    throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' is invalid.`, 'SyntaxError');
  }
}

/** Ids in the order a start asks for them: its session's, then its connection's. */
export function counterIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}
/** A start's session id, under `counterIds`. */
export const SESSION_ID = 'id-1';

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'zh', target: 'en' }, speech: true, turns: 'auto' };

/** A leg's config: Doubao's defaults, patched. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<Ast2Settings> = {}): Ast2Config {
  return buildAst2(context, { ...AST2_DEFAULTS, ...patch }, SHARED) as Ast2Config;
}

/** A server frame as Doubao sends it: a binary `TranslateResponse`, read as an ArrayBuffer. */
export function serverFrame(r: proto.speech.ast.ITranslateResponse): ArrayBuffer {
  const bytes = proto.speech.ast.TranslateResponse.encode(r).finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type Meta = { session?: string; sequence?: number; status?: number; message?: string };
/** A frame's server times, as a subtitle's `Start` and `End` and a TTS sentence's `Start` and `End` carry them (the owner's probe, 2026-09-28). */
type Times = { startTime?: number; endTime?: number };
const meta = (m: Meta = {}) => ({ SessionID: m.session ?? SESSION_ID, Sequence: m.sequence ?? 0, StatusCode: m.status ?? OK_STATUS, ...(m.message ? { Message: m.message } : {}) });
const SUBTITLE = {
  source: { start: EventType.SourceSubtitleStart, response: EventType.SourceSubtitleResponse, end: EventType.SourceSubtitleEnd },
  translation: { start: EventType.TranslationSubtitleStart, response: EventType.TranslationSubtitleResponse, end: EventType.TranslationSubtitleEnd },
};

/** The server frames the suites send, by name. */
export const SERVER = {
  started: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.SessionStarted }),
  subtitle: (side: 'source' | 'translation', phase: 'start' | 'response' | 'end', text = '', m?: Meta & Times) =>
    serverFrame({ responseMeta: meta(m), event: SUBTITLE[side][phase], text, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
  ttsStart: (m?: Meta & Times) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceStart, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
  ttsChunk: (bytes = 64, fill = 7, m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSResponse, data: new Uint8Array(bytes).fill(fill) }),
  ttsEnd: (m?: Meta & Times) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceEnd, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
  ttsEnded: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSEnded }),
  /** A refusal: a status other than OK, on any event. */
  status: (status: number, message: string, event = EventType.None) => serverFrame({ responseMeta: meta({ status, message }), event }),
  failed: (message = 'session failed') => serverFrame({ responseMeta: meta({ message }), event: EventType.SessionFailed }),
  finished: () => serverFrame({ responseMeta: meta(), event: EventType.SessionFinished }),
  canceled: () => serverFrame({ responseMeta: meta(), event: EventType.SessionCanceled }),
  /** A frame that reads, with no event: nothing to say. */
  none: () => serverFrame({ responseMeta: meta(), event: EventType.None }),
  usage: () => serverFrame({ responseMeta: { ...meta(), Billing: { DurationMsec: 61_000, WordCount: 12, Items: [{ Unit: 'minute', Quantity: 1.02 }] } }, event: EventType.UsageResponse }),
  muted: (ms = 3_000) => serverFrame({ responseMeta: meta(), event: EventType.AudioMuted, mutedDurationMs: ms }),
};

/** What the client sent on this socket, decoded, in order. */
export function sentRequests(socket: FakeSocket): proto.speech.ast.TranslateRequest[] {
  return socket.sent.map((d) => proto.speech.ast.TranslateRequest.decode(d as Uint8Array));
}

/** A `TaskRequest`'s 16 kHz samples. */
export function pcmOf(request: proto.speech.ast.TranslateRequest): Int16Array {
  const bytes = request.sourceAudio?.binaryData ?? new Uint8Array();
  return new Int16Array(new Uint8Array(bytes).buffer);
}

/** A Doubao leg started over `FakeSocket`s on a tracked virtual clock; its socket not yet opened. The decoder answers one sample per byte, unless given its own. */
export function startAst2(o: { context?: SessionContext; credentials?: Ast2Credentials; patch?: Partial<Ast2Settings>; decode?: OggDecoder; online?: boolean } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const config = configFor(context, o.patch);
  const decode = o.decode ?? (async (ogg: Uint8Array) => new Int16Array(ogg.length));
  const adapter = createAst2Adapter({ openSocket: sockets.create, decode, newId: counterIds(), online: () => o.online ?? true });
  const starting = adapter.start({ context, config, credentials: o.credentials ?? APP_KEY, clock, signal: controller.signal }, events);
  const socket = () => sockets.last();
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The payloads of the frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  /** What the client sent on the leg's socket, decoded. */
  const requests = () => sentRequests(socket());
  /** The log without its frames: what L1 folds. */
  const content = () => log.filter((e) => e.kind !== 'frame');
  return { sockets, clock, timers, log, controller, config, starting, socket, of, frames, requests, content };
}

/** Started, opened and answered: the start resolved. */
export async function liveAst2(o?: Parameters<typeof startAst2>[0]) {
  const h = startAst2(o);
  h.socket().open();
  h.socket().receive(SERVER.started());
  const session = await h.starting;
  return { ...h, session };
}
