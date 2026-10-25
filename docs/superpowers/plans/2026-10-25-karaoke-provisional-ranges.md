# Karaoke Provisional Ranges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live karaoke on Soniox, Palabra and Qwen LiveTranslate lights from a sentence's first chunk, using a provisional range per chunk that the existing fill-in later replaces, and never steps back within a sentence.

**Architecture:** One shared estimator (`SpeechPace`) beside `tileSpan` in `src/lib/contract/ranges.ts` turns "samples heard so far" into a provisional end within the phrase. Each of the three adapters emits that range on its `audio` event and feeds its existing fill-in back to the estimator. `nextLit` in `src/lib/view/karaoke.ts` holds what is lit when a corrected range would light less of the same segment. No L0 type changes.

**Tech Stack:** TypeScript (strict), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-karaoke-provisional-ranges-design.md`

## Global Constraints

- Code, comments, commit messages: English; conventional commits; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit locally only; never push.
- TDD: write the failing test, watch it fail, then implement.
- Adapters never call `report()` and never `console.*` (`src/providers/sessionSide.consistency.test.ts`, `consoleLedger.consistency.test.ts`); no timers are added.
- Priors, seconds per letter/digit/CJK character at speed 1.0: any kana in the phrase 0.16; else Han ≥ half its letters 0.25; else Hangul ≥ half 0.17; else 0.075. Prior weight: 10 characters. No cap.
- Letters are counted with `countSkeleton` (`src/lib/segmentation/sealCursor.ts`). Ranges are UTF-16 offsets; no range end inside a surrogate pair.
- Run tests with `npx vitest run <path>`. A worktree without its own `node_modules` uses the main checkout's: `<main checkout>/node_modules/.bin/vitest run <path>` (same for `tsc`, `tsx`).
- Type check: `npx tsc --noEmit -p tsconfig.json`. The baseline already reports errors elsewhere (`Intl.Segmenter`, `chrome.tabs`); a task passes when no error names a file it touched.

## Review Focus

1. **Soniox text that grows after a segment's audio began** (the clause-wait rule): later chunks are placed in the span sent so far, never outside it. Test in Task 3.
2. **A Soniox reconnect mid-utterance:** the new socket's `utt-1-1` starts its own provisional state at its own span, not continuing the old socket's stream of the same id. Test in Task 3.
3. **A speaking-speed setting other than 1.0** (Soniox `ttsSpeed`, 0.7–1.3): the prior scales by it. Tests in Tasks 1 and 3.
4. **A Qwen final text shorter than the provisional ranges already stated:** `restate` pulls them inside the final text, so conformance still passes. Test in Task 5.
5. **A segment whose text shrinks below what is lit:** the kept highlight is clamped to the new text length. Test in Task 2.

---

### Task 1: `SpeechPace`, the shared estimate

**Files:**
- Modify: `src/lib/contract/ranges.ts`
- Test: `src/lib/contract/ranges.test.ts`

**Interfaces:**
- Produces (all exported from `src/lib/contract/ranges.ts`):
  - `PRIOR_WEIGHT = 10`
  - `priorSeconds(phrase: string): number`
  - `class SpeechPace { constructor(speed?: number /* default 1 */); rate(phrase: string): number; learn(phrase: string, samples: number): void; reach(phrase: string, cum: number, from: number): number | null }`
  - `rate`: samples per letter. `learn`: a fill-in's phrase text and the samples of its chunks. `reach`: the provisional end, an offset into `phrase`, for `cum` samples of the phrase heard so far, never below `from`; `null` when `phrase` has no letters (the chunk then stays rangeless).

- [ ] **Step 1: Write the failing tests** (append to `ranges.test.ts`)

```ts
describe('priorSeconds', () => {
  it("reads the phrase's script: kana 0.16, mostly Han 0.25, mostly Hangul 0.17, else 0.075", () => {
    expect(priorSeconds('Hello there')).toBe(0.075);
    expect(priorSeconds('明天的会议')).toBe(0.25);
    expect(priorSeconds('リアルタイム翻訳')).toBe(0.16);
    expect(priorSeconds('안녕하세요')).toBe(0.17);
    expect(priorSeconds('下午3点开始')).toBe(0.25);
    expect(priorSeconds('Room 3 会议')).toBe(0.075);
  });
});

