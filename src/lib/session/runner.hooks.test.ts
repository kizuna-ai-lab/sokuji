import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents, AdapterSession, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { AnyProvider } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { createRunner } from './runner';
import type { RunShape, SessionHooks } from './types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function withHooks(session: SessionHooks<unknown, unknown, unknown>, patch: Partial<AnyProvider> = {}): AnyProvider {
  return { ...fakeProvider, ...patch, session } as AnyProvider;
}

function setup(provider: AnyProvider, legs: RunShape['legs'] = ['speaker']) {
  const clock = createVirtualClock(0);
  const sources: FakeSource[] = [];
  const persistIfUnchanged = vi.fn();
  const shape: RunShape = {
    provider,
    settings: FAKE_DEFAULTS,
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs,
    turnMode: 'auto',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 } },
    auth: { signedIn: false, getToken: async () => null },
  };
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged,
    openSource: async () => { const s = createFakeSource(clock); sources.push(s); return s; },
    playback: { audio: () => {}, closed: () => {}, held: () => {}, clear: () => {} },
    analytics: { track: () => {} },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  return { clock, runner, sources, persistIfUnchanged, shape };
}

describe('runner — prepare', () => {
  it("applies prepare's override to this run's build", async () => {
    const { runner, clock } = setup(withHooks({ prepare: async () => ({ override: { script: 'cjk' } }) }));
    await runner.start();
    clock.advance(600);
    expect(runner.conversation.snapshot()[0].segments[0].text).toBe('今日は');
  });

  it("writes prepare's persist patch through persistIfUnchanged, against the run's snapshot", async () => {
    const provider = withHooks({ prepare: async () => ({ persist: { script: 'long' } }) });
    const { runner, persistIfUnchanged, shape } = setup(provider);
    await runner.start();
    expect(persistIfUnchanged).toHaveBeenCalledWith(provider, shape.settings, { script: 'long' });
  });

  it("records prepare's notice on the first leg", async () => {
    const { runner } = setup(withHooks({ prepare: async () => ({ notice: { code: 'voice_fallback', message: 'built-in voice' } }) }));
    await runner.start();
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ severity: 'warning', code: 'voice_fallback', message: 'built-in voice' })]);
  });
});

describe('runner — admit', () => {
  it('hands admit the configs actually built, one per leg', async () => {
    const admit = vi.fn(() => true as const);
    const { runner } = setup(withHooks({ admit }), ['speaker', 'participant']);
    await runner.start();
    expect(admit).toHaveBeenCalledWith({ speaker: expect.objectContaining({ script: expect.anything() }), participant: expect.objectContaining({ script: expect.anything() }) });
  });

  it('refuses a start admit refuses, opening nothing', async () => {
    const { runner, sources } = setup(withHooks({ admit: () => ({ refused: 'one leg only' }) }), ['speaker', 'participant']);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'admit-refused', message: 'one leg only' } } });
    expect(sources).toHaveLength(0);
  });
});

describe('runner — acquire', () => {
  it("gives each leg its own credentials, and releases the lease after the legs have closed", async () => {
    const order: string[] = [];
    const seen: Record<string, unknown> = {};
    const provider = withHooks(
      {
        acquire: async () => ({
          credentials: (leg) => ({ minted: leg }),
          release: async () => { order.push('lease released'); },
        }),
      },
      {
        async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
          const leg = request.context.direction.source === 'en' ? 'speaker' : 'participant';
          seen[leg] = request.credentials;
          const inner = await fakeProvider.start(request as StartRequest<never, never>, events);
          return { ...inner, info: inner.info, appendAudio: () => {}, appendText: () => {}, beginTurn: () => {}, endTurn: () => {}, cancelTurn: () => {},
            stop: async () => { order.push(`${leg} closed`); await inner.stop(); } } as AdapterSession;
        },
      },
    );
    const { runner } = setup(provider, ['speaker', 'participant']);
    await runner.start();
    expect(seen).toEqual({ speaker: { minted: 'speaker' }, participant: { minted: 'participant' } });
    await runner.stop();
    expect(order[order.length - 1]).toBe('lease released');
    expect(order.slice(0, 2).sort()).toEqual(['participant closed', 'speaker closed']);
  });

  it("ends the run when the lease ends it, with the lease's message", async () => {
    let endLease!: (message: string) => void;
    const provider = withHooks({
      acquire: async (_shape, _s, ctx) => {
        endLease = ctx.end;
        return { credentials: () => ({}), release: async () => {} };
      },
    });
    const { runner } = setup(provider);
    await runner.start();
    endLease('balance exhausted');
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'lease_ended', message: 'balance exhausted' } } });
  });

  it('releases a lease that arrives after the start was cancelled', async () => {
    let grant!: () => void;
    const release = vi.fn(async () => {});
    const provider = withHooks({
      acquire: () => new Promise((resolve) => { grant = () => resolve({ credentials: () => ({}), release }); }),
    });
    const { runner } = setup(provider);
    const starting = runner.start();
    await flush();
    await runner.stop();
    grant();
    await starting;
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('runner — startBoth (D23)', () => {
  it('hands both legs to startBoth at once, each on its own source', async () => {
    const startBoth = vi.fn(async (requests: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>, events: Record<'speaker' | 'participant', AdapterEvents>) => ({
      speaker: await fakeProvider.start(requests.speaker as StartRequest<never, never>, events.speaker),
      participant: await fakeProvider.start(requests.participant as StartRequest<never, never>, events.participant),
    }));
    const { runner, sources, clock } = setup(withHooks({ startBoth }), ['speaker', 'participant']);
    await runner.start();
    expect(startBoth).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(2);
    expect(runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live', participant: 'live' } });
    clock.advance(600);
    expect(runner.conversation.snapshot().map((l) => l.segments.length)).toEqual([1, 1]);
  });

  it('opens a single leg the ordinary way', async () => {
    const startBoth = vi.fn();
    const { runner } = setup(withHooks({ startBoth }));
    await runner.start();
    expect(startBoth).not.toHaveBeenCalled();
    expect(runner.state.getState().phase).toBe('running');
  });
});
