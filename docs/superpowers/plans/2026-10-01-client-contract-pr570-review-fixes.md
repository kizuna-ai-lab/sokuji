# Two Review Fixes Before #570 Merges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two defects left open on kizuna-ai-lab/sokuji#570 before it merges: output-device switches that race on one audio element, and a setup wizard that records itself complete before the provider settings it chose have reached storage.

**Architecture:** The audio graph queues device switches per bus. Each element has one `setSinkId` in flight at a time. A switch that a newer request overtook before its turn is skipped, and so is a switch still queued at `close()`. A stale switch's outcome, success or failure, does not touch the bus's bookkeeping or pause its element. A switch that never settles holds the next one for `SINK_SWITCH_DEADLINE_MS` at most. The provider store routes every write through one helper, which tracks the writes in flight and the last value per key that did not land. A new `flush(p?)` writes those values again, waits for every write, and answers for the keys of `p` and the selection. The wizard awaits `flush(p)` before it records setup complete.

**Tech Stack:** TypeScript, Zustand, Vitest (jsdom), the Web Audio fakes in `src/lib/audio/fakeWebAudio.ts`.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` (binding for the stores and the graph). The defects are the two unresolved review threads on #570 (`src/lib/audio/graph.ts:462`, `src/components/SetupWizard/useApplySetup.ts:36`). The owner chose to fix them before merging (2026-10-01).

**Revision 1** (2026-10-01, after the plan's review: Ready after fixes, 0 Critical / 2 Important / 7 Minor / 5 Nit, `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/pr570-fixes/plan-review.md`):
- A switch that never settles no longer holds its bus for the page's lifetime: each turn is bounded (choice 1).
- `flush` answers for the wizard's provider and the selection only (choice 2).
- The store tests' typing is fixed.
- No test hangs under a mutant: held writes and pending switches are released before any assertion.
- Every expected red and every mutant's named failures match the review's replay.
- A case for a retry refused again is added.
- The comments cite no plan.

## Global Constraints

- Branch `worktree-client-contract-stage2` (PR #571, stacked on #570), base `7022af45`. Worktree: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/research-asr-punctuation`. Never push, never merge.
- Production comments explain the behaviour. They cite rulings, choices or issue numbers only, never a review, a finding, a thread, a task or a plan.
- No one-time migration code. No stored value is rewritten except by a write the user's own action started; a retried write writes the user's latest value for its key, nothing else.
- Failures are recorded through `persistSetting` / `reportWarning` as today (CLAUDE.md "Error Handling"). No new `console.*` in `src/stores` or `src/lib` (`consoleLedger.consistency.test.ts`).
- TDD: each new test is run red against the code before the fix, then green after it; the one stated pin is the exception.
- A test never asserts while something it holds (a write, a device switch) is still held. Release first, assert after, so a regression fails instead of hanging.
- Gates (each task):
  - `npx vitest run src`: 0 failed, no unhandled errors.
  - `npx vitest run electron`: 34 files, 477 tests.
  - `npx vitest run extension`: 9 files, 56 tests.
  - `npx tsc --noEmit -p tsconfig.json > /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/pr570-fixes/tNN.txt`, then `python3 /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-tools/tscdiff.py <previous> <this>` → `new 0`.
  - `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh | diff - /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/deletion-gate-baseline.txt` prints nothing.
- Baseline at `7022af45`: `npx vitest run src` gives 532 files passed and 1 skipped, and 6 661 tests passed and 2 skipped. The full tree's tsc reports 95 errors. The pre-flight writes the base's tsc output to `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/pr570-fixes/t00.txt`.
- Shell and commits:
  - zsh, single commands (`&&`, `;` and loops are refused); `command grep`.
  - Commits with explicit pathspecs: `git add -- <files>`, then `git commit -q -F - -- <files> <<'EOF' … EOF`.
  - The message ends with `Co-Authored-By: <model> <noreply@anthropic.com>`, where `<model>` is the executing model's name, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`.
  - On `.git/index.lock`, wait and retry; never delete it.

## Review Focus

1. **Several output device picks in a row, the first switch still pending:** the element ends on the last pick, and no two `setSinkId` calls on one element overlap — Task 1's first test.
2. **A device unplugged while a newer pick is pending (the older switch rejects):** the newer pick lands and plays. The stale failure neither pauses the meeting output nor makes a later identical request look new — Task 1's second test.
3. **A device switch that never settles** (a vanished Bluetooth or USB sink): it holds the bus only until the deadline, and a newer pick then lands — Task 1's fifth test.
4. **The session or page closing during a pending switch:** nothing queued reaches the element after `close()`, and a switch that lands after it does not start the element again — Task 1's fourth test.
5. **Finish when storage is slow, refuses a write, recovers on a retry, or refuses another provider's value:**
   - The setup record is written only after the provider's settings landed.
   - A refused write fails Finish with "Could not save your setup" and records nothing.
   - Finish again writes what did not land, a language pair already in memory included, and then records.
   - Another provider's refused value does not fail it.
   - Task 2's tests.

