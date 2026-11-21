import { describe, it, expect } from 'vitest';
import type { SessionContext } from './adapter';
import { createVirtualClock } from './clock';
import type { TranslationEvents, TranslationSession, TranslationStartRequest } from './translation';
import { checkTranslation, recordTranslation, type TranslationLog, type TranslationRecord } from './translationConformance';

const context: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: false, turns: 'auto' };

const start: TranslationRecord = { kind: 'start' };
const source = (origin: string, text: string, stableLen = 0, closed = false): TranslationRecord => ({ kind: 'source', snapshot: { origin, text, stableLen, closed } });
const closing = (origin: string, text: string): TranslationRecord => source(origin, text, text.length, true);
const opened = (ref: number, origin: string): TranslationRecord => ({ kind: 'translationOpened', payload: { ref, origin } });
const text = (ref: number, said: string, stableLen = said.length): TranslationRecord => ({ kind: 'translationText', payload: { ref, text: said, stableLen } });
const closed = (ref: number): TranslationRecord => ({ kind: 'translationClosed', payload: { ref } });
const degraded: TranslationRecord = { kind: 'degraded', payload: { code: 'translation_failed', message: 'A sentence could not be translated.' } };
const failed: TranslationRecord = { kind: 'failed', payload: { message: 'The model is gone.' } };
const frame: TranslationRecord = { kind: 'frame', payload: { direction: 'out', type: 'translation.bye' } };
const rules = (...log: TranslationLog) => checkTranslation(log).map((v) => v.rule);

