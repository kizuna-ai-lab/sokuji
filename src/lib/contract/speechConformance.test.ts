import { describe, it, expect } from 'vitest';
import type { Ref, SessionContext, TextRange } from './adapter';
import { createVirtualClock } from './clock';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from './speech';
import { checkSpeech, recordSpeech, type SpeechLog, type SpeechRecord } from './speechConformance';

const context: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const pcm = new Int16Array(240);

/** A log entry without its counter, and what the counter does at it: `bump` is how far an entry moves its ref's count (an `audio`: 1 unless it says otherwise). */
type Step = SpeechRecord & { bump?: [Ref, number] };

/** A log by hand: each entry gets the counter as an honest voice leaves it — one more for its ref at every `audio` — unless a step says otherwise. */
function logOf(...steps: Step[]): SpeechLog {
  const counts = new Map<Ref, number>();
  return steps.map(({ bump, ...entry }) => {
    const move = bump ?? (entry.kind === 'audio' && typeof entry.payload.ref === 'number' ? [entry.payload.ref, 1] as [Ref, number] : undefined);
    if (move) counts.set(move[0], (counts.get(move[0]) ?? 0) + move[1]);
    return { ...entry, counts: new Map(counts) } as SpeechLog[number];
  });
}

const start: Step = { kind: 'start' };
const speak = (ref: Ref, text: string, span: TextRange): Step => ({ kind: 'speak', ref, text, span, language: 'en' });
const end = (ref: Ref): Step => ({ kind: 'endUtterance', ref });
const setOn = (on: boolean): Step => ({ kind: 'setOn', on });
const audio = (ref: Ref, range?: TextRange, bump?: [Ref, number]): Step => ({ kind: 'audio', payload: { pcm, ref, ...(range ? { range } : {}) }, ...(bump ? { bump } : {}) });
const ranges = (ref: Ref, list: Array<[number, TextRange]>): Step => ({ kind: 'speechRanges', payload: { ref, ranges: list.map(([index, range]) => ({ index, range })) } });
const rules = (...steps: Step[]) => checkSpeech(logOf(...steps)).map((v) => v.rule);

