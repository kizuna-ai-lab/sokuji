import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Kept from before the old audio service was deleted: ServiceFactory used to
// import ModernBrowserAudioService -> ModernAudioRecorder -> a worklet
// `?url` import that this sandboxed Vite test transform denied outright.
// ServiceFactory no longer reaches ModernAudioRecorder at all, and this
// module (telemetry.ts) never imports session.ts/appCapture either, so no
// worklet `?url` import is reachable here any more. Not needed by the
// current graph for that reason.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, fallback: unknown) => fallback,
      setSetting: async () => undefined,
    }),
  },
}));

import { settleReports } from '../lib/diagnostics/report';
import { sentenceEnds } from '../lib/segmentation/sentenceEnd';
import useAudioStore from '../stores/audioStore';
import useLogStore from '../stores/logStore';
import { useProviderStore } from '../stores/providerStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  appStartInputs,
  createFrameLog,
  decorateSessionAnalytics,
  sessionEndProperties,
  sessionStartProperties,
  teeFrames,
  type FrameLog,
  type RunFacts,
  type SessionTally,
} from './telemetry';

const initialAudio = useAudioStore.getState();
const initialSettings = useSettingsStore.getState();
const initialProvider = useProviderStore.getState();

beforeEach(() => {
  // These tests assert what reaches the log store, which records nothing
  // unless diagnostic logs are switched on (off by default in the app).
  useLogStore.getState().setEnabled(true);
  useLogStore.getState().clearLogs();
});

afterEach(() => {
  useAudioStore.setState(initialAudio, true);
  useSettingsStore.setState(initialSettings, true);
  useProviderStore.setState(initialProvider, true);
});

function emptyTally(): SessionTally {
  return { seals: {}, modelCalls: 0, text: {} };
}

describe('createFrameLog', () => {
  it('reaches the Logs panel under the leg the frame is on, with the wire direction turned into a source', () => {
    const log = createFrameLog();

    log.port.frame('participant', { direction: 'in', type: 'local.asr.end', payload: { text: 'Hi.', modelId: 'm' } });
    const first = useLogStore.getState().allLogs[useLogStore.getState().allLogs.length - 1];
    expect(first).toMatchObject({ clientId: 'participant', eventType: 'local.asr.end', source: 'server' });

    log.port.frame('participant', { direction: 'out', type: 'local.asr.end', payload: { text: 'Hi.', modelId: 'm' } });
    const second = useLogStore.getState().allLogs[useLogStore.getState().allLogs.length - 1];
    expect(second).toMatchObject({ clientId: 'participant', eventType: 'local.asr.end', source: 'client' });
  });

  it('still counts a frame while diagnostic logs are off, and logs nothing', () => {
    useLogStore.getState().setEnabled(false);
    const log = createFrameLog();

    log.port.frame('speaker', { direction: 'in', type: 'local.asr.end', payload: { text: 'Hi.', modelId: 'm' } });

    expect(log.snapshot().text['speaker|m']).toMatchObject({ chars: 3, terminals: 1 });
    expect(useLogStore.getState().allLogs).toEqual([]);
  });

  it('tallies a seal by leg and reason', () => {
    const log = createFrameLog();

    log.port.frame('speaker', { direction: 'in', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'One.' } });
    log.port.frame('speaker', { direction: 'in', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'Two.' } });
    log.port.frame('participant', { direction: 'in', type: 'local.segmentation.seal', payload: { reason: 'length', text: 'Three' } });

    expect(log.snapshot().seals).toEqual({ speaker_sentences: 2, participant_length: 1 });
  });

  it('does not count a seal whose text has no letters or digits', () => {
    const log = createFrameLog();

    log.port.frame('speaker', { direction: 'in', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: '(' } });

    expect(log.snapshot().seals).toEqual({});
  });

  it('does not count a seal whose reason is not a string', () => {
    const log = createFrameLog();

    log.port.frame('speaker', { direction: 'in', type: 'local.segmentation.seal', payload: { reason: 3, text: 'One.' } });

    expect(log.snapshot().seals).toEqual({});
  });

  it('tallies raw characters and sentence terminals per leg and ASR model', () => {
    const log = createFrameLog();
    const text = 'Hello there. How are you?';

    log.port.frame('speaker', { direction: 'in', type: 'local.asr.end', payload: { text, modelId: 'moonshine tiny' } });

    expect(log.snapshot().text['speaker|moonshine tiny']).toEqual({
      leg: 'speaker',
      model: 'moonshine tiny',
      chars: text.length,
      terminals: sentenceEnds(text).length,
    });
  });

  it('adds a second final to the same bucket', () => {
    const log = createFrameLog();

    log.port.frame('speaker', { direction: 'in', type: 'local.asr.end', payload: { text: 'One.', modelId: 'm' } });
    log.port.frame('speaker', { direction: 'in', type: 'local.asr.end', payload: { text: 'Two.', modelId: 'm' } });

    expect(log.snapshot().text['speaker|m']).toEqual({
      leg: 'speaker',
      model: 'm',
      chars: 'One.'.length + 'Two.'.length,
      terminals: sentenceEnds('One.').length + sentenceEnds('Two.').length,
    });
  });

  it("charges a final with no modelId to 'unknown'", () => {
    const log = createFrameLog();

    log.port.frame('speaker', { direction: 'in', type: 'local.asr.end', payload: { text: 'One.' } });

    expect(log.snapshot().text['speaker|unknown']).toMatchObject({ model: 'unknown' });
  });

  it('counts a model call twice', () => {
    const log = createFrameLog();

    log.countModelCall();
    log.countModelCall();

    expect(log.snapshot().modelCalls).toBe(2);
  });

  it('hands back a copy: mutating the snapshot changes nothing', () => {
    const log = createFrameLog();
    log.port.frame('speaker', { direction: 'in', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'One.' } });

    const snap = log.snapshot();
    snap.seals.speaker_sentences = 999;
    snap.modelCalls = 999;

    expect(log.snapshot().seals).toEqual({ speaker_sentences: 1 });
    expect(log.snapshot().modelCalls).toBe(0);
  });

  it('reset empties all three', () => {
    const log = createFrameLog();
    log.port.frame('speaker', { direction: 'in', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'One.' } });
    log.port.frame('speaker', { direction: 'in', type: 'local.asr.end', payload: { text: 'One.', modelId: 'm' } });
    log.countModelCall();

    log.reset();

    expect(log.snapshot()).toEqual(emptyTally());
  });

  it('counts nothing and throws nothing for a frame of another type, or one with no payload', () => {
    const log = createFrameLog();

    expect(() => {
      log.port.frame('speaker', { direction: 'in', type: 'local.session.opened' });
      log.port.frame('speaker', { direction: 'in', type: 'local.asr.end' });
      log.port.frame('speaker', { direction: 'in', type: 'local.segmentation.seal' });
    }).not.toThrow();

    expect(log.snapshot()).toEqual(emptyTally());
  });
});