describe('checkTranslation rules', () => {
  it('passes a source translated a sentence at a time, then its rest at the close', () => {
    expect(checkTranslation([
      start, { kind: 'open' },
      source('u1', 'One. Tw', 7),
      opened(1, 'u1'), text(1, 'いち。'), closed(1),
      closing('u1', 'One. Two.'),
      opened(2, 'u1'), text(2, 'に。'), closed(2),
      { kind: 'stop' }, frame, { kind: 'stopped' },
    ])).toEqual([]);
  });

  it('passes a translation that grows, its stable start kept', () => {
    expect(checkTranslation([start, closing('u1', 'Hello there.'), opened(1, 'u1'), text(1, 'こん', 0), text(1, 'こんにちは', 2), text(1, 'こんにちは。', 6), closed(1)])).toEqual([]);
  });

  it('flags a ref opened twice', () => {
    expect(checkTranslation([start, closing('u1', 'Hi.'), opened(1, 'u1'), text(1, 'やあ。'), closed(1), opened(1, 'u1')])).toEqual([expect.objectContaining({ rule: 'ref-opened-once', index: 5 })]);
  });

  it('flags a translation of an origin the session was not handed, or not yet', () => {
    expect(rules(start, closing('u1', 'Hi.'), opened(1, 'u2'), text(1, 'やあ。'), closed(1))).toEqual(['origin-given', 'source-answered']);
    expect(rules(start, opened(1, 'u1'), text(1, 'やあ。'), closed(1), closing('u1', 'Hi.'))).toEqual(['origin-given']);
  });

  it('flags text before its ref opened and after it closed', () => {
    expect(rules(start, closing('u1', 'Hi.'), text(1, 'やあ。'), opened(1, 'u1'), closed(1))).toEqual(['text-before-open']);
    expect(rules(start, closing('u1', 'Hi.'), opened(1, 'u1'), text(1, 'やあ。'), closed(1), text(1, 'やあ。'))).toEqual(['text-after-close']);
  });

  it('flags a close for a ref that never opened, and a second close', () => {
    expect(rules(start, closing('u1', 'Hi.'), closed(4), opened(1, 'u1'), text(1, 'やあ。'), closed(1))).toEqual(['close-unopened']);
    expect(rules(start, closing('u1', 'Hi.'), opened(1, 'u1'), text(1, 'やあ。'), closed(1), closed(1))).toEqual(['closed-once']);
  });

  it('flags a stable length that is no length within the text', () => {
    for (const stableLen of [-1, 4, 1.5, Number.NaN]) {
      expect(rules(start, closing('u1', 'Hi.'), opened(1, 'u1'), text(1, 'やあ。', stableLen), closed(1))).toEqual(['stable-len-in-text']);
    }
  });

  it('flags a stable length that goes back, and stable text that changes', () => {
    expect(rules(start, closing('u1', 'Hi.'), opened(1, 'u1'), text(1, 'やあ。', 3), text(1, 'やあ。', 2), closed(1))).toEqual(['stable-len-holds']);
    expect(rules(start, closing('u1', 'Hi.'), opened(1, 'u1'), text(1, 'やあ。', 2), text(1, 'よう。', 3), closed(1))).toEqual(['stable-len-holds']);
  });

  it('flags anything after failed', () => {
    expect(rules(start, closing('u1', 'Hi.'), failed, frame)).toEqual(['nothing-after-failed']);
    expect(rules(start, closing('u1', 'Hi.'), failed, opened(1, 'u1'))).toEqual(['nothing-after-failed']);
  });

  it('admits only a frame while stop() runs, and nothing once it has settled', () => {
    expect(rules(start, closing('u1', 'Hi.'), { kind: 'stop' }, frame, { kind: 'stopped' })).toEqual([]);
    expect(rules(start, closing('u1', 'Hi.'), { kind: 'stop' }, opened(1, 'u1'), { kind: 'stopped' })).toEqual(['nothing-after-stop']);
    expect(rules(start, closing('u1', 'Hi.'), { kind: 'stop' }, { kind: 'stopped' }, frame)).toEqual(['nothing-after-stop']);
    // No `stopped` entry: the log cannot say the frame came while the stop ran.
    expect(rules(start, closing('u1', 'Hi.'), { kind: 'stop' }, frame)).toEqual(['nothing-after-stop']);
  });

  it('flags a translation left open at the end of a session that ran to it', () => {
    expect(checkTranslation([start, closing('u1', 'Hi.'), opened(1, 'u1'), text(1, 'やあ。')])).toEqual([expect.objectContaining({ rule: 'translation-closed', index: 4 })]);
  });

  it('flags a closed source that was neither translated nor said to have failed', () => {
    expect(checkTranslation([start, source('u1', 'Hi'), closing('u1', 'Hi.')])).toEqual([expect.objectContaining({ rule: 'source-answered', index: 2 })]);
    // Said to have failed: after the origin was first handed over, before or after its close.
    expect(rules(start, source('u1', 'One. Two', 8), degraded, closing('u1', 'One. Two'))).toEqual([]);
    expect(rules(start, closing('u1', 'Hi.'), degraded)).toEqual([]);
    // A degradation that came before the origin did says nothing of it.
    expect(rules(start, closing('u0', 'Yo.'), degraded, closing('u1', 'Hi.'))).toEqual(['source-answered']);
  });

  it('owes no answer to a source that closed blank, is still open, or was abandoned by a stop or a failure', () => {
    expect(rules(start, closing('u1', '  '))).toEqual([]);
    // Nothing to translate: no letter and no digit, as the cutter reads it.
    expect(rules(start, closing('u1', ' … '))).toEqual([]);
    expect(rules(start, closing('u1', '?!'))).toEqual([]);
    expect(rules(start, closing('u1', '7'))).toEqual(['source-answered']);
    expect(rules(start, source('u1', 'Hi', 2))).toEqual([]);
    expect(rules(start, closing('u1', 'Hi.'), opened(1, 'u1'), { kind: 'stop' }, { kind: 'stopped' })).toEqual([]);
    expect(rules(start, closing('u1', 'Hi.'), failed)).toEqual([]);
  });
});

