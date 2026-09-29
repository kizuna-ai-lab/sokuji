/**
 * Palabra's delete under the runner (Stage 2 session end, choice 5): the
 * adapter's bound, `RELEASE_TIMEOUT_MS`, falls strictly inside the runner's
 * own bound on each release (5 000 ms by default), so a delete that never
 * answers says so — `session.delete_warning` — before the runner files the
 * run with each leg's `session.stopped`. Each timer fires here as a task of
 * its own, as a real event loop runs them: the kit's virtual clock fires the
 * timers one `advance()` makes due in one call, which hides which bound wins,
 * so the clock is stepped to each one alone. Palabra's adapter runs under the
 * fake's definition, the app pair's REST session on the fake server.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents, StartRequest } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { flush } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import type { AnyProvider } from '../../lib/provider/types';
import type { FramePort } from '../../lib/session/ports';
import { createRunner } from '../../lib/session/runner';
import type { RunShape } from '../../lib/session/types';
import { fakeProvider } from '../fake/provider';
import { FAKE_DEFAULTS } from '../fake/settings';
import { createFakeSource } from '../fake/source';
import { createPalabraAdapter, POLL_MS, RELEASE_TIMEOUT_MS } from './adapter';
import { APP, configFor, fakeRest, SERVER } from './testing';

const reportWarningSpy = vi.hoisted(() => vi.fn());
vi.mock('../../lib/diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/diagnostics/report')>();
  return { ...actual, reportWarning: reportWarningSpy };
});

/** The frames the run's Logs would show that this case reads: the end's own. */
const ENDING = new Set(['task.end', 'session.delete', 'session.deleted', 'session.delete_warning', 'session.stopped']);

function setup() {
  const clock = createVirtualClock(0);
  const sockets = fakeSockets();
  const rest = fakeRest({ remove: 'hang' });
  const adapter = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: rest.fetch, newId: () => 'test-hash', online: () => true });
  const provider = {
    ...fakeProvider,
    start: (request: StartRequest<unknown, unknown>, events: AdapterEvents) =>
      adapter.start({ ...request, config: configFor(request.context), credentials: APP }, events),
  } as unknown as AnyProvider;
  const seen: string[] = [];
  const frames: FramePort = { frame: (_leg, f) => { if (ENDING.has(f.type)) seen.push(f.type); } };
  const shape: RunShape = {
    provider,
    settings: FAKE_DEFAULTS,
    credentials: { apiKey: '' },
    pair: { source: 'ja', target: 'en' },
    legs: ['speaker'],
    turnMode: 'auto',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
    auth: { signedIn: false, getToken: async () => null },
  };
  // No `timeoutMs`: the runner's own default bound on a release, the app's.
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback: { audio: () => {}, held: () => {}, clear: () => {}, live: () => {} },
    analytics: { track: () => {} },
    frames,
    newSessionId: () => 'run1',
  });
  return { clock, sockets, rest, runner, seen };
}

describe("Palabra's delete under the runner (Stage 2 session end, choice 5)", () => {
  it("a delete that never answers is a warning before the run's session.stopped: its bound runs out first, and the runner's own never does", async () => {
    reportWarningSpy.mockClear();
    const { clock, sockets, rest, runner, seen } = setup();
    const starting = runner.start();
    // The create's answer, then the socket, then the task found running.
    await flush();
    sockets.last().open();
    clock.advance(POLL_MS);
    sockets.last().receive(SERVER.currentTask());
    await starting;
    expect(runner.state.getState().phase).toBe('running');

    const stopping = runner.stop();
    await flush();
    expect(rest.of('DELETE')).toHaveLength(1);
    expect(seen).toEqual(['task.end', 'session.delete']);
    // Palabra's bound, alone, as its own task.
    clock.advance(RELEASE_TIMEOUT_MS);
    await flush();
    await stopping;
    expect(seen).toEqual(['task.end', 'session.delete', 'session.delete_warning', 'session.stopped']);
    // Where the runner's bound would have fallen, as a task of its own: nothing more, and it never reported the release.
    clock.advance(5_000 - RELEASE_TIMEOUT_MS);
    await flush();
    expect(seen).toHaveLength(4);
    expect(reportWarningSpy.mock.calls.filter(([, message]) => String(message).startsWith('Releasing'))).toEqual([]);
  });
});
