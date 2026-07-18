# Soniox Both Single-Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Soniox's Both mode collapse from two STT sessions to one — mic + system audio mixed into a single `two_way` Soniox session — with a user "shared session" fallback toggle, direction derived from You/Others/Both instead of a provider toggle.

**Architecture:** A pure `PcmMixer` sums the two audio channels (fixed 0.5 each). `SonioxClient` runs `bidirectional` when its config says so: it owns the mixer, `appendInputAudio` feeds channel A, and `createSecondaryPort()` returns a lightweight IClient whose `appendInputAudio` feeds channel B — so MainPanel keeps its two-client shape (two refs → one core). The core tags each conversation item's `source` by token language so You/Others/Both display keeps working, and voices only the me→other direction in v1.

**Tech Stack:** TypeScript, Vitest (jsdom, fake timers), Zustand. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-18-soniox-provider-design.md` — Addendum 2026-07-19.

## Global Constraints

- Correctness gate is `npx vitest run` (the `test` package script is watch mode — never use it). `tsc` is NOT clean repo-wide (~113 pre-existing errors) — do not gate on tsc; a transient type mismatch that keeps tests green is acceptable between tasks and must be flagged.
- No-interruption rule stays: `createResponse`/`cancelResponse` are no-ops; never fire `onConversationInterrupted`.
- Mixer gain is **fixed 0.5 per channel, summed** — never clips (0.5·int16 + 0.5·int16 ≤ int16). No dynamic gain (proven equivalent to limiter/hardclip; Soniox is level-invariant).
- v1 TTS is **single sink** (existing `ai-assistant`): voice only the me→other direction — translation tokens whose `source_language === sourceLanguage`. The other→me direction is text-only. Dual-sink is a deferred follow-up, not built.
- Sample rate is **24000** everywhere (`SAMPLE_RATE` in SonioxClient; mic + system recorders both run at 24 kHz).
- All code comments/docs in English; conversation with the user in Chinese.
- Locale key parity is enforced across all 30 files by `src/locales/locales.consistency.test.ts` — any `providers.*`/`settings.*` key add/remove must touch all 30.
- Never `git push` or open/modify a PR without explicit per-action user approval.

---

### Task 1: PcmMixer

**Files:**
- Create: `src/services/clients/PcmMixer.ts`
- Test: `src/services/clients/PcmMixer.test.ts`

**Interfaces:**
- Produces (consumed by Task 3):
```ts
export interface PcmMixerOptions {
  frameSamples: number;       // samples emitted per tick, e.g. 2400 (100ms @ 24kHz)
  intervalMs: number;         // tick cadence, e.g. 100
  maxBacklogSamples: number;  // per-channel cap, e.g. 48000 (2s); oldest dropped past this
  onFrame: (mixed: Int16Array) => void;
}
export class PcmMixer {
  constructor(options: PcmMixerOptions);
  pushA(pcm: Int16Array): void;   // channel A (mic / speaker)
  pushB(pcm: Int16Array): void;   // channel B (system / participant)
  start(): void;                  // begin emitting frames
  stop(): void;                   // stop timer, clear queues
}
```

- [ ] **Step 1: Write the failing test**

Create `src/services/clients/PcmMixer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PcmMixer } from './PcmMixer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(onFrame: (m: Int16Array) => void, over = {}) {
  return new PcmMixer({ frameSamples: 4, intervalMs: 100, maxBacklogSamples: 12, onFrame, ...over });
}

