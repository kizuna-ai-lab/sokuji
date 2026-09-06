import { describe, it, expect } from 'vitest';
import { sessionModelTelemetry, legModelsOf } from './sessionModelTelemetry';

const speaker = {
  provider: 'local_inference',
  asrModelId: 'qwen3-asr-0.6b-webgpu',
  translationModelId: 'hy-mt15-1.8b-translation',
  ttsModelId: 'supertonic-3',
};

describe('legModelsOf', () => {
  it('reads the models a local leg resolved', () => {
    expect(legModelsOf({
      provider: 'local_inference',
      asrModelId: 'voxtral-mini-4b-webgpu',
      translationModelId: 'hy-mt15-1.8b-translation',
    })).toEqual({ asr: 'voxtral-mini-4b-webgpu', translation: 'hy-mt15-1.8b-translation' });
  });

  it('covers local_native, which names the same fields', () => {
    expect(legModelsOf({ provider: 'local_native', asrModelId: 'parakeet', translationModelId: 'qwen3' }))
      .toEqual({ asr: 'parakeet', translation: 'qwen3' });
  });

  it('says none rather than dropping the leg when it resolved no translation model', () => {
    expect(legModelsOf({ provider: 'local_inference', asrModelId: 'voxtral-mini-4b-webgpu' }))
      .toEqual({ asr: 'voxtral-mini-4b-webgpu', translation: 'none' });
  });

  it('is null for a provider with no per-leg model selection, and for no config', () => {
    expect(legModelsOf({ provider: 'openai', asrModelId: 'whatever' })).toBeNull();
    expect(legModelsOf(null)).toBeNull();
    expect(legModelsOf(undefined)).toBeNull();
  });
});

describe('sessionModelTelemetry', () => {
  it('reports both legs when a split session runs two model sets', () => {
    // The case that produced issue #504: the speaker had been switched to
    // Qwen3-ASR while the participant direction was still resolving Voxtral,
    // so every participant error looked like it came from a model the session
    // was not using.
    expect(sessionModelTelemetry(speaker, { asr: 'voxtral-mini-4b-webgpu', translation: 'hy-mt15-1.8b-translation' }))
      .toEqual({
        asr_model: 'qwen3-asr-0.6b-webgpu',
        translation_model: 'hy-mt15-1.8b-translation',
        tts_model: 'supertonic-3',
        participant_asr_model: 'voxtral-mini-4b-webgpu',
        participant_translation_model: 'hy-mt15-1.8b-translation',
      });
  });

  it('omits the participant fields entirely when there is no participant leg', () => {
    const props = sessionModelTelemetry(speaker, null);
    expect(props).toEqual({
      asr_model: 'qwen3-asr-0.6b-webgpu',
      translation_model: 'hy-mt15-1.8b-translation',
      tts_model: 'supertonic-3',
    });
    expect('participant_asr_model' in props).toBe(false);
  });

  it('reports local_native, which was silently excluded before', () => {
    expect(sessionModelTelemetry(
      { provider: 'local_native', asrModelId: 'parakeet', translationModelId: 'qwen3', ttsModelId: 'supertonic' },
      null,
    )).toEqual({ asr_model: 'parakeet', translation_model: 'qwen3', tts_model: 'supertonic' });
  });

  it('keeps the placeholder spellings existing queries were written against', () => {
    expect(sessionModelTelemetry({ provider: 'local_inference', asrModelId: 'whisper-tiny' }, null))
      .toEqual({ asr_model: 'whisper-tiny', translation_model: 'unknown', tts_model: 'none' });
  });

  it('reports no models at all for a cloud provider', () => {
    expect(sessionModelTelemetry({ provider: 'openai' }, null)).toEqual({});
  });

  it('still reports the participant leg when the speaker is a cloud provider', () => {
    // Not reachable today (a split session shares one provider), but the two
    // legs are reported independently on purpose, so neither can silence the
    // other if that ever changes.
    expect(sessionModelTelemetry({ provider: 'openai' }, { asr: 'voxtral-mini-4b-webgpu', translation: 'none' }))
      .toEqual({ participant_asr_model: 'voxtral-mini-4b-webgpu', participant_translation_model: 'none' });
  });
});
