import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/diagnostics/report')>()),
  reportError,
}));

import { previewVoice, type PreviewDeps } from './preview';
import { voicesFor } from './catalog';

const HARMONY = 'zh_male_jingqiangkanye_moon_bigtts';
const samples = new Float32Array([0.1, -0.2, 0.3]);
const decoded = { sampleRate: 24000, getChannelData: () => samples } as unknown as AudioBuffer;

function deps(response: Partial<Response> | Error): PreviewDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: (async (url: string) => {
      calls.push(url);
      if (response instanceof Error) throw response;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8), ...response } as Response;
    }) as unknown as typeof fetch,
    decode: async () => decoded,
  };
}

beforeEach(() => reportError.mockClear());

describe('previewVoice (#577 catalog §4)', () => {
  it("fetches the voice's sample for the target's persona and returns its samples", async () => {
    const d = deps({});
    const clip = await previewVoice(HARMONY, 'en', undefined, d);
    expect(d.calls).toEqual([voicesFor('en').find((v) => v.id === HARMONY)!.previewUrl]);
    expect(d.calls[0]).toMatch(/\/Harmony\.mp3$/);
    expect(clip).toEqual({ audio: samples, sampleRate: 24000 });
    expect(clip!.audio).not.toBe(samples);
  });

  it('returns null without fetching for a voice the target does not list', async () => {
    const d = deps({});
    expect(await previewVoice('nope_bigtts', 'en', undefined, d)).toBeNull();
    expect(d.calls).toEqual([]);
  });

  it('reports a failed download once and returns null, since the library swallows a rejection', async () => {
    expect(await previewVoice(HARMONY, 'en', undefined, deps({ ok: false, status: 404 }))).toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][1]).toMatch(/Harmony.*HTTP 404/);
  });

  it('does not report a preview the user stopped (Review Focus)', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await previewVoice(HARMONY, 'en', controller.signal, deps(Object.assign(new Error('aborted'), { name: 'AbortError' })))).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });
});
