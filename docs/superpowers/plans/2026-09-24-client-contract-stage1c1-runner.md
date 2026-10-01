# Client contract — Stage 1c-1: the runner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The session runner — a plain module outside React that starts, stops and turns a session over any provider definition — built on a resource stack, with the run's shape frozen at start, legs rising and falling together, turns owned by the run, and a live fake session in the development preview. Real capture and playback come in plan 1c-2.

**Architecture:** `src/lib/session/` holds the runner. A `Run` freezes a `RunShape`, pushes every resource it acquires onto a `ResourceStack` with its release, and opens its legs in parallel; a thin `createRunner` owns the phases (`idle → starting → running → stopping`), one stop promise and the conversation (a `ConversationSet` of L1 legs that outlives the run). Capture, playback and analytics are ports the caller supplies: tests pass the fake source, a recording playback port and a recording tracker; the development preview wires the stores and the fake source. Nothing the app runs today changes.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`, `jsx: react-jsx` — never import `React` for JSX), Zustand 5 (`createStore` from `zustand/vanilla`, `useStore` from `zustand`), vitest 4 (`globals`, jsdom, `vi.hoisted`, `@testing-library/react`), plan 1a's `Clock` / `createVirtualClock`, `eventsFrom`, `Conversation`; plan 1b's provider layer.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Session lifecycle" (all subsections), "Turns" → "The design", "L1 — the data model" → "Retention", "Testing". Roadmap: `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` (the items carried out of plans 1a and 1b for 1c are Tasks 1–3 here).

## Global Constraints

- Work on branch `worktree-client-contract-refactor` in this worktree. Commit after every task. **Never push.**
- **Nothing the app runs changes.** No edit to `src/components/MainPanel/**`, `src/stores/settingsStore.ts`, `src/stores/audioStore.ts`, `src/stores/sessionStore.ts`, `src/services/**` or any old client. The only edits to existing files are the ones a task names.
- `src/lib/session/**` imports nothing from `src/stores/**` or `src/services/**`, with one exception: `src/lib/session/appShape.ts` (Task 10), which reads the stores to build a shape. The runner reads live settings only through `readShape`; every later step reads the frozen `RunShape`.
- Adapters emit no analytics; the runner emits the session events (spec "Analytics") through its `AnalyticsPort`.
- No `console.*` in any new file. Failures go out through `reportError` / `reportWarning` (from `src/lib/diagnostics/report.ts`); a failure the user must act on is state (`RunState.lastEnd`), never only a report.
- Tests assert behaviour, not copy. The fake provider's controls are found by their literal English labels (dev-only, unlocalized — plan 1b ruling R1). Provider-supplied strings (a `reason`, a `message`) are data and may be asserted.
- English-only comments and test names. Tests colocated next to the module.
- Conventional commit messages. Each commit ends with the implementer's own `Co-Authored-By:` attribution line (the one its harness gives it) and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`.
- Run one file with `npx vitest run <path>`; everything with `npx vitest run src` — **0 failed**. It also prints 4 unhandled rejections from `src/stores/settingsStore.nativeGate.test.ts`; those predate this branch.
- **Typecheck gate.** Run exactly:
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' \
    | grep -E '^(src/(lib/(session|provider|conversation|projection|export|contract|analytics\.ts)|providers|components/(providers|dev/(SpinePreview|SessionControls))|stores/(providerStore|turnModeStore)|utils/environment|App\.tsx))' \
    | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```
  It must print exactly these four baseline lines and nothing else:
  ```
  src/App.tsx: error TS6133: 'React' is declared but its value is never read.
  src/lib/analytics.ts: error TS6133: 'response' is declared but its value is never read.
  src/utils/environment.ts: error TS2717: Subsequent property declarations must have the sam
  src/utils/environment.ts: error TS2339: Property 'create' does not exist on type '{ query(
  ```

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/conversation/Conversation.ts` | + public `notice()`, `setRetention()`, listener isolation, `degraded` de-duplication |
| `src/lib/projection/*`, `src/lib/export/transcript.ts` | + a notice's `params` on `Entry` and in the export JSON |
| `src/lib/session/source.ts` | `Source`, `OpenSource` — one leg's capture |
| `src/providers/fake/source.ts` | `createFakeSource(clock, options)` — a pcm generator with injectable `end` / `degrade` |
| `src/lib/provider/credentials.ts` | `readCredentials`, `isMissing` |
| `src/lib/session/types.ts` | `TurnMode`, `RunShape`, `RunNotice`, `Prepared`, `Resources`, `SessionHooks`, `EndReason`, `RunEnd`, `LegState`, `RunState` |
| `src/lib/session/stack.ts` | `ResourceStack` |
| `src/lib/session/turn.ts` | `isVoiced`, `Turn`, `VOICED_LEVEL`, `MIN_VOICED_MS` |
| `src/lib/session/shape.ts` | `contextsFor(shape)`, `gate(shape, platform)`, `Refusal` |
| `src/lib/session/shared.ts` | `buildSharedSettings` |
| `src/lib/session/ports.ts` | `PlaybackPort`, `AnalyticsPort`, `ControlMethod`, `RunnerDeps` |
| `src/lib/session/conversationSet.ts` | `ConversationSet` — the conversation that outlives a run |
| `src/lib/session/run.ts` | `Run`, `RunHost`, `RefusedError`, `LegOpenError` |
| `src/lib/session/runner.ts` | `createRunner(deps)` → `Runner` |
| `src/stores/turnModeStore.ts` | the one global turn mode (D15), persisted at `settings.common.turnMode` |
| `src/lib/session/appShape.ts` | `readShapeFromStores`, `persistIfUnchanged` — the stores behind a runner |
| `src/components/dev/SessionControls.tsx` | dev-only start / stop / hold / type / clear, and a raw transcript |

---

### Task 1: What the runner needs from L1

**Files:**
- Modify: `src/lib/conversation/types.ts`
- Modify: `src/lib/conversation/Conversation.ts`
- Modify: `src/lib/projection/types.ts`, `src/lib/projection/project.ts`
- Modify: `src/lib/export/transcript.ts`
- Test: `src/lib/conversation/Conversation.test.ts`, `src/lib/projection/project.test.ts`, `src/lib/export/transcript.test.ts`

**Interfaces:**
- Produces: `NoticeInput`; `Conversation.notice(input: NoticeInput): void`; `Conversation.setRetention(retention: Retention): void`; `ConversationDiagnostic['code']` gains `'listener_threw'`; `DEGRADED_DEDUPE_MS = 5000`; the notice variant of `Entry` gains `params?: Record<string, string | number>`; `TranscriptJson['notices']` items carry `params`.

These are the roadmap's items carried out of plan 1a for 1c: a runner-facing notice (source ended, lease ended), a retention setter (`keepReplayAudio` takes effect immediately), `params` on notices, listener isolation, and `degraded` notices de-duplicated by code (the table's severity stays the source of truth, as in plan 1a).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/conversation/Conversation.test.ts` (it already imports `describe`, `it`, `expect`, `createVirtualClock`, `AdapterEvent`, `Conversation`, `MARK_COMPACT_MS`, `ConversationDiagnostic`, and defines `pcm(n)` and `make(extra)`; add `DEGRADED_DEDUPE_MS` to the import from `./Conversation`):

```ts
describe('Conversation — what the runner adds', () => {
  it('records a notice raised outside the adapter, with its code and params', () => {
    const { conv, clock } = make();
    clock.advance(250);
    conv.notice({ severity: 'error', message: 'microphone unplugged', code: 'source_ended', params: { leg: 'speaker' } });
    expect(conv.snapshot().notices).toEqual([
      { id: 's1:speaker:n1', at: 10_250, severity: 'error', message: 'microphone unplugged', code: 'source_ended', params: { leg: 'speaker' } },
    ]);
  });

  it('drops a degraded notice that repeats its code within the dedupe window, and keeps other codes', () => {
    const { conv, clock, apply } = make();
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    clock.advance(DEGRADED_DEDUPE_MS - 1);
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    apply({ kind: 'degraded', payload: { code: 'tts_degraded', message: 'no voice' } });
    clock.advance(1);
    apply({ kind: 'degraded', payload: { code: 'parse_error', message: 'bad frame' } });
    expect(conv.snapshot().notices.map((n) => n.code)).toEqual(['parse_error', 'tts_degraded', 'parse_error']);
  });

  it('turning pcm retention off drops the pcm already held and keeps the ranges', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'abc' } });
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 3], pcm: pcm(240) } });
    apply({ kind: 'audio', payload: { ref: 2, range: [0, 1], pcm: pcm(10) } });
    conv.setRetention({ keepPcm: false, maxPcmBytes: 0 });
    expect(conv.snapshot().segments[0].speech).toEqual([{ range: [0, 3], pcm: new Int16Array(0) }]);
    apply({ kind: 'audio', payload: { ref: 1, range: [0, 1], pcm: pcm(10) } });
    expect(conv.snapshot().segments[0].speech[1].pcm.length).toBe(0);
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } });
    expect(conv.snapshot().segments[1].speech).toEqual([{ range: [0, 1], pcm: new Int16Array(0) }]);
  });

  it('lowering the ceiling trims the oldest pcm at once', () => {
    const { conv, apply } = make();
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 1, text: 'a' } });
    apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } }, { kind: 'segmentText', payload: { ref: 2, text: 'b' } });
    apply({ kind: 'audio', payload: { ref: 1, pcm: pcm(100) } }, { kind: 'audio', payload: { ref: 2, pcm: pcm(100) } });
    conv.setRetention({ keepPcm: true, maxPcmBytes: 200 });
    const [a, b] = conv.snapshot().segments;
    expect(a.speech[0].pcm.length).toBe(0);
    expect(b.speech[0].pcm.length).toBe(100);
  });

  it('a subscriber that throws is reported and does not stop the next one hearing', () => {
    const { conv, apply, diagnostics } = make();
    let heard = 0;
    conv.subscribe(() => { throw new Error('boom'); });
    conv.subscribe(() => { heard++; });
    apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    expect(heard).toBe(1);
    expect(diagnostics).toEqual([{ code: 'listener_threw', message: 'A conversation subscriber threw: boom' }]);
  });
});
```

In `src/lib/projection/project.test.ts`, inside the existing `describe` that holds `'interleaves both legs by time and includes notices'`, add:

```ts
  it("carries a notice's params onto its entry", () => {
    const notice: Notice = { id: 's:speaker:n1', at: 5, severity: 'error', message: 'lease ended', code: 'lease_ended', params: { minutes: 3 } };
    const [entry] = createProjector().project([legOf('speaker', [], [notice])], DEFAULT_PROJECTION);
    expect(entry).toMatchObject({ kind: 'notice', code: 'lease_ended', params: { minutes: 3 } });
  });
```

In `src/lib/export/transcript.test.ts`, add (the file already builds a notice entry `{ kind: 'notice', id: 'n', leg: 'speaker', severity: 'warning', message: 'hiccup', at: 2_000 }` in its fixtures; import whatever it already imports):

```ts
describe('renderTranscriptJson — notice params', () => {
  it('writes a notice with its code and params', () => {
    const json = renderTranscriptJson([{ kind: 'notice', id: 'n2', leg: 'participant', severity: 'error', message: 'ended', code: 'source_ended', params: { leg: 'participant' }, at: 9 }], []);
    expect(json.notices).toEqual([{ id: 'n2', leg: 'participant', at: 9, severity: 'error', message: 'ended', code: 'source_ended', params: { leg: 'participant' } }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts src/lib/projection/project.test.ts src/lib/export/transcript.test.ts`
Expected: FAIL — `conv.notice is not a function`, `DEGRADED_DEDUPE_MS` undefined, `setRetention` missing, a missing `params`.

- [ ] **Step 3: Implement**

`src/lib/conversation/types.ts` — after the `Notice` interface, add:

```ts
/** What a caller supplies to record a notice; the leg adds its id and time. */
export type NoticeInput = Pick<Notice, 'severity' | 'message' | 'code' | 'params'>;
```

`src/lib/conversation/Conversation.ts`:

1. Import `NoticeInput` with the other types from `./types`, and `import { describeCause } from '../diagnostics/describeCause';`.
2. `ConversationDiagnostic['code']` becomes `'contract_violation' | 'range_out_of_text' | 'listener_threw'`.
3. After `MARK_COMPACT_MS`, add:
   ```ts
   /** A `degraded` notice repeating its code within this window is dropped, as the Logs panel throttles per key. */
   export const DEGRADED_DEDUPE_MS = 5_000;
   ```
4. Add the fields `private retention: Retention;` and `private readonly lastDegradedAt = new Map<string, number>();` and give the constructor a body: `constructor(private readonly opts: ConversationOptions) { this.retention = opts.retention ?? DEFAULT_RETENTION; }`.
5. In `dispatch`, replace the `failed` and `degraded` cases with:
   ```ts
      case 'failed': {
        this.addNotice({ severity: 'error', message: event.payload.message, code: event.payload.code });
        this.finalizeAll();
        return;
      }
      case 'degraded': {
        const { code, message } = event.payload;
        const now = this.opts.clock.now();
        const last = this.lastDegradedAt.get(code);
        if (last !== undefined && now - last < DEGRADED_DEDUPE_MS) return;
        this.lastDegradedAt.set(code, now);
        return this.addNotice({ severity: CLIENT_DIAGNOSTICS[code]?.severity ?? 'warning', message, code });
      }
   ```
6. Add these public methods after `finalizeAll()`:
   ```ts
  /** Records a notice from outside the adapter's stream: the runner's (a source ended, a lease ended). */
  notice(input: NoticeInput): void {
    this.batch(() => this.addNotice(input));
  }

  /**
   * Applies a retention policy now (`keepReplayAudio` takes effect
   * immediately): off drops every pcm held, ranges kept; a lower ceiling trims
   * the oldest.
   */
  setRetention(retention: Retention): void {
    this.batch(() => {
      this.retention = retention;
      if (retention.keepPcm) {
        this.afterAudio();
        return;
      }
      this.segments.forEach((seg, i) => {
        if (!seg.speech.some((s) => s.pcm.length > 0)) return;
        this.replace(i, { ...seg, speech: seg.speech.map((s) => (s.pcm.length > 0 ? { ...s, pcm: EMPTY_PCM } : s)) });
      });
      for (const [ref, list] of this.pending) this.pending.set(ref, list.map((s) => ({ ...s, pcm: EMPTY_PCM })));
      this.pcmBytes = 0;
    });
  }
   ```
7. In `clear()`, also `this.lastDegradedAt.clear();`.
8. Replace the private `notice(severity, message, code)` with:
   ```ts
  private addNotice(input: NoticeInput): void {
    this.notices.push({ id: `${this.opts.session}:${this.opts.leg}:n${++this.noticeCounter}`, at: this.opts.clock.now(), ...input });
    this.touch();
  }
   ```
9. In `retain()` and `afterAudio()`, read `this.retention` instead of `this.opts.retention ?? DEFAULT_RETENTION`.
10. Replace `notify()` with:
   ```ts
  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        // One subscriber's bug must not reach the adapter's event callback, or the next subscriber.
        this.opts.onDiagnostic?.({ code: 'listener_threw', message: `A conversation subscriber threw: ${describeCause(error)}` });
      }
    }
  }
   ```

`src/lib/projection/types.ts` — in the `notice` variant of `Entry`, after `code?: string;` add `params?: Record<string, string | number>;`.

`src/lib/projection/project.ts` — where a notice entry is built, add `params: notice.params` to the object; in `sameEntry`'s notice branch add `&& a.params === b.params` (a notice is immutable once recorded, so the same notice keeps the same `params` object).

`src/lib/export/transcript.ts` — replace the inline notice type in `TranscriptJson` with one derived from `Entry`, and copy `params`:

```ts
/** A notice as the export writes it: the entry without its `kind`. */
export type TranscriptNotice = Omit<Extract<Entry, { kind: 'notice' }>, 'kind'>;

export interface TranscriptJson {
  groups: TranscriptGroup[];
  notices: TranscriptNotice[];
}
```

and where notices are pushed: `notices.push({ id: e.id, leg: e.leg, at: e.at, severity: e.severity, message: e.message, code: e.code, params: e.params });` (import `Entry` if the file does not already).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/conversation src/lib/projection src/lib/export src/providers/fake`
Expected: PASS — the new tests and every existing one (the spine e2e included).

- [ ] **Step 5: Typecheck and commit**

Run the typecheck gate; expect exactly the four baseline lines.

```bash
git add src/lib/conversation src/lib/projection src/lib/export
git commit -m "feat(conversation): notices, retention and isolation the runner needs"
```
(with the two trailer lines from Global Constraints)

---

