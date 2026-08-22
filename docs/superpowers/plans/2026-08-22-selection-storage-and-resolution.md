# Selection Storage and Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move local-provider model selection to one record per translation direction, resolved by a single pure function that never writes its own results back to settings.

**Architecture:** A new `src/lib/local-inference/selection/` module holds the data shape (`Selections`), a pure resolver (`resolveStage` / `resolveDirection`), and one `CandidateSource` adapter per provider that normalises the two incompatible catalogs. Stores and components call the resolver instead of the three drifted copies of auto-select. The participant channel stops reversing languages and simply resolves the other direction.

**Tech Stack:** TypeScript (strict), Zustand (`subscribeWithSelector`), Vitest + jsdom, React 18.

**Spec:** `docs/superpowers/specs/2026-08-22-engine-model-selection-design.md`

This plan covers stages **S1–S3** of that spec's Staging table. Stages S0 and S4–S7 (all UI) are a separate plan.

## Global Constraints

- **English only** in all code, comments, and identifiers (CLAUDE.md).
- **TDD**: every task writes a failing test first, then the minimum code to pass.
- **No user-visible change** except determinism. The full suite passes at every task boundary.
- `''` means **auto** for all three stages. Nothing writes an auto result back into `selections`.
- The **only** write the resolver may cause is pruning a `not-in-catalog` selection to `''`, and even then it *reports* the prune — the store applies it.
- Direction key format is exactly `` `${src}→${tgt}` `` using U+2192 RIGHTWARDS ARROW, matching today's `modelPreferences` keys (`modelStore.ts:87`).
- Ranking, for both providers: `recommended` desc → `sortOrder` asc → `sizeBytes` asc, where `sizeBytes === 0` means unknown and sorts **last**.
- Run tests with `npm run test -- <path>`.
- Commit after every task with a Conventional Commits message.

---

### Task 1: Selection types and direction keys

**Files:**
- Create: `src/lib/local-inference/selection/types.ts`
- Test: `src/lib/local-inference/selection/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Stage`, `StageSelection`, `DirectionSelection`, `Selections`, `Candidate`, `CandidateSource`, `ResolutionReason`, `ResolutionNote`, `Resolved`, `StageResult`, `DirectionResult`, `EMPTY_STAGE`, `emptyDirection()`, `directionKey(src, tgt)`, `splitDirection(dir)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/local-inference/selection/types.test.ts
import { describe, it, expect } from 'vitest';
import { directionKey, splitDirection, emptyDirection } from './types';

describe('directionKey', () => {
  it('joins with U+2192, matching the legacy modelPreferences key format', () => {
    expect(directionKey('ja', 'en')).toBe('ja→en');
  });

  it('round-trips through splitDirection', () => {
    expect(splitDirection(directionKey('zh-Hant', 'en'))).toEqual(['zh-Hant', 'en']);
  });

  it('splits on the FIRST arrow only, so a tag containing one cannot corrupt the target', () => {
    expect(splitDirection('a→b→c')).toEqual(['a', 'b→c']);
  });
});

describe('emptyDirection', () => {
  it('is all-auto', () => {
    expect(emptyDirection()).toEqual({
      asr: { modelId: '' },
      translation: { modelId: '' },
      tts: { modelId: '' },
    });
  });

  it('returns a fresh object each call, so callers cannot poison a shared default', () => {
    const a = emptyDirection();
    const b = emptyDirection();
    a.asr.modelId = 'mutated';
    expect(b.asr.modelId).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/local-inference/selection/types.test.ts`
Expected: FAIL — `Failed to resolve import "./types"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/local-inference/selection/types.ts

/** The three pipeline stages a direction needs filled. */
export type Stage = 'asr' | 'translation' | 'tts';

/** One stage's stored choice. `modelId: ''` means auto — resolve it every time. */
export interface StageSelection {
  modelId: string;
  /** Quantization pin, scoped to this slot. Absent under auto. */
  variant?: string;
  /** Reserved for per-stage cloud providers. Unset today = local. */
  source?: string;
}

export interface DirectionSelection {
  asr: StageSelection;
  translation: StageSelection;
  tts: StageSelection;
}

/**
 * Keyed `${src}→${tgt}`. Only directions the user has explicitly touched appear;
 * an absent direction is entirely auto, which is why no LRU cap is needed.
 */
export type Selections = Record<string, DirectionSelection>;

export const EMPTY_STAGE: StageSelection = Object.freeze({ modelId: '' });

/** A fresh all-auto direction on every call — a factory, not a constant, so a
 *  caller that spreads and mutates cannot poison a shared object. */
export const emptyDirection = (): DirectionSelection => ({
  asr: { modelId: '' },
  translation: { modelId: '' },
  tts: { modelId: '' },
});

export const directionKey = (src: string, tgt: string): string => `${src}→${tgt}`;

/** Splits on the first arrow only; language tags never contain one, but a
 *  malformed key must not silently produce a three-part direction. */
export const splitDirection = (dir: string): [string, string] => {
  const i = dir.indexOf('→');
  return i < 0 ? [dir, ''] : [dir.slice(0, i), dir.slice(i + 1)];
};

/** A normalised candidate. Both providers project their catalog onto this so the
 *  resolver stays free of provider knowledge. */
export interface Candidate {
  id: string;
  recommended: boolean;
  sortOrder: number;
  /** 0 = unknown; sorts last among ties. */
  sizeBytes: number;
  /** Downloaded, or cloud with a valid key. */
  ready: boolean;
  /** WASM `deviceReady()`; native `!hardwareGated()`. */
  hardwareOk: boolean;
  /** Reserved: false for every local implementation today. */
  needsKey: boolean;
  /** May auto pick this? False for candidates selectable only on purpose —
   *  today, the AST-capable ASR entries that appear in the translation pool. */
  autoEligible: boolean;
  /** Is this pinned quantization still offered and runnable here?
   *  `undefined` (no pin) is always supported. */
  supportsVariant: (variant: string | undefined) => boolean;
}

export interface CandidateSource {
  /** Candidates for this stage and direction. Already language-filtered. */
  pool: (stage: Stage, src: string, tgt: string) => Candidate[];
  /** Catalog membership, language-agnostic. Separates "wrong direction"
   *  (revivable) from "no longer exists" (never revivable). */
  has: (stage: Stage, id: string) => boolean;
}

export type ResolutionReason =
  | 'not-in-catalog'
  | 'lang-incompatible'
  | 'not-downloaded'
  | 'hardware-gated'
  | 'needs-key'
  | 'no-candidate';

export interface ResolutionNote {
  direction: string;
  stage: Stage;
  from: string | null;
  to: string | null;
  reason: ResolutionReason;
}

export interface Resolved {
  modelId: string;
  variant?: string;
  source: 'explicit' | 'auto';
}

export interface StageResult {
  resolved: Resolved | null;
  note?: ResolutionNote;
  /** The stored selection can never become valid — the store should drop it. */
  prune?: true;
}

export interface DirectionResult {
  asr: Resolved | null;
  translation: Resolved | null;
  tts: Resolved | null;
  notes: ResolutionNote[];
  prunes: Array<{ direction: string; stage: Stage }>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/local-inference/selection/types.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/selection/types.ts src/lib/local-inference/selection/types.test.ts
git commit -m "feat(selection): add per-direction selection types and direction keys"
```

---

### Task 2: `resolveStage` honours an explicit selection

**Files:**
- Create: `src/lib/local-inference/selection/resolveStage.ts`
- Test: `src/lib/local-inference/selection/resolveStage.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `resolveStage(direction, stage, selections, candidates): StageResult`, `byRank(a, b): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/local-inference/selection/resolveStage.test.ts
import { describe, it, expect } from 'vitest';
import { resolveStage } from './resolveStage';
import type { Candidate, CandidateSource, Selections, Stage } from './types';

/** Fixture candidate. Defaults are "usable and auto-pickable" so each test
 *  only states the property it is about. */
export const C = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  recommended: false,
  sortOrder: 0,
  sizeBytes: 0,
  ready: true,
  hardwareOk: true,
  needsKey: false,
  autoEligible: true,
  supportsVariant: () => true,
  ...over,
});

/** A CandidateSource over a fixed pool. `has` defaults to pool membership plus
 *  any extra ids, which is how a language-incompatible-but-existing model is
 *  expressed: present in `extraKnown`, absent from `pool`. */
export const src = (pool: Candidate[], extraKnown: string[] = []): CandidateSource => ({
  pool: () => pool,
  has: (_stage: Stage, id: string) => pool.some((c) => c.id === id) || extraKnown.includes(id),
});

const sel = (modelId: string, variant?: string): Selections => ({
  'ja→en': {
    asr: { modelId, ...(variant ? { variant } : {}) },
    translation: { modelId: '' },
    tts: { modelId: '' },
  },
});

