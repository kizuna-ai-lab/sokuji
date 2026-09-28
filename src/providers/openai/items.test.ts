import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { RealtimeItems } from './items';

type PayloadOf<K extends AdapterEvent['kind']> = Extract<AdapterEvent, { kind: K }>['payload'];

function machine() {
  const { events, log } = recordEvents();
  const items = new RealtimeItems(events);
  /** The payloads of one kind of event, in order. */
  const of = <K extends AdapterEvent['kind']>(kind: K): Array<PayloadOf<K>> => {
    const out: Array<PayloadOf<K>> = [];
    for (const e of log) if (e.kind === kind) out.push(e.payload as PayloadOf<K>);
    return out;
  };
  return { items, log, of };
}
const pcm = (n = 2_400) => new Int16Array(n).fill(900);
const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

describe("OpenAI Realtime's items: the sources", () => {
  it('opens a source for each committed input under its item id, empty until text comes; deltas stream, and the completed transcript settles and closes it (ruling 11)', () => {
    const m = machine();
    m.items.committed('item_a');
    expect(m.of('segmentOpened')).toEqual([{ ref: 1, side: 'source', origin: 'item_a' }]);
    expect(m.of('segmentText')).toEqual([]);
    m.items.inputDelta('item_a', 'こんにち');
    m.items.inputDelta('item_a', 'は');
    m.items.inputDone('item_a', 'こんにちは。');
    expect(m.of('segmentText')).toEqual([{ ref: 1, text: 'こんにち' }, { ref: 1, text: 'こんにちは' }, { ref: 1, text: 'こんにちは。' }]);
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }]);
    // Nothing more for a closed source; a second commit of the same item opens nothing.
    m.items.inputDelta('item_a', 'x');
    m.items.committed('item_a');
    expect(m.log).toHaveLength(5);
  });

  it('settles a transcript that equals the streamed text without writing it again, and closes a failed transcription as it stands', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.inputDelta('item_a', 'Hi');
    m.items.inputDone('item_a', 'Hi');
    m.items.committed('item_b');
    m.items.inputDelta('item_b', 'Hal');
    m.items.inputFailed('item_b');
    expect(m.of('segmentText')).toEqual([{ ref: 1, text: 'Hi' }, { ref: 2, text: 'Hal' }]);
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('keeps the streamed text when the completed transcript arrives empty, as `outputDone` treats an empty final text as none; with no deltas, the source closes with no text at all', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.inputDelta('item_a', 'Hal');
    m.items.inputDone('item_a', '');
    expect(m.of('segmentText')).toEqual([{ ref: 1, text: 'Hal' }]);
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }]);
    m.items.committed('item_b');
    m.items.inputDone('item_b', '');
    expect(m.of('segmentText')).toEqual([{ ref: 1, text: 'Hal' }]);
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it("opens, writes and closes typed text at once, under the adapter's own item id", () => {
    const m = machine();
    m.items.typed('sokuji_text_1', 'Hello there');
    expect(m.log.map((e) => [e.kind, e.payload])).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'sokuji_text_1' }],
      ['segmentText', { ref: 1, text: 'Hello there' }],
      ['segmentClosed', { ref: 1 }],
    ]);
  });
});

