// A record's recording: a track per leg from the runner's tap, pieces to the main process once a second.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVirtualClock, type VirtualClock } from '../../contract/clock';
import type { HistoryPort } from '../port';
import type { HistoryTrackPiece } from '../types';
import { createHistoryRecorder, END_WAIT_MS, FLUSH_MS, MAX_HELD_MS, type HistoryRecorder } from './recorder';
import type { OpusEncoderFactory } from './track';

const HEAD = new Uint8Array([79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 156, 0, 192, 93, 0, 0, 0, 0, 0]);
const fakeEncoder: OpusEncoderFactory = (onPacket, onHead) => {
  let held = 0;
  let head = false;
  return {
    encode(p) { if (!head) { head = true; onHead(HEAD); } held += p.length; while (held >= 480) { held -= 480; onPacket(new Uint8Array([1, 2, 3]), 960); } },
    async flush() { if (held > 0) { held = 0; onPacket(new Uint8Array([4, 5, 6]), 960); } },
    close() {},
  };
};

let clock: VirtualClock;
let pieces: HistoryTrackPiece[];
let failWrites: boolean;
let report: ReturnType<typeof vi.fn<(message: string, cause: unknown) => void>>;
let tell: ReturnType<typeof vi.fn<() => void>>;
let recorder: HistoryRecorder;
const ID = 'run-0001-aaaa';
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const chunk = () => new Int16Array(2400).fill(500); // 100 ms
/** Advances the clock in 100 ms steps, feeding a chunk to each leg that is speaking then. */
async function run(toMs: number, speaking: (now: number) => Array<'speaker' | 'participant'>) {
  while (clock.now() < toMs) {
    clock.advance(100);
    for (const leg of speaking(clock.now())) recorder.pcm(leg, chunk());
    await settle();
  }
}

beforeEach(() => {
  clock = createVirtualClock(0);
  pieces = [];
  failWrites = false;
  report = vi.fn<(message: string, cause: unknown) => void>();
  tell = vi.fn<() => void>();
  const port = {
    appendTrack: async (a: HistoryTrackPiece) => {
      if (failWrites) throw new Error('disk full');
      pieces.push(a);
      return { bytes: a.data.length };
    },
  } as unknown as HistoryPort;
  recorder = createHistoryRecorder({ port, clock, encoder: fakeEncoder, report, tell });
});

