// Writing one version of a record's notes: parts, retries, the finishing call, the names step and the program's rules.
import { describe, it, expect, vi } from 'vitest';
import type { HistorySentence } from '../history/types';
import { ChatError, type ChatPort, type ChatRequest } from './chat';
import { finishPrompt, namesPrompt, NOTES_PROMPT_VERSION, partPrompt } from './prompts';
import { cutParts, NOTES_MIN_MS, writeNotes } from './write';

const LANGUAGE = { code: 'ja', name: 'Japanese' };
const MIN = 60_000;

const sentence = (n: number, startMs: number, o: Partial<HistorySentence> = {}): HistorySentence => ({
  n, segmentId: null, side: 'other', sideCertain: true, track: 'other', speaker: 'Other side 1', speakerByUser: null,
  speakerName: null, startMs, endMs: startMs + 10_000, text: `sentence ${n}`, language: 'ja', timeKind: 'given', translation: null, ...o,
});

/** One sentence a minute: `count` of them. */
const everyMinute = (count: number) => Array.from({ length: count }, (_, i) => sentence(i + 1, i * MIN));

/** 65 minutes, a sentence every 30 s, with a longer pause before sentence 42 (20.8 min) and sentence 91 (45.7 min). */
const withPauses = () =>
  Array.from({ length: 130 }, (_, i) => sentence(i + 1, i * 30_000 + (i >= 41 ? 20_000 : 0) + (i >= 90 ? 20_000 : 0)));

type Handler = (user: any, call: ChatRequest) => unknown;
type PartUser = { sentences: Array<{ sid: number }>; part?: { index: number } };

/** One topic per part: it opens at the part's first sentence and has one plain point at its second. */
const onePointPerPart: Handler = (user: PartUser) => {
  const index = user.part?.index ?? 1;
  return {
    title: `Part ${index}`, summary: `About part ${index}.`,
    topics: [{ title: `Topic ${index}`, sid: user.sentences[0].sid, summary: `Topic ${index} summary.`, points: [{ text: `Point ${index}`, sid: user.sentences[1].sid, kinds: [] }] }],
  };
};

/** A fake notes model: answers by which prompt it was given. */
function fakeChat(h: { part?: Handler; finish?: Handler; names?: Handler } = {}) {
  // The tests read what was sent; its shape is the code under test's to decide.
  const calls: Array<ChatRequest & { user: any }> = [];
  const chat: ChatPort = async (r) => {
    calls.push(r);
    if (r.system === finishPrompt(LANGUAGE.name)) return (h.finish ?? (() => ({ join: [], drop: [], merge: [] })))(r.user, r);
    if (r.system === namesPrompt()) return (h.names ?? (() => ({ items: [] })))(r.user, r);
    return (h.part ?? onePointPerPart)(r.user, r);
  };
  const of = (kind: 'part' | 'finish' | 'names') => calls.filter((c) =>
    kind === 'finish' ? c.system === finishPrompt(LANGUAGE.name) : kind === 'names' ? c.system === namesPrompt() : c.system !== finishPrompt(LANGUAGE.name) && c.system !== namesPrompt());
  return { chat, calls, of };
}

const write = (sentences: HistorySentence[], chat: ChatPort, signal = new AbortController().signal) =>
  writeNotes({ sentences, speakerLabel: (s) => s.speaker, language: LANGUAGE, chat, signal });

describe('cutting a transcript into parts', () => {
  it('keeps a recording under thirty minutes in one part', () => {
    expect(cutParts(everyMinute(26)).map((p) => p.length)).toEqual([26]);
  });

  // Half an hour is where a transcript starts to be sent in parts of about twenty minutes.
  it('sends a transcript in one part up to half an hour, and in parts from half an hour on', () => {
    expect(cutParts(everyMinute(30)).map((p) => p.length)).toEqual([30]);
    const parts = cutParts(everyMinute(31));
    expect(parts).toHaveLength(2);
    expect(parts.flat().map((x) => x.n)).toEqual(everyMinute(31).map((x) => x.n));
  });

  it('cuts 65 minutes into three parts at the longest pause near each mark', () => {
    const parts = cutParts(withPauses());
    expect(parts.map((p) => p[0].n)).toEqual([1, 42, 91]);
    expect(parts.flat()).toHaveLength(130);
  });
});

