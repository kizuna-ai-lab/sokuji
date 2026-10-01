import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../clock';
import { flush } from './drive';
import { fakeSockets } from './fakeSocket';
import { fakeHeaderSockets } from './headerSocket';

const URL_LIVE = 'wss://api.openai.com/v1/live/sessions';
const HEADERS = { set: { Authorization: 'Bearer sk-proj-fakeKey0123456789' }, remove: ['Origin'] };

describe("the header seam's fake (Stage 2 OpenAI Live, choice 1)", () => {
  it('runs the real seam over FakeSockets from the sockets it is given, recording each rule and its clear', async () => {
    const sockets = fakeSockets();
    const seam = fakeHeaderSockets(sockets);
    expect(seam.sockets).toBe(sockets);
    const clock = createVirtualClock(0);
    const opening = seam.open(URL_LIVE, HEADERS, { signal: new AbortController().signal, clock });
    await flush();
    expect(seam.registrations).toEqual([{ host: 'api.openai.com', path: '/v1/live/', set: HEADERS.set, remove: ['Origin'], cleared: false }]);
    sockets.last().open();
    await expect(opening).resolves.toBe(sockets.last());
    await flush();
    expect(seam.registrations[0].cleared).toBe(true);
  });

  it('refuses the next registration once, clearing it too, and holds the next one until it is let go', async () => {
    const seam = fakeHeaderSockets();
    const clock = createVirtualClock(0);
    const signal = new AbortController().signal;
    seam.refuseNext('no');
    await expect(seam.open(URL_LIVE, HEADERS, { signal, clock })).rejects.toMatchObject({ reason: 'register' });
    const letGo = seam.holdNext();
    const opening = seam.open(URL_LIVE, HEADERS, { signal, clock });
    await flush();
    expect(seam.sockets.all).toEqual([]);
    letGo();
    await flush();
    seam.sockets.last().open();
    await expect(opening).resolves.toBe(seam.sockets.last());
    expect(seam.registrations.map((r) => r.cleared)).toEqual([true, true]);
  });
});
