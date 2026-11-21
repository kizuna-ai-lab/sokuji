/**
 * A final translation chunk that arrives after its segment closed, through
 * the adapter: it is said as `lateSpeech`, for the voice that reads the leg,
 * which is never the adapter's own. Driven on `FakeSocket` and a virtual
 * clock.
 */
import { describe, it, expect } from 'vitest';
import type { AdapterEvents, SessionContext } from '../../lib/contract/adapter';
import { recordEvents } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import { createSonioxAdapter } from './adapter';
import { buildSoniox } from './config';
import { SONIOX_DEFAULTS } from './settings';
import { AUTO_CTX, END, isStt, KEY, msg, orig, SHARED, tr, trackedClock } from './testing';

type Late = Parameters<NonNullable<AdapterEvents['lateSpeech']>>[0];

async function live(context: SessionContext) {
  const sockets = fakeSockets();
  const { clock } = trackedClock();
  const { events, log } = recordEvents();
  const late: Late[] = [];
  /** Each segment's close and each late text, as they were said: `[what, ref]`. */
  const trace: Array<['segmentClosed' | 'lateSpeech', number]> = [];
  const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
    { context, config: buildSoniox(context, SONIOX_DEFAULTS, SHARED), credentials: KEY, clock, signal: new AbortController().signal },
    {
      ...events,
      segmentClosed: (e) => { trace.push(['segmentClosed', e.ref]); events.segmentClosed(e); },
      lateSpeech: (e) => { trace.push(['lateSpeech', e.ref]); late.push(e); },
    },
  );
  for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open();
  const session = await starting;
  const stt = sockets.all.filter(isStt)[0];
  return { session, stt, sockets, log, late, of: (ref: number) => trace.filter((t) => t[1] === ref) };
}

describe('the Soniox adapter: a translation chunk after its segment closed', () => {
  it('says it as lateSpeech, once, after the segment closed', async () => {
    const h = await live({ ...AUTO_CTX, speech: false });
    h.stt.receive(msg(orig('Hi.'), tr('やあ'), END));
    await flush();
    expect(h.late).toEqual([]);
    expect(h.of(2)).toEqual([['segmentClosed', 2]]);
    h.stt.receive(msg(tr('。')));
    await flush();
    expect(h.late).toEqual([{ ref: 2, text: '。', span: [2, 3], language: 'ja' }]);
    // In one order: the segment's close, then its one late text.
    expect(h.of(2)).toEqual([['segmentClosed', 2], ['lateSpeech', 2]]);
    await h.session.stop();
  });

  it('says it the same for a leg whose context speaks: the adapter reads nothing itself, and opens no TTS socket', async () => {
    const h = await live(AUTO_CTX);
    h.stt.receive(msg(orig('Hi.'), tr('やあ'), END));
    h.stt.receive(msg(tr('。')));
    await flush();
    expect(h.late).toEqual([{ ref: 2, text: '。', span: [2, 3], language: 'ja' }]);
    expect(h.of(2)).toEqual([['segmentClosed', 2], ['lateSpeech', 2]]);
    expect(h.sockets.all.every(isStt)).toBe(true);
    expect(h.log.some((e) => e.kind === 'audio' || e.kind === 'degraded')).toBe(false);
    await h.session.stop();
  });
});
