import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { MID_SENTENCE_HOLD_MS } from '../../lib/segmentation/continuousSegments';
import type { GeminiConfig } from './config';
import { trackedClock } from './testing';
import { GeminiTurns, normalizeCjkSpaces, writesSentenceMarks } from './turns';

function turns(o: { kind?: GeminiConfig['kind']; speech?: boolean; silence?: GeminiConfig['silence'] } = {}) {
  // `timers()` counts what has neither fired nor been cancelled: the clock rule's proof that no timer outlives what should end it.
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const kind = o.kind ?? 'dialogue';
  const silence = kind === 'translate' ? o.silence ?? { sourceMs: 1500, translationMs: 1500, deferMidSentence: false } : undefined;
  const t = new GeminiTurns({ kind, speech: o.speech ?? true, clock, silence, sink: events });
  const of = <K extends AdapterEvent['kind']>(k: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === k);
  const texts = (ref: number) => of('segmentText').filter((e) => e.payload.ref === ref).map((e) => e.payload.text);
  const opened = () => of('segmentOpened').map((e) => e.payload);
  const closed = () => of('segmentClosed').map((e) => e.payload);
  return { t, clock, timers, log, of, texts, opened, closed };
}
const pcm = (n = 160) => new Int16Array(n).fill(3);
/** A press with voice, released: what the adapter reports once its `activityEnd` goes out. */
const voiced = (t: GeminiTurns) => { t.beginTurn(); t.endTurn(); };
/** A press released without voice. */
const tap = (t: GeminiTurns) => { t.beginTurn(); t.cancelTurn(); };

