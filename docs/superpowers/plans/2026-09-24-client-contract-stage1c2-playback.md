# Client contract — Stage 1c-2: playback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The playback half of the audio layer behind plan 1c-1's `PlaybackPort`: a clip queue per leg and one for replay on one Web Audio graph, the route table (switches, and one mix gain), replay, voice preview and the test tone on the real device, the extension's virtual microphone fed from the virtual bus, and a pcm tap of the translated speech for the echo monitor — heard in the development preview. Capture is plan 1c-3.

**Architecture:** `src/lib/audio/`. A `ClipQueue` schedules clips — one speech entry each — back to back on an `AudioTimeline`. `createAudioGraph(deps)` builds one 24 kHz `AudioContext` with five feeds (speaker, participant, replay, preview, passthrough), two buses (real, virtual) that leave through `<audio>` elements (or, in the extension, a tap that feeds the tabs' virtual microphone), and a tap of the translated speech; it applies a route table as a diff of gain edges. `routesFor(settings, held)` is the pure route table. `createPlayback(graph, routing)` implements `PlaybackPort` plus replay, preview, queue positions and the tap. `appAudio.ts` composes it for the page: the worklet from the platform's URL, the virtual device by label, the routing settings read from `audioStore` and a new `routingStore`. Nothing the app runs today changes; plan 1e switches MainPanel over.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`, `allowJs` without `checkJs`, `jsx: react-jsx` — never import `React` for JSX), Web Audio (`AudioContext`, `AudioWorkletNode`, `MediaStreamAudioDestinationNode`, `HTMLAudioElement.setSinkId`), Zustand 5, vitest 4 (`globals`, jsdom — which has no Web Audio, hence the fakes below), `@testing-library/react`; plan 1a's `SAMPLE_RATE`, `Conversation`, projection; plan 1c-1's runner, `PlaybackPort`, `guardPorts`.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Playback" (Routing, The clip queue, The echo monitor keeps its three probes), "Session lifecycle" → "What may change during a run", "L1 — the data model" → "Retention", "Testing". Roadmap: `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — Task 1 here is the playback half of "Carried out of plan 1c-1" → 1c-2; its capture half moves to plan 1c-3.

## Rulings this plan makes

These settle what the spec leaves open or gets wrong. The controller records them in the roadmap when the plan lands.

1. **1c-2 splits into 1c-2 (playback) and 1c-3 (capture).** Each is about eight tasks. Playback comes first because the passthrough route and the echo monitor's reference live in its graph, and 1c-3's sources plug into them (`Playback.attachPassthrough`, `Playback.ttsTap`).
2. **A clip is one speech entry** — the spec's own words — **whole when it is enqueued.** L0 has no "this segment's audio is complete" event: `segmentClosed` marks the *text* final, and a local engine's speech for a closed segment arrives after it, so a clip spanning a segment could never be sealed correctly. So there is no `seal`, and `PlaybackPort.closed` is removed. A clip's key is `${leg}:${ref}:${index}`, `index` being the entry's position in `Segment.speech` (L1 appends one entry per `audio` event, in order); replay enqueues a segment's entries under the same keys, so karaoke reads live and replay alike. `position()` is exact against the audio clock and null in a gap; `subscribe` says *when to look*, since a pushed `{key, t}` cannot be exact without a timer.
3. **Output leaves through `<audio>` elements, on a 24 kHz context** — as `ModernAudioPlayer` does today ("AEC-visible": the browser's echo canceller sees an element's output, not a context destination's).
4. **The monitor route is `mode === 'speaker' && !isMonitorMuted`** — today's audibility rule, which keeps a whole-system participant capture from hearing the monitor. No "Level" control exists today (`setMonitorVolume` takes a boolean), so the real bus has no gain; replay, preview, the test tone and participant speech are audible whatever the monitor switch says. (Today replay is silent with the monitor off — the player's global volume is 0.)
5. **The virtual element never plays without a virtual device.** With none found, the virtual bus is silent rather than playing the meeting's audio on the user's speakers.
6. **The extension's virtual microphone receives the virtual bus as one live mixed stream** — 100 ms `PCM_DATA` messages on track `default`, near-silent chunks skipped — instead of a copy of every `addAudioData` call. Replay and the test tone never reach it: they have no route to the virtual bus.
7. **`held` is called only under push-to-translate** and means "the original-voice route is closed while held"; push-to-talk leaves passthrough alone.
8. **A refused start goes straight to idle**: no `stopping` phase and no `playback.clear()`, which would stop a replay of the kept conversation.
9. **The four voice-preview call sites are not migrated here.** They belong to providers plan 1e deletes and Stage 2 rewrites; `Playback.preview` is the route each folds into when its provider's settings component is written. The test tone has no provider, so it moves now (`AppAudio.testTone`).

**Not in this plan** (the controller adds them to the roadmap): the mic, system-audio and tab sources, the passthrough source, the echo monitor's wiring to the taps, `Source.track`, a leg's request built after its source opens, degradation through L1's throttle, the `appendAudio` hot-path guard and integer voiced samples (plan 1c-3); an output-waveform analyser for the footer and the karaoke output-latency offset (1d); the wedged-context recovery `ModernAudioPlayer._recreateContext` does today (#246), and the speaker leg's `speech` derived from its routes (1e).

## Global Constraints

- Work on branch `worktree-client-contract-refactor` in this worktree. Commit after every task. **Never push.**
- **Nothing the app runs changes.** No edit to `src/components/MainPanel/**`, `src/stores/settingsStore.ts`, `src/stores/audioStore.ts`, `src/stores/sessionStore.ts`, `src/services/**`, `src/lib/modern-audio/**`, `extension/content/**`, `electron/**` or any old client. The only edits to existing files are the ones a task names.
- `src/lib/audio/**` imports nothing from `src/stores/**` or `src/services/**`, with one exception: `src/lib/audio/appAudio.ts` (Task 7). `src/lib/session/**` keeps its rule: `appShape.ts` is its one store reader.
- No `console.*` in any new file. Failures go out through `reportError` / `reportWarning` (from `src/lib/diagnostics/report.ts`). Hot paths — per chunk, per tap message, per clip — never report per occurrence: report the ok → failing transition, or pass a `dedupeKey`.
- A clip is 24 kHz mono `Int16` (`SAMPLE_RATE` from `src/lib/contract/adapter.ts`). A preview clip carries its own rate.
- Tests assert behaviour, not copy. The development controls are found by their literal English labels (dev-only, unlocalized — plan 1b ruling R1).
- English-only comments and test names. Tests colocated next to the module.
- Conventional commit messages. Each commit ends with the implementer's own `Co-Authored-By:` attribution line (the one its harness gives it) and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`.
- Run one file with `npx vitest run <path>`; everything with `npx vitest run src` — **0 failed**. It also prints 4 unhandled rejections from `src/stores/settingsStore.nativeGate.test.ts`; those predate this branch.
- **Typecheck gate.** Run exactly:
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' \
    | grep -E '^(src/(lib/(session|audio|provider|conversation|projection|export|contract|analytics\.ts)|providers|components/(providers|dev/(SpinePreview|SessionControls))|stores/(providerStore|turnModeStore|routingStore)|utils/environment|App\.tsx))' \
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
| `src/lib/session/ports.ts` | `PlaybackPort` loses `closed`; `guardPorts` reports a failing `playback.audio` once per failing streak |
| `src/lib/session/run.ts`, `runner.ts` | `held` only under push-to-translate; refusals straight to idle |
| `src/lib/audio/clipQueue.ts` | `AudioTimeline`, `Playing`, `QueueView`, `ClipQueue`, `LEAD_S` |
| `src/lib/audio/worklets/pcm-tap-processor.js` | the AudioWorklet that hands the main thread fixed chunks of what reaches it |
| `src/lib/audio/pcmTap.ts` | `PcmTap`, `createPcmTap`, `TAP_CHUNK_SAMPLES`, `TAP_CAP_SAMPLES` |
| `src/lib/audio/tabMicrophone.ts` | `toPcmDataMessage`, `sendToTabs`, `targetTabIdFromSearch`, `TabsApi` — the extension's virtual microphone |
| `src/lib/audio/virtualSpeaker.ts` | `findVirtualSpeaker` — the Electron virtual device, by label |
| `src/lib/audio/routes.ts` | `Feed`, `Bus`, `Edge`, `RoutingSettings`, `routesFor` — the route table |
| `src/stores/routingStore.ts` | the two new switches: the meeting hears the translation (on), participant speech (off) |
| `src/lib/audio/fakeWebAudio.ts` | test support: a recording Web Audio for jsdom |
| `src/lib/audio/graph.ts` | `createAudioGraph`, `AudioGraph`, `GraphDeps`, `SinkElement`, `VirtualOutput`, `OneShot` |
| `src/lib/audio/playback.ts` | `createPlayback`, `Playback`, `RoutingSource`, `PreviewClip`, `ClipKey`, `clipKey` |
| `src/lib/audio/testTone.ts` | `testToneUrl`, `loadTestTone` |
| `src/lib/audio/appAudio.ts` | `getAppAudio`, `AppAudio`, `readRouting`, `createAppRouting` — the page's playback |
| `src/lib/session/appShape.ts` | the participant-TTS switch reaches the run's shape |
| `src/components/dev/SpinePreview.tsx`, `SessionControls.tsx` | the preview's fake session heard: replay, test tone, route switches, a playback probe |
| `scripts/dev/spine-audio-probe.mjs` | headless Chromium check that the preview's session played |
| `extension/vite.config.ts`, `.github/workflows/build.yml` | copy the tap worklet into the extension; run the new tests in CI |

---

### Task 1: The runner's playback carry-over

**Files:**
- Modify: `src/lib/session/ports.ts`, `src/lib/session/run.ts`, `src/lib/session/runner.ts`
- Modify: `src/components/dev/SpinePreview.tsx` (its stub port loses `closed`)
- Modify: `.github/workflows/build.yml`
- Test: `src/lib/session/runner.test.ts`, `src/lib/session/runner.turns.test.ts`, `src/lib/session/runner.hooks.test.ts`

**Interfaces:**
- Consumes: plan 1c-1's `PlaybackPort`, `guardPorts`, `Run`, `createRunner`.
- Produces: `PlaybackPort` = `{ audio(leg: LegName, ref: number | undefined, pcm: Int16Array): void; held(held: boolean): void; clear(): void }` — `closed` is gone (ruling 2). `held` is called only when `shape.turnMode === 'push-to-translate'` (ruling 7). A start that ends with reason `'refused'` never enters `stopping` and never calls `playback.clear()` (ruling 8).

These are the playback half of the roadmap's "Carried out of plan 1c-1" → 1c-2 list, plus the CI paths plan 1c-1 never added.

- [ ] **Step 1: Make the two vacuous tests able to fail**

In `src/lib/session/runner.test.ts`, replace the test `'a playback port that throws on audio does not reach the adapter'` with:

```ts
  it('a playback port that throws on audio does not reach the adapter', async () => {
    const audio = vi.fn(() => { throw new Error('sink gone'); });
    const { runner, clock } = setup({ playback: { audio } });
    await runner.start();
    // The exchange's first translated audio lands at 1300 ms: its block starts
    // at 500, and the translation's audio 800 ms into the block.
    clock.advance(1500);
    expect(audio).toHaveBeenCalled();
    expect(runner.state.getState().phase).toBe('running');
    expect(runner.conversation.snapshot()[0].segments.map((s) => s.side)).toEqual(['source', 'translation']);
  });
```

and the test `'an analytics port that throws neither fails a start nor skips onRunEnded'` with:

```ts
  it('an analytics port that throws neither fails a start nor skips onRunEnded', async () => {
    const onRunEnded = vi.fn();
    const { runner } = setup({ onRunEnded, track: () => { throw new Error('posthog'); } });
    await runner.start();
    expect(runner.state.getState().phase).toBe('running');
    await runner.stop();
    expect(runner.state.getState().phase).toBe('idle');
    expect(onRunEnded).toHaveBeenCalledTimes(1);
  });
```

Both pass against the current code, which already guards the ports. Prove each can fail: in `createRunner`, temporarily build `deps` as `rawDeps` instead of `{ ...rawDeps, ...guardPorts(rawDeps) }`, run `npx vitest run src/lib/session/runner.test.ts -t "guarded ports"`, and confirm both tests FAIL (the audio one with `sink gone` thrown out of `clock.advance`, the analytics one with `posthog` rejecting `start()`). Restore `createRunner`. Record both failing runs in your report.

- [ ] **Step 2: Write the failing tests for the port and the runner changes**

In `src/lib/session/runner.test.ts`:

1. In `setup()`, the playback mock loses `closed`:

```ts
  const playback = { audio: vi.fn(), held: vi.fn(), clear: vi.fn() };
```

2. Replace the test `'hands playback the translated audio and every closed segment'` with:

```ts
  it('hands playback every piece of translated audio, attributed to its segment', async () => {
    const { runner, clock, playback } = setup();
    await runner.start();
    clock.advance(5000);
    // The first exchange's translation (ref 2) speaks in three chunks.
    expect(playback.audio.mock.calls.filter(([leg, ref]) => leg === 'speaker' && ref === 2)).toHaveLength(3);
  });
```

3. Append to `describe('runner — guarded ports (F1)', …)`:

```ts
  it('reports a playback port that keeps throwing on audio once, not once per chunk', async () => {
    const audio = vi.fn(() => { throw new Error('sink gone'); });
    const { runner, clock } = setup({ playback: { audio } });
    reportErrorSpy.mockClear();
    await runner.start();
    clock.advance(10_000);
    expect(audio.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes('playback.audio'))).toHaveLength(1);
  });

  it('reports it again once it has recovered and fails anew', async () => {
    let calls = 0;
    const audio = vi.fn(() => {
      calls += 1;
      if (calls === 1 || calls === 3) throw new Error('sink gone');
    });
    const { runner, clock } = setup({ playback: { audio } });
    reportErrorSpy.mockClear();
    await runner.start();
    clock.advance(10_000);
    expect(reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes('playback.audio'))).toHaveLength(2);
  });
```

4. Append a new `describe` block:

```ts
describe('runner — a refused start', () => {
  it('goes straight back to idle: no stopping phase, and playback is left alone', async () => {
    const { runner, playback } = setup({ settings: { buildRefused: true } });
    const phases: string[] = [];
    runner.state.subscribe((s) => { phases.push(s.phase); });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused' } });
    expect(phases).not.toContain('stopping');
    expect(playback.clear).not.toHaveBeenCalled();
  });
});
```

In `src/lib/session/runner.turns.test.ts`:

1. In `setup()`, the playback mock loses `closed`:

```ts
  const playback = { audio: vi.fn(), held: vi.fn(), clear: vi.fn() };
```

2. In the test `"sends the speaker's audio only while the key is held, and ends a turn that held voice"` (push-to-talk, the setup default), replace `expect(playback.held.mock.calls).toEqual([[true], [false]]);` with:

```ts
    // Push-to-talk leaves the original-voice route alone.
    expect(playback.held).not.toHaveBeenCalled();
```

3. Append to `describe('runner — manual turns', …)`:

```ts
  it('push-to-translate closes the original-voice route while the key is held', async () => {
    const { runner, clock, sources, playback, events } = setup({ turnMode: 'push-to-translate' });
    await runner.start();
    sources[0].setVoiced(true);
    runner.press();
    expect(playback.held.mock.calls).toEqual([[true]]);
    clock.advance(600);
    runner.release();
    expect(playback.held.mock.calls).toEqual([[true], [false]]);
    expect(events('push_to_talk_used')).toEqual([{ session_id: 'run1', hold_duration_ms: 600, mode: 'push-to-translate' }]);
  });
```

4. In the test `'a stop during a hold closes the turn without ending it'`, change `setup()` to `setup({ turnMode: 'push-to-translate' })` (it asserts `held` as `[[true], [false]]`, which only push-to-translate now produces). In the test `'a playback port that throws on held still stops every source when Stop lands during a hold (F1)'`, add `turnMode: 'push-to-translate'` to its `setup({ … })` options — under push-to-talk `held` is never called and the test would pass vacuously.

In `src/lib/session/runner.hooks.test.ts`, the playback literal loses `closed`:

```ts
    playback: { audio: () => {}, held: () => {}, clear: () => {} },
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/lib/session`
Expected: FAIL — the push-to-talk test sees `held` called; `reports … once, not once per chunk` sees 5 reports; `reports it again …` sees 2 reports already (it passes, which is fine — it pins the reset); the refused test sees `stopping` in `phases` and `clear` called. TypeScript is not checked by vitest, so the removed `closed` shows up only in the typecheck gate after Step 4.

- [ ] **Step 4: Implement**

`src/lib/session/ports.ts` — replace `PlaybackPort` and `guardPorts`:

```ts
/** Where a run's audio goes; plan 1c-2's `Playback` (src/lib/audio/playback.ts) implements it. */
export interface PlaybackPort {
  /**
   * One piece of a leg's translated audio: one clip, which is one speech entry
   * of the segment `ref` names (absent: it names none).
   */
  audio(leg: LegName, ref: number | undefined, pcm: Int16Array): void;
  /** Push-to-translate only: the original-voice route is closed while the key is held. */
  held(held: boolean): void;
  /** The run ended or the conversation was cleared: stop, and drop what is queued. */
  clear(): void;
}
```

```ts
/**
 * The caller's ports, each method guarded: a port that throws is reported
 * once per method (a dedupe key) and never reaches the run or an adapter.
 */
export function guardPorts(deps: RunnerDeps): Pick<RunnerDeps, 'playback' | 'analytics'> {
  const report = (name: string, error: unknown) =>
    reportError('SessionRunner', `The ${name} port threw: ${describeCause(error)}`, { cause: error, dedupeKey: `port:${name}` });
  const guard = <A extends unknown[]>(name: string, fn: (...args: A) => void) => (...args: A): void => {
    try {
      fn(...args);
    } catch (error) {
      report(name, error);
    }
  };
  const { playback, analytics } = deps;
  // Audio arrives per chunk: report when the port starts failing, not on every
  // chunk after, so a dead sink costs one console line per failing streak.
  let audioFailing = false;
  return {
    playback: {
      audio: (leg: LegName, ref: number | undefined, pcm: Int16Array) => {
        try {
          playback.audio(leg, ref, pcm);
          audioFailing = false;
        } catch (error) {
          if (!audioFailing) report('playback.audio', error);
          audioFailing = true;
        }
      },
      held: guard('playback.held', (held: boolean) => playback.held(held)),
      clear: guard('playback.clear', () => playback.clear()),
    },
    analytics: { track: guard('analytics.track', (event, properties) => analytics.track(event, properties)) as AnalyticsPort['track'] },
  };
}
```

`src/lib/session/run.ts`:

- In `onEvent`, delete the `case 'segmentClosed':` branch (its two lines); `segmentClosed` now falls through to `default`.
- Add a private method after `sendText`:

```ts
  /** Push-to-translate closes the original-voice route while the key is held; push-to-talk leaves it alone. */
  private hold(held: boolean): void {
    if (this.shape.turnMode === 'push-to-translate') this.deps.playback.held(held);
  }
```

- In `press()`, replace `this.deps.playback.held(true);` with `this.hold(true);`. In `release()`, replace `this.deps.playback.held(false);` with `this.hold(false);`. In `close()`, replace `if (this.turn?.close()) this.deps.playback.held(false);` with `if (this.turn?.close()) this.hold(false);`.

`src/lib/session/runner.ts`, in `end()` — replace the body of the `try` block up to and including `await run.close();` with:

```ts
        // A refused start opened nothing and played nothing: straight back to
        // idle, leaving a replay of the kept conversation playing.
        const refused = result.reason === 'refused';
        if (!refused) set({ phase: 'stopping' });
        // Captured before `run.close()`, so teardown time (a hung release,
        // the bounded wait for fill-in) is never counted as session duration.
        const endedAt = deps.clock.now();
        // Stop speaking now; the port is guarded, so a throw here cannot keep the run open.
        if (!refused) deps.playback.clear();
        await run.close();
```

(the rest of `end()` is unchanged).

`src/components/dev/SpinePreview.tsx` — its stub becomes `playback: { audio: () => {}, held: () => {}, clear: () => {} },` (Task 8 replaces it).

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/lib/session src/components/dev`
Expected: PASS.

- [ ] **Step 6: Run the new spine's tests in CI**

In `.github/workflows/build.yml`, in the step `Run diagnostics, log-surface, local-inference and client-contract tests`, add `src/lib/session` after `src/lib/export`, add `src/stores/turnModeStore.test.ts` after `src/stores/providerStore.readiness.test.ts`, and replace `src/components/dev/SpinePreview.test.tsx` with `src/components/dev`. Then run exactly the step's command locally:

```bash
npx vitest run src/lib/diagnostics src/lib/errorTracking.test.ts src/stores/logStore.test.ts src/stores/sanitizeEvent.test.ts src/components/LogsPanel src/lib/local-inference src/lib/contract src/lib/conversation src/lib/projection src/lib/export src/lib/session src/lib/provider src/providers src/stores/providerStore.test.ts src/stores/providerStore.readiness.test.ts src/stores/turnModeStore.test.ts src/components/providers src/components/dev src/utils/featureGateForwarding.consistency.test.ts
```

Expected: PASS.

- [ ] **Step 7: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. Run the typecheck gate — the four baseline lines only.

- [ ] **Step 8: Commit**

```bash
git add src/lib/session src/components/dev/SpinePreview.tsx .github/workflows/build.yml
git commit -m "fix(session): hold passthrough only for push-to-translate, refuse straight to idle, report a failing sink once"
```

---

### Task 2: The clip queue

**Files:**
- Create: `src/lib/audio/clipQueue.ts`
- Test: `src/lib/audio/clipQueue.test.ts`
- Modify: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `SAMPLE_RATE` (`src/lib/contract/adapter.ts`), `reportError`, `describeCause`.
- Produces: `interface AudioTimeline { now(): number; play(pcm: Int16Array, at: number, onEnded: () => void): () => void }` (seconds); `interface Playing<K extends string = string> { key: K; t: number }` (`t` in ms); `interface QueueView<K> { position(): Playing<K> | null; readonly pending: number; subscribe(listener: () => void): () => void }`; `class ClipQueue<K extends string = string> implements QueueView<K>` with `constructor(timeline: AudioTimeline, leadS = LEAD_S)`, `enqueue(key: K, pcm: Int16Array): void`, `clear(): void`; `LEAD_S = 0.05`.

A clip is one speech entry, whole when enqueued (ruling 2). Clips play back to back in enqueue order; a clip enqueued while the queue is idle starts one lead ahead of the clock. The queue keeps no pcm: the timeline holds a clip until it ends, and L1 keeps the durable copy.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/clipQueue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SAMPLE_RATE } from '../contract/adapter';
import { ClipQueue, LEAD_S, type AudioTimeline } from './clipQueue';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

/** A timeline the test moves by hand; a clip ends once the clock passes its end, or when stopped. */
function fakeTimeline() {
  let now = 0;
  const plays: Array<{ pcm: Int16Array; at: number; onEnded: () => void; stopped: boolean; done: boolean }> = [];
  const timeline: AudioTimeline = {
    now: () => now,
    play(pcm, at, onEnded) {
      const play = { pcm, at, onEnded, stopped: false, done: false };
      plays.push(play);
      return () => {
        play.stopped = true;
        if (!play.done) {
          play.done = true;
          play.onEnded();
        }
      };
    },
  };
  const advance = (seconds: number) => {
    now += seconds;
    for (const play of plays) {
      if (!play.done && play.at + play.pcm.length / SAMPLE_RATE <= now) {
        play.done = true;
        play.onEnded();
      }
    }
  };
  return { timeline, plays, advance };
}

/** `ms` milliseconds of pcm. */
const pcm = (ms: number) => new Int16Array((SAMPLE_RATE * ms) / 1000);

describe('ClipQueue', () => {
  it('plays clips back to back in the order they were enqueued, the first one lead ahead of the clock', () => {
    const { timeline, plays } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(200));
    queue.enqueue('b', pcm(100));
    expect(plays.map((p) => p.at)).toEqual([LEAD_S, LEAD_S + 0.2]);
    expect(queue.pending).toBe(2);
  });

  it('says which clip plays and how far into it, and null before it starts and once it has ended', () => {
    const { timeline, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(200));
    expect(queue.position()).toBeNull();
    advance(LEAD_S + 0.05);
    expect(queue.position()?.key).toBe('a');
    expect(queue.position()?.t).toBeCloseTo(50, 6);
    advance(0.2);
    expect(queue.position()).toBeNull();
    expect(queue.pending).toBe(0);
  });

  it('moves to the next clip at the boundary', () => {
    const { timeline, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(100));
    queue.enqueue('b', pcm(100));
    advance(LEAD_S + 0.15);
    expect(queue.position()?.key).toBe('b');
    expect(queue.position()?.t).toBeCloseTo(50, 6);
  });

  it('is null in a gap: a clip enqueued after the queue drained starts one lead ahead of the clock, not at the old tail', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(100));
    advance(1);
    expect(queue.position()).toBeNull();
    queue.enqueue('b', pcm(100));
    expect(plays[1].at).toBeCloseTo(1 + LEAD_S, 9);
  });

  it('tells subscribers when a clip is enqueued and when one ends', () => {
    const { timeline, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    const heard = vi.fn();
    const off = queue.subscribe(heard);
    queue.enqueue('a', pcm(100));
    expect(heard).toHaveBeenCalledTimes(1);
    advance(1);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    queue.enqueue('b', pcm(100));
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('clear stops every clip, drops them, tells subscribers once, and the next clip starts fresh', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', pcm(500));
    queue.enqueue('b', pcm(500));
    advance(LEAD_S + 0.1);
    const heard = vi.fn();
    queue.subscribe(heard);
    queue.clear();
    expect(plays.every((p) => p.stopped)).toBe(true);
    expect(queue.pending).toBe(0);
    expect(queue.position()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    queue.enqueue('c', pcm(100));
    expect(plays[2].at).toBeCloseTo(LEAD_S + 0.1 + LEAD_S, 9);
  });

  it('ignores an empty clip', () => {
    const { timeline, plays } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    queue.enqueue('a', new Int16Array(0));
    expect(plays).toHaveLength(0);
    expect(queue.pending).toBe(0);
  });

  it('a subscriber that throws is reported and does not keep the next from hearing', () => {
    const { timeline } = fakeTimeline();
    const queue = new ClipQueue(timeline);
    reportErrorSpy.mockClear();
    queue.subscribe(() => { throw new Error('buggy karaoke'); });
    const heard = vi.fn();
    queue.subscribe(heard);
    queue.enqueue('a', pcm(100));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/clipQueue.test.ts`
Expected: FAIL — `Failed to resolve import "./clipQueue"`.

- [ ] **Step 3: Implement**

`src/lib/audio/clipQueue.ts`:

```ts
/**
 * The clip queue (spec: "Playback" → "The clip queue"). A clip is one speech
 * entry — one `audio` event's pcm — so it is whole when it is enqueued: L0
 * has no "this segment's audio is complete" event (`segmentClosed` marks the
 * text final, and a local engine's speech for a closed segment arrives after
 * it), so a clip spanning a segment could never be sealed. Clips play back to
 * back in the order they were enqueued. The queue keeps no pcm: the timeline
 * holds a clip until it ends, and L1's `speech[].pcm` is the durable copy.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import { describeCause, reportError } from '../diagnostics/report';

/** The clock a queue schedules on: the graph's `AudioContext` in the app, a fake in tests. Seconds. */
export interface AudioTimeline {
  now(): number;
  /**
   * Plays 24 kHz mono pcm from `at`. `onEnded` fires once, when it has played
   * out or been stopped; the returned function stops it.
   */
  play(pcm: Int16Array, at: number, onEnded: () => void): () => void;
}

/** What a queue is playing: which clip, and how far into it. */
export interface Playing<K extends string = string> {
  key: K;
  /** Milliseconds into the clip, on the audio clock. */
  t: number;
}

/** A read-only view of a queue, for karaoke and the playing indicator. */
export interface QueueView<K extends string = string> {
  /** Exact, against the audio clock; null in a gap and when idle. */
  position(): Playing<K> | null;
  /** How many clips are scheduled or playing. */
  readonly pending: number;
  /** Called when a clip is enqueued, a clip ends, or the queue is cleared: time to read `position()` again. */
  subscribe(listener: () => void): () => void;
}

/** How far ahead of the clock a clip is scheduled when the queue is idle: absorbs main-thread jitter. */
export const LEAD_S = 0.05;

interface Scheduled<K> {
  key: K;
  at: number;
  end: number;
  stop: () => void;
  done: boolean;
}

export class ClipQueue<K extends string = string> implements QueueView<K> {
  private clips: Scheduled<K>[] = [];
  /** When the last scheduled clip ends: the next one starts there, or one lead ahead of the clock if that has passed. */
  private tail = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly timeline: AudioTimeline, private readonly leadS = LEAD_S) {}

  enqueue(key: K, pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const at = Math.max(this.timeline.now() + this.leadS, this.tail);
    const clip: Scheduled<K> = { key, at, end: at + pcm.length / SAMPLE_RATE, stop: () => {}, done: false };
    this.tail = clip.end;
    this.clips.push(clip);
    clip.stop = this.timeline.play(pcm, at, () => this.finish(clip));
    this.notify();
  }

  /** Stops what plays and drops what is queued. */
  clear(): void {
    const clips = this.clips;
    this.clips = [];
    this.tail = 0;
    for (const clip of clips) {
      clip.done = true;
      clip.stop();
    }
    if (clips.length > 0) this.notify();
  }

  position(): Playing<K> | null {
    const now = this.timeline.now();
    const clip = this.clips.find((c) => c.at <= now && now < c.end);
    return clip ? { key: clip.key, t: (now - clip.at) * 1000 } : null;
  }

  get pending(): number {
    return this.clips.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private finish(clip: Scheduled<K>): void {
    if (clip.done) return;
    clip.done = true;
    this.clips = this.clips.filter((c) => c !== clip);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        reportError('ClipQueue', `A queue subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'clipQueue:subscriber' });
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio/clipQueue.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: CI**

