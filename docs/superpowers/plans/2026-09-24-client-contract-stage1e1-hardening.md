# Client contract — Stage 1e-1: the runner's and the audio's loose ends

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the roadmap's "1e" items that need no real provider, before LocalInference runs on the spine: every leg's open is awaited before a run unwinds, a synchronous `abandon()` for `pagehide`, one overall bound on stopping, readiness checked from the run's own shape (with the language pair, and cancellable), model-load progress in the run's state, per-leg and redacted analytics, failed notices in words, `keepReplayAudio` live during a run, passthrough only while the run is live, the replay cleared where the conversation is replaced, an idempotent and quieter audio graph that suspends while idle, and the preview's modules out of the release bundle.

**Architecture:** Runner-side changes land in `src/lib/session/` (`run.ts`, `runner.ts`, `stack.ts`, `ports.ts`, `types.ts`, `appShape.ts`); the readiness plumbing in the provider type (`src/lib/provider/types.ts`) and `src/stores/providerStore.ts`; L1's failed code in `src/lib/conversation/Conversation.ts` and its words in `src/lib/view/noticeText.ts` plus the locales; playback's in `src/lib/audio/` (`graph.ts`, `playback.ts`). The preview (`src/components/dev/`) wires what the app will wire in plan 1e-3.

**Tech Stack:** TypeScript (strict), React 18, zustand, Web Audio, i18next, Vitest + @testing-library/react, Vite, headless Chromium over the DevTools protocol.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Session lifecycle" (a run, the resource stack, "Stopping, and closing the window", "What may change during a run"), "Readiness is one check", "Notices reach the user localized", "Analytics", "Playback". The roadmap (`docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`) lists each item under the plan that first needed it, and its "Decided for 1e" section records jiangzhuo's decisions this plan implements: **`check` sees the pair** and a pair change resets readiness; **passthrough starts when the run is live**.

## Global Constraints

- No real provider, no MainPanel: `src/components/MainPanel/**`, `src/components/Subtitle/SubtitleApp.tsx`, `src/services/**`, `electron/**`, `extension/**` are read only. Every change is reachable from the preview (`?preview=spine`) and its tests.
- `src/lib/**` never imports React. Under `src/lib`, stores are read only by `src/lib/session/appShape.ts`, `src/lib/audio/appAudio.ts`, `src/lib/audio/appCapture.ts`, `src/lib/view/appViewSettings.ts`, `src/lib/subtitle/appSession.ts`, `src/lib/transcript/autoSave.ts` and `src/lib/export/appAutoSave.ts`.
- New locale keys only in Task 7 — five `notices.*` keys, added to all 30 locales, translated (`locales.consistency.test.ts` enforces parity; keep each locale's existing notice wording style).
- Record a caught failure with `reportError` / `reportWarning`; never `console.error` / `console.warn`. A per-chunk path reports the ok → failing transition, never each occurrence.
- Gates for every task: `npx vitest run src` shows 0 failed (4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline), and this typecheck gate prints exactly the same **11 lines** it prints at this plan's start (the shell's `grep` is a ugrep wrapper that mis-parses this regex — use `command grep` exactly as written):

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|MainPanel/ExportButton|dev/(SpinePreview|SessionControls|OverlayPreview))|stores/(providerStore|turnModeStore|routingStore)|utils/(environment|conversationExport)|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  The 11 lines: App.tsx TS6133 'React'; SubtitleApp.handleStart.test.tsx TS6133 'provider'; 6× SubtitleBar.test.tsx TS2322 'SessionControl'; analytics.ts TS6133; environment.ts TS2717; environment.ts TS2339. Do not fix them; do not add to them. (Task 9 changes `App.tsx`: its TS6133 line must stay exactly as it is.)
- Commits: conventional, English; every message ends with the implementing model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`. In this worktree the shell refuses compound git commands: run `git add` and `git commit -q -F - <<'EOF' … EOF` as separate calls. Never push.

## Rulings this plan makes

1. **`check(k, s, ctx)`** — the third argument is `{ pair, signal? }`. Readiness is cached per settings, credentials, sign-in and pair; `setPair` forgets it (jiangzhuo's decision). The runner asks readiness **of its shape**, not the live store entry, and can abandon the answer: a stop during `checking` no longer waits for a check that cannot be cancelled.
2. **`abandon()` is not `stop()`.** It fires every remaining release at once, in reverse, without awaiting any, marks the run ended (reason `'user'`), runs no `onRunEnded` (no auto-save on `pagehide`, as today) and sends no end analytics. The adapter rule it relies on — `stop()` closes its socket before its first `await` — is written on `AdapterSession.stop`.
3. **One overall stop bound.** A run that has not finished closing `closeTimeoutMs` (default 15 000) after it began ending is reported and shown idle; its unwind continues in the background, and the next `start()` waits for that unwind (bounded again) before it opens anything, so two runs never hold the microphone at once.
4. **`PlaybackPort.live(on)`**: the runner says when a run is live (every leg up) and when it ended. Playback forwards the original voice to its route only while live (jiangzhuo's decision: passthrough starts when the leg goes live), and suspends its context once it has been quiet — not live, nothing queued, no preview — for `QUIET_MS` (5 000); anything that plays resumes it, as today.
5. **The replay is cleared where the conversation is replaced**: the runner calls `playback.clear()` right before it replaces the conversation at `opening`. A refused start never gets there, so a replay of the kept conversation keeps playing (plan 1c-2's ruling 8 holds).
6. **Failed notices get words both ways**: L1 records a `failed` event without a code as `leg_failed`, and the five API error types (`auth`, `rate_limit`, `network`, `server`, `client`) get words of their own.
7. **Analytics**: `connection_status` carries `channel` (the leg) on every status; `duration_ms` is sent on `disconnected` only and means the session's length. Every string value of every event is redacted once, in the runner's guarded analytics port.
8. **`keepReplayAudio` is live**: the runner reads it from an optional `RunnerDeps.replayAudio` source, applies it to the conversation whenever it changes, and uses its current value when a run creates its legs.
9. **Deferred to plan 1e-3** (they need the app, not the preview): the provider-choice lock during a run and the sign-in auto-switch, loading the stores before the first start, the wedged-`AudioContext` recovery of `ModernAudioPlayer` (#246, before that player is deleted), the sources' own analytics, the recorder warm-up measurement, frames into `logStore`, and the replay gate while the participant leg captures the whole system. A lease that ends before `opening` still has no leg to record its notice on: Stage 2, with the first managed provider.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/lib/session/run.ts` | 1, 2, 4, 5, 6 | leg opens tracked; `abandon()`; readiness from the shape; loading; per-leg analytics |
| `src/lib/session/stack.ts` | 2 | `abandon()` |
| `src/lib/session/runner.ts` | 2, 3, 5, 6, 7, 8 | `abandon()`, the stop bound, loading in state, retention, `live`, clear at replace |
| `src/lib/session/ports.ts`, `types.ts` | 3, 4, 5, 6, 7, 8 | deps and state shapes; analytics redaction |
| `src/lib/contract/adapter.ts` | 2 | the `stop()` rule, in its doc |
| `src/lib/provider/types.ts`, `src/providers/fake/provider.ts` | 4 | `check(k, s, ctx)` |
| `src/stores/providerStore.ts`, `src/lib/session/appShape.ts` | 4 | readiness from given inputs, the pair in its key; `ensureReadyFromStores` |
| `src/lib/analytics.ts` | 6 | `connection_status.channel` |
| `src/lib/conversation/Conversation.ts`, `src/lib/view/noticeText.ts`, `src/locales/*/translation.json` | 7 | failed code default; five notices in words |
| `src/lib/audio/graph.ts`, `playback.ts`, `fakeWebAudio.ts` | 8 | idempotent close, quiet play failures, `suspend()`, `live()` |
| `src/components/dev/SpinePreview.tsx`, `SessionControls.tsx`, `src/App.tsx` | 9 | the preview's wiring; lazy preview modules |

