/**
 * Soniox with an own key for transcription and translation, read by Kizuna AI's Soniox voice, through the runner:
 * the line-up composes, its option offering the voice alone, and the run goes through the composite. The text
 * side connects on the user's key; the voice on the lease's speech key, under that stream's own client reference;
 * each speaking leg's voice is reported started once; Stop tells the service the session is over. Sockets are
 * fake and the service is a stub `fetch`; nothing reaches a network.
 */
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SessionCountdown from '../../components/MainPanel/SessionCountdown';
import { createVirtualClock } from '../../lib/contract/clock';
import { FakeSocket, fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { flush } from '../../lib/contract/testing/drive';
import type { LegName } from '../../lib/conversation/types';
import { allCaps } from '../../lib/lineup/catalog';
import { compose } from '../../lib/plan/compose';
import { isRefusal } from '../../lib/plan/types';
import type { AnyProvider } from '../../lib/provider/types';
import { createRunner } from '../../lib/session/runner';
import type { RunShape } from '../../lib/session/types';
import { createFakeSource } from '../fake/source';
import { createSonioxAdapter } from './adapter';
import { kizunaSonioxProvider } from './kizuna';
import { createKizunaLease, type RememberedVoiceLease } from './lease';
import { sonioxProvider } from './provider';
import { SONIOX_DEFAULTS } from './settings';
import { b64, END, isStt, msg, orig, tr, type Json } from './testing';
import { createSonioxTtsUnit } from './ttsUnit';
import { sonioxSttUnitFor } from './units';
import { registerReleasedCatalog } from '../../lib/lineup/catalog.testing';

registerReleasedCatalog();

const API = 'https://api.test';
const LINE_UP = { transcription: 'soniox', translation: 'soniox', speech: 'kizunaai_soniox' };

function setup(o: Partial<Pick<RunShape, 'legs' | 'textOnly' | 'participantSpeech' | 'auth' | 'account'>> = {}, grantSeconds = 600) {
  const sockets = fakeSockets();
  const clock = createVirtualClock(0);
  const adapter = createSonioxAdapter({ openSocket: sockets.create });
  const units = () => [sonioxSttUnitFor({ start: adapter.start }), createSonioxTtsUnit({ openSocket: sockets.create })];
  // Soniox with an own key, its adapter and its units on fake sockets.
  const own = { ...sonioxProvider, units: units(), session: { startBoth: adapter.startBoth } } as AnyProvider;

  /** The service: a session-key answer with a speech stream for each leg asked, and a 200 for everything else. */
  const requests: Array<{ path: string; token: string | undefined; body: Record<string, unknown> }> = [];
  const service = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.slice(API.length);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ path, token: (init.headers as Record<string, string>).Authorization, body });
    if (path !== '/soniox/session-key') return new Response('{}', { status: 200 });
    const roles = body.legs === 'both' ? ['spk_tts', 'par_tts'] : body.legs === 'speaker' ? ['spk_tts'] : ['par_tts'];
    return new Response(JSON.stringify({
      leaseId: 'lease-1', clientReferenceId: `ref-${roles[0]}`, region: 'us', maxSessionDurationSeconds: grantSeconds,
      streams: roles.map((role) => ({ role, apiKey: `k-${role}`, clientReferenceId: `ref-${role}` })),
    }), { status: 200 });
  });
  const remembered: Array<RememberedVoiceLease | null> = [];
  // Kizuna AI's Soniox: its own definition, voice claim and floor; its units on the fake sockets, its lease on the stub service.
  const hosted = {
    ...kizunaSonioxProvider,
    units: units(),
    session: {
      ...kizunaSonioxProvider.session,
      acquire: createKizunaLease({
        participantSpeech: true, fetch: service as unknown as typeof fetch, apiUrl: () => API,
        voiceLeases: { remember: (lease) => { remembered.push(lease); }, forget: () => { remembered.push(null); } },
      }),
    },
  } as AnyProvider;

  const input = { providers: [own, hosted], settings: () => SONIOX_DEFAULTS };
  // The app's catalog offers this voice alone: the line-up composes there, and is refused under one that does not.
  const refused = compose(LINE_UP, { ...input, catalog: allCaps().map((c) => (c.id === 'kizunaai_soniox' ? { ...c, voiceAlone: false } : c)) });
  const plan = compose(LINE_UP, input);
  if (isRefusal(plan)) throw new Error(`expected a plan, got ${plan.refused}`);

  const shape: RunShape = {
    plan,
    accounts: {
      // Both legs, when a run has both, on one transcription socket.
      soniox: { settings: { ...SONIOX_DEFAULTS, bothModeSharedSession: true }, credentials: { apiKey: 'k-own' } },
      kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {} },
    },
    lineUp: LINE_UP,
    lineUpStored: true,
    pair: { source: 'en', target: 'ja' },
    legs: ['speaker'],
    turnMode: 'auto',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } },
    auth: { signedIn: true, userId: 'u1', getToken: async () => 'tok' },
    ...o,
  };
  const played: Array<{ leg: LegName; ref: number | undefined; samples: number }> = [];
  const tracked: Array<[string, Record<string, unknown>]> = [];
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback: {
      audio: (leg, ref, pcm) => { played.push({ leg, ref, samples: pcm.length }); return []; },
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
  const keyOf = (s: FakeSocket) => (s.protocols as string[])[1];
  const configOf = (s: FakeSocket) => s.sentJson<Json>().find((m) => m.model !== undefined);
  const answer = (s: FakeSocket, samples: number) => {
    const streamId = s.sentJson<Json>().filter((m) => m.model !== undefined).map((m) => m.stream_id as string).pop();
    s.receive(JSON.stringify({ stream_id: streamId, audio: b64(samples) }));
    s.receive(JSON.stringify({ stream_id: streamId, terminated: true }));
  };
  const sent = (path: string) => requests.filter((r) => r.path === path);
  return { clock, refused, plan, shape, runner, sockets, requests, sent, remembered, played, tracked, start, stt, tts, keyOf, configOf, answer };
}

