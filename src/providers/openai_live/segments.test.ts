import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { CutSummary } from '../../lib/segmentation/continuousSegments';
import type { LiveConfig } from './config';
import { computeRms, FLOOR_RMS, LiveSegments, SOURCE_CAP_MS, SOURCE_CLAUSE_MS } from './segments';

const PAUSE: LiveConfig['silence'] = { sourceMs: 1500, translationMs: 1500, deferMidSentence: false };

function live(o: { silence?: LiveConfig['silence']; n?: number } = {}) {
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const cuts: CutSummary[] = [];
  const s = new LiveSegments({ clock, silence: o.silence ?? PAUSE, sentencesPerSegment: o.n ?? 1, sink: events, cut: (c) => cuts.push(c) });
  const of = <K extends AdapterEvent['kind']>(k: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === k);
  /** Each segment's last text, by ref. */
  const texts = () => {
    const out = new Map<number, string>();
    for (const e of of('segmentText')) out.set(e.payload.ref, e.payload.text);
    return [...out.entries()];
  };
  const closed = () => of('segmentClosed').map((e) => e.payload.ref);
  const audio = () => of('audio').map((e) => [e.payload.ref, e.payload.range ?? null]);
  const at = (ms: number) => clock.advance(ms - clock.now());
  return { s, clock, timers, log, cuts, of, texts, closed, audio, at };
}
/** 100 ms of speech, and of the floor, as the stream sends them. */
const VOICED = { voiced: true, play: true };
const FLOOR = { voiced: false, play: true };
const frame = (ms = 100) => new Int16Array(ms * 24).fill(900);

describe("OpenAI Live's source cuts: a pause of the source pause on the timeline (ruling 10; choice 6)", () => {
  it(`keeps the old client's caps: a clause at ${SOURCE_CLAUSE_MS} ms, anywhere at ${SOURCE_CAP_MS} ms`, () => {
    expect([SOURCE_CLAUSE_MS, SOURCE_CAP_MS]).toEqual([8_000, 12_000]);
  });

  it("drops a delta's leading marks when no source is open — their sentence is closed — and starts a source at its first word", () => {
    const h = live();
    h.s.input(', 你好', 0, 200);
    h.s.input(' Next', 200, 400);
    expect(h.texts()).toEqual([[1, '你好 Next']]);
  });

  it('a gap on the timeline of the source pause or more ends the open source, whatever it holds: its leading mark goes with the text before it, the rest opens the next', () => {
    const h = live();
    h.s.input('你好', 0, 400);
    h.s.input(',老板', 400 + 1_500, 2_100);
    expect(h.texts()).toEqual([[1, '你好,'], [2, '老板']]);
    expect(h.closed()).toEqual([1]);
  });

  it("a shorter gap ends nothing — a comma's pause stays in its row — and the pause is the user's setting", () => {
    const h = live();
    h.s.input('今天我吃了一家不错的牛肉面', 0, 3_800);
    h.s.input(',老板', 3_800 + 1_499, 5_500);
    expect(h.closed()).toEqual([]);
    expect(h.texts()).toEqual([[1, '今天我吃了一家不错的牛肉面,老板']]);
    const short = live({ silence: { ...PAUSE, sourceMs: 800 } });
    short.s.input('你好', 0, 400);
    short.s.input('再见', 400 + 800, 1_400);
    expect(short.texts()).toEqual([[1, '你好'], [2, '再见']]);
  });

  it('by pause, a source is cut after each sentence end inside a delta, its abbreviations read on the whole source', () => {
    const h = live();
    h.s.input('I met Dr', 0, 200);
    h.s.input('. Smith today. He', 200, 400);
    h.s.input(' said hi.', 400, 600);
    expect(h.texts()).toEqual([[1, 'I met Dr. Smith today.'], [2, 'He said hi.']]);
    expect(h.closed()).toEqual([1, 2]);
  });

  it('by sentence, every N-th end cuts — N the display setting (ruling 4) — and several in one delta are cut in turn', () => {
    const h = live({ n: 2 });
    h.s.input('一。二。三。', 0, 600);
    h.s.input('四。五', 600, 800);
    expect(h.texts()).toEqual([[1, '一。二。'], [2, '三。四。'], [3, '五']]);
    const none = live({ n: 0 });
    none.s.input('一。二。三。', 0, 600);
    expect(none.closed()).toEqual([]);
  });

  it(`with no sentence end, a source past ${SOURCE_CLAUSE_MS / 1000} s is cut at its last clause mark, and at ${SOURCE_CAP_MS / 1000} s anywhere — by sentence too`, () => {
    for (const n of [1, 3]) {
      const h = live({ n });
      h.s.input('第一句话', 0, 4_000);
      h.s.input('还在说,还没', 4_000, 8_000);
      expect(h.texts()).toEqual([[1, '第一句话还在说,'], [2, '还没']]);
      h.s.input('停下来的意思', 8_200, 20_000);
      expect(h.closed()).toEqual([1, 2]);
    }
  });

  it('by arrival, a source closes at its pause whatever it holds, a delta arriving in between restarting it — no short source is held a pause more', () => {
    const h = live();
    h.s.input('你好', 0, 400);
    h.at(1_500);
    expect(h.closed()).toEqual([1]);
    const g = live();
    g.s.input('你好', 0, 400);
    g.at(1_000);
    g.s.input('吗', 400, 600);
    g.at(2_499);
    expect(g.closed()).toEqual([]);
    g.at(2_500);
    expect(g.closed()).toEqual([1]);
  });

  it("by sentence, the module's deferral keeps a source open mid-sentence while it grows", () => {
    const h = live({ silence: { ...PAUSE, deferMidSentence: true }, n: 3 });
    h.s.input('今天我吃了一家不错的牛肉面', 0, 4_000);
    h.at(1_500);
    expect(h.closed()).toEqual([]);
    h.at(3_000);
    expect(h.closed()).toEqual([1]);
  });
});