describe('SpeechPace', () => {
  it('starts from the prior in samples per letter, scaled by the speaking speed', () => {
    expect(new SpeechPace().rate('Hello')).toBe(1800);
    expect(new SpeechPace(1.25).rate('Hello')).toBe(1440);
  });

  it('blends what fill-ins measured with the prior, the prior weighted as 10 letters', () => {
    const pace = new SpeechPace();
    pace.learn('Hello world', 20_000);
    expect(pace.rate('abc')).toBe(1900);
  });

  it('learns nothing from a fill-in with no letters or no samples', () => {
    const pace = new SpeechPace();
    pace.learn('...', 5_000);
    pace.learn('Hello', 0);
    expect(pace.rate('abc')).toBe(1800);
  });

  it('reaches into the phrase in proportion to the samples heard against its estimated length, never past its end', () => {
    const pace = new SpeechPace();
    expect(pace.reach('abcdefghij', 9_000, 0)).toBe(5);
    expect(pace.reach('abcdefghij', 18_000, 5)).toBe(10);
    expect(pace.reach('abcdefghij', 27_000, 10)).toBe(10);
  });

  it('never reaches back before from', () => {
    expect(new SpeechPace().reach('abcdefghij', 9_000, 6)).toBe(6);
  });

  it('places nothing in a phrase with no letters', () => {
    expect(new SpeechPace().reach('', 5_000, 0)).toBeNull();
    expect(new SpeechPace().reach('...', 5_000, 0)).toBeNull();
  });

  it('never ends inside a surrogate pair', () => {
    expect(new SpeechPace().reach('a😀b', 1_800, 0)).toBe(3);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/contract/ranges.test.ts`
Expected: FAIL, `priorSeconds` / `SpeechPace` not exported.

- [ ] **Step 3: Implement in `ranges.ts`**

`priorSeconds`: kana test with `/[\p{Script=Hiragana}\p{Script=Katakana}]/u`; Han and Hangul counted per code point against `countSkeleton(phrase)`. `rate(phrase)`: `prior = priorSeconds(phrase) * SAMPLE_RATE / speed`; with measured characters > 0, `(measuredSamples + prior * PRIOR_WEIGHT) / (measuredChars + PRIOR_WEIGHT)`, else `prior`. `learn` adds only when both the letter count and the samples are positive. `reach`:

```ts
const letters = countSkeleton(phrase);
if (letters === 0) return null;
let end = Math.min(phrase.length, Math.max(from, Math.round((phrase.length * cum) / (letters * this.rate(phrase)))));
if (end > from && end < phrase.length && isHigh(phrase.charCodeAt(end - 1)) && isLow(phrase.charCodeAt(end))) end += 1;
return end;
```

Update the module comment: ranges known only later, and the provisional ones before them.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/contract/ranges.test.ts`
Expected: PASS (the existing `tileSpan` tests too).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contract/ranges.ts src/lib/contract/ranges.test.ts
git commit -m "feat(contract): estimate a chunk's provisional range from a learned speech rate"
```

### Task 2: Karaoke never steps back within a segment

**Files:**
- Modify: `src/lib/view/karaoke.ts` (`nextLit`, its comment)
- Test: `src/lib/view/karaoke.test.ts`

**Interfaces:**
- Consumes: nothing new. `nextLit(prev, playing, legs)` keeps its signature; replay still uses `litFor` directly and is not held.

- [ ] **Step 1: Write the failing tests** (a new `describe` after `nextLit while a rangeless clip plays`; `segment`, `legs`, `SECOND`, `setup` are the file's helpers; `TEXT` has 13 characters)

```ts
describe('nextLit never steps back within a segment (provisional ranges)', () => {
  const prev = { segmentId: 's:speaker:2', leg: 'speaker' as const, upTo: 9 };

  it('keeps what is lit when a corrected range would light less of the same segment', () => {
    expect(nextLit(prev, { key: 'speaker:2:1', t: 0, ms: 1000 }, legs(segment()))).toEqual(prev);
  });

  it('moves on once playback passes what is lit', () => {
    expect(nextLit(prev, { key: 'speaker:2:1', t: 600, ms: 1000 }, legs(segment()))).toEqual({ ...prev, upTo: 10 });
  });

  it("clamps what it keeps to the segment's current, shorter text", () => {
    const shorter = segment({ text: 'こんにちは、お元', speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 8], pcm: SECOND }] });
    expect(nextLit(prev, { key: 'speaker:2:1', t: 0, ms: 1000 }, legs(shorter))).toEqual({ ...prev, upTo: 8 });
  });

  it('lets another segment start from its own position', () => {
    const next = segment({ id: 's:speaker:3', ref: 3, speech: [{ range: [0, 4], pcm: SECOND }] });
    const both: readonly Leg[] = [{ ...legs(segment())[0], segments: [segment(), next] }];
    expect(nextLit(prev, { key: 'speaker:3:0', t: 0, ms: 1000 }, both)).toEqual({ segmentId: 's:speaker:3', leg: 'speaker', upTo: 0 });
  });
});
```

And in `describe('createKaraoke', …)`:

```ts
it('a replay is not held: it lights what its clip says', () => {
  const { queues, karaoke } = setup(segment());
  karaoke.subscribe(() => {});
  queues.replay.set({ key: 'speaker:2:1', t: 1000, ms: 1000 }, 2);
  expect(karaoke.get().lit.get('s:speaker:2')).toBe(13);
  queues.replay.set({ key: 'speaker:2:0', t: 0, ms: 1000 }, 2);
  expect(karaoke.get().lit.get('s:speaker:2')).toBe(0);
});

it('a sentence whose speech ended uncleanly un-highlights once its fill-in tiles it to the end', () => {
  const { queues, karaoke, setSegment } = setup(segment({ speech: [{ range: [0, 4], pcm: SECOND }] }));
  karaoke.subscribe(() => {});
  queues.speaker.set({ key: 'speaker:2:0', t: 1000, ms: 1000 }, 1);
  queues.speaker.set(null, 0);
  expect(karaoke.get().lit.get('s:speaker:2')).toBe(4);      // held: its ranges stop short of its last letter
  setSegment(segment({ speech: [{ range: [0, 13], pcm: SECOND }] }));
  expect(karaoke.get().lit.size).toBe(0);
});
```

- [ ] **Step 2: Run to verify the new `nextLit` tests fail**

Run: `npx vitest run src/lib/view/karaoke.test.ts`
Expected: FAIL in "keeps what is lit…" and "clamps what it keeps…" (they return `upTo: 6`); the replay and uncleanly-ended tests already pass, and pin behaviour that must not change.

- [ ] **Step 3: Implement in `nextLit`**

When a clip plays and `litFor` gives a lit for `prev`'s segment and leg with `upTo < prev.upTo`, return `prev` with `upTo` clamped to that segment's current text length (`prev` itself when unchanged). Every other path is as today. Extend the function's comment with the rule and why (provisional ranges corrected by the fill-in).

- [ ] **Step 4: Run to verify the file passes**

Run: `npx vitest run src/lib/view/karaoke.test.ts`
Expected: PASS, all existing tests included.

- [ ] **Step 5: Commit**

```bash
git add src/lib/view/karaoke.ts src/lib/view/karaoke.test.ts
git commit -m "feat(karaoke): never step back within a segment while its speech plays"
```

### Task 3: Soniox speaks with provisional ranges

**Files:**
- Modify: `src/providers/soniox/ttsStream.ts` (`SonioxTtsAudioInfo`, the audio handler call)
- Modify: `src/providers/soniox/speech.ts` (`LegSpeech`)
- Test: `src/providers/soniox/ttsStream.test.ts`, `src/providers/soniox/speech.test.ts`

**Interfaces:**
- Consumes: `SpeechPace`, `tileSpan` from `src/lib/contract/ranges.ts` (Task 1).
- Produces: `SonioxTtsAudioInfo { streamId: string; ref?: number; span?: TextRange }`: `span` is the union of the spans of the tagged text sent to that stream so far (`record.span` in `segments`), absent when its text was never tagged.

- [ ] **Step 1: Write the failing `ttsStream` test**

```ts
it('tells each chunk of audio the span of text sent to its stream so far', async () => {
  const { t, ws } = await openTts();
  const infos: Array<{ streamId: string; ref?: number; span?: [number, number] }> = [];
  t.setHandlers({ onAudio: (_audio, info) => infos.push(info) });
  t.sendText('Hello, ', 'en', { ref: 2, span: [0, 7] });
  ws.message({ stream_id: 'utt-1-1', audio: pcmB64() });
  t.sendText('world.', 'en', { ref: 2, span: [7, 13] });
  ws.message({ stream_id: 'utt-1-1', audio: pcmB64() });
  expect(infos.map((i) => i.span)).toEqual([[0, 7], [0, 13]]);
});
```

Untagged text keeps no `span`: in the existing test that sends `t.sendText('Hello', 'en')` and collects audio, assert `'span' in info` is false.

- [ ] **Step 2: Write the failing `LegSpeech` tests** (`speech.test.ts`; the existing tests named here change as shown, the rest must pass unchanged)

- `streams each chunk as audio on its ref as it arrives, with no range` → rename to `…with a provisional range from the prior`; replace the `'range' in a` assertion with `expect(audio.map((a) => a.range)).toEqual([[0, 2], [2, 4]])` (`'Hello. '` over `[0, 7]`, two 2 400-sample chunks).
- `fills in the chunks' ranges when the segment ends cleanly…`: before `terminated`, `expect(kinds('audio').map((e) => (e.payload as { range?: unknown }).range)).toEqual([[0, 2], [2, 7]])`; the fill-in assertion is unchanged.
- `a 408-killed segment gets no ranges…` → rename to `a 408-killed segment is tiled over the chunks that arrived, says tts_segment_lost once per episode, and teaches the rate nothing`: the first chunk's range is `[0, 2]`; after the first 408 `kinds('speechRanges')` holds `{ ref: 2, ranges: [{ index: 0, range: [0, 3] }] }`; `utt-1-2` (no audio) states nothing; `utt-1-3`'s chunk has the prior's range `[7, 10]` and its 408 adds `{ ref: 2, ranges: [{ index: 1, range: [7, 11] }] }`. The `degraded` assertions are unchanged.
- `off ends the live segment, and nothing it still says reaches the leg`: the one audio event has range `[0, 1]`; after `terminated`, `kinds('speechRanges')` is `[{ ref: 1, ranges: [{ index: 0, range: [0, 5] }] }]`.
- `after a reconnect a ref's index goes on…`: add `expect(kinds('audio').map((e) => (e.payload as { range?: unknown }).range)).toEqual([[0, 1], [3, 5]])`.

New tests:

```ts
it("places the next segment's chunks with the rate its fill-ins measured", async () => {
  const { speech, tts, kinds } = await setup();
  speech.speak(2, 'Hello, world.', [0, 13], 'en');
  tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
  tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(7200) }));
  tts().receive(JSON.stringify({ stream_id: 'utt-1-1', terminated: true }));
  speech.speak(2, ' Next one.', [13, 23], 'en');
  tts().receive(JSON.stringify({ stream_id: 'utt-1-2', audio: b64(4830) }));
  expect((kinds('audio')[2].payload as { range?: unknown }).range).toEqual([13, 18]);
});

it('places a chunk in the span sent so far when the segment is fed more text after its audio began', async () => {
  const { speech, tts, kinds } = await setup();
  speech.speak(2, 'Hello, ', [0, 7], 'en');
  tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
  speech.speak(2, 'world.', [7, 13], 'en');
  tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
  expect(kinds('audio').map((e) => (e.payload as { range?: unknown }).range)).toEqual([[0, 2], [2, 3]]);
});

it("scales the prior by the leg's speaking speed", async () => {
  const { speech, tts, kinds } = await setup({ speed: 1.25 });
  speech.speak(2, 'Hello. ', [0, 7], 'en');
  tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
  expect((kinds('audio')[0].payload as { range?: unknown }).range).toEqual([0, 2]);
  tts().receive(JSON.stringify({ stream_id: 'utt-1-1', audio: b64(2400) }));
  expect((kinds('audio')[1].payload as { range?: unknown }).range).toEqual([2, 5]);
});
```

`LegSpeech` emits speech only, no segments, so these tests do not run the conformance kit; `adapter.test.ts`'s conformance scenarios (`describe('the Soniox adapter: conformance')`) cover the provisional ranges through the whole adapter and must pass unchanged.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/providers/soniox/ttsStream.test.ts src/providers/soniox/speech.test.ts`
Expected: FAIL in the new and changed tests only.

- [ ] **Step 4: Implement**

`ttsStream.ts`: pass `span` (a copy of `record.span`) in the info given to `onAudio`. `speech.ts`:
- one `new SpeechPace(o.speed)` per `LegSpeech`;
- per stream, beside `entries`, the provisional state `{ start: number; cum: number; reached: number }`, reset with `segments` when a new socket opens (`ensure()`);
- `onAudio(pcm, streamId, ref, span)`: with a `span`, the phrase is the text of `ref`'s held chunks (`texts`) inside `span`, in order; `end = pace.reach(phrase, cum, reached)`; a non-null `end` gives `audio({ ref, pcm, range: [span[0] + reached, span[0] + end] })` and moves `reached`; `null` keeps the chunk rangeless;
- `onSegmentEnd`: clean, as today, then `pace.learn(text, sum of the entries' samples)`; unclean with a `ref`, a `span` and at least one entry (a 408, a failed socket, a dropped segment), the same `tileSpan` fill-in, stated by `speechRanges`, without learning. `close()` still states nothing.
- Update the module comment (no longer "one rangeless audio per chunk") and the test file's header comment.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/providers/soniox`
Expected: PASS (every Soniox test file, `adapter.test.ts` and `adapter.both.test.ts` included).

- [ ] **Step 6: Commit**

```bash
git add src/providers/soniox/ttsStream.ts src/providers/soniox/speech.ts src/providers/soniox/ttsStream.test.ts src/providers/soniox/speech.test.ts
git commit -m "feat(soniox): provisional karaoke ranges, and close out a segment that ends uncleanly"
```

### Task 4: Palabra speaks with provisional ranges

**Files:**
- Modify: `src/providers/palabraai/items.ts`
- Test: `src/providers/palabraai/items.test.ts`

**Interfaces:**
- Consumes: `SpeechPace` (Task 1). One per `PalabraItems`; Palabra has no speed setting (speed 1).

- [ ] **Step 1: Write the failing tests**

- `tiles the translation over its burst once the last chunk is in…`: the audio assertion becomes `[[2, 4_800, [0, 3]], [2, 4_800, [3, 7]], [2, 2_400, [7, 8]]]` (`EN`, 82 code units, 67 letters); the fill-in assertions are unchanged.
- New:

```ts
it("places the next sentence's chunks with the rate the last fill-in measured", () => {
  const h = items();
  h.feed(SERVER.validated());
  h.feed(SERVER.translated());
  h.feed(SERVER.audio(), new Int16Array(4_800));
  h.feed(SERVER.audio(), new Int16Array(4_800));
  h.feed(SERVER.audio({ last: true }), new Int16Array(2_400));
  h.feed(SERVER.validated('こんにちは。', 'second'));
  h.feed(SERVER.translated('Hello there.', 'second'));
  h.feed(SERVER.audio({ id: 'second' }), new Int16Array(4_800));
  const audio = h.of('audio');
  expect(audio[audio.length - 1].range).toEqual([0, 12]);
  expect(checkConformance(h.log, AUTO)).toEqual([]);
});
```

`opens the translation empty for speech that comes before its text…` and `an empty translation…` stay as they are: a part with no letters keeps its chunks rangeless. Any other expectation in the file that changes may only gain a provisional `range` on an `audio` payload before its fill-in; check each against the formula by hand.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/providers/palabraai/items.test.ts`
Expected: FAIL in the changed and new tests.

- [ ] **Step 3: Implement**

`Translation` gains `cum` and `reached`. In `audio()`, for a chunk with samples on a translation not yet `ranged`: `cum += pcm.length`; `end = pace.reach(t.text, cum, reached)`; a non-null `end` gives the event `range: [reached, end]` and moves `reached`; `null` emits it rangeless. In `fill()`, after `speechRanges`, `pace.learn(t.text, sum of t.samples)`. Update the module comment ("karaoke lights a sentence once its burst is whole" no longer holds).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/providers/palabraai`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/palabraai/items.ts src/providers/palabraai/items.test.ts
git commit -m "feat(palabra): provisional karaoke ranges before a sentence's fill-in"
```

### Task 5: Qwen LiveTranslate speaks with provisional ranges

**Files:**
- Modify: `src/providers/qwen_livetranslate/segments.ts`
- Test: `src/providers/qwen_livetranslate/segments.test.ts`, `src/providers/qwen_livetranslate/segments.replay.test.ts` (must pass unchanged)

**Interfaces:**
- Consumes: `SpeechPace` (Task 1). One per `QwenSegments`, so one per adapter session and leg (managed Qwen wraps the same class).

- [ ] **Step 1: Write the failing tests** (inside `describe('karaoke: a phrase is the words before its audio…')`)

```ts
it('places each chunk of a phrase as it arrives, the fill-in replacing it, the next phrase at the learned rate', () => {
  const { s, log } = segments();
  s.text('t1', 'translation', 'Welcome to it. ');
  s.audio('t1', pcm(4_800));
  s.audio('t1', pcm(4_800));
  s.text('t1', 'translation', 'We hope ');
  s.audio('t1', pcm(4_800));
  const audio = log.flatMap((e) => (e.kind === 'audio' ? [e.payload.range] : []));
  expect(audio).toEqual([[0, 3], [3, 7], [14, 19]]);
  expect(ranges(log)).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 7] }, { index: 1, range: [7, 14] }] }]);
});

