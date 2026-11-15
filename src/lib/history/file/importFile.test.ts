// An audio or video file becomes a History record: its recording first, then its transcript, then closed.
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../contract/clock';
import { HistoryUnavailable, type HistoryPort } from '../port';
import type { OpusEncoderFactory } from '../recording/track';
import type { HistoryRecognizeRequest, SonioxFileToken } from '../types';
import { importFile, ImportError, MAX_IMPORT_BYTES, MAX_IMPORT_MS, type DecodedAudio } from './importFile';

const HEAD = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1, 0x38, 0x01, 0xc0, 0x5d, 0, 0, 0, 0, 0]);
const encoder: OpusEncoderFactory = (onPacket, onHead) => {
  let headSent = false;
  let held = 0;
  return {
    encode(p) {
      if (!headSent) { headSent = true; onHead(HEAD); }
      held += p.length;
      while (held >= 480) { held -= 480; onPacket(new Uint8Array([1, 2, 3]), 960); }
    },
    async flush() { if (held > 0) { held = 0; onPacket(new Uint8Array([4, 5, 6]), 960); } },
    close() {},
  };
};

const SERVICE = { service: 'soniox' as const, apiKey: 'sk-test', region: 'us' as const };
const SAID: SonioxFileToken[] = [{ text: 'Welcome to the meeting.', start_ms: 100, end_ms: 2000, speaker: '1', language: 'en' }];
const SECOND = 24_000;

/** A decoded file: `seconds` of 24 kHz audio in one-second chunks, loud unless `silent`. */
function decoded(seconds: number, o: { silent?: boolean } = {}): DecodedAudio {
  return {
    durationMs: seconds * 1000,
    async *pcm24k() {
      for (let i = 0; i < seconds; i++) yield new Int16Array(SECOND).fill(o.silent ? 0 : 3000);
    },
  };
}
const file = (name = 'Team sync.mp4', size = 1000) => ({ name, size, lastModified: 1_800_000_100_000 }) as unknown as File;

function fakePort(o: { recognize?: (r: HistoryRecognizeRequest) => Promise<{ tokens: SonioxFileToken[]; audioMs: number }> } = {}) {
  const calls: Array<[string, any]> = [];
  const note = (name: string, value: unknown = undefined) => vi.fn(async (a: unknown) => { calls.push([name, a]); return value; });
  const tracks: Array<{ source: string; offsetMs: number; goneAt: null }> = [];
  const port = {
    openRecord: note('openRecord'),
    putLeg: note('putLeg'),
    appendTrack: vi.fn(async (a: { source: string; offsetMs: number; data: Uint8Array }) => {
      calls.push(['appendTrack', a]);
      if (!tracks.length) tracks.push({ source: a.source, offsetMs: a.offsetMs, goneAt: null });
      return { bytes: a.data.length };
    }),
    renameRecord: note('renameRecord'),
    getRecord: vi.fn(async () => ({
      id: 'import-0001', tracks, transcripts: [],
      legs: [{ leg: 'participant', languages: { source: 'en', target: 'zh' }, input: null, inputName: null, inputId: null, translated: false, spoken: false }],
    })),
    recognize: vi.fn(o.recognize ?? (async () => ({ tokens: SAID, audioMs: 3000 }))),
    recognitionStatus: vi.fn(async () => null),
    cancelRecognition: vi.fn(async () => true),
    createTranscript: note('createTranscript', 3),
    appendSentences: vi.fn(async (a: { sentences: unknown[] }) => { calls.push(['appendSentences', a]); return { added: a.sentences.length }; }),
    closeRecord: note('closeRecord', { kept: true }),
    binRecords: note('binRecords', { changed: 1 }),
    purgeRecords: note('purgeRecords', { purged: ['import-0001'], failed: [] }),
  };
  return { port: port as unknown as HistoryPort, calls, names: () => calls.map((c) => c[0]) };
}

const base = (port: HistoryPort, over: Partial<Parameters<typeof importFile>[0]> = {}) => ({
  port, file: file(), myLanguage: 'zh', language: 'en', service: SERVICE, appVersion: '9.9.9',
  readDuration: async () => 3000, decode: async () => decoded(3), encoder, clock: createVirtualClock(0),
  newId: () => 'import-0001', newJobId: () => 'job-1', pause: async () => {}, ...over,
});