---

### Task 1: Every leg's open is awaited before the run unwinds

**Files:**
- Modify: `src/lib/session/run.ts`
- Test: `src/lib/session/runner.test.ts`

**Interfaces:**
- Produces: nothing new outside `Run`; `close()` now waits for every leg's open still in flight.

Today `close()` waits for `open()`'s own promise. With two legs, `Promise.all` over the legs rejects at the first leg to fail, so `open()` settles while the other leg is still opening: the run unwinds and goes idle, and that leg's source or session is released later, after `stop()` resolved (roadmap, "Carried out of plan 1c-1" → 1e, first item).

- [ ] **Step 1: Write the failing test**

In `src/lib/session/runner.test.ts`, inside `describe('runner — stopping', …)`:

```ts
  it("waits for a leg still opening before it unwinds, so nothing is released after the run went idle", async () => {
    const order: string[] = [];
    let openParticipant!: () => void;
    const quietSource = (leg: string): Source => ({
      onPcm: () => () => {}, onEnded: () => () => {}, onDegraded: () => () => {},
      stop: async () => { order.push(`${leg} source stopped`); },
    });
    const openSource: OpenSource = async (leg) => {
      if (leg === 'participant') await new Promise<void>((resolve) => { openParticipant = resolve; });
      return quietSource(leg);
    };
    const provider = { ...fakeProvider, start: async () => { throw new Error('the speaker leg failed'); } } as unknown as AnyProvider;
    const { runner } = setup({ openSource, shape: { provider, legs: ['speaker', 'participant'] } });
    runner.state.subscribe((s) => { if (s.phase === 'idle') order.push('idle'); });
    const started = runner.start();
    await flush();
    openParticipant();
    await started;
    expect(order).toEqual(['speaker source stopped', 'participant source stopped', 'idle']);
  });
```

(`Source`, `OpenSource` from `./source`; `AnyProvider` from `../provider/types`; `flush` = `() => new Promise((r) => setTimeout(r, 0))` if the file has none — reuse the file's own helper if it has one.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/session/runner.test.ts -t "waits for a leg still opening"`
Expected: FAIL — `'idle'` comes before `'participant source stopped'`.

- [ ] **Step 3: Track every leg's open**

In `src/lib/session/run.ts`:

```ts
  /** Every leg's open still in flight — a source, an adapter's start: `close()` waits for all of them, not just the first to fail. */
  private readonly legOpens: Promise<unknown>[] = [];

  /** Keeps `task` among the opens `close()` waits for. */
  private opened<T>(task: Promise<T>): Promise<T> {
    this.legOpens.push(task);
    return task;
  }
```

In `runOpen()`, wrap each leg's promise: in the `startBoth` branch `shape.legs.map(async (leg) => …)` becomes `shape.legs.map((leg) => this.opened((async () => { … })()))`; in the other branch `shape.legs.map((leg) => this.opened(this.openLeg(leg, requests[leg])))`. `Promise.all` stays over the same promises, so D22 still fails fast.

Replace `awaitOpening()`'s body so it waits, bounded by the one timeout, first for `open()` itself and then for every leg open (after `open()` settles no new one can be added — nothing awaits between `host.step('opening')` and the legs' `Promise.all`):

```ts
  private awaitOpening(): Promise<void> {
    const opening = this.opening;
    if (!opening) return Promise.resolve();
    const all = opening.then(() => undefined, () => undefined).then(() => Promise.allSettled(this.legOpens));
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const cancel = this.deps.clock.setTimeout(finish, this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      void all.then(() => { cancel(); finish(); });
    });
  }
```

Update its doc comment: it waits for `open()` and every leg's open, so a leg still opening when another failed is released before the run unwinds.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/session` — PASS. Then `npx vitest run src` (0 failed) and the typecheck gate (11 lines).

- [ ] **Step 5: Commit**

```bash
git add src/lib/session
git commit -m "fix(session): wait for every leg's open before a run unwinds"
```

---

### Task 2: `abandon()` for `pagehide`

**Files:**
- Modify: `src/lib/session/stack.ts`, `src/lib/session/run.ts`, `src/lib/session/runner.ts`, `src/lib/contract/adapter.ts` (a doc comment)
- Test: `src/lib/session/stack.test.ts`, `src/lib/session/runner.test.ts`

**Interfaces:**
- Produces: `ResourceStack.abandon(): void`; `Run.abandon(): void`; `Runner.abandon(): void`. Task 9 calls `runner.abandon()` on `pagehide`.

- [ ] **Step 1: Write the failing tests**

`src/lib/session/stack.test.ts`:

```ts
  it('abandon fires every release now, last first, without waiting for any', () => {
    const stack = new ResourceStack(createVirtualClock(0), 1000, () => {});
    const calls: string[] = [];
    stack.defer('a', () => { calls.push('a'); });
    stack.defer('b', () => new Promise<void>(() => { calls.push('b'); }));
    stack.defer('c', () => { calls.push('c'); });
    stack.abandon();
    expect(calls).toEqual(['c', 'b', 'a']);
    stack.defer('late', () => { calls.push('late'); });
    expect(calls).toEqual(['c', 'b', 'a', 'late']);
  });
```

`src/lib/session/runner.test.ts`, a new `describe('runner — abandon', …)`:

```ts
  it('closes every leg and source synchronously, goes idle, and saves nothing', async () => {
    const onRunEnded = vi.fn();
    const stops: string[] = [];
    const provider = {
      ...fakeProvider,
      start: async (request: unknown, events: unknown) => {
        const session = await fakeProvider.start(request as never, events as never);
        return { ...session, stop: () => { stops.push('session'); return session.stop(); } };
      },
    } as unknown as AnyProvider;
    const { runner, sources } = setup({ onRunEnded, shape: { provider } });
    await runner.start();
    const stopSource = vi.spyOn(sources[0], 'stop');
    runner.abandon();
    expect(stops).toEqual(['session']);
    expect(stopSource).toHaveBeenCalledTimes(1);
    expect(runner.state.getState()).toEqual({ phase: 'idle', lastEnd: { reason: 'user' } });
    await flush();
    expect(onRunEnded).not.toHaveBeenCalled();
  });

  it('does nothing when idle', () => {
    const { runner } = setup();
    runner.abandon();
    expect(runner.state.getState()).toEqual({ phase: 'idle' });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/session/stack.test.ts src/lib/session/runner.test.ts -t "abandon"`
Expected: FAIL — `abandon` is not a function.

- [ ] **Step 3: Abandon**

`src/lib/session/stack.ts`:

```ts
  /**
   * `pagehide`: fires every remaining release now, last pushed first, without
   * awaiting any — a release that awaits the network must not hold back the
   * ones below it. The stack counts as unwound: a later `defer` runs at once.
   */
  abandon(): void {
    this.unwinding ??= Promise.resolve();
    for (let entry = this.entries.pop(); entry; entry = this.entries.pop()) void this.release(entry);
  }
```

(`defer` already releases at once while `unwinding` is set.)

`src/lib/session/run.ts`:

```ts
  /** `pagehide`: decide nothing more, abort, fire every release now (spec: "Stopping, and closing the window"). */
  abandon(): void {
    this.ending = true;
    this.finished = true;
    this.controller.abort(new Error('the page went away'));
    this.stack.abandon();
  }
```

`src/lib/session/runner.ts`: add to `Runner`

```ts
  /** `pagehide`: closes every leg and source synchronously; no auto-save, no end analytics. Idle: does nothing. */
  abandon(): void;
```

and implement it:

```ts
    abandon: () => {
      const run = current;
      if (!run) return;
      current = null;
      ending = null;
      run.abandon();
      set({ phase: 'idle', lastEnd: { reason: 'user' } });
    },
```

`src/lib/contract/adapter.ts`, on `AdapterSession.stop`'s doc comment, add: "Closes its socket (or ends its pipeline) before its first `await`: on `pagehide` the runner calls `stop()` without awaiting it, and only what ran synchronously is sure to happen."

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/session` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session src/lib/contract/adapter.ts
git commit -m "feat(session): abandon a run synchronously for pagehide"
```

---

### Task 3: One overall bound on stopping

**Files:**
- Modify: `src/lib/session/runner.ts`, `src/lib/session/ports.ts`
- Test: `src/lib/session/runner.test.ts`

**Interfaces:**
- Produces: `RunnerDeps.closeTimeoutMs?: number` (default 15 000).

Each release, the fill-in wait and `onRunEnded` are bounded by `timeoutMs` one at a time, so a stop can take their sum. This bounds the whole ending once; what outlives it keeps unwinding in the background, and the next start waits for it (ruling 3).

- [ ] **Step 1: Write the failing tests**

In `describe('runner — stopping', …)`:

```ts
  it('goes idle when ending overruns closeTimeoutMs, and the next start waits for the unwind still running', async () => {
    let finishStop!: () => void;
    const provider = {
      ...fakeProvider,
      start: async (request: unknown, events: unknown) => {
        const session = await fakeProvider.start(request as never, events as never);
        return { ...session, stop: () => new Promise<void>((resolve) => { finishStop = resolve; }) };
      },
    } as unknown as AnyProvider;
    const { runner, clock, sources } = setup({ shape: { provider }, closeTimeoutMs: 3000, timeoutMs: 10_000 });
    await runner.start();
    const stopped = runner.stop();
    await flush();
    clock.advance(3000);
    await stopped;
    expect(runner.state.getState().phase).toBe('idle');
    const opens = sources.length;
    const next = runner.start();
    await flush();
    expect(sources.length).toBe(opens);
    finishStop();
    await flush();
    await next;
    expect(sources.length).toBe(opens + 1);
  });
```

