import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { AnyProvider } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import type { FakeConfig, FakeCredentials } from '../../providers/fake/adapter';
import { createRunner } from './runner';
import type { RunShape, TurnMode } from './types';
import type { PlaybackPort } from './ports';

/** The fake, with every call its sessions receive written to `log` as `<leg>:<call>`. */
function spyingProvider(log: string[], patch: Partial<AnyProvider> = {}): AnyProvider {
  return {
    ...fakeProvider,
    ...patch,
    async start(request: StartRequest<FakeConfig, FakeCredentials>, events: AdapterEvents) {
      const leg = request.context.direction.source === 'en' ? 'speaker' : 'participant';
      const inner = await fakeProvider.start(request, events);
      return {
        info: inner.info,
        appendAudio: (pcm: Int16Array) => { log.push(`${leg}:audio`); inner.appendAudio(pcm); },
        appendText: (text: string) => { log.push(`${leg}:text`); inner.appendText(text); },
        beginTurn: () => { log.push(`${leg}:begin`); inner.beginTurn(); },
        endTurn: () => { log.push(`${leg}:end`); inner.endTurn(); },
        cancelTurn: () => { log.push(`${leg}:cancel`); inner.cancelTurn(); },
        stop: () => inner.stop(),
      };
    },
  } as AnyProvider;
}

function setup(o: { turnMode?: TurnMode; legs?: RunShape['legs']; provider?: AnyProvider; log?: string[]; playback?: Partial<PlaybackPort> } = {}) {
  const clock = createVirtualClock(0);
  const log = o.log ?? [];
  const sources: FakeSource[] = [];
  const playback = { audio: vi.fn(), held: vi.fn(), clear: vi.fn(), live: vi.fn() };
  Object.assign(playback, o.playback);
  const tracked: Array<[string, unknown]> = [];
  const shape: RunShape = {
    provider: o.provider ?? spyingProvider(log),
    settings: FAKE_DEFAULTS,
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs: o.legs ?? ['speaker'],
    turnMode: o.turnMode ?? 'push-to-talk',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: {
      instructions: () => '',
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
    openSource: async () => { const s = createFakeSource(clock); sources.push(s); return s; },
    playback,
    analytics: { track: (event, properties) => { tracked.push([event, properties]); } },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  const events = (name: string) => tracked.filter(([e]) => e === name).map(([, p]) => p);
  const count = (entry: string) => log.filter((e) => e === entry).length;
  return { clock, runner, sources, playback, events, log, count };
}

describe('runner — manual turns', () => {
  it("sends the speaker's audio only while the key is held, and ends a turn that held voice", async () => {
    const { runner, clock, sources, count, log, playback, events } = setup();
    await runner.start();
    sources[0].setVoiced(true);
    clock.advance(300);
    expect(count('speaker:audio')).toBe(0);
    runner.press();
    clock.advance(600);
    runner.release();
    expect(count('speaker:audio')).toBe(6);
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual(['speaker:begin', 'speaker:end']);
    // Push-to-talk leaves the original-voice route alone.
    expect(playback.held).not.toHaveBeenCalled();
    expect(events('push_to_talk_used')).toEqual([{ session_id: 'run1', hold_duration_ms: 600, mode: 'push-to-talk' }]);
    clock.advance(300);
    expect(count('speaker:audio')).toBe(6);
  });

  it('cancels a turn that held too little voice', async () => {
    const { runner, clock, log } = setup();
    await runner.start();
    runner.press();
    clock.advance(600);
    runner.release();
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual(['speaker:begin', 'speaker:cancel']);
  });

  it('streams the participant leg whatever the key does', async () => {
    const { runner, clock, count } = setup({ legs: ['speaker', 'participant'] });
    await runner.start();
    clock.advance(300);
    expect(count('participant:audio')).toBe(3);
    expect(count('speaker:audio')).toBe(0);
  });

  it('reports push-to-translate as its own mode', async () => {
    const { runner, clock, events } = setup({ turnMode: 'push-to-translate' });
    await runner.start();
    runner.press();
    clock.advance(100);
    runner.release();
    expect(events('push_to_talk_used')).toEqual([expect.objectContaining({ mode: 'push-to-translate' })]);
  });

  it('ignores the key under automatic turns, and streams everything', async () => {
    const { runner, clock, log, count } = setup({ turnMode: 'auto' });
    await runner.start();
    runner.press();
    clock.advance(300);
    runner.release();
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual([]);
    expect(count('speaker:audio')).toBe(3);
  });

  it('ignores a second press while a turn is held, and a release with no turn', async () => {
    const { runner, clock, log } = setup();
    await runner.start();
    runner.release();
    runner.press();
    runner.press();
    clock.advance(100);
    runner.release();
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual(['speaker:begin', 'speaker:cancel']);
  });

  it('a stop during a hold closes the turn without ending it', async () => {
    const { runner, clock, log, playback } = setup({ turnMode: 'push-to-translate' });
    await runner.start();
    runner.press();
    clock.advance(200);
    await runner.stop();
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual(['speaker:begin']);
    expect(playback.held.mock.calls).toEqual([[true], [false]]);
  });

  it('a playback port that throws on held still stops every source when Stop lands during a hold (F1)', async () => {
    const { runner, clock, sources } = setup({
      turnMode: 'push-to-translate',
      playback: { held: vi.fn((held: boolean) => { if (!held) throw new Error('route toggle failed'); }) },
    });
    await runner.start();
    runner.press();
    clock.advance(100);
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
    expect(sources.every((s) => s.stopped)).toBe(true);
  });

  it('push-to-translate closes the original-voice route while the key is held', async () => {
    const { runner, clock, sources, playback, events } = setup({ turnMode: 'push-to-translate' });
    await runner.start();
    sources[0].setVoiced(true);
    runner.press();
    expect(playback.held.mock.calls).toEqual([[true]]);
    clock.advance(600);
    runner.release();
    expect(playback.held.mock.calls).toEqual([[true], [false]]);
    expect(events('push_to_talk_used')).toEqual([{ session_id: 'run1', hold_duration_ms: 600, mode: 'push-to-translate' }]);
  });
});

describe('runner — typed text and clearing', () => {
  it('types into the speaker leg while running, and records it', async () => {
    const { runner, log, events } = setup({ turnMode: 'auto' });
    await runner.start();
    runner.sendText('hi');
    expect(log).toContain('speaker:text');
    const texts = runner.conversation.snapshot()[0].segments.map((s) => s.text);
    expect(texts).toEqual(['hi', '«hi»']);
    expect(events('text_input_sent')).toEqual([{ session_id: 'run1', provider: 'fake', text_length: 2 }]);
  });

  it('ignores typed text when no run is live, or the provider takes none', async () => {
    const log: string[] = [];
    const { runner } = setup({ turnMode: 'auto', provider: spyingProvider(log, { textInput: false }), log });
    runner.sendText('early');
    await runner.start();
    runner.sendText('hi');
    expect(log).not.toContain('speaker:text');
  });

  it('clear() empties the conversation and the queued audio, and keeps the run', async () => {
    const { runner, clock, playback } = setup({ turnMode: 'auto' });
    await runner.start();
    clock.advance(5000);
    runner.clear();
    expect(runner.conversation.snapshot()[0].segments.every((s) => !s.final)).toBe(true);
    expect(playback.clear).toHaveBeenCalled();
    expect(runner.state.getState().phase).toBe('running');
  });
});
