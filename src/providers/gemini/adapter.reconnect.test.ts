/**
 * Gemini's resumption ladder (ruling 3, choice 14): three attempts on the
 * request's clock, each bounded; the resumable handle when one is held,
 * a fresh session when none is; break before make on goAway; what the
 * gap does to segments, presses and audio; stop. On `FakeSocket` and a
 * virtual clock.
 */
import { describe, it, expect } from 'vitest';
import { checkConformance } from '../../lib/contract/conformance';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { flush } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { createGeminiAdapter, RECONNECT_DELAYS_MS, SETUP_TIMEOUT_MS } from './adapter';
import { buildGemini, type GeminiConfig } from './config';
import { GEMINI_DEFAULTS } from './settings';
import { AUTO_CTX, configFor, DIALOGUE, KEY, liveGemini, SERVER, serverFrame, SHARED, trackedClock, TRANSLATE } from './testing';
import { setupFrame } from './wire';

type Live = Awaited<ReturnType<typeof liveGemini>>;
/** A model audio part named pcm whose data is not base64: `atob` refuses it. */
const BAD_AUDIO = () => serverFrame({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: '%%not base64%%' } }] } } });

/** The newest socket opens and the server answers its setup. */
async function answer(h: Pick<Live, 'socket'>): Promise<void> {
  h.socket().open();
  h.socket().receive(SERVER.setupComplete());
  await flush();
}
/** The newest attempt drops before it opens. */
async function drop(h: Pick<Live, 'socket'>): Promise<void> {
  h.socket().drop();
  await flush();
}

/**
 * Live Translate whose open segment outlives the ladder, which takes 5 s
 * from the drop to `failed`: the longest pause the settings allow (3 s),
 * with the display cut by sentences, so a segment that stops mid-sentence
 * waits one window more (choice 7) and closes 6 s after its last word.
 */
async function liveTranslateOutlastingTheLadder() {
  const sockets = fakeSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const shared = { ...SHARED, pauses: { sourceSeconds: 3, translationSeconds: 3 }, segmentation: { mode: 'sentences' as const, sentencesPerRow: 1 } };
  const config = buildGemini(AUTO_CTX, { ...GEMINI_DEFAULTS, model: TRANSLATE }, shared) as GeminiConfig;
  const starting = createGeminiAdapter({ openSocket: sockets.create }).start({ context: AUTO_CTX, config, credentials: KEY, clock, signal: new AbortController().signal }, events);
  const socket = () => sockets.last();
  socket().open();
  socket().receive(SERVER.setupComplete());
  await starting;
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  return { config, sockets, clock, timers, log, socket, of, frames };
}

