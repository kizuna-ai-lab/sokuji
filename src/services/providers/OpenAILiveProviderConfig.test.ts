import { describe, it, expect, vi } from 'vitest';

vi.mock('../../locales', () => ({ default: { t: (key: string) => key } }));

import { OpenAILiveProviderConfig, defaultOpenAILiveSettings, LIVE_VOICES } from './OpenAILiveProviderConfig';
import { OpenAILiveClient } from '../clients/OpenAILiveClient';
import { OpenAIClient } from '../clients/OpenAIClient';
import type { OpenAILiveSessionConfig } from '../interfaces/IClient';

const descriptor = new OpenAILiveProviderConfig();

describe('OpenAILiveProviderConfig.getConfig', () => {
  const cfg = descriptor.getConfig();

  it('is the openai_live provider with a fixed model and 22 voices', () => {
    expect(cfg.id).toBe('openai_live');
    expect(cfg.displayName).toBe('OpenAI Live');
    expect(cfg.models).toEqual([{ id: 'gpt-live-1', type: 'realtime' }]);
    expect(cfg.voices).toHaveLength(22);
    expect(cfg.voices.map(v => v.value)).toEqual(expect.arrayContaining(['marin', 'cedar', 'alloy', 'quartz', 'bossa', 'cinder']));
    expect(cfg.voices).toBe(LIVE_VOICES);
  });

  it('switches off everything Live has no wire field for', () => {
    expect(cfg.capabilities).toMatchObject({
      hasTemplateMode: true,
      hasTurnDetection: false,
      hasVoiceSettings: true,
      hasNoiseReduction: false,
      hasModelConfiguration: false,
      hasReasoningEffort: false,
      textOnlyCapability: 'never',
      // Every field false: with hasTurnDetection off, nothing in this block
      // renders — the silence slider it used to claim is the segmentation
      // section's global pause pair since A2.
      turnDetection: { modes: [], hasThreshold: false, hasPrefixPadding: false, hasSilenceDuration: false, hasSemanticEagerness: false },
    });
    expect(cfg.transcriptModels).toEqual([]);
    expect(cfg.noiseReductionModes).toEqual([]);
    expect(cfg.targetLanguages).toBeUndefined();
    expect(cfg.languages.length).toBeGreaterThan(30);
  });

  it('declares the slice key and no WebRTC', () => {
    expect(descriptor.settingsSliceKey).toBe('openaiLive');
    expect(descriptor.supportsWebRTC).toBe(false);
  });
});

describe('OpenAILiveProviderConfig.buildSessionConfig', () => {
  // The silence thresholds used to be built here from two fields of this
  // provider's own slice. A2 made them one global pair, so they reach the
  // client through ClientOptions instead and the session config carries
  // nothing about them.
  it('carries the rendered instructions, voice and pair, and no silence thresholds', () => {
    const cfg = descriptor.buildSessionConfig(
      { ...defaultOpenAILiveSettings, voice: 'cedar', sourceLanguage: 'ja', targetLanguage: 'en' },
      'INSTR',
    ) as OpenAILiveSessionConfig;
    expect(cfg).toEqual({
      provider: 'openai_live',
      model: 'gpt-live-1',
      voice: 'cedar',
      instructions: 'INSTR',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
    });
  });

  it('the participant leg swaps the instructions and is text-only like every provider', () => {
    const result = descriptor.buildParticipantSessionConfig(defaultOpenAILiveSettings, 'SWAPPED', { keepReplayAudio: true });
    expect(result.notices).toEqual([]);
    expect(result.config).toMatchObject({ provider: 'openai_live', instructions: 'SWAPPED', textOnly: true, keepReplayAudio: true });
  });
});

describe('OpenAILiveProviderConfig.createClient / validation', () => {
  it('always builds the WebSocket client', () => {
    const client = descriptor.createClient({ ok: true, primary: 'k' }, { transport: 'webrtc' });
    expect(client).toBeInstanceOf(OpenAILiveClient);
    expect(client.getProvider()).toBe('openai_live');
  });

  it('hands the client the pause pair in milliseconds — the source side, then the translation side', () => {
    const client = descriptor.createClient(
      { ok: true, primary: 'k' },
      { transport: 'websocket', sourcePause: 0.8, translationPause: 2 },
    );
    expect((client as any).userSilenceTimeoutMs).toBe(800);
    expect((client as any).assistantSilenceTimeoutMs).toBe(2000);
  });

  it('falls back to 1.5 s a side when no pause reaches it', () => {
    const client = descriptor.createClient({ ok: true, primary: 'k' }, { transport: 'websocket' });
    expect((client as any).userSilenceTimeoutMs).toBe(1500);
    expect((client as any).assistantSilenceTimeoutMs).toBe(1500);
  });

  it('accepts a key whose model list contains gpt-live-1 and rejects one without it', async () => {
    const spy = vi.spyOn(OpenAIClient, 'fetchOpenAIModelsList');
    spy.mockResolvedValueOnce({ models: [
      { id: 'gpt-realtime-2.1', created: 1, object: 'model', owned_by: 'openai' } as any,
      { id: 'gpt-live-transcribe', created: 2, object: 'model', owned_by: 'openai' } as any,
      { id: 'gpt-live-1', created: 3, object: 'model', owned_by: 'openai' } as any,
    ] });
    const ok = await descriptor.validateAndFetchModels({ ok: true, primary: 'k' });
    expect(ok.validation.valid).toBe(true);
    expect(ok.models.map(m => m.id)).toEqual(['gpt-live-1']);
    expect(descriptor.latestRealtimeModel(ok.models)).toBe('gpt-live-1');

    spy.mockResolvedValueOnce({ models: [{ id: 'gpt-realtime-2.1', created: 1, object: 'model', owned_by: 'openai' } as any] });
    const bad = await descriptor.validateAndFetchModels({ ok: true, primary: 'k' });
    expect(bad.validation).toMatchObject({ valid: false, message: 'settings.realtimeModelNotAvailable', hasRealtimeModel: false });
    expect(bad.models).toEqual([]);
    spy.mockRestore();
  });

  it('reports the provider-specific missing-key message', async () => {
    const res = await descriptor.validateAndFetchModels({ ok: false, missing: 'API key is required for openai_live' });
    expect(res.validation.valid).toBe(false);
    expect(res.validation.message).toBe('API key is required for openai_live');
  });
});

describe('OpenAILiveProviderConfig participant direction', () => {
  it('asks the Start gate for a concrete source whenever a participant leg is in scope', () => {
    // The gate reads this; with an `auto` source the participant template would
    // otherwise name "auto" as its target language.
    expect(descriptor.reversesDirectionViaSourceLanguage('gpt-live-1')).toBe(true);
  });
});