describe('PcmMixer', () => {
  it('sums the two channels at fixed 0.5 each on each tick', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start();
    m.pushA(new Int16Array([100, 200, 300, 400]));
    m.pushB(new Int16Array([10, 20, 30, 40]));
    vi.advanceTimersByTime(100);
    expect(Array.from(frames[0])).toEqual([55, 110, 165, 220]); // round(0.5a+0.5b)
    m.stop();
  });

  it('zero-fills a starved channel (one side silent) — active side at half level', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start();
    m.pushA(new Int16Array([100, 200, 300, 400])); // B empty
    vi.advanceTimersByTime(100);
    expect(Array.from(frames[0])).toEqual([50, 100, 150, 200]);
    m.stop();
  });

  it('emits a full silence frame when both channels are empty (keepalive-friendly)', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start();
    vi.advanceTimersByTime(100);
    expect(frames[0].length).toBe(4);
    expect(Array.from(frames[0])).toEqual([0, 0, 0, 0]);
    m.stop();
  });

  it('consumes the queue across ticks in order', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start();
    m.pushA(new Int16Array([2, 4, 6, 8, 10, 12])); // 6 samples, frame=4
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);
    expect(Array.from(frames[0])).toEqual([1, 2, 3, 4]);
    expect(Array.from(frames[1])).toEqual([5, 6, 0, 0]); // remaining 2 + zero-fill
    m.stop();
  });

  it('drops oldest samples past the backlog cap', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f), { maxBacklogSamples: 4 });
    m.start();
    m.pushA(new Int16Array([1, 2, 3, 4, 5, 6])); // cap 4 → keep [3,4,5,6]
    vi.advanceTimersByTime(100);
    expect(Array.from(frames[0])).toEqual([2, 2, 3, 3]); // 0.5*[3,4,5,6] rounded
    m.stop();
  });

  it('stop() halts emission and start() is idempotent', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f));
    m.start(); m.start();
    m.stop();
    vi.advanceTimersByTime(500);
    expect(frames).toHaveLength(0);
  });

  it('clips the sum into int16 range', () => {
    const frames: Int16Array[] = [];
    const m = make((f) => frames.push(f), { frameSamples: 1 });
    m.start();
    m.pushA(new Int16Array([32767])); m.pushB(new Int16Array([32767]));
    vi.advanceTimersByTime(100);
    expect(frames[0][0]).toBe(32767); // 0.5*32767+0.5*32767 = 32767, no clip
    m.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/clients/PcmMixer.test.ts`
Expected: FAIL — cannot resolve `./PcmMixer`.

- [ ] **Step 3: Implement**

Create `src/services/clients/PcmMixer.ts`:

```ts
/**
 * Sums two mono Int16 PCM channels into one stream for a single Soniox STT
 * session (Both-mode single-session). Fixed 0.5 gain per channel — proven
 * equivalent to a limiter/hardclip for Soniox recognition (level-invariant)
 * and can never clip. A starved channel is zero-filled so timing is preserved;
 * a channel exceeding the backlog cap drops its oldest samples.
 *
 * The mixed stream is STT-only (never played), so cross-AudioContext clock
 * drift between the two recorders is immaterial — occasional zero-fill or drop
 * does not affect recognition.
 */
export interface PcmMixerOptions {
  frameSamples: number;
  intervalMs: number;
  maxBacklogSamples: number;
  onFrame: (mixed: Int16Array) => void;
}

export class PcmMixer {
  private qA: number[] = [];
  private qB: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private options: PcmMixerOptions) {}

  pushA(pcm: Int16Array): void { this.enqueue(this.qA, pcm); }
  pushB(pcm: Int16Array): void { this.enqueue(this.qB, pcm); }

  private enqueue(q: number[], pcm: Int16Array): void {
    for (let i = 0; i < pcm.length; i++) q.push(pcm[i]);
    const over = q.length - this.options.maxBacklogSamples;
    if (over > 0) q.splice(0, over); // drop oldest
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.qA = []; this.qB = [];
  }

  private tick(): void {
    const n = this.options.frameSamples;
    const a = this.qA.splice(0, n);
    const b = this.qB.splice(0, n);
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const va = i < a.length ? a[i] : 0;
      const vb = i < b.length ? b[i] : 0;
      const s = Math.round(0.5 * va + 0.5 * vb);
      out[i] = s < -32768 ? -32768 : s > 32767 ? 32767 : s;
    }
    this.options.onFrame(out);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/clients/PcmMixer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/PcmMixer.ts src/services/clients/PcmMixer.test.ts
git commit -m "feat(soniox): PcmMixer — fixed-0.5 two-channel mixer for Both single-session"
```

---

### Task 2: Config migration — `bidirectional` + `bothModeSharedSession`

**Files:**
- Modify: `src/services/interfaces/IClient.ts` (`SonioxSessionConfig`)
- Modify: `src/services/providers/SonioxProviderConfig.ts` (settings shape, defaults, `buildSessionConfig`)
- Modify: `src/services/clients/SonioxClient.ts` (`connect` keys off `bidirectional`)
- Modify: `src/services/clients/SonioxClient.test.ts` (two_way tests set `bidirectional`)
- Modify: `src/stores/settingsStore.ts` (nothing structural — slice key unchanged; verify defaults flow)

**Interfaces:**
- Produces (consumed by Tasks 3–6):
  - `SonioxSessionConfig` field `bidirectional: boolean` (replaces `twoWayTranslation`).
  - `SonioxSettings` field `bothModeSharedSession: boolean` (default `true`); `twoWayTranslation` removed.
  - `buildSessionConfig` emits `bidirectional: false` (You/Others are one_way; MainPanel flips it true only for shared-Both in Task 6).

Note (flag in report): after this task the settings UI in `ProviderSpecificSettings.tsx` still reads `sonioxSettings.twoWayTranslation` — a transient tsc-only mismatch (field gone → reads `undefined` → toggle shows Disabled; no crash, tests stay green). Task 5 removes that UI.

- [ ] **Step 1: Update the existing SonioxClient two_way tests to the new field**

In `src/services/clients/SonioxClient.test.ts`, the `BASE_CONFIG` and tests currently set `twoWayTranslation`. Replace every `twoWayTranslation:` with `bidirectional:` in that file (test config objects only). The two tests that assert two_way wire config — "two_way uses source/target as language_a/language_b with both hints" and "two_way with auto source degrades to one_way" — keep their assertions but drive them by `bidirectional: true`. For the auto-degrade test, keep `sourceLanguage: 'auto', bidirectional: true` and still expect `one_way` (SonioxClient keeps the belt: bidirectional + auto → one_way).

- [ ] **Step 2: Run to confirm RED**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts`
Expected: FAIL — `bidirectional` not yet honored by `SonioxClient.connect` / not on the type.

- [ ] **Step 3: Migrate the type**

In `src/services/interfaces/IClient.ts`, in `SonioxSessionConfig`, replace:
```ts
  twoWayTranslation: boolean;
```
with:
```ts
  /** True only for Both mode with a shared single session (set by MainPanel). Drives two_way vs one_way. */
  bidirectional: boolean;
```

- [ ] **Step 4: Migrate settings + descriptor**

In `src/services/providers/SonioxProviderConfig.ts`:
- In `SonioxSettings`, remove `twoWayTranslation: boolean;` and add:
```ts
  /** Both mode: use one shared two_way session (true) vs two separate sessions (false). */
  bothModeSharedSession: boolean;
```
- In `defaultSonioxSettings`, remove `twoWayTranslation: false,` and add `bothModeSharedSession: true,`.
- In `buildSessionConfig`, replace the `twoWayTranslation:` line with:
```ts
      // Direction is derived from You/Others/Both at connect time; default one_way.
      // MainPanel sets bidirectional:true only for the shared-Both single-session path.
      bidirectional: false,
```

- [ ] **Step 5: Migrate SonioxClient.connect**

In `src/services/clients/SonioxClient.ts` `connect()`, replace the direction derivation:
```ts
    const effectiveTwoWay = cfg.twoWayTranslation && cfg.sourceLanguage !== 'auto';
```
with:
```ts
    const effectiveTwoWay = cfg.bidirectional && cfg.sourceLanguage !== 'auto';
```
Add a private field near the other state fields (`private bidirectional = false;`) and set it in `connect` after `this.currentConfig = ...`:
```ts
    this.bidirectional = effectiveTwoWay;
```
(Tasks 3–4 consume `this.bidirectional`.)

- [ ] **Step 6: Run to confirm GREEN**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts src/services/providers/descriptorRegistry.test.ts src/stores/settingsStore.sliceRegistry.test.ts`
Expected: PASS (slice key `soniox` unchanged; wire tag unchanged; direction tests pass via `bidirectional`).

- [ ] **Step 7: Commit**

```bash
git add src/services/interfaces/IClient.ts src/services/providers/SonioxProviderConfig.ts src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts
git commit -m "refactor(soniox): direction field twoWayTranslation -> bidirectional; add bothModeSharedSession setting"
```

---

### Task 3: SonioxClient bidirectional core — mixer + secondary port

**Files:**
- Modify: `src/services/clients/SonioxClient.ts`
- Modify: `src/services/clients/SonioxClient.test.ts`

**Interfaces:**
- Consumes: `PcmMixer` (Task 1); `this.bidirectional` (Task 2).
- Produces (consumed by Task 6):
  - `appendParticipantAudio(audioData: Int16Array): void` — optional IClient method, feeds mixer channel B.
  - `createSecondaryPort(): IClient` — a port whose `appendInputAudio` → this core's `appendParticipantAudio`; all lifecycle/handler methods inert; `getProvider()`/`isConnected()` delegate.

- [ ] **Step 1: Write the failing test**

Add to `src/services/clients/SonioxClient.test.ts` (the file mocks `SonioxSttStream`/`SonioxTtsStream`; `MockStt` records `sentAudio`). Add a `vi.useFakeTimers()`-aware block. First extend `MockStt` if needed so `sendAudio` pushes to `sentAudio` (it already does per the existing file). Add:

```ts
describe('SonioxClient bidirectional core (Both single-session)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function bidiClient() {
    const client = new SonioxClient('key');
    client.setEventHandlers({});
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: true });
    return { client, stt: sttInstances.at(-1)! };
  }

  it('mixes appendInputAudio (A) and the secondary port (B) into one STT stream', async () => {
    const { client, stt } = await bidiClient();
    const port = (client as any).createSecondaryPort();
    client.appendInputAudio(new Int16Array([100, 100]));
    port.appendInputAudio(new Int16Array([10, 10]));
    vi.advanceTimersByTime(100);
    // one mixed frame reached the STT stream (0.5*100 + 0.5*10 = 55)
    const frame = stt.sentAudio.at(-1)!;
    expect(frame[0]).toBe(55);
  });

  it('non-bidirectional appendInputAudio still goes straight to the STT stream (no mixer)', async () => {
    const client = new SonioxClient('key');
    client.setEventHandlers({});
    await client.connect({ ...BASE_CONFIG, bidirectional: false, textOnly: true });
    const stt = sttInstances.at(-1)!;
    const pcm = new Int16Array([7, 7]);
    client.appendInputAudio(pcm);
    expect(stt.sentAudio).toContain(pcm); // direct, unmixed
  });

  it('secondary port is inert for lifecycle/handlers and delegates identity', async () => {
    const { client } = await bidiClient();
    const port = (client as any).createSecondaryPort();
    const handler = vi.fn();
    port.setEventHandlers({ onConversationUpdated: handler });
    await port.connect({} as any);   // no-op
    await port.disconnect();          // no-op — must NOT tear down the core
    expect(client.isConnected()).toBe(true);
    expect(port.isConnected()).toBe(true);
    expect(port.getProvider()).toBe(Provider.SONIOX);
    expect(port.getConversationItems()).toEqual([]);
  });

  it('disconnect stops the mixer (no frames after teardown)', async () => {
    const { client, stt } = await bidiClient();
    client.appendInputAudio(new Int16Array([100, 100]));
    await client.disconnect();
    const before = stt.sentAudio.length;
    vi.advanceTimersByTime(500);
    expect(stt.sentAudio.length).toBe(before);
  });
});
```

Note: the existing MockStt's `isOpen()` returns `!closed`; after `disconnect()` the core calls `stt.end()`+`close()`, so `sentAudio` stops growing. Ensure the mixer's `onFrame` guards on `stt` being present.

- [ ] **Step 2: Run to confirm RED**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts`
Expected: FAIL — `createSecondaryPort` undefined; mixing not wired.