describe("the Gemini adapter's resumption ladder", () => {
  it('is the old ladder: at once, after 2 s, after 3 s', () => {
    expect(RECONNECT_DELAYS_MS).toEqual([0, 2_000, 3_000]);
  });

  it('makes three attempts on the clock, then fails the leg with connection_lost, leaving no timer — not even that of a segment still open', async () => {
    const h = await liveTranslateOutlastingTheLadder();
    expect(h.config.silence).toEqual({ sourceMs: 3_000, translationMs: 3_000, deferMidSentence: true });
    h.socket().receive(SERVER.input('Hel'));
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    expect(h.of('reconnecting')).toHaveLength(1);
    expect(h.sockets.all).toHaveLength(2);
    await drop(h);
    h.clock.advance(1_999);
    await flush();
    expect(h.sockets.all).toHaveLength(2);
    h.clock.advance(1);
    await flush();
    expect(h.sockets.all).toHaveLength(3);
    await drop(h);
    h.clock.advance(2_999);
    await flush();
    expect(h.sockets.all).toHaveLength(3);
    h.clock.advance(1);
    await flush();
    expect(h.sockets.all).toHaveLength(4);
    await drop(h);
    expect(h.frames('session.reconnect_failed').map((p) => (p as { attempt: number }).attempt)).toEqual([1, 2, 3]);
    expect(h.frames('session.connection_lost')).toEqual([{ attempts: 3 }]);
    expect(h.of('failed').map((e) => e.payload.code)).toEqual(['connection_lost']);
    expect(h.of('reconnected')).toEqual([]);
    // The segment rode its timer across the gap and was still open when the leg failed: its timer ended with the leg.
    expect(h.of('segmentClosed')).toEqual([]);
    expect(h.timers()).toBe(0);
    const n = h.log.length;
    // Past the segment's silence window, which would have closed it 6 s after its last word.
    h.clock.advance(3_000);
    await flush();
    expect(h.log.length).toBe(n);
    expect(checkConformance(h.log, AUTO_CTX)).toEqual([]);
  });

  it('resumes with the last handle the server issued while resumable', async () => {
    const h = await liveGemini();
    h.socket().receive(SERVER.handle('h-1'));
    // Issued while the model generates: not resumable, so not recorded, though it came last.
    h.socket().receive(SERVER.handle('h-0', false));
    h.socket().receive(serverFrame({ sessionResumptionUpdate: { resumable: true } }));
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    h.socket().open();
    expect(h.sent()).toEqual([setupFrame(configFor(DIALOGUE), 'h-1')]);
    h.socket().receive(SERVER.setupComplete());
    await flush();
    expect(h.of('reconnected')).toHaveLength(1);
    expect(h.frames('session.opened').map((p) => (p as { resumed: boolean }).resumed)).toEqual([false, true]);
    expect(h.frames('session.reconnecting')).toEqual([{ cause: 'close', code: 1011, reason: 'Internal error', hasHandle: true }]);
  });

  it('with no handle it opens a fresh session, whatever the conversation holds (ruling 3)', async () => {
    const h = await liveGemini();
    h.socket().receive(SERVER.input('Hello.'));
    h.socket().receive(SERVER.output('こんにちは。'));
    h.socket().receive(SERVER.turnComplete());
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    h.socket().open();
    expect(h.sent()).toEqual([setupFrame(configFor(DIALOGUE), null)]);
    h.socket().receive(SERVER.setupComplete());
    await flush();
    expect(h.of('reconnected')).toHaveLength(1);
    expect(h.of('failed')).toEqual([]);
  });

  it('a close refused for good (1008) still tries the ladder, as the old code did, and ends within its attempts', async () => {
    const h = await liveGemini();
    h.socket().serverClose(1008, 'Policy violation');
    await flush();
    const refuse = async () => {
      h.socket().open();
      h.socket().serverClose(1008, 'Policy violation');
      await flush();
    };
    await refuse();
    h.clock.advance(2_000);
    await flush();
    await refuse();
    h.clock.advance(3_000);
    await flush();
    await refuse();
    expect(h.frames('session.reconnect_failed').map((p) => (p as { message: string }).message)).toEqual(Array(3).fill('[Gemini 1008] Policy violation'));
    expect(h.of('failed').map((e) => e.payload.code)).toEqual(['connection_lost']);
  });

  it('goAway breaks before it makes: the old socket closes first, audio in the gap is dropped, and the new setup carries the handle', async () => {
    const h = await liveGemini();
    h.socket().receive(SERVER.handle('h-1'));
    const first = h.socket();
    first.receive(SERVER.goAway());
    expect(first.closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.sockets.all).toHaveLength(2);
    h.session.appendAudio(new Int16Array(10));
    h.socket().open();
    expect(h.sent()).toEqual([setupFrame(configFor(DIALOGUE), 'h-1')]);
    expect(first.sent).toHaveLength(1);
    expect(h.frames('server.go_away')).toEqual([{ timeLeft: '50s' }]);
    expect(h.frames('session.reconnecting')).toEqual([{ cause: 'go_away', hasHandle: true }]);
    await flush();
    expect(h.of('reconnecting')).toHaveLength(1);
  });

  it('a goAway on an attempt not yet set up is ignored: one reconnect at a time', async () => {
    const h = await liveGemini();
    h.socket().receive(SERVER.goAway());
    h.socket().open();
    h.socket().receive(SERVER.goAway());
    h.socket().receive(SERVER.setupComplete());
    await flush();
    expect(h.of('reconnecting')).toHaveLength(1);
    expect(h.of('reconnected')).toHaveLength(1);
    expect(h.sockets.all).toHaveLength(2);
  });

  it('a superseded socket is heard no more, even when its handlers fire late (a stale socket, `GeminiClient.test.ts:443-473`)', async () => {
    const h = await liveGemini();
    const first = h.socket();
    // The adapter's own handlers, kept before the reconnect detaches them.
    const onmessage = first.onmessage!;
    const onclose = first.onclose!;
    first.receive(SERVER.goAway());
    const n = h.log.length;
    onmessage.call(first, new MessageEvent('message', { data: SERVER.input('late') }));
    onclose.call(first, new CloseEvent('close', { code: 1011, reason: 'late' }));
    await flush();
    expect(h.log.length).toBe(n);
    expect(h.of('reconnecting')).toHaveLength(1);
    expect(h.sockets.all).toHaveLength(2);
  });

  it('a handle is single-use: a failed resume keeps it, a resume that succeeded drops it unless the new session issued another', async () => {
    const h = await liveGemini();
    h.socket().receive(SERVER.handle('h-1'));
    h.socket().serverClose(1011, '');
    await flush();
    await drop(h);
    h.clock.advance(2_000);
    await flush();
    h.socket().open();
    expect(h.sent()).toEqual([setupFrame(configFor(DIALOGUE), 'h-1')]);
    h.socket().receive(SERVER.setupComplete());
    await flush();
    h.socket().serverClose(1011, '');
    await flush();
    h.socket().open();
    expect(h.sent()).toEqual([setupFrame(configFor(DIALOGUE), null)]);
    h.socket().receive(SERVER.setupComplete());
    await flush();
    h.socket().receive(SERVER.handle('h-2'));
    h.socket().serverClose(1011, '');
    await flush();
    h.socket().open();
    expect(h.sent()).toEqual([setupFrame(configFor(DIALOGUE), 'h-2')]);
    // This resume's new session issues a handle before the resume settles (in the setup answer's own tick): it is kept.
    h.socket().receive(SERVER.setupComplete());
    h.socket().receive(SERVER.handle('h-3'));
    await flush();
    h.socket().serverClose(1011, '');
    await flush();
    h.socket().open();
    expect(h.sent()).toEqual([setupFrame(configFor(DIALOGUE), 'h-3')]);
  });

  it('an attempt that opens and never answers is bounded by the setup timeout, then the next attempt runs', async () => {
    const h = await liveGemini();
    h.socket().serverClose(1011, '');
    await flush();
    h.socket().open();
    h.clock.advance(SETUP_TIMEOUT_MS);
    await flush();
    expect(h.frames('session.reconnect_failed')).toEqual([{ attempt: 1, maxRetries: 3, message: 'Gemini did not answer the setup within 15 s.' }]);
    expect(h.sockets.all[1].closedByClient).not.toBeNull();
    h.clock.advance(2_000);
    await flush();
    expect(h.sockets.all).toHaveLength(3);
  });

  it('a stop during a backoff or an attempt ends it silently, leaving no timer', async () => {
    const waiting = await liveGemini();
    waiting.socket().serverClose(1011, '');
    await flush();
    await drop(waiting);
    const n = waiting.log.length;
    await waiting.session.stop();
    // The backoff's timer is cancelled by the stop itself, not merely outlived.
    expect(waiting.timers()).toBe(0);
    waiting.clock.advance(10_000);
    await flush();
    expect(waiting.sockets.all).toHaveLength(2);
    expect(waiting.log.length).toBe(n);
    expect(waiting.timers()).toBe(0);

    const trying = await liveGemini();
    trying.socket().serverClose(1011, '');
    await flush();
    const attempt = trying.socket();
    const m = trying.log.length;
    await trying.session.stop();
    expect(attempt.closedByClient).not.toBeNull();
    await flush();
    expect(trying.log.length).toBe(m);
    expect(trying.timers()).toBe(0);
  });

  it("a dialogue turn in flight closes as it stands; Live Translate's segments ride their timers across the gap (choice 14)", async () => {
    const d = await liveGemini();
    d.socket().receive(SERVER.input('Hel'));
    d.socket().serverClose(1011, '');
    await flush();
    expect(d.content().map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed', 'reconnecting']);
    expect(d.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1, origin: 't1' }]);
    await answer(d);
    d.socket().receive(SERVER.input('lo'));
    expect(d.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 't1' }, { ref: 2, side: 'source', origin: 't2' }]);

    const t = await liveGemini({ model: TRANSLATE });
    t.socket().receive(SERVER.input('Hel'));
    t.socket().serverClose(1011, '');
    await flush();
    expect(t.of('segmentClosed')).toEqual([]);
    t.clock.advance(1_500);
    expect(t.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
  });

  it('a press held across the gap starts again on the new connection (choice 14)', async () => {
    const h = await liveGemini({ context: { ...AUTO_CTX, turns: 'manual' } });
    h.session.beginTurn();
    h.socket().serverClose(1011, '');
    await flush();
    await answer(h);
    expect(h.sent().slice(1)).toEqual([{ realtimeInput: { activityStart: {} } }]);
    h.session.endTurn();
    expect(h.sent().slice(2)).toEqual([{ realtimeInput: { activityEnd: {} } }]);
  });

  it("a press released in the gap reached no server, so no answer is owed for it: a voiceless press after the reconnect still drops its own (ruling 8)", async () => {
    const h = await liveGemini({ context: { ...AUTO_CTX, turns: 'manual' } });
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(480));
    h.socket().serverClose(1011, '');
    await flush();
    h.session.endTurn();
    await answer(h);
    // The release went nowhere, and nothing is held to start again: the new connection has only its setup.
    expect(h.sent()).toHaveLength(1);
    h.session.beginTurn();
    h.session.cancelTurn();
    // Should the server answer the voiceless press anyway, that answer is the cancelled press's own.
    h.socket().receive(SERVER.output('an answer to the cancelled press'));
    h.socket().receive(SERVER.turnComplete());
    expect(h.of('segmentOpened')).toEqual([]);
    // The control: the next press's answer is shown.
    h.session.beginTurn();
    h.session.appendAudio(new Int16Array(480));
    h.session.endTurn();
    h.socket().receive(SERVER.output('the next answer'));
    h.socket().receive(SERVER.turnComplete());
    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['the next answer']);
  });

  it('a resumed connection starts readable: an audio part the old one could not decode silences nothing on the new one', async () => {
    const h = await liveGemini();
    h.socket().receive(BAD_AUDIO());
    h.socket().serverClose(1011, '');
    await flush();
    await answer(h);
    h.socket().receive(BAD_AUDIO());
    expect(h.frames('server.unreadable')).toHaveLength(2);
    expect(h.of('reconnected')).toHaveLength(1);
  });

  it('each new socket starts readable, before its setup is answered too: a frame the old one could not parse silences nothing on it', async () => {
    const h = await liveGemini();
    h.socket().receive('{bad');
    h.socket().serverClose(1011, '');
    await flush();
    h.socket().open();
    h.socket().receive('{bad');
    expect(h.frames('server.unreadable')).toHaveLength(2);
    h.socket().receive(SERVER.setupComplete());
    await flush();
    expect(h.of('reconnected')).toHaveLength(1);
  });

  it('nothing reconnects after stop', async () => {
    const h = await liveGemini();
    await h.session.stop();
    await flush();
    expect(h.sockets.all).toHaveLength(1);
    expect(h.of('reconnecting')).toEqual([]);
  });
});
