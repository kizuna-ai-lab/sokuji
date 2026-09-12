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
      turnDetection: { modes: [], hasThreshold: false, hasPrefixPadding: false, hasSilenceDuration: true, hasSemanticEagerness: false },
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
  it('carries the rendered instructions, voice, pair and silence thresholds in ms', () => {
    const cfg = descriptor.buildSessionConfig(
      { ...defaultOpenAILiveSettings, voice: 'cedar', sourceLanguage: 'ja', targetLanguage: 'en', userSilenceDuration: 0.8, assistantSilenceDuration: 2 },
      'INSTR',
    ) as OpenAILiveSessionConfig;
    expect(cfg).toEqual({
      provider: 'openai_live',
      model: 'gpt-live-1',
      voice: 'cedar',
      instructions: 'INSTR',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      userSilenceDurationMs: 800,
      assistantSilenceDurationMs: 2000,
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
