// The import's decoder: a piece at a time when the codec can be streamed, the whole file for a short one it cannot.
import { describe, it, expect, vi } from 'vitest';
import { decodeFile, type MediaFile } from './decode';
import type { DecodedAudio } from './importFile';
import type { DecodedPiece } from './toPcm24k';

const file = new File([new Uint8Array(4)], 'a.m4a');
function media(o: { canStream: boolean; durationMs: number; pieces?: DecodedPiece[] }): MediaFile & { close: ReturnType<typeof vi.fn<() => void>> } {
  return {
    durationMs: o.durationMs,
    canStream: o.canStream,
    async *pieces(signal?: AbortSignal) { for (const p of o.pieces ?? []) { if (signal?.aborted) return; yield p; } },
    close: vi.fn<() => void>(),
  };
}
const whole: DecodedAudio = { durationMs: 1, async *pcm24k() { yield new Int16Array([7]); } };
async function all(audio: DecodedAudio): Promise<number> {
  let n = 0;
  for await (const c of audio.pcm24k()) n += c.length;
  return n;
}
const second = (ts: number): DecodedPiece => ({ timestampS: ts, sampleRate: 24000, planes: [new Float32Array(24000).fill(0.5)] });

describe("the import's decoder", () => {
  it('streams when the codec can be decoded', async () => {
    const m = media({ canStream: true, durationMs: 2000, pieces: [second(0), second(1)] });
    const decodeWholeFile = vi.fn(async () => whole);
    const audio = await decodeFile(file, undefined, { openMedia: async () => m, decodeWholeFile });
    expect(audio.durationMs).toBe(2000);
    expect(await all(audio)).toBe(48000);
    expect(decodeWholeFile).not.toHaveBeenCalled();
  });

  it('falls back to the whole-file decoder for a short file it cannot stream', async () => {
    const m = media({ canStream: false, durationMs: 59 * 60_000 });
    const decodeWholeFile = vi.fn(async () => whole);
    const audio = await decodeFile(file, undefined, { openMedia: async () => m, decodeWholeFile });
    expect(audio).toBe(whole);
    expect(decodeWholeFile).toHaveBeenCalledTimes(1);
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it('refuses a long file it cannot stream', async () => {
    const m = media({ canStream: false, durationMs: 61 * 60_000 });
    const decodeWholeFile = vi.fn(async () => whole);
    await expect(decodeFile(file, undefined, { openMedia: async () => m, decodeWholeFile })).rejects.toThrow();
    expect(decodeWholeFile).not.toHaveBeenCalled();
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it('closes the media when the iteration ends or is cancelled', async () => {
    const ended = media({ canStream: true, durationMs: 2000, pieces: [second(0), second(1)] });
    await all(await decodeFile(file, undefined, { openMedia: async () => ended, decodeWholeFile: async () => whole }));
    expect(ended.close).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const long = media({ canStream: true, durationMs: 60_000, pieces: Array.from({ length: 60 }, (_, i) => second(i)) });
    const audio = await decodeFile(file, controller.signal, { openMedia: async () => long, decodeWholeFile: async () => whole });
    for await (const _ of audio.pcm24k()) controller.abort();
    expect(long.close).toHaveBeenCalledTimes(1);
  });
});
