/**
 * The three session-side protocol modules (`sttStream`, `ttsStream`,
 * `pcmMixer`) driven on a `FakeSocket` and a virtual clock — no fake timers,
 * no stubbed global `WebSocket` (case "reads its own socket's state" is the
 * one exception, and it proves exactly that the class does NOT depend on the
 * global). Pins F18: every timer reads the injected clock, every socket comes
 * from the injected factory.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SonioxSttStream, type SonioxSttConfig } from './sttStream';
import { SonioxTtsStream, type SonioxTtsOptions } from './ttsStream';
import { PcmMixer } from './pcmMixer';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { createVirtualClock } from '../../lib/contract/clock';
import { flush } from '../../lib/contract/testing/drive';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CONFIG: SonioxSttConfig = {
  apiKey: 'k', region: 'us', model: 'stt-rt-v5', sampleRate: 24000,
  translation: { type: 'one_way', target_language: 'en' },
};

const TTS: SonioxTtsOptions = {
  apiKey: 'k', region: 'us', voice: 'Adrian', model: 'tts-rt-v2', sampleRate: 24000,
};

/** Whether `p` is still pending: races it against a flush, which settles
 *  first only when nothing else has settled `p` yet. */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const outcome = await Promise.race([
    p.then(() => 'settled' as const, () => 'settled' as const),
    flush().then(() => 'pending' as const),
  ]);
  return outcome === 'pending';
}