In `.github/workflows/build.yml`'s client-contract test step, add `src/lib/audio` after `src/lib/session`.

- [ ] **Step 6: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 7: Commit**

```bash
git add src/lib/audio .github/workflows/build.yml
git commit -m "feat(audio): a clip queue — one speech entry per clip, positions on the audio clock"
```

---
### Task 3: The taps and the virtual devices

**Files:**
- Create: `src/lib/audio/worklets/pcm-tap-processor.js`, `src/lib/audio/pcmTap.ts`, `src/lib/audio/tabMicrophone.ts`, `src/lib/audio/virtualSpeaker.ts`
- Test: `src/lib/audio/pcmTapProcessor.test.ts`, `src/lib/audio/pcmTap.test.ts`, `src/lib/audio/tabMicrophone.test.ts`, `src/lib/audio/virtualSpeaker.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_RATE`.
- Produces:
  - The worklet `pcm-tap-processor` (`processorOptions: { chunk: number }`): posts a `Float32Array` of `chunk` samples each time that many frames have reached its input; an input with nothing connected counts as silence.
  - `interface PcmTap { read(): Float32Array }`; `interface PcmTapBuffer extends PcmTap { push(chunk: Float32Array): void }`; `createPcmTap(cap = TAP_CAP_SAMPLES): PcmTapBuffer`; `TAP_CHUNK_SAMPLES = 2400` (100 ms); `TAP_CAP_SAMPLES = 720000` (30 s).
  - `interface PcmDataMessage { type: 'PCM_DATA'; pcmData: number[]; chunkIndex: 0; totalChunks: 1; sampleRate: number; trackId: 'default'; timestamp: number }`; `toPcmDataMessage(chunk: Float32Array, timestamp: number): PcmDataMessage | null`; `SILENT_MEAN = 0.003`; `interface Tab { id?: number; url?: string }`; `interface TabsApi { get(tabId: number, callback: (tab?: Tab) => void): void; query(info: Record<string, never>, callback: (tabs: Tab[]) => void): void; sendMessage(tabId: number, message: unknown, callback: () => void): void; lastError(): unknown }`; `sendToTabs(tabs: TabsApi, targetTabId: number | null, message: unknown): void`; `targetTabIdFromSearch(search: string): number | null`.
  - `findVirtualSpeaker(outputs: readonly { deviceId: string; label: string }[]): string | undefined`.