describe('a record\'s recording', () => {
  it('opens a track per leg on its first audio and appends pieces once a second', async () => {
    expect(FLUSH_MS).toBe(1000);
    recorder.begin(ID, 0);
    await run(3000, (now) => (now > 2000 ? ['speaker', 'participant'] : ['speaker']));
    const speaker = pieces.filter((p) => p.source === 'speaker');
    const participant = pieces.filter((p) => p.source === 'participant');
    expect(speaker).toHaveLength(3);
    expect(speaker.every((p) => p.offsetMs === 0)).toBe(true);
    // Each flush comes before that moment's chunk: 0.9 s, 1.9 s, 2.9 s of audio, less the pre-skip.
    expect(speaker.map((p) => p.durationMs)).toEqual([897, 1897, 2897]);
    expect(participant).toHaveLength(1);
    expect(participant[0].offsetMs).toBe(2000);
    expect(pieces.every((p) => p.recordId === ID)).toBe(true);
  });

  // Review: an encoder that fails at the very end left the recording short without a word.
  it('says the recording stopped when an encoder fails while the recording ends', async () => {
    let failAtEnd = false;
    const failingAtEnd: OpusEncoderFactory = (onPacket, onHead, onError) => {
      const inner = fakeEncoder(onPacket, onHead, onError);
      return { ...inner, flush: async () => { if (failAtEnd) throw new Error('encoder closed'); return inner.flush(); } };
    };
    const port = { appendTrack: async (a: HistoryTrackPiece) => { pieces.push(a); return { bytes: a.data.length }; } } as unknown as HistoryPort;
    recorder = createHistoryRecorder({ port, clock, encoder: failingAtEnd, report, tell });
    recorder.begin(ID, 0);
    await run(1500, () => ['speaker']);
    failAtEnd = true;
    await recorder.end(ID);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('encoder failed'), null);
    expect(tell).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing once a piece is sent', async () => {
    recorder.begin(ID, 0);
    await run(2000, () => ['speaker']);
    expect(recorder.queuedBytes()).toBe(0);
  });

  it("stops the record's recording at the first failed write and says so once", async () => {
    recorder.begin(ID, 0);
    failWrites = true;
    await run(3000, () => ['speaker', 'participant']);
    expect(tell).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    failWrites = false;
    await run(5000, () => ['speaker']);
    expect(pieces).toEqual([]);
  });

  it('end writes the last pages with the end of the stream', async () => {
    recorder.begin(ID, 0);
    await run(1500, () => ['speaker']);
    await recorder.end();
    const last = pieces[pieces.length - 1];
    let at = -1;
    for (let i = last.data.length - 4; i >= 0; i--) if (last.data[i] === 0x4f && last.data[i + 1] === 0x67 && last.data[i + 2] === 0x67 && last.data[i + 3] === 0x53) { at = i; break; }
    expect(last.data[at + 5] & 4).toBe(4);
    expect(last.durationMs).toBeGreaterThanOrEqual(1400);
  });

  it('sends no empty piece when everything was already written', async () => {
    recorder.begin(ID, 0);
    await run(900, () => ['speaker']);
    clock.advance(100);
    await settle();
    const before = pieces.length;
    await recorder.end();
    expect(pieces.slice(before).every((p) => p.data.length > 0)).toBe(true);
    expect(tell).not.toHaveBeenCalled();
  });

  it('ignores audio with no record, and audio after end', async () => {
    recorder.pcm('speaker', chunk());
    recorder.begin(ID, 0);
    await recorder.end();
    recorder.pcm('speaker', chunk());
    clock.advance(2000);
    await settle();
    expect(pieces).toEqual([]);
  });

  // Review: a failed write must still close every track's encoder, the healthy one's too.
  it('closes every track once its recording has stopped', async () => {
    let closed = 0;
    const counting: OpusEncoderFactory = (onPacket, onHead, onError) => ({ ...fakeEncoder(onPacket, onHead, onError), close() { closed += 1; } });
    const port = { appendTrack: async () => { throw new Error('disk full'); } } as unknown as HistoryPort;
    recorder = createHistoryRecorder({ port, clock, encoder: counting, report, tell });
    recorder.begin(ID, 0);
    await run(1500, () => ['speaker', 'participant']);
    expect(tell).toHaveBeenCalledTimes(1);
    expect(closed).toBe(2);
    await recorder.end();
    expect(closed).toBe(2);
  });

  // Review: a write that never answers must not let the pieces waiting behind it grow without end.
  it('stops recording, and says so, when the pieces waiting to be written pass the limit', async () => {
    const port = { appendTrack: () => new Promise(() => {}) } as unknown as HistoryPort;
    recorder = createHistoryRecorder({ port, clock, encoder: fakeEncoder, report, tell, maxQueuedBytes: 2000 });
    recorder.begin(ID, 0);
    await run(30_000, () => ['speaker', 'participant']);
    expect(tell).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('cannot keep up'), null);
    expect(recorder.queuedBytes()).toBeLessThanOrEqual(2000);
    // Stopped, it is ended at once: nothing waits on the write that never answers.
    const ended = await Promise.race([recorder.end(ID).then(() => 'ended'), new Promise((resolve) => { setTimeout(() => resolve('waiting'), 50); })]);
    expect(ended).toBe('ended');
  });

  // Review: below the limit, one write that never answers must not hold the record's end, and every record after it.
  it('ends after END_WAIT_MS when a write never answers, and says the recording stopped', async () => {
    const port = { appendTrack: () => new Promise(() => {}) } as unknown as HistoryPort;
    recorder = createHistoryRecorder({ port, clock, encoder: fakeEncoder, report, tell });
    recorder.begin(ID, 0);
    await run(1500, () => ['speaker']);
    let ended = false;
    void recorder.end(ID).then(() => { ended = true; });
    await settle();
    expect(ended).toBe(false);
    clock.advance(END_WAIT_MS);
    await settle();
    expect(ended).toBe(true);
    expect(tell).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('did not answer'), null);
  });

  // Review: the encoder's last flush can hang too; the one wait covers the whole end, the flush included.
  it('ends after END_WAIT_MS when the encoder never finishes its last audio, and says the recording stopped', async () => {
    const hanging: OpusEncoderFactory = (...args) => {
      const inner = fakeEncoder(...args);
      return { encode: (p) => inner.encode(p), flush: () => new Promise(() => {}), close() {} };
    };
    const port = { appendTrack: async (a: HistoryTrackPiece) => { pieces.push(a); return { bytes: a.data.length }; } } as unknown as HistoryPort;
    recorder = createHistoryRecorder({ port, clock, encoder: hanging, report, tell });
    recorder.begin(ID, 0);
    await run(1500, () => ['speaker']);
    let ended = false;
    void recorder.end(ID).then(() => { ended = true; });
    await settle();
    expect(ended).toBe(false);
    clock.advance(END_WAIT_MS);
    await settle();
    expect(ended).toBe(true);
    expect(tell).toHaveBeenCalledTimes(1);
  });

  // Review: a session's first audio arrives before its record exists, and while the previous record is still closing.
  describe('audio before its record exists', () => {
    // A piece carries the track's length so far.
    const msOf = (source: 'speaker' | 'participant', id = ID) => Math.max(0, ...pieces.filter((p) => p.recordId === id && p.source === source).map((p) => p.durationMs));

    // Review: past the hold, the audio was dropped without a word; the recording would silently miss its start.
    it('stops the recording, and says so, when its record is not open after MAX_HELD_MS', async () => {
      recorder.prepare(ID, 0);
      await run(MAX_HELD_MS + 1000, () => ['speaker']);
      expect(tell).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(expect.stringContaining('not opened'), null);
      recorder.begin(ID, 0);
      await run(MAX_HELD_MS + 3000, () => ['speaker']);
      await recorder.end(ID);
      expect(pieces).toEqual([]);
    });

    it('is held from where it arrived and written once the record exists', async () => {
      recorder.prepare(ID, 0);
      await run(500, () => ['speaker']);
      expect(pieces).toEqual([]);
      recorder.begin(ID, 0);
      await run(1500, () => ['speaker']);
      await recorder.end(ID);
      expect(pieces[0].offsetMs).toBe(0);
      expect(msOf('speaker')).toBeGreaterThanOrEqual(1400);
    });

    it("goes to the new record, never to the one still closing", async () => {
      const B = 'run-0002-bbbb';
      recorder.begin(ID, 0);
      await run(1000, () => ['speaker']);
      recorder.prepare(B, 1000);
      await run(2000, () => ['speaker']);
      await recorder.end(ID);
      expect(msOf('speaker')).toBeLessThanOrEqual(1000);
      recorder.begin(B, 1000);
      await run(2500, () => ['speaker']);
      await recorder.end(B);
      expect(msOf('speaker', B)).toBeGreaterThanOrEqual(1400);
      expect(pieces.filter((p) => p.recordId === B)[0].offsetMs).toBe(0);
    });

    it('is let go when the record could not be opened', async () => {
      recorder.prepare(ID, 0);
      await run(500, () => ['speaker']);
      recorder.drop(ID);
      await run(1500, () => ['speaker']);
      await recorder.end(ID);
      expect(pieces).toEqual([]);
    });
  });
});