it('restates provisional ranges a shorter final text no longer holds', () => {
  const { s, log } = segments();
  s.text('t1', 'translation', 'Welcome to it. ');
  s.audio('t1', pcm(4_800));
  s.audio('t1', pcm(4_800));
  s.done('t1', 'translation', 'Wel');
  s.audioDone('t1');
  expect(ranges(log)).toEqual([
    { ref: 1, ranges: [{ index: 1, range: [3, 3] }] },
    { ref: 1, ranges: [{ index: 0, range: [0, 2] }, { index: 1, range: [2, 3] }] },
  ]);
});
```

Conformance on the provisional ranges is covered by `segments.replay.test.ts`, which runs the kit over both recordings. The existing `a final text shorter than its deltas restates…` test changes: its second expected `speechRanges` becomes `[{ index: 0, range: [0, 8] }, { index: 1, range: [8, 8] }, { index: 2, range: [8, 8] }]` (index 2's provisional `[14, 14]` is pulled inside `Welcome.`), and its name drops "leaves the phrase it no longer reaches unranged". `fills the last phrase … audio after that plays unranged` must pass unchanged: no provisional range once a closed, spoken translation's last phrase is filled. Its tiny chunks get zero-width provisional ranges that no assertion reads.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/providers/qwen_livetranslate/segments.test.ts`
Expected: FAIL in the new tests and the changed restate test.

