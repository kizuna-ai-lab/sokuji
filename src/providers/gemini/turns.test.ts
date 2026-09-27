import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import type { GeminiConfig } from './config';
import { trackedClock } from './testing';
import { GeminiTurns, normalizeCjkSpaces } from './turns';

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

  it('interrupted starts a pending drop, as turnComplete does: the answer after it is dropped', () => {
    const { t, texts } = turns();
    t.output('A');
    t.cancelTurn();
    t.interrupted();
    t.output('B');
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

describe('Live Translate: no turns, each side on its own silence timer (ruling 1)', () => {
  const translate = (silence?: GeminiConfig['silence']) => turns({ kind: 'translate', silence });

  it('runs each side on its own pause, and states no origin (`GeminiClient.test.ts:808`)', () => {
    const { t, clock, timers, opened, closed } = translate({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
    t.input('first utterance');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
    clock.advance(699);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    t.output('最初の翻訳。');
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

  it('times the two sides independently (`:864`)', () => {
    const { t, clock, closed } = translate();
    t.input('speaking');
    t.output('translating');
    clock.advance(1000);
    t.input(' and continuing');
    clock.advance(600);
    expect(closed()).toEqual([{ ref: 2 }]);
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

  it('keeps its open segments across a reconnect, closing them on their own timers (`:914`; choice 14)', () => {
    const { t, clock, timers, closed } = translate();
    t.input('interrupted mid-sentence');
    t.connectionLost();
    expect(closed()).toEqual([]);
    expect(timers()).toBe(1);
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }]);
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
    expect(timers()).toBe(0);
    t.input('Done.');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
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

  it('typed text states no origin', () => {
    const { t, timers, opened } = translate();
    t.typed('typed words');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
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
