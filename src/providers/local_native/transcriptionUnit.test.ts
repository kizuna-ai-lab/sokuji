/**
 * Local Native's recognition as a unit of its own: what it declares, the config it builds, which configs it takes,
 * and its sessions over the fake seams, held to the adapter rules.
 */
import { describe, expect, it } from 'vitest';
import { AdapterStartError, type AdapterSession, type SessionContext } from '../../lib/contract/adapter';
import { createVirtualClock } from '../../lib/contract/clock';
import { checkConformance, recordConformance, type ConformanceLog } from '../../lib/contract/conformance';
import type { AdapterEvent } from '../../lib/contract/events';
import { fakeNativeModels } from '../../lib/local-inference/native/nativeModels.testing';
import type { SharedSettings } from '../../lib/run/types';
import type { LocalNativeConfig } from './config';
import { createFakeNativeEngines, createFakeNativeHost } from './fakeEngines';
import { LOCAL_NATIVE_DEFAULTS } from './settings';
import {
  admitNativeTranscription, areNativeTranscriptionConfigs, buildNativeTranscription, createNativeTranscriptionUnit, nativeTranscriptionUnit,
} from './transcriptionUnit';

const context: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const resolved = (id: string | null) => (id ? { modelId: id, source: 'explicit' as const } : null);

function shared(asr: string | null = 'asr-a', over: Partial<SharedSettings> = {}): SharedSettings {
  const nativeModels = fakeNativeModels({
    resolve: () => ({ asr: resolved(asr), translation: resolved('mt-a'), tts: resolved('tts-a'), notes: [], prunes: [] }),
  });
  return { pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 }, reversed: () => false, segmentation: { mode: 'sentences', sentencesPerRow: 2 }, models: [], nativeModels, ...over };
}

function aloneConfig(over: Partial<LocalNativeConfig> = {}): LocalNativeConfig {
  return {
    asr: { modelId: 'asr-a', device: 'auto' },
    vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4 },
    limit: { maxSpeechSeconds: 19 },
    translation: null,
    asrFirst: true,
    transcribesAlone: true,
    host: createFakeNativeHost(),
    ...over,
  };
}

const events = (log: ConformanceLog) => log.filter((e): e is AdapterEvent => e.kind !== 'marker');
const ofKind = <K extends AdapterEvent['kind']>(log: ConformanceLog, kind: K) =>
  events(log).filter((e) => e.kind === kind).map((e) => e.payload as Extract<AdapterEvent, { kind: K }>['payload']);

async function open(config = aloneConfig()) {
  const fakes = createFakeNativeEngines();
  const recorder = recordConformance();
  const starting = createNativeTranscriptionUnit({ engines: fakes.engines }).start!(
    { context, config, credentials: {}, clock: createVirtualClock(), signal: new AbortController().signal }, recorder.events,
  );
  fakes.asr.ready();
  fakes.turns.ready();
  const session: AdapterSession = await starting;
  await settle();
  return { ...fakes, ...recorder, session };
}

describe('what the Local Native transcription unit declares', () => {
  it('occupies transcription alone, and nothing else', () => {
    const occupies = (stages: string[]) => nativeTranscriptionUnit.occupies(LOCAL_NATIVE_DEFAULTS, new Set(stages) as never);
    expect(occupies(['transcription'])).toEqual(['transcription']);
    expect(occupies(['transcription', 'translation'])).toBeNull();
    expect(occupies(['translation'])).toBeNull();
    expect(occupies(['speech'])).toBeNull();
  });

  it('declares what the whole session declares for transcription, and never speaks', () => {
    expect(nativeTranscriptionUnit.capabilities(LOCAL_NATIVE_DEFAULTS)).toEqual({
      speech: 'never', turns: ['auto', 'manual'], boundaries: 'provider', textInput: true, faceToFace: false, participantSpeech: true,
    });
    expect(nativeTranscriptionUnit.describe(aloneConfig())).toEqual({ asrModel: 'asr-a' });
  });
});

