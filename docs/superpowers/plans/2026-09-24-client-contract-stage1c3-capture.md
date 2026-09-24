# Client contract — Stage 1c-3: capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The capture half of the audio layer behind plan 1c-1's `OpenSource`: the microphone, Electron's system audio and the extension's tab as `Source`s, with mute, device switching and noise suppression live inside them, device loss and a dead app-capture helper noticed, the original voice fed into plan 1c-2's passthrough route, and the echo monitor fed from the sources and the playback's tts tap — used by the development preview on a real (or headless fake) microphone.

**Architecture:** `src/lib/audio/capture/`. The recorder classes in `src/lib/modern-audio/` stay — they are the capture engines (48 kHz capture, RNNoise / GTCRN, 24 kHz Int16 chunks; the Electron helper, PipeWire tap and loopback; Chrome tab capture) — and each new source wraps them: `createSourceCore` holds what every source shares (listeners, mute, one end, a watched track), and `openMic`, `openSystemAudio` and `openTab` replace `ModernBrowserAudioService`'s orchestration of them. Playback gains `passthrough(pcm)`: the processed microphone, played back to back on the passthrough feed with its latency bounded. `createEchoWatch` runs today's `EchoMonitor` on the sources and the tts tap. `appCapture.ts` composes it all for the page from `audioStore`. Nothing the app runs today changes; plan 1e switches MainPanel over and deletes `ModernBrowserAudioService`.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`, `allowJs` without `checkJs`, `jsx: react-jsx`), Web Audio and Media Capture (`getUserMedia`, `MediaStreamTrack` `ended`), Electron IPC through `window.electron.invoke` (typed in `src/electron.d.ts`), Chrome tab capture through the existing `TabAudioRecorder`, Zustand 5, vitest 4 (jsdom, `vi.stubGlobal`, `vi.mock`), `@testing-library/react`; plan 1c-1's runner and `Source`; plan 1c-2's `Playback`, `AudioTimeline`, `LEAD_S`, `STARVED_S`, `PcmTap`.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Session lifecycle" → "Capture belongs to the runner", "Sources, in full", "Legs rise and fall together (D21, D22)", "What may change during a run"; "Playback" → "Routing" (passthrough is a route tapping the microphone source) and "The echo monitor keeps its three probes". Roadmap: `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — "Carried out of plan 1c-1" → 1c-3 and "Deferred by plan 1c-2 — for 1c-3". The current stack, with line references: `docs/superpowers/notes/2026-09-24-audio-stack-current-state.md`.

## Rulings this plan makes

The controller records them in the roadmap when the plan lands.

1. **Wrap the recorders; do not rewrite them.** The recorder classes are capture engines — 48 → 24 kHz resampling, two noise suppressors (GTCRN in a worker), a native helper's IPC stream, Chrome tab capture — and nothing in the client contract asks them to change. What the spec replaces is their orchestration (`ModernBrowserAudioService`), so the new sources take over its sequences step by step. The one edit to `src/lib/modern-audio/` is a public `getStream()` on `BaseAudioRecorder` (the field exists; nothing exposes it), which is additive.
2. **Mute lives in the source.** A muted source delivers nothing: the leg sends no audio, passthrough goes quiet, and the echo monitor hears nothing from it. Today mute is a per-chunk skip in MainPanel that keeps passthrough playing into the meeting while "muted" (and pure push-to-talk refuses to start the recorder instead); the spec lists the mute switches among what "takes effect immediately", and a muted microphone the meeting still hears is a defect.
3. **Passthrough carries the processed microphone.** The meeting heard the microphone after the app's noise suppression (RNNoise / GTCRN) today; `Playback.attachPassthrough(stream)` (plan 1c-2) could only take a raw stream, and GTCRN's output exists only as PCM. So playback gains `passthrough(pcm)`: the source's own chunks, played back to back on the passthrough feed, the delay bounded (a capture clock faster than the output clock drops a chunk instead of growing the delay). `attachPassthrough` is removed.
4. **Every source ends on a lost device.** A source watches its capture track's `ended` event — a microphone unplugged, a tab closed, "Stop sharing" on a loopback, a PipeWire tap gone — and ends, which ends the session (D21). Nothing notices any of these today.
5. **A dead app-capture helper degrades, then falls back.** As today, a lost per-application capture falls back to whole-system capture — but the widening is a `degraded` notice with a code (`app_capture_lost_using_system_audio`), and if the fallback cannot start, the source ends. The helper's `silent_no_permission` warning is a `degraded` notice too; the permission modal it drives today is plan 1d's.
6. **Switching the input mid-run is inside the source; a switch that fails ends it.** Changing the microphone or the participant source during a run restarts the recorder in place (as `switchRecordingDevice` / `switchParticipantSource` do today). If the new one cannot start, the source ends with the reason, rather than today's attempt to restore the previous source.
7. **A degraded notice carries a code.** `Source.onDegraded` hands its listener `{ code, message }`, and the leg records it through the same per-code throttle an adapter's `degraded` gets.
8. **The tab's own audio keeps its route.** Chrome mutes a captured tab; `TabAudioRecorder` plays the capture back on the monitor device, chosen when capture begins. That stays inside the tab source (it is what tab capture requires, not a playback route), and a monitor-device change during a run does not move it — as today.

**Not in this plan** (the controller adds them to the roadmap): the echo notice and the participant-permission modal on screen (1d); `pagehide` releasing the microphone (`releaseMicrophone`), the echo diagnostics flag read from storage, and the sources' analytics events (`audio_error`, `audio_device_changed` — the spec's table has the sources emit them; a source has no analytics port yet) (1e); and, before the first WebRTC adapter consumes `Source.track` (Stage 2): the track handed over is the device's own, so mute and a device switch are not upstream of it as the spec asks ("A WebRTC adapter receives a `MediaStreamTrack` from the runner's own graph") — hand over a track from a graph the source owns, after its mute gate, that survives a device switch.

## Global Constraints

- Work on branch `worktree-client-contract-refactor` in this worktree. Commit after every task. **Never push.**
- **Nothing the app runs changes.** No edit to `src/components/MainPanel/**`, `src/stores/settingsStore.ts`, `src/stores/audioStore.ts`, `src/stores/sessionStore.ts`, `src/services/**`, `extension/**`, `electron/**` or any old client. In `src/lib/modern-audio/`, the only edit is Task 3's public `getStream()` on `BaseAudioRecorder`. The only other edits to existing files are the ones a task names.
- `src/lib/audio/**` imports nothing from `src/stores/**` or `src/services/**`, except `src/lib/audio/appAudio.ts` and `src/lib/audio/appCapture.ts` (Task 8). It may import the recorder classes and `EchoMonitor` from `src/lib/modern-audio/`. `src/lib/session/**` keeps its rule (`appShape.ts` is its one store reader).
- No `console.error` / `console.warn` in any new file; failures go out through `reportError` / `reportWarning` (`src/lib/diagnostics/report.ts`). `console.info` appears once: the echo monitor's opt-in diagnostics line (Task 7), as today. Hot paths — per chunk — never report per occurrence: report the ok → failing transition, or pass a `dedupeKey`. A failure the user must see is a source's end or degradation, which the leg records.
- A source delivers 24 kHz mono `Int16` (`SAMPLE_RATE` from `src/lib/contract/adapter.ts`).
- Tests assert behaviour, not copy; provider- and recorder-supplied messages are data and may be asserted. The development controls are found by their literal English labels.
- English-only comments and test names. Tests colocated next to the module.
- Conventional commit messages. Each commit ends with the implementer's own `Co-Authored-By:` attribution line (the one its harness gives it) and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`. The worktree's shell refuses compound git commands: run `git add` and `git commit` separately.
- Run one file with `npx vitest run <path>`; everything with `npx vitest run src` — **0 failed**. It also prints 4 unhandled rejections from `src/stores/settingsStore.nativeGate.test.ts`; those predate this branch.
- **Typecheck gate.** Run exactly:
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' \
    | grep -E '^(src/(lib/(session|audio|provider|conversation|projection|export|contract|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|dev/(SpinePreview|SessionControls))|stores/(providerStore|turnModeStore|routingStore)|utils/environment|App\.tsx))' \
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
| `src/lib/session/source.ts` | `Source.track?`; `onDegraded` hands `{ code, message }` |
| `src/lib/session/run.ts` | a leg's request built after its source opens (`input`); `appendAudio` guarded; a source's degradation throttled |
| `src/lib/session/turn.ts` | voiced time counted in whole samples |
| `src/lib/conversation/Conversation.ts` | `degraded(code, message)`: a throttled warning from outside the adapter |
| `src/providers/fake/source.ts` | `degrade(message, code?)` |
| `src/lib/audio/capture/core.ts` | `createSourceCore` — listeners, mute, one end, a watched track, one stop |
| `src/lib/modern-audio/BaseAudioRecorder.ts` | + public `getStream()` |
| `src/lib/audio/capture/mic.ts` | `openMic` — `ModernAudioRecorder` as a source: device switching and noise suppression live |
| `src/lib/audio/capture/systemAudio.ts` | `openSystemAudio` — Electron's app / device / loopback capture as a source |
| `src/lib/audio/capture/tab.ts` | `openTab` — the extension's tab capture as a source |
| `src/lib/audio/liveStream.ts` | `LiveStream` — a continuous stream, back to back, its delay bounded |
| `src/lib/audio/graph.ts`, `playback.ts` | the passthrough feed gets a timeline; `Playback.passthrough(pcm)`; `attachPassthrough` removed |
| `src/lib/audio/capture/echoWatch.ts` | `createEchoWatch` — `EchoMonitor` on the sources and the tts tap |
| `src/lib/audio/appCapture.ts` | `createAppCapture` — the page's `OpenSource` from `audioStore` |
| `src/components/dev/SpinePreview.tsx`, `SessionControls.tsx`, `scripts/dev/spine-audio-probe.mjs` | the preview captures from a device on `&capture=device`; the probe checks it |

---

### Task 1: The runner's capture carry-over

**Files:**
- Modify: `src/lib/session/source.ts`, `src/lib/session/run.ts`, `src/lib/session/turn.ts`, `src/lib/conversation/Conversation.ts`, `src/providers/fake/source.ts`
- Test: `src/lib/session/runner.test.ts`, `src/lib/session/turn.test.ts`, `src/lib/conversation/Conversation.test.ts`, `src/providers/fake/source.test.ts`

**Interfaces:**
- Consumes: plan 1c-1's `Run`, `Turn`, `Conversation`, `createFakeSource`.
- Produces:
  - `Source` gains `readonly track?: MediaStreamTrack` and its `onDegraded` becomes `onDegraded(listener: (notice: { code: string; message: string }) => void): () => void` (ruling 7).
  - A leg's `StartRequest` is built after its source opens and carries `input: source.track` when the source has one (both paths: one leg at a time, and `startBoth`).
  - `Run` guards `session.appendAudio`: a throw is reported once per failing streak per leg (`reportError`, dedupe key `append:${leg}`) and never reaches the source.
  - `Turn` counts voiced samples as an integer; `MIN_VOICED_SAMPLES = 12000` (500 ms at 24 kHz) is exported beside `MIN_VOICED_MS`.
  - `Conversation.degraded(code: string, message: string): void` records a warning notice through the same per-code `DEGRADED_DEDUPE_MS` throttle as an adapter's `degraded` event.
  - `FakeSource.degrade(message: string, code?: string)` (default code `'source_degraded'`).

The capture items of the roadmap's "Carried out of plan 1c-1" → 1c-3 list.

- [ ] **Step 1: Write the failing tests**

`src/lib/conversation/Conversation.test.ts` — append (the file already has `make(extra)` returning `{ conv, clock, apply }` and imports `DEGRADED_DEDUPE_MS`):

```ts
describe('Conversation — a degradation from outside the adapter', () => {
  it('records it as a warning with its code, throttled per code like an adapter degradation', () => {
    const { conv, clock } = make();
    conv.degraded('app_capture_lost_using_system_audio', 'widened to system audio');
    conv.degraded('app_capture_lost_using_system_audio', 'widened again');
    conv.degraded('silent_no_permission', 'nothing heard');
    clock.advance(DEGRADED_DEDUPE_MS);
    conv.degraded('app_capture_lost_using_system_audio', 'widened a third time');
    expect(conv.snapshot().notices.map((n) => [n.severity, n.code, n.message])).toEqual([
      ['warning', 'app_capture_lost_using_system_audio', 'widened to system audio'],
      ['warning', 'silent_no_permission', 'nothing heard'],
      ['warning', 'app_capture_lost_using_system_audio', 'widened a third time'],
    ]);
  });
});
```

`src/lib/session/turn.test.ts` — append (the file already imports `Turn` from `./turn`):

```ts
describe('Turn — whole samples', () => {
  it('ends a turn holding exactly 500 ms of voice, and cancels one a sample short', () => {
    const voiced = (n: number) => new Int16Array(n).fill(8000);
    const full = new Turn(0);
    for (let i = 0; i < 5; i++) full.add(voiced(2400));
    expect(full.close()).toBe('end');
    const short = new Turn(0);
    for (let i = 0; i < 4; i++) short.add(voiced(2400));
    short.add(voiced(2399));
    expect(short.close()).toBe('cancel');
  });

  it('exports the threshold in samples', () => {
    expect(MIN_VOICED_SAMPLES).toBe(12_000);
  });
});
```

and add `MIN_VOICED_SAMPLES` to its import from `./turn`.

