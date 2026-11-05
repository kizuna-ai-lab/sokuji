import { describe, it, expect, vi } from 'vitest';
import type { OutletName } from '../audio/outlets';
import type { AdapterEvents, AdapterSession, Ref, StartRequest, TextRange } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { LegName } from '../conversation/types';
import type { AnyProvider, SharedSettings } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import type { PlaybackPort } from './ports';
import { createRunner } from './runner';
import type { RunShape, TurnMode } from './types';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

/**
 * A run over sessions that write each agent text frame they take to `log` as `<leg>:[text,end]` (and their stop as
 * `<leg>:stop`), and a playback whose outlets the test sets (spec 2026-11-05 §4). The run knows no agent text
 * setting: Soniox decides at Start whether a socket asks (`buildSoniox`), and a socket that did not ask refuses.
 * Every frame offered is written to `offered`; `refuse.on` makes every session refuse (a socket that did not ask);
 * `fault.on` makes every session's `agentText` throw; each `setSpeech` is written to `speech`; `muted` is the microphone's mute.
 */
function setup(o: { legs?: RunShape['legs']; turnMode?: TurnMode; mutePort?: boolean; participantSpeech?: boolean } = {}) {
  const clock = createVirtualClock(0);
  const log: string[] = [];
  const offered: string[] = [];
  const speech: string[] = [];
  const fault = { on: false };
  const refuse = { on: false };
  // `ports.mute` makes the mute's getter throw.
  const ports = { mute: false };
  const kept: Partial<Record<LegName, AdapterEvents>> = {};
  const outlets: { now: readonly OutletName[] } = { now: ['me'] };
  const asked: Array<boolean | undefined> = [];
  const muted = { value: false };
  let idleListener: ((voice: LegName) => void) | null = null;
  const start = async (request: StartRequest<unknown, unknown>, events: AdapterEvents): Promise<AdapterSession> => {
    const leg: LegName = request.context.direction.source === 'en' ? 'speaker' : 'participant';
    kept[leg] = events;
    return {
      info: { transport: 'fake' },
      appendAudio: () => {},
      appendText: () => {},
      beginTurn: () => {},
      endTurn: () => {},
      cancelTurn: () => {},
      agentText: (text, end) => {
        if (fault.on) throw new Error('agent text broke');
        offered.push(`${leg}:${JSON.stringify([text, end])}`);
        if (refuse.on) return false;
        log.push(`${leg}:${JSON.stringify([text, end])}`);
        return true;
      },
      setSpeech: (on) => { speech.push(`${leg}:${on}`); },
      stop: async () => { log.push(`${leg}:stop`); },
    };
  };
  const playback: PlaybackPort = {
    audio: () => outlets.now,
    held: () => {},
    clear: () => { for (const voice of ['speaker', 'participant'] as const) idleListener?.(voice); },
    live: () => {},
    onVoiceIdle: (listener) => {
      idleListener = listener;
      return () => { if (idleListener === listener) idleListener = null; };
    },
  };
  // Translation I hear, live (#595).
  const hear = { value: true, listeners: new Set<() => void>() };
  const shape: RunShape = {
    provider: { ...fakeProvider, start, build: (c: never, st: never, shared: SharedSettings) => { asked.push(shared.speaks); return fakeProvider.build(c, st, shared); } } as unknown as AnyProvider,
    settings: FAKE_DEFAULTS,
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs: o.legs ?? ['speaker'],
    turnMode: o.turnMode ?? 'auto',
    textOnly: false,
    participantSpeech: o.participantSpeech ?? false,
    keepReplayAudio: true,
    shared: {
      pauses: { sourceSeconds: 1, translationSeconds: 1 },
      reversed: () => false,
      segmentation: { mode: 'off', sentencesPerRow: 0 },
    },
    auth: { signedIn: false, getToken: async () => null },
  };
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback,
    analytics: { track: () => {} },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
    participantSpeech: {
      get: () => hear.value,
      subscribe: (listener) => { hear.listeners.add(listener); return () => { hear.listeners.delete(listener); }; },
    },
    ...(o.mutePort === false ? {} : { micMuted: { get: () => { if (ports.mute) throw new Error('mute broke'); return muted.value; } } }),
  });
  const events = (leg: LegName): AdapterEvents => kept[leg]!;
  const row = (leg: LegName, ref: Ref, text: string) => {
    events(leg).segmentOpened({ ref, side: 'translation' });
    events(leg).segmentText({ ref, text });
  };
  const chunk = (leg: LegName, ref: Ref, range?: TextRange, voice?: LegName) =>
    events(leg).audio({ pcm: new Int16Array(240), ref, ...(range ? { range } : {}), ...(voice ? { voice } : {}) });
  const idle = (voice: LegName) => idleListener?.(voice);
  const switchHearing = (next: boolean) => { hear.value = next; for (const listener of [...hear.listeners]) listener(); };
  return { runner, asked, log, offered, speech, fault, refuse, ports, outlets, muted, row, chunk, idle, events, switchHearing };
}

