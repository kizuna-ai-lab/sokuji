// Running one version of a record's notes: from its newest transcript to a saved version, one at a time per record.
import { refreshPrompts, resetPromptSource } from './promptSource';
import { describe, it, expect, vi } from 'vitest';
import type { HistoryPort } from '../history/port';
import type { HistoryRecord, HistorySentence } from '../history/types';
import { ChatError, type ChatPort, type ChatRequest } from './chat';
import { createNotesRunner } from './runner';

const ID = 'run-0001-aaaa';
const JA = { code: 'ja', name: 'Japanese' };

const sentence = (n: number, o: Partial<HistorySentence> = {}): HistorySentence => ({
  n, segmentId: null, side: 'other', sideCertain: true, track: 'other', speaker: '1.1', speakerByUser: null, speakerName: null,
  startMs: (n - 1) * 30_000, endMs: (n - 1) * 30_000 + 10_000, text: `sentence ${n}`, language: 'ja', timeKind: 'given', translation: null, ...o,
});
const SENTENCES = [1, 2, 3, 4, 5].map((n) => sentence(n));

/** One answer that serves every call: a part, the finishing call and the names step each read what they need. */
const ANSWER = {
  title: 'Weekly sync', summary: 'What was agreed.',
  topics: [{ title: 'Delivery', sid: 1, summary: 'The date.', points: [{ text: 'Ships Tuesday', sid: 2, kinds: ['decision'] }] }],
  join: [], drop: [], merge: [], items: [],
};

function fakePort(o: { sentences?: HistorySentence[] } = {}) {
  const saved: unknown[] = [];
  const port = {
    getRecord: vi.fn(async () => ({
      id: ID, titleByUser: false,
      transcripts: [
        { id: 1, origin: { service: 'soniox', kind: 'live' }, textKind: 'original', createdAt: 100, sentences: 5 },
        { id: 2, origin: { service: 'soniox', kind: 'live' }, textKind: 'original', createdAt: 200, sentences: 5 },
      ],
    }) as unknown as HistoryRecord),
    getSentences: vi.fn(async () => o.sentences ?? SENTENCES),
    saveNotes: vi.fn(async (a: unknown) => { saved.push(a); return saved.length; }),
    renameRecord: vi.fn(async () => undefined),
  };
  return { port: port as unknown as HistoryPort, raw: port, saved };
}

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function setup(o: { chat?: ChatPort | null; sentences?: HistorySentence[] } = {}) {
  const { port, raw, saved } = fakePort(o);
  const calls: ChatRequest[] = [];
  const chat: ChatPort = o.chat ?? (async (r) => { calls.push(r); return ANSWER; });
  const runner = createNotesRunner({
    port,
    chatFor: async () => (o.chat === null ? null : { chat, model: 'gpt-6-luna' }),
    language: () => JA,
  });
  return { runner, raw, saved, calls };
}

const promptsAt3 = async () => refreshPrompts({
  fetch: async () => new Response(JSON.stringify({
    notes: { version: 3, prompts: { 'whole-meeting': 'v3 whole __LANGUAGE__', 'meeting-part': 'v3 part __LANGUAGE__', 'combine-parts': 'v3 combine __LANGUAGE__', 'check-names': 'v3 names' } },
    live: { version: 3, prompts: { 'live-update': 'v3 live __LANGUAGE__' } },
  })),
  save: async () => true,
});

