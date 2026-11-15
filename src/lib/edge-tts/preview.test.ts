// An Edge voice's sample, for the line-up page's speech card: the language's preview sentence in that voice.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const report = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportError: report.error,
}));

import { previewEdgeVoice, type EdgePreviewDeps } from './preview';
import { previewSampleFor } from '../tts/previewSample';

const buffer = (samples: number[], sampleRate = 24000) =>
  ({ sampleRate, getChannelData: () => Float32Array.from(samples) }) as unknown as AudioBuffer;

function deps(over: Partial<EdgePreviewDeps> = {}): EdgePreviewDeps {
  return {
    synthesize: vi.fn(async () => new Uint8Array([1, 2, 3])),
    decode: vi.fn(async () => buffer([0.25, -0.5])),
    ...over,
  };
}

beforeEach(() => report.error.mockClear());

describe('previewEdgeVoice', () => {
  it("speaks the language's preview sentence in the voice, and plays what it decodes", async () => {
    const d = deps();
    const clip = await previewEdgeVoice('ja-JP-NanamiNeural', 'ja', undefined, d);
    expect(d.synthesize).toHaveBeenCalledWith(previewSampleFor('ja').text, 'ja-JP-NanamiNeural', undefined);
    expect(d.decode).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(clip).toEqual({ audio: Float32Array.from([0.25, -0.5]), sampleRate: 24000 });
  });

  it('plays nothing and says why when the service fails', async () => {
    const clip = await previewEdgeVoice('en-US-AvaNeural', 'en', undefined, deps({ synthesize: async () => { throw new Error('closed'); } }));
    expect(clip).toBeNull();
    expect(report.error).toHaveBeenCalledTimes(1);
    expect(String(report.error.mock.calls[0][1])).toContain('en-US-AvaNeural');
  });

  it('a preview stopped while it was made is no failure', async () => {
    const stop = new AbortController();
    const clip = await previewEdgeVoice('en-US-AvaNeural', 'en', stop.signal, deps({
      synthesize: async () => { stop.abort(); throw new Error('aborted'); },
    }));
    expect(clip).toBeNull();
    expect(report.error).not.toHaveBeenCalled();
  });
});
