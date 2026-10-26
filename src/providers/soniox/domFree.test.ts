// @vitest-environment node
import { describe, it, expect } from 'vitest';

// The mobile app imports these modules through Metro. They must load and run
// where there is no window/document — the phone's JS runtime is not a browser.
describe('Soniox wire modules without a DOM', () => {
  it('runs in an environment with no window', () => {
    expect(typeof window).toBe('undefined');
  });

  it('imports the lease client and the model constant', async () => {
    const { createKizunaLease } = await import('./lease');
    const { SONIOX_STT_MODEL } = await import('./model');
    expect(typeof createKizunaLease({ apiUrl: () => 'https://example.test/api' })).toBe('function');
    expect(SONIOX_STT_MODEL).toBe('stt-rt-v5');
  });

  it('imports and opens a stream through an injected socket', async () => {
    const { SonioxSttStream } = await import('./sttStream');
    const { sonioxHosts } = await import('../../lib/soniox/regions');
    const opened: Array<{ url: string; protocols: string[] }> = [];
    const fake = { readyState: 1, send() {}, close() {} } as unknown as WebSocket;
    const stream = new SonioxSttStream({
      openSocket: (url, protocols) => {
        opened.push({ url, protocols });
        queueMicrotask(() => fake.onopen?.(new Event('open')));
        return fake;
      },
    });
    await stream.connect({
      apiKey: 'snx_temp_test',
      region: 'us',
      model: 'stt-rt-v5',
      sampleRate: 16000,
      translation: { type: 'one_way', target_language: 'zh' },
    });
    expect(opened[0].url).toBe(`wss://${sonioxHosts('us').sttRt}/transcribe-websocket`);
    expect(opened[0].protocols).toEqual(['soniox-api-key', 'snx_temp_test']);
    stream.close();
  });
});
