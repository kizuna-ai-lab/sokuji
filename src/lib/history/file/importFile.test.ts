// An audio or video file becomes a History record: its recording first, then its transcript, then closed.
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../contract/clock';
import { HistoryUnavailable, type HistoryPort } from '../port';
import type { OpusEncoderFactory } from '../recording/track';
import type { HistoryRecognizeRequest, FileToken } from '../types';
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

const SERVICE = { service: 'soniox' as const, apiKey: 'sk-test', region: 'us' as const, languages: ['en', 'zh', 'ja'] };
const SAID: FileToken[] = [{ text: 'Welcome to the meeting.', start_ms: 100, end_ms: 2000, speaker: '1', language: 'en' }];
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

function fakePort(o: { recognize?: (r: HistoryRecognizeRequest) => Promise<{ tokens: FileToken[]; audioMs: number }> } = {}) {
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
  port, file: file(), myLanguage: 'zh', options: { languages: ['en'], translateTo: 'zh' }, service: SERVICE, appVersion: '9.9.9',
  readDuration: async () => 3000, decode: async () => decoded(3), encoder, clock: createVirtualClock(0),
  newId: () => 'import-0001', newJobId: () => 'job-1', pause: async () => {}, ...over,
});

// Decoding a piece at a time, length no longer weighs on memory: the limits are Soniox's five hours and 16 GB.
it('takes files up to five hours and 16 GB', () => {
  expect(MAX_IMPORT_MS).toBe(300 * 60_000);
  expect(MAX_IMPORT_BYTES).toBe(16 * 1000 ** 3);
});

describe('importing a file', () => {
  // Measured: a 3-hour WAV decodes far faster than Opus encodes, and the waiting audio reached 1 GB.
  it('lets the encoder catch up before decoding further, so its waiting audio never grows with the file', async () => {
    const { port } = fakePort();
    let waiting = 0;
    let most = 0;
    const slow: OpusEncoderFactory = (onPacket, onHead, onError) => {
      const inner = encoder(onPacket, onHead, onError);
      return {
        encode(p) { waiting += p.length; most = Math.max(most, waiting); inner.encode(p); },
        flush: () => inner.flush(),
        close() { inner.close(); },
        async settle() { await Promise.resolve(); waiting = 0; },
      };
    };
    await importFile(base(port, { encoder: slow, readDuration: async () => 60_000, decode: async () => decoded(60) }));
    expect(most).toBeLessThanOrEqual(2 * SECOND);
  });

  // Review: decoding now happens a block at a time, inside the loop; a broken file must still read as unreadable.
  it('calls a file whose audio breaks partway unreadable, and keeps nothing of it', async () => {
    const { port, names } = fakePort();
    const broken: DecodedAudio = { durationMs: 3000, async *pcm24k() { yield new Int16Array(SECOND).fill(3000); throw new Error('EncodingError: decoding failed'); } };
    await expect(importFile(base(port, { decode: async () => broken }))).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(names()).toContain('purgeRecords');
  });

  it('stores the recording as a new record, transcribes it, names it after the file, and closes it', async () => {
    const { port, calls, names } = fakePort();
    const phases: string[] = [];
    const result = await importFile(base(port, { onProgress: (p) => phases.push(p.phase) }));
    expect(result).toEqual({ recordId: 'import-0001', transcribed: true });
    const startedAt = 1_800_000_100_000 - 3000;
    expect(calls[0]).toEqual(['openRecord', {
      id: 'import-0001', startedAt, mode: 'import', myLanguage: 'zh', targetLanguage: 'en',
      services: { provider: 'soniox', models: { transcription: 'stt-async-v6' }, options: { languages: ['en'], translateTo: 'zh' } }, appVersion: '9.9.9',
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

  it('is transcribed as chosen: the main language is the record\u2019s, the others hinted too, translated into the language asked', async () => {
    const { port, calls } = fakePort();
    const options = { languages: ['ja', 'en'], translateTo: 'zh' };
    await importFile(base(port, { options }));
    // Kept with the record, so a transcription that fails can be tried again as it was asked.
    expect(calls.find((c) => c[0] === 'openRecord')![1]).toMatchObject({ myLanguage: 'zh', targetLanguage: 'ja', services: { options } });
    expect(calls.find((c) => c[0] === 'putLeg')![1]).toMatchObject({ languages: { source: 'ja', target: 'zh' } });
    expect(vi.mocked(port.recognize).mock.calls[0][0]).toMatchObject({ languageHints: ['ja', 'en'], translateTo: 'zh' });
    expect(calls.find((c) => c[0] === 'createTranscript')![1]).toMatchObject({ origin: { service: 'soniox', kind: 'file', options } });
  });

  // Review: a decoder's length is in fractions of a millisecond; the store takes whole ones only.
  it('closes the record at a whole millisecond when the file is not a whole number of them long', async () => {
    const { port, calls } = fakePort();
    const audio = { ...decoded(3), durationMs: 3045.333 };
    const result = await importFile(base(port, { readDuration: async () => 3045.333, decode: async () => audio }));
    expect(result.transcribed).toBe(true);
    const open = calls.find((c) => c[0] === 'openRecord')![1];
    const close = calls.find((c) => c[0] === 'closeRecord')![1];
    expect(Number.isSafeInteger(open.startedAt)).toBe(true);
    expect(Number.isSafeInteger(close.endedAt)).toBe(true);
    expect(close.endedAt - open.startedAt).toBe(3045);
  });

  it('refuses a file too long or too large before decoding it, and one whose length cannot be read', async () => {
    const cases: Array<[Partial<Parameters<typeof importFile>[0]>, string]> = [
      [{ readDuration: async () => 301 * 60_000 }, 'TOO_LONG'],
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
    expect(names().slice(-3)).toEqual(['closeRecord', 'binRecords', 'purgeRecords']);
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
    expect(names().slice(-3)).toEqual(['closeRecord', 'binRecords', 'purgeRecords']);
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
