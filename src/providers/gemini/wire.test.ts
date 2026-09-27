import { describe, it, expect } from 'vitest';
import { AUTO_CTX, configFor, DIALOGUE, KEY, serverFrame, TRANSLATE } from './testing';
import {
  ACTIVITY_END, ACTIVITY_START, audioFrame, base64ToPcm, closeFailureCode, decodeServerMessage, INPUT_MIME, liveUrl, pcmRate, setupFrame, textFrame,
} from './wire';

const PARTICIPANT = { direction: { source: 'ja-JP', target: 'en-US' }, speech: true, turns: 'auto' as const };

describe("Gemini's wire", () => {
  it('dials the documented Live endpoint, v1beta, the key in the query (choice 11)', () => {
    expect(liveUrl(KEY.apiKey)).toBe(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY.apiKey}`);
    expect(liveUrl('a+b/c')).toContain('?key=a%2Bb%2Fc');
  });

  it("sets up a dialogue model: AUDIO, its sampling and voice, the prompt, both transcriptions, no interruption, the user's detection knobs", () => {
    expect(setupFrame(configFor(DIALOGUE), null)).toEqual({
      setup: {
        model: `models/${DIALOGUE}`,
        generationConfig: { responseModalities: ['AUDIO'], temperature: 0.8, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } },
        systemInstruction: { parts: [{ text: expect.stringContaining('translate English (United States) → Japanese (Japan).') }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          activityHandling: 'NO_INTERRUPTION',
          automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', silenceDurationMs: 500, prefixPaddingMs: 300 },
        },
        sessionResumption: {},
        contextWindowCompression: { slidingWindow: {} },
      },
    });
  });

  it('sets up Live Translate: its target under generationConfig, echo off, the prompt kept, no sampling, no voice', () => {
    const setup = setupFrame(configFor(TRANSLATE), null).setup;
    expect(setup.generationConfig).toEqual({ responseModalities: ['AUDIO'], translationConfig: { targetLanguageCode: 'ja', echoTargetLanguage: false } });
    expect(setup.systemInstruction).toBeDefined();
    expect(setupFrame(configFor(TRANSLATE, PARTICIPANT), null).setup.generationConfig.translationConfig).toEqual({ targetLanguageCode: 'en', echoTargetLanguage: false });
  });

  it('marks activity itself under manual turns, still asks for AUDIO from a silent leg, sends max tokens, omits a blank prompt, and resumes with a handle', () => {
    expect(setupFrame(configFor(DIALOGUE, { ...AUTO_CTX, turns: 'manual' }), null).setup.realtimeInputConfig.automaticActivityDetection).toEqual({ disabled: true });
    const silent = setupFrame(configFor(DIALOGUE, { ...AUTO_CTX, speech: false }), null).setup;
    expect(silent.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(silent.generationConfig).not.toHaveProperty('speechConfig');
    expect(setupFrame(configFor(DIALOGUE, AUTO_CTX, { maxTokens: 2048 }), null).setup.generationConfig.maxOutputTokens).toBe(2048);
    expect(setupFrame(configFor(DIALOGUE, AUTO_CTX, { useTemplateMode: false, systemInstructions: ' ' }), null).setup).not.toHaveProperty('systemInstruction');
    expect(setupFrame(configFor(DIALOGUE), 'handle-1').setup.sessionResumption).toEqual({ handle: 'handle-1' });
  });

  it("sends a view's own bytes, never its backing buffer's (survey §1.16.2), as 24 kHz pcm", () => {
    const view = new Int16Array([1, 2, 3, 4]).subarray(1, 3);
    const frame = JSON.parse(audioFrame(view));
    expect(frame.realtimeInput.audio.mimeType).toBe(INPUT_MIME);
    expect(INPUT_MIME).toBe('audio/pcm;rate=24000');
    expect(Array.from(base64ToPcm(frame.realtimeInput.audio.data))).toEqual([2, 3]);
  });

  it('marks activity and sends typed text as the realtime input they are', () => {
    expect(JSON.parse(ACTIVITY_START)).toEqual({ realtimeInput: { activityStart: {} } });
    expect(JSON.parse(ACTIVITY_END)).toEqual({ realtimeInput: { activityEnd: {} } });
    expect(JSON.parse(textFrame('hello'))).toEqual({ realtimeInput: { text: 'hello' } });
  });

  it('decodes a text or a binary frame at once, in the order given, and refuses anything but a JSON object (survey §1.16.4)', () => {
    expect(decodeServerMessage('{"setupComplete":{}}')).toEqual({ setupComplete: {} });
    expect(decodeServerMessage(serverFrame({ goAway: { timeLeft: '1s' } }))).toEqual({ goAway: { timeLeft: '1s' } });
    expect(() => decodeServerMessage('{bad')).toThrow();
    expect(() => decodeServerMessage('[1]')).toThrow(/not a JSON object/);
    expect(() => decodeServerMessage('3')).toThrow(/not a JSON object/);
    expect(() => decodeServerMessage(new Blob(['{}']))).toThrow(/unexpected kind/);
  });

  it('drops an odd trailing byte of model audio (survey §1.16.3), and reads the rate its mime type names, 24 000 when none', () => {
    expect(Array.from(base64ToPcm(btoa(String.fromCharCode(1, 0, 2, 0, 7))))).toEqual([1, 2]);
    expect(pcmRate('audio/pcm;rate=16000')).toBe(16000);
    expect(pcmRate('audio/pcm')).toBe(24000);
    expect(pcmRate(undefined)).toBe(24000);
  });

  it("words a close before setup by the server's reason first, then its code (choice 12)", () => {
    expect(closeFailureCode(1008, 'API key not valid. Please pass a valid API key.')).toBe('auth');
    expect(closeFailureCode(1011, 'You exceeded your current quota.')).toBe('rate_limit');
    expect(closeFailureCode(1011, 'RESOURCE_EXHAUSTED')).toBe('rate_limit');
    expect(closeFailureCode(1008, 'models/x is not found for API version v1beta')).toBe('client');
    expect(closeFailureCode(1007, 'Request contains an invalid argument.')).toBe('client');
    expect(closeFailureCode(1011, 'Internal error')).toBe('server');
    expect(closeFailureCode(1013, '')).toBe('server');
    expect(closeFailureCode(1006, '')).toBe('network');
  });
});
