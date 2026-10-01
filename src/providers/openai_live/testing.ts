/**
 * The OpenAI Live suites' fixtures: a key, the settings the suites build
 * from, the server's events as the JSON text frames the endpoint sends (the
 * shapes the owner's probe recorded), and the harness that starts a leg over
 * the header seam's fake on a tracked virtual clock. Test-only: nothing but
 * a test imports it (the session-side guard's kit rule), and the adapter's
 * session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { flush } from '../../lib/contract/testing/drive';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { SharedSettings } from '../../lib/provider/types';
import { createLiveAdapter } from './adapter';
import { buildLive, type LiveConfig } from './config';
import { LIVE_DEFAULTS, type LiveCredentials, type LiveSettings } from './settings';
import { base64ToPcm } from './wire';

/** Shaped as a real key (`sk-…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: LiveCredentials = { apiKey: 'sk-proj-liveKey0123456789' };

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en' && d.target === 'zh-CN',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-live-1' }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'zh-CN', target: 'en' }, speech: true, turns: 'auto' };
export const MANUAL_CTX: SessionContext = { ...AUTO_CTX, turns: 'manual' };

/** A leg's config: the defaults, patched. A refusal is a fixture bug: it throws. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<LiveSettings> = {}, shared: SharedSettings = SHARED): LiveConfig {
  const c = buildLive(context, { ...LIVE_DEFAULTS, ...patch }, shared);
  if ('refused' in c) throw new Error(c.refused);
  return c;
}

/** `samples` of 24 kHz pcm16 as an audio delta carries it. `fill` 900 is speech (RMS 0.027); 20 is the floor (0.0006). */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const event = (e: Record<string, unknown>) => JSON.stringify({ event_id: 'event_1', ...e });

/** The server's events, by name, as the endpoint sends them (`.superpowers/wire-probes/openai-live/*.jsonl`). */
export const SERVER = {
  started: (id = 'live_1') => event({ type: 'session.started', client_event_id: 'start_1', session: { id, expires_at: 1_790_713_967, model: 'gpt-live-1', status: 'active' } }),
  input: (delta: string, startMs: number | null = 0, endMs: number | null = 200) => event({ type: 'session.input_transcript.delta', start_ms: startMs, end_ms: endMs, delta }),
  output: (delta: string, startMs: number | null = 0, endMs: number | null = 200) => event({ type: 'session.output_transcript.delta', start_ms: startMs, end_ms: endMs, delta }),
  /** 100 ms of output, the stream's frame: speech by default. */
  audio: (o: { samples?: number; fill?: number } = {}) => event({ type: 'session.output_audio.delta', delta: b64(o.samples ?? 2_400, o.fill ?? 900) }),
  /** 100 ms of the stream's dithered floor. */
  floor: (samples = 2_400) => event({ type: 'session.output_audio.delta', delta: b64(samples, 20) }),
  usage: (seconds: number) => event({ type: 'session.usage.updated', usage: { seconds } }),
  closed: (reason = 'close_requested', seconds = 0) => event({ type: 'session.closed', reason, session: { id: 'live_1' }, usage: { seconds } }),
  error: (e: { type?: string; code?: string | null; message?: string; param?: string | null } = {}) =>
    event({ type: 'error', error: { type: 'invalid_request_error', code: null, message: 'Something was wrong.', param: null, ...e } }),
  /** U10: an invalid voice at `session.start`. */
  forbidden: () => event({ type: 'error', error: { type: 'invalid_request_error', code: 'forbidden', message: 'Voice session access denied.' } }),
  muted: () => event({ type: 'session.input_audio.muted', client_event_id: 'mute_1' }),
  unmuted: () => event({ type: 'session.input_audio.unmuted', client_event_id: 'unmute_1' }),
  /** An event by its type alone. */
  bare: (type: string) => event({ type }),
};

/** An OpenAI Live leg started over the header seam's fake on a tracked virtual clock; its registration not yet answered, its socket not yet made. */
export function startLive(o: { context?: SessionContext; patch?: Partial<LiveSettings>; credentials?: LiveCredentials; shared?: SharedSettings } = {}) {
  const seam = fakeHeaderSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const config = configFor(context, o.patch, o.shared);
  const starting = createLiveAdapter({ openHeaderSocket: seam.open }).start({ context, config, credentials: o.credentials ?? KEY, clock, signal: controller.signal }, events);
  const socket = () => seam.sockets.last();
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The payloads of the frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  /** What the client sent on the newest socket, parsed. */
  const sent = () => socket().sentJson<Record<string, unknown>>();
  /** The pcm of every append sent on the newest socket, in order. */
  const appended = () => sent().filter((m) => m.type === 'session.input_audio.append').map((m) => base64ToPcm(m.audio as string));
  /** The log without its frames: what L1 folds. */
  const content = () => log.filter((e) => e.kind !== 'frame');
  return { seam, clock, timers, log, controller, config, starting, socket, of, frames, sent, appended, content };
}

/** The registration answered and the socket open: `session.start` sent. */
export async function openLive(o?: Parameters<typeof startLive>[0]) {
  const h = startLive(o);
  await flush();
  h.socket().open();
  await flush();
  return h;
}

/** Started: the start resolved. */
export async function liveSession(o?: Parameters<typeof startLive>[0]) {
  const h = await openLive(o);
  h.socket().receive(SERVER.started());
  const session = await h.starting;
  return { ...h, session };
}
