import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/diagnostics/report')>()),
  reportError,
}));

import { clearPreviewCache } from '../../lib/tts/previewCache';
import { PREVIEW_SAMPLES } from '../../lib/tts/previewSample';
import { GEMINI_TTS_URL, PREVIEW_TIMEOUT_MS, previewGeminiVoice, type GeminiPreviewDeps } from './preview';

const decoded = { audio: new Float32Array([0.25, -0.25]), sampleRate: 48000 };
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

interface Call { url: string; init: RequestInit }

function deps(answer: { status?: number; body?: unknown } | Error | 'hang' = { body: audioBody('audio/wav', WAV) }) {
  const calls: Call[] = [];
  const decodedBytes: ArrayBuffer[] = [];
  let fire: (() => void) | undefined;
  const d: GeminiPreviewDeps = {
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (answer === 'hang') {
        return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      }
      if (answer instanceof Error) throw answer;
      const status = answer.status ?? 200;
      return { ok: status >= 200 && status < 300, status, json: async () => answer.body } as Response;
    }) as unknown as typeof fetch,
    decode: async (bytes) => { decodedBytes.push(bytes); return decoded; },
    clock: { setTimeout: (fn: () => void) => { fire = fn; return () => { fire = undefined; }; } },
  };
  return { d, calls, decodedBytes, elapse: () => fire?.() };
}

function audioBody(mimeType: string, bytes: Uint8Array) {
  return { candidates: [{ content: { parts: [{ inlineData: { mimeType, data: base64(bytes) } }] } }] };
}

beforeEach(() => {
  reportError.mockClear();
  clearPreviewCache();
});

describe("previewGeminiVoice: one sentence synthesized with the user's own key (preset voice preview)", () => {
  it("asks Gemini's TTS model to read the target's sentence in the voice, with the key in the header", async () => {
    const { d, calls, decodedBytes } = deps();
    expect(await previewGeminiVoice({ voice: 'Puck', target: 'ja', apiKey: 'k-1' }, undefined, d)).toBe(decoded);
    expect(GEMINI_TTS_URL).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GEMINI_TTS_URL);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ 'x-goog-api-key': 'k-1', 'Content-Type': 'application/json' });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      contents: [{ role: 'user', parts: [{ text: PREVIEW_SAMPLES.ja }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Puck' } } },
    });
    // A unary request answers a whole WAV, which the browser decodes.
    expect(new Uint8Array(decodedBytes[0])).toEqual(WAV);
  });

  it("reads a regional target's sentence by its language, and English where the table has none", async () => {
    const pt = deps();
    await previewGeminiVoice({ voice: 'Kore', target: 'pt-BR', apiKey: 'k' }, undefined, pt.d);
    expect(JSON.parse(pt.calls[0].init.body as string).contents[0].parts[0].text).toBe(PREVIEW_SAMPLES.pt);
    const yo = deps();
    await previewGeminiVoice({ voice: 'Kore', target: 'yo', apiKey: 'k' }, undefined, yo.d);
    expect(JSON.parse(yo.calls[0].init.body as string).contents[0].parts[0].text).toBe(PREVIEW_SAMPLES.en);
  });

  it('turns headerless 16-bit PCM (an older model, or AUDIO_L16) into samples at its own rate', async () => {
    const pcm = new Uint8Array(new Int16Array([0, 16384, -32768]).buffer);
    const { d, decodedBytes } = deps({ body: audioBody('audio/L16;codec=pcm;rate=24000', pcm) });
    const clip = await previewGeminiVoice({ voice: 'Puck', target: 'en', apiKey: 'k' }, undefined, d);
    expect(decodedBytes).toHaveLength(0);
    expect(clip?.sampleRate).toBe(24000);
    expect(Array.from(clip!.audio)).toEqual([0, 0.5, -1]);
  });

  it('plays a sentence heard before from the cache: a second listen costs nothing', async () => {
    const { d, calls } = deps();
    await previewGeminiVoice({ voice: 'Puck', target: 'en', apiKey: 'k' }, undefined, d);
    expect(await previewGeminiVoice({ voice: 'Puck', target: 'en-US', apiKey: 'k' }, undefined, d)).toBe(decoded);
    expect(calls).toHaveLength(1);
    await previewGeminiVoice({ voice: 'Kore', target: 'en', apiKey: 'k' }, undefined, d);
    expect(calls).toHaveLength(2);
  });

  it("reports Google's own sentence for a refused request, once, and returns null", async () => {
    const { d } = deps({ status: 429, body: { error: { message: 'Resource has been exhausted (e.g. check quota).' } } });
    expect(await previewGeminiVoice({ voice: 'Puck', target: 'en', apiKey: 'k' }, undefined, d)).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toBe('GeminiPreview');
    expect(reportError.mock.calls[0][1]).toMatch(/Puck.*HTTP 429.*Resource has been exhausted/);
  });

  it('reports an answer that carries no audio', async () => {
    const { d } = deps({ body: { candidates: [{ content: { parts: [{ text: 'no' }] } }] } });
    expect(await previewGeminiVoice({ voice: 'Puck', target: 'en', apiKey: 'k' }, undefined, d)).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][1]).toMatch(/no audio/);
  });

  it('gives up on a request that does not answer in time, and says so', async () => {
    const { d, elapse } = deps('hang');
    const pending = previewGeminiVoice({ voice: 'Puck', target: 'en', apiKey: 'k' }, undefined, d);
    elapse();
    expect(await pending).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][1]).toContain(`${PREVIEW_TIMEOUT_MS / 1000} s`);
  });

  it('does not report, or cache, a preview the user stopped', async () => {
    const { d, calls } = deps('hang');
    const controller = new AbortController();
    const pending = previewGeminiVoice({ voice: 'Puck', target: 'en', apiKey: 'k' }, controller.signal, d);
    controller.abort();
    expect(await pending).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});