- [ ] **Step 3: Implement**

In `src/services/clients/SonioxClient.ts`:
- Add import: `import { PcmMixer } from './PcmMixer';`
- Add fields near the other private state:
```ts
  private mixer: PcmMixer | null = null;
```
- In `connect()`, right after `this.isConnectedState = true;` (STT connected), add:
```ts
    if (this.bidirectional) {
      this.mixer = new PcmMixer({
        frameSamples: Math.round(SAMPLE_RATE * 0.1),
        intervalMs: 100,
        maxBacklogSamples: SAMPLE_RATE * 2,
        onFrame: (mixed) => { if (this.stt?.isOpen()) this.stt.sendAudio(mixed); },
      });
      this.mixer.start();
    }
```
- Replace `appendInputAudio`:
```ts
  appendInputAudio(audioData: Int16Array): void {
    if (this.mixer) { this.mixer.pushA(audioData); return; }
    if (!this.stt?.isOpen()) return;
    this.stt.sendAudio(audioData);
  }

  /** Channel B feed for the Both single-session mixer (fed by the secondary port). */
  appendParticipantAudio(audioData: Int16Array): void {
    if (this.mixer) this.mixer.pushB(audioData);
  }

  /**
   * Second IClient reference for MainPanel's participant slot in Both single-session.
   * Its audio is channel B of this core's mixer; every other method is inert so the
   * core is driven solely by the primary (speaker) reference.
   */
  createSecondaryPort(): IClient {
    const core = this;
    return {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => core.isConnected(),
      updateSession: () => {},
      reset: () => {},
      appendInputAudio: (d: Int16Array) => core.appendParticipantAudio(d),
      appendInputText: () => {},
      createResponse: () => {},
      cancelResponse: () => {},
      getConversationItems: () => [],
      clearConversationItems: () => {},
      setEventHandlers: () => {},
      getProvider: () => core.getProvider(),
    };
  }
```
- In `disconnect()`, before closing the STT stream, add:
```ts
    if (this.mixer) { this.mixer.stop(); this.mixer = null; }
```
- In `reset()`, add `this.mixer = null;` is NOT needed (reset runs at connect start, before mixer creation) — but if `reset()` could run mid-session, stop it: add `if (this.mixer) { this.mixer.stop(); this.mixer = null; }` at the top of `reset()`.