- [ ] **Step 3: Implement**

`Item` gains `cum` and `reached`, reset where `fill()` moves `phraseText` / `phraseAudio`. In `audio()`, unless the item is `closed && spoken`: the phrase is `it.shown.slice(phraseText, it.shown.length)` as the chunk arrives (audio before any words joins the first phrase, whose words then grow it); `cum += pcm.length`; `end = pace.reach(phrase, cum, reached)`; a non-null `end` gives the event `range: [phraseText + reached, phraseText + end]`, recorded in `it.ranges` under the entry's index (`it.samples.length` before the push) so `restate` covers it, and moves `reached`; `null` keeps it rangeless. In `fill()`, when it states ranges, `pace.learn(it.shown.slice(...span), sum of the phrase's samples)`. Update the module comment ("Nothing is lit before its phrase is whole").

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/providers/qwen_livetranslate`
Expected: PASS, `segments.replay.test.ts` included (its conformance check covers the provisional ranges on both recordings).

- [ ] **Step 5: Commit**

```bash
git add src/providers/qwen_livetranslate/segments.ts src/providers/qwen_livetranslate/segments.test.ts
git commit -m "feat(qwen-livetranslate): provisional karaoke ranges before a phrase's fill-in"
```

### Task 6: The contract spec and the design catch up

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`
- Modify: `docs/superpowers/specs/2026-10-25-karaoke-provisional-ranges-design.md`

- [ ] **Step 1: Amend the contract spec**
  - D4 row and "Risks → Karaoke's honesty depends on producers being honest": a fourth stated exception, provisional ranges estimated from a measured speech rate on Soniox, Palabra and Qwen LiveTranslate, replaced by the fill-in, by the owner's ruling of 2026-10-25 (cite the karaoke design).
  - "A range known only later is filled in": audio no longer plays rangeless before the fill-in; describe the provisional range, the step-back hold in `nextLit`, and Soniox's unclean segment end being tiled over the chunks that arrived.
  - "Provider capability": the Soniox, Palabra and Qwen LiveTranslate karaoke cells ("unlit before" is no longer true; Palabra's note that D4's list is unchanged is no longer true).
- [ ] **Step 2: Bring the karaoke design in line with the code**
  - §1: a phrase with no letters places nothing; the chunk stays rangeless (was `[prevEnd, prevEnd]`).
  - §2 Palabra: a chunk before any text stays rangeless (was `[0, 0]`).
  - §2 Qwen: the phrase's end is the shown text's length as each chunk arrives (was "when the phrase's first chunk arrived"), so audio before any words still lights once its words come.
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/specs/2026-10-25-karaoke-provisional-ranges-design.md
git commit -m "docs(contract): provisional karaoke ranges, the fourth stated exception"
```