describe("OpenAI Realtime's items: translations, paired exactly (choice 8)", () => {
  it("pairs each translation with the input its item follows, as the server states it", () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.committed('item_b');
    m.items.responseCreated('resp_1', false);
    m.items.outputAdded('item_x', 'resp_1');
    m.items.assistantAdded('item_x', 'item_a');
    m.items.outputDelta('item_x', 'resp_1', 'Hello.');
    m.items.responseCreated('resp_2', false);
    m.items.outputAdded('item_y', 'resp_2');
    m.items.assistantAdded('item_y', 'item_b');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation')).toEqual([
      { ref: 3, side: 'translation', origin: 'item_a' },
      { ref: 4, side: 'translation', origin: 'item_b' },
    ]);
  });

  it('takes the fallback origin as the response was created, not later when its translation opens: an utterance committed afterward is not it', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.responseCreated('resp_1', false);
    m.items.committed('item_b');
    m.items.assistantAdded('item_x', null);
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation')).toEqual([{ ref: 3, side: 'translation', origin: 'item_a' }]);
  });

  it('falls back, when the item names no input of this leg, to the newest known input if it is still unanswered — never an older unanswered one behind it (choice 8)', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.committed('item_b');
    m.items.responseCreated('resp_1', false);
    m.items.outputAdded('item_x', 'resp_1');
    m.items.assistantAdded('item_x', null);
    // A delta before any announcement opens it the same way.
    m.items.responseCreated('resp_2', false);
    m.items.outputDelta('item_y', 'resp_2', 'Hi');
    m.items.responseCreated('resp_3', false);
    m.items.assistantAdded('item_z', 'item_unknown');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation')).toEqual([
      { ref: 3, side: 'translation', origin: 'item_b' },
      // item_b, the newest known input, is already answered; item_a behind it is not taken: no origin.
      { ref: 4, side: 'translation' },
      { ref: 5, side: 'translation' },
    ]);
  });

  it('pairs an assistant item announced before its output item through the one in-band response still running, and guesses no owner between two (choice 8)', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.responseCreated('resp_anchor', true);
    m.items.responseCreated('resp_1', false);
    // The announcement first, naming no input of this leg; its output item after it.
    m.items.assistantAdded('item_x', 'item_other');
    m.items.outputAdded('item_x', 'resp_1');
    m.items.outputDelta('item_x', 'resp_1', 'Hello.');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation')).toEqual([{ ref: 2, side: 'translation', origin: 'item_a' }]);
    // Its response's end closes it.
    m.items.responseDone('resp_1');
    expect(m.of('segmentClosed')).toEqual([{ ref: 2 }]);
    // Two in-band responses running: no owner is guessed, so no fallback pairs it.
    m.items.committed('item_b');
    m.items.responseCreated('resp_2', false);
    m.items.responseCreated('resp_3', false);
    m.items.assistantAdded('item_y', null);
    expect(last(m.of('segmentOpened'))).toEqual({ ref: 4, side: 'translation' });
  });

  it('does not fall back to a typed text the server does not hold yet; it does once the server added it', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.typed('sokuji_text_1', 'queued words');
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'x');
    m.items.inputAdded('sokuji_text_1');
    m.items.responseCreated('resp_2', false);
    m.items.outputDelta('item_y', 'resp_2', 'y');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation').map((e) => e.origin)).toEqual(['item_a', 'sokuji_text_1']);
  });

  it('leaves an input no response answers as a source of its own: an utterance spoken over a playing translation', () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.responseCreated('resp_1', false);
    m.items.assistantAdded('item_x', 'item_a');
    // Spoken while resp_1 plays: committed, never answered (`interrupt_response: false`).
    m.items.committed('item_b');
    m.items.inputDone('item_b', 'unanswered words');
    m.items.responseDone('resp_1');
    m.items.committed('item_c');
    m.items.responseCreated('resp_2', false);
    m.items.assistantAdded('item_y', 'item_c');
    expect(m.of('segmentOpened').filter((e) => e.side === 'translation').map((e) => e.origin)).toEqual(['item_a', 'item_c']);
    // item_b stays its own source row: opened, written, closed, never a translation's origin.
    expect(m.of('segmentOpened')).toContainEqual({ ref: 3, side: 'source', origin: 'item_b' });
    expect(m.of('segmentText')).toContainEqual({ ref: 3, text: 'unanswered words' });
    expect(m.of('segmentClosed')).toContainEqual({ ref: 3 });
  });

  it("makes no segment of an out-of-band response: the drift anchor's (ruling 2)", () => {
    const m = machine();
    m.items.committed('item_a');
    m.items.responseCreated('resp_anchor', true);
    m.items.outputAdded('item_anchor', 'resp_anchor');
    m.items.assistantAdded('item_anchor', null);
    m.items.outputDelta('item_anchor', 'resp_anchor', 'Understood.');
    m.items.outputDone('item_anchor', 'resp_anchor', 'Understood.');
    m.items.audio('item_anchor', 'resp_anchor', pcm());
    m.items.itemDone('item_anchor');
    m.items.responseDone('resp_anchor');
    expect(m.log.map((e) => e.kind)).toEqual(['segmentOpened']);
    // Its fallback was never taken: the next in-band response answers the input.
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'Hi');
    expect(m.of('segmentOpened')[1]).toEqual({ ref: 2, side: 'translation', origin: 'item_a' });
  });

  it('closes a translation when its item is done, and every one still open when its response is done; nothing reopens it', () => {
    const m = machine();
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'one');
    m.items.outputDelta('item_y', 'resp_1', 'two');
    m.items.itemDone('item_x');
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }]);
    m.items.responseDone('resp_1');
    expect(m.of('segmentClosed')).toEqual([{ ref: 1 }, { ref: 2 }]);
    m.items.outputDelta('item_x', 'resp_1', ' more');
    expect(m.of('segmentText')).toEqual([{ ref: 1, text: 'one' }, { ref: 2, text: 'two' }]);
  });
});

