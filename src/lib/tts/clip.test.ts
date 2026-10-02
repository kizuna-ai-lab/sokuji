import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportError,
}));

import { previewClip, type ClipDeps } from './clip';

const URL = 'https://cdn.example.com/voices/marin.flac';
const decoded = { audio: new Float32Array([0.1, -0.2, 0.3]), sampleRate: 48000 };

function deps(response: Partial<Response> | Error): ClipDeps & { calls: string[]; decoded: ArrayBuffer[] } {
  const calls: string[] = [];
  const bytes: ArrayBuffer[] = [];
  return {
    calls,
    decoded: bytes,
    fetch: (async (url: string) => {
      calls.push(url);
      if (response instanceof Error) throw response;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), ...response } as Response;
    }) as unknown as typeof fetch,
    decode: async (b) => { bytes.push(b); return decoded; },
  };
}

beforeEach(() => reportError.mockClear());

describe("previewClip: a vendor's published sample, fetched and decoded", () => {
  it('fetches the url and returns the decoded samples', async () => {
    const d = deps({});
    expect(await previewClip({ url: URL, name: 'Marin', scope: 'RealtimePreview' }, undefined, d)).toBe(decoded);
    expect(d.calls).toEqual([URL]);
    expect(d.decoded).toHaveLength(1);
  });

  it('reports a failed download once, naming the voice, and returns null: the voice library swallows a rejection', async () => {
    expect(await previewClip({ url: URL, name: 'Marin', scope: 'RealtimePreview' }, undefined, deps({ ok: false, status: 404 }))).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toBe('RealtimePreview');
    expect(reportError.mock.calls[0][1]).toMatch(/Marin.*HTTP 404/);
  });

  it('reports a clip that will not decode', async () => {
    const d = deps({});
    d.decode = async () => { throw new Error('EncodingError'); };
    expect(await previewClip({ url: URL, name: 'Marin', scope: 'RealtimePreview' }, undefined, d)).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('does not report a preview the user stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    const stopped = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(await previewClip({ url: URL, name: 'Marin', scope: 'RealtimePreview' }, controller.signal, deps(stopped))).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });
});