(`setup` passes `closeTimeoutMs` and `timeoutMs` from its options into `createRunner`: add both to `Options`, `timeoutMs` defaulting to today's 1000.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/session/runner.test.ts -t "overruns closeTimeoutMs"`
Expected: FAIL — `stopped` does not resolve at 3000 (the session's stop waits up to 10 000).

- [ ] **Step 3: The bound**

In `src/lib/session/ports.ts`, on `RunnerDeps`:

```ts
  /** Bounds a whole ending — every release, the fill-in wait, `onRunEnded` — at once; default 15000. What outlives it unwinds in the background. */
  closeTimeoutMs?: number;
```

In `src/lib/session/runner.ts`: keep the whole ending's work as `const work = (async () => { … })()` (today's `try` body: stopping, clear, `run.close()`, end analytics, `onRunEnded`), and race it against `closeTimeoutMs`:

```ts
const DEFAULT_CLOSE_TIMEOUT_MS = 15_000;
  /** An ending that outlived its bound, still unwinding: the next start waits for it. */
  let lingering: Promise<void> | null = null;
```

Inside `end()`, after `work` is created:

```ts
      const overran = await new Promise<boolean>((resolve) => {
        const cancel = deps.clock.setTimeout(() => resolve(true), deps.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS);
        void work.then(() => { cancel(); resolve(false); });
      });
      if (overran) {
        reportWarning('SessionRunner', 'Stopping the session is taking long; it goes on in the background', { dedupeKey: 'close:timeout' });
        // Cleared when it finishes — unless a newer lingering ending replaced it meanwhile.
        const lingerFor: Promise<void> = work.then(() => { if (lingering === lingerFor) lingering = null; });
        lingering = lingerFor;
      }
```

(`work` never rejects: its body keeps today's `try`/`catch`.) The `finally` that sets idle and resolves `done` stays after this race.

At the top of `start()`, after the phase check and before `readShape()`:

```ts
    if (lingering) {
      // The last run is still unwinding past its bound: never open a second one over it.
      if (waitingToStart) return;
      waitingToStart = true;
      try {
        await new Promise<void>((resolve) => {
          const cancel = deps.clock.setTimeout(resolve, deps.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS);
          void lingering!.then(() => { cancel(); resolve(); });
        });
      } finally {
        waitingToStart = false;
      }
      if (state.getState().phase !== 'idle') return;
    }
```

(`let waitingToStart = false;` beside `lingering`: a second start while the first is waiting does nothing, as a second start while `starting` does today.) Add a second test: two `runner.start()` calls while the unwind lingers open exactly one new source once it finishes.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/session` — PASS (the existing stopping tests unchanged). Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session
git commit -m "feat(session): bound a whole stop, and never start over an unwind still running"
```

---

### Task 4: Readiness from the run's shape, with the pair

**Files:**
- Modify: `src/lib/provider/types.ts`, `src/providers/fake/provider.ts`, `src/stores/providerStore.ts`, `src/lib/session/ports.ts`, `src/lib/session/run.ts`, `src/lib/session/appShape.ts`, `src/components/dev/SpinePreview.tsx` (its `ensureReady` line)
- Test: `src/stores/providerStore.test.ts`, `src/lib/session/runner.test.ts`; update the `ensureReady` stubs in `runner.test.ts`, `runner.turns.test.ts`, `runner.hooks.test.ts`

**Interfaces:**
- Produces: `CheckContext { pair: LanguagePair; signal?: AbortSignal }` and `Provider.check(k: K, s: S, ctx: CheckContext)`; `ReadinessInputs { settings: unknown; credentials: Readonly<Record<string, string>>; pair: LanguagePair }` and `ProviderStore.refreshReadiness(p, auth, from?: ReadinessInputs, signal?: AbortSignal)`; `RunnerDeps.ensureReady(shape: RunShape, signal: AbortSignal): Promise<Readiness>`; `ensureReadyFromStores(shape, signal)` in `appShape.ts`. Plan 1e-2's LocalInference `check` reads `ctx.pair`.

- [ ] **Step 1: Write the failing tests**

`src/stores/providerStore.test.ts` (use the file's existing fixture provider and store reset; give the fixture's `check` a `vi.fn` that records its third argument):

```ts
  it('asks check about the pair, and forgets readiness when the pair changes', async () => {
    const check = vi.fn(async () => ({ ok: true as const }));
    const p = { ...fixture, check };
    await useProviderStore.getState().load(p);
    await useProviderStore.getState().refreshReadiness(p, auth);
    expect(check.mock.calls[0][2]).toMatchObject({ pair: useProviderStore.getState().entries[p.id].pair });
    useProviderStore.getState().setPair(p, { source: 'ja', target: 'en' });
    expect(useProviderStore.getState().readiness[p.id]).toEqual({ state: 'unknown' });
  });

  it('checks the inputs it is given — a run's shape — instead of the live entry', async () => {
    const check = vi.fn(async () => ({ ok: true as const }));
    const p = { ...fixture, check };
    await useProviderStore.getState().load(p);
    const from = { settings: { ...p.settings.defaults, marker: 1 }, credentials: {}, pair: { source: 'en', target: 'ja' } };
    await useProviderStore.getState().refreshReadiness(p, auth, from);
    expect(check.mock.calls[0][1]).toBe(from.settings);
    expect(check.mock.calls[0][2]).toMatchObject({ pair: from.pair });
  });
```

(Adapt `fixture`, `auth` and the language codes to what the file already uses; the fixture's languages must offer the pair the test sets.)

`src/lib/session/runner.test.ts`, in `describe('runner — stopping', …)`:

```ts
  it('a stop during checking ends at once, without waiting for the check', async () => {
    const { runner } = setup({ ensureReady: () => new Promise(() => {}) });
    void runner.start();
    await flush();
    expect(runner.state.getState()).toMatchObject({ phase: 'starting', step: 'checking' });
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/stores/providerStore.test.ts src/lib/session/runner.test.ts -t "pair|inputs it is given|during checking"`
Expected: FAIL — no third argument; readiness not reset; the stop waits (it resolves only after `timeoutMs` of virtual time, which the test never advances).

- [ ] **Step 3: The pair and the inputs**

`src/lib/provider/types.ts`:

```ts
/** What a readiness check may consult besides the credentials and settings. */
export interface CheckContext {
  /** The speaker's pair; the participant leg runs its reverse. A local engine's models are per direction. */
  pair: LanguagePair;
  /** Aborted when the start that asked is cancelled. */
  signal?: AbortSignal;
}
```

and `check(k: K, s: S, ctx: CheckContext): Promise<CheckResult>;` with its doc gaining "Readiness is cached per settings, credentials, sign-in and pair."

`src/providers/fake/provider.ts`: `check: async (_k, s, _ctx) => …` (unchanged behaviour).

`src/stores/providerStore.ts`: export

```ts
/** What a readiness check reads: the live entry's by default, or a run's frozen shape. */
export interface ReadinessInputs {
  settings: unknown;
  credentials: Readonly<Record<string, string>>;
  pair: LanguagePair;
}
```

`refreshReadiness(p, auth, from?: ReadinessInputs, signal?: AbortSignal)`: `const inputs = from ?? loaded(p)`; read `settings`, `credentials` and `pair` from `inputs` everywhere the body now reads `entry.*`; the cache key becomes `JSON.stringify([inputs.settings, values, auth.signedIn, inputs.pair])`; call `p.check(credentials, inputs.settings, { pair: inputs.pair, signal })`. `setPair` ends with `forgetReadiness(p);`.

`src/lib/session/ports.ts`:

```ts
  /** Readiness of the run's own shape (settings, credentials, pair), through the shared cache; honours `signal`. */
  ensureReady(shape: RunShape, signal: AbortSignal): Promise<Readiness>;
```

`src/lib/session/run.ts`: `const readiness = await this.untilAborted(deps.ensureReady(shape, this.signal));` with

```ts
  /** `task`, or the abort, whichever comes first: a check that cannot be cancelled no longer holds a stop. */
  private untilAborted<T>(task: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.signal.reason ?? new Error('aborted'));
      if (this.signal.aborted) return onAbort();
      this.signal.addEventListener('abort', onAbort, { once: true });
      task.then(
        (value) => { this.signal.removeEventListener('abort', onAbort); resolve(value); },
        (error) => { this.signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  }
```

`src/lib/session/appShape.ts`:

```ts
/** The runner's `ensureReady` in the app: the shape's own inputs, through the provider store's cache. */
export function ensureReadyFromStores(shape: RunShape, signal: AbortSignal): Promise<Readiness> {
  return useProviderStore.getState().refreshReadiness(
    shape.provider, shape.auth,
    { settings: shape.settings, credentials: shape.credentials, pair: shape.pair },
    signal,
  );
}
```

`src/components/dev/SpinePreview.tsx`: `ensureReady: ensureReadyFromStores,`. In the three runner test files, every `ensureReady` stub takes `(shape, signal)` (most ignore both).

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/stores src/lib/session src/providers src/components/dev src/components/providers` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provider src/providers/fake src/stores/providerStore.ts src/stores/providerStore.test.ts src/lib/session src/components/dev/SpinePreview.tsx
git commit -m "feat(session): readiness from the run's shape, with the pair, and cancellable"
```

---
### Task 5: Model-load progress in the run's state

**Files:**
- Modify: `src/lib/session/types.ts`, `src/lib/session/run.ts`, `src/lib/session/runner.ts`
- Test: `src/lib/session/runner.test.ts`

**Interfaces:**
- Produces: `LoadingProgress { leg: LegName; stage: string; done: number; total: number }`; `RunState`'s starting variant gains `loading?: LoadingProgress`; `RunHost.loading(leg, progress)`. Task 9's `SessionControls` and plan 1e-3's surfaces read it.

A local engine loads its models inside `start()`, and reports it through `loading` events; the runner drops them today (roadmap, "Carried out of plan 1c-1" → 1e).

- [ ] **Step 1: Write the failing test**

In `describe('runner — starting', …)`:

```ts
  it('shows a leg loading its models while it opens', async () => {
    let open!: () => void;
    const provider = {
      ...fakeProvider,
      start: async (request: unknown, events: AdapterEvents) => {
        events.loading({ stage: 'asr', done: 1, total: 3 });
        await new Promise<void>((resolve) => { open = resolve; });
        return fakeProvider.start(request as never, events);
      },
    } as unknown as AnyProvider;
    const { runner } = setup({ shape: { provider } });
    const started = runner.start();
    await flush();
    expect(runner.state.getState()).toEqual({ phase: 'starting', step: 'opening', loading: { leg: 'speaker', stage: 'asr', done: 1, total: 3 } });
    open();
    await started;
    expect(runner.state.getState().phase).toBe('running');
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/session/runner.test.ts -t "loading its models"`
Expected: FAIL — the state has no `loading`.

- [ ] **Step 3: Route `loading` into the state**

`src/lib/session/types.ts`:

```ts
/** A leg loading its models while it opens: the `loading` event, as the starting surfaces show it. */
export interface LoadingProgress {
  leg: LegName;
  stage: string;
  done: number;
  total: number;
}
```

and the starting variant becomes `{ phase: 'starting'; step: 'checking' | 'preparing' | 'opening'; loading?: LoadingProgress }`.

`src/lib/session/run.ts`: `RunHost` gains `loading(leg: LegName, progress: Omit<LoadingProgress, 'leg'>): void;` and `onEvent`'s switch a case (after the `ending` check, like the others):

```ts
      case 'loading':
        this.host.loading(leg, event.payload);
        return;
```

`src/lib/session/runner.ts`, in `hostFor`:

```ts
    loading: (leg, progress) => {
      const now = state.getState();
      if (run === current && now.phase === 'starting') set({ ...now, loading: { leg, ...progress } });
    },
```

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/session src/lib/subtitle` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session
git commit -m "feat(session): a leg's model loading in the starting state"
```

---

### Task 6: Analytics per leg, and redacted at the port

**Files:**
- Modify: `src/lib/analytics.ts` (`connection_status`), `src/lib/session/run.ts`, `src/lib/session/runner.ts`, `src/lib/session/ports.ts`
- Test: `src/lib/session/runner.test.ts`, `src/lib/session/ports.test.ts` (create it if it does not exist)

**Interfaces:**
- Produces: `AnalyticsEvents['connection_status'].channel?: 'speaker' | 'participant'`.

- [ ] **Step 1: Write the failing tests**

`src/lib/session/runner.test.ts`, in `describe('runner — stopping', …)`:

```ts
  it('reports connected and disconnected once per leg, each with its channel and the session length', async () => {
    const { runner, clock, events } = setup({ shape: { legs: ['speaker', 'participant'] } });
    await runner.start();
    clock.advance(4000);
    await runner.stop();
    expect(events('connection_status')).toEqual([
      { status: 'connected', provider: 'fake', channel: 'speaker' },
      { status: 'connected', provider: 'fake', channel: 'participant' },
      { status: 'disconnected', provider: 'fake', channel: 'speaker', duration_ms: 4000 },
      { status: 'disconnected', provider: 'fake', channel: 'participant', duration_ms: 4000 },
    ]);
  });
```

(If the two `connected` events can arrive in either order, compare with `expect.arrayContaining` for those two and keep the `disconnected` pair in leg order.)

`src/lib/session/ports.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { guardPorts, type RunnerDeps } from './ports';

describe('guardPorts — analytics', () => {
  it('redacts every string value before the port sees it', () => {
    const track = vi.fn();
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    const deps = { playback: { audio() {}, held() {}, clear() {}, live() {} }, analytics: { track } } as unknown as RunnerDeps;
    guardPorts(deps).analytics.track('error_occurred', { error_type: 'x', error_message: `failed with ${secret}`, severity: 'high', recoverable: true });
    const sent = track.mock.calls[0][1] as { error_message: string };
    expect(sent.error_message).not.toContain(secret);
    expect(sent.error_message).toContain('failed with');
  });
});
```

(Check the secret against `src/lib/diagnostics/redact.ts`'s patterns: pick one it certainly redacts. `live()` is Task 8's port method; with Task 8 not done yet, the cast keeps this compiling.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/session/runner.test.ts src/lib/session/ports.test.ts -t "channel|redacts"`
Expected: FAIL — no `channel`; the secret reaches the port.

- [ ] **Step 3: Per leg, and redacted**

`src/lib/analytics.ts`, `connection_status`:

```ts
  'connection_status': {
    status: 'connected' | 'disconnected' | 'reconnecting';
    provider: string;
    /** On `disconnected` only: the session's length. */
    duration_ms?: number;
    /** The leg; absent in events from before the session runner. */
    channel?: 'speaker' | 'participant';
  };
```

`src/lib/session/run.ts`: `connect()` tracks `{ status: 'connected', provider: …, channel: leg }`; the `reconnecting` case `{ status: 'reconnecting', provider, channel: leg }`.

`src/lib/session/runner.ts`, `end()`: `run.shape.legs.forEach((leg) => deps.analytics.track('connection_status', { status: 'disconnected', provider, duration_ms: duration, channel: leg }));`

`src/lib/session/ports.ts` (import `redact` from `../diagnostics/redact`):

```ts
/** Every string value — and every string in an array value — through `redact`: an event never carries a secret, whoever built it. */
function redactValues<T extends object>(properties: T): T {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
    key,
    typeof value === 'string' ? redact(value)
      : Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? redact(item) : item))
        : value,
  ])) as T;
}
```

and the guarded analytics port calls `analytics.track(event, redactValues(properties))`.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/session src/lib/analytics` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.ts src/lib/session
git commit -m "feat(session): per-leg connection analytics, every value redacted at the port"
```

---

### Task 7: Failed notices in words, and `keepReplayAudio` live

**Files:**
- Modify: `src/lib/conversation/Conversation.ts`, `src/lib/view/noticeText.ts`, the 30 `src/locales/<code>/translation.json`, `src/lib/session/ports.ts`, `src/lib/session/run.ts`, `src/lib/session/runner.ts`, `src/lib/session/appShape.ts`
- Test: `src/lib/conversation/Conversation.test.ts`, `src/lib/view/noticeText.test.ts`, `src/lib/session/runner.test.ts`

**Interfaces:**
- Produces: `RunnerDeps.replayAudio?: { get(): boolean; subscribe(listener: () => void): () => void }`; `retentionFor(keep: boolean): Retention` in `run.ts`; `appReplayAudio` in `appShape.ts` (Task 9 wires it into the preview).

- [ ] **Step 1: Write the failing tests**

`src/lib/conversation/Conversation.test.ts` (with the file's own helpers for a conversation and its events):

```ts
  it('records a failure without a code as leg_failed, so it has words', () => {
    const c = conversation();
    c.apply({ kind: 'failed', payload: { message: 'socket closed' } });
    expect(c.snapshot().notices.at(-1)).toMatchObject({ severity: 'error', code: 'leg_failed', message: 'socket closed' });
  });