describe('a dialogue model: one turn, one origin, stated', () => {
  it("a turn's source and translation share its origin; turnComplete closes both, and the next turn is t2", () => {
    const { t, texts, opened, closed } = turns();
    t.input('Hello');
    t.input(' there.');
    t.output('こんにちは。');
    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 't1' }, { ref: 2, side: 'translation', origin: 't1' }]);
    expect(texts(1)).toEqual(['Hello', 'Hello there.']);
    t.turnComplete();
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }, { ref: 2, origin: 't1' }]);
    t.input('Next');
    expect(opened()[2]).toEqual({ ref: 3, side: 'source', origin: 't2' });
  });

  it('removes the spaces Gemini 3.x puts between CJK characters, on the source side only (`GeminiClient.ts:1671-1688`)', () => {
    expect(normalizeCjkSpaces('今 天 天 气 不 错')).toBe('今天天气不错');
    expect(normalizeCjkSpaces('日本 語 と English words')).toBe('日本語と English words');
    const { t, texts } = turns();
    t.input('今 天 ');
    t.input('天 气');
    t.output('今 天');
    // The whole text each time, normalized: a trailing space before the next delta stays until a CJK character follows it.
    expect(texts(1)).toEqual(['今天 ', '今天天气']);
    // The output side is the model's own text, left as it came.
    expect(texts(2)).toEqual(['今 天']);
  });

  it("the model's audio opens the turn's translation and plays under it; a leg that does not speak drops it", () => {
    const spoken = turns();
    spoken.t.audio(pcm());
    expect(spoken.opened()).toEqual([{ ref: 1, side: 'translation', origin: 't1' }]);
    expect(spoken.of('audio').map((e) => e.payload.ref)).toEqual([1]);
    const silent = turns({ speech: false });
    silent.t.audio(pcm());
    expect(silent.log).toEqual([]);
  });

  it("ranges each played chunk by arrival: from the previous chunk's end to the text as it stood, [0, 0] before any text (Gemini/AST2 follow-up, ruling 2)", () => {
    const { t, of } = turns();
    t.audio(pcm());
    t.output('Welcome');
    t.audio(pcm());
    t.audio(pcm());
    t.output(' to real-time translation.');
    t.audio(pcm());
    t.turnComplete();
    // The next turn's translation counts from its own start.
    t.output('Next');
    t.audio(pcm());
    expect(of('audio').map((e) => [e.payload.ref, e.payload.range])).toEqual([
      [1, [0, 0]], [1, [0, 7]], [1, [7, 7]], [1, [7, 33]], [2, [0, 4]],
    ]);
  });

  it('keeps [0, 0] on the chunks of a turn whose transcript never came: its text parts are shown only at the turn\'s end', () => {
    const { t, of, texts } = turns();
    t.modelText('Bonjour');
    t.audio(pcm());
    t.audio(pcm());
    t.turnComplete();
    expect(texts(1)).toEqual(['Bonjour']);
    expect(of('audio').map((e) => e.payload.range)).toEqual([[0, 0], [0, 0]]);
  });

  it("the model's text parts stand in for a transcript that never came (`GeminiClient.ts:1094-1105`), and only then", () => {
    const bare = turns();
    bare.t.modelText('Bonjour');
    bare.t.turnComplete();
    expect(bare.opened()).toEqual([{ ref: 1, side: 'translation', origin: 't1' }]);
    expect(bare.texts(1)).toEqual(['Bonjour']);
    expect(bare.closed()).toEqual([{ ref: 1, origin: 't1' }]);
    const transcribed = turns();
    transcribed.t.output('Hi');
    transcribed.t.modelText('ignored');
    transcribed.t.turnComplete();
    expect(transcribed.texts(1)).toEqual(['Hi']);
  });

  it('interrupted closes what is open as it stands and starts the next turn — nothing is stranded open (survey §1.16.5)', () => {
    const { t, opened, closed } = turns();
    t.input('Half');
    t.output('Hal');
    t.interrupted();
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }, { ref: 2, origin: 't1' }]);
    t.output('x');
    expect(opened()[2]).toEqual({ ref: 3, side: 'translation', origin: 't2' });
  });

  it("typed text is its own source segment, opened, texted and closed at once under the turn's origin; the answer follows", () => {
    const { t, log, opened } = turns();
    t.typed('typed words');
    expect(log.map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
    expect(opened()[0]).toEqual({ ref: 1, side: 'source', origin: 't1' });
    t.output('answer');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 't1' });
  });

  it("a cancelled turn closes what it opened and drops its answer until the turn ends (ruling 8)", () => {
    const { t, log, opened, closed } = turns();
    t.input('uh');
    t.cancelTurn();
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }]);
    const n = log.length;
    t.input('more');
    t.output('an answer to a cough');
    t.audio(pcm());
    t.modelText('x');
    t.turnComplete();
    expect(log.length).toBe(n);
    t.output('the next answer');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 't2' });
  });

  it("a cancelled turn's answer is dropped until the next press when no turnComplete comes", () => {
    const { t, opened } = turns();
    t.cancelTurn();
    t.output('dropped');
    expect(opened()).toEqual([]);
    t.beginTurn();
    t.output('kept');
    expect(opened()).toEqual([{ ref: 1, side: 'translation', origin: 't2' }]);
  });

  it("typed text after a cancel is answered: it ends the cancelled turn's suppression", () => {
    const { t, opened } = turns();
    t.cancelTurn();
    t.typed('typed words');
    t.output('answer');
    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 't2' }, { ref: 2, side: 'translation', origin: 't2' }]);
  });

  it("a cancel while the previous answer streams cuts nothing: that answer ends in its own segments, then the cancelled press's own answer is dropped (ruling 8, NO_INTERRUPTION)", () => {
    const { t, log, texts, opened, closed } = turns();
    t.input('Hello');
    t.output('A');
    t.cancelTurn();
    expect(closed()).toEqual([]);
    t.output('B');
    t.audio(pcm());
    expect(texts(2)).toEqual(['A', 'AB']);
    t.turnComplete();
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }, { ref: 2, origin: 't1' }]);
    const n = log.length;
    t.output('an answer to the cancelled press');
    t.audio(pcm());
    t.turnComplete();
    expect(log.length).toBe(n);
    t.output('the next answer');
    expect(opened()[2]).toEqual({ ref: 3, side: 'translation', origin: 't2' });
  });

  it('a press made before the streaming answer ends lifts the pending drop: the answers after it are kept', () => {
    const { t, texts, opened } = turns();
    t.output('A');
    t.cancelTurn();
    t.beginTurn();
    t.output('B');
    t.turnComplete();
    t.output('C');
    expect(texts(1)).toEqual(['A', 'AB']);
    expect(opened()).toEqual([{ ref: 1, side: 'translation', origin: 't1' }, { ref: 2, side: 'translation', origin: 't2' }]);
  });

  it("a cancel after a voiced release, before its answer's first output, keeps that answer and drops only its own", () => {
    const { t, of, texts, closed } = turns();
    t.beginTurn();
    t.input('Hello');
    t.endTurn();
    t.beginTurn();
    t.cancelTurn();
    expect(closed()).toEqual([]);
    t.output('Bonjour');
    t.audio(pcm());
    t.turnComplete();
    expect(texts(2)).toEqual(['Bonjour']);
    expect(of('audio').map((e) => e.payload.ref)).toEqual([2]);
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }, { ref: 2, origin: 't1' }]);
    // The cancelled press's own answer.
    t.output('an answer to the cancelled press');
    t.turnComplete();
    t.output('the next answer');
    expect(texts(3)).toEqual(['the next answer']);
  });

  it("a cancel after typed text, before its answer's first output, keeps that answer and drops only its own", () => {
    const { t, texts } = turns();
    t.typed('hi');
    t.beginTurn();
    t.cancelTurn();
    t.output('salut');
    t.turnComplete();
    expect(texts(2)).toEqual(['salut']);
    t.output('an answer to the cancelled press');
    t.turnComplete();
    t.output('the next answer');
    expect(texts(3)).toEqual(['the next answer']);
  });

  it.each([
    ['turnComplete', (t: GeminiTurns) => t.turnComplete()],
    ['interrupted', (t: GeminiTurns) => t.interrupted()],
    ['connectionLost', (t: GeminiTurns) => t.connectionLost()],
  ])('an owed answer is no longer owed after %s: a later voiceless press drops its own answer at once', (_, end) => {
    const { t, texts, closed } = turns();
    t.input('Hello');
    t.endTurn();
    end(t);
    t.beginTurn();
    t.cancelTurn();
    t.output('an answer to the cancelled press');
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }]);
    expect(texts(2)).toEqual([]);
  });

  it.each([
    ["on a model that barges in, released before the server's interrupted (Gemini/AST2 follow-up, ruling 5)", (t: GeminiTurns) => {
      voiced(t);
      t.interrupted();
      t.turnComplete();
      tap(t);
      t.input('Again.');
    }],
    ['on a model that barges in, released after interrupted and its turnComplete — the control', (t: GeminiTurns) => {
      t.beginTurn();
      t.interrupted();
      t.turnComplete();
      t.endTurn();
      tap(t);
      t.input('Again.');
    }],
    ['on a model that barges in, typed text instead, which reaches it before the interrupted it causes (Gemini/AST2 follow-up, ruling 5)', (t: GeminiTurns) => {
      t.typed('Again.');
      t.interrupted();
      t.turnComplete();
      tap(t);
    }],
    ["under NO_INTERRUPTION, released while the answer streams, the tap after that answer's turnComplete", (t: GeminiTurns) => {
      voiced(t);
      t.output(' à tous');
      t.turnComplete();
      tap(t);
      t.input('Again.');
    }],
    ['under NO_INTERRUPTION, released while the answer streams, the tap too', (t: GeminiTurns) => {
      voiced(t);
      tap(t);
      t.output(' à tous');
      t.turnComplete();
      t.input('Again.');
    }],
    ['under NO_INTERRUPTION, released after the answer ends — the control', (t: GeminiTurns) => {
      t.output(' à tous');
      t.turnComplete();
      voiced(t);
      tap(t);
      t.input('Again.');
    }],
  ])("a second press, %s, keeps its source row and its own answer; a voiceless tap before that answer streams drops only the tap's own (ruling 8, choice 16)", (_, second) => {
    const { t, of } = turns();
    voiced(t);
    t.input('Hello');
    t.output('Bonjour');
    t.audio(pcm());
    // Up to the second press's source row: its input transcript, or the typed text's own row.
    second(t);
    t.output('Encore');
    t.audio(pcm());
    t.turnComplete();
    t.output('an answer to the tap');
    t.audio(pcm());
    t.turnComplete();
    t.output('the next answer');
    const shown = of('segmentText').map((e) => e.payload.text);
    // The second press's row, then its own answer, then — the drop ended with the tap's own answer — the next. Typed
    // text always shows its row, so there the order is what can fail: its answer, not the tap's, follows the row.
    expect(shown.slice(shown.indexOf('Again.'))).toEqual(['Again.', 'Encore', 'the next answer']);
    expect(shown).not.toContain('an answer to the tap');
    // Each kept answer's audio plays under its own translation; the tap's plays nowhere.
    const encore = of('segmentText').find((e) => e.payload.text === 'Encore')?.payload.ref;
    expect(of('audio').map((e) => e.payload.ref)).toEqual([2, encore]);
  });

  it('a press released while an earlier answer streams owes nothing across a reconnect: a tap on the new connection drops the next answer, its own', () => {
    const { t, of } = turns();
    voiced(t);
    t.output('Bonjour');
    voiced(t);
    t.connectionLost();
    tap(t);
    t.output('an answer to the tap');
    t.turnComplete();
    t.output('the next answer');
    expect(of('segmentText').map((e) => e.payload.text)).toEqual(['Bonjour', 'the next answer']);
  });

  it.each([
    ['both before any answer streams', (t: GeminiTurns) => { voiced(t); voiced(t); }],
    ['both while the same earlier answer streams', (t: GeminiTurns) => { voiced(t); t.output('Bonjour'); voiced(t); voiced(t); t.turnComplete(); }],
    ['one while an earlier answer streams, one after it ends', (t: GeminiTurns) => { voiced(t); t.output('Bonjour'); voiced(t); t.turnComplete(); voiced(t); }],
  ])("the flag's stated limit, a flag and not a count: two voiced releases waiting at once for their answers to start, %s, are one claim, so a tap before the second's answer streams (here, before either's) drops the second's answer, not its own", (_, releases) => {
    const { t, of } = turns();
    releases(t);
    tap(t);
    t.output("the first release's answer");
    t.turnComplete();
    t.output("the second release's answer");
    t.turnComplete();
    t.output('an answer to the tap');
    t.turnComplete();
    const shown = of('segmentText').map((e) => e.payload.text).filter((text) => text !== 'Bonjour');
    expect(shown).toEqual(["the first release's answer", 'an answer to the tap']);
  });

  it.each([
    ['answers an empty press: the first tap\'s queued answer takes the release\'s claim, so the release\'s row and answer are dropped and both taps\' replies show', true, ['Bonjour', 'Bonjour à tous', 'an answer to the first tap', 'an answer to the second tap']],
    ['answers no empty press: the release keeps its row and its answer', false, ['Bonjour', 'Bonjour à tous', 'Again.', 'Encore']],
  ])("the flag's stated limit, a tap's queued answer: within one streaming answer, a tap, a voiced press that ends its pending drop and is released, then a tap — on a model that %s", (_, answersTaps, expected) => {
    const { t, of } = turns();
    voiced(t);
    t.output('Bonjour');
    tap(t);
    voiced(t);
    tap(t);
    t.output(' à tous');
    t.turnComplete();
    if (answersTaps) {
      t.output('an answer to the first tap');
      t.turnComplete();
    }
    t.input('Again.');
    t.output('Encore');
    t.turnComplete();
    if (answersTaps) {
      t.output('an answer to the second tap');
      t.turnComplete();
    }
    expect(of('segmentText').map((e) => e.payload.text)).toEqual(expected);
  });

  it("the model's audio marks its answer streaming, on a leg that does not speak too: a cancel then waits for it", () => {
    const { t, texts, closed } = turns({ speech: false });
    t.input('Hello');
    t.audio(pcm());
    t.cancelTurn();
    expect(closed()).toEqual([]);
    t.turnComplete();
    t.output('an answer to the cancelled press');
    expect(texts(2)).toEqual([]);
  });

  it("the model's text parts mark its answer streaming: a cancel then waits for it", () => {
    const { t, texts, closed } = turns();
    t.input('Hello');
    t.modelText('Bonjour');
    t.cancelTurn();
    expect(closed()).toEqual([]);
    t.turnComplete();
    expect(texts(2)).toEqual(['Bonjour']);
    t.output('an answer to the cancelled press');
    expect(texts(3)).toEqual([]);
  });

  it('a reconnect ends an active drop: the next answer is kept', () => {
    const { t, texts } = turns();
    t.input('uh');
    t.cancelTurn();
    t.connectionLost();
    t.output('kept');
    expect(texts(2)).toEqual(['kept']);
  });

  it('a reconnect ends a pending drop: the answer after it is kept', () => {
    const { t, texts } = turns();
    t.output('A');
    t.cancelTurn();
    t.connectionLost();
    t.output('B');
    t.turnComplete();
    t.output('C');
    expect([texts(1), texts(2), texts(3)]).toEqual([['A'], ['B'], ['C']]);
  });

  it('typed text ends a pending drop: the answer after the streaming one is kept', () => {
    const { t, texts } = turns();
    t.output('A');
    t.cancelTurn();
    t.typed('x');
    t.turnComplete();
    t.output('B');
    expect(texts(3)).toEqual(['B']);
  });

  it('interrupted ends an active drop, as turnComplete does: the next answer is kept', () => {
    const { t, texts } = turns();
    t.input('uh');
    t.cancelTurn();
    t.interrupted();
    t.output('kept');
    expect(texts(2)).toEqual(['kept']);
  });

  it('an interrupted that ends an active drop is one end with its trailing turnComplete: the next answer is kept, in turn t2', () => {
    const { t, opened } = turns();
    t.input('uh');
    t.cancelTurn();
    t.interrupted();
    t.turnComplete();
    t.output('kept');
    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 't1' }, { ref: 2, side: 'translation', origin: 't2' }]);
  });

  it('interrupted starts a pending drop, as turnComplete does: the answer after it is dropped', () => {
    const { t, texts } = turns();
    t.output('A');
    t.cancelTurn();
    t.interrupted();
    t.output('B');
    expect(texts(2)).toEqual([]);
  });

  it.each([
    ["before the server's interrupted", (t: GeminiTurns) => { t.cancelTurn(); t.interrupted(); t.turnComplete(); }],
    ['between interrupted and its turnComplete', (t: GeminiTurns) => { t.interrupted(); t.cancelTurn(); t.turnComplete(); }],
  ])("on a model that barges in, a voiceless press released %s still drops its own answer: interrupted and its trailing turnComplete are one end (Gemini/AST2 follow-up, ruling 5; ruling 8)", (_, release) => {
    const { t, log, texts, closed } = turns();
    t.beginTurn();
    t.input('Hello');
    t.endTurn();
    t.output('Bonjour');
    // The voiceless press's activityStart cuts the streaming answer: 3.8 sends interrupted, then turnComplete 5 ms later.
    t.beginTurn();
    release(t);
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }, { ref: 2, origin: 't1' }]);
    const n = log.length;
    t.output('an answer to the cancelled press');
    t.audio(pcm());
    t.turnComplete();
    expect(log.length).toBe(n);
    t.output('the next answer');
    expect(texts(3)).toEqual(['the next answer']);
  });

  it('on a model that barges in, interrupted and its trailing turnComplete end one answer, not two: the next turn is t2 and its answer is shown (Gemini/AST2 follow-up, ruling 5)', () => {
    const { t, texts, opened, closed } = turns();
    t.input('Hello');
    t.output('Bonjour');
    t.interrupted();
    t.turnComplete();
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }, { ref: 2, origin: 't1' }]);
    t.input('Again');
    t.output('Encore');
    expect(opened().slice(2)).toEqual([{ ref: 3, side: 'source', origin: 't2' }, { ref: 4, side: 'translation', origin: 't2' }]);
    expect(texts(4)).toEqual(['Encore']);
  });

  it.each([
    ['an input transcript', (t: GeminiTurns) => t.input('Again')],
    ['an output transcript', (t: GeminiTurns) => t.output('Encore')],
    ['audio', (t: GeminiTurns) => t.audio(pcm())],
    ['a text part', (t: GeminiTurns) => t.modelText('Encore')],
    ['typed text', (t: GeminiTurns) => t.typed('again')],
  ])('a turnComplete after interrupted with %s in between is an answer of its own ending: the turn after it is t3', (_, content) => {
    const { t, opened } = turns();
    t.output('Bonjour');
    t.interrupted();
    content(t);
    t.turnComplete();
    t.output('the next answer');
    const all = opened();
    expect(all[all.length - 1]).toMatchObject({ side: 'translation', origin: 't3' });
  });

  it("content a drop swallows still counts as content: the turnComplete after it ends the cancelled press's answer, and the next answer is shown", () => {
    const { t, texts } = turns();
    t.output('A');
    t.cancelTurn();
    t.interrupted();
    t.output('an answer to the cancelled press');
    t.turnComplete();
    t.output('the next answer');
    expect(texts(2)).toEqual(['the next answer']);
  });

  it("a reconnect after interrupted: the new connection's first turnComplete ends an answer of its own", () => {
    const { t, texts } = turns();
    t.output('A');
    t.interrupted();
    t.connectionLost();
    // A voiced press on the new connection, answered with nothing but its turnComplete: that answer is no longer owed.
    t.endTurn();
    t.turnComplete();
    t.beginTurn();
    t.cancelTurn();
    t.output('an answer to the cancelled press');
    expect(texts(2)).toEqual([]);
  });

  it('a reconnect closes a turn in flight as it stands; the next content opens new refs (choice 14)', () => {
    const { t, opened, closed } = turns();
    t.input('Hel');
    t.output('He');
    t.connectionLost();
    expect(closed()).toEqual([{ ref: 1, origin: 't1' }, { ref: 2, origin: 't1' }]);
    t.input('lo');
    expect(opened()[2]).toEqual({ ref: 3, side: 'source', origin: 't2' });
  });

  it('runs no timer: a dialogue turn waits for its turnComplete however long (`GeminiClient.test.ts:854`)', () => {
    const { t, clock, timers, closed } = turns();
    t.input('hello');
    t.output('bonjour');
    t.audio(pcm());
    t.modelText('bonjour');
    expect(timers()).toBe(0);
    clock.advance(60_000);
    expect(closed()).toEqual([]);
  });
});

