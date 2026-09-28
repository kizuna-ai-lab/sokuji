/**
 * The Gemini suites' fixtures: the models, a key, the settings the adapter
 * suites build from, the server's frames as the binary frames the Live
 * API sends, a clock that counts its live timers, and the harness that
 * starts a leg over `FakeSocket`s. Test-only: nothing but a test imports
 * it (the session-side guard's kit rule counts every provider's
 * `testing.ts` as kit and holds it to that), and the adapter's session
 * walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { SharedSettings } from '../../lib/provider/types';
import { createGeminiAdapter } from './adapter';
import { buildGemini, type GeminiConfig } from './config';
import { GEMINI_DEFAULTS, type GeminiCredentials, type GeminiSettings } from './settings';

export const DIALOGUE = 'gemini-2.5-flash-native-audio-preview-12-2025';
export const TRANSLATE = 'gemini-3.5-live-translate-preview';
/** Shaped as a real key (`AIza…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: GeminiCredentials = { apiKey: 'AIzaTestKey0123456789' };

/** A browser that will not open the socket, as Chromium refuses one: a DOMException named SyntaxError, the URL with its key in the message. Stubbed as the global `WebSocket`. */
export class RefusingWebSocket {
  constructor(url: string) {
    throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' is invalid.`, 'SyntaxError');
  }
}

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'ja-JP' && d.target === 'en-US',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: TRANSLATE }, { id: DIALOGUE }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'en-US', target: 'ja-JP' }, speech: true, turns: 'auto' };

/** A leg's config: Gemini's defaults with `model` saved. */
export function configFor(model: string, context: SessionContext = AUTO_CTX, patch: Partial<GeminiSettings> = {}): GeminiConfig {
  return buildGemini(context, { ...GEMINI_DEFAULTS, model, ...patch }, SHARED) as GeminiConfig;
}

/** A server frame as the Live API sends it — binary JSON, read as an ArrayBuffer (`binaryType = 'arraybuffer'`). */
export function serverFrame(message: Record<string, unknown>): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** `samples` of 24 kHz pcm as a model audio part carries it: base64 of little-endian Int16. */
export function b64(samples: number, fill = 9): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The server frames the suites send, by name. */
export const SERVER = {
  setupComplete: () => serverFrame({ setupComplete: { sessionId: 'sid-1' } }),
  input: (text: string) => serverFrame({ serverContent: { inputTranscription: { text } } }),
  output: (text: string) => serverFrame({ serverContent: { outputTranscription: { text } } }),
  audio: (samples = 2400, mimeType = 'audio/pcm;rate=24000') => serverFrame({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType, data: b64(samples) } }] } } }),
  turnComplete: () => serverFrame({ serverContent: { turnComplete: true } }),
  interrupted: () => serverFrame({ serverContent: { interrupted: true } }),
  goAway: () => serverFrame({ goAway: { timeLeft: '50s' } }),
  handle: (newHandle: string, resumable = true) => serverFrame({ sessionResumptionUpdate: { newHandle, resumable } }),
};

/** A virtual clock that counts its live timers: the kit's now (Stage 2 Volcengine AST2, its third user; Gemini choice 21). */
export { trackedClock };

/** A Gemini leg started over `FakeSocket`s on a tracked virtual clock; its socket not yet opened. */
export function startGemini(o: { model?: string; context?: SessionContext; patch?: Partial<GeminiSettings> } = {}) {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const config = configFor(o.model ?? DIALOGUE, context, o.patch);
  const starting = createGeminiAdapter({ openSocket: sockets.create }).start({ context, config, credentials: KEY, clock, signal: controller.signal }, events);
  const socket = () => sockets.last();
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The payloads of the frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  /** What the adapter sent on the newest socket, parsed. */
  const sent = () => socket().sentJson<Record<string, unknown>>();
  /** The log without its frames: what L1 folds. */
  const content = () => log.filter((e) => e.kind !== 'frame');
  return { sockets, clock, timers, log, controller, config, starting, socket, of, frames, sent, content };
}

/** Started, opened and set up: the start resolved. */
export async function liveGemini(o?: Parameters<typeof startGemini>[0]) {
  const h = startGemini(o);
  h.socket().open();
  h.socket().receive(SERVER.setupComplete());
  const session = await h.starting;
  return { ...h, session };
}
