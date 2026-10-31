# Output Context Sinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sokuji's three real outlets play through one `AudioContext` each, so `echoCancellation: true` removes Sokuji's own speech on Windows, macOS and Linux.

**Architecture:** A new `contextSink.ts` implements the graph's existing `SinkElement` on an `AudioContext` fed by the stream each outlet's bus already ends in. `appAudio.ts` hands that sink to the outlets and keeps an `<audio>` element for the virtual bus. Each sink watches its own context for a vanished device (#246).

**Tech Stack:** TypeScript, Web Audio, Vitest with the fakes in `src/lib/audio/fakeWebAudio.ts`, Electron 44.5.1, the Chrome extension.

**Spec:** `docs/superpowers/specs/2026-10-31-output-context-sinks-design.md`

## Global Constraints

- Sink contexts run at `SAMPLE_RATE` with the default `latencyHint`: the measured setup.
- The virtual bus stays on an `<audio>` element. Passthrough reaches no outlet.
- The first context, its feeds, buses, routes, taps, meters and queues do not change.
- No new setting, no flag, no fallback path, no change to the 30 catalogs.
- A sink never awaits `close()`, and no `resume()` or `setSinkId()` that never settles may hold a caller (#246).
- `WEDGE_GRACE_MS`, `RESUME_DEADLINE_MS` and `MAX_REBUILDS` are imported from `graph.ts`, not repeated. `graph.ts` imports nothing from `contextSink.ts`.
- Worktree: `.claude/worktrees/output-context-sinks`, branch `fix/output-context-sinks`. Run `npm ci --ignore-scripts` once. No `git stash`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nothing is pushed and no PR is opened until the owner says so for that act, naming `kizuna-ai-lab/sokuji` and the branch.

## Review Focus

1. A stored device applied at page load, before any user gesture: `resume()` stays pending, so a switch must neither wait for it nor reject. Task 2 pins it.
2. A second switch while the first hangs on a dead device: the newer one wins and the hung context is not left open. Task 2 pins it.
3. A first-context rebuild during a switch: the sink's new context must take the newest stream, not the one the switch began with. Task 2 pins it.
4. The first context resting (`graph.suspend()`): the sinks keep running, because resuming is what clears the bridge's delay. Task 4 pins it.
5. `close()` during a switch or a wedge timer: no context outlives it and no timer builds a new one. Tasks 2 and 3 pin it.

---

### Task 1: The sink on one context

**Files:**
- Create: `src/lib/audio/contextSink.ts`
- Create: `src/lib/audio/contextSink.test.ts`
- Modify: `src/lib/audio/fakeWebAudio.ts` (`FakeAudioContext`, about line 114)

**Interfaces:**
- Consumes: `SinkElement`, `RESUME_DEADLINE_MS` from `./graph`; `Clock`, `realClock` from `../contract/clock`.
- Produces:

```ts
export interface ContextSinkDeps {
  /** A new context at the app's rate, on the browser's default device. */
  createContext(): AudioContext;
  /** The outlet, for warnings and their dedupe keys. */
  label: string;
  /** Times the deadlines and the wedge watch; `realClock` by default. */
  clock?: Pick<Clock, 'setTimeout'>;
}
export function createContextSink(stream: MediaStream, deps: ContextSinkDeps): SinkElement;
```

- `FakeAudioContext` gains `constructor(state: AudioContextState = 'running')`, `sinkIds: string[]` (every id `setSinkId` was given), `sinkFails = false` (the call rejects), `holdSink = false` (the call waits for `releaseSink()`), and `releaseSink(): void`.

- [ ] **Step 1: Extend the fake**

Add the members above. `setSinkId(id)` pushes to `sinkIds`, waits if `holdSink`, rejects with `new DOMException('no such device', 'NotFoundError')` if `sinkFails`. Existing callers of `new FakeAudioContext()` keep working.

- [ ] **Step 2: Write the failing tests**

In `contextSink.test.ts`, a harness shared by Tasks 1 to 3:

```ts
const fakeStream = (id: string) => ({ id }) as unknown as MediaStream;
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function setup({ state, prepare }: { state?: AudioContextState; prepare?: (ctx: FakeAudioContext, index: number) => void } = {}) {
  const contexts: FakeAudioContext[] = [];
  const clock = createVirtualClock();
  const stream = fakeStream('a');
  const sink = createContextSink(stream, {
    label: 'them',
    clock,
    createContext: () => {
      const ctx = new FakeAudioContext(state);
      prepare?.(ctx, contexts.length);
      contexts.push(ctx);
      return ctx.asContext();
    },
  });
  /** Whether `ctx` currently plays `id`. */
  const plays = (ctx: FakeAudioContext, id: string) =>
    ctx.streamSources.some((s) => (s.mediaStream as unknown as { id: string }).id === id && reaches(s, ctx.destination));
  return { sink, contexts, clock, plays };
}

describe('createContextSink', () => {
  it('plays the stream through its context', () => {
    const { contexts, plays } = setup();
    expect(contexts).toHaveLength(1);
    expect(plays(contexts[0], 'a')).toBe(true);
  });

  it('is paused until its context runs, and a refused start works on a later play()', async () => {
    const { sink, contexts, clock } = setup({ state: 'suspended', prepare: (ctx) => { ctx.stuck = true; } });
    expect(sink.paused).toBe(true);
    const refused = sink.play();
    clock.advance(RESUME_DEADLINE_MS);
    await refused;
    contexts[0].stuck = false;
    await sink.play();
    expect(sink.paused).toBe(false);
    expect(contexts[0].resumed).toBe(2);
  });

  it('play() settles though resume() never does', async () => {
    const { sink, clock } = setup({ state: 'suspended', prepare: (ctx) => { ctx.stuck = true; } });
    const started = sink.play();
    clock.advance(RESUME_DEADLINE_MS);
    await expect(started).resolves.toBeUndefined();
  });

  it('a new stream replaces the old one on the same context', () => {
    const { sink, contexts, plays } = setup();
    sink.srcObject = fakeStream('b');
    expect(contexts).toHaveLength(1);
    expect(plays(contexts[0], 'a')).toBe(false);
    expect(plays(contexts[0], 'b')).toBe(true);
    expect((sink.srcObject as unknown as { id: string }).id).toBe('b');
  });

  it('null closes the context, once', () => {
    const { sink, contexts } = setup();
    sink.srcObject = null;
    sink.srcObject = null;
    expect(contexts[0].closed).toBe(1);
    expect(sink.srcObject).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/lib/audio/contextSink.test.ts`
Expected: FAIL, `contextSink` cannot be resolved.

- [ ] **Step 4: Implement `createContextSink` in `src/lib/audio/contextSink.ts`**

Holds the current context, source node, stream and device id (`''` for the default). `paused` is `context.state !== 'running'`. `play()` races `context.resume()` against `RESUME_DEADLINE_MS`, and resolves either way; a real rejection propagates to the graph's `play()`, which reports it. `pause()` is `void context.suspend().catch(() => {})`. `srcObject`'s setter casts to `MediaStream`, disconnects the old source and connects a new one; `null` disconnects and calls `void context.close().catch(() => {})` once, and marks the sink closed so every later call does nothing. `setSinkId` stays a stub until Task 2.

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run src/lib/audio/contextSink.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/contextSink.ts src/lib/audio/contextSink.test.ts src/lib/audio/fakeWebAudio.ts
git commit -m "feat(audio): an output sink on its own AudioContext"
```

---

### Task 2: Switching device

**Files:**
- Modify: `src/lib/audio/contextSink.ts`
- Test: `src/lib/audio/contextSink.test.ts`

**Interfaces:**
- Consumes: `createContextSink` and the harness from Task 1.
- Produces: `sink.setSinkId(id: string): Promise<void>` with these rules, which `graph.ts`'s `switchBus` relies on: it rejects only when the sink stays where it was; a call superseded by a newer one resolves. Two internal helpers Task 3 reuses: `openOn(device: string): Promise<AudioContext>` and `adopt(next: AudioContext): void`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('createContextSink — switching device', () => {
  it('opens a new context on the device, moves the stream, then closes the old one', async () => {
    const { sink, contexts, plays } = setup();
    await sink.setSinkId('usb');
    expect(contexts).toHaveLength(2);
    expect(contexts[1].sinkIds).toEqual(['usb']);
    expect(plays(contexts[1], 'a')).toBe(true);
    expect(contexts[0].closed).toBe(1);
  });

  it('asks nothing of the default device', async () => {
    const { sink, contexts } = setup();
    await sink.setSinkId('');
    expect(contexts[1].sinkIds).toEqual([]);
  });

  it('keeps the old context and rejects when the device refuses', async () => {
    const { sink, contexts, plays } = setup({ prepare: (ctx, i) => { ctx.sinkFails = i === 1; } });
    await expect(sink.setSinkId('gone')).rejects.toThrow();
    expect(contexts[1].closed).toBe(1);
    expect(contexts[0].closed).toBe(0);
    expect(plays(contexts[0], 'a')).toBe(true);
  });

  it('keeps the old context and rejects when a new one will not start after a gesture', async () => {
    const { sink, contexts, clock } = setup({
      prepare: (ctx, i) => { if (i === 1) { ctx.state = 'suspended'; ctx.stuck = true; } },
    });
    const switching = sink.setSinkId('usb');
    await flush();
    clock.advance(RESUME_DEADLINE_MS);
    await expect(switching).rejects.toThrow();
    expect(contexts[1].closed).toBe(1);
    expect(contexts[0].closed).toBe(0);
  });

  it('moves at once before any gesture, without waiting for a start', async () => {
    const { sink, contexts, plays } = setup({ state: 'suspended', prepare: (ctx) => { ctx.stuck = true; } });
    await sink.setSinkId('usb');
    expect(plays(contexts[1], 'a')).toBe(true);
    expect(contexts[0].closed).toBe(1);
    contexts[1].stuck = false;
    await sink.play();
    expect(sink.paused).toBe(false);
  });

  it('a newer switch abandons one that hangs', async () => {
    const { sink, contexts, plays } = setup({ prepare: (ctx, i) => { ctx.holdSink = i === 1; } });
    const hung = sink.setSinkId('dead');
    await flush();
    await sink.setSinkId('usb');
    expect(contexts[1].closed).toBe(1);
    expect(plays(contexts[2], 'a')).toBe(true);
    contexts[1].releaseSink();
    await expect(hung).resolves.toBeUndefined();
    expect(plays(contexts[2], 'a')).toBe(true);
  });

  it('a stream swapped during a switch lands on the new context', async () => {
    const { sink, contexts, plays } = setup({ prepare: (ctx, i) => { ctx.holdSink = i === 1; } });
    const switching = sink.setSinkId('usb');
    await flush();
    sink.srcObject = fakeStream('b');
    contexts[1].releaseSink();
    await switching;
    expect(plays(contexts[1], 'b')).toBe(true);
    expect(plays(contexts[1], 'a')).toBe(false);
  });

  it('closing during a switch closes both contexts', async () => {
    const { sink, contexts } = setup({ prepare: (ctx, i) => { ctx.holdSink = i === 1; } });
    const switching = sink.setSinkId('usb');
    await flush();
    sink.srcObject = null;
    contexts[1].releaseSink();
    await switching;
    expect(contexts).toHaveLength(2);
    expect(contexts[0].closed).toBe(1);
    expect(contexts[1].closed).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/audio/contextSink.test.ts -t "switching device"`
Expected: FAIL on every case.

- [ ] **Step 3: Implement `setSinkId`, `openOn` and `adopt`**

`openOn(device)` makes a context, remembers it as `pending` (closing any earlier `pending`, which is how a hung switch is abandoned), and awaits `setSinkId` unless `device` is `''`. `setSinkId(id)` takes a turn number; after `openOn` lands, a stale turn or a closed sink closes its context and resolves. Before any context of this sink has run (`ran` false: no gesture yet) it does not wait to start: it calls `void next.resume()` and adopts. After one has run, it races `next.resume()` against `RESUME_DEADLINE_MS`; a loss closes `next` and rejects with `new Error('the output would not start')`. `adopt(next)` builds the source from the current stream, connects it, stores the device, swaps `context`, and closes the old one unawaited. `ran` becomes true whenever a context is seen `running`.

- [ ] **Step 4: Run the file**

Run: `npx vitest run src/lib/audio/contextSink.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/contextSink.ts src/lib/audio/contextSink.test.ts
git commit -m "feat(audio): a context sink switches device on a new context"
```

---

### Task 3: A device that vanishes (#246)

**Files:**
- Modify: `src/lib/audio/contextSink.ts`
- Test: `src/lib/audio/contextSink.test.ts`

**Interfaces:**
- Consumes: `openOn`, `adopt`, `ran` from Task 2; `WEDGE_GRACE_MS`, `RESUME_DEADLINE_MS`, `MAX_REBUILDS` from `./graph`; `reportWarning` from `../diagnostics/report`.
- Produces: warnings with `dedupeKey` `sink:<label>:rebuild` (each rebuild) and `sink:<label>:gave-up` (the cap), scope `'ContextSink'`.

- [ ] **Step 1: Write the failing tests**

```ts
/** Takes the current context down with its device. */
const lose = (ctx: FakeAudioContext) => { ctx.stuck = true; ctx.wedge(); };

describe('createContextSink — a device that vanishes (#246)', () => {
  it('tells it to resume after the grace, then rebuilds on the same device', async () => {
    const { sink, contexts, clock, plays } = setup();
    await sink.setSinkId('usb');
    const ctx = contexts[1];
    const before = ctx.resumed;
    lose(ctx);
    clock.advance(WEDGE_GRACE_MS - 1);
    expect(ctx.resumed).toBe(before);
    clock.advance(1);
    expect(ctx.resumed).toBe(before + 1);
    clock.advance(RESUME_DEADLINE_MS);
    await flush();
    expect(contexts).toHaveLength(3);
    expect(contexts[2].sinkIds).toEqual(['usb']);
    expect(plays(contexts[2], 'a')).toBe(true);
    expect(ctx.closed).toBe(1);
  });

  it('leaves alone a context that comes back', async () => {
    const { contexts, clock } = setup();
    contexts[0].wedge();
    clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
    await flush();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].state).toBe('running');
  });

  it('a context that never ran is waiting for a gesture, not wedged', async () => {
    const { sink, contexts, clock } = setup({ state: 'suspended', prepare: (ctx) => { ctx.stuck = true; } });
    void sink.play();
    clock.advance(10_000);
    await flush();
    expect(contexts).toHaveLength(1);
  });

  it('pause() is not a wedge', async () => {
    const { sink, contexts, clock } = setup();
    sink.pause();
    await flush();
    clock.advance(10_000);
    await flush();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resumed).toBe(0);
  });

  it('stops at the cap and reports once', async () => {
    const { contexts, clock } = setup({ prepare: (ctx, i) => { if (i > 0) { ctx.state = 'suspended'; ctx.stuck = true; } } });
    lose(contexts[0]);
    for (let i = 0; i < MAX_REBUILDS + 2; i += 1) {
      clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
      await flush();
    }
    expect(contexts).toHaveLength(1 + MAX_REBUILDS);
    expect(withKey('sink:them:gave-up')).toHaveLength(1);
  });

  it('a device that is gone keeps the old context, and a later switch recovers', async () => {
    const { sink, contexts, clock, plays } = setup({ prepare: (ctx, i) => { ctx.sinkFails = i === 2; } });
    await sink.setSinkId('usb');
    lose(contexts[1]);
    clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
    await flush();
    expect(contexts[2].closed).toBe(1);
    await sink.setSinkId('speakers');
    expect(plays(contexts[contexts.length - 1], 'a')).toBe(true);
  });

  it('a context replaced by a switch is no longer watched', async () => {
    const { sink, contexts, clock } = setup();
    await sink.setSinkId('usb');
    contexts[0].stuck = true;
    contexts[0].state = 'suspended';
    contexts[0].wedge();
    clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
    await flush();
    expect(contexts).toHaveLength(2);
  });

  it('closing stops the watch', async () => {
    const { sink, contexts, clock } = setup();
    lose(contexts[0]);
    sink.srcObject = null;
    clock.advance(WEDGE_GRACE_MS + RESUME_DEADLINE_MS);
    await flush();
    expect(contexts).toHaveLength(1);
  });
});
```

`withKey(key)` filters a hoisted `reportWarningSpy`, the same mock and helper `graph.test.ts` uses (`vi.mock('../diagnostics/report', ...)`).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/audio/contextSink.test.ts -t "vanishes"`
Expected: FAIL: the context is told nothing and no rebuild happens.

- [ ] **Step 3: Implement the watch**

Same shape as `graph.ts`'s `onState`, `armDeadline` and `rebuild` (lines 390 to 415 and 418 to 475). Listen for `statechange` on the current context only, removing the listener when a context is replaced or closed. `running`: set `ran`, cancel the timers, reset `rebuilds` to 0. `suspended`, with `ran` true and not asked for by `pause()`: after `WEDGE_GRACE_MS`, if still suspended, call `resume()` (report a rejection) and arm `RESUME_DEADLINE_MS`; past that, if not running, rebuild. A rebuild past `MAX_REBUILDS` reports `gave-up` once and stops. Otherwise it counts, reports `rebuild`, calls `openOn(device)`, `adopt`s the result, calls `void next.resume()` and arms the deadline, so a new context that never runs counts as the next attempt. A rebuild takes a turn like a switch, so the newer of the two wins. A rejected `openOn` closes its context, reports through `sink:<label>:rebuild`, and leaves things for `deviceWatch` and `setSinkId`. `pause()` sets a `resting` flag that `play()` clears.

- [ ] **Step 4: Run the file**

Run: `npx vitest run src/lib/audio/contextSink.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio/contextSink.ts src/lib/audio/contextSink.test.ts
git commit -m "feat(audio): a context sink recovers from a vanished device"
```

---

### Task 4: The graph uses it

**Files:**
- Modify: `src/lib/audio/graph.ts` (header lines 1 to 11, `SinkElement` doc line 20, `GraphDeps.createSink` line 42, `toElement` line 208)
- Modify: `src/lib/audio/appAudio.ts` (`createSink`, line 153)
- Modify: `CLAUDE.md` (the outlets line, about line 150)
- Test: `src/lib/audio/graph.test.ts`, `src/lib/audio/appAudio.test.ts`, `src/lib/audio/routes.test.ts`

**Interfaces:**
- Consumes: `createContextSink(stream, deps)` from Task 1.
- Produces: `GraphDeps.createSink(stream: MediaStream, bus: Outlet): SinkElement`.

- [ ] **Step 1: Write the failing tests**

`graph.test.ts`, with `setup()`'s `createSink` recording its second argument:

```ts
it('tells createSink which bus each output is for', async () => {
  const { buses } = await setup('device');
  expect(buses).toEqual(['other', 'me', 'them', 'virtual']);
});

it('resting the graph leaves the outputs running', async () => {
  const { graph, me } = await setup();
  await graph.resume();
  await graph.suspend();
  expect(me.paused).toBe(false);
});
```

`routes.test.ts`:

```ts
it('sends passthrough to the virtual bus and nowhere else', () => {
  const on = { ...OFF, speak: ALL, meeting: true, passthrough: { on: true, ratio: 1 } };
  for (const s of [on, { ...on, faceToFace: true }, { ...on, passthrough: { on: true, ratio: 1, gate: 'held' as const } }]) {
    for (const held of [false, true]) {
      const to = routesFor(s, held).filter((e) => e.from === 'passthrough').map((e) => e.to);
      expect(to.filter((bus) => bus !== 'virtual')).toEqual([]);
    }
  }
});
```

`appAudio.test.ts`, on the `toneAudio` harness, whose `LiveContext` records every context in `live` and whose `Audio` stub is extended to count constructions:

```ts
it('gives each outlet a context and the virtual bus an element', async () => {
  const { live, audios } = await toneAudio(); // on the Electron platform, with a virtual speaker
  expect(live).toHaveLength(4); // the graph's, and other, me, them
  expect(audios).toHaveLength(1);
  expect(live[1].streamSources).toHaveLength(1);
});
```

The existing tests in this file that read `live[0]` keep working, because the graph's context is built first. Any that assert the number of contexts move from 1 to 4.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/audio/graph.test.ts src/lib/audio/appAudio.test.ts src/lib/audio/routes.test.ts`
Expected: FAIL on the bus list and the context count. The rest and passthrough tests pass already: they pin behaviour this task must not change.

- [ ] **Step 3: Pass the bus through `graph.ts`**

`createSink(stream: MediaStream, bus: Outlet): SinkElement;` and `elements[bus] ??= deps.createSink(out.stream, bus);`. Replace the header's sentences about `<audio>` with:

```
 * tap of the translated speech for the echo monitor. Each outlet leaves through
 * a context of its own (`contextSink.ts`): the browser's echo canceller takes an
 * AudioContext's output as its reference, and not an `<audio>` element's. The
 * virtual bus stays on an `<audio>` element, so the user's own voice never
 * becomes a reference. The context runs at 24 kHz, the system rate. A
```

And `SinkElement`'s doc: `/** An output: a context sink for an outlet, an `HTMLAudioElement` for the virtual bus. */`

- [ ] **Step 4: Choose by bus in `appAudio.ts`**

```ts
createSink: (stream, bus) => {
  if (bus !== 'virtual') {
    return createContextSink(stream, { label: bus, createContext: () => new AudioContext({ sampleRate: SAMPLE_RATE }) });
  }
  const element = new Audio();
  element.srcObject = stream;
  return element;
},
```

- [ ] **Step 5: Correct `CLAUDE.md`**

Replace "`graph.ts` keeps one `<audio>` element per outlet and the virtual one," with "each outlet leaves through its own `AudioContext` (`contextSink.ts`), which the echo canceller takes as a reference, and the virtual bus through an `<audio>` element,".

- [ ] **Step 6: Run the audio tests and the type check**

Run: `npx vitest run src/lib/audio && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/audio/graph.ts src/lib/audio/graph.test.ts src/lib/audio/appAudio.ts src/lib/audio/appAudio.test.ts src/lib/audio/routes.test.ts CLAUDE.md
git commit -m "fix(audio): the outlets play through contexts the echo canceller hears"
```

---

### Task 5: Verification on real machines

**Files:** none, unless a check finds a defect. A defect goes back to the task that owns the code, with a failing test first.

**Interfaces:**
- Consumes: the whole branch.
- Produces: a results table in the PR body, one row per spec check, each marked passed, failed or not run.

- [ ] **Step 1: Full suite, type check and OCR**

Run: `npx vitest run && npx tsc --noEmit && ocr review --audience agent --from origin/main --to HEAD`
Expected: all green. Answer or fix every OCR comment. Report any test that fails, even if unrelated.

- [ ] **Step 2: Ask the owner before anything leaves the machine**

Ask to push `fix/output-context-sinks` to `kizuna-ai-lab/sokuji` and open a PR into `main`. The PR's CI builds are the installers for the next steps. Stop here until the answer comes.

- [ ] **Step 3: Digital check in the real app**

On BigBlack, with the output on CABLE Input and the microphone on CABLE Output: in "Sokuji only", the translation does not come back into the transcript. In "All sounds" as well. On LittleSilver the same with SokujiVirtualAudio, which covers Electron on macOS, and on LittleBlack with the null sink and `module-remap-source` setup in `notes/sokuji.md`. Nothing is audible in these runs.

- [ ] **Step 4: Owner's checks**

Ask the owner to run spec checks 1 to 6 with speakers and a real microphone. Check 1, the original report, and check 4, unplugging a device, need someone at the machine. Record the results in the PR body.

---

## Execution notes

Tasks 1 to 3 build one file and each depends on the last. Task 4 depends only on Task 1's signature. Task 5 is not code.