### Task 2: A fake capture, and a fake adapter that honours a late cancel

**Files:**
- Create: `src/lib/session/source.ts`
- Create: `src/providers/fake/source.ts`
- Modify: `src/providers/fake/adapter.ts`
- Test: `src/providers/fake/source.test.ts`, `src/providers/fake/adapter.test.ts`

**Interfaces:**
- Produces: `Source { onPcm(l): () => void; onEnded(l): () => void; onDegraded(l): () => void; stop(): Promise<void> }`; `OpenSource = (leg: LegName, signal: AbortSignal) => Promise<Source>`; `FakeSource extends Source { setVoiced(v: boolean): void; end(reason: string): void; degrade(message: string): void; readonly stopped: boolean }`; `createFakeSource(clock: Clock, options?: { chunkMs?: number; voiced?: boolean }): FakeSource`.

Also the roadmap's items carried out of plan 1a for the fake: `start()` re-checks the signal after `startDelayMs`; a test that a cancelled start's timer stays silent; a per-kind table test for `play()`'s untested branches.

- [ ] **Step 1: Write the failing tests**

Create `src/providers/fake/source.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { createFakeSource } from './source';

describe('createFakeSource', () => {
  it('delivers a chunk every chunkMs: silence until voiced, a tone after', () => {
    const clock = createVirtualClock();
    const source = createFakeSource(clock, { chunkMs: 100 });
    const chunks: Int16Array[] = [];
    source.onPcm((pcm) => chunks.push(pcm));
    clock.advance(200);
    source.setVoiced(true);
    clock.advance(100);
    expect(chunks.map((c) => c.length)).toEqual([2400, 2400, 2400]);
    expect(chunks[0].every((v) => v === 0)).toBe(true);
    expect(chunks[2].some((v) => v !== 0)).toBe(true);
  });

  it('stops delivering once stopped', async () => {
    const clock = createVirtualClock();
    const source = createFakeSource(clock);
    let n = 0;
    source.onPcm(() => { n++; });
    await source.stop();
    clock.advance(1000);
    expect(n).toBe(0);
    expect(source.stopped).toBe(true);
  });

  it('reports an end once, and a degradation, to their listeners', () => {
    const clock = createVirtualClock();
    const source = createFakeSource(clock);
    const ends: string[] = [];
    const warnings: string[] = [];
    source.onEnded((r) => ends.push(r));
    source.onDegraded((m) => warnings.push(m));
    source.degrade('fell back to system audio');
    source.end('unplugged');
    source.end('again');
    expect(ends).toEqual(['unplugged']);
    expect(warnings).toEqual(['fell back to system audio']);
    expect(source.stopped).toBe(true);
  });

  it('forgets a listener that unsubscribed', () => {
    const clock = createVirtualClock();
    const source = createFakeSource(clock);
    let n = 0;
    const off = source.onPcm(() => { n++; });
    clock.advance(100);
    off();
    clock.advance(300);
    expect(n).toBe(1);
  });
});
```

Append to `src/providers/fake/adapter.test.ts` (it already has `auto`, `kinds`, and the `start(script, context, faults)` helper, and imports `createVirtualClock`, `recordEvents`, `createFakeAdapter`, `exchange`):

```ts
describe('fake adapter — cancel and every step kind', () => {
  it('rejects a start cancelled during its delay, and its timer stays silent', async () => {
    const clock = createVirtualClock();
    const { events, log } = recordEvents();
    const controller = new AbortController();
    const script = { blocks: [exchange({ startAt: 0, ref: 1, source: ['a'], translation: 'b' })] };
    const starting = createFakeAdapter().start(
      { context: auto, config: { script, faults: { startDelayMs: 1000 } }, credentials: {}, clock, signal: controller.signal },
      events,
    );
    controller.abort(new Error('cancelled'));
    await expect(starting).rejects.toThrow('cancelled');
    clock.advance(10_000);
    expect(log).toEqual([]);
  });

  it('plays every kind of scripted step', async () => {
    const steps = [
      { at: 0, degraded: { code: 'parse_error' as const, message: 'bad' } },
      { at: 1, reconnecting: true as const },
      { at: 2, reconnected: true as const },
      { at: 3, loading: { stage: 'asr', done: 1, total: 2 } },
      { at: 4, busy: true },
      { at: 5, frame: { direction: 'in' as const, type: 'test.frame' } },
      { at: 6, closed: { reason: 'done' } },
    ];
    const { clock, log } = await start({ blocks: [{ startAt: 0, steps }] });
    clock.advance(10);
    expect(kinds(log)).toEqual(['degraded', 'reconnecting', 'reconnected', 'loading', 'busy', 'frame', 'closed']);
  });

  it('plays a scripted failure and then nothing', async () => {
    const { clock, log } = await start({ blocks: [{ startAt: 0, steps: [{ at: 0, failed: { message: 'x' } }, { at: 5, busy: true }] }] });
    clock.advance(10);
    expect(kinds(log)).toEqual(['failed']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/fake/source.test.ts src/providers/fake/adapter.test.ts`
Expected: FAIL — `./source` does not resolve. (The adapter tests may already pass; they pin behaviour that must hold.)

- [ ] **Step 3: Implement**

Create `src/lib/session/source.ts`:

```ts
import type { LegName } from '../conversation/types';

/** One leg's capture (spec: "Sources, in full"): 24 kHz mono pcm, an end, and a degradation. */
export interface Source {
  onPcm(listener: (pcm: Int16Array) => void): () => void;
  /** Fires at most once, when the capture can no longer deliver: a device unplugged, a tab closed, the app-capture helper gone. */
  onEnded(listener: (reason: string) => void): () => void;
  /** Still delivering, but worse: app capture fell back to whole-system capture. */
  onDegraded(listener: (message: string) => void): () => void;
  stop(): Promise<void>;
}

/** Opens one leg's capture; rejects when it cannot open, and honours `signal`. */
export type OpenSource = (leg: LegName, signal: AbortSignal) => Promise<Source>;
```

Create `src/providers/fake/source.ts`:

```ts
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { Source } from '../../lib/session/source';
import { synthPcm } from './synth';

export interface FakeSource extends Source {
  /** Makes the next chunks a tone (voice) or silence. */
  setVoiced(voiced: boolean): void;
  /** Ends the capture, as an unplugged device would. */
  end(reason: string): void;
  /** Reports the capture as degraded. */
  degrade(message: string): void;
  readonly stopped: boolean;
}

/**
 * A capture that delivers a chunk every `chunkMs` on the clock — a tone while
 * voiced, silence otherwise — with its end and degradation injectable (spec:
 * "Testing", fake sources).
 */
export function createFakeSource(clock: Clock, options: { chunkMs?: number; voiced?: boolean } = {}): FakeSource {
  const chunkMs = options.chunkMs ?? 100;
  let voiced = options.voiced ?? false;
  let stopped = false;
  const pcmListeners = new Set<(pcm: Int16Array) => void>();
  const endedListeners = new Set<(reason: string) => void>();
  const degradedListeners = new Set<(message: string) => void>();
  const listen = <T>(set: Set<T>, listener: T) => {
    set.add(listener);
    return () => { set.delete(listener); };
  };
  const tick = () => {
    if (stopped) return;
    const pcm = voiced ? synthPcm(chunkMs) : new Int16Array((SAMPLE_RATE * chunkMs) / 1000);
    for (const listener of pcmListeners) listener(pcm);
    cancel = clock.setTimeout(tick, chunkMs);
  };
  let cancel = clock.setTimeout(tick, chunkMs);

  return {
    onPcm: (listener) => listen(pcmListeners, listener),
    onEnded: (listener) => listen(endedListeners, listener),
    onDegraded: (listener) => listen(degradedListeners, listener),
    async stop() {
      stopped = true;
      cancel();
    },
    setVoiced(next) {
      voiced = next;
    },
    end(reason) {
      if (stopped) return;
      stopped = true;
      cancel();
      for (const listener of endedListeners) listener(reason);
    },
    degrade(message) {
      for (const listener of degradedListeners) listener(message);
    },
    get stopped() {
      return stopped;
    },
  };
}
```

In `src/providers/fake/adapter.ts`, in `createFakeAdapter().start`, directly after the `if (faults?.startDelayMs) await waitOnClock(...)` line, add:

```ts
      // A cancel landing as the delay ends still wins: nothing opens after it.
      if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/fake`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run the typecheck gate; expect exactly the four baseline lines.

```bash
git add src/lib/session/source.ts src/providers/fake
git commit -m "feat(fake): a fake capture, and a start that honours a late cancel"
```

---

### Task 3: The provider layer's side of a run

**Files:**
- Create: `src/lib/provider/credentials.ts`
- Create: `src/lib/session/types.ts`
- Modify: `src/lib/provider/types.ts`, `src/lib/provider/languages.ts`, `src/lib/provider/presence.ts`
- Modify: `src/stores/providerStore.ts`
- Modify: `src/components/providers/ProviderPanel.tsx`
- Test: `src/lib/provider/credentials.test.ts`, `src/stores/providerStore.test.ts`, `src/components/providers/ProviderPanel.test.tsx`

**Interfaces:**
- Consumes: plan 1b's `Provider`, `providerStore`.
- Produces:
  - `readCredentials<S, K>(p, s, saved: CredentialValues, auth): K | { missing: string }` and `isMissing(r): r is { missing: string }`;
  - `Provider<S, K extends { missing?: never }, C extends { refused?: never }>` with `session?: SessionHooks<S, K, C>`;
  - `Readiness` moved into `src/lib/provider/types.ts` (the store re-exports it);
  - every type in `src/lib/session/types.ts` exactly as written below;
  - on the store, `selected: string | null` and `select(id: string): void`.

The roadmap's items carried out of plan 1b for 1c: `readCredentials` holds the rule that `read` sees exactly the fields `fields(s)` shows, so the runner does not re-implement it; a `read` that throws becomes a not-ready answer, not a rejected promise; `K` / `C` are constrained so the `missing` / `refused` checks rest on the compiler.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/provider/credentials.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isMissing, readCredentials } from './credentials';
import type { CredentialField } from './types';

const auth = { signedIn: false, getToken: async () => null };
const field = (key: string): CredentialField => ({ key, labelKey: key, secret: true });

describe('readCredentials', () => {
  it('hands read exactly the fields the settings show, a missing one as empty', () => {
    const seen: unknown[] = [];
    const p = {
      credentials: {
        keys: ['apiKey', 'apiKeyEu'],
        fields: (s: { region: string }) => [field(s.region === 'eu' ? 'apiKeyEu' : 'apiKey')],
        read: (values: Record<string, string>) => { seen.push(values); return { key: values.apiKeyEu }; },
      },
    };
    expect(readCredentials(p, { region: 'eu' }, { apiKey: 'us-1' }, auth)).toEqual({ key: '' });
    expect(seen).toEqual([{ apiKeyEu: '' }]);
  });

  it('answers a read that throws as missing, instead of throwing', () => {
    const p = { credentials: { keys: [], fields: () => [], read: () => { throw new Error('bad shape'); } } };
    const answer = readCredentials(p, {}, {}, auth);
    expect(isMissing(answer) && answer.missing).toBe('Could not read the credentials: bad shape');
  });

  it('tells a missing answer from credentials', () => {
    expect(isMissing({ missing: 'no key' })).toBe(true);
    expect(isMissing({ key: 'k' })).toBe(false);
    expect(isMissing({})).toBe(false);
  });
});
```

Append to `src/stores/providerStore.test.ts`, in `describe('writes')`:

```ts
  it('remembers the chosen provider', () => {
    expect(useProviderStore.getState().selected).toBeNull();
    useProviderStore.getState().select('probe');
    expect(useProviderStore.getState().selected).toBe('probe');
  });
```

(and in that file's `beforeEach`, reset `selected: null` along with `entries`).

Append to `src/components/providers/ProviderPanel.test.tsx` (it already mocks the settings service and i18n, and imports `fakeProvider`, `useProviderStore`, `ProviderPanel`, `noAuth`; its `beforeEach` must also reset `selected: null`):

```tsx
  it('shows the provider the store has chosen, and records a new choice there', async () => {
    const other = { ...fakeProvider, id: 'fake2', settings: { ...fakeProvider.settings, key: 'fake2' } };
    useProviderStore.setState({ selected: 'fake2' });
    render(<ProviderPanel providers={[fakeProvider, other]} auth={noAuth} />);
    expect(await screen.findByLabelText('simpleSettings.provider')).toHaveValue('fake2');
    fireEvent.change(screen.getByLabelText('simpleSettings.provider'), { target: { value: 'fake' } });
    expect(useProviderStore.getState().selected).toBe('fake');
  });

  it('records the provider it shows when the store has none', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} />);
    await screen.findByLabelText('Script');
    expect(useProviderStore.getState().selected).toBe('fake');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/provider/credentials.test.ts src/stores/providerStore.test.ts src/components/providers/ProviderPanel.test.tsx`
Expected: FAIL — `./credentials` does not resolve; `selected` undefined.

- [ ] **Step 3: Write the run types**

Create `src/lib/session/types.ts`:

```ts
/**
 * The runner's vocabulary (spec: "Session lifecycle"). Types only.
 */
import type { AdapterEvents, AdapterSession, StartRequest } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import type { AnyProvider, AuthContext, LanguagePair, SharedSettings } from '../provider/types';

/** One global setting (D15). Push-to-talk and push-to-translate are the same to an adapter: manual turns. */
export type TurnMode = 'auto' | 'push-to-talk' | 'push-to-translate';

/** Everything a run reads, frozen once at start (spec: "A run"); later steps read this, never the live stores. */
export interface RunShape {
  provider: AnyProvider;
  /** The provider's settings at start. */
  settings: unknown;
  /** Its saved credential values at start: every key in `credentials.keys`. */
  credentials: Readonly<Record<string, string>>;
  /** The speaker's pair; the participant leg runs its reverse. */
  pair: LanguagePair;
  /** The legs asked for, speaker first. */
  legs: readonly LegName[];
  turnMode: TurnMode;
  /** The speaker leg produces no translated speech (unless the provider always speaks). */
  textOnly: boolean;
  /** The participant-TTS opt-in; off until plan 1c-2's routing adds the switch. */
  participantSpeech: boolean;
  keepReplayAudio: boolean;
  shared: SharedSettings;
  auth: AuthContext;
}

/** A notice a run records; surfaces localize it by `code`. */
export interface RunNotice {
  code: string;
  message: string;
  params?: Record<string, string | number>;
}

/** What a provider's `prepare` returns (the managed voice claim). */
export interface Prepared<S> {
  /** Applies to this run only. */
  override?: Partial<S>;
  /** Written back field by field, where the stored value still equals the run's snapshot. */
  persist?: Partial<S>;
  notice?: RunNotice;
}

/** A managed lease: one `K` per leg, released when the run unwinds. */
export interface Resources<K> {
  credentials(leg: LegName): K;
  release(): Promise<void>;
}

/** What a provider may add across legs and time (spec: "Session hooks on the provider definition"). */
export interface SessionHooks<S, K, C> {
  prepare?(shape: RunShape, s: S, signal: AbortSignal): Promise<Prepared<S>>;
  /** Cross-leg checks over the configs actually built. */
  admit?(configs: Partial<Record<LegName, C>>): true | { refused: string };
  /** `end` stops the run with a notice: budget exhausted, duration cutoff. */
  acquire?(shape: RunShape, s: S, ctx: { signal: AbortSignal; end(message: string): void }): Promise<Resources<K>>;
  /** Both legs at once (D23): the provider decides between one mixed socket and two. */
  startBoth?(
    requests: Record<LegName, StartRequest<C, K>>,
    events: Record<LegName, AdapterEvents>,
  ): Promise<Record<LegName, AdapterSession>>;
}

/** Why a run ended; the idle surfaces look the text up by the notice's code. */
export type EndReason = 'user' | 'refused' | 'start-failed' | 'leg-failed' | 'leg-closed' | 'source-ended' | 'lease-ended';

export interface RunEnd {
  reason: EndReason;
  notice?: RunNotice & { leg?: LegName };
}

export type LegState = 'opening' | 'live' | 'reconnecting';

export type RunState =
  | { phase: 'idle'; lastEnd?: RunEnd }
  | { phase: 'starting'; step: 'checking' | 'preparing' | 'opening' }
  | { phase: 'running'; since: number; legs: Partial<Record<LegName, LegState>> }
  | { phase: 'stopping' };
