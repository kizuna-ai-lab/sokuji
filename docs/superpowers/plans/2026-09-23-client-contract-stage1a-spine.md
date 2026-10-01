# Client contract — Stage 1a: the spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pure core of the new client contract — L0 types, a scripted fake adapter, a conformance checker, L1 (`Conversation`), L2 (`project`) and the export writer — built and proven with vitest alone, touching nothing the app runs today.

**Architecture:** Three leaf packages under `src/lib/` (`contract`, `conversation`, `projection`) plus `src/providers/fake/` and `src/lib/export/`. Adapters emit a tagged event stream; one `Conversation` per leg folds it into immutable `Segment`s; one `Projector` cuts, pairs and orders both legs into `Entry[]`; the export writer renders `Entry[]`. The fake adapter plays a timed script on a `Clock`, so every test is deterministic and the same fixtures feed every layer.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`), vitest (`globals: true`, jsdom), the existing leaf helpers `src/lib/segmentation/sentenceEnd.ts` (`sentenceEnds`, `skeleton`, `baseLang`) and `src/lib/segmentation/sealCursor.ts` (`countSkeleton`, `offsetAfterSkeleton`), `src/lib/diagnostics/clientDiagnostics.ts` (`CLIENT_DIAGNOSTICS`).

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — sections "L0 — the client contract" (incl. "What every adapter must honour"), "L1 — the data model", "L2 — the projection" (incl. "Export: one block per group"), "Testing". Roadmap: `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`.

## Global Constraints

- Work on branch `worktree-client-contract-refactor` in this worktree. Commit after every task. **Never push.**
- **Rewrite, not port** (spec D11): nothing under `src/lib/contract`, `src/lib/conversation`, `src/lib/projection`, `src/lib/export`, `src/providers/fake` imports from `src/services/clients/`, `src/services/interfaces/IClient.ts`, `src/services/providers/`, or any store under `src/stores/`. They are leaf modules: their only imports are each other and the helpers named in Tech Stack.
- No `console.*` anywhere in the new files. Failures a layer notices go out through the `onDiagnostic` callback defined in Task 5 (`consoleLedger.consistency.test.ts` counts console calls per file and would fail).
- Audio is **24 kHz mono `Int16Array`** in both directions (`SAMPLE_RATE = 24000`).
- `range` is in **UTF-16 code units** of the text as it was when the audio was produced.
- Segment ids are `` `${session}:${leg}:${n}` ``; row keys are `` `${segmentId}:${k}` ``.
- English-only comments and test names. Tests are colocated as `*.test.ts` next to the module.
- Conventional commit messages. Every commit message ends with these two lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28
  ```
- Run a single test file with `npx vitest run <path>`; run everything with `npx vitest run`. Typecheck with `npx tsc --noEmit -p tsconfig.json` (the Vite build does not typecheck, so this is the only gate for types).

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/contract/adapter.ts` | L0 types only: `SessionContext`, `StartRequest`, `AdapterSession`, `AdapterEvents`, `Adapter`, `SAMPLE_RATE` |
| `src/lib/contract/clock.ts` | `Clock`, `realClock`, `createVirtualClock()` |
| `src/lib/contract/events.ts` | `AdapterEvent` tagged union, `eventsFrom(listener)`, `recordEvents()` |
| `src/lib/contract/conformance.ts` | `checkConformance(log, context)` → `Violation[]` — the rules of "What every adapter must honour" |
| `src/providers/fake/script.ts` | `FakeScript`, `ScriptBlock`, `ScriptStep`, the `exchange()` builder |
| `src/providers/fake/synth.ts` | `synthPcm(ms)`, `msForText(text)` |
| `src/providers/fake/adapter.ts` | `createFakeAdapter(clock)`, `FakeConfig`, `FakeFaults` |
| `src/lib/conversation/types.ts` | `Leg`, `Segment`, `Speech`, `Mark`, `Notice`, `Languages`, `LegName`, `SegmentId`, `EMPTY_PCM` |
| `src/lib/conversation/reanchor.ts` | `reanchorRanges(oldText, newText, ranges)` |
| `src/lib/conversation/fillIn.ts` | `Punctuator`, `fillIn(lang, text, punctuate)` |
| `src/lib/conversation/Conversation.ts` | `Conversation` — one per leg; `apply`, `finalizeAll`, `clear`, `snapshot`, `subscribe` |
| `src/lib/projection/types.ts` | `Row`, `Entry`, `Pairing`, `CutSettings`, `PairingThresholds`, `ProjectionSettings` |
| `src/lib/projection/cut.ts` | `cutRanges`, `pauseCuts`, `cutSegment` |
| `src/lib/projection/pair.ts` | `inferPairs`, `DEFAULT_PAIRING` |
| `src/lib/projection/project.ts` | `createProjector()` → `project(legs, settings)` |
| `src/lib/export/transcript.ts` | `renderTranscriptTxt`, `renderTranscriptJson` |

---

### Task 1: The L0 contract types and the clock

**Files:**
- Create: `src/lib/contract/adapter.ts`
- Create: `src/lib/contract/clock.ts`
- Test: `src/lib/contract/clock.test.ts`
- Test: `src/lib/contract/adapter.test.ts`

**Interfaces:**
- Consumes: `ClientDiagnosticCode` from `src/lib/diagnostics/clientDiagnostics.ts`.
- Produces: everything in `adapter.ts` and `clock.ts` below. Every later task imports these names exactly.

- [ ] **Step 1: Write the failing clock test**

`src/lib/contract/clock.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from './clock';