```

`src/lib/view/noticeText.test.ts`:

```ts
  it('puts the five API error types into words', () => {
    for (const code of ['auth', 'rate_limit', 'network', 'server', 'client']) {
      expect(NOTICE_WORDS[code]).toBeDefined();
      expect(noticeText(t, { code, message: 'HTTP 401' })).toContain('HTTP 401');
    }
  });
```

(`t` is the file's own i18n stand-in; `{{detail}}` carries the message.)

`src/lib/session/runner.test.ts`, in `describe('runner — the conversation', …)`:

```ts
  it('applies keepReplayAudio during a run, and a new run takes its current value', async () => {
    let keep = true;
    const listeners = new Set<() => void>();
    const replayAudio = { get: () => keep, subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); } };
    const { runner, clock } = setup({ replayAudio, shape: { keepReplayAudio: false } });
    await runner.start();
    clock.advance(5000);
    const speech = () => runner.conversation.snapshot()[0].segments.flatMap((s) => s.speech);
    expect(speech().some((s) => s.pcm.length > 0)).toBe(true);
    keep = false;
    listeners.forEach((l) => l());
    expect(speech().every((s) => s.pcm.length === 0)).toBe(true);
  });
```

(`setup` passes `replayAudio` through to `createRunner`: add it to `Options`. The shape says `false` and the source says `true`: the run takes the source's current value.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/conversation src/lib/view/noticeText.test.ts src/lib/session/runner.test.ts -t "leg_failed|five API|keepReplayAudio during"`
Expected: FAIL.