`src/providers/fake/source.test.ts` — append (the file already imports `createVirtualClock` and `createFakeSource`):

```ts
describe('createFakeSource — degradation', () => {
  it('hands its listeners a code and a message', () => {
    const source = createFakeSource(createVirtualClock(0));
    const heard: Array<{ code: string; message: string }> = [];
    source.onDegraded((notice) => { heard.push(notice); });
    source.degrade('fell back');
    source.degrade('no audio yet', 'silent_no_permission');
    expect(heard).toEqual([
      { code: 'source_degraded', message: 'fell back' },
      { code: 'silent_no_permission', message: 'no audio yet' },
    ]);
  });
});
```

`src/lib/session/runner.test.ts`:

1. Replace the test `'records a degraded source on its leg and keeps running'` with:

```ts
  it("records a degraded source on its leg with the source's code, throttled, and keeps running", async () => {
    const { runner, sources } = setup();
    await runner.start();
    sources[0].degrade('fell back to system audio', 'app_capture_lost_using_system_audio');
    sources[0].degrade('fell back again', 'app_capture_lost_using_system_audio');
    expect(runner.state.getState().phase).toBe('running');
    expect(runner.conversation.snapshot()[0].notices).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'app_capture_lost_using_system_audio', message: 'fell back to system audio' }),
    ]);
  });
```

2. Append:

```ts
describe('runner — capture carry-over', () => {
  /** The fake provider, with every request it starts recorded. */
  function recordingInputs() {
    const inputs: Array<MediaStreamTrack | undefined> = [];
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<never, never>, events: AdapterEvents) {
        inputs.push(request.input);
        return fakeProvider.start(request, events);
      },
    } as unknown as AnyProvider;
    return { inputs, provider };
  }

  it("hands the adapter the source's track, and builds the request once the source has opened", async () => {
    const track = { kind: 'audio' } as MediaStreamTrack;
    const { inputs, provider } = recordingInputs();
    const { runner } = setup({
      shape: { provider },
      openSource: async () => Object.assign(createFakeSource(createVirtualClock(0)), { track }),
    });
    await runner.start();
    expect(inputs).toEqual([track]);
  });

  it('builds a request without input when the source has no track', async () => {
    const { inputs, provider } = recordingInputs();
    const { runner } = setup({ shape: { provider } });
    await runner.start();
    expect(inputs).toEqual([undefined]);
  });

  it('keeps capturing when the adapter throws on audio, and reports it once per failing streak', async () => {
    let appended = 0;
    const provider = {
      ...fakeProvider,
      async start(request: StartRequest<never, never>, events: AdapterEvents) {
        const session = await fakeProvider.start(request, events);
        // Spreading a `FakeSession` instance would drop its prototype
        // methods; delegate explicitly, only `appendAudio` throws.
        return {
          info: session.info,
          appendAudio: () => { appended += 1; throw new Error('socket closed'); },
          appendText: (text: string) => session.appendText(text),
          beginTurn: () => session.beginTurn(),
          endTurn: () => session.endTurn(),
          cancelTurn: () => session.cancelTurn(),
          stop: () => session.stop(),
        };
      },
    } as unknown as AnyProvider;
    const { runner, clock } = setup({ shape: { provider } });
    reportErrorSpy.mockClear();
    await runner.start();
    clock.advance(500);
    expect(appended).toBeGreaterThanOrEqual(4);
    expect(reportErrorSpy.mock.calls.filter(([, message]) => String(message).includes('socket closed'))).toHaveLength(1);
  });
});
```

(`runner.test.ts` already imports `AdapterEvents`, `StartRequest`, `AnyProvider`, `createVirtualClock`, `fakeProvider`, `createFakeSource` and defines `reportErrorSpy`; its `setup()` passes `openSource` through and uses `turnMode: 'auto'`, so the default fake source's chunks reach `appendAudio` every 100 ms. The track test's own source runs on a clock nobody advances — it only needs to open.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/conversation/Conversation.test.ts src/lib/session src/providers/fake/source.test.ts`
Expected: FAIL — `conv.degraded is not a function`; `MIN_VOICED_SAMPLES` undefined; the fake's degradation hands a string; the runner records `source_degraded` twice with the wrong code; `inputs` is `[undefined]` where the track was expected; the throwing `appendAudio` escapes into the fake source's tick, so `appended` stays at 1.

- [ ] **Step 3: Implement**

`src/lib/session/source.ts` — the full file becomes:

```ts
import type { LegName } from '../conversation/types';

/** A degradation a source reports: still delivering, but worse. The code lets a surface localize it. */
export interface SourceNotice {
  code: string;
  message: string;
}

/** One leg's capture (spec: "Sources, in full"): 24 kHz mono pcm, an end, and a degradation. */
export interface Source {
  onPcm(listener: (pcm: Int16Array) => void): () => void;
  /** Fires at most once, when the capture can no longer deliver: a device unplugged, a tab closed, the app-capture helper gone. */
  onEnded(listener: (reason: string) => void): () => void;
  /** Still delivering, but worse: app capture fell back to whole-system capture. */
  onDegraded(listener: (notice: SourceNotice) => void): () => void;
  /** The capture's own track, for an adapter that sends a native track (WebRTC); absent where there is none. */
  readonly track?: MediaStreamTrack;
  stop(): Promise<void>;
}

/** Opens one leg's capture; rejects when it cannot open, and honours `signal`. */
export type OpenSource = (leg: LegName, signal: AbortSignal) => Promise<Source>;
```

`src/lib/conversation/Conversation.ts`:
- Add a private helper beside the `lastDegradedAt` map's other users:

```ts
  /** False when a degradation with this code was recorded within `DEGRADED_DEDUPE_MS`; otherwise notes it. */
  private admitDegraded(code: string): boolean {
    const now = this.opts.clock.now();
    const last = this.lastDegradedAt.get(code);
    if (last !== undefined && now - last < DEGRADED_DEDUPE_MS) return false;
    this.lastDegradedAt.set(code, now);
    return true;
  }
```

- In `apply`'s `case 'degraded'`, replace the four throttle lines with `if (!this.admitDegraded(code)) return;` (keeping `const { code, message } = event.payload;` and the `return this.addNotice(…)` line).
- Add, after `notice()`:

```ts
  /** A degradation from outside the adapter's stream (a source's): a warning, throttled per code like `degraded`. */
  degraded(code: string, message: string): void {
    if (!this.admitDegraded(code)) return;
    this.batch(() => this.addNotice({ severity: 'warning', message, code }));
  }
```

`src/lib/session/turn.ts`:
- After `MIN_VOICED_MS`, add:

```ts
/** `MIN_VOICED_MS` in samples at 24 kHz: counted whole, so irregular chunk sizes never round. */
export const MIN_VOICED_SAMPLES = (SAMPLE_RATE * MIN_VOICED_MS) / 1000;
```

- In `Turn`, replace `private voicedMs = 0;` with `private voicedSamples = 0;`, `add`'s body with `if (this.open && isVoiced(pcm)) this.voicedSamples += pcm.length;`, and `close`'s return with `return this.voicedSamples >= MIN_VOICED_SAMPLES ? 'end' : 'cancel';`.

`src/providers/fake/source.ts`:
- `FakeSource.degrade`'s doc and signature become `/** Reports the capture as degraded, with a code (default 'source_degraded'). */ degrade(message: string, code?: string): void;`
- `const degradedListeners = new Set<(notice: SourceNotice) => void>();` (import `type SourceNotice` from `../../lib/session/source` beside `Source`).
- `degrade(message, code = 'source_degraded') { for (const listener of degradedListeners) listener({ code, message }); },`

`src/lib/session/run.ts`:
1. Build each request without `input`, and add it once the source is open. In `runOpen`, keep the `requests` object as it is. In the `startBoth` branch, after `const sources = await Promise.all(…)`, add:

```ts
      // Built before the sources opened; a source with a track hands it to the adapter (WebRTC).
      shape.legs.forEach((leg, i) => {
        const track = sources[i].track;
        if (track) requests[leg] = { ...requests[leg], input: track };
      });
```

2. In `openLeg`, replace `const session = await this.shape.provider.start(request, this.eventsFor(leg));` with:

```ts
      // Built before the source opened; a source with a track hands it to the adapter (WebRTC).
      const withInput = source.track ? { ...request, input: source.track } : request;
      const session = await this.shape.provider.start(withInput, this.eventsFor(leg));
```

(everything else in `openLeg` — `openSource` first, then `setLegState(leg, 'opening')` — stays as it is).

3. In `openSource`, replace the degradation watch with:

```ts
    this.stack.defer(`${leg} degradation watch`, source.onDegraded(({ code, message }) =>
      conversation.degraded(code, message)));
```

4. Guard `appendAudio`. Add a field `private readonly appendFailing = new Set<LegName>();` and replace `send` with:

```ts
  /** The participant leg and automatic turns stream everything; manual turns send only while the key is held. */
  private send(leg: LegName, session: AdapterSession, pcm: Int16Array): void {
    if (this.ending) return;
    if (leg === 'speaker' && this.shape.turnMode !== 'auto') {
      if (!this.turn?.isOpen) return;
      this.turn.add(pcm);
    }
    // Per chunk: an adapter that throws is reported when it starts failing,
    // and the throw never reaches the source's delivery.
    try {
      session.appendAudio(pcm);
      this.appendFailing.delete(leg);
    } catch (error) {
      if (!this.appendFailing.has(leg)) {
        reportError('SessionRunner', `The ${leg} adapter did not take audio: ${describeCause(error)}`, { cause: error, dedupeKey: `append:${leg}` });
      }
      this.appendFailing.add(leg);
    }
  }
```

and add `reportError` to the import from `../diagnostics/report`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/conversation src/lib/session src/providers/fake`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only. (`src/lib/audio` has no `Source` implementation yet; the dev preview's fake source is updated in this task.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/session src/lib/conversation src/providers/fake
git commit -m "feat(session): sources hand over a track and coded degradations; guard appendAudio; count voice in samples"
```

---

### Task 2: The source core

**Files:**
- Create: `src/lib/audio/capture/core.ts`
- Test: `src/lib/audio/capture/core.test.ts`

**Interfaces:**
- Consumes: `Source`, `SourceNotice` (Task 1); `reportError`, `describeCause`.
- Produces: `interface SourceCore extends Source { deliver(pcm: Int16Array): void; watch(stream: MediaStream | null): () => void; end(reason: string): void; degrade(notice: SourceNotice): void; readonly stopped: boolean; readonly ended: boolean }`; `createSourceCore(options: { muted(): boolean; track(): MediaStreamTrack | undefined; release(): Promise<void> }): SourceCore`; `TRACK_ENDED = 'The capture device went away (unplugged, closed or stopped).'`.

What every source shares, so the three sources only drive their recorders. Chunks reach the listeners unless the source is muted (ruling 2), each listener isolated from the others (a throwing one is reported once per failing streak — a hot path). The source ends at most once — from a watched track's `ended` event (ruling 4) or its owner's `end(reason)` — and after it ends or stops it delivers nothing. `stop()` releases once, however often it is called; a source that was stopped never reports an end. A degradation raised before anyone listens (the system-audio source widens while it is still opening) is held and handed to the first `onDegraded` listener — the runner subscribes as soon as a source resolves.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/capture/core.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSourceCore, TRACK_ENDED } from './core';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../diagnostics/report')>();
  return { ...actual, reportError: reportErrorSpy };
});

/** A track whose `ended` the test fires, and a stream holding it. */
function fakeStream() {
  const track = new EventTarget() as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const end = () => track.dispatchEvent(new Event('ended'));
  return { track, stream, end };
}

function setup(o: { muted?: () => boolean } = {}) {
  const release = vi.fn(async () => {});
  const core = createSourceCore({ muted: o.muted ?? (() => false), track: () => undefined, release });
  return { core, release };
}

const chunk = () => new Int16Array(4);

describe('createSourceCore', () => {
  it('hands each chunk to every listener, and stops handing it after unsubscribe', () => {
    const { core } = setup();
    const a = vi.fn();
    const b = vi.fn();
    const offA = core.onPcm(a);
    core.onPcm(b);
    core.deliver(chunk());
    offA();
    core.deliver(chunk());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('delivers nothing while muted, and resumes when unmuted', () => {
    let muted = true;
    const { core } = setup({ muted: () => muted });
    const heard = vi.fn();
    core.onPcm(heard);
    core.deliver(chunk());
    muted = false;
    core.deliver(chunk());
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('keeps delivering to the others when a listener throws, and reports it once per failing streak', () => {
    const { core } = setup();
    reportErrorSpy.mockClear();
    core.onPcm(() => { throw new Error('sink detached'); });
    const heard = vi.fn();
    core.onPcm(heard);
    core.deliver(chunk());
    core.deliver(chunk());
    expect(heard).toHaveBeenCalledTimes(2);
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('ends once, from a watched track, and delivers nothing after', () => {
    const { core } = setup();
    const { stream, end } = fakeStream();
    core.watch(stream);
    const ended = vi.fn();
    const heard = vi.fn();
    core.onEnded(ended);
    core.onPcm(heard);
    end();
    end();
    core.end('again');
    core.deliver(chunk());
    expect(ended.mock.calls).toEqual([[TRACK_ENDED]]);
    expect(core.ended).toBe(true);
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops watching a track once unwatched', () => {
    const { core } = setup();
    const { stream, end } = fakeStream();
    const unwatch = core.watch(stream);
    const ended = vi.fn();
    core.onEnded(ended);
    unwatch();
    end();
    expect(ended).not.toHaveBeenCalled();
  });

  it('passes a degradation to its listeners', () => {
    const { core } = setup();
    const heard = vi.fn();
    core.onDegraded(heard);
    core.degrade({ code: 'silent_no_permission', message: 'nothing heard yet' });
    expect(heard).toHaveBeenCalledWith({ code: 'silent_no_permission', message: 'nothing heard yet' });
  });

  it('hands a degradation raised before anyone listened to the first listener only', () => {
    const { core } = setup();
    core.degrade({ code: 'app_capture_monitor_missing', message: 'widened while opening' });
    const first = vi.fn();
    const second = vi.fn();
    core.onDegraded(first);
    core.onDegraded(second);
    expect(first).toHaveBeenCalledWith({ code: 'app_capture_monitor_missing', message: 'widened while opening' });
    expect(second).not.toHaveBeenCalled();
  });

  it('releases once however often it is stopped, and a stopped source never reports an end', async () => {
    const { core, release } = setup();
    const { stream, end } = fakeStream();
    core.watch(stream);
    const ended = vi.fn();
    core.onEnded(ended);
    await Promise.all([core.stop(), core.stop()]);
    await core.stop();
    end();
    core.end('late');
    expect(release).toHaveBeenCalledTimes(1);
    expect(core.stopped).toBe(true);
    expect(ended).not.toHaveBeenCalled();
  });

  it('exposes the current track', () => {
    const { track } = fakeStream();
    let current: MediaStreamTrack | undefined;
    const core = createSourceCore({ muted: () => false, track: () => current, release: async () => {} });
    expect(core.track).toBeUndefined();
    current = track;
    expect(core.track).toBe(track);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/capture/core.test.ts`
Expected: FAIL — `Failed to resolve import "./core"`.

- [ ] **Step 3: Implement**

`src/lib/audio/capture/core.ts`:

```ts
/**
 * What every source shares (spec: "Sources, in full"), so the microphone, the
 * system audio and the tab only drive their recorders: listeners, mute, one
 * end, a watched track, one release.
 */
import { describeCause, reportError } from '../../diagnostics/report';
import type { Source, SourceNotice } from '../../session/source';

export const TRACK_ENDED = 'The capture device went away (unplugged, closed or stopped).';

export interface SourceCore extends Source {
  /** Hands a chunk to the listeners, unless muted, ended or stopped. */
  deliver(pcm: Int16Array): void;
  /** Ends the source when the stream's audio track ends; returns the unwatch. */
  watch(stream: MediaStream | null): () => void;
  /** Ends the source with a reason, once; nothing after a stop. */
  end(reason: string): void;
  degrade(notice: SourceNotice): void;
  readonly stopped: boolean;
  readonly ended: boolean;
}

export interface SourceCoreOptions {
  /** Read on every chunk: mute takes effect at once. */
  muted(): boolean;
  track(): MediaStreamTrack | undefined;
  /** Stops the recorders; called once, by the first `stop()`. */
  release(): Promise<void>;
}

export function createSourceCore(options: SourceCoreOptions): SourceCore {
  const pcmListeners = new Set<(pcm: Int16Array) => void>();
  const endedListeners = new Set<(reason: string) => void>();
  const degradedListeners = new Set<(notice: SourceNotice) => void>();
  /** Degradations raised before anyone listened: the first listener gets them. */
  const held: SourceNotice[] = [];
  let ended = false;
  let stopping: Promise<void> | null = null;
  let failing = false;

  const listen = <T>(set: Set<T>, listener: T) => {
    set.add(listener);
    return () => { set.delete(listener); };
  };

  const end = (reason: string) => {
    if (ended || stopping) return;
    ended = true;
    for (const listener of [...endedListeners]) listener(reason);
  };

  return {
    onPcm: (listener) => listen(pcmListeners, listener),
    onEnded: (listener) => listen(endedListeners, listener),
    onDegraded: (listener) => {
      const off = listen(degradedListeners, listener);
      for (const notice of held.splice(0)) listener(notice);
      return off;
    },
    get track() {
      return options.track();
    },

    deliver(pcm) {
      if (ended || stopping || options.muted()) return;
      let threw = false;
      for (const listener of pcmListeners) {
        try {
          listener(pcm);
        } catch (error) {
          threw = true;
          // Per chunk: report when a listener starts failing, not on every chunk after.
          if (!failing) reportError('SourceCore', `A capture listener threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'source:listener' });
        }
      }
      failing = threw;
    },

    watch(stream) {
      const track = stream?.getAudioTracks()[0];
      if (!track) return () => {};
      const onEnded = () => end(TRACK_ENDED);
      track.addEventListener('ended', onEnded);
      return () => track.removeEventListener('ended', onEnded);
    },

    end,

    degrade(notice) {
      if (ended || stopping) return;
      if (degradedListeners.size === 0) {
        held.push(notice);
        return;
      }
      for (const listener of [...degradedListeners]) listener(notice);
    },

    stop() {
      stopping ??= options.release();
      return stopping;
    },

    get stopped() {
      return stopping !== null;
    },

    get ended() {
      return ended;
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio/capture/core.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/capture
git commit -m "feat(audio): the source core — listeners, mute, one end, a watched track, one release"
```

---
### Task 3: The microphone

**Files:**
- Modify: `src/lib/modern-audio/BaseAudioRecorder.ts` (one public getter)
- Create: `src/lib/audio/capture/mic.ts`
- Test: `src/lib/modern-audio/BaseAudioRecorder.test.ts` (new), `src/lib/audio/capture/mic.test.ts`

**Interfaces:**
- Consumes: `createSourceCore`, `TRACK_ENDED` (Task 2); `Source`; `ModernAudioRecorder` (`src/lib/modern-audio/ModernAudioRecorder.ts`: `begin(deviceId?)` throws a `MicrophoneCaptureError` whose message tells the user what to do; `record(cb)`; `end()`; `setNoiseSuppressionMode(mode)` — applied at once to a running graph, or recorded and applied at the next `begin`); `SAMPLE_RATE`; `reportWarning`, `describeCause`.
- Produces:
  - `BaseAudioRecorder.getStream(): MediaStream | null`.
  - `type NoiseSuppression = 'off' | 'standard' | 'enhanced'`; `interface MicSettings { deviceId(): string | undefined; noiseSuppression(): NoiseSuppression; muted(): boolean; subscribe(listener: () => void): () => void }`; `interface MicRecorder { begin(deviceId?: string): Promise<boolean>; record(chunk: (data: { mono: Int16Array }) => void): Promise<boolean>; end(): Promise<unknown>; setNoiseSuppressionMode(mode: NoiseSuppression): Promise<void>; getStream(): MediaStream | null }`; `openMic(settings: MicSettings, signal: AbortSignal, createRecorder?: () => MicRecorder): Promise<Source>`.

`ModernAudioRecorder` as the speaker's source. It opens on the selected device with the selected noise suppression (set before `begin`, which applies it when the graph is built), delivers through the core (so mute holds, ruling 2), and follows the settings during the run: a noise-suppression change goes to the running recorder; a device change ends it and opens it on the new device (`switchRecordingDevice` today), one change at a time. A switch that fails ends the source with the reason (ruling 6). The track is watched (ruling 4). A cancel that lands while it opens stops what opened and rejects; a `begin` that fails rejects with the recorder's own message and releases nothing (the recorder tears itself down).

- [ ] **Step 1: Write the failing tests**

`src/lib/modern-audio/BaseAudioRecorder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BaseAudioRecorder } from './BaseAudioRecorder';