describe('createVirtualClock', () => {
  it('starts at the given time and advances', () => {
    const clock = createVirtualClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(250);
    expect(clock.now()).toBe(1250);
  });

  it('fires timers in due order, with now() equal to each due time inside the callback', () => {
    const clock = createVirtualClock();
    const seen: Array<[string, number]> = [];
    clock.setTimeout(() => seen.push(['b', clock.now()]), 200);
    clock.setTimeout(() => seen.push(['a', clock.now()]), 100);
    clock.setTimeout(() => seen.push(['c', clock.now()]), 200);
    clock.advance(300);
    expect(seen).toEqual([['a', 100], ['b', 200], ['c', 200]]);
    expect(clock.now()).toBe(300);
  });

  it('does not fire a cancelled timer', () => {
    const clock = createVirtualClock();
    let fired = false;
    const cancel = clock.setTimeout(() => { fired = true; }, 50);
    cancel();
    clock.advance(100);
    expect(fired).toBe(false);
  });

  it('fires a timer scheduled from inside a callback when it is due within the same advance', () => {
    const clock = createVirtualClock();
    const seen: number[] = [];
    clock.setTimeout(() => {
      seen.push(clock.now());
      clock.setTimeout(() => seen.push(clock.now()), 10);
    }, 10);
    clock.advance(50);
    expect(seen).toEqual([10, 20]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/contract/clock.test.ts`
Expected: FAIL — `Cannot find module './clock'`.

- [ ] **Step 3: Write the clock**

`src/lib/contract/clock.ts`:

```ts
/**
 * The one clock every timer in the new spine reads. Production passes
 * `realClock`; tests pass a virtual clock and advance it by hand, so a script
 * that spans a minute runs in a millisecond and never flakes.
 */
export interface Clock {
  now(): number;
  /** Schedules `fn` after `ms`; returns a cancel function. */
  setTimeout(fn: () => void, ms: number): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

export interface VirtualClock extends Clock {
  /** Moves time forward, firing every due timer in order of due time, then
   *  insertion. A timer scheduled by a callback fires in the same advance
   *  when it falls due inside it. */
  advance(ms: number): void;
}

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
  cancelled: boolean;
}

export function createVirtualClock(start = 0): VirtualClock {
  let now = start;
  let seq = 0;
  /** Kept sorted by (at, seq), so advancing pops from the front. A script of
   *  thousands of exchanges schedules tens of thousands of timers; a linear
   *  scan per pop would be quadratic. */
  const timers: Timer[] = [];

  const before = (a: Timer, b: Timer) => a.at < b.at || (a.at === b.at && a.seq < b.seq);

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const timer: Timer = { at: now + Math.max(0, ms), seq: seq++, fn, cancelled: false };
      let lo = 0;
      let hi = timers.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (before(timers[mid], timer)) lo = mid + 1; else hi = mid;
      }
      timers.splice(lo, 0, timer);
      return () => { timer.cancelled = true; };
    },
    advance(ms) {
      const target = now + ms;
      while (timers.length > 0 && timers[0].at <= target) {
        const due = timers.shift() as Timer;
        if (due.cancelled) continue;
        now = due.at;
        due.fn();
      }
      now = target;
    },
  };
}
```

- [ ] **Step 4: Run the clock test**

Run: `npx vitest run src/lib/contract/clock.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the contract types**

`src/lib/contract/adapter.ts`:

```ts
/**
 * L0 — what an adapter receives and what it emits. Types only.
 *
 * An adapter talks to one provider for one leg and emits content: text
 * between provider boundaries (segments), audio with the stretch of text it
 * speaks (range), and lifecycle. Identity, time, ordering, cutting and logging
 * vocabulary are not its business (spec: "L0 — the client contract").
 */
import type { ClientDiagnosticCode } from '../diagnostics/clientDiagnostics';

/** Audio crosses the contract at this rate, mono, Int16, in both directions. */
export const SAMPLE_RATE = 24000;

export type Lang = string;
export type Side = 'source' | 'translation';
/** An adapter-local counter naming a segment; never reused within one session. */
export type Ref = number;
/** UTF-16 code-unit offsets into a segment's text: [start, end). */
export type TextRange = [number, number];
export interface SegmentTiming { startMs: number; endMs: number }

export interface SessionContext {
  direction: { source: Lang; target: Lang };
  /** Produce translated audio at all. */
  speech: boolean;
  /** Always 'auto' on the participant leg. */
  turns: 'auto' | 'manual';
}

export interface StartRequest<C, K> {
  context: SessionContext;
  config: C;
  credentials: K;
  /** A track from the runner's capture graph, for adapters that send a native
   *  track (WebRTC). Absent in tests and ignored by adapters that take pcm. */
  input?: MediaStreamTrack;
}

export interface AdapterSession {
  appendAudio(pcm: Int16Array): void;
  appendText(text: string): void;
  /** Manual turns only: key pressed / released with speech / released without. */
  beginTurn(): void;
  endTurn(): void;
  cancelTurn(): void;
  stop(): Promise<void>;
  /** What the started session actually used, for telemetry. */
  readonly info: { transport?: string };
}

export interface AdapterEvents {
  segmentOpened(e: { ref: Ref; side: Side; origin?: string }): void;
  /** Always the whole text; a snapshot, never a delta. */
  segmentText(e: { ref: Ref; text: string; timing?: SegmentTiming; language?: string }): void;
  segmentClosed(e: { ref: Ref; origin?: string }): void;
  /** `ref` absent: attributable to no segment (plays, pairs with nothing).
   *  `range` absent: this segment's audio, which characters unknown. */
  audio(e: { pcm: Int16Array; ref?: Ref; range?: TextRange }): void;
  closed(e: { reason: string }): void;
  reconnecting(): void;
  reconnected(): void;
  /** The session is broken. Nothing follows. */
  failed(e: { message: string; code?: string; cause?: unknown }): void;
  /** Running, degraded. */
  degraded(e: { code: ClientDiagnosticCode; message: string; cause?: unknown }): void;
  loading(e: { stage: string; done: number; total: number }): void;
  busy(e: boolean): void;
  /** Wire traffic for the Logs panel. Never audio, never a credential. */
  frame(e: { direction: 'in' | 'out'; type: string; payload?: unknown }): void;
}

export interface Adapter<C, K> {
  start(request: StartRequest<C, K>, events: AdapterEvents): Promise<AdapterSession>;
}
```

- [ ] **Step 6: Write a type-level test for the contract**

`src/lib/contract/adapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SAMPLE_RATE, type Adapter, type AdapterEvents, type AdapterSession } from './adapter';

/** A no-op adapter: proves the interface can be implemented as written. */
const nullAdapter: Adapter<{ name: string }, { key: string }> = {
  async start(request, events): Promise<AdapterSession> {
    events.segmentOpened({ ref: 1, side: 'source' });
    events.segmentText({ ref: 1, text: request.config.name });
    events.segmentClosed({ ref: 1 });
    return {
      appendAudio() {},
      appendText() {},
      beginTurn() {},
      endTurn() {},
      cancelTurn() {},
      async stop() {},
      info: { transport: 'none' },
    };
  },
};

describe('contract', () => {
  it('fixes the sample rate at 24 kHz', () => {
    expect(SAMPLE_RATE).toBe(24000);
  });

  it('can be implemented by a minimal adapter', async () => {
    const seen: string[] = [];
    const events: AdapterEvents = {
      segmentOpened: () => seen.push('opened'),
      segmentText: (e) => seen.push(`text:${e.text}`),
      segmentClosed: () => seen.push('closed'),
      audio: () => seen.push('audio'),
      closed: () => seen.push('closed-session'),
      reconnecting: () => {},
      reconnected: () => {},
      failed: () => {},
      degraded: () => {},
      loading: () => {},
      busy: () => {},
      frame: () => {},
    };
    const session = await nullAdapter.start(
      { context: { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' }, config: { name: 'hi' }, credentials: { key: '' } },
      events,
    );
    expect(seen).toEqual(['opened', 'text:hi', 'closed']);
    expect(session.info.transport).toBe('none');
  });
});
```

- [ ] **Step 7: Run both tests and the typecheck**

Run: `npx vitest run src/lib/contract && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (6 tests); tsc prints nothing.

- [ ] **Step 8: Commit**

```bash
git add src/lib/contract/adapter.ts src/lib/contract/adapter.test.ts src/lib/contract/clock.ts src/lib/contract/clock.test.ts
git commit -m "feat(contract): the L0 adapter contract and a virtual clock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 2: The tagged event stream

**Files:**
- Create: `src/lib/contract/events.ts`
- Test: `src/lib/contract/events.test.ts`

**Interfaces:**
- Consumes: `AdapterEvents` (Task 1).
- Produces: `AdapterEvent` (a discriminated union, `{ kind, payload }`), `eventsFrom(listener): AdapterEvents`, `recordEvents(): { events, log }`. L1 (`Conversation.apply`) takes an `AdapterEvent`; the fake and the runner build their `AdapterEvents` with `eventsFrom`.

- [ ] **Step 1: Write the failing test**

`src/lib/contract/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eventsFrom, recordEvents, type AdapterEvent } from './events';

describe('eventsFrom', () => {
  it('forwards every method as a tagged event, in call order', () => {
    const log: AdapterEvent[] = [];
    const events = eventsFrom((e) => log.push(e));
    events.segmentOpened({ ref: 1, side: 'source' });
    events.segmentText({ ref: 1, text: 'hello' });
    events.reconnecting();
    events.busy(true);
    expect(log).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'hello' } },
      { kind: 'reconnecting', payload: undefined },
      { kind: 'busy', payload: true },
    ]);
  });
});

describe('recordEvents', () => {
  it('keeps a log the test can assert on', () => {
    const { events, log } = recordEvents();
    events.closed({ reason: 'stopped' });
    expect(log).toEqual([{ kind: 'closed', payload: { reason: 'stopped' } }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/contract/events.test.ts`
Expected: FAIL — `Cannot find module './events'`.

- [ ] **Step 3: Write the module**

`src/lib/contract/events.ts`:

```ts
import type { AdapterEvents } from './adapter';

type PayloadOf<K extends keyof AdapterEvents> = Parameters<AdapterEvents[K]>[0];

/** One adapter event as a value: `{ kind, payload }`. What L1 folds. */
export type AdapterEvent = {
  [K in keyof AdapterEvents]: { kind: K; payload: PayloadOf<K> };
}[keyof AdapterEvents];

export const EVENT_KINDS: ReadonlyArray<keyof AdapterEvents> = [
  'segmentOpened', 'segmentText', 'segmentClosed', 'audio',
  'closed', 'reconnecting', 'reconnected', 'failed', 'degraded',
  'loading', 'busy', 'frame',
];

/** An `AdapterEvents` object whose every method forwards one tagged event. */
export function eventsFrom(listener: (event: AdapterEvent) => void): AdapterEvents {
  const out: Record<string, (payload?: unknown) => void> = {};
  for (const kind of EVENT_KINDS) {
    out[kind] = (payload?: unknown) => listener({ kind, payload } as AdapterEvent);
  }
  return out as unknown as AdapterEvents;
}

/** For tests: the events object and the array it appends to. */
export function recordEvents(): { events: AdapterEvents; log: AdapterEvent[] } {
  const log: AdapterEvent[] = [];
  return { events: eventsFrom((e) => log.push(e)), log };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lib/contract/events.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (2 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contract/events.ts src/lib/contract/events.test.ts
git commit -m "feat(contract): adapter events as a tagged stream

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 3: The fake adapter — script format, synthetic audio, playback

**Files:**
- Create: `src/providers/fake/script.ts`
- Create: `src/providers/fake/synth.ts`
- Create: `src/providers/fake/adapter.ts`
- Test: `src/providers/fake/adapter.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `AdapterSession`, `AdapterEvents`, `SAMPLE_RATE`, `Side`, `SegmentTiming`, `TextRange` (Task 1); `Clock` (Task 1); `sentenceEnds` from `src/lib/segmentation/sentenceEnd.ts`.
- Produces: `FakeScript`, `ScriptBlock`, `ScriptStep`, `exchange(opts): ScriptBlock`, `synthPcm(ms)`, `msForText(text)`, `createFakeAdapter(clock): Adapter<FakeConfig, FakeCredentials>`, `FakeConfig { script; faults? }`, `FakeFaults { startThrows?; failAfterMs?; failMessage? }`, `FakeCredentials`.

- [ ] **Step 1: Write the failing test**

`src/providers/fake/adapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import type { SessionContext } from '../../lib/contract/adapter';
import { createFakeAdapter, type FakeConfig } from './adapter';
import { exchange, type FakeScript } from './script';
import { synthPcm, msForText } from './synth';

const auto: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const kinds = (log: AdapterEvent[]) => log.map((e) => e.kind);

async function start(script: FakeScript, context = auto, faults?: FakeConfig['faults']) {
  const clock = createVirtualClock();
  const { events, log } = recordEvents();
  const session = await createFakeAdapter(clock).start(
    { context, config: { script, faults }, credentials: {} },
    events,
  );
  return { clock, log, session };
}

describe('synth', () => {
  it('makes 24 kHz pcm of the requested length', () => {
    expect(synthPcm(100).length).toBe(2400);
    expect(synthPcm(100)).toBeInstanceOf(Int16Array);
  });
  it('sizes audio to the text with a floor', () => {
    expect(msForText('')).toBe(200);
    expect(msForText('こんにちは')).toBe(300);
  });
});

describe('exchange', () => {
  it('builds source partials, a close, a translation with audio, and a close', () => {
    const block = exchange({ startAt: 0, ref: 1, source: ['今日は', '今日は天気が'], translation: 'The weather is nice.' });
    expect(block.steps.map((s) => Object.keys(s).find((k) => k !== 'at'))).toEqual([
      'open', 'text', 'text', 'close', 'open', 'text', 'audio', 'close',
    ]);
  });
});

describe('createFakeAdapter', () => {
  it('plays blocks at their start time under automatic turns', async () => {
    const script: FakeScript = { blocks: [
      exchange({ startAt: 100, ref: 1, source: ['a'], translation: 'A.' }),
      exchange({ startAt: 1000, ref: 3, source: ['b'], translation: 'B.' }),
    ] };
    const { clock, log } = await start(script);
    expect(log).toEqual([]);
    // Block 1 spans 100..700 (partial 200 ms apart, 200 ms of audio); block 2 starts at 1000.
    clock.advance(800);
    expect(kinds(log)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed', 'segmentOpened', 'segmentText', 'audio', 'segmentClosed']);
    clock.advance(1000);
    expect(log.length).toBe(14);
  });

  it('emits no audio when the context has speech off', async () => {
    const script: FakeScript = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a'], translation: 'A.' })] };
    const { clock, log } = await start(script, { ...auto, speech: false });
    clock.advance(1000);
    expect(kinds(log)).not.toContain('audio');
  });

  it('holds blocks under manual turns until endTurn, and cancelTurn releases nothing', async () => {
    const script: FakeScript = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a'], translation: 'A.' })] };
    const { clock, log, session } = await start(script, { ...auto, turns: 'manual' });
    clock.advance(5000);
    expect(log).toEqual([]);
    session.beginTurn();
    session.cancelTurn();
    clock.advance(5000);
    expect(log).toEqual([]);
    session.beginTurn();
    session.endTurn();
    clock.advance(5000);
    expect(kinds(log)[0]).toBe('segmentOpened');
  });

  it('answers appendText with a source segment and then a translation', async () => {
    const { log, session } = await start({ blocks: [] });
    session.appendText('hello');
    expect(kinds(log)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed', 'segmentOpened', 'segmentText', 'audio', 'segmentClosed']);
    expect(log[0]).toEqual({ kind: 'segmentOpened', payload: { ref: 1000, side: 'source', origin: 'text-1000' } });
    expect(log[4]).toEqual({ kind: 'segmentText', payload: { ref: 1001, text: '«hello»' } });
  });

  it('emits nothing after stop()', async () => {
    const script: FakeScript = { blocks: [exchange({ startAt: 100, ref: 1, source: ['a'], translation: 'A.' })] };
    const { clock, log, session } = await start(script);
    await session.stop();
    clock.advance(1000);
    expect(log).toEqual([]);
  });

  it('fails after the configured time and then stays silent', async () => {
    const script: FakeScript = { blocks: [exchange({ startAt: 500, ref: 1, source: ['a'], translation: 'A.' })] };
    const { clock, log } = await start(script, auto, { failAfterMs: 100, failMessage: 'boom' });
    clock.advance(1000);
    expect(log).toEqual([{ kind: 'failed', payload: { message: 'boom' } }]);
  });

  it('throws from start() when told to', async () => {
    const clock = createVirtualClock();
    const { events } = recordEvents();
    await expect(createFakeAdapter(clock).start(
      { context: auto, config: { script: { blocks: [] }, faults: { startThrows: 'no network' } }, credentials: {} },
      events,
    )).rejects.toThrow('no network');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/providers/fake/adapter.test.ts`
Expected: FAIL — `Cannot find module './adapter'`.

- [ ] **Step 3: Write `synth.ts`**

```ts
import { SAMPLE_RATE } from '../../lib/contract/adapter';

/** A 440 Hz tone, `ms` long, at the contract's sample rate. */
export function synthPcm(ms: number, hz = 440, amplitude = 8000): Int16Array {
  const n = Math.round((SAMPLE_RATE * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * amplitude);
  }
  return out;
}

/** How long the fake "speaks" a text: 60 ms per character, at least 200 ms. */
export function msForText(text: string, msPerChar = 60): number {
  return Math.max(200, text.length * msPerChar);
}
```

- [ ] **Step 4: Write `script.ts`**

```ts
import type { Side, SegmentTiming, TextRange } from '../../lib/contract/adapter';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { msForText } from './synth';

/** One scripted emission. `at` is relative to the block's start. */
export type ScriptStep =
  | { at: number; open: { ref: number; side: Side; origin?: string } }
  | { at: number; text: { ref: number; text: string; timing?: SegmentTiming; language?: string } }
  | { at: number; close: { ref: number; origin?: string } }
  | { at: number; audio: { ref?: number; range?: TextRange; ms: number } }
  | { at: number; degraded: { code: ClientDiagnosticCode; message: string } }
  | { at: number; reconnecting: true }
  | { at: number; reconnected: true }
  | { at: number; failed: { message: string; code?: string } }
  | { at: number; closed: { reason: string } }
  | { at: number; loading: { stage: string; done: number; total: number } }
  | { at: number; busy: boolean }
  | { at: number; frame: { direction: 'in' | 'out'; type: string; payload?: unknown } };

/**
 * A block plays as one unit: at `startAt` under automatic turns, or on the
 * n-th `endTurn` under manual turns.
 */
export interface ScriptBlock {
  startAt: number;
  steps: ScriptStep[];
}

export interface FakeScript {
  blocks: ScriptBlock[];
  /** What `appendText` answers with. Default: the text wrapped in «». */
  translate?: (text: string) => string;
}

export interface ExchangeOptions {
  startAt: number;
  /** The source segment's ref; the translation takes `ref + 1`. */
  ref: number;
  /** Successive partials; the last one is the final text. */
  source: string[];
  translation: string;
  /** Stated on both segments when given. */
  origin?: string;
  language?: string;
  /** Milliseconds between source partials. */
  partialEvery?: number;
  /** Split the translation's audio into this many chunks with ranges. 0 = one chunk without a range. */
  audioChunks?: number;
  timing?: { source: SegmentTiming; translation: SegmentTiming };
}

/** Source partials → close → translation text → its audio → close. */
export function exchange(o: ExchangeOptions): ScriptBlock {
  const every = o.partialEvery ?? 200;
  const steps: ScriptStep[] = [];
  let at = 0;
  steps.push({ at, open: { ref: o.ref, side: 'source', origin: o.origin } });
  for (const partial of o.source) {
    steps.push({ at, text: { ref: o.ref, text: partial, timing: o.timing?.source, language: o.language } });
    at += every;
  }
  steps.push({ at, close: { ref: o.ref, origin: o.origin } });
  const tr = o.ref + 1;
  at += every;
  steps.push({ at, open: { ref: tr, side: 'translation', origin: o.origin } });
  steps.push({ at, text: { ref: tr, text: o.translation, timing: o.timing?.translation } });
  const chunks = o.audioChunks ?? 1;
  if (chunks <= 0) {
    steps.push({ at, audio: { ref: tr, ms: msForText(o.translation) } });
  } else {
    const len = o.translation.length;
    for (let k = 0; k < chunks; k++) {
      const start = Math.floor((len * k) / chunks);
      const end = k === chunks - 1 ? len : Math.floor((len * (k + 1)) / chunks);
      const piece = o.translation.slice(start, end);
      steps.push({ at, audio: { ref: tr, range: [start, end], ms: msForText(piece) } });
      at += msForText(piece);
    }
  }
  steps.push({ at, close: { ref: tr, origin: o.origin } });
  return { startAt: o.startAt, steps };
}
```

- [ ] **Step 5: Write `adapter.ts`**

```ts
import type { Adapter, AdapterEvents, AdapterSession, SessionContext } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { FakeScript, ScriptBlock, ScriptStep } from './script';
import { msForText, synthPcm } from './synth';

export interface FakeFaults {
  /** `start()` rejects with this message. */
  startThrows?: string;
  /** Emit `failed` this long after start, then stay silent. */
  failAfterMs?: number;
  failMessage?: string;
}

export interface FakeConfig {
  script: FakeScript;
  faults?: FakeFaults;
}

export type FakeCredentials = Record<string, never>;

/** Refs minted for `appendText` start here, above any script ref. */
const TEXT_REF_BASE = 1000;

export function createFakeAdapter(clock: Clock): Adapter<FakeConfig, FakeCredentials> {
  return {
    async start(request, events): Promise<AdapterSession> {
      const { script, faults } = request.config;
      if (faults?.startThrows) throw new Error(faults.startThrows);
      return new FakeSession(clock, script, faults ?? {}, request.context, events);
    },
  };
}

class FakeSession implements AdapterSession {
  readonly info = { transport: 'fake' };
  private ended = false;
  private cancels: Array<() => void> = [];
  private pendingBlocks: ScriptBlock[];
  private nextTextRef = TEXT_REF_BASE;

  constructor(
    private readonly clock: Clock,
    private readonly script: FakeScript,
    faults: FakeFaults,
    private readonly context: SessionContext,
    private readonly events: AdapterEvents,
  ) {
    this.pendingBlocks = [...script.blocks];
    if (context.turns === 'auto') {
      for (const block of this.pendingBlocks) this.schedule(block, block.startAt);
      this.pendingBlocks = [];
    }
    if (faults.failAfterMs !== undefined) {
      const message = faults.failMessage ?? 'fake failure';
      this.cancels.push(clock.setTimeout(() => {
        this.emit('failed', { message });
        this.ended = true;
      }, faults.failAfterMs));
    }
  }

  appendAudio(): void {
    // The fake listens to nothing; audio in is accepted and dropped.
  }

  appendText(text: string): void {
    if (this.ended) return;
    const src = this.nextTextRef++;
    const tr = this.nextTextRef++;
    const origin = `text-${src}`;
    const translate = this.script.translate ?? ((t: string) => `«${t}»`);
    const translated = translate(text);
    this.emit('segmentOpened', { ref: src, side: 'source', origin });
    this.emit('segmentText', { ref: src, text });
    this.emit('segmentClosed', { ref: src, origin });
    this.emit('segmentOpened', { ref: tr, side: 'translation', origin });
    this.emit('segmentText', { ref: tr, text: translated });
    if (this.context.speech) {
      this.emit('audio', { ref: tr, range: [0, translated.length], pcm: synthPcm(msForText(translated)) });
    }
    this.emit('segmentClosed', { ref: tr, origin });
  }

  beginTurn(): void {}

  endTurn(): void {
    const block = this.pendingBlocks.shift();
    if (block) this.schedule(block, 0);
  }

  cancelTurn(): void {}

  async stop(): Promise<void> {
    this.ended = true;
    for (const cancel of this.cancels) cancel();
    this.cancels = [];
  }

  private schedule(block: ScriptBlock, delay: number): void {
    for (const step of block.steps) {
      this.cancels.push(this.clock.setTimeout(() => this.play(step), delay + step.at));
    }
  }

  private play(step: ScriptStep): void {
    if (this.ended) return;
    if ('open' in step) this.emit('segmentOpened', step.open);
    else if ('text' in step) this.emit('segmentText', step.text);
    else if ('close' in step) this.emit('segmentClosed', step.close);
    else if ('audio' in step) {
      if (!this.context.speech) return;
      this.emit('audio', { ref: step.audio.ref, range: step.audio.range, pcm: synthPcm(step.audio.ms) });
    } else if ('degraded' in step) this.emit('degraded', step.degraded);
    else if ('reconnecting' in step) this.emit('reconnecting', undefined);
    else if ('reconnected' in step) this.emit('reconnected', undefined);
    else if ('failed' in step) { this.emit('failed', step.failed); this.ended = true; }
    else if ('closed' in step) { this.emit('closed', step.closed); this.ended = true; }
    else if ('loading' in step) this.emit('loading', step.loading);
    else if ('busy' in step) this.emit('busy', step.busy);
    else if ('frame' in step) this.emit('frame', step.frame);
  }

  private emit<K extends keyof AdapterEvents>(kind: K, payload: Parameters<AdapterEvents[K]>[0]): void {
    if (this.ended) return;
    (this.events[kind] as (p: typeof payload) => void)(payload);
  }
}
```

Note: `emit('reconnecting', undefined)` compiles because `Parameters<() => void>[0]` is `undefined`.

- [ ] **Step 6: Run the test and the typecheck**

Run: `npx vitest run src/providers/fake/adapter.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (10 tests); tsc clean. If tsc complains about `origin: undefined` under `exactOptionalPropertyTypes`, that flag is not set in this repo's tsconfig; if it is, spread `...(o.origin !== undefined ? { origin: o.origin } : {})` at the three sites in `exchange`.

- [ ] **Step 7: Commit**

```bash
git add src/providers/fake
git commit -m "feat(fake): a scripted adapter with synthetic audio and fault knobs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 4: The conformance checker

**Files:**
- Create: `src/lib/contract/conformance.ts`
- Test: `src/lib/contract/conformance.test.ts`

**Interfaces:**
- Consumes: `AdapterEvent` (Task 2), `SessionContext` (Task 1), the fake (Task 3) as the subject under test.
- Produces: `Marker`, `ConformanceLog = Array<AdapterEvent | Marker>`, `Violation { rule; detail; index }`, `checkConformance(log, context): Violation[]`, `recordConformance(): { events; log; mark(name) }`. Plan 1e runs the same checker over a recorded live session of each real adapter.

- [ ] **Step 1: Write the failing test**

`src/lib/contract/conformance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from './clock';
import type { SessionContext } from './adapter';
import { checkConformance, recordConformance, type ConformanceLog } from './conformance';
import { createFakeAdapter } from '../../providers/fake/adapter';
import { exchange, type FakeScript } from '../../providers/fake/script';

const auto: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
const rules = (log: ConformanceLog, ctx = auto) => checkConformance(log, ctx).map((v) => v.rule);

describe('checkConformance on the fake', () => {
  it('passes a clean exchange', async () => {
    const clock = createVirtualClock();
    const { events, log, mark } = recordConformance();
    const script: FakeScript = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a', 'ab'], translation: 'Ab.', audioChunks: 2 })] };
    const session = await createFakeAdapter(clock).start({ context: auto, config: { script }, credentials: {} }, events);
    clock.advance(5000);
    await session.stop();
    mark('stop');
    clock.advance(5000);
    expect(checkConformance(log, auto)).toEqual([]);
  });

  it('passes manual turns and text input', async () => {
    const clock = createVirtualClock();
    const { events, log, mark } = recordConformance();
    const ctx: SessionContext = { ...auto, turns: 'manual' };
    const script: FakeScript = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a'], translation: 'A.' })] };
    const session = await createFakeAdapter(clock).start({ context: ctx, config: { script }, credentials: {} }, events);
    session.beginTurn(); session.cancelTurn(); mark('cancelTurn');
    clock.advance(1000);
    session.beginTurn(); session.endTurn(); mark('endTurn');
    clock.advance(5000);
    mark('appendText'); session.appendText('typed');
    expect(checkConformance(log, ctx)).toEqual([]);
  });
});

describe('checkConformance rules', () => {
  const opened = (ref: number, side: 'source' | 'translation' = 'source') => ({ kind: 'segmentOpened' as const, payload: { ref, side } });
  const text = (ref: number, t: string) => ({ kind: 'segmentText' as const, payload: { ref, text: t } });
  const pcm = new Int16Array(240);

  it('flags an event after failed', () => {
    const log: ConformanceLog = [{ kind: 'failed', payload: { message: 'x' } }, opened(1)];
    expect(rules(log)).toContain('ended-silence');
  });

  it('flags an event after the stop marker', () => {
    const log: ConformanceLog = [{ kind: 'marker', payload: 'stop' }, opened(1)];
    expect(rules(log)).toContain('stop-silence');
  });

  it('flags a ref opened twice', () => {
    expect(rules([opened(1), opened(1)])).toContain('ref-opened-once');
  });

  it('flags text for a ref never opened', () => {
    expect(rules([text(7, 'hi')])).toContain('text-before-open');
  });

  it('allows audio before the text of its ref', () => {
    expect(rules([{ kind: 'audio', payload: { ref: 1, pcm } }, opened(1, 'translation'), text(1, 'hi')])).toEqual([]);
  });

  it('flags a range past the text', () => {
    const log: ConformanceLog = [opened(1, 'translation'), text(1, 'hi'), { kind: 'audio', payload: { ref: 1, pcm, range: [0, 5] } }];
    expect(rules(log)).toContain('range-in-text');
  });

  it('flags audio when speech is off', () => {
    const log: ConformanceLog = [opened(1, 'translation'), text(1, 'hi'), { kind: 'audio', payload: { ref: 1, pcm } }];
    expect(rules(log, { ...auto, speech: false })).toContain('no-audio-when-silent');
  });

  it('flags a segment event before the first endTurn under manual turns', () => {
    expect(rules([opened(1)], { ...auto, turns: 'manual' })).toContain('manual-turn-gate');
  });

  it('flags a frame carrying audio, a huge string, or a credential key', () => {
    const big = 'x'.repeat(3000);
    const log: ConformanceLog = [
      { kind: 'frame', payload: { direction: 'out', type: 't', payload: { audio: pcm } } },
      { kind: 'frame', payload: { direction: 'out', type: 't', payload: { data: big } } },
      { kind: 'frame', payload: { direction: 'out', type: 't', payload: { apiKey: 'sk-1' } } },
    ];
    expect(checkConformance(log, auto).filter((v) => v.rule === 'frame-clean')).toHaveLength(3);
  });

  it('flags text input that is not answered with a source then a translation', () => {
    const log: ConformanceLog = [{ kind: 'marker', payload: 'appendText' }, opened(1, 'translation')];
    expect(rules(log)).toContain('text-input-answered');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/contract/conformance.test.ts`
Expected: FAIL — `Cannot find module './conformance'`.

- [ ] **Step 3: Write the checker**

`src/lib/contract/conformance.ts`:

```ts
/**
 * The rules of "What every adapter must honour", checked over a recorded
 * event log. Markers record what the caller did (stop, turns, text input) so
 * the rules that depend on it can be checked from the log alone.
 */
import type { SessionContext } from './adapter';
import { eventsFrom, type AdapterEvent } from './events';

export type MarkerName = 'stop' | 'endTurn' | 'cancelTurn' | 'appendText';
export interface Marker { kind: 'marker'; payload: MarkerName }
export type ConformanceLog = Array<AdapterEvent | Marker>;

export interface Violation { rule: string; detail: string; index: number }

const CREDENTIAL_KEY = /key|token|secret|authorization|password/i;
const MAX_FRAME_STRING = 2048;

export function recordConformance(): { events: ReturnType<typeof eventsFrom>; log: ConformanceLog; mark(name: MarkerName): void } {
  const log: ConformanceLog = [];
  return {
    events: eventsFrom((e) => log.push(e)),
    log,
    mark: (name) => log.push({ kind: 'marker', payload: name }),
  };
}

export function checkConformance(log: ConformanceLog, context: SessionContext): Violation[] {
  const out: Violation[] = [];
  const opened = new Set<number>();
  const textOf = new Map<number, string>();
  let ended = false;
  let stopped = false;
  let turnsEnded = 0;
  // After an appendText marker: expect a source open, then a translation open.
  let textInput: 'idle' | 'want-source' | 'want-translation' = 'idle';

  const flag = (rule: string, detail: string, index: number) => out.push({ rule, detail, index });

  log.forEach((entry, index) => {
    if (entry.kind === 'marker') {
      if (entry.payload === 'stop') stopped = true;
      if (entry.payload === 'endTurn') turnsEnded++;
      if (entry.payload === 'appendText') {
        if (textInput !== 'idle') flag('text-input-answered', 'previous text input was never answered', index);
        textInput = 'want-source';
      }
      return;
    }
    if (ended) flag('ended-silence', `${entry.kind} after failed/closed`, index);
    if (stopped) flag('stop-silence', `${entry.kind} after stop()`, index);

    const isSegmentEvent = entry.kind === 'segmentOpened' || entry.kind === 'segmentText' || entry.kind === 'segmentClosed' || entry.kind === 'audio';
    if (context.turns === 'manual' && isSegmentEvent && turnsEnded === 0 && textInput === 'idle') {
      flag('manual-turn-gate', `${entry.kind} before the first endTurn`, index);
    }

    switch (entry.kind) {
      case 'segmentOpened': {
        const { ref, side } = entry.payload;
        if (opened.has(ref)) flag('ref-opened-once', `ref ${ref} opened twice`, index);
        opened.add(ref);
        if (!textOf.has(ref)) textOf.set(ref, '');
        if (textInput === 'want-source') {
          if (side !== 'source') flag('text-input-answered', 'text input answered with a non-source segment first', index);
          textInput = 'want-translation';
        } else if (textInput === 'want-translation') {
          if (side !== 'translation') flag('text-input-answered', 'text input\'s source was not followed by a translation', index);
          textInput = 'idle';
        }
        break;
      }
      case 'segmentText': {
        const { ref, text } = entry.payload;
        if (!opened.has(ref)) flag('text-before-open', `text for ref ${ref} before segmentOpened`, index);
        textOf.set(ref, text);
        break;
      }
      case 'audio': {
        const { ref, range, pcm } = entry.payload;
        if (!context.speech) flag('no-audio-when-silent', 'audio with speech: false', index);
        if (!(pcm instanceof Int16Array)) flag('audio-int16', 'pcm is not an Int16Array', index);
        if (range) {
          const [start, end] = range;
          const len = opened.has(ref ?? -1) ? (textOf.get(ref ?? -1) ?? '').length : Infinity;
          if (start < 0 || start > end || end > len) flag('range-in-text', `range [${start}, ${end}] outside text of length ${len}`, index);
        }
        break;
      }
      case 'failed':
      case 'closed':
        ended = true;
        break;
      case 'frame': {
        const problem = dirtyFrame(entry.payload.payload);
        if (problem) flag('frame-clean', problem, index);
        break;
      }
      default:
        break;
    }
  });
  return out;
}

/** Why a frame payload is not fit for the Logs panel, or null. */
function dirtyFrame(value: unknown, path = 'payload'): string | null {
  if (value instanceof Int16Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return `${path} carries audio`;
  if (typeof value === 'string') return value.length >= MAX_FRAME_STRING ? `${path} is a ${value.length}-char string` : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const p = dirtyFrame(value[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CREDENTIAL_KEY.test(k)) return `${path}.${k} looks like a credential`;
      const p = dirtyFrame(v, `${path}.${k}`);
      if (p) return p;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lib/contract/conformance.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (12 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contract/conformance.ts src/lib/contract/conformance.test.ts
git commit -m "feat(contract): a conformance checker for the adapter obligations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 5: L1 — `Conversation`: identity, text, closing, audio, notices

**Files:**
- Create: `src/lib/conversation/types.ts`
- Create: `src/lib/conversation/Conversation.ts`
- Test: `src/lib/conversation/Conversation.test.ts`

**Interfaces:**
- Consumes: `AdapterEvent` (Task 2), `Clock` (Task 1), `CLIENT_DIAGNOSTICS`.
- Produces: `types.ts` (`Leg`, `Segment`, `Speech`, `Mark`, `Notice`, `Languages`, `LegName`, `SegmentId`, `EMPTY_PCM`), `Conversation` with `apply(event)`, `finalizeAll()`, `clear()`, `snapshot(): Leg`, `subscribe(cb): () => void`, `ConversationOptions`, `ConversationDiagnostic`, `MARK_COMPACT_MS`. Tasks 6 and 7 extend this class in place; the reanchor and fill-in hooks are stubbed here as identity and replaced there.

- [ ] **Step 1: Write the failing test**

`src/lib/conversation/Conversation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { AdapterEvent } from '../contract/events';
import { Conversation, MARK_COMPACT_MS, type ConversationDiagnostic } from './Conversation';

const pcm = (n: number) => new Int16Array(n);

function make(extra: Partial<ConstructorParameters<typeof Conversation>[0]> = {}) {
  const clock = createVirtualClock(10_000);
  const diagnostics: ConversationDiagnostic[] = [];
  const conv = new Conversation({
    leg: 'speaker', session: 's1', languages: { source: 'ja', target: 'en' }, clock,
    onDiagnostic: (d) => diagnostics.push(d),
    ...extra,
  });
  const apply = (...events: AdapterEvent[]) => events.forEach((e) => conv.apply(e));
  return { clock, conv, diagnostics, apply };
}

describe('Conversation — identity and text', () => {
  it('names segments by session, leg and a counter, in order of opening', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 5, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 9, side: 'translation' } });
    expect(conv.snapshot().segments.map((s) => s.id)).toEqual(['s1:speaker:1', 's1:speaker:2']);
    expect(conv.snapshot().segments[0].openedAt).toBe(10_000);
  });

  it('replaces text wholesale, records timing and language, and keeps a compacted growth trace', () => {
    const { conv, clock, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: '今日' } });
    clock.advance(MARK_COMPACT_MS - 1);
    apply({ kind: 'segmentText', payload: { ref: 1, text: '今日は' } });
    clock.advance(2000);
    apply({ kind: 'segmentText', payload: { ref: 1, text: '今日は晴れ', timing: { startMs: 0, endMs: 900 }, language: 'ja' } });
    const seg = conv.snapshot().segments[0];
    expect(seg.text).toBe('今日は晴れ');
    expect(seg.timing).toEqual({ startMs: 0, endMs: 900 });
    expect(seg.language).toBe('ja');
    expect(seg.marks).toEqual([{ at: 10_000 + MARK_COMPACT_MS - 1, len: 3 }, { at: 12_099, len: 5 }]);
  });

  it('closes a segment as final and records a stated origin', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentClosed', payload: { ref: 1, origin: 'u1' } });
    expect(conv.snapshot().segments[0]).toMatchObject({ final: true, origin: 'u1' });
  });

  it('treats text after close as a revision without reopening', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a' } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'ab' } });
    expect(conv.snapshot().segments[0]).toMatchObject({ text: 'ab', final: true });
  });

  it('reports a contract violation for text on an unknown ref and for a ref opened twice, and ignores them', () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentText', payload: { ref: 3, text: 'x' } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    expect(diagnostics.map((d) => d.code)).toEqual(['contract_violation', 'contract_violation']);
    expect(conv.snapshot().segments).toHaveLength(1);
  });
});