```

- [ ] **Step 4: Implement the provider layer changes**

`src/lib/provider/types.ts`:

1. `import type { SessionHooks } from '../session/types';` (a type-only cycle with `session/types.ts`, which TypeScript resolves).
2. Move the `Readiness` type here, after `CheckResult`:
   ```ts
   /** Whether a provider can start now (spec: "Readiness is one check"). */
   export type Readiness =
     | { state: 'unknown' }
     | { state: 'checking' }
     | { state: 'ready'; models: readonly ModelOption[] }
     | { state: 'not-ready'; reason: string };
   ```
3. Constrain the interface: `export interface Provider<S, K extends { missing?: never }, C extends { refused?: never }> {`, and add as its last member:
   ```ts
  // across legs and time — optional
  session?: SessionHooks<S, K, C>;
   ```
4. Update the doc comments on `credentials.read` and `build` to say the constraint enforces it ("`K` has no `missing` member — the type parameter's constraint enforces it"; the same for `C` and `refused`).

`src/lib/provider/languages.ts` and `src/lib/provider/presence.ts`: their `Pick<Provider<…, unknown, unknown>, …>` becomes `Pick<Provider<…, never, never>, …>` (`unknown` no longer satisfies the new constraints; `never` does, and neither pick reads `K` or `C`).

Create `src/lib/provider/credentials.ts`:

```ts
import { describeCause } from '../diagnostics/describeCause';
import type { AuthContext, CredentialValues, Provider } from './types';

/**
 * A provider's credentials for these settings: `read` sees the values of
 * exactly the fields `fields(s)` shows, a field with nothing saved as ''. A
 * `read` that throws is a provider bug, answered as missing rather than
 * thrown, so no caller has to guard it.
 */
export function readCredentials<S, K extends { missing?: never }>(
  p: Pick<Provider<S, K, never>, 'credentials'>,
  s: S,
  saved: CredentialValues,
  auth: AuthContext,
): K | { missing: string } {
  const values: CredentialValues = Object.fromEntries(p.credentials.fields(s).map((f) => [f.key, saved[f.key] ?? '']));
  try {
    return p.credentials.read(values, auth);
  } catch (error) {
    return { missing: `Could not read the credentials: ${describeCause(error)}` };
  }
}

/** A `missing` answer, told from credentials by the constraint that `K` has no `missing` member. */
export function isMissing(answer: unknown): answer is { missing: string } {
  return typeof (answer as { missing?: unknown } | null)?.missing === 'string';
}
```

`src/stores/providerStore.ts`:
1. Import `Readiness` from `../lib/provider/types` and re-export it: `export type { Readiness } from '../lib/provider/types';` — delete the local `Readiness` type; keep `UNKNOWN` here.
2. Import `{ isMissing, readCredentials }` from `../lib/provider/credentials`.
3. In `refreshReadiness`, replace the block from `// \`read\` receives exactly the fields…` through the `missing` return with:
   ```ts
      const credentials = readCredentials(p, entry.settings, entry.credentials, auth);
      if (isMissing(credentials)) return setReadiness(p, { state: 'not-ready', reason: credentials.missing });
      // The fields these settings show, for the cache key below.
      const values = Object.fromEntries(p.credentials.fields(entry.settings).map((f) => [f.key, entry.credentials[f.key] ?? '']));
   ```
4. Add to `ProviderStore`: `/** The provider the panel shows and a run starts; in memory until plan 1e persists it under \`settings.common.provider\`. */ selected: string | null;` and `select(id: string): void;`; in the returned object: `selected: null,` and `select(id) { set({ selected: id }); },`.

`src/components/providers/ProviderPanel.tsx`: the choice moves to the store.
- Remove `useState` from the React import.
- Replace the `useState` line and the `provider` line with:
  ```tsx
  const selected = useProviderStore((st) => st.selected);
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  ```
- Add `select` to the destructured store actions, and after the load effect:
  ```tsx
  // The store holds what the panel shows, so a run starts the provider on screen.
  useEffect(() => {
    if (provider && selected !== provider.id) select(provider.id);
  }, [provider, selected, select]);
  ```
- The select's `onChange` becomes `(e) => select(e.target.value)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/provider src/providers src/stores/providerStore.test.ts src/stores/providerStore.readiness.test.ts src/components/providers`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run the typecheck gate; expect exactly the four baseline lines.

```bash
git add src/lib/provider src/lib/session/types.ts src/stores/providerStore.ts src/stores/providerStore.test.ts src/components/providers
git commit -m "feat(provider): session hooks, constrained credentials, and the chosen provider in the store"
```

---

### Task 4: The resource stack

**Files:**
- Create: `src/lib/session/stack.ts`
- Test: `src/lib/session/stack.test.ts`

**Interfaces:**
- Produces: `ReleaseFailure { name: string; message: string }`; `class ResourceStack { constructor(clock: Clock, timeoutMs: number, onFailure: (f: ReleaseFailure) => void); defer(name: string, release: () => Promise<void> | void): void; unwind(): Promise<void>; readonly unwound: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/session/stack.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { ResourceStack, type ReleaseFailure } from './stack';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(timeoutMs = 1000) {
  const clock = createVirtualClock();
  const failures: ReleaseFailure[] = [];
  const stack = new ResourceStack(clock, timeoutMs, (f) => failures.push(f));
  return { clock, failures, stack };
}

describe('ResourceStack', () => {
  it('releases the last pushed first, one at a time', async () => {
    const { stack } = setup();
    const order: string[] = [];
    let finishLease!: () => void;
    stack.defer('lease', async () => { order.push('lease'); });
    stack.defer('session', () => new Promise<void>((resolve) => { order.push('session:start'); finishLease = () => { order.push('session:done'); resolve(); }; }));
    stack.defer('listener', () => { order.push('listener'); });
    const done = stack.unwind();
    await flush();
    expect(order).toEqual(['listener', 'session:start']);
    finishLease();
    await done;
    expect(order).toEqual(['listener', 'session:start', 'session:done', 'lease']);
  });

  it('reports a release that throws or rejects, and still runs the rest', async () => {
    const { stack, failures } = setup();
    const released: string[] = [];
    stack.defer('a', () => { released.push('a'); });
    stack.defer('b', async () => { throw new Error('socket stuck'); });
    stack.defer('c', () => { throw new Error('bad'); });
    await stack.unwind();
    expect(released).toEqual(['a']);
    expect(failures).toEqual([{ name: 'c', message: 'bad' }, { name: 'b', message: 'socket stuck' }]);
  });

  it('gives up on a release that overruns its timeout, and moves on', async () => {
    const { stack, failures, clock } = setup(500);
    let released = false;
    stack.defer('first', () => { released = true; });
    stack.defer('hangs', () => new Promise<void>(() => {}));
    const done = stack.unwind();
    await flush();
    clock.advance(500);
    await done;
    expect(released).toBe(true);
    expect(failures).toEqual([{ name: 'hangs', message: 'timed out after 500 ms' }]);
  });

  it('unwinds once: every call returns the same promise', async () => {
    const { stack } = setup();
    let n = 0;
    stack.defer('x', () => { n++; });
    const a = stack.unwind();
    const b = stack.unwind();
    expect(a).toBe(b);
    await a;
    expect(n).toBe(1);
    expect(stack.unwound).toBe(true);
  });

  it('releases at once what is pushed after unwinding began', async () => {
    const { stack } = setup();
    await stack.unwind();
    let released = false;
    stack.defer('late session', () => { released = true; });
    await flush();
    expect(released).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/session/stack.test.ts`
Expected: FAIL — `./stack` does not resolve.

- [ ] **Step 3: Implement**

Create `src/lib/session/stack.ts`:

```ts
import type { Clock } from '../contract/clock';
import { describeCause } from '../diagnostics/describeCause';

/** A release that threw, rejected or overran its timeout. */
export interface ReleaseFailure {
  name: string;
  message: string;
}

interface Entry {
  name: string;
  release: () => Promise<void> | void;
}

/**
 * Every resource a run acquires, pushed with its release the moment it is
 * acquired (spec: "A run"). Stop, failure and cancel all unwind it the same
 * way: last in first out, one release at a time, each bounded by a timeout,
 * once. It replaces today's five hand-written rollback lists.
 */
export class ResourceStack {
  private readonly entries: Entry[] = [];
  private unwinding: Promise<void> | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly timeoutMs: number,
    private readonly onFailure: (failure: ReleaseFailure) => void,
  ) {}

  get unwound(): boolean {
    return this.unwinding !== null;
  }

  /**
   * Pushes a release. Once unwinding has begun the release runs at once
   * instead: a resource that finished opening after a cancel is closed, never
   * kept.
   */
  defer(name: string, release: () => Promise<void> | void): void {
    if (this.unwinding) {
      void this.release({ name, release });
      return;
    }
    this.entries.push({ name, release });
  }

  /** Releases everything, last pushed first. Every call returns the same promise. */
  unwind(): Promise<void> {
    this.unwinding ??= this.run();
    return this.unwinding;
  }

  private async run(): Promise<void> {
    for (let entry = this.entries.pop(); entry; entry = this.entries.pop()) {
      await this.release(entry);
    }
  }

  private release(entry: Entry): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (failure: ReleaseFailure | null) => {
        if (settled) return;
        settled = true;
        cancel();
        if (failure) this.onFailure(failure);
        resolve();
      };
      const cancel = this.clock.setTimeout(
        () => finish({ name: entry.name, message: `timed out after ${this.timeoutMs} ms` }),
        this.timeoutMs,
      );
      Promise.resolve()
        .then(entry.release)
        .then(
          () => finish(null),
          (error) => finish({ name: entry.name, message: describeCause(error) }),
        );
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/session/stack.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
git add src/lib/session/stack.ts src/lib/session/stack.test.ts
git commit -m "feat(session): a resource stack that unwinds once, in reverse, with timeouts"
```

---

### Task 5: The turn and its voice gate

**Files:**
- Create: `src/lib/session/turn.ts`
- Test: `src/lib/session/turn.test.ts`

**Interfaces:**
- Produces: `VOICED_LEVEL = 0.01`; `MIN_VOICED_MS = 500`; `isVoiced(pcm: Int16Array): boolean`; `class Turn { constructor(startedAt: number); readonly startedAt: number; readonly isOpen: boolean; add(pcm: Int16Array): void; close(): 'end' | 'cancel' | null }`.

Today's gate (`MainPanel.tsx` `isSilentAudio`, `MIN_VOICE_CHUNKS = 5`) counts chunks of 100 ms whose mean absolute amplitude reaches 1 % of full scale; five of them — 500 ms of voice — end the turn, fewer cancel it. The turn counts milliseconds, so it does not depend on the capture's chunk size.

- [ ] **Step 1: Write the failing test**

Create `src/lib/session/turn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { synthPcm } from '../../providers/fake/synth';
import { MIN_VOICED_MS, Turn, isVoiced } from './turn';

const silence = (ms: number) => new Int16Array((24000 * ms) / 1000);

describe('isVoiced', () => {
  it('hears a tone and not silence or nothing', () => {
    expect(isVoiced(synthPcm(100))).toBe(true);
    expect(isVoiced(silence(100))).toBe(false);
    expect(isVoiced(new Int16Array(0))).toBe(false);
  });

  it('draws the line at a mean of 1% of full scale', () => {
    expect(isVoiced(new Int16Array(100).fill(328))).toBe(true);
    expect(isVoiced(new Int16Array(100).fill(327))).toBe(false);
  });
});

describe('Turn', () => {
  it('ends a turn that held enough voice', () => {
    const turn = new Turn(0);
    for (let i = 0; i < MIN_VOICED_MS / 100; i++) turn.add(synthPcm(100));
    expect(turn.close()).toBe('end');
  });

  it('cancels a turn that held too little voice, however long it was held', () => {
    const turn = new Turn(0);
    for (let i = 0; i < 4; i++) turn.add(synthPcm(100));
    for (let i = 0; i < 20; i++) turn.add(silence(100));
    expect(turn.close()).toBe('cancel');
  });

  it('closes once, and counts nothing after', () => {
    const turn = new Turn(7);
    expect(turn.isOpen).toBe(true);
    expect(turn.close()).toBe('cancel');
    turn.add(synthPcm(1000));
    expect(turn.close()).toBeNull();
    expect(turn.isOpen).toBe(false);
    expect(turn.startedAt).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/session/turn.test.ts`
Expected: FAIL — `./turn` does not resolve.

- [ ] **Step 3: Implement**

Create `src/lib/session/turn.ts`:

```ts
import { SAMPLE_RATE } from '../contract/adapter';

/** A chunk whose mean absolute amplitude reaches this share of full scale counts as voice (today's `isSilentAudio` threshold). */
export const VOICED_LEVEL = 0.01;

/** A turn holding less voice than this is cancelled rather than ended (today: five 100 ms chunks). */
export const MIN_VOICED_MS = 500;

export function isVoiced(pcm: Int16Array): boolean {
  if (pcm.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += Math.abs(pcm[i]) / 32768;
  return sum / pcm.length >= VOICED_LEVEL;
}

/**
 * One press of the key (spec: "Turns belong to the run"). Each press gets its
 * own count, so a press landing while the last release is still ending cannot
 * reset that turn's count.
 */
export class Turn {
  private voicedMs = 0;
  private open = true;

  constructor(readonly startedAt: number) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** Counts a chunk sent during the turn. */
  add(pcm: Int16Array): void {
    if (this.open && isVoiced(pcm)) this.voicedMs += (pcm.length / SAMPLE_RATE) * 1000;
  }

  /** Closes the turn: 'end' when it held enough voice, else 'cancel'; null when it was already closed. */
  close(): 'end' | 'cancel' | null {
    if (!this.open) return null;
    this.open = false;
    return this.voicedMs >= MIN_VOICED_MS ? 'end' : 'cancel';
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/session/turn.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
git add src/lib/session/turn.ts src/lib/session/turn.test.ts
git commit -m "feat(session): a turn object with the generic voice gate"
```

---

### Task 6: The gate, the leg contexts and the shared settings

**Files:**
- Create: `src/lib/session/shape.ts`
- Create: `src/lib/session/shared.ts`
- Test: `src/lib/session/shape.test.ts`, `src/lib/session/shared.test.ts`

**Interfaces:**
- Consumes: `RunShape` (Task 3), `reverseSupported` (plan 1b), `fakeProvider`, `FAKE_DEFAULTS` (tests).
- Produces: `interface Refusal extends RunNotice { leg?: LegName }`; `contextsFor(shape): Partial<Record<LegName, SessionContext>>`; `gate(shape, platform: Platform): Refusal | null`; `InstructionSettings`; `buildSharedSettings(p, s, pair, instructions, pauses): SharedSettings`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/session/shape.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AUTO } from '../provider/languages';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { contextsFor, gate } from './shape';
import type { RunShape } from './types';

const shape = (patch: Partial<RunShape> = {}): RunShape => ({
  provider: fakeProvider,
  settings: FAKE_DEFAULTS,
  credentials: { apiKey: '' },
  pair: { source: 'en', target: 'ja' },
  legs: ['speaker'],
  turnMode: 'auto',
  textOnly: false,
  participantSpeech: false,
  keepReplayAudio: true,
  shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 } },
  auth: { signedIn: false, getToken: async () => null },
  ...patch,
});

describe('contextsFor', () => {
  it('gives the speaker the pair and the participant its reverse, always with automatic turns', () => {
    const contexts = contextsFor(shape({ legs: ['speaker', 'participant'], turnMode: 'push-to-talk' }));
    expect(contexts).toEqual({
      speaker: { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'manual' },
      participant: { direction: { source: 'ja', target: 'en' }, speech: false, turns: 'auto' },
    });
  });

  it('turns speech off for text-only, and the participant on only with the opt-in', () => {
    const contexts = contextsFor(shape({ legs: ['speaker', 'participant'], textOnly: true, participantSpeech: true }));
    expect(contexts.speaker?.speech).toBe(false);
    expect(contexts.participant?.speech).toBe(true);
  });

  it('follows a provider that always or never speaks, whatever the switches say', () => {
    expect(contextsFor(shape({ provider: { ...fakeProvider, speech: 'always' }, textOnly: true })).speaker?.speech).toBe(true);
    expect(contextsFor(shape({ provider: { ...fakeProvider, speech: 'never' } })).speaker?.speech).toBe(false);
  });
});

