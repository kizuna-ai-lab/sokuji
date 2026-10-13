/**
 * The Qwen LiveTranslate suites' fixtures: a key in the real shape, the
 * settings the suites build from, the server's events as the JSON text
 * frames the storefronts send (the shapes the owner's probe recorded,
 * 2026-10-13), one whole turn in the recorded order, and the harness that
 * starts a leg over the header seam's fake on a tracked virtual clock.
 * Test-only: nothing but a test imports it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { flush } from '../../lib/contract/testing/drive';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { SharedSettings } from '../../lib/provider/types';
import { createQwenAdapter } from './adapter';
import type { DetectEndpoint } from './check';
import { buildQwen, type QwenConfig } from './config';
import { QWEN_DEFAULTS, QWEN_MODEL, type QwenCredentials, type QwenSettings } from './settings';
import { base64ToPcm } from './wire';

/** The real keys' shape (dots and underscores), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: QwenCredentials = { apiKey: 'sk-ws-T.ABCDEFGH.ijklmnop_Q-rs.TUVWX0123456789' };

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  // The participant's direction in these suites: English into Chinese.
  reversed: (d) => d.source === 'en' && d.target === 'zh',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'intl' }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'zh', target: 'en' }, speech: true, turns: 'auto' };
export const MANUAL_CTX: SessionContext = { ...AUTO_CTX, turns: 'manual' };
export const TEXT_CTX: SessionContext = { ...AUTO_CTX, speech: false };
export const PARTICIPANT_CTX: SessionContext = { direction: { source: 'en', target: 'zh' }, speech: true, turns: 'auto' };

/** A leg's config: the defaults, patched. A refusal is a fixture bug: it throws. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<QwenSettings> = {}, shared: SharedSettings = SHARED): QwenConfig {
  const c = buildQwen(context, { ...QWEN_DEFAULTS, ...patch }, shared);
  if ('refused' in c) throw new Error(c.refused);
  return c;
}

/** `samples` of 24 kHz pcm16 as an audio delta carries it. */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const event = (e: Record<string, unknown>) => JSON.stringify({ event_id: 'event_1', ...e });

/** The server's events, by name, as the storefronts send them. */
export const SERVER = {
  created: (id = 'sess_1') => event({ type: 'session.created', session: { id, model: QWEN_MODEL, object: 'realtime.session' } }),
  updated: () => event({ type: 'session.updated', session: { id: 'sess_1', model: QWEN_MODEL } }),
  speechStarted: (itemId: string, speaker = 1) => event({ type: 'input_audio_buffer.speech_started', audio_start_ms: 360, item_id: itemId, speaker_id: speaker }),
  heardItem: (itemId: string, previous?: string) =>
    event({ type: 'conversation.item.created', ...(previous ? { previous_item_id: previous } : {}), item: { id: itemId, type: 'message', role: 'assistant', content: [{ type: 'input_audio' }] } }),
  answerItem: (itemId: string, previous: string) =>
    event({ type: 'conversation.item.created', previous_item_id: previous, item: { id: itemId, type: 'message', role: 'assistant', content: [] } }),
  outputItem: (itemId: string) => event({ type: 'response.output_item.added', response_id: 'resp_1', output_index: 0, item: { id: itemId, type: 'message', role: 'assistant', content: [] } }),
  sourceDelta: (itemId: string, delta: string) => event({ type: 'conversation.item.input_audio_transcription.delta', item_id: itemId, content_index: 0, delta }),
  sourceDone: (itemId: string, transcript: string) => event({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, content_index: 0, transcript }),
  transcriptDelta: (itemId: string, delta: string) => event({ type: 'response.audio_transcript.delta', response_id: 'resp_1', item_id: itemId, delta }),
  transcriptDone: (itemId: string, transcript: string) => event({ type: 'response.audio_transcript.done', response_id: 'resp_1', item_id: itemId, transcript }),
  textDelta: (itemId: string, delta: string) => event({ type: 'response.text.delta', response_id: 'resp_1', item_id: itemId, delta }),
  textDone: (itemId: string, text: string) => event({ type: 'response.text.done', response_id: 'resp_1', item_id: itemId, text }),
  /** 100 ms of translated speech. */
  audio: (itemId: string, samples = 2_400) => event({ type: 'response.audio.delta', response_id: 'resp_1', item_id: itemId, delta: b64(samples) }),
  /** The end of a translation's speech. */
  audioDone: (itemId: string) => event({ type: 'response.audio.done', response_id: 'resp_1', item_id: itemId, output_index: 0, content_index: 0 }),
  responseDone: () => event({ type: 'response.done', response: { status: 'completed', usage: { total_tokens: 197, input_tokens: 96, output_tokens: 101 } } }),
  error: (code = 'invalid_value', message = 'Invalid translation parameter.') => event({ type: 'error', error: { code, message } }),
  /** An event by its type alone. */
  bare: (type: string) => event({ type }),
};