describe('Conversation — audio', () => {
  it('attaches audio to its segment with its range', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 2, text: 'Hello there.' } });
    apply({ kind: 'audio', payload: { ref: 2, range: [0, 6], pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 6], pcm: pcm(240) }]);
  });

  it('holds audio that arrives before its segment opens, and attaches it on open', () => {
    const { conv, apply } = make();
    apply({ kind: 'audio', payload: { ref: 2, pcm: pcm(240) } });
    expect(conv.snapshot().segments).toHaveLength(0);
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    expect(conv.snapshot().segments[0].speech).toHaveLength(1);
  });

  it('ignores audio without a ref', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'audio', payload: { pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([]);
  });

  it('drops a range outside the text, keeps the pcm, and reports it once', () => {
    const { conv, diagnostics, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'abc' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 9], pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: undefined, pcm: pcm(240) }]);
    expect(diagnostics.map((d) => d.code)).toEqual(['range_out_of_text']);
  });
});

describe('Conversation — notices and closing', () => {
  it('turns failed into an error notice and degraded into a notice with the table\'s severity', () => {
    const { conv, apply } = make();
    apply({ kind: 'failed', payload: { message: 'socket died', code: 'E1' } });
    apply({ kind: 'degraded', payload: { code: 'input_pipeline_failed', message: 'mic gone' } });
    apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'no voice' } });
    expect(conv.snapshot().notices.map((n) => [n.severity, n.message, n.code])).toEqual([
      ['error', 'socket died', 'E1'],
      ['error', 'mic gone', 'input_pipeline_failed'],
      ['warning', 'no voice', 'tts_degraded'],
    ]);
    expect(conv.snapshot().notices[0].id).toBe('s1:speaker:n1');
  });

  it('finalizes every open segment on closed and on finalizeAll', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    apply({ kind: 'closed', payload: { reason: 'server' } });
    expect(conv.snapshot().segments.every((s) => s.final)).toBe(true);
    apply({ kind: 'segmentOpened', payload: { ref: 3, side: 'source' } });
    conv.finalizeAll();
    expect(conv.snapshot().segments[2].final).toBe(true);
  });

  it('ignores loading, busy, frame, reconnecting and reconnected', () => {
    const { conv, apply } = make();
    apply({ kind: 'loading', payload: { stage: 'asr', done: 1, total: 2 } }, { kind: 'busy', payload: true }, { kind: 'frame', payload: { direction: 'in', type: 't' } }, { kind: 'reconnecting', payload: undefined }, { kind: 'reconnected', payload: undefined });
    expect(conv.snapshot()).toMatchObject({ segments: [], notices: [] });
  });
});