The graph's two taps — the translated speech for the echo monitor, and the extension's virtual bus — are one worklet. The tabs' virtual microphone keeps its wire format (`extension/content/virtual-microphone.js` reads `PCM_DATA` messages, 24 kHz `Int16` as numbers) and its routing (the side panel's `?tabId=`, else every web tab), taken from `ModernBrowserAudioService.sendPcmDataToTabs` (`src/lib/modern-audio/ModernBrowserAudioService.ts:529-655`). What changes (ruling 6): it receives one live mix in 100 ms messages, the near-silent ones skipped as today's passthrough skip does. The virtual speaker's labels come from `detectAndSetVirtualSpeaker` (same file, `:364-396`).

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/pcmTapProcessor.test.ts`:

```ts
import { beforeAll, describe, it, expect, vi } from 'vitest';

interface TapProcessor {
  port: { posted: Float32Array[] };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
let Tap: new (options?: { processorOptions?: { chunk?: number } }) => TapProcessor;

beforeAll(async () => {
  vi.stubGlobal('AudioWorkletProcessor', class {
    port = {
      posted: [] as Float32Array[],
      postMessage(message: Float32Array) { this.posted.push(message); },
    };
  });
  vi.stubGlobal('registerProcessor', (name: string, ctor: typeof Tap) => {
    if (name === 'pcm-tap-processor') Tap = ctor;
  });
  await import('./worklets/pcm-tap-processor.js');
});

const quantum = (value: number) => new Float32Array(128).fill(value);

describe('pcm-tap-processor', () => {
  it('posts a chunk each time `chunk` frames have arrived', () => {
    const tap = new Tap({ processorOptions: { chunk: 256 } });
    tap.process([[quantum(0.5)]], [[new Float32Array(128)]]);
    expect(tap.port.posted).toHaveLength(0);
    tap.process([[quantum(0.25)]], [[new Float32Array(128)]]);
    expect(tap.port.posted).toHaveLength(1);
    expect(tap.port.posted[0]).toHaveLength(256);
    expect(tap.port.posted[0][0]).toBe(0.5);
    expect(tap.port.posted[0][255]).toBe(0.25);
  });

  it('counts an input with nothing connected as silence, so the tap stays clocked', () => {
    const tap = new Tap({ processorOptions: { chunk: 256 } });
    tap.process([[]], [[new Float32Array(128)]]);
    tap.process([[]], [[new Float32Array(128)]]);
    expect(tap.port.posted).toHaveLength(1);
    expect(tap.port.posted[0].every((s) => s === 0)).toBe(true);
  });

  it('keeps running', () => {
    const tap = new Tap({ processorOptions: { chunk: 256 } });
    expect(tap.process([[quantum(0)]], [[new Float32Array(128)]])).toBe(true);
  });
});
```

`src/lib/audio/pcmTap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createPcmTap, TAP_CAP_SAMPLES, TAP_CHUNK_SAMPLES } from './pcmTap';

describe('createPcmTap', () => {
  it('hands back everything pushed since the last read, oldest first, then nothing', () => {
    const tap = createPcmTap();
    tap.push(Float32Array.of(1, 2));
    tap.push(Float32Array.of(3));
    expect([...tap.read()]).toEqual([1, 2, 3]);
    expect(tap.read()).toHaveLength(0);
  });

  it('keeps only the newest `cap` samples', () => {
    const tap = createPcmTap(4);
    tap.push(Float32Array.of(1, 2, 3));
    tap.push(Float32Array.of(4, 5, 6));
    expect([...tap.read()]).toEqual([3, 4, 5, 6]);
  });

  it('chunks are 100 ms and the cap is thirty seconds, at 24 kHz', () => {
    expect(TAP_CHUNK_SAMPLES).toBe(2400);
    expect(TAP_CAP_SAMPLES).toBe(720_000);
  });
});
```

`src/lib/audio/tabMicrophone.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { sendToTabs, targetTabIdFromSearch, toPcmDataMessage, type TabsApi } from './tabMicrophone';

describe('toPcmDataMessage', () => {
  it("turns a chunk into the page microphone's PCM_DATA message, as 16-bit samples", () => {
    expect(toPcmDataMessage(Float32Array.of(0.5, -0.5, 1, -2), 42)).toEqual({
      type: 'PCM_DATA',
      pcmData: [16384, -16384, 32767, -32768],
      chunkIndex: 0,
      totalChunks: 1,
      sampleRate: 24000,
      trackId: 'default',
      timestamp: 42,
    });
  });

  it('skips a near-silent chunk, and an empty one', () => {
    expect(toPcmDataMessage(new Float32Array(2400).fill(0.002), 0)).toBeNull();
    expect(toPcmDataMessage(new Float32Array(0), 0)).toBeNull();
  });
});

function fakeTabs(tabs: Array<{ id?: number; url?: string }>, missing: number[] = []) {
  const sent: Array<[number, unknown]> = [];
  let lastError: unknown;
  // Like Chrome, `lastError` describes only the call whose callback is running.
  const api: TabsApi = {
    get(tabId, callback) {
      lastError = missing.includes(tabId) ? { message: 'No tab with id' } : undefined;
      callback(missing.includes(tabId) ? undefined : tabs.find((t) => t.id === tabId));
    },
    query(_info, callback) {
      lastError = undefined;
      callback(tabs);
    },
    sendMessage(tabId, message, callback) {
      lastError = undefined;
      sent.push([tabId, message]);
      callback();
    },
    lastError: () => lastError,
  };
  return { api, sent };
}

describe('sendToTabs', () => {
  const tabs = [
    { id: 1, url: 'https://meet.google.com/abc' },
    { id: 2, url: 'chrome://extensions' },
    { id: 3, url: 'chrome-extension://x/fullpage.html' },
    { id: 4, url: 'https://zoom.us/j/1' },
    { id: 5 },
  ];

  it('sends to the target tab only', () => {
    const { api, sent } = fakeTabs(tabs);
    sendToTabs(api, 4, 'm');
    expect(sent).toEqual([[4, 'm']]);
  });

  it('sends to every web tab when there is no target, or the target is gone', () => {
    const none = fakeTabs(tabs);
    sendToTabs(none.api, null, 'm');
    expect(none.sent).toEqual([[1, 'm'], [4, 'm']]);
    const gone = fakeTabs(tabs, [9]);
    sendToTabs(gone.api, 9, 'm');
    expect(gone.sent).toEqual([[1, 'm'], [4, 'm']]);
  });

  it('reads lastError inside every send callback, so Chrome never logs it as unchecked', () => {
    const { api } = fakeTabs([{ id: 1, url: 'https://a.example' }]);
    const lastError = vi.spyOn(api, 'lastError');
    sendToTabs(api, null, 'm');
    // Once in the query callback, once in the send callback.
    expect(lastError).toHaveBeenCalledTimes(2);
  });
});

describe('targetTabIdFromSearch', () => {
  it("reads the side panel's ?tabId=", () => {
    expect(targetTabIdFromSearch('?tabId=17')).toBe(17);
    expect(targetTabIdFromSearch('?preview=spine')).toBeNull();
    expect(targetTabIdFromSearch('?tabId=abc')).toBeNull();
  });
});
```

`src/lib/audio/virtualSpeaker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findVirtualSpeaker } from './virtualSpeaker';

const device = (deviceId: string, label: string) => ({ deviceId, label });