describe('gate', () => {
  it('lets a supported shape through', () => {
    expect(gate(shape({ legs: ['speaker', 'participant'] }), 'electron')).toBeNull();
  });

  it('refuses a shape with no legs', () => {
    expect(gate(shape({ legs: [] }), 'electron')).toMatchObject({ code: 'no-legs' });
  });

  it('refuses the participant leg where the provider cannot run the reversed pair (D20)', () => {
    expect(gate(shape({ legs: ['participant'], pair: { source: AUTO, target: 'en' } }), 'electron'))
      .toMatchObject({ code: 'participant-unsupported', leg: 'participant' });
  });

  it('refuses the participant leg where the platform has no participant source', () => {
    expect(gate(shape({ legs: ['speaker', 'participant'] }), 'web')).toMatchObject({ code: 'participant-source-unavailable', leg: 'participant' });
  });

  it('refuses a turn mode the provider does not offer', () => {
    const manualOnly = { ...fakeProvider, turns: () => ['manual' as const] };
    expect(gate(shape({ provider: manualOnly }), 'electron')).toMatchObject({ code: 'turn-mode-unsupported', leg: 'speaker' });
    expect(gate(shape({ provider: manualOnly, turnMode: 'push-to-talk', legs: ['speaker', 'participant'] }), 'electron'))
      .toMatchObject({ code: 'turn-mode-unsupported', leg: 'participant' });
  });
});
```

Create `src/lib/session/shared.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { buildSharedSettings, type InstructionSettings } from './shared';

const pair = { source: 'en', target: 'ja' };
const pauses = { sourceSeconds: 1.2, translationSeconds: 0.8 };
const settings = (patch: Partial<InstructionSettings>): InstructionSettings => ({
  useTemplateMode: true,
  templateSystemInstructions: 'Translate {{SOURCE_LANGUAGE}} into {{TARGET_LANGUAGE}}. Only {{TARGET_LANGUAGE}}.',
  systemInstructions: 'mine',
  participantSystemInstructions: 'theirs',
  ...patch,
});

describe('buildSharedSettings', () => {
  it("fills the template with each direction's English names", () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({}), pauses);
    expect(shared.instructions({ source: 'en', target: 'ja' })).toBe('Translate English into Japanese. Only Japanese.');
    expect(shared.instructions({ source: 'ja', target: 'en' })).toBe('Translate Japanese into English. Only English.');
  });

  it('falls back to the code for a language the provider does not name', () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({}), pauses);
    expect(shared.instructions({ source: 'xx', target: 'ja' })).toBe('Translate xx into Japanese. Only Japanese.');
  });

  it("uses the user's prompt for the speaker's direction and the participant prompt for the reverse", () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({ useTemplateMode: false }), pauses);
    expect(shared.instructions({ source: 'en', target: 'ja' })).toBe('mine');
    expect(shared.instructions({ source: 'ja', target: 'en' })).toBe('theirs');
  });

  it("falls back to the user's prompt when the participant prompt is blank", () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({ useTemplateMode: false, participantSystemInstructions: '  ' }), pauses);
    expect(shared.instructions({ source: 'ja', target: 'en' })).toBe('mine');
  });

  it('passes the pauses through', () => {
    expect(buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({}), pauses).pauses).toEqual(pauses);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/session/shape.test.ts src/lib/session/shared.test.ts`
Expected: FAIL — neither module resolves.

- [ ] **Step 3: Implement**

Create `src/lib/session/shape.ts`:

```ts
import type { SessionContext } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import { reverseSupported } from '../provider/languages';
import type { Platform } from '../provider/types';
import type { RunNotice, RunShape } from './types';

/** Why a start was refused before anything opened. */
export interface Refusal extends RunNotice {
  leg?: LegName;
}

/** What each leg's adapter is told (spec: "The session request"). The participant leg runs the reverse, always with automatic turns. */
export function contextsFor(shape: RunShape): Partial<Record<LegName, SessionContext>> {
  const { provider: p, pair } = shape;
  const speaks = (wanted: boolean) => p.speech === 'always' || (p.speech === 'optional' && wanted);
  const contexts: Partial<Record<LegName, SessionContext>> = {};
  if (shape.legs.includes('speaker')) {
    contexts.speaker = {
      direction: { source: pair.source, target: pair.target },
      speech: speaks(!shape.textOnly),
      turns: shape.turnMode === 'auto' ? 'auto' : 'manual',
    };
  }
  if (shape.legs.includes('participant')) {
    contexts.participant = {
      direction: { source: pair.target, target: pair.source },
      speech: speaks(shape.participantSpeech),
      turns: 'auto',
    };
  }
  return contexts;
}

/**
 * The start gate over a frozen shape: what can be refused before anything is
 * checked, built or opened. Credentials, readiness, the build and `admit` are
 * refused by the run's later steps.
 */
export function gate(shape: RunShape, platform: Platform): Refusal | null {
  const { provider: p, settings: s, legs } = shape;
  if (legs.length === 0) return { code: 'no-legs', message: 'The audio mode asks for no leg.' };
  const offered = p.turns(s);
  const speakerTurns = shape.turnMode === 'auto' ? 'auto' : 'manual';
  if (legs.includes('speaker') && !offered.includes(speakerTurns)) {
    return { code: 'turn-mode-unsupported', message: `${p.id} does not offer ${speakerTurns} turns with these settings.`, leg: 'speaker' };
  }
  if (legs.includes('participant')) {
    if (!offered.includes('auto')) {
      return { code: 'turn-mode-unsupported', message: `${p.id} does not offer automatic turns, which the participant leg needs.`, leg: 'participant' };
    }
    if (platform === 'web') {
      return { code: 'participant-source-unavailable', message: 'This build has no participant source.', leg: 'participant' };
    }
    // D20: the participant leg runs the reversed pair; an auto source never reverses.
    if (!reverseSupported(p, s, shape.pair)) {
      return { code: 'participant-unsupported', message: `${p.id} does not translate ${shape.pair.target} into ${shape.pair.source}.`, leg: 'participant' };
    }
  }
  return null;
}
```

Create `src/lib/session/shared.ts`:

```ts
import type { LanguageOption, LanguagePair, Provider, SharedSettings } from '../provider/types';

/** The settings today's `getProcessedSystemInstructions` reads. */
export interface InstructionSettings {
  useTemplateMode: boolean;
  templateSystemInstructions: string;
  systemInstructions: string;
  participantSystemInstructions: string;
}

/**
 * What every builder may read beyond its own settings, resolved once per run.
 * Instructions follow today's `getProcessedSystemInstructions`: in template
 * mode, the template with the direction's English language names; otherwise
 * the user's prompt for the speaker's direction and, for the reverse, the
 * participant prompt or — when blank — the user's.
 */
export function buildSharedSettings<S>(
  p: Pick<Provider<S, never, never>, 'languages'>,
  s: S,
  pair: LanguagePair,
  instructions: InstructionSettings,
  pauses: SharedSettings['pauses'],
): SharedSettings {
  const name = (code: string, options: readonly LanguageOption[]) => options.find((o) => o.value === code)?.englishName || code;
  return {
    pauses,
    instructions(direction) {
      if (instructions.useTemplateMode) {
        const source = name(direction.source, p.languages.sources(s));
        const target = name(direction.target, p.languages.targets(direction.source, s));
        return instructions.templateSystemInstructions
          .replace(/\{\{SOURCE_LANGUAGE\}\}/g, source)
          .replace(/\{\{TARGET_LANGUAGE\}\}/g, target);
      }
      const speakers = direction.source === pair.source && direction.target === pair.target;
      return speakers ? instructions.systemInstructions : instructions.participantSystemInstructions.trim() || instructions.systemInstructions;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/session/shape.test.ts src/lib/session/shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
git add src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/shared.ts src/lib/session/shared.test.ts
git commit -m "feat(session): the start gate, leg contexts and shared settings over a frozen shape"
```

---

### Task 7: The runner — start, stop, and legs that rise and fall together

**Files:**
- Create: `src/lib/session/ports.ts`
- Create: `src/lib/session/conversationSet.ts`
- Create: `src/lib/session/run.ts`
- Create: `src/lib/session/runner.ts`
- Modify: `src/lib/analytics.ts` (`translation_session_end.translation_count` becomes optional)
- Test: `src/lib/session/runner.test.ts`, `src/lib/session/conversationSet.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6; `Conversation`, `DEFAULT_RETENTION`, `eventsFrom`, `AnalyticsEvents` (type only, from `src/lib/analytics.ts`).
- Produces:
  - `PlaybackPort { audio(leg, ref: number | undefined, pcm): void; closed(leg, ref: number): void; held(held: boolean): void; clear(): void }`;
  - `AnalyticsPort { track<E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]): void }`;
  - `ControlMethod` (`'button' | 'keyboard'`);
  - `RunnerDeps` (below);
  - `ConversationSet { get(leg); replace(map); snapshot(): readonly Leg[]; subscribe(l): () => void; clear() }`;
  - `Runner { state: StoreApi<RunState>; conversation: ConversationSet; start(method?): Promise<void>; stop(method?): Promise<void>; press(): void; release(): void; sendText(text: string): void; clear(): void }`;
  - `createRunner(deps: RunnerDeps): Runner`.

`press`, `release` and `sendText` are wired in Task 8. Until then the runner withholds the speaker's audio under manual turns — the gate's closed state — and the three methods do nothing.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/session/conversationSet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { Conversation } from '../conversation/Conversation';
import { ConversationSet } from './conversationSet';

const make = (leg: 'speaker' | 'participant', session: string) =>
  new Conversation({ leg, session, languages: { source: 'en', target: 'ja' }, clock: createVirtualClock() });

describe('ConversationSet', () => {
  it("lists the run's legs speaker first, and keeps the same array until a leg changes", () => {
    const set = new ConversationSet();
    const speaker = make('speaker', 'r1');
    set.replace(new Map([['participant', make('participant', 'r1')], ['speaker', speaker]]));
    const first = set.snapshot();
    expect(first.map((l) => l.leg)).toEqual(['speaker', 'participant']);
    expect(set.snapshot()).toBe(first);
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    expect(set.snapshot()).not.toBe(first);
  });

  it('tells subscribers about a leg change and about a new run', () => {
    const set = new ConversationSet();
    let heard = 0;
    set.subscribe(() => { heard++; });
    const speaker = make('speaker', 'r1');
    set.replace(new Map([['speaker', speaker]]));
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    set.replace(new Map([['speaker', make('speaker', 'r2')]]));
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'source' } });
    expect(heard).toBe(3);
    expect(set.snapshot()[0].session).toBe('r2');
  });

  it('clears every leg', () => {
    const set = new ConversationSet();
    const speaker = make('speaker', 'r1');
    set.replace(new Map([['speaker', speaker]]));
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    speaker.apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    set.clear();
    expect(set.snapshot()[0].segments).toEqual([]);
  });
});
```

Create `src/lib/session/runner.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Leg } from '../conversation/types';
import type { AnyProvider, Readiness } from '../provider/types';
import { createVirtualClock } from '../contract/clock';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS, type FakeSettings } from '../../providers/fake/settings';
import type { OpenSource } from './source';
import { createRunner } from './runner';
import type { RunShape } from './types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Options {
  shape?: Partial<RunShape>;
  settings?: Partial<FakeSettings>;
  openSource?: OpenSource;
  ready?: Readiness;
  onRunEnded?: (legs: readonly Leg[]) => void;
}

function setup(o: Options = {}) {
  const clock = createVirtualClock(0);
  const sources: FakeSource[] = [];
  const playback = { audio: vi.fn(), closed: vi.fn(), held: vi.fn(), clear: vi.fn() };
  const tracked: Array<[string, unknown]> = [];
  const shape: RunShape = {
    provider: fakeProvider as AnyProvider,
    settings: { ...FAKE_DEFAULTS, ...o.settings },
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs: ['speaker'],
    turnMode: 'auto',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 } },
    auth: { signedIn: false, getToken: async () => null },
    ...o.shape,
  };
  let runs = 0;
  const persistIfUnchanged = vi.fn();
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => o.ready ?? { state: 'ready', models: [] },
    persistIfUnchanged,
    openSource: o.openSource ?? (async () => {
      const source = createFakeSource(clock);
      sources.push(source);
      return source;
    }),
    playback,
    analytics: { track: (event, properties) => { tracked.push([event, properties]); } },
    newSessionId: () => `run${++runs}`,
    onRunEnded: o.onRunEnded,
    timeoutMs: 1000,
  });
  const events = (name: string) => tracked.filter(([e]) => e === name).map(([, p]) => p);
  return { clock, runner, sources, playback, events, shape, persistIfUnchanged };
}

describe('runner — starting', () => {
  it('starts every leg it was asked for, goes running, and folds the script into the conversation', async () => {
    const { runner, clock, events } = setup({ shape: { legs: ['speaker', 'participant'] } });
    await runner.start();
    expect(runner.state.getState()).toEqual({ phase: 'running', since: 0, legs: { speaker: 'live', participant: 'live' } });
    clock.advance(600);
    const legs = runner.conversation.snapshot();
    expect(legs.map((l) => l.leg)).toEqual(['speaker', 'participant']);
    expect(legs[0].segments[0]).toMatchObject({ side: 'source', text: 'Hello' });
    expect(legs[1].languages).toEqual({ source: 'ja', target: 'en' });
    expect(events('translation_session_start')).toEqual([expect.objectContaining({
      session_id: 'run1', provider: 'fake', source_language: 'en', target_language: 'ja',
      channels: ['speaker', 'participant'], transport: 'fake', platform: 'electron', translation_model: 'fake',
    })]);
    expect(events('session_control_clicked')).toEqual([{ action: 'start', method: 'button' }]);
  });

  it('hands playback the translated audio and every closed segment', async () => {
    const { runner, clock, playback } = setup();
    await runner.start();
    clock.advance(5000);
    expect(playback.audio).toHaveBeenCalledWith('speaker', 2, expect.any(Int16Array));
    expect(playback.closed).toHaveBeenCalledWith('speaker', 1);
  });

  it('refuses a start the build refuses, opening nothing', async () => {
    const { runner, sources, events } = setup({ settings: { buildRefused: true } });
    await runner.start();
    expect(runner.state.getState()).toEqual({
      phase: 'idle',
      lastEnd: { reason: 'refused', notice: { code: 'build-refused', message: 'The fake refuses to build (fault knob).', leg: 'speaker' } },
    });
    expect(sources).toHaveLength(0);
    expect(events('translation_session_start')).toEqual([]);
    expect(events('error_occurred')).toEqual([]);
  });

  it('refuses the participant leg of an auto source before checking anything (D20)', async () => {
    const { runner } = setup({ shape: { legs: ['speaker', 'participant'], pair: { source: 'auto', target: 'en' } } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'participant-unsupported' } } });
  });

  it('refuses a provider that is not ready, with its reason', async () => {
    const { runner } = setup({ ready: { state: 'not-ready', reason: 'model not downloaded' } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'not-ready', message: 'model not downloaded' } } });
  });

  it('refuses when the credentials the settings ask for are missing', async () => {
    const { runner } = setup({ settings: { requireKey: true } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'credentials-missing' } } });
  });

  it("fails the start when one leg's source will not open, and closes the leg that did (D22)", async () => {
    const clock = createVirtualClock(0);
    const opened: FakeSource[] = [];
    const { runner, events } = setup({
      shape: { legs: ['speaker', 'participant'] },
      openSource: async (leg) => {
        if (leg === 'participant') throw new Error('permission denied');
        const source = createFakeSource(clock);
        opened.push(source);
        return source;
      },
    });
    await runner.start();
    await flush();
    expect(runner.state.getState()).toEqual({
      phase: 'idle',
      lastEnd: { reason: 'start-failed', notice: { code: 'start-failed', message: 'permission denied', leg: 'participant' } },
    });
    expect(opened.every((s) => s.stopped)).toBe(true);
    expect(events('error_occurred')).toEqual([expect.objectContaining({ error_message: 'permission denied', provider: 'fake' })]);
  });

  it('fails the start when the adapter throws, and closes the source it opened', async () => {
    const { runner, sources } = setup({ settings: { startThrows: true } });
    await runner.start();
    await flush();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'start-failed', notice: { message: 'The fake failed to start (fault knob).', leg: 'speaker' } } });
    expect(sources[0].stopped).toBe(true);
  });
});