---

## File Structure

- `src/lib/audio/graph.ts` — modify: `SINK_SWITCH_DEADLINE_MS`; a per-bus switch queue beside the graph's other bounded waits; `setSinks` hands each bus's switch to it; the comments that describe it.
- `src/lib/audio/graph.test.ts` — modify: four cases in `describe('createAudioGraph — outputs')`, one in `describe('createAudioGraph — a wedged context (#246)')`.
- `src/stores/providerStore.ts` — modify: one `write()` helper replaces the five `void persistSetting(…)` calls; `flush(p?)` on the interface and the store.
- `src/stores/providerStore.test.ts` — modify: a `describe('flush')` block.
- `src/components/SetupWizard/useApplySetup.ts` — modify: `applyProvider` awaits `store.flush(p)` and throws `SetupPersistError` when a write did not land.
- `src/components/SetupWizard/useApplySetup.test.ts` — modify: a drain after each case, three cases.
- `src/components/SetupWizard/applySetup.ts`, `src/stores/setupStore.ts` — modify: one doc line each, for the error `applyProvider` now rejects with.
- `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — modify (Task 3, controller): the record.

---

### Task 1: One device switch at a time per bus

**Files:**
- Modify: `src/lib/audio/graph.ts`:
  - the constant after `CLOSE_WAIT_MS` (`:95`);
  - the interface comment of `setSinks` (`:65`);
  - the `requested` / `applied` comment (`:192-196`);
  - the queue after `let rebuilding: Promise<void> | null = null;` (`:279`);
  - `setSinks` (`:424-466`).
- Test: `src/lib/audio/graph.test.ts`:
  - four cases inside `describe('createAudioGraph — outputs', …)`, after the case ending at `:159`;
  - one at the end of `describe('createAudioGraph — a wedged context (#246)', …)`;
  - `SINK_SWITCH_DEADLINE_MS` added to the `./graph` import on line 7.

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const SINK_SWITCH_DEADLINE_MS = 1_500`. `AudioGraph.setSinks(sinks)` keeps its signature; its promise settles once this call's switches have run or been skipped. A switch that never settles leaves the promise pending; `playback.ts` does not await it.

- [ ] **Step 1: Write the five failing tests.** Add after the case `'a virtual element that cannot choose its device never plays'`:

```ts
  /** Lets every queued microtask and resolved promise run. */
  const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

  // Each case lets the first switch start (`settle`) before asking for the next:
  // a request overtaken in the same tick never reaches the element at all.

  it('switches one device at a time per bus, and skips a switch a newer one overtook before its turn', async () => {
    const { graph, real } = await setup();
    const calls: string[] = [];
    const land: Array<() => void> = [];
    real.setSinkId = (id: string) => {
      calls.push(id);
      return new Promise<void>((resolve) => { land.push(() => { real.sinkId = id; resolve(); }); });
    };
    const first = graph.setSinks({ real: 'monitor-a' });
    await settle();
    const second = graph.setSinks({ real: 'monitor-b' });
    const third = graph.setSinks({ real: 'monitor-c' });
    await settle();
    // monitor-b and monitor-c wait for monitor-a: no two switches overlap on one element.
    expect(calls).toEqual(['monitor-a']);
    land.shift()!();
    await first;
    await settle();
    // monitor-b was overtaken by monitor-c before its turn: it never reaches the element.
    expect(calls).toEqual(['monitor-a', 'monitor-c']);
    land.shift()!();
    await Promise.all([second, third]);
    expect(real.sinkId).toBe('monitor-c');
  });

  it("a stale switch's failure neither forgets nor pauses the newer selection", async () => {
    const { graph, virtualSink } = await setup();
    const outcome: Record<string, { ok: () => void; fail: () => void }> = {};
    virtualSink.setSinkId = (id: string) => new Promise<void>((resolve, reject) => {
      outcome[id] = { ok: () => { virtualSink.sinkId = id; resolve(); }, fail: () => reject(new Error('NotFoundError')) };
    });
    reportWarningSpy.mockClear();
    const first = graph.setSinks({ virtual: 'cable-1' });
    await settle();
    const second = graph.setSinks({ virtual: 'cable-2' });
    outcome['cable-1'].fail();
    await first;
    await settle();
    // The newer switch ran after the stale one settled, and was not given up.
    expect(outcome['cable-2']).toBeDefined();
    outcome['cable-2'].ok();
    await second;
    expect(virtualSink.sinkId).toBe('cable-2');
    expect(virtualSink.paused).toBe(false);
    // The device the user moved away from is not worth a line in the panel.
    expect(reportWarningSpy).not.toHaveBeenCalled();
  });

  it('turning the virtual output off while a switch is pending keeps it silent when that switch lands', async () => {
    const { graph, virtualSink } = await setup();
    let land!: () => void;
    virtualSink.setSinkId = (id: string) => new Promise<void>((resolve) => { land = () => { virtualSink.sinkId = id; resolve(); }; });
    const first = graph.setSinks({ virtual: 'cable-1' });
    await settle();
    await graph.setSinks({ virtual: undefined });
    land();
    await first;
    await graph.resume();
    expect(virtualSink.paused).toBe(true);
  });

  it('a switch landing or still queued at close() neither reaches nor starts the element', async () => {
    const { graph, real } = await setup();
    const calls: string[] = [];
    const land: Array<() => void> = [];
    real.setSinkId = (id: string) => {
      calls.push(id);
      return new Promise<void>((resolve) => { land.push(() => { real.sinkId = id; resolve(); }); });
    };
    const first = graph.setSinks({ real: 'monitor-a' });
    await settle();
    const second = graph.setSinks({ real: 'monitor-b' });
    const closed = graph.close();
    for (const release of land.splice(0)) release();
    await settle();
    expect(calls).toEqual(['monitor-a']);
    // Whatever did reach the element lands too, so a regression fails above instead of hanging here.
    for (const release of land.splice(0)) release();
    await Promise.all([first, second, closed]);
    expect(real.paused).toBe(true);
  });
```

