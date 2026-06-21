import { describe, it, expect, vi } from 'vitest';
import { LocalNativeClient } from './LocalNativeClient';

function mocks() {
  const asr: any = {
    onResult: null, onSpeechStart: null, onStatus: null, onError: null,
    init: vi.fn().mockResolvedValue({ loadTimeMs: 1 }), feedAudio: vi.fn(), flush: vi.fn(), dispose: vi.fn(),
  };
  const translate: any = {
    onError: null, init: vi.fn().mockResolvedValue({ loadTimeMs: 1 }),
    translate: vi.fn().mockResolvedValue({ sourceText: 'hola', translatedText: 'hello', inferenceTimeMs: 2 }),
    dispose: vi.fn(),
  };
  const tts: any = { onError: null, init: vi.fn(), generate: vi.fn(), dispose: vi.fn() };
  return { asr, translate, tts };
}

describe('LocalNativeClient', () => {
  it('connects and runs ASR→translation, emitting user + assistant items', async () => {
    const m = mocks();
    const c = new LocalNativeClient(m);
    const items: any[] = [];
    c.setEventHandlers({ onConversationUpdated: ({ item }) => items.push({ role: item.role, status: item.status, text: item.formatted?.transcript }) });
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en',
      asrModelId: 'sense-voice', translationModelId: 'opus-mt-es-en',
    } as any);
    expect(m.asr.init).toHaveBeenCalled();
    expect(m.translate.init).toHaveBeenCalledWith('es', 'en', 'opus-mt-es-en');

    await m.asr.onResult({ text: 'hola', durationMs: 100, recognitionTimeMs: 5 });
    await new Promise((r) => setTimeout(r, 0));

    const roles = items.map((i) => i.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const assistant = [...items].reverse().find((i) => i.role === 'assistant');
    expect(assistant.text).toBe('hello');
    expect(assistant.status).toBe('completed');
  });

  it('emits an audio delta when a non-cloning TTS model is configured', async () => {
    const m = mocks();
    m.tts.init = vi.fn().mockResolvedValue({ sampleRate: 16000, loadTimeMs: 1 });
    m.tts.generate = vi.fn().mockResolvedValue({ samples: new Float32Array(16000), sampleRate: 16000, generationTimeMs: 9 });
    const c = new LocalNativeClient(m);
    const deltas: any[] = [];
    c.setEventHandlers({ onConversationUpdated: ({ item, delta }) => { if (delta?.audio) deltas.push({ role: item.role, len: delta.audio.length }); } });
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'en', targetLanguage: 'en',
      asrModelId: 'sense-voice', ttsModelId: 'piper-en-amy',
    } as any);
    expect(m.tts.init).toHaveBeenCalledWith('piper-en-amy');
    await m.asr.onResult({ text: 'hi', durationMs: 10, recognitionTimeMs: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(deltas.length).toBe(1);
    expect(deltas[0].role).toBe('assistant');
    expect(deltas[0].len).toBe(24000); // 16k resampled to 24k
  });

  it('feedAudio forwards to the ASR client', async () => {
    const m = mocks();
    const c = new LocalNativeClient(m);
    await c.connect({
      provider: 'local_native', model: 'native', sourceLanguage: 'es', targetLanguage: 'en', asrModelId: 'sense-voice',
    } as any);
    const buf = new Int16Array(10);
    c.appendInputAudio(buf);
    expect(m.asr.feedAudio).toHaveBeenCalledWith(buf, 24000);
  });
});