describe('Conversation — snapshot sharing', () => {
  it('returns the same Leg until something changes, and keeps untouched segment objects', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentOpened', payload: { ref: 2, side: 'source' } });
    const a = conv.snapshot();
    expect(conv.snapshot()).toBe(a);
    apply({ kind: 'segmentText', payload: { ref: 2, text: 'x' } });
    const b = conv.snapshot();
    expect(b).not.toBe(a);
    expect(b.segments[0]).toBe(a.segments[0]);
    expect(b.segments[1]).not.toBe(a.segments[1]);
  });

  it('notifies subscribers on every change', () => {
    const { conv, apply } = make();
    let n = 0;
    const off = conv.subscribe(() => n++);
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a' } });
    expect(n).toBe(2);
    off();
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'ab' } });
    expect(n).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts`
Expected: FAIL — `Cannot find module './Conversation'`.

- [ ] **Step 3: Write `types.ts`**

```ts
import type { Side, SegmentTiming, TextRange } from '../contract/adapter';

export type LegName = 'speaker' | 'participant';
/** `${session}:${leg}:${n}` */
export type SegmentId = string;

export interface Mark { at: number; len: number }

export interface Speech {
  /** Which characters this pcm speaks. Absent: replay only, no karaoke. */
  range?: TextRange;
  /** 24 kHz mono. Empty when retention dropped it. */
  pcm: Int16Array;
}

export interface Segment {
  id: SegmentId;
  ref: number;
  side: Side;
  /** Display text, replaced wholesale. */
  text: string;
  /** The adapter closed it. */
  final: boolean;
  /** L1 wall clock at open. */
  openedAt: number;
  /** Growth trace, compacted. */
  marks: readonly Mark[];
  timing?: SegmentTiming;
  language?: string;
  /** Stated by the adapter only; inference lives in L2. */
  origin?: string;
  speech: readonly Speech[];
}

export interface Notice {
  id: string;
  at: number;
  severity: 'error' | 'warning';
  /** Diagnostic English. Surfaces localize by `code` and `params`. */
  message: string;
  code?: string;
  params?: Record<string, string | number>;
}

export interface Languages { source: string; target: string }

export interface Leg {
  leg: LegName;
  session: string;
  /** Frozen at start. The participant leg's is already the reversed pair. */
  languages: Languages;
  segments: readonly Segment[];
  notices: readonly Notice[];
}

export const EMPTY_PCM: Int16Array = new Int16Array(0);
```

- [ ] **Step 4: Write `Conversation.ts`**

```ts
/**
 * L1 — one per leg. Folds the adapter's event stream into immutable
 * segments: identity, time, the growth trace, audio attached by ref, notices.
 * Knows nothing about the other leg.
 */
import type { SegmentTiming, TextRange } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { AdapterEvent } from '../contract/events';
import { CLIENT_DIAGNOSTICS } from '../diagnostics/clientDiagnostics';
import type { Languages, Leg, LegName, Mark, Notice, Segment, Speech } from './types';

/** Writes closer together than this collapse into one mark. It is the
 *  smallest pause a user can configure (`MIN_SEGMENT_PAUSE_MS`), so no cut
 *  a setting could ask for is lost to compaction. */
export const MARK_COMPACT_MS = 100;

export interface ConversationDiagnostic {
  code: 'contract_violation' | 'range_out_of_text';
  message: string;
}

export interface ConversationOptions {
  leg: LegName;
  session: string;
  languages: Languages;
  clock: Clock;
  onDiagnostic?: (d: ConversationDiagnostic) => void;
}

export class Conversation {
  private segments: Segment[] = [];
  private notices: Notice[] = [];
  private readonly indexByRef = new Map<number, number>();
  /** Audio that arrived before its segment opened. */
  private readonly pending = new Map<number, Speech[]>();
  private counter = 0;
  private noticeCounter = 0;
  private version = 0;
  private snapshotVersion = -1;
  private cached: Leg | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(protected readonly opts: ConversationOptions) {}

  apply(event: AdapterEvent): void {
    switch (event.kind) {
      case 'segmentOpened': return this.open(event.payload.ref, event.payload.side, event.payload.origin);
      case 'segmentText': return this.text(event.payload.ref, event.payload.text, event.payload.timing, event.payload.language);
      case 'segmentClosed': return this.close(event.payload.ref, event.payload.origin);
      case 'audio': return this.audio(event.payload.ref, event.payload.range, event.payload.pcm);
      case 'failed': return this.notice('error', event.payload.message, event.payload.code);
      case 'degraded': {
        const severity = CLIENT_DIAGNOSTICS[event.payload.code]?.severity ?? 'warning';
        return this.notice(severity, event.payload.message, event.payload.code);
      }
      case 'closed': return this.finalizeAll();
      default: return;
    }
  }

  /** Every open segment becomes final. Idempotent. */
  finalizeAll(): void {
    this.segments.forEach((seg, i) => { if (!seg.final) this.markFinal(i); });
  }

  /** Extended in Task 7. */
  clear(): void {
    this.segments = [];
    this.notices = [];
    this.indexByRef.clear();
    this.pending.clear();
    this.touch();
  }