describe('writing the notes', () => {
  it("hands every part, the finishing call and the names step the word list's spellings, and nothing without one", async () => {
    const model = fakeChat();
    const names = [{ written: 'Kizuna AI', heardAs: 'kizuna eye' }, { written: 'Sokuji', translation: '速记' }];
    await writeNotes({ sentences: withPauses(), speakerLabel: (s) => s.speaker, language: LANGUAGE, chat: model.chat, signal: new AbortController().signal, names });
    const wire = [{ written: 'Kizuna AI', heard_as: 'kizuna eye' }, { written: 'Sokuji' }];
    expect(model.of('part').length).toBeGreaterThan(1);
    for (const kind of ['part', 'finish', 'names'] as const) for (const c of model.of(kind)) expect(c.user.names, kind).toEqual(wire);
    const plain = fakeChat();
    await write(everyMinute(26), plain.chat);
    for (const c of plain.calls) expect(c.user).not.toHaveProperty('names');
  });

  // Owner, 2026-11-18: with no reasoning, notes of Japanese speech asked for in Chinese came out in Japanese, or in
  // Traditional Chinese, in most runs (16 of 20 on five recorded sessions); a little reasoning wrote Simplified Chinese in
  // all 20. The finishing call keeps its own, higher effort.
  it('writes each part with a little reasoning, so the notes keep to the language asked for', async () => {
    const model = fakeChat();
    await write(withPauses(), model.chat);
    expect(model.of('part').length).toBeGreaterThan(1);
    for (const c of model.of('part')) expect(c.effort).toBe('low');
    for (const c of model.of('finish')) expect(c.effort).toBe('medium');
  });

  it('writes a short recording in one part and keeps its title', async () => {
    const model = fakeChat();
    const result = await write(everyMinute(26), model.chat);
    const [part] = model.of('part');
    expect(model.of('part')).toHaveLength(1);
    expect(part.system).toBe(partPrompt('Japanese', false));
    expect(part.effort).toBe('low');
    expect(part.maxTokens).toBe(32000);
    expect(part.user).toEqual({
      output_language: 'ja',
      sentences: everyMinute(26).map((s) => ({ sid: s.n, speaker: 'Other side 1', text: s.text })),
      candidates: [],
    });
    expect(result).toEqual({
      ok: true,
      requestIds: [],
      body: {
        title: 'Part 1', overview: { text: 'About part 1.', format: 'plain' },
        topics: [{ title: 'Topic 1', summary: 'Topic 1 summary.', first: 1 }],
        points: [{ topic: 0, text: 'Point 1', sentences: [2], kinds: [] }],
        names: [],
      },
    });
  });

  it('sends the parts of a long recording at once and says which part each is', async () => {
    const model = fakeChat();
    const result = await write(withPauses(), model.chat);
    const parts = model.of('part');
    expect(parts.map((c) => c.user.part)).toEqual([{ index: 1, of: 3 }, { index: 2, of: 3 }, { index: 3, of: 3 }]);
    expect(parts.every((c) => c.system === partPrompt('Japanese', true))).toBe(true);
    expect(parts[1].user.sentences[0]).toEqual({ sid: 42, speaker: 'Other side 1', text: 'sentence 42' });
    expect(result.ok && result.body.topics.map((t) => t.first)).toEqual([1, 42, 91]);
  });

  it('tries a failing part twice more', async () => {
    let tries = 0;
    const model = fakeChat({ part: (user, call) => (++tries < 3 ? Promise.reject(new ChatError('Bad gateway', { status: 502 })) : onePointPerPart(user, call)) });
    const result = await write(everyMinute(26), model.chat);
    expect(model.of('part')).toHaveLength(3);
    expect(result.ok).toBe(true);
  });

  it('fails the version with the service\'s words when a part fails three times', async () => {
    const model = fakeChat({ part: () => Promise.reject(new ChatError('busy', { status: 503, serviceMessage: 'The server is overloaded.' })) });
    await expect(write(everyMinute(26), model.chat)).resolves.toEqual({ ok: false, failure: 'The server is overloaded.', requestIds: [] });
    expect(model.of('part')).toHaveLength(3);
    expect(model.of('finish')).toHaveLength(0);
  });

  // One part of several failing is the whole version failing: no notes from the other parts are kept.
  it('fails the whole version when one part of several fails three times, and finishes nothing', async () => {
    const model = fakeChat({
      part: (user: PartUser, call) => (user.part?.index === 2
        ? Promise.reject(new ChatError('busy', { status: 503, serviceMessage: 'The server is overloaded.' }))
        : onePointPerPart(user, call)),
    });
    await expect(write(withPauses(), model.chat)).resolves.toEqual({ ok: false, failure: 'The server is overloaded.', requestIds: [] });
    expect(model.of('part').filter((c) => (c.user as PartUser).part?.index === 2)).toHaveLength(3);
    expect(model.of('finish')).toHaveLength(0);
  });

  it('fails the version when the model wrote no topic', async () => {
    const model = fakeChat({ part: () => ({ title: 'T', summary: 'S', topics: [] }) });
    const result = await write(everyMinute(26), model.chat);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && 'failure' in result && result.failure.length > 0).toBe(true);
  });

  it('moves a point whose sentence number is unknown to the nearest sentence and marks it', async () => {
    const model = fakeChat({
      part: () => ({
        title: 'T', summary: 'S',
        topics: [{ title: 'A', sid: 1, summary: 'a', points: [{ text: 'Known', sid: 3, kinds: [] }, { text: 'Too far', sid: 999, kinds: [] }, { text: 'No number', sid: 'x', kinds: [] }, { text: '  ', sid: 4, kinds: [] }] }],
      }),
    });
    const result = await write(everyMinute(26), model.chat);
    expect(result.ok && result.body.points).toEqual([
      { topic: 0, text: 'Known', sentences: [3], kinds: [] },
      { topic: 0, text: 'Too far', sentences: [26], kinds: [], anchorMoved: true },
      { topic: 0, text: 'No number', sentences: [1], kinds: [], anchorMoved: true },
    ]);
  });

  it('starts a topic at its own sentence unless that comes after its first point', async () => {
    const model = fakeChat({
      part: () => ({
        title: 'T', summary: 'S',
        topics: [
          { title: 'A', sid: 2, summary: 'a', points: [{ text: 'a1', sid: 3, kinds: [] }] },
          { title: 'B', sid: 9, summary: 'b', points: [{ text: 'b1', sid: 6, kinds: [] }] },
          { title: 'C', sid: 12, summary: 'c', points: [] },
        ],
      }),
    });
    const result = await write(everyMinute(26), model.chat);
    expect(result.ok && result.body.topics.map((t) => t.first)).toEqual([2, 6, 12]);
  });

  it('keeps only the three kinds, and cuts an owner that is a speaker label back to its side', async () => {
    const sentences = everyMinute(26).map((s) => (s.n === 5 ? { ...s, speaker: 'Other side 2' } : s));
    const model = fakeChat({
      part: () => ({
        title: 'T', summary: 'S',
        topics: [{ title: 'A', sid: 1, summary: 'a', points: [
          { text: 'Send the draft', sid: 5, kinds: ['todo', 'idea'], owner: 'Other side 2', due: 'Friday' },
          { text: 'Book the room', sid: 6, kinds: ['todo'], owner: 'Bob', due: null },
        ] }],
      }),
    });
    const result = await write(sentences, model.chat);
    expect(result.ok && result.body.points).toEqual([
      { topic: 0, text: 'Send the draft', sentences: [5], kinds: ['todo'], owner: 'Other side', due: 'Friday' },
      { topic: 0, text: 'Book the room', sentences: [6], kinds: ['todo'], owner: 'Bob', due: null },
    ]);
  });

  it('joins a topic cut by a part boundary, and only that', async () => {
    const model = fakeChat({
      finish: () => ({
        title: 'Whole', summary: 'All of it.',
        join: [{ first: 1, second: 2, title: 'Topic 1 and 2', summary: 'Both.' }, { first: 2, second: 3, title: 'No', summary: 'No.' }],
        drop: [], merge: [],
      }),
    });
    const result = await write(withPauses(), model.chat);
    const finish = model.of('finish')[0];
    expect(finish.effort).toBe('medium');
    expect(finish.user).toEqual({
      output_language: 'ja',
      topics: [1, 2, 3].map((n) => ({ n, part: n, title: `Topic ${n}`, summary: `Topic ${n} summary.` })),
      points: [1, 2, 3].map((n) => ({ id: `p${n}`, topic: n, text: `Point ${n}`, kinds: [] })),
    });
    expect(result.ok && result.body.title).toBe('Whole');
    expect(result.ok && result.body.overview.text).toBe('All of it.');
    expect(result.ok && result.body.topics).toEqual([
      { title: 'Topic 1 and 2', summary: 'Both.', first: 1 },
      { title: 'Topic 3', summary: 'Topic 3 summary.', first: 91 },
    ]);
    expect(result.ok && result.body.points.map((p) => [p.text, p.topic])).toEqual([['Point 1', 0], ['Point 2', 0], ['Point 3', 1]]);
  });

  it('drops a mark that no longer holds and merges marks about the same thing', async () => {
    const sentences = everyMinute(26).map((s) => (s.n === 7 ? { ...s, speaker: 'Other side 2' } : s));
    const model = fakeChat({
      part: () => ({
        title: 'T', summary: 'S',
        topics: [{ title: 'A', sid: 1, summary: 'a', points: [
          { text: 'Send the draft by Friday', sid: 2, kinds: ['todo'], owner: null, due: 'Friday' },
          { text: 'Send the draft by Monday instead', sid: 7, kinds: ['todo'], owner: null, due: 'Monday' },
          { text: 'Ship in May', sid: 8, kinds: ['decision'] },
        ] }],
      }),
      finish: () => ({
        title: 'Ignored for one part', summary: 'Ignored.', join: [],
        drop: [{ id: 'p3', kind: 'decision' }, { id: 'p3', kind: 'risk' }],
        merge: [{ kind: 'todo', keep: 'p1', same: ['p2'], text: 'Send the draft by Monday', owner: 'Other side 2', due: 'Monday' }],
      }),
    });
    const result = await write(sentences, model.chat);
    expect(model.of('finish')[0].user.points[0]).toEqual({ id: 'p1', topic: 1, text: 'Send the draft by Friday', kinds: ['todo'], owner: null, due: 'Friday' });
    expect(result.ok && result.body.title).toBe('T');
    expect(result.ok && result.body.points).toEqual([
      { topic: 0, text: 'Send the draft by Monday', sentences: [2], kinds: ['todo'], owner: 'Other side', due: 'Monday' },
      { topic: 0, text: 'Send the draft by Monday instead', sentences: [7], kinds: [], owner: null, due: 'Monday', was: ['todo'] },
      { topic: 0, text: 'Ship in May', sentences: [8], kinds: [], was: ['decision'] },
    ]);
  });

  // The same decision taken up again in a later part is one decision in the notes; a to-do called off is
  // a plain point, with no to-do mark left on it.
  it('keeps one decision met in two parts, and leaves a to-do called off without its mark', async () => {
    const model = fakeChat({
      part: (user: PartUser) => {
        const index = user.part?.index ?? 1;
        const [first, second] = [user.sentences[0].sid, user.sentences[1].sid];
        return {
          title: `Part ${index}`, summary: 'S',
          topics: [{ title: `Topic ${index}`, sid: first, summary: 's', points: index === 1
            ? [{ text: 'Ship in May', sid: second, kinds: ['decision'] }, { text: 'Book the hall', sid: first, kinds: ['todo'], owner: null, due: null }]
            : [{ text: 'Shipping in May stands', sid: second, kinds: ['decision'] }] }],
        };
      },
      finish: () => ({
        title: 'Whole', summary: 'All.', join: [],
        drop: [{ id: 'p2', kind: 'todo' }],
        merge: [{ kind: 'decision', keep: 'p1', same: ['p3'], text: 'Ship in May' }],
      }),
    });
    const result = await write(withPauses().slice(0, 90), model.chat);
    expect(result.ok).toBe(true);
    const points = result.ok ? result.body.points : [];
    expect(points.filter((p) => p.kinds.includes('decision')).map((p) => p.text)).toEqual(['Ship in May']);
    expect(points.find((p) => p.text === 'Shipping in May stands')).toMatchObject({ kinds: [], was: ['decision'] });
    expect(points.find((p) => p.text === 'Book the hall')).toMatchObject({ kinds: [], was: ['todo'] });
  });

  it('keeps the parts\' notes when the finishing call fails', async () => {
    const model = fakeChat({ finish: () => Promise.reject(new ChatError('Bad gateway', { status: 502 })) });
    const result = await write(withPauses(), model.chat);
    expect(model.of('finish')).toHaveLength(3);
    expect(result.ok && result.body.title).toBe('Part 1');
    expect(result.ok && result.body.topics).toHaveLength(3);
  });

  it('lists names that may be misspelled, not the ones written as suggested', async () => {
    const model = fakeChat({
      names: (user) => ({ items: user.sentences[0].sid !== 1 ? [] : [
        { sid: 3, heard: 'Kizuna', meant: 'Kizuna', why: 'same' },
        { sid: 4, heard: 'Soku G', meant: 'Sokuji', why: 'the app is named later' },
        { sid: 9, heard: 'Soku G', meant: 'Sokuji', why: 'again' },
        { sid: 999, heard: 'Nowhere', meant: 'Somewhere', why: 'no such sentence' },
        { sid: 5, heard: 'Tanaka-san', meant: null, why: 'unclear' },
      ] }),
    });
    const result = await write(everyMinute(26), model.chat);
    const names = model.of('names');
    expect(names.map((c) => c.user.sentences.length)).toEqual([20, 6]);
    expect(names[0].effort).toBe('medium');
    expect(names[0].user).toEqual({ sentences: everyMinute(20).map((s) => ({ sid: s.n, speaker: 'Other side 1', text: s.text })) });
    expect(result.ok && result.body.names).toEqual([
      { written: 'Soku G', likely: 'Sokuji', sentences: [4, 9] },
      { written: 'Tanaka-san', likely: null, sentences: [5] },
    ]);
  });

  it('asks for names one twenty-minute part at a time, and goes on without them when that fails', async () => {
    const model = fakeChat({ names: () => Promise.reject(new ChatError('Bad gateway', { status: 502 })) });
    const result = await write(withPauses(), model.chat);
    expect(new Set(model.of('names').map((c) => c.user.sentences[0].sid))).toEqual(new Set([1, 41, 81, 120]));
    expect(result.ok && result.body.names).toEqual([]);
  });

  // Review: after a long silence the next part starts at the twenty-minute edge after the sentence, not one edge on.
  it('asks for names once per twenty minutes that has sentences, across a long silence', async () => {
    const model = fakeChat();
    const sentences = [sentence(1, 0), sentence(2, MIN), ...Array.from({ length: 7 }, (_, i) => sentence(i + 3, (120 + i) * MIN))];
    await write(sentences, model.chat);
    expect(model.of('names').map((c) => c.user.sentences.map((x: { sid: number }) => x.sid))).toEqual([[1, 2], [3, 4, 5, 6, 7, 8, 9]]);
  });

  it('writes nothing for less than a minute', async () => {
    const model = fakeChat();
    expect(NOTES_MIN_MS).toBe(60_000);
    await expect(write([sentence(1, 0), sentence(2, 40_000)], model.chat)).resolves.toEqual({ ok: false, tooShort: true });
    await expect(write([], model.chat)).resolves.toEqual({ ok: false, tooShort: true });
    expect(model.calls).toHaveLength(0);
  });

  it('stops when it is cancelled', async () => {
    const controller = new AbortController();
    const chat: ChatPort = vi.fn((r: ChatRequest) => new Promise<unknown>((_, reject) => {
      r.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = write(everyMinute(26), chat, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('does not try again what another try cannot fix', async () => {
    const model = fakeChat({ part: () => Promise.reject(new ChatError('refused', { status: 401, serviceMessage: 'Incorrect API key provided.', retryable: false })) });
    await expect(write(everyMinute(26), model.chat)).resolves.toEqual({ ok: false, failure: 'Incorrect API key provided.', requestIds: [] });
    expect(model.of('part')).toHaveLength(1);
  });

  // No network. The browser's fetch fails with a TypeError; another try may get through, so the part is
  // tried again, and the version then fails as "could not be reached".
  it('fails the version as unreachable when the service cannot be reached, after trying again', async () => {
    const model = fakeChat({ part: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(write(everyMinute(26), model.chat)).resolves.toEqual({ ok: false, failure: 'notes:network', requestIds: [] });
    expect(model.of('part')).toHaveLength(3);
  });

  // A refusal Kizuna AI gives a code for is kept as that code, which the page words in the interface's language, not
  // as the service's English words.
  it('keeps a refusal with a code of ours as the code, not the service\'s words', async () => {
    const model = fakeChat({ part: () => Promise.reject(new ChatError('refused', { status: 402, serviceMessage: 'Insufficient balance.', code: 'no-balance', retryable: false })) });
    await expect(write(everyMinute(26), model.chat)).resolves.toEqual({ ok: false, failure: 'notes:no-balance', requestIds: [] });
  });

  it('tries again a part that wrote no topic, and fails the version when it never does', async () => {
    let tries = 0;
    const model = fakeChat({ part: (user, call) => (++tries < 2 ? { title: 'T', summary: 'S', topics: [] } : onePointPerPart(user, call)) });
    expect((await write(everyMinute(26), model.chat)).ok).toBe(true);
    expect(model.of('part')).toHaveLength(2);
    const never = fakeChat({ part: () => ({ title: 'T', summary: 'S', topics: [{ title: '', points: [] }] }) });
    await expect(write(everyMinute(26), never.chat)).resolves.toEqual({ ok: false, failure: 'notes:no-topics', requestIds: [] });
    expect(never.of('part')).toHaveLength(3);
  });

  it('numbers the sentences for the model by their places in reading order, and maps them back', async () => {
    // Both sides interleave: the store numbers sentences as they are finalized, not as they were spoken.
    const sentences = [
      sentence(1, 0, { side: 'mine', speaker: '1' }), sentence(3, 20_000), sentence(2, 40_000, { side: 'mine', speaker: '1' }),
      ...Array.from({ length: 20 }, (_, i) => sentence(4 + i, 60_000 + i * 60_000)),
    ];
    const model = fakeChat({
      part: () => ({ title: 'T', summary: 'S', topics: [{ title: 'A', sid: 1, summary: 'a', points: [{ text: 'Said third', sid: 3, kinds: [] }] }] }),
    });
    const result = await write(sentences, model.chat);
    expect(model.of('part')[0].user.sentences.slice(0, 3).map((s: { sid: number; text: string }) => [s.sid, s.text])).toEqual([[1, 'sentence 1'], [2, 'sentence 3'], [3, 'sentence 2']]);
    expect(result.ok && result.body.points[0].sentences).toEqual([2]);
  });

  it('cuts an owner back to a side only where the side is certain, whatever the speaker is called', async () => {
    const sentences = everyMinute(26).map((s) => (s.n === 5 ? { ...s, speakerName: 'Tanaka' } : s.n === 9 ? { ...s, side: 'mine' as const, speaker: '1', sideCertain: false } : s));
    const labels = (s: HistorySentence) => s.speakerName ?? (s.side === 'mine' ? 'My side' : 'Other side');
    const model = fakeChat({
      part: () => ({
        title: 'T', summary: 'S',
        topics: [{ title: 'A', sid: 1, summary: 'a', points: [
          { text: 'Send the draft', sid: 5, kinds: ['todo'], owner: 'Tanaka', due: null },
          { text: 'Book the room', sid: 9, kinds: ['todo'], owner: 'My side', due: null },
          { text: 'Call Bob', sid: 6, kinds: ['todo'], owner: 'Bob', due: null },
        ] }],
      }),
    });
    const result = await writeNotes({ sentences, speakerLabel: labels, language: LANGUAGE, chat: model.chat, signal: new AbortController().signal });
    expect(result.ok && result.body.points.map((p) => p.owner)).toEqual(['Other side', null, 'Bob']);
  });

  it('gives back the request ids of the calls it made', async () => {
    let n = 0;
    // One answer that serves every call: the part, the finishing call and the names step.
    const answer = { title: 'T', summary: 'S', topics: [{ title: 'A', sid: 1, summary: 'a', points: [{ text: 'p', sid: 2, kinds: [] }] }], join: [], drop: [], merge: [], items: [] };
    const chat: ChatPort = async (r) => { r.onAnswered?.({ requestId: `req_${++n}` }); return answer; };
    const result = await write(everyMinute(26), chat);
    expect(result).toMatchObject({ ok: true, requestIds: ['req_1', 'req_2', 'req_3', 'req_4'] });
  });

  // Hosted notes: the relay puts in its own copy of each prompt by name and version, and names the language from the data.
  it('names each call\'s prompt and its version, and gives the parts and the finish the language code', async () => {
    const model = fakeChat();
    await write(withPauses(), model.chat);
    expect(new Set(model.of('part').map((c) => c.prompt))).toEqual(new Set(['meeting-part']));
    expect(model.of('finish').map((c) => c.prompt)).toEqual(['combine-parts']);
    expect(new Set(model.of('names').map((c) => c.prompt))).toEqual(new Set(['check-names']));
    expect(new Set(model.calls.map((c) => c.promptVersion))).toEqual(new Set([NOTES_PROMPT_VERSION]));
    for (const c of [...model.of('part'), ...model.of('finish')]) expect(c.user.output_language).toBe('ja');
    const single = fakeChat();
    await write(everyMinute(5), single.chat);
    expect(single.of('part').map((c) => c.prompt)).toEqual(['whole-meeting']);
  });
});