And at the end of `describe('createAudioGraph — a wedged context (#246)', …)`:

```ts
  it('a device switch that never settles holds its bus only until the deadline', async () => {
    const { graph, real, clock, flush } = await setupRecovering();
    const calls: string[] = [];
    real.setSinkId = (id: string) => {
      calls.push(id);
      return id === 'gone' ? new Promise<void>(() => {}) : Promise.resolve().then(() => { real.sinkId = id; });
    };
    void graph.setSinks({ real: 'gone' });
    await flush();
    const next = graph.setSinks({ real: 'monitor-b' });
    await flush();
    expect(calls).toEqual(['gone']);
    clock.advance(SINK_SWITCH_DEADLINE_MS);
    await flush();
    expect(calls).toEqual(['gone', 'monitor-b']);
    await next;
    expect(real.sinkId).toBe('monitor-b');
    expect(clock.pending).toBe(0);
  });
```

- [ ] **Step 2: Run them and see four fail.** Run: `npx vitest run src/lib/audio/graph.test.ts`. Expected: 4 failed, 54 passed, out of 58.
  - The first fails with `expected [ 'monitor-a', 'monitor-b', …(1) ] to deeply equal [ 'monitor-a' ]`.
  - The second fails with `expected true to be false`, on `paused`: the stale failure cleared `requested.virtual` and paused the element, so the newer switch landed and was ignored.
  - The fourth fails with `expected [ 'monitor-a', 'monitor-b' ] to deeply equal [ 'monitor-a' ]`.
  - The fifth fails with `expected [ 'gone', 'monitor-b' ] to deeply equal [ 'gone' ]`.
  - The third passes already. It pins behaviour the queue must keep (the TDD exception).

  Record the output.

- [ ] **Step 3: Add the deadline and the queue.** In `graph.ts`, after `export const CLOSE_WAIT_MS = 1_000;` (`:95`), add:

```ts
/** How long a bus's device switch holds the next one: a wedged sink may never settle `setSinkId` (#246). */
export const SINK_SWITCH_DEADLINE_MS = 1_500;
```

Replace the comment above `requested` (`:192-196`):

```ts
  // `requested`: what `setSinks` was last asked for, per bus. `applied`: what
  // `setSinkId` actually resolved to. The virtual element plays only once its
  // switch has *landed* on the id currently requested — not merely started —
  // so a `resume()` racing a pending switch never starts it on whatever
  // device the element happened to be on before (F1). A bus's switches run
  // one at a time (`switchBus` below), so only the latest request's switch
  // sets `applied`, or forgets `requested` when it fails.
```

After `let rebuilding: Promise<void> | null = null;` (`:279`) add:

```ts
  /**
   * The turn each bus's next switch waits for. One `setSinkId` at a time per
   * element: two in flight could land in either order and leave the element
   * on the older device. A switch whose turn comes after a newer request, or
   * after `close()`, never reaches the element; a stale switch's outcome,
   * success or failure, leaves the newer request's records and the element
   * alone. A switch that has not settled after `SINK_SWITCH_DEADLINE_MS`
   * stops holding the next one.
   */
  const switching: Partial<Record<Bus, Promise<void>>> = {};
  const switchBus = (bus: Bus, element: SinkElement, id: string | undefined): Promise<void> => {
    const stale = () => closing !== null || requested[bus] !== id;
    let turnOver!: () => void;
    const over = new Promise<void>((resolve) => { turnOver = resolve; });
    const run = async () => {
      if (stale()) return;
      const cancel = clock.setTimeout(turnOver, SINK_SWITCH_DEADLINE_MS);
      try {
        await element.setSinkId?.(id ?? '');
      } catch (error) {
        cancel();
        if (stale()) return;
        reportWarning('AudioGraph', `Could not switch the ${bus} output: ${describeCause(error)}`, { dedupeKey: `graph:sink:${bus}` });
        // Forget the id on either bus, so a later setSinks with the same id
        // (the device coming back, or routing re-applying unchanged
        // settings) retries instead of short-circuiting.
        requested[bus] = undefined;
        if (bus === 'virtual') {
          // Never play the meeting's audio on whatever device the element was left on.
          element.pause();
          return;
        }
        // The real element keeps playing wherever it was — the user still
        // hears their audio — so it plays as on success.
        play(bus);
        return;
      }
      cancel();
      if (stale()) return;
      applied[bus] = id;
      play(bus);
    };
    // `run` never rejects, so the chain never breaks. The next switch waits
    // for this one's turn: its end, or the deadline when it hangs.
    const done = (switching[bus] ?? Promise.resolve()).then(run).finally(turnOver);
    switching[bus] = over;
    return done;
  };
```