describe('the config it builds', () => {
  it('builds the leg\'s recognition model with the device the settings pin, and no translation or voice', () => {
    const s = shared();
    const c = buildNativeTranscription(context, { ...LOCAL_NATIVE_DEFAULTS, asrDevice: 'gpu' }, s) as LocalNativeConfig;
    expect(c).toEqual({
      asr: { modelId: 'asr-a', device: 'gpu' },
      vad: { threshold: 0.3, minSilenceDuration: 1.4, minSpeechDuration: 0.4, maxSpeechDuration: 30, preSpeechPadDuration: 0.8 },
      limit: { maxSpeechSeconds: 19 },
      translation: null,
      asrFirst: true,
      transcribesAlone: true,
      host: s.nativeModels,
    });
  });

  it('refuses a direction with no recognition model (no_asr)', () => {
    expect(buildNativeTranscription(context, LOCAL_NATIVE_DEFAULTS, shared(null))).toEqual({ refused: 'No speech recognition model for ja.', code: 'no_asr', params: { source: 'ja' } });
  });
});

describe('admission', () => {
  it("areNativeTranscriptionConfigs takes this unit's configs and no other unit's", () => {
    expect(areNativeTranscriptionConfigs({ speaker: aloneConfig() })).toBe(true);
    const whole = aloneConfig({ transcribesAlone: undefined, translation: { modelId: 'mt-a', device: 'auto', instructions: '', wrapTranscript: true } });
    expect(areNativeTranscriptionConfigs({ speaker: whole })).toBe(false);
    expect(areNativeTranscriptionConfigs({ speaker: { voice: 'x' } as never })).toBe(false);
    expect(areNativeTranscriptionConfigs({})).toBe(false);
  });

  it('refuses two legs and admits one', () => {
    expect(admitNativeTranscription({ speaker: aloneConfig() })).toBe(true);
    expect(admitNativeTranscription({ speaker: aloneConfig(), participant: aloneConfig() })).toEqual({ refused: 'Local Native transcribes one side at a time: choose Me or Other.' });
  });
});

describe('a session of the Local Native transcription unit', () => {
  it('says no translation_unavailable, and each final states all of it stable', async () => {
    const t = await open();
    t.asr.partial('こんにち');
    t.asr.final('こんにちは');
    await settle();
    expect(ofKind(t.log, 'degraded').filter((d) => d.code === 'translation_unavailable')).toEqual([]);
    const texts = ofKind(t.log, 'segmentText');
    expect(texts[texts.length - 1]).toMatchObject({ text: 'こんにちは', heard: { pieces: [], stableLen: 5 } });
    expect(ofKind(t.log, 'segmentOpened').map((o) => o.side)).toEqual(['source']);
    expect(checkConformance(t.log, context)).toEqual([]);
  });

  it('typed text is shown as a source and nothing more', async () => {
    const t = await open();
    t.session.appendText('hi');
    await settle();
    expect(ofKind(t.log, 'segmentOpened').map((o) => o.side)).toEqual(['source']);
    expect(ofKind(t.log, 'degraded')).toEqual([]);
    expect(checkConformance(t.log, context)).toEqual([]);
  });

  it('refuses at start a config that would translate or speak, before any seam is made', async () => {
    for (const config of [
      aloneConfig({ translation: { modelId: 'mt-a', device: 'auto', instructions: '', wrapTranscript: true } }),
      aloneConfig({ tts: { modelId: 'tts-a', device: 'auto', speed: 1, voice: '', capability: null } }),
      aloneConfig({ transcribesAlone: undefined }),
    ]) {
      const fakes = createFakeNativeEngines();
      const recorder = recordConformance();
      const start = createNativeTranscriptionUnit({ engines: fakes.engines }).start!(
        { context, config, credentials: {}, clock: createVirtualClock(), signal: new AbortController().signal }, recorder.events,
      );
      await expect(start).rejects.toBeInstanceOf(AdapterStartError);
      await expect(start).rejects.toMatchObject({ code: 'build_refused' });
      expect(fakes.calls).toEqual([]);
      expect(fakes.clocks).toEqual({});
    }
  });

  it('a closed ASR socket fails the session', async () => {
    const t = await open();
    t.asr.close();
    await settle();
    expect(ofKind(t.log, 'failed')).toHaveLength(1);
    expect(checkConformance(t.log, context)).toEqual([]);
  });
});