  snapshot(): Leg {
    if (this.cached && this.snapshotVersion === this.version) return this.cached;
    this.cached = {
      leg: this.opts.leg,
      session: this.opts.session,
      languages: this.opts.languages,
      segments: [...this.segments],
      notices: [...this.notices],
    };
    this.snapshotVersion = this.version;
    return this.cached;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ---- events ----

  private open(ref: number, side: Segment['side'], origin?: string): void {
    if (this.indexByRef.has(ref)) return this.violation(`ref ${ref} opened twice`);
    const n = ++this.counter;
    const speech = this.pending.get(ref) ?? [];
    this.pending.delete(ref);
    const seg: Segment = {
      id: `${this.opts.session}:${this.opts.leg}:${n}`,
      ref, side, text: '', final: false,
      openedAt: this.opts.clock.now(), marks: [], origin, speech,
    };
    this.indexByRef.set(ref, this.segments.length);
    this.segments.push(seg);
    this.touch();
  }

  private text(ref: number, text: string, timing?: SegmentTiming, language?: string): void {
    const i = this.indexByRef.get(ref);
    if (i === undefined) return this.violation(`text for ref ${ref} before it opened`);
    this.replaceText(i, text, { timing, language, mark: true });
  }

  private close(ref: number, origin?: string): void {
    const i = this.indexByRef.get(ref);
    if (i === undefined) return this.violation(`close for ref ${ref} before it opened`);
    const seg = this.segments[i];
    this.replace(i, { ...seg, origin: origin ?? seg.origin });
    if (!seg.final) this.markFinal(i);
  }

  private audio(ref: number | undefined, range: TextRange | undefined, pcm: Int16Array): void {
    if (ref === undefined) return;
    const i = this.indexByRef.get(ref);
    if (i === undefined) {
      const list = this.pending.get(ref) ?? [];
      list.push({ range, pcm: this.retain(pcm) });
      this.pending.set(ref, list);
      return;
    }
    const seg = this.segments[i];
    let kept = range;
    if (range && (range[0] < 0 || range[0] > range[1] || range[1] > seg.text.length)) {
      this.opts.onDiagnostic?.({ code: 'range_out_of_text', message: `range [${range[0]}, ${range[1]}] outside ${seg.id}'s text of length ${seg.text.length}` });
      kept = undefined;
    }
    this.replace(i, { ...seg, speech: [...seg.speech, { range: kept, pcm: this.retain(pcm) }] });
    this.afterAudio();
  }

  private notice(severity: Notice['severity'], message: string, code?: string): void {
    this.notices.push({ id: `${this.opts.session}:${this.opts.leg}:n${++this.noticeCounter}`, at: this.opts.clock.now(), severity, message, code });
    this.touch();
  }

  // ---- hooks the later tasks fill in ----

  /** Task 6 re-anchors speech ranges and runs punctuation fill-in here. */
  protected replaceText(i: number, text: string, o: { timing?: SegmentTiming; language?: string; mark: boolean }): void {
    const seg = this.segments[i];
    const marks = o.mark ? pushMark(seg.marks, this.opts.clock.now(), text.length) : seg.marks;
    this.replace(i, { ...seg, text, timing: o.timing ?? seg.timing, language: o.language ?? seg.language, marks });
  }

  /** Task 6 triggers fill-in from here. */
  protected markFinal(i: number): void {
    this.replace(i, { ...this.segments[i], final: true });
  }

  /** Task 7 applies the retention policy here. */
  protected retain(pcm: Int16Array): Int16Array { return pcm; }
  protected afterAudio(): void {}

  // ---- internals ----

  protected replace(i: number, next: Segment): void {
    this.segments[i] = next;
    this.touch();
  }

  protected touch(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private violation(message: string): void {
    this.opts.onDiagnostic?.({ code: 'contract_violation', message });
  }
}

function pushMark(marks: readonly Mark[], at: number, len: number): Mark[] {
  const last = marks[marks.length - 1];
  if (last && at - last.at < MARK_COMPACT_MS) return [...marks.slice(0, -1), { at, len }];
  return [...marks, { at, len }];
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (13 tests); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/conversation/types.ts src/lib/conversation/Conversation.ts src/lib/conversation/Conversation.test.ts
git commit -m "feat(conversation): L1 folds adapter events into immutable segments

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 6: L1 — re-anchoring on text replacement and punctuation fill-in

**Files:**
- Create: `src/lib/conversation/reanchor.ts`
- Create: `src/lib/conversation/fillIn.ts`
- Modify: `src/lib/conversation/Conversation.ts` (the `replaceText` and `markFinal` hooks, `ConversationOptions.punctuate`)
- Test: `src/lib/conversation/reanchor.test.ts`, `src/lib/conversation/fillIn.test.ts`, extend `src/lib/conversation/Conversation.test.ts`

**Interfaces:**
- Consumes: `countSkeleton`, `offsetAfterSkeleton` (`src/lib/segmentation/sealCursor.ts`), `sentenceEnds`, `skeleton`, `baseLang` (`src/lib/segmentation/sentenceEnd.ts`).
- Produces: `reanchorRanges(oldText, newText, ranges)`, `Punctuator = (lang, text) => Promise<string | null>`, `fillIn(lang, text, punctuate)`, `ConversationOptions.punctuate?: Punctuator`.

- [ ] **Step 1: Write the failing reanchor test**

`src/lib/conversation/reanchor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reanchorRanges } from './reanchor';

describe('reanchorRanges', () => {
  it('keeps ranges when the text only grew', () => {
    expect(reanchorRanges('hello', 'hello world', [[0, 5]])).toEqual([[0, 5]]);
  });

  it('moves ranges by skeleton when only punctuation and spacing changed', () => {
    // "hello world" → "Hello, world." : the range [6, 11] ("world") lands on "world."
    expect(reanchorRanges('hello world', 'Hello, world.', [[0, 5], [6, 11]])).toEqual([[0, 7], [7, 13]]);
  });

  it('drops ranges when letters changed', () => {
    expect(reanchorRanges('hello world', 'hallo world', [[0, 5], undefined])).toEqual([undefined, undefined]);
  });

  it('is a no-op on a list with no ranges', () => {
    expect(reanchorRanges('a', 'b', [undefined])).toEqual([undefined]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/conversation/reanchor.test.ts`
Expected: FAIL — `Cannot find module './reanchor'`.

- [ ] **Step 3: Write `reanchor.ts`**

```ts
import type { TextRange } from '../contract/adapter';
import { countSkeleton, offsetAfterSkeleton } from '../segmentation/sealCursor';
import { skeleton } from '../segmentation/sentenceEnd';

/**
 * Speech ranges are measured against the text at production time, and the
 * text is replaced repeatedly. Three cases (spec: "Re-anchoring on every text
 * replacement"): the text only grew — ranges stand; the same letters and
 * digits in a different dress — re-anchor by skeleton; letters changed — the
 * ranges are gone, the pcm stays.
 */
export function reanchorRanges(
  oldText: string,
  newText: string,
  ranges: ReadonlyArray<TextRange | undefined>,
): Array<TextRange | undefined> {
  if (ranges.every((r) => r === undefined)) return [...ranges];
  if (newText.startsWith(oldText)) return [...ranges];
  if (skeleton(oldText) === skeleton(newText)) {
    return ranges.map((r) => (r ? [mapOffset(oldText, newText, r[0]), mapOffset(oldText, newText, r[1])] : undefined));
  }
  return ranges.map(() => undefined);
}

/** The offset in `newText` after as many letters and digits as `oldText` has before `offset`. */
function mapOffset(oldText: string, newText: string, offset: number): number {
  return offsetAfterSkeleton(newText, countSkeleton(oldText.slice(0, offset)));
}
```

- [ ] **Step 4: Run the reanchor test**

Run: `npx vitest run src/lib/conversation/reanchor.test.ts`
Expected: PASS (4 tests). If the second case's numbers differ, print `offsetAfterSkeleton('Hello, world.', 5)` and `offsetAfterSkeleton('Hello, world.', 10)` — they must be 7 and 13 (the helper steps over `, ` and `.`); the test encodes the helper's documented behaviour, so adjust the test only if the helper's own test says otherwise.

- [ ] **Step 5: Write the failing fill-in test**

`src/lib/conversation/fillIn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fillIn } from './fillIn';

describe('fillIn', () => {
  it('leaves text that already ends a sentence alone and never calls the model', async () => {
    let calls = 0;
    expect(await fillIn('en', 'Done.', async () => { calls++; return 'Done!'; })).toBe('Done.');
    expect(calls).toBe(0);
  });

  it('takes the model\'s answer when it only adds marks', async () => {
    expect(await fillIn('en', 'hello world', async () => 'Hello, world.')).toBe('Hello, world.');
  });

  it('rejects an answer that changes letters, and a null answer, and a throw', async () => {
    expect(await fillIn('en', 'hello world', async () => 'hallo world.')).toBe('hello world');
    expect(await fillIn('en', 'hello world', async () => null)).toBe('hello world');
    expect(await fillIn('en', 'hello world', async () => { throw new Error('x'); })).toBe('hello world');
  });

  it('does nothing for empty text', async () => {
    expect(await fillIn('en', '', async () => '.')).toBe('');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/conversation/fillIn.test.ts`
Expected: FAIL — `Cannot find module './fillIn'`.

- [ ] **Step 7: Write `fillIn.ts`**

```ts
import { sentenceEnds, skeleton } from '../segmentation/sentenceEnd';

/** Asks a punctuation model for `text` with marks. Null: no answer. */
export type Punctuator = (lang: string, text: string) => Promise<string | null>;

/**
 * Punctuation fill-in, once, when a segment goes final. Text that already
 * carries a sentence end is returned untouched (the local engines punctuate
 * themselves). An answer that alters letters or digits is discarded — that
 * invariant is what lets the speech ranges survive the replacement.
 */
export async function fillIn(lang: string, text: string, punctuate: Punctuator): Promise<string> {
  if (text.length === 0 || sentenceEnds(text).length > 0) return text;
  let filled: string | null;
  try {
    filled = await punctuate(lang, text);
  } catch {
    filled = null;
  }
  if (!filled || skeleton(filled) !== skeleton(text)) return text;
  return filled;
}
```

- [ ] **Step 8: Run the fill-in test**

Run: `npx vitest run src/lib/conversation/fillIn.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Add the Conversation tests for both behaviours**

Append to `src/lib/conversation/Conversation.test.ts`:

```ts
describe('Conversation — re-anchoring and fill-in', () => {
  it('re-anchors speech ranges when punctuation is inserted, and drops them when letters change', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 5], pcm: pcm(10) } }, { kind: 'audio', payload: { ref: 1, range: [6, 11], pcm: pcm(10) } });
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello, world.' } });
    expect(conv.snapshot().segments[0].speech.map((s) => s.range)).toEqual([[0, 7], [7, 13]]);
    apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hallo, world.' } });
    expect(conv.snapshot().segments[0].speech.map((s) => s.range)).toEqual([undefined, undefined]);
    expect(conv.snapshot().segments[0].speech.every((s) => s.pcm.length === 10)).toBe(true);
  });

  it('runs fill-in when a segment closes, in the segment\'s language, and re-anchors through it', async () => {
    const seen: string[] = [];
    const { conv, apply } = make({ punctuate: async (lang, text) => { seen.push(`${lang}:${text}`); return `${text}.`; } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'hello world' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 11], pcm: pcm(10) } });
    apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    await Promise.resolve(); await Promise.resolve();
    expect(seen).toEqual(['en:hello world']);
    expect(conv.snapshot().segments[0]).toMatchObject({ text: 'hello world.', final: true });
    expect(conv.snapshot().segments[0].speech[0].range).toEqual([0, 12]);
  });

  it('prefers the segment\'s detected language and skips fill-in for an auto source', async () => {
    const seen: string[] = [];
    const { conv, apply } = make({ languages: { source: 'auto', target: 'en' }, punctuate: async (lang, text) => { seen.push(lang); return `${text}.`; } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a b' } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'source' } }, { kind: 'segmentText', payload: { ref: 2, text: 'c d', language: 'ja-JP' } }, { kind: 'segmentClosed', payload: { ref: 2 } });
    await Promise.resolve(); await Promise.resolve();
    expect(seen).toEqual(['ja']);
    expect(conv.snapshot().segments[0].text).toBe('a b');
  });
});
```

- [ ] **Step 10: Run it to verify the new cases fail**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts`
Expected: FAIL — the three new tests (ranges not re-anchored; `punctuate` unknown option / never called).

- [ ] **Step 11: Wire the hooks into `Conversation.ts`**

Replace the imports block's first lines and the two hook methods:

```ts
import type { SegmentTiming, TextRange } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { AdapterEvent } from '../contract/events';
import { CLIENT_DIAGNOSTICS } from '../diagnostics/clientDiagnostics';
import { baseLang } from '../segmentation/sentenceEnd';
import { fillIn, type Punctuator } from './fillIn';
import { reanchorRanges } from './reanchor';
import type { Languages, Leg, LegName, Mark, Notice, Segment, Speech } from './types';
```

Add to `ConversationOptions`:

```ts
  /** Punctuation fill-in for segments that close without a sentence end. */
  punctuate?: Punctuator;
```

Replace `replaceText` and `markFinal`:

```ts
  protected replaceText(i: number, text: string, o: { timing?: SegmentTiming; language?: string; mark: boolean }): void {
    const seg = this.segments[i];
    const ranges = reanchorRanges(seg.text, text, seg.speech.map((s) => s.range));
    const speech = seg.speech.map((s, k) => (ranges[k] === s.range ? s : { ...s, range: ranges[k] }));
    const marks = o.mark ? pushMark(seg.marks, this.opts.clock.now(), text.length) : seg.marks;
    this.replace(i, { ...seg, text, timing: o.timing ?? seg.timing, language: o.language ?? seg.language, marks, speech });
  }

  protected markFinal(i: number): void {
    const seg = { ...this.segments[i], final: true };
    this.replace(i, seg);
    const punctuate = this.opts.punctuate;
    if (!punctuate) return;
    const lang = this.fillInLanguage(seg);
    if (!lang) return;
    const before = seg.text;
    void fillIn(lang, before, punctuate).then((filled) => {
      const j = this.indexByRef.get(seg.ref);
      if (j === undefined || filled === before || this.segments[j].text !== before) return;
      this.replaceText(j, filled, { mark: false });
    });
  }

  /** The detected language wins; otherwise the leg's configured one; `auto` means no fill-in. */
  private fillInLanguage(seg: Segment): string | null {
    const configured = seg.side === 'source' ? this.opts.languages.source : this.opts.languages.target;
    const lang = seg.language ?? configured;
    if (!lang || lang === 'auto') return null;
    return baseLang(lang);
  }
```

Note `reanchorRanges` compares by identity in `ranges[k] === s.range`; when the text only grew it returns the same tuple objects, so untouched speech entries keep their identity.

- [ ] **Step 12: Run all conversation tests and the typecheck**

Run: `npx vitest run src/lib/conversation && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (24 tests); tsc clean.

- [ ] **Step 13: Commit**

```bash
git add src/lib/conversation
git commit -m "feat(conversation): re-anchor speech ranges and fill in punctuation on close

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 7: L1 — retention and `clear()`

**Files:**
- Modify: `src/lib/conversation/Conversation.ts` (`ConversationOptions.retention`, the `retain` / `afterAudio` hooks, `clear`)
- Test: extend `src/lib/conversation/Conversation.test.ts`

