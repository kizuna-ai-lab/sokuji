/**
 * The Doubao AST 2.0 suites' fixtures: credentials of both kinds, the
 * settings the adapter suites build from, the server's frames as the binary
 * frames it sends, and what the client sent, decoded. Test-only: nothing but
 * a test imports it, and the adapter's session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import type { SharedSettings } from '../../lib/provider/types';
import { buildAst2, type Ast2Config } from './config';
import { data as proto } from './proto/ast2-proto.js';
import { AST2_DEFAULTS, type Ast2Credentials, type Ast2Settings } from './settings';
import { EventType, OK_STATUS } from './wire';

/** The legacy mode's. The token is shaped as a key `redact()` masks (`sk-…`): a frame that carried it fails the kit's frame-secret rule. */
export const APP_KEY: Ast2Credentials = { kind: 'app', appKey: '1234567890', accessKey: 'sk-ast2token0123456' };
/** The new console's, shaped as `redact()`'s `key-…`. */
export const API_KEY: Ast2Credentials = { kind: 'apiKey', apiKey: 'key-ast2api0123456789' };

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
const meta = (m: Meta = {}) => ({ SessionID: m.session ?? SESSION_ID, Sequence: m.sequence ?? 0, StatusCode: m.status ?? OK_STATUS, ...(m.message ? { Message: m.message } : {}) });
const SUBTITLE = {
  source: { start: EventType.SourceSubtitleStart, response: EventType.SourceSubtitleResponse, end: EventType.SourceSubtitleEnd },
  translation: { start: EventType.TranslationSubtitleStart, response: EventType.TranslationSubtitleResponse, end: EventType.TranslationSubtitleEnd },
};

/** The server frames the suites send, by name. */
export const SERVER = {
  started: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.SessionStarted }),
  subtitle: (side: 'source' | 'translation', phase: 'start' | 'response' | 'end', text = '', m?: Meta & { startTime?: number; endTime?: number }) =>
    serverFrame({ responseMeta: meta(m), event: SUBTITLE[side][phase], text, startTime: m?.startTime ?? 0, endTime: m?.endTime ?? 0 }),
  ttsStart: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceStart }),
  ttsChunk: (bytes = 64, fill = 7, m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSResponse, data: new Uint8Array(bytes).fill(fill) }),
  ttsEnd: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSSentenceEnd }),
  ttsEnded: (m?: Meta) => serverFrame({ responseMeta: meta(m), event: EventType.TTSEnded }),
  /** A refusal: a status other than OK, on any event. */
  status: (status: number, message: string, event = EventType.None) => serverFrame({ responseMeta: meta({ status, message }), event }),
  failed: (message = 'session failed') => serverFrame({ responseMeta: meta({ message }), event: EventType.SessionFailed }),
  finished: () => serverFrame({ responseMeta: meta(), event: EventType.SessionFinished }),
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
