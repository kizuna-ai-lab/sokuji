import { describe, it, expect } from 'vitest';
import { OpenAITranslateGAClient } from './OpenAITranslateGAClient';
import type { OpenAITranslateSessionConfig } from '../interfaces/IClient';

const baseConfig: OpenAITranslateSessionConfig = {
  provider: 'openai_translate',
  model: 'gpt-realtime-translate',
  targetLanguage: 'es',
};

describe('OpenAITranslateGAClient.buildSessionUpdate', () => {
  it('builds minimal payload with target language only', () => {
    const payload = OpenAITranslateGAClient.buildSessionUpdate(baseConfig);
    expect(payload).toEqual({
      type: 'session.update',
      session: {
        audio: {
          output: { language: 'es' },
        },
      },
    });
  });

  it('includes transcription config when provided', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      inputAudioTranscription: { model: 'gpt-realtime-whisper' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.input).toEqual({
      transcription: { model: 'gpt-realtime-whisper' },
    });
  });

  it('includes noise reduction when provided', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      inputAudioNoiseReduction: { type: 'near_field' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.input).toEqual({
      noise_reduction: { type: 'near_field' },
    });
  });

  it('combines transcription and noise reduction', () => {
    const config: OpenAITranslateSessionConfig = {
      ...baseConfig,
      targetLanguage: 'zh',
      inputAudioTranscription: { model: 'gpt-realtime-whisper' },
      inputAudioNoiseReduction: { type: 'far_field' },
    };
    const payload = OpenAITranslateGAClient.buildSessionUpdate(config);
    expect(payload.session.audio.output.language).toBe('zh');
    expect(payload.session.audio.input).toEqual({
      transcription: { model: 'gpt-realtime-whisper' },
      noise_reduction: { type: 'far_field' },
    });
  });

  it('omits audio.input when neither transcription nor noise reduction set', () => {
    const payload = OpenAITranslateGAClient.buildSessionUpdate(baseConfig);
    expect(payload.session.audio).not.toHaveProperty('input');
  });
});
