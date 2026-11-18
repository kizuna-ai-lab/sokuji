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

function record(o: { tracks?: Array<{ source: string; offsetMs: number; goneAt?: number | null; durationMs?: number }>; sameInput?: boolean } = {}): HistoryRecord {
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

function fakePort(o: { record?: HistoryRecord; words?: Record<string, FileToken[]>; fail?: string; failCode?: string; writeFails?: boolean; deleteFails?: boolean } = {}) {
  const asked: HistoryRecognizeRequest[] = [];
  const written: unknown[] = [];
  const port = {
    getRecord: vi.fn(async () => o.record ?? record()),
    recognize: vi.fn(async (r: HistoryRecognizeRequest) => {
      asked.push(r);
      if (o.fail === r.source) {
        throw o.failCode ? new HistoryUnavailable(`The service refused the track (${o.failCode})`, o.failCode) : new HistoryUnavailable('Soniox refused the key (401)', 'NO_KEY');
      }
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

  // The whole request, so nothing meant for the Kizuna AI service (a sign-in, its address, a payer, the audio still to
  // come) ever rides along with the user's own key; strictly, so not even such a key left undefined.
  it('asks with the key, the region and what the user chose, and nothing else', async () => {
    const { port, asked } = fakePort({ words: { speaker: said('One.', 0), participant: said('Two.', 0) } });
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    const sent = { recordId: ID, service: 'soniox', apiKey: 'sk-test', region: 'eu', languageHints: ['en', 'zh'], translateTo: 'zh', jobId: expect.any(String) };
    expect(asked).toStrictEqual([{ ...sent, source: 'speaker' }, { ...sent, source: 'participant' }]);
  });

  // Only Kizuna AI's service leaves out a translation into the recording's own language; the user's own key is asked
  // exactly what the user chose.
  it('asks the user’s own key for a translation into the only language spoken, as chosen', async () => {
    const { port, asked } = fakePort({ words: { speaker: said('One.', 0), participant: said('Two.', 0) } });
    await transcribeRecord({ options: { languages: ['zh'], translateTo: 'zh' }, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.source, r.languageHints, r.translateTo])).toEqual([['speaker', ['zh'], 'zh'], ['participant', ['zh'], 'zh']]);
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

  it('each side: a side the session translated into nothing is sent without a translation', async () => {
    const legs = record().legs.map((l) => (l.leg === 'participant' ? { ...l, languages: { source: 'en', target: '' } } : l));
    const { port, asked } = fakePort({ record: { ...record(), legs } as HistoryRecord, words: { speaker: said('Mine.', 0), participant: said('Theirs.', 200) } });
    await transcribeRecord({ options: { languages: ['en', 'zh'], translateTo: EACH_SIDE }, port, recordId: ID, service: SERVICE, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.source, 'translateTo' in r, r.translateTo])).toEqual([['speaker', true, 'en'], ['participant', false, undefined]]);
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

// Kizuna AI's Soniox: each track a file job of the signed-in account at the Kizuna AI service, never with a key.
describe('transcribing a record through the Kizuna AI service', () => {
  const API_URL = 'https://service.example/api';
  const hosted = (token: () => Promise<string | null>, payer?: 'organization' | 'personal') => ({
    service: 'kizunaai_soniox' as const, hosted: true as const, region: 'jp', languages: ['en', 'zh', 'ja'],
    access: { apiUrl: API_URL, token, ...(payer ? { payer } : {}) },
  });
  /** Two kept tracks of different lengths, the speaker's first. */
  const twoTracks = () => record({ tracks: [{ source: 'speaker', offsetMs: 0, durationMs: 90_000 }, { source: 'participant', offsetMs: 1000, durationMs: 45_000 }] });
  const words = { speaker: said('Mine first.', 0), participant: said('Then theirs.', 200) };

  it('sends each track with the sign-in, the service’s address, the region, the payer and the audio still to come; no key', async () => {
    const token = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce('tok-1').mockResolvedValueOnce('tok-2');
    const { port, asked, written } = fakePort({ record: twoTracks(), words });
    const result = await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: hosted(token, 'organization'), newJobId, clock: createVirtualClock(0) });
    const sent = { recordId: ID, service: 'kizunaai_soniox', region: 'jp', apiUrl: API_URL, payer: 'organization', languageHints: ['en', 'zh'], translateTo: 'zh', jobId: expect.any(String) };
    // The token as it is when each track starts; the first track tells the service the second is still to come.
    expect(asked).toEqual([
      { ...sent, source: 'speaker', token: 'tok-1', laterAudioMs: 45_000 },
      { ...sent, source: 'participant', token: 'tok-2', laterAudioMs: 0 },
    ]);
    expect(asked.every((r) => !('apiKey' in r))).toBe(true);
    expect(token).toHaveBeenCalledTimes(2);
    // The new version names the service that made it.
    expect(written[0]).toEqual(['createTranscript', { recordId: ID, origin: { service: 'kizunaai_soniox', kind: 'file', options: OPTIONS }, textKind: 'original' }]);
    expect(result).toEqual({ transcriptId: 7, sentences: 2 });
  });

  it('counts only the tracks still kept in the audio still to come', async () => {
    const goneLater = record({ tracks: [{ source: 'speaker', offsetMs: 0, durationMs: 90_000 }, { source: 'participant', offsetMs: 1000, durationMs: 45_000, goneAt: 5 }] });
    const { port, asked } = fakePort({ record: goneLater, words });
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: hosted(async () => 'tok'), newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.source, r.laterAudioMs])).toEqual([['speaker', 0]]);
  });

  it('names no payer when there is none to name, and the word list goes with every track', async () => {
    const context = { terms: ['Sokuji'] };
    const { port, asked } = fakePort({ record: twoTracks(), words });
    await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: { ...hosted(async () => 'tok'), context }, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => ['payer' in r, r.context])).toEqual([[false, context], [false, context]]);
  });

  // One language spoken and translated into itself: there is nothing to translate, so none is asked for, nor paid for
  // (owner, 2026-11-19). The new version still says what the user chose.
  it('asks for no translation into the only language spoken', async () => {
    const options = { languages: ['zh'], translateTo: 'zh' };
    const { port, asked, written } = fakePort({ record: twoTracks(), words });
    await transcribeRecord({ options, port, recordId: ID, service: hosted(async () => 'tok'), newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.source, r.languageHints, 'translateTo' in r])).toEqual([['speaker', ['zh'], false], ['participant', ['zh'], false]]);
    expect(written[0]).toEqual(['createTranscript', { recordId: ID, origin: { service: 'kizunaai_soniox', kind: 'file', options }, textKind: 'original' }]);
  });

  it('asks for the translation when another language is spoken too, or it goes into another language', async () => {
    for (const options of [{ languages: ['zh', 'en'], translateTo: 'zh' }, { languages: ['zh'], translateTo: 'en' }]) {
      const { port, asked } = fakePort({ record: twoTracks(), words });
      await transcribeRecord({ options, port, recordId: ID, service: hosted(async () => 'tok'), newJobId, clock: createVirtualClock(0) });
      expect(asked.map((r) => r.translateTo), JSON.stringify(options)).toEqual([options.translateTo, options.translateTo]);
    }
  });

  it('compares the languages in the service’s own codes', async () => {
    const { port, asked } = fakePort({ record: twoTracks(), words });
    const service = { ...hosted(async () => 'tok'), languageHint: (code: string) => (code === 'zh' ? 'zh' : null) };
    // A regional code the service knows only by its language: the same language as the translation's.
    await transcribeRecord({ options: { languages: ['zh-CN'], translateTo: 'zh' }, port, recordId: ID, service, newJobId, clock: createVirtualClock(0) });
    expect(asked.map((r) => [r.languageHints, 'translateTo' in r])).toEqual([[['zh'], false], [['zh'], false]]);
  });

  it('says to sign in, and sends nothing, when there is no sign-in', async () => {
    const { port, raw, written } = fakePort({ record: twoTracks(), words });
    const error = await transcribeRecord({ options: OPTIONS, port, recordId: ID, service: hosted(async () => null), newJobId, clock: createVirtualClock(0) }).catch((e) => e);
    expect(error).toBeInstanceOf(TranscribeError);
    expect(error).toMatchObject({ code: 'SIGN_IN' });
    expect(raw.recognize).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  it('a sign-out between tracks stops the next one, and writes nothing', async () => {
    const token = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce('tok').mockResolvedValueOnce(null);
    const { port, raw } = fakePort({ record: twoTracks(), words });
    await expect(transcribeRecord({ options: OPTIONS, port, recordId: ID, service: hosted(token), newJobId, clock: createVirtualClock(0) })).rejects.toMatchObject({ code: 'SIGN_IN' });
    expect(raw.recognize).toHaveBeenCalledTimes(1);
    expect(raw.createTranscript).not.toHaveBeenCalled();
  });

  // The first track's words are paid for, but a record is never left with half a transcript.
  it('passes on the service’s refusal of the second track and writes nothing', async () => {
    const { port, raw } = fakePort({ record: twoTracks(), words, fail: 'participant', failCode: 'NO_BALANCE' });
    await expect(transcribeRecord({ options: OPTIONS, port, recordId: ID, service: hosted(async () => 'tok'), newJobId, clock: createVirtualClock(0) })).rejects.toMatchObject({ code: 'NO_BALANCE' });
    expect(raw.recognize).toHaveBeenCalledTimes(2);
    expect(raw.createTranscript).not.toHaveBeenCalled();
  });

  it('a cancel while the sign-in is read sends nothing', async () => {
    const controller = new AbortController();
    const { port, raw } = fakePort({ record: twoTracks(), words });
    const token = async () => { controller.abort(); return 'tok'; };
    await expect(transcribeRecord({ options: OPTIONS, port, recordId: ID, service: hosted(token), newJobId, clock: createVirtualClock(0), signal: controller.signal }))
      .rejects.toMatchObject({ code: 'CANCELLED' });
    expect(raw.recognize).not.toHaveBeenCalled();
    expect(raw.createTranscript).not.toHaveBeenCalled();
  });

  // A cancel that lands while the sign-in is read is a cancel, not a missing sign-in.
  it('a cancel while the sign-in is read says it was cancelled, even when no sign-in came back', async () => {
    const controller = new AbortController();
    const { port, raw } = fakePort({ record: twoTracks(), words });
    const token = async () => { controller.abort(); return null; };
    await expect(transcribeRecord({ options: OPTIONS, port, recordId: ID, service: hosted(token), newJobId, clock: createVirtualClock(0), signal: controller.signal }))
      .rejects.toMatchObject({ code: 'CANCELLED' });
    expect(raw.recognize).not.toHaveBeenCalled();
  });
});