- [ ] **Step 4: Hand `setSinks`' switches to it.** Replace the body of `setSinks` (`:424-466`):

```ts
    async setSinks(sinks) {
      const switches: Promise<void>[] = [];
      for (const bus of ['real', 'virtual'] as const) {
        const element = elements[bus];
        const id = sinks[bus];
        if (!element || id === requested[bus]) continue;
        requested[bus] = id;
        if (bus === 'virtual') {
          // Never play the meeting's audio on whatever device the element is
          // on while a switch is pending or absent (F1).
          applied.virtual = undefined;
          element.pause();
          if (!id) continue;
          if (!element.setSinkId) {
            reportWarning('AudioGraph', 'Could not switch the virtual output: it cannot choose its device', { dedupeKey: 'graph:sink:virtual' });
            requested.virtual = undefined;
            continue;
          }
        }
        switches.push(switchBus(bus, element, id));
      }
      await Promise.all(switches);
    },
```

And the interface comment at `:65`:

```ts
  /** Points each bus's element at a device; the virtual one stays silent until it has one. A bus switches one device at a time and ends on the last one asked for; the promise settles once this call's switches have run. */
```

- [ ] **Step 5: Run the file green.** Run: `npx vitest run src/lib/audio/graph.test.ts`. Expected: 58 of 58 pass.

- [ ] **Step 6: Check each new test bites.** For each mutant: edit `graph.ts`, run `npx vitest run src/lib/audio/graph.test.ts`, and record the failing tests' names. Then restore the line with the Edit tool and re-run green. No mutant may hang a test (a 5 s timeout is a finding):
  - **No queue.** `(switching[bus] ?? Promise.resolve()).then(run)` → `run()`. Fails: the first, fourth and fifth tests.
  - **No stale check in `catch`.** Drop `if (stale()) return;` there. Fails: the second test.
  - **No stale check after the `try`.** Drop `if (stale()) return;` there. Fails: the fourth test (the switch that lands after `close()` starts the element).
  - **`close()` not stale.** `const stale = () => closing !== null || requested[bus] !== id;` → `const stale = () => requested[bus] !== id;`. Fails: the fourth test (monitor-b reaches the element).
  - **No stale check at the start of a turn.** Drop `if (stale()) return;` at the start of `run`. Fails: the first and fourth tests.
  - **No deadline.** `switching[bus] = over;` → `switching[bus] = done;`. Fails: the fifth test.

  The third test has no mutant here. `play`'s own guard (`applied.virtual !== requested.virtual`) also keeps that case silent, so it stays as a pin.

- [ ] **Step 7: The gates** (Global Constraints), with `t01.txt` against `t00.txt`. Expected: `npx vitest run src` gives 532 + 1 files and 6 666 + 2 tests.

- [ ] **Step 8: Commit.**

```bash
git add -- src/lib/audio/graph.ts src/lib/audio/graph.test.ts
```