- [ ] **Step 3: The code, the words, the retention**

`src/lib/conversation/Conversation.ts`, the `failed` case: `code: event.payload.code ?? 'leg_failed'`. Existing tests that expected `code: undefined` for a failure without a code now expect `'leg_failed'`.

`src/lib/view/noticeText.ts`, `NOTICE_WORDS` gains, under a comment `// A failed leg's API error type (the adapter's code).`:

```ts
  auth: 'The provider did not accept the credentials: {{detail}}',
  rate_limit: 'The provider is limiting requests; try again shortly: {{detail}}',
  network: 'The connection to the provider failed: {{detail}}',
  server: 'The provider had a problem: {{detail}}',
  client: 'The provider rejected the request: {{detail}}',
```

Add the same five under `notices` in `src/locales/en/translation.json`, word for word, and translated into the other 29 locales (keep `{{detail}}`; follow each locale's existing `notices.*` wording). Insert lines; do not re-serialize a file.

`src/lib/session/ports.ts`, on `RunnerDeps`:

```ts
  /** `keepReplayAudio`, live (spec: "What may change during a run"); absent, the shape's value holds for the run. */
  replayAudio?: { get(): boolean; subscribe(listener: () => void): () => void };
```

`src/lib/session/run.ts`:

```ts
/** The retention a `keepReplayAudio` value means. */
export function retentionFor(keep: boolean): Retention {
  return keep ? DEFAULT_RETENTION : { keepPcm: false, maxPcmBytes: 0 };
}
```

and the legs are created with `retention: retentionFor(deps.replayAudio?.get() ?? shape.keepReplayAudio)`.

`src/lib/session/runner.ts`, after `conversation` is created:

```ts
  // `keepReplayAudio` takes effect at once: the kept conversation and a live run alike. The runner lives as long as the page.
  deps.replayAudio?.subscribe(() => {
    const retention = retentionFor(deps.replayAudio!.get());
    for (const leg of ['speaker', 'participant'] as const) conversation.get(leg)?.setRetention(retention);
  });
```

`src/lib/session/appShape.ts`:

```ts
/** `keepReplayAudio`, live from the settings store: the runner's `replayAudio`. */
export const appReplayAudio = {
  get: () => useSettingsStore.getState().keepReplayAudio,
  subscribe: (listener: () => void) => useSettingsStore.subscribe((now, before) => {
    if (now.keepReplayAudio !== before.keepReplayAudio) listener();
  }),
};
```

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/conversation src/lib/view src/lib/session src/locales` — PASS (the locale parity suite included). Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversation src/lib/view src/locales src/lib/session
git commit -m "feat(session): failed notices in words; keepReplayAudio applies during a run"
```

---

### Task 8: Playback: live, cleared at replace, idempotent, quiet, resting

**Files:**
- Modify: `src/lib/session/ports.ts`, `src/lib/session/runner.ts`, `src/lib/audio/graph.ts`, `src/lib/audio/playback.ts`, `src/lib/audio/fakeWebAudio.ts`
- Test: `src/lib/session/runner.test.ts`, `src/lib/audio/graph.test.ts`, `src/lib/audio/playback.test.ts`; add `live: vi.fn()` to every playback stub the session tests build

**Interfaces:**
- Produces: `PlaybackPort.live(on: boolean): void`; `AudioGraph.suspend(): Promise<void>`; `createPlayback(graph, routing, clock?)` with `QUIET_MS` (5000) exported from `playback.ts`. Task 9 wires `live` into the preview's bridge.

- [ ] **Step 1: Write the failing tests**

`src/lib/session/runner.test.ts`:

```ts
  it('tells playback when the run is live and when it ended, and clears the replay where the conversation is replaced', async () => {
    const { runner, playback } = setup();
    await runner.start();
    expect(playback.clear).toHaveBeenCalledTimes(1);
    expect(playback.live.mock.calls).toEqual([[true]]);
    await runner.stop();
    expect(playback.live.mock.calls).toEqual([[true], [false]]);
  });

  it('a refused start clears nothing: the replay of the kept conversation plays on', async () => {
    const { runner, playback } = setup({ ready: { state: 'not-ready', reason: 'no' } });
    await runner.start();
    expect(playback.clear).not.toHaveBeenCalled();
  });
```

(`setup`'s playback stub gains `live: vi.fn()`.)

`src/lib/audio/playback.test.ts` (on the file's fake graph or `fakeWebAudio`, with a virtual clock passed to `createPlayback`):

```ts
  it('forwards the original voice only while the run is live', () => {
    const { playback, passthroughPlayed } = build();
    playback.passthrough(chunk());
    playback.live(true);
    playback.passthrough(chunk());
    playback.live(false);
    playback.passthrough(chunk());
    expect(passthroughPlayed()).toBe(1);
  });

  it('suspends the graph once quiet for QUIET_MS, never while live or while something is queued', async () => {
    const { playback, graph, clock } = build();
    playback.live(true);
    clock.advance(QUIET_MS);
    expect(graph.suspended).toBe(0);
    playback.live(false);
    playback.audio('speaker', 1, pcmOf(24_000));
    clock.advance(QUIET_MS);
    expect(graph.suspended).toBe(0);
    playback.clear();
    clock.advance(QUIET_MS);
    expect(graph.suspended).toBe(1);
  });

  it('disposes once', async () => {
    const { playback, graph } = build();
    await Promise.all([playback.dispose(), playback.dispose()]);
    expect(graph.closed).toBe(1);
  });
```

(`build()` is the file's harness, extended to count `suspend()` and `close()` calls and passthrough clips played; name the counters to fit it.)

`src/lib/audio/graph.test.ts`:

```ts
  it('closes once, however often it is asked', async () => {
    const { graph, context } = await buildGraph();
    await Promise.all([graph.close(), graph.close()]);
    expect(context.closed).toBe(1);
  });

  it('reports an output that will not start once per failing streak, not per chunk', async () => {
    const { graph, elements } = await buildGraph();
    elements.real.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    await graph.resume();
    await graph.resume();
    await graph.resume();
    expect(warnings('graph:play:real')).toBe(1);
  });
```

(`buildGraph`, `elements`, `warnings` stand for the file's own harness: however it builds a graph over `fakeWebAudio` and observes `reportWarning` — spy on it if nothing does yet. The fake `AudioContext` must reject a second `close()` like a real one, and count `suspend()` / `close()` calls.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/session/runner.test.ts src/lib/audio -t "live|refused start clears|QUIET_MS|disposes once|closes once|failing streak|original voice"`
Expected: FAIL.

- [ ] **Step 3: The port**

`src/lib/session/ports.ts`, `PlaybackPort`:

```ts
  /** A run went live (every leg up), or ended: the original voice reaches its route only while live, and playback may rest once not. */
  live(on: boolean): void;
```

and `guardPorts` guards it: `live: guard('playback.live', (on: boolean) => playback.live(on)),`.

`src/lib/session/runner.ts`: after `set({ phase: 'running', … })` in `start()`, `deps.playback.live(true);`. In `end()`, beside `deps.playback.clear()` (and regardless of `refused`): `deps.playback.live(false);`. In `abandon()`: `deps.playback.live(false);`. In `hostFor`: `conversations: (map, info) => { deps.playback.clear(); conversation.replace(map, info); },` — the replay of the last conversation stops where that conversation goes (refs restart per run, so its clip keys would alias the new run's segments).

- [ ] **Step 4: The graph**

`src/lib/audio/graph.ts`:
- `AudioGraph` gains `/** Pauses rendering while nothing plays; `resume()` undoes it. */ suspend(): Promise<void>;`, implemented as `if (ctx.state === 'running') await ctx.suspend()` inside a `try` that reports a failure with `reportWarning('AudioGraph', …, { dedupeKey: 'graph:suspend' })`.
- `close()` runs once: `let closing: Promise<void> | null = null;` and `close() { closing ??= (async () => { …today's body… })(); return closing; }`.
- An output that will not start is reported once per failing streak: `const playFailing: Partial<Record<Bus, boolean>> = {};` — `element.play().then(() => { playFailing[bus] = false; }, (error) => { if AbortError → return (as today); if (!playFailing[bus]) reportWarning(…today's message…); playFailing[bus] = true; })`. `resume()`'s `ctx.resume()` failure the same way, with its own `resumeFailing` flag.

`src/lib/audio/fakeWebAudio.ts`: the fake context counts `suspend()` (state → `'suspended'`) and `close()`, and a second `close()` rejects with `InvalidStateError`, as a real context does.

- [ ] **Step 5: Playback**

`src/lib/audio/playback.ts`:

```ts
/** How long playback must be quiet — no run live, nothing queued, no preview — before its context rests. */
export const QUIET_MS = 5_000;
```

`createPlayback(graph, routing, clock: Pick<Clock, 'setTimeout'> = realClock)`; inside:

```ts
  let live = false;
  let rest: (() => void) | null = null;
  const quiet = () => !live && current === null
    && queues.speaker.pending === 0 && queues.participant.pending === 0 && replayQueue.pending === 0;
  /** Rests the graph once it has stayed quiet for QUIET_MS; anything that plays resumes it. */
  const restLater = () => {
    rest?.();
    rest = clock.setTimeout(() => {
      rest = null;
      if (quiet()) void graph.suspend();
    }, QUIET_MS);
  };
```

(rename today's `live` record of queues to `queues` so the flag can be `live`.) Subscribe to all three queues — `if (quiet()) restLater()` on each change — keep the unsubscribes for `dispose()`; call `restLater()` once at creation, in `live(false)`, and when a preview ends. `passthrough(pcm)` returns at once unless `live`. `live(on)` sets the flag and, when `false`, drops the passthrough stream (`passthroughStream.clear()`) and calls `restLater()`. `dispose()` runs once (`let disposing: Promise<void> | null`), cancels `rest`, unsubscribes the queues, then does today's body.

- [ ] **Step 6: Stubs, tests, gates**

Every playback stub under `src/lib/session/*.test.ts`, `src/lib/subtitle/*.test.ts` and `src/components/dev/*.test.tsx` gains `live`. Run: `npx vitest run src/lib/audio src/lib/session src/lib/subtitle src/components/dev` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 7: Commit**

```bash
git add src/lib/session src/lib/audio src/lib/subtitle src/components/dev
git commit -m "feat(audio): passthrough only while live; rest when quiet; close once; quiet play failures"
```

---

### Task 9: The preview's wiring, and the preview out of the release bundle

**Files:**
- Modify: `src/components/dev/SpinePreview.tsx`, `src/components/dev/SessionControls.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `runner.abandon()` (Task 2), `ensureReadyFromStores` (Task 4), `RunState.loading` (Task 5), `appReplayAudio` (Task 7), `PlaybackPort.live` (Task 8).

- [ ] **Step 1: The preview**

`src/components/dev/SpinePreview.tsx`:
- `createRunner({ …, ensureReady: ensureReadyFromStores, replayAudio: appReplayAudio, … })` (Task 4 already switched `ensureReady`; check).
- `playbackBridge` gains `live: (on) => bridge.playback?.live(on),`.
- In `SpinePreview`, an effect that abandons the run when the page goes away:

```ts
  // `pagehide` (a reload, the tab closing): close every leg and capture now; nothing is saved, as in the app.
  useEffect(() => {
    const onPageHide = () => runner.abandon();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [runner]);
```

`src/components/dev/SessionControls.tsx`: the phase line shows the loading progress while starting — `{state.phase === 'starting' ? ` (${state.step}${state.loading ? `: ${state.loading.leg} ${state.loading.stage} ${state.loading.done}/${state.loading.total}` : ''})` : ''}` — and the comment on `keepReplayAudio` now says it applies at once (Task 7), not from the next Start.

- [ ] **Step 2: The preview out of the release bundle**

`src/App.tsx`: replace the static imports of `SpinePreview` and `OverlayPreview` with lazy ones defined only in development builds, so a release build tree-shakes the import itself (a top-level `lazy()` would keep the chunk):

```tsx
// Development builds only: in a release build the condition is false at build time and both imports go.
const SpinePreview = import.meta.env.DEV ? lazy(() => import('./components/dev/SpinePreview').then((m) => ({ default: m.SpinePreview }))) : null;
const OverlayPreview = import.meta.env.DEV ? lazy(() => import('./components/dev/OverlayPreview').then((m) => ({ default: m.OverlayPreview }))) : null;
```

and render each inside `<Suspense fallback={null}>` in its existing DEV branch (`SpinePreview && …`). Import `lazy` and `Suspense` from `react` by name; leave the existing `import React …` line exactly as it is (its TS6133 is in the gate's baseline).

Check it: `npm run build`, then `command grep -rl "spine-preview\|spine-conversation\|Session (dev)" build/assets | head` prints nothing (class names and copy only the preview carries; component names are minified away, so they prove nothing). (If `npm run build` needs Electron or signing environment it does not have here, use `npx vite build` — the renderer bundle is what matters.)

- [ ] **Step 3: The headless checks still pass**

```
SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # background; restart it if the page does not show your edits
node scripts/dev/spine-surface-probe.mjs
node scripts/dev/spine-subtitle-probe.mjs
node scripts/dev/spine-audio-probe.mjs
node scripts/dev/spine-export-probe.mjs http://localhost:5199
```

Each must end with its ok line (read each probe's header for its default URL and pass arguments). Stop the dev server you started.

- [ ] **Step 4: The gates**

`npx vitest run src` (0 failed) and the typecheck gate (11 lines, `App.tsx`'s TS6133 unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/dev src/App.tsx
git commit -m "feat(dev): the preview abandons on pagehide and shows loading; preview modules out of the release bundle"
```