describe('runner — stopping', () => {
  it('a stop during a slow start cancels it: nothing stays open, nothing plays', async () => {
    const { runner, clock, sources, playback, events } = setup({ settings: { startDelayMs: 2000 } });
    const starting = runner.start();
    await flush();
    expect(runner.state.getState()).toEqual({ phase: 'starting', step: 'opening' });
    await runner.stop();
    await starting;
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(sources.every((s) => s.stopped)).toBe(true);
    clock.advance(10_000);
    expect(playback.audio).not.toHaveBeenCalled();
    expect(events('session_control_clicked')).toEqual([{ action: 'start', method: 'button' }, { action: 'cancel', method: 'button' }]);
    expect(events('translation_session_start')).toEqual([]);
  });

  it('stop is idempotent: every call returns the same promise', async () => {
    const { runner, events } = setup();
    await runner.start();
    const a = runner.stop();
    const b = runner.stop('keyboard');
    expect(a).toBe(b);
    await a;
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(events('session_control_clicked')).toEqual([{ action: 'start', method: 'button' }, { action: 'stop', method: 'button' }]);
  });

  it('a start while stopping does nothing', async () => {
    const { runner, sources } = setup();
    await runner.start();
    const stopping = runner.stop();
    await runner.start();
    await stopping;
    expect(sources).toHaveLength(1);
  });

  it('finalizes open segments, reports the end, and hands the final legs to onRunEnded', async () => {
    const onRunEnded = vi.fn();
    const { runner, clock, events } = setup({ onRunEnded });
    await runner.start();
    clock.advance(600);
    await runner.stop();
    const legs = runner.conversation.snapshot();
    expect(legs[0].segments[0].final).toBe(true);
    expect(onRunEnded).toHaveBeenCalledWith(legs);
    expect(events('translation_session_end')).toEqual([{ session_id: 'run1', duration: 600, provider: 'fake' }]);
    expect(events('connection_status')).toEqual([
      { status: 'connected', provider: 'fake' },
      { status: 'disconnected', provider: 'fake', duration_ms: 600 },
    ]);
  });

  it('reports no session end and calls no onRunEnded after a refused start', async () => {
    const onRunEnded = vi.fn();
    const { runner, events } = setup({ onRunEnded, settings: { buildRefused: true } });
    await runner.start();
    expect(onRunEnded).not.toHaveBeenCalled();
    expect(events('translation_session_end')).toEqual([]);
  });
});

describe('runner — legs end together (D21)', () => {
  it('ends the session when one leg fails, closing every leg', async () => {
    const { runner, clock, sources, events } = setup({ shape: { legs: ['speaker', 'participant'] }, settings: { failAfterMs: 1000 } });
    await runner.start();
    clock.advance(1000);
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code: 'leg_failed', message: 'fake failure' } } });
    expect(sources.every((s) => s.stopped)).toBe(true);
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ severity: 'error', message: 'fake failure' })]);
    expect(events('api_error')[0]).toMatchObject({ provider: 'fake', error_message: 'fake failure', error_type: 'server' });
  });

  it('ends the session when a source ends, and records why on its leg', async () => {
    const { runner, sources } = setup({ shape: { legs: ['speaker', 'participant'] } });
    await runner.start();
    sources[0].end('unplugged');
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'source-ended', notice: { code: 'source_ended', leg: 'speaker' } } });
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ code: 'source_ended' })]);
    expect(sources[1].stopped).toBe(true);
  });

  it('records a degraded source on its leg and keeps running', async () => {
    const { runner, sources } = setup();
    await runner.start();
    sources[0].degrade('fell back to system audio');
    expect(runner.state.getState().phase).toBe('running');
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ severity: 'warning', code: 'source_degraded', message: 'fell back to system audio' })]);
  });
});

describe('runner — the conversation', () => {
  it('outlives the run until the next start replaces it', async () => {
    const { runner, clock } = setup();
    await runner.start();
    clock.advance(5000);
    await runner.stop();
    expect(runner.conversation.snapshot()[0].segments.length).toBeGreaterThan(0);
    await runner.start();
    expect(runner.conversation.snapshot()[0].session).toBe('run2');
    expect(runner.conversation.snapshot()[0].segments).toEqual([]);
  });

  it('keeps no replay audio when keepReplayAudio is off', async () => {
    const { runner, clock } = setup({ shape: { keepReplayAudio: false } });
    await runner.start();
    clock.advance(5000);
    const speech = runner.conversation.snapshot()[0].segments.flatMap((s) => s.speech);
    expect(speech.length).toBeGreaterThan(0);
    expect(speech.every((s) => s.pcm.length === 0)).toBe(true);
  });

  it('discards events from a run that has ended', async () => {
    let late: ((e: { ref: number; side: 'source' }) => void) | undefined;
    const provider = {
      ...fakeProvider,
      start: async (_request: unknown, events: { segmentOpened(e: { ref: number; side: 'source' }): void }) => {
        late = (e) => events.segmentOpened(e);
        return { appendAudio() {}, appendText() {}, beginTurn() {}, endTurn() {}, cancelTurn() {}, async stop() {}, info: {} };
      },
    } as unknown as AnyProvider;
    const { runner } = setup({ shape: { provider } });
    await runner.start();
    await runner.stop();
    late!({ ref: 9, side: 'source' });
    expect(runner.conversation.snapshot()[0].segments).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/session/conversationSet.test.ts src/lib/session/runner.test.ts`
Expected: FAIL — the modules do not resolve.

- [ ] **Step 3: Make `translation_count` optional**

In `src/lib/analytics.ts`, in `'translation_session_end'`, change `translation_count: number;` to:

```ts
    /** No longer collected (D9); still sent by the old session path until plan 1e removes it. */
    translation_count?: number;
```

- [ ] **Step 4: Write the ports and the conversation set**

Create `src/lib/session/ports.ts`:

```ts
import type { AnalyticsEvents } from '../analytics';
import type { Clock } from '../contract/clock';
import type { Punctuator } from '../conversation/fillIn';
import type { Leg, LegName } from '../conversation/types';
import type { AnyProvider, AuthContext, Platform, Readiness } from '../provider/types';
import type { OpenSource } from './source';
import type { RunShape } from './types';

/** Where a run's audio goes; plan 1c-2 builds the clip queues and routes behind it. */
export interface PlaybackPort {
  /** A leg's translated audio; `ref` names the segment it speaks, absent when it names none. */
  audio(leg: LegName, ref: number | undefined, pcm: Int16Array): void;
  /** A segment closed: no more audio will come for it. */
  closed(leg: LegName, ref: number): void;
  /** A manual turn is held (push-to-translate closes the original-voice route while held). */
  held(held: boolean): void;
  /** The run ended or the conversation was cleared: stop, and drop what is queued. */
  clear(): void;
}

/** The session events the runner owns (spec: "Analytics"). */
export interface AnalyticsPort {
  track<E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]): void;
}

export type ControlMethod = AnalyticsEvents['session_control_clicked']['method'];

export interface RunnerDeps {
  clock: Clock;
  platform: Platform;
  /** Everything a run freezes; null when no provider is chosen or it has not loaded. */
  readShape(): RunShape | null;
  /** Readiness through the shared cache (the provider store's `refreshReadiness`). */
  ensureReady(p: AnyProvider, auth: AuthContext): Promise<Readiness>;
  /** Writes a `prepare` patch field by field, only where the stored value still equals the run's snapshot. */
  persistIfUnchanged(p: AnyProvider, snapshot: unknown, patch: Readonly<Record<string, unknown>>): void;
  openSource: OpenSource;
  playback: PlaybackPort;
  analytics: AnalyticsPort;
  punctuate?: Punctuator;
  newSessionId(): string;
  /** After a run that went live has ended and its legs are final: where auto-save plugs in. */
  onRunEnded?(legs: readonly Leg[]): Promise<void> | void;
  /** Bounds each release and the wait for punctuation fill-in; default 5000. */
  timeoutMs?: number;
}
```

Create `src/lib/session/conversationSet.ts`:

```ts
import type { Conversation } from '../conversation/Conversation';
import type { Leg, LegName } from '../conversation/types';

const ORDER: readonly LegName[] = ['speaker', 'participant'];

/**
 * The conversation: the legs of the last run, held until the next start
 * replaces them or `clear()` empties them (spec: "The conversation outlives
 * the run"). Export, replay, auto-save and the surfaces read this, never a run.
 */
export class ConversationSet {
  private legs = new Map<LegName, Conversation>();
  private unsubscribes: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();
  private cached: readonly Leg[] = [];
  private stale = true;

  get(leg: LegName): Conversation | undefined {
    return this.legs.get(leg);
  }

  /** A new run's legs take the place of the last run's. */
  replace(next: ReadonlyMap<LegName, Conversation>): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.legs = new Map(next);
    this.unsubscribes = [...this.legs.values()].map((c) => c.subscribe(() => this.changed()));
    this.changed();
  }

  /** Every leg's snapshot, speaker first; the same array until a leg changes. */
  snapshot(): readonly Leg[] {
    if (this.stale) {
      this.cached = ORDER.flatMap((leg) => {
        const conversation = this.legs.get(leg);
        return conversation ? [conversation.snapshot()] : [];
      });
      this.stale = false;
    }
    return this.cached;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  clear(): void {
    for (const conversation of this.legs.values()) conversation.clear();
  }

  private changed(): void {
    this.stale = true;
    for (const listener of this.listeners) listener();
  }
}
```

- [ ] **Step 5: Write the run**

Create `src/lib/session/run.ts`:

```ts
/**
 * One run (spec: "A run"): the shape frozen at start, its resources on a
 * stack, its legs. Everything that opens here is pushed with its release the
 * moment it is acquired, so stop, failure and cancel unwind the same way. The
 * runner owns the phases and ends a run through `close()`.
 */
import type { AnalyticsEvents } from '../analytics';
import type { AdapterEvents, AdapterSession, StartRequest } from '../contract/adapter';
import { eventsFrom, type AdapterEvent } from '../contract/events';
import { Conversation, DEFAULT_RETENTION } from '../conversation/Conversation';
import type { LegName } from '../conversation/types';
import { describeCause, reportWarning } from '../diagnostics/report';
import { isMissing, readCredentials } from '../provider/credentials';
import type { RunnerDeps } from './ports';
import { contextsFor, gate, type Refusal } from './shape';
import type { Source } from './source';
import { ResourceStack } from './stack';
import type { LegState, Prepared, RunEnd, RunNotice, RunShape } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;
const API_ERROR_TYPES = ['auth', 'rate_limit', 'network', 'server', 'client'] as const;
type ApiErrorType = AnalyticsEvents['api_error']['error_type'];

/** The start was refused before anything opened. */
export class RefusedError extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
  }
}

/** Opening one leg threw: its source, or its adapter. */
export class LegOpenError extends Error {
  constructor(readonly leg: LegName, readonly failure: unknown) {
    super(describeCause(failure));
  }
}

/** What a run tells the runner. */
export interface RunHost {
  step(step: 'checking' | 'preparing' | 'opening'): void;
  legState(leg: LegName, state: LegState): void;
  /** The run's legs exist: they become the conversation now, so text shows as it arrives. */
  conversations(legs: ReadonlyMap<LegName, Conversation>): void;
  /** A leg ended on its own, or a lease did: end the run. */
  end(result: RunEnd): void;
}

export class Run {
  readonly id: string;
  readonly legStates = new Map<LegName, LegState>();
  /** When every leg went live; null until then. */
  liveSince: number | null = null;
  transport: string | undefined;
  models: { asrModel?: string; translationModel?: string; ttsModel?: string } = {};
  private readonly controller = new AbortController();
  private readonly host: RunHost;
  private readonly stack: ResourceStack;
  private readonly conversations = new Map<LegName, Conversation>();
  private readonly sessions = new Map<LegName, AdapterSession>();
  /** Ending: events still fold into L1, but decide nothing. */
  private ending = false;
  /** Ended: events are discarded. */
  private finished = false;