```bash
git commit -q -F - -- src/lib/audio/graph.ts src/lib/audio/graph.test.ts <<'EOF'
fix(audio): switch one output device at a time per bus

Two setSinkId calls in flight on one element could land in either order,
so a quick second pick could end on the first device, and a stale
switch's failure cleared the newer request and paused the virtual output.
Each bus now runs its switches one at a time: a switch a newer request
overtook before its turn, or one still queued at close(), never reaches
the element, and a stale switch's outcome leaves the newer one alone. A
switch that never settles holds the next one for 1.5 s at most, as the
graph already bounds every other wait on a wedged device (#246).

Co-Authored-By: <model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: Setup completes only over saved provider settings

**Files:**
- Modify: `src/stores/providerStore.ts`:
  - the interface (`:52-88`);
  - `persistPair` (`:118-121`), `select` (`:164-173`), `updateSettings` (`:228-242`), `setCredential` (`:244-250`), `setPair` (`:252-260`).
- Modify: `src/components/SetupWizard/useApplySetup.ts`; one doc line each in `src/components/SetupWizard/applySetup.ts` (`:18-21`) and `src/stores/setupStore.ts` (`:47`).
- Test:
  - `src/stores/providerStore.test.ts`: a new `describe('flush')` at the end;
  - `src/components/SetupWizard/useApplySetup.test.ts`: a drain after each case, and three cases at the end of its `describe`.

**Interfaces:**
- Consumes: `persistSetting(key, value): Promise<boolean>` (`src/services/persistSetting.ts`; never rejects). `SetupPersistError` (`src/stores/setupStore.ts`).
- Produces: `ProviderStore.flush(p?: AnyProvider): Promise<boolean>`.
  - It writes again every value whose last write did not land, then waits for every write started so far.
  - It resolves true when nothing it answers for is left unsaved.
  - With `p`, it writes again and answers for `p`'s own keys (`settings.<p.settings.key>.*`) and `settings.common.provider` only. Without `p`, it covers every key.

- [ ] **Step 1: Write the failing store tests.** Append to `src/stores/providerStore.test.ts`, and add `afterEach` to the vitest import on line 1:

```ts
describe('flush', () => {
  const landNow = async (key: string, value: unknown) => {
    stored.set(key, value);
    return { success: true };
  };
  // The store keeps what did not land across tests (beforeEach resets its
  // state, not its write ledger): put storage back and drain it.
  afterEach(async () => {
    setSetting.mockImplementation(landNow);
    await useProviderStore.getState().flush();
  });

  /** Holds every write until released; `ok: false` refuses it as a full quota would. */
  const holdWrites = () => {
    const held: Array<{ key: string; release: (ok: boolean) => void }> = [];
    setSetting.mockImplementation((key: string, value: unknown) => new Promise<{ success: boolean; error?: string }>((resolve) => {
      held.push({ key, release: (ok) => {
        if (ok) stored.set(key, value);
        resolve(ok ? { success: true } : { success: false, error: 'QuotaExceededError' });
      } });
    }));
    return held;
  };

  it('resolves true at once when nothing is being written', async () => {
    await expect(useProviderStore.getState().flush()).resolves.toBe(true);
  });

  it('waits for every write the store started, and resolves true once all landed', async () => {
    await useProviderStore.getState().load(probe);
    const held = holdWrites();
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    useProviderStore.getState().setCredential(probe, 'apiKeyEu', 'k-2');
    let answer: boolean | undefined;
    const flushed = useProviderStore.getState().flush().then((ok) => { answer = ok; });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    const early = answer;
    // Released before any assertion: a held write would hold the drain in afterEach.
    for (const write of held.splice(0)) write.release(true);
    await flushed;
    expect(early).toBeUndefined();
    expect(answer).toBe(true);
    expect(stored.get('settings.probe.apiKey')).toBe('k-1');
    expect(stored.get('settings.probe.apiKeyEu')).toBe('k-2');
  });

  it('resolves false when a write did not land, and writes that value again on the next flush', async () => {
    await useProviderStore.getState().load(probe);
    setSetting.mockImplementationOnce(async () => ({ success: false, error: 'QuotaExceededError' }));
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    await expect(useProviderStore.getState().flush()).resolves.toBe(false);
    expect(stored.has('settings.probe.apiKey')).toBe(false);
    // Storage is back: the value the user left is written, nothing else.
    await expect(useProviderStore.getState().flush()).resolves.toBe(true);
    expect(stored.get('settings.probe.apiKey')).toBe('k-1');
  });

  it('resolves false again when the value written again is refused again', async () => {
    await useProviderStore.getState().load(probe);
    // Storage refuses every write until afterEach puts it back.
    setSetting.mockImplementation(async () => ({ success: false, error: 'QuotaExceededError' }));
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    await expect(useProviderStore.getState().flush()).resolves.toBe(false);
    await expect(useProviderStore.getState().flush()).resolves.toBe(false);
    expect(stored.has('settings.probe.apiKey')).toBe(false);
  });

  it('never writes again a value a newer write of the same key replaced', async () => {
    await useProviderStore.getState().load(probe);
    setSetting.mockImplementationOnce(async () => ({ success: false, error: 'QuotaExceededError' }));
    useProviderStore.getState().setCredential(probe, 'apiKey', 'old');
    await useProviderStore.getState().flush();
    useProviderStore.getState().setCredential(probe, 'apiKey', 'new');
    setSetting.mockClear();
    await expect(useProviderStore.getState().flush()).resolves.toBe(true);
    expect(setSetting).not.toHaveBeenCalledWith('settings.probe.apiKey', 'old');
    expect(stored.get('settings.probe.apiKey')).toBe('new');
  });

  it('never writes again a value whose write failed after a newer write of its key began', async () => {
    await useProviderStore.getState().load(probe);
    const held = holdWrites();
    useProviderStore.getState().setCredential(probe, 'apiKey', 'old');
    useProviderStore.getState().setCredential(probe, 'apiKey', 'new');
    held[1].release(true); // the newer write lands first
    held[0].release(false); // then the older one fails
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    setSetting.mockImplementation(landNow);
    setSetting.mockClear();
    await expect(useProviderStore.getState().flush()).resolves.toBe(true);
    expect(setSetting).not.toHaveBeenCalled();
    expect(stored.get('settings.probe.apiKey')).toBe('new');
  });

  it("flush(p) answers for p's own settings and the selection only: another provider's refused value does not fail it", async () => {
    const other = { ...probe, id: 'other', settings: { ...probe.settings, key: 'other' } } as unknown as AnyProvider;
    await useProviderStore.getState().load(probe);
    await useProviderStore.getState().load(other);
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key.startsWith('settings.other.')) return { success: false, error: 'QuotaExceededError' };
      stored.set(key, value);
      return { success: true };
    });
    useProviderStore.getState().setCredential(other, 'apiKey', 'too-long');
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    await useProviderStore.getState().flush();
    setSetting.mockClear();
    await expect(useProviderStore.getState().flush(probe)).resolves.toBe(true);
    // The other provider's value is neither written again nor answered for…
    expect(setSetting).not.toHaveBeenCalledWith('settings.other.apiKey', expect.anything());
    expect(stored.get('settings.probe.apiKey')).toBe('k-1');
    // …but a flush of every key still sees it.
    await expect(useProviderStore.getState().flush()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing wizard tests.** In `src/components/SetupWizard/useApplySetup.test.ts`:
  - Add `afterEach` to the vitest import.
  - Add `import { SetupPersistError } from '../../stores/setupStore';` beside the other store imports.
  - After the `beforeEach`, add:

```ts
const landNow = async (key: string, value: unknown) => {
  stored.set(key, value);
  return { success: true };
};
// The provider store keeps what did not land across tests: put storage back and drain it.
afterEach(async () => {
  setSetting.mockImplementation(landNow);
  await useProviderStore.getState().flush();
});
```

Then append inside `describe("useApplySetup's applyProvider (review Minor 4)", …)`:

```ts
  it('records setup complete only after every provider write has landed', async () => {
    const held: Array<() => void> = [];
    setSetting.mockImplementation((key: string, value: unknown) => {
      if (key === 'settings.setup') return landNow(key, value);
      return new Promise<{ success: boolean }>((resolve) => { held.push(() => { stored.set(key, value); resolve({ success: true }); }); });
    });
    const { result } = renderHook(() => useApplySetup());

    const finishing = result.current(draft({}));
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    const recordedEarly = setSetting.mock.calls.some(([key]) => key === 'settings.setup');
    // Released before any assertion: a held write would hold the drain in afterEach.
    for (const release of held.splice(0)) release();
    await finishing;

    expect(recordedEarly).toBe(false);
    expect(setSetting).toHaveBeenCalledWith('settings.setup', expect.objectContaining({ provider: Provider.LOCAL_INFERENCE }));
    expect(stored.get('settings.common.provider')).toBe('local_inference');
  });

  it('fails Finish with the setup-persist error, recording nothing, when a provider write does not land', async () => {
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'settings.localInference.sourceLanguage') return { success: false, error: 'QuotaExceededError' };
      return landNow(key, value);
    });
    const { result } = renderHook(() => useApplySetup());

    await expect(result.current(draft({}))).rejects.toBeInstanceOf(SetupPersistError);

    expect(setSetting).not.toHaveBeenCalledWith('settings.setup', expect.anything());
  });

  it('Finish again writes what did not land — a pair already in memory too — and then records', async () => {
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'settings.localInference.sourceLanguage') return { success: false, error: 'QuotaExceededError' };
      return landNow(key, value);
    });
    const { result } = renderHook(() => useApplySetup());
    await expect(result.current(draft({}))).rejects.toBeInstanceOf(SetupPersistError);

    setSetting.mockImplementation(landNow);
    await result.current(draft({}));

    expect(stored.get('settings.localInference.sourceLanguage')).toBe('en');
    expect(stored.get('settings.setup')).toEqual(expect.objectContaining({ provider: Provider.LOCAL_INFERENCE }));
  });
```

  The third case is the retry the store's pair writes would otherwise miss. On the second Finish the pair in memory already equals the draft's, so `setPair` writes nothing. Only `flush(p)` writing the failed value again puts it on disk.

- [ ] **Step 3: Run them and see them fail.** Run: `npx vitest run src/stores/providerStore.test.ts src/components/SetupWizard/useApplySetup.test.ts`. Expected: 17 failed, 37 passed.
  - The seven `flush` cases fail with `flush is not a function` (a TypeError), in the body and again in their `afterEach`.
  - Every case in `useApplySetup.test.ts` fails in the shared `afterEach` with the same TypeError. For the seven existing cases this is the only failure.
  - The three new wizard cases also fail in their bodies:
    - the first on `expect(recordedEarly).toBe(false)`;
    - the second and third because the promise resolves instead of rejecting.

  Record the output.

- [ ] **Step 4: One write helper and `flush()` in the store.** In `providerStore.ts`, add to the `ProviderStore` interface, after `setPair`:

```ts
  /**
   * Writes again every value whose last write did not land, then waits for
   * every write started so far, those included. True when nothing it answers
   * for is left unsaved. With `p`, only `p`'s own settings and the selection
   * are written again and answered for: another provider's refused value is
   * not this caller's to fail on.
   */
  flush(p?: AnyProvider): Promise<boolean>;
```

Inside `create<ProviderStore>()((set, get) => {`, after `put`, add:

```ts
  /** Writes in flight, and the last value per key whose write did not land (a later write of the key replaces it). */
  const writing = new Set<Promise<boolean>>();
  const unsaved = new Map<string, unknown>();
  const latest = new Map<string, number>();
  let writes = 0;
  /** Every write this store makes goes through here, so `flush` can wait for it. */
  const write = (key: string, value: unknown): void => {
    const mine = ++writes;
    latest.set(key, mine);
    unsaved.delete(key);
    // persistSetting never rejects; it reports a failure itself.
    const done = persistSetting(key, value).then((ok) => {
      if (!ok && latest.get(key) === mine) unsaved.set(key, value);
      return ok;
    });
    writing.add(done);
    void done.then(() => { writing.delete(done); });
  };
```

Replace the five calls:
- `persistPair`: `void persistSetting(storageKey(p, SOURCE), after.source);` → `write(storageKey(p, SOURCE), after.source);`, and the same for `TARGET`.
- `select`: `if (value !== null) void persistSetting('settings.common.provider', value);` → `if (value !== null) write('settings.common.provider', value);`.
- `updateSettings`: `for (const [field, value] of Object.entries(patch)) void persistSetting(storageKey(p, field), value);` → `for (const [field, value] of Object.entries(patch)) write(storageKey(p, field), value);`.
- `setCredential`: `void persistSetting(storageKey(p, key), value);` → `write(storageKey(p, key), value);`.

After the change, `command grep -n persistSetting src/stores/providerStore.ts` finds only the import and `write`.

Add to the returned object, after `setPair`:

```ts
    async flush(p) {
      const covers = (key: string) => !p || key === 'settings.common.provider' || key.startsWith(`settings.${p.settings.key}.`);
      for (const [key, value] of [...unsaved]) {
        if (covers(key)) write(key, value);
      }
      await Promise.all([...writing]);
      return ![...unsaved.keys()].some(covers);
    },
```

- [ ] **Step 5: The wizard awaits it.**
  - In `useApplySetup.ts`, import `SetupPersistError` with the setup store: `import { useSetupStore, SetupPersistError } from '../../stores/setupStore';`.
  - After `store.select(p.id, 'pick');`, add:

```ts
        // The record comes last and says setup is done: never over a provider
        // whose settings are not on disk yet (the extension's storage is
        // asynchronous, and a closed side panel would keep the record alone).
        if (!await store.flush(p)) throw new SetupPersistError();
```

  - Replace the header's paragraph that begins `// applyProvider writes through the provider store` with:

```ts
// applyProvider writes through the provider store, the one writer of the
// session's provider settings, and resolves once those writes have landed;
// readiness re-checks on the store's own reset.
```

  - In `applySetup.ts`, the `applyProvider` doc (`:18-21`) gains a last sentence, `Rejects with \`SetupPersistError\` when a write did not land; the record is then not written.` It reads:

```ts
  /** The provider, its pair and — on the own-key path — its credentials and
   *  the credential choice its step showed (a settings patch; F4), written
   *  where the session reads them; the one write the wizard makes besides
   *  the presets and the record. Rejects with `SetupPersistError` when a
   *  write did not land; the record is then not written. */
```

  - In `setupStore.ts`, the first line of `SetupPersistError`'s doc (`:47`), `/** The setup record could not be written. Typed rather than a bare Error so the`, becomes `/** The setup record, or a provider setting written before it, could not be written. Typed rather than a bare Error so the`.

- [ ] **Step 6: Run green.** Run: `npx vitest run src/stores/providerStore.test.ts src/components/SetupWizard`. Expected: every case passes.

- [ ] **Step 7: Check each new test bites.** For each mutant: edit, run the step-6 command, and record the failing tests' names. Then restore with the Edit tool and re-run green. No mutant may hang a test (a hook timeout is a finding). Each list names the cases that must fail; a case failing later on what the drain could not empty is expected too.
  - **Result ignored.** In `useApplySetup.ts`, `if (!await store.flush(p)) throw new SetupPersistError();` → `await store.flush(p);`. Fails: the wizard's second and third cases.
  - **No flush.** The same line removed. Fails: the wizard's first, second and third cases (the record is written before the writes land, and a refused write no longer fails Finish).
  - **No retry.** In `flush`, drop the `for` loop that writes the unsaved values again. Fails: the store's third case and the wizard's third case.
  - **No reset on a new write.** In `write`, drop `unsaved.delete(key);`. Fails: the store's third and fifth cases and the wizard's third. A write that lands no longer clears its key, so `flush` keeps answering false.
  - **No `latest` guard.** In `write`, `if (!ok && latest.get(key) === mine)` → `if (!ok)`. Fails: the store's sixth case (the late failure of `old` is written over `new`).
  - **Writes not tracked.** In `write`, drop `writing.add(done);`. Fails: the store's second and third cases and all three new wizard cases (`flush` answers before any write lands).
  - **Retries not awaited.** In `flush`, take `const pending = [...writing];` before the `for` loop and await `Promise.all(pending)` instead. Fails: the store's fourth case.
  - **No scope.** In `flush`, `const covers = (key: string) => …` → `const covers = (_key: string) => true;`. Fails: the store's seventh case.

- [ ] **Step 8: The gates** (Global Constraints), with `t02.txt` against `t01.txt`. Expected: `npx vitest run src` gives 532 + 1 files and 6 676 + 2 tests (Task 1's 5 new cases, then this task's 7 store and 3 wizard cases).

- [ ] **Step 9: Commit.**

```bash
git add -- src/stores/providerStore.ts src/stores/providerStore.test.ts src/components/SetupWizard/useApplySetup.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/applySetup.ts src/stores/setupStore.ts
```

```bash
git commit -q -F - -- src/stores/providerStore.ts src/stores/providerStore.test.ts src/components/SetupWizard/useApplySetup.ts src/components/SetupWizard/useApplySetup.test.ts src/components/SetupWizard/applySetup.ts src/stores/setupStore.ts <<'EOF'
fix(setup): record setup complete only over saved provider settings

The provider store's setters started their storage writes and returned,
so the wizard recorded setup complete while the provider, its pair and
its credentials could still be in flight; closing the extension's side
panel then kept the record without them. The store now tracks its writes
and the values that did not land, and flush(p) writes those again for
the wizard's provider and the selection and waits for all of them.
Finish awaits it and fails with the setup-persist message when a write
did not land; Finish again writes what was missing, a pair already in
memory included, before it records.

Co-Authored-By: <model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: The record (controller)

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — a new last section, `## Fixed before #570 merges: the two open review threads`.

- [ ] **Step 1: Write the section** in the roadmap's form.
  - **What landed:** this plan's path and its Revision 1, the two commits, the gates' numbers, and each mutant with the tests it failed.
  - **The two choices made on the review:**
    - A switch that never settles holds its bus for `SINK_SWITCH_DEADLINE_MS` (1.5 s) at most. Past it, a switch that is slow but alive can overlap the next one: the original race, only after 1.5 s.
    - `flush(p)` answers for the wizard's provider and the selection only. Another provider's refused value, such as a long prompt over `chrome.storage.sync`'s per-item quota, does not fail Finish; it still reaches the panel through `persistSetting`'s warning.
  - **The stated scope:** the scenario's mode and text-only writes stay unawaited. `setTextOnly` already awaits its own write and rolls back when it fails. A lost `setMode` leaves the person's previous mode, which they see and can change, while a lost credential leaves a provider that cannot start.
  - **Left to the owner:** resolving the two threads on #570 once this is pushed.
- [ ] **Step 2: Commit** with the pathspec `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` and the subject `docs(roadmap): the two review fixes before #570 merges`.

---

## Self-Review

- **The two threads, covered:**
  - `graph.ts:462`:
    - per-bus serialization (Task 1, Steps 3-4);
    - a stale success leaving the element on the old device (the first test);
    - a stale rejection clearing or pausing the newer selection (the second test).
  - `useApplySetup.ts:36`:
    - the record awaited after the provider writes (Task 2, Step 5; the first wizard case);
    - a refused write failing Finish (the second);
    - the retry the pair's change-only writes would have missed (the third).
- **Beyond the threads, by the same mechanisms:**
  - a switch queued or landing at `close()` (Task 1, the fourth test);
  - a switch that never settles (the fifth);
  - a retry refused again (Task 2, the fourth store case);
  - a newer value never overwritten by a stale retry (the fifth and sixth);
  - another provider's refused value (the seventh).
- **Placeholders:** none. `<model>` in the commit messages is the executing model's name (Global Constraints).
- **Names:**
  - Task 1 defines `SINK_SWITCH_DEADLINE_MS`, `switchBus` and `switching`.
  - Task 2 defines `write`, `writing`, `unsaved`, `latest` and `flush`.
  - Each is defined where it is used. `SetupPersistError`, `persistSetting`, `setupRecovering` and `countingClock`'s `pending` exist at the base.
- **Counts:**
  - The base has 6 661 + 2 tests.
  - Task 1 adds 5 (6 666).
  - Task 2 adds 7 store and 3 wizard cases (6 676).
  - Files stay 532 + 1: every case goes into an existing file.
- **Timing in the tests:**
  - A request overtaken in the same tick never reaches the element, so each graph case lets the first switch start before the next request.
  - Every held write or switch is released before the first assertion, so a regression fails instead of hanging.
