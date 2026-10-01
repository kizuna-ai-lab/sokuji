/**
 * One leg's speech (`LegSpeech`): chunks stream as rangeless `audio`, a
 * clean segment end fills in their ranges (`speechRanges`, ruling 2), and
 * the old client's TTS failure episodes (ruling 3, choices 6 and 7). Driven
 * on `FakeSocket` and a virtual clock from the first run — no network, no
 * fake timers, no stubbed global.
 */
import { describe, it, expect } from 'vitest';
import { LegSpeech, tileSpan, type LegSpeechOptions } from './speech';
import type { AdapterFrame } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import { b64, type Json } from './testing';

/** A LegSpeech whose socket is not opened yet: `opening` is its `open()`. */
function create(options: Partial<LegSpeechOptions> = {}) {
  const clock = createVirtualClock(0);
  const sockets = fakeSockets();
  const { events, log } = recordEvents();
  const speech = new LegSpeech({ region: 'us', key: 'k', voice: 'Adrian', speed: 1, events, clock, openSocket: sockets.create, ...options });
  const opening = speech.open();
  const kinds = (k: AdapterEvent['kind']) => log.filter((e) => e.kind === k);
  const frames = (type: string): AdapterFrame[] => log.flatMap((e) => (e.kind === 'frame' && e.payload.type === type ? [e.payload] : []));
  const degraded = () => log.flatMap((e) => (e.kind === 'degraded' ? [e.payload.code] : []));
  const reasons = () => log.flatMap((e) => (e.kind === 'degraded' ? [e.payload.reason] : []));
  return { clock, sockets, log, speech, opening, kinds, frames, degraded, reasons };
}

async function setup(options: Partial<LegSpeechOptions> = {}) {
  const made = create(options);
  made.sockets.last().open();
  await made.opening;
  const tts = () => made.sockets.last();
  return { ...made, tts };
}

const payloadOf = (frame: AdapterFrame) => frame.payload as Json;

describe('tileSpan', () => {
  it("tiles a span by sample count, the last range ending at the span's end", () => {
    expect(tileSpan([0, 10], [100, 100], 'x'.repeat(10))).toEqual([[0, 5], [5, 10]]);
    expect(tileSpan([3, 9], [1, 2, 3], 'x'.repeat(9))).toEqual([[3, 4], [4, 6], [6, 9]]);
    expect(tileSpan([2, 7], [480], 'x'.repeat(7))).toEqual([[2, 7]]);
  });

  it('never ends a range inside a surrogate pair', () => {
    expect(tileSpan([0, 4], [1, 1], 'a😀b')).toEqual([[0, 3], [3, 4]]);
  });

  it('a chunk whose share rounds to nothing gets an empty range: harmless, pinned', () => {
    // Under half a code unit each: rounding gives some chunks [n, n]. The kit
    // rejects only start > end, and karaoke holds at the boundary.
    expect(tileSpan([0, 3], [1, 1, 1, 1, 1], 'abc')).toEqual([[0, 1], [1, 1], [1, 2], [2, 2], [2, 3]]);
  });
});

