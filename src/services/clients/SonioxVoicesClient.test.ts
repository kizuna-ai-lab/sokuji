import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxVoicesClient, encodeWavPcm16 } from './SonioxVoicesClient';
import { SONIOX_TTS_MODEL } from '../../lib/soniox/ttsCatalog';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const err = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });
const VOICE = (over: object = {}) => ({
  id: 'v-1', name: 'My Voice',
  models: [{ model: SONIOX_TTS_MODEL, status: 'processing', error_type: null, error_message: null }],
  ...over,
});

describe('SonioxVoicesClient', () => {
  it('lists voices with auth header and follows pagination cursors', async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ voices: [VOICE({ id: 'a' })], next_page_cursor: 'c2' }))
      .mockResolvedValueOnce(ok({ voices: [VOICE({ id: 'b' })], next_page_cursor: null }));
    const voices = await new SonioxVoicesClient('key-1').list();
    expect(voices.map((v) => v.id)).toEqual(['a', 'b']);
    const [url1, init1] = fetchMock.mock.calls[0];
    expect(String(url1)).toContain('https://api.soniox.com/v1/voices');
    expect(String(url1)).toContain('limit=1000');
    expect((init1.headers as Record<string, string>).Authorization).toBe('Bearer key-1');
    expect(String(fetchMock.mock.calls[1][0])).toContain('cursor=c2');
  });

  it('creates via multipart with exactly name + file and surfaces the created voice', async () => {
    fetchMock.mockResolvedValueOnce(ok(VOICE()));
    const blob = new Blob(['x'], { type: 'audio/wav' });
    const voice = await new SonioxVoicesClient('k').create('My Voice', blob, 'ref.wav');
    expect(voice.id).toBe('v-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('name')).toBe('My Voice');
    expect((form.get('file') as File).name).toBe('ref.wav');
    expect([...form.keys()].sort()).toEqual(['file', 'name']);
  });

  it('maps API errors to SonioxVoicesError with error_type', async () => {
    fetchMock.mockResolvedValueOnce(err(409, { error_type: 'voice_name_conflict', message: 'dup' }));
    await expect(new SonioxVoicesClient('k').create('x', new Blob(['y'])))
      .rejects.toMatchObject({ errorType: 'voice_name_conflict', status: 409 });
  });

  it('delete tolerates 404 and rejects other failures', async () => {
    fetchMock.mockResolvedValueOnce(err(404, { error_type: 'voice_not_found', message: 'gone' }));
    await expect(new SonioxVoicesClient('k').delete('v-x')).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(err(500, { error_type: 'internal_error', message: 'boom' }));
    await expect(new SonioxVoicesClient('k').delete('v-x'))
      .rejects.toMatchObject({ errorType: 'internal_error' });
  });

  it('waitUntilReady polls until ready', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(VOICE()))
      .mockResolvedValueOnce(ok(VOICE({ models: [{ model: SONIOX_TTS_MODEL, status: 'ready' }] })));
    const p = new SonioxVoicesClient('k').waitUntilReady('v-1', { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(250);
    await expect(p).resolves.toMatchObject({ id: 'v-1' });
  });

  it('waitUntilReady rejects terminally on failed (no retry) and on timeout', async () => {
    fetchMock.mockResolvedValueOnce(ok(VOICE({ models: [{ model: SONIOX_TTS_MODEL, status: 'failed', error_message: 'bad clip' }] })));
    await expect(new SonioxVoicesClient('k').waitUntilReady('v-1'))
      .rejects.toMatchObject({ errorType: 'voice_failed' });

    fetchMock.mockResolvedValue(ok(VOICE())); // forever processing
    const p = new SonioxVoicesClient('k').waitUntilReady('v-2', { timeoutMs: 500, intervalMs: 100 });
    const assertion = expect(p).rejects.toMatchObject({ errorType: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});

describe('encodeWavPcm16', () => {
  // Helper: read Blob bytes via FileReader.readAsArrayBuffer (jsdom Blob lacks arrayBuffer())
  function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  it('produces a valid RIFF/WAVE mono 16-bit header and round-trips samples', async () => {
    vi.useRealTimers();  // FileReader needs real timers
    try {
      const samples = new Float32Array([0, 0.5, -0.5, 1, -1, -0.9999]);
      const blob = encodeWavPcm16(samples, 24000);
      expect(blob.type).toBe('audio/wav');
      expect(blob.size).toBe(44 + samples.length * 2);
      const arrayBuffer = await readBlobAsArrayBuffer(blob);
      const buf = new Uint8Array(arrayBuffer);
      const dv = new DataView(buf.buffer);
      expect(String.fromCharCode(...buf.slice(0, 4))).toBe('RIFF');
      expect(String.fromCharCode(...buf.slice(8, 12))).toBe('WAVE');
      expect(dv.getUint16(22, true)).toBe(1);            // mono
      expect(dv.getUint32(24, true)).toBe(24000);        // sample rate
      expect(dv.getUint16(34, true)).toBe(16);           // bit depth
      expect(dv.getUint32(40, true)).toBe(samples.length * 2);
      expect(dv.getInt16(44, true)).toBe(0);
      expect(dv.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff));
      expect(dv.getInt16(50, true)).toBe(0x7fff);        // +1 clamps to max
      expect(dv.getInt16(52, true)).toBe(-0x8000);       // -1 maps to min
      // Fractional negative must ROUND (to -32765), not truncate toward zero
      // (-32764): DataView.setInt16 truncates non-integers, so the encoder
      // has to round the negative branch itself.
      expect(dv.getInt16(54, true)).toBe(Math.round(-0.9999 * 0x8000));
    } finally {
      vi.useFakeTimers();  // Restore for other tests in afterEach
    }
  });
});
