/**
 * A final translation chunk that arrives after its segment closed, through
 * the adapter: a leg that speaks here reads it itself and its events are told
 * nothing more; a leg asked for no speech says it as `lateSpeech`, for a voice
 * outside the adapter. Driven on `FakeSocket` and a virtual clock.
 */
import { describe, it, expect } from 'vitest';
import type { AdapterEvents, SessionContext } from '../../lib/contract/adapter';
import { recordEvents } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import { createSonioxAdapter } from './adapter';
import { buildSoniox } from './config';
import { SONIOX_DEFAULTS } from './settings';
import { AUTO_CTX, END, isStt, KEY, msg, orig, SHARED, tr, trackedClock, type Json } from './testing';

type Late = Parameters<NonNullable<AdapterEvents['lateSpeech']>>[0];

async function live(context: SessionContext) {
  const sockets = fakeSockets();
  const { clock } = trackedClock();
  const { events, log } = recordEvents();
  const late: Late[] = [];
  const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
    { context, config: buildSoniox(context, SONIOX_DEFAULTS, SHARED), credentials: KEY, clock, signal: new AbortController().signal },
    { ...events, lateSpeech: (e) => late.push(e) },
  );
  for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open();
  const session = await starting;
  const stt = sockets.all.filter(isStt)[0];
  const tts = sockets.all.filter((s) => !isStt(s))[0];
  return { session, stt, tts, log, late };
}

describe('the Soniox adapter: a translation chunk after its segment closed', () => {
  it('a leg asked for no speech says it as lateSpeech, once, after the segment closed', async () => {
    const h = await live({ ...AUTO_CTX, speech: false });
    h.stt.receive(msg(orig('Hi.'), tr('やあ'), END));
    await flush();
    expect(h.late).toEqual([]);
    h.stt.receive(msg(tr('。')));
    await flush();
    expect(h.late).toEqual([{ ref: 2, text: '。', span: [2, 3], language: 'ja' }]);
    await h.session.stop();
  });

  it('a leg that speaks here reads it on its own socket and says no lateSpeech', async () => {
    const h = await live(AUTO_CTX);
    h.stt.receive(msg(orig('Hi.'), tr('やあ'), END));
    h.stt.receive(msg(tr('。')));
    await flush();
    expect(h.late).toEqual([]);
    // The late chunk is its own TTS segment, sent once the one before it has ended.
    const first = h.tts.sentJson<Json>().find((m) => m.model !== undefined)!.stream_id as string;
    h.tts.receive(JSON.stringify({ stream_id: first, terminated: true }));
    await flush();
    expect(h.tts.sentJson<Json>().filter((m) => typeof m.text === 'string' && m.text !== '').map((m) => m.text)).toEqual(['やあ', '。']);
    await h.session.stop();
  });
});
