// A record transcribed (again) from its kept tracks: one recognition per track, one new transcript, nothing on failure.
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../contract/clock';
import type { HistoryPort } from '../port';
import { HistoryUnavailable } from '../port';
import type { HistoryRecord, HistoryRecognizeRequest, FileToken } from '../types';
import { transcribeRecord, TranscribeError } from './transcribe';
import { EACH_SIDE } from './options';

const ID = 'run-0001-aaaa';
const SERVICE = { service: 'soniox' as const, apiKey: 'sk-test', region: 'eu' as const, languages: ['en', 'zh', 'ja'] };
/** What the user chose: the languages spoken, the main one first, and the one to translate into. */
const OPTIONS = { languages: ['en', 'zh'], translateTo: 'zh' };
const said = (text: string, at: number): FileToken[] => [{ text, start_ms: at, end_ms: at + 500, speaker: '1', language: 'en' }];
const translated = (text: string): FileToken[] => [{ text, translation_status: 'translation', language: 'zh', source_language: 'en' }];

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

function fakePort(o: { record?: HistoryRecord; words?: Record<string, FileToken[]>; fail?: string; writeFails?: boolean; deleteFails?: boolean } = {}) {
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
    appendSentences: vi.fn(async (a: { sentences: unknown[] }) => {
      if (o.writeFails) throw new HistoryUnavailable('disk full', 'LOCAL');
      written.push(['appendSentences', a]); return { added: a.sentences.length };
    }),
    deleteTranscript: vi.fn(async (a: unknown) => { written.push(['deleteTranscript', a]); if (o.deleteFails) throw new Error('still full'); }),
  };
  return { port: port as unknown as HistoryPort, raw: port, asked, written };
}

let jobs = 0;
const newJobId = () => `job-${++jobs}`;