class Probe extends BaseAudioRecorder {
  protected getLogPrefix(): string {
    return '[Probe]';
  }

  capture(stream: MediaStream | null): void {
    this.stream = stream;
  }
}

describe('BaseAudioRecorder.getStream', () => {
  it('exposes the capture stream while there is one', () => {
    const probe = new Probe();
    expect(probe.getStream()).toBeNull();
    const stream = { id: 's1' } as MediaStream;
    probe.capture(stream);
    expect(probe.getStream()).toBe(stream);
  });
});
```

`src/lib/audio/capture/mic.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TRACK_ENDED } from './core';
import { openMic, type MicRecorder, type MicSettings, type NoiseSuppression } from './mic';

/** A recorder that records its calls; `push` delivers a chunk while it records, `endTrack` unplugs its device. */
function fakeRecorder(o: { failBegins?: number[] } = {}) {
  const track = new EventTarget() as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const calls: string[] = [];
  let begins = 0;
  let open = false;
  let chunk: ((data: { mono: Int16Array }) => void) | null = null;
  const recorder: MicRecorder = {
    async begin(deviceId) {
      begins += 1;
      calls.push(`begin:${deviceId ?? 'default'}`);
      if (o.failBegins?.includes(begins)) throw new Error('The selected microphone is no longer available (NotFoundError).');
      open = true;
      return true;
    },
    async record(fn) {
      calls.push('record');
      chunk = fn;
      return true;
    },
    async end() {
      calls.push('end');
      open = false;
      chunk = null;
      return {};
    },
    async setNoiseSuppressionMode(mode) {
      calls.push(`ns:${mode}`);
    },
    getStream: () => (open ? stream : null),
  };
  return {
    recorder,
    calls,
    track,
    push: (pcm = new Int16Array(4)) => chunk?.({ mono: pcm }),
    endTrack: () => track.dispatchEvent(new Event('ended')),
  };
}