describe('importing a file', () => {
  it('stores the recording as a new record, transcribes it, names it after the file, and closes it', async () => {
    const { port, calls, names } = fakePort();
    const phases: string[] = [];
    const result = await importFile(base(port, { onProgress: (p) => phases.push(p.phase) }));
    expect(result).toEqual({ recordId: 'import-0001', transcribed: true });
    const startedAt = 1_800_000_100_000 - 3000;
    expect(calls[0]).toEqual(['openRecord', {
      id: 'import-0001', startedAt, mode: 'import', myLanguage: 'zh', targetLanguage: 'en',
      services: { provider: 'soniox', models: { transcription: 'stt-async-v6' } }, appVersion: '9.9.9',
    }]);
    expect(calls[1]).toEqual(['putLeg', {
      recordId: 'import-0001', leg: 'participant', languages: { source: 'en', target: 'zh' }, input: null, inputName: null, inputId: null, translated: false, spoken: false,
    }]);
    const pieces = calls.filter((c) => c[0] === 'appendTrack').map((c) => c[1]);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.source === 'participant' && p.data.length <= 1024 * 1024)).toBe(true);
    // The track's own length: three seconds less the encoder's pre-skip.
    expect(Math.abs(pieces[pieces.length - 1].durationMs - 3000)).toBeLessThanOrEqual(10);
    expect(names().slice(-5)).toEqual(['appendTrack', 'renameRecord', 'createTranscript', 'appendSentences', 'closeRecord']);
    expect(calls.find((c) => c[0] === 'renameRecord')![1]).toEqual({ id: 'import-0001', title: 'Team sync' });
    expect(calls.find((c) => c[0] === 'closeRecord')![1]).toEqual({ id: 'import-0001', endedAt: startedAt + 3000 });
    expect(phases[0]).toBe('reading');
    expect(phases).toContain('decoding');
    expect(phases).toContain('saving');
    expect(phases[phases.length - 1]).toBe('writing');
  });

  it('refuses a file too long or too large before decoding it, and one whose length cannot be read', async () => {
    const cases: Array<[Partial<Parameters<typeof importFile>[0]>, string]> = [
      [{ readDuration: async () => MAX_IMPORT_MS + 1 }, 'TOO_LONG'],
      [{ file: file('big.mov', MAX_IMPORT_BYTES + 1) }, 'TOO_BIG'],
      [{ readDuration: async () => Number.NaN }, 'UNSUPPORTED'],
      [{ readDuration: async () => Number.POSITIVE_INFINITY }, 'UNSUPPORTED'],
      [{ readDuration: async () => 0 }, 'NO_AUDIO'],
      [{ readDuration: async () => { throw new Error('no media'); } }, 'UNSUPPORTED'],
    ];
    for (const [over, code] of cases) {
      const { port, calls } = fakePort();
      const decode = vi.fn(async () => decoded(3));
      const error = await importFile(base(port, { decode, ...over })).catch((e) => e);
      expect(error, code).toBeInstanceOf(ImportError);
      expect(error.code, code).toBe(code);
      expect(decode, code).not.toHaveBeenCalled();
      expect(calls, code).toEqual([]);
    }
  });

  it('refuses a file the decoder cannot read, before making a record', async () => {
    const { port, calls } = fakePort();
    await expect(importFile(base(port, { decode: async () => { throw new Error('EncodingError'); } }))).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(calls).toEqual([]);
  });

  it('refuses silence, and removes the record it had begun, files and all', async () => {
    const { port, names } = fakePort();
    await expect(importFile(base(port, { decode: async () => decoded(3, { silent: true }) }))).rejects.toMatchObject({ code: 'NO_AUDIO' });
    expect(names().slice(-2)).toEqual(['binRecords', 'purgeRecords']);
    expect(names()).not.toContain('createTranscript');
  });

  it('a cancel while the recording is stored removes the record', async () => {
    const { port, names } = fakePort();
    const controller = new AbortController();
    let chunks = 0;
    const decode = async (): Promise<DecodedAudio> => ({
      durationMs: 3000,
      async *pcm24k() { for (let i = 0; i < 3; i++) { if (++chunks === 2) controller.abort(); yield new Int16Array(SECOND).fill(3000); } },
    });
    await expect(importFile(base(port, { decode, signal: controller.signal }))).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(names().slice(-2)).toEqual(['binRecords', 'purgeRecords']);
  });

  it('keeps the recording without a transcript when recognition fails or is cancelled after it was stored', async () => {
    const failing = fakePort({ recognize: async () => { throw new HistoryUnavailable('Soniox refused the key (401)', 'NO_KEY'); } });
    expect(await importFile(base(failing.port))).toEqual({ recordId: 'import-0001', transcribed: false, failure: 'NO_KEY' });
    expect(failing.names()).not.toContain('purgeRecords');
    expect(failing.names()).not.toContain('createTranscript');
    expect(failing.names()[failing.names().length - 1]).toBe('closeRecord');

    const controller = new AbortController();
    const cancelled = fakePort({ recognize: async () => { controller.abort(); throw new HistoryUnavailable('cancelled', 'CANCELLED'); } });
    expect(await importFile(base(cancelled.port, { signal: controller.signal }))).toEqual({ recordId: 'import-0001', transcribed: false, failure: 'CANCELLED' });
    expect(cancelled.names()).not.toContain('purgeRecords');
    expect(cancelled.names()[cancelled.names().length - 1]).toBe('closeRecord');
  });
});