/** One whole turn under automatic turns, in the order the probe recorded: heard item `item_h<n>`, translation `item_t<n>`. */
export function turn(n: number, o: { source: string; translation: string; speaker?: number; text?: boolean }): string[] {
  const heard = `item_h${n}`;
  const answer = `item_t${n}`;
  return [
    SERVER.speechStarted(heard, o.speaker ?? 1),
    SERVER.heardItem(heard),
    SERVER.bare('response.created'),
    SERVER.outputItem(answer),
    SERVER.answerItem(answer, heard),
    SERVER.sourceDelta(heard, o.source),
    o.text ? SERVER.textDelta(answer, o.translation) : SERVER.transcriptDelta(answer, o.translation),
    ...(o.text ? [] : [SERVER.audio(answer)]),
    SERVER.bare('input_audio_buffer.speech_stopped'),
    SERVER.sourceDone(heard, o.source),
    o.text ? SERVER.textDone(answer, o.translation) : SERVER.transcriptDone(answer, o.translation),
    ...(o.text ? [] : [SERVER.audioDone(answer)]),
    SERVER.responseDone(),
  ];
}

/** A leg started over the header seam's fake on a tracked virtual clock; its registration not yet answered, its socket not yet made. */
export function startQwen(o: { context?: SessionContext; patch?: Partial<QwenSettings>; credentials?: QwenCredentials; shared?: SharedSettings; detect?: DetectEndpoint } = {}) {
  const seam = fakeHeaderSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const config = configFor(context, o.patch, o.shared);
  const detected: string[] = [];
  const detect: DetectEndpoint = o.detect ?? (async (apiKey) => { detected.push(apiKey); return { endpoint: 'intl' }; });
  const starting = createQwenAdapter({ openHeaderSocket: seam.open, detect }).start({ context, config, credentials: o.credentials ?? KEY, clock, signal: controller.signal }, events);
  const socket = () => seam.sockets.last();
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The payloads of the frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  /** What the client sent on the newest socket, parsed. */
  const sent = () => socket().sentJson<Record<string, unknown>>();
  /** The pcm of every append sent on the newest socket, in order. */
  const appended = () => sent().filter((m) => m.type === 'input_audio_buffer.append').map((m) => base64ToPcm(m.audio as string));
  /** The log without its frames: what L1 folds. */
  const content = () => log.filter((e) => e.kind !== 'frame');
  return { seam, clock, timers, log, controller, config, detected, starting, socket, of, frames, sent, appended, content };
}

/** The registration answered and the socket open: nothing sent yet, `session.created` awaited. */
export async function openQwen(o?: Parameters<typeof startQwen>[0]) {
  const h = startQwen(o);
  await flush();
  h.socket().open();
  await flush();
  return h;
}

/** Started: the update confirmed, the start resolved. */
export async function qwenSession(o?: Parameters<typeof startQwen>[0]) {
  const h = await openQwen(o);
  h.socket().receive(SERVER.created());
  h.socket().receive(SERVER.updated());
  const session = await h.starting;
  return { ...h, session };
}