describe('teeFrames', () => {
  it('hands every frame to both ports, first before second', () => {
    const order: string[] = [];
    const a = { frame: () => { order.push('a'); } };
    const b = { frame: () => { order.push('b'); } };

    teeFrames(a, b).frame('speaker', { direction: 'in', type: 'local.asr.end' });

    expect(order).toEqual(['a', 'b']);
  });

  it("is the first port's behaviour when there is no second", () => {
    const seen: unknown[] = [];
    const a = { frame: (leg: string, frame: unknown) => { seen.push([leg, frame]); } };

    expect(teeFrames(a)).toBe(a);
    teeFrames(a).frame('participant', { direction: 'out', type: 'local.asr.end' });
    expect(seen).toEqual([['participant', { direction: 'out', type: 'local.asr.end' }]]);
  });
});

describe('sessionStartProperties', () => {
  it('maps the audio, segmentation and punctuator inputs to the kept properties', () => {
    expect(sessionStartProperties({
      audio: { noiseSuppressionMode: 'standard', isRealVoicePassthroughEnabled: true, isMicMuted: false, isMonitorMuted: true },
      segmentation: { mode: 'sentences', size: 2 },
      punctuationActive: true,
    })).toEqual({
      noise_suppression_enabled: true,
      noise_suppression_mode: 'standard',
      real_voice_passthrough_enabled: true,
      input_device_on: true,
      monitor_device_on: false,
      sentence_segmentation_enabled: true,
      sentence_segmentation_active: true,
      sentence_segmentation_chunk_sentences: 2,
    });
  });

  it("reads noise_suppression_enabled false for mode 'off'", () => {
    expect(sessionStartProperties({
      audio: { noiseSuppressionMode: 'off', isRealVoicePassthroughEnabled: false, isMicMuted: false, isMonitorMuted: false },
      segmentation: { mode: 'off', size: 0 },
      punctuationActive: false,
    })).toMatchObject({ noise_suppression_enabled: false, noise_suppression_mode: 'off' });
  });
});