describe("OpenAI Live's translation (ruling 3; choice 8)", () => {
  it("follows the source's cut, stating it; a delta's leading marks end the open translation before the cut is taken", () => {
    const h = live();
    h.s.input('你好。', 0, 200);
    h.at(100);
    h.s.output('Hello there', 0, 400);
    h.at(200);
    // A source that closed at its sentence end owes the translation one sentence.
    h.s.input('再见', 400, 600);
    h.at(300);
    h.s.output('.', 400, 600);
    h.s.output(' Bye', 600, 800);
    expect(h.texts()).toEqual([[1, '你好。'], [2, 'Hello there.'], [3, '再见'], [4, ' Bye']]);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([
      { ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' }, { ref: 3, side: 'source', origin: 's3' }, { ref: 4, side: 'translation', origin: 's3' },
    ]);
  });

  it('drops leading marks with no translation open', () => {
    const h = live();
    h.s.output('. Hello', 0, 200);
    expect(h.texts()).toEqual([[1, 'Hello']]);
  });

  it('restores the space the stream drops where its timeline paused between two words — never inside a word, never in a script written without spaces', () => {
    const h = live();
    h.s.output('Not Japanese.', 0, 400);
    h.s.output('The decor', 1_000, 1_200);
    h.s.output(' to me', 1_200, 1_400);
    h.s.output('altime', 1_400, 1_600);
    h.s.output(' walls are', 1_600, 1_800);
    h.s.output('really', 2_600, 2_800);
    expect(h.texts()[0][1]).toBe('Not Japanese. The decor to mealtime walls are really');
    const zh = live();
    zh.s.output('今天天气很好。', 0, 400);
    zh.s.output('我们', 1_000, 1_200);
    expect(zh.texts()[0][1]).toBe('今天天气很好。我们');
  });
});

describe("OpenAI Live's karaoke on the output's sample clock (ruling 2; choices 9, 10)", () => {
  it("sets the floor at RMS 0.002, which Live's dithered silence stays under and its speech passes", () => {
    expect(FLOOR_RMS).toBe(0.002);
    expect(computeRms(new Int16Array(2_400).fill(20))).toBeLessThan(FLOOR_RMS);
    expect(computeRms(frame())).toBeGreaterThan(FLOOR_RMS);
    expect(computeRms(new Int16Array(0))).toBe(0);
  });

  it('every frame advances the clock, the floor too; a voiced one plays the characters its window covers, interpolated in a delta, held through a gap', () => {
    const h = live();
    h.s.output('Hello', 0, 200);
    h.s.output(' world', 400, 600);
    // [0, 100) is the floor: counted, not played.
    h.s.audio(frame(), FLOOR);
    for (let i = 0; i < 6; i++) h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[1, [3, 5]], [1, [5, 5]], [1, [5, 5]], [1, [5, 8]], [1, [8, 11]], [1, [11, 11]]]);
  });

  it('a frame goes to the segment whose stamps lie nearest it: before a new segment\'s first delta, its own; after a closed one\'s last, that one, without holding the open one', () => {
    const h = live();
    h.s.input('你好。', 0, 200);
    h.at(100);
    h.s.output('Hi.', 0, 200);
    h.s.input('再见', 200, 400);
    h.s.output(' Bye', 1_000, 1_200);
    expect(h.closed()).toContain(2);
    // [200, 300): nearest "Hi." — the closed segment's last words; [900, 1000): nearest " Bye".
    h.s.audio(frame(200), FLOOR);
    h.s.audio(frame(), VOICED);
    h.s.audio(frame(600), FLOOR);
    h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[2, [3, 3]], [4, [0, 0]]]);
  });

  it("a closed segment's last words play on it and open nothing: the stream's audio trails its text", () => {
    const h = live();
    h.s.input('你好。', 0, 200);
    h.at(100);
    h.s.output('Hi.', 0, 200);
    h.at(1_600);
    expect(h.closed()).toEqual([1, 2]);
    h.s.audio(frame(200), FLOOR);
    h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[2, [3, 3]]]);
    expect(h.of('segmentOpened')).toHaveLength(2);
  });

  it("a segment's ranges ascend and never overlap, and none splits a surrogate pair", () => {
    const h = live();
    h.s.output('😀😀😀', 0, 300);
    for (let i = 0; i < 3; i++) h.s.audio(frame(), VOICED);
    const ranges = h.audio().map((a) => a[1] as [number, number]);
    expect(ranges).toEqual([[0, 2], [2, 4], [4, 6]]);
  });

  it('a leg that does not speak plays nothing, yet its voiced audio opens the translation and holds it', () => {
    const h = live();
    h.s.audio(frame(), { voiced: true, play: false });
    expect(h.audio()).toEqual([]);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'translation' }]);
    h.at(1_400);
    h.s.audio(frame(), { voiced: true, play: false });
    h.at(2_800);
    expect(h.closed()).toEqual([]);
    h.at(20_000);
    expect(h.closed()).toEqual([1]);
  });

  it('audio before any text opens a translation and plays rangeless on it: which characters it speaks is not yet known', () => {
    const h = live();
    h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[1, null]]);
  });
});

describe("OpenAI Live's segments: a lost connection and stop", () => {
  it('a lost connection closes both sides as they stand and starts the timelines again; the refs count on', () => {
    const h = live();
    h.s.input('你好', 0, 200);
    h.s.output('Hi', 0, 200);
    h.s.audio(frame(), VOICED);
    h.s.connectionLost();
    expect(h.closed()).toEqual([1, 2]);
    expect(h.cuts.map((c) => c.reason)).toEqual(['lost']);
    expect(h.timers()).toBe(0);
    // The new session's stamps start at 0 again, and so does its sample clock.
    h.s.output('Again', 0, 200);
    h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[2, [0, 1]], [3, [0, 3]]]);
  });

  it('stop leaves no timer and says nothing after', () => {
    const h = live();
    h.s.input('你好', 0, 200);
    h.s.output('Hi', 0, 200);
    h.s.stop();
    const n = h.log.length;
    h.s.input('再见', 200, 400);
    h.s.output(' there', 200, 400);
    h.s.audio(frame(), VOICED);
    h.clock.advance(60_000);
    expect(h.log.length).toBe(n);
    expect(h.timers()).toBe(0);
  });
});
