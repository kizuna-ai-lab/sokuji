# Soniox Speaker-Diarization Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Both-shared-session side attribution robust when both sides speak the same language, using Soniox speaker diarization bootstrapped by mixer-channel energy with the existing language method as fallback.

**Architecture:** A new pure class `SonioxSideTracker` owns the energy ring buffer, the speaker-label vote map, and the three-tier side inference. `PcmMixer` reports per-channel energy on each frame; `SonioxClient` records frames at the send site, enables `enable_speaker_diarization` on the shared session's wire, consults the tracker where `utteranceSide` is decided today, and switches the TTS direction gate to the resolved side. Spec: `docs/superpowers/specs/2026-07-30-soniox-diarization-attribution-design.md`.

**Tech Stack:** TypeScript, Vitest (fake timers for mixer-driven tests; existing MockStt/MockTts harness in `SonioxClient.test.ts`).

## Global Constraints

- **Branch/worktree:** work on `feat/soniox-diarization` in `.claude/worktrees/soniox-diarization` (stacked on `feat/soniox-advanced-settings`, PR #368). Never push, never open a PR. Do not use bare `git stash`.
- **Default-neutral wire:** `enable_speaker_diarization` appears in the STT first frame ONLY when configured; non-bidirectional sessions' wire stays byte-identical (the #368 convention — falsy check, presence/omission tests).
- **Tier order is fixed:** (1) established label map, (2) energy verdict, (3) legacy language comparison. Energy verdicts vote into the label map; language-derived sides NEVER vote.
- **Constants (centralized in `SonioxSideTracker`):** frame = 100 ms; ring capacity = 600 frames (60 s); energy dominance ratio = 2; label established at net vote magnitude ≥ 2.
- **Worst-case behavior = today:** with `speaker` fields absent and no usable energy timeline, attribution must be byte-for-byte the current language logic.
- **Vitest is the gate:** `npx vitest run <path>`; do NOT gate on tsc (~113 pre-existing errors). This worktree has 11 pre-existing environmental "Denied ID …?url" vitest failures (no own node_modules); they are byte-identical at the branch base — not regressions.
- **All comments/code in English.** Conventional commits, one per task, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `SonioxSideTracker` — energy ring, vote map, three-tier inference

**Files:**
- Create: `src/services/clients/SonioxSideTracker.ts`
- Test: `src/services/clients/SonioxSideTracker.test.ts`

**Interfaces:**
- Consumes: nothing (pure class, no timers, no I/O).
- Produces (Task 4 relies on these exact names):
  - `export type UtteranceSide = 'speaker' | 'participant'`
  - `export interface SideEvidence { side: UtteranceSide; tier: 'label' | 'energy' }`
  - `export class SonioxSideTracker { recordFrame(energyA: number, energyB: number): void; inferSide(speaker: string | undefined, startMs: number | undefined, endMs: number | undefined): SideEvidence | null; reset(): void; }`
  - Constructor takes optional `{ frameMs?, capacity?, energyRatio?, establishNet? }` (defaults 100 / 600 / 2 / 2) so tests can use small numbers.

- [ ] **Step 1: Write the failing test**

Create `src/services/clients/SonioxSideTracker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SonioxSideTracker } from './SonioxSideTracker';

// Channel A = mic = 'speaker' side; channel B = far end = 'participant'.
describe('SonioxSideTracker', () => {
  it('returns an energy verdict for a window where one channel dominates', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(500, 0);   // frame 0: 0-100 ms, A hot
    t.recordFrame(0, 500);   // frame 1: 100-200 ms, B hot
    expect(t.inferSide(undefined, 0, 100)).toEqual({ side: 'speaker', tier: 'energy' });
    expect(t.inferSide(undefined, 100, 200)).toEqual({ side: 'participant', tier: 'energy' });
  });

  it('spans multi-frame windows and uses summed energy', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(100, 0);
    t.recordFrame(400, 30);
    expect(t.inferSide(undefined, 0, 200)).toEqual({ side: 'speaker', tier: 'energy' }); // 500 vs 30
  });

  it('returns null on ambiguous energy (ratio < 2x), silence, or missing timing', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(100, 60);  // 100 < 2*60 → ambiguous
    t.recordFrame(0, 0);     // silence
    expect(t.inferSide(undefined, 0, 100)).toBeNull();
    expect(t.inferSide(undefined, 100, 200)).toBeNull();
    expect(t.inferSide(undefined, undefined, undefined)).toBeNull();
  });

  it('treats a window entirely outside the retained ring as a miss', () => {
    const t = new SonioxSideTracker({ capacity: 2 });
    t.recordFrame(500, 0);   // frame 0 — will be evicted
    t.recordFrame(500, 0);   // frame 1
    t.recordFrame(500, 0);   // frame 2 → ring keeps frames 1-2
    expect(t.inferSide(undefined, 0, 100)).toBeNull();               // frame 0 evicted
    expect(t.inferSide(undefined, 200, 300)).not.toBeNull();         // frame 2 retained
  });

  it('defaults a missing endMs to one frame from startMs', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(500, 0);
    expect(t.inferSide(undefined, 20, undefined)).toEqual({ side: 'speaker', tier: 'energy' });
  });

  it('establishes a label after net >= 2 energy-backed votes, then answers by label on ambiguous energy', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(0, 500);   // frame 0: B hot
    t.recordFrame(0, 500);   // frame 1: B hot
    t.recordFrame(300, 300); // frame 2: ambiguous
    expect(t.inferSide('2', 0, 100)).toEqual({ side: 'participant', tier: 'energy' });   // vote → net -1
    expect(t.inferSide('2', 100, 200)).toEqual({ side: 'participant', tier: 'label' });  // vote → net -2, established in the same call
    expect(t.inferSide('2', 200, 300)).toEqual({ side: 'participant', tier: 'label' });  // ambiguous energy → label memory
  });

  it('does not answer by label before establishment; energy governs and can erode a wrong early vote', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(0, 500);   // frame 0: B hot — spurious vote for label '1'
    t.recordFrame(500, 0);   // frame 1: A hot
    t.recordFrame(500, 0);   // frame 2: A hot
    t.recordFrame(500, 0);   // frame 3: A hot
    expect(t.inferSide('1', 0, 100)).toEqual({ side: 'participant', tier: 'energy' }); // net -1
    expect(t.inferSide('1', 100, 200)).toEqual({ side: 'speaker', tier: 'energy' });   // net 0
    expect(t.inferSide('1', 200, 300)).toEqual({ side: 'speaker', tier: 'energy' });   // net +1
    expect(t.inferSide('1', 300, 400)).toEqual({ side: 'speaker', tier: 'label' });    // net +2 — established
  });

  it('thin label memory yields to strong contrary energy; deep memory absorbs a single glitch', () => {
    const t = new SonioxSideTracker();
    // Barely established (net +2): one strong contrary verdict erodes it
    // below the threshold, so fresh energy governs the display (no lock-in).
    t.recordFrame(500, 0);   // frame 0: A hot
    t.recordFrame(500, 0);   // frame 1: A hot
    t.recordFrame(0, 500);   // frame 2: contrary energy
    t.inferSide('1', 0, 100);                                  // net +1
    t.inferSide('1', 100, 200);                                // net +2 — established
    expect(t.inferSide('1', 200, 300)).toEqual({ side: 'participant', tier: 'energy' }); // net erodes to +1
    // Deep history: net climbs back above the threshold with margin, so the
    // next single glitch (e.g. echo leakage) no longer flips the answer.
    t.recordFrame(500, 0);   // frame 3: A hot
    t.recordFrame(500, 0);   // frame 4: A hot
    t.recordFrame(0, 500);   // frame 5: glitch
    t.inferSide('1', 300, 400);                                // net +2
    t.inferSide('1', 400, 500);                                // net +3
    expect(t.inferSide('1', 500, 600)).toEqual({ side: 'speaker', tier: 'label' });      // net +2 — still established
  });

  it('a token with a speaker but no usable energy neither votes nor answers before establishment', () => {
    const t = new SonioxSideTracker();
    expect(t.inferSide('3', undefined, undefined)).toBeNull();
    expect(t.inferSide('3', 5000, 5100)).toBeNull(); // nothing recorded there
  });

  it('reset clears both the ring and the vote map', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(0, 500);
    t.recordFrame(0, 500);
    t.inferSide('2', 0, 100);
    t.inferSide('2', 100, 200); // established
    t.reset();
    t.recordFrame(300, 300);
    expect(t.inferSide('2', 0, 100)).toBeNull(); // no label memory, ambiguous energy
  });
});
```

Semantics pinned by these tests: within one `inferSide` call the energy vote is cast BEFORE the label lookup, so the very evidence arriving in a call counts toward (or against) establishment in that same call. Votes accumulate without a cap — a long-established label carries proportionally deep memory, which is the spec's "no lock-in, flips under sustained contrary evidence" behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/clients/SonioxSideTracker.test.ts`
Expected: FAIL — module `./SonioxSideTracker` does not exist.

- [ ] **Step 3: Implement**

Create `src/services/clients/SonioxSideTracker.ts`:

```typescript
/**
 * Speaker-label → conversation-side attribution for the Both single-session
 * path (see docs/superpowers/specs/2026-07-30-soniox-diarization-attribution-design.md).
 *
 * Pure bookkeeping — no timers, no I/O. SonioxClient records one energy
 * sample per 100 ms mixer frame ACTUALLY SENT to the STT socket (dropped
 * frames don't advance the server's audio clock), so frame index × frameMs
 * lines up with token start_ms/end_ms. Channel A is the mic ('speaker'
 * side), channel B the far end ('participant').
 *
 * Three tiers, evaluated per inferSide call:
 *   1. an established speaker-label mapping (net energy-backed votes >= establishNet)
 *   2. a fresh energy verdict for the token's time window (also casts a vote)
 *   3. null — the caller falls back to the legacy language comparison,
 *      which never votes (in the same-language case it is exactly the
 *      unreliable witness this class exists to replace).
 */

export type UtteranceSide = 'speaker' | 'participant';

export interface SideEvidence {
  side: UtteranceSide;
  tier: 'label' | 'energy';
}

interface SideTrackerOptions {
  frameMs?: number;
  capacity?: number;
  energyRatio?: number;
  establishNet?: number;
}

const FRAME_MS = 100;
const CAPACITY_FRAMES = 600; // 60 s of timeline
const ENERGY_RATIO = 2;      // one channel must carry 2x the other's energy
const ESTABLISH_NET = 2;     // net votes before a label answers on its own

export class SonioxSideTracker {
  private readonly frameMs: number;
  private readonly capacity: number;
  private readonly energyRatio: number;
  private readonly establishNet: number;

  private framesA: number[] = [];
  private framesB: number[] = [];
  private baseIndex = 0; // absolute frame index of framesA[0]/framesB[0]
  // Net energy-backed votes per speaker label: positive = 'speaker' (A),
  // negative = 'participant' (B).
  private votes = new Map<string, number>();

  constructor(options: SideTrackerOptions = {}) {
    this.frameMs = options.frameMs ?? FRAME_MS;
    this.capacity = options.capacity ?? CAPACITY_FRAMES;
    this.energyRatio = options.energyRatio ?? ENERGY_RATIO;
    this.establishNet = options.establishNet ?? ESTABLISH_NET;
  }

  recordFrame(energyA: number, energyB: number): void {
    this.framesA.push(energyA);
    this.framesB.push(energyB);
    const over = this.framesA.length - this.capacity;
    if (over > 0) {
      this.framesA.splice(0, over);
      this.framesB.splice(0, over);
      this.baseIndex += over;
    }
  }

  inferSide(
    speaker: string | undefined,
    startMs: number | undefined,
    endMs: number | undefined
  ): SideEvidence | null {
    const energySide = this.energyVerdict(startMs, endMs);
    if (speaker && energySide) {
      this.votes.set(speaker, (this.votes.get(speaker) ?? 0) + (energySide === 'speaker' ? 1 : -1));
    }
    if (speaker) {
      const net = this.votes.get(speaker) ?? 0;
      if (Math.abs(net) >= this.establishNet) {
        return { side: net > 0 ? 'speaker' : 'participant', tier: 'label' };
      }
    }
    if (energySide) return { side: energySide, tier: 'energy' };
    return null;
  }

  reset(): void {
    this.framesA = [];
    this.framesB = [];
    this.baseIndex = 0;
    this.votes.clear();
  }

  private energyVerdict(startMs: number | undefined, endMs: number | undefined): UtteranceSide | null {
    if (startMs == null) return null;
    const from = Math.floor(startMs / this.frameMs);
    const to = Math.max(from, Math.ceil((endMs ?? startMs + this.frameMs) / this.frameMs) - 1);
    let a = 0;
    let b = 0;
    let counted = 0;
    for (let i = from; i <= to; i++) {
      const idx = i - this.baseIndex;
      if (idx < 0 || idx >= this.framesA.length) continue;
      a += this.framesA[idx];
      b += this.framesB[idx];
      counted++;
    }
    if (!counted) return null;
    if (a > 0 && a >= this.energyRatio * b) return 'speaker';
    if (b > 0 && b >= this.energyRatio * a) return 'participant';
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/clients/SonioxSideTracker.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxSideTracker.ts src/services/clients/SonioxSideTracker.test.ts
git commit -m "feat(soniox): add SonioxSideTracker for diarization side attribution (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `PcmMixer` — per-channel energy on every frame

**Files:**
- Modify: `src/services/clients/PcmMixer.ts` (`PcmMixerOptions.onFrame` at :16, `tick()` at :45-57)
- Test: `src/services/clients/PcmMixer.test.ts`

**Interfaces:**
- Produces: `onFrame: (mixed: Int16Array, energyA: number, energyB: number) => void` — energy = mean absolute value of the RAW (pre-0.5-gain) channel samples over the frame; a starved/zero-filled tail counts as zeros. Existing callbacks that ignore the new arguments keep working (Task 4 updates SonioxClient's).

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('PcmMixer', ...)` block in `src/services/clients/PcmMixer.test.ts` (the file's `make()` helper at :7-9 passes `onFrame` through, so extra callback args flow to the new tests):

```typescript
  it('reports per-channel mean-absolute energy of the raw (pre-gain) samples', () => {
    const got: Array<[number, number]> = [];
    const m = make((_f: Int16Array, ea: number, eb: number) => got.push([ea, eb]));
    m.start();
    m.pushA(new Int16Array([100, -100, 100, -100]));
    m.pushB(new Int16Array([10, 10, -10, -10]));
    vi.advanceTimersByTime(100);
    expect(got[0]).toEqual([100, 10]);
    m.stop();
  });

  it('reports zero energy for a silent/starved channel and partial energy for a zero-filled tail', () => {
    const got: Array<[number, number]> = [];
    const m = make((_f: Int16Array, ea: number, eb: number) => got.push([ea, eb]));
    m.start();
    m.pushA(new Int16Array([200, 200])); // 2 of 4 samples → mean |.| = 100
    vi.advanceTimersByTime(100);
    expect(got[0]).toEqual([100, 0]);
    m.stop();
  });
```

Also update the `make()` helper's parameter type so both old and new callbacks typecheck:

```typescript
function make(onFrame: (m: Int16Array, ea: number, eb: number) => void, over = {}) {
  return new PcmMixer({ frameSamples: 4, intervalMs: 100, maxBacklogSamples: 12, onFrame, ...over });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/clients/PcmMixer.test.ts`
Expected: the two new tests FAIL (`ea`/`eb` are `undefined`); the seven pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `src/services/clients/PcmMixer.ts`, change the options interface (:16):

```typescript
  /** Mixed frame plus the mean-absolute level of each RAW channel over the
   *  frame (pre-gain; zero-filled tail counts as zeros) — the Both-session
   *  side-attribution energy evidence (see SonioxSideTracker). */
  onFrame: (mixed: Int16Array, energyA: number, energyB: number) => void;
```

And `tick()` (:45-57):

```typescript
  private tick(): void {
    const n = this.options.frameSamples;
    const a = this.qA.splice(0, n);
    const b = this.qB.splice(0, n);
    const out = new Int16Array(n);
    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < n; i++) {
      const va = i < a.length ? a[i] : 0;
      const vb = i < b.length ? b[i] : 0;
      sumA += Math.abs(va);
      sumB += Math.abs(vb);
      const s = Math.round(0.5 * va + 0.5 * vb);
      out[i] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
    }
    this.options.onFrame(out, sumA / n, sumB / n);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/clients/PcmMixer.test.ts src/services/clients/SonioxClient.test.ts`
Expected: PASS — including SonioxClient's existing bidirectional tests (its `onFrame` callback ignores the new arguments until Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/PcmMixer.ts src/services/clients/PcmMixer.test.ts
git commit -m "feat(soniox): report per-channel energy from PcmMixer frames (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: STT wire — `enable_speaker_diarization` flag

**Files:**
- Modify: `src/services/clients/SonioxSttStream.ts` (`SonioxSttConfig`, first-frame config in `ws.onopen`)
- Test: `src/services/clients/SonioxSttStream.test.ts`

**Interfaces:**
- Produces: `SonioxSttConfig.enableSpeakerDiarization?: boolean`; wire key `enable_speaker_diarization: true` present iff truthy. Task 4's `SonioxClient` sets it for bidirectional sessions.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SonioxSttStream', ...)` block in `src/services/clients/SonioxSttStream.test.ts`:

```typescript
  it('includes enable_speaker_diarization when configured', async () => {
    const { ws } = await openStream({ ...CONFIG, enableSpeakerDiarization: true });
    const first = JSON.parse(ws.sent[0] as string);
    expect(first.enable_speaker_diarization).toBe(true);
  });

  it('omits enable_speaker_diarization when absent or false (wire unchanged)', async () => {
    for (const enableSpeakerDiarization of [undefined, false]) {
      const { s, ws } = await openStream({ ...CONFIG, enableSpeakerDiarization });
      const first = JSON.parse(ws.sent[0] as string);
      expect('enable_speaker_diarization' in first).toBe(false);
      s.close();
    }
  });
```

(Note: `openStream` uses `MockWebSocket.instances[0]` — for the two-iteration loop, reset instances or index with `.at(-1)`. Match the file's existing helper: if `openStream` hardcodes `instances[0]`, write the loop as two separate `it` cases or use `MockWebSocket.instances.at(-1)!` inline like this:

```typescript
  it('omits enable_speaker_diarization when absent or false (wire unchanged)', async () => {
    for (const enableSpeakerDiarization of [undefined, false]) {
      const s = new SonioxSttStream();
      const p = s.connect({ ...CONFIG, enableSpeakerDiarization });
      const ws = MockWebSocket.instances.at(-1)!;
      ws.open();
      await p;
      const first = JSON.parse(ws.sent[0] as string);
      expect('enable_speaker_diarization' in first).toBe(false);
    }
  });
```
Use this second form.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/clients/SonioxSttStream.test.ts`
Expected: the presence test FAILS (no such key); TypeScript flags the unknown config field.

- [ ] **Step 3: Implement**

In `SonioxSttConfig`, after the `endpointLatencyAdjustmentLevel` field:

```typescript
  /** Label tokens with a speaker id ("1", "2", …). Enabled only for the
   *  Both shared session; falsy = key omitted (wire unchanged). */
  enableSpeakerDiarization?: boolean;
```

In the first-frame config, after the `...(config.context ? ... )` spread:

```typescript
          ...(config.enableSpeakerDiarization ? { enable_speaker_diarization: true } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/clients/SonioxSttStream.test.ts`
Expected: PASS, pre-existing first-frame tests unedited.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxSttStream.ts src/services/clients/SonioxSttStream.test.ts
git commit -m "feat(soniox): support enable_speaker_diarization in the STT config frame (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `SonioxClient` — wire flag, tracker lifecycle, inference chain, TTS gate

**Files:**
- Modify: `src/services/clients/SonioxClient.ts`
- Test: `src/services/clients/SonioxClient.test.ts`

**Interfaces:**
- Consumes: `SonioxSideTracker`/`SideEvidence` (Task 1), the 3-arg `onFrame` (Task 2), `SonioxSttConfig.enableSpeakerDiarization` (Task 3), `SonioxToken.speaker/start_ms/end_ms` (already typed).
- Produces: behavior only — no new exports.

Current code anchors (line numbers as of branch base `d12bf768` + Tasks 1-3):
- import block top of file; fields around :85-126 (`bidirectional`, `mixer`, `utteranceSide`, `audioItemSide`)
- `connect()`: `stt.connect({...})` call ~:274-283 (after #368 it already passes `context`/`endpointSensitivity`/`endpointLatencyAdjustmentLevel`); bidirectional mixer block ~:291-299
- `handleSttMessage()` utteranceSide block ~:534-541
- `feedTts()` direction gate ~:630
- mixer teardown sites ~:953 and ~:977 (disconnect/reset paths)

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block at the end of `src/services/clients/SonioxClient.test.ts`. It follows the existing harness exactly: `BASE_CONFIG`, `sttInstances`/`ttsInstances`, `tok()` helper, real `PcmMixer` driven by fake timers (the pattern of the `bidirectional core` describe at :498), `stt.emit` for token frames.

```typescript
describe('SonioxClient diarization attribution (#342)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const FRAME = 2400; // SAMPLE_RATE * 0.1 — one 100 ms mixer frame
  const loud = () => new Int16Array(FRAME).fill(1000);
  const tok = (text: string, extra: object = {}) => ({ text, ...extra });

  async function bidi(textOnly = true) {
    const client = new SonioxClient('key');
    const updates: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (d) => updates.push(d) });
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly });
    return {
      client, updates,
      stt: sttInstances.at(-1)!, tts: ttsInstances.at(-1),
      port: (client as any).createSecondaryPort(),
    };
  }

  it('enables diarization on the wire for bidirectional sessions only', async () => {
    const { stt } = await bidi();
    expect(stt.config!.enableSpeakerDiarization).toBe(true);
    const solo = new SonioxClient('key');
    solo.setEventHandlers({});
    await solo.connect({ ...BASE_CONFIG, bidirectional: false, textOnly: true });
    expect((sttInstances.at(-1)!.config as any).enableSpeakerDiarization).toBeUndefined();
  });

  it('attributes a participant speaking MY language to participant via channel energy (language method would say speaker)', async () => {
    const { updates, stt, port } = await bidi();
    port.appendInputAudio(loud());       // far end (B) speaks during frame 0
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('你好', {
      is_final: true, translation_status: 'original',
      language: 'zh',                    // == sourceLanguage → language method would say 'speaker'
      speaker: '2', start_ms: 0, end_ms: 100,
    })] });
    expect(updates.at(-1)!.item.source).toBe('participant');
  });

  it('cold start: my own speech in a non-source language is attributed to speaker via energy', async () => {
    const { client, updates, stt } = await bidi();
    client.appendInputAudio(loud());     // mic (A) speaks during frame 0
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('Hello', {
      is_final: true, translation_status: 'original',
      language: 'en',                    // != sourceLanguage → language method would say 'participant'
      speaker: '1', start_ms: 0, end_ms: 100,
    })] });
    expect(updates.at(-1)!.item.source).toBe('speaker');
  });

  it('an established label takes over when both channels are hot (overlap)', async () => {
    const { client, updates, stt, port } = await bidi();
    // Two clean B-only utterances establish label '2' → participant.
    for (const [start, end] of [[0, 100], [100, 200]] as const) {
      port.appendInputAudio(loud());
      vi.advanceTimersByTime(100);
      stt.emit({ tokens: [tok('好', {
        is_final: true, translation_status: 'original', language: 'zh',
        speaker: '2', start_ms: start, end_ms: end,
      })] });
      stt.emit({ tokens: [tok('<end>')] });
    }
    // Overlap: both channels hot during frame 2 → ambiguous energy.
    client.appendInputAudio(loud());
    port.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('也好', {
      is_final: true, translation_status: 'original', language: 'zh',
      speaker: '2', start_ms: 200, end_ms: 300,
    })] });
    expect(updates.at(-1)!.item.source).toBe('participant');
  });

  it('falls back to the language method when tokens carry no speaker and no usable timing', async () => {
    const { updates, stt } = await bidi();
    stt.emit({ tokens: [tok('你好', { is_final: true, translation_status: 'original', language: 'zh' })] });
    expect(updates.at(-1)!.item.source).toBe('speaker'); // today's behavior, byte-for-byte
    stt.emit({ tokens: [tok('<end>')] });
    stt.emit({ tokens: [tok('Hello', { is_final: true, translation_status: 'original', language: 'en' })] });
    expect(updates.at(-1)!.item.source).toBe('participant');
  });

  it('TTS gate follows the resolved side: participant translations are not spoken, speaker translations are', async () => {
    const { client, stt, tts, port } = await bidi(false); // textOnly=false → TTS active
    // Participant utterance (B energy, MY language — the gate must NOT rely on language).
    port.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original', language: 'zh', speaker: '2', start_ms: 0, end_ms: 100 }),
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh', speaker: '2' }),
    ] });
    expect(tts!.sent).toHaveLength(0);
    stt.emit({ tokens: [tok('<end>')] });
    // Speaker utterance (A energy) → translation IS fed.
    client.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [
      tok('早上好', { is_final: true, translation_status: 'original', language: 'zh', speaker: '1', start_ms: 100, end_ms: 200 }),
      tok('Good morning', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh', speaker: '1' }),
    ] });
    expect(tts!.sent.map((s: any) => s.text)).toEqual(['Good morning']);
  });

  it('a new connect on the same client starts with no label memory from the previous session', async () => {
    const { client, stt, port, updates } = await bidi();
    port.appendInputAudio(loud());
    vi.advanceTimersByTime(100);
    stt.emit({ tokens: [tok('好', { is_final: true, translation_status: 'original', language: 'zh', speaker: '2', start_ms: 0, end_ms: 100 })] });
    await client.disconnect();
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: true });
    const stt2 = sttInstances.at(-1)!;
    // Same label '2', no timing/energy evidence: must hit the language
    // fallback (zh == source → speaker), not the stale participant memory.
    stt2.emit({ tokens: [tok('好', { is_final: true, translation_status: 'original', language: 'zh', speaker: '2' })] });
    expect(updates.at(-1)!.item.source).toBe('speaker');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts`
Expected: the new describe FAILS (wire flag undefined; energy-driven attributions come out per the language method instead); all pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `src/services/clients/SonioxClient.ts`:

**(a)** Import and field (next to the `mixer` field):

```typescript
import { SonioxSideTracker } from './SonioxSideTracker';
```
```typescript
  // Both single-session only: energy timeline + speaker-label memory that
  // resolves which side an utterance belongs to (see SonioxSideTracker docs).
  private sideTracker: SonioxSideTracker | null = null;
```

**(b)** `connect()` — add the wire flag to the existing `stt.connect({...})` call (one line, next to the endpoint fields):

```typescript
      ...(effectiveTwoWay ? { enableSpeakerDiarization: true } : {}),
```

**(c)** `connect()` — the bidirectional mixer block becomes:

```typescript
    if (this.bidirectional) {
      this.sideTracker = new SonioxSideTracker();
      this.mixer = new PcmMixer({
        frameSamples: Math.round(SAMPLE_RATE * 0.1),
        intervalMs: 100,
        maxBacklogSamples: SAMPLE_RATE * 2,
        // Record energy ONLY for frames actually sent: dropped frames don't
        // advance the server's audio clock, and the tracker's frame index
        // must line up with token start_ms.
        onFrame: (mixed, energyA, energyB) => {
          if (this.stt?.isOpen()) {
            this.stt.sendAudio(mixed);
            this.sideTracker?.recordFrame(energyA, energyB);
          }
        },
      });
      this.mixer.start();
    }
```

**(d)** `handleSttMessage()` — replace the utteranceSide block (currently the `if (this.bidirectional && this.utteranceSide === null) { ... }` statement) with:

```typescript
      if (this.bidirectional && this.utteranceSide === null) {
        // Tier 1+2: established speaker label, else channel-energy verdict
        // (original tokens carry start_ms/end_ms; translation tokens can
        // still hit tier 1 via their speaker field).
        const evidence = this.sideTracker?.inferSide(token.speaker, token.start_ms, token.end_ms) ?? null;
        if (evidence) {
          this.utteranceSide = evidence.side;
        } else {
          // Tier 3: legacy language comparison (display only — never votes).
          const src = this.currentConfig?.sourceLanguage;
          if (!isTranslation && token.language) {
            this.utteranceSide = token.language === src ? 'speaker' : 'participant';
          } else if (isTranslation && token.source_language) {
            this.utteranceSide = token.source_language === src ? 'speaker' : 'participant';
          }
        }
      }
```

**(e)** `feedTts()` — replace the direction gate line (`if (this.bidirectional && token.source_language !== this.currentConfig.sourceLanguage) return;`) with:

```typescript
    if (this.bidirectional) {
      // The attribution chain has already run for this token in
      // handleSttMessage; fall back to the legacy language comparison only
      // if it produced nothing at all.
      const side = this.utteranceSide
        ?? (token.source_language === this.currentConfig.sourceLanguage ? 'speaker' : 'participant');
      if (side !== 'speaker') return; // v1: only me→other is spoken
    }
```

**(f)** Teardown — at BOTH mixer teardown sites (the disconnect path and the reset path; each currently reads `if (this.mixer) { this.mixer.stop(); this.mixer = null; }`), add tracker cleanup alongside:

```typescript
    this.sideTracker = null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts src/services/clients/PcmMixer.test.ts`
Expected: ALL PASS — including every pre-existing bidirectional tagging/TTS-filter test unedited (they emit tokens without speaker/timing, so they exercise the tier-3 fallback and must behave byte-for-byte as before).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts
git commit -m "feat(soniox): diarization-backed side attribution for the Both shared session (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only; fix regressions if any appear).

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: same pass/fail profile as the branch base except for the new tests: the only failures are the 11 pre-existing environmental "Denied ID …?url" items (this worktree has no own node_modules). Classify anything else as a regression and fix it. If attribution cannot be cleanly established for a failure, compare at the branch base: `git checkout d12bf768 -q`, run the single test, `git checkout feat/soniox-diarization -q` (tree is clean).

- [ ] **Step 2: Build sanity**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Wire-neutrality re-check**

Run: `npx vitest run src/services/clients/`
Expected: PASS — the omission tests (Task 3's absent/false case; #368's default-omission tests) are the byte-identical-wire guarantee for non-shared sessions.

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A && git commit -m "fix(soniox): full-suite fixes for diarization attribution (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Out of scope for this plan

- Token-level bubble splitting on mid-utterance speaker change (possible follow-up).
- Any UI/settings/locale changes (none are needed — no new user-facing strings).
- Pushing the branch / opening a PR — requires the user's explicit per-action approval; the branch also needs a rebase onto main after PR #368 merges.
- Live smoke against the real API (spike already validated the wire behavior; a post-merge real-session check can ride the next release verification).