describe('sessionEndProperties', () => {
  const run: RunFacts = { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] };

  it('reports nothing for an empty tally', () => {
    expect(sessionEndProperties(emptyTally(), run)).toEqual({});
  });

  it('keys model calls by the single leg of a one-leg run', () => {
    const tally: SessionTally = { seals: {}, modelCalls: 3, text: {} };
    expect(sessionEndProperties(tally, { pair: run.pair, legs: ['speaker'] }))
      .toEqual({ segmentation_model_calls: { speaker: 3 } });
  });

  it("keys model calls by 'both' for a two-leg run", () => {
    const tally: SessionTally = { seals: {}, modelCalls: 3, text: {} };
    expect(sessionEndProperties(tally, { pair: run.pair, legs: ['speaker', 'participant'] }))
      .toEqual({ segmentation_model_calls: { both: 3 } });
  });

  it('passes seals through unchanged', () => {
    const tally: SessionTally = { seals: { speaker_sentences: 2, participant_length: 1 }, modelCalls: 0, text: {} };
    expect(sessionEndProperties(tally, run)).toEqual({ segmentation_seals: { speaker_sentences: 2, participant_length: 1 } });
  });

  it("keys sentence terminals per 100 raw characters by leg, ASR model and the leg's own language: the speaker's is the pair's source, the participant's is the pair's target", () => {
    const tally: SessionTally = {
      seals: {},
      modelCalls: 0,
      text: {
        'speaker|moonshine tiny': { leg: 'speaker', model: 'moonshine tiny', chars: 200, terminals: 3 },
        'participant|m': { leg: 'participant', model: 'm', chars: 100, terminals: 1 },
      },
    };
    expect(sessionEndProperties(tally, { pair: { source: 'en', target: 'ja' }, legs: ['speaker', 'participant'] }))
      .toEqual({ segmentation_terminals_per_100: { speaker_moonshine_tiny_en: 1.5, participant_m_ja: 1 } });
  });

  it('leaves out a bucket with no characters', () => {
    const tally: SessionTally = {
      seals: {},
      modelCalls: 0,
      text: { 'speaker|m': { leg: 'speaker', model: 'm', chars: 0, terminals: 0 } },
    };
    expect(sessionEndProperties(tally, run)).toEqual({});
  });
});

describe('appStartInputs', () => {
  it('reads the audio, settings and provider stores', () => {
    useAudioStore.setState({ noiseSuppressionMode: 'off', isMicMuted: true });
    useSettingsStore.setState({ segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 3 });
    useProviderStore.setState({ selected: null, entries: {} });

    const inputs = appStartInputs(true);

    expect(inputs.segmentation).toEqual({ mode: 'sentences', size: 3 });
    expect(inputs.punctuationActive).toBe(true);
    expect(inputs.audio.noiseSuppressionMode).toBe('off');
    expect(inputs.audio.isMicMuted).toBe(true);
  });
});

