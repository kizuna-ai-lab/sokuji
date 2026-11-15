// A record transcribed (again) from its kept tracks: one recognition per track, one new transcript, nothing on failure.
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../contract/clock';
import type { HistoryPort } from '../port';
import { HistoryUnavailable } from '../port';
import type { HistoryRecord, HistoryRecognizeRequest, SonioxFileToken } from '../types';
import { transcribeRecord, TranscribeError } from './transcribe';

const ID = 'run-0001-aaaa';
const SERVICE = { service: 'soniox' as const, apiKey: 'sk-test', region: 'eu' as const };
const said = (text: string, at: number): SonioxFileToken[] => [{ text, start_ms: at, end_ms: at + 500, speaker: '1', language: 'en' }];

function record(o: { tracks?: Array<{ source: string; offsetMs: number; goneAt?: number | null }>; sameInput?: boolean } = {}): HistoryRecord {
  const mic = { input: 'microphone', inputName: 'Mic', inputId: 'mic-1' };
  return {
    id: ID,
    legs: [
      { leg: 'speaker', languages: { source: 'zh', target: 'en' }, ...mic, translated: true, spoken: false },
      { leg: 'participant', languages: { source: 'en', target: 'zh' }, ...(o.sameInput ? mic : { input: 'app', inputName: 'Zoom', inputId: 'app-1' }), translated: true, spoken: false },
    ],
    tracks: (o.tracks ?? [{ source: 'speaker', offsetMs: 0 }, { source: 'participant', offsetMs: 1000 }])
      .map((t) => ({ file: `${t.source}.opus`, format: 'ogg-opus', durationMs: 60_000, bytes: 1, goneAt: null, ...t })),
    transcripts: [{ id: 1, origin: { service: 'soniox', kind: 'live' }, textKind: 'original', createdAt: 1, sentences: 3 }],
  } as unknown as HistoryRecord;
}

function fakePort(o: { record?: HistoryRecord; words?: Record<string, SonioxFileToken[]>; fail?: string } = {}) {
  const asked: HistoryRecognizeRequest[] = [];
  const written: unknown[] = [];
  const port = {
    getRecord: vi.fn(async () => o.record ?? record()),
    recognize: vi.fn(async (r: HistoryRecognizeRequest) => {
      asked.push(r);
      if (o.fail === r.source) throw new HistoryUnavailable('Soniox refused the key (401)', 'NO_KEY');
      return { tokens: o.words?.[r.source] ?? [], audioMs: 60_000 };
    }),
    cancelRecognition: vi.fn(async () => true),
    recognitionStatus: vi.fn(async () => ({ phase: 'processing' })),
    createTranscript: vi.fn(async (a: unknown) => { written.push(['createTranscript', a]); return 7; }),
    appendSentences: vi.fn(async (a: { sentences: unknown[] }) => { written.push(['appendSentences', a]); return { added: a.sentences.length }; }),
  };
  return { port: port as unknown as HistoryPort, raw: port, asked, written };
}

let jobs = 0;
const newJobId = () => `job-${++jobs}`;

describe('transcribing a record again', () => {
  it('recognizes each kept track, sides from the tracks, and writes one new transcript in time order', async () => {
    const { port, asked, written } = fakePort({ words: { speaker: said('Mine first.', 0), participant: said('Then theirs.', 200) } });
    const result = await transcribeRecord({ port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.source, r.apiKey, r.region, r.languageHints])).toEqual([
      ['speaker', 'sk-test', 'eu', ['zh', 'en']],
      ['participant', 'sk-test', 'eu', ['zh', 'en']],
    ]);
    expect(written[0]).toEqual(['createTranscript', { recordId: ID, origin: { service: 'soniox', kind: 'file' }, textKind: 'original' }]);
    const sentences = (written[1] as [string, { transcriptId: number; sentences: Array<Record<string, unknown>> }])[1];
    expect(sentences.transcriptId).toBe(7);
    expect(sentences.sentences.map((s) => [s.n, s.side, s.sideCertain, s.track, s.startMs, s.text])).toEqual([
      [1, 'mine', true, 'microphone', 0, 'Mine first.'],
      [2, 'other', true, 'other', 1200, 'Then theirs.'],
    ]);
    expect(result).toEqual({ transcriptId: 7, sentences: 2 });
  });

  it('is not certain of the side when both legs heard one input', async () => {
    const { port, written } = fakePort({ record: record({ sameInput: true }), words: { speaker: said('One.', 0), participant: said('Two.', 0) } });
    await transcribeRecord({ port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    const sentences = (written[1] as [string, { sentences: Array<{ sideCertain: boolean }> }])[1].sentences;
    expect(sentences.every((s) => s.sideCertain === false)).toBe(true);
  });

  it('writes nothing when one track fails, and passes its reason on', async () => {
    const { port, written } = fakePort({ fail: 'participant', words: { speaker: said('One.', 0) } });
    await expect(transcribeRecord({ port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) })).rejects.toMatchObject({ code: 'NO_KEY' });
    expect(written).toEqual([]);
  });

  it('skips a dropped track, and says so when no track is left', async () => {
    const { port, asked } = fakePort({ record: record({ tracks: [{ source: 'speaker', offsetMs: 0, goneAt: 5 }, { source: 'participant', offsetMs: 0 }] }), words: { participant: said('Two.', 0) } });
    await transcribeRecord({ port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => r.source)).toEqual(['participant']);
    const none = fakePort({ record: record({ tracks: [{ source: 'speaker', offsetMs: 0, goneAt: 5 }] }) });
    const error = await transcribeRecord({ port: none.port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) }).catch((e) => e);
    expect(error).toBeInstanceOf(TranscribeError);
    expect(error).toMatchObject({ code: 'NO_TRACK' });
  });

  it('says no speech was found instead of writing an empty transcript', async () => {
    const { port, written } = fakePort({ words: {} });
    await expect(transcribeRecord({ port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) })).rejects.toMatchObject({ code: 'NO_SPEECH' });
    expect(written).toEqual([]);
  });

  it('reports the phases, asking main once a second while a track is recognized', async () => {
    const clock = createVirtualClock(0);
    let release!: () => void;
    const { port, raw } = fakePort({ words: { speaker: said('One.', 0) }, record: record({ tracks: [{ source: 'speaker', offsetMs: 0 }] }) });
    raw.recognize.mockImplementationOnce(async () => { await new Promise<void>((res) => { release = res; }); return { tokens: said('One.', 0), audioMs: 1 }; });
    const phases: string[] = [];
    const done = transcribeRecord({ port, recordId: ID, service: SERVICE, newJobId, clock, onProgress: (p) => phases.push(p.phase) });
    await vi.waitFor(() => expect(phases).toEqual(['uploading']));
    clock.advance(1000);
    await vi.waitFor(() => expect(phases).toEqual(['uploading', 'processing']));
    release();
    await done;
    expect(phases).toEqual(['uploading', 'processing', 'writing']);
  });

  it('a cancel stops the running recognition at main and writes nothing', async () => {
    const controller = new AbortController();
    const { port, raw, written } = fakePort({ record: record({ tracks: [{ source: 'speaker', offsetMs: 0 }] }) });
    raw.recognize.mockImplementationOnce(async () => {
      controller.abort();
      throw new HistoryUnavailable('The recognition was cancelled', 'CANCELLED');
    });
    await expect(transcribeRecord({ port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0), signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(raw.cancelRecognition).toHaveBeenCalled();
    expect(written).toEqual([]);
  });
});