function settingsFixture(initial: { deviceId?: string; noiseSuppression?: NoiseSuppression; muted?: boolean } = {}) {
  let current = { deviceId: 'mic-1' as string | undefined, noiseSuppression: 'off' as NoiseSuppression, muted: false, ...initial };
  const listeners = new Set<() => void>();
  const settings: MicSettings = {
    deviceId: () => current.deviceId,
    noiseSuppression: () => current.noiseSuppression,
    muted: () => current.muted,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const set = (patch: Partial<typeof current>) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  };
  return { settings, set, listeners };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const live = () => new AbortController().signal;

describe('openMic', () => {
  it('opens the selected device with its noise suppression, and delivers its chunks', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture({ noiseSuppression: 'standard' });
    const source = await openMic(settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    fake.push();
    expect(fake.calls).toEqual(['ns:standard', 'begin:mic-1', 'record']);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(source.track).toBe(fake.track);
  });

  it("rejects with the recorder's message when the device will not open, and releases nothing", async () => {
    const fake = fakeRecorder({ failBegins: [1] });
    const { settings, listeners } = settingsFixture();
    await expect(openMic(settings, live(), () => fake.recorder)).rejects.toThrow('no longer available');
    expect(fake.calls).not.toContain('end');
    expect(listeners.size).toBe(0);
  });

  it('stops what it opened when the run was cancelled while it opened', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture();
    const cancel = new AbortController();
    cancel.abort(new Error('the run ended'));
    await expect(openMic(settings, cancel.signal, () => fake.recorder)).rejects.toThrow('the run ended');
    expect(fake.calls).toContain('end');
  });

  it('delivers nothing while muted, at once', async () => {
    const fake = fakeRecorder();
    const { settings, set } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    set({ muted: true });
    fake.push();
    set({ muted: false });
    fake.push();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('applies a noise-suppression change to the running recorder, without reopening it', async () => {
    const fake = fakeRecorder();
    const { settings, set } = settingsFixture();
    await openMic(settings, live(), () => fake.recorder);
    set({ noiseSuppression: 'enhanced' });
    await settle();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'ns:enhanced']);
  });

  it('moves to a newly selected device in place, keeping its listeners', async () => {
    const fake = fakeRecorder();
    const { settings, set } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const heard = vi.fn();
    source.onPcm(heard);
    set({ deviceId: 'mic-2' });
    await settle();
    fake.push();
    expect(fake.calls).toEqual(['ns:off', 'begin:mic-1', 'record', 'end', 'begin:mic-2', 'record']);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('ends with the reason when a device switch fails', async () => {
    const fake = fakeRecorder({ failBegins: [2] });
    const { settings, set } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const ended = vi.fn();
    source.onEnded(ended);
    set({ deviceId: 'gone' });
    await settle();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(String(ended.mock.calls[0][0])).toContain('no longer available');
  });

  it('ends when its device goes away', async () => {
    const fake = fakeRecorder();
    const { settings } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    const ended = vi.fn();
    source.onEnded(ended);
    fake.endTrack();
    expect(ended).toHaveBeenCalledWith(TRACK_ENDED);
  });

  it('stops once: ends the recorder and follows the settings no more', async () => {
    const fake = fakeRecorder();
    const { settings, set, listeners } = settingsFixture();
    const source = await openMic(settings, live(), () => fake.recorder);
    await source.stop();
    await source.stop();
    set({ deviceId: 'mic-3' });
    await settle();
    expect(fake.calls.filter((c) => c === 'end')).toHaveLength(1);
    expect(fake.calls).not.toContain('begin:mic-3');
    expect(listeners.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/modern-audio/BaseAudioRecorder.test.ts src/lib/audio/capture/mic.test.ts`
Expected: FAIL — `probe.getStream is not a function`; `Failed to resolve import "./mic"`.

- [ ] **Step 3: Implement**

`src/lib/modern-audio/BaseAudioRecorder.ts` — add after `isRecording()` (the only edit to this file, and the only edit to `src/lib/modern-audio/` in this plan):

```ts
  /**
   * The live capture stream, or null when there is none: for watching its
   * track's end and handing the track to an adapter (the client-contract
   * capture layer, `src/lib/audio/capture/`).
   */
  getStream(): MediaStream | null {
    return this.stream;
  }
```

`src/lib/audio/capture/mic.ts`:

```ts
/**
 * The microphone as the speaker's source (spec: "Capture belongs to the
 * runner"): `ModernAudioRecorder` — 48 kHz capture, RNNoise / GTCRN, 24 kHz
 * chunks — opened on the selected device, following the device and the noise
 * suppression during the run (today's `switchRecordingDevice` and MainPanel's
 * noise-suppression effect).
 */
import { SAMPLE_RATE } from '../../contract/adapter';
import { describeCause, reportWarning } from '../../diagnostics/report';
import { ModernAudioRecorder } from '../../modern-audio/ModernAudioRecorder';
import type { Source } from '../../session/source';
import { createSourceCore } from './core';

export type NoiseSuppression = 'off' | 'standard' | 'enhanced';

/** The settings a microphone follows, read live. */
export interface MicSettings {
  deviceId(): string | undefined;
  noiseSuppression(): NoiseSuppression;
  muted(): boolean;
  /** Called when any of them may have changed. */
  subscribe(listener: () => void): () => void;
}

/** The part of `ModernAudioRecorder` a microphone drives. */
export interface MicRecorder {
  /** Throws a `MicrophoneCaptureError` whose message says what to do. */
  begin(deviceId?: string): Promise<boolean>;
  record(chunk: (data: { mono: Int16Array }) => void): Promise<boolean>;
  end(): Promise<unknown>;
  setNoiseSuppressionMode(mode: NoiseSuppression): Promise<void>;
  getStream(): MediaStream | null;
}

export async function openMic(
  settings: MicSettings,
  signal: AbortSignal,
  createRecorder: () => MicRecorder = () => new ModernAudioRecorder({ sampleRate: SAMPLE_RATE }),
): Promise<Source> {
  const recorder = createRecorder();
  let deviceId = settings.deviceId();
  let mode = settings.noiseSuppression();
  /** Whether the recorder has begun and not ended: only then is there anything to end. */
  let open = false;
  let unwatch = () => {};
  let unsubscribe = () => {};
  let chain: Promise<void> = Promise.resolve();

  const close = async () => {
    unwatch();
    unwatch = () => {};
    if (!open) return;
    open = false;
    await recorder.end();
  };

  const core = createSourceCore({
    muted: () => settings.muted(),
    track: () => recorder.getStream()?.getAudioTracks()[0],
    release: async () => {
      unsubscribe();
      // A switch in flight finishes (or fails) before the recorder is ended.
      await chain;
      try {
        await close();
      } catch (error) {
        reportWarning('Microphone', `Stopping the microphone failed: ${describeCause(error)}`, { dedupeKey: 'mic:end' });
      }
    },
  });

  const begin = async () => {
    await recorder.begin(deviceId);
    open = true;
    unwatch = core.watch(recorder.getStream());
    await recorder.record((data) => core.deliver(data.mono));
  };

  // Recorded now and applied when `begin` builds the graph.
  await recorder.setNoiseSuppressionMode(mode);
  try {
    await begin();
  } catch (error) {
    await core.stop();
    throw error;
  }
  if (signal.aborted) {
    await core.stop();
    throw signal.reason ?? new Error('aborted');
  }

  unsubscribe = settings.subscribe(() => {
    chain = chain
      .then(async () => {
        if (core.stopped || core.ended) return;
        const nextMode = settings.noiseSuppression();
        if (nextMode !== mode) {
          mode = nextMode;
          await recorder.setNoiseSuppressionMode(mode);
        }
        const nextDevice = settings.deviceId();
        if (nextDevice === deviceId) return;
        deviceId = nextDevice;
        await close();
        if (core.stopped) return;
        await begin();
      })
      .catch((error: unknown) => core.end(`The microphone could not switch: ${describeCause(error)}`));
  });
  return core;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/modern-audio/BaseAudioRecorder.test.ts src/lib/audio/capture`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only (it now also covers `src/lib/modern-audio/BaseAudioRecorder*`). `ModernAudioRecorder` must satisfy `MicRecorder` where `openMic`'s default factory returns it; if TypeScript rejects that assignment, report the error rather than casting it away.

- [ ] **Step 6: Commit**

```bash
git add src/lib/modern-audio/BaseAudioRecorder.ts src/lib/modern-audio/BaseAudioRecorder.test.ts src/lib/audio/capture
git commit -m "feat(audio): the microphone as a source — mute, device switching and noise suppression live, a lost device ends it"
```

---

### Task 4: Electron's system audio

**Files:**
- Create: `src/lib/audio/capture/systemAudio.ts`
- Test: `src/lib/audio/capture/systemAudio.test.ts`

**Interfaces:**
- Consumes: `createSourceCore` (Task 2); `Source`; `AppAudioRecorder`, `DeviceCaptureRecorder`, `LoopbackRecorder` (`src/lib/modern-audio/`; their `begin(options)` returns `false` — logging why — rather than throwing, and cleans up after itself); `window.electron.invoke` (typed in `src/electron.d.ts`); `SAMPLE_RATE`; `reportWarning`, `describeCause`.
- Produces: `APP_CAPTURE_LOST = 'app_capture_lost_using_system_audio'`, `APP_MONITOR_MISSING = 'app_capture_monitor_missing'`, `SILENT_NO_PERMISSION = 'silent_no_permission'`; `interface SystemAudioSettings { sourceId(): string; muted(): boolean; subscribe(listener: () => void): () => void; audioSeen(): void }`; `interface ParticipantCapture { begin(options?: { deviceId?: string }): Promise<boolean>; record(callback: (data: { mono: Int16Array }) => void): Promise<boolean>; end(): Promise<void>; getStream?(): MediaStream | null; onLost?: (() => void) | null; onWarning?: ((code: string) => void) | null; onAudioSeen?: (() => void) | null }`; `interface SystemAudioDeps { invoke(channel: string, data?: unknown): Promise<unknown>; enumerateDevices(): Promise<MediaDeviceInfo[]>; wait(ms: number): Promise<void>; app(): ParticipantCapture; device(): ParticipantCapture; loopback(): ParticipantCapture }`; `electronSystemAudio(): SystemAudioDeps`; `openSystemAudio(settings: SystemAudioSettings, signal: AbortSignal, deps?: SystemAudioDeps): Promise<Source>`.

The participant source in Electron, replacing `ModernBrowserAudioService`'s sequence (`connectSystemAudioSource` → `startSystemAudioRecording` and its three branches → `stopSystemAudioRecording` → `disconnectSystemAudioSource`, `src/lib/modern-audio/ModernBrowserAudioService.ts:978-1223, 1297-1318`; the current-state notes §2 walk it through). Connect the chosen source over IPC; the main process answers `capture: 'app'` (the helper: Windows per-application, and all of macOS), a `monitorLabel` (Linux per-application: a PipeWire tap, recorded through its monitor device, found by label with ten 100 ms retries), or neither (loopback: whole-system on Windows and Linux). A monitor that never appears widens to loopback, visibly (`APP_MONITOR_MISSING`). A helper that dies degrades and falls back to loopback (ruling 5); one whose fallback cannot start ends the source. The helper's warning codes become coded degradations; its first audible audio calls `settings.audioSeen()` (issue #492's memory, `markParticipantTapAudioSeen` today). A changed source during the run disconnects and connects again in place, one change at a time (ruling 6). Stopping detaches the helper's `onLost` before ending it — its own teardown is not a loss — then disconnects.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/capture/systemAudio.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TRACK_ENDED } from './core';
import {
  APP_CAPTURE_LOST, APP_MONITOR_MISSING, SILENT_NO_PERMISSION, openSystemAudio,
  type ParticipantCapture, type SystemAudioDeps, type SystemAudioSettings,
} from './systemAudio';

/** A participant recorder that records its calls; `push` delivers a chunk while it records. */
function fakeCapture(o: { begins?: boolean; stream?: MediaStream } = {}) {
  let callback: ((data: { mono: Int16Array }) => void) | null = null;
  const capture = {
    begun: [] as Array<{ deviceId?: string } | undefined>,
    ended: 0,
    onLost: null as (() => void) | null,
    onWarning: null as ((code: string) => void) | null,
    onAudioSeen: null as (() => void) | null,
    async begin(options?: { deviceId?: string }) {
      capture.begun.push(options);
      return o.begins ?? true;
    },
    async record(fn: (data: { mono: Int16Array }) => void) {
      callback = fn;
      return true;
    },
    async end() {
      capture.ended += 1;
      // A helper killed by its own teardown reports an exit; `onLost` must be detached by now.
      capture.onLost?.();
      callback = null;
    },
    getStream: () => o.stream ?? null,
    push: (pcm = new Int16Array(4)) => callback?.({ mono: pcm }),
  };
  return capture satisfies ParticipantCapture;
}

function setup(o: {
  answer?: unknown;
  devices?: Array<{ kind: string; label: string; deviceId: string }>;
  app?: ReturnType<typeof fakeCapture>;
  device?: ReturnType<typeof fakeCapture>;
  loopback?: ReturnType<typeof fakeCapture>;
  sourceId?: string;
} = {}) {
  const invoked: Array<[string, unknown]> = [];
  const answers: unknown[] = Array.isArray(o.answer) ? [...o.answer] : [o.answer ?? { success: true, capture: 'system' }];
  const app = o.app ?? fakeCapture();
  const device = o.device ?? fakeCapture();
  const loopback = o.loopback ?? fakeCapture();
  const wait = vi.fn(async () => {});
  const deps: SystemAudioDeps = {
    invoke: async (channel, data) => {
      invoked.push([channel, data]);
      return channel === 'connect-system-audio-source' ? (answers.length > 1 ? answers.shift() : answers[0]) : { success: true };
    },
    enumerateDevices: async () => (o.devices ?? []) as MediaDeviceInfo[],
    wait,
    app: () => app,
    device: () => device,
    loopback: () => loopback,
  };
  let current = { sourceId: o.sourceId ?? 'desktop-audio-loopback', muted: false };
  const listeners = new Set<() => void>();
  const audioSeen = vi.fn();
  const settings: SystemAudioSettings = {
    sourceId: () => current.sourceId,
    muted: () => current.muted,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    audioSeen,
  };
  const set = (patch: Partial<typeof current>) => {
    current = { ...current, ...patch };
    for (const listener of listeners) listener();
  };
  return { deps, settings, set, invoked, app, device, loopback, wait, audioSeen };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const live = () => new AbortController().signal;

describe('openSystemAudio — opening', () => {
  it('records an application through the helper when the main process asks for it', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const heard = vi.fn();
    source.onPcm(heard);
    s.app.push();
    expect(s.invoked[0]).toEqual(['connect-system-audio-source', 'app:42']);
    expect(s.app.begun).toEqual([{ deviceId: 'app:42' }]);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("records a PipeWire tap through its monitor device, found by label", async () => {
    const s = setup({
      sourceId: 'app:7',
      answer: { success: true, monitorLabel: 'Sokuji Capture' },
      devices: [{ kind: 'audioinput', label: 'Monitor of Sokuji Capture', deviceId: 'mon-1' }],
    });
    await openSystemAudio(s.settings, live(), s.deps);
    expect(s.device.begun).toEqual([{ deviceId: 'mon-1' }]);
  });

  it("widens to whole-system capture, visibly, when the tap's monitor never appears", async () => {
    const s = setup({ sourceId: 'app:7', answer: { success: true, monitorLabel: 'Sokuji Capture' } });
    const degraded = vi.fn();
    const source = await openSystemAudio(s.settings, live(), s.deps);
    // Raised while it opened, held by the core for the first listener (the leg's).
    source.onDegraded(degraded);
    expect(s.wait).toHaveBeenCalledTimes(10);
    expect(s.loopback.begun).toEqual([undefined]);
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: APP_MONITOR_MISSING }));
  });

  it('records the whole system through loopback otherwise', async () => {
    const s = setup();
    await openSystemAudio(s.settings, live(), s.deps);
    expect(s.loopback.begun).toEqual([undefined]);
  });

  it('rejects when the source will not connect', async () => {
    const s = setup({ answer: { success: false, error: 'helper missing' } });
    await expect(openSystemAudio(s.settings, live(), s.deps)).rejects.toThrow('helper missing');
    expect(s.invoked.map(([c]) => c)).toEqual(['connect-system-audio-source']);
  });

  it('rejects and disconnects when the recorder will not begin', async () => {
    const s = setup({ loopback: fakeCapture({ begins: false }) });
    await expect(openSystemAudio(s.settings, live(), s.deps)).rejects.toThrow();
    expect(s.invoked.map(([c]) => c)).toEqual(['connect-system-audio-source', 'disconnect-system-audio-source']);
  });

  it('stops what it opened when the run was cancelled while it opened', async () => {
    const s = setup();
    const cancel = new AbortController();
    cancel.abort(new Error('the run ended'));
    await expect(openSystemAudio(s.settings, cancel.signal, s.deps)).rejects.toThrow('the run ended');
    expect(s.loopback.ended).toBe(1);
    expect(s.invoked.map(([c]) => c)).toContain('disconnect-system-audio-source');
  });
});

describe('openSystemAudio — running', () => {
  it('falls back to whole-system capture, visibly, when the helper dies', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    s.app.onLost?.();
    await settle();
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: APP_CAPTURE_LOST }));
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(s.app.ended).toBe(1);
    expect(s.loopback.begun).toEqual([undefined]);
  });

  it('ends when the fallback cannot start', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' }, loopback: fakeCapture({ begins: false }) });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const ended = vi.fn();
    source.onEnded(ended);
    s.app.onLost?.();
    await settle();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("passes the helper's warning on as a coded degradation, and its first audible audio to the settings", async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    s.app.onWarning?.(SILENT_NO_PERMISSION);
    s.app.onAudioSeen?.();
    expect(degraded).toHaveBeenCalledWith(expect.objectContaining({ code: SILENT_NO_PERMISSION }));
    expect(s.audioSeen).toHaveBeenCalledTimes(1);
  });

  it('ends when the captured track ends', async () => {
    const track = new EventTarget() as MediaStreamTrack;
    const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
    const s = setup({ loopback: fakeCapture({ stream }) });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const ended = vi.fn();
    source.onEnded(ended);
    track.dispatchEvent(new Event('ended'));
    expect(ended).toHaveBeenCalledWith(TRACK_ENDED);
  });

  it('delivers nothing while muted', async () => {
    const s = setup();
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const heard = vi.fn();
    source.onPcm(heard);
    s.set({ muted: true });
    s.loopback.push();
    expect(heard).not.toHaveBeenCalled();
  });

  it('moves to a newly chosen source in place: stops, disconnects, connects and records again', async () => {
    const s = setup({ answer: [{ success: true, capture: 'system' }, { success: true, capture: 'app' }] });
    await openSystemAudio(s.settings, live(), s.deps);
    s.set({ sourceId: 'app:9' });
    await settle();
    expect(s.loopback.ended).toBe(1);
    expect(s.invoked.map(([c, d]) => `${c}:${d ?? ''}`)).toEqual([
      'connect-system-audio-source:desktop-audio-loopback',
      'disconnect-system-audio-source:',
      'connect-system-audio-source:app:9',
    ]);
    expect(s.app.begun).toEqual([{ deviceId: 'app:9' }]);
  });

  it('stops once: ends the recorder without reading its own teardown as a loss, then disconnects', async () => {
    const s = setup({ sourceId: 'app:42', answer: { success: true, capture: 'app' } });
    const source = await openSystemAudio(s.settings, live(), s.deps);
    const degraded = vi.fn();
    source.onDegraded(degraded);
    await source.stop();
    await source.stop();
    expect(s.app.ended).toBe(1);
    expect(degraded).not.toHaveBeenCalled();
    expect(s.loopback.begun).toEqual([]);
    expect(s.invoked.filter(([c]) => c === 'disconnect-system-audio-source')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/capture/systemAudio.test.ts`
Expected: FAIL — `Failed to resolve import "./systemAudio"`.

- [ ] **Step 3: Implement**

`src/lib/audio/capture/systemAudio.ts`:

```ts
/**
 * Electron's system audio as the participant source (spec: "Sources, in
 * full"), replacing `ModernBrowserAudioService`'s sequence step by step:
 * connect the chosen source over IPC, then record it with the recorder the
 * main process asks for — the per-application helper (Windows, and all of
 * macOS), a PipeWire tap's monitor device (Linux per-application), or
 * getDisplayMedia loopback (whole-system on Windows and Linux).
 */
import { SAMPLE_RATE } from '../../contract/adapter';
import { describeCause, reportWarning } from '../../diagnostics/report';
import { AppAudioRecorder } from '../../modern-audio/AppAudioRecorder';
import { DeviceCaptureRecorder } from '../../modern-audio/DeviceCaptureRecorder';
import { LoopbackRecorder } from '../../modern-audio/LoopbackRecorder';
import type { Source } from '../../session/source';
import { createSourceCore } from './core';

export const APP_CAPTURE_LOST = 'app_capture_lost_using_system_audio';
export const APP_MONITOR_MISSING = 'app_capture_monitor_missing';
export const SILENT_NO_PERMISSION = 'silent_no_permission';

/** The settings a system-audio source follows, read live. */
export interface SystemAudioSettings {
  /** The chosen participant source: 'desktop-audio-loopback' (the whole system) or an 'app:…' id. */
  sourceId(): string;
  muted(): boolean;
  subscribe(listener: () => void): () => void;
  /** The helper heard audible audio: remembered, so a later silence reads as a permission problem (#492). */
  audioSeen(): void;
}

/** The part of a participant recorder this source drives. */
export interface ParticipantCapture {
  /** False when it cannot capture (it logs why and cleans up after itself). */
  begin(options?: { deviceId?: string }): Promise<boolean>;
  record(callback: (data: { mono: Int16Array }) => void): Promise<boolean>;
  end(): Promise<void>;
  getStream?(): MediaStream | null;
  onLost?: (() => void) | null;
  onWarning?: ((code: string) => void) | null;
  onAudioSeen?: (() => void) | null;
}

export interface SystemAudioDeps {
  invoke(channel: string, data?: unknown): Promise<unknown>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  wait(ms: number): Promise<void>;
  app(): ParticipantCapture;
  device(): ParticipantCapture;
  loopback(): ParticipantCapture;
}

export const electronSystemAudio = (): SystemAudioDeps => ({
  invoke: (channel, data) => window.electron.invoke(channel, data),
  enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  app: () => new AppAudioRecorder(SAMPLE_RATE),
  device: () => new DeviceCaptureRecorder(SAMPLE_RATE),
  loopback: () => new LoopbackRecorder(SAMPLE_RATE),
});

type Connection = { mode: 'app' } | { mode: 'device'; monitorId: string } | { mode: 'loopback' };

interface ConnectAnswer {
  success?: boolean;
  error?: string;
  capture?: string;
  monitorLabel?: string;
}

const SILENT_MESSAGE =
  'No audio has come through from the selected source yet: it may be silent, or Sokuji may lack permission to record it.';

export async function openSystemAudio(
  settings: SystemAudioSettings,
  signal: AbortSignal,
  deps: SystemAudioDeps = electronSystemAudio(),
): Promise<Source> {
  let sourceId = settings.sourceId();
  let recorder: ParticipantCapture | null = null;
  let connected = false;
  let unwatch = () => {};
  let unsubscribe = () => {};
  let chain: Promise<void> = Promise.resolve();

  /** Ends the recorder: its `onLost` detached first, since its own teardown kills the helper. */
  const stopRecorder = async () => {
    const current = recorder;
    recorder = null;
    unwatch();
    unwatch = () => {};
    if (!current) return;
    current.onLost = null;
    try {
      await current.end();
    } catch (error) {
      reportWarning('SystemAudio', `Stopping the system audio capture failed: ${describeCause(error)}`, { dedupeKey: 'system:end' });
    }
  };

  const close = async () => {
    await stopRecorder();
    if (!connected) return;
    connected = false;
    try {
      await deps.invoke('disconnect-system-audio-source');
    } catch (error) {
      reportWarning('SystemAudio', `Disconnecting the system audio source failed: ${describeCause(error)}`, { dedupeKey: 'system:disconnect' });
    }
  };

  const core = createSourceCore({
    muted: () => settings.muted(),
    track: () => recorder?.getStream?.()?.getAudioTracks()[0],
    release: async () => {
      unsubscribe();
      await chain;
      await close();
    },
  });

  /** A PipeWire tap's sink appears in the browser's device list a moment after it is created: retry briefly. */
  const findMonitor = async (label: string): Promise<string | undefined> => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const match = (await deps.enumerateDevices()).find((d) => d.kind === 'audioinput' && d.label.includes(label));
      if (match) return match.deviceId;
      await deps.wait(100);
    }
    return undefined;
  };

  const connect = async (id: string): Promise<Connection> => {
    const answer = (await deps.invoke('connect-system-audio-source', id)) as ConnectAnswer | undefined;
    if (answer?.success === false) throw new Error(answer.error || 'The system audio source did not connect.');
    connected = true;
    if (answer?.capture === 'app') return { mode: 'app' };
    if (answer?.monitorLabel) {
      const monitorId = await findMonitor(answer.monitorLabel);
      if (monitorId) return { mode: 'device', monitorId };
      // Widening from one application to the whole system must be visible.
      core.degrade({ code: APP_MONITOR_MISSING, message: 'The application capture did not appear, so all system audio is being translated instead.' });
    }
    return { mode: 'loopback' };
  };

  const record = async (connection: Connection) => {
    const next = connection.mode === 'app' ? deps.app() : connection.mode === 'device' ? deps.device() : deps.loopback();
    if (connection.mode === 'app') {
      next.onWarning = (code) => core.degrade({ code, message: code === SILENT_NO_PERMISSION ? SILENT_MESSAGE : `The application capture warned: ${code}` });
      next.onAudioSeen = () => settings.audioSeen();
      next.onLost = () => {
        chain = chain.then(fallBack).catch((error: unknown) => core.end(`System audio stopped: ${describeCause(error)}`));
      };
    }
    recorder = next;
    const options = connection.mode === 'app' ? { deviceId: sourceId } : connection.mode === 'device' ? { deviceId: connection.monitorId } : undefined;
    if (!(await next.begin(options))) {
      recorder = null;
      throw new Error('The system audio capture did not start.');
    }
    unwatch = core.watch(next.getStream?.() ?? null);
    await next.record((data) => core.deliver(data.mono));
  };

  /** The helper died: widen to whole-system capture, visibly (ruling 5). */
  const fallBack = async () => {
    if (core.stopped || core.ended) return;
    core.degrade({ code: APP_CAPTURE_LOST, message: 'The application capture stopped, so all system audio is being translated instead.' });
    await stopRecorder();
    await record({ mode: 'loopback' });
  };

  try {
    await record(await connect(sourceId));
  } catch (error) {
    await close();
    throw error;
  }
  if (signal.aborted) {
    await core.stop();
    throw signal.reason ?? new Error('aborted');
  }

  unsubscribe = settings.subscribe(() => {
    const next = settings.sourceId();
    if (next === sourceId) return;
    sourceId = next;
    chain = chain
      .then(async () => {
        if (core.stopped || core.ended) return;
        await close();
        await record(await connect(sourceId));
      })
      .catch((error: unknown) => core.end(`The participant source could not switch: ${describeCause(error)}`));
  });
  return core;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio/capture`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only. The three recorder classes must satisfy `ParticipantCapture` where `electronSystemAudio` returns them (`AppAudioRecorder` has no `getStream`, which is optional; `DeviceCaptureRecorder` and `LoopbackRecorder` inherit Task 3's). If TypeScript rejects one, report the error rather than casting it away.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/capture
git commit -m "feat(audio): Electron's system audio as a source — app, tap and loopback capture, a dead helper widens visibly"
```

---

### Task 5: The extension's tab

**Files:**
- Create: `src/lib/audio/capture/tab.ts`
- Test: `src/lib/audio/capture/tab.test.ts`

**Interfaces:**
- Consumes: `createSourceCore` (Task 2); `Source`; `TabAudioRecorder` (`src/lib/modern-audio/TabAudioRecorder.ts`: `begin({ tabId?, outputDeviceId? })` returns `false` rather than throwing; it plays the capture back on `outputDeviceId`, since Chrome mutes a captured tab); `SAMPLE_RATE`; `reportWarning`, `describeCause`.
- Produces: `interface TabSettings { tabId(): number | null; outputDeviceId(): string | undefined; muted(): boolean }`; `interface TabCapture { begin(options?: { tabId?: number; outputDeviceId?: string }): Promise<boolean>; record(callback: (data: { mono: Int16Array }) => void): Promise<boolean>; end(): Promise<void>; getStream(): MediaStream | null }`; `openTab(settings: TabSettings, signal: AbortSignal, createRecorder?: () => TabCapture): Promise<Source>`.

The participant source in the extension (`startTabAudioRecording` today): capture the meeting tab — the one the side panel was opened for (`?tabId=`), or the recorder's own fallback, the active tab — played back on the monitor device chosen when capture begins (ruling 8). A closed tab ends it (ruling 4).

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/capture/tab.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TRACK_ENDED } from './core';
import { openTab, type TabCapture, type TabSettings } from './tab';

function fakeTab(o: { begins?: boolean } = {}) {
  const track = new EventTarget() as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  let callback: ((data: { mono: Int16Array }) => void) | null = null;
  const tab = {
    begun: [] as Array<{ tabId?: number; outputDeviceId?: string } | undefined>,
    ended: 0,
    async begin(options?: { tabId?: number; outputDeviceId?: string }) {
      tab.begun.push(options);
      return o.begins ?? true;
    },
    async record(fn: (data: { mono: Int16Array }) => void) {
      callback = fn;
      return true;
    },
    async end() {
      tab.ended += 1;
      callback = null;
    },
    getStream: () => stream,
    push: (pcm = new Int16Array(4)) => callback?.({ mono: pcm }),
    close: () => track.dispatchEvent(new Event('ended')),
  };
  return tab satisfies TabCapture;
}

function settingsFixture(o: { tabId?: number | null; outputDeviceId?: string; muted?: boolean } = {}) {
  let muted = o.muted ?? false;
  const settings: TabSettings = {
    tabId: () => (o.tabId === undefined ? 17 : o.tabId),
    outputDeviceId: () => o.outputDeviceId ?? 'speakers-1',
    muted: () => muted,
  };
  return { settings, mute: (next: boolean) => { muted = next; } };
}

const live = () => new AbortController().signal;

describe('openTab', () => {
  it('captures the meeting tab, played back on the monitor device, and delivers its chunks', async () => {
    const tab = fakeTab();
    const source = await openTab(settingsFixture().settings, live(), () => tab);
    const heard = vi.fn();
    source.onPcm(heard);
    tab.push();
    expect(tab.begun).toEqual([{ tabId: 17, outputDeviceId: 'speakers-1' }]);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("leaves the tab to the recorder's own fallback when the side panel names none", async () => {
    const tab = fakeTab();
    await openTab(settingsFixture({ tabId: null }).settings, live(), () => tab);
    expect(tab.begun).toEqual([{ tabId: undefined, outputDeviceId: 'speakers-1' }]);
  });

  it('rejects when the tab will not be captured', async () => {
    const tab = fakeTab({ begins: false });
    await expect(openTab(settingsFixture().settings, live(), () => tab)).rejects.toThrow();
    expect(tab.ended).toBe(0);
  });

  it('stops what it opened when the run was cancelled while it opened', async () => {
    const tab = fakeTab();
    const cancel = new AbortController();
    cancel.abort(new Error('the run ended'));
    await expect(openTab(settingsFixture().settings, cancel.signal, () => tab)).rejects.toThrow('the run ended');
    expect(tab.ended).toBe(1);
  });

  it('delivers nothing while muted', async () => {
    const tab = fakeTab();
    const { settings, mute } = settingsFixture();
    const source = await openTab(settings, live(), () => tab);
    const heard = vi.fn();
    source.onPcm(heard);
    mute(true);
    tab.push();
    expect(heard).not.toHaveBeenCalled();
  });

  it('ends when the tab closes', async () => {
    const tab = fakeTab();
    const source = await openTab(settingsFixture().settings, live(), () => tab);
    const ended = vi.fn();
    source.onEnded(ended);
    tab.close();
    expect(ended).toHaveBeenCalledWith(TRACK_ENDED);
  });

  it('stops once', async () => {
    const tab = fakeTab();
    const source = await openTab(settingsFixture().settings, live(), () => tab);
    await source.stop();
    await source.stop();
    expect(tab.ended).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/capture/tab.test.ts`
Expected: FAIL — `Failed to resolve import "./tab"`.

- [ ] **Step 3: Implement**

`src/lib/audio/capture/tab.ts`:

```ts
/**
 * The extension's tab as the participant source (`startTabAudioRecording`
 * today). Chrome mutes a captured tab, so `TabAudioRecorder` plays the
 * capture back on the monitor device chosen when capture begins; that stays
 * inside this source (ruling 8), and a monitor change during the run does not
 * move it, as today.
 */
import { SAMPLE_RATE } from '../../contract/adapter';
import { describeCause, reportWarning } from '../../diagnostics/report';
import { TabAudioRecorder } from '../../modern-audio/TabAudioRecorder';
import type { Source } from '../../session/source';
import { createSourceCore } from './core';

/** The settings a tab source reads when it opens (and `muted` on every chunk). */
export interface TabSettings {
  /** The meeting tab the side panel was opened for; null lets the recorder take the active tab. */
  tabId(): number | null;
  /** Where the captured tab is played back, since Chrome mutes it. */
  outputDeviceId(): string | undefined;
  muted(): boolean;
}

/** The part of `TabAudioRecorder` this source drives. */
export interface TabCapture {
  /** False when the tab cannot be captured (it logs why and cleans up after itself). */
  begin(options?: { tabId?: number; outputDeviceId?: string }): Promise<boolean>;
  record(callback: (data: { mono: Int16Array }) => void): Promise<boolean>;
  end(): Promise<void>;
  getStream(): MediaStream | null;
}

export async function openTab(
  settings: TabSettings,
  signal: AbortSignal,
  createRecorder: () => TabCapture = () => new TabAudioRecorder(SAMPLE_RATE),
): Promise<Source> {
  const recorder = createRecorder();
  let unwatch = () => {};
  let open = false;
  const core = createSourceCore({
    muted: () => settings.muted(),
    track: () => recorder.getStream()?.getAudioTracks()[0],
    release: async () => {
      unwatch();
      if (!open) return;
      open = false;
      try {
        await recorder.end();
      } catch (error) {
        reportWarning('TabCapture', `Stopping the tab capture failed: ${describeCause(error)}`, { dedupeKey: 'tab:end' });
      }
    },
  });

  const begun = await recorder.begin({ tabId: settings.tabId() ?? undefined, outputDeviceId: settings.outputDeviceId() });
  if (!begun) throw new Error('The meeting tab could not be captured. Reload the tab and try again.');
  open = true;
  unwatch = core.watch(recorder.getStream());
  try {
    await recorder.record((data) => core.deliver(data.mono));
  } catch (error) {
    await core.stop();
    throw error;
  }
  if (signal.aborted) {
    await core.stop();
    throw signal.reason ?? new Error('aborted');
  }
  return core;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio/capture`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only. `TabAudioRecorder` must satisfy `TabCapture` where the default factory returns it; if TypeScript rejects it, report the error rather than casting it away.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/capture
git commit -m "feat(audio): the extension's tab as a source — a closed tab ends it"
```

---
### Task 6: Passthrough, from the microphone's own chunks

**Files:**
- Create: `src/lib/audio/liveStream.ts`
- Modify: `src/lib/audio/graph.ts`, `src/lib/audio/playback.ts`
- Test: `src/lib/audio/liveStream.test.ts`, `src/lib/audio/graph.test.ts`, `src/lib/audio/playback.test.ts`, `src/components/dev/SessionControls.test.tsx`, `src/components/dev/SpinePreview.test.tsx`

**Interfaces:**
- Consumes: `AudioTimeline`, `LEAD_S`, `STARVED_S` (`src/lib/audio/clipQueue.ts`); `SAMPLE_RATE`.
- Produces:
  - `MAX_BUFFERED_S = 0.3`; `class LiveStream { constructor(timeline: AudioTimeline, leadS = LEAD_S); push(pcm: Int16Array): void; clear(): void }`.
  - `AudioGraph.timeline(feed: 'speaker' | 'participant' | 'replay' | 'passthrough'): AudioTimeline`; `AudioGraph.attachPassthrough` is removed.
  - `Playback.passthrough(pcm: Int16Array): void` — the microphone's chunk, played on the passthrough feed; the passthrough route and its ratio decide whether the meeting hears it; `Playback.attachPassthrough` is removed (ruling 3).

The original voice under the translation is the processed microphone — what the meeting hears today — so playback takes the source's own chunks rather than a raw stream. A `LiveStream` plays them back to back as they arrive (one lead ahead of the clock when it has run dry, as the clip queue does, `STARVED_S` included), and keeps its delay bounded: a capture clock that runs faster than the output clock would otherwise grow the delay forever, so a chunk arriving with more than `MAX_BUFFERED_S` already queued is dropped. The microphone delivers ~85 ms chunks (the recorder worklet's 4096 frames at 48 kHz, halved), so the lead absorbs the gap between them.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/liveStream.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SAMPLE_RATE } from '../contract/adapter';
import { LEAD_S, type AudioTimeline } from './clipQueue';
import { LiveStream, MAX_BUFFERED_S } from './liveStream';

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

const chunk = (ms: number) => new Int16Array((SAMPLE_RATE * ms) / 1000);

describe('LiveStream', () => {
  it('plays chunks back to back as they arrive, the first one lead ahead of the clock', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const stream = new LiveStream(timeline);
    stream.push(chunk(85));
    advance(0.06);
    stream.push(chunk(85));
    expect(plays.map((p) => p.at)).toEqual([LEAD_S, LEAD_S + 0.085]);
  });

  it('starts fresh once it has run dry', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const stream = new LiveStream(timeline);
    stream.push(chunk(85));
    advance(1);
    stream.push(chunk(85));
    expect(plays[1].at).toBeCloseTo(1 + LEAD_S, 9);
  });

  it('drops a chunk rather than let the delay grow past its bound', () => {
    const { timeline, plays } = fakeTimeline();
    const stream = new LiveStream(timeline);
    const n = Math.ceil((MAX_BUFFERED_S + LEAD_S) / 0.085) + 3;
    for (let i = 0; i < n; i++) stream.push(chunk(85));
    const last = plays[plays.length - 1];
    expect(plays.length).toBeLessThan(n);
    expect(last.at - 0).toBeLessThanOrEqual(MAX_BUFFERED_S + 0.085);
  });

  it('clear stops what plays and starts fresh', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const stream = new LiveStream(timeline);
    stream.push(chunk(85));
    stream.push(chunk(85));
    advance(0.06);
    stream.clear();
    expect(plays.every((p) => p.stopped)).toBe(true);
    stream.push(chunk(85));
    expect(plays[2].at).toBeCloseTo(0.06 + LEAD_S, 9);
  });

  it('ignores an empty chunk', () => {
    const { timeline, plays } = fakeTimeline();
    new LiveStream(timeline).push(new Int16Array(0));
    expect(plays).toHaveLength(0);
  });
});
```

`src/lib/audio/graph.test.ts`:
- Widen the `clip` helper in `setup()` to `const clip = (feed: 'speaker' | 'participant' | 'replay' | 'passthrough'): FakeBufferSource => {` (body unchanged).
- In `'applies a diff: a changed gain is updated in place, a missing edge is disconnected'`, replace its first three lines (`const { ctx, graph } = await setup();`, `graph.attachPassthrough({} as MediaStream);`, `const feed = [...ctx.streamSources[0].outputs][0];`) with:

```ts
    const { graph, clip } = await setup();
    const feed = [...clip('passthrough').outputs][0];
```

- In `'hears the translated speech whatever the routes, and not the preview or passthrough'`, replace the two lines `graph.attachPassthrough({} as MediaStream);` and `expect(reaches(ctx.streamSources[0], ttsTap)).toBe(false);` with `expect(reaches(clip('passthrough'), ttsTap)).toBe(false);`.
- Append to `describe('createAudioGraph — routes', …)`:

```ts
  it('routes the passthrough feed into the meeting at its ratio', async () => {
    const { graph, virtualSink, destinationOf, clip } = await setup();
    graph.route([{ from: 'passthrough', to: 'virtual', gain: 0.3 }]);
    expect(reaches(clip('passthrough'), destinationOf(virtualSink))).toBe(true);
  });
```

`src/lib/audio/playback.test.ts`:
- In `fakeGraph()`, delete the line `attachPassthrough: () => () => {},`.
- Append:

```ts
describe('createPlayback — passthrough', () => {
  it("plays the microphone's chunks back to back on the passthrough feed", () => {
    const { graph, plays } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.passthrough(pcm(85));
    playback.passthrough(pcm(85));
    expect(plays.map((p) => p.feed)).toEqual(['passthrough', 'passthrough']);
    expect(plays[1].at).toBeCloseTo(plays[0].at + 0.085, 9);
  });

  it('resumes the graph before it plays (autoplay)', () => {
    const { graph, resumed } = fakeGraph();
    const playback = createPlayback(graph, routing().source);
    playback.passthrough(pcm(85));
    expect(resumed()).toBeGreaterThan(0);
  });
});
```

`src/components/dev/SessionControls.test.tsx` — in `fakeAudio()`, replace `attachPassthrough: vi.fn(() => () => {}),` with `passthrough: vi.fn(),`. `src/components/dev/SpinePreview.test.tsx` — in the `getAppAudio` mock, replace `attachPassthrough: () => () => {},` with `passthrough: () => {},`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio`
Expected: FAIL — `Failed to resolve import "./liveStream"`; `playback.passthrough is not a function`. (The new graph test passes already at run time — the passthrough feed exists; only its type is widened here — so it is a pin.)

- [ ] **Step 3: Implement**

`src/lib/audio/liveStream.ts`:

```ts
/**
 * A continuous stream played as it arrives — the microphone under the
 * translation (passthrough): chunks back to back, one lead ahead of the clock
 * once it has run dry, as the clip queue schedules. A capture clock that runs
 * faster than the output clock would grow the delay forever, so a chunk that
 * arrives with more than `MAX_BUFFERED_S` already queued is dropped.
 */
import { SAMPLE_RATE } from '../contract/adapter';
import { LEAD_S, STARVED_S, type AudioTimeline } from './clipQueue';

export const MAX_BUFFERED_S = 0.3;

export class LiveStream {
  /** When the last scheduled chunk ends. */
  private tail = 0;
  private readonly playing = new Set<{ stop: () => void }>();

  constructor(private readonly timeline: AudioTimeline, private readonly leadS = LEAD_S) {}

  push(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const now = this.timeline.now();
    if (this.tail - now > MAX_BUFFERED_S) return;
    const at = this.tail > now + STARVED_S ? this.tail : now + this.leadS;
    let ended = false;
    const entry = { stop: () => {} };
    entry.stop = this.timeline.play(pcm, at, () => {
      ended = true;
      this.playing.delete(entry);
    });
    if (!ended) this.playing.add(entry);
    this.tail = at + pcm.length / SAMPLE_RATE;
  }

  /** Stops what plays and drops what is queued. */
  clear(): void {
    const playing = [...this.playing];
    this.playing.clear();
    this.tail = 0;
    for (const entry of playing) entry.stop();
  }
}
```

`src/lib/audio/graph.ts`:
- `AudioGraph.timeline`'s parameter becomes `feed: 'speaker' | 'participant' | 'replay' | 'passthrough'`, and its doc comment: `/** A timeline playing into a feed: the clip queues' and the passthrough stream's. */`.
- Delete `attachPassthrough` from the `AudioGraph` interface (with its doc comment) and from the returned object.

`src/lib/audio/playback.ts`:
- Import `LiveStream` from `./liveStream`.
- In `Playback`, replace `attachPassthrough(stream: MediaStream): () => void;` and its doc comment with:

```ts
  /** The microphone's chunk, processed: the original voice under the translation. The passthrough route and its ratio decide whether the meeting hears it. */
  passthrough(pcm: Int16Array): void;
```

- In `createPlayback`, after `const replayQueue = …`, add `const passthroughStream = new LiveStream(graph.timeline('passthrough'));`; replace the `attachPassthrough: …` member with:

```ts
    passthrough(pcm) {
      void graph.resume();
      passthroughStream.push(pcm);
    },
```

- In `dispose()`, add `passthroughStream.clear();` beside the queues' `clear()` calls.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio src/components/dev`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only (`grep -rn attachPassthrough src` must find nothing).

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio src/components/dev
git commit -m "feat(audio): passthrough from the microphone's own chunks, back to back, the delay bounded"
```

---

### Task 7: The echo watch

**Files:**
- Create: `src/lib/audio/capture/echoWatch.ts`
- Test: `src/lib/audio/capture/echoWatch.test.ts`

**Interfaces:**
- Consumes: `EchoMonitor`, `EchoMonitorHooks`, `EchoNoticeState` (`src/lib/modern-audio/EchoMonitor.ts`: `new EchoMonitor(hooks)`, `pushMic(pcm)`, `pushParticipant(pcm)`, `start()`, `stop()`, `running`; hooks `readPlayedTts(): Float32Array`, `onChange(state | null)`, `onDiagnostic?(line)`); `PcmTap` (`src/lib/audio/pcmTap.ts`); `Source`; `LegName`.
- Produces: `interface EchoMonitorLike { pushMic(pcm: Int16Array): void; pushParticipant(pcm: Int16Array): void; start(): void; stop(): void; readonly running: boolean }`; `interface EchoWatch { attach(leg: LegName, source: Source): () => void; onNotice(listener: ((state: EchoNoticeState | null) => void) | null): void; setDiagnostics(enabled: boolean): void }`; `createEchoWatch(ttsTap: PcmTap, createMonitor?: (hooks: EchoMonitorHooks) => EchoMonitorLike): EchoWatch`.

Today's `EchoMonitor` and its three detectors, unchanged, fed from the new capture: the speaker's source is the microphone probe, the participant's is the participant probe, and the playback's tts tap is the reference (spec: "The echo monitor keeps its three probes"). It runs while any source is attached; when it starts it drains the tap first, so speech played while nothing listened is never correlated (the roadmap's 1c-3 item; today a fresh tap is created per capture lifecycle), and it is the tap's only reader. `onNotice` keeps `useEchoNotice`'s contract — one listener, the latest; `null` removes it — so plan 1d can hand it the watch. The diagnostics line is `console.info`, printed only while diagnostics are on, as today.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/capture/echoWatch.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { EchoMonitorHooks } from '../../modern-audio/EchoMonitor';
import { createVirtualClock } from '../../contract/clock';
import { createFakeSource } from '../../../providers/fake/source';
import { createEchoWatch, type EchoMonitorLike } from './echoWatch';

function fakeMonitor() {
  const log: string[] = [];
  let hooks!: EchoMonitorHooks;
  let running = false;
  const monitor: EchoMonitorLike = {
    pushMic: () => { log.push('mic'); },
    pushParticipant: () => { log.push('participant'); },
    start: () => { log.push('start'); running = true; },
    stop: () => { log.push('stop'); running = false; },
    get running() { return running; },
  };
  return { monitor, log, hooks: () => hooks, create: (h: EchoMonitorHooks) => { hooks = h; return monitor; } };
}

function tap() {
  const reads: string[] = [];
  return { reads, read: vi.fn(() => { reads.push('read'); return Float32Array.of(0.5); }) };
}

describe('createEchoWatch', () => {
  it("feeds the speaker's capture to the microphone probe and the participant's to the participant probe", () => {
    const fake = fakeMonitor();
    const watch = createEchoWatch(tap(), fake.create);
    const clock = createVirtualClock(0);
    const speaker = createFakeSource(clock, { voiced: true });
    const participant = createFakeSource(clock, { voiced: true });
    watch.attach('speaker', speaker);
    watch.attach('participant', participant);
    clock.advance(100);
    expect(fake.log.filter((e) => e !== 'start')).toEqual(['mic', 'participant']);
  });

  it('starts with the first source, draining the tap first, and stops after the last', () => {
    const fake = fakeMonitor();
    const t = tap();
    const watch = createEchoWatch(t, fake.create);
    const clock = createVirtualClock(0);
    const detachA = watch.attach('speaker', createFakeSource(clock));
    const detachB = watch.attach('participant', createFakeSource(clock));
    expect(t.read).toHaveBeenCalledTimes(1);
    expect(fake.log).toEqual(['start']);
    detachA();
    detachA();
    expect(fake.log).toEqual(['start']);
    detachB();
    expect(fake.log).toEqual(['start', 'stop']);
  });

  it('stops feeding a detached source', () => {
    const fake = fakeMonitor();
    const watch = createEchoWatch(tap(), fake.create);
    const clock = createVirtualClock(0);
    const source = createFakeSource(clock);
    const detach = watch.attach('speaker', source);
    detach();
    clock.advance(300);
    expect(fake.log).not.toContain('mic');
  });

  it('reads the reference from the tts tap', () => {
    const fake = fakeMonitor();
    const t = tap();
    createEchoWatch(t, fake.create);
    expect([...fake.hooks().readPlayedTts()]).toEqual([0.5]);
  });

  it('hands a notice to the one listener, the latest, until it is removed', () => {
    const fake = fakeMonitor();
    const watch = createEchoWatch(tap(), fake.create);
    const first = vi.fn();
    const second = vi.fn();
    watch.onNotice(first);
    watch.onNotice(second);
    const state = { cause: 'tts-echo' as const, lagMs: 120, rho: 0.7 };
    fake.hooks().onChange(state);
    watch.onNotice(null);
    fake.hooks().onChange(null);
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[state]]);
  });

  it('prints the diagnostics line only while diagnostics are on', () => {
    const fake = fakeMonitor();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const watch = createEchoWatch(tap(), fake.create);
    fake.hooks().onDiagnostic?.('rho=0.1');
    watch.setDiagnostics(true);
    fake.hooks().onDiagnostic?.('rho=0.2');
    expect(info.mock.calls.map(([line]) => line)).toEqual(['[Sokuji] [EchoMonitor] rho=0.2']);
    info.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/capture/echoWatch.test.ts`
Expected: FAIL — `Failed to resolve import "./echoWatch"`.

- [ ] **Step 3: Implement**

`src/lib/audio/capture/echoWatch.ts`:

```ts
/**
 * The echo monitor on the new capture (spec: "The echo monitor keeps its
 * three probes"): today's `EchoMonitor`, unchanged, fed from the sources'
 * pcm and the playback's tts tap instead of the recorder callbacks and the
 * player's ring. It runs while any source is attached; starting, it drains
 * the tap, so speech played while nothing listened is never correlated. It is
 * the tap's only reader.
 */
import type { LegName } from '../../conversation/types';
import { EchoMonitor, type EchoMonitorHooks, type EchoNoticeState } from '../../modern-audio/EchoMonitor';
import type { Source } from '../../session/source';
import type { PcmTap } from '../pcmTap';

/** The part of `EchoMonitor` the watch drives. */
export interface EchoMonitorLike {
  pushMic(pcm: Int16Array): void;
  pushParticipant(pcm: Int16Array): void;
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export interface EchoWatch {
  /** Feeds a leg's capture to its probe while attached; returns the detach. */
  attach(leg: LegName, source: Source): () => void;
  /** One listener, the latest (`useEchoNotice`'s contract); null removes it. */
  onNotice(listener: ((state: EchoNoticeState | null) => void) | null): void;
  setDiagnostics(enabled: boolean): void;
}

export function createEchoWatch(
  ttsTap: PcmTap,
  createMonitor: (hooks: EchoMonitorHooks) => EchoMonitorLike = (hooks) => new EchoMonitor(hooks),
): EchoWatch {
  let listener: ((state: EchoNoticeState | null) => void) | null = null;
  let diagnostics = false;
  let attached = 0;
  const monitor = createMonitor({
    readPlayedTts: () => ttsTap.read(),
    onChange: (state) => listener?.(state),
    // Opt-in (the `sokuji.echoDiagnostics` flag), once a second: information, not a failure.
    onDiagnostic: (line) => {
      if (diagnostics) console.info(`[Sokuji] [EchoMonitor] ${line}`);
    },
  });

  return {
    attach(leg, source) {
      const off = source.onPcm(leg === 'speaker' ? (pcm) => monitor.pushMic(pcm) : (pcm) => monitor.pushParticipant(pcm));
      attached += 1;
      if (!monitor.running) {
        ttsTap.read();
        monitor.start();
      }
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        off();
        attached -= 1;
        if (attached === 0) monitor.stop();
      };
    },
    onNotice(next) {
      listener = next;
    },
    setDiagnostics(enabled) {
      diagnostics = enabled;
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio/capture`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only. `EchoMonitor` must satisfy `EchoMonitorLike` where the default factory returns it; if TypeScript rejects it, report the error rather than casting it away.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/capture
git commit -m "feat(audio): the echo watch — today's monitor on the sources and the tts tap"
```

---

### Task 8: The page's capture

**Files:**
- Create: `src/lib/audio/appCapture.ts`
- Test: `src/lib/audio/appCapture.test.ts`

**Interfaces:**
- Consumes: `openMic` + `MicSettings` (Task 3), `openSystemAudio` + `SystemAudioSettings` (Task 4), `openTab` + `TabSettings` (Task 5), `createEchoWatch` + `EchoWatch` (Task 7), `Playback` (`passthrough`, `ttsTap` — Task 6 and plan 1c-2), `targetTabIdFromSearch` (`src/lib/audio/tabMicrophone.ts`), `OpenSource`, `Source`, `LegName`, `Platform`; `useAudioStore` (default export of `src/stores/audioStore.ts`: `selectedInputDevice`, `noiseSuppressionMode`, `isMicMuted`, `selectedParticipantSource`, `isParticipantMuted`, `selectedMonitorDevice`, `markParticipantTapAudioSeen`); `getEnvironment`.
- Produces: `interface AppCapture { openSource: OpenSource; echo: EchoWatch }`; `createAppCapture(playback: Playback, platform?: Platform): AppCapture`; `micSettings(): MicSettings`, `systemAudioSettings(): SystemAudioSettings`, `tabSettings(): TabSettings`.

The one other module in `src/lib/audio` that reads the stores (with `appAudio.ts`). `openSource` opens the speaker's microphone, or the participant's system audio (Electron) or tab (extension) — the web build has none, and the start gate already refuses a participant leg there. The speaker's chunks go to `playback.passthrough` (they are the original voice; the route decides whether the meeting hears it). Both legs attach to the echo watch. The returned source's `stop()` detaches both before stopping the capture. The settings the sources follow are read live from `audioStore`.

- [ ] **Step 1: Write the failing tests**

`src/lib/audio/appCapture.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { createFakeSource, type FakeSource } from '../../providers/fake/source';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

const opened = vi.hoisted(() => ({ calls: [] as string[], sources: [] as FakeSource[] }));
vi.mock('./capture/mic', () => ({ openMic: vi.fn(async () => { opened.calls.push('mic'); return opened.sources[opened.sources.length - 1]; }) }));
vi.mock('./capture/systemAudio', () => ({ openSystemAudio: vi.fn(async () => { opened.calls.push('system'); return opened.sources[opened.sources.length - 1]; }) }));
vi.mock('./capture/tab', () => ({ openTab: vi.fn(async () => { opened.calls.push('tab'); return opened.sources[opened.sources.length - 1]; }) }));

const watch = vi.hoisted(() => ({ attached: [] as string[], detached: [] as string[] }));
vi.mock('./capture/echoWatch', () => ({
  createEchoWatch: () => ({
    attach: (leg: string) => { watch.attached.push(leg); return () => { watch.detached.push(leg); }; },
    onNotice: () => {},
    setDiagnostics: () => {},
  }),
}));

import useAudioStore from '../../stores/audioStore';
import { createAppCapture, micSettings, systemAudioSettings } from './appCapture';
import type { Playback } from './playback';

function fakePlayback() {
  return { passthrough: vi.fn(), ttsTap: { read: () => new Float32Array(0) } } as unknown as Playback & { passthrough: ReturnType<typeof vi.fn> };
}

const clock = createVirtualClock(0);
const live = () => new AbortController().signal;

beforeEach(() => {
  opened.calls = [];
  opened.sources = [createFakeSource(clock, { voiced: true })];
  watch.attached = [];
  watch.detached = [];
});

describe('createAppCapture', () => {
  it('opens the microphone for the speaker and feeds its chunks to passthrough', async () => {
    const playback = fakePlayback();
    const capture = createAppCapture(playback, 'electron');
    await capture.openSource('speaker', live());
    clock.advance(100);
    expect(opened.calls).toEqual(['mic']);
    expect(playback.passthrough).toHaveBeenCalledTimes(1);
    expect(watch.attached).toEqual(['speaker']);
  });

  it("opens the system audio for the participant in Electron and the tab in the extension, and never passes it through", async () => {
    const playback = fakePlayback();
    await createAppCapture(playback, 'electron').openSource('participant', live());
    await createAppCapture(playback, 'extension').openSource('participant', live());
    clock.advance(100);
    expect(opened.calls).toEqual(['system', 'tab']);
    expect(playback.passthrough).not.toHaveBeenCalled();
    expect(watch.attached).toEqual(['participant', 'participant']);
  });

  it('refuses a participant source in the web build', async () => {
    await expect(createAppCapture(fakePlayback(), 'web').openSource('participant', live())).rejects.toThrow('no participant source');
  });

  it('detaches passthrough and the echo watch before it stops the capture', async () => {
    const playback = fakePlayback();
    const source = await createAppCapture(playback, 'electron').openSource('speaker', live());
    await source.stop();
    await source.stop();
    clock.advance(300);
    expect(watch.detached).toEqual(['speaker']);
    expect(opened.sources[0].stopped).toBe(true);
    expect(playback.passthrough).not.toHaveBeenCalled();
  });
});

describe('the settings the sources follow', () => {
  it("reads the microphone's device, noise suppression and mute from the audio store, live", () => {
    const settings = micSettings();
    useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' }, noiseSuppressionMode: 'standard', isMicMuted: false });
    expect([settings.deviceId(), settings.noiseSuppression(), settings.muted()]).toEqual(['mic-1', 'standard', false]);
    useAudioStore.setState({ isMicMuted: true });
    expect(settings.muted()).toBe(true);
  });

  it('reads the participant source, whole-system when none is chosen, and remembers audible audio', () => {
    const settings = systemAudioSettings();
    useAudioStore.setState({ selectedParticipantSource: null, participantTapAudioSeen: false });
    expect(settings.sourceId()).toBe('desktop-audio-loopback');
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'app:42', label: 'Zoom' } });
    expect(settings.sourceId()).toBe('app:42');
    settings.audioSeen();
    expect(useAudioStore.getState().participantTapAudioSeen).toBe(true);
  });

  it('tells the sources when the audio store changes', () => {
    const listener = vi.fn();
    const off = micSettings().subscribe(listener);
    useAudioStore.setState({ isMicMuted: false });
    off();
    useAudioStore.setState({ isMicMuted: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/audio/appCapture.test.ts`
Expected: FAIL — `Failed to resolve import "./appCapture"`.

- [ ] **Step 3: Implement**

`src/lib/audio/appCapture.ts`:

```ts
/**
 * The page's capture — with `appAudio.ts`, the only modules in `src/lib/audio`
 * that read the stores. Opens each leg's source for the platform, feeds the
 * microphone into playback's passthrough route and both legs into the echo
 * watch, and reads the settings the sources follow, live, from `audioStore`.
 */
import type { LegName } from '../conversation/types';
import type { Platform } from '../provider/types';
import type { OpenSource, Source } from '../session/source';
import useAudioStore from '../../stores/audioStore';
import { getEnvironment } from '../../utils/environment';
import { createEchoWatch, type EchoWatch } from './capture/echoWatch';
import { openMic, type MicSettings } from './capture/mic';
import { openSystemAudio, type SystemAudioSettings } from './capture/systemAudio';
import { openTab, type TabSettings } from './capture/tab';
import type { Playback } from './playback';
import { targetTabIdFromSearch } from './tabMicrophone';

export interface AppCapture {
  openSource: OpenSource;
  /** For the echo notice (plan 1d): `useEchoNotice`'s one-listener contract. */
  echo: EchoWatch;
}

const audio = () => useAudioStore.getState();
const onAudioChange = (listener: () => void) => useAudioStore.subscribe(() => listener());

export function micSettings(): MicSettings {
  return {
    deviceId: () => audio().selectedInputDevice?.deviceId,
    noiseSuppression: () => audio().noiseSuppressionMode,
    muted: () => audio().isMicMuted,
    subscribe: onAudioChange,
  };
}

export function systemAudioSettings(): SystemAudioSettings {
  return {
    sourceId: () => audio().selectedParticipantSource?.deviceId ?? 'desktop-audio-loopback',
    muted: () => audio().isParticipantMuted,
    subscribe: onAudioChange,
    audioSeen: () => audio().markParticipantTapAudioSeen(),
  };
}

export function tabSettings(): TabSettings {
  return {
    tabId: () => targetTabIdFromSearch(window.location.search),
    outputDeviceId: () => audio().selectedMonitorDevice?.deviceId,
    muted: () => audio().isParticipantMuted,
  };
}

/** The source, with `cleanup` run once before it stops. */
function withCleanup(source: Source, cleanup: () => void): Source {
  let cleaned = false;
  return {
    onPcm: (listener) => source.onPcm(listener),
    onEnded: (listener) => source.onEnded(listener),
    onDegraded: (listener) => source.onDegraded(listener),
    get track() {
      return source.track;
    },
    async stop() {
      if (!cleaned) {
        cleaned = true;
        cleanup();
      }
      await source.stop();
    },
  };
}

export function createAppCapture(playback: Playback, platform: Platform = getEnvironment()): AppCapture {
  const echo = createEchoWatch(playback.ttsTap);

  const open = (leg: LegName, signal: AbortSignal): Promise<Source> => {
    if (leg === 'speaker') return openMic(micSettings(), signal);
    if (platform === 'electron') return openSystemAudio(systemAudioSettings(), signal);
    if (platform === 'extension') return openTab(tabSettings(), signal);
    return Promise.reject(new Error('This build has no participant source.'));
  };

  return {
    echo,
    async openSource(leg, signal) {
      const source = await open(leg, signal);
      // The processed microphone is the original voice under the translation.
      const offPassthrough = leg === 'speaker' ? source.onPcm((pcm) => playback.passthrough(pcm)) : () => {};
      const detach = echo.attach(leg, source);
      return withCleanup(source, () => {
        offPassthrough();
        detach();
      });
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/audio`
Expected: PASS.

- [ ] **Step 5: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio/appCapture.ts src/lib/audio/appCapture.test.ts
git commit -m "feat(audio): the page's capture — a source per leg and platform, passthrough and the echo watch wired"
```

---

### Task 9: The preview on a microphone

**Files:**
- Modify: `src/components/dev/SpinePreview.tsx`, `src/components/dev/SessionControls.tsx`, `scripts/dev/spine-audio-probe.mjs`
- Test: `src/components/dev/SpinePreview.test.tsx`, `src/components/dev/SessionControls.test.tsx`

**Interfaces:**
- Consumes: `createAppCapture` (Task 8); `OpenSource` (`src/lib/session/source.ts`); the preview's bridge and `usePlaybackProbe` (plan 1c-2).
- Produces: `/?preview=spine&capture=device` runs the fake session on the page's real capture (the microphone for the speaker leg) instead of the fake source; `SessionControls` gains an optional prop `capture?: () => { chunks: number; peak: number }`, and when it is given, its probe line reads `heard: <keys|-> · tap peak: <n> · captured: <chunks> · mic peak: <n>`. `scripts/dev/spine-audio-probe.mjs` launches Chromium with a fake microphone and, for a `capture=device` URL, also requires `captured > 0` and `mic peak > 0`.

The fake provider ignores what it is sent, so a real microphone changes nothing it says; what this proves is that the capture opens, delivers 24 kHz chunks through the runner and passthrough, and stops. Headless Chromium supplies a fake microphone with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (a beep once a second). The default (`capture` absent) stays the fake source, so the existing probe run is unchanged.

- [ ] **Step 1: Write the failing tests**

`src/components/dev/SessionControls.test.tsx` — append to `describe('SessionControls — playback', …)`:

```ts
  it('shows what the capture delivered, when it is watched', () => {
    vi.useFakeTimers();
    try {
      const { runner } = fakeRunner();
      render(<SessionControls runner={runner} turnMode="auto" audio={fakeAudio()} capture={() => ({ chunks: 3, peak: 0.25 })} />);
      act(() => { vi.advanceTimersByTime(100); });
      expect(document.querySelector('[data-probe="playback"]')?.textContent).toBe('heard: - · tap peak: 0.000 · captured: 3 · mic peak: 0.250');
    } finally {
      vi.useRealTimers();
    }
  });
```

`src/components/dev/SpinePreview.test.tsx` — add a mock beside the others (the preview imports the page's capture; jsdom has no media devices):

```ts
vi.mock('../../lib/audio/appCapture', () => ({
  createAppCapture: () => ({
    openSource: async () => { throw new Error('no capture in tests'); },
    echo: { attach: () => () => {}, onNotice: () => {}, setDiagnostics: () => {} },
  }),
}));
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/components/dev`
Expected: FAIL — the probe line has no `captured` part.

- [ ] **Step 3: Implement**

`src/components/dev/SessionControls.tsx`:
- Add `capture?: () => { chunks: number; peak: number };` to `SessionControlsProps`, with the doc comment `/** What the page's capture delivered (the preview's `&capture=device`), for the probe line. */`.
- `usePlaybackProbe` takes the capture reader too and reports it: its signature becomes `usePlaybackProbe(playback: Playback | undefined, capture?: () => { chunks: number; peak: number })`, its state gains `captured: { chunks: number; peak: number } | null` (initially `capture ? { chunks: 0, peak: 0 } : null`), and each tick reads `const seen = capture?.();` and includes it in the change check (`seen && (seen.chunks !== last.chunks || seen.peak !== last.peak)`), setting `captured: seen ?? null` with the rest. Add `capture` to the effect's dependency list.
- The component passes it (`usePlaybackProbe(audio?.playback, capture)`) and the probe line becomes:

```tsx
          <p data-probe="playback">
            {`heard: ${probe.heard.join(',') || '-'} · tap peak: ${probe.peak.toFixed(3)}`
              + (probe.captured ? ` · captured: ${probe.captured.chunks} · mic peak: ${probe.captured.peak.toFixed(3)}` : '')}
          </p>
```

`src/components/dev/SpinePreview.tsx`:
- Import `createAppCapture` from `../../lib/audio/appCapture` and `type OpenSource` from `../../lib/session/source`.
- Add to the module-level `bridge` a member `openSource: OpenSource`, initially `async () => createFakeSource(realClock)`, and a module-level counter:

```ts
/** What the page's capture delivered, for the probe (`&capture=device`). */
const captured = { chunks: 0, peak: 0 };

/** Counts every chunk a source delivers, and the loudest sample. */
function counting(open: OpenSource): OpenSource {
  return async (leg, signal) => {
    const source = await open(leg, signal);
    source.onPcm((pcm) => {
      captured.chunks += 1;
      for (let i = 0; i < pcm.length; i++) captured.peak = Math.max(captured.peak, Math.abs(pcm[i]) / 32768);
    });
    return source;
  };
}
```

- In `getPreviewRunner`, replace `openSource: async () => createFakeSource(realClock),` with `openSource: (leg, signal) => bridge.openSource(leg, signal),`.
- In the component, read the mode once: `const deviceCapture = useMemo(() => new URLSearchParams(window.location.search).get('capture') === 'device', []);`. In the `getAppAudio().then(…)` success branch, after `bridge.playback = loaded.playback;`, add `if (deviceCapture) bridge.openSource = counting(createAppCapture(loaded.playback).openSource);` (add `deviceCapture` to that effect's dependency list, or read it inside the effect — it never changes).
- Pass `capture={deviceCapture ? () => ({ ...captured }) : undefined}` to `SessionControls`.
- Update the component's doc comment to mention `&capture=device`.

`scripts/dev/spine-audio-probe.mjs`:
- Add `'--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',` to Chromium's arguments.
- Update the usage comment: `node scripts/dev/spine-audio-probe.mjs ['http://localhost:5199/?preview=spine&autostart=1&capture=device'] [seconds]` — "with `capture=device`, the fake microphone is captured too, and it must deliver".
- After computing `heard` and `peak`, add:

```js
  const deviceCapture = url.includes('capture=device');
  const chunks = Number(/captured: (\d+)/.exec(text)?.[1] ?? 0);
  const micPeak = Number(/mic peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const captureOk = !deviceCapture || (chunks > 0 && micPeak > 0);
```

and make the exit code `process.exitCode = heard !== '-' && peak > 0 && captureOk ? 0 : 1;`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/components/dev`
Expected: PASS.

- [ ] **Step 5: Run it — the fake microphone through the whole path**

Start the renderer only: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort` (in the background; wait until `curl -s -o /dev/null -w '%{http_code}' 'http://localhost:5199/?preview=spine'` answers 200). Then run both:

```bash
node scripts/dev/spine-audio-probe.mjs
node scripts/dev/spine-audio-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&capture=device'
```

Expected: both exit 0; the first prints the same line as plan 1c-2 (`heard: speaker:2:0,…,speaker:4:1 · tap peak: 0.244`), the second the same `heard` keys and a `captured: <n> · mic peak: <x>` part with `n` in the dozens (the microphone's ~85 ms chunks over the run) and `x > 0` (the fake device's beep, after the default noise suppression — GTCRN falls back to RNNoise under `vite dev`). Record both lines and exit codes in your report. If the second exits 1, the report says so with the line, and what the page showed (the preview's error line, which carries the run's `lastEnd` — e.g. a `start-failed` naming the speaker leg and the microphone's message); do not paper over it. Stop the dev server afterwards and check nothing still listens on 5199 or 9333.

- [ ] **Step 6: The whole suite and the gate**

Run: `npx vitest run src` — 0 failed. The typecheck gate — the four baseline lines only.

- [ ] **Step 7: Commit**

```bash
git add src/components/dev scripts/dev/spine-audio-probe.mjs
git commit -m "feat(dev): the preview on a microphone — &capture=device, a capture probe, a fake device in the headless check"
```
