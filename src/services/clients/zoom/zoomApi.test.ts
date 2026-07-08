import { describe, it, expect, vi, afterEach } from 'vitest';
import { encodeWavDataUri, transcribe, translate, ZoomApiError } from './zoomApi';

afterEach(() => vi.restoreAllMocks());

describe('encodeWavDataUri', () => {
  it('produces a wav data URI with a RIFF/WAVE header and correct data length', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const uri = encodeWavDataUri(samples, 16000);
    expect(uri.startsWith('data:audio/wav;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(uri.split(',')[1]), (c) => c.charCodeAt(0));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    // 44-byte header + 2 bytes/sample
    expect(bytes.length).toBe(44 + samples.length * 2);
  });
});

describe('transcribe', () => {
  it('POSTs a data-uri file + language and returns text_display', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { text_display: 'hello' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await transcribe('TOK', 'data:audio/wav;base64,AAAA', 'en-US');
    expect(out).toBe('hello');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/aiservices/scribe/transcribe');
    const body = JSON.parse(opts.body);
    expect(body.file).toBe('data:audio/wav;base64,AAAA');
    expect(body.config.language).toBe('en-US');
    expect(opts.headers.Authorization).toBe('Bearer TOK');
  });

  it('throws ZoomApiError on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403,
      text: async () => JSON.stringify({ reason: 'BILLING_SCRIBE_API_PLAN_REQUIRED', message: 'x' }),
    }));
    await expect(transcribe('T', 'data:...', 'en-US')).rejects.toMatchObject({
      status: 403, reason: 'BILLING_SCRIBE_API_PLAN_REQUIRED',
    });
  });
});

describe('translate', () => {
  it('POSTs text + config and returns translations[target]', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => JSON.stringify({ result: { translations: { 'zh-CN': '你好' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await translate('TOK', 'hello', 'en-US', 'zh-CN');
    expect(out).toBe('你好');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe('hello');
    expect(body.config.source_language).toBe('en-US');
    expect(body.config.target_languages).toEqual(['zh-CN']);
  });
});