**Interfaces:**
- Produces: `Retention { keepPcm: boolean; maxPcmBytes: number }`, `ConversationOptions.retention?: Retention` (default `{ keepPcm: true, maxPcmBytes: 64 MiB }`), `DEFAULT_RETENTION`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/conversation/Conversation.test.ts`:

```ts
describe('Conversation — retention and clear', () => {
  it('keeps the range but no pcm when keepPcm is off', () => {
    const { conv, apply } = make({ retention: { keepPcm: false, maxPcmBytes: 1 << 20 } });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'abc' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 3], pcm: pcm(240) } });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 3], pcm: new Int16Array(0) }]);
  });

  it('drops the oldest pcm past the byte ceiling, text and ranges intact', () => {
    const { conv, apply } = make({ retention: { keepPcm: true, maxPcmBytes: 1000 } });
    for (const ref of [1, 2, 3]) {
      apply({ kind: 'segmentOpened', payload: { ref, side: 'translation' } }, { kind: 'segmentText', payload: { ref, text: 'abc' } });
      apply({ kind: 'audio', payload: { ref, range: [0, 3], pcm: pcm(200) } }); // 400 bytes each
    }
    const speech = conv.snapshot().segments.map((s) => s.speech[0]);
    expect(speech.map((s) => s.pcm.length)).toEqual([0, 200, 200]);
    expect(speech.map((s) => s.range)).toEqual([[0, 3], [0, 3], [0, 3]]);
  });

  it('clear() drops closed segments, notices and audio, and keeps open segments open with empty text', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } }, { kind: 'segmentText', payload: { ref: 1, text: 'done' } }, { kind: 'segmentClosed', payload: { ref: 1 } });
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 2, text: 'live' } }, { kind: 'audio', payload: { ref: 2, pcm: pcm(10) } });
    apply({ kind: 'failed', payload: { message: 'x' } });
    conv.clear();
    const leg = conv.snapshot();
    expect(leg.notices).toEqual([]);
    expect(leg.segments.map((s) => [s.ref, s.text, s.final, s.speech.length])).toEqual([[2, '', false, 0]]);
    apply({ kind: 'segmentText', payload: { ref: 2, text: 'still live' } });
    expect(conv.snapshot().segments[0].text).toBe('still live');
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts`
Expected: FAIL — 3 new tests.

- [ ] **Step 3: Implement retention and clear in `Conversation.ts`**

Add after `ConversationDiagnostic`:

```ts
export interface Retention {
  /** Off: pcm is dropped on arrival; the row keeps its range and loses replay. */
  keepPcm: boolean;
  /** Above this many bytes of pcm across the leg, the oldest pcm is dropped. */
  maxPcmBytes: number;
}

export const DEFAULT_RETENTION: Retention = { keepPcm: true, maxPcmBytes: 64 * 1024 * 1024 };
```

Add to `ConversationOptions`:

```ts
  retention?: Retention;
```

Add a field and replace the `retain` / `afterAudio` hooks and `clear`:

```ts
  private pcmBytes = 0;

  protected retain(pcm: Int16Array): Int16Array {
    const retention = this.opts.retention ?? DEFAULT_RETENTION;
    if (!retention.keepPcm) return EMPTY_PCM;
    this.pcmBytes += pcm.byteLength;
    return pcm;
  }

  /** Drop the oldest pcm until the leg is under its ceiling. */
  protected afterAudio(): void {
    const max = (this.opts.retention ?? DEFAULT_RETENTION).maxPcmBytes;
    for (let i = 0; i < this.segments.length && this.pcmBytes > max; i++) {
      const seg = this.segments[i];
      const k = seg.speech.findIndex((s) => s.pcm.length > 0);
      if (k < 0) continue;
      const speech = seg.speech.map((s, j) => (j === k ? { ...s, pcm: EMPTY_PCM } : s));
      this.pcmBytes -= seg.speech[k].pcm.byteLength;
      this.replace(i, { ...seg, speech });
      i--; // the same segment may hold more pcm
    }
  }

  clear(): void {
    const kept = this.segments.filter((s) => !s.final).map((s) => ({ ...s, text: '', marks: [], speech: [], timing: undefined }));
    this.segments = kept;
    this.notices = [];
    this.indexByRef.clear();
    kept.forEach((s, i) => this.indexByRef.set(s.ref, i));
    this.pending.clear();
    this.pcmBytes = 0;
    this.touch();
  }
```

Also import `EMPTY_PCM` from `./types` (add it to the existing `import type { … } from './types'` as a separate value import: `import { EMPTY_PCM } from './types';`).

- [ ] **Step 4: Run all conversation tests and the typecheck**

Run: `npx vitest run src/lib/conversation && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (27 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversation
git commit -m "feat(conversation): pcm retention and clear()

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 8: L2 — cutting segments into rows

**Files:**
- Create: `src/lib/projection/types.ts`
- Create: `src/lib/projection/cut.ts`
- Test: `src/lib/projection/cut.test.ts`

**Interfaces:**
- Consumes: `Segment`, `Mark`, `LegName`, `Languages`, `SegmentId` (Task 5); `sentenceEnds`; `Side`, `TextRange` (Task 1).
- Produces: `Row { key; segmentId; side; start; end }`, `Entry`, `Pairing`, `CutSettings { mode; sentencesPerRow; pauseMs }`, `PairingThresholds`, `ProjectionSettings`, `cutRanges(text, n)`, `pauseCuts(marks, pauseMs, textLength)`, `cutSegment(segment, settings)`.

- [ ] **Step 1: Write the failing test**

`src/lib/projection/cut.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Segment } from '../conversation/types';
import { cutRanges, pauseCuts, cutSegment } from './cut';

const seg = (over: Partial<Segment>): Segment => ({
  id: 's:speaker:1', ref: 1, side: 'source', text: '', final: true, openedAt: 0, marks: [], speech: [], ...over,
});

describe('cutRanges', () => {
  it('tiles the text with no gaps and no trimming, one range per n sentences', () => {
    const text = '今天天气很好。我们去公园吧。顺便买点东西。';
    expect(cutRanges(text, 1)).toEqual([[0, 7], [7, 14], [14, 21]]);
    expect(cutRanges(text, 2)).toEqual([[0, 14], [14, 21]]);
    expect(cutRanges('Hi there. How are you? Fine.', 1)).toEqual([[0, 9], [9, 22], [22, 28]]);
  });

  it('returns the whole text for n = 0, for fewer ends than n, and for empty text', () => {
    expect(cutRanges('One. Two.', 0)).toEqual([[0, 9]]);
    expect(cutRanges('One. Two.', 3)).toEqual([[0, 9]]);
    expect(cutRanges('', 1)).toEqual([[0, 0]]);
  });

  it('never ends with an empty range when the text ends on a sentence end', () => {
    // Not 'A. B.': a lone capital before a period reads as an initial, not a sentence end.
    expect(cutRanges('One. Two.', 1)).toEqual([[0, 4], [4, 9]]);
  });
});

describe('pauseCuts', () => {
  it('cuts at the length the text had when a pause of at least pauseMs began', () => {
    const marks = [{ at: 0, len: 4 }, { at: 200, len: 8 }, { at: 2000, len: 12 }, { at: 2100, len: 16 }];
    expect(pauseCuts(marks, 1500, 16)).toEqual([8]);
  });
  it('drops cuts at 0, at the end, and when pauses are off', () => {
    expect(pauseCuts([{ at: 0, len: 0 }, { at: 5000, len: 9 }, { at: 9000, len: 9 }], 1500, 9)).toEqual([]);
    expect(pauseCuts([{ at: 0, len: 4 }, { at: 5000, len: 9 }], 0, 9)).toEqual([]);
  });
});

describe('cutSegment', () => {
  const sentences = { mode: 'sentences' as const, sentencesPerRow: 1, pauseMs: 0 };
  const pause = { mode: 'pause' as const, sentencesPerRow: 0, pauseMs: 1500 };
  const off = { mode: 'off' as const, sentencesPerRow: 0, pauseMs: 0 };

  it('cuts a final segment by sentences and keys the rows', () => {
    const rows = cutSegment(seg({ text: 'One. Two.' }), sentences);
    expect(rows).toEqual([
      { key: 's:speaker:1:0', segmentId: 's:speaker:1', side: 'source', start: 0, end: 4 },
      { key: 's:speaker:1:1', segmentId: 's:speaker:1', side: 'source', start: 4, end: 9 },
    ]);
  });

  it('leaves an open segment as one live row under the sentences mode', () => {
    expect(cutSegment(seg({ text: 'One. Tw', final: false }), sentences)).toHaveLength(1);
  });

  it('cuts by pause whether the segment is open or closed', () => {
    const s = seg({ text: 'abcdefgh', final: false, marks: [{ at: 0, len: 4 }, { at: 3000, len: 8 }] });
    expect(cutSegment(s, pause).map((r) => [r.start, r.end])).toEqual([[0, 4], [4, 8]]);
  });

  it('is one row when segmentation is off', () => {
    expect(cutSegment(seg({ text: 'One. Two.' }), off)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projection/cut.test.ts`
Expected: FAIL — `Cannot find module './cut'`.

- [ ] **Step 3: Write `types.ts`**

```ts
import type { Side } from '../contract/adapter';
import type { Languages, LegName, SegmentId } from '../conversation/types';

/** A drawn line: a stretch of one segment's text. */
export interface Row {
  /** `${segmentId}:${k}` — stable while the cut does not change. */
  key: string;
  segmentId: SegmentId;
  side: Side;
  start: number;
  end: number;
}

export type Pairing = 'stated' | 'inferred' | 'none';

export type Entry =
  | {
      kind: 'exchange';
      id: string;
      leg: LegName;
      languages: Languages;
      pairing: Pairing;
      source: Row[];
      translation: Row[];
      /** Earliest `openedAt` in the group. */
      t: number;
    }
  | {
      kind: 'notice';
      id: string;
      leg: LegName;
      severity: 'error' | 'warning';
      message: string;
      code?: string;
      at: number;
    };

export interface CutSettings {
  mode: 'off' | 'pause' | 'sentences';
  /** 0 = whole segment. */
  sentencesPerRow: number;
  pauseMs: number;
}

export interface PairingThresholds {
  /** Fraction of the translation's media span that must overlap the source's. */
  minOverlap: number;
  /** How long after a source opens a translation may open and still be its pair. */
  proximityMs: number;
}

export interface ProjectionSettings extends CutSettings {
  pairing: PairingThresholds;
}
```

- [ ] **Step 4: Write `cut.ts`**

```ts
import type { TextRange } from '../contract/adapter';
import type { Mark, Segment } from '../conversation/types';
import { sentenceEnds } from '../segmentation/sentenceEnd';
import type { CutSettings, Row } from './types';

/**
 * `text` cut after every `n`th sentence end. The ranges tile the text — no
 * gaps, no trimming — so adjacent rows concatenated reproduce it exactly; a
 * bubble surface trims for display, a band surface joins with nothing.
 */
export function cutRanges(text: string, n: number): TextRange[] {
  if (text.length === 0) return [[0, 0]];
  if (n <= 0) return [[0, text.length]];
  const ends = sentenceEnds(text);
  if (ends.length < n) return [[0, text.length]];
  const out: TextRange[] = [];
  let start = 0;
  for (let i = n - 1; i < ends.length; i += n) {
    if (ends[i] > start) {
      out.push([start, ends[i]]);
      start = ends[i];
    }
  }
  if (start < text.length) out.push([start, text.length]);
  return out;
}

/** The text lengths at which a pause of at least `pauseMs` began. */
export function pauseCuts(marks: readonly Mark[], pauseMs: number, textLength: number): number[] {
  if (pauseMs <= 0) return [];
  const cuts: number[] = [];
  for (let k = 0; k + 1 < marks.length; k++) {
    const len = marks[k].len;
    if (marks[k + 1].at - marks[k].at < pauseMs) continue;
    if (len <= 0 || len >= textLength) continue;
    if (cuts.length > 0 && cuts[cuts.length - 1] >= len) continue;
    cuts.push(len);
  }
  return cuts;
}

function rangesFromCuts(length: number, cuts: number[]): TextRange[] {
  const out: TextRange[] = [];
  let start = 0;
  for (const cut of cuts) {
    if (cut > start && cut < length) {
      out.push([start, cut]);
      start = cut;
    }
  }
  out.push([start, length]);
  return out;
}

/** A segment's rows under the settings. An open segment under the sentences
 *  mode is one live row; a pause cut applies to open and closed alike. */
export function cutSegment(seg: Segment, settings: CutSettings): Row[] {
  let ranges: TextRange[];
  if (settings.mode === 'sentences' && seg.final) ranges = cutRanges(seg.text, settings.sentencesPerRow);
  else if (settings.mode === 'pause') ranges = rangesFromCuts(seg.text.length, pauseCuts(seg.marks, settings.pauseMs, seg.text.length));
  else ranges = [[0, seg.text.length]];
  return ranges.map(([start, end], k) => ({ key: `${seg.id}:${k}`, segmentId: seg.id, side: seg.side, start, end }));
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `npx vitest run src/lib/projection/cut.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (9 tests); tsc clean. If the English case's offsets differ, check `sentenceEnds('Hi there. How are you? Fine.')` — the expected `[9, 22, 28]` follows its documented "just past the terminal" rule.

- [ ] **Step 6: Commit**

```bash
git add src/lib/projection/types.ts src/lib/projection/cut.ts src/lib/projection/cut.test.ts
git commit -m "feat(projection): cut segments into rows that tile the text

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 9: L2 — inferring source↔translation pairs

**Files:**
- Create: `src/lib/projection/pair.ts`
- Test: `src/lib/projection/pair.test.ts`

**Interfaces:**
- Consumes: `Segment`, `SegmentId` (Task 5); `PairingThresholds` (Task 8).
- Produces: `inferPairs(segments, thresholds): Map<SegmentId, SegmentId>` (translation id → source id, only for segments with no stated origin), `DEFAULT_PAIRING`.

- [ ] **Step 1: Write the failing test**

`src/lib/projection/pair.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Segment } from '../conversation/types';
import { inferPairs, DEFAULT_PAIRING } from './pair';

let n = 0;
const seg = (over: Partial<Segment>): Segment => ({
  id: `s:speaker:${++n}`, ref: n, side: 'source', text: 'x', final: true, openedAt: 0, marks: [], speech: [], ...over,
});