describe('findVirtualSpeaker', () => {
  it("prefers Linux's sink, then macOS's driver, then VB-CABLE", () => {
    expect(findVirtualSpeaker([
      device('cable', 'CABLE Input (VB-Audio Virtual Cable)'),
      device('mac', 'SokujiVirtualAudio'),
      device('linux', 'Sokuji_Virtual_Speaker'),
    ])).toBe('linux');
    expect(findVirtualSpeaker([device('cable', 'CABLE Input'), device('mac', 'SokujiVirtualAudio')])).toBe('mac');
    expect(findVirtualSpeaker([device('speakers', 'Speakers'), device('cable', 'Cable Input')])).toBe('cable');
  });

  it('finds none among ordinary devices', () => {
    expect(findVirtualSpeaker([device('speakers', 'Speakers'), device('hdmi', 'HDMI Output')])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio`
Expected: FAIL — the four new modules do not exist.

- [ ] **Step 3: Implement**

`src/lib/audio/worklets/pcm-tap-processor.js` (plain JavaScript: it runs in the AudioWorklet scope, where `AudioWorkletProcessor` and `registerProcessor` are globals; `tsconfig` has `allowJs` without `checkJs`, so it is not type-checked):

```js
/**
 * Hands the main thread what reaches this node, in fixed chunks of mono float
 * samples at the context's rate. An input with nothing connected counts as
 * silence, so a tap stays clocked while nothing plays (the echo monitor
 * correlates against wall time).
 */
class PcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const chunk = options && options.processorOptions && options.processorOptions.chunk;
    this.chunk = chunk || 2400;
    this.buffer = new Float32Array(this.chunk);
    this.filled = 0;
  }

  process(inputs, outputs) {
    const channel = inputs[0] && inputs[0][0];
    const frames = channel ? channel.length : (outputs[0] && outputs[0][0] ? outputs[0][0].length : 128);
    for (let i = 0; i < frames; i++) {
      this.buffer[this.filled++] = channel ? channel[i] : 0;
      if (this.filled === this.chunk) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.chunk);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-tap-processor', PcmTapProcessor);
```

`src/lib/audio/pcmTap.ts`:

```ts
/**
 * A tap's buffer on the main thread (spec: "The echo monitor keeps its three
 * probes" — the sink exposes a pcm tap). The worklet pushes chunks; the
 * reader drains whatever arrived since its last read.
 */
import { SAMPLE_RATE } from '../contract/adapter';

/** 100 ms: the tap worklet's chunk, and one tabs message. */
export const TAP_CHUNK_SAMPLES = SAMPLE_RATE / 10;

/** Thirty seconds, today's `createPlayedAudioTap` read cap. */
export const TAP_CAP_SAMPLES = 30 * SAMPLE_RATE;

/** What a tap heard since the last read. */
export interface PcmTap {
  /** Mono float samples at 24 kHz, oldest first; at most the tap's cap (older samples are dropped). */
  read(): Float32Array;
}

export interface PcmTapBuffer extends PcmTap {
  push(chunk: Float32Array): void;
}

export function createPcmTap(cap = TAP_CAP_SAMPLES): PcmTapBuffer {
  let chunks: Float32Array[] = [];
  let length = 0;
  return {
    push(chunk) {
      chunks.push(chunk);
      length += chunk.length;
      // Drop whole chunks while what is left still fills the cap.
      while (chunks.length > 1 && length - chunks[0].length >= cap) length -= chunks.shift()!.length;
    },
    read() {
      const out = new Float32Array(Math.min(length, cap));
      // Newest first, so the oldest chunk is the one cut when it straddles the cap.
      let offset = out.length;
      for (let i = chunks.length - 1; i >= 0 && offset > 0; i--) {
        const chunk = chunks[i];
        const take = Math.min(chunk.length, offset);
        out.set(chunk.subarray(chunk.length - take), offset - take);
        offset -= take;
      }
      chunks = [];
      length = 0;
      return out;
    },
  };
}
```

`src/lib/audio/tabMicrophone.ts`:

```ts
/**
 * The extension's virtual microphone. The virtual bus's tap hands over 100 ms
 * chunks; each one that is not near-silent becomes one `PCM_DATA` message in
 * the format the page-side microphone (`extension/content/virtual-microphone.js`)
 * reads, sent to the meeting tab the side panel was opened for, or to every web
 * tab — the wire format and routing of `ModernBrowserAudioService.sendPcmDataToTabs`.
 */
import { SAMPLE_RATE } from '../contract/adapter';

/** Mean absolute amplitude below which a chunk is not sent (≈ −50 dBFS, today's passthrough skip). */
export const SILENT_MEAN = 0.003;

export interface PcmDataMessage {
  type: 'PCM_DATA';
  pcmData: number[];
  chunkIndex: 0;
  totalChunks: 1;
  sampleRate: number;
  trackId: 'default';
  timestamp: number;
}

export function toPcmDataMessage(chunk: Float32Array, timestamp: number): PcmDataMessage | null {
  if (chunk.length === 0) return null;
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += Math.abs(chunk[i]);
  if (sum / chunk.length < SILENT_MEAN) return null;
  const pcmData = new Array<number>(chunk.length);
  for (let i = 0; i < chunk.length; i++) {
    const s = Math.max(-1, Math.min(1, chunk[i]));
    pcmData[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return { type: 'PCM_DATA', pcmData, chunkIndex: 0, totalChunks: 1, sampleRate: SAMPLE_RATE, trackId: 'default', timestamp };
}

export interface Tab {
  id?: number;
  url?: string;
}

/** The part of `chrome.tabs` this uses (the repo's own `chrome` typing lacks `get` and `sendMessage`), and `chrome.runtime.lastError`. */
export interface TabsApi {
  get(tabId: number, callback: (tab?: Tab) => void): void;
  query(info: Record<string, never>, callback: (tabs: Tab[]) => void): void;
  sendMessage(tabId: number, message: unknown, callback: () => void): void;
  /** Read inside a callback; reading it is what keeps Chrome from logging it as unchecked. */
  lastError(): unknown;
}

/** The side panel's `?tabId=` names the meeting tab it was opened for. */
export function targetTabIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('tabId');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Sends one message to the target tab or, when there is none or it is gone,
 * to every web tab. Send errors are ignored: not every tab has the content
 * script, and this runs ten times a second.
 */
export function sendToTabs(tabs: TabsApi, targetTabId: number | null, message: unknown): void {
  const checked = () => { void tabs.lastError(); };
  const toAll = () => tabs.query({}, (all) => {
    if (tabs.lastError() || !all) return;
    for (const tab of all) {
      // Chrome's own pages and extension pages never carry the content script.
      if (tab.id === undefined || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
      tabs.sendMessage(tab.id, message, checked);
    }
  });
  if (targetTabId === null) {
    toAll();
    return;
  }
  tabs.get(targetTabId, (tab) => {
    if (tabs.lastError() || !tab) {
      toAll();
      return;
    }
    tabs.sendMessage(targetTabId, message, checked);
  });
}
```

`src/lib/audio/virtualSpeaker.ts`:

```ts
/**
 * The output device a meeting app hears as a microphone (Electron), found by
 * label in today's order: Linux's PulseAudio sink, macOS's driver, Windows'
 * VB-CABLE (`ModernBrowserAudioService.detectAndSetVirtualSpeaker`).
 */
export function findVirtualSpeaker(outputs: readonly { deviceId: string; label: string }[]): string | undefined {
  const match = outputs.find((d) => d.label.includes('Sokuji_Virtual_Speaker'))
    ?? outputs.find((d) => d.label.includes('SokujiVirtualAudio'))
    ?? outputs.find((d) => d.label.toUpperCase().includes('CABLE'));
  return match?.deviceId;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio
git commit -m "feat(audio): a pcm tap worklet, the tabs' virtual microphone and the virtual speaker by label"
```

---

### Task 4: The route table and its two new switches

**Files:**
- Create: `src/lib/audio/routes.ts`, `src/stores/routingStore.ts`
- Modify: `src/lib/session/appShape.ts`, `.github/workflows/build.yml`
- Test: `src/lib/audio/routes.test.ts`, `src/stores/routingStore.test.ts`, `src/lib/session/appShape.test.ts`

**Interfaces:**
- Produces:
  - `type Feed = 'speaker' | 'participant' | 'replay' | 'preview' | 'passthrough'`; `type Bus = 'real' | 'virtual'`; `interface Edge { from: Feed; to: Bus; gain: number }`; `interface RoutingSettings { meeting: boolean; monitor: boolean; participantSpeech: boolean; passthrough: { on: boolean; ratio: number }; sinks: { real?: string; virtual?: string } }`; `routesFor(s: RoutingSettings, held: boolean): Edge[]`.
  - `useRoutingStore` with `{ meeting: boolean /* default true */; participantSpeech: boolean /* default false */; load(): Promise<void>; setMeeting(on: boolean): void; setParticipantSpeech(on: boolean): void }`, persisted at `settings.routing.meeting` and `settings.routing.participantSpeech`.
  - `readShapeFromStores` fills `participantSpeech` from `useRoutingStore`.

The spec's route table ("Playback" → "Routing") as data: a route is a switch; passthrough's ratio is the one mix gain; replay and preview (the test tone is a preview) are fixed routes to the real device. Push-to-translate's hold closes the passthrough route (ruling 7). The two switches that did not exist before get a store of their own; the monitor switch and passthrough stay in `audioStore`, where they live today, and Task 7 reads them there.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { routesFor, type RoutingSettings } from './routes';

const OFF: RoutingSettings = {
  meeting: false,
  monitor: false,
  participantSpeech: false,
  passthrough: { on: false, ratio: 0.2 },
  sinks: {},
};

describe('routesFor', () => {
  it('always routes replay and preview to the real device, and nothing into the meeting', () => {
    expect(routesFor(OFF, false)).toEqual([
      { from: 'replay', to: 'real', gain: 1 },
      { from: 'preview', to: 'real', gain: 1 },
    ]);
  });

  it("routes the speaker's translation to the meeting and to the monitor, each by its own switch", () => {
    expect(routesFor({ ...OFF, meeting: true }, false)).toContainEqual({ from: 'speaker', to: 'virtual', gain: 1 });
    expect(routesFor({ ...OFF, meeting: true }, false)).not.toContainEqual(expect.objectContaining({ from: 'speaker', to: 'real' }));
    expect(routesFor({ ...OFF, monitor: true }, false)).toContainEqual({ from: 'speaker', to: 'real', gain: 1 });
  });

  it("routes the participant's translation to the real device only with the opt-in, and never into the meeting", () => {
    expect(routesFor(OFF, false).some((e) => e.from === 'participant')).toBe(false);
    const on = routesFor({ ...OFF, participantSpeech: true }, false).filter((e) => e.from === 'participant');
    expect(on).toEqual([{ from: 'participant', to: 'real', gain: 1 }]);
  });

  it('mixes passthrough into the meeting at its ratio, and closes it while push-to-translate is held', () => {
    const s = { ...OFF, passthrough: { on: true, ratio: 0.3 } };
    expect(routesFor(s, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.3 });
    expect(routesFor(s, true).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor({ ...s, passthrough: { on: true, ratio: 0 } }, false).some((e) => e.from === 'passthrough')).toBe(false);
    expect(routesFor({ ...s, passthrough: { on: false, ratio: 0.3 } }, false).some((e) => e.from === 'passthrough')).toBe(false);
  });

  it('caps the ratio at unity', () => {
    expect(routesFor({ ...OFF, passthrough: { on: true, ratio: 3 } }, false)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 1 });
  });
});
```

`src/stores/routingStore.test.ts`:

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

import { useRoutingStore } from './routingStore';

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  useRoutingStore.setState({ meeting: true, participantSpeech: false });
});

describe('routingStore', () => {
  it('lets the meeting hear the translation and keeps participant speech off, until something was saved', async () => {
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: true, participantSpeech: false });
    stored.set('settings.routing.meeting', false);
    stored.set('settings.routing.participantSpeech', true);
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: true });
  });

  it('ignores a saved value that is not a boolean', async () => {
    stored.set('settings.routing.meeting', 'yes');
    await useRoutingStore.getState().load();
    expect(useRoutingStore.getState().meeting).toBe(true);
  });

  it('saves each switch', async () => {
    useRoutingStore.getState().setMeeting(false);
    useRoutingStore.getState().setParticipantSpeech(true);
    expect(useRoutingStore.getState()).toMatchObject({ meeting: false, participantSpeech: true });
    await vi.waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith('settings.routing.meeting', false);
      expect(setSetting).toHaveBeenCalledWith('settings.routing.participantSpeech', true);
    });
  });
});
```

In `src/lib/session/appShape.test.ts`: add `import { useRoutingStore } from '../../stores/routingStore';` beside the other store imports; add `useRoutingStore.setState({ participantSpeech: false });` to its `beforeEach`; append to `describe('readShapeFromStores', …)`:

```ts
  it('freezes the participant-TTS switch', () => {
    useProviderStore.setState({
      selected: 'fake',
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
    });
    useRoutingStore.setState({ participantSpeech: true });
    expect(readShapeFromStores(auth)?.participantSpeech).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/routes.test.ts src/stores/routingStore.test.ts src/lib/session/appShape.test.ts`
Expected: FAIL — `./routes` and `./routingStore` do not exist; the shape still reads `participantSpeech: false`.

- [ ] **Step 3: Implement**

`src/lib/audio/routes.ts`:

```ts
/**
 * The route table (spec: "Playback" → "Routing"). Three things, three
 * natures: a route is a switch; the one mix gain is passthrough's ratio (only
 * the virtual device carries a deliberate mix, translation with the original
 * voice underneath); nothing else has a volume.
 */

/** What plays. The test tone is a preview. */
export type Feed = 'speaker' | 'participant' | 'replay' | 'preview' | 'passthrough';

/** Where it goes: the user's output device, or the one the meeting hears. */
export type Bus = 'real' | 'virtual';

export interface Edge {
  from: Feed;
  to: Bus;
  gain: number;
}

export interface RoutingSettings {
  /** Speaker translation → the virtual device: the meeting hears it. On by default (new). */
  meeting: boolean;
  /** Speaker translation → the real device: the user monitors it. */
  monitor: boolean;
  /** Participant translation → the real device: the participant-TTS opt-in, off by default. */
  participantSpeech: boolean;
  /** The microphone → the virtual device, under the translation, at `ratio` (0–1). */
  passthrough: { on: boolean; ratio: number };
  /** Output device ids: the monitor device, and the virtual speaker where one exists (Electron). */
  sinks: { real?: string; virtual?: string };
}

/** Every edge the settings ask for. `held`: push-to-translate's key is down, which closes the original-voice route. */
export function routesFor(s: RoutingSettings, held: boolean): Edge[] {
  // Replay and preview are fixed routes to the real device, never into the meeting.
  const edges: Edge[] = [
    { from: 'replay', to: 'real', gain: 1 },
    { from: 'preview', to: 'real', gain: 1 },
  ];
  if (s.meeting) edges.push({ from: 'speaker', to: 'virtual', gain: 1 });
  if (s.monitor) edges.push({ from: 'speaker', to: 'real', gain: 1 });
  if (s.participantSpeech) edges.push({ from: 'participant', to: 'real', gain: 1 });
  if (s.passthrough.on && !held && s.passthrough.ratio > 0) {
    edges.push({ from: 'passthrough', to: 'virtual', gain: Math.min(1, s.passthrough.ratio) });
  }
  return edges;
}
```

`src/stores/routingStore.ts`:

```ts
/**
 * The two routing switches that did not exist before plan 1c-2 (spec:
 * "Playback" → "Routing"): whether the meeting hears the speaker's
 * translation (on by default), and the participant-TTS opt-in (off). The
 * monitor switch and passthrough stay in `audioStore`, where they live today.
 */
import { create } from 'zustand';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

const MEETING = 'settings.routing.meeting';
const PARTICIPANT_SPEECH = 'settings.routing.participantSpeech';

interface RoutingStore {
  meeting: boolean;
  participantSpeech: boolean;
  load(): Promise<void>;
  setMeeting(on: boolean): void;
  setParticipantSpeech(on: boolean): void;
}

export const useRoutingStore = create<RoutingStore>()((set) => ({
  meeting: true,
  participantSpeech: false,
  async load() {
    const settings = ServiceFactory.getSettingsService();
    const [meeting, participantSpeech] = await Promise.all([
      settings.getSetting(MEETING, true),
      settings.getSetting(PARTICIPANT_SPEECH, false),
    ]);
    set({
      meeting: typeof meeting === 'boolean' ? meeting : true,
      participantSpeech: typeof participantSpeech === 'boolean' ? participantSpeech : false,
    });
  },
  setMeeting(on) {
    set({ meeting: on });
    void persistSetting(MEETING, on);
  },
  setParticipantSpeech(on) {
    set({ participantSpeech: on });
    void persistSetting(PARTICIPANT_SPEECH, on);
  },
}));
```

`src/lib/session/appShape.ts` — add `import { useRoutingStore } from '../../stores/routingStore';` beside the other store imports, and replace these two lines:

```ts
    // The participant-TTS switch arrives with plan 1c-2's routing.
    participantSpeech: false,
```

with:

```ts
    participantSpeech: useRoutingStore.getState().participantSpeech,
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio/routes.test.ts src/stores/routingStore.test.ts src/lib/session/appShape.test.ts`
Expected: PASS.

- [ ] **Step 5: CI**

In `.github/workflows/build.yml`'s client-contract test step, add `src/stores/routingStore.test.ts` after `src/stores/turnModeStore.test.ts`.

- [ ] **Step 6: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 7: Commit**

```bash
git add src/lib/audio/routes.ts src/lib/audio/routes.test.ts src/stores/routingStore.ts src/stores/routingStore.test.ts src/lib/session/appShape.ts src/lib/session/appShape.test.ts .github/workflows/build.yml
git commit -m "feat(audio): the route table, and switches for the meeting hearing the translation and participant speech"
```

---
### Task 5: The graph

**Files:**
- Create: `src/lib/audio/fakeWebAudio.ts` (test support), `src/lib/audio/graph.ts`
- Test: `src/lib/audio/graph.test.ts`

**Interfaces:**
- Consumes: `AudioTimeline` (Task 2); `createPcmTap`, `PcmTap`, `TAP_CHUNK_SAMPLES` (Task 3); `Bus`, `Edge`, `Feed` (Task 4); `SAMPLE_RATE`; `reportWarning`, `describeCause`.
- Produces:
  - `interface SinkElement { srcObject: MediaProvider | null; readonly paused: boolean; setSinkId?(sinkId: string): Promise<void>; play(): Promise<void>; pause(): void }` (an `HTMLAudioElement` satisfies it).
  - `type VirtualOutput = { kind: 'device' } | { kind: 'tabs'; send(chunk: Float32Array): void } | { kind: 'none' }`.
  - `interface GraphDeps { context: AudioContext; addTapModule(context: AudioContext): Promise<void>; createTapNode(context: AudioContext, chunk: number): AudioWorkletNode; createSink(stream: MediaStream): SinkElement; virtual: VirtualOutput }`.
  - `interface OneShot { readonly ended: Promise<void>; stop(): void }`.
  - `interface AudioGraph { timeline(feed: 'speaker' | 'participant' | 'replay'): AudioTimeline; playOnce(audio: Float32Array, sampleRate: number): OneShot; route(edges: readonly Edge[]): void; setSinks(sinks: { real?: string; virtual?: string }): Promise<void>; attachPassthrough(stream: MediaStream): () => void; readonly ttsTap: PcmTap; resume(): Promise<void>; close(): Promise<void> }`.
  - `createAudioGraph(deps: GraphDeps): Promise<AudioGraph>`.
  - Test support in `fakeWebAudio.ts`: `FakeAudioContext` (`currentTime`, `state`, `destination`, `sources`, `destinations`, `streamSources`, `resumed`, `closed`, `advance(seconds)`, `asContext()`), `FakeNode`, `FakeGain`, `FakeBuffer`, `FakeBufferSource`, `FakeStreamDestination`, `FakeStreamSource`, `FakeWorkletNode` (`chunk`, `emit(chunk)`), `FakeSink`, `reaches(from, to)`.

One graph for everything the app plays. Five feeds; two buses; the route table applied as a diff of gain edges — an edge is a `GainNode` between a feed and a bus, so the passthrough ratio is its gain and a switch is whether it exists. The real bus and Electron's virtual bus each leave through an `<audio>` element fed by a `MediaStreamAudioDestinationNode` (ruling 3); the extension's virtual bus ends in a tap whose chunks go to the tabs; the web build has no virtual bus. The virtual element plays only once it points at a virtual device (ruling 5). The speaker, participant and replay feeds also feed the tts tap, before any route: the echo monitor's reference, what `ModernAudioPlayer.createPlayedAudioTap` reads today — the translated speech, never passthrough. Taps are pulled through a muted path to the context's destination.

jsdom has no Web Audio, so the graph's tests run against `fakeWebAudio.ts`: nodes record their connections, and `reaches(from, to)` asks whether audio can flow between two nodes. The real graph is heard in Task 8.

- [ ] **Step 1: Write the test support**

`src/lib/audio/fakeWebAudio.ts`:

```ts
/**
 * Just enough of Web Audio for the graph's tests under jsdom, which has none:
 * nodes record their connections, buffer sources end on a clock the test
 * advances, and sinks record the device they point at. Test support only —
 * nothing in the app imports it.
 */
let nextStream = 0;

export class FakeNode {
  readonly outputs = new Set<FakeNode>();

  connect<T extends FakeNode>(to: T): T {
    this.outputs.add(to);
    return to;
  }

  disconnect(to?: FakeNode): void {
    if (to) this.outputs.delete(to);
    else this.outputs.clear();
  }
}

export class FakeGain extends FakeNode {
  readonly gain = {
    value: 1,
    setValueAtTime(value: number): void {
      this.value = value;
    },
  };
}

export class FakeBuffer {
  private readonly data: Float32Array;

  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(_channel: number): Float32Array {
    return this.data;
  }
}

export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;

  constructor(private readonly context: FakeAudioContext) {
    super();
  }

  start(at = 0): void {
    this.startedAt = Math.max(at, this.context.currentTime);
  }

  stop(): void {
    this.stopped = true;
  }
}

export class FakeStreamDestination extends FakeNode {
  readonly stream = { id: `stream${++nextStream}` } as unknown as MediaStream;
}

export class FakeStreamSource extends FakeNode {
  constructor(readonly mediaStream: MediaStream) {
    super();
  }
}

export class FakeWorkletNode extends FakeNode {
  readonly port: { onmessage: ((event: { data: Float32Array }) => void) | null; postMessage(): void } = {
    onmessage: null,
    postMessage() {},
  };

  constructor(readonly name: string, readonly chunk: number) {
    super();
  }

  /** Delivers a chunk as the worklet would. */
  emit(chunk: Float32Array): void {
    this.port.onmessage?.({ data: chunk });
  }
}

export class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  readonly sampleRate = 24000;
  readonly destination = new FakeNode();
  readonly sources: FakeBufferSource[] = [];
  readonly destinations: FakeStreamDestination[] = [];
  readonly streamSources: FakeStreamSource[] = [];
  resumed = 0;
  closed = false;

  createGain(): FakeGain {
    return new FakeGain();
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource(this);
    this.sources.push(source);
    return source;
  }

  createMediaStreamDestination(): FakeStreamDestination {
    const destination = new FakeStreamDestination();
    this.destinations.push(destination);
    return destination;
  }

  createMediaStreamSource(stream: MediaStream): FakeStreamSource {
    const source = new FakeStreamSource(stream);
    this.streamSources.push(source);
    return source;
  }

  async resume(): Promise<void> {
    this.resumed += 1;
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
  }

  /** Moves the audio clock, ending every started source that has played out or been stopped. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const source of this.sources) {
      const { buffer, onended, startedAt } = source;
      if (!onended || !buffer || startedAt === null) continue;
      if (source.stopped || startedAt + buffer.duration <= this.currentTime) {
        source.onended = null;
        onended();
      }
    }
  }

  /** As the graph's code sees it. */
  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

export class FakeSink {
  sinkId = '';
  paused = true;
  plays = 0;

  constructor(public srcObject: MediaProvider | null) {}

  async setSinkId(sinkId: string): Promise<void> {
    this.sinkId = sinkId;
  }

  async play(): Promise<void> {
    this.plays += 1;
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

/** Whether audio can flow from `from` to `to` through the recorded connections. */
export function reaches(from: FakeNode, to: FakeNode): boolean {
  const seen = new Set<FakeNode>();
  const walk = (node: FakeNode): boolean => {
    if (node === to) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    for (const next of node.outputs) if (walk(next)) return true;
    return false;
  };
  return walk(from);
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/audio/graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  FakeAudioContext, FakeSink, FakeWorkletNode, reaches, type FakeBufferSource, type FakeGain, type FakeNode,
} from './fakeWebAudio';
import { createAudioGraph } from './graph';

async function setup(virtual: 'device' | 'tabs' | 'none' = 'device') {
  const ctx = new FakeAudioContext();
  const sinks: FakeSink[] = [];
  const taps: FakeWorkletNode[] = [];
  const sent: Float32Array[] = [];
  const graph = await createAudioGraph({
    context: ctx.asContext(),
    addTapModule: async () => {},
    createTapNode: (_context, chunk) => {
      const node = new FakeWorkletNode('pcm-tap-processor', chunk);
      taps.push(node);
      return node as unknown as AudioWorkletNode;
    },
    createSink: (stream) => {
      const sink = new FakeSink(stream);
      sinks.push(sink);
      return sink;
    },
    virtual: virtual === 'tabs' ? { kind: 'tabs', send: (chunk) => { sent.push(chunk); } } : { kind: virtual },
  });
  // The real element is created first, then the virtual one (Electron).
  const [real, virtualSink] = sinks;
  const destinationOf = (sink: FakeSink): FakeNode => ctx.destinations.find((d) => d.stream === sink.srcObject)!;
  /** Plays a clip into a feed; returns its source node. */
  const clip = (feed: 'speaker' | 'participant' | 'replay'): FakeBufferSource => {
    graph.timeline(feed).play(new Int16Array(2400), 0, () => {});
    return ctx.sources[ctx.sources.length - 1];
  };
  return { ctx, graph, sinks, real, virtualSink, taps, sent, destinationOf, clip };
}

describe('createAudioGraph — routes', () => {
  it("sends the speaker's translation only where the edges say", async () => {
    const { graph, real, virtualSink, destinationOf, clip } = await setup();
    graph.route([{ from: 'speaker', to: 'virtual', gain: 1 }]);
    const source = clip('speaker');
    expect(reaches(source, destinationOf(virtualSink))).toBe(true);
    expect(reaches(source, destinationOf(real))).toBe(false);
    graph.route([{ from: 'speaker', to: 'real', gain: 1 }]);
    expect(reaches(source, destinationOf(virtualSink))).toBe(false);
    expect(reaches(source, destinationOf(real))).toBe(true);
  });

  it('applies a diff: a changed gain is updated in place, a missing edge is disconnected', async () => {
    const { ctx, graph } = await setup();
    graph.attachPassthrough({} as MediaStream);
    const feed = [...ctx.streamSources[0].outputs][0];
    const edge = () => [...feed.outputs][0] as FakeGain;
    graph.route([{ from: 'passthrough', to: 'virtual', gain: 0.2 }]);
    const first = edge();
    expect(first.gain.value).toBe(0.2);
    graph.route([{ from: 'passthrough', to: 'virtual', gain: 0.4 }]);
    expect(edge()).toBe(first);
    expect(first.gain.value).toBe(0.4);
    graph.route([]);
    expect(feed.outputs.size).toBe(0);
  });

  it('ignores an edge to a bus this platform lacks (the web build has no virtual device)', async () => {
    const { graph, sinks, real, destinationOf, clip } = await setup('none');
    expect(sinks).toHaveLength(1);
    graph.route([{ from: 'speaker', to: 'virtual', gain: 1 }]);
    expect(reaches(clip('speaker'), destinationOf(real))).toBe(false);
  });

  it("sends the extension's virtual bus to the tabs", async () => {
    const { graph, taps, sent, clip } = await setup('tabs');
    // The tts tap is created first, then the virtual bus's.
    const virtualTap = taps[1];
    graph.route([{ from: 'speaker', to: 'virtual', gain: 1 }]);
    expect(reaches(clip('speaker'), virtualTap)).toBe(true);
    virtualTap.emit(Float32Array.of(0.5));
    expect(sent).toEqual([Float32Array.of(0.5)]);
  });
});

describe('createAudioGraph — outputs', () => {
  it('plays the real element from the start, on the monitor device once one is set', async () => {
    const { graph, real } = await setup();
    expect(real.paused).toBe(false);
    await graph.setSinks({ real: 'monitor-1' });
    expect(real.sinkId).toBe('monitor-1');
  });

  it('keeps the virtual element silent until it points at a virtual device, and silent again without one', async () => {
    const { graph, virtualSink } = await setup();
    expect(virtualSink.paused).toBe(true);
    await graph.setSinks({ virtual: 'cable-1' });
    expect(virtualSink.sinkId).toBe('cable-1');
    expect(virtualSink.paused).toBe(false);
    await graph.setSinks({ virtual: undefined });
    expect(virtualSink.paused).toBe(true);
  });

  it('keeps the virtual element silent when pointing it at its device fails', async () => {
    const { graph, virtualSink } = await setup();
    virtualSink.setSinkId = async () => { throw new Error('NotFoundError'); };
    await graph.setSinks({ virtual: 'cable-1' });
    expect(virtualSink.paused).toBe(true);
  });

  it('resume() resumes a suspended context and restarts a paused real element', async () => {
    const { ctx, graph, real, virtualSink } = await setup();
    ctx.state = 'suspended';
    real.pause();
    await graph.resume();
    expect(ctx.resumed).toBe(1);
    expect(real.paused).toBe(false);
    expect(virtualSink.paused).toBe(true);
  });

  it('close() pauses the outputs and closes the context', async () => {
    const { ctx, graph, real } = await setup();
    await graph.close();
    expect(real.paused).toBe(true);
    expect(real.srcObject).toBeNull();
    expect(ctx.closed).toBe(true);
  });
});

describe('createAudioGraph — the tts tap', () => {
  it('hears the translated speech whatever the routes, and not the preview or passthrough', async () => {
    const { ctx, graph, taps, clip } = await setup();
    const ttsTap = taps[0];
    expect(reaches(clip('speaker'), ttsTap)).toBe(true);
    expect(reaches(clip('participant'), ttsTap)).toBe(true);
    expect(reaches(clip('replay'), ttsTap)).toBe(true);
    graph.playOnce(new Float32Array(10), 48000);
    expect(reaches(ctx.sources[ctx.sources.length - 1], ttsTap)).toBe(false);
    graph.attachPassthrough({} as MediaStream);
    expect(reaches(ctx.streamSources[0], ttsTap)).toBe(false);
  });

  it('hands the reader what the worklet posts', async () => {
    const { graph, taps } = await setup();
    taps[0].emit(Float32Array.of(0.5, 0.25));
    taps[0].emit(Float32Array.of(0.125));
    expect([...graph.ttsTap.read()]).toEqual([0.5, 0.25, 0.125]);
  });

  it('asks the worklet for 100 ms chunks, and pulls both taps through a muted path', async () => {
    const { ctx, taps } = await setup('tabs');
    expect(taps.map((t) => t.chunk)).toEqual([2400, 2400]);
    for (const tap of taps) expect(reaches(tap, ctx.destination)).toBe(true);
  });
});

describe('createAudioGraph — clips', () => {
  it('writes a clip at 24 kHz, and ends it once: on its end, or on stop', async () => {
    const { ctx, graph } = await setup();
    let ended = 0;
    graph.timeline('speaker').play(Int16Array.of(16384, -16384), 0, () => { ended += 1; });
    const source = ctx.sources[0];
    expect(source.buffer!.sampleRate).toBe(24000);
    expect([...source.buffer!.getChannelData(0)]).toEqual([0.5, -0.5]);
    ctx.advance(1);
    expect(ended).toBe(1);
    const stop = graph.timeline('speaker').play(new Int16Array(24000), 5, () => { ended += 1; });
    stop();
    stop();
    ctx.advance(10);
    expect(ended).toBe(2);
    expect(ctx.sources[1].stopped).toBe(true);
  });

  it('plays a one-shot at its own rate and resolves when it ends', async () => {
    const { ctx, graph } = await setup();
    const shot = graph.playOnce(new Float32Array(4800), 48000);
    expect(ctx.sources[0].buffer!.sampleRate).toBe(48000);
    ctx.advance(0.2);
    await expect(shot.ended).resolves.toBeUndefined();
  });

  it('an empty one-shot has ended already and plays nothing', async () => {
    const { ctx, graph } = await setup();
    await expect(graph.playOnce(new Float32Array(0), 48000).ended).resolves.toBeUndefined();
    expect(ctx.sources).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/graph.test.ts`
Expected: FAIL — `Failed to resolve import "./graph"`.

- [ ] **Step 4: Implement**

`src/lib/audio/graph.ts`:

```ts
/**
 * One Web Audio graph for everything the app plays (spec: "Playback"): five
 * feeds, two buses, the route table applied as a diff of gain edges, and a
 * tap of the translated speech for the echo monitor. Output leaves through
 * `<audio>` elements, as `ModernAudioPlayer`'s does today, so the browser's
 * echo canceller sees it; the context runs at 24 kHz, the system rate.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import { describeCause, reportWarning } from '../diagnostics/report';
import type { AudioTimeline } from './clipQueue';
import { createPcmTap, TAP_CHUNK_SAMPLES, type PcmTap } from './pcmTap';
import type { Bus, Edge, Feed } from './routes';

/** An output element: an `HTMLAudioElement` in the app. */
export interface SinkElement {
  srcObject: MediaProvider | null;
  readonly paused: boolean;
  setSinkId?(sinkId: string): Promise<void>;
  play(): Promise<void>;
  pause(): void;
}

/** Where the virtual bus goes on this platform. */
export type VirtualOutput =
  | { kind: 'device' }
  | { kind: 'tabs'; send(chunk: Float32Array): void }
  | { kind: 'none' };

export interface GraphDeps {
  context: AudioContext;
  /** Loads `pcm-tap-processor` into the context; its URL differs by platform. */
  addTapModule(context: AudioContext): Promise<void>;
  createTapNode(context: AudioContext, chunk: number): AudioWorkletNode;
  createSink(stream: MediaStream): SinkElement;
  /** Electron: a virtual speaker device. Extension: the tabs' virtual microphone. Web: none. */
  virtual: VirtualOutput;
}

export interface OneShot {
  /** Resolves when it has played out or been stopped. */
  readonly ended: Promise<void>;
  stop(): void;
}

export interface AudioGraph {
  timeline(feed: 'speaker' | 'participant' | 'replay'): AudioTimeline;
  /** Plays a clip at its own rate on the preview feed. */
  playOnce(audio: Float32Array, sampleRate: number): OneShot;
  /** Makes the edges exactly these; an edge to a bus this platform lacks is ignored. */
  route(edges: readonly Edge[]): void;
  /** Points each bus's element at a device; the virtual one stays silent until it has one. */
  setSinks(sinks: { real?: string; virtual?: string }): Promise<void>;
  /** Feeds a capture into the passthrough feed; returns the detach. */
  attachPassthrough(stream: MediaStream): () => void;
  /** The translated speech the graph plays (speaker, participant, replay), before any route: the echo monitor's reference. */
  readonly ttsTap: PcmTap;
  /** Resumes a suspended context and restarts an output the browser paused (autoplay). */
  resume(): Promise<void>;
  close(): Promise<void>;
}

export async function createAudioGraph(deps: GraphDeps): Promise<AudioGraph> {
  const ctx = deps.context;
  await deps.addTapModule(ctx);
  const gain = (value = 1): GainNode => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };

  // A tap is processed only when the render graph pulls it: each one ends in
  // this muted path to the destination, which the user never hears.
  const muted = gain(0);
  muted.connect(ctx.destination);
  const taps: AudioWorkletNode[] = [];
  const tapInto = (from: AudioNode, onChunk: (chunk: Float32Array) => void) => {
    const node = deps.createTapNode(ctx, TAP_CHUNK_SAMPLES);
    from.connect(node);
    node.connect(muted);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => onChunk(event.data);
    taps.push(node);
  };

  const feeds: Record<Feed, GainNode> = {
    speaker: gain(), participant: gain(), replay: gain(), preview: gain(), passthrough: gain(),
  };

  // The echo reference: the translated speech, before any route (never
  // passthrough, which is the microphone itself). Built before the virtual bus.
  const tts = gain();
  feeds.speaker.connect(tts);
  feeds.participant.connect(tts);
  feeds.replay.connect(tts);
  const ttsTap = createPcmTap();
  tapInto(tts, (chunk) => ttsTap.push(chunk));

  const buses: Partial<Record<Bus, GainNode>> = {};
  const elements: Partial<Record<Bus, SinkElement>> = {};
  const toElement = (bus: Bus) => {
    const node = gain();
    const out = ctx.createMediaStreamDestination();
    node.connect(out);
    buses[bus] = node;
    elements[bus] = deps.createSink(out.stream);
  };
  toElement('real');
  const virtual = deps.virtual;
  if (virtual.kind === 'device') toElement('virtual');
  if (virtual.kind === 'tabs') {
    const node = gain();
    buses.virtual = node;
    tapInto(node, (chunk) => virtual.send(chunk));
  }

  const sinkIds: Partial<Record<Bus, string>> = {};
  const play = (bus: Bus) => {
    const element = elements[bus];
    // The virtual element plays only once it points at a virtual device:
    // otherwise the meeting's audio would play on the user's speakers.
    if (!element || !element.paused || (bus === 'virtual' && !sinkIds.virtual)) return;
    element.play().catch((error: unknown) =>
      reportWarning('AudioGraph', `The ${bus} output did not start: ${describeCause(error)}`, { dedupeKey: `graph:play:${bus}` }));
  };
  play('real');

  /** Starts a buffer into `into`; `onEnded` fires once, on its end or on stop. */
  const start = (buffer: AudioBuffer, into: AudioNode, at: number, onEnded: () => void): (() => void) => {
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(into);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      node.disconnect();
      onEnded();
    };
    node.onended = finish;
    node.start(at);
    return () => {
      if (done) return;
      node.stop();
      finish();
    };
  };

  const edges = new Map<string, { from: Feed; node: GainNode }>();

  return {
    timeline: (feed) => ({
      now: () => ctx.currentTime,
      play(pcm, at, onEnded) {
        const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
        return start(buffer, feeds[feed], at, onEnded);
      },
    }),

    playOnce(audio, sampleRate) {
      if (audio.length === 0) return { ended: Promise.resolve(), stop: () => {} };
      const buffer = ctx.createBuffer(1, audio.length, sampleRate);
      buffer.getChannelData(0).set(audio);
      let resolve!: () => void;
      const ended = new Promise<void>((r) => { resolve = r; });
      const stop = start(buffer, feeds.preview, ctx.currentTime, resolve);
      return { ended, stop };
    },

    route(next) {
      const wanted = new Map<string, Edge>();
      for (const edge of next) if (buses[edge.to]) wanted.set(`${edge.from}>${edge.to}`, edge);
      for (const [id, edge] of edges) {
        if (wanted.has(id)) continue;
        feeds[edge.from].disconnect(edge.node);
        edge.node.disconnect();
        edges.delete(id);
      }
      for (const [id, edge] of wanted) {
        const existing = edges.get(id);
        if (existing) {
          existing.node.gain.setValueAtTime(edge.gain, ctx.currentTime);
          continue;
        }
        const node = gain(edge.gain);
        feeds[edge.from].connect(node);
        node.connect(buses[edge.to]!);
        edges.set(id, { from: edge.from, node });
      }
    },

    async setSinks(sinks) {
      for (const bus of ['real', 'virtual'] as const) {
        const element = elements[bus];
        const id = sinks[bus];
        if (!element || id === sinkIds[bus]) continue;
        sinkIds[bus] = id;
        if (bus === 'virtual' && !id) {
          element.pause();
          continue;
        }
        try {
          await element.setSinkId?.(id ?? '');
        } catch (error) {
          reportWarning('AudioGraph', `Could not switch the ${bus} output: ${describeCause(error)}`, { dedupeKey: `graph:sink:${bus}` });
          if (bus === 'virtual') {
            // Never play the meeting's audio on whatever device the element was left on.
            sinkIds.virtual = undefined;
            element.pause();
            continue;
          }
        }
        play(bus);
      }
    },

    attachPassthrough(stream) {
      const source = ctx.createMediaStreamSource(stream);
      source.connect(feeds.passthrough);
      return () => source.disconnect();
    },

    ttsTap,

    async resume() {
      if (ctx.state === 'suspended') await ctx.resume();
      play('real');
      play('virtual');
    },

    async close() {
      for (const element of Object.values(elements)) {
        element.pause();
        element.srcObject = null;
      }
      for (const tap of taps) tap.port.onmessage = null;
      await ctx.close();
    },
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio`
Expected: PASS.

- [ ] **Step 6: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 7: Commit**

```bash
git add src/lib/audio
git commit -m "feat(audio): one graph — five feeds, two buses, routes as gain edges, a tap of the translated speech"
```

---

### Task 6: Playback, and the test tone

**Files:**
- Create: `src/lib/audio/playback.ts`, `src/lib/audio/testTone.ts`
- Test: `src/lib/audio/playback.test.ts`, `src/lib/audio/testTone.test.ts`

**Interfaces:**
- Consumes: `PlaybackPort` (Task 1); `ClipQueue`, `QueueView`, `LEAD_S` (Task 2); `createPcmTap`, `PcmTap` (Task 3); `routesFor`, `RoutingSettings`, `Edge` (Task 4); `AudioGraph`, `OneShot` (Task 5); `LegName`, `Segment`, `EMPTY_PCM` (`src/lib/conversation/types.ts`).
- Produces:
  - `type ClipKey = \`${LegName}:${number | 'none'}:${number}\``; `clipKey(leg: LegName, ref: number | undefined, index: number): ClipKey`.
  - `interface RoutingSource { get(): RoutingSettings; subscribe(listener: () => void): () => void }`.
  - `interface PreviewClip { audio: Float32Array; sampleRate: number }`.
  - `interface Playback extends PlaybackPort { readonly queues: Readonly<Record<'speaker' | 'participant' | 'replay', QueueView<ClipKey>>>; replay(leg: LegName, segment: Segment): void; stopReplay(): void; preview(clip: PreviewClip): Promise<void>; stopPreview(): void; attachPassthrough(stream: MediaStream): () => void; readonly ttsTap: PcmTap; dispose(): Promise<void> }`.
  - `createPlayback(graph: AudioGraph, routing: RoutingSource): Playback`.
  - `testToneUrl(): string`; `loadTestTone(context: BaseAudioContext, fetchImpl?: typeof fetch, url?: string): Promise<PreviewClip>`.

Everything the app plays, behind the runner's port. Each leg's audio goes to its own queue as one clip per `audio` call (ruling 2); a clip's key counts the calls per `${leg}:${ref}`, which is the speech entry's index because L1 appends one entry per `audio` event, in order — and `clear()` restarts the count, as L1's `clear()` empties every segment's speech. Replay plays a segment's kept speech entry by entry on its own queue, under the same keys; entries whose pcm retention dropped are skipped but still counted. A preview is one clip at a time on the real device. Routes and sinks are applied at once and on every routing change; `held` re-applies them with the passthrough route closed. The graph is resumed before anything plays (autoplay).

The test tone (spec routing: a fixed route to the real device) moves out of MainPanel's `playTestTone` (`src/components/MainPanel/MainPanel.tsx:3640-3765`): the bundled `test-tone.mp3`, decoded, mixed to one channel, 10% under full scale; it keeps its own rate, since a preview plays at any rate.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/playback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SAMPLE_RATE } from '../contract/adapter';
import { EMPTY_PCM, type Segment } from '../conversation/types';
import { LEAD_S } from './clipQueue';
import type { AudioGraph } from './graph';
import { createPcmTap } from './pcmTap';
import { createPlayback, type RoutingSource } from './playback';
import { routesFor, type Edge, type RoutingSettings } from './routes';

/** A graph whose timelines the test moves by hand, and which records routes, sinks and one-shots. */
function fakeGraph() {
  let now = 0;
  let resumed = 0;
  const plays: Array<{ feed: string; pcm: Int16Array; at: number; onEnded: () => void; done: boolean }> = [];
  const routes: Edge[][] = [];
  const sinks: Array<{ real?: string; virtual?: string }> = [];
  const shots: Array<{ audio: Float32Array; sampleRate: number; stopped: boolean; end: () => void }> = [];
  const graph: AudioGraph = {
    timeline: (feed) => ({
      now: () => now,
      play(pcm, at, onEnded) {
        const play = { feed, pcm, at, onEnded, done: false };
        plays.push(play);
        return () => {
          if (play.done) return;
          play.done = true;
          onEnded();
        };
      },
    }),
    playOnce(audio, sampleRate) {
      let end!: () => void;
      const ended = new Promise<void>((resolve) => { end = resolve; });
      const shot = { audio, sampleRate, stopped: false, end };
      shots.push(shot);
      return { ended, stop: () => { shot.stopped = true; end(); } };
    },
    route: (edges) => { routes.push([...edges]); },
    setSinks: async (s) => { sinks.push(s); },
    attachPassthrough: () => () => {},
    ttsTap: createPcmTap(),
    resume: async () => { resumed += 1; },
    close: async () => {},
  };
  const advance = (seconds: number) => {
    now += seconds;
    for (const play of plays) {
      if (!play.done && play.at + play.pcm.length / SAMPLE_RATE <= now) {
        play.done = true;
        play.onEnded();
      }
    }
  };
  return { graph, plays, routes, sinks, shots, advance, resumed: () => resumed };
}

const ROUTING: RoutingSettings = {
  meeting: true,
  monitor: false,
  participantSpeech: false,
  passthrough: { on: true, ratio: 0.2 },
  sinks: { real: 'monitor-1' },
};

function routing(initial: RoutingSettings = ROUTING) {
  let settings = initial;
  const listeners = new Set<() => void>();
  const source: RoutingSource = {
    get: () => settings,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const set = (patch: Partial<RoutingSettings>) => {
    settings = { ...settings, ...patch };
    for (const listener of listeners) listener();
  };
  return { source, set };
}

/** `ms` milliseconds of pcm. */
const pcm = (ms: number) => new Int16Array((SAMPLE_RATE * ms) / 1000);

function translation(ref: number, speech: Segment['speech']): Segment {
  return { id: `s:speaker:${ref}`, ref, side: 'translation', text: 'こんにちは', final: true, openedAt: 0, marks: [], speech };
}

describe('createPlayback — live audio', () => {
  it("queues each leg's audio as its own clip, keyed by leg, segment and speech entry", () => {
    const { graph, plays, advance } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', 2, pcm(100));
    playback.audio('speaker', 2, pcm(100));
    playback.audio('participant', 5, pcm(100));
    expect(plays.map((p) => p.feed)).toEqual(['speaker', 'speaker', 'participant']);
    advance(LEAD_S + 0.01);
    expect(playback.queues.speaker.position()?.key).toBe('speaker:2:0');
    expect(playback.queues.participant.position()?.key).toBe('participant:5:0');
    advance(0.1);
    expect(playback.queues.speaker.position()?.key).toBe('speaker:2:1');
  });

  it('keys audio that names no segment with none', () => {
    const { graph, advance } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', undefined, pcm(100));
    advance(LEAD_S + 0.01);
    expect(playback.queues.speaker.position()?.key).toBe('speaker:none:0');
  });

  it('resumes the graph before it plays (autoplay)', () => {
    const { graph, resumed } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', 2, pcm(100));
    expect(resumed()).toBeGreaterThan(0);
  });

  it('clear stops both legs and the replay, and restarts the speech entry count', () => {
    const { graph, plays, advance } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.audio('speaker', 2, pcm(100));
    playback.audio('participant', 5, pcm(100));
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }]));
    playback.clear();
    expect(plays.every((p) => p.done)).toBe(true);
    playback.audio('speaker', 2, pcm(100));
    advance(LEAD_S + 0.01);
    expect(playback.queues.speaker.position()?.key).toBe('speaker:2:0');
  });
});

describe('createPlayback — routes', () => {
  it('applies the route table and the sinks at once, and again whenever the routing changes', () => {
    const { graph, routes, sinks } = fakeGraph();
    const r = routing();
    createPlayback(graph, r.source);
    expect(routes).toEqual([routesFor(ROUTING, false)]);
    expect(sinks).toEqual([{ real: 'monitor-1' }]);
    r.set({ monitor: true });
    expect(routes[1]).toContainEqual({ from: 'speaker', to: 'real', gain: 1 });
  });

  it("closes passthrough while push-to-translate's key is held", () => {
    const { graph, routes } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.held(true);
    expect(routes.at(-1)!.some((e) => e.from === 'passthrough')).toBe(false);
    playback.held(false);
    expect(routes.at(-1)).toContainEqual({ from: 'passthrough', to: 'virtual', gain: 0.2 });
    const count = routes.length;
    playback.held(false);
    expect(routes).toHaveLength(count);
  });

  it('stops listening to the routing once disposed', async () => {
    const { graph, routes } = fakeGraph();
    const r = routing();
    const playback = createPlayback(graph, r.source);
    await playback.dispose();
    r.set({ monitor: true });
    expect(routes).toHaveLength(1);
  });
});

describe('createPlayback — replay', () => {
  it("plays a segment's kept speech entry by entry, skipping dropped pcm, under the live keys", () => {
    const { graph, plays, advance } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }, { pcm: EMPTY_PCM }, { pcm: pcm(100) }]));
    expect(plays.map((p) => p.feed)).toEqual(['replay', 'replay']);
    advance(LEAD_S + 0.01);
    expect(playback.queues.replay.position()?.key).toBe('speaker:4:0');
    advance(0.1);
    expect(playback.queues.replay.position()?.key).toBe('speaker:4:2');
  });

  it('replaces a replay in progress, and stops on request', () => {
    const { graph, plays } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.replay('speaker', translation(4, [{ pcm: pcm(100) }]));
    playback.replay('speaker', translation(6, [{ pcm: pcm(100) }]));
    expect(plays[0].done).toBe(true);
    expect(plays[1].done).toBe(false);
    playback.stopReplay();
    expect(plays[1].done).toBe(true);
  });
});

describe('createPlayback — preview', () => {
  it('plays one clip at a time and resolves when it ends', async () => {
    const { graph, shots } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    const first = playback.preview({ audio: new Float32Array(10), sampleRate: 44100 });
    const second = playback.preview({ audio: new Float32Array(10), sampleRate: 44100 });
    expect(shots[0].stopped).toBe(true);
    await first;
    shots[1].end();
    await second;
    expect(shots.map((s) => s.sampleRate)).toEqual([44100, 44100]);
  });

  it('an empty clip resolves at once and plays nothing', async () => {
    const { graph, shots } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    await playback.preview({ audio: new Float32Array(0), sampleRate: 44100 });
    expect(shots).toHaveLength(0);
  });
});
```

`src/lib/audio/testTone.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadTestTone, testToneUrl } from './testTone';

