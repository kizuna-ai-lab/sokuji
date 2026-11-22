import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { TranslationEvents } from '../contract/translation';
import type { LegName } from '../conversation/types';
import { separatePlan, stubSpeechUnit, stubTextUnit, stubTranslationUnit, type StubCalls, type StubTextStart } from '../plan/testing';
import type { AnyProvider, SharedSettings } from '../provider/types';
import { FAKE_LANGUAGES } from '../../providers/fake/provider';
import { createFakeSource } from '../../providers/fake/source';
import { createRunner } from './runner';
import type { RunShape } from './types';

const STAGES = { transcription: 'stub_text', translation: 'stub_translation', speech: 'stub_voice' };

/**
 * A run over a plan of three stub units, each of a provider of its own: `stub_text` transcribes, `stub_translation`
 * translates, `stub_voice` speaks. Each provider reads its own credentials and describes its own models.
 */
function setup(o: { legs?: RunShape['legs']; participantSpeech?: boolean; startBoth?: () => never } = {}) {
  const clock = createVirtualClock(0);
  const calls: StubCalls = [];
  const member = (id: string, describe: () => object) => ({
    credentials: { keys: [], fields: () => [], read: () => ({ key: id }) },
    languages: FAKE_LANGUAGES,
    build: (_context: unknown, _s: unknown, _shared: SharedSettings) => ({ built: id }),
    describe,
  });
  const text = stubTextUnit(calls, { provider: { ...member('stub_text', () => ({ asrModel: 'text-asr', translationModel: 'text-translation', ttsModel: 'text-tts' })), ...(o.startBoth ? { session: { startBoth: o.startBoth } } : {}) } });
  const translation = stubTranslationUnit(calls, { provider: member('stub_translation', () => ({ translationModel: 'translation-model' })) });
  const voice = stubSpeechUnit(calls, { answers: true, provider: member('stub_voice', () => ({ ttsModel: 'voice-tts' })) });
  const shape: RunShape = {
    plan: separatePlan(text.planned, translation.planned, voice.planned),
    accounts: { stub_text: { settings: {}, credentials: {} }, stub_translation: { settings: {}, credentials: {} }, stub_voice: { settings: {}, credentials: {} } },
    lineUp: STAGES,
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
  const tracked: Array<[string, Record<string, unknown>]> = [];
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async (p: AnyProvider) => ({ state: 'ready', models: [{ id: `${p.id}-model` }] }),
    persistIfUnchanged: () => {},
    openSource: async () => createFakeSource(clock),
    playback: { audio: () => [], held: () => {}, clear: () => {}, live: () => {} },
    analytics: { track: (event, properties) => { tracked.push([event, properties as Record<string, unknown>]); } },
    participantSpeech: { get: () => true, subscribe: () => () => {} },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  /** The transcription's start for a leg: the speaker's direction starts from `en`. */
  const heard = (leg: LegName = 'speaker'): StubTextStart => text.starts.find((s) => (s.request.context.direction.source === 'en') === (leg === 'speaker'))!;
  const translated = (leg: LegName = 'speaker'): TranslationEvents => translation.sessions.find((s) => s.request.leg === leg)!.events;
  const errors = () => tracked.filter(([event]) => event === 'api_error').map(([, properties]) => properties);
  return { clock, runner, calls, text, translation, voice, tracked, heard, translated, errors };
}

function hear(events: AdapterEvents, ref: number, text: string, origin: string) {
  events.segmentOpened({ ref, side: 'source', origin });
  events.segmentText({ ref, text });
  events.segmentClosed({ ref, origin });
}

describe('a run over a plan of a unit that transcribes, a unit that translates and a unit that speaks', () => {
  it('starts, each unit with its own provider\'s config and credentials, and names each model from the unit of its stage', async () => {
    const h = setup();
    await h.runner.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live' } });
    expect(h.heard().request).toMatchObject({ config: { built: 'stub_text' }, credentials: { key: 'stub_text' } });
    expect(h.translation.sessions[0].request).toMatchObject({ leg: 'speaker', config: { built: 'stub_translation' }, credentials: { key: 'stub_translation' }, context: { direction: { source: 'en', target: 'ja' }, speech: false } });
    expect(h.voice.voices[0].request).toMatchObject({ config: { built: 'stub_voice' }, credentials: { key: 'stub_voice' } });
    expect(h.runner.conversation.info).toMatchObject({ provider: 'stub_text', stages: STAGES, models: { asrModel: 'text-asr', translationModel: 'translation-model', ttsModel: 'voice-tts' } });
  });

  it('what is heard is translated and read: the rows are the leg\'s, the translation under its source\'s origin', async () => {
    const h = setup();
    await h.runner.start();
    hear(h.heard().events, 1, 'Hello.', 'u1');
    expect(h.translation.sessions[0].sources.slice(-1)).toEqual([{ origin: 'u1', text: 'Hello.', stableLen: 6, closed: true }]);
    h.translated().translationOpened({ ref: 1, origin: 'u1' });
    h.translated().translationText({ ref: 1, text: 'こんにちは。', stableLen: 6 });
    h.translated().translationClosed({ ref: 1 });
    const rows = h.runner.conversation.get('speaker')!.snapshot().segments;
    expect(rows.map((r) => [r.side, r.origin, r.text, r.final])).toEqual([['source', 'u1', 'Hello.', true], ['translation', 'u1', 'こんにちは。', true]]);
    expect(rows[1].speech).toHaveLength(1);
    expect(h.calls).toContainEqual(['voice.speak', 'speaker', 2, 'こんにちは。', [0, 6], 'ja', undefined]);
  });

  it('files a degradation under the provider whose stage it came from: a failed translation under the one that translates', async () => {
    const h = setup();
    await h.runner.start();
    h.translated().degraded({ code: 'translation_failed', message: 'A sentence could not be translated.', reason: 'http_500' });
    h.heard().events.degraded({ code: 'transcription_failed', message: 'One utterance was lost.' });
    h.voice.voices[0].events.degraded({ code: 'tts_degraded', message: 'The voice is gone.', reason: 'tts_408' });
    expect(h.errors()).toEqual([
      { provider: 'stub_translation', stages: STAGES, error_message: 'A sentence could not be translated.', error_code: 'http_500', error_type: 'server', channel: 'speaker' },
      { provider: 'stub_text', stages: STAGES, error_message: 'One utterance was lost.', error_code: 'transcription_failed', error_type: 'server', channel: 'speaker' },
      { provider: 'stub_voice', stages: STAGES, error_message: 'The voice is gone.', error_code: 'tts_408', error_type: 'server', channel: 'speaker' },
    ]);
    // The user is told on the leg, whoever it came from.
    expect(h.runner.conversation.get('speaker')!.snapshot().notices.map((n) => n.code)).toEqual(['translation_failed', 'transcription_failed', 'tts_degraded']);
    // The run is still named by the provider that transcribes.
    expect(h.tracked.find(([event]) => event === 'translation_session_start')![1]).toMatchObject({ provider: 'stub_text' });
  });

  it('a translation unit that fails ends the run, and its error is filed under the provider that translates', async () => {
    const h = setup();
    await h.runner.start();
    h.translated().failed({ message: 'The translation model is gone.', code: 'model_lost' });
    await vi.waitFor(() => expect(h.runner.state.getState().phase).toBe('idle'));
    expect(h.runner.state.getState()).toMatchObject({ lastEnd: { reason: 'leg-failed', notice: { code: 'model_lost', message: 'The translation model is gone.', leg: 'speaker' } } });
    expect(h.errors()).toEqual([
      { provider: 'stub_translation', stages: STAGES, error_message: 'The translation model is gone.', error_code: 'model_lost', error_type: 'server', channel: 'speaker' },
    ]);
    expect(h.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['text.stop', 'translation.stop', 'voice.close']));
  });

  it("a translation unit refused for its key (or its credit) ends the run naming the provider that translates, so the notice opens that provider's row", async () => {
    for (const code of ['auth', 'quota']) {
      const h = setup();
      await h.runner.start();
      h.translated().failed({ message: 'Incorrect API key provided.', code });
      await vi.waitFor(() => expect(h.runner.state.getState().phase).toBe('idle'));
      expect(h.runner.state.getState(), code).toMatchObject({ lastEnd: { reason: 'leg-failed', notice: { code, message: 'Incorrect API key provided.', params: { provider: 'stub_translation' }, leg: 'speaker' } } });
      // The leg's own notice too.
      expect(h.runner.conversation.get('speaker')!.snapshot().notices, code).toEqual([expect.objectContaining({ code, params: { provider: 'stub_translation' } })]);
    }
    // Any other code names no provider, as before.
    const other = setup();
    await other.runner.start();
    other.translated().failed({ message: 'The model is gone.', code: 'model_missing' });
    await vi.waitFor(() => expect(other.runner.state.getState().phase).toBe('idle'));
    const end = other.runner.state.getState();
    expect(end.phase === 'idle' ? end.lastEnd?.notice : undefined).not.toHaveProperty('params');
  });

  it('a transcription that fails is filed under the provider that transcribes, as before', async () => {
    const h = setup();
    await h.runner.start();
    h.heard().events.failed({ message: 'The socket closed.', code: 'socket_closed' });
    await vi.waitFor(() => expect(h.runner.state.getState().phase).toBe('idle'));
    expect(h.errors()).toEqual([expect.objectContaining({ provider: 'stub_text', error_code: 'socket_closed' })]);
  });

  it('runs both legs, each with a translation session in its own direction', async () => {
    const h = setup({ legs: ['speaker', 'participant'], participantSpeech: true });
    await h.runner.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live', participant: 'live' } });
    expect(h.translation.sessions.map((s) => [s.request.leg, s.request.context.direction]).sort()).toEqual([
      ['participant', { source: 'ja', target: 'en' }],
      ['speaker', { source: 'en', target: 'ja' }],
    ]);
    hear(h.heard('participant').events, 1, 'はい。', 'u1');
    h.translated('participant').translationOpened({ ref: 1, origin: 'u1' });
    h.translated('participant').translationText({ ref: 1, text: 'Yes.', stableLen: 4 });
    h.translated('participant').translationClosed({ ref: 1 });
    expect(h.runner.conversation.get('participant')!.snapshot().segments.map((r) => r.text)).toEqual(['はい。', 'Yes.']);
    expect(h.runner.conversation.get('speaker')!.snapshot().segments).toEqual([]);
    await h.runner.stop();
    expect(h.calls.filter((c) => c[0] === 'translation.stop')).toHaveLength(2);
  });

  it('starts each leg on its own even where the provider that transcribes can start both at once', async () => {
    const startBoth = vi.fn((): never => { throw new Error('not asked'); });
    const h = setup({ legs: ['speaker', 'participant'], participantSpeech: true, startBoth });
    await h.runner.start();
    expect(h.runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live', participant: 'live' } });
    expect(startBoth).not.toHaveBeenCalled();
    expect(h.text.starts).toHaveLength(2);
    expect(h.translation.sessions).toHaveLength(2);
    expect(h.voice.voices.map((v) => v.request.leg).sort()).toEqual(['participant', 'speaker']);
    await h.runner.stop();
  });
});
