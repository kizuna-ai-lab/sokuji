import { describe, it, expect } from 'vitest';
import type { OutletName } from '../audio/outlets';
import type { AdapterEvents, AdapterSession, Ref, StartRequest, TextRange } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { LegName } from '../conversation/types';
import type { AnyProvider } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import type { PlaybackPort } from './ports';
import { createRunner } from './runner';
import type { RunShape, TurnMode } from './types';

/**
 * A run over sessions that write each agent text frame to `log` as `<leg>:[text,end]` (and their stop as
 * `<leg>:stop`), a playback whose outlets the test sets, and the switch as a value (spec 2026-11-05 §4).
 */
function setup(o: { legs?: RunShape['legs']; turnMode?: TurnMode; switchPort?: boolean; participantSpeech?: boolean } = {}) {
  const clock = createVirtualClock(0);
  const log: string[] = [];
  const kept: Partial<Record<LegName, AdapterEvents>> = {};
  const outlets: { now: readonly OutletName[] } = { now: ['me'] };
  const on = { value: true };
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
      agentText: (text, end) => { log.push(`${leg}:${JSON.stringify([text, end])}`); return true; },
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
    provider: { ...fakeProvider, start } as unknown as AnyProvider,
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
    ...(o.switchPort === false ? {} : { agentText: { get: () => on.value } }),
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
  return { runner, log, outlets, on, row, chunk, idle, events, switchHearing };
}

describe('runner — agent text (spec 2026-11-05 §4.1, §4.2)', () => {
  it('sends a chunk queued on my outlet on the speaker session', async () => {
    const h = setup(); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    expect(h.log).toEqual(['speaker:["Hello ",false]']);
  });

  it("split Both: the participant row's chunk on them goes to the speaker session, never the participant's (Review Focus 2)", async () => {
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

  it('reads the switch at each chunk (Review Focus 4)', async () => {
    const h = setup(); await h.runner.start();
    h.row('speaker', 1, 'Hello there.');
    h.on.value = false; h.chunk('speaker', 1, [0, 6]);
    expect(h.log).toEqual([]);
    h.on.value = true; h.chunk('speaker', 1, [6, 12]);
    expect(h.log).toEqual(['speaker:["there.",false]']);
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

  it('without the switch port nothing is sent', async () => {
    const h = setup({ switchPort: false }); await h.runner.start();
    h.row('speaker', 1, 'Hello there.'); h.chunk('speaker', 1, [0, 6]);
    expect(h.log).toEqual([]);
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
});