- [ ] **Step 4: Run to confirm GREEN**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts src/services/clients/`
Expected: PASS (new bidirectional block + all existing).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts
git commit -m "feat(soniox): bidirectional core — mixer wiring + createSecondaryPort (dual-ref one core)"
```

---

### Task 4: Bidirectional item source tagging + me→other TTS filter

**Files:**
- Modify: `src/services/clients/SonioxClient.ts`
- Modify: `src/services/clients/SonioxClient.test.ts`

**Interfaces:**
- Consumes: `this.bidirectional`, `this.currentConfig.sourceLanguage` (Task 2).
- Produces: in bidirectional mode, emitted items carry `item.source` ('speaker' = my language, 'participant' = other's); TTS is fed only for me→other translations.

Rules (from spec):
- Utterance side determined by the first original token's language: `language === sourceLanguage ? 'speaker' : 'participant'` (reset each `<end>`).
- `item.source` set to the utterance side (bidirectional only; unset otherwise → MainPanel fallback).
- TTS fed only when `token.source_language === sourceLanguage` (me→other; output = targetLanguage). The other→me direction is text-only in v1.

- [ ] **Step 1: Write the failing test**

Add to `src/services/clients/SonioxClient.test.ts`:

```ts
describe('SonioxClient bidirectional tagging + TTS filter', () => {
  async function bidi(textOnly = true) {
    const client = new SonioxClient('key');
    const updates: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (d) => updates.push(d) });
    await client.connect({ ...BASE_CONFIG, bidirectional: true, sourceLanguage: 'zh', targetLanguage: 'en', textOnly });
    return { client, updates, stt: sttInstances.at(-1)!, tts: ttsInstances.at(-1) };
  }
  const tok = (text: string, extra: object = {}) => ({ text, ...extra });

  it('tags my-language utterance items as source=speaker', async () => {
    const { updates, stt } = await bidi();
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'original', language: 'zh' }),
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' }),
    ] });
    expect(updates.every((u) => u.item.source === 'speaker')).toBe(true);
  });

  it('tags other-language utterance items as source=participant', async () => {
    const { updates, stt } = await bidi();
    stt.emit({ tokens: [
      tok('Hello', { is_final: true, translation_status: 'original', language: 'en' }),
      tok('你好', { is_final: true, translation_status: 'translation', language: 'zh', source_language: 'en' }),
    ] });
    expect(updates.some((u) => u.item.source === 'participant')).toBe(true);
    expect(updates.every((u) => u.item.source === 'participant')).toBe(true);
  });

  it('does NOT set source when not bidirectional (MainPanel fallback owns it)', async () => {
    const client = new SonioxClient('key');
    const updates: any[] = [];
    client.setEventHandlers({ onConversationUpdated: (d) => updates.push(d) });
    await client.connect({ ...BASE_CONFIG, bidirectional: false, sourceLanguage: 'zh', targetLanguage: 'en', textOnly: true });
    const stt = sttInstances.at(-1)!;
    stt.emit({ tokens: [tok('你好', { is_final: true, translation_status: 'original', language: 'zh' })] });
    expect(updates.every((u) => u.item.source === undefined)).toBe(true);
  });

  it('feeds TTS only for me→other translations (source_language === sourceLanguage)', async () => {
    const { stt, tts } = await bidi(false);
    stt.emit({ tokens: [
      tok('Hello', { is_final: true, translation_status: 'translation', language: 'en', source_language: 'zh' }), // me→other: SPOKEN
    ] });
    stt.emit({ tokens: [
      tok('你好', { is_final: true, translation_status: 'translation', language: 'zh', source_language: 'en' }),   // other→me: TEXT ONLY
    ] });
    expect(tts!.sent).toEqual([{ text: 'Hello', language: 'en' }]);
  });
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts`
Expected: FAIL — source not tagged; other→me still fed to TTS.

- [ ] **Step 3: Implement**

In `src/services/clients/SonioxClient.ts`:
- Add a private field: `private utteranceSide: 'speaker' | 'participant' | null = null;`
- In `reset()`, add `this.utteranceSide = null;`
- In `handleSttMessage`, inside the per-token loop, when an original (non-`<end>`/`<fin>`) token is seen and `this.bidirectional && this.utteranceSide === null`, set the side:
```ts
      // (inside the loop, where isTranslation is computed)
      if (this.bidirectional && this.utteranceSide === null) {
        const src = this.currentConfig?.sourceLanguage;
        if (!isTranslation && token.language) {
          this.utteranceSide = token.language === src ? 'speaker' : 'participant';
        } else if (isTranslation && token.source_language) {
          this.utteranceSide = token.source_language === src ? 'speaker' : 'participant';
        }
      }
```
- In `emitTextUpdate` and in `finishUtterance`'s `complete(...)` helper, after constructing the `item` object, set the source in bidirectional mode:
```ts
      if (this.bidirectional && this.utteranceSide) item.source = this.utteranceSide;
```
(Add this line wherever an item is built and before it is emitted — both the in-progress `emitTextUpdate` item and the completed `complete()` item, and the `emitAssistantAudio` item.)
- In `finishUtterance`, after resetting per-utterance state, add `this.utteranceSide = null;`
- In `feedTts`, gate the me→other filter at the top:
```ts
  private feedTts(text: string, token: SonioxToken): void {
    if (!this.tts) return;
    if (this.bidirectional && token.source_language !== this.currentConfig?.sourceLanguage) return; // v1: only me→other is spoken
    // ...existing body...
  }
```

- [ ] **Step 4: Run to confirm GREEN**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts`
Expected: PASS (tagging + filter + all existing).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts
git commit -m "feat(soniox): bidirectional item.source tagging by language + me->other TTS filter"
```

---

### Task 5: Settings UI + locales — swap two-way toggle for the shared-session toggle

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`
- Modify: `src/components/Settings/sections/LanguageSection.tsx`
- Modify: all 30 `src/locales/*/translation.json`

**Interfaces:**
- Consumes: `SonioxSettings.bothModeSharedSession` (Task 2); the current mode (`useConversationMode`/`effectiveMode` — see below).
- Produces: the greyed-unless-Both shared-session pill + its tooltip; removal of the two-way toggle and its interlock.

- [ ] **Step 1: Find how the settings panel reads the current You/Others/Both mode**

Run: `grep -rn "useConversationMode\|conversationMode\|state.mode\b" src/stores src/components/Settings | head`
Use whatever selector the store exposes for the active mode (`'speaker' | 'participant' | 'both'`). In `ProviderSpecificSettings.tsx`, read it (e.g. `const mode = useConversationMode();`). If no hook exists, read `useSettingsStore`/session store's mode field directly the way sibling code does. The pill is enabled only when `mode === 'both'`.

- [ ] **Step 2: Replace the Soniox settings render function**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, replace the entire `renderSonioxSettings` function (currently the two-way toggle, ~lines 1729–1770) with the shared-session toggle. Mirror the existing `.turn-detection-options`/`.option-button` pill pattern used elsewhere in the file, and reuse existing `settings.enabled`/`settings.disabled` keys:

```tsx
  const renderSonioxSettings = () => {
    if (provider !== Provider.SONIOX) return null;
    const inBoth = mode === 'both';
    const shared = sonioxSettings.bothModeSharedSession;
    return (
      <div className="settings-section" id="soniox-settings-section">
        <h2>{t('settings.sonioxSharedSession', 'Shared session in Both mode')}</h2>
        <div className="setting-item">
          <div className="turn-detection-options">
            <button
              className={`option-button ${shared ? 'active' : ''}`}
              disabled={isSessionActive || !inBoth}
              onClick={() => updateSonioxSettings({ bothModeSharedSession: true })}
            >{t('settings.enabled', 'Enabled')}</button>
            <button
              className={`option-button ${!shared ? 'active' : ''}`}
              disabled={isSessionActive || !inBoth}
              onClick={() => updateSonioxSettings({ bothModeSharedSession: false })}
            >{t('settings.disabled', 'Disabled')}</button>
          </div>
          <div className="setting-description">
            {!inBoth
              ? t('settings.sonioxSharedSessionOnlyBoth', 'Only affects Both mode.')
              : shared
                ? t('settings.sonioxSharedSessionOn', 'One Soniox session translates both sides with automatic speaker separation — lower cost and latency.')
                : t('settings.sonioxSharedSessionOff', 'A separate session per direction — more reliable when both people talk at once, but about twice the cost.')}
          </div>
        </div>
      </div>
    );
  };
```
Keep the `{renderSonioxSettings()}` call at its existing JSX site (~line 2069). Confirm the `updateCurrentProviderSetting`'s `Provider.SONIOX` branch (~line 287) stays (it writes `bothModeSharedSession` too via the generic path — no change needed).

- [ ] **Step 3: Remove the LanguageSection two-way/auto interlock**

In `src/components/Settings/sections/LanguageSection.tsx`, the two `case Provider.SONIOX:` entries (~lines 220, 293) that write `sourceLanguage`/`targetLanguage` **stay** (still needed). Remove only any Soniox-specific two-way interlock code added in the original Task 6 (search `twoWayTranslation` in this file — if present, delete those lines; the generic swap path already handles Soniox). Run `grep -n "twoWayTranslation\|sonioxTwoWay" src/components/Settings/sections/LanguageSection.tsx` — delete any hits.

- [ ] **Step 4: Locale keys — remove old, add new, across all 30 files**

Run this from repo root (removes the 4 obsolete keys, adds the 4 new ones with English text everywhere — English is the authoritative fallback; a later native pass can localize):

```bash
python3 - <<'PY'
import json, glob, collections
NEW = {
  "sonioxSharedSession": "Shared session in Both mode",
  "sonioxSharedSessionOn": "One Soniox session translates both sides with automatic speaker separation — lower cost and latency.",
  "sonioxSharedSessionOff": "A separate session per direction — more reliable when both people talk at once, but about twice the cost.",
  "sonioxSharedSessionOnlyBoth": "Only affects Both mode.",
}
OLD = ["sonioxTwoWay", "sonioxTwoWayDesc", "sonioxTwoWayNeedsSource", "translationMode"]
for p in glob.glob("src/locales/*/translation.json"):
    d = json.load(open(p, encoding="utf-8"), object_pairs_hook=collections.OrderedDict)
    s = d.get("settings", {})
    for k in OLD: s.pop(k, None)
    for k, v in NEW.items(): s.setdefault(k, v)
    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(p, "a", encoding="utf-8").write("\n")
print("updated", len(glob.glob("src/locales/*/translation.json")), "locale files")
PY
```
CAUTION: verify `translationMode` is not used by any OTHER provider before removing — run `grep -rn "settings.translationMode\|'translationMode'" src/ | grep -v locales` first; if another provider uses it, drop `translationMode` from the OLD list and leave it.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/locales/locales.consistency.test.ts src/components/Settings`
Expected: PASS (30-file key parity holds; Settings components render).

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/LanguageSection.tsx src/locales
git commit -m "feat(soniox): replace two-way toggle with Both shared-session toggle (greyed unless Both) + locales"
```

---

### Task 6: MainPanel integration — two localized branches

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

**Interfaces:**
- Consumes: `SonioxClient.createSecondaryPort()` (Task 3); `SonioxSessionConfig.bidirectional` (Task 2); `SonioxSettings.bothModeSharedSession` (Task 2); `effectiveMode` (existing, line 392).

Decision rule (compute once, reuse):
```ts
const useSharedBothSession =
  provider === Provider.SONIOX &&
  effectiveMode === 'both' &&
  (useSettingsStore.getState().soniox.bothModeSharedSession ?? true) &&
  useSettingsStore.getState().soniox.sourceLanguage !== 'auto'; // two_way needs a concrete source
```
(If `sourceLanguage` is `'auto'`, silently fall back to the 2-client path — safety belt.)

- [ ] **Step 1: Branch the speaker session config to bidirectional**

In `MainPanel.tsx`, at the speaker connect site (`const sessionConfig = getSessionConfig();`, ~line 1518), set `bidirectional` when shared-Both:
```ts
        const sessionConfig = getSessionConfig();
        if (
          sessionConfig.provider === 'soniox' &&
          effectiveMode === 'both' &&
          (useSettingsStore.getState().soniox.bothModeSharedSession ?? true) &&
          (sessionConfig as SonioxSessionConfig).sourceLanguage !== 'auto'
        ) {
          (sessionConfig as SonioxSessionConfig).bidirectional = true;
        }
```
Import `SonioxSessionConfig` from `../../services/interfaces/IClient` at the top if not already imported.

- [ ] **Step 2: Branch the participant client to the secondary port**

In the participant-capture block, the participant client is created at `participantClientRef.current = await createAIClient();` (~line 1728). Replace that single assignment with a branch that reuses the speaker core for shared-Both:
```ts
            const speakerCore = speakerClientRef.current;
            if (
              provider === Provider.SONIOX &&
              effectiveMode === 'both' &&
              (useSettingsStore.getState().soniox.bothModeSharedSession ?? true) &&
              useSettingsStore.getState().soniox.sourceLanguage !== 'auto' &&
              speakerCore && typeof (speakerCore as any).createSecondaryPort === 'function'
            ) {
              participantClientRef.current = (speakerCore as any).createSecondaryPort();
            } else {
              participantClientRef.current = await createAIClient();
            }
```
Everything downstream (participant event handlers, `participantClient.connect(participantSessionConfig)` — a no-op on the port, `startSystemAudioRecording`/`startTabAudioRecording` feeding `participantClient.appendInputAudio` → the port → channel B) is unchanged: the port's inert methods absorb the connect/handlers, and its `appendInputAudio` routes to the core's mixer channel B.

- [ ] **Step 3: Add the Soniox participant language swap (fixes Others mode + Both fallback direction)**

`createParticipantSessionConfig` (~lines 620–650) swaps `sourceLanguage`/`targetLanguage` for `openai_translate`, `volcengine_ast2`, and `local_native`, but **not `soniox`** — so the participant Soniox client (Others mode, and Both-shared-OFF fallback) currently translates the wrong direction. Add a Soniox branch next to the `volcengine_ast2` one, mirroring it:
```ts
    } else if (config.provider === 'soniox') {
      // Soniox carries direction in sourceLanguage/targetLanguage; reverse it so the
      // participant translates the other party's speech into the user's language.
      const sx = config as SonioxSessionConfig;
      [sx.sourceLanguage, sx.targetLanguage] = [sx.targetLanguage, sx.sourceLanguage];
```
This is harmless for the shared-Both path (the built config is passed to the inert secondary port and discarded). Known edge (leave as-is, note in report): if the user's `sourceLanguage` is `'auto'`, the swap yields `targetLanguage: 'auto'` (invalid target) — Others mode already requires a concrete "My Language" to have a target, so this mirrors existing provider behavior.

- [ ] **Step 4: Verify no teardown regression**

Read the participant `onClose` symmetric-teardown handler (`createParticipantEventHandlers`, ~line 550) and confirm it is set on `participantClientRef.current` via `participantClient.setEventHandlers(...)` — on the secondary port that's a no-op, so the participant port never fires `onClose`; the core's own `onClose` (via the speaker handlers) drives teardown. No change needed; note this in the report.

- [ ] **Step 5: Run the app-level and provider test suites**

Run: `npx vitest run src/components/MainPanel src/services/clients src/services/providers`
Expected: PASS (no existing MainPanel test asserts the participant-client-creation branch; the change is additive and provider-gated).

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(soniox): wire Both single-session in MainPanel via speaker bidirectional config + secondary port"
```

---

### Task 7: Full suite + live smoke

No production code unless the smoke surfaces a defect.

- [ ] **Step 1: Full suite green**

Run: `npx vitest run`
Expected: ALL PASS. Fix any fallout before proceeding.

- [ ] **Step 2: Live Both single-session smoke (needs the user's key)**

The user's key may still be at `/home/jiangzhuo/.claude/jobs/3c1ccd1c/tmp/soniox_key.txt`; if absent, ask. NEVER write it into the repo.

Reuse the browser smoke harness at `/home/jiangzhuo/.claude/jobs/3c1ccd1c/tmp/smoke/`. Drive the REAL app (dev server) in Both mode with Soniox selected, `bothModeSharedSession` ON, a concrete source language, and two speech sources (patch `getUserMedia` for mic AND provide system audio, or feed a two-speaker mixed clip). Verify:
1. Exactly ONE `wss://stt-rt.soniox.com` connection opens for Both (not two) — confirms single session.
2. First STT frame config carries `two_way`.
3. Conversation shows both sides: my-language turns on the speaker side, other-language turns on the participant side (item.source tagging works end-to-end).
4. Only the me→other translation is spoken (TTS frames present for that direction; other→me is text-only).
5. Turning `bothModeSharedSession` OFF reverts to TWO `stt-rt` connections (fallback path).
6. No console errors; clean session stop.

- [ ] **Step 3: Report results to the user**

Report each checklist item honestly (single-vs-two session counts, direction, tagging). Any failure goes back to the relevant task.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A && git commit -m "fix(soniox): Both single-session smoke fallout"
```

---

## Out of scope (do not implement)

- Dual-sink TTS routing (voicing the other→me direction to the local speakers). v1 is single-sink, me→other only.
- Energy/VAD-based ducking or any dynamic mixer gain (proven unnecessary).
- Native-speaker localization of the new/other locale strings (English fallback ships; separate pass).
- Any change to the ModePicker, mute gates, waveforms, footer, or teardown beyond the two additive MainPanel branches.
