/**
 * The OpenAI Translate suites' fixtures: a key, the settings the suites
 * build from, the server's events as the JSON text frames the endpoint
 * sends, and a browser that refuses the socket. Test-only: nothing but a
 * test imports it (the session-side guard's kit rule counts every
 * provider's `testing.ts` as kit and holds it to that), and the adapter's
 * session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildTranslate, type TranslateConfig } from './config';
import { TRANSLATE_DEFAULTS, type TranslateCredentials, type TranslateSettings } from './settings';

/** Shaped as a real key (`sk-…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: TranslateCredentials = { apiKey: 'sk-proj-translateKey0123456789' };

/** A browser that will not open the socket, as Chromium refuses an invalid subprotocol: a DOMException named SyntaxError whose message quotes the subprotocols, the key among them. Stubbed as the global `WebSocket`. */
export class RefusingWebSocket {
  constructor(_url: string, protocols?: string | string[]) {
    const list = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    throw new DOMException(`Failed to construct 'WebSocket': The subprotocol '${list.join(', ')}' is invalid.`, 'SyntaxError');
  }
}

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en' && d.target === 'ja',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-realtime-translate' }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };

/** A leg's config: the defaults, patched. A refusal is a fixture bug, not a case any suite means to build — it throws loudly rather than hiding behind a cast. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<TranslateSettings> = {}): TranslateConfig {
  const c = buildTranslate(context, { ...TRANSLATE_DEFAULTS, ...patch }, SHARED);
  if ('refused' in c) throw new Error(c.refused);
  return c;
}

/** `samples` of 24 kHz pcm16 as an audio delta carries it: base64 of little-endian Int16. `fill` 0 is a heartbeat. */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const event = (e: Record<string, unknown>) => JSON.stringify({ event_id: 'event_1', ...e });
/** The session as `session.created` reports it: the server's defaults. */
const SESSION = { id: 'sess_1', type: 'translation', model: 'gpt-realtime-translate', expires_at: 1_790_000_000, audio: { input: { noise_reduction: { type: 'near_field' }, transcription: null }, output: { language: 'en' } } };

/** The server's events, by name, as the endpoint sends them: JSON text frames. */
export const SERVER = {
  created: () => event({ type: 'session.created', session: SESSION }),
  updated: () => event({ type: 'session.updated', session: { ...SESSION, audio: { input: { noise_reduction: null, transcription: { model: 'gpt-live-transcribe' } }, output: { language: 'en' } } } }),
  input: (delta: string, elapsed: number | null = 0) => event({ type: 'session.input_transcript.delta', delta, elapsed_ms: elapsed }),
  output: (delta: string, elapsed: number | null = 0) => event({ type: 'session.output_transcript.delta', delta, elapsed_ms: elapsed }),
  /** Content audio: 200 ms by default. An explicit `null` elapsed passes through, as `input` and `output` already do — only an omitted one defaults to 0. */
  audio: (o: { samples?: number; fill?: number; elapsed?: number | null; rate?: number } = {}) =>
    event({ type: 'session.output_audio.delta', delta: b64(o.samples ?? 4_800, o.fill ?? 900), elapsed_ms: o.elapsed === undefined ? 0 : o.elapsed, format: 'pcm16', sample_rate: o.rate ?? 24_000, channels: 1 }),
  /** A heartbeat: an all-zero frame. */
  heartbeat: (samples = 4_800) => event({ type: 'session.output_audio.delta', delta: b64(samples, 0), elapsed_ms: 0, format: 'pcm16', sample_rate: 24_000, channels: 1 }),
  error: (e: { type?: string; code?: string | null; message?: string } = {}) =>
    event({ type: 'error', error: { type: 'invalid_request_error', code: null, message: 'Something was wrong.', param: null, event_id: null, ...e } }),
  closed: () => event({ type: 'session.closed' }),
  /** An event by its type alone: a `.done` the SDK does not list, or one it never sends. */
  bare: (type: string) => event({ type }),
};