describe('checkSpeech rules', () => {
  it('passes a row spoken in two stretches, with ranges carried and filled in', () => {
    expect(checkSpeech(logOf(
      start, { kind: 'open' },
      speak(1, 'Hello, ', [0, 7]), audio(1, [0, 3]), audio(1),
      speak(1, 'world.', [7, 13]), end(1), audio(1), ranges(1, [[1, [3, 7]], [2, [7, 13]]]),
      { kind: 'close' }, { kind: 'closed' },
    ))).toEqual([]);
  });

  it('flags audio that names no ref', () => {
    const log = logOf(start, speak(1, 'Hi.', [0, 3]), { kind: 'audio', payload: { pcm } as never });
    expect(checkSpeech(log)).toEqual([expect.objectContaining({ rule: 'audio-has-ref', index: 2 })]);
  });

  it('flags audio that leaves the counter of its ref where it was, or moves it by more than one', () => {
    expect(rules(start, speak(1, 'Hi.', [0, 3]), audio(1, undefined, [1, 0]))).toEqual(['audio-index-counts']);
    expect(rules(start, speak(1, 'Hi.', [0, 3]), audio(1, undefined, [1, 2]))).toEqual(['audio-index-counts']);
  });

  it('flags a counter that moves with no audio for its ref', () => {
    expect(rules(start, { ...speak(1, 'Hi.', [0, 3]), bump: [1, 1] })).toEqual(['audio-index-counts']);
    expect(rules(start, speak(1, 'Hi.', [0, 3]), speak(2, 'Yo.', [0, 3]), audio(1, undefined, [2, 1]))).toEqual(['audio-index-counts', 'audio-index-counts']);
  });

  it('numbers from where the counter stood when the session started', () => {
    const log = logOf({ ...start, bump: [1, 2] }, speak(1, 'more.', [4, 9]), audio(1), ranges(1, [[2, [4, 9]]]));
    expect(checkSpeech(log)).toEqual([]);
    // Entries 0 and 1 are another voice's: this one may not range them.
    expect(checkSpeech(logOf({ ...start, bump: [1, 2] }, speak(1, 'more.', [4, 9]), audio(1), ranges(1, [[0, [4, 9]]]))).map((v) => v.rule)).toEqual(['ranges-entry-exists']);
  });

  it('flags ranges for an entry the session never emitted', () => {
    expect(rules(start, speak(1, 'Hi.', [0, 3]), audio(1), ranges(1, [[1, [0, 3]]]))).toEqual(['ranges-entry-exists']);
    expect(rules(start, speak(1, 'Hi.', [0, 3]), ranges(1, [[0, [0, 3]]]))).toEqual(['ranges-entry-exists']);
  });

  it('flags ranges that overlap or run backwards in entry order, each pair once', () => {
    const two = (list: Array<[number, TextRange]>) => rules(start, speak(1, 'Hello, world.', [0, 13]), audio(1), audio(1), ranges(1, list));
    expect(two([[0, [0, 8]], [1, [5, 13]]])).toEqual(['ranges-ascend']);
    expect(two([[0, [7, 13]], [1, [0, 7]]])).toEqual(['ranges-ascend']);
    expect(two([[0, [0, 7]], [1, [7, 7]]])).toEqual([]);
    // A range the audio carried, against one filled in later; and no second flag when the ref is read again.
    expect(rules(start, speak(1, 'Hello, world.', [0, 13]), audio(1, [0, 7]), audio(1), audio(1), ranges(1, [[1, [3, 9]]]), ranges(1, [[2, [9, 13]]]))).toEqual(['ranges-ascend']);
  });

  it('flags a range outside the spans spoken for its ref', () => {
    // Beyond what was spoken, on the audio and filled in.
    expect(rules(start, speak(1, 'Hello, ', [0, 7]), audio(1, [0, 9]))).toEqual(['range-in-span']);
    expect(rules(start, speak(1, 'Hello, ', [0, 7]), audio(1), ranges(1, [[0, [0, 9]]]))).toEqual(['range-in-span']);
    // Spans that touch are one stretch; a gap between spans is not spoken.
    expect(rules(start, speak(1, 'Hello, ', [0, 7]), speak(1, 'world.', [7, 13]), audio(1, [5, 9]))).toEqual([]);
    expect(rules(start, speak(1, 'Hello', [0, 5]), speak(1, 'world.', [7, 13]), audio(1, [3, 9]))).toEqual(['range-in-span']);
    // Another ref's span does not count, and a range that is no range is flagged.
    expect(rules(start, speak(1, 'Hello, ', [0, 7]), speak(2, 'Hi.', [0, 3]), audio(2, [0, 7]))).toEqual(['range-in-span']);
    expect(rules(start, speak(1, 'Hello, ', [0, 7]), audio(1, [5, 2]))).toEqual(['range-in-span']);
    // A spoken span that is no range is flagged, and is not counted as spoken.
    expect(rules(start, speak(1, 'Hi.', [5, 2]))).toEqual(['range-in-span']);
    expect(rules(start, speak(1, 'Hi.', [-3, 4]), audio(1, [0, 3]))).toEqual(['range-in-span', 'range-in-span']);
  });

  it('flags audio for text spoken while off, and audio still arriving once switched off', () => {
    expect(rules(start, setOn(false), speak(1, 'Hi.', [0, 3]), audio(1))).toEqual(['silent-when-off']);
    // In flight when switched off: dropped, also once speech is on again.
    expect(rules(start, speak(1, 'Hi.', [0, 3]), setOn(false), audio(1))).toEqual(['silent-when-off']);
    expect(rules(start, speak(1, 'Hi.', [0, 3]), setOn(false), setOn(true), audio(1))).toEqual(['silent-when-off']);
    // Speech resumes with the next text spoken while on, for that row or another.
    expect(rules(start, speak(1, 'Hi.', [0, 3]), setOn(false), setOn(true), speak(1, ' You.', [3, 8]), audio(1, [3, 8]), speak(2, 'Yo.', [0, 3]), audio(2))).toEqual([]);
  });

  it('flags audio over a stretch handed over while speech was off, also once the same row is spoken again', () => {
    const resumed: Step[] = [start, speak(1, 'One', [0, 3]), setOn(false), speak(1, 'two', [3, 6]), setOn(true), speak(1, 'six', [6, 9])];
    expect(rules(...resumed, audio(1, [3, 6]))).toEqual(['silent-when-off']);
    // A stretch spoken before the switch is not read after it either, and a range that reaches into one is flagged.
    expect(rules(...resumed, audio(1, [0, 3]))).toEqual(['silent-when-off']);
    expect(rules(...resumed, audio(1, [5, 8]))).toEqual(['silent-when-off']);
    // What was spoken since the row came back is read; so is audio that says no range.
    expect(rules(...resumed, audio(1, [6, 9]), audio(1))).toEqual([]);
    // Ranges filled in later for entries already emitted are not audio: they are held to the spans spoken, as before.
    expect(rules(start, speak(1, 'One', [0, 3]), audio(1), setOn(false), speak(1, 'two', [3, 6]), setOn(true), speak(1, 'six', [6, 9]), audio(1), ranges(1, [[0, [0, 3]], [1, [6, 9]]]))).toEqual([]);
  });

  it('flags an event after close, and lets only a frame come before close has returned', () => {
    const frame: Step = { kind: 'frame', payload: { direction: 'in', type: 'tts.closed' } };
    expect(rules(start, speak(1, 'Hi.', [0, 3]), { kind: 'close' }, frame, { kind: 'closed' })).toEqual([]);
    expect(rules(start, speak(1, 'Hi.', [0, 3]), { kind: 'close' }, { kind: 'closed' }, frame)).toEqual(['nothing-after-close']);
    expect(rules(start, speak(1, 'Hi.', [0, 3]), { kind: 'close' }, audio(1), { kind: 'closed' })).toEqual(['nothing-after-close']);
    expect(rules(start, { kind: 'close' }, { kind: 'degraded', payload: { code: 'tts_degraded', message: 'late' } }, { kind: 'closed' })).toEqual(['nothing-after-close']);
    // A log that does not say when close returned admits nothing after it.
    expect(rules(start, { kind: 'close' }, frame)).toEqual(['nothing-after-close']);
  });
});