describe('inferPairs', () => {
  it('pairs by maximum media-time overlap when both sides carry timing', () => {
    const s1 = seg({ side: 'source', timing: { startMs: 0, endMs: 1000 } });
    const s2 = seg({ side: 'source', timing: { startMs: 1000, endMs: 2000 } });
    const t = seg({ side: 'translation', timing: { startMs: 900, endMs: 1900 } });
    expect(inferPairs([s1, s2, t], DEFAULT_PAIRING)).toEqual(new Map([[t.id, s2.id]]));
  });

  it('pairs by proximity of opening when timing is absent, within the window and only forward', () => {
    const s1 = seg({ side: 'source', openedAt: 0 });
    const s2 = seg({ side: 'source', openedAt: 5000 });
    const t1 = seg({ side: 'translation', openedAt: 1200 });
    const t2 = seg({ side: 'translation', openedAt: 4000 });
    expect(inferPairs([s1, s2, t1, t2], DEFAULT_PAIRING)).toEqual(new Map([[t1.id, s1.id]]));
  });

  it('never pairs a source twice, and skips segments with a stated origin', () => {
    const s1 = seg({ side: 'source', openedAt: 0 });
    const t1 = seg({ side: 'translation', openedAt: 100 });
    const t2 = seg({ side: 'translation', openedAt: 200 });
    const stated = seg({ side: 'translation', openedAt: 50, origin: 'o1' });
    const pairs = inferPairs([s1, t1, t2, stated], DEFAULT_PAIRING);
    expect(pairs).toEqual(new Map([[t1.id, s1.id]]));
  });

  it('leaves a translation unpaired when the overlap is below the threshold', () => {
    const s = seg({ side: 'source', timing: { startMs: 0, endMs: 1000 } });
    const t = seg({ side: 'translation', timing: { startMs: 900, endMs: 2900 } });
    expect(inferPairs([s, t], DEFAULT_PAIRING).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projection/pair.test.ts`
Expected: FAIL — `Cannot find module './pair'`.

- [ ] **Step 3: Write `pair.ts`**

```ts
import type { Segment, SegmentId } from '../conversation/types';
import type { PairingThresholds } from './types';

export const DEFAULT_PAIRING: PairingThresholds = { minOverlap: 0.5, proximityMs: 4000 };

/**
 * `origin` inference for a leg's segments that state none: by maximum media-
 * time overlap where both sides carry `timing`, otherwise by how soon after a
 * source the translation opened. Each source pairs at most once; translations
 * are matched in order of opening. Unpaired is the normal case, not an error.
 */
export function inferPairs(segments: readonly Segment[], t: PairingThresholds): Map<SegmentId, SegmentId> {
  const sources = segments.filter((s) => s.side === 'source' && s.origin === undefined);
  const translations = segments.filter((s) => s.side === 'translation' && s.origin === undefined);
  const taken = new Set<SegmentId>();
  const out = new Map<SegmentId, SegmentId>();
  for (const tr of translations) {
    let best: Segment | undefined;
    let bestScore = -Infinity;
    for (const src of sources) {
      if (taken.has(src.id)) continue;
      const score = pairScore(src, tr, t);
      if (score !== null && score > bestScore) {
        best = src;
        bestScore = score;
      }
    }
    if (best) {
      out.set(tr.id, best.id);
      taken.add(best.id);
    }
  }
  return out;
}

/** Higher is better; null means "not a candidate". Timing outranks proximity. */
function pairScore(src: Segment, tr: Segment, t: PairingThresholds): number | null {
  if (src.timing && tr.timing) {
    const overlap = Math.min(src.timing.endMs, tr.timing.endMs) - Math.max(src.timing.startMs, tr.timing.startMs);
    const span = Math.max(1, tr.timing.endMs - tr.timing.startMs);
    const fraction = overlap / span;
    return fraction >= t.minOverlap ? 1 + fraction : null;
  }
  const gap = tr.openedAt - src.openedAt;
  if (gap < 0 || gap > t.proximityMs) return null;
  return 1 - gap / t.proximityMs;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lib/projection/pair.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (4 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projection/pair.ts src/lib/projection/pair.test.ts
git commit -m "feat(projection): infer source-translation pairs by timing, then proximity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 10: L2 — the projector: group, order, notices, incremental

**Files:**
- Create: `src/lib/projection/project.ts`
- Test: `src/lib/projection/project.test.ts`

**Interfaces:**
- Consumes: `Leg`, `Segment`, `Notice` (Task 5); `Row`, `Entry`, `ProjectionSettings` (Task 8); `cutSegment` (Task 8); `inferPairs` (Task 9).
- Produces: `Projector { project(legs, settings): Entry[] }`, `createProjector()`, `DEFAULT_PROJECTION: ProjectionSettings`. The surfaces (plan 1d) hold one projector and call `project` on every change.

- [ ] **Step 1: Write the failing test**

`src/lib/projection/project.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Leg, Segment, Notice } from '../conversation/types';
import { createProjector, DEFAULT_PROJECTION } from './project';
import type { Entry } from './types';

let n = 0;
const seg = (leg: 'speaker' | 'participant', over: Partial<Segment>): Segment => ({
  id: `s:${leg}:${++n}`, ref: n, side: 'source', text: 'x.', final: true, openedAt: 0, marks: [], speech: [], ...over,
});
const legOf = (leg: 'speaker' | 'participant', segments: Segment[], notices: Notice[] = []): Leg => ({
  leg, session: 's', languages: { source: 'ja', target: 'en' }, segments, notices,
});
const exchanges = (entries: Entry[]) => entries.filter((e): e is Extract<Entry, { kind: 'exchange' }> => e.kind === 'exchange');

describe('createProjector', () => {
  it('groups by stated origin, keys the entry by it, and marks the pairing stated', () => {
    const src = seg('speaker', { side: 'source', origin: 'u1', openedAt: 10 });
    const tr = seg('speaker', { side: 'translation', origin: 'u1', openedAt: 40 });
    const [e] = exchanges(createProjector().project([legOf('speaker', [src, tr])], DEFAULT_PROJECTION));
    expect(e).toMatchObject({ id: 'speaker:o:u1', pairing: 'stated', t: 10, leg: 'speaker', languages: { source: 'ja', target: 'en' } });
    expect(e.source.map((r) => r.segmentId)).toEqual([src.id]);
    expect(e.translation.map((r) => r.segmentId)).toEqual([tr.id]);
  });

  it('groups an inferred pair under the source, and leaves the unpaired alone', () => {
    const src = seg('speaker', { side: 'source', openedAt: 0 });
    const tr = seg('speaker', { side: 'translation', openedAt: 500 });
    const lone = seg('speaker', { side: 'source', openedAt: 9000 });
    const es = exchanges(createProjector().project([legOf('speaker', [src, tr, lone])], DEFAULT_PROJECTION));
    expect(es.map((e) => [e.id, e.pairing, e.source.length, e.translation.length])).toEqual([
      [`speaker:s:${src.id}`, 'inferred', 1, 1],
      [`speaker:s:${lone.id}`, 'none', 1, 0],
    ]);
  });

  it('interleaves both legs by time and includes notices', () => {
    const a = seg('speaker', { openedAt: 100 });
    const b = seg('participant', { openedAt: 50 });
    const notice: Notice = { id: 's:speaker:n1', at: 75, severity: 'warning', message: 'w' };
    const entries = createProjector().project([legOf('speaker', [a], [notice]), legOf('participant', [b])], DEFAULT_PROJECTION);
    expect(entries.map((e) => (e.kind === 'notice' ? `notice@${e.at}` : `${e.leg}@${e.t}`))).toEqual(['participant@50', 'notice@75', 'speaker@100']);
    expect(entries[1]).toMatchObject({ kind: 'notice', id: 'speaker:n:s:speaker:n1', severity: 'warning' });
  });

  it('cuts rows with the settings', () => {
    const src = seg('speaker', { text: 'One. Two.' });
    const [e] = exchanges(createProjector().project([legOf('speaker', [src])], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 }));
    expect(e.source.map((r) => [r.start, r.end])).toEqual([[0, 4], [4, 9]]);
  });

  it('keeps identity for entries whose inputs did not change, and returns the same array for the same inputs', () => {
    const projector = createProjector();
    const a = seg('speaker', { openedAt: 0 });
    const b = seg('speaker', { openedAt: 100 });
    const first = projector.project([legOf('speaker', [a, b])], DEFAULT_PROJECTION);
    expect(projector.project([legOf('speaker', [a, b])], DEFAULT_PROJECTION)).toBe(first);
    const b2 = { ...b, text: 'changed.' };
    const second = projector.project([legOf('speaker', [a, b2])], DEFAULT_PROJECTION);
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projection/project.test.ts`
Expected: FAIL — `Cannot find module './project'`.

- [ ] **Step 3: Write `project.ts`**

```ts
/**
 * L2 — session-wide, runs once: cut every segment into rows, group rows by
 * origin (stated, else inferred, else alone), order groups by time. Incremental:
 * a segment object that did not change keeps its rows; an entry whose inputs
 * did not change keeps its identity; identical input yields the same array.
 */
import type { Leg, Segment, SegmentId } from '../conversation/types';
import { cutSegment } from './cut';
import { DEFAULT_PAIRING, inferPairs } from './pair';
import type { CutSettings, Entry, PairingThresholds, ProjectionSettings, Row } from './types';

export const DEFAULT_PROJECTION: ProjectionSettings = { mode: 'off', sentencesPerRow: 0, pauseMs: 0, pairing: DEFAULT_PAIRING };

export interface Projector {
  project(legs: readonly Leg[], settings: ProjectionSettings): Entry[];
}

type Exchange = Extract<Entry, { kind: 'exchange' }>;

interface Group { id: string; leg: Leg; pairing: Exchange['pairing']; source: Segment[]; translation: Segment[]; t: number }

export function createProjector(): Projector {
  const rows = new WeakMap<Segment, { cut: CutSettings; rows: Row[] }>();
  const pairs = new WeakMap<readonly Segment[], { thresholds: PairingThresholds; map: Map<SegmentId, SegmentId> }>();
  const entries = new Map<string, Entry>();
  let last: Entry[] = [];

  const rowsOf = (seg: Segment, cut: CutSettings): Row[] => {
    const hit = rows.get(seg);
    if (hit && sameCut(hit.cut, cut)) return hit.rows;
    const fresh = cutSegment(seg, cut);
    rows.set(seg, { cut, rows: fresh });
    return fresh;
  };

  const pairsOf = (leg: Leg, thresholds: PairingThresholds): Map<SegmentId, SegmentId> => {
    const hit = pairs.get(leg.segments);
    if (hit && hit.thresholds === thresholds) return hit.map;
    const map = inferPairs(leg.segments, thresholds);
    pairs.set(leg.segments, { thresholds, map });
    return map;
  };

  return {
    project(legs, settings) {
      const cut: CutSettings = { mode: settings.mode, sentencesPerRow: settings.sentencesPerRow, pauseMs: settings.pauseMs };
      const next: Entry[] = [];
      for (const leg of legs) {
        for (const group of groupsOf(leg, pairsOf(leg, settings.pairing))) {
          const candidate: Exchange = {
            kind: 'exchange', id: group.id, leg: leg.leg, languages: leg.languages, pairing: group.pairing,
            source: group.source.flatMap((s) => rowsOf(s, cut)),
            translation: group.translation.flatMap((s) => rowsOf(s, cut)),
            t: group.t,
          };
          next.push(reuse(entries, candidate));
        }
        for (const notice of leg.notices) {
          next.push(reuse(entries, { kind: 'notice', id: `${leg.leg}:n:${notice.id}`, leg: leg.leg, severity: notice.severity, message: notice.message, code: notice.code, at: notice.at }));
        }
      }
      next.sort((a, b) => timeOf(a) - timeOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (next.length === last.length && next.every((e, i) => e === last[i])) return last;
      last = next;
      return next;
    },
  };
}

function groupsOf(leg: Leg, inferred: Map<SegmentId, SegmentId>): Group[] {
  const byId = new Map<string, Group>();
  const order: Group[] = [];
  const get = (id: string, pairing: Exchange['pairing']): Group => {
    let g = byId.get(id);
    if (!g) {
      g = { id, leg, pairing, source: [], translation: [], t: Infinity };
      byId.set(id, g);
      order.push(g);
    }
    return g;
  };
  const pairedSources = new Set(inferred.values());
  for (const seg of leg.segments) {
    let g: Group;
    if (seg.origin !== undefined) g = get(`${leg.leg}:o:${seg.origin}`, 'stated');
    else if (seg.side === 'translation' && inferred.has(seg.id)) g = get(`${leg.leg}:s:${inferred.get(seg.id)}`, 'inferred');
    else if (seg.side === 'source' && pairedSources.has(seg.id)) g = get(`${leg.leg}:s:${seg.id}`, 'inferred');
    else g = get(`${leg.leg}:s:${seg.id}`, 'none');
    (seg.side === 'source' ? g.source : g.translation).push(seg);
    g.t = Math.min(g.t, seg.openedAt);
  }
  return order;
}

function timeOf(e: Entry): number { return e.kind === 'exchange' ? e.t : e.at; }

function sameCut(a: CutSettings, b: CutSettings): boolean {
  return a.mode === b.mode && a.sentencesPerRow === b.sentencesPerRow && a.pauseMs === b.pauseMs;
}

/** The cached entry when nothing about it changed, else the candidate. */
function reuse(cache: Map<string, Entry>, candidate: Entry): Entry {
  const prev = cache.get(candidate.id);
  if (prev && sameEntry(prev, candidate)) return prev;
  cache.set(candidate.id, candidate);
  return candidate;
}

function sameEntry(a: Entry, b: Entry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'notice' && b.kind === 'notice') {
    return a.at === b.at && a.severity === b.severity && a.message === b.message && a.code === b.code && a.leg === b.leg;
  }
  if (a.kind === 'exchange' && b.kind === 'exchange') {
    // Languages by value: a Leg snapshot may be rebuilt around the same segments.
    return a.leg === b.leg && a.languages.source === b.languages.source && a.languages.target === b.languages.target
      && a.pairing === b.pairing && a.t === b.t
      && sameRows(a.source, b.source) && sameRows(a.translation, b.translation);
  }
  return false;
}

function sameRows(a: Row[], b: Row[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

Row identity: `rowsOf` returns the cached array for an unchanged segment, whose elements are the same objects, so `sameRows` compares elements by identity and an unchanged group reuses its entry.

Pairing is recomputed whenever a leg's `segments` array changes (every `Conversation` change produces a new array). Segments with a stated origin cost nothing — `inferPairs` filters them out first — so this is quadratic only in the segments that need inference; making that incremental is a later optimisation, not a Stage 1 requirement.

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lib/projection && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (18 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projection/project.ts src/lib/projection/project.test.ts
git commit -m "feat(projection): group, order and share entries incrementally

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 11: The export writer — one block per group

**Files:**
- Create: `src/lib/export/transcript.ts`
- Test: `src/lib/export/transcript.test.ts`

**Interfaces:**
- Consumes: `Entry` (Task 8), `Leg`, `Segment` (Task 5).
- Produces: `TranscriptLabels`, `TranscriptOptions`, `renderTranscriptTxt(entries, legs, options): string`, `renderTranscriptJson(entries, legs): TranscriptJson`, `TranscriptJson`. Plan 1d's export surface adds the header lines and the file name (today's `formatAsTxt` header) on top of this body.

- [ ] **Step 1: Write the failing test**

`src/lib/export/transcript.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Leg, Segment } from '../conversation/types';
import type { Entry } from '../projection/types';
import { renderTranscriptTxt, renderTranscriptJson } from './transcript';

let n = 0;
const seg = (leg: 'speaker' | 'participant', over: Partial<Segment>): Segment => ({
  id: `s:${leg}:${++n}`, ref: n, side: 'source', text: '', final: true, openedAt: 0, marks: [], speech: [], ...over,
});
const rows = (s: Segment) => [{ key: `${s.id}:0`, segmentId: s.id, side: s.side, start: 0, end: s.text.length }];

const src = seg('speaker', { text: '今天天气很好。我们去公园吧。', openedAt: 1_000 });
const tr = seg('speaker', { side: 'translation', text: 'The weather is nice. Let us go to the park.', openedAt: 1_500 });
const other = seg('participant', { text: 'Sounds good.', openedAt: 8_000 });
const otherTr = seg('participant', { side: 'translation', text: '听起来不错。', openedAt: 8_400 });
const lone = seg('speaker', { text: '下午三点吧。', openedAt: 13_000 });
const legs: Leg[] = [
  { leg: 'speaker', session: 's', languages: { source: 'zh', target: 'en' }, segments: [src, tr, lone], notices: [] },
  { leg: 'participant', session: 's', languages: { source: 'en', target: 'zh' }, segments: [other, otherTr], notices: [] },
];
const entries: Entry[] = [
  { kind: 'exchange', id: 'a', leg: 'speaker', languages: legs[0].languages, pairing: 'stated', source: rows(src), translation: rows(tr), t: 1_000 },
  { kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'hiccup', at: 2_000 },
  { kind: 'exchange', id: 'b', leg: 'participant', languages: legs[1].languages, pairing: 'inferred', source: rows(other), translation: rows(otherTr), t: 8_000 },
  { kind: 'exchange', id: 'c', leg: 'speaker', languages: legs[0].languages, pairing: 'none', source: rows(lone), translation: [], t: 13_000 },
];
const options = {
  labels: { me: 'Me', other: 'Other', noTranslation: '(no translation)', noSource: '(no source)' },
  formatTime: (ms: number) => `[t${ms}]`,
};

describe('renderTranscriptTxt', () => {
  it('writes one block per group, whole segment text, one timestamp, a stated missing side, and no notices', () => {
    expect(renderTranscriptTxt(entries, legs, options)).toBe([
      '[t1000] Me',
      '  今天天气很好。我们去公园吧。',
      '  → The weather is nice. Let us go to the park.',
      '',
      '[t8000] Other',
      '  Sounds good.',
      '  → 听起来不错。',
      '',
      '[t13000] Me',
      '  下午三点吧。',
      '  (no translation)',
      '',
    ].join('\n'));
  });

  it('honours the scope: translation only', () => {
    const txt = renderTranscriptTxt(entries, legs, { ...options, scope: { source: false, translation: true } });
    expect(txt).toContain('  → The weather is nice.');
    expect(txt).not.toContain('今天天气很好');
  });
});

describe('renderTranscriptJson', () => {
  it('keeps pairing and ids on every group and lists notices separately', () => {
    const json = renderTranscriptJson(entries, legs);
    expect(json.groups.map((g) => [g.id, g.pairing, g.source?.text, g.translation?.text])).toEqual([
      ['a', 'stated', '今天天气很好。我们去公园吧。', 'The weather is nice. Let us go to the park.'],
      ['b', 'inferred', 'Sounds good.', '听起来不错。'],
      ['c', 'none', '下午三点吧。', undefined],
    ]);
    expect(json.groups[0].source?.segmentIds).toEqual([src.id]);
    expect(json.notices).toEqual([{ id: 'n', leg: 'speaker', at: 2_000, severity: 'warning', message: 'hiccup', code: undefined }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/export/transcript.test.ts`
Expected: FAIL — `Cannot find module './transcript'`.

- [ ] **Step 3: Write `transcript.ts`**

```ts
/**
 * The export is an L3 surface over L2's groups. One block per group, each
 * segment's text whole (never its rows), one timestamp per group, a missing
 * side stated. Inferred pairs are written paired, like stated ones; the JSON
 * form keeps `pairing` so a consumer can tell them apart.
 */
import type { Leg, LegName, Segment, SegmentId } from '../conversation/types';
import type { Entry, Pairing, Row } from '../projection/types';

export interface TranscriptLabels {
  me: string;
  other: string;
  noTranslation: string;
  noSource: string;
}

export interface TranscriptOptions {
  labels: TranscriptLabels;
  formatTime: (ms: number) => string;
  /** Which sides to write. Default: both. */
  scope?: { source: boolean; translation: boolean };
}

export interface TranscriptSide { segmentIds: SegmentId[]; text: string }

export interface TranscriptGroup {
  id: string;
  leg: LegName;
  t: number;
  pairing: Pairing;
  source: TranscriptSide | null;
  translation: TranscriptSide | null;
}

export interface TranscriptJson {
  groups: TranscriptGroup[];
  notices: Array<{ id: string; leg: LegName; at: number; severity: 'error' | 'warning'; message: string; code?: string }>;
}

function segmentIndex(legs: readonly Leg[]): Map<SegmentId, Segment> {
  const index = new Map<SegmentId, Segment>();
  for (const leg of legs) for (const seg of leg.segments) index.set(seg.id, seg);
  return index;
}

/** The distinct segments behind a group's rows, in row order, text whole. */
function sideOf(rows: Row[], index: Map<SegmentId, Segment>): TranscriptSide | null {
  const ids: SegmentId[] = [];
  for (const row of rows) if (!ids.includes(row.segmentId)) ids.push(row.segmentId);
  if (ids.length === 0) return null;
  const text = ids.map((id) => index.get(id)?.text ?? '').join(' ').trim();
  return { segmentIds: ids, text };
}

export function renderTranscriptJson(entries: readonly Entry[], legs: readonly Leg[]): TranscriptJson {
  const index = segmentIndex(legs);
  const groups: TranscriptGroup[] = [];
  const notices: TranscriptJson['notices'] = [];
  for (const e of entries) {
    if (e.kind === 'notice') {
      notices.push({ id: e.id, leg: e.leg, at: e.at, severity: e.severity, message: e.message, code: e.code });
      continue;
    }
    groups.push({ id: e.id, leg: e.leg, t: e.t, pairing: e.pairing, source: sideOf(e.source, index), translation: sideOf(e.translation, index) });
  }
  return { groups, notices };
}

export function renderTranscriptTxt(entries: readonly Entry[], legs: readonly Leg[], o: TranscriptOptions): string {
  const scope = o.scope ?? { source: true, translation: true };
  const { groups } = renderTranscriptJson(entries, legs);
  const lines: string[] = [];
  for (const g of groups) {
    lines.push(`${o.formatTime(g.t)} ${g.leg === 'speaker' ? o.labels.me : o.labels.other}`);
    if (scope.source) lines.push(`  ${g.source ? g.source.text : o.labels.noSource}`);
    if (scope.translation) lines.push(`  ${g.translation ? `→ ${g.translation.text}` : o.labels.noTranslation}`);
    lines.push('');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lib/export/transcript.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (3 tests); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/transcript.ts src/lib/export/transcript.test.ts
git commit -m "feat(export): render a transcript as one block per group

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

### Task 12: End to end on the fake — script → Conversation → project → export, and the long-session generator

**Files:**
- Create: `src/providers/fake/generate.ts`
- Test: `src/providers/fake/spine.e2e.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `longScript(exchanges, opts?)` — the generator the spec asks for ("thousands of segments to load L2"); the end-to-end test is the fixture plan 1c's runner tests start from.

- [ ] **Step 1: Write the generator**

`src/providers/fake/generate.ts`:

```ts
import { exchange, type FakeScript } from './script';

/** `count` exchanges, one every `everyMs`, alternating three short texts. */
export function longScript(count: number, everyMs = 1500): FakeScript {
  const sources = ['今日は天気がいいですね。', '公園に行きましょう。', 'ついでに買い物もします。'];
  const translations = ['The weather is nice today.', 'Let us go to the park.', 'And do some shopping on the way.'];
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const k = i % 3;
    blocks.push(exchange({ startAt: i * everyMs, ref: 1 + i * 2, source: [sources[k].slice(0, 4), sources[k]], translation: translations[k], origin: `u${i}`, audioChunks: 1 }));
  }
  return { blocks };
}
```

- [ ] **Step 2: Write the failing end-to-end test**

`src/providers/fake/spine.e2e.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { eventsFrom } from '../../lib/contract/events';
import { checkConformance, type ConformanceLog } from '../../lib/contract/conformance';
import { Conversation } from '../../lib/conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import { renderTranscriptTxt } from '../../lib/export/transcript';
import { createFakeAdapter } from './adapter';
import { exchange } from './script';
import { longScript } from './generate';

const context = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' as const };
const options = {
  labels: { me: 'Me', other: 'Other', noTranslation: '(no translation)', noSource: '(no source)' },
  formatTime: (ms: number) => `[${ms}]`,
};

describe('the spine on the fake', () => {
  it('turns a two-exchange script into two paired entries and a transcript', async () => {
    const clock = createVirtualClock();
    const conv = new Conversation({ leg: 'speaker', session: 'e2e', languages: context.direction, clock, punctuate: async (_l, t) => `${t}。` });
    const log: ConformanceLog = [];
    const events = eventsFrom((e) => { log.push(e); conv.apply(e); });
    const script = { blocks: [
      exchange({ startAt: 0, ref: 1, source: ['今日は', '今日は天気がいい'], translation: 'The weather is nice.', origin: 'u1', audioChunks: 2 }),
      exchange({ startAt: 3000, ref: 3, source: ['公園に'], translation: 'To the park.', origin: 'u2' }),
    ] };
    const session = await createFakeAdapter(clock).start({ context, config: { script }, credentials: {} }, events);
    clock.advance(10_000);
    await session.stop();
    await Promise.resolve(); await Promise.resolve();
    expect(checkConformance(log, context)).toEqual([]);

    const leg = conv.snapshot();
    expect(leg.segments.map((s) => [s.side, s.final, s.text])).toEqual([
      ['source', true, '今日は天気がいい。'],
      ['translation', true, 'The weather is nice.'],
      ['source', true, '公園に。'],
      ['translation', true, 'To the park.'],
    ]);
    expect(leg.segments[1].speech.map((s) => s.range)).toEqual([[0, 10], [10, 20]]);

    const entries = createProjector().project([leg], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    expect(entries.map((e) => e.kind === 'exchange' && e.pairing)).toEqual(['stated', 'stated']);
    expect(renderTranscriptTxt(entries, [leg], options)).toBe([
      '[0] Me', '  今日は天気がいい。', '  → The weather is nice.', '',
      '[3000] Me', '  公園に。', '  → To the park.', '',
    ].join('\n'));
  });

  it('projects a long session incrementally: one new exchange changes one entry', async () => {
    const clock = createVirtualClock();
    const conv = new Conversation({ leg: 'speaker', session: 'long', languages: context.direction, clock });
    const events = eventsFrom((e) => conv.apply(e));
    const session = await createFakeAdapter(clock).start({ context, config: { script: longScript(2000, 1000) }, credentials: {} }, events);
    const projector = createProjector();
    clock.advance(1999 * 1000 + 500);
    const before = projector.project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    expect(before.length).toBe(2000);
    clock.advance(10_000);
    await session.stop();
    const after = projector.project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    expect(after.length).toBe(2000);
    let changed = 0;
    for (let i = 0; i < 1999; i++) if (after[i] !== before[i]) changed++;
    expect(changed).toBe(0);
    expect(after[1999]).not.toBe(before[1999]);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run src/providers/fake/spine.e2e.test.ts`
Expected: PASS (2 tests). If the first test's fill-in assertion fails because `punctuate` was called for `'今日は天気がいい'` and the range re-anchoring moved the ranges differently, check that `sentenceEnds('今日は天気がいい')` is empty (so fill-in runs) and that appending `。` is the "only longer" branch (ranges unchanged) — the expected ranges `[0, 10]`, `[10, 20]` are the two halves of `'The weather is nice.'` and belong to the translation, which the punctuator also touches: `'The weather is nice.'` already ends a sentence, so it is untouched.

- [ ] **Step 4: Run the whole suite and the typecheck**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: every existing test still passes (the new packages import nothing the old code owns), the new ones pass, tsc clean. `consoleLedger.consistency.test.ts` passes because no new file calls `console.*`.

- [ ] **Step 5: Commit**

```bash
git add src/providers/fake/generate.ts src/providers/fake/spine.e2e.test.ts
git commit -m "test(spine): the fake drives L1, L2 and the export end to end

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28"
```

---

## What this plan does not do, on purpose

- Nothing here is wired into the app. MainPanel, the old clients and the old descriptors run unchanged; the new packages are dead code until plan 1c (the runner) and 1d (the surfaces) call them.
- The fake is not yet a registered provider (plan 1b wraps `createFakeAdapter` in a `Provider` definition).
- `Notice.params` is declared but nothing fills it; the localized notice codes are plan 1c's (the runner and sources are what produce user-facing notices).
- Row keys are stable per cut; the surfaces' enter animation keys on them in plan 1d.