describe('runner — agent text (spec 2026-11-05 §4.1, §4.2)', () => {
  it('sends a chunk queued on my outlet on the speaker session', async () => {
    const h = setup(); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    expect(h.log).toEqual(['speaker:["Hello ",false]']);
  });

  it("routing only: the participant row's chunk on them is offered to the speaker session, never the participant's (Review Focus 2); the Soniox adapter refuses it in split Both, see adapter.agentText.test.ts", async () => {
    const h = setup({ legs: ['speaker', 'participant'] }); h.outlets.now = ['them']; await h.runner.start();
    h.row('participant', 1, 'こんにちは。'); h.chunk('participant', 1, [0, 6]);
    expect(h.log).toEqual(['speaker:["こんにちは。",false]']);
  });

  it('a stop closes the open segment before any session stops (Review Focus 3)', async () => {
    const h = setup(); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    await h.runner.stop();
    expect(h.log).toEqual(['speaker:["Hello ",false]', 'speaker:["",true]', 'speaker:stop']);
  });

  it('a socket that did not ask refuses each chunk: nothing goes, no segment opens, nothing is reported (spec 2026-11-05 §4.3)', async () => {
    const h = setup(); h.refuse.on = true; await h.runner.start();
    reportErrorSpy.mockClear();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    // Refused, so not live: its fill-in offers nothing more, and the idle has no segment to close.
    h.events('speaker').speechRanges({ ref: 1, ranges: [{ index: 0, range: [0, 12] }] });
    h.idle('speaker');
    h.chunk('speaker', 1, [6, 12]);
    expect(h.offered).toEqual(['speaker:["Hello ",false]', 'speaker:["there.",false]']);
    expect(h.log).toEqual([]);
    const reports = reportErrorSpy.mock.calls.filter(([, , options]) => ['agentText', 'agentTextPorts'].includes((options as { dedupeKey?: string } | undefined)?.dedupeKey ?? ''));
    expect(reports).toEqual([]);
  });

  it('tells its builders that the run speaks; whether a socket asks is the provider\'s own setting', async () => {
    const h = setup(); await h.runner.start();
    expect(h.asked).toEqual([true]);
  });

  it('push-to-talk: nothing while the key is up; after a press, only the next chunk goes (Review Focus 4)', async () => {
    const h = setup({ turnMode: 'push-to-talk' }); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    expect(h.log).toEqual([]);
    h.runner.press(); h.chunk('speaker', 1, [6, 12]);
    h.runner.release(); h.idle('speaker');
    expect(h.log).toEqual(['speaker:["there.",false]', 'speaker:["",true]']);
  });

  it('a fill-in reaches the feed: the rest of the sentence goes while its chunk is queued (Review Focus 1)', async () => {
    const h = setup(); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    h.events('speaker').speechRanges({ ref: 1, ranges: [{ index: 0, range: [0, 12] }] });
    expect(h.log).toEqual(['speaker:["Hello ",false]', 'speaker:["there.",false]']);
  });

  it('a reconnecting speaker leg leaves no segment for the next socket (Review Focus 5)', async () => {
    const h = setup(); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    h.events('speaker').reconnecting();
    h.idle('speaker');
    expect(h.log).toEqual(['speaker:["Hello ",false]']);
    h.events('speaker').reconnected();
    h.chunk('speaker', 1, [6, 12]);
    expect(h.log).toEqual(['speaker:["Hello ",false]', 'speaker:["there.",false]']);
  });

  it('the microphone muted: a chunk sends nothing; unmuted, the next chunk sends (spec 2026-11-05 §4.2)', async () => {
    const h = setup(); await h.runner.start();
    h.row('speaker', 1, 'Hello there.');
    h.muted.value = true; h.chunk('speaker', 1, [0, 6]);
    expect(h.log).toEqual([]);
    h.muted.value = false; h.chunk('speaker', 1, [6, 12]);
    expect(h.log).toEqual(['speaker:["there.",false]']);
  });

  it('muted mid-segment: a fill-in sends nothing, and the voice going idle still closes the open segment', async () => {
    const h = setup(); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    h.muted.value = true;
    h.events('speaker').speechRanges({ ref: 1, ranges: [{ index: 0, range: [0, 12] }] });
    h.idle('speaker');
    expect(h.log).toEqual(['speaker:["Hello ",false]', 'speaker:["",true]']);
  });

  it('without the mute port the microphone counts as not muted', async () => {
    const h = setup({ mutePort: false }); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    expect(h.log).toEqual(['speaker:["Hello ",false]']);
  });

  it("Translation I hear switched off mid-segment: one end, and nothing of the dropped words, whenever the killed segment's fill-in lands (Review Focus 3)", async () => {
    const h = setup({ legs: ['speaker', 'participant'], participantSpeech: true }); h.outlets.now = ['them']; await h.runner.start();
    h.row('participant', 1, 'See you soon.'); h.chunk('participant', 1, [0, 4]);
    h.switchHearing(false);
    // The participant session's TTS segment was killed: its unclean fill-in, here before playback's own clear says the voice is idle.
    h.events('participant').speechRanges({ ref: 1, ranges: [{ index: 0, range: [0, 13] }] });
    h.idle('participant');
    expect(h.log).toEqual(['speaker:["See ",false]', 'speaker:["",true]']);
  });

  it('a session whose agentText throws: Translation I hear off still switches the participant speech off, and the run reports it once', async () => {
    const h = setup({ legs: ['speaker', 'participant'], participantSpeech: true }); h.outlets.now = ['them']; await h.runner.start();
    h.row('participant', 1, 'See you soon.'); h.chunk('participant', 1, [0, 4]);
    h.fault.on = true;
    reportErrorSpy.mockClear();
    expect(() => h.switchHearing(false)).not.toThrow();
    expect(h.speech).toEqual(['participant:false']);
    expect(() => h.chunk('participant', 1, [4, 8])).not.toThrow();
    const reports = reportErrorSpy.mock.calls.filter(([, , options]) => (options as { dedupeKey?: string } | undefined)?.dedupeKey === 'agentText');
    expect(reports).toHaveLength(1);
  });

  it('a mute whose getter throws: the chunk event does not throw, nothing is sent while it fails, and it is reported once', async () => {
    const h = setup(); await h.runner.start();
    h.ports.mute = true;
    reportErrorSpy.mockClear();
    h.row('speaker', 1, 'Hello there.');
    expect(() => h.chunk('speaker', 1, [0, 6])).not.toThrow();
    expect(() => h.chunk('speaker', 1, [6, 12])).not.toThrow();
    expect(h.log).toEqual([]);
    const reports = reportErrorSpy.mock.calls.filter(([, , options]) => (options as { dedupeKey?: string } | undefined)?.dedupeKey === 'agentTextPorts');
    expect(reports).toHaveLength(1);
  });
});
