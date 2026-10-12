import { describe, it, expect, vi, afterEach } from 'vitest';
import { SYNTHESIS_ENDPOINTS, buildSynthesisUrl, fetchVoiceList } from './edgeTts';

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const GEC = 'A'.repeat(64);
const CONNECTION = 'c0ffee';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Edge TTS synthesis endpoints (rany2/edge-tts#490)', () => {
  it('tries api.msedgeservices.com first and speech.platform.bing.com second', () => {
    expect(SYNTHESIS_ENDPOINTS.map((e) => e.host)).toEqual(['api.msedgeservices.com', 'speech.platform.bing.com']);
  });

  it('synthesizes on api.msedgeservices.com with the legacy token, also given as Ocp-Apim-Subscription-Key', () => {
    const url = new URL(buildSynthesisUrl(SYNTHESIS_ENDPOINTS[0], GEC, CONNECTION));
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      TrustedClientToken: TOKEN,
      'Sec-MS-GEC': GEC,
      'Sec-MS-GEC-Version': '1-143.0.3650.75',
      ConnectionId: CONNECTION,
      'Ocp-Apim-Subscription-Key': TOKEN,
    });
  });

  it('falls back to the readaloud socket on speech.platform.bing.com with its four parameters alone', () => {
    const url = new URL(buildSynthesisUrl(SYNTHESIS_ENDPOINTS[1], GEC, CONNECTION));
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      TrustedClientToken: TOKEN,
      'Sec-MS-GEC': GEC,
      'Sec-MS-GEC-Version': '1-143.0.3650.75',
      ConnectionId: CONNECTION,
    });
  });
});

describe('Edge TTS voice list', () => {
  it('still reads the voice list from speech.platform.bing.com', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200, headers: { date: new Date().toUTCString() } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVoiceList()).resolves.toEqual([]);

    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list');
    expect(url.searchParams.get('trustedclienttoken')).toBe(TOKEN);
    expect(url.searchParams.get('Sec-MS-GEC')).toMatch(/^[0-9A-F]{64}$/);
    expect(url.searchParams.get('Sec-MS-GEC-Version')).toBe('1-143.0.3650.75');
  });
});