describe('recordSpeech', () => {
  /** A voice that speaks each text in one chunk, at once, while it is on. */
  const voice = (request: SpeechStartRequest<unknown, unknown>, events: SpeechEvents): SpeechSession => {
    let on = true;
    return {
      open: async () => { events.frame({ direction: 'out', type: 'tts.open' }); },
      speak: (ref, _text, span) => {
        if (!on) return;
        request.counts.set(ref, (request.counts.get(ref) ?? 0) + 1);
        events.audio({ pcm, ref, range: span });
      },
      endUtterance: () => {},
      setOn: (next) => { on = next; },
      recycle: () => {},
      close: () => { events.frame({ direction: 'out', type: 'tts.close' }); },
    };
  };
  const request = (): SpeechStartRequest<unknown, unknown> =>
    ({ leg: 'speaker', context, config: {}, credentials: {}, clock: createVirtualClock(0), signal: new AbortController().signal, counts: new Map() });

  it('records calls and events in order, with the counter as it stood, and passes the events on', async () => {
    const heard: string[] = [];
    const forward: SpeechEvents = { audio: () => heard.push('audio'), speechRanges: () => heard.push('speechRanges'), degraded: () => heard.push('degraded'), frame: () => heard.push('frame') };
    const { session, log } = recordSpeech(voice, request(), forward);
    await session.open();
    session.speak(1, 'Hello, ', [0, 7], 'en');
    session.setOn(false);
    session.speak(1, 'world.', [7, 13], 'en');
    session.setOn(true);
    session.recycle?.();
    session.speak(2, 'Hi.', [0, 3], 'en', 'participant');
    session.endUtterance(2);
    session.close();

    expect(log.map((e) => e.kind)).toEqual(['start', 'open', 'frame', 'speak', 'audio', 'setOn', 'speak', 'setOn', 'recycle', 'speak', 'audio', 'endUtterance', 'close', 'frame', 'closed']);
    expect(log[3]).toMatchObject({ kind: 'speak', ref: 1, text: 'Hello, ', span: [0, 7], language: 'en' });
    expect(log[9]).toMatchObject({ kind: 'speak', ref: 2, home: 'participant' });
    expect([...log[3].counts]).toEqual([]);
    expect([...log[4].counts]).toEqual([[1, 1]]);
    expect([...log[14].counts]).toEqual([[1, 1], [2, 1]]);
    expect(heard).toEqual(['frame', 'audio', 'audio', 'frame']);
    expect(checkSpeech(log)).toEqual([]);
  });

  it('gives the session a recycle only when the unit has one, and appends to a log it is handed', () => {
    const log: SpeechLog = [];
    const bare = (r: SpeechStartRequest<unknown, unknown>, e: SpeechEvents): SpeechSession => { const { recycle: _recycle, ...rest } = voice(r, e); return rest; };
    const recorded = recordSpeech(bare, request(), undefined, log);
    expect(recorded.session.recycle).toBeUndefined();
    expect(recorded.log).toBe(log);
    expect(log.map((e) => e.kind)).toEqual(['start']);
  });

  it('catches a voice that speaks while off', () => {
    const deaf = (r: SpeechStartRequest<unknown, unknown>, e: SpeechEvents): SpeechSession => ({ ...voice(r, e), setOn: () => {} });
    const { session, log } = recordSpeech(deaf, request());
    session.setOn(false);
    session.speak(1, 'Hi.', [0, 3], 'en');
    expect(checkSpeech(log).map((v) => v.rule)).toEqual(['silent-when-off']);
  });
});