describe("Live Translate: no turns — the source on its own silence timer, the translation at the source's cuts (ruling 1; Stage 2 translation cuts, ruling 3)", () => {
  const translate = (silence?: GeminiConfig['silence']) => turns({ kind: 'translate', silence });

  it('runs the source on its own pause, stating its origin, and the translation states that source (`GeminiClient.test.ts:808`; Stage 2 translation cuts, ruling 2)', () => {
    const { t, clock, timers, opened, closed } = translate({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
    t.input('first utterance');
    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 's1' }]);
    clock.advance(699);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    t.output('最初の翻訳。');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
    clock.advance(2499);
    expect(closed()).toHaveLength(1);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);
  });

  it('keeps one segment while the speaker keeps going, and opens a new one after quiet (`:827`, `:841`)', () => {
    const { t, clock, timers, texts, opened } = translate();
    t.input('one ');
    clock.advance(1400);
    t.input('two ');
    clock.advance(1400);
    t.input('three');
    // Each delta replaces the side's countdown rather than stacking another.
    expect(timers()).toBe(1);
    expect(texts(1)).toEqual(['one ', 'one two ', 'one two three']);
    clock.advance(1500);
    t.input('second utterance');
    expect(opened().map((o) => o.ref)).toEqual([1, 2]);
    expect(texts(2)).toEqual(['second utterance']);
  });

  it("cuts the translation where the source was, when the interpreter pauses less than the speaker, and reads the source with its CJK spaces removed (Stage 2 translation cuts, rulings 1, 3)", () => {
    const { t, clock, opened, closed, texts } = translate();
    t.input('第 一 句');
    clock.advance(1000);
    t.input(' 话 。');
    clock.advance(200);
    t.output('The first');
    clock.advance(600);
    t.output(' sentence.');
    // The speaker pauses 2 s, past the source's 1.5 s; the interpreter's pause, 1.4 s, is inside its own.
    clock.advance(1200);
    t.input('第 二 句 。');
    clock.advance(200);
    t.output(' The second.');
    expect(texts(1)).toEqual(['第一句', '第一句话。']);
    expect(opened()).toEqual([
      { ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' },
      { ref: 3, side: 'source', origin: 's3' }, { ref: 4, side: 'translation', origin: 's3' },
    ]);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('a translation with no cut owed waits for the source still open, then closes for its cut (`:864`; Stage 2 translation cuts, choice 7)', () => {
    const { t, clock, closed } = translate();
    t.input('speaking');
    t.output('translating.');
    clock.advance(1000);
    t.input(' and continuing');
    clock.advance(600);
    expect(closed()).toEqual([]);
    clock.advance(900);
    expect(closed()).toEqual([{ ref: 1 }]);
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('audio never holds a timer open: it streams straight through pauses (`:881`)', () => {
    const { t, clock, closed } = translate();
    t.output('translated text');
    for (let i = 0; i < 10; i++) {
      t.audio(pcm());
      clock.advance(250);
    }
    expect(closed()).toEqual([{ ref: 1 }]);
  });

  it(`once its stream has shown a sentence end, a translation that stops mid-sentence waits to ${MID_SENTENCE_HOLD_MS} ms after its last text, not its pause (Stage 2 translation cuts, choice 6)`, () => {
    const { t, clock, closed } = translate();
    t.output('Il a dit. Et que');
    clock.advance(1500);
    expect(closed()).toEqual([]);
    clock.advance(MID_SENTENCE_HOLD_MS - 1500);
    expect(closed()).toEqual([{ ref: 1 }]);
  });

  it("audio outside an open translation plays with no ref; inside one it is that segment's (choice 8)", () => {
    const { t, clock, timers, of, opened } = translate();
    t.audio(pcm());
    expect(opened()).toEqual([]);
    expect(timers()).toBe(0);
    t.output('first');
    t.audio(pcm());
    clock.advance(1500);
    t.audio(pcm());
    expect(of('audio').map((e) => e.payload.ref)).toEqual([undefined, 1, undefined]);
    expect(timers()).toBe(0);
  });

  it('ranges the audio inside an open translation by arrival — a chunk with no new text is zero-width — and audio outside one carries neither ref nor range (Gemini/AST2 follow-up, ruling 2; choice 7)', () => {
    const { t, clock, of } = translate();
    // The probe's Live Translate stream: a 250 ms chunk every 250 ms, silence included; its text 0–0.3 s ahead.
    t.audio(pcm());
    t.output('Real-time Funky');
    t.audio(pcm());
    t.audio(pcm());
    t.output(' it is, so');
    t.audio(pcm());
    clock.advance(1500);
    t.audio(pcm());
    expect(of('audio').map((e) => e.payload)).toEqual([
      { pcm: pcm() },
      { pcm: pcm(), ref: 1, range: [0, 15] },
      { pcm: pcm(), ref: 1, range: [15, 15] },
      { pcm: pcm(), ref: 1, range: [15, 25] },
      { pcm: pcm() },
    ]);
  });

  it('keeps its open segments across a reconnect, closing them on their own timers, and the cut a source owes (`:914`; choice 14; Stage 2 translation cuts, choice 12)', () => {
    const { t, clock, timers, closed, opened } = translate();
    t.input('interrupted mid-sentence');
    t.connectionLost();
    expect(closed()).toEqual([]);
    expect(timers()).toBe(1);
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }]);
    t.output('Cut short.');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);
  });

  it('under sentence mode a mid-sentence pause waits while the text grows, and closes once it stops (choice 7)', () => {
    const { t, clock, timers, closed } = translate({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    t.input('He said that');
    clock.advance(1000);
    expect(closed()).toEqual([]);
    t.input(' we should');
    clock.advance(1000);
    expect(closed()).toEqual([]);
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }]);
    t.input('Done.');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    // Each closed source gave the translation its pause to begin (Stage 2 translation cuts, choice 8).
    clock.advance(1000);
    expect(timers()).toBe(0);
  });

  it("under sentence mode each segment starts its own deferral: the next one's repeated mid-sentence tail still gets its extra window", () => {
    const { t, clock, closed } = translate({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    t.input('He said that');
    clock.advance(2000);
    expect(closed()).toEqual([{ ref: 1 }]);
    t.input('He said that');
    clock.advance(1000);
    expect(closed()).toHaveLength(1);
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('without sentence mode a mid-sentence pause closes at once', () => {
    const { t, clock, closed } = translate({ sourceMs: 1000, translationMs: 1000, deferMidSentence: false });
    t.input('He said that');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }]);
  });

  it('a turnComplete or an interrupted, should Live Translate send one, closes the source and settles the translation for it (Stage 2 translation cuts, choice 12)', () => {
    const { t, timers, opened, closed } = translate();
    t.input('你好');
    t.output('Hello');
    t.turnComplete();
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    t.input('再见');
    t.output('Bye');
    t.interrupted();
    expect(opened()[3]).toEqual({ ref: 4, side: 'translation', origin: 's3' });
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
    expect(timers()).toBe(0);
  });

  it('typed text is a row of its own: it states no origin, owes no cut, and takes a ref no other segment has (Stage 2 translation cuts, choice 12)', () => {
    const { t, timers, opened } = translate();
    t.typed('typed words');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
    expect(timers()).toBe(0);
    t.input('spoken');
    t.typed('more words');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'source', origin: 's2' }, { ref: 3, side: 'source' }]);
  });

  it('reads a target as writing sentence-final marks but Thai and Lao, by its base language (Stage 2 translation cuts, choice 6)', () => {
    expect(writesSentenceMarks('th')).toBe(false);
    expect(writesSentenceMarks('lo')).toBe(false);
    expect(writesSentenceMarks('th-TH')).toBe(false);
    expect(writesSentenceMarks('km')).toBe(true);
    expect(writesSentenceMarks('ja')).toBe(true);
    expect(writesSentenceMarks('zh-Hant')).toBe(true);
    expect(writesSentenceMarks(undefined)).toBe(true);
  });

  it('with no mid-sentence hold, a translation that stops mid-sentence closes at its pause, a sentence end shown or not (Stage 2 translation cuts, choice 6)', () => {
    const { clock, timers } = trackedClock();
    const { events, log } = recordEvents();
    const t = new GeminiTurns({ kind: 'translate', speech: true, clock, silence: { sourceMs: 1500, translationMs: 1500, deferMidSentence: false }, sink: events, holdMidSentence: false });
    t.output('ใช่ไหม? แล้วก็');
    clock.advance(1_500);
    expect(log.filter((e) => e.kind === 'segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
    expect(timers()).toBe(0);
  });

  it('is Live Translate by its kind alone: with no pauses given it takes the default ones, and its audio still opens no translation (Stage 2 translation cuts, ruling 3)', () => {
    const { clock, timers } = trackedClock();
    const { events, log } = recordEvents();
    const t = new GeminiTurns({ kind: 'translate', speech: true, clock, sink: events });
    t.audio(pcm());
    t.input('你好');
    expect(log.map((e) => e.kind)).toEqual(['audio', 'segmentOpened', 'segmentText']);
    expect(log[1].payload).toEqual({ ref: 1, side: 'source', origin: 's1' });
    clock.advance(1_499);
    expect(log).toHaveLength(3);
    clock.advance(1);
    expect(log[3].payload).toEqual({ ref: 1 });
    // Its pause to begin a translation, then nothing is left.
    clock.advance(1_500);
    expect(timers()).toBe(0);
  });

  it("ignores the model's text parts: its translation is the output transcript alone", () => {
    const { t, log } = translate();
    t.modelText('a text part');
    t.turnComplete();
    expect(log).toEqual([]);
  });

  it('a cancel closes nothing and drops nothing: its output belongs to no press (choice 16)', () => {
    const { t, clock, timers, texts, closed } = translate();
    t.output('streaming');
    t.cancelTurn();
    expect(timers()).toBe(1);
    t.output(' on');
    expect(texts(1)).toEqual(['streaming', 'streaming on']);
    expect(closed()).toEqual([]);
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }]);
    expect(timers()).toBe(0);
  });

  it('stop cancels every timer and emits nothing after it', () => {
    const { t, clock, timers, log } = translate();
    t.input('speaking');
    t.output('translating');
    expect(timers()).toBe(2);
    const n = log.length;
    t.stop();
    expect(timers()).toBe(0);
    clock.advance(10_000);
    t.input('late');
    t.output('late');
    t.audio(pcm());
    t.typed('late');
    t.turnComplete();
    expect(timers()).toBe(0);
    expect(log.length).toBe(n);
  });

  it('a timer re-armed by the deferral is cancelled by stop too', () => {
    const { t, clock, timers, log } = translate({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    t.input('He said that');
    clock.advance(1000);
    // The deferral re-armed the source's countdown for one more window.
    expect(timers()).toBe(1);
    const n = log.length;
    t.stop();
    expect(timers()).toBe(0);
    clock.advance(10_000);
    expect(log.length).toBe(n);
  });
});