describe('the notes runner', () => {
  it('writes a version from the newest transcript and saves it as complete notes', async () => {
    const { runner, raw, saved } = setup();
    const seen: string[][] = [];
    runner.subscribe(() => seen.push(runner.running()));
    runner.start(ID);
    expect(runner.running()).toEqual([ID]);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(raw.getSentences).toHaveBeenCalledWith({ transcriptId: 2 });
    expect(saved[0]).toEqual({
      recordId: ID, transcriptId: 2, writtenBy: { kind: 'sokuji', promptVersion: 2, model: 'gpt-6-luna' }, language: 'ja', state: 'complete', requestIds: [],
      body: expect.objectContaining({ title: 'Weekly sync', topics: [{ title: 'Delivery', summary: 'The date.', first: 1 }] }),
    });
    await settle();
    expect(runner.running()).toEqual([]);
    expect(seen).toEqual([[ID], []]);
    // The store names the record after its notes unless the user named it: the runner leaves the title alone.
    expect(raw.renameRecord).not.toHaveBeenCalled();
  });

  it('writes every call with the prompts in use when it starts, and stores their version', async () => {
    await promptsAt3();
    try {
      const { runner, saved, calls } = setup();
      runner.start(ID);
      await vi.waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0]).toMatchObject({ writtenBy: { promptVersion: 3 } });
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.promptVersion).toBe(3);
        expect(call.system.startsWith('v3 ')).toBe(true);
      }
    } finally {
      resetPromptSource();
    }
  });

  it('asks for the notes service for the record it writes, so a hosted service bills that meeting', async () => {
    const { port } = fakePort({});
    const chatFor = vi.fn(async () => ({ chat: (async () => ANSWER) as ChatPort, model: 'gpt-6-luna' }));
    const runner = createNotesRunner({ port, chatFor, language: () => JA });
    runner.start(ID);
    await vi.waitFor(() => expect(chatFor).toHaveBeenCalledWith(ID));
    await settle();
  });

  it('writes for the transcript asked for, and for the newest when that one is not the record’s', async () => {
    const { runner, raw, saved } = setup();
    runner.start(ID, undefined, 1);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(raw.getSentences).toHaveBeenCalledWith({ transcriptId: 1 });
    expect(saved[0]).toMatchObject({ transcriptId: 1 });
    await settle();
    runner.start(ID, undefined, 99);
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]).toMatchObject({ transcriptId: 2 });
  });

  it('writes in the language asked for', async () => {
    const { runner, saved, calls } = setup();
    runner.start(ID, { code: 'en', name: 'English' });
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ language: 'en' });
    expect((calls[0].user as { output_language: string }).output_language).toBe('en');
  });

  it('labels the speakers by side, numbered when a side has several, by name when the user gave one', async () => {
    const sentences = [
      sentence(1, { side: 'mine', speaker: '1', track: 'microphone' }),
      sentence(2, { speaker: '1.1' }),
      sentence(3, { speaker: '1.2' }),
      sentence(4, { speaker: '1.1', speakerName: '田中' }),
      sentence(5, { speaker: '1.2', speakerByUser: '1.1', speakerName: '田中' }),
    ];
    const { runner, saved, calls } = setup({ sentences });
    runner.start(ID);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    const part = calls.find((c) => (c.user as { output_language?: string; sentences?: unknown }).output_language && (c.user as { sentences?: unknown }).sentences)!;
    expect((part.user as { sentences: Array<{ speaker: string }> }).sentences.map((s) => s.speaker)).toEqual(['My side', '田中', 'Other side 2', '田中', '田中']);
  });

  it("stores a failed version with the service's own words", async () => {
    const chat: ChatPort = async () => { throw new ChatError('refused', { status: 401, serviceMessage: 'Incorrect API key provided.' }); };
    const { runner, saved } = setup({ chat });
    runner.start(ID);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      recordId: ID, transcriptId: 2, writtenBy: { kind: 'sokuji', promptVersion: 2, model: 'gpt-6-luna' }, language: 'ja', state: 'failed',
      failure: 'Incorrect API key provided.', body: null, requestIds: [],
    });
  });

  it('stores a failed version saying so when there is no notes service to call', async () => {
    const { runner, saved } = setup({ chat: null });
    runner.start(ID);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ state: 'failed', failure: 'notes:no-service', body: null });
  });

  it('stores a cancelled version when it is cancelled', async () => {
    const chat: ChatPort = (r) => new Promise((_, reject) => r.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    const { runner, saved } = setup({ chat });
    runner.start(ID);
    await settle();
    runner.cancel(ID);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ state: 'cancelled', body: null });
    await settle();
    expect(runner.running()).toEqual([]);
  });

  // Review: the last answer can come back just as the user cancels; the version is then cancelled, not complete.
  it('stores a cancelled version when it is cancelled as its last answer comes back', async () => {
    const counted = setup();
    counted.runner.start(ID);
    await vi.waitFor(() => expect(counted.saved).toHaveLength(1));
    const last = counted.calls.length;
    let n = 0;
    let runner!: ReturnType<typeof setup>['runner'];
    const chat: ChatPort = async () => {
      n += 1;
      // The answer is in; the cancel comes before the runner gets to it.
      if (n === last) runner.cancel(ID);
      return ANSWER;
    };
    const s = setup({ chat });
    runner = s.runner;
    runner.start(ID);
    await vi.waitFor(() => expect(s.saved).toHaveLength(1));
    expect(s.saved[0]).toMatchObject({ state: 'cancelled', body: null });
  });

  it('ignores a second start for a record whose notes are being written', async () => {
    const { runner, raw, saved } = setup();
    runner.start(ID);
    runner.start(ID);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    await settle();
    expect(raw.getRecord).toHaveBeenCalledTimes(1);
  });

  it('saves nothing and calls nothing for less than a minute of transcript', async () => {
    const { runner, saved, calls } = setup({ sentences: [sentence(1), sentence(2, { startMs: 20_000, endMs: 40_000 })] });
    runner.start(ID);
    await settle();
    await settle();
    expect(saved).toEqual([]);
    expect(calls).toEqual([]);
    expect(runner.running()).toEqual([]);
  });

  it('saves nothing for too little transcript even without a notes service', async () => {
    const { runner, saved } = setup({ chat: null, sentences: [sentence(1), sentence(2, { startMs: 20_000, endMs: 40_000 })] });
    runner.start(ID);
    await settle();
    await settle();
    expect(saved).toEqual([]);
  });

  it('saves the request ids of the calls a version made', async () => {
    let n = 0;
    const chat: ChatPort = async (r) => { r.onAnswered?.({ requestId: `req_${++n}` }); return ANSWER; };
    const { runner, saved } = setup({ chat });
    runner.start(ID);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ state: 'complete', requestIds: ['req_1', 'req_2', 'req_3'] });
  });
});