describe("Soniox with an own key, read by Kizuna AI's Soniox voice", () => {
  it("composes, the option offering the voice alone, as the text unit of one and the voice of the other", () => {
    const h = setup();
    expect(h.refused).toEqual({ refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'kizunaai_soniox' });
    expect(h.plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([
      ['soniox', 'stt', ['transcription', 'translation']],
      ['kizunaai_soniox', 'tts', ['speech']],
    ]);
  });

  it('one leg: the text on the own key, the voice on the lease\'s speech key and its own reference, one start reported, and Stop ends the lease', async () => {
    const h = setup();
    await h.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live' }, budget: { totalMs: 600_000, endsAt: 600_000 } });

    // What was asked of the service: the voice alone, for the one leg that speaks, with the sign-in.
    expect(h.sent('/soniox/session-key')).toEqual([{ path: '/soniox/session-key', token: 'Bearer tok', body: { mode: 'voice_only', legs: 'speaker', region: 'us' } }]);
    expect(h.remembered).toEqual([{ leaseId: 'lease-1', apiUrl: API }]);

    // The transcription socket runs on the user's own key and carries nothing of the lease.
    expect([h.stt().length, h.tts().length]).toEqual([1, 1]);
    expect(h.keyOf(h.stt()[0])).toBe('k-own');
    expect(JSON.stringify(h.stt()[0].sentJson<Json>()[0])).not.toMatch(/ref-|k-spk_tts/);
    // The voice's socket runs on the lease's speech key.
    expect(h.keyOf(h.tts()[0])).toBe('k-spk_tts');

    // Its start is reported once, by its role and its own stream's reference.
    expect(h.sent('/soniox/session-started')).toEqual([
      { path: '/soniox/session-started', token: 'Bearer tok', body: { leaseId: 'lease-1', role: 'spk_tts', clientReferenceId: 'ref-spk_tts' } },
    ]);

    h.stt()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(h.configOf(h.tts()[0])).toMatchObject({ client_reference_id: 'ref-spk_tts', model: 'tts-rt-v2' });
    h.answer(h.tts()[0], 2400);
    expect(h.played).toEqual([{ leg: 'speaker', ref: 2, samples: 2400 }]);
    // The transcription socket's first message reported nothing more: that socket is not the lease's.
    expect(h.sent('/soniox/session-started')).toHaveLength(1);
    expect(h.sent('/soniox/session-key/reissue')).toEqual([]);

    // The run is named by the provider that transcribes; the stages say who served each.
    expect(h.tracked.find(([event]) => event === 'translation_session_start')?.[1]).toMatchObject({
      provider: 'soniox', stages: LINE_UP, asr_model: 'stt-rt-v6', tts_model: 'tts-rt-v2',
    });

    expect(h.sent('/soniox/session-end')).toEqual([]);
    await h.runner.stop();
    expect(h.sent('/soniox/session-end')).toEqual([{ path: '/soniox/session-end', token: 'Bearer tok', body: { leaseId: 'lease-1' } }]);
    expect(h.remembered).toEqual([{ leaseId: 'lease-1', apiUrl: API }, null]);
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect(h.runner.state.getState().phase).toBe('idle');
  });

  it('both legs speaking: each leg\'s voice on its own speech key and reference, and one start reported for each', async () => {
    const h = setup({ legs: ['speaker', 'participant'], participantSpeech: true });
    await h.start();
    expect(h.runner.state.getState().phase).toBe('running');
    expect(h.sent('/soniox/session-key').map((r) => r.body)).toEqual([{ mode: 'voice_only', legs: 'both', region: 'us' }]);
    expect([h.stt().length, h.tts().length]).toEqual([1, 2]);
    expect(h.keyOf(h.stt()[0])).toBe('k-own');
    expect(h.tts().map(h.keyOf).sort()).toEqual(['k-par_tts', 'k-spk_tts']);
    expect(h.sent('/soniox/session-started').map((r) => r.body).sort((a, b) => String(a.role).localeCompare(String(b.role)))).toEqual([
      { leaseId: 'lease-1', role: 'par_tts', clientReferenceId: 'ref-par_tts' },
      { leaseId: 'lease-1', role: 'spk_tts', clientReferenceId: 'ref-spk_tts' },
    ]);

    h.stt()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    // A line whose translation is English, the participant's target: read by the participant's voice.
    h.stt()[0].receive(msg({ ...orig('大丈夫。'), language: 'ja' }, tr('It is fine.', 'en', 'ja'), END));
    const speaker = h.tts().find((s) => h.keyOf(s) === 'k-spk_tts')!;
    const participant = h.tts().find((s) => h.keyOf(s) === 'k-par_tts')!;
    expect(h.configOf(speaker)).toMatchObject({ client_reference_id: 'ref-spk_tts' });
    expect(h.configOf(participant)).toMatchObject({ client_reference_id: 'ref-par_tts' });
    expect(participant.sentJson<Json>().some((m) => m.text === 'It is fine.')).toBe(true);

    await h.runner.stop();
    expect(h.sent('/soniox/session-end').map((r) => r.body)).toEqual([{ leaseId: 'lease-1' }]);
    expect(h.sent('/soniox/session-started')).toHaveLength(2);
  });

  it('text only: nothing is asked of the service, no voice starts, and Stop has nothing to end', async () => {
    const h = setup({ textOnly: true });
    await h.start();
    expect(h.runner.state.getState().phase).toBe('running');
    expect(h.runner.state.getState()).not.toHaveProperty('budget');
    expect(h.keyOf(h.stt()[0])).toBe('k-own');
    h.stt()[0].receive(msg(orig('Hello.'), tr('こんにちは。'), END));
    expect(h.tts()).toEqual([]);
    await h.runner.stop();
    expect(h.requests).toEqual([]);
    expect(h.remembered).toEqual([]);
  });

  it("the lease's time running out ends the whole run, the own-key text side included, and is filed under Kizuna AI's Soniox", async () => {
    // A grant shorter than any wait of an idle socket: only the lease's own timer runs out.
    const h = setup({}, 5);
    await h.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', budget: { totalMs: 5_000 } });
    h.clock.advance(5_000);
    await vi.waitFor(() => expect(h.runner.state.getState().phase).toBe('idle'));
    // Below the hour's cap: the balance is what ran out.
    expect(h.runner.state.getState()).toMatchObject({ lastEnd: { reason: 'lease-ended', notice: { code: 'budget_exhausted' } } });
    expect(h.sockets.all.every((s) => s.closedByClient !== null)).toBe(true);
    expect(h.sent('/soniox/session-end').map((r) => r.body)).toEqual([{ leaseId: 'lease-1' }]);
    expect(h.tracked.filter(([event]) => event === 'api_error').map(([, props]) => props)).toEqual([
      expect.objectContaining({ provider: 'kizunaai_soniox', stages: LINE_UP, error_code: 'budget_exhausted' }),
    ]);
  });

  it("signed out: the start is refused for the sign-in, the notice naming Kizuna AI's Soniox though Soniox transcribes on a key that is there", async () => {
    const h = setup({ auth: { signedIn: false, getToken: async () => null } });
    await h.runner.start();
    expect(h.runner.state.getState()).toMatchObject({
      phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'sign_in_required', params: { provider: 'kizunaai_soniox' } } },
    });
    // Nothing was connected and nothing was asked of the service.
    expect(h.sockets.all).toEqual([]);
    expect(h.requests).toEqual([]);
  });

  it("a wallet below the voice's own floor refuses the start; one between that floor and a whole session's starts", async () => {
    const wallet = (balanceMicroUsd: number) => ({ status: 'known' as const, balanceMicroUsd, frozen: false });
    const low = setup({ account: wallet(4_166) });
    await low.runner.start();
    expect(low.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'balance_below_floor', params: { balance: '$0.004166' } } } });
    expect(low.sockets.all).toEqual([]);
    expect(low.requests).toEqual([]);
    // 12 500 would be asked of a whole speaking session; the voice alone asks 4 167.
    const enough = setup({ account: wallet(4_167) });
    await enough.start();
    expect(enough.runner.state.getState().phase).toBe('running');
    await enough.runner.stop();
    // A frozen wallet refuses it too, and text only asks no balance at all.
    const frozen = setup({ account: { status: 'known', balanceMicroUsd: 1_000_000, frozen: true } });
    await frozen.runner.start();
    expect(frozen.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { notice: { code: 'wallet_frozen' } } });
    const textOnly = setup({ account: wallet(0), textOnly: true });
    await textOnly.start();
    expect(textOnly.runner.state.getState().phase).toBe('running');
    await textOnly.runner.stop();
  });

  it("the countdown is the voice lease's: an hour at most, shown in the footer, and at its end the run ends as a segment does", async () => {
    const h = setup({}, 3600);
    await h.start();
    const running = h.runner.state.getState();
    expect(running).toMatchObject({ phase: 'running', budget: { totalMs: 3_600_000, endsAt: 3_600_000 } });
    if (running.phase !== 'running' || !running.budget) throw new Error('expected a running state with a budget');
    // What the footers mount for a running state that has a budget.
    const { container } = render(createElement(SessionCountdown, { budget: running.budget, now: () => h.clock.now() }));
    expect(container.querySelector('.session-remaining-time')?.textContent).toBe('01:00:00');
    cleanup();

    // The transcription service keeps answering meanwhile, so its socket lives: only the lease's time ends the run.
    for (let elapsed = 0; elapsed < 3_600_000 && h.runner.state.getState().phase === 'running'; elapsed += 2_000) {
      h.stt()[0].receive(msg());
      h.clock.advance(2_000);
      await flush();
    }
    expect(h.stt()).toHaveLength(1);
    await vi.waitFor(() => expect(h.runner.state.getState().phase).toBe('idle'));
    // At the hour's cap: the words of a segment that ended, and nothing filed as an error.
    expect(h.runner.state.getState()).toMatchObject({ lastEnd: { reason: 'lease-ended', notice: { code: 'segment_ended' } } });
    expect(h.sent('/soniox/session-end').map((r) => r.body)).toEqual([{ leaseId: 'lease-1' }]);
    expect(h.tracked.filter(([event]) => event === 'api_error')).toEqual([]);
  });

  it("the session's record names Kizuna AI's Soniox on the speech stage and Soniox on the other two, under the provider that transcribes", async () => {
    const h = setup();
    await h.start();
    expect(h.runner.conversation.info).toMatchObject({ provider: 'soniox', stages: LINE_UP, models: { asrModel: 'stt-rt-v6', ttsModel: 'tts-rt-v2' } });
    await h.runner.stop();
    // Kept after the run, for the record that is written from it.
    expect(h.runner.conversation.info).toMatchObject({ provider: 'soniox', stages: LINE_UP });
  });

  it("a drop of the transcription connection is reported as the own key's: `managed` says who runs the connection that dropped, and `stages` names the hosted voice", async () => {
    const h = setup();
    await h.start();
    h.stt()[0].drop();
    await flush();
    const dropped = h.tracked.filter(([event]) => event === 'connection_dropped').map(([, props]) => props);
    expect(dropped).toEqual([expect.objectContaining({ provider: 'soniox', managed: false, stages: LINE_UP })]);
    await h.runner.stop();
  });
});
