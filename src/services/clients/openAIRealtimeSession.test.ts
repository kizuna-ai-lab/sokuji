import { describe, expect, it } from 'vitest';
import { OpenAISessionConfig } from '../interfaces/IClient';
import {
  buildOpenAIRealtimeCallForm,
  buildOpenAIRealtimeResponseEvent,
  buildOpenAIRealtimeSession
} from './openAIRealtimeSession';

const config: OpenAISessionConfig = {
  provider: 'openai',
  model: 'gpt-realtime-2.1',
  voice: 'ash',
  instructions: 'Translate only.',
  maxTokens: 'inf',
  reasoningEffort: 'low',
  turnDetection: {
    type: 'server_vad',
    threshold: 0.5,
    prefixPadding: 0.3,
    silenceDuration: 0.8,
    createResponse: true,
    interruptResponse: false
  },
  inputAudioTranscription: { model: 'gpt-4o-transcribe' },
  inputAudioNoiseReduction: { type: 'near_field' }
};

describe('OpenAI Realtime GA session payload', () => {
  it('places the selected voice under audio.output for every transport', () => {
    const { session, turnDetectionDisabled } = buildOpenAIRealtimeSession(config);

    expect(session.audio.output.voice).toBe('ash');
    expect(session.voice).toBeUndefined();
    expect(session.output_modalities).toEqual(['audio']);
    expect(session.max_output_tokens).toBe('inf');
    expect(session.reasoning).toEqual({ effort: 'low' });
    expect(turnDetectionDisabled).toBe(false);
  });

  it('preserves the current voice for partial updates that omit voice', () => {
    const { session } = buildOpenAIRealtimeSession(
      { ...config, voice: undefined },
      { includeDefaultVoice: false }
    );

    expect(session.audio.output).toBeUndefined();
  });

  it('omits reasoning for models that do not support it', () => {
    const { session } = buildOpenAIRealtimeSession({
      ...config,
      model: 'gpt-realtime'
    });

    expect(session.reasoning).toBeUndefined();
  });

  it('uses GA nested audio input fields', () => {
    const { session } = buildOpenAIRealtimeSession(config);

    expect(session.audio.input).toEqual({
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 800,
        create_response: true,
        interrupt_response: false
      },
      transcription: { model: 'gpt-4o-transcribe' },
      noise_reduction: { type: 'near_field' }
    });
    expect(session.turn_detection).toBeUndefined();
    expect(session.input_audio_transcription).toBeUndefined();
  });

  it('embeds the same Ash session in the WebRTC call form', () => {
    const form = buildOpenAIRealtimeCallForm('offer-sdp', config);
    const callSession = JSON.parse(String(form.get('session')));

    expect(form.get('sdp')).toBe('offer-sdp');
    expect(callSession.model).toBe('gpt-realtime-2.1');
    expect(callSession.audio.output.voice).toBe('ash');
    expect(callSession.output_modalities).toEqual(['audio']);
  });

  it('tracks push-to-talk and omits output voice for text-only mode', () => {
    const { session, turnDetectionDisabled } = buildOpenAIRealtimeSession({
      ...config,
      textOnly: true,
      turnDetection: { type: 'none' }
    });

    expect(turnDetectionDisabled).toBe(true);
    expect(session.output_modalities).toEqual(['text']);
    expect(session.audio.output).toBeUndefined();
    expect(session.audio.input.turn_detection).toBeNull();
  });

  it('uses output_modalities in GA response.create events', () => {
    const event = buildOpenAIRealtimeResponseEvent({
      conversation: 'none',
      modalities: ['text'],
      instructions: 'Anchor translator behavior.',
      metadata: { purpose: 'anchor' }
    });

    expect(event).toEqual({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['text'],
        instructions: 'Anchor translator behavior.',
        metadata: { purpose: 'anchor' }
      }
    });
    expect(event.response.modalities).toBeUndefined();
  });
});