afterEach(() => { vi.unstubAllGlobals(); });

function context(channels: Float32Array[], sampleRate: number) {
  return {
    decodeAudioData: vi.fn(async () => ({
      length: channels[0].length,
      numberOfChannels: channels.length,
      sampleRate,
      getChannelData: (c: number) => channels[c],
    })),
  } as unknown as BaseAudioContext;
}

const ok = vi.fn(async () => new Response(new ArrayBuffer(8)));

describe('loadTestTone', () => {
  it('mixes the channels to one, 10% under full scale, at its own rate', async () => {
    const clip = await loadTestTone(context([Float32Array.of(1, 0), Float32Array.of(0, 1)], 44100), ok, '/tone.mp3');
    expect(ok).toHaveBeenCalledWith('/tone.mp3');
    expect(clip.sampleRate).toBe(44100);
    expect([...clip.audio].map((s) => Math.round(s * 100) / 100)).toEqual([0.45, 0.45]);
  });

  it('rejects when the asset does not load', async () => {
    const missing = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(loadTestTone(context([Float32Array.of(0)], 24000), missing, '/tone.mp3')).rejects.toThrow('404');
  });
});

describe('testToneUrl', () => {
  it('is the bundled asset, served from the extension when there is one', () => {
    expect(testToneUrl()).toBe('/assets/test-tone.mp3');
    vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://x/${path}` } });
    expect(testToneUrl()).toBe('chrome-extension://x/assets/test-tone.mp3');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/playback.test.ts src/lib/audio/testTone.test.ts`
Expected: FAIL — `./playback` and `./testTone` do not exist.

- [ ] **Step 3: Implement**

`src/lib/audio/playback.ts`:

```ts
/**
 * Everything the app plays, behind the runner's `PlaybackPort` (spec:
 * "Playback"): a clip queue per leg and one for replay, the preview route,
 * the route table kept live from the routing settings, and the tts tap.
 */
import type { LegName, Segment } from '../conversation/types';
import type { PlaybackPort } from '../session/ports';
import { ClipQueue, type QueueView } from './clipQueue';
import type { AudioGraph, OneShot } from './graph';
import type { PcmTap } from './pcmTap';
import { routesFor, type RoutingSettings } from './routes';

/** One clip: a leg, the segment its `ref` names ('none' when it names none), and which of the segment's speech entries. */
export type ClipKey = `${LegName}:${number | 'none'}:${number}`;

export function clipKey(leg: LegName, ref: number | undefined, index: number): ClipKey {
  return `${leg}:${ref ?? 'none'}:${index}`;
}

/** The routing settings, live: the app reads its stores, the preview its toggles, a test a fixture. */
export interface RoutingSource {
  get(): RoutingSettings;
  subscribe(listener: () => void): () => void;
}

/** A voice sample or the test tone, at its own rate. */
export interface PreviewClip {
  audio: Float32Array;
  sampleRate: number;
}

export interface Playback extends PlaybackPort {
  readonly queues: Readonly<Record<'speaker' | 'participant' | 'replay', QueueView<ClipKey>>>;
  /** Plays a segment's kept speech on the real device, replacing any replay in progress. */
  replay(leg: LegName, segment: Segment): void;
  stopReplay(): void;
  /** Plays a clip on the real device, stopping the previous one; resolves when it ends or is stopped. */
  preview(clip: PreviewClip): Promise<void>;
  stopPreview(): void;
  /** Mixes a capture into the meeting under the translation (the passthrough route); returns the detach. */
  attachPassthrough(stream: MediaStream): () => void;
  /** The translated speech as played, before any route: the echo monitor's reference. */
  readonly ttsTap: PcmTap;
  dispose(): Promise<void>;
}

export function createPlayback(graph: AudioGraph, routing: RoutingSource): Playback {
  const live: Record<LegName, ClipQueue<ClipKey>> = {
    speaker: new ClipQueue<ClipKey>(graph.timeline('speaker')),
    participant: new ClipQueue<ClipKey>(graph.timeline('participant')),
  };
  const replayQueue = new ClipQueue<ClipKey>(graph.timeline('replay'));
  /**
   * Per `${leg}:${ref}`, how many clips have arrived: the next one's speech
   * entry index, since L1 appends one entry per `audio` event, in order.
   */
  const counts = new Map<string, number>();
  let held = false;
  let current: OneShot | null = null;

  const apply = () => {
    const settings = routing.get();
    graph.route(routesFor(settings, held));
    void graph.setSinks(settings.sinks);
  };
  apply();
  const unsubscribe = routing.subscribe(apply);

  const stopPreview = () => {
    current?.stop();
    current = null;
  };

  return {
    queues: { speaker: live.speaker, participant: live.participant, replay: replayQueue },

    audio(leg, ref, pcm) {
      const id = `${leg}:${ref ?? 'none'}`;
      const index = counts.get(id) ?? 0;
      counts.set(id, index + 1);
      void graph.resume();
      live[leg].enqueue(clipKey(leg, ref, index), pcm);
    },

    held(next) {
      if (next === held) return;
      held = next;
      apply();
    },

    clear() {
      live.speaker.clear();
      live.participant.clear();
      replayQueue.clear();
      // L1's `clear()` empties every segment's speech too: the indices restart together.
      counts.clear();
    },

    replay(leg, segment) {
      replayQueue.clear();
      void graph.resume();
      segment.speech.forEach((entry, index) => {
        // An entry whose pcm retention dropped plays nothing, but keeps its index.
        if (entry.pcm.length > 0) replayQueue.enqueue(clipKey(leg, segment.ref, index), entry.pcm);
      });
    },

    stopReplay: () => replayQueue.clear(),

    preview(clip) {
      stopPreview();
      if (clip.audio.length === 0) return Promise.resolve();
      void graph.resume();
      const shot = graph.playOnce(clip.audio, clip.sampleRate);
      current = shot;
      return shot.ended.then(() => {
        if (current === shot) current = null;
      });
    },

    stopPreview,

    attachPassthrough: (stream) => graph.attachPassthrough(stream),

    ttsTap: graph.ttsTap,

    async dispose() {
      unsubscribe();
      live.speaker.clear();
      live.participant.clear();
      replayQueue.clear();
      stopPreview();
      await graph.close();
    },
  };
}
```

`src/lib/audio/testTone.ts`:

```ts
/**
 * The test tone (spec routing: a fixed route to the real device). Today
 * MainPanel decodes it and sends it through the whole pipeline, the virtual
 * microphone included; here it is one preview clip.
 */
import type { PreviewClip } from './playback';

/** The bundled asset; the extension serves it from its own origin. */
export function testToneUrl(): string {
  const runtime = (globalThis as unknown as { chrome?: { runtime?: { getURL?(path: string): string } } }).chrome?.runtime;
  return runtime?.getURL ? runtime.getURL('assets/test-tone.mp3') : '/assets/test-tone.mp3';
}

/** Decodes the tone to one channel at its own rate, 10% under full scale as today. */
export async function loadTestTone(
  context: BaseAudioContext,
  fetchImpl: typeof fetch = fetch,
  url: string = testToneUrl(),
): Promise<PreviewClip> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`The test tone did not load: HTTP ${response.status}`);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const audio = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) audio[i] += channel[i] / buffer.numberOfChannels;
  }
  for (let i = 0; i < audio.length; i++) audio[i] *= 0.9;
  return { audio, sampleRate: buffer.sampleRate };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio
git commit -m "feat(audio): playback behind the runner's port — clips per leg, replay, preview, live routes; the test tone"
```

---

### Task 7: The page's playback

**Files:**
- Create: `src/lib/audio/appAudio.ts`
- Test: `src/lib/audio/appAudio.test.ts`
- Modify: `extension/vite.config.ts`

**Interfaces:**
- Consumes: `createAudioGraph`, `SinkElement`, `VirtualOutput` (Task 5); `createPlayback`, `Playback`, `PreviewClip`, `RoutingSource` (Task 6); `RoutingSettings` (Task 4); `toPcmDataMessage`, `sendToTabs`, `targetTabIdFromSearch`, `TabsApi` (Task 3); `findVirtualSpeaker` (Task 3); `loadTestTone` (Task 6); `useAudioStore` (default export of `src/stores/audioStore.ts`); `useRoutingStore` (Task 4); `getEnvironment` (`src/utils/environment.ts`); `Platform` (`src/lib/provider/types.ts`).
- Produces: `interface AppAudio { playback: Playback; testTone(): Promise<void> }`; `getAppAudio(): Promise<AppAudio>` (one per page, built on first use); `readRouting(audio, playback, platform): RoutingSettings`; `createAppRouting(platform: Platform): RoutingSource`.

The one module in `src/lib/audio` that reads the stores, as `session/appShape.ts` is for the runner. The routing settings: the meeting and participant-speech switches from `routingStore`; the monitor route from `audioStore` under today's rule (ruling 4); passthrough and its ratio from `audioStore`; the real sink is the selected monitor device; the virtual sink is the Electron virtual speaker found by label among `audioStore.audioMonitorDevices` (every output, labels included). The graph: one `AudioContext` at 24 kHz; the tap worklet from `chrome.runtime.getURL('worklets/pcm-tap-processor.js')` in the extension (its CSP forbids `blob:` and `data:` modules, as `ModernAudioPlayer`'s own worklet shows) and from Vite's `new URL(…, import.meta.url)` elsewhere; `<audio>` elements as sinks; the virtual output per platform. The extension build must copy the worklet next to the others.

`getAppAudio` itself needs a real `AudioContext`; it is exercised by Task 8's headless run. Its pure parts are tested here.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/appAudio.test.ts`:

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

import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { createAppRouting, readRouting } from './appAudio';

const AUDIO = {
  mode: 'speaker' as const,
  isMonitorMuted: false,
  isRealVoicePassthroughEnabled: true,
  realVoicePassthroughVolume: 0.3,
  selectedMonitorDevice: { deviceId: 'monitor-1', label: 'Headphones' },
  audioMonitorDevices: [
    { deviceId: 'monitor-1', label: 'Headphones' },
    { deviceId: 'cable-1', label: 'CABLE Input (VB-Audio Virtual Cable)', isVirtual: true },
  ],
};
const SWITCHES = { meeting: true, participantSpeech: false };

describe('readRouting', () => {
  it('maps the stores onto the route settings', () => {
    expect(readRouting(AUDIO, SWITCHES, 'electron')).toEqual({
      meeting: true,
      monitor: true,
      participantSpeech: false,
      passthrough: { on: true, ratio: 0.3 },
      sinks: { real: 'monitor-1', virtual: 'cable-1' },
    });
  });

  it('hears the monitor only in speaker mode, as today', () => {
    expect(readRouting({ ...AUDIO, mode: 'both' }, SWITCHES, 'electron').monitor).toBe(false);
    expect(readRouting({ ...AUDIO, mode: 'participant' }, SWITCHES, 'electron').monitor).toBe(false);
    expect(readRouting({ ...AUDIO, isMonitorMuted: true }, SWITCHES, 'electron').monitor).toBe(false);
  });

  it('looks for a virtual speaker device only in Electron', () => {
    expect(readRouting(AUDIO, SWITCHES, 'extension').sinks.virtual).toBeUndefined();
    expect(readRouting(AUDIO, SWITCHES, 'web').sinks.virtual).toBeUndefined();
    expect(readRouting({ ...AUDIO, audioMonitorDevices: [AUDIO.audioMonitorDevices[0]] }, SWITCHES, 'electron').sinks.virtual).toBeUndefined();
  });
});

describe('createAppRouting', () => {
  beforeEach(() => {
    useAudioStore.setState(AUDIO);
    useRoutingStore.setState(SWITCHES);
  });

  it('reads the live stores, and tells its listener when either changes', () => {
    const routing = createAppRouting('electron');
    const heard = vi.fn();
    const off = routing.subscribe(heard);
    useRoutingStore.getState().setMeeting(false);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(routing.get().meeting).toBe(false);
    useAudioStore.setState({ isMonitorMuted: true });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(routing.get().monitor).toBe(false);
    off();
    useRoutingStore.getState().setMeeting(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/appAudio.test.ts`
Expected: FAIL — `./appAudio` does not exist.

- [ ] **Step 3: Implement**

`src/lib/audio/appAudio.ts`:

```ts
/**
 * The page's playback — the one module in `src/lib/audio` that reads the
 * stores, as `session/appShape.ts` is for the runner. One graph per page, on
 * a 24 kHz context; `<audio>` elements as its outputs; the tap worklet from
 * the platform's URL; the virtual output per platform (Electron's virtual
 * speaker, the extension's tabs, nothing on the web); the routing settings
 * read live from `audioStore` and `routingStore`.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import type { Platform } from '../provider/types';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { getEnvironment } from '../../utils/environment';
import { createAudioGraph, type VirtualOutput } from './graph';
import { createPlayback, type Playback, type PreviewClip, type RoutingSource } from './playback';
import type { RoutingSettings } from './routes';
import { sendToTabs, targetTabIdFromSearch, toPcmDataMessage, type TabsApi } from './tabMicrophone';
import { loadTestTone } from './testTone';
import { findVirtualSpeaker } from './virtualSpeaker';

type AudioState = ReturnType<typeof useAudioStore.getState>;

export interface AppAudio {
  playback: Playback;
  /** Plays the bundled test tone on the real device: a fixed route, never into the meeting. */
  testTone(): Promise<void>;
}

export function readRouting(
  audio: Pick<AudioState, 'mode' | 'isMonitorMuted' | 'isRealVoicePassthroughEnabled' | 'realVoicePassthroughVolume' | 'selectedMonitorDevice' | 'audioMonitorDevices'>,
  switches: { meeting: boolean; participantSpeech: boolean },
  platform: Platform,
): RoutingSettings {
  return {
    meeting: switches.meeting,
    // Today's rule: the monitor is heard only in speaker mode, so a
    // whole-system participant capture never hears it.
    monitor: audio.mode === 'speaker' && !audio.isMonitorMuted,
    participantSpeech: switches.participantSpeech,
    passthrough: { on: audio.isRealVoicePassthroughEnabled, ratio: audio.realVoicePassthroughVolume },
    sinks: {
      real: audio.selectedMonitorDevice?.deviceId,
      virtual: platform === 'electron' ? findVirtualSpeaker(audio.audioMonitorDevices) : undefined,
    },
  };
}

export function createAppRouting(platform: Platform): RoutingSource {
  return {
    get: () => readRouting(useAudioStore.getState(), useRoutingStore.getState(), platform),
    subscribe(listener) {
      const offAudio = useAudioStore.subscribe(() => listener());
      const offSwitches = useRoutingStore.subscribe(() => listener());
      return () => {
        offAudio();
        offSwitches();
      };
    },
  };
}

interface ChromeLike {
  tabs?: Omit<TabsApi, 'lastError'>;
  runtime?: { lastError?: unknown; getURL?(path: string): string };
}

const chromeApi = (): ChromeLike | undefined => (globalThis as unknown as { chrome?: ChromeLike }).chrome;

/** The extension serves worklets from its own origin (its CSP forbids blob: and data: modules); elsewhere Vite resolves the file. */
function tapModuleUrl(platform: Platform): string {
  const getURL = chromeApi()?.runtime?.getURL;
  if (platform === 'extension' && getURL) return getURL('worklets/pcm-tap-processor.js');
  return new URL('./worklets/pcm-tap-processor.js', import.meta.url).href;
}

function virtualOutput(platform: Platform): VirtualOutput {
  if (platform === 'electron') return { kind: 'device' };
  const api = platform === 'extension' ? chromeApi() : undefined;
  const chromeTabs = api?.tabs;
  if (!chromeTabs) return { kind: 'none' };
  const tabs: TabsApi = {
    get: (tabId, callback) => chromeTabs.get(tabId, callback),
    query: (info, callback) => chromeTabs.query(info, callback),
    sendMessage: (tabId, message, callback) => chromeTabs.sendMessage(tabId, message, callback),
    lastError: () => api?.runtime?.lastError,
  };
  const target = targetTabIdFromSearch(window.location.search);
  return {
    kind: 'tabs',
    send(chunk) {
      const message = toPcmDataMessage(chunk, Date.now());
      if (message) sendToTabs(tabs, target, message);
    },
  };
}

async function build(): Promise<AppAudio> {
  const platform = getEnvironment();
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const graph = await createAudioGraph({
    context,
    addTapModule: (ctx) => ctx.audioWorklet.addModule(tapModuleUrl(platform)),
    createTapNode: (ctx, chunk) => new AudioWorkletNode(ctx, 'pcm-tap-processor', { processorOptions: { chunk } }),
    createSink: (stream) => {
      const element = new Audio();
      element.srcObject = stream;
      return element;
    },
    virtual: virtualOutput(platform),
  });
  const playback = createPlayback(graph, createAppRouting(platform));
  let tone: Promise<PreviewClip> | null = null;
  return {
    playback,
    async testTone() {
      tone ??= loadTestTone(context).catch((error: unknown) => {
        tone = null;
        throw error;
      });
      await playback.preview(await tone);
    },
  };
}

let appAudio: Promise<AppAudio> | null = null;

/** The page's one playback, built on first use; a failed build is retried on the next call. */
export function getAppAudio(): Promise<AppAudio> {
  appAudio ??= build().catch((error: unknown) => {
    appAudio = null;
    throw error;
  });
  return appAudio;
}
```

`extension/vite.config.ts` — in `viteStaticCopy`'s `targets`, after the entry for `../src/lib/modern-audio/worklets/playback-ring-processor.js`, add:

```ts
          {
            src: '../src/lib/audio/worklets/pcm-tap-processor.js',
            dest: 'worklets',
          },
```

(`extension/manifest.json` already exposes `worklets/*` as a web-accessible resource.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/appAudio.ts src/lib/audio/appAudio.test.ts extension/vite.config.ts
git commit -m "feat(audio): the page's playback — routing from the stores, the tap worklet per platform, the virtual output"
```

---

### Task 8: The preview, heard

**Files:**
- Modify: `src/components/dev/SpinePreview.tsx`, `src/components/dev/SessionControls.tsx`
- Test: `src/components/dev/SpinePreview.test.tsx`, `src/components/dev/SessionControls.test.tsx`
- Create: `scripts/dev/spine-audio-probe.mjs`

**Interfaces:**
- Consumes: `getAppAudio`, `AppAudio` (Task 7); `Playback` (Task 6); `useRoutingStore` (Task 4); `useAudioStore` (default export); `PlaybackPort` (Task 1); the runner and `SessionControls` from plan 1c-1.
- Produces: `SessionControls` gains an optional prop `audio?: AppAudio | null` and renders, when it is given: a `Test tone` button; four switches labelled `Meeting hears the translation`, `Monitor`, `Participant speech` and `Keep audio for replay` (the old `settingsStore.keepReplayAudio`, through its own `setKeepReplayAudio`); a `Replay` button on each exchange whose translation kept speech; and a probe line `<p data-probe="playback">heard: <keys|-> · tap peak: <n></p>` updated every 100 ms. `scripts/dev/spine-audio-probe.mjs [url] [seconds]` exits 0 only when the preview's session played a clip and the tts tap heard it.

The preview's fake session becomes audible: the runner's playback port forwards to the page's playback once it has loaded (a bridge, so the runner can be created synchronously as before), and the controls add what a listener needs to check the routes by ear. The probe line is what a headless check reads: `requestAnimationFrame` never fires in headless Chromium (see the rendering notes), so the probe runs on `setInterval`. Reading the tts tap here drains it — acceptable on a development page that runs no echo monitor.

- [ ] **Step 1: Write the failing tests**

`src/components/dev/SessionControls.test.tsx` — add these imports at the top, beside the existing ones:

```ts
import { createVirtualClock } from '../../lib/contract/clock';
import { Conversation } from '../../lib/conversation/Conversation';
import type { AppAudio } from '../../lib/audio/appAudio';
import type { Playback } from '../../lib/audio/playback';
import { useRoutingStore } from '../../stores/routingStore';
```

and this mock, before the first import of the component (it keeps the stores' `persistSetting` off the real settings service):

```ts
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));
```

Then append:

```ts
function fakeAudio(): AppAudio & { playback: Playback } {
  const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
  const playback = {
    queues: { speaker: queue, participant: queue, replay: queue },
    audio: vi.fn(), held: vi.fn(), clear: vi.fn(),
    replay: vi.fn(), stopReplay: vi.fn(),
    preview: vi.fn(async () => {}), stopPreview: vi.fn(),
    attachPassthrough: vi.fn(() => () => {}),
    ttsTap: { read: () => new Float32Array(0) },
    dispose: vi.fn(async () => {}),
  } as unknown as Playback;
  return { playback, testTone: vi.fn(async () => {}) };
}

/** One exchange whose translation (ref 2) kept its speech. */
function oneExchange(): Conversation {
  const conversation = new Conversation({ leg: 'speaker', session: 's', languages: { source: 'en', target: 'ja' }, clock: createVirtualClock(0) });
  conversation.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: 'x' } });
  conversation.apply({ kind: 'segmentText', payload: { ref: 1, text: 'Hello.' } });
  conversation.apply({ kind: 'segmentClosed', payload: { ref: 1, origin: 'x' } });
  conversation.apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: 'x' } });
  conversation.apply({ kind: 'segmentText', payload: { ref: 2, text: 'こんにちは。' } });
  conversation.apply({ kind: 'audio', payload: { ref: 2, pcm: new Int16Array(2400) } });
  conversation.apply({ kind: 'segmentClosed', payload: { ref: 2, origin: 'x' } });
  return conversation;
}

