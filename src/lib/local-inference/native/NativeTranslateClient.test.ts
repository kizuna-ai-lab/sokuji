// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NativeTranslateClient } from './NativeTranslateClient';
import { FakeSidecarConnection } from './fakeSidecarConnection';

describe('NativeTranslateClient', () => {
  it('init() sends translate_init with the init timeout and returns the resolved plan', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTranslateClient(conn);
    const p = c.init('en', 'ja', 'qwen2.5-0.5b', 'cuda', 'sense-voice', null, 'q8');
    const sent = conn.sent[0];
    expect(sent).toMatchObject({ type: 'translate_init', sourceLang: 'en', targetLang: 'ja', model: 'qwen2.5-0.5b', device: 'cuda', asrModel: 'sense-voice', variant: 'q8' });
    conn.emit({ type: 'ready', id: sent.id, loadTimeMs: 7, backend: 'llamacpp_qwen', device: 'cuda', computeType: 'q8', tokensPerSec: 42 });
    await expect(p).resolves.toMatchObject({ loadTimeMs: 7, device: 'cuda', tokensPerSec: 42 });
  });

  it('translate() returns the sidecar TranslationResult', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTranslateClient(conn);
    const p = c.translate('hello', 'be terse', true);
    const sent = conn.sent[0];
    expect(sent).toMatchObject({ type: 'translate', text: 'hello', systemPrompt: 'be terse', wrapTranscript: true });
    conn.emit({ type: 'translation', id: sent.id, sourceText: 'hello', translatedText: 'こんにちは', inferenceTimeMs: 12 });
    await expect(p).resolves.toEqual({ sourceText: 'hello', translatedText: 'こんにちは', inferenceTimeMs: 12 });
  });

  it('translate() rejects on an error reply', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTranslateClient(conn);
    const p = c.translate('x');
    conn.emit({ type: 'error', id: conn.sent[0].id, message: 'boom' });
    await expect(p).rejects.toThrow('boom');
  });

  it('dispose() rejects an unsettled request', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTranslateClient(conn);
    const p = c.translate('x');
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
    expect(conn.disposed).toBe(true);
  });
});