describe('SonioxSttStream on the injected clock and socket', () => {
  it("opens the STT socket through the injected factory, at the key's region, and sends its config first", async () => {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const s = new SonioxSttStream({ clock, openSocket: sockets.create });
    const p = s.connect({ ...CONFIG, region: 'eu' });
    expect(sockets.last().url).toBe('wss://stt-rt.eu.soniox.com/transcribe-websocket');
    sockets.last().open();
    await p;
    expect(sockets.last().sentJson()[0]).toMatchObject({ api_key: 'k', model: 'stt-rt-v5' });
  });

  it('times out an STT connect after 15 s on the clock', async () => {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const s = new SonioxSttStream({ clock, openSocket: sockets.create });
    const p = s.connect(CONFIG);
    clock.advance(14_999);
    expect(await isPending(p)).toBe(true);
    clock.advance(1);
    await expect(p).rejects.toThrow(/connection timeout/);
    expect(sockets.last().closedByClient).not.toBeNull();
  });

  it('sends the STT keepalive after 15 s without audio, checked every 5 s, on the clock', async () => {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const s = new SonioxSttStream({ clock, openSocket: sockets.create });
    const p = s.connect(CONFIG);
    sockets.last().open();
    await p;
    clock.advance(10_000);
    expect(sockets.last().sentJson()).not.toContainEqual({ type: 'keepalive' });
    clock.advance(5_000);
    const afterKeepalive = sockets.last().sentJson();
    expect(afterKeepalive[afterKeepalive.length - 1]).toEqual({ type: 'keepalive' });
    s.sendAudio(new Int16Array(240));
    clock.advance(10_000);
    const keepalives = sockets.last().sentJson()
      .filter((m) => typeof m === 'object' && m !== null && (m as { type?: string }).type === 'keepalive');
    expect(keepalives).toHaveLength(1);
  });

  it("reads its own socket's state, whatever the global WebSocket says", async () => {
    vi.stubGlobal('WebSocket', class { static OPEN = 99; });
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const s = new SonioxSttStream({ clock, openSocket: sockets.create });
    const p = s.connect(CONFIG);
    sockets.last().open();
    await p;
    s.sendAudio(new Int16Array(240));
    expect(sockets.last().sent.some((d) => d instanceof Int16Array)).toBe(true);
  });

  it('stops the keepalive at close: nothing is sent after it', async () => {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const s = new SonioxSttStream({ clock, openSocket: sockets.create });
    const p = s.connect(CONFIG);
    sockets.last().open();
    await p;
    s.close();
    const n = sockets.last().sent.length;
    clock.advance(60_000);
    expect(sockets.last().sent.length).toBe(n);
  });

  it('tells an unreadable STT frame to onUnreadable, and routes nothing', async () => {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const s = new SonioxSttStream({ clock, openSocket: sockets.create });
    const onUnreadable = vi.fn();
    const onMessage = vi.fn();
    s.setHandlers({ onUnreadable, onMessage });
    const p = s.connect(CONFIG);
    sockets.last().open();
    await p;
    sockets.last().receive('{not json');
    expect(onUnreadable).toHaveBeenCalledTimes(1);
    expect(onUnreadable.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('SonioxTtsStream on the injected clock and socket', () => {
  it('times out a TTS connect after 15 s on the clock', async () => {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const t = new SonioxTtsStream(TTS, { clock, openSocket: sockets.create });
    const p = t.connect();
    clock.advance(14_999);
    expect(await isPending(p)).toBe(true);
    clock.advance(1);
    await expect(p).rejects.toThrow(/TTS connection timeout/);
    expect(sockets.last().closedByClient).not.toBeNull();
  });

  it('sends the TTS keep_alive every 20 s on the clock', async () => {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const t = new SonioxTtsStream(TTS, { clock, openSocket: sockets.create });
    const p = t.connect();
    sockets.last().open();
    await p;
    clock.advance(20_000);
    const sent = sockets.last().sentJson();
    expect(sent[sent.length - 1]).toEqual({ keep_alive: true });
  });

  it('cuts a TTS segment on the clock: a clause after 1.5 s, idle after 3 s, age after 8 s', async () => {
    const textEnds = (sockets: ReturnType<typeof fakeSockets>) =>
      sockets.last().sentJson().filter((m) => typeof m === 'object' && m !== null && (m as { text_end?: boolean }).text_end === true);

    // A clause end (the trailing comma) waits 1.5 s for more text, then hands
    // the segment over since the server never spoke it.
    {
      const sockets = fakeSockets();
      const clock = createVirtualClock(0);
      const t = new SonioxTtsStream(TTS, { clock, openSocket: sockets.create });
      const p = t.connect();
      sockets.last().open();
      await p;
      t.sendText('Well, ', 'en');
      clock.advance(1_499);
      expect(textEnds(sockets)).toHaveLength(0);
      clock.advance(1);
      expect(textEnds(sockets)).toEqual([{ stream_id: 'utt-1-1', text: '', text_end: true }]);
    }

    // No clause or sentence end: the 3 s idle cut ends the segment on its own.
    {
      const sockets = fakeSockets();
      const clock = createVirtualClock(0);
      const t = new SonioxTtsStream(TTS, { clock, openSocket: sockets.create });
      const p = t.connect();
      sockets.last().open();
      await p;
      t.sendText('and so', 'en');
      clock.advance(2_999);
      expect(textEnds(sockets)).toHaveLength(0);
      clock.advance(1);
      expect(textEnds(sockets)).toHaveLength(1);
    }

    // Four chunks two seconds apart each reset the 3 s idle cut, but the
    // segment's age — counted from the first chunk — still caps it at 8 s.
    {
      const sockets = fakeSockets();
      const clock = createVirtualClock(0);
      const t = new SonioxTtsStream(TTS, { clock, openSocket: sockets.create });
      const p = t.connect();
      sockets.last().open();
      await p;
      t.sendText('one', 'en');       // t = 0
      clock.advance(2_000);
      t.sendText('two', 'en');       // t = 2 000
      clock.advance(2_000);
      t.sendText('three', 'en');     // t = 4 000
      clock.advance(2_000);
      t.sendText('four', 'en');      // t = 6 000
      clock.advance(1_999);          // t = 7 999
      expect(textEnds(sockets)).toHaveLength(0);
      clock.advance(1);              // t = 8 000
      expect(textEnds(sockets)).toHaveLength(1);
    }
  });

  it('tells an unreadable TTS frame to onUnreadable', async () => {
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const t = new SonioxTtsStream(TTS, { clock, openSocket: sockets.create });
    const onUnreadable = vi.fn();
    t.setHandlers({ onUnreadable });
    const p = t.connect();
    sockets.last().open();
    await p;
    sockets.last().receive('{not json');
    expect(onUnreadable).toHaveBeenCalledTimes(1);
    expect(onUnreadable.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe('PcmMixer on the injected clock', () => {
  it('mixes every 100 ms on the clock, and stops at stop()', () => {
    const clock = createVirtualClock(0);
    const frames: Int16Array[] = [];
    const m = new PcmMixer({ clock, frameSamples: 2400, intervalMs: 100, maxBacklogSamples: 48000, onFrame: (f) => frames.push(f) });
    m.start();
    clock.advance(300);
    expect(frames).toHaveLength(3);
    m.stop();
    clock.advance(300);
    expect(frames).toHaveLength(3);
  });
});