describe('decorateSessionAnalytics', () => {
  function fakeFrameLog(snapshot: SessionTally): FrameLog & { reset: ReturnType<typeof vi.fn> } {
    const reset = vi.fn();
    return {
      port: { frame: () => {} },
      countModelCall: () => {},
      snapshot: () => snapshot,
      reset,
    };
  }

  it('resets the frame log and sends the start event once with the runner properties plus the app-kept ones', () => {
    const track = vi.fn();
    const frames = fakeFrameLog(emptyTally());
    const startInputs = () => ({
      audio: { noiseSuppressionMode: 'off' as const, isRealVoicePassthroughEnabled: false, isMicMuted: false, isMonitorMuted: false },
      segmentation: { mode: 'off' as const, size: 0 as const },
      punctuationActive: false,
    });
    const analytics = decorateSessionAnalytics(() => track, { frames, startInputs });

    analytics.track('translation_session_start', {
      source_language: 'en',
      target_language: 'ja',
      session_id: 's1',
      provider: 'fake',
      channels: ['speaker'],
    });

    expect(frames.reset).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('translation_session_start', {
      source_language: 'en',
      target_language: 'ja',
      session_id: 's1',
      provider: 'fake',
      channels: ['speaker'],
      ...sessionStartProperties(startInputs()),
    });
  });

  it("sends the end event with the tally's segmentation properties, keyed by the legs the start event named", () => {
    const track = vi.fn();
    const tally: SessionTally = { seals: {}, modelCalls: 2, text: {} };
    const frames = fakeFrameLog(tally);
    const startInputs = () => ({
      audio: { noiseSuppressionMode: 'off' as const, isRealVoicePassthroughEnabled: false, isMicMuted: false, isMonitorMuted: false },
      segmentation: { mode: 'off' as const, size: 0 as const },
      punctuationActive: false,
    });
    const analytics = decorateSessionAnalytics(() => track, { frames, startInputs });

    analytics.track('translation_session_start', {
      source_language: 'en',
      target_language: 'ja',
      session_id: 's1',
      provider: 'fake',
      channels: ['speaker', 'participant'],
    });
    analytics.track('translation_session_end', {
      session_id: 's1',
      duration: 1000,
      provider: 'fake',
    });

    expect(track).toHaveBeenLastCalledWith('translation_session_end', {
      session_id: 's1',
      duration: 1000,
      provider: 'fake',
      ...sessionEndProperties(tally, { pair: { source: 'en', target: 'ja' }, legs: ['speaker', 'participant'] }),
    });
  });

  it('passes any other event through unchanged', () => {
    const track = vi.fn();
    const frames = fakeFrameLog(emptyTally());
    const analytics = decorateSessionAnalytics(() => track, { frames, startInputs: () => ({
      audio: { noiseSuppressionMode: 'off' as const, isRealVoicePassthroughEnabled: false, isMicMuted: false, isMonitorMuted: false },
      segmentation: { mode: 'off' as const, size: 0 as const },
      punctuationActive: false,
    }) });

    analytics.track('session_control_clicked', { action: 'start', method: 'button' });

    expect(track).toHaveBeenCalledWith('session_control_clicked', { action: 'start', method: 'button' });
  });

  it("computes the start properties in a try: a throw sends the runner's own properties unchanged, with one warning", async () => {
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().clearLogs();
    const track = vi.fn();
    const frames = fakeFrameLog(emptyTally());
    const startInputs = (): never => { throw new Error('boom'); };
    const analytics = decorateSessionAnalytics(() => track, { frames, startInputs });

    analytics.track('translation_session_start', {
      source_language: 'en', target_language: 'ja', session_id: 's1', provider: 'fake', channels: ['speaker'],
    });

    expect(track).toHaveBeenCalledWith('translation_session_start', {
      source_language: 'en', target_language: 'ja', session_id: 's1', provider: 'fake', channels: ['speaker'],
    });
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);
  });

  it("computes the end properties in a try: a throw sends the runner's own properties unchanged, with one warning", async () => {
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().clearLogs();
    const track = vi.fn();
    const frames = fakeFrameLog(emptyTally());
    frames.snapshot = () => { throw new Error('boom'); };
    const startInputs = () => ({
      audio: { noiseSuppressionMode: 'off' as const, isRealVoicePassthroughEnabled: false, isMicMuted: false, isMonitorMuted: false },
      segmentation: { mode: 'off' as const, size: 0 as const },
      punctuationActive: false,
    });
    const analytics = decorateSessionAnalytics(() => track, { frames, startInputs });

    analytics.track('translation_session_start', {
      source_language: 'en', target_language: 'ja', session_id: 's1', provider: 'fake', channels: ['speaker'],
    });
    analytics.track('translation_session_end', { session_id: 's1', duration: 1000, provider: 'fake' });

    expect(track).toHaveBeenLastCalledWith('translation_session_end', { session_id: 's1', duration: 1000, provider: 'fake' });
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);
  });

  it('reads track() at each call, so swapping the bridge between two events reaches the new one', () => {
    const trackA = vi.fn();
    const trackB = vi.fn();
    let current = trackA;
    const frames = fakeFrameLog(emptyTally());
    const startInputs = () => ({
      audio: { noiseSuppressionMode: 'off' as const, isRealVoicePassthroughEnabled: false, isMicMuted: false, isMonitorMuted: false },
      segmentation: { mode: 'off' as const, size: 0 as const },
      punctuationActive: false,
    });
    const analytics = decorateSessionAnalytics(() => current, { frames, startInputs });

    analytics.track('translation_session_start', {
      source_language: 'en', target_language: 'ja', session_id: 's1', provider: 'fake', channels: ['speaker'],
    });
    current = trackB;
    analytics.track('translation_session_end', { session_id: 's1', duration: 1, provider: 'fake' });

    expect(trackA).toHaveBeenCalledTimes(1);
    expect(trackB).toHaveBeenCalledTimes(1);
  });
});
