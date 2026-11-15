// The Soniox adapter places a final original word on the run's clock by the audio it really sent on that socket.
import { describe, it, expect } from 'vitest';
import type { LegName } from '../../lib/conversation/types';
import type { SessionContext, StartRequest } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import type { SharedSettings } from '../../lib/provider/types';
import type { SonioxToken } from './sttStream';
import { createSonioxAdapter } from './adapter';
import { buildSoniox, type SonioxConfig } from './config';
import { SONIOX_DEFAULTS, type SonioxCredentials } from './settings';
import { AUTO_CTX, ERROR_503, isStt, KEY, msg, SHARED, trackedClock } from './testing';

const frame = () => new Int16Array(2400); // 100 ms at 24 kHz
const word = (start_ms: number, end_ms: number): SonioxToken => ({ text: 'Hi', is_final: true, translation_status: 'original', language: 'en', start_ms, end_ms });
type Text = Extract<AdapterEvent, { kind: 'segmentText' }>;
const lastHeard = (log: readonly AdapterEvent[]) => log.filter((e): e is Text => e.kind === 'segmentText' && e.payload.heard !== undefined).pop()!.payload.heard!;

async function single() {
  const sockets = fakeSockets();
  const { clock } = trackedClock();
  const { events, log } = recordEvents();
  const starting = createSonioxAdapter({ openSocket: sockets.create }).start(
    { context: AUTO_CTX, config: buildSoniox(AUTO_CTX, SONIOX_DEFAULTS, SHARED), credentials: KEY, clock, signal: new AbortController().signal },
    events,
  );
  const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
  openAll();
  const session = await starting;
  const stt = () => sockets.all.filter(isStt).slice(-1)[0];
  /** `n` frames of 100 ms, each sent once the clock has moved past it. */
  const send = (n: number) => { for (let i = 0; i < n; i++) { clock.advance(100); session.appendAudio(frame()); } };
  return { clock, log, session, stt, send, openAll };
}

describe('Soniox — heard', () => {
  it('places a word by the audio that was really sent, across a muted stretch', async () => {
    const h = await single();
    const t0 = h.clock.now();
    h.send(10);
    h.clock.advance(10_000);
    h.send(10);
    h.stt().receive(msg(word(1200, 1500)));
    await flush();
    expect(lastHeard(h.log).pieces[0]).toEqual(expect.objectContaining({ startAt: t0 + 11_200, endAt: t0 + 11_500 }));
  });

  it('starts a new table when the socket is replaced', async () => {
    const h = await single();
    h.send(50);
    const dropped = h.stt();
    dropped.receive(ERROR_503);
    dropped.serverClose(1011);
    await flush();
    h.openAll();
    await flush();
    expect(h.stt()).not.toBe(dropped);
    const reconnectedAt = h.clock.now();
    h.send(3);
    h.stt().receive(msg(word(100, 200)));
    await flush();
    expect(lastHeard(h.log).pieces[0].startAt).toBe(reconnectedAt + 100);
  });

  it('counts the mixed frames of a shared session', async () => {
    const sockets = fakeSockets();
    const { clock } = trackedClock();
    const shared: SharedSettings = { ...SHARED, reversed: (direction) => direction.source === 'ja' };
    const contexts: Record<LegName, SessionContext> = {
      speaker: { direction: { source: 'en', target: 'ja' }, speech: false, turns: 'auto' },
      participant: { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' },
    };
    const credentials: SonioxCredentials = { region: 'us', stt: 'k', tts: 'k' };
    const rec = { speaker: recordEvents(), participant: recordEvents() };
    const request = (leg: LegName): StartRequest<SonioxConfig, SonioxCredentials> =>
      ({ context: contexts[leg], config: buildSoniox(contexts[leg], { ...SONIOX_DEFAULTS, bothModeSharedSession: true }, shared), credentials, clock, signal: new AbortController().signal });
    const starting = createSonioxAdapter({ openSocket: sockets.create }).startBoth(
      { speaker: request('speaker'), participant: request('participant') },
      { speaker: rec.speaker.events, participant: rec.participant.events },
    );
    for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open();
    const sessions = await starting;
    const openedAt = clock.now();
    for (let i = 0; i < 5; i++) {
      sessions.speaker.appendAudio(frame());
      sessions.participant.appendAudio(frame());
      clock.advance(100);
    }
    const stt = sockets.all.filter(isStt)[0];
    stt.receive(msg(word(100, 200)));
    await flush();
    const both = [...rec.speaker.log, ...rec.participant.log];
    expect(lastHeard(both).pieces[0].startAt).toBe(openedAt + 100);
  });
});
