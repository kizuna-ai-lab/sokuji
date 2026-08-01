import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthesizeOnce } from './SonioxTtsRest';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Response whose body is little-endian Int16 PCM of the given samples. */
const pcmBody = (samples: number[]) => {
  const dv = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((s, i) => dv.setInt16(i * 2, s, true));
  return { ok: true, status: 200, arrayBuffer: async () => dv.buffer };
};
const errBody = (status: number, body: unknown) => ({
  ok: false,
  status,
  json: async () => body,
});
const OPTS = { apiKey: 'k', voice: 'uuid-1', language: 'ja', text: 'こんにちは。' };

describe('synthesizeOnce', () => {
  it('posts every required field with a Bearer header and omits speed at 1.0', async () => {
    fetchMock.mockResolvedValueOnce(pcmBody([0]));
    await synthesizeOnce({ ...OPTS, speed: 1.0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://tts-rt.soniox.com/tts');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      model: 'tts-rt-v1',
      voice: 'uuid-1',
      language: 'ja',
      text: 'こんにちは。',
      audio_format: 'pcm_s16le',
      sample_rate: 24000,
    });
  });

  it('includes speed when it differs from the server default', async () => {
    fetchMock.mockResolvedValueOnce(pcmBody([0]));
    await synthesizeOnce({ ...OPTS, speed: 1.2 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).speed).toBe(1.2);
  });

  it('decodes little-endian Int16 PCM into normalized Float32 at 24 kHz', async () => {
    fetchMock.mockResolvedValueOnce(pcmBody([0, 16384, -16384, 32767]));
    const { audio, sampleRate } = await synthesizeOnce(OPTS);
    expect(sampleRate).toBe(24000);
    expect(Array.from(audio)).toEqual([0, 0.5, -0.5, 32767 / 32768]);
  });

  it('maps an HTTP error body to SonioxVoicesError with its error_type', async () => {
    fetchMock.mockResolvedValueOnce(errBody(401, {
      error_code: 401, error_type: 'unauthenticated', error_message: 'bad key',
    }));
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({
      errorType: 'unauthenticated', status: 401, message: 'bad key',
    });
  });

  it('rejects a zero-byte body rather than returning silent audio', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'empty_audio' });
  });

  it('does not spend a request when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(synthesizeOnce({ ...OPTS, signal: controller.signal }))
      .rejects.toMatchObject({ errorType: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an in-flight abort to errorType "aborted"', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'aborted' });
  });

  it('maps the internal deadline to errorType "timeout"', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('deadline', 'TimeoutError'));
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'timeout' });
  });

  it('normalizes transport failures to errorType "network"', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'network', status: 0 });
  });

  it('passes an AbortSignal to fetch so a cancel actually reaches the network', async () => {
    fetchMock.mockResolvedValueOnce(pcmBody([0]));
    await synthesizeOnce(OPTS);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the in-flight fetch when the caller aborts', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
      new Promise((_res, rej) =>
        init.signal!.addEventListener('abort', () => rej(init.signal!.reason))));
    const p = synthesizeOnce({ ...OPTS, signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ errorType: 'aborted' });
  });

  // `fetch()` settles as soon as response HEADERS arrive — the body streams in
  // afterwards. These two pin that cancellation stays armed across that gap:
  // headers-then-stalled-body is a real failure mode, and releasing the timer
  // and the abort forwarding at fetch-resolve time would leave the promise
  // pending forever with the preview row's spinner stuck on.
  //
  // A response whose body only settles when the request signal aborts. The
  // pre-check matters: the signal may already be aborted by the time the body
  // read starts, and `addEventListener('abort')` never fires on an
  // already-aborted signal.
  const stalledBodyResponse = (init: RequestInit) => Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => new Promise((_res, rej) => {
      if (init.signal!.aborted) { rej(init.signal!.reason); return; }
      init.signal!.addEventListener('abort', () => rej(init.signal!.reason));
    }),
  });

  it('keeps the deadline armed while the response body is read', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => stalledBodyResponse(init));
      const p = synthesizeOnce(OPTS);
      const settled = expect(p).rejects.toMatchObject({ errorType: 'timeout' });
      await vi.advanceTimersByTimeAsync(25_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('still cancels the body read when the caller aborts after headers arrive', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => stalledBodyResponse(init));
    const p = synthesizeOnce({ ...OPTS, signal: controller.signal });
    const settled = expect(p).rejects.toMatchObject({ errorType: 'aborted' });
    // Let fetch resolve and the body read begin before cancelling.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await settled;
  });

  it('classifies a caller abort as "aborted" even with a non-DOMException reason', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
      new Promise((_res, rej) =>
        init.signal!.addEventListener('abort', () => rej(init.signal!.reason))));
    const p = synthesizeOnce({ ...OPTS, signal: controller.signal });
    // A plain string reason (not a DOMException) — `opts.signal.aborted` must
    // still be enough to classify this as a cancel, not a spurious network error.
    controller.abort('switched');
    await expect(p).rejects.toMatchObject({ errorType: 'aborted' });
  });

  it('normalizes a body-read failure (connection drop mid-stream) to errorType "network"', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () => { throw new TypeError('network error reading body'); },
    });
    await expect(synthesizeOnce(OPTS)).rejects.toMatchObject({ errorType: 'network' });
  });
});
