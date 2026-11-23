import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { LegName } from '../conversation/types';
import { stubSpeechUnit, stubTextUnit, textAndSpeechPlan, type StubCalls, type StubTextStart } from '../plan/testing';
import type { AnyProvider } from '../provider/types';
import type { LeaseContext, SessionHooks, SharedSettings } from '../run/types';
import { FAKE_LANGUAGES } from '../../providers/fake/provider';
import { createFakeSource } from '../../providers/fake/source';
import { createRunner } from './runner';
import type { RunShape } from './types';

/** The calls of a list, by name. */
const named = (calls: StubCalls) => calls.map((c) => c[0]);

/**
 * A run over a plan of a stub text unit (`stub_text`: transcription and translation) and a stub speech unit
 * (`stub_voice`: speech). Each provider reads its own credentials, answers its own readiness and describes its own
 * models; every build is listed with the models it was handed. `hooks`: the text provider's session hooks;
 * `voiceHooks`: the voice provider's.
 */
function setup(o: { legs?: RunShape['legs']; participantSpeech?: boolean; hooks?: SessionHooks<unknown, unknown, unknown, AnyProvider>; voiceHooks?: SessionHooks<unknown, unknown, unknown, AnyProvider>; lineUpStored?: boolean } = {}) {
  const clock = createVirtualClock(0);
  const calls: StubCalls = [];
  const builds: Array<{ provider: string; shared: SharedSettings }> = [];
  const member = (id: string, describe: () => object) => ({
    credentials: { keys: [], fields: () => [], read: () => ({ key: id }) },
    languages: FAKE_LANGUAGES,
    build: (_context: unknown, _s: unknown, shared: SharedSettings) => { builds.push({ provider: id, shared }); return { built: id }; },
    describe,
  });
  const text = stubTextUnit(calls, {
    provider: {
      ...member('stub_text', () => ({ asrModel: 'text-asr', translationModel: 'text-translation', ttsModel: 'text-tts' })),
      ...(o.hooks ? { session: o.hooks } : {}),
    },
  });
  const voice = stubSpeechUnit(calls, {
    answers: true,
    provider: { ...member('stub_voice', () => ({ asrModel: 'voice-asr', ttsModel: 'voice-tts' })), ...(o.voiceHooks ? { session: o.voiceHooks } : {}) },
  });
  const shape: RunShape = {
    plan: textAndSpeechPlan(text.planned, voice.planned),
    accounts: { stub_text: { settings: {}, credentials: {} }, stub_voice: { settings: {}, credentials: {} } },
    lineUp: { transcription: 'stub_text', translation: 'stub_text', speech: 'stub_voice' },
    ...(o.lineUpStored === undefined ? {} : { lineUpStored: o.lineUpStored }),
    pair: { source: 'en', target: 'ja' },
    legs: o.legs ?? ['speaker'],
    turnMode: 'auto',
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
  const played: Array<{ leg: LegName; ref: number | undefined; samples: number; voice?: LegName }> = [];
  const tracked: Array<[string, unknown]> = [];
  const speechSwitch = { on: true, listeners: new Set<() => void>() };
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async (p: AnyProvider) => ({ state: 'ready', models: [{ id: `${p.id}-model` }] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback: {
      audio: (leg, ref, pcm, by) => { played.push({ leg, ref, samples: pcm.length, ...(by ? { voice: by } : {}) }); return []; },
      held: () => {},
      clear: () => {},
      live: () => {},
    },
    analytics: { track: (event, properties) => { tracked.push([event, properties]); } },
    participantSpeech: {
      get: () => speechSwitch.on,
      subscribe: (listener) => { speechSwitch.listeners.add(listener); return () => { speechSwitch.listeners.delete(listener); }; },
    },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  /** The text unit's start for a leg: the speaker's direction starts from `en`. */
  const started = (leg: LegName = 'speaker'): StubTextStart => text.starts.find((s) => (s.request.context.direction.source === 'en') === (leg === 'speaker'))!;
  const setSpeech = (on: boolean) => { speechSwitch.on = on; for (const listener of [...speechSwitch.listeners]) listener(); };
  return { clock, runner, calls, builds, text, voice, played, tracked, started, setSpeech };
}

/** A translation segment whose whole text is stable, still open. */
function translate(events: AdapterEvents, ref: number, text: string) {
  events.segmentOpened({ ref, side: 'translation' });
  events.segmentText({ ref, text, stableLen: text.length });
}

describe('a run over a plan of a text unit and a speech unit', () => {
  it('starts: the text unit without speech, the voice for the leg', async () => {
    const h = setup();
    await h.runner.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live' } });
    expect(h.text.starts).toHaveLength(1);
    expect(h.started().request.context).toMatchObject({ direction: { source: 'en', target: 'ja' }, speech: false });
    expect(h.voice.voices.map((v) => v.request.leg)).toEqual(['speaker']);
    expect(h.voice.voices[0].request.context.speech).toBe(true);
  });

  it("a translation's stable text is spoken, and the voice's audio is the leg's: played and kept on its row", async () => {
    const h = setup();
    await h.runner.start();
    translate(h.started().events, 1, 'こんにちは。');
    expect(h.calls).toContainEqual(['voice.speak', 'speaker', 1, 'こんにちは。', [0, 6], 'ja', undefined]);
    expect(h.played).toEqual([{ leg: 'speaker', ref: 1, samples: 240 }]);
    const [row] = h.runner.conversation.get('speaker')!.snapshot().segments;
    expect(row).toMatchObject({ text: 'こんにちは。' });
    expect(row.speech).toHaveLength(1);
    expect(row.speech[0]).toMatchObject({ range: [0, 6] });
  });

  it('names each model from the unit that serves its stage', async () => {
    const h = setup();
    await h.runner.start();
    const models = { asrModel: 'text-asr', translationModel: 'text-translation', ttsModel: 'voice-tts' };
    expect(h.runner.conversation.info).toMatchObject({ provider: 'stub_text', models });
    expect(h.tracked.find(([event]) => event === 'translation_session_start')![1]).toMatchObject({
      provider: 'stub_text', asr_model: 'text-asr', translation_model: 'text-translation', tts_model: 'voice-tts',
    });
  });

  it('hands every builder the line-up frozen at start when it is the stored one, and none otherwise', async () => {
    const stored = setup({ legs: ['speaker', 'participant'], participantSpeech: true, lineUpStored: true });
    await stored.runner.start();
    expect(stored.builds.map((b) => b.shared.lineUp)).toEqual(Array(4).fill({ transcription: 'stub_text', translation: 'stub_text', speech: 'stub_voice' }));
    for (const lineUpStored of [false, undefined]) {
      const none = setup({ lineUpStored });
      await none.runner.start();
      expect(none.builds).toHaveLength(2);
      expect(none.builds.every((b) => !('lineUp' in b.shared))).toBe(true);
    }
  });

  it("builds each unit with its own provider's models, and the same of everything else", async () => {
    const h = setup({ legs: ['speaker', 'participant'], participantSpeech: true });
    await h.runner.start();
    expect(h.builds.map((b) => [b.provider, b.shared.models])).toEqual([
      ['stub_text', [{ id: 'stub_text-model' }]],
      ['stub_voice', [{ id: 'stub_voice-model' }]],
      ['stub_text', [{ id: 'stub_text-model' }]],
      ['stub_voice', [{ id: 'stub_voice-model' }]],
    ]);
    expect(h.builds.map((b) => b.shared.speaks)).toEqual([true, true, true, true]);
    const direction = { source: 'en', target: 'ja' };
    expect(h.builds.map((b) => b.shared.reversed(direction))).toEqual([false, false, true, true]);
  });

  it("starts each unit with its own provider's credentials", async () => {
    const h = setup();
    await h.runner.start();
    expect(h.started().request.credentials).toEqual({ key: 'stub_text' });
    expect(h.voice.voices[0].request.credentials).toEqual({ key: 'stub_voice' });
    expect(h.started().request.config).toEqual({ built: 'stub_text' });
    expect(h.voice.voices[0].request.config).toEqual({ built: 'stub_voice' });
  });

  it("a leased provider's unit starts with its lease's credentials for the leg, the other unit with its own", async () => {
    const release = vi.fn(async () => {});
    const h = setup({
      legs: ['speaker', 'participant'],
      participantSpeech: true,
      hooks: { acquire: async () => ({ credentials: (leg) => ({ lease: leg }), release }) },
    });
    await h.runner.start();
    expect(h.started('speaker').request.credentials).toEqual({ lease: 'speaker' });
    expect(h.started('participant').request.credentials).toEqual({ lease: 'participant' });
    expect(h.voice.voices.map((v) => v.request.credentials)).toEqual([{ key: 'stub_voice' }, { key: 'stub_voice' }]);
  });

  it("a leased voice's unit starts with its lease's credentials for the leg, the text unit with its own provider's", async () => {
    const release = vi.fn(async () => {});
    const h = setup({
      legs: ['speaker', 'participant'],
      participantSpeech: true,
      voiceHooks: { acquire: async () => ({ credentials: (leg) => ({ voiceLease: leg }), budget: { totalMs: 60_000, endsAt: 60_000 }, release }) },
    });
    await h.runner.start();
    expect(h.voice.voices.map((v) => [v.request.leg, v.request.credentials])).toEqual([['speaker', { voiceLease: 'speaker' }], ['participant', { voiceLease: 'participant' }]]);
    expect(h.started('speaker').request.credentials).toEqual({ key: 'stub_text' });
    expect(h.started('participant').request.credentials).toEqual({ key: 'stub_text' });
    // The voice's lease is the run's granted time.
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', budget: { totalMs: 60_000, endsAt: 60_000 } });
    await h.runner.stop();
    expect(release).toHaveBeenCalledTimes(1);
    // Released after the text session stopped and the voices closed.
    expect(named(h.calls).filter((c) => c === 'text.stop' || c === 'voice.close')).toHaveLength(4);
  });

  it("a leased voice's lease ending ends the whole run, the text side included, and is filed under the leased provider", async () => {
    let ctx!: LeaseContext;
    const release = vi.fn(async () => {});
    const h = setup({ voiceHooks: { acquire: async (_shape, _s, given) => { ctx = given; return { credentials: () => ({}), release }; } } });
    await h.runner.start();
    ctx.end({ code: 'budget_exhausted', message: 'Session budget exhausted' });
    await vi.waitFor(() => expect(h.runner.state.getState().phase).toBe('idle'));
    expect(h.runner.state.getState()).toMatchObject({ lastEnd: { reason: 'lease-ended', notice: { code: 'budget_exhausted' } } });
    expect(h.runner.conversation.get('speaker')!.snapshot().notices).toEqual([expect.objectContaining({ severity: 'error', code: 'budget_exhausted' })]);
    expect(named(h.calls)).toContain('text.stop');
    expect(release).toHaveBeenCalledTimes(1);
    // The lease is the voice provider's: the error is its, not the transcription provider's, which the run is otherwise named by.
    expect(h.tracked.filter(([event]) => event === 'api_error')).toEqual([
      ['api_error', {
        provider: 'stub_voice', stages: { transcription: 'stub_text', translation: 'stub_text', speech: 'stub_voice' },
        error_message: 'Session budget exhausted', error_code: 'budget_exhausted', error_type: 'server', channel: 'speaker',
      }],
    ]);
    expect(h.tracked.find(([event]) => event === 'translation_session_start')![1]).toMatchObject({ provider: 'stub_text' });
  });

  it("an expected end of a leased voice's lease, a segment at its cap, ends the run and tracks no error", async () => {
    let ctx!: LeaseContext;
    const h = setup({ voiceHooks: { acquire: async (_shape, _s, given) => { ctx = given; return { credentials: () => ({}), release: async () => {} }; } } });
    await h.runner.start();
    ctx.end({ code: 'segment_ended', message: 'Session segment ended at the per-session cap' }, { expected: true });
    await vi.waitFor(() => expect(h.runner.state.getState().phase).toBe('idle'));
    expect(h.runner.state.getState()).toMatchObject({ lastEnd: { reason: 'lease-ended', notice: { code: 'segment_ended' } } });
    expect(h.tracked.map(([event]) => event)).not.toContain('api_error');
  });

  it("starts the participant's voice as the participant's, and its speech switched off and on reaches that voice", async () => {
    const h = setup({ legs: ['speaker', 'participant'], participantSpeech: true });
    await h.runner.start();
    expect(h.voice.voices.map((v) => v.request.leg).sort()).toEqual(['participant', 'speaker']);
    const theirs = h.voice.voices.find((v) => v.request.leg === 'participant')!;
    expect(theirs.request.context.direction).toEqual({ source: 'ja', target: 'en' });

    h.setSpeech(false);
    h.setSpeech(true);
    expect(h.calls.filter((c) => c[0] === 'voice.setOn')).toEqual([['voice.setOn', 'participant', false], ['voice.setOn', 'participant', true]]);

    // The participant's translation is read by its own voice, and plays as the participant's.
    translate(h.started('participant').events, 1, 'Hello.');
    expect(h.calls).toContainEqual(['voice.speak', 'participant', 1, 'Hello.', [0, 6], 'en', undefined]);
    expect(h.played).toEqual([{ leg: 'participant', ref: 1, samples: 240 }]);
  });

  it('stops the text session before it closes the voice', async () => {
    const h = setup();
    await h.runner.start();
    await h.runner.stop();
    const order = named(h.calls);
    expect(order).toContain('text.stop');
    expect(order.indexOf('text.stop')).toBeLessThan(order.indexOf('voice.close'));
    expect(h.runner.state.getState().phase).toBe('idle');
  });
});