describe('resolveStage — explicit selection', () => {
  it('uses the stored model when it is in the pool, ready and runnable', () => {
    const r = resolveStage('ja→en', 'asr', sel('whisper-base'), src([C('sensevoice'), C('whisper-base')]));
    expect(r.resolved).toEqual({ modelId: 'whisper-base', variant: undefined, source: 'explicit' });
    expect(r.note).toBeUndefined();
    expect(r.prune).toBeUndefined();
  });

  it('carries the pinned variant through', () => {
    const r = resolveStage('ja→en', 'asr', sel('whisper-base', 'int8'), src([C('whisper-base')]));
    expect(r.resolved).toEqual({ modelId: 'whisper-base', variant: 'int8', source: 'explicit' });
  });

  it('ignores a pin the candidate no longer supports, without touching selections', () => {
    const selections = sel('whisper-base', 'bf16');
    const r = resolveStage('ja→en', 'asr', selections,
      src([C('whisper-base', { supportsVariant: (v) => v === undefined })]));
    expect(r.resolved).toEqual({ modelId: 'whisper-base', variant: undefined, source: 'explicit' });
    expect(selections['ja→en'].asr.variant).toBe('bf16');
  });

  it('prefers the explicit model over a better-ranked one', () => {
    const r = resolveStage('ja→en', 'asr', sel('whisper-base'),
      src([C('sensevoice', { recommended: true }), C('whisper-base')]));
    expect(r.resolved?.modelId).toBe('whisper-base');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/local-inference/selection/resolveStage.test.ts`
Expected: FAIL — `Failed to resolve import "./resolveStage"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/local-inference/selection/resolveStage.ts
import {
  type Candidate, type CandidateSource, type Selections, type Stage,
  type StageResult, EMPTY_STAGE, splitDirection,
} from './types';

/** Unknown size (0) sorts last among ties rather than first. */
const size = (c: Candidate): number => (c.sizeBytes > 0 ? c.sizeBytes : Number.POSITIVE_INFINITY);

/** recommended desc -> sortOrder asc -> sizeBytes asc. One rule, both providers. */
export const byRank = (a: Candidate, b: Candidate): number =>
  Number(b.recommended) - Number(a.recommended)
  || a.sortOrder - b.sortOrder
  || size(a) - size(b);

export function resolveStage(
  direction: string,
  stage: Stage,
  selections: Selections,
  candidates: CandidateSource,
): StageResult {
  const [src, tgt] = splitDirection(direction);
  const pool = candidates.pool(stage, src, tgt);
  const sel = selections[direction]?.[stage] ?? EMPTY_STAGE;

  if (sel.modelId !== '') {
    const c = pool.find((x) => x.id === sel.modelId);
    if (c && c.ready && c.hardwareOk) {
      return {
        resolved: {
          modelId: sel.modelId,
          variant: c.supportsVariant(sel.variant) ? sel.variant : undefined,
          source: 'explicit',
        },
      };
    }
  }

  const usable = pool.filter((c) => c.ready && c.hardwareOk && c.autoEligible).sort(byRank);
  const best = usable[0];
  return { resolved: best ? { modelId: best.id, variant: undefined, source: 'auto' } : null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/local-inference/selection/resolveStage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/selection/resolveStage.ts src/lib/local-inference/selection/resolveStage.test.ts
git commit -m "feat(selection): resolve an explicit stage selection"
```

---

### Task 3: `resolveStage` auto fallback and ranking

**Files:**
- Modify: `src/lib/local-inference/selection/resolveStage.test.ts` (append)

**This task pins a contract rather than driving new behaviour.** Task 2's implementation already contains the auto path; what is missing is the guarantee that both providers rank identically forever. So these tests are expected to pass on first run — a failure here means Task 2's `byRank` is wrong, and the fix goes in `byRank`, never in the test.

**Interfaces:**
- Consumes: `resolveStage`, `byRank`, the `C` and `src` fixtures from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Write the contract tests**

```ts
// append to src/lib/local-inference/selection/resolveStage.test.ts
const auto: Selections = {};

describe('resolveStage — auto', () => {
  it("resolves '' by ranking the pool", () => {
    const r = resolveStage('ja→en', 'asr', auto, src([C('a'), C('b', { recommended: true })]));
    expect(r.resolved).toEqual({ modelId: 'b', variant: undefined, source: 'auto' });
  });

  it('treats an absent direction the same as an all-auto one', () => {
    const explicitlyEmpty: Selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: '' } },
    };
    const pool = [C('a'), C('b', { recommended: true })];
    expect(resolveStage('ja→en', 'asr', auto, src(pool)).resolved)
      .toEqual(resolveStage('ja→en', 'asr', explicitlyEmpty, src(pool)).resolved);
  });

  it('ranks recommended first', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('plain', { sortOrder: 0 }), C('star', { recommended: true, sortOrder: 9 })]));
    expect(r.resolved?.modelId).toBe('star');
  });

  it('breaks a recommended tie by sortOrder', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('late', { recommended: true, sortOrder: 5 }), C('early', { recommended: true, sortOrder: 1 })]));
    expect(r.resolved?.modelId).toBe('early');
  });

  it('breaks a sortOrder tie by smaller size', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('big', { sizeBytes: 900 }), C('small', { sizeBytes: 100 })]));
    expect(r.resolved?.modelId).toBe('small');
  });

  it('sorts unknown size (0) last among ties rather than first', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('unknown', { sizeBytes: 0 }), C('known', { sizeBytes: 900 })]));
    expect(r.resolved?.modelId).toBe('known');
  });

  it('never auto-picks an un-ready candidate', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('down', { ready: false, recommended: true }), C('up')]));
    expect(r.resolved?.modelId).toBe('up');
  });

  it('never auto-picks a hardware-gated candidate', () => {
    const r = resolveStage('ja→en', 'asr', auto,
      src([C('gpu', { hardwareOk: false, recommended: true }), C('cpu')]));
    expect(r.resolved?.modelId).toBe('cpu');
  });

  it('never auto-picks a candidate marked explicit-only', () => {
    const r = resolveStage('ja→en', 'translation', auto,
      src([C('ast-model', { autoEligible: false, recommended: true }), C('mt')]));
    expect(r.resolved?.modelId).toBe('mt');
  });

  it('still lets an explicit selection reach an explicit-only candidate', () => {
    const selections: Selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: 'ast-model' }, tts: { modelId: '' } },
    };
    const r = resolveStage('ja→en', 'translation', selections,
      src([C('ast-model', { autoEligible: false }), C('mt')]));
    expect(r.resolved).toEqual({ modelId: 'ast-model', variant: undefined, source: 'explicit' });
  });

  it('returns null when nothing is usable', () => {
    const r = resolveStage('ja→en', 'asr', auto, src([C('down', { ready: false })]));
    expect(r.resolved).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests — they should pass unmodified**

Run: `npm run test -- src/lib/local-inference/selection/resolveStage.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 3: If any failed, fix `byRank` — not the test**

The likely culprit is `size()` in `resolveStage.ts` missing its `Number.POSITIVE_INFINITY` branch, which makes unknown size (0) sort *first*:

```ts
const size = (c: Candidate): number => (c.sizeBytes > 0 ? c.sizeBytes : Number.POSITIVE_INFINITY);
```

Re-run until green. If they all passed in Step 2, skip this step.

- [ ] **Step 4: Commit**

```bash
git add src/lib/local-inference/selection/resolveStage.test.ts
git commit -m "test(selection): pin the shared ranking contract for auto fallback"
```

---

### Task 4: Notes, prune, and the `not-in-catalog` distinction

**Files:**
- Modify: `src/lib/local-inference/selection/resolveStage.ts`
- Modify: `src/lib/local-inference/selection/resolveStage.test.ts` (append)

**Interfaces:**
- Consumes: `resolveStage`.
- Produces: `resolveStage` now populates `note` and `prune`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/local-inference/selection/resolveStage.test.ts
describe('resolveStage — why the explicit pick was not used', () => {
  const pick = (id: string): Selections => ({
    'ja→en': { asr: { modelId: id }, translation: { modelId: '' }, tts: { modelId: '' } },
  });

  it('deleted model -> not-downloaded, falls back, keeps the selection', () => {
    const selections = pick('whisper-base');
    const r = resolveStage('ja→en', 'asr', selections,
      src([C('whisper-base', { ready: false }), C('sensevoice')]));
    expect(r.note).toEqual({
      direction: 'ja→en', stage: 'asr',
      from: 'whisper-base', to: 'sensevoice', reason: 'not-downloaded',
    });
    expect(r.resolved).toEqual({ modelId: 'sensevoice', variant: undefined, source: 'auto' });
    expect(r.prune).toBeUndefined();
    expect(selections['ja→en'].asr.modelId).toBe('whisper-base');
  });

  it('wrong direction -> lang-incompatible when the model still exists elsewhere', () => {
    const r = resolveStage('ja→en', 'translation', pick('opus-mt-en-ja'),
      src([C('qwen')], ['opus-mt-en-ja']));
    expect(r.note?.reason).toBe('lang-incompatible');
    expect(r.prune).toBeUndefined();
  });

  it('model gone from the catalog -> not-in-catalog AND prune', () => {
    const r = resolveStage('ja→en', 'asr', pick('retired-model'), src([C('sensevoice')]));
    expect(r.note?.reason).toBe('not-in-catalog');
    expect(r.prune).toBe(true);
  });

  it('lost the GPU -> hardware-gated', () => {
    const r = resolveStage('ja→en', 'asr', pick('gpu-only'),
      src([C('gpu-only', { hardwareOk: false }), C('cpu')]));
    expect(r.note?.reason).toBe('hardware-gated');
  });

  it('cloud implementation without a key -> needs-key, not not-downloaded', () => {
    const r = resolveStage('ja→en', 'asr', pick('cloud'),
      src([C('cloud', { ready: false, needsKey: true }), C('local')]));
    expect(r.note?.reason).toBe('needs-key');
  });

  it('nothing usable and nothing chosen -> a single no-candidate note', () => {
    const r = resolveStage('ja→en', 'asr', {}, src([C('down', { ready: false })]));
    expect(r.resolved).toBeNull();
    expect(r.note).toEqual({
      direction: 'ja→en', stage: 'asr', from: null, to: null, reason: 'no-candidate',
    });
  });

  it('nothing usable but something was chosen -> keeps the specific reason, to: null', () => {
    const r = resolveStage('ja→en', 'asr', pick('whisper-base'),
      src([C('whisper-base', { ready: false })]));
    expect(r.resolved).toBeNull();
    expect(r.note).toEqual({
      direction: 'ja→en', stage: 'asr', from: 'whisper-base', to: null, reason: 'not-downloaded',
    });
  });

  it('prunes even when the fallback also fails', () => {
    const r = resolveStage('ja→en', 'asr', pick('retired-model'), src([]));
    expect(r.prune).toBe(true);
    expect(r.note?.reason).toBe('not-in-catalog');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/local-inference/selection/resolveStage.test.ts`
Expected: FAIL — 8 failures, all `expected undefined to equal { … }` on `r.note`.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `resolveStage` in `src/lib/local-inference/selection/resolveStage.ts`:

```ts
export function resolveStage(
  direction: string,
  stage: Stage,
  selections: Selections,
  candidates: CandidateSource,
): StageResult {
  const [src, tgt] = splitDirection(direction);
  const pool = candidates.pool(stage, src, tgt);
  const sel = selections[direction]?.[stage] ?? EMPTY_STAGE;

  let reason: ResolutionReason | null = null;
  let prune: true | undefined;

  if (sel.modelId !== '') {
    const c = pool.find((x) => x.id === sel.modelId);
    if (c && c.ready && c.hardwareOk) {
      return {
        resolved: {
          modelId: sel.modelId,
          variant: c.supportsVariant(sel.variant) ? sel.variant : undefined,
          source: 'explicit',
        },
      };
    }
    // Why not? `has` is language-agnostic, so it is the only thing that can tell
    // "exists but wrong for this direction" (revivable) from "gone" (never).
    if (!candidates.has(stage, sel.modelId)) {
      reason = 'not-in-catalog';
      prune = true;
    } else if (!c) {
      reason = 'lang-incompatible';
    } else if (!c.ready) {
      reason = c.needsKey ? 'needs-key' : 'not-downloaded';
    } else {
      reason = 'hardware-gated';
    }
  }

  const usable = pool.filter((c) => c.ready && c.hardwareOk && c.autoEligible).sort(byRank);
  const best = usable[0];
  const resolved = best ? { modelId: best.id, variant: undefined, source: 'auto' as const } : null;

  let note: ResolutionNote | undefined;
  if (reason) {
    note = { direction, stage, from: sel.modelId, to: best?.id ?? null, reason };
  } else if (!resolved) {
    note = { direction, stage, from: null, to: null, reason: 'no-candidate' };
  }

  return { resolved, note, prune };
}
```

Extend the imports at the top of the file:

```ts
import {
  type Candidate, type CandidateSource, type ResolutionNote, type ResolutionReason,
  type Selections, type Stage, type StageResult, EMPTY_STAGE, splitDirection,
} from './types';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/local-inference/selection/resolveStage.test.ts`
Expected: PASS (23 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/selection/resolveStage.ts src/lib/local-inference/selection/resolveStage.test.ts
git commit -m "feat(selection): report why an explicit pick was dropped, and prune only dead ids"
```

---

### Task 5: `resolveDirection`

**Files:**
- Modify: `src/lib/local-inference/selection/resolveStage.ts`
- Create: `src/lib/local-inference/selection/resolveDirection.test.ts`

**Interfaces:**
- Consumes: `resolveStage`.
- Produces: `resolveDirection(direction, selections, candidates): DirectionResult`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/local-inference/selection/resolveDirection.test.ts
import { describe, it, expect } from 'vitest';
import { resolveDirection } from './resolveStage';
import type { Candidate, CandidateSource, Selections, Stage } from './types';

const C = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, recommended: false, sortOrder: 0, sizeBytes: 0, ready: true, hardwareOk: true,
  needsKey: false, autoEligible: true, supportsVariant: () => true, ...over,
});

/** Per-stage, per-direction pools — the shape the real adapters have. */
const source = (byStage: Partial<Record<Stage, Record<string, Candidate[]>>>): CandidateSource => ({
  pool: (stage, src, tgt) => byStage[stage]?.[`${src}→${tgt}`] ?? [],
  has: (stage, id) =>
    Object.values(byStage[stage] ?? {}).some((list) => list.some((c) => c.id === id)),
});

const CAT = source({
  asr: { 'ja→en': [C('sensevoice')], 'en→ja': [C('sensevoice')] },
  translation: { 'ja→en': [C('opus-ja-en'), C('qwen')], 'en→ja': [C('qwen')] },
  tts: { 'ja→en': [C('kokoro-en')], 'en→ja': [] },
});

describe('resolveDirection', () => {
  it('resolves all three stages', () => {
    const r = resolveDirection('ja→en', {}, CAT);
    expect(r.asr?.modelId).toBe('sensevoice');
    expect(r.translation?.modelId).toBe('opus-ja-en');
    expect(r.tts?.modelId).toBe('kokoro-en');
  });

  it('returns null for a stage with no usable candidate, without failing the others', () => {
    const r = resolveDirection('en→ja', {}, CAT);
    expect(r.asr?.modelId).toBe('sensevoice');
    expect(r.tts).toBeNull();
    expect(r.notes.filter((n) => n.stage === 'tts' && n.reason === 'no-candidate')).toHaveLength(1);
  });

  it('collects notes and prunes across stages', () => {
    const selections: Selections = {
      'ja→en': { asr: { modelId: 'retired' }, translation: { modelId: '' }, tts: { modelId: 'also-retired' } },
    };
    const r = resolveDirection('ja→en', selections, CAT);
    expect(r.notes.map((n) => n.reason)).toEqual(['not-in-catalog', 'not-in-catalog']);
    expect(r.prunes).toEqual([
      { direction: 'ja→en', stage: 'asr' },
      { direction: 'ja→en', stage: 'tts' },
    ]);
  });

  it('resolves the two directions independently — neither consults the other', () => {
    const selections: Selections = {
      'ja→en': { asr: { modelId: '' }, translation: { modelId: 'opus-ja-en' }, tts: { modelId: '' } },
    };
    const speaker = resolveDirection('ja→en', selections, CAT);
    const participant = resolveDirection('en→ja', selections, CAT);
    expect(speaker.translation?.modelId).toBe('opus-ja-en');
    // The directional Opus model is simply absent from the reverse pool; the
    // reverse direction falls to its own best rather than inheriting anything.
    expect(participant.translation).toEqual({ modelId: 'qwen', variant: undefined, source: 'auto' });
    expect(participant.notes).toHaveLength(1);
    expect(participant.notes[0].stage).toBe('tts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/local-inference/selection/resolveDirection.test.ts`
Expected: FAIL — `resolveDirection is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/local-inference/selection/resolveStage.ts`:

```ts
const STAGES: Stage[] = ['asr', 'translation', 'tts'];

/**
 * One direction's three stages. Called once per live direction — speaker
 * (`src→tgt`) and participant (`tgt→src`) — with nothing shared between the two
 * calls beyond `selections` and `candidates`. There is deliberately no path by
 * which one direction can influence the other.
 */
export function resolveDirection(
  direction: string,
  selections: Selections,
  candidates: CandidateSource,
): DirectionResult {
  const out: DirectionResult = {
    asr: null, translation: null, tts: null, notes: [], prunes: [],
  };
  for (const stage of STAGES) {
    const r = resolveStage(direction, stage, selections, candidates);
    out[stage] = r.resolved;
    if (r.note) out.notes.push(r.note);
    if (r.prune) out.prunes.push({ direction, stage });
  }
  return out;
}
```

Add `type DirectionResult` to the import list at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/local-inference/selection/resolveDirection.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/selection/resolveStage.ts src/lib/local-inference/selection/resolveDirection.test.ts
git commit -m "feat(selection): resolve a whole direction, collecting notes and prunes"
```

---

### Task 6: WASM `CandidateSource`

**Files:**
- Create: `src/lib/local-inference/selection/candidates.wasm.ts`
- Test: `src/lib/local-inference/selection/candidates.wasm.test.ts`
- Read for reference: `src/lib/local-inference/modelManifest.ts:3301-3331` (`modelUsable`, `pickBestModel`)

**Interfaces:**
- Consumes: `Candidate`, `CandidateSource`, `Stage` from Task 1; `getManifestByType`, `getManifestEntry`, `modelUsable`, `isTranslationModelCompatible`, `isAstCompatible`, `getModelSizeMb`, `selectVariant` from `../modelManifest`.
- Produces: `wasmCandidates(ctx): CandidateSource` where
  `ctx = { modelStatuses: Record<string, ModelStatus>; webgpuAvailable: boolean; deviceFeatures: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/local-inference/selection/candidates.wasm.test.ts
import { describe, it, expect } from 'vitest';
import { wasmCandidates } from './candidates.wasm';
import { getManifestByType } from '../modelManifest';

const allDownloaded = () => {
  const out: Record<string, 'downloaded'> = {};
  for (const t of ['asr', 'asr-stream', 'translation', 'tts'] as const) {
    for (const m of getManifestByType(t)) out[m.id] = 'downloaded';
  }
  return out;
};

const ctx = () => ({
  modelStatuses: allDownloaded(),
  webgpuAvailable: true,
  deviceFeatures: [] as string[],
});

describe('wasmCandidates', () => {
  it('puts both asr and asr-stream models in the ASR pool', () => {
    const ids = wasmCandidates(ctx()).pool('asr', 'ja', 'en').map((c) => c.id);
    const streamIds = getManifestByType('asr-stream').map((m) => m.id);
    expect(ids.some((id) => streamIds.includes(id))).toBe(true);
  });

  it('filters ASR by SOURCE language', () => {
    const s = wasmCandidates(ctx());
    const ja = s.pool('asr', 'ja', 'en').map((c) => c.id);
    const ko = s.pool('asr', 'ko', 'en').map((c) => c.id);
    expect(ja).not.toEqual(ko);
  });

  it('filters TTS by TARGET language — the mirror of ASR', () => {
    const s = wasmCandidates(ctx());
    const toEn = s.pool('tts', 'ja', 'en').map((c) => c.id);
    const toJa = s.pool('tts', 'en', 'ja').map((c) => c.id);
    expect(toEn).not.toEqual(toJa);
  });

  it('excludes a directional translation model from the reverse direction', () => {
    const s = wasmCandidates(ctx());
    const fwd = s.pool('translation', 'ja', 'en').map((c) => c.id);
    const rev = s.pool('translation', 'en', 'ja').map((c) => c.id);
    const onlyForward = fwd.filter((id) => !rev.includes(id));
    expect(onlyForward.length).toBeGreaterThan(0);
  });

  it('keeps has() language-agnostic, so a wrong-direction model is preserved not pruned', () => {
    const s = wasmCandidates(ctx());
    const fwd = s.pool('translation', 'ja', 'en').map((c) => c.id);
    const rev = s.pool('translation', 'en', 'ja').map((c) => c.id);
    const onlyForward = fwd.find((id) => !rev.includes(id))!;
    expect(s.has('translation', onlyForward)).toBe(true);
  });

  it('reports has() false for an id no longer in the manifest', () => {
    expect(wasmCandidates(ctx()).has('asr', 'retired-model-xyz')).toBe(false);
  });

  it('marks un-downloaded models not ready', () => {
    const s = wasmCandidates({ ...ctx(), modelStatuses: {} });
    const local = s.pool('asr', 'ja', 'en').filter((c) => !c.needsKey);
    expect(local.every((c) => !c.ready)).toBe(true);
  });

  it('treats cloud models as ready regardless of download status', () => {
    const s = wasmCandidates({ ...ctx(), modelStatuses: {} });
    const cloud = s.pool('tts', 'ja', 'en').filter((c) =>
      getManifestByType('tts').find((m) => m.id === c.id)?.isCloudModel);
    expect(cloud.length).toBeGreaterThan(0);
    expect(cloud.every((c) => c.ready)).toBe(true);
  });

  it('marks WebGPU-only models hardware-gated when WebGPU is absent', () => {
    const s = wasmCandidates({ ...ctx(), webgpuAvailable: false });
    const gated = s.pool('translation', 'ja', 'en').filter((c) => !c.hardwareOk);
    expect(gated.length).toBeGreaterThan(0);
  });

  it('adds AST-capable ASR entries to the translation pool as explicit-only', () => {
    const s = wasmCandidates(ctx());
    const ast = s.pool('translation', 'ja', 'en').filter((c) => c.autoEligible === false);
    expect(ast.length).toBeGreaterThan(0);
    for (const c of ast) {
      expect(getManifestByType('translation').some((m) => m.id === c.id)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/local-inference/selection/candidates.wasm.test.ts`
Expected: FAIL — `Failed to resolve import "./candidates.wasm"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/local-inference/selection/candidates.wasm.ts
import {
  getManifestByType, getManifestEntry, deviceReady, isTranslationModelCompatible,
  isAstCompatible, getModelSizeMb,
  type ModelManifestEntry, type ModelStatus,
} from '../modelManifest';
import type { Candidate, CandidateSource, Stage } from './types';

export interface WasmCandidateCtx {
  modelStatuses: Record<string, ModelStatus>;
  webgpuAvailable: boolean;
  deviceFeatures: string[];
}

const asrEntries = (): ModelManifestEntry[] =>
  [...getManifestByType('asr'), ...getManifestByType('asr-stream')];

/** Language predicates, unchanged from today — only their home moved. */
const asrOk = (m: ModelManifestEntry, src: string) => Boolean(m.multilingual) || m.languages.includes(src);
const ttsOk = (m: ModelManifestEntry, tgt: string) => Boolean(m.multilingual) || m.languages.includes(tgt);

export function wasmCandidates(ctx: WasmCandidateCtx): CandidateSource {
  // modelUsable() is `downloaded && deviceReady`. The resolver needs the two
  // apart so a note can say WHICH one failed, and deviceReady is already
  // exported (modelManifest.ts:3285) — so call the halves directly rather than
  // the combined predicate.
  const toCandidate = (m: ModelManifestEntry, autoEligible = true): Candidate => ({
    id: m.id,
    recommended: Boolean(m.recommended),
    sortOrder: m.sortOrder ?? 0,
    sizeBytes: m.isCloudModel ? 0 : getModelSizeMb(m, ctx.deviceFeatures) * 1_048_576,
    ready: Boolean(m.isCloudModel) || ctx.modelStatuses[m.id] === 'downloaded',
    hardwareOk: deviceReady(m, ctx.webgpuAvailable),
    needsKey: false,
    autoEligible,
    // WASM chooses its variant from device features; a stored pin is honoured
    // only while that variant key still exists on this entry.
    supportsVariant: (v) => v === undefined || v in m.variants,
  });

  const pool = (stage: Stage, src: string, tgt: string): Candidate[] => {
    if (stage === 'asr') return asrEntries().filter((m) => asrOk(m, src)).map((m) => toCandidate(m));
    if (stage === 'tts') return getManifestByType('tts').filter((m) => ttsOk(m, tgt)).map((m) => toCandidate(m));
    return [
      ...getManifestByType('translation')
        .filter((m) => isTranslationModelCompatible(m, src, tgt))
        .map((m) => toCandidate(m)),
      // AST: an ASR model that translates directly. Reachable by explicit choice
      // only — today's short-circuit fires solely when translationModel === asrModel,
      // so letting auto pick one would be a behaviour change.
      ...asrEntries()
        .filter((m) => isAstCompatible(m, src, tgt))
        .map((m) => toCandidate(m, false)),
    ];
  };

  const has = (stage: Stage, id: string): boolean => {
    const entry = getManifestEntry(id);
    if (!entry) return false;
    if (stage === 'asr') return entry.type === 'asr' || entry.type === 'asr-stream';
    if (stage === 'tts') return entry.type === 'tts';
    return entry.type === 'translation' || entry.type === 'asr' || entry.type === 'asr-stream';
  };

  return { pool, has };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/local-inference/selection/candidates.wasm.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/selection/candidates.wasm.ts src/lib/local-inference/selection/candidates.wasm.test.ts
git commit -m "feat(selection): project the WASM manifest onto normalised candidates"
```

---

### Task 7: Native `CandidateSource`

**Files:**
- Create: `src/lib/local-inference/selection/candidates.native.ts`
- Test: `src/lib/local-inference/selection/candidates.native.test.ts`
- Read for reference: `src/lib/local-inference/native/nativeCatalog.ts` (`nativeAsrCards`, `nativeTranslationCards`, `nativeTtsModels`, `hardwareGated`)

**Interfaces:**
- Consumes: `Candidate`, `CandidateSource`, `Stage`; `nativeAsrCards`, `nativeTranslationCards`, `nativeTtsModels`, `hardwareGated` from `../native/nativeCatalog`; `NativeModelInfo` from `../native/nativeProtocol`.
- Produces: `nativeCandidates(ctx): CandidateSource` where
  `ctx = { catalog: Record<string, NativeModelInfo>; statuses: Record<string, 'ready' | 'absent' | 'downloading'> }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/local-inference/selection/candidates.native.test.ts
import { describe, it, expect } from 'vitest';
import { nativeCandidates } from './candidates.native';
import type { NativeModelInfo } from '../native/nativeProtocol';

const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
           recommended = false, extra: Partial<NativeModelInfo> = {}): NativeModelInfo =>
  ({ id, name: id, languages, recommended, tiers: [{ tier: 'cpu', backend: 'ct2', available: true }],
     order, repo: id, kind, ...extra });

const CATALOG: Record<string, NativeModelInfo> = {
  'sense-voice': M('sense-voice', 'asr', ['zh', 'en', 'ja', 'ko'], 1, true),
  'whisper-base': M('whisper-base', 'asr', ['multi'], 3),
  'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true, { sizeBytes: 480_000_000 }),
  'opus-mt-ja-en': M('opus-mt-ja-en', 'translate', ['ja', 'en'], 21, false, { sizeBytes: 78_000_000 }),
  'piper-en': M('piper-en', 'tts', ['en'], 1, true),
};

const ready = Object.fromEntries(Object.keys(CATALOG).map((id) => [id, 'ready' as const]));
const ctx = (over: Partial<{ statuses: Record<string, 'ready' | 'absent' | 'downloading'> }> = {}) =>
  ({ catalog: CATALOG, statuses: ready, ...over });

describe('nativeCandidates', () => {
  it('filters ASR by source language', () => {
    const s = nativeCandidates(ctx());
    expect(s.pool('asr', 'ja', 'en').map((c) => c.id)).toContain('sense-voice');
    expect(s.pool('asr', 'de', 'en').map((c) => c.id)).not.toContain('sense-voice');
  });

  it("treats 'multi' as a wildcard", () => {
    expect(nativeCandidates(ctx()).pool('asr', 'de', 'en').map((c) => c.id)).toContain('whisper-base');
  });

  it('shows a directional translate model only in its own direction', () => {
    const s = nativeCandidates(ctx());
    expect(s.pool('translation', 'ja', 'en').map((c) => c.id)).toContain('opus-mt-ja-en');
    expect(s.pool('translation', 'en', 'ja').map((c) => c.id)).not.toContain('opus-mt-ja-en');
  });

  it('keeps has() language-agnostic so the reverse direction preserves the pick', () => {
    expect(nativeCandidates(ctx()).has('translation', 'opus-mt-ja-en')).toBe(true);
  });

  it('reports has() false for an unknown id', () => {
    expect(nativeCandidates(ctx()).has('translation', 'gone')).toBe(false);
  });

  it("does not confuse kinds: an ASR id is not 'in' the tts stage", () => {
    expect(nativeCandidates(ctx()).has('tts', 'sense-voice')).toBe(false);
  });

  it('marks an absent model not ready', () => {
    const s = nativeCandidates(ctx({ statuses: { ...ready, 'sense-voice': 'absent' } }));
    expect(s.pool('asr', 'ja', 'en').find((c) => c.id === 'sense-voice')?.ready).toBe(false);
  });

  it('marks a downloading model not ready', () => {
    const s = nativeCandidates(ctx({ statuses: { ...ready, 'sense-voice': 'downloading' } }));
    expect(s.pool('asr', 'ja', 'en').find((c) => c.id === 'sense-voice')?.ready).toBe(false);
  });

  it('carries recommended, order and size through for ranking', () => {
    const c = nativeCandidates(ctx()).pool('translation', 'ja', 'en').find((x) => x.id === 'qwen2.5-0.5b')!;
    expect(c.recommended).toBe(true);
    expect(c.sortOrder).toBe(1);
    expect(c.sizeBytes).toBe(480_000_000);
  });

  it('reports sizeBytes 0 when the catalog omits it', () => {
    const c = nativeCandidates(ctx()).pool('asr', 'ja', 'en').find((x) => x.id === 'sense-voice')!;
    expect(c.sizeBytes).toBe(0);
  });

  it('marks every native candidate auto-eligible — AST is a WASM-only concept', () => {
    const s = nativeCandidates(ctx());
    expect(s.pool('translation', 'ja', 'en').every((c) => c.autoEligible)).toBe(true);
  });

  it('accepts a variant the catalog still offers and rejects one it does not', () => {
    const withVariants = {
      ...CATALOG,
      'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true, {
        variants: [{ id: 'int8', sizeBytes: 1, needBytes: 1, repo: 'r', supported: true, recommended: true }],
      }),
    };
    const c = nativeCandidates({ catalog: withVariants, statuses: ready })
      .pool('translation', 'ja', 'en').find((x) => x.id === 'qwen2.5-0.5b')!;
    expect(c.supportsVariant(undefined)).toBe(true);
    expect(c.supportsVariant('int8')).toBe(true);
    expect(c.supportsVariant('bf16')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/local-inference/selection/candidates.native.test.ts`
Expected: FAIL — `Failed to resolve import "./candidates.native"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/local-inference/selection/candidates.native.ts
import {
  nativeAsrCards, nativeTranslationCards, nativeTtsModels, hardwareGated,
} from '../native/nativeCatalog';
import type { NativeModelInfo } from '../native/nativeProtocol';
import type { Candidate, CandidateSource, Stage } from './types';

export interface NativeCandidateCtx {
  catalog: Record<string, NativeModelInfo>;
  statuses: Record<string, 'ready' | 'absent' | 'downloading'>;
}

const KIND_FOR: Record<Stage, NativeModelInfo['kind']> = {
  asr: 'asr', translation: 'translate', tts: 'tts',
};

export function nativeCandidates(ctx: NativeCandidateCtx): CandidateSource {
  const toCandidate = (info: NativeModelInfo): Candidate => ({
    id: info.id,
    recommended: Boolean(info.recommended),
    sortOrder: info.order,
    sizeBytes: info.sizeBytes ?? 0,
    ready: ctx.statuses[info.id] === 'ready',
    hardwareOk: !hardwareGated(info),
    needsKey: false,
    // AST is a WASM manifest concept; the sidecar has no equivalent, so every
    // native candidate is auto-eligible.
    autoEligible: true,
    supportsVariant: (v) => v === undefined || (info.variants ?? []).some((x) => x.id === v),
  });

  const infos = (stage: Stage, src: string, tgt: string): NativeModelInfo[] => {
    // The card helpers already apply this provider's language rules, including
    // the 'multi' wildcard and the canonLang aliases.
    const ids =
      stage === 'asr' ? nativeAsrCards(src, ctx.catalog).map((c) => c.selectId)
      : stage === 'translation' ? nativeTranslationCards(src, tgt, ctx.catalog).map((c) => c.selectId)
      : nativeTtsModels(tgt, ctx.catalog).map((m) => m.id);
    return ids.map((id) => ctx.catalog[id]).filter((m): m is NativeModelInfo => Boolean(m));
  };

  return {
    pool: (stage, src, tgt) => infos(stage, src, tgt).map(toCandidate),
    has: (stage, id) => ctx.catalog[id]?.kind === KIND_FOR[stage],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/local-inference/selection/candidates.native.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/selection/candidates.native.ts src/lib/local-inference/selection/candidates.native.test.ts
git commit -m "feat(selection): project the sidecar catalog onto normalised candidates"
```

---

### Task 8: Add `selections` to both settings slices and drop the flat fields

**Files:**
- Modify: `src/services/providers/LocalInferenceProviderConfig.ts:12-48`
- Modify: `src/services/providers/LocalNativeProviderConfig.ts:21-64`
- Test: `src/stores/settingsStore.selections.test.ts`

Per the spec's **No migration**, legacy keys are left in storage unread. `loadProviderSettings` iterates `Object.keys(defaults)`, so removing the fields from the defaults is the whole mechanism — no delete, no probe, no transform.

**Interfaces:**
- Consumes: `Selections` from Task 1.
- Produces: `LocalInferenceSettings.selections`, `LocalNativeSettings.selections`. Removed: `asrModel`, `translationModel`, `ttsModel` from both, plus `translationVariantByModel` from native.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/settingsStore.selections.test.ts
import { describe, it, expect } from 'vitest';
import { defaultLocalInferenceSettings } from '../services/providers/LocalInferenceProviderConfig';
import { defaultLocalNativeSettings } from '../services/providers/LocalNativeProviderConfig';

describe('local provider slices carry selections, not flat model fields', () => {
  for (const [name, defaults] of [
    ['localInference', defaultLocalInferenceSettings as Record<string, unknown>],
    ['localNative', defaultLocalNativeSettings as Record<string, unknown>],
  ] as const) {
    it(`${name} defaults to an empty selections map`, () => {
      expect(defaults.selections).toEqual({});
    });

    it(`${name} no longer declares the flat model fields`, () => {
      // The loader reads Object.keys(defaults); anything still listed here is
      // still loaded and still a second source of truth.
      expect(Object.keys(defaults)).not.toContain('asrModel');
      expect(Object.keys(defaults)).not.toContain('translationModel');
      expect(Object.keys(defaults)).not.toContain('ttsModel');
    });
  }

  it('localNative no longer declares the misnamed shared quant map', () => {
    expect(Object.keys(defaultLocalNativeSettings as Record<string, unknown>))
      .not.toContain('translationVariantByModel');
  });

  it('keeps the language pair — it is a session property, not a stage property', () => {
    expect(defaultLocalInferenceSettings.sourceLanguage).toBe('ja');
    expect(defaultLocalInferenceSettings.targetLanguage).toBe('en');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/stores/settingsStore.selections.test.ts`
Expected: FAIL — `expected undefined to deeply equal {}`.

- [ ] **Step 3: Write minimal implementation**

In `LocalInferenceProviderConfig.ts`, replace the three model fields in the interface with `selections` and add the import:

```ts
import type { Selections } from '../../lib/local-inference/selection/types';

export interface LocalInferenceSettings {
  /** Per-direction model choices. '' in any stage means auto. */
  selections: Selections;
  ttsSpeakerId: number;
  ttsSpeed: number;
  edgeTtsVoice: string;
  sourceLanguage: string;
  targetLanguage: string;
  // …the rest unchanged…
}

export const defaultLocalInferenceSettings: LocalInferenceSettings = {
  selections: {},
  ttsSpeakerId: 0,
  // …the rest unchanged, minus asrModel / translationModel / ttsModel…
};
```

Do the same in `LocalNativeProviderConfig.ts`, additionally deleting
`translationVariantByModel` from both the interface and the defaults (its per-model
pins now live on each `StageSelection.variant`).

Compilation will now fail across the codebase wherever those fields are read. Fix
only the mechanical cases in this task by routing through the resolver's result;
Tasks 9–12 own the real call sites. If a site cannot be fixed mechanically, leave a
compile error and move to the next task rather than inventing a shim.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/stores/settingsStore.selections.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/LocalInferenceProviderConfig.ts src/services/providers/LocalNativeProviderConfig.ts src/stores/settingsStore.selections.test.ts
git commit -m "feat(settings): store local model choices per direction, drop the flat fields"
```

---

### Task 9: `modelStore` routes through the resolver

**Files:**
- Modify: `src/stores/modelStore.ts` — delete `autoSelectModels` (`:543-620`), `modelPreferences` (`:87`, `:163`), `rememberModels`, `recallModels`, `getParticipantModelStatus` (`:448-540`); rewrite `ensureSelectionReady` (`:657-685`)
- Modify: `src/stores/modelStore.test.ts`

**Interfaces:**
- Consumes: `resolveDirection`, `wasmCandidates`, `directionKey`.
- Produces: `useModelStore.getState().resolve(src, tgt): DirectionResult` and `applyPrunes(prunes)`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/stores/modelStore.test.ts
import { directionKey } from '../lib/local-inference/selection/types';

describe('modelStore.resolve', () => {
  it('resolves a direction from the manifest and current download statuses', () => {
    useModelStore.setState({ modelStatuses: {}, webgpuAvailable: false });
    const r = useModelStore.getState().resolve('ja', 'en');
    // Nothing downloaded: every local stage is unresolvable.
    expect(r.asr).toBeNull();
    expect(r.notes.some((n) => n.stage === 'asr' && n.reason === 'no-candidate')).toBe(true);
  });

  it('does not write anything back into settings', async () => {
    const before = JSON.stringify(useSettingsStore.getState().localInference.selections);
    useModelStore.getState().resolve('ja', 'en');
    expect(JSON.stringify(useSettingsStore.getState().localInference.selections)).toBe(before);
  });

  it('applyPrunes clears only the named stages and drops an all-auto direction', async () => {
    const dir = directionKey('ja', 'en');
    await useSettingsStore.getState().updateLocalInference({
      selections: {
        [dir]: { asr: { modelId: 'gone' }, translation: { modelId: 'kept' }, tts: { modelId: '' } },
      },
    });
    await useModelStore.getState().applyPrunes([{ direction: dir, stage: 'asr' }]);
    expect(useSettingsStore.getState().localInference.selections[dir]).toEqual({
      asr: { modelId: '' }, translation: { modelId: 'kept' }, tts: { modelId: '' },
    });

    await useModelStore.getState().applyPrunes([{ direction: dir, stage: 'translation' }]);
    expect(useSettingsStore.getState().localInference.selections[dir]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/stores/modelStore.test.ts`
Expected: FAIL — `resolve is not a function`, plus failures in the old `autoSelectModels` / `rememberModels` describes.

- [ ] **Step 3: Write minimal implementation**

Delete the `autoSelectModels`, `rememberModels`, `recallModels`, `getParticipantModelStatus` actions, the `modelPreferences` state and its initial `{}`, and their entries in `ModelStoreState`. Delete the tests that covered them — their contract no longer exists, and the resolver tests replace it.

Add to `modelStore.ts`:

```ts
import { resolveDirection } from '../lib/local-inference/selection/resolveStage';
import { wasmCandidates } from '../lib/local-inference/selection/candidates.wasm';
import { directionKey, emptyDirection, type DirectionResult, type Stage } from '../lib/local-inference/selection/types';
import useSettingsStore from './settingsStore';
```

```ts
    /**
     * Resolve one direction. Pure with respect to settings: the result is a
     * computed value and is never written back — that distinction is what lets
     * the system tell a user's choice from a machine's guess.
     */
    resolve: (src, tgt) => {
      const { modelStatuses, webgpuAvailable, deviceFeatures } = get();
      const { selections } = useSettingsStore.getState().localInference;
      return resolveDirection(
        directionKey(src, tgt),
        selections,
        wasmCandidates({ modelStatuses, webgpuAvailable, deviceFeatures }),
      );
    },

    /**
     * The one write the resolver can cause: an id the manifest no longer knows
     * can never resolve again, so keeping it only produces a note the user
     * cannot act on. Garbage collection, not write-back.
     */
    applyPrunes: async (prunes) => {
      if (prunes.length === 0) return;
      const store = useSettingsStore.getState();
      const next = { ...store.localInference.selections };
      for (const { direction, stage } of prunes) {
        const dir = next[direction] ?? emptyDirection();
        next[direction] = { ...dir, [stage]: { modelId: '' } };
      }
      // A direction with nothing explicit left carries no information.
      for (const key of Object.keys(next)) {
        const d = next[key];
        if (!d.asr.modelId && !d.translation.modelId && !d.tts.modelId) delete next[key];
      }
      await store.updateLocalInference({ selections: next });
    },
```

Declare both on `ModelStoreState`:

```ts
  resolve: (src: string, tgt: string) => DirectionResult;
  applyPrunes: (prunes: Array<{ direction: string; stage: Stage }>) => Promise<void>;
```

Rewrite `ensureSelectionReady` to call `resolve` for the speaker direction, apply any
prunes, and report readiness as "ASR and translation both resolved", replacing its
former dependence on `autoSelectModels` corrections.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/stores/modelStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/modelStore.ts src/stores/modelStore.test.ts
git commit -m "refactor(models): resolve WASM selections instead of rewriting settings"
```

---

### Task 10: `nativeModelStore` routes through the resolver

**Files:**
- Modify: `src/stores/nativeModelStore.ts` — delete `modelPreferences` (`:20`, `:211`), `rememberModels` (`:521`), `recallModels` (`:524`), `autoSelect` (`:526-540`); rewrite `ensureSelectionReady` (`:452-518`)
- Modify: `src/lib/local-inference/native/nativeCatalog.ts` — delete `autoSelectNative` (`:505-566`)
- Modify: `src/stores/nativeModelStore.test.ts`, `src/lib/local-inference/native/nativeCatalog.test.ts`

**Interfaces:**
- Consumes: `resolveDirection`, `nativeCandidates`, `directionKey`.
- Produces: `useNativeModelStore.getState().resolve(src, tgt)` and `applyPrunes(prunes)` — same signatures as Task 9, over `localNative`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/stores/nativeModelStore.test.ts
import { directionKey } from '../lib/local-inference/selection/types';

describe('nativeModelStore.resolve', () => {
  it('resolves from the sidecar catalog and download statuses', () => {
    useNativeModelStore.setState({
      catalog: {
        'sense-voice': { id: 'sense-voice', name: 'SenseVoice', languages: ['ja', 'en'],
          recommended: true, tiers: [{ tier: 'cpu', backend: 'ct2', available: true }],
          order: 1, repo: 'r', kind: 'asr' },
      } as never,
      statuses: { 'sense-voice': 'ready' },
    });
    expect(useNativeModelStore.getState().resolve('ja', 'en').asr?.modelId).toBe('sense-voice');
  });

  it('falls to null when the only candidate is absent', () => {
    useNativeModelStore.setState({ statuses: { 'sense-voice': 'absent' } });
    expect(useNativeModelStore.getState().resolve('ja', 'en').asr).toBeNull();
  });

  it('applyPrunes writes to the localNative slice, not localInference', async () => {
    const dir = directionKey('ja', 'en');
    await useSettingsStore.getState().updateLocalNative({
      selections: { [dir]: { asr: { modelId: 'gone' }, translation: { modelId: 'kept' }, tts: { modelId: '' } } },
    });
    await useNativeModelStore.getState().applyPrunes([{ direction: dir, stage: 'asr' }]);
    expect(useSettingsStore.getState().localNative.selections[dir].asr.modelId).toBe('');
    expect(useSettingsStore.getState().localInference.selections[dir]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/stores/nativeModelStore.test.ts`
Expected: FAIL — `resolve is not a function`.

- [ ] **Step 3: Write minimal implementation**

Mirror Task 9 exactly, substituting `nativeCandidates({ catalog, statuses })` for
`wasmCandidates(...)` and `updateLocalNative` for `updateLocalInference`:

```ts
    resolve: (src, tgt) => {
      const { catalog, statuses } = get();
      const { selections } = useSettingsStore.getState().localNative;
      return resolveDirection(directionKey(src, tgt), selections, nativeCandidates({ catalog, statuses }));
    },
```

`applyPrunes` is the same function with `localNative` / `updateLocalNative`.

Delete `autoSelectNative` from `nativeCatalog.ts` and every test in
`nativeCatalog.test.ts` that exercises it; `resolveStage.test.ts` and
`candidates.native.test.ts` now own that behaviour. Leave `resolveNativeTts`,
`nativeAsrCards`, `nativeTranslationCards` and the rest untouched — the adapter
depends on them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/stores/nativeModelStore.test.ts src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "refactor(models): resolve native selections instead of rewriting settings"
```

---

### Task 11: Delete the two duplicate auto-select effects

**Files:**
- Modify: `src/components/Settings/sections/ModelManagementSection.tsx:376-437`
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:297-350`
- Modify: `src/components/Settings/sections/ModelManagementSection.test.tsx`

The third copy at `ProviderSpecificSettings.tsx:297-350` uses raw
`modelStatuses[id] === 'downloaded'` instead of `modelUsable()`, so it **skips the
`deviceReady` hardware gate** and can select a WebGPU-only model on a machine without
WebGPU. Deleting it is the fix.

**Interfaces:**
- Consumes: `useModelStore().resolve`.
- Produces: no new exports. Both components read the resolved model for their selected state.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/components/Settings/sections/ModelManagementSection.test.tsx
it('marks the resolved model selected without writing it to settings', async () => {
  useSettingsStore.setState({
    localInference: { ...useSettingsStore.getState().localInference, selections: {} },
  });
  useModelStore.setState({ modelStatuses: { 'sensevoice-int8': 'downloaded' }, webgpuAvailable: false });

  render(<ModelManagementSection />);

  const row = await screen.findByRole('radio', { name: /sensevoice/i });
  expect(row).toBeChecked();
  // The whole point: displaying an auto result must not persist it.
  expect(useSettingsStore.getState().localInference.selections).toEqual({});
});

it('never selects a WebGPU-only model when WebGPU is unavailable', async () => {
  useModelStore.setState({
    modelStatuses: Object.fromEntries(
      [...getManifestByType('asr'), ...getManifestByType('translation')].map((m) => [m.id, 'downloaded']),
    ),
    webgpuAvailable: false,
  });

  render(<ModelManagementSection />);

  const checked = await screen.findAllByRole('radio', { checked: true });
  for (const el of checked) {
    const id = el.getAttribute('value')!;
    expect(getManifestEntry(id)?.requiredDevice).not.toBe('webgpu');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/Settings/sections/ModelManagementSection.test.tsx`
Expected: FAIL — the first test fails because the surviving effect writes `selections`; the second fails because the `ProviderSpecificSettings` copy selects a gated model.

- [ ] **Step 3: Write minimal implementation**

Delete the entire `useEffect` at `ModelManagementSection.tsx:376-437` and the entire
`useEffect` at `ProviderSpecificSettings.tsx:297-350`, together with any imports left
unused (`pickBestModel`, `modelUsable`, `isTranslationModelCompatible`,
`isAstCompatible`, `getManifestEntry` where no longer referenced).

In `ModelManagementSection.tsx`, derive the selected id per stage:

```ts
const resolved = useModelStore((s) => s.resolve)(sourceLanguage, targetLanguage);
const selectedAsr = resolved.asr?.modelId ?? '';
const selectedTranslation = resolved.translation?.modelId ?? '';
const selectedTts = resolved.tts?.modelId ?? '';
```

and have each card's `checked` compare against these instead of
`settings.asrModel` / `settings.translationModel` / `settings.ttsModel`.

Picking a card writes an explicit selection:

```ts
const selectCard = async (stage: Stage, modelId: string) => {
  const dir = directionKey(sourceLanguage, targetLanguage);
  const current = localInferenceSettings.selections[dir] ?? emptyDirection();
  await updateLocalInference({
    selections: {
      ...localInferenceSettings.selections,
      [dir]: { ...current, [stage]: { modelId } },
    },
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/components/Settings/sections/ModelManagementSection.test.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ModelManagementSection.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/ModelManagementSection.test.tsx
git commit -m "fix(models): delete the duplicate auto-select effects and their deviceReady bypass"
```

---

### Task 12: Participant resolves its own direction

**Files:**
- Modify: `src/services/providers/localParticipantConfig.ts` — rewrite `createParticipantLocalInferenceConfig` (`:60-115`) and `createParticipantLocalNativeConfig` (`:143-192`), delete the `:121-142` comment block
- Modify: `src/services/providers/participantConfig.test.ts`

**Interfaces:**
- Consumes: `useModelStore().resolve`, `useNativeModelStore().resolve`.
- Produces: unchanged public signatures — `createParticipantLocalInferenceConfig(baseConfig)` and `createParticipantLocalNativeConfig(baseConfig)` still return the same result unions.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/services/providers/participantConfig.test.ts
describe('participant resolves the reverse direction as a peer', () => {
  it('reads selections[tgt→src] rather than borrowing the speaker memory', () => {
    const dir = directionKey('en', 'ja');
    useSettingsStore.setState({
      localNative: {
        ...useSettingsStore.getState().localNative,
        selections: { [dir]: { asr: { modelId: 'whisper-base' }, translation: { modelId: '' }, tts: { modelId: '' } } },
      },
    });
    useNativeModelStore.setState({
      catalog: NATIVE_FIXTURE,
      statuses: { 'whisper-base': 'ready', 'qwen2.5-0.5b': 'ready' },
    });

    const r = createParticipantLocalNativeConfig({ ...BASE, sourceLanguage: 'ja', targetLanguage: 'en' });
    expect(r.success).toBe(true);
    expect(r.success && r.config.sourceLanguage).toBe('en');
    expect(r.success && r.config.targetLanguage).toBe('ja');
    expect(r.success && r.config.asrModelId).toBe('whisper-base');
  });

  it('drops TTS entirely — the participant channel is text-only', () => {
    const r = createParticipantLocalNativeConfig({ ...BASE, sourceLanguage: 'ja', targetLanguage: 'en' });
    expect(r.success && r.config.ttsModelId).toBeUndefined();
    expect(r.success && r.config.ttsVariant).toBeUndefined();
  });

  it("fails with no_asr when the reverse direction cannot resolve ASR", () => {
    useNativeModelStore.setState({ catalog: NATIVE_FIXTURE, statuses: {} });
    const r = createParticipantLocalNativeConfig({ ...BASE, sourceLanguage: 'ja', targetLanguage: 'en' });
    expect(r.success).toBe(false);
    expect(!r.success && r.reason).toBe('no_asr');
  });

  it('does not inherit the speaker direction: an explicit speaker pick is not copied', () => {
    const speakerDir = directionKey('ja', 'en');
    useSettingsStore.setState({
      localNative: {
        ...useSettingsStore.getState().localNative,
        // 'ja-only-asr' is explicitly chosen for the speaker direction. It cannot
        // serve 'en', so if the participant inherited it we would see it here.
        selections: { [speakerDir]: { asr: { modelId: 'ja-only-asr' }, translation: { modelId: '' }, tts: { modelId: '' } } },
      },
    });
    useNativeModelStore.setState({
      catalog: NATIVE_FIXTURE,
      statuses: { 'ja-only-asr': 'ready', 'en-asr': 'ready', 'qwen2.5-0.5b': 'ready' },
    });
    const r = createParticipantLocalNativeConfig({ ...BASE, sourceLanguage: 'ja', targetLanguage: 'en' });
    expect(r.success && r.config.asrModelId).toBe('en-asr');
  });
});
```

Add these fixtures near the top of `participantConfig.test.ts`, beside the existing ones:

```ts
import { directionKey } from '../../lib/local-inference/selection/types';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import type { LocalNativeSessionConfig } from '../interfaces/IClient';

const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
           recommended = false): NativeModelInfo =>
  ({ id, name: id, languages, recommended, tiers: [{ tier: 'cpu', backend: 'ct2', available: true }],
     order, repo: id, kind });

const NATIVE_FIXTURE: Record<string, NativeModelInfo> = {
  'ja-only-asr': M('ja-only-asr', 'asr', ['ja'], 1, true),
  'en-asr': M('en-asr', 'asr', ['en'], 1, true),
  'whisper-base': M('whisper-base', 'asr', ['multi'], 5),
  'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true),
};

/** Minimal speaker-side session config; each test overrides the language pair. */
const BASE = {
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  asrModelId: 'ja-only-asr',
  translationModelId: 'qwen2.5-0.5b',
  ttsModelId: 'piper-en',
  ttsVariant: 'int8',
} as unknown as LocalNativeSessionConfig;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/services/providers/participantConfig.test.ts`
Expected: FAIL — the old implementation still calls `autoSelectNative`, which no longer exists after Task 10.

- [ ] **Step 3: Write minimal implementation**

Replace both functions. The native one:

```ts
/**
 * Build the participant (other-speaker) config. The participant direction is
 * `target→source` — a peer of the speaker direction, not a reversal of it. It has
 * its own entry in `selections` and resolves from its own pool, so nothing here
 * reverses fields or borrows the speaker's memory.
 *
 * TTS is dropped: the participant channel is text-only.
 */
export function createParticipantLocalNativeConfig(
  baseConfig: LocalNativeSessionConfig
): ParticipantLocalNativeResult {
  const revSrc = baseConfig.targetLanguage;
  const revTgt = baseConfig.sourceLanguage;
  const r = useNativeModelStore.getState().resolve(revSrc, revTgt);

  if (!r.asr) {
    return { success: false, reason: 'no_asr', detail: `No ASR model available for ${revSrc}` };
  }

  return {
    success: true,
    translationAvailable: Boolean(r.translation),
    config: {
      ...baseConfig,
      sourceLanguage: revSrc,
      targetLanguage: revTgt,
      asrModelId: r.asr.modelId,
      asrVariant: r.asr.variant,
      translationModelId: r.translation?.modelId,
      translationVariant: r.translation?.variant,
      ttsModelId: undefined,
      ttsVariant: undefined,
    },
  };
}
```

The WASM one is the same shape over `useModelStore.getState().resolve`, keeping the
existing memory-budget check between resolution and the return — it still consults
`estimateModelMemoryByDevice` over the speaker and participant model ids and returns
`{ success: false, reason: 'memory_exceeded' }` unchanged.

Delete `getParticipantModelStatus` usages and the `:121-142` comment block explaining
why re-resolution was necessary; it no longer is.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/services/providers/participantConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/localParticipantConfig.ts src/services/providers/participantConfig.test.ts
git commit -m "refactor(participant): resolve the reverse direction as a peer, not a reversal"
```

---

### Task 13: Drop the hidden `qwen2.5-0.5b` substitution

**Files:**
- Modify: `src/lib/local-inference/native/nativeCatalog.ts:148-158` (`requiredNativeModels`)
- Modify: `src/lib/local-inference/native/nativeCatalog.test.ts`

With `''` meaning auto uniformly and resolution happening before this function is
reached, a caller that still passes `''` has genuinely nothing selected — substituting
a hardcoded model hides that from the Start gate.

**Interfaces:**
- Consumes: nothing new.
- Produces: `requiredNativeModels` returns only ids that were actually chosen.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/lib/local-inference/native/nativeCatalog.test.ts
describe('requiredNativeModels', () => {
  it('does not substitute a hardcoded translation model for an empty choice', () => {
    const ids = requiredNativeModels('sense-voice', '', '', 'ja', 'en', TR_CAT, true);
    expect(ids).not.toContain('qwen2.5-0.5b');
    expect(ids).toEqual(['sense-voice']);
  });

  it('still lists a real translation choice', () => {
    const ids = requiredNativeModels('sense-voice', 'qwen2.5-0.5b', '', 'ja', 'en', TR_CAT, true);
    expect(ids).toEqual(['sense-voice', 'qwen2.5-0.5b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: FAIL — first test gets `['sense-voice', 'qwen2.5-0.5b']`.

- [ ] **Step 3: Write minimal implementation**

```ts
export function requiredNativeModels(
  asrModel: string, translationChoice: string, ttsChoice: string, _src: string, tgt: string,
  catalog: Record<string, NativeModelInfo>, textOnly = false,
): string[] {
  // No substitution: '' now means "resolution found nothing", and the Start gate
  // must see that rather than a model nobody chose.
  const ids = [asrModel, resolveNativeTranslation(translationChoice)]
    .filter((id): id is string => Boolean(id));
  if (!textOnly) {
    const tts = resolveNativeTts(ttsChoice, tgt, catalog);
    if (tts) ids.push(tts);
  }
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/local-inference/native/nativeCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/native/nativeCatalog.ts src/lib/local-inference/native/nativeCatalog.test.ts
git commit -m "fix(native): stop substituting a hardcoded translation model for an empty choice"
```

---

### Task 14: The Start gate follows the session-gate table

**Files:**
- Modify: `src/stores/modelStore.ts` (`ensureSelectionReady`)
- Modify: `src/stores/nativeModelStore.ts` (`ensureSelectionReady`)
- Test: `src/stores/ensureSelectionReady.test.ts`

Tasks 9 and 10 rewrote `ensureSelectionReady` to call `resolve`; this task pins **which
failures actually block Start**. The asymmetry is deliberate and is today's behaviour:
without the speaker leg a session is pointless, but without the participant leg it
still works one-way.

**Interfaces:**
- Consumes: `resolve`, `applyPrunes` from Tasks 9–10.
- Produces: `ensureSelectionReady(): Promise<{ ready: boolean; notes: ResolutionNote[] }>` on both stores — `ready` is what drives `isApiKeyValid`, and `notes` is what the UI renders instead of the generic `local*ModelsRequired` string.

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/ensureSelectionReady.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useModelStore } from './modelStore';
import useSettingsStore from './settingsStore';
import { getManifestByType } from '../lib/local-inference/modelManifest';

const downloadOnly = (ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, 'downloaded' as const]));

/** Ids that can serve ja→en for each stage in the real manifest. */
const pickIds = (stage: 'asr' | 'translation' | 'tts') => {
  if (stage === 'asr') {
    return [...getManifestByType('asr'), ...getManifestByType('asr-stream')]
      .filter((m) => m.multilingual || m.languages.includes('ja')).map((m) => m.id);
  }
  if (stage === 'tts') {
    return getManifestByType('tts')
      .filter((m) => m.multilingual || m.languages.includes('en')).map((m) => m.id);
  }
  return getManifestByType('translation').map((m) => m.id);
};

describe('ensureSelectionReady — what blocks Start', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      localInference: {
        ...useSettingsStore.getState().localInference,
        selections: {}, sourceLanguage: 'ja', targetLanguage: 'en',
      },
    });
    useModelStore.setState({ webgpuAvailable: true });
  });

  it('blocks when ASR cannot resolve, and the note names the stage', async () => {
    useModelStore.setState({ modelStatuses: downloadOnly(pickIds('translation')) });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(false);
    expect(r.notes.some((n) => n.stage === 'asr' && n.reason === 'no-candidate')).toBe(true);
  });

  it('blocks when translation cannot resolve', async () => {
    useModelStore.setState({ modelStatuses: downloadOnly(pickIds('asr')) });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(false);
    expect(r.notes.some((n) => n.stage === 'translation' && n.reason === 'no-candidate')).toBe(true);
  });

  it('does NOT block when only TTS cannot resolve — sessions degrade to subtitles', async () => {
    useModelStore.setState({
      modelStatuses: downloadOnly([...pickIds('asr'), ...pickIds('translation')]),
    });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(true);
  });

  it('does NOT block when the participant direction cannot resolve', async () => {
    // Only a ja-capable ASR is present, so en→ja has no ASR at all.
    const jaOnly = [...getManifestByType('asr')]
      .filter((m) => !m.multilingual && m.languages.includes('ja') && !m.languages.includes('en'))
      .map((m) => m.id);
    useModelStore.setState({
      modelStatuses: downloadOnly([...jaOnly, ...pickIds('translation'), ...pickIds('tts')]),
    });
    const r = await useModelStore.getState().ensureSelectionReady();
    expect(r.ready).toBe(true);
  });

  it('applies prunes found while checking, so a dead id is cleaned up once', async () => {
    useSettingsStore.setState({
      localInference: {
        ...useSettingsStore.getState().localInference,
        selections: {
          'ja→en': { asr: { modelId: 'retired-xyz' }, translation: { modelId: '' }, tts: { modelId: '' } },
        },
      },
    });
    useModelStore.setState({
      modelStatuses: downloadOnly([...pickIds('asr'), ...pickIds('translation')]),
    });
    await useModelStore.getState().ensureSelectionReady();
    expect(useSettingsStore.getState().localInference.selections['ja→en']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/stores/ensureSelectionReady.test.ts`
Expected: FAIL — `ensureSelectionReady` returns the old shape, so `r.ready` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `modelStore.ts`:

```ts
    /**
     * Decide whether Start may proceed, and collect everything worth telling the
     * user. Speaker-mandatory / participant-optional matches today's behaviour:
     * without the speaker leg a session is pointless; without the participant leg
     * it still works one-way, so that channel is simply skipped at connect time.
     * TTS never blocks — a missing voice degrades to subtitles.
     */
    ensureSelectionReady: async () => {
      const { sourceLanguage, targetLanguage } = useSettingsStore.getState().localInference;
      const speaker = get().resolve(sourceLanguage, targetLanguage);
      const participant = get().resolve(targetLanguage, sourceLanguage);

      await get().applyPrunes([...speaker.prunes, ...participant.prunes]);

      return {
        ready: Boolean(speaker.asr && speaker.translation),
        notes: [...speaker.notes, ...participant.notes],
      };
    },
```

Apply the identical body in `nativeModelStore.ts` against `localNative`. Update both
callers (`settingsStore.validateApiKey` short-circuits at `settingsStore.ts:844` and
`:876`) to read `.ready` and stash `.notes` where the UI can render them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/stores/ensureSelectionReady.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/modelStore.ts src/stores/nativeModelStore.ts src/stores/ensureSelectionReady.test.ts
git commit -m "feat(models): gate Start on the speaker leg only, and surface why"
```

---

## Final verification

- [ ] Run the full suite: `npm run test`
- [ ] Confirm no remaining references: `grep -rn "autoSelectModels\|autoSelectNative\|modelPreferences\|rememberModels\|recallModels\|getParticipantModelStatus\|translationVariantByModel" src/ --include="*.ts" --include="*.tsx"` returns nothing.
- [ ] Confirm the flat fields are gone: `grep -rn "\.asrModel\b\|\.translationModel\b\|\.ttsModel\b" src/services/providers src/stores` returns only `SessionConfig` field names (`asrModelId` etc.), not settings reads.
- [ ] Build: `npm run build`
