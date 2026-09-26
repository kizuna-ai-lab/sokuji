/**
 * TTS span tags and segment ends: `sendText`'s optional `TextTag` (a ref and
 * the chunk's UTF-16 span in its text), `onAudio`'s stream/ref info, and
 * `onSegmentEnd` — each stream reports the union of its chunks' spans and
 * whether it ended cleanly (its own `terminated`) or was cut short (an
 * error, a dropped socket). Driven on `FakeSocket` and a virtual clock, as
 * `wire.clock.test.ts` — no network, no fake timers, no stubbed global.
 */
import { describe, it, expect } from 'vitest';
import { SonioxTtsStream, type SonioxTtsOptions, type SonioxTtsAudioInfo, type SonioxTtsSegmentEnd } from './ttsStream';
import { fakeSockets, type FakeSockets } from '../../lib/contract/testing/fakeSocket';
import { createVirtualClock } from '../../lib/contract/clock';
import { flush } from '../../lib/contract/testing/drive';

const TTS: SonioxTtsOptions = {
  apiKey: 'k', region: 'us', voice: 'Adrian', model: 'tts-rt-v2', sampleRate: 24000,
};

const pcm = (n: number) => btoa(String.fromCharCode(...new Uint8Array(new Int16Array(n).fill(7).buffer)));

async function openTts() {
  const sockets = fakeSockets();
  const clock = createVirtualClock(0);
  const t = new SonioxTtsStream(TTS, { clock, openSocket: sockets.create });
  const ends: SonioxTtsSegmentEnd[] = [];
  const audio: Array<[number, SonioxTtsAudioInfo]> = [];
  t.setHandlers({ onAudio: (a, info) => audio.push([a.length, info]), onSegmentEnd: (e) => ends.push(e) });
  const p = t.connect();
  sockets.last().open();
  await p;
  return { t, sockets, clock, ends, audio };
}

const receive = (sockets: FakeSockets, obj: unknown) => sockets.last().receive(JSON.stringify(obj));

describe('SonioxTtsStream — span tags and segment ends', () => {
  it("hands each chunk's stream and ref to onAudio", async () => {
    const { t, sockets, audio } = await openTts();
    t.sendText('Hello. ', 'en', { ref: 2, span: [0, 7] });
    receive(sockets, { stream_id: 'utt-1-1', audio: pcm(4) });
    expect(audio).toEqual([[4, { streamId: 'utt-1-1', ref: 2 }]]);
  });

  it("ends a segment cleanly at its terminated, with the union of its chunks' spans", async () => {
    const { t, sockets, ends } = await openTts();
    t.sendText('Hello, ', 'en', { ref: 2, span: [0, 7] });
    t.sendText('world.', 'en', { ref: 2, span: [7, 13] });
    // The sentence end ('world.') sends text_end right away — the segment is
    // already draining before its terminated arrives.
    expect(sockets.last().sentJson()).toContainEqual({ stream_id: 'utt-1-1', text: '', text_end: true });
    receive(sockets, { stream_id: 'utt-1-1', terminated: true });
    expect(ends).toEqual([{ streamId: 'utt-1-1', ref: 2, span: [0, 13], clean: true }]);
  });

  it('a language change splits the span between two segments', async () => {
    const { t, sockets, ends } = await openTts();
    t.sendText('Hola, ', 'es', { ref: 2, span: [0, 6] });
    t.sendText('hello.', 'en', { ref: 2, span: [6, 12] });
    receive(sockets, { stream_id: 'utt-1-1', terminated: true });
    expect(ends[0]).toEqual({ streamId: 'utt-1-1', ref: 2, span: [0, 6], clean: true });
    expect(sockets.last().sentJson()).toContainEqual(expect.objectContaining({ stream_id: 'utt-1-2', language: 'en' }));
    receive(sockets, { stream_id: 'utt-1-2', terminated: true });
    expect(ends[1]).toEqual({ streamId: 'utt-1-2', ref: 2, span: [6, 12], clean: true });
  });

  it('a new ref starts a new segment, even mid-clause', async () => {
    const { t, sockets, ends } = await openTts();
    t.sendText('and then', 'en', { ref: 2, span: [0, 8] });
    t.sendText('next', 'en', { ref: 4, span: [0, 4] });
    // A text_end for utt-1-1 was sent before the second stream's config: the
    // new ref's text is queued behind the draining segment, not sent yet.
    const beforeTerminated = sockets.last().sentJson();
    expect(beforeTerminated).toContainEqual({ stream_id: 'utt-1-1', text: '', text_end: true });
    expect(beforeTerminated.some((m) => typeof m === 'object' && m !== null && (m as { stream_id?: string }).stream_id === 'utt-1-2')).toBe(false);
    receive(sockets, { stream_id: 'utt-1-1', terminated: true });
    expect(ends.map((e) => e.ref)).toEqual([2]);
    expect(sockets.last().sentJson()).toContainEqual(expect.objectContaining({ stream_id: 'utt-1-2', language: 'en' }));
    // 'next' ends no sentence, so utt-1-2 is still active, not draining, and a
    // terminated now would be ignored — endUtterance() ends it explicitly.
    t.endUtterance();
    expect(sockets.last().sentJson()).toContainEqual({ stream_id: 'utt-1-2', text: '', text_end: true });
    receive(sockets, { stream_id: 'utt-1-2', terminated: true });
    expect(ends.map((e) => e.ref)).toEqual([2, 4]);
  });

  it('a 408-killed segment ends unclean, once', async () => {
    const { t, sockets, ends } = await openTts();
    t.sendText('Hello.', 'en', { ref: 2, span: [0, 6] });
    receive(sockets, { stream_id: 'utt-1-1', error_code: 408, error_message: 'Request timeout' });
    receive(sockets, { stream_id: 'utt-1-1', terminated: true });
    expect(ends).toEqual([{ streamId: 'utt-1-1', ref: 2, span: [0, 6], clean: false }]);
  });

  it('a socket that drops ends its live segments unclean; close() ends none', async () => {
    const { t, sockets, ends } = await openTts();
    t.sendText('Hi', 'en', { ref: 1, span: [0, 2] }); // no sentence/clause end: stays active
    sockets.last().drop();
    await flush();
    expect(ends).toEqual([{ streamId: 'utt-1-1', ref: 1, span: [0, 2], clean: false }]);

    // Reconnect (a second stream) and prove an intentional close() ends none.
    const p2 = t.connect();
    sockets.last().open();
    await p2;
    t.sendText('Yo', 'en', { ref: 3, span: [0, 2] });
    t.close();
    expect(ends).toHaveLength(1);
  });

  it("untagged text — the old client's call — reports no ref and no span", async () => {
    const { t, sockets, ends, audio } = await openTts();
    t.sendText('Hi.', 'en');
    receive(sockets, { stream_id: 'utt-1-1', audio: pcm(4) });
    receive(sockets, { stream_id: 'utt-1-1', terminated: true });
    expect(audio).toEqual([[4, { streamId: 'utt-1-1', ref: undefined }]]);
    expect(ends).toEqual([{ streamId: 'utt-1-1', ref: undefined, span: undefined, clean: true }]);
  });
});