describe('transcribing a record again', () => {
  it('recognizes each kept track, sides from the tracks, and writes one new transcript in time order', async () => {
    const { port, asked, written } = fakePort({ words: { speaker: said('Mine first.', 0), participant: said('Then theirs.', 200) } });
    const result = await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.source, r.apiKey, r.region, r.languageHints, r.translateTo])).toEqual([
      ['speaker', 'sk-test', 'eu', ['en', 'zh'], 'zh'],
      ['participant', 'sk-test', 'eu', ['en', 'zh'], 'zh'],
    ]);
    // The version says what it was asked with: the next "transcribe again" starts from it.
    expect(written[0]).toEqual(['createTranscript', { recordId: ID, origin: { service: 'soniox', kind: 'file', options: OPTIONS }, textKind: 'original' }]);
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
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    const sentences = (written[1] as [string, { sentences: Array<{ sideCertain: boolean }> }])[1].sentences;
    expect(sentences.every((s) => s.sideCertain === false)).toBe(true);
  });

  it('is not certain of the side of an imported file: who speaks in it is not known', async () => {
    const imported = { ...record({ tracks: [{ source: 'participant', offsetMs: 0 }] }), mode: 'import', legs: [record().legs[1]] } as unknown as HistoryRecord;
    const { port, written } = fakePort({ record: imported, words: { participant: said('Hello.', 0) } });
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    const sentences = (written[1] as [string, { sentences: Array<{ side: string; sideCertain: boolean }> }])[1].sentences;
    expect(sentences.map((s) => [s.side, s.sideCertain])).toEqual([['other', false]]);
  });

  it('sends the language hints in the service’s own codes, dropping those it does not know', async () => {
    const { port, asked } = fakePort({ words: { speaker: said('One.', 0), participant: said('Two.', 0) } });
    const service = { ...SERVICE, languageHint: (code: string) => (code === 'zh' ? 'zh' : null) };
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => r.languageHints)).toEqual([['zh'], ['zh']]);
  });

  it('asks for the translation in the service\u2019s code, and none it cannot make; the word list goes with every track', async () => {
    const context = { terms: ['Sokuji'] };
    const { port, asked } = fakePort({ words: { speaker: said('One.', 0), participant: said('Two.', 0) } });
    const service = { ...SERVICE, context, languageHint: (code: string) => (code === 'zh' ? 'zh-wire' : code === 'en' ? 'en' : null) };
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.translateTo, r.context])).toEqual([['zh-wire', context], ['zh-wire', context]]);
    const none = fakePort({ words: { speaker: said('One.', 0), participant: said('Two.', 0) } });
    await transcribeRecord({ options: { languages: ['en'], translateTo: 'ja' }, port: none.port, recordId: ID, service, newJobId, clock: createVirtualClock(0) });
    expect(none.asked.map((r) => ['translateTo' in r, 'context' in r])).toEqual([[false, true], [false, true]]);
  });

  it('each side into the other\u2019s language: every track translated as its own side was in the session', async () => {
    const { port, asked } = fakePort({ words: { speaker: said('Mine.', 0), participant: said('Theirs.', 200) } });
    await transcribeRecord({ options: { languages: ['en', 'zh'], translateTo: EACH_SIDE }, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    // The speaker side was Chinese into English; the other side English into Chinese.
    expect(asked.map((r) => [r.source, r.translateTo])).toEqual([['speaker', 'en'], ['participant', 'zh']]);
  });

  it('each side: a side translated into a regional language goes into that language as the service has it', async () => {
    const legs = record().legs.map((l) => (l.leg === 'participant' ? { ...l, languages: { source: 'en', target: 'zh-Hant' } } : l));
    const { port, asked } = fakePort({ record: { ...record(), legs } as HistoryRecord, words: { speaker: said('Mine.', 0), participant: said('Theirs.', 200) } });
    const service = { ...SERVICE, languageHint: (code: string) => (['zh', 'en'].includes(code) ? code : null) };
    await transcribeRecord({ options: { languages: ['en', 'zh'], translateTo: EACH_SIDE }, port, recordId: ID, service, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.source, r.translateTo])).toEqual([['speaker', 'en'], ['participant', 'zh']]);
  });

  it('keeps each turn\u2019s translation on its first sentence, in the new transcript', async () => {
    const { port, written } = fakePort({ words: { speaker: [...said('Mine.', 0), ...translated('我的。')], participant: [...said('Theirs.', 200), ...translated('他们的。')] } });
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    expect(written.map((w) => (w as [string])[0])).toEqual(['createTranscript', 'appendSentences']);
    const sentences = (written[1] as [string, { sentences: Array<{ text: string; translation?: string }> }])[1].sentences;
    expect(sentences.map((x) => [x.text, x.translation])).toEqual([['Mine.', '我的。'], ['Theirs.', '他们的。']]);
  });

  it('writes nothing when one track fails, and passes its reason on', async () => {
    const { port, written } = fakePort({ fail: 'participant', words: { speaker: said('One.', 0) } });
    await expect(transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) })).rejects.toMatchObject({ code: 'NO_KEY' });
    expect(written).toEqual([]);
  });

  it('skips a dropped track, and says so when no track is left', async () => {
    const { port, asked } = fakePort({ record: record({ tracks: [{ source: 'speaker', offsetMs: 0, goneAt: 5 }, { source: 'participant', offsetMs: 0 }] }), words: { participant: said('Two.', 0) } });
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => r.source)).toEqual(['participant']);
    const none = fakePort({ record: record({ tracks: [{ source: 'speaker', offsetMs: 0, goneAt: 5 }] }) });
    const error = await transcribeRecord({ options: OPTIONS, port: none.port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) }).catch((e) => e);
    expect(error).toBeInstanceOf(TranscribeError);
    expect(error).toMatchObject({ code: 'NO_TRACK' });
  });

  it('says no speech was found instead of writing an empty transcript', async () => {
    const { port, written } = fakePort({ words: {} });
    await expect(transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) })).rejects.toMatchObject({ code: 'NO_SPEECH' });
    expect(written).toEqual([]);
  });

  it('reports the phases, asking main once a second while a track is recognized', async () => {
    const clock = createVirtualClock(0);
    let release!: () => void;
    const { port, raw } = fakePort({ words: { speaker: said('One.', 0) }, record: record({ tracks: [{ source: 'speaker', offsetMs: 0 }] }) });
    raw.recognize.mockImplementationOnce(async () => { await new Promise<void>((res) => { release = res; }); return { tokens: said('One.', 0), audioMs: 1 }; });
    const phases: string[] = [];
    const done = transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock, onProgress: (p) => phases.push(p.phase) });
    await vi.waitFor(() => expect(phases).toEqual(['uploading']));
    clock.advance(1000);
    await vi.waitFor(() => expect(phases).toEqual(['uploading', 'processing']));
    release();
    await done;
    expect(phases).toEqual(['uploading', 'processing', 'writing']);
  });

  // The words are paid for and whole; only writing them here can fail half way: the half-written version goes.
  it('deletes the transcript it made when writing its sentences fails, and passes the failure on', async () => {
    for (const deleteFails of [false, true]) {
      const { port, written } = fakePort({ words: { speaker: said('Mine first.', 0), participant: said('Then theirs.', 200) }, writeFails: true, deleteFails });
      await expect(transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, clock: createVirtualClock(0), newJobId })).rejects.toThrow('disk full');
      expect(written).toContainEqual(['deleteTranscript', { transcriptId: 7 }]);
    }
  });

  it('a cancel stops the running recognition at main and writes nothing', async () => {
    const controller = new AbortController();
    const { port, raw, written } = fakePort({ record: record({ tracks: [{ source: 'speaker', offsetMs: 0 }] }) });
    raw.recognize.mockImplementationOnce(async () => {
      controller.abort();
      throw new HistoryUnavailable('The recognition was cancelled', 'CANCELLED');
    });
    await expect(transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0), signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(raw.cancelRecognition).toHaveBeenCalled();
    expect(written).toEqual([]);
  });
});