  /** `host` is a factory because the runner's host closes over the run it serves. */
  constructor(private readonly deps: RunnerDeps, host: (run: Run) => RunHost, readonly shape: RunShape) {
    this.id = deps.newSessionId();
    this.host = host(this);
    this.stack = new ResourceStack(deps.clock, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, (f) =>
      reportWarning('SessionRunner', `Releasing ${f.name} failed: ${f.message}`, { dedupeKey: `release:${f.name}` }));
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Steps 1–8 of "A run". Throws a `RefusedError`, a `LegOpenError`, or the abort; the caller ends the run. */
  async open(): Promise<void> {
    const { shape, deps, host } = this;
    const p = shape.provider;

    const refusal = gate(shape, deps.platform);
    if (refusal) throw new RefusedError(refusal);

    host.step('checking');
    const credentials = readCredentials(p, shape.settings, shape.credentials, shape.auth);
    if (isMissing(credentials)) throw new RefusedError({ code: 'credentials-missing', message: credentials.missing });
    const readiness = await deps.ensureReady(p, shape.auth);
    this.throwIfAborted();
    if (readiness.state !== 'ready') {
      throw new RefusedError({ code: 'not-ready', message: readiness.state === 'not-ready' ? readiness.reason : `readiness is ${readiness.state}` });
    }

    let settings = shape.settings;
    let prepared: Prepared<unknown> = {};
    if (p.session?.prepare) {
      host.step('preparing');
      prepared = await p.session.prepare(shape, settings, this.signal);
      this.throwIfAborted();
      if (prepared.override) settings = { ...(settings as object), ...prepared.override };
      if (prepared.persist) deps.persistIfUnchanged(p, shape.settings, prepared.persist);
    }

    const contexts = contextsFor(shape);
    const configs: Partial<Record<LegName, unknown>> = {};
    for (const leg of shape.legs) {
      const built = p.build(contexts[leg]!, settings, shape.shared);
      // `C` has no `refused` member (the provider type's constraint), so this tells a refusal from a config.
      if (typeof built?.refused === 'string') throw new RefusedError({ code: 'build-refused', message: built.refused, leg });
      configs[leg] = built;
    }
    if (p.session?.admit) {
      const admitted = p.session.admit(configs);
      if (admitted !== true) throw new RefusedError({ code: 'admit-refused', message: admitted.refused });
    }
    this.models = p.describe(configs.speaker ?? configs.participant);

    let credentialsFor = (_leg: LegName): unknown => credentials;
    if (p.session?.acquire) {
      const resources = await p.session.acquire(shape, settings, {
        signal: this.signal,
        end: (message) => host.end({ reason: 'lease-ended', notice: { code: 'lease_ended', message } }),
      });
      this.stack.defer('lease', () => resources.release());
      this.throwIfAborted();
      credentialsFor = (leg) => resources.credentials(leg);
    }

    host.step('opening');
    for (const leg of shape.legs) {
      this.conversations.set(leg, new Conversation({
        leg,
        session: this.id,
        languages: contexts[leg]!.direction,
        clock: deps.clock,
        punctuate: deps.punctuate,
        retention: shape.keepReplayAudio ? DEFAULT_RETENTION : { keepPcm: false, maxPcmBytes: 0 },
        onDiagnostic: (d) => reportWarning('SessionRunner', `${leg}: ${d.message}`, { dedupeKey: `conversation:${d.code}` }),
      }));
    }
    host.conversations(this.conversations);
    if (prepared.notice) this.conversations.get(shape.legs[0])!.notice({ severity: 'warning', ...prepared.notice });

    const requests = Object.fromEntries(shape.legs.map((leg) => [leg, {
      context: contexts[leg]!,
      config: configs[leg],
      credentials: credentialsFor(leg),
      clock: deps.clock,
      signal: this.signal,
    }])) as Record<LegName, StartRequest<unknown, unknown>>;

    if (shape.legs.length === 2 && p.session?.startBoth) {
      const sources = await Promise.all(shape.legs.map((leg) => this.openSource(leg)));
      const events = { speaker: this.eventsFor('speaker'), participant: this.eventsFor('participant') };
      let sessions: Record<LegName, AdapterSession>;
      try {
        sessions = await p.session.startBoth(requests, events);
      } catch (error) {
        throw new LegOpenError(shape.legs[0], error);
      }
      for (const leg of shape.legs) this.stack.defer(`${leg} session`, () => sessions[leg].stop());
      this.throwIfAborted();
      shape.legs.forEach((leg, i) => this.connect(leg, sources[i], sessions[leg]));
    } else {
      await Promise.all(shape.legs.map((leg) => this.openLeg(leg, requests[leg])));
    }
    this.throwIfAborted();
    this.liveSince = deps.clock.now();
  }

  /** Ends the run: decide nothing more, abort, unwind, finalize the legs, wait (bounded) for fill-in. */
  async close(): Promise<void> {
    this.ending = true;
    this.controller.abort(new Error('the run ended'));
    await this.stack.unwind();
    for (const conversation of this.conversations.values()) conversation.finalizeAll();
    await this.settled();
    this.finished = true;
  }

  private async openLeg(leg: LegName, request: StartRequest<unknown, unknown>): Promise<void> {
    try {
      const source = await this.openSource(leg);
      this.setLegState(leg, 'opening');
      const session = await this.shape.provider.start(request, this.eventsFor(leg));
      this.stack.defer(`${leg} session`, () => session.stop());
      this.throwIfAborted();
      this.connect(leg, source, session);
    } catch (error) {
      if (this.signal.aborted) throw error;
      throw new LegOpenError(leg, error);
    }
  }

  private async openSource(leg: LegName): Promise<Source> {
    const source = await this.deps.openSource(leg, this.signal);
    this.stack.defer(`${leg} source`, () => source.stop());
    this.throwIfAborted();
    return source;
  }

  private connect(leg: LegName, source: Source, session: AdapterSession): void {
    this.sessions.set(leg, session);
    if (leg === 'speaker' || this.transport === undefined) this.transport = session.info.transport;
    const conversation = this.conversations.get(leg)!;
    this.stack.defer(`${leg} capture`, source.onPcm((pcm) => this.send(leg, session, pcm)));
    this.stack.defer(`${leg} end watch`, source.onEnded((reason) =>
      this.legEnded(leg, 'source-ended', { code: 'source_ended', message: `The ${leg} capture ended: ${reason}` })));
    this.stack.defer(`${leg} degradation watch`, source.onDegraded((message) =>
      conversation.notice({ severity: 'warning', message, code: 'source_degraded' })));
    this.setLegState(leg, 'live');
    this.deps.analytics.track('connection_status', { status: 'connected', provider: this.shape.provider.id });
  }

  /** The participant leg and automatic turns stream everything; manual turns arrive in the next task. */
  private send(leg: LegName, session: AdapterSession, pcm: Int16Array): void {
    if (this.ending) return;
    if (leg === 'participant' || this.shape.turnMode === 'auto') session.appendAudio(pcm);
  }

  private eventsFor(leg: LegName): AdapterEvents {
    return eventsFrom((event) => this.onEvent(leg, event));
  }

  private onEvent(leg: LegName, event: AdapterEvent): void {
    if (this.finished) return;
    this.conversations.get(leg)?.apply(event);
    if (this.ending) return;
    const { playback, analytics } = this.deps;
    const provider = this.shape.provider.id;
    switch (event.kind) {
      case 'audio':
        playback.audio(leg, event.payload.ref, event.payload.pcm);
        return;
      case 'segmentClosed':
        playback.closed(leg, event.payload.ref);
        return;
      case 'reconnecting':
        this.setLegState(leg, 'reconnecting');
        analytics.track('connection_status', { status: 'reconnecting', provider });
        return;
      case 'reconnected':
        this.setLegState(leg, 'live');
        return;
      case 'failed': {
        const { message, code } = event.payload;
        const errorType: ApiErrorType = API_ERROR_TYPES.find((t) => t === code) ?? 'server';
        analytics.track('api_error', { provider, error_message: message, error_code: code, error_type: errorType, channel: leg });
        // L1 already recorded the failure as an error notice on this leg.
        this.host.end({ reason: 'leg-failed', notice: { code: code ?? 'leg_failed', message, leg } });
        return;
      }
      case 'closed':
        this.legEnded(leg, 'leg-closed', { code: 'leg_closed', message: `The ${leg} leg closed: ${event.payload.reason}` });
        return;
      default:
        return;
    }
  }

  /** A leg ended on its own: record why on the leg, and end the run. */
  private legEnded(leg: LegName, reason: RunEnd['reason'], notice: RunNotice): void {
    if (this.ending) return;
    this.conversations.get(leg)?.notice({ severity: 'error', ...notice });
    this.host.end({ reason, notice: { ...notice, leg } });
  }

  private setLegState(leg: LegName, state: LegState): void {
    this.legStates.set(leg, state);
    this.host.legState(leg, state);
  }

  private async settled(): Promise<void> {
    const all = Promise.all([...this.conversations.values()].map((c) => c.settled()));
    await new Promise<void>((resolve) => {
      const cancel = this.deps.clock.setTimeout(resolve, this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      void all.then(() => { cancel(); resolve(); });
    });
  }

  private throwIfAborted(): void {
    if (this.signal.aborted) throw this.signal.reason ?? new Error('aborted');
  }
}
```

- [ ] **Step 6: Write the runner**

Create `src/lib/session/runner.ts`:

```ts
/**
 * The session runner (spec: "The runner"): a plain module outside React.
 * Every surface calls the same methods; the UI reads only `state`.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { describeCause, reportError } from '../diagnostics/report';
import type { LegName } from '../conversation/types';
import { ConversationSet } from './conversationSet';
import type { ControlMethod, RunnerDeps } from './ports';
import { LegOpenError, RefusedError, Run, type RunHost } from './run';
import type { LegState, RunEnd, RunState } from './types';

export interface Runner {
  readonly state: StoreApi<RunState>;
  /** The legs of the last run, until the next start replaces them. */
  readonly conversation: ConversationSet;
  start(method?: ControlMethod): Promise<void>;
  /** Idempotent: every call while a run ends returns the same promise. */
  stop(method?: ControlMethod): Promise<void>;
  press(): void;
  release(): void;
  sendText(text: string): void;
  /** Empties the conversation, and the queued audio with it. */
  clear(): void;
}

export function createRunner(deps: RunnerDeps): Runner {
  const state = createStore<RunState>(() => ({ phase: 'idle' }));
  const conversation = new ConversationSet();
  let current: Run | null = null;
  let ending: Promise<void> | null = null;

  const set = (next: RunState) => state.setState(next, true);
  const legs = (run: Run) => Object.fromEntries(run.legStates) as Partial<Record<LegName, LegState>>;

  /** The one way a run ends — stop, a leg ending, a failed start — once per run. */
  const end = (run: Run, result: RunEnd): Promise<void> => {
    if (run !== current) return Promise.resolve();
    if (ending) return ending;
    const liveSince = run.liveSince;
    set({ phase: 'stopping' });
    ending = (async () => {
      await run.close();
      deps.playback.clear();
      if (liveSince !== null) {
        const duration = deps.clock.now() - liveSince;
        const provider = run.shape.provider.id;
        // One per leg, as `connected` was.
        run.shape.legs.forEach(() => deps.analytics.track('connection_status', { status: 'disconnected', provider, duration_ms: duration }));
        deps.analytics.track('translation_session_end', { session_id: run.id, duration, provider });
        try {
          await deps.onRunEnded?.(conversation.snapshot());
        } catch (error) {
          reportError('SessionRunner', `After the session ended: ${describeCause(error)}`, { cause: error });
        }
      }
      current = null;
      ending = null;
      set({ phase: 'idle', lastEnd: result });
    })();
    return ending;
  };

  const hostFor = (run: Run): RunHost => ({
    step: (step) => {
      if (run === current && state.getState().phase === 'starting') set({ phase: 'starting', step });
    },
    legState: () => {
      const now = state.getState();
      if (run === current && now.phase === 'running') set({ ...now, legs: legs(run) });
    },
    conversations: (map) => conversation.replace(map),
    end: (result) => { void end(run, result); },
  });

  const start = async (method: ControlMethod = 'button'): Promise<void> => {
    if (state.getState().phase !== 'idle') return;
    deps.analytics.track('session_control_clicked', { action: 'start', method });
    const shape = deps.readShape();
    if (!shape) {
      set({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no-provider', message: 'No provider is chosen, or it has not loaded.' } } });
      return;
    }
    const run = new Run(deps, hostFor, shape);
    current = run;
    set({ phase: 'starting', step: 'checking' });
    try {
      await run.open();
    } catch (error) {
      if (run !== current || run.signal.aborted) return; // a stop or a leg's end is already ending it
      if (error instanceof RefusedError) {
        await end(run, { reason: 'refused', notice: error.refusal });
        return;
      }
      const leg = error instanceof LegOpenError ? error.leg : undefined;
      const message = describeCause(error);
      deps.analytics.track('error_occurred', {
        error_type: 'session_start', error_message: message, component: 'session-runner',
        severity: 'high', provider: shape.provider.id, recoverable: true,
      });
      await end(run, { reason: 'start-failed', notice: { code: 'start-failed', message, ...(leg ? { leg } : {}) } });
      return;
    }
    if (run !== current || run.signal.aborted) return;
    set({ phase: 'running', since: run.liveSince!, legs: legs(run) });
    deps.analytics.track('translation_session_start', {
      session_id: run.id,
      provider: shape.provider.id,
      source_language: shape.pair.source,
      target_language: shape.pair.target,
      asr_model: run.models.asrModel,
      translation_model: run.models.translationModel,
      tts_model: run.models.ttsModel,
      transport: run.transport,
      platform: deps.platform,
      channels: [...shape.legs],
    });
  };

  const stop = (method: ControlMethod = 'button'): Promise<void> => {
    const run = current;
    if (!run) return Promise.resolve();
    if (!ending) {
      const action = state.getState().phase === 'starting' ? 'cancel' : 'stop';
      deps.analytics.track('session_control_clicked', { action, method });
    }
    return end(run, { reason: 'user' });
  };

  return {
    state,
    conversation,
    start,
    stop,
    press: () => {},
    release: () => {},
    sendText: () => {},
    clear: () => {
      conversation.clear();
      deps.playback.clear();
    },
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/session`
Expected: PASS — `conversationSet.test.ts` (3), `runner.test.ts` (19), and Tasks 4–6's files.

- [ ] **Step 8: Typecheck, the console ledger, the whole suite, and commit**

Run the typecheck gate; expect exactly the four baseline lines. Run `npx vitest run src/lib/diagnostics/consoleLedger.consistency.test.ts` (PASS) and `npx vitest run src` (0 failed).

```bash
git add src/lib/session src/lib/analytics.ts
git commit -m "feat(session): the runner — a run on a resource stack, legs that rise and fall together"
```

---

### Task 8: Turns, typed text and clearing

**Files:**
- Modify: `src/lib/session/run.ts`, `src/lib/session/runner.ts`
- Modify: `src/lib/analytics.ts` (declare `text_input_sent`)
- Test: `src/lib/session/runner.turns.test.ts`

**Interfaces:**
- Consumes: Task 5's `Turn`; Task 7's `Run`, `createRunner`.
- Produces: `Run.press(): void`, `Run.release(): void`, `Run.sendText(text: string): void`; the runner's `press`, `release`, `sendText` forward to the current run.

Under manual turns the speaker's audio reaches the adapter only while the key is held, counted by the turn; release ends a turn that held enough voice and cancels one that did not; push-to-translate is the same to the adapter and only tells playback the key is held. Stop closes an open turn without asking the adapter to end it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/session/runner.turns.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { AnyProvider } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import type { FakeConfig, FakeCredentials } from '../../providers/fake/adapter';
import { createRunner } from './runner';
import type { RunShape, TurnMode } from './types';

/** The fake, with every call its sessions receive written to `log` as `<leg>:<call>`. */
function spyingProvider(log: string[], patch: Partial<AnyProvider> = {}): AnyProvider {
  return {
    ...fakeProvider,
    ...patch,
    async start(request: StartRequest<FakeConfig, FakeCredentials>, events: AdapterEvents) {
      const leg = request.context.direction.source === 'en' ? 'speaker' : 'participant';
      const inner = await fakeProvider.start(request, events);
      return {
        info: inner.info,
        appendAudio: (pcm: Int16Array) => { log.push(`${leg}:audio`); inner.appendAudio(pcm); },
        appendText: (text: string) => { log.push(`${leg}:text`); inner.appendText(text); },
        beginTurn: () => { log.push(`${leg}:begin`); inner.beginTurn(); },
        endTurn: () => { log.push(`${leg}:end`); inner.endTurn(); },
        cancelTurn: () => { log.push(`${leg}:cancel`); inner.cancelTurn(); },
        stop: () => inner.stop(),
      };
    },
  } as AnyProvider;
}

function setup(o: { turnMode?: TurnMode; legs?: RunShape['legs']; provider?: AnyProvider; log?: string[] } = {}) {
  const clock = createVirtualClock(0);
  const log = o.log ?? [];
  const sources: FakeSource[] = [];
  const playback = { audio: vi.fn(), closed: vi.fn(), held: vi.fn(), clear: vi.fn() };
  const tracked: Array<[string, unknown]> = [];
  const shape: RunShape = {
    provider: o.provider ?? spyingProvider(log),
    settings: FAKE_DEFAULTS,
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs: o.legs ?? ['speaker'],
    turnMode: o.turnMode ?? 'push-to-talk',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 } },
    auth: { signedIn: false, getToken: async () => null },
  };
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged: () => {},
    openSource: async () => { const s = createFakeSource(clock); sources.push(s); return s; },
    playback,
    analytics: { track: (event, properties) => { tracked.push([event, properties]); } },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  const events = (name: string) => tracked.filter(([e]) => e === name).map(([, p]) => p);
  const count = (entry: string) => log.filter((e) => e === entry).length;
  return { clock, runner, sources, playback, events, log, count };
}

describe('runner — manual turns', () => {
  it("sends the speaker's audio only while the key is held, and ends a turn that held voice", async () => {
    const { runner, clock, sources, count, log, playback, events } = setup();
    await runner.start();
    sources[0].setVoiced(true);
    clock.advance(300);
    expect(count('speaker:audio')).toBe(0);
    runner.press();
    clock.advance(600);
    runner.release();
    expect(count('speaker:audio')).toBe(6);
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual(['speaker:begin', 'speaker:end']);
    expect(playback.held.mock.calls).toEqual([[true], [false]]);
    expect(events('push_to_talk_used')).toEqual([{ session_id: 'run1', hold_duration_ms: 600, mode: 'push-to-talk' }]);
    clock.advance(300);
    expect(count('speaker:audio')).toBe(6);
  });

  it('cancels a turn that held too little voice', async () => {
    const { runner, clock, log } = setup();
    await runner.start();
    runner.press();
    clock.advance(600);
    runner.release();
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual(['speaker:begin', 'speaker:cancel']);
  });

  it('streams the participant leg whatever the key does', async () => {
    const { runner, clock, count } = setup({ legs: ['speaker', 'participant'] });
    await runner.start();
    clock.advance(300);
    expect(count('participant:audio')).toBe(3);
    expect(count('speaker:audio')).toBe(0);
  });

  it('reports push-to-translate as its own mode', async () => {
    const { runner, clock, events } = setup({ turnMode: 'push-to-translate' });
    await runner.start();
    runner.press();
    clock.advance(100);
    runner.release();
    expect(events('push_to_talk_used')).toEqual([expect.objectContaining({ mode: 'push-to-translate' })]);
  });

  it('ignores the key under automatic turns, and streams everything', async () => {
    const { runner, clock, log, count } = setup({ turnMode: 'auto' });
    await runner.start();
    runner.press();
    clock.advance(300);
    runner.release();
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual([]);
    expect(count('speaker:audio')).toBe(3);
  });

  it('ignores a second press while a turn is held, and a release with no turn', async () => {
    const { runner, clock, log } = setup();
    await runner.start();
    runner.release();
    runner.press();
    runner.press();
    clock.advance(100);
    runner.release();
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual(['speaker:begin', 'speaker:cancel']);
  });

  it('a stop during a hold closes the turn without ending it', async () => {
    const { runner, clock, log, playback } = setup();
    await runner.start();
    runner.press();
    clock.advance(200);
    await runner.stop();
    expect(log.filter((e) => !e.endsWith(':audio'))).toEqual(['speaker:begin']);
    expect(playback.held.mock.calls).toEqual([[true], [false]]);
  });
});

describe('runner — typed text and clearing', () => {
  it('types into the speaker leg while running, and records it', async () => {
    const { runner, log, events } = setup({ turnMode: 'auto' });
    await runner.start();
    runner.sendText('hi');
    expect(log).toContain('speaker:text');
    const texts = runner.conversation.snapshot()[0].segments.map((s) => s.text);
    expect(texts).toEqual(['hi', '«hi»']);
    expect(events('text_input_sent')).toEqual([{ session_id: 'run1', provider: 'fake', text_length: 2 }]);
  });

  it('ignores typed text when no run is live, or the provider takes none', async () => {
    const log: string[] = [];
    const { runner } = setup({ turnMode: 'auto', provider: spyingProvider(log, { textInput: false }), log });
    runner.sendText('early');
    await runner.start();
    runner.sendText('hi');
    expect(log).not.toContain('speaker:text');
  });

  it('clear() empties the conversation and the queued audio, and keeps the run', async () => {
    const { runner, clock, playback } = setup({ turnMode: 'auto' });
    await runner.start();
    clock.advance(5000);
    runner.clear();
    expect(runner.conversation.snapshot()[0].segments.every((s) => !s.final)).toBe(true);
    expect(playback.clear).toHaveBeenCalled();
    expect(runner.state.getState().phase).toBe('running');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/session/runner.turns.test.ts`
Expected: FAIL — no `speaker:begin`, no `push_to_talk_used`, no typed text.

- [ ] **Step 3: Implement**

`src/lib/analytics.ts` — in `AnalyticsEvents`, next to `push_to_talk_used`, declare the event the old path already sends:

```ts
  'text_input_sent': {
    session_id: string;
    provider: string;
    text_length: number;
  };
```

`src/lib/session/run.ts`:

1. `import { Turn } from './turn';`
2. Add the field `private turn: Turn | null = null;`.
3. Replace `send()` with:
   ```ts
  /** The participant leg and automatic turns stream everything; manual turns send only while the key is held. */
  private send(leg: LegName, session: AdapterSession, pcm: Int16Array): void {
    if (this.ending) return;
    if (leg === 'participant' || this.shape.turnMode === 'auto') {
      session.appendAudio(pcm);
      return;
    }
    if (!this.turn?.isOpen) return;
    this.turn.add(pcm);
    session.appendAudio(pcm);
  }
   ```
4. Add the public methods, after `close()`:
   ```ts
  /** A press (D14): opens a turn under manual turns once the run is live. */
  press(): void {
    const session = this.sessions.get('speaker');
    if (this.ending || this.liveSince === null || this.shape.turnMode === 'auto' || !session || this.turn?.isOpen) return;
    this.turn = new Turn(this.deps.clock.now());
    session.beginTurn();
    this.deps.playback.held(true);
  }

  /** A release: the turn's voice decides between ending and cancelling it. */
  release(): void {
    const turn = this.turn;
    const session = this.sessions.get('speaker');
    if (!turn || !session) return;
    const outcome = turn.close();
    if (!outcome) return;
    this.deps.playback.held(false);
    if (outcome === 'end') session.endTurn();
    else session.cancelTurn();
    this.deps.analytics.track('push_to_talk_used', {
      session_id: this.id,
      hold_duration_ms: this.deps.clock.now() - turn.startedAt,
      mode: this.shape.turnMode === 'push-to-translate' ? 'push-to-translate' : 'push-to-talk',
    });
  }

  /** Typed text for the speaker leg, when the provider takes text. */
  sendText(text: string): void {
    const session = this.sessions.get('speaker');
    if (this.ending || this.liveSince === null || !this.shape.provider.textInput || !session) return;
    session.appendText(text);
    this.deps.analytics.track('text_input_sent', { session_id: this.id, provider: this.shape.provider.id, text_length: text.length });
  }
   ```
5. In `close()`, before `this.controller.abort(…)`, close an open turn without asking the adapter (the run is stopping):
   ```ts
    if (this.turn?.close()) this.deps.playback.held(false);
   ```

`src/lib/session/runner.ts` — the three methods forward to the current run:

```ts
    press: () => current?.press(),
    release: () => current?.release(),
    sendText: (text) => current?.sendText(text),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/session`
Expected: PASS — the new file (10) and every earlier one.

- [ ] **Step 5: Typecheck and commit**

Run the typecheck gate; expect exactly the four baseline lines.

```bash
git add src/lib/session src/lib/analytics.ts
git commit -m "feat(session): turns, typed text and clearing on the runner"
```

---

### Task 9: The session hooks

**Files:**
- Test: `src/lib/session/runner.hooks.test.ts`
- Modify (only if a test exposes a gap): `src/lib/session/run.ts`

**Interfaces:**
- Consumes: Task 3's `SessionHooks`; Task 7's runner (which already calls `prepare`, `admit`, `acquire` and `startBoth`).
- Produces: tests pinning each hook's contract with probe providers built on the fake.

Task 7 wrote the hook calls; this task proves them one by one, and fixes `run.ts` where a test shows it wrong. `minimumBalance` is not part of this plan: it needs the wallet, and arrives with the first managed provider (Stage 2).

- [ ] **Step 1: Write the tests**

Create `src/lib/session/runner.hooks.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { AdapterEvents, AdapterSession, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import type { AnyProvider } from '../provider/types';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { createRunner } from './runner';
import type { RunShape, SessionHooks } from './types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function withHooks(session: SessionHooks<unknown, unknown, unknown>, patch: Partial<AnyProvider> = {}): AnyProvider {
  return { ...fakeProvider, ...patch, session } as AnyProvider;
}

function setup(provider: AnyProvider, legs: RunShape['legs'] = ['speaker']) {
  const clock = createVirtualClock(0);
  const sources: FakeSource[] = [];
  const persistIfUnchanged = vi.fn();
  const shape: RunShape = {
    provider,
    settings: FAKE_DEFAULTS,
    credentials: { apiKey: '' },
    pair: { source: 'en', target: 'ja' },
    legs,
    turnMode: 'auto',
    textOnly: false,
    participantSpeech: false,
    keepReplayAudio: true,
    shared: { instructions: () => '', pauses: { sourceSeconds: 1, translationSeconds: 1 } },
    auth: { signedIn: false, getToken: async () => null },
  };
  const runner = createRunner({
    clock,
    platform: 'electron',
    readShape: () => shape,
    ensureReady: async () => ({ state: 'ready', models: [] }),
    persistIfUnchanged,
    openSource: async () => { const s = createFakeSource(clock); sources.push(s); return s; },
    playback: { audio: () => {}, closed: () => {}, held: () => {}, clear: () => {} },
    analytics: { track: () => {} },
    newSessionId: () => 'run1',
    timeoutMs: 1000,
  });
  return { clock, runner, sources, persistIfUnchanged, shape };
}

describe('runner — prepare', () => {
  it("applies prepare's override to this run's build", async () => {
    const { runner, clock } = setup(withHooks({ prepare: async () => ({ override: { script: 'cjk' } }) }));
    await runner.start();
    clock.advance(600);
    expect(runner.conversation.snapshot()[0].segments[0].text).toBe('今日は');
  });

  it("writes prepare's persist patch through persistIfUnchanged, against the run's snapshot", async () => {
    const provider = withHooks({ prepare: async () => ({ persist: { script: 'long' } }) });
    const { runner, persistIfUnchanged, shape } = setup(provider);
    await runner.start();
    expect(persistIfUnchanged).toHaveBeenCalledWith(provider, shape.settings, { script: 'long' });
  });

  it("records prepare's notice on the first leg", async () => {
    const { runner } = setup(withHooks({ prepare: async () => ({ notice: { code: 'voice_fallback', message: 'built-in voice' } }) }));
    await runner.start();
    expect(runner.conversation.snapshot()[0].notices).toEqual([expect.objectContaining({ severity: 'warning', code: 'voice_fallback', message: 'built-in voice' })]);
  });
});

describe('runner — admit', () => {
  it('hands admit the configs actually built, one per leg', async () => {
    const admit = vi.fn(() => true as const);
    const { runner } = setup(withHooks({ admit }), ['speaker', 'participant']);
    await runner.start();
    expect(admit).toHaveBeenCalledWith({ speaker: expect.objectContaining({ script: expect.anything() }), participant: expect.objectContaining({ script: expect.anything() }) });
  });

  it('refuses a start admit refuses, opening nothing', async () => {
    const { runner, sources } = setup(withHooks({ admit: () => ({ refused: 'one leg only' }) }), ['speaker', 'participant']);
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'admit-refused', message: 'one leg only' } } });
    expect(sources).toHaveLength(0);
  });
});

describe('runner — acquire', () => {
  it("gives each leg its own credentials, and releases the lease after the legs have closed", async () => {
    const order: string[] = [];
    const seen: Record<string, unknown> = {};
    const provider = withHooks(
      {
        acquire: async () => ({
          credentials: (leg) => ({ minted: leg }),
          release: async () => { order.push('lease released'); },
        }),
      },
      {
        async start(request: StartRequest<unknown, unknown>, events: AdapterEvents) {
          const leg = request.context.direction.source === 'en' ? 'speaker' : 'participant';
          seen[leg] = request.credentials;
          const inner = await fakeProvider.start(request as StartRequest<never, never>, events);
          return { ...inner, info: inner.info, appendAudio: () => {}, appendText: () => {}, beginTurn: () => {}, endTurn: () => {}, cancelTurn: () => {},
            stop: async () => { order.push(`${leg} closed`); await inner.stop(); } } as AdapterSession;
        },
      },
    );
    const { runner } = setup(provider, ['speaker', 'participant']);
    await runner.start();
    expect(seen).toEqual({ speaker: { minted: 'speaker' }, participant: { minted: 'participant' } });
    await runner.stop();
    expect(order[order.length - 1]).toBe('lease released');
    expect(order.slice(0, 2).sort()).toEqual(['participant closed', 'speaker closed']);
  });

  it("ends the run when the lease ends it, with the lease's message", async () => {
    let endLease!: (message: string) => void;
    const provider = withHooks({
      acquire: async (_shape, _s, ctx) => {
        endLease = ctx.end;
        return { credentials: () => ({}), release: async () => {} };
      },
    });
    const { runner } = setup(provider);
    await runner.start();
    endLease('balance exhausted');
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'lease-ended', notice: { code: 'lease_ended', message: 'balance exhausted' } } });
  });

  it('releases a lease that arrives after the start was cancelled', async () => {
    let grant!: () => void;
    const release = vi.fn(async () => {});
    const provider = withHooks({
      acquire: () => new Promise((resolve) => { grant = () => resolve({ credentials: () => ({}), release }); }),
    });
    const { runner } = setup(provider);
    const starting = runner.start();
    await flush();
    await runner.stop();
    grant();
    await starting;
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('runner — startBoth (D23)', () => {
  it('hands both legs to startBoth at once, each on its own source', async () => {
    const startBoth = vi.fn(async (requests: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>, events: Record<'speaker' | 'participant', AdapterEvents>) => ({
      speaker: await fakeProvider.start(requests.speaker as StartRequest<never, never>, events.speaker),
      participant: await fakeProvider.start(requests.participant as StartRequest<never, never>, events.participant),
    }));
    const { runner, sources, clock } = setup(withHooks({ startBoth }), ['speaker', 'participant']);
    await runner.start();
    expect(startBoth).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(2);
    expect(runner.state.getState()).toMatchObject({ phase: 'running', legs: { speaker: 'live', participant: 'live' } });
    clock.advance(600);
    expect(runner.conversation.snapshot().map((l) => l.segments.length)).toEqual([1, 1]);
  });

  it('opens a single leg the ordinary way', async () => {
    const startBoth = vi.fn();
    const { runner } = setup(withHooks({ startBoth }));
    await runner.start();
    expect(startBoth).not.toHaveBeenCalled();
    expect(runner.state.getState().phase).toBe('running');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/session/runner.hooks.test.ts`
Expected: PASS. If a test fails, the failure shows a gap in Task 7's hook calls: fix `run.ts` (never the test's expectation), re-run, and describe the fix in the report.

- [ ] **Step 3: Typecheck and commit**

Run the typecheck gate; expect exactly the four baseline lines.

```bash
git add src/lib/session
git commit -m "test(session): pin prepare, admit, acquire and startBoth on the runner"
```

---

### Task 10: The turn mode, the stores behind a runner, and a live fake session in the preview

**Files:**
- Create: `src/stores/turnModeStore.ts`
- Create: `src/lib/session/appShape.ts`
- Create: `src/components/dev/SessionControls.tsx`
- Modify: `src/components/dev/SpinePreview.tsx`
- Modify: `src/lib/provider/types.ts` (`SettingsProps` gains `disabled?`)
- Modify: `src/components/providers/ProviderPanel.tsx`, `CredentialForm.tsx`, `LanguagePairSection.tsx`, `src/providers/fake/FakeSettingsView.tsx` (a `disabled` prop)
- Test: `src/stores/turnModeStore.test.ts`, `src/lib/session/appShape.test.ts`, `src/components/dev/SessionControls.test.tsx`, `src/components/providers/ProviderPanel.test.tsx`

**Interfaces:**
- Consumes: everything above; `useSettingsStore` (read-only: `textOnly`, `keepReplayAudio`, `useTemplateMode`, `templateSystemInstructions`, `systemInstructions`, `participantSystemInstructions`, `segmentationSourcePause`, `segmentationTranslationPause`), `useAudioStore` (read-only: `mode: 'speaker' | 'participant' | 'both'`), `useProviderStore`, `presentProviders()`.
- Produces:
  - `useTurnModeStore { turnMode: TurnMode; load(): Promise<void>; setTurnMode(m: TurnMode): void }`, persisted at `settings.common.turnMode`;
  - `legsFor(mode: 'speaker' | 'participant' | 'both'): LegName[]`;
  - `readShapeFromStores(auth: AuthContext): RunShape | null`;
  - `persistIfUnchanged(p, snapshot, patch): void`;
  - `SessionControls({ runner, turnMode })`;
  - `disabled?: boolean` on `ProviderPanel`, `CredentialForm`, `LanguagePairSection` and `SettingsProps`.

D15: the turn mode is one global setting. It is new here under `settings.common.turnMode` (default `'auto'`); plan 1e migrates the six old per-provider `turnDetectionMode` values into it. Spec "What may change during a run": provider, languages, mode and the provider's own settings are locked while a run is not idle, so the panel takes `disabled`.

- [ ] **Step 1: Write the failing tests**

Create `src/stores/turnModeStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { stored, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return { stored, setSetting: vi.fn(async (key: string, value: unknown) => { stored.set(key, value); return { success: true }; }) };
});
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));

import { useTurnModeStore } from './turnModeStore';

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useTurnModeStore.setState({ turnMode: 'auto' });
});

describe('turnModeStore', () => {
  it('starts automatic, and loads what was saved', async () => {
    expect(useTurnModeStore.getState().turnMode).toBe('auto');
    stored.set('settings.common.turnMode', 'push-to-talk');
    await useTurnModeStore.getState().load();
    expect(useTurnModeStore.getState().turnMode).toBe('push-to-talk');
  });

  it('ignores a saved value it does not know', async () => {
    stored.set('settings.common.turnMode', 'Semantic');
    await useTurnModeStore.getState().load();
    expect(useTurnModeStore.getState().turnMode).toBe('auto');
  });

  it('saves a new mode', async () => {
    useTurnModeStore.getState().setTurnMode('push-to-translate');
    expect(useTurnModeStore.getState().turnMode).toBe('push-to-translate');
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.common.turnMode', 'push-to-translate'));
  });
});
```

Create `src/lib/session/appShape.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { useAudioStore } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { legsFor, persistIfUnchanged, readShapeFromStores } from './appShape';

const auth = { signedIn: false, getToken: async () => null };

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null });
  useTurnModeStore.setState({ turnMode: 'auto' });
});

describe('legsFor', () => {
  it('maps the audio mode to the legs, speaker first', () => {
    expect(legsFor('speaker')).toEqual(['speaker']);
    expect(legsFor('participant')).toEqual(['participant']);
    expect(legsFor('both')).toEqual(['speaker', 'participant']);
  });
});

describe('readShapeFromStores', () => {
  it('is null until the chosen provider has loaded', () => {
    expect(readShapeFromStores(auth)).toBeNull();
  });

  it("freezes the chosen provider's settings, credentials and pair with the global settings", () => {
    useProviderStore.setState({
      selected: 'fake',
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'en', target: 'ja' } } },
    });
    useAudioStore.setState({ mode: 'both' });
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    useSettingsStore.setState({ textOnly: true, keepReplayAudio: false, useTemplateMode: false, systemInstructions: 'mine', participantSystemInstructions: '' });
    const shape = readShapeFromStores(auth)!;
    expect(shape).toMatchObject({
      provider: fakeProvider,
      settings: FAKE_DEFAULTS,
      credentials: { apiKey: 'k' },
      pair: { source: 'en', target: 'ja' },
      legs: ['speaker', 'participant'],
      turnMode: 'push-to-talk',
      textOnly: true,
      participantSpeech: false,
      keepReplayAudio: false,
      auth,
    });
    expect(shape.shared.instructions({ source: 'ja', target: 'en' })).toBe('mine');
  });
});

describe('persistIfUnchanged', () => {
  it('writes only the fields the user has not changed since the run froze them', async () => {
    const snapshot = FAKE_DEFAULTS;
    useProviderStore.setState({
      entries: { fake: { settings: { ...FAKE_DEFAULTS, startDelayMs: 900 }, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    persistIfUnchanged(fakeProvider, snapshot, { script: 'long', startDelayMs: 100 });
    expect(useProviderStore.getState().entries.fake.settings).toMatchObject({ script: 'long', startDelayMs: 900 });
  });
});
```

Create `src/components/dev/SessionControls.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createStore } from 'zustand/vanilla';
import { ConversationSet } from '../../lib/session/conversationSet';
import type { Runner } from '../../lib/session/runner';
import type { RunState } from '../../lib/session/types';
import { SessionControls } from './SessionControls';

function fakeRunner(initial: RunState = { phase: 'idle' }) {
  const state = createStore<RunState>(() => initial);
  const runner: Runner = {
    state,
    conversation: new ConversationSet(),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    press: vi.fn(),
    release: vi.fn(),
    sendText: vi.fn(),
    clear: vi.fn(),
  };
  return { runner, state };
}

describe('SessionControls', () => {
  it('starts from idle and stops while running', () => {
    const { runner, state } = fakeRunner();
    render(<SessionControls runner={runner} turnMode="auto" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(runner.start).toHaveBeenCalled();
    act(() => { state.setState({ phase: 'running', since: 0, legs: { speaker: 'live' } }, true); });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(runner.stop).toHaveBeenCalled();
  });

  it('holds a turn with the pointer, releasing on up, leave and cancel', () => {
    const { runner } = fakeRunner({ phase: 'running', since: 0, legs: { speaker: 'live' } });
    render(<SessionControls runner={runner} turnMode="push-to-talk" />);
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(hold);
    fireEvent.pointerUp(hold);
    fireEvent.pointerDown(hold);
    fireEvent.pointerLeave(hold);
    fireEvent.pointerDown(hold);
    fireEvent.pointerCancel(hold);
    expect(runner.press).toHaveBeenCalledTimes(3);
    expect(runner.release).toHaveBeenCalledTimes(3);
  });

  it('offers no hold button under automatic turns', () => {
    const { runner } = fakeRunner({ phase: 'running', since: 0, legs: { speaker: 'live' } });
    render(<SessionControls runner={runner} turnMode="auto" />);
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });

  it('sends typed text and clears', () => {
    const { runner } = fakeRunner({ phase: 'running', since: 0, legs: { speaker: 'live' } });
    render(<SessionControls runner={runner} turnMode="auto" />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(runner.sendText).toHaveBeenCalledWith('hello');
    expect(runner.clear).toHaveBeenCalled();
  });

  it('shows why the last run ended', () => {
    const { runner } = fakeRunner({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'not-ready', message: 'model not downloaded' } } });
    render(<SessionControls runner={runner} turnMode="auto" />);
    expect(screen.getByText(/model not downloaded/)).toBeInTheDocument();
  });
});
```

Append to `src/components/providers/ProviderPanel.test.tsx`:

```tsx
  it('locks every control while disabled', async () => {
    render(<ProviderPanel providers={[fakeProvider]} auth={noAuth} disabled />);
    expect(await screen.findByLabelText('Script')).toBeDisabled();
    expect(screen.getByLabelText('simpleSettings.provider')).toBeDisabled();
    expect(screen.getByLabelText('settings.sourceLanguage')).toBeDisabled();
    expect(screen.getByTitle('simpleSettings.validate')).toBeDisabled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/stores/turnModeStore.test.ts src/lib/session/appShape.test.ts src/components/dev/SessionControls.test.tsx src/components/providers/ProviderPanel.test.tsx`
Expected: FAIL — the new modules do not resolve; `disabled` is not honoured.

- [ ] **Step 3: The turn-mode store**

Create `src/stores/turnModeStore.ts`:

```ts
/**
 * The turn mode: one global setting (D15), since holding a key is the user's
 * habit, not a property of a provider. Plan 1e migrates the old per-provider
 * `turnDetectionMode` values into it.
 */
import { create } from 'zustand';
import type { TurnMode } from '../lib/session/types';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

const KEY = 'settings.common.turnMode';
const MODES: readonly TurnMode[] = ['auto', 'push-to-talk', 'push-to-translate'];

interface TurnModeStore {
  turnMode: TurnMode;
  load(): Promise<void>;
  setTurnMode(turnMode: TurnMode): void;
}

export const useTurnModeStore = create<TurnModeStore>()((set) => ({
  turnMode: 'auto',
  async load() {
    const stored = await ServiceFactory.getSettingsService().getSetting(KEY, 'auto');
    set({ turnMode: MODES.find((m) => m === stored) ?? 'auto' });
  },
  setTurnMode(turnMode) {
    set({ turnMode });
    void persistSetting(KEY, turnMode);
  },
}));
```

- [ ] **Step 4: The stores behind a runner**

Create `src/lib/session/appShape.ts`:

```ts
/**
 * The one place a runner reads the stores (plan 1c-1 Global Constraints):
 * `readShapeFromStores` freezes a shape at start, and `persistIfUnchanged`
 * writes a `prepare` patch back without overwriting a change the user made
 * during the run.
 */
import type { LegName } from '../conversation/types';
import type { AnyProvider, AuthContext } from '../provider/types';
import { presentProviders } from '../../providers/registry';
import { useAudioStore } from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { buildSharedSettings } from './shared';
import type { RunShape } from './types';

export function legsFor(mode: 'speaker' | 'participant' | 'both'): LegName[] {
  return mode === 'both' ? ['speaker', 'participant'] : [mode];
}

export function readShapeFromStores(auth: AuthContext): RunShape | null {
  const { selected, entries } = useProviderStore.getState();
  const providers = presentProviders();
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const entry = provider ? entries[provider.id] : undefined;
  if (!provider || !entry) return null;
  const st = useSettingsStore.getState();
  return {
    provider,
    settings: entry.settings,
    credentials: entry.credentials,
    pair: entry.pair,
    legs: legsFor(useAudioStore.getState().mode),
    turnMode: useTurnModeStore.getState().turnMode,
    textOnly: st.textOnly,
    // The participant-TTS switch arrives with plan 1c-2's routing.
    participantSpeech: false,
    keepReplayAudio: st.keepReplayAudio,
    shared: buildSharedSettings(
      provider,
      entry.settings,
      entry.pair,
      {
        useTemplateMode: st.useTemplateMode,
        templateSystemInstructions: st.templateSystemInstructions,
        systemInstructions: st.systemInstructions,
        participantSystemInstructions: st.participantSystemInstructions,
      },
      { sourceSeconds: st.segmentationSourcePause, translationSeconds: st.segmentationTranslationPause },
    ),
    auth,
  };
}

export function persistIfUnchanged(p: AnyProvider, snapshot: unknown, patch: Readonly<Record<string, unknown>>): void {
  const entry = useProviderStore.getState().entries[p.id];
  if (!entry) return;
  const now = entry.settings as Record<string, unknown>;
  const then = snapshot as Record<string, unknown>;
  const unchanged = Object.fromEntries(Object.entries(patch).filter(([field]) => Object.is(now[field], then[field])));
  if (Object.keys(unchanged).length > 0) useProviderStore.getState().updateSettings(p, unchanged);
}
```

- [ ] **Step 5: `disabled` through the panel**

- `src/lib/provider/types.ts`: `export interface SettingsProps<S> { settings: S; update(patch: Partial<S>): void; /** A run is not idle: the provider's settings are locked. */ disabled?: boolean }`.
- `src/components/providers/CredentialForm.tsx`: prop `disabled?: boolean`; each `input` gets `disabled={disabled}`; the check button's `disabled` becomes `disabled || checking || fields.some((f) => !values[f.key])`.
- `src/components/providers/LanguagePairSection.tsx`: prop `disabled?: boolean`; both selects get `disabled={disabled}`; the swap button's `disabled` becomes `disabled || !reversed`.
- `src/components/providers/ProviderPanel.tsx`: prop `disabled?: boolean`; the provider select gets `disabled={disabled}`; pass `disabled={disabled}` to `CredentialForm`, `LanguagePairSection` and `<Settings … disabled={disabled} />`.
- `src/providers/fake/FakeSettingsView.tsx`: take `disabled` from its props; pass it to the script select and both number inputs as `disabled={disabled}`, and to each `ToggleSwitch` as `disabled={disabled}` (its existing prop).

- [ ] **Step 6: The dev session controls, and the preview**

Create `src/components/dev/SessionControls.tsx`:

```tsx
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import type { Runner } from '../../lib/session/runner';
import type { TurnMode } from '../../lib/session/types';

interface SessionControlsProps {
  runner: Runner;
  turnMode: TurnMode;
}

/**
 * Development builds only: drive a runner by hand and read its conversation
 * raw. The real surfaces (plan 1d) replace this; its copy is not localized.
 */
export function SessionControls({ runner, turnMode }: SessionControlsProps) {
  const state = useStore(runner.state);
  const legs = useSyncExternalStore((l) => runner.conversation.subscribe(l), () => runner.conversation.snapshot());
  const projector = useMemo(() => createProjector(), []);
  const entries = projector.project(legs, DEFAULT_PROJECTION);
  const [text, setText] = useState('');
  const running = state.phase === 'running';
  const segments = new Map(legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const)));

  return (
    <div className="settings-section">
      <h2>Session (dev)</h2>
      <div className="setting-item">
        {state.phase === 'idle' ? (
          <button type="button" className="validate-button" onClick={() => void runner.start()}>Start</button>
        ) : (
          <button type="button" className="validate-button" disabled={state.phase === 'stopping'} onClick={() => void runner.stop()}>Stop</button>
        )}
        <span> {state.phase}{state.phase === 'starting' ? ` (${state.step})` : ''}</span>
        {state.phase === 'idle' && state.lastEnd && (
          <div className="validation-message error">
            {state.lastEnd.reason}{state.lastEnd.notice ? `: ${state.lastEnd.notice.message}` : ''}
          </div>
        )}
      </div>
      {running && turnMode !== 'auto' && (
        <div className="setting-item">
          <button
            type="button"
            className="validate-button"
            onPointerDown={() => runner.press()}
            onPointerUp={() => runner.release()}
            onPointerLeave={() => runner.release()}
            onPointerCancel={() => runner.release()}
          >
            Hold to talk
          </button>
        </div>
      )}
      <div className="setting-item">
        <label className="setting-label" htmlFor="dev-type"><span>Type</span></label>
        <input id="dev-type" className="settings-input" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="validate-button" disabled={!running || !text} onClick={() => { runner.sendText(text); setText(''); }}>Send</button>
        <button type="button" className="validate-button" onClick={() => runner.clear()}>Clear</button>
      </div>
      <ol className="setting-item">
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.kind === 'notice'
              ? `[${entry.severity}] ${entry.message}`
              : `${entry.leg}: ${[...entry.source, ...entry.translation].map((row) => segments.get(row.segmentId)?.text.slice(row.start, row.end) ?? '').join(' | ')}`}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

Modify `src/components/dev/SpinePreview.tsx` so the preview runs a live fake session: a runner created once per page, reading the stores, fed by fake sources, with playback discarded (plan 1c-2 plays it) and analytics forwarded to the app's tracker.

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { useAnalytics } from '../../lib/analytics';
import { useAuth } from '../../lib/auth/hooks';
import { realClock } from '../../lib/contract/clock';
import type { AuthContext } from '../../lib/provider/types';
import { persistIfUnchanged, readShapeFromStores } from '../../lib/session/appShape';
import type { AnalyticsPort } from '../../lib/session/ports';
import { createRunner, type Runner } from '../../lib/session/runner';
import { createFakeSource } from '../../providers/fake/source';
import { presentProviders } from '../../providers/registry';
import { useProviderStore } from '../../stores/providerStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import { getEnvironment } from '../../utils/environment';
import { ProviderPanel } from '../providers/ProviderPanel';
import { SessionControls } from './SessionControls';
import '../Settings/Settings.scss';
import './SpinePreview.scss';

let previewRunner: Runner | null = null;
const bridge: { auth: AuthContext; track: AnalyticsPort['track'] } = {
  auth: { signedIn: false, getToken: async () => null },
  track: () => {},
};

/** One runner per page: the preview's stand-in for the app's, until plan 1c-2 supplies real capture and playback. */
function getPreviewRunner(): Runner {
  previewRunner ??= createRunner({
    clock: realClock,
    platform: getEnvironment(),
    readShape: () => readShapeFromStores(bridge.auth),
    ensureReady: (p, auth) => useProviderStore.getState().refreshReadiness(p, auth),
    persistIfUnchanged,
    openSource: async () => createFakeSource(realClock),
    playback: { audio: () => {}, closed: () => {}, held: () => {}, clear: () => {} },
    analytics: { track: (event, properties) => bridge.track(event, properties) },
    newSessionId: () => crypto.randomUUID(),
  });
  return previewRunner;
}

/**
 * Development builds only: the new provider layer and a live fake session on
 * a page of their own (plans 1b–1d). Open the dev server at `/?preview=spine`;
 * add `&autostart=1` to start a session on load, for headless rendering.
 */
export function SpinePreview() {
  const { isSignedIn, getToken } = useAuth();
  const { trackEvent } = useAnalytics();
  const auth = useMemo(() => ({ signedIn: isSignedIn, getToken }), [isSignedIn, getToken]);
  bridge.auth = auth;
  bridge.track = trackEvent as AnalyticsPort['track'];
  const providers = useMemo(() => presentProviders(), []);
  const runner = getPreviewRunner();
  const phase = useStore(runner.state, (s) => s.phase);
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const entry = useProviderStore((s) => (s.selected ? s.entries[s.selected] : undefined));
  const autostarted = useRef(false);

  useEffect(() => { void useTurnModeStore.getState().load(); }, []);
  useEffect(() => {
    if (autostarted.current || !entry || new URLSearchParams(window.location.search).get('autostart') !== '1') return;
    autostarted.current = true;
    void runner.start();
  }, [entry, runner]);

  return (
    <div className="settings-container spine-preview">
      <div className="settings-body">
        <ProviderPanel providers={providers} auth={auth} disabled={phase !== 'idle'} />
        <SessionControls runner={runner} turnMode={turnMode} />
      </div>
    </div>
  );
}
```

(Keep the existing `SpinePreview.test.tsx` passing: it mocks `useAuth`; add `vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }))` to it if the real hook needs a PostHog context.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/stores/turnModeStore.test.ts src/lib/session src/components/dev src/components/providers src/providers`
Expected: PASS.

- [ ] **Step 8: Run a live fake session and look at it**

Start the dev server without Electron, in the background, and prove the served code is current (plan 1b Task 9's recipe):

```bash
SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort
curl -s -o /dev/null -w '%{http_code}' http://localhost:5199/                     # 200
curl -s http://localhost:5199/src/components/dev/SpinePreview.tsx | grep -c getPreviewRunner   # ≥ 1
```

Screenshot a session that starts on load, after the fake script has played its first exchange:

```bash
OUT="${CLAUDE_JOB_DIR:-/tmp}/spine-preview"; mkdir -p "$OUT"
CHROME=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | tail -1)
"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=450,1600 \
  --virtual-time-budget=12000 --screenshot="$OUT/session-450.png" 'http://localhost:5199/?preview=spine&autostart=1'
```

Open the PNG and look at it. Expected: the provider controls greyed out (disabled while running), a "Session (dev)" section showing a Stop button and `running`, and an ordered list with at least one entry like `speaker: Hello, how are you? | こんにちは、お元気ですか？`. If the list is empty, the page may have rendered before the script played: re-shoot with a larger `--virtual-time-budget` before debugging. Stop the dev server; confirm port 5199 is free. Record the PNG path and what you saw in the report.

- [ ] **Step 9: Run everything, typecheck and commit**

Run: `npx vitest run src` — 0 failed. Run the typecheck gate; exactly the four baseline lines.

```bash
git add src/stores/turnModeStore.ts src/stores/turnModeStore.test.ts src/lib/session src/lib/provider/types.ts \
  src/components/dev src/components/providers src/providers/fake/FakeSettingsView.tsx
git commit -m "feat(session): the global turn mode, the stores behind a runner, and a live fake session in the preview"
```

---

## What this plan leaves to later plans

- **1c-2 — capture and playback:** real sources (microphone, system audio, tab) behind `OpenSource`, with device switching inside them; `ClipQueue`, the sink and the routing table behind `PlaybackPort` (passthrough as a route with its percentage, push-to-translate's inverse route, the participant-TTS switch, replay's own queue, voice preview folded in); the echo monitor's pcm taps; `audio_error` / `audio_device_changed`; the preview's session heard, not only read.
- **1d — the surfaces:** the panel's conversation, the subtitle takeover and the extension overlay reading `runner.state` and `runner.conversation`; `subtitle:turn-press` / `subtitle:turn-release`; localized `lastEnd` notices with settings deep links; the session duration from `since`.
- **1e — the switch-over:** the app's runner singleton replacing `connectConversation` / `disconnectConversation`; `onRunEnded` wired to auto-save; a `keepReplayAudio` change during a run applied to the current legs through `Conversation.setRetention` (spec: it takes effect immediately); `Provider.check` taking the run's signal, so a local engine's check stops on a cancel (today the runner only refuses to go on after it); the Electron close / update handshake (`app:session-busy`, `app:close-requested`) and `pagehide` driven by the phase; the old `turnDetectionMode` values migrated into `settings.common.turnMode`; `translation_count` removed with the old path.
- **Stage 2:** `minimumBalance` and a lease `budget` with the first managed provider; the segmentation tallies on `translation_session_end`.