describe("OpenAI Realtime's items: karaoke by arrival (ruling 3; choice 9)", () => {
  it("ranges each played frame from the previous frame's end to the text's length at its arrival; audio before any text carries [0, 0]", () => {
    const m = machine();
    m.items.responseCreated('resp_1', false);
    m.items.audio('item_x', 'resp_1', pcm());
    m.items.outputDelta('item_x', 'resp_1', 'Hello');
    m.items.audio('item_x', 'resp_1', pcm());
    m.items.audio('item_x', 'resp_1', pcm());
    m.items.outputDelta('item_x', 'resp_1', ' there.');
    m.items.audio('item_x', 'resp_1', pcm());
    expect(m.of('audio').map((e) => [e.ref, e.range])).toEqual([[1, [0, 0]], [1, [0, 5]], [1, [5, 5]], [1, [5, 12]]]);
  });

  it('settles the final text, and states again within it every range past its end; later frames start there', () => {
    const m = machine();
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'Hello. ');
    m.items.audio('item_x', 'resp_1', pcm());
    m.items.outputDelta('item_x', 'resp_1', ' ');
    m.items.audio('item_x', 'resp_1', pcm());
    // Trimmed: 'Hello.' is 6 long, the streamed text 8.
    m.items.outputDone('item_x', 'resp_1', 'Hello.');
    expect(last(m.of('segmentText'))).toEqual({ ref: 1, text: 'Hello.' });
    expect(m.of('speechRanges')).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 6] }] }]);
    m.items.audio('item_x', 'resp_1', pcm());
    expect(last(m.of('audio'))).toMatchObject({ ref: 1, range: [6, 6] });
    // A final text equal to the streamed one, or none, changes nothing.
    m.items.outputDone('item_x', 'resp_1', 'Hello.');
    m.items.outputDone('item_x', 'resp_1', '');
    expect(m.of('segmentText')).toHaveLength(3);
    expect(m.of('speechRanges')).toHaveLength(1);
  });

  it('plays a frame whose translation already closed as no row\'s, and makes nothing after stop', () => {
    const m = machine();
    m.items.responseCreated('resp_1', false);
    m.items.outputDelta('item_x', 'resp_1', 'Hi');
    m.items.itemDone('item_x');
    m.items.audio('item_x', 'resp_1', pcm(10));
    expect(last(m.of('audio'))).toEqual({ pcm: pcm(10) });
    const n = m.log.length;
    m.items.stop();
    m.items.committed('item_b');
    m.items.typed('sokuji_text_1', 'x');
    m.items.responseCreated('resp_2', false);
    m.items.outputDelta('item_y', 'resp_2', 'y');
    m.items.audio('item_y', 'resp_2', pcm());
    m.items.responseDone('resp_2');
    expect(m.log).toHaveLength(n);
  });
});
