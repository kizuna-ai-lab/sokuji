// The import's decoder: a piece at a time when the codec can be streamed, the whole file for a short one it cannot.
import { describe, it, expect, vi } from 'vitest';
import { decodeFile, readDuration, NoAudioTrack, type MediaFile } from './decode';
import type { DecodedAudio } from './importFile';
import type { DecodedPiece } from './toPcm24k';

const file = new File([new Uint8Array(4)], 'a.m4a');
function media(o: { canStream: boolean; durationMs: number; pieces?: DecodedPiece[] }): MediaFile & { close: ReturnType<typeof vi.fn<() => void>> } {
  return {
    durationMs: o.durationMs,
    startS: 0,
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

  // Review: an MPEG-TS capture starts at an arbitrary time; its first timestamp is the file's start, not leading silence.
  it("measures the file from where its first track starts", async () => {
    const m = { ...media({ canStream: true, durationMs: 2000, pieces: [second(18000), second(18001)] }), startS: 18000 };
    const audio = await decodeFile(file, undefined, { openMedia: async () => m, decodeWholeFile: async () => whole });
    expect(audio.durationMs).toBe(2000);
    expect(await all(audio)).toBe(48000);
  });

  // Review: an encoder's priming gives the first block a negative timestamp; what lies before the start is cut, so
  // the recording starts with sound, not silence, and is as long as the file.
  it('cuts what a negative first timestamp puts before the start', async () => {
    const primed: DecodedPiece = { timestampS: -0.5, sampleRate: 24000, planes: [new Float32Array(24000).fill(0.5)] };
    const m = media({ canStream: true, durationMs: 1500, pieces: [primed, second(0.5)] });
    const audio = await decodeFile(file, undefined, { openMedia: async () => m, decodeWholeFile: async () => whole });
    const out: number[] = [];
    for await (const c of audio.pcm24k()) out.push(...c);
    expect(out.length).toBe(36000);
    expect(out[1000]).toBeGreaterThan(16000);
  });

  // Review: a timestamp that jumps far ahead in the middle must not make hours of silence (uploaded and billed).
  it('never gives more than the file is long, whatever its timestamps say', async () => {
    const m = media({ canStream: true, durationMs: 3000, pieces: [second(0), second(1), second(36000), second(2)] });
    const audio = await decodeFile(file, undefined, { openMedia: async () => m, decodeWholeFile: async () => whole });
    expect(await all(audio)).toBeLessThanOrEqual(4 * 24000);
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

describe("the file's length", () => {
  it('is 0 for a file without an audio track (a silent video), and not a number for one that cannot be read', async () => {
    expect(await readDuration(file, { openMedia: async () => { throw new NoAudioTrack(); } })).toBe(0);
    expect(await readDuration(file, { openMedia: async () => { throw new Error('not a media file'); } })).toBeNaN();
    const m = media({ canStream: true, durationMs: 1234 });
    expect(await readDuration(file, { openMedia: async () => m })).toBe(1234);
    expect(m.close).toHaveBeenCalledTimes(1);
  });
});