describe('SessionControls — playback', () => {
  it("replays an exchange's translation", () => {
    const { runner } = fakeRunner();
    runner.conversation.replace(new Map([['speaker' as const, oneExchange()]]));
    const audio = fakeAudio();
    render(<SessionControls runner={runner} turnMode="auto" audio={audio} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(audio.playback.replay).toHaveBeenCalledWith('speaker', expect.objectContaining({ ref: 2 }));
  });

  it('plays the test tone', () => {
    const { runner } = fakeRunner();
    const audio = fakeAudio();
    render(<SessionControls runner={runner} turnMode="auto" audio={audio} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test tone' }));
    expect(audio.testTone).toHaveBeenCalled();
  });

  it('switches whether the meeting hears the translation', () => {
    useRoutingStore.setState({ meeting: true });
    const { runner } = fakeRunner();
    render(<SessionControls runner={runner} turnMode="auto" audio={fakeAudio()} />);
    fireEvent.click(screen.getByLabelText('Meeting hears the translation'));
    expect(useRoutingStore.getState().meeting).toBe(false);
  });

  it('shows the clips it heard and the loudest sample the tap heard', () => {
    vi.useFakeTimers();
    try {
      const { runner } = fakeRunner();
      const audio = fakeAudio();
      const playing = { position: () => ({ key: 'speaker:2:0', t: 10 }), pending: 1, subscribe: () => () => {} };
      Object.assign(audio.playback.queues, { speaker: playing });
      Object.assign(audio.playback, { ttsTap: { read: () => Float32Array.of(0.25, -0.5) } });
      render(<SessionControls runner={runner} turnMode="auto" audio={audio} />);
      act(() => { vi.advanceTimersByTime(100); });
      expect(document.querySelector('[data-probe="playback"]')?.textContent).toBe('heard: speaker:2:0 · tap peak: 0.500');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

`src/components/dev/SpinePreview.test.tsx` — add this mock beside the others (jsdom has no Web Audio; the preview's playback is `getAppAudio`'s business, tested in Task 7 and heard in Step 5):

```ts
vi.mock('../../lib/audio/appAudio', () => ({
  getAppAudio: async () => {
    const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
    return {
      playback: {
        queues: { speaker: queue, participant: queue, replay: queue },
        audio: () => {}, held: () => {}, clear: () => {},
        replay: () => {}, stopReplay: () => {}, preview: async () => {}, stopPreview: () => {},
        attachPassthrough: () => () => {}, ttsTap: { read: () => new Float32Array(0) }, dispose: async () => {},
      },
      testTone: async () => {},
    };
  },
}));
```

and append to its `describe`:

```ts
  it('offers the test tone once the playback has loaded', async () => {
    render(<SpinePreview />);
    expect(await screen.findByRole('button', { name: 'Test tone' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/dev`
Expected: FAIL — no `Replay`, `Test tone`, switch or probe yet.

- [ ] **Step 3: Implement**

`src/components/dev/SpinePreview.tsx` — the runner's playback port becomes a bridge to the page's playback, the page loads the playback store and its playback, and hands the latter to the controls. Replace the module-level `bridge` and `getPreviewRunner`, and the component, with:

```tsx
let previewRunner: Runner | null = null;
const bridge: { auth: AuthContext; track: AnalyticsPort['track']; playback: Playback | null } = {
  auth: { signedIn: false, getToken: async () => null },
  track: () => {},
  playback: null,
};

/**
 * Forwards to the page's playback once it has loaded, so the runner can be
 * created synchronously; audio before then is dropped (autostart waits for it).
 */
const playbackBridge: PlaybackPort = {
  audio: (leg, ref, pcm) => bridge.playback?.audio(leg, ref, pcm),
  held: (held) => bridge.playback?.held(held),
  clear: () => bridge.playback?.clear(),
};

/** One runner per page: the preview's stand-in for the app's, on the fake source until plan 1c-3 supplies real capture. */
function getPreviewRunner(): Runner {
  previewRunner ??= createRunner({
    clock: realClock,
    platform: getEnvironment(),
    readShape: () => readShapeFromStores(bridge.auth),
    ensureReady: (p, auth) => useProviderStore.getState().refreshReadiness(p, auth),
    persistIfUnchanged,
    openSource: async () => createFakeSource(realClock),
    playback: playbackBridge,
    analytics: { track: (event, properties) => bridge.track(event, properties) },
    newSessionId: () => crypto.randomUUID(),
  });
  return previewRunner;
}

/**
 * Development builds only: the new provider layer and a live fake session on
 * a page of their own (plans 1b–1d), heard through the new playback. Open the
 * dev server at `/?preview=spine`; add `&autostart=1` to start a session on
 * load, for headless rendering.
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
  const [audio, setAudio] = useState<AppAudio | null>(null);
  const autostarted = useRef(false);

  useEffect(() => {
    void useTurnModeStore.getState().load();
    void useRoutingStore.getState().load();
    let live = true;
    getAppAudio().then(
      (loaded) => {
        bridge.playback = loaded.playback;
        if (live) setAudio(loaded);
      },
      (error: unknown) => reportError('SpinePreview', `The playback did not load: ${describeCause(error)}`, { cause: error }),
    );
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (autostarted.current || !entry || !audio || new URLSearchParams(window.location.search).get('autostart') !== '1') return;
    autostarted.current = true;
    void runner.start();
  }, [entry, audio, runner]);

  return (
    <div className="settings-container spine-preview">
      <div className="settings-body">
        <ProviderPanel providers={providers} auth={auth} disabled={phase !== 'idle'} />
        <SessionControls runner={runner} turnMode={turnMode} audio={audio} />
      </div>
    </div>
  );
}
```

and update its imports: add `useState` to the `react` import; add `import { getAppAudio, type AppAudio } from '../../lib/audio/appAudio';`, `import type { Playback } from '../../lib/audio/playback';`, `import { describeCause, reportError } from '../../lib/diagnostics/report';`, `import { useRoutingStore } from '../../stores/routingStore';`, and add `PlaybackPort` to the type import from `../../lib/session/ports` (which already brings `AnalyticsPort`).

`src/components/dev/SessionControls.tsx` — add the prop, the playback controls and the probe. The full new file:

```tsx
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { AppAudio } from '../../lib/audio/appAudio';
import type { Playback } from '../../lib/audio/playback';
import type { Segment } from '../../lib/conversation/types';
import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
import type { Runner } from '../../lib/session/runner';
import type { TurnMode } from '../../lib/session/types';
import useAudioStore from '../../stores/audioStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';

interface SessionControlsProps {
  runner: Runner;
  turnMode: TurnMode;
  /** The page's playback, once it has loaded. */
  audio?: AppAudio | null;
}

/**
 * What the playback played, for a listener and for a headless check (which
 * cannot use requestAnimationFrame): every clip key heard, and the loudest
 * sample the tts tap heard. Reading the tap drains it — this page runs no
 * echo monitor.
 */
function usePlaybackProbe(playback: Playback | undefined): { heard: string[]; peak: number } {
  const [probe, setProbe] = useState<{ heard: string[]; peak: number }>({ heard: [], peak: 0 });
  useEffect(() => {
    if (!playback) return;
    const heard = new Set<string>();
    let peak = 0;
    const id = setInterval(() => {
      const before = heard.size;
      const beforePeak = peak;
      for (const queue of Object.values(playback.queues)) {
        const playing = queue.position();
        if (playing) heard.add(playing.key);
      }
      for (const sample of playback.ttsTap.read()) peak = Math.max(peak, Math.abs(sample));
      if (heard.size !== before || peak !== beforePeak) setProbe({ heard: [...heard], peak });
    }, 100);
    return () => clearInterval(id);
  }, [playback]);
  return probe;
}

/**
 * Development builds only: drive a runner by hand, read its conversation
 * raw, and check the playback by ear. The real surfaces (plan 1d) replace
 * this; its copy is not localized.
 */
export function SessionControls({ runner, turnMode, audio }: SessionControlsProps) {
  const state = useStore(runner.state);
  const legs = useSyncExternalStore((l) => runner.conversation.subscribe(l), () => runner.conversation.snapshot());
  const projector = useMemo(() => createProjector(), []);
  const entries = projector.project(legs, DEFAULT_PROJECTION);
  const [text, setText] = useState('');
  const running = state.phase === 'running';
  const segments = new Map(legs.flatMap((leg) => leg.segments.map((s) => [s.id, s] as const)));
  const meeting = useRoutingStore((s) => s.meeting);
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const monitorMuted = useAudioStore((s) => s.isMonitorMuted);
  // Read when a run starts (its shape), so it applies from the next Start.
  const keepReplayAudio = useSettingsStore((s) => s.keepReplayAudio);
  const probe = usePlaybackProbe(audio?.playback);

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
      {audio && (
        <div className="setting-item">
          <label>
            <input type="checkbox" checked={meeting} onChange={(e) => useRoutingStore.getState().setMeeting(e.target.checked)} />
            Meeting hears the translation
          </label>
          <label>
            <input type="checkbox" checked={!monitorMuted} onChange={(e) => useAudioStore.getState().setMonitorMuted(!e.target.checked)} />
            Monitor
          </label>
          <label>
            <input type="checkbox" checked={participantSpeech} onChange={(e) => useRoutingStore.getState().setParticipantSpeech(e.target.checked)} />
            Participant speech
          </label>
          <label>
            <input type="checkbox" checked={keepReplayAudio} onChange={(e) => void useSettingsStore.getState().setKeepReplayAudio(e.target.checked)} />
            Keep audio for replay
          </label>
          <button type="button" className="validate-button" onClick={() => void audio.testTone()}>Test tone</button>
          <p data-probe="playback">{`heard: ${probe.heard.join(',') || '-'} · tap peak: ${probe.peak.toFixed(3)}`}</p>
        </div>
      )}
      <ol className="setting-item">
        {entries.map((entry) => {
          if (entry.kind === 'notice') return <li key={entry.id}>{`[${entry.severity}] ${entry.message}`}</li>;
          const spoken = entry.translation
            .map((row) => segments.get(row.segmentId))
            .find((segment): segment is Segment => !!segment && segment.speech.some((s) => s.pcm.length > 0));
          return (
            <li key={entry.id}>
              {`${entry.leg}: ${[...entry.source, ...entry.translation].map((row) => segments.get(row.segmentId)?.text.slice(row.start, row.end) ?? '').join(' | ')}`}
              {audio && spoken && (
                <button type="button" className="validate-button" onClick={() => audio.playback.replay(entry.leg, spoken)}>Replay</button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

`scripts/dev/spine-audio-probe.mjs`:

```js
#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * prints what its playback did: the clips its queues played and the loudest
 * sample the tts tap heard (the page's `[data-probe=playback]` line).
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-audio-probe.mjs [url] [seconds]
 *
 * Exits 1 when no clip played or the tap heard nothing.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1';
const seconds = Number(process.argv[3] ?? 12);
const cache = join(homedir(), '.cache', 'ms-playwright');
const build = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
if (!build) throw new Error(`no Playwright chromium under ${cache}`);
const port = 9333;
const browser = spawn(join(cache, build, 'chrome-linux', 'chrome'), [
  '--headless', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spine-probe-'))}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocketUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error('chromium did not come up');
}

try {
  const ws = new WebSocket(await pageSocketUrl());
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let nextId = 0;
  const waiting = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(seconds * 1000);
  const reply = await send('Runtime.evaluate', {
    expression: 'document.querySelector("[data-probe=playback]")?.textContent ?? ""',
    returnByValue: true,
  });
  const text = reply.result?.result?.value ?? '';
  console.log(text || 'no playback probe on the page');
  const heard = /heard: (\S+)/.exec(text)?.[1] ?? '-';
  const peak = Number(/tap peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  process.exitCode = heard !== '-' && peak > 0 ? 0 : 1;
  ws.close();
} finally {
  browser.kill();
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/dev`
Expected: PASS.

- [ ] **Step 5: Hear it — the headless check, and by ear if you can**

Start the renderer only (plain `npx vite` also boots Electron):

```bash
SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort
```

In another shell, run `node scripts/dev/spine-audio-probe.mjs`. Expected: exit 0 and a line like `heard: speaker:2:0,speaker:2:1,speaker:2:2,speaker:4:0,speaker:4:1 · tap peak: 0.244` — the fake's two exchanges (translation refs 2 and 4), three and two clips of at least 200 ms each, and its tone's amplitude (8000 of 32768). Record the exact line in your report. If it exits 1, the report says so with the line — do not paper over it. Stop the dev server afterwards.

With a desktop session, also open `http://localhost:5199/?preview=spine`, tick `Monitor` and `Keep audio for replay`, press `Start` and listen: the tone bursts play on the monitor device; `Replay` on an exchange plays its clips again (without `Keep audio for replay` the run keeps no pcm and no `Replay` button shows); `Test tone` plays the tone. Say in the report which of these you could hear.

- [ ] **Step 6: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 7: Commit**

```bash
git add src/components/dev scripts/dev/spine-audio-probe.mjs
git commit -m "feat(dev): the preview's fake session heard — replay, test tone, route switches and a playback probe"
```