describe('recordTranslation', () => {
  it('records the calls before they are made and the events as they come, passing both on', async () => {
    const seen: string[] = [];
    let emit!: TranslationEvents;
    const inner: TranslationSession = {
      open: async () => { seen.push('open'); },
      source: (e) => {
        seen.push(`source ${e.origin}`);
        emit.translationOpened({ ref: 1, origin: e.origin });
        emit.translationText({ ref: 1, text: 'やあ。', stableLen: 3 });
        emit.translationClosed({ ref: 1 });
      },
      stop: async () => { seen.push('stop'); emit.frame({ direction: 'out', type: 'translation.bye' }); },
    };
    const request: TranslationStartRequest<undefined, undefined> = { leg: 'speaker', context, config: undefined, credentials: undefined, clock: createVirtualClock(0), signal: new AbortController().signal };
    const forwarded: string[] = [];
    const { session, log } = recordTranslation((_request, events) => { emit = events; return inner; }, request, { translationOpened: (e) => forwarded.push(`opened ${e.ref}`), frame: (e) => forwarded.push(e.type) });
    await session.open();
    const snapshot = { origin: 'u1', text: 'Hi.', stableLen: 3, closed: true };
    session.source(snapshot);
    // The log keeps the snapshot as it was handed over.
    snapshot.text = 'changed';
    await session.stop();
    await Promise.resolve();

    expect(log.map((e) => e.kind)).toEqual(['start', 'open', 'source', 'translationOpened', 'translationText', 'translationClosed', 'stop', 'frame', 'stopped']);
    expect(log[2]).toEqual({ kind: 'source', snapshot: { origin: 'u1', text: 'Hi.', stableLen: 3, closed: true } });
    expect(seen).toEqual(['open', 'source u1', 'stop']);
    expect(forwarded).toEqual(['opened 1', 'translation.bye']);
    expect(checkTranslation(log)).toEqual([]);
  });

  it('records each event as it was said: a payload said again, changed, is read as two', () => {
    let emit!: TranslationEvents;
    const inner: TranslationSession = { open: async () => {}, source: () => {}, stop: async () => {} };
    const request: TranslationStartRequest<undefined, undefined> = { leg: 'speaker', context, config: undefined, credentials: undefined, clock: createVirtualClock(0), signal: new AbortController().signal };
    const forwarded: unknown[] = [];
    const { session, log } = recordTranslation((_request, events) => { emit = events; return inner; }, request, { translationText: (e) => forwarded.push(e) });
    session.source({ origin: 'u1', text: 'Hi.', stableLen: 3, closed: true });
    emit.translationOpened({ ref: 1, origin: 'u1' });
    const said = { ref: 1, text: 'A', stableLen: 1 };
    emit.translationText(said);
    said.text = 'B';
    emit.translationText(said);
    emit.translationClosed({ ref: 1 });
    expect(log.filter((e) => e.kind === 'translationText').map((e) => e.payload)).toEqual([{ ref: 1, text: 'A', stableLen: 1 }, { ref: 1, text: 'B', stableLen: 1 }]);
    expect(checkTranslation(log).map((v) => v.rule)).toEqual(['stable-len-holds']);
    // The listener gets what the unit said, itself.
    expect(forwarded).toEqual([said, said]);
    expect(forwarded[0]).toBe(said);
  });

  it('records `stopped` when a stop rejects, and hands the rejection on', async () => {
    const inner: TranslationSession = { open: async () => {}, source: () => {}, stop: () => Promise.reject(new Error('stuck')) };
    const request: TranslationStartRequest<undefined, undefined> = { leg: 'speaker', context, config: undefined, credentials: undefined, clock: createVirtualClock(0), signal: new AbortController().signal };
    const { session, log } = recordTranslation(() => inner, request);
    await expect(session.stop()).rejects.toThrow('stuck');
    await Promise.resolve();
    expect(log.map((e) => e.kind)).toEqual(['start', 'stop', 'stopped']);
  });
});