describe('LegSpeech', () => {
  it('streams each chunk as audio on its ref as it arrives, with no range', async () => {
    const { speech, tts, kinds, frames } = await setup();
    speech.speak(2, 'Hello. ', [0, 7], 'en');
    const sent = tts().sentJson<Json>();
    expect(sent[0]).toMatchObject({ stream_id: 'utt-1-1', api_key: 'k', language: 'en' });
    expect(sent).toContainEqual({ stream_id: 'utt-1-1', text: 'Hello. ', text_end: false });
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    expect(kinds('audio')).toHaveLength(1);
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    const audio = kinds('audio').map((e) => e.payload as { ref?: number; pcm: Int16Array; range?: unknown });
    expect(audio).toHaveLength(2);
    for (const a of audio) {
      expect(a.ref).toBe(2);
      expect(a.pcm).toBeInstanceOf(Int16Array);
      expect(a.pcm.length).toBe(2400);
      expect('range' in a).toBe(false);
    }
    expect(frames('tts.audio')).toHaveLength(2);
    expect(kinds('speechRanges')).toEqual([]);
  });

  it('fills in the chunks\' ranges when the segment ends cleanly, tiling its span by sample count', async () => {
    const { speech, tts, kinds } = await setup();
    speech.speak(2, 'Hello, world.', [0, 13], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(7200) }));
    expect(kinds('speechRanges')).toEqual([]);
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    expect(kinds('speechRanges').map((e) => e.payload)).toEqual([
      { ref: 2, ranges: [{ index: 0, range: [0, 3] }, { index: 1, range: [3, 13] }] },
    ]);
  });

  it("snaps a filled-in boundary past a surrogate pair in the text it was fed", async () => {
    const { speech, tts, kinds } = await setup();
    speech.speak(2, 'a😀', [0, 3], 'en');
    speech.speak(2, 'b', [3, 4], 'en');
    speech.endUtterance();
    // Equal chunks put the proportional boundary at 2, between the emoji's two halves.
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(1) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(1) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    expect(kinds('speechRanges').map((e) => e.payload)).toEqual([
      { ref: 2, ranges: [{ index: 0, range: [0, 3] }, { index: 1, range: [3, 4] }] },
    ]);
  });

  it('keeps no text for a segment once its ranges are filled in or it is lost', async () => {
    // Memory, not behaviour: a session's translations must not pile up here.
    const { speech, tts } = await setup();
    const held = () => (speech as unknown as { texts: Map<number, unknown> }).texts.size;
    speech.speak(2, 'Hello.', [0, 6], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    expect(held()).toBe(1);
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    expect(held()).toBe(0);
    speech.speak(4, 'Lost.', [0, 5], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-2', error_code: 408, error_message: 'Request timeout' }));
    expect(held()).toBe(0);
  });

  it("counts a ref's entries across its segments", async () => {
    const { speech, tts, kinds } = await setup();
    speech.speak(2, 'One. ', [0, 5], 'en');
    speech.speak(2, 'Two.', [5, 9], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-2', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-2', terminated: true }));
    expect(kinds('speechRanges').map((e) => e.payload)).toEqual([
      { ref: 2, ranges: [{ index: 0, range: [0, 5] }] },
      { ref: 2, ranges: [{ index: 1, range: [5, 9] }] },
    ]);
  });

  it("interleaved refs count their own entries: a new ref starts at 0 while another goes on", async () => {
    const { speech, tts, kinds } = await setup();
    speech.speak(2, 'One. ', [0, 5], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    speech.speak(4, 'Uno.', [0, 4], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-2', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-2', terminated: true }));
    speech.speak(2, 'Two.', [5, 9], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-3', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-3', terminated: true }));
    expect(kinds('speechRanges').map((e) => e.payload)).toEqual([
      { ref: 2, ranges: [{ index: 0, range: [0, 5] }] },
      { ref: 4, ranges: [{ index: 0, range: [0, 4] }] },
      { ref: 2, ranges: [{ index: 1, range: [5, 9] }] },
    ]);
  });

  it("after a reconnect a ref's index goes on, and the new socket's utt-1-1 does not merge with the old one's", async () => {
    const { speech, tts, sockets, kinds } = await setup();
    speech.speak(2, 'One', [0, 3], 'en'); // no end: utt-1-1 stays live on the first socket
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    // The server closes; its close event has not arrived when the next text
    // needs the socket, so the first socket's utt-1-1 never reports an end.
    tts().serverClose();
    speech.speak(2, ' two', [3, 7], 'en');
    speech.endUtterance();
    expect(sockets.all).toHaveLength(2);
    sockets.last().open();
    await flush();
    sockets.last().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    sockets.last().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    expect(kinds('audio')).toHaveLength(2);
    expect(kinds('speechRanges').map((e) => e.payload)).toEqual([
      { ref: 2, ranges: [{ index: 1, range: [3, 7] }] },
    ]);
  });

  it('a 408-killed segment gets no ranges and says tts_segment_lost, once per episode', async () => {
    const { speech, tts, kinds, degraded } = await setup();
    speech.speak(2, 'Hi.', [0, 3], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' }));
    expect(degraded()).toEqual(['tts_segment_lost']);
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    expect(kinds('speechRanges')).toEqual([]);
    // The next segment dies before any audio: the same episode.
    speech.speak(2, ' Yo.', [3, 7], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-2', error_code: 408, error_message: 'Request timeout' }));
    expect(degraded()).toEqual(['tts_segment_lost']);
    // Audio flowed again, so the next kill is a new episode.
    speech.speak(2, ' Ok.', [7, 11], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-3', audio: b64(2400) }));
    tts().receive(JSON.stringify({ stream_id: 'utt-1-3', error_code: 408, error_message: 'Request timeout' }));
    expect(degraded()).toEqual(['tts_segment_lost', 'tts_segment_lost']);
    expect(kinds('speechRanges')).toEqual([]);
  });

  it('a failure of all speech says tts_stopped, even after a lost segment', async () => {
    const { speech, tts, degraded, reasons, frames } = await setup();
    speech.speak(2, 'Hi.', [0, 3], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' }));
    expect(degraded()).toEqual(['tts_segment_lost']);
    speech.speak(4, 'Yo', [0, 2], 'en');
    tts().receive(JSON.stringify({ error_code: 400, error_message: 'Invalid voice' }));
    expect(degraded()).toEqual(['tts_segment_lost', 'tts_stopped']);
    expect(reasons()).toEqual(['tts_408', 'tts_400']);
    expect(frames('tts.degraded').map(payloadOf)).toEqual([
      { code: '408', message: 'Request timeout', scope: 'segment' },
      { code: '400', message: 'Invalid voice', scope: 'all' },
    ]);
    // The client's own verdict, as the old client logged it (`SonioxClient.ts:1472`): out, not in.
    expect(frames('tts.degraded').map((f) => f.direction)).toEqual(['out', 'out']);
    tts().receive(JSON.stringify({ error_code: 400, error_message: 'Invalid voice' }));
    expect(degraded()).toEqual(['tts_segment_lost', 'tts_stopped']);
    // A new live stream failing alike, with no audio between: the same episode.
    speech.speak(6, 'Hm', [0, 2], 'en');
    tts().receive(JSON.stringify({ error_code: 400, error_message: 'Invalid voice' }));
    expect(degraded()).toEqual(['tts_segment_lost', 'tts_stopped']);
  });

  it('an idle drop is silent, and the next text reconnects and flushes what waited, in order', async () => {
    const { speech, tts, sockets, kinds } = await setup();
    tts().drop();
    await flush();
    expect(kinds('degraded')).toEqual([]);
    speech.speak(4, 'Again.', [0, 6], 'en');
    expect(sockets.all).toHaveLength(2);
    speech.endUtterance();
    sockets.last().open();
    await flush();
    const sent = sockets.last().sentJson<Json>();
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ stream_id: 'utt-1-1', api_key: 'k', language: 'en' });
    expect(sent[1]).toEqual({ stream_id: 'utt-1-1', text: 'Again.', text_end: false });
    expect(sent[2]).toEqual({ stream_id: 'utt-1-1', text: '', text_end: true });
    expect(kinds('degraded')).toEqual([]);
  });

  it('an utterance end that waited on the reconnect is sent after its text', async () => {
    const { speech, tts, sockets } = await setup();
    tts().drop();
    await flush();
    // No sentence end: only the waiting endUtterance() can end this segment.
    speech.speak(4, 'Again', [0, 5], 'en');
    speech.endUtterance();
    sockets.last().open();
    await flush();
    const sent = sockets.last().sentJson<Json>();
    expect(sent.slice(1)).toEqual([
      { stream_id: 'utt-1-1', text: 'Again', text_end: false },
      { stream_id: 'utt-1-1', text: '', text_end: true },
    ]);
  });

  it('a reconnect that fails says tts_stopped', async () => {
    const { speech, tts, sockets, degraded, reasons, frames } = await setup();
    tts().drop();
    await flush();
    speech.speak(4, 'Again.', [0, 6], 'en');
    sockets.last().drop();
    await flush();
    expect(degraded()).toEqual(['tts_stopped']);
    expect(reasons()).toEqual(['tts_connect_failed']);
    expect(frames('tts.degraded').map(payloadOf)).toEqual([expect.objectContaining({ code: 'connect_failed', scope: 'all' })]);
  });

  it('a TTS connect that fails at start is silent until the first translation, which retries it; a failed retry says tts_stopped once (choice 6)', async () => {
    const { speech, sockets, opening, log, degraded } = create();
    sockets.last().drop();
    await opening;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'frame', payload: { direction: 'in', type: 'tts.connect_failed' } });
    expect(typeof payloadOf(log[0].payload as AdapterFrame).message).toBe('string');

    speech.speak(2, 'Hi.', [0, 3], 'en');
    expect(sockets.all).toHaveLength(2);
    sockets.last().drop();
    await flush();
    expect(degraded()).toEqual(['tts_stopped']);

    speech.speak(4, 'Yo.', [0, 3], 'en');
    expect(sockets.all).toHaveLength(3);
    sockets.last().drop();
    await flush();
    expect(degraded()).toEqual(['tts_stopped']);

    speech.speak(6, 'Ok.', [0, 3], 'en');
    expect(sockets.all).toHaveLength(4);
    sockets.last().open();
    await flush();
    const sent = sockets.last().sentJson<Json>();
    expect(sent[0]).toMatchObject({ stream_id: 'utt-1-1', api_key: 'k', language: 'en' });
    // Only what waited on THIS retry: the failed retries' text is not spoken late.
    expect(sent.filter((m) => typeof m.text === 'string' && m.text !== '')).toEqual([{ stream_id: 'utt-1-1', text: 'Ok.', text_end: false }]);

    // The retry succeeded, so the episode is over: once that segment is done
    // an idle drop is silent, and a failed reconnect says tts_stopped again.
    sockets.last().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
    sockets.last().drop();
    await flush();
    expect(degraded()).toEqual(['tts_stopped']);
    speech.speak(8, 'Again.', [0, 6], 'en');
    expect(sockets.all).toHaveLength(5);
    sockets.last().drop();
    await flush();
    expect(degraded()).toEqual(['tts_stopped', 'tts_stopped']);
  });

  it('text that arrives while the start\'s socket still opens waits for it: one socket, sent in order once it opens', async () => {
    const { speech, sockets, opening, frames } = create();
    speech.speak(2, 'Hi', [0, 2], 'en');
    speech.endUtterance();
    expect(sockets.all).toHaveLength(1);
    sockets.last().open();
    await opening;
    await flush();
    expect(sockets.all).toHaveLength(1);
    const sent = sockets.last().sentJson<Json>();
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ stream_id: 'utt-1-1', api_key: 'k', language: 'en' });
    expect(sent.slice(1)).toEqual([
      { stream_id: 'utt-1-1', text: 'Hi', text_end: false },
      { stream_id: 'utt-1-1', text: '', text_end: true },
    ]);
    expect(frames('tts.connect_failed')).toEqual([]);
  });

  it('a start that fails with text waiting retries at once: that text is the first translation (choice 6)', async () => {
    const { speech, sockets, opening, frames, degraded } = create();
    speech.speak(2, 'Hi.', [0, 3], 'en');
    sockets.last().drop();
    await opening;
    expect(frames('tts.connect_failed')).toHaveLength(1);
    expect(degraded()).toEqual([]);
    expect(sockets.all).toHaveLength(2);
    sockets.last().open();
    await flush();
    expect(sockets.last().sentJson<Json>()[1]).toEqual({ stream_id: 'utt-1-1', text: 'Hi.', text_end: false });
    expect(degraded()).toEqual([]);
  });

  it('a start that fails with only an utterance end waiting opens nothing more: no text needs speaking', async () => {
    const { speech, sockets, opening, frames, degraded } = create();
    speech.endUtterance();
    sockets.last().drop();
    await opening;
    await flush();
    expect(frames('tts.connect_failed')).toHaveLength(1);
    expect(sockets.all).toHaveLength(1);
    expect(degraded()).toEqual([]);
  });

  it('an unreadable TTS frame goes to the Logs only, once per episode (choice 7)', async () => {
    const { speech, tts, kinds, frames } = await setup();
    tts().receive('{bad');
    tts().receive('{bad');
    const first = frames('tts.unreadable');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ direction: 'in', type: 'tts.unreadable' });
    expect(typeof payloadOf(first[0]).message).toBe('string');
    speech.speak(2, 'Hi.', [0, 3], 'en');
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    tts().receive('{bad');
    expect(frames('tts.unreadable')).toHaveLength(2);
    expect(kinds('degraded')).toEqual([]);
  });

  it('a new socket starts a new unreadable episode', async () => {
    const { speech, tts, sockets, frames } = await setup();
    tts().receive('{bad');
    expect(frames('tts.unreadable')).toHaveLength(1);
    tts().drop();
    await flush();
    speech.speak(2, 'Hi.', [0, 3], 'en');
    sockets.last().open();
    await flush();
    // No audio between: the fresh socket's first bad frame is still logged.
    sockets.last().receive('{bad');
    expect(frames('tts.unreadable')).toHaveLength(2);
  });

  it("logs the utterance's text at its end, never the audio", async () => {
    const { speech, tts, frames } = await setup();
    speech.speak(2, 'Hi', [0, 2], 'en');
    speech.speak(2, ' there.', [2, 9], 'en');
    expect(frames('tts.speak')).toEqual([]);
    tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
    speech.endUtterance();
    expect(frames('tts.speak')).toEqual([{ direction: 'out', type: 'tts.speak', payload: { text: 'Hi there.' } }]);
    const audio = frames('tts.audio');
    expect(audio).toHaveLength(1);
    for (const frame of audio) expect(frame.payload).toEqual({ bytes: expect.any(Number) });
    expect(audio[0].payload).toEqual({ bytes: 4800 });
    // An end with nothing new spoken logs nothing more.
    speech.endUtterance();
    expect(frames('tts.speak')).toHaveLength(1);
  });

  it('close ends the stream still speaking with text_end, says so, and stops everything: nothing after it (Stage 2 session end, ruling 2 (ii))', async () => {
    const { speech, tts, sockets, log, clock } = await setup();
    speech.speak(2, 'and so', [0, 6], 'en');
    const socket = tts();
    const n = log.length;
    speech.close();
    expect(socket.sentJson<Json>().slice(-1)).toEqual([{ stream_id: 'utt-1-1', text: '', text_end: true }]);
    expect(log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'tts.end', payload: { streamId: 'utt-1-1' } } }]);
    expect(socket.closedByClient).not.toBeNull();
    const ended = log.length;
    await flush();
    clock.advance(60_000);
    await flush();
    expect(log.length).toBe(ended);
    speech.speak(4, 'More.', [0, 5], 'en');
    speech.endUtterance();
    await flush();
    expect(log.length).toBe(ended);
    expect(sockets.all).toHaveLength(1);
  });

  it('close while its TTS socket is CLOSING (a server close in flight) sends no text_end and frames no tts.end (Stage 2 session end, choice 4)', async () => {
    const { speech, tts, frames } = await setup();
    speech.speak(2, 'and so', [0, 6], 'en');
    const socket = tts();
    const sentBefore = socket.sent.length;
    socket.serverClose(); // CLOSING until the queued microtask fires close
    speech.close();
    expect(socket.sent).toHaveLength(sentBefore);
    expect(frames('tts.end')).toEqual([]);
  });

  it('close with no stream speaking sends no text_end and says nothing', async () => {
    const { speech, tts, log } = await setup();
    speech.speak(2, 'Done.', [0, 5], 'en');
    speech.endUtterance();
    const socket = tts();
    const sent = socket.sent.length;
    const n = log.length;
    speech.close();
    expect(socket.sent).toHaveLength(sent);
    expect(log.length).toBe(n);
  });

  it('sends the leg\'s voice, speed and key, and a client reference only when there is one', async () => {
    const leased = await setup({ region: 'eu', voice: 'Maya', speed: 1.2, clientReferenceId: 'ref-1' });
    expect(leased.tts().url).toBe('wss://tts-rt.eu.soniox.com/tts-websocket');
    leased.speech.speak(2, 'Hi.', [0, 3], 'en');
    expect(leased.tts().sentJson<Json>()[0]).toMatchObject({
      api_key: 'k', voice: 'Maya', speed: 1.2, model: 'tts-rt-v2', client_reference_id: 'ref-1', sample_rate: 24000,
    });
    const own = await setup();
    own.speech.speak(2, 'Hi.', [0, 3], 'en');
    const config = own.tts().sentJson<Json>()[0];
    expect(config).toMatchObject({ api_key: 'k', voice: 'Adrian', model: 'tts-rt-v2' });
    expect(config).not.toHaveProperty('client_reference_id');
    // Speed 1 is the server's default: not sent.
    expect(config).not.toHaveProperty('speed');
  });

  it("close during the start's own connect closes that socket, and says nothing — not even tts.connect_failed", async () => {
    const { speech, sockets, opening, log, clock } = create();
    const starting = sockets.last();
    expect(starting.readyState).toBe(starting.CONNECTING);
    speech.close();
    expect(starting.closedByClient).not.toBeNull();
    await opening;
    await flush();
    clock.advance(60_000);
    await flush();
    expect(log).toEqual([]);
    expect(sockets.all).toHaveLength(1);
  });

  it('close while a reconnect is opening closes the new socket, and nothing follows', async () => {
    const { speech, tts, sockets, log, clock } = await setup();
    tts().drop();
    await flush();
    speech.speak(4, 'Again.', [0, 6], 'en');
    const reconnecting = sockets.last();
    expect(reconnecting.readyState).toBe(reconnecting.CONNECTING);
    const n = log.length;
    speech.close();
    expect(reconnecting.closedByClient).not.toBeNull();
    await flush();
    clock.advance(60_000);
    await flush();
    expect(log.length).toBe(n);
    expect(sockets.last()).toBe(reconnecting);
  });
});
