import { describe, it, expect } from 'vitest';
import {
  appendFrame, base64ToPcm, COMMIT, decodeServerEvent, errorCode, errorOf, errorWords, FINISH, imageFrame, qwenHeaders, sessionUpdate, socketUrl,
} from './wire';
import { SERVER } from './testing';

const MODEL = 'qwen3.8-livetranslate-flash-realtime';
const preset = { target: 'en', speech: true, voice: { kind: 'preset' as const, name: 'Tina' }, manual: false, phrases: {}, silenceMs: null };
const INPUT = { format: { type: 'pcm', sample_rate: 24000 } };

describe("Qwen LiveTranslate's wire (spec §6)", () => {
  it('dials each endpoint with the model in the query and nothing else', () => {
    expect(socketUrl('intl', MODEL)).toBe('wss://maas.qwencloudapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
    expect(socketUrl('cn', MODEL)).toBe('wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime');
  });

  it('carries the key in the upgrade header alone (D3)', () => {
    expect(qwenHeaders({ apiKey: 'sk-ws-T.ABCDEFGH' })).toEqual({ set: { Authorization: 'Bearer sk-ws-T.ABCDEFGH' } });
  });

  it('asks a speaking leg for text and audio in its preset, at 24 kHz in, with server turns', () => {
    expect(sessionUpdate(preset, { video: false })).toEqual({
      type: 'session.update',
      session: { output_modalities: ['text', 'audio'], translation: { language: 'en' }, audio: { input: INPUT, output: { voice: 'Tina' } } },
    });
  });

  it('declares video beside audio only when asked, as the first key of the session', () => {
    expect(sessionUpdate(preset, { video: true }).session.input_modalities).toEqual(['audio', 'video']);
    expect('input_modalities' in sessionUpdate(preset, { video: false }).session).toBe(false);
    expect(Object.keys(sessionUpdate(preset, { video: true }).session)[0]).toBe('input_modalities');
  });

  it('frames an image as base64 under input_image_buffer.append', () => {
    expect(JSON.parse(imageFrame(new Uint8Array([255, 216, 255])))).toEqual({ type: 'input_image_buffer.append', image: '/9j/' });
  });

  it('frames a frame the size of a screenshot without overflowing the stack, byte for byte', () => {
    const jpeg = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256);
    const image = (JSON.parse(imageFrame(jpeg)) as { image: string }).image;
    const back = Uint8Array.from(atob(image), (c) => c.charCodeAt(0));
    expect(back).toEqual(jpeg);
  });

  it('turns server turn detection off under push-to-talk', () => {
    expect(sessionUpdate({ ...preset, manual: true }, { video: false }).session.audio.input).toEqual({ ...INPUT, turn_detection: null });
  });

  it('clones the speaker on every turn: the voice "default", cloning on, always', () => {
    expect(sessionUpdate({ ...preset, voice: { kind: 'clone', frequency: 'always' } }, { video: false }).session).toEqual({
      output_modalities: ['text', 'audio'],
      translation: { language: 'en' },
      audio: { input: INPUT, output: { voice: 'default' } },
      enable_voice_clone: true,
      voice_clone_options: { frequency: 'always' },
    });
  });

  it('clones the first speaker once and keeps that voice: frequency once', () => {
    expect(sessionUpdate({ ...preset, voice: { kind: 'clone', frequency: 'once' } }, { video: false }).session).toMatchObject({
      audio: { output: { voice: 'default' } }, enable_voice_clone: true, voice_clone_options: { frequency: 'once' },
    });
  });

  it('sends the hotwords as the corpus, and no corpus without them', () => {
    expect(sessionUpdate({ ...preset, phrases: { '实时翻译': 'LiveTranslate' } }, { video: false }).session.translation).toEqual({ language: 'en', corpus: { phrases: { '实时翻译': 'LiveTranslate' } } });
    expect(sessionUpdate(preset, { video: false }).session.translation).toEqual({ language: 'en' });
  });

  it('sends a pause as speaker detection with that silence; push-to-talk stays without server turns', () => {
    expect(sessionUpdate({ ...preset, silenceMs: 1000 }, { video: false }).session.audio.input).toEqual({ ...INPUT, turn_detection: { type: 'speaker_detection', silence_duration_ms: 1000 } });
    expect(sessionUpdate({ ...preset, manual: true, silenceMs: 1000 }, { video: false }).session.audio.input).toEqual({ ...INPUT, turn_detection: null });
  });

  it('asks a leg that does not speak for text alone: no output, no cloning, whatever voice is chosen', () => {
    for (const voice of [preset.voice, { kind: 'clone' as const, frequency: 'always' as const }, { kind: 'clone' as const, frequency: 'once' as const }]) {
      expect(sessionUpdate({ ...preset, speech: false, voice }, { video: false }).session).toEqual({ output_modalities: ['text'], translation: { language: 'en' }, audio: { input: INPUT } });
    }
    expect(sessionUpdate({ ...preset, speech: false, manual: true }, { video: false }).session.audio).toEqual({ input: { ...INPUT, turn_detection: null } });
  });

  it('sends preset names verbatim, spaces and diacritics included', () => {
    expect(sessionUpdate({ ...preset, voice: { kind: 'preset', name: 'Liora Mira' } }, { video: false }).session.audio.output).toEqual({ voice: 'Liora Mira' });
    expect(sessionUpdate({ ...preset, voice: { kind: 'preset', name: 'Eliška' } }, { video: false }).session.audio.output).toEqual({ voice: 'Eliška' });
  });

  it('appends pcm as base64, as it came', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    const frame = JSON.parse(appendFrame(pcm)) as { type: string; audio: string };
    expect(frame.type).toBe('input_audio_buffer.append');
    expect(Array.from(base64ToPcm(frame.audio))).toEqual(Array.from(pcm));
    expect([COMMIT, FINISH]).toEqual([{ type: 'input_audio_buffer.commit' }, { type: 'session.finish' }]);
  });

  it('reads a text frame with a type, and refuses anything else', () => {
    expect(decodeServerEvent('{"type":"session.created","session":{}}')).toEqual({ type: 'session.created', session: {} });
    expect(() => decodeServerEvent(new ArrayBuffer(2))).toThrow('Qwen sent a binary frame where JSON text was expected.');
    expect(() => decodeServerEvent('not json')).toThrow();
    expect(() => decodeServerEvent('{"event_id":"e"}')).toThrow('Qwen sent a frame with no type.');
    expect(() => decodeServerEvent('null')).toThrow('Qwen sent a frame with no type.');
  });

  it('reads the refusal Qwen sends with no type, a code and words, as an error', () => {
    expect(decodeServerEvent(SERVER.denied())).toEqual({
      type: 'error', error: { code: 'AccessDenied.Unpurchased', message: 'Access to model denied. Please make sure you are eligible for using the model.' },
    });
    expect(() => decodeServerEvent('{"code":"AccessDenied.Unpurchased"}')).toThrow('Qwen sent a frame with no type.');
  });

  it("words an error in Qwen's own words with its code, clipped", () => {
    const voice = errorOf(decodeServerEvent(JSON.stringify({ type: 'error', error: { code: 'COMMON_ERROR', message: "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported." } })));
    expect(voice).toEqual({ code: 'COMMON_ERROR', message: "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported." });
    expect(errorWords(voice)).toBe("[Qwen COMMON_ERROR] <400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.");
    expect(errorWords({ code: null, message: null })).toBe('[Qwen] Qwen reported an error without words.');
    expect(errorWords({ code: null, message: 'x'.repeat(400) })).toBe(`[Qwen] ${'x'.repeat(300)}…`);
    expect(errorOf({ type: 'error' })).toEqual({ code: null, message: null });
  });

  it('files each error under the code the user can act on', () => {
    const code = (c: string | null, m: string) => errorCode({ code: c, message: m });
    expect(code('InvalidApiKey', 'Invalid API-key provided.')).toBe('auth');
    expect(code(null, 'API Token is expired.')).toBe('auth');
    expect(code('Throttling', 'Requests rate limit exceeded, please try again later.')).toBe('rate_limit');
    expect(code(null, 'Allocated quota exceeded, please increase your quota limit.')).toBe('rate_limit');
    expect(code('COMMON_ERROR', "<400> InternalError.Algo.InvalidParameter: Voice 'X' is not supported.")).toBe('client');
    expect(code('invalid_value', 'Invalid translation parameter.')).toBe('client');
    // A close's reason carries the message without its code.
    expect(code(null, 'Invalid translation parameter.')).toBe('client');
    expect(code(null, 'Internal error')).toBe('server');
    // The key is good; its account has not enabled the model in the key's region.
    expect(code('AccessDenied.Unpurchased', 'Access to model denied. Please make sure you are eligible for using the model.')).toBe('model_access_denied');
  });
});