### Task 7: Verify and accept

- [ ] **Step 1: The whole suite**

Run: `npx vitest run`
Expected: every file passes (the consistency tests included).

- [ ] **Step 2: Types**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/lib/contract/ranges|src/lib/view/karaoke|src/providers/(soniox|palabraai|qwen_livetranslate)/"`
Expected: no output.

- [ ] **Step 3: Qwen acceptance on the committed fixtures**

Run: `npx tsx scripts/dev/karaoke-probe/simulate.mts`
Expected, in the printed `summary` rows for `group: "qwen"`: method `A` (now the new code) has `darkShare` within 0.01 of method `C`'s, `jumpShareP50` ≤ 0.10, and `errP90` within 100 of `C`'s. Paste both rows into the hand-off. On a miss: priors and `PRIOR_WEIGHT` may be tuned within the measured ranges (English 0.065–0.091 s, Japanese 0.14–0.18, Chinese 0.21–0.31) and Task 1's expected values updated; if it still misses, stop and report the numbers.

- [ ] **Step 4: Soniox acceptance (needs the owner)**

Ask the owner for the go-ahead and a key: four sessions, about 3 minutes of speech, about US$0.03, billed to them. Then follow `scripts/dev/karaoke-probe/README.md` → "Acceptance run (Soniox)". Expected for `group: "soniox"`: the same three bars as Step 3. A further live run after a miss needs the owner's go-ahead again.

- [ ] **Step 5: Live check in the app (the owner)**

Hand the owner the checklist: with Soniox (own key) and with Kizuna AI, one session each: the highlight starts with the voice; it never runs backward within a sentence; switching Translation I hear off mid-sentence leaves no row lit.
