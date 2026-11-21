/**
 * A run on Soniox alone, through the runner: its plan is its text unit and
 * its voice, so one leg starts through the composite and both legs through
 * the composite over `startBoth`; a text-only run names no speech model and
 * opens no TTS socket. Sockets are fake; nothing reaches a network.
 */
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { shapeWith } from '../../lib/plan/testing';
import type { AnyProvider } from '../../lib/provider/types';
import { createRunner } from '../../lib/session/runner';
import type { RunShape } from '../../lib/session/types';
import { createFakeSource } from '../fake/source';
import { createSonioxAdapter } from './adapter';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS } from './settings';
import { b64, END, isStt, msg, orig, tr, type Json } from './testing';
import { createSonioxTtsUnit } from './ttsUnit';
import { sonioxSttUnitFor } from './units';

function setup(o: Partial<Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech'>> = {}) {
  const sockets = fakeSockets();
  const clock = createVirtualClock(0);
  const adapter = createSonioxAdapter({ openSocket: sockets.create });
  // Soniox's definition, its adapter and its units on fake sockets.
  const provider = {
    ...sonioxProvider,
    start: adapter.start,
    units: [sonioxSttUnitFor({ start: adapter.start }), createSonioxTtsUnit({ openSocket: sockets.create })],
    session: { startBoth: adapter.startBoth },
  } as AnyProvider;
  const shape: RunShape = shapeWith(provider, {
    // Both legs, when a run has both, on one socket.
    settings: { ...SONIOX_DEFAULTS, bothModeSharedSession: true },
    credentials: { apiKey: 'k-own' },
    pair: { source: 'en', target: 'ja' },
    legs: ['speaker'],
    turnMode: 'auto',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
    auth: { signedIn: false, getToken: async () => null },
    ...o,
  });
  const played: Array<{ leg: LegName; ref: number | undefined; samples: number; voice?: LegName }> = [];
  const tracked: Array<[string, Record<string, unknown>]> = [];
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback: {
      audio: (leg, ref, pcm, by) => { played.push({ leg, ref, samples: pcm.length, ...(by ? { voice: by } : {}) }); return []; },
      held: () => {},
      clear: () => {},
      live: () => {},
    },
    analytics: { track: (event, properties) => { tracked.push([event, properties as Record<string, unknown>]); } },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  const openAll = () => { for (const s of sockets.all) if (s.readyState === FakeSocket.CONNECTING) s.open(); };
  /** Starts the run, the server accepting each socket as it is asked for, the voices' too. */
  const start = async () => {
    let done = false;
    const starting = runner.start().finally(() => { done = true; });
    while (!done) {
      openAll();
      await flush();
    }
    await starting;
    openAll();
    await flush();
  };
  const stt = () => sockets.all.filter(isStt);
  const tts = () => sockets.all.filter((s) => !isStt(s));
  const lastStream = (s: FakeSocket) => s.sentJson<Json>().filter((m) => m.model !== undefined).map((m) => m.stream_id as string).pop();
  const answer = (s: FakeSocket, samples: number) => {
    s.receive(JSON.stringify({ stream_id: lastStream(s), audio: b64(samples) }));
    s.receive(JSON.stringify({ stream_id: lastStream(s), terminated: true }));
  };
  return { shape, runner, sockets, played, tracked, start, stt, tts, answer };
}

describe('a run on Soniox alone goes through its two units', () => {
  it('one leg: the text unit transcribes and translates, the voice reads, and the models are both units\'', async () => {
    const h = setup();
    expect(h.shape.plan.units.map((u) => u.unit.id)).toEqual(['stt', 'tts']);
    await h.start();
    expect(h.runner.state.getState().phase).toBe('running');
    expect([h.stt().length, h.tts().length]).toEqual([1, 1]);
    // The own key serves both sockets.
    expect(h.sockets.all.map((s) => (s.protocols as string[])[1])).toEqual(['k-own', 'k-own']);
    h.stt()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    h.answer(h.tts()[0], 2400);
    expect(h.played).toEqual([{ leg: 'speaker', ref: 2, samples: 2400 }]);
    expect(h.tracked.find(([event]) => event === 'translation_session_start')?.[1]).toMatchObject({ asr_model: 'stt-rt-v6', tts_model: 'tts-rt-v2' });
    await h.runner.stop();
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
  });

  it('text only: no voice is started, no TTS socket opens and no speech model is named', async () => {
    const h = setup({ textOnly: true });
    await h.start();
    expect(h.runner.state.getState().phase).toBe('running');
    h.stt()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(h.tts()).toEqual([]);
    expect(h.played).toEqual([]);
    const start = h.tracked.find(([event]) => event === 'translation_session_start')![1];
    expect(start.asr_model).toBe('stt-rt-v6');
    expect(start.tts_model).toBeUndefined();
    await h.runner.stop();
  });

  it('both legs on one socket: each leg has its voice on its own TTS socket', async () => {
    const h = setup({ legs: ['speaker', 'participant'], participantSpeech: true });
    await h.start();
    expect(h.runner.state.getState().phase).toBe('running');
    expect([h.stt().length, h.tts().length]).toEqual([1, 2]);
    h.stt()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    h.answer(h.tts()[0], 2400);
    // A line whose translation is English, the participant's target: read by that voice, whichever leg's row it is.
    h.stt()[0].receive(msg({ ...orig('大丈夫。'), language: 'ja' }, tr('It is fine.', 'en', 'ja'), END));
    const reader = h.tts().find((s) => s.sentJson<Json>().some((m) => m.text === 'It is fine.'))!;
    expect(reader).toBe(h.tts()[1]);
    h.answer(reader, 1200);
    expect(h.played[0]).toEqual({ leg: 'speaker', ref: 2, samples: 2400 });
    expect(h.played[1]).toMatchObject({ leg: 'participant', samples: 1200 });
    await h.runner.stop();
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
  });
});
