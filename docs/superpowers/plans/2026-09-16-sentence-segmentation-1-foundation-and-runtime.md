# Sentence Segmentation — Slice 1: Foundation and Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the punctuation/segmentation engine — a shared sentence-end rule, a pure `SentenceStream` counter/sealer, three ONNX model adapters, two worker entries and the `PunctuationRuntime` that drives them — with no client wired up yet.

**Architecture:** `sentenceEnd.ts` holds the rule (moved out of `OpenAILiveClient`). `SentenceStream` is pure main-thread logic: it counts sentences in the unsealed tail, calls a `SegmentationRuntime` only when the tail is long and unpunctuated, and seals every N sentences. `PunctuationRuntime` implements that interface over one lazily-created worker, following the `TranslationEngine` + `WorkerSession` + `RequestRegistry` pattern already in the repo. Two worker entries exist because the two ONNX Runtime bundles differ: `_shared/onnxruntime-webgpu.ts` (the `onnxruntime-web/webgpu` entry) is the only one whose sessions really run on the GPU, and `_shared/onnxruntime-all.ts` (the default wasm-only entry) is the only one whose WASM EP registers `GatherBlockQuantized`, which SaT needs.

**Tech Stack:** TypeScript, onnxruntime-web `1.26.0-dev.20260416-b7804b056c`, `@huggingface/tokenizers`, Vitest (jsdom), Zustand (slice 2).

**Spec:** `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`. Read it before Task 1; every threshold below traces to its "Risks and open questions" table.

**Slices:** this is 1 of 4. Slice 2 = settings, store and UI. Slice 3 = Local Inference and Local Native integration. Slice 4 = online providers, notice, diagnostics, analytics. Nothing in this slice is reachable by a user; its deliverable is a unit-tested library plus a benchmark entry that reproduces the measured numbers.

**Typecheck:** the repo's baseline is **not clean** — `npx tsc --noEmit` reports 319 errors across 154 files as of `6dd46986`, every one of them pre-existing and none in a file this work creates or touches. "Confirm tsc is clean" is therefore impossible to satisfy and must not be asked of anyone. The bar is **zero contribution**: run `npx tsc --noEmit` and confirm its output names none of the files your task created or modified. Tests: `npm run test -- <path>`. Both must hold before every commit.

---

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

- **English only** in all code, comments, commit messages and docs (project CLAUDE.md).
- **Clients never call `report.ts` and never `console.*`.** `PunctuationRuntime` imports **no store and no `report.ts`** — it emits events and the app layer (slice 2) forwards them. Files under `src/lib/local-inference/workers/` are exempt from the console ledger (`consoleLedger.consistency.test.ts` SKIP list includes `/[\\/]workers[\\/]/`), but nothing else in this slice may add a `console.error` / `console.warn`: unlisted files must stay at 0.
- **Nothing gets worse.** A null or disabled runtime, a missing model, a slow call or any failure must leave behaviour exactly as it is today.
- **No transcript text** in any diagnostic or analytics payload.
- **Thresholds** (do not invent others): right context **8** skeleton characters; sentences per bubble **N**, default **3**, clamped **1–5**; model gate **N × 20** characters for zh/yue/ja/ko and **N × 50** for every other language; Chinese length fallback **N × 33** characters rounded to a multiple of ten; model window **~300** characters per call; inference timeout **3 s**; latency budget **500 ms** median; disable after **3** consecutive failures or **2** worker crashes; idle unload **2 minutes**; memory guard `deviceMemory` **≤ 4** GB.
- **Model-internal thresholds stay at upstream defaults**: SaT `0.25` (strict `>`), Edge-Punct and FireRedPunc take the argmax. Nothing is refitted.
- **Hosting is an outward action.** Task 8 prepares the Hugging Face repos locally and stops. Uploading requires jiangzhuo's explicit confirmation naming `jiangzhuo9357/<repo>` at the time.

---

## File Structure

| Path | Change |
|---|---|
| `src/lib/segmentation/sentenceEnd.ts` | **new** — the shared rule, moved from `OpenAILiveClient.ts` and extended |
| `src/lib/segmentation/sentenceEnd.test.ts` | **new** — table-driven, covers every abbreviation case measured in the spec |
| `src/lib/segmentation/SegmentationRuntime.ts` | **new** — the `SegmentationRuntime` / `PunctuationResult` interfaces clients see |
| `src/lib/segmentation/SentenceStream.ts` | **new** — pure counting/gating/sealing logic |
| `src/lib/segmentation/SentenceStream.test.ts` | **new** — with a controllable fake runtime |
| `src/lib/segmentation/PunctuationRuntime.ts` | **new** — worker owner, routing, health, idle unload |
| `src/lib/segmentation/PunctuationRuntime.test.ts` | **new** — with a fake worker |
| `src/lib/segmentation/createPunctuationWorker.ts` | **new** — isolated worker factory so the runtime is unit-testable |
| `src/lib/local-inference/workers/punctuation-webgpu.worker.ts` | **new** — entry importing `_shared/onnxruntime-webgpu` |
| `src/lib/local-inference/workers/punctuation-wasm.worker.ts` | **new** — entry importing `_shared/onnxruntime-all` |
| `src/lib/local-inference/workers/_shared/punctuation-core.ts` | **new** — message router + adapter registry shared by both entries |
| `src/lib/local-inference/workers/_shared/punctuation-fireredpunc.ts` | **new** — zh adapter, ported from the benchmark |
| `src/lib/local-inference/workers/_shared/punctuation-edge-punct-en.ts` | **new** — en adapter |
| `src/lib/local-inference/workers/_shared/punctuation-sat.ts` | **new** — SaT boundary adapter |
| `src/lib/local-inference/workers/_shared/punctuation-*.test.ts` | **new** — three golden tests on canned logits, no ONNX |
| `src/lib/local-inference/modelManifest.ts` | modify — `ModelType` gains `'punctuation'`; three `MODEL_MANIFEST` entries |
| `src/lib/local-inference/modelManifest.punctuation.test.ts` | **new** — pins the three entries |
| `src/components/Settings/engine/StoragePage.tsx:300` | modify — exclude `punctuation` from the import dropdown |
| `src/services/clients/OpenAILiveClient.ts` | modify — delete the moved code, import it instead |
| `package.json` | modify — promote `@huggingface/tokenizers` to a direct dependency |
| `benchmark/punctuation-restoration/models/app-adapters.mjs` | **new** — runs the shipped adapters through the existing harness |

---

## Task 1: Move and extend the shared sentence-end rule

The three helpers in `OpenAILiveClient.ts` are pure functions of `(text, prefix)` with no `this`, and `OpenAILiveClient.test.ts` never imports them — it drives them black-box through `handleServerEvent`. So the move is mechanical and the 26 existing segmentation tests must stay green untouched.

**Files:**
- Create: `src/lib/segmentation/sentenceEnd.ts`
- Create: `src/lib/segmentation/sentenceEnd.test.ts`
- Modify: `src/services/clients/OpenAILiveClient.ts:51-61` (delete), `:88-132` (delete), imports

**Interfaces:**
- Consumes: nothing.
- Produces: `SENTENCE_TERMINALS`, `SENTENCE_CLOSERS`, `CLAUSE_MARKS`, `LEADING_PUNCT_RE`, `ABBREVIATIONS`, `periodIsNotSentenceEnd(text: string, dot: number): boolean`, `lastSentenceEnd(text: string, prefix?: string): number`, `lastClauseEnd(text: string): number`, `sentenceEnds(text: string): number[]`, `breakpoints(text: string): number[]`, `skeleton(text: string): string`, `baseLang(lang: string): string`.

- [ ] **Step 1: Write the failing test** at `src/lib/segmentation/sentenceEnd.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  periodIsNotSentenceEnd,
  lastSentenceEnd,
  lastClauseEnd,
  sentenceEnds,
  breakpoints,
  skeleton,
  baseLang,
} from './sentenceEnd';

describe('periodIsNotSentenceEnd', () => {
  // Every case here is one the spec measured Intl.Segmenter getting wrong.
  const notAnEnd: [string, number][] = [
    ['Dr. Smith will join us.', 2],
    ['I met Mr. Brown today.', 8],
    ['Use a fruit, e.g. Apple.', 16],
    ['He served in the U.S. Army.', 20],
    ['The meeting is at 2 p.m. Please be on time.', 23],
    ['Version 3.5 is out.', 9],
    ['Visit sokuji.kizuna.ai for details.', 12],
    ['Wait... What happened?', 4],
    ['J. K. Rowling wrote it.', 1],
    ['Das ist z. B. ein Test.', 9],
    ['Siehe Nr. 5 im Anhang.', 8],
    ['El Sr. García llegó ayer.', 5],
    ['A Dra. Silva chegou.', 5],
    ['Это т. е. пример.', 5],
  ];
  it.each(notAnEnd)('%s: the dot at %i is not a sentence end', (text, dot) => {
    expect(text[dot]).toBe('.');
    expect(periodIsNotSentenceEnd(text, dot)).toBe(true);
  });

  const isAnEnd: [string, number][] = [
    ['Thanks. See you.', 6],
    ['Apple Inc. Announced results.', 28],
    ['It is free. Try it.', 10],
  ];
  it.each(isAnEnd)('%s: the dot at %i ends a sentence', (text, dot) => {
    expect(text[dot]).toBe('.');
    expect(periodIsNotSentenceEnd(text, dot)).toBe(false);
  });
});

describe('lastSentenceEnd', () => {
  it('returns the index just past the terminal', () => {
    expect(lastSentenceEnd('Hello there. And then')).toBe(12);
  });
  it('includes closing quotes and brackets', () => {
    expect(lastSentenceEnd('He said "go.") Then')).toBe(14);
  });
  it('judges a word split across deltas on the whole word', () => {
    expect(lastSentenceEnd('. Andrew', 'Dr')).toBe(-1);
  });
  it('returns -1 with no terminal', () => {
    expect(lastSentenceEnd('no terminal here')).toBe(-1);
  });
});

describe('lastClauseEnd', () => {
  it('returns the index just past the last clause mark', () => {
    expect(lastClauseEnd('one, two; three')).toBe(9);
  });
  it('returns -1 with no clause mark', () => {
    expect(lastClauseEnd('nothing here')).toBe(-1);
  });
});

describe('sentenceEnds', () => {
  it('lists every sentence end in order, closers included', () => {
    expect(sentenceEnds('One. Two? Three!')).toEqual([4, 9, 16]);
  });
  it('skips abbreviation dots', () => {
    expect(sentenceEnds('Dr. Smith spoke. Then left.')).toEqual([16, 27]);
  });
  it('handles CJK terminals', () => {
    expect(sentenceEnds('你好。世界！')).toEqual([3, 6]);
  });
  it('is empty for unpunctuated text', () => {
    expect(sentenceEnds('这是一段没有标点的文字')).toEqual([]);
  });
});

describe('breakpoints', () => {
  it('merges sentence ends and clause marks in order', () => {
    expect(breakpoints('One, two. Three')).toEqual([4, 9]);
  });
  it('includes CJK commas', () => {
    expect(breakpoints('你好，世界。')).toEqual([3, 6]);
  });
});

describe('skeleton', () => {
  it('keeps letters and digits, lowercased, and drops everything else', () => {
    expect(skeleton('Hello, World! 42')).toBe('helloworld42');
  });
  it('keeps CJK characters', () => {
    expect(skeleton('你好，世界。')).toBe('你好世界');
  });
  it('is case-insensitive so a model that recases still matches', () => {
    expect(skeleton('i think so')).toBe(skeleton('I think so.'));
  });
});

describe('baseLang', () => {
  it.each([
    ['zh', 'zh'],
    ['zh-CN', 'zh'],
    ['cmn-CN', 'zh'],
    ['yue', 'yue'],
    ['en-US', 'en'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(baseLang(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/lib/segmentation/sentenceEnd.test.ts`
Expected: FAIL — `Failed to resolve import "./sentenceEnd"`.

- [ ] **Step 3: Create the module, moving the code verbatim first**

Create `src/lib/segmentation/sentenceEnd.ts`. Copy `SENTENCE_TERMINALS`, `SENTENCE_CLOSERS`, `ABBREVIATIONS`, `CLAUSE_MARKS` and `LEADING_PUNCT_RE` from `OpenAILiveClient.ts:51-61`, and `periodIsNotSentenceEnd` / `lastSentenceEnd` / `lastClauseEnd` from `:88-132`, changing only `const`/`function` to `export const`/`export function`. Keep the existing doc comments. Then extend as shown:

```typescript
/**
 * The shared sentence-end rule.
 *
 * Moved out of OpenAILiveClient, which had the only copy: the segmentation
 * stage, the online providers and the local pipeline all have to agree on
 * where a sentence ends, and Intl.Segmenter cannot be that agreement — it
 * finds no boundary at all in unpunctuated text and splits after every
 * abbreviation followed by a capital (measured in the design's Problem
 * section). splitSentences.ts keeps using Intl.Segmenter for TTS chunking,
 * where the only cost of a wrong cut is an extra pause.
 */

/** Marks that can end a sentence. */
export const SENTENCE_TERMINALS = '。．！？!?.';
/** Quotes and brackets that belong to the sentence they close. */
export const SENTENCE_CLOSERS = '"\'”’」』）)]';
/** Marks a long item may be cut at when no sentence end comes. */
export const CLAUSE_MARKS = ',，、;；:：—–';
/** Punctuation and whitespace at the head of a delta belong to the text before it. */
export const LEADING_PUNCT_RE = /^[\s。．！？!?.,，、;；:：—–"'”’」』）)\]]+/;

/**
 * Words whose trailing period is not a sentence end (lower-case, inner dots kept).
 *
 * The English rows are the original OpenAILiveClient set. The rest cover the
 * de/fr/es/pt/ru/it abbreviations the design measured Intl.Segmenter splitting
 * on. Single letters are listed where the language writes them lower-case
 * (German "z. B.", Russian "т. е."); an upper-case single letter is already
 * handled as an initial below.
 */
export const ABBREVIATIONS = new Set([
  // English (unchanged)
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'bros',
  'fig', 'vol', 'al', 'e.g', 'i.e', 'a.m', 'p.m', 'u.s', 'u.k',
  // German
  'nr', 'bzw', 'ca', 'usw', 'z', 'b', 'd.h', 'u.a', 'evtl', 'ggf', 'abb', 'bspw',
  // French
  'mme', 'mlle', 'cf', 'env', 'av', 'apr', 'p.ex',
  // Spanish and Portuguese
  'sra', 'srta', 'dra', 'ud', 'uds', 'núm', 'pág',
  // Russian
  'т', 'е', 'др', 'тыс', 'руб', 'см', 'стр', 'г', 'гг',
  // Italian
  'sig', 'dott', 'ing', 'avv',
]);

/** True when the period at `dot` is part of an abbreviation, an initial, a
 *  decimal or a dotted token (e.g., U.S., example.com) rather than a sentence end. */
export function periodIsNotSentenceEnd(text: string, dot: number): boolean {
  const next = text[dot + 1];
  if (next !== undefined && /[A-Za-z0-9]/.test(next)) return true; // 3.5, e.g, U.S, a.b
  if (next === '.' || text[dot - 1] === '.') return true; // an ellipsis is a pause, not an end
  if (next === ',' || next === ';' || next === ':') return true; // "Co., Ltd": the clause goes on
  if (next !== undefined && /\s/.test(next) && /^\s+[a-z]/.test(text.slice(dot + 1))) return true; // "no. then"
  let start = dot;
  // \p{L} rather than [A-Za-z] so a Cyrillic or accented abbreviation is read
  // as one word. The forward check above stays ASCII on purpose: widening it
  // would make a period between two CJK characters stop ending a sentence,
  // which is a behaviour change GPT-Live never asked for.
  while (start > 0 && /[\p{L}.]/u.test(text[start - 1])) start--;
  const word = text.slice(start, dot).replace(/^\.+/, '');
  if (word.length === 0) return false;
  if (word.length === 1 && /[A-Z]/.test(word)) return true; // an initial: "J. Smith"
  return ABBREVIATIONS.has(word.toLowerCase());
}
```

Keep `lastSentenceEnd` and `lastClauseEnd` byte-identical to the originals apart from `export`. Then append the new helpers:

```typescript
/**
 * Offsets just past every sentence end in `text`, in order, closers included.
 * The forward twin of lastSentenceEnd, which only reports the last one.
 */
export function sentenceEnds(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!SENTENCE_TERMINALS.includes(ch)) continue;
    if (ch === '.' && periodIsNotSentenceEnd(text, i)) continue;
    let end = i + 1;
    while (end < text.length && SENTENCE_CLOSERS.includes(text[end])) end++;
    out.push(end);
    i = end - 1;
  }
  return out;
}

/** Offsets just past every sentence end or clause mark, in order. */
export function breakpoints(text: string): number[] {
  const ends = new Set(sentenceEnds(text));
  for (let i = 0; i < text.length; i++) {
    if (CLAUSE_MARKS.includes(text[i])) ends.add(i + 1);
  }
  return [...ends].sort((a, b) => a - b);
}

/**
 * Letters and digits only, lower-cased.
 *
 * Two jobs. It is the identity a punctuation model must preserve — every model
 * rewrites spacing (FireRedPunc re-derives it from an ASCII rule, Edge-Punct
 * collapses runs to single spaces) and two of them recase, so the invariant has
 * to ignore both. And it is the anchor a rewritten ASR partial is realigned
 * against, since punctuation and spacing are exactly what a rewrite churns.
 */
export function skeleton(text: string): string {
  let out = '';
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) out += ch.toLowerCase();
  }
  return out;
}

/**
 * The base language tag used for model routing.
 *
 * Production language codes are fragmented — PostHog shows zh, zh-CN, cmn-CN
 * and zh_CN all in use for the same language — so everything downstream keys
 * off this, never off the raw setting.
 */
export function baseLang(lang: string): string {
  const base = lang.toLowerCase().replace(/[_-].*$/, '');
  return base === 'cmn' ? 'zh' : base;
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npm run test -- src/lib/segmentation/sentenceEnd.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Switch OpenAILiveClient to the import and prove it is unchanged**

In `src/services/clients/OpenAILiveClient.ts`, delete lines 51–61 (the five constants, keeping the doc comment block at 42–50 above `SENTENCE_TERMINALS` — move that comment with the constants or leave it as a pointer) and lines 88–132 (the three functions). Add to the import block at the top of the file:

```typescript
import {
  SENTENCE_TERMINALS,
  SENTENCE_CLOSERS,
  CLAUSE_MARKS,
  LEADING_PUNCT_RE,
  periodIsNotSentenceEnd,
  lastSentenceEnd,
  lastClauseEnd,
} from '../../lib/segmentation/sentenceEnd';
```

`SENTENCE_TERMINALS`, `SENTENCE_CLOSERS`, `CLAUSE_MARKS` and `periodIsNotSentenceEnd` are referenced only from inside the moved functions, so after the move they may be unused in this file — delete them from the import list if `tsc` says so. `LEADING_PUNCT_RE` is used at `:779` and `:822` and must stay.

- [ ] **Step 6: Run the client tests and the typecheck**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts && npx tsc --noEmit`
Expected: PASS — all 26 tests in `describe('OpenAILiveClient source segmentation')` (line 501) and `describe('OpenAILiveClient sentence segmentation')` (line 602) still green, because they only ever call `handleServerEvent`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/segmentation/sentenceEnd.ts src/lib/segmentation/sentenceEnd.test.ts src/services/clients/OpenAILiveClient.ts
git commit -m "refactor(segmentation): move the sentence-end rule into a shared module"
```

---

## Task 2: The `SegmentationRuntime` interface

A separate, dependency-free module so clients and `SentenceStream` can import the type without pulling in the worker.

**Files:**
- Create: `src/lib/segmentation/SegmentationRuntime.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SegmentationRuntime`, `PunctuationResult`, `PunctuationModelId`.

- [ ] **Step 1: Create the module** (no test — it is types only; Task 3 consumes it)

```typescript
/**
 * What a client sees of the segmentation stage.
 *
 * Deliberately one method and one flag. Clients never construct a runtime,
 * never import a store, and never learn which model ran: a client that
 * receives null, or a disabled runtime, behaves exactly as it does today.
 */

export type PunctuationModelId = 'fireredpunc' | 'edge-punct-en' | 'sat-3l-sm';

export interface PunctuationResult {
  /** The input's characters with marks inserted. SaT emits no marks, so its
   *  adapter writes one terminal at each predicted boundary. */
  text: string;
  /** Offsets into `text`, just past each sentence end, per the model's own
   *  counting rule (Edge-Punct: its periods; SaT: its boundaries;
   *  FireRedPunc: 。！？ plus a `.` that periodIsNotSentenceEnd rejects). */
  sentenceEnds: number[];
  /** Sentence ends plus commas. */
  breakpoints: number[];
  model: PunctuationModelId;
}

export interface SegmentationRuntime {
  /** False when the user switched the feature off. A disabled runtime never
   *  seals and never downloads. */
  readonly enabled: boolean;
  /**
   * Punctuate one tail. Resolves to null — never rejects — whenever the stage
   * cannot help: model not downloaded, still loading, disabled for the
   * session after repeated failures, timed out, or the device is too small.
   * The caller then behaves as if there were no model at all.
   */
  punctuate(
    lang: string,
    text: string,
    opts?: { signal?: AbortSignal },
  ): Promise<PunctuationResult | null>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/segmentation/SegmentationRuntime.ts
git commit -m "feat(segmentation): add the SegmentationRuntime interface"
```

---

## Task 3: `SentenceStream` — counting, gating, sealing

The whole product decision lives here, and it is pure: no worker, no store, no DOM. Slice 3 hands it a real runtime; this task proves it against a fake one.

**Files:**
- Create: `src/lib/segmentation/SentenceStream.ts`
- Create: `src/lib/segmentation/SentenceStream.test.ts`

**Interfaces:**
- Consumes: `sentenceEnds`, `breakpoints`, `skeleton`, `baseLang` from `./sentenceEnd`; `SegmentationRuntime`, `PunctuationResult` from `./SegmentationRuntime`.
- Produces: `SentenceStream` (methods `update`, `setLanguage`, `end`, `dispose`, `confirmedBoundary`), `SentenceStreamOptions`, `SealedChunk`, and the constants `RIGHT_CONTEXT_CHARS`, `MAX_MODEL_CHARS`, `gateChars(lang, n)`, `zhFallbackChars(n)`.

`confirmedBoundary(): number` returns the latest counted sentence end in the current tail, or −1. It is side-effect free, and slice 4 uses it to land GPT-Live's hard span cap on a real boundary instead of mid-word.

- [ ] **Step 1: Write the failing test** at `src/lib/segmentation/SentenceStream.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SentenceStream, type SealedChunk } from './SentenceStream';
import type { PunctuationResult, SegmentationRuntime } from './SegmentationRuntime';

/** A runtime whose every answer the test writes by hand. */
function fakeRuntime(answers: Record<string, PunctuationResult | null>) {
  const calls: string[] = [];
  const runtime: SegmentationRuntime = {
    enabled: true,
    async punctuate(_lang, text) {
      calls.push(text);
      return answers[text] ?? null;
    },
  };
  return { runtime, calls };
}

/** Build a PunctuationResult from text whose marks are already in place. */
function resultOf(text: string, ends: number[], breaks: number[] = ends): PunctuationResult {
  return { text, sentenceEnds: ends, breakpoints: breaks, model: 'fireredpunc' };
}

/**
 * Yield to the macrotask queue, which drains every pending microtask first.
 *
 * `vi.waitFor` runs its callback synchronously and returns immediately if it
 * already passes, so `await vi.waitFor(() => expect(seals).toEqual([]))` on an
 * array that is already empty proves nothing: it resolves before the model's
 * answer could possibly arrive. Every assertion that something did NOT happen
 * must come after a real yield instead.
 */
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

describe('SentenceStream gating', () => {
  it('never calls the model for a short tail', async () => {
    const { runtime, calls } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('太短了');
    await vi.waitFor(() => expect(calls).toEqual([]));
  });

  it('never calls the model when the tail already has a terminal', async () => {
    const { runtime, calls } = fakeRuntime({});
    const seals: SealedChunk[] = [];
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    // Three sentences, each followed by enough right context.
    stream.update('第一句话。第二句话。第三句话。后面还有很多很多很多字');
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(calls).toEqual([]);
    expect(seals[0].reason).toBe('sentences');
    expect(seals[0].text).toBe('第一句话。第二句话。第三句话。');
  });

  it('calls the model once the unpunctuated tail could hold N sentences', async () => {
    const tail = '这是一段没有任何标点的中文文字总共超过六十个字符所以应当触发模型调用我们继续往下写够长度为止真的够了吗还差一点点现在够了';
    const { runtime, calls } = fakeRuntime({ [tail]: null });
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update(tail);
    await vi.waitFor(() => expect(calls).toEqual([tail]));
  });

  it('uses the 50-character-per-sentence gate for non-CJK languages', async () => {
    const { runtime, calls } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('a'.repeat(149));
    await vi.waitFor(() => expect(calls).toEqual([]));
    stream.update('a'.repeat(150));
    await vi.waitFor(() => expect(calls.length).toBe(1));
  });
});

describe('SentenceStream sealing', () => {
  it('seals at the Nth sentence end for N = 1, 3 and 5', async () => {
    for (const n of [1, 3, 5]) {
      const seals: SealedChunk[] = [];
      const { runtime } = fakeRuntime({});
      const stream = new SentenceStream({
        lang: 'en', runtime, sentencesPerChunk: n, onSeal: (c) => seals.push(c), onPending: () => {},
      });
      const text = Array.from({ length: 6 }, (_, i) => `Sentence number ${i + 1}.`).join(' ');
      stream.update(text);
      await vi.waitFor(() => expect(seals.length).toBeGreaterThan(0));
      const sealedSentences = seals[0].text.match(/\./g)?.length ?? 0;
      expect(sealedSentences).toBe(n);
    }
  });

  it('does not trust a mark at the very end of the tail', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('One complete sentence.');
    await vi.waitFor(() => expect(seals).toEqual([]));
    stream.update('One complete sentence. And more words after it');
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('One complete sentence.');
  });

  it('seals Chinese at the last comma once the tail is N x 33 characters', async () => {
    const seals: SealedChunk[] = [];
    // 12 comma-separated clauses of 8 characters (96) plus an 18-character
    // tail = 114, past zhFallbackChars(3) = 100, with no sentence-final mark
    // anywhere and a runtime that declines.
    const tail = '第一段内容很长，'.repeat(12) + '第七段内容仍然没有句号而且继续写下去';
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'zh', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(tail);
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].reason).toBe('length');
    expect(seals[0].text.endsWith('，')).toBe(true);
    expect(seals[0].text.length).toBe(96);
  });

  it('does not apply the Chinese length fallback to Japanese', async () => {
    const seals: SealedChunk[] = [];
    // 123 characters, past zhFallbackChars(3) = 100, and still carrying 、 —
    // so if 'ja' were ever added to LENGTH_FALLBACK_LANGS this test would
    // fail. At 74 characters it could not, because the length guard returned
    // before the language was ever consulted.
    const tail = 'これは長い日本語の文章です、'.repeat(8) + '句点がないまま続きます';
    const { runtime } = fakeRuntime({ [tail]: null });
    const stream = new SentenceStream({
      lang: 'ja', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(tail);
    await vi.waitFor(() => expect(seals).toEqual([]));
  });

  it('reads N when the stream is created, so a setting change never cuts mid-bubble', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 5, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('One. Two. Three. Four. and the tail keeps going here');
    await vi.waitFor(() => expect(seals).toEqual([]));
  });
});

describe('SentenceStream model results', () => {
  it('seals with the inserted punctuation and leaves the remainder raw', async () => {
    // 162 characters, so it clears the English gate at N = 3 (3 x 50 = 150).
    const raw = 'first sentence here second sentence here third sentence here and then the tail continues for a good while longer without any punctuation at all and it keeps going';
    const punctuated = 'First sentence here. Second sentence here. Third sentence here. and then the tail continues for a good while longer without any punctuation at all and it keeps going';
    const ends = [20, 42, 63];
    const seals: SealedChunk[] = [];
    const pendings: string[] = [];
    const { runtime } = fakeRuntime({ [raw]: resultOf(punctuated, ends) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3,
      onSeal: (c) => seals.push(c), onPending: (t) => pendings.push(t),
    });
    stream.update(raw);
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('First sentence here. Second sentence here. Third sentence here.');
    expect(seals[0].reason).toBe('sentences');
    // The tail is shown raw, with no provisional marks.
    expect(pendings[pendings.length - 1]).toBe(' and then the tail continues for a good while longer without any punctuation at all and it keeps going');
  });

  it('discards a result whose skeleton differs from the input', async () => {
    const raw = 'a'.repeat(160);
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({ [raw]: resultOf('completely different text.', [26]) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(raw);
    await vi.waitFor(() => expect(seals).toEqual([]));
  });

  it('accepts a result that only recases and respaces', async () => {
    // Over 100 characters, so it clears the English gate at N = 2 (2 x 50).
    const raw = 'i think so we should go now and then some more text follows here to push this tail past the hundred character gate';
    const punctuated = 'I think so. We should go now. and then some more text follows here to push this tail past the hundred character gate';
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({ [raw]: resultOf(punctuated, [11, 29]) });
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 2, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update(raw);
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('I think so. We should go now.');
  });

  it('coalesces updates: one call in flight, latest wins', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const calls: string[] = [];
    const runtime: SegmentationRuntime = {
      enabled: true,
      async punctuate(_lang, text) { calls.push(text); await gate; return null; },
    };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('a'.repeat(150));
    stream.update('a'.repeat(160));
    stream.update('a'.repeat(170));
    expect(calls).toEqual(['a'.repeat(150)]);
    release();
    await vi.waitFor(() => expect(calls).toEqual(['a'.repeat(150), 'a'.repeat(170)]));
  });

  it('sends at most MAX_MODEL_CHARS to the model', async () => {
    const calls: string[] = [];
    const runtime: SegmentationRuntime = {
      enabled: true,
      async punctuate(_lang, text) { calls.push(text); return null; },
    };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: () => {}, onPending: () => {},
    });
    stream.update('a'.repeat(900));
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].length).toBeLessThanOrEqual(300);
  });
});

describe('SentenceStream rewrites and re-anchoring', () => {
  it('never un-seals when the ASR rewrites the tail after a seal', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    // The word after the period is capitalised on purpose: sentenceEnd.ts
    // treats "sentence. and" as a mid-sentence dot ("no. then"), so a
    // lower-case continuation would give the rule nothing to count.
    stream.update('First sentence. And the tail goes on');
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('First sentence.');
    // update() carries the text SINCE the last seal, so the client now sends
    // the rewritten remainder. The seal already emitted must not move.
    stream.update(' And the tail went on a bit further than that');
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0].text).toBe('First sentence.');
  });

  it('discards a model answer whose input is no longer a prefix of the tail', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const seals: SealedChunk[] = [];
    const runtime: SegmentationRuntime = {
      enabled: true,
      async punctuate(_lang, text) {
        await gate;
        return { text: `${text}.`, sentenceEnds: [text.length + 1], breakpoints: [], model: 'fireredpunc' };
      },
    };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('a'.repeat(150));
    // The tail is rewritten from the start while the call is in flight.
    stream.update('b'.repeat(150));
    release();
    await vi.waitFor(() => expect(seals).toEqual([]));
  });

  it('confirmedBoundary reports the latest counted end, and -1 when there is none', () => {
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 5, onSeal: () => {}, onPending: () => {},
    });
    expect(stream.confirmedBoundary()).toBe(-1);
    // Capitalised continuations, for the same reason as the test above.
    stream.update('One. Two. And then a good deal more text after it');
    expect(stream.confirmedBoundary()).toBe(9);
    // A mark at the very end of the tail is not confirmed. The one before it
    // is — but only because the closing sentence is long enough to supply the
    // 8 skeleton characters the right-context rule demands. In 'One. Two.
    // Three.' the mark at 9 would fail too, since 'three' is only 5.
    stream.update('One. Two. Three sentences here.');
    expect(stream.confirmedBoundary()).toBe(9);
  });
});

describe('SentenceStream end and disposal', () => {
  it('emits the remainder as a final chunk, ignoring the right-context rule', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('Just one short sentence.');
    stream.end();
    await vi.waitFor(() => expect(seals.length).toBe(1));
    expect(seals[0]).toEqual({ text: 'Just one short sentence.', reason: 'end' });
  });

  it('emits nothing for an empty stream', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 3, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.end();
    expect(seals).toEqual([]);
  });

  it('never seals with a null runtime, and still reports the pending text', async () => {
    const seals: SealedChunk[] = [];
    const pendings: string[] = [];
    const stream = new SentenceStream({
      lang: 'en', runtime: null, sentencesPerChunk: 1,
      onSeal: (c) => seals.push(c), onPending: (t) => pendings.push(t),
    });
    stream.update('One. Two. Three. Four. Five. Six.');
    await vi.waitFor(() => expect(pendings.length).toBe(1));
    expect(seals).toEqual([]);
    stream.end();
    expect(seals).toEqual([]);
  });

  it('never seals with a disabled runtime', async () => {
    const seals: SealedChunk[] = [];
    const runtime: SegmentationRuntime = { enabled: false, async punctuate() { return null; } };
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.update('One. Two. Three. Four. Five. Six.');
    stream.end();
    await vi.waitFor(() => expect(seals).toEqual([]));
  });

  it('emits nothing after dispose', async () => {
    const seals: SealedChunk[] = [];
    const { runtime } = fakeRuntime({});
    const stream = new SentenceStream({
      lang: 'en', runtime, sentencesPerChunk: 1, onSeal: (c) => seals.push(c), onPending: () => {},
    });
    stream.dispose();
    stream.update('One. Two. Three. and more text');
    stream.end();
    await vi.waitFor(() => expect(seals).toEqual([]));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/lib/segmentation/SentenceStream.test.ts`
Expected: FAIL — `Failed to resolve import "./SentenceStream"`.

- [ ] **Step 3: Implement `SentenceStream`**

```typescript
import {
  sentenceEnds as ruleSentenceEnds,
  breakpoints as ruleBreakpoints,
  skeleton,
  baseLang,
} from './sentenceEnd';
import type { PunctuationResult, SegmentationRuntime } from './SegmentationRuntime';

/**
 * Skeleton characters that must follow a sentence end before it is counted.
 *
 * Every model marks the end of its input as a sentence end — measured on all
 * three — so the last mark in a growing tail is never trustworthy. Precision
 * stopped improving past 8 in the streaming tables at R = 0/4/8/16, at a
 * commit lag of 9-14 characters.
 */
export const RIGHT_CONTEXT_CHARS = 8;

/**
 * The most characters handed to a model in one call.
 *
 * SaT degrades past 510 subwords (511 -> 984 ms, 1,020 -> 4.5 s), FireRedPunc
 * caps at 512 tokens and Edge-Punct at 200 pieces per row. 300 characters is
 * comfortably inside all three.
 */
export const MAX_MODEL_CHARS = 300;

/** Average sentence length per language, from the corpus: ja 19, zh 22, ko 16,
 *  en 40, fr/de/es/pt/ru 36-38. Rounded into two buckets. */
const CJK_CHARS_PER_SENTENCE = 20;
const DEFAULT_CHARS_PER_SENTENCE = 50;
const CJK_LANGS = new Set(['zh', 'yue', 'ja', 'ko']);

/** Languages that get the length fallback. Japanese is deliberately absent:
 *  the fallback exists because FireRedPunc under-emits sentence ends, and
 *  Japanese does not route to FireRedPunc. */
const LENGTH_FALLBACK_LANGS = new Set(['zh', 'yue']);

/** FireRedPunc emits only 62% of the reference sentence ends, so N detected
 *  sentences are roughly 1.6 x N real ones; 33 characters per sentence is that
 *  ratio applied to the 22-character Chinese average, rounded to a ten. */
const FALLBACK_CHARS_PER_SENTENCE = 33;

/** The tail is long enough to hold `n` sentences of this language. */
export function gateChars(lang: string, n: number): number {
  const per = CJK_LANGS.has(baseLang(lang)) ? CJK_CHARS_PER_SENTENCE : DEFAULT_CHARS_PER_SENTENCE;
  return n * per;
}

/** The Chinese length fallback threshold for `n` sentences. */
export function zhFallbackChars(n: number): number {
  return Math.round((n * FALLBACK_CHARS_PER_SENTENCE) / 10) * 10;
}

export interface SealedChunk {
  text: string;
  reason: 'sentences' | 'length' | 'end';
}

export interface SentenceStreamOptions {
  lang: string;
  /** null or disabled means no sealing at all — today's behaviour. */
  runtime: SegmentationRuntime | null;
  /** How many sentences fill a bubble. Read once, here, so changing the
   *  setting applies to the next stream and never cuts an open bubble. */
  sentencesPerChunk: number;
  /** Text up to the seal, carrying whatever punctuation was inserted. */
  onSeal(chunk: SealedChunk): void;
  /** The unsealed tail, raw. Never carries provisional marks: they would
   *  flicker as the ASR rewrites. */
  onPending(text: string): void;
}

export class SentenceStream {
  private readonly opts: SentenceStreamOptions;
  private lang: string;
  private readonly n: number;
  /** The unsealed tail exactly as the client last gave it. */
  private pending = '';
  private inFlight = false;
  /** The newest tail seen while a call was in flight; latest wins. */
  private queued: string | null = null;
  private disposed = false;
  /** Skeleton of the text last handed to the model, so a stale answer is
   *  recognised even after the ASR rewrote the tail. */
  private inFlightSkeleton = '';

  constructor(opts: SentenceStreamOptions) {
    this.opts = opts;
    this.lang = opts.lang;
    this.n = Math.min(5, Math.max(1, Math.round(opts.sentencesPerChunk)));
  }

  setLanguage(lang: string): void {
    this.lang = lang;
  }

  update(fullText: string): void {
    if (this.disposed) return;
    this.pending = fullText;
    this.opts.onPending(fullText);
    this.evaluate();
  }

  end(): void {
    // active(), not just disposed: update() records the pending text before
    // it checks whether the stage is on, so a null or disabled runtime would
    // otherwise still emit a final chunk — and "no runtime" must mean no
    // sealing at all, including this one.
    if (!this.active()) return;
    const tail = this.pending;
    this.pending = '';
    this.queued = null;
    if (tail.length > 0) this.opts.onSeal({ text: tail, reason: 'end' });
  }

  dispose(): void {
    this.disposed = true;
    this.pending = '';
    this.queued = null;
  }

  // ----- internals -----

  private active(): boolean {
    return !this.disposed && !!this.opts.runtime && this.opts.runtime.enabled;
  }

  private evaluate(): void {
    if (!this.active()) return;
    const tail = this.pending;
    if (tail.length === 0) return;

    // Existing punctuation is authoritative: count it and never call a model.
    const ends = ruleSentenceEnds(tail);
    if (ends.length > 0) {
      this.sealFromRule(tail, ends);
      return;
    }

    if (tail.length >= gateChars(this.lang, this.n)) this.callModel(tail);
    // No length fallback here. The spec conditions it on "fewer than N
    // sentence ends", which is a fact only the model's answer establishes, so
    // it belongs on the paths that know that answer: applyResult when a
    // result arrives, and onResult when one never usefully does. Firing it
    // here as well would seal at a comma in the same tick the model was
    // asked, guaranteeing its answer is discarded as stale.
  }

  /** Count the marks already in the tail and seal if there are enough. */
  private sealFromRule(tail: string, ends: number[]): void {
    const counted = ends.filter((e) => this.hasRightContext(tail, e));
    if (counted.length >= this.n) {
      this.seal(tail.slice(0, counted[this.n - 1]), tail.slice(counted[this.n - 1]), 'sentences');
      return;
    }
    this.tryLengthFallback(tail, counted.length);
  }

  private hasRightContext(text: string, offset: number): boolean {
    return skeleton(text.slice(offset)).length >= RIGHT_CONTEXT_CHARS;
  }

  /** zh and yue only: a very long tail with too few sentence ends seals at the
   *  latest confirmed comma rather than growing without bound. */
  private tryLengthFallback(tail: string, countedEnds: number): void {
    if (!LENGTH_FALLBACK_LANGS.has(baseLang(this.lang))) return;
    if (countedEnds >= this.n) return;
    if (tail.length < zhFallbackChars(this.n)) return;
    const marks = ruleBreakpoints(tail).filter((b) => this.hasRightContext(tail, b));
    if (marks.length === 0) return;
    const at = marks[marks.length - 1];
    this.seal(tail.slice(0, at), tail.slice(at), 'length');
  }

  private callModel(tail: string): void {
    if (this.inFlight) {
      this.queued = tail;
      return;
    }
    const window = tail.length > MAX_MODEL_CHARS ? tail.slice(tail.length - MAX_MODEL_CHARS) : tail;
    // Only the window is sent, but the prefix it drops is kept so the seal can
    // be expressed against the whole tail.
    const dropped = tail.length - window.length;
    this.inFlight = true;
    this.inFlightSkeleton = skeleton(window);
    const runtime = this.opts.runtime!;
    runtime
      .punctuate(this.lang, window)
      .then((result) => this.onResult(window, dropped, result))
      .catch(() => this.onResult(window, dropped, null));
  }

  private onResult(input: string, dropped: number, result: PunctuationResult | null): void {
    this.inFlight = false;
    const next = this.queued;
    this.queued = null;

    const applied = !this.disposed && result
      ? this.applyResult(input, dropped, result)
      : false;
    // The model declined, or its answer was stale or failed the skeleton
    // invariant. The tail is still unpunctuated and still growing, so the
    // length backstop is the only thing left that can seal it.
    if (!applied && !this.disposed) this.tryLengthFallback(this.pending, 0);

    if (next !== null && this.active() && this.pending.length > 0) this.evaluate();
  }

  /** True when this answer was usable and the counting decision was made from
   *  it — false when it was stale or malformed, so the caller knows the tail
   *  still has nobody deciding for it. */
  private applyResult(input: string, dropped: number, result: PunctuationResult): boolean {
    // A stale answer: the tail no longer starts with what was sent.
    const tail = this.pending;
    const sentSkeleton = this.inFlightSkeleton;
    const tailSkeleton = skeleton(tail.slice(dropped));
    if (!tailSkeleton.startsWith(sentSkeleton)) return false;

    // The output invariant. Every model rewrites spacing and two of them
    // recase, so only letters and digits, lower-cased, may be compared.
    if (skeleton(result.text) !== skeleton(input)) return false;

    const counted = result.sentenceEnds.filter((e) => this.hasRightContext(result.text, e));
    if (counted.length >= this.n) {
      const cut = counted[this.n - 1];
      const sealedText = result.text.slice(0, cut);
      const rawCut = this.rawOffsetFor(input, skeleton(sealedText).length);
      this.seal(tail.slice(0, dropped) + sealedText, tail.slice(dropped + rawCut), 'sentences');
      return true;
    }
    this.tryLengthFallback(tail, counted.length);
    return true;
  }

  /**
   * The offset in `raw` whose prefix holds `skeletonLength` skeleton
   * characters. This is how a cut chosen in the model's output — which has
   * different spacing and possibly different case — is mapped back onto the
   * characters the ASR actually produced.
   */
  private rawOffsetFor(raw: string, skeletonLength: number): number {
    if (skeletonLength === 0) return 0;
    let seen = 0;
    for (let i = 0; i < raw.length; i++) {
      if (/[\p{L}\p{N}]/u.test(raw[i])) {
        seen++;
        if (seen === skeletonLength) return i + 1;
      }
    }
    return raw.length;
  }

  private seal(sealed: string, remainder: string, reason: SealedChunk['reason']): void {
    if (this.disposed || sealed.length === 0) return;
    this.pending = remainder;
    this.opts.onSeal({ text: sealed, reason });
    this.opts.onPending(remainder);
  }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test -- src/lib/segmentation/SentenceStream.test.ts && npx tsc --noEmit`
Expected: PASS. If a seal offset is off by one in the fixture expectations, fix the fixture, not the right-context rule — the rule is measured.

- [ ] **Step 5: Commit**

```bash
git add src/lib/segmentation/SentenceStream.ts src/lib/segmentation/SentenceStream.test.ts
git commit -m "feat(segmentation): add SentenceStream counting, gating and sealing"
```

---

## Task 4: Worker protocol and the adapter contract

Both worker entries share one router and one adapter shape; only the ONNX Runtime import differs. This task creates the shared core with no adapter registered yet, so the two entries in Task 8 are three lines each.

**Files:**
- Create: `src/lib/local-inference/workers/_shared/punctuation-core.ts`

**Interfaces:**
- Consumes: `PunctuationModelId`, `PunctuationResult` from `src/lib/segmentation/SegmentationRuntime`.
- Produces: `PunctuationInitMessage`, `PunctuationRunMessage`, `PunctuationUnloadMessage`, `PunctuationDisposeMessage`, `PunctuationWorkerInbound`, `PunctuationWorkerOutbound`, `PunctuationAdapter`, `PunctuationAdapterDeps`, `installPunctuationWorker(deps)`.

- [ ] **Step 1: Create the module**

```typescript
/**
 * The half of the punctuation worker that does not know which onnxruntime-web
 * bundle it is running in.
 *
 * Two entries exist because the two bundles are not interchangeable: only
 * `onnxruntime-web/webgpu` really runs a session on the GPU (the default entry
 * silently returns garbage for executionProviders: ['webgpu']), and only the
 * default entry's WASM EP registers GatherBlockQuantized, which SaT's
 * 8-bit embedding needs. A WebGPU failure therefore has to recreate the
 * worker with the other entry rather than fall back inside one.
 */
import type { PunctuationModelId, PunctuationResult } from '../../../segmentation/SegmentationRuntime';

export interface PunctuationInitMessage {
  type: 'load';
  id: string;
  model: PunctuationModelId;
  /** filename -> blob URL, straight from ModelManager.getModelBlobUrls(). */
  fileUrls: Record<string, string>;
  /** Absolute URL of /wasm/ort/ for ort.env.wasm.wasmPaths. */
  ortWasmBaseUrl: string;
  /** Pinned deliberately: Edge-Punct's int8 logits are not bit-identical
   *  across thread counts, and a flipped word is a visible wrong capital. */
  numThreads: number;
}

export interface PunctuationRunMessage {
  type: 'run';
  id: string;
  model: PunctuationModelId;
  text: string;
}

export interface PunctuationUnloadMessage { type: 'unload'; id: string; model: PunctuationModelId }
export interface PunctuationDisposeMessage { type: 'dispose' }

export type PunctuationWorkerInbound =
  | PunctuationInitMessage
  | PunctuationRunMessage
  | PunctuationUnloadMessage
  | PunctuationDisposeMessage;

export type PunctuationWorkerOutbound =
  | { type: 'ready'; loadTimeMs: number; device: 'webgpu' | 'wasm' }
  | { type: 'loaded'; id: string; model: PunctuationModelId; loadTimeMs: number; device: 'webgpu' | 'wasm' }
  | { type: 'result'; id: string; result: PunctuationResult; inferenceMs: number }
  | { type: 'unloaded'; id: string }
  | { type: 'error'; id?: string; error: string }
  | { type: 'disposed' };

/** What the core hands an adapter at load time. */
export interface PunctuationAdapterDeps {
  /** Either bundle's InferenceSession, whichever entry imported the core. */
  InferenceSession: any;
  Tensor: any;
  /** Read one of the model's files by manifest filename. */
  readFile(filename: string): Promise<Uint8Array>;
  /** 'webgpu' only when this entry can really run on the GPU AND the model
   *  supports it; every adapter is free to ignore it. */
  executionProviders: string[];
}

export interface PunctuationAdapter {
  readonly model: PunctuationModelId;
  /** True when this adapter may run on the WebGPU EP. Edge-Punct returns false:
   *  its graph is DynamicQuantizeLSTM / ConvInteger / MatMulInteger / NonZero /
   *  TopK, none of which have WebGPU kernels, so it would fall back to CPU
   *  op by op and be slower than plain WASM. */
  readonly supportsWebGpu: boolean;
  load(deps: PunctuationAdapterDeps): Promise<void>;
  run(text: string): Promise<PunctuationResult>;
  release(): Promise<void>;
}

export interface PunctuationCoreDeps {
  InferenceSession: any;
  Tensor: any;
  env: any;
  /** Whether this entry's sessions can really use the GPU. */
  canUseWebGpu(): Promise<boolean>;
  adapters: Record<PunctuationModelId, () => PunctuationAdapter>;
}

/**
 * Wire `self.onmessage` to the load/run/unload/dispose protocol.
 *
 * Messages are serialized through one promise chain: ORT sessions are not
 * re-entrant, and two runs overlapping inside one wasm instance is the hang
 * qwen3-asr-webgpu.worker.ts documents at its VAD import.
 */
export function installPunctuationWorker(deps: PunctuationCoreDeps): void {
  const loaded = new Map<PunctuationModelId, PunctuationAdapter>();
  let chain: Promise<void> = Promise.resolve();

  const post = (msg: PunctuationWorkerOutbound) => (self as any).postMessage(msg);

  async function handleLoad(msg: PunctuationInitMessage): Promise<void> {
    const started = performance.now();
    // A second load for a model already held would otherwise drop the first
    // adapter's ONNX session — and its WASM heap or GPU buffers — with nothing
    // releasing it. The guard belongs here rather than in the caller: this
    // module exists so the two entries and the runtime can stay thin, and a
    // leaked session costs 0.25-1.5 GB against a design whose largest open
    // question is already renderer memory.
    const previous = loaded.get(msg.model);
    if (previous) {
      loaded.delete(msg.model);
      await previous.release();
    }
    if (deps.env?.wasm) {
      deps.env.wasm.wasmPaths = msg.ortWasmBaseUrl;
      deps.env.wasm.numThreads = msg.numThreads;
    }
    const adapter = deps.adapters[msg.model]();
    const gpu = adapter.supportsWebGpu && (await deps.canUseWebGpu());
    const device: 'webgpu' | 'wasm' = gpu ? 'webgpu' : 'wasm';
    await adapter.load({
      InferenceSession: deps.InferenceSession,
      Tensor: deps.Tensor,
      readFile: async (filename: string) => {
        const url = msg.fileUrls[filename];
        if (!url) throw new Error(`punctuation: ${msg.model} is missing ${filename}`);
        const res = await fetch(url);
        return new Uint8Array(await res.arrayBuffer());
      },
      executionProviders: [device],
    });
    loaded.set(msg.model, adapter);
    post({ type: 'loaded', id: msg.id, model: msg.model, loadTimeMs: Math.round(performance.now() - started), device });
  }

  async function handleRun(msg: PunctuationRunMessage): Promise<void> {
    const adapter = loaded.get(msg.model);
    if (!adapter) throw new Error(`punctuation: ${msg.model} is not loaded`);
    const started = performance.now();
    const result = await adapter.run(msg.text);
    post({ type: 'result', id: msg.id, result, inferenceMs: Math.round(performance.now() - started) });
  }

  async function handleUnload(msg: PunctuationUnloadMessage): Promise<void> {
    const adapter = loaded.get(msg.model);
    if (adapter) await adapter.release();
    loaded.delete(msg.model);
    post({ type: 'unloaded', id: msg.id });
  }

  self.onmessage = (event: MessageEvent<PunctuationWorkerInbound>) => {
    const msg = event.data;
    chain = chain.then(async () => {
      try {
        if (msg.type === 'load') await handleLoad(msg);
        else if (msg.type === 'run') await handleRun(msg);
        else if (msg.type === 'unload') await handleUnload(msg);
        else if (msg.type === 'dispose') {
          for (const adapter of loaded.values()) await adapter.release();
          loaded.clear();
          post({ type: 'disposed' });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        post({ type: 'error', id: (msg as { id?: string }).id, error });
      }
    });
  };

  post({ type: 'ready', loadTimeMs: 0, device: 'wasm' });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/local-inference/workers/_shared/punctuation-core.ts
git commit -m "feat(segmentation): add the punctuation worker protocol and adapter contract"
```

---

## Task 5: FireRedPunc adapter (Chinese)

Port of `benchmark/punctuation-restoration/models/fireredpunc.mjs` (389 lines) driven through the `punc.q8w.onnx` build. **Port it verbatim** — the benchmark measured this exact code at breakpoint F1 91.5, and it matches the fp32 reference on 100% of the corpus. Every regex, every window rule and `ruleBasedTxtFix`'s regex ORDER are load-bearing.

**Files:**
- Create: `src/lib/local-inference/workers/_shared/punctuation-fireredpunc.ts`
- Create: `src/lib/local-inference/workers/_shared/punctuation-fireredpunc.test.ts`

**Interfaces:**
- Consumes: `PunctuationAdapter`, `PunctuationAdapterDeps` from `./punctuation-core`; `periodIsNotSentenceEnd` from `src/lib/segmentation/sentenceEnd`.
- Produces: `createFireRedPuncAdapter(): PunctuationAdapter`, and for the test: `tokenize`, `decode`, `ruleBasedTxtFix`, `stripMarks`, `parseOutDict`.

- [ ] **Step 1: Write the failing golden test**

The test never runs ONNX. It feeds fixed token ids and canned class predictions through the decoder and checks the text that comes out, then checks the counting rule.

```typescript
import { describe, it, expect } from 'vitest';
import {
  ruleBasedTxtFix,
  stripMarks,
  parseOutDict,
  countSentenceEnds,
} from './punctuation-fireredpunc';

describe('fireredpunc out_dict', () => {
  it('maps <space> to a blank label and keeps the four marks', () => {
    expect(parseOutDict('<space>\n，\n。\n？\n！')).toEqual([' ', '，', '。', '？', '！']);
  });
});

describe('fireredpunc stripMarks', () => {
  it('removes the marks the model predicts', () => {
    expect(stripMarks('你好，世界。')).toBe('你好 世界 ');
  });
  it('keeps a dot that joins two digits', () => {
    expect(stripMarks('version 3.5 here')).toBe('version 3.5 here');
  });
});

describe('fireredpunc ruleBasedTxtFix', () => {
  it('converts a full-width mark between ASCII letters and adds a space', () => {
    expect(ruleBasedTxtFix('hello，world')).toBe('Hello, world');
  });
  it('capitalises a standalone i', () => {
    expect(ruleBasedTxtFix('so i went')).toBe('So I went');
  });
  it('capitalises after a terminal', () => {
    expect(ruleBasedTxtFix('one. two')).toBe('One. Two');
  });
  it('leaves CJK untouched', () => {
    expect(ruleBasedTxtFix('你好，世界。')).toBe('你好，世界。');
  });
});

describe('fireredpunc sentence counting', () => {
  it('counts the three CJK terminals', () => {
    expect(countSentenceEnds('第一句。第二句！第三句？')).toEqual([4, 8, 12]);
  });
  it('does not count a comma', () => {
    expect(countSentenceEnds('第一部分，第二部分。')).toEqual([10]);
  });
  it('counts an ASCII period only when the shared rule accepts it', () => {
    expect(countSentenceEnds('Dr. Smith spoke. Then left.')).toEqual([16, 27]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/lib/local-inference/workers/_shared/punctuation-fireredpunc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Port the module**

Copy the whole body of `benchmark/punctuation-restoration/models/fireredpunc.mjs` into the new file and convert it to TypeScript. Mechanical changes only:

- add types to the exported function signatures;
- replace the `create({ ort, readFile, executionProviders, sessionOptions })` factory with `createFireRedPuncAdapter(): PunctuationAdapter` whose `load(deps)` does what `createFireRedPunc` did, reading `'punc.q8w.onnx'`, `'tokenizer.json'` and `'out_dict'` through `deps.readFile`;
- `ort.Tensor` becomes `deps.Tensor`, `ort.InferenceSession` becomes `deps.InferenceSession`;
- keep `MAX_TOKENS = 511`, `WINDOW_OVERLAP = 128`, `MAX_CHARS_PER_WORD = 100`, `STRIP_MARKS`, `DIGIT_JOINERS`, `FW_TO_ASCII` and every `RE_*` regex exactly as they are;
- keep the batch at 1 — the 42ailab graph fixes the output batch dimension.

Then add the two pieces the benchmark did not need:

```typescript
import { periodIsNotSentenceEnd } from '../../../segmentation/sentenceEnd';

/**
 * Where FireRedPunc's output ends a sentence.
 *
 * The model writes four marks and prefers commas: 64 sentence ends against 103
 * in the reference, but 205 of 225 marks overall. That under-emission is why
 * the Chinese length fallback exists; it is not compensated for here.
 */
export function countSentenceEnds(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '。' || ch === '！' || ch === '？') { out.push(i + 1); continue; }
    if (ch === '.' && !periodIsNotSentenceEnd(text, i)) out.push(i + 1);
  }
  return out;
}

/** Sentence ends plus the commas the model wrote. */
export function countBreakpoints(text: string): number[] {
  const ends = new Set(countSentenceEnds(text));
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '，' || text[i] === ',') ends.add(i + 1);
  }
  return [...ends].sort((a, b) => a - b);
}
```

and the adapter wrapper:

```typescript
export function createFireRedPuncAdapter(): PunctuationAdapter {
  let session: any = null;
  let vocab: Map<string, number> | null = null;
  let outDict: string[] = [];
  let clsId = 0;
  let unkId = 0;

  return {
    model: 'fireredpunc',
    // MatMulNBits at 8 bits has a WebGPU kernel; measured 27 ms for 480 zh
    // characters against 394 ms on WASM with 4 threads.
    supportsWebGpu: true,
    async load(deps) { /* as createFireRedPunc, using deps.readFile */ },
    async run(text) {
      const out = /* the module's punctuate(text) */ '';
      return {
        text: out,
        sentenceEnds: countSentenceEnds(out),
        breakpoints: countBreakpoints(out),
        model: 'fireredpunc',
      };
    },
    async release() { await session?.release?.(); session = null; vocab = null; },
  };
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test -- src/lib/local-inference/workers/_shared/punctuation-fireredpunc.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/workers/_shared/punctuation-fireredpunc.ts src/lib/local-inference/workers/_shared/punctuation-fireredpunc.test.ts
git commit -m "feat(segmentation): port the FireRedPunc adapter"
```

---

## Task 6: Edge-Punct-Casing adapter (English)

Port of `benchmark/punctuation-restoration/models/edge-punct-en.mjs` (221 lines, self-contained, no tokenizer dependency).

**Files:**
- Create: `src/lib/local-inference/workers/_shared/punctuation-edge-punct-en.ts`
- Create: `src/lib/local-inference/workers/_shared/punctuation-edge-punct-en.test.ts`

**Interfaces:**
- Consumes: `PunctuationAdapter`, `PunctuationAdapterDeps`.
- Produces: `createEdgePunctEnAdapter(): PunctuationAdapter`, and for the test: `UnigramEncoder`, `moduleWords`, `encodeSentences`, `decodeWord`.

- [ ] **Step 1: Write the failing golden test**

```typescript
import { describe, it, expect } from 'vitest';
import { UnigramEncoder, moduleWords, encodeSentences, decodeWord } from './punctuation-edge-punct-en';

// Five pieces is enough to exercise the trie, the tie-break and <unk>.
const VOCAB = ['<unk>\t0', '<s>\t0', '</s>\t0', '▁the\t-1.0', '▁cat\t-2.0'].join('\r\n');

describe('edge-punct UnigramEncoder', () => {
  it('encodes a known word to its single piece', () => {
    const enc = new UnigramEncoder(VOCAB);
    expect(enc.encodeWord('the')).toEqual([3]);
  });
  it('falls back to <unk> for an uncovered word, since the vocab has no byte pieces', () => {
    const enc = new UnigramEncoder(VOCAB);
    expect(enc.encodeWord('zzz')).toEqual([0]);
  });
});

describe('edge-punct preprocessing', () => {
  it('strips a trailing run of .,? from each word and drops emptied words', () => {
    expect(moduleWords('hello, world. ... ok?')).toEqual(['hello', 'world', 'ok']);
  });
});

describe('edge-punct batching', () => {
  it('marks only the first piece of a word valid', () => {
    const enc = new UnigramEncoder(VOCAB);
    const out = encodeSentences(enc, ['the', 'cat'], true);
    expect(out.n).toBe(1);
    expect(Array.from(out.tokenIds.slice(0, 4))).toEqual([1, 3, 4, 2]);
    expect(Array.from(out.validIds.slice(0, 4))).toEqual([1, 1, 1, 1]);
    expect(Array.from(out.labelLens)).toEqual([4]);
  });
});

describe('edge-punct decoding', () => {
  it.each([
    ['ok', 0, 0, 'ok'],
    ['ok', 1, 0, 'OK'],
    ['ok', 2, 0, 'Ok'],
    ['ok', 0, 1, 'ok,'],
    ['ok', 0, 2, 'ok.'],
    ['ok', 0, 3, 'ok?'],
    ['ok', 2, 2, 'Ok.'],
    ['ok', 3, 0, 'ok'],
  ])('decodeWord(%s, case=%i, punct=%i) -> %s', (word, c, p, expected) => {
    expect(decodeWord(word as string, c as number, p as number)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/lib/local-inference/workers/_shared/punctuation-edge-punct-en.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Port the module**

Copy `edge-punct-en.mjs` and convert to TypeScript. Keep every constant: `MAX_SEQ_LEN = 200`, `BOS = 1`, `EOS = 2`, `PUNCT_SUFFIX = ['', ',', '.', '?']`, `CASE_UPPER = 1`, `CASE_CAP = 2`. Keep the two upstream quirks in `UnigramEncoder.encodeWord` — the `score[i] = maxScore === -Infinity ? 0 : maxScore` zero for an uncovered position, and the `s === maxScore && maxIdx >= end` shortest-piece tie-break — and keep `Math.fround` where it is. Keep all rows in one batch: the graph quantizes activations per tensor, so splitting the batch changes the numbers. Export `decodeWord` for the test.

The adapter:

```typescript
export function createEdgePunctEnAdapter(): PunctuationAdapter {
  let session: any = null;
  let encoder: UnigramEncoder | null = null;

  return {
    model: 'edge-punct-en',
    // Dynamic int8: DynamicQuantizeLSTM, ConvInteger, MatMulInteger, NonZero
    // and TopK have no WebGPU kernels, so a 'webgpu' session would fall back
    // op by op and be slower than plain WASM. Always WASM, in either entry.
    supportsWebGpu: false,
    async load(deps) {
      const [modelBytes, vocabBytes] = await Promise.all([
        deps.readFile('model.int8.onnx'),
        deps.readFile('bpe.vocab'),
      ]);
      session = await deps.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
      encoder = new UnigramEncoder(new TextDecoder().decode(vocabBytes));
    },
    async run(text) {
      const words = moduleWords(text);
      if (words.length === 0) {
        return { text: '', sentenceEnds: [], breakpoints: [], model: 'edge-punct-en' };
      }
      const out = /* predict + decodeWord join, as in the benchmark's punctuate */ '';
      return {
        text: out,
        sentenceEnds: periodOffsets(out),
        breakpoints: periodOrCommaOffsets(out),
        model: 'edge-punct-en',
      };
    },
    async release() { await session?.release?.(); session = null; encoder = null; },
  };
}

/** Edge-Punct writes no abbreviation dots, so every '.' and '?' it emits is a
 *  sentence end. It never forces a final mark — the utterance end supplies one. */
function periodOffsets(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '.' || text[i] === '?') out.push(i + 1);
  return out;
}

function periodOrCommaOffsets(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '.' || text[i] === '?' || text[i] === ',') out.push(i + 1);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test -- src/lib/local-inference/workers/_shared/punctuation-edge-punct-en.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-inference/workers/_shared/punctuation-edge-punct-en.ts src/lib/local-inference/workers/_shared/punctuation-edge-punct-en.test.ts
git commit -m "feat(segmentation): port the Edge-Punct-Casing English adapter"
```

---

## Task 7: SaT adapter (every other language) and its tokenizer dependency

Port of `benchmark/punctuation-restoration/models/sat-3l-sm.mjs` (298 lines). This is the one adapter with an external dependency, and the dependency is currently only transitive.

**Files:**
- Modify: `package.json` — add `@huggingface/tokenizers` to `dependencies`
- Create: `src/lib/local-inference/workers/_shared/punctuation-sat.ts`
- Create: `src/lib/local-inference/workers/_shared/punctuation-sat.test.ts`

**Interfaces:**
- Consumes: `PunctuationAdapter`, `PunctuationAdapterDeps`.
- Produces: `createSatAdapter(): PunctuationAdapter`, and for the test: `sentencesFrom`, `joinSegments`, `SAT_DEFAULTS`, `f16round`.

- [ ] **Step 1: Promote the tokenizer to a direct dependency**

`@huggingface/tokenizers` 0.1.3 is in `node_modules` only as a transitive dependency of `@huggingface/transformers`, and the adapter uses four of its internals (`tokenizer.normalizer(s)`, `tokenizer.model([...])` called as a function, `tokenizer.model.tokens_to_ids`, `tokenizer.model.unk_token_id`). Relying on a transitive version for that is how a patch release breaks the build silently.

Read the installed version first, then pin that exact version:

```bash
node -e "console.log(require('./node_modules/@huggingface/tokenizers/package.json').version)"
```

Add it to `dependencies` in `package.json` with an exact version (no caret — the adapter depends on internals), then `npm install` and confirm `package-lock.json` changed.

- [ ] **Step 2: Write the failing golden test**

```typescript
import { describe, it, expect } from 'vitest';
import { sentencesFrom, joinSegments, SAT_DEFAULTS, f16round } from './punctuation-sat';

describe('SaT defaults', () => {
  it('keeps wtpsplit thresholds', () => {
    expect(SAT_DEFAULTS).toEqual({ threshold: 0.25, blockSize: 512, stride: 64, batchSize: 32 });
  });
});

describe('SaT sentencesFrom', () => {
  const chars = Array.from('one two three');
  it('cuts strictly above the threshold', () => {
    const probs = new Float32Array(chars.length);
    probs[2] = 0.25; // exactly at the threshold: not a boundary
    expect(sentencesFrom(chars, probs)).toEqual(['one two three']);
    probs[2] = 0.2500001;
    expect(sentencesFrom(chars, probs)).toEqual(['one', 'two three']);
  });
  it('swallows the whitespace after a boundary', () => {
    const probs = new Float32Array(chars.length);
    probs[2] = 0.9;
    expect(sentencesFrom(chars, probs)).toEqual(['one', 'two three']);
  });
  it('treats an input newline as a boundary', () => {
    const withNewline = Array.from('one\ntwo');
    expect(sentencesFrom(withNewline, new Float32Array(withNewline.length))).toEqual(['one', 'two']);
  });
});

describe('SaT joinSegments', () => {
  it('drops one trailing space per cut segment', () => {
    expect(joinSegments(['one ', 'two'])).toBe('one\ntwo');
  });
});

describe('SaT float16 accumulation', () => {
  it('rounds to half precision, which is what the reference buffers do', () => {
    expect(f16round(1 / 3)).not.toBe(1 / 3);
    expect(f16round(1)).toBe(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test -- src/lib/local-inference/workers/_shared/punctuation-sat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Port the module**

Copy `sat-3l-sm.mjs` and convert to TypeScript, exporting `DEFAULTS` as `SAT_DEFAULTS`. Keep verbatim: `CLS_ID = 0`, `SEP_ID = 2`, `MAX_SUBWORDS = 510`, `METASPACE = '▁'`, the `PY_SPACE` set, `tokenizeWithEnds` including its grapheme / 6-byte rule, the window loop (`min(512, n, 510)`, stride 64, last window right-aligned, batch 32), the **emulated float16 averaging** (`f16round(f32(...))`) and the float32 sigmoid. The mask dtype must stay auto-detected from `session.inputMetadata` — the shipped build wants float32, the fp16 build wants float16.

SaT emits boundaries, not marks, so the adapter converts:

```typescript
export function createSatAdapter(): PunctuationAdapter {
  let session: any = null;
  let tokenizer: any = null;

  return {
    model: 'sat-3l-sm',
    // No tensor in the q8w-gather build is float16, so it needs no shader-f16
    // and clears the existing gate. Measured 11-16 ms on WebGPU at any length.
    supportsWebGpu: true,
    async load(deps) {
      const { Tokenizer } = await import('@huggingface/tokenizers');
      const tokenizerJson = JSON.parse(new TextDecoder().decode(await deps.readFile('tokenizer.json')));
      tokenizer = new Tokenizer(tokenizerJson, {});
      session = await deps.InferenceSession.create(await deps.readFile('model.onnx'), {
        executionProviders: deps.executionProviders,
      });
    },
    async run(text) {
      const segments = /* split(text) as in the benchmark */ [] as string[];
      // A boundary carries no mark of its own. Writing one terminal per cut
      // keeps the PunctuationResult contract — "input characters with marks
      // inserted" — and gives SentenceStream something to count. The mark is
      // chosen by script so a Japanese bubble does not end in a Latin period.
      const terminal = /[　-鿿＀-￯]/.test(text) ? '。' : '.';
      let out = '';
      const sentenceEnds: number[] = [];
      segments.forEach((seg, i) => {
        out += seg;
        if (i < segments.length - 1) { out += terminal; sentenceEnds.push(out.length); }
      });
      return { text: out, sentenceEnds, breakpoints: [...sentenceEnds], model: 'sat-3l-sm' };
    },
    async release() { await session?.release?.(); session = null; tokenizer = null; },
  };
}
```

Note for the implementer: the adapter must **not** append a terminal after the last segment. The final mark is the utterance end's job, and a mark at the very end of a tail is never trusted by `SentenceStream` anyway.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npm run test -- src/lib/local-inference/workers/_shared/punctuation-sat.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/local-inference/workers/_shared/punctuation-sat.ts src/lib/local-inference/workers/_shared/punctuation-sat.test.ts
git commit -m "feat(segmentation): port the SaT boundary adapter and pin its tokenizer"
```

---

## Task 8: The two worker entries

Three consistency tests read these files as **text**. Getting the literal spellings wrong fails the suite in ways the compiler cannot see, so each rule below is a hard requirement, not a style note.

**Files:**
- Create: `src/lib/local-inference/workers/punctuation-webgpu.worker.ts`
- Create: `src/lib/local-inference/workers/punctuation-wasm.worker.ts`
- Create: `src/lib/segmentation/createPunctuationWorker.ts`

**Interfaces:**
- Consumes: `installPunctuationWorker` and the three `create*Adapter` factories.
- Produces: `createPunctuationWorker(backend: 'webgpu' | 'wasm'): Worker`.

- [ ] **Step 1: Write the WebGPU entry**

```typescript
/**
 * Punctuation worker, WebGPU entry.
 *
 * Imports the onnxruntime-web/webgpu bundle, which is the only one whose
 * sessions really run on the GPU. Its WASM EP lacks GatherBlockQuantized, so
 * SaT cannot fall back to CPU inside this bundle — a WebGPU failure recreates
 * the worker with the wasm entry instead.
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-webgpu';
import { acquireWebGpuAdapter, bindCheckedWebGpuAdapter } from './shaderF16Gate';
import { installPunctuationWorker } from './_shared/punctuation-core';
import { createFireRedPuncAdapter } from './_shared/punctuation-fireredpunc';
import { createEdgePunctEnAdapter } from './_shared/punctuation-edge-punct-en';
import { createSatAdapter } from './_shared/punctuation-sat';

installPunctuationWorker({
  InferenceSession,
  Tensor,
  env: ortEnv,
  async canUseWebGpu() {
    const adapter = await acquireWebGpuAdapter(ortEnv);
    if (!adapter) return false;
    // No build here uses a float16 tensor, so this binds the checked adapter
    // without demanding shader-f16.
    await bindCheckedWebGpuAdapter(ortEnv, 'q8', 'Punctuation');
    return true;
  },
  adapters: {
    'fireredpunc': createFireRedPuncAdapter,
    'edge-punct-en': createEdgePunctEnAdapter,
    'sat-3l-sm': createSatAdapter,
  },
});
```

Requirements this file must satisfy, all enforced by `shaderF16Gate.consistency.test.ts` reading the source as text:
1. the literal call text `bindCheckedWebGpuAdapter(` appears;
2. the literal import text `from './shaderF16Gate'` appears;
3. the first argument is the bare identifier `ortEnv` (the capture is `/bindCheckedWebGpuAdapter\(\s*([A-Za-z0-9_.]+)/`, so no cast and no parenthesis);
4. `requestAdapter(` appears **nowhere**, including in comments — probe through `acquireWebGpuAdapter` only;
5. the gate import is not inside a multi-line `import type { … }` block.

And from `qwen35ChunkedPrefill.consistency.test.ts`: the strings `DynamicCache`, `past_key_values` and `model.forward(` must not appear anywhere in the file, comments included.

- [ ] **Step 2: Write the WASM entry**

```typescript
/**
 * Punctuation worker, CPU entry.
 *
 * Imports the default onnxruntime-web bundle. It is the only one whose WASM
 * EP registers GatherBlockQuantized, which SaT's 8-bit embedding needs, so
 * this entry is both the no-GPU path and the fallback after a GPU failure.
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import { installPunctuationWorker } from './_shared/punctuation-core';
import { createFireRedPuncAdapter } from './_shared/punctuation-fireredpunc';
import { createEdgePunctEnAdapter } from './_shared/punctuation-edge-punct-en';
import { createSatAdapter } from './_shared/punctuation-sat';

installPunctuationWorker({
  InferenceSession,
  Tensor,
  env: ortEnv,
  // This bundle has no GPU execution provider at all; every model runs on CPU.
  async canUseWebGpu() { return false; },
  adapters: {
    'fireredpunc': createFireRedPuncAdapter,
    'edge-punct-en': createEdgePunctEnAdapter,
    'sat-3l-sm': createSatAdapter,
  },
});
```

**The trap in this file:** `shaderF16Gate.consistency.test.ts` makes any `*.worker.ts` in this directory a candidate when its lowercased source contains the substring `webgpu` **and** it matches `/InferenceSession\.create\(/`. The `InferenceSession.create(` call lives in the adapters, not here, so as written this file is not a candidate — but the word "WebGPU" must not appear in it either, or a later edit that adds a `create(` call would silently enrol it. The doc comment above deliberately says "GPU", not "WebGPU". If a future edit needs the word, add an `EXEMPT` row in that test with an executable `stillHolds` predicate, copying the `zoom-vad.worker.ts` row.

- [ ] **Step 3: Write the worker factory**

Copy the shape of `src/services/clients/createNativeVadWorker.ts`, which exists precisely so a client can be unit-tested with the worker stubbed.

```typescript
/** Isolated factory so PunctuationRuntime can be unit-tested with the worker stubbed. */
export function createPunctuationWorker(backend: 'webgpu' | 'wasm'): Worker {
  return backend === 'webgpu'
    ? new Worker(
        new URL('../local-inference/workers/punctuation-webgpu.worker.ts', import.meta.url),
        { type: 'module' },
      )
    : new Worker(
        new URL('../local-inference/workers/punctuation-wasm.worker.ts', import.meta.url),
        { type: 'module' },
      );
}
```

- [ ] **Step 4: Run every consistency test that reads the workers directory**

Run: `npm run test -- src/lib/local-inference/workers/shaderF16Gate.consistency.test.ts src/lib/local-inference/workers/qwen35ChunkedPrefill.consistency.test.ts src/lib/local-inference/workers/_shared/harness-consolidation.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS. Two notes:
- `shaderF16Gate.consistency.test.ts` asserts `candidates().length >= 13`; adding the WebGPU entry raises the count to 14, which still passes.
- `harness-consolidation.test.ts` walks hand-maintained arrays, not the directory. Do **not** add either worker to them: both are text-in/text-out with no VAD, so the `await initVad(`, `case Message.SpeechEnd:` and `handleFlush` anchors those arrays require do not exist here and would fail.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/local-inference/workers/punctuation-webgpu.worker.ts src/lib/local-inference/workers/punctuation-wasm.worker.ts src/lib/segmentation/createPunctuationWorker.ts
git commit -m "feat(segmentation): add the WebGPU and CPU punctuation worker entries"
```

---

## Task 9: Manifest entries and the storage-page exclusion

`ModelType` is a plain string union with no `Record<ModelType, …>` and no exhaustive switch anywhere in `src/` — adding a member produces **zero** compile errors, so every exclusion has to be found by hand. It was: only two sites leak, and both are in `StoragePage.tsx`.

**Files:**
- Modify: `src/lib/local-inference/modelManifest.ts:17` and the `MODEL_MANIFEST` array
- Create: `src/lib/local-inference/modelManifest.punctuation.test.ts`
- Modify: `src/components/Settings/engine/StoragePage.tsx:300`

**Interfaces:**
- Consumes: nothing.
- Produces: manifest ids `punct-zh-fireredpunc`, `punct-en-edge`, `punct-multi-sat`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { MODEL_MANIFEST, getManifestEntry, getManifestByType, getModelSizeMb } from './modelManifest';

const IDS = ['punct-zh-fireredpunc', 'punct-en-edge', 'punct-multi-sat'];

describe('punctuation manifest entries', () => {
  it('registers exactly three punctuation models', () => {
    expect(getManifestByType('punctuation').map((m) => m.id).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS)('%s is hosted from a pinned revision of our own mirror', (id) => {
    const entry = getManifestEntry(id)!;
    expect(entry.type).toBe('punctuation');
    // cdnPath is deliberately unused: getModelDownloadUrl buckets a cdnPath
    // entry as TTS-or-else-ASR, so a punctuation model would silently resolve
    // against the ASR dataset base.
    expect(entry.cdnPath).toBeUndefined();
    expect(entry.hfModelId).toMatch(/^jiangzhuo9357\//);
    expect(entry.hfRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(entry.variants)).toEqual(['default']);
    expect(entry.variants.default.requiredFeatures).toBeUndefined();
    expect(entry.requiredDevice).toBeUndefined();
  });

  it('carries the measured file sizes', () => {
    const zh = getManifestEntry('punct-zh-fireredpunc')!;
    expect(zh.variants.default.files).toEqual([
      { filename: 'punc.q8w.onnx', sizeBytes: 162_771_205 },
      { filename: 'tokenizer.json', sizeBytes: 268_961 },
      { filename: 'out_dict', sizeBytes: 33 },
    ]);
    const en = getManifestEntry('punct-en-edge')!;
    expect(en.variants.default.files).toEqual([
      { filename: 'model.int8.onnx', sizeBytes: 7_490_500 },
      { filename: 'bpe.vocab', sizeBytes: 149_430 },
    ]);
    const sat = getManifestEntry('punct-multi-sat')!;
    expect(sat.variants.default.files).toEqual([
      { filename: 'model.onnx', sizeBytes: 241_945_842 },
      { filename: 'tokenizer.json', sizeBytes: 9_096_718 },
    ]);
  });

  it('reports the sizes the settings section will show', () => {
    expect(getModelSizeMb(getManifestEntry('punct-zh-fireredpunc')!)).toBe(156);
    expect(getModelSizeMb(getManifestEntry('punct-en-edge')!)).toBe(7);
    expect(getModelSizeMb(getManifestEntry('punct-multi-sat')!)).toBe(239);
  });

  it('keeps punctuation models out of every resolver pool', () => {
    // Stage is a separate union from ModelType, so this is structural, but
    // pin it: a punctuation model must never be offered as an engine.
    for (const id of IDS) {
      expect(MODEL_MANIFEST.find((m) => m.id === id)!.asrEngine).toBeUndefined();
      expect(MODEL_MANIFEST.find((m) => m.id === id)!.engine).toBeUndefined();
      expect(MODEL_MANIFEST.find((m) => m.id === id)!.translationWorkerType).toBeUndefined();
    }
  });
});
```

The three `getModelSizeMb` expectations are placeholders until Step 3 computes them — run the test once, read the real values out of the failure, and write them in. Do not round by hand.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/lib/local-inference/modelManifest.punctuation.test.ts`
Expected: FAIL — `getManifestByType('punctuation')` is empty (and `'punctuation'` is not assignable to `ModelType`).

- [ ] **Step 3: Add the type and the three entries**

At `src/lib/local-inference/modelManifest.ts:17`:

```typescript
export type ModelType = 'asr' | 'asr-stream' | 'tts' | 'translation' | 'punctuation';
```

Append three entries to `MODEL_MANIFEST` (the array closes at line 3328). `hfRevision` is left as the literal `'TODO-COMMIT-SHA'` until Step 5 fills it in from the real upload; the test above will fail until then, which is the point.

```typescript
  // ─── Punctuation (sentence segmentation stage) ─────────────────────────
  // Not engines: these never enter a resolver pool and never appear in the
  // model-management or engine pages. They are downloaded on first need by
  // PunctuationRuntime and managed from the Sentence segmentation section.
  {
    id: 'punct-zh-fireredpunc',
    type: 'punctuation',
    name: 'FireRedPunc (Chinese)',
    languages: ['zh', 'yue'],
    hfModelId: 'jiangzhuo9357/fireredpunc-onnx',
    hfRevision: 'TODO-COMMIT-SHA',
    variants: {
      default: {
        dtype: 'default',
        files: [
          { filename: 'punc.q8w.onnx', sizeBytes: 162_771_205 },
          { filename: 'tokenizer.json', sizeBytes: 268_961 },
          { filename: 'out_dict', sizeBytes: 33 },
        ],
      },
    },
  },
  {
    id: 'punct-en-edge',
    type: 'punctuation',
    name: 'Edge-Punct-Casing (English)',
    languages: ['en'],
    hfModelId: 'jiangzhuo9357/edge-punct-casing-en-onnx',
    hfRevision: 'TODO-COMMIT-SHA',
    variants: {
      default: {
        dtype: 'default',
        files: [
          { filename: 'model.int8.onnx', sizeBytes: 7_490_500 },
          { filename: 'bpe.vocab', sizeBytes: 149_430 },
        ],
      },
    },
  },
  {
    id: 'punct-multi-sat',
    type: 'punctuation',
    name: 'SaT 3L-SM (other languages)',
    languages: ['multilingual'],
    multilingual: true,
    hfModelId: 'jiangzhuo9357/sat-3l-sm-onnx',
    hfRevision: 'TODO-COMMIT-SHA',
    variants: {
      default: {
        dtype: 'default',
        files: [
          { filename: 'model.onnx', sizeBytes: 241_945_842 },
          { filename: 'tokenizer.json', sizeBytes: 9_096_718 },
        ],
      },
    },
  },
```

- [ ] **Step 4: Exclude them from the storage page's import dropdown**

`src/components/Settings/engine/StoragePage.tsx:300` currently reads:

```tsx
              {MODEL_MANIFEST.filter((m) => !m.isCloudModel).map((m) => (
```

Change it to:

```tsx
              {MODEL_MANIFEST.filter((m) => !m.isCloudModel && m.type !== 'punctuation').map((m) => (
```

Leave the storage **rows** at `:151` alone: they are keyed off download status, so a downloaded punctuation model does show up with a delete button, which is correct — it really does occupy IndexedDB. It will render without the "In use" badge, because `inUse` is computed only from the three resolver stages.

- [ ] **Step 5: Prepare the three Hugging Face repos locally — and stop**

For each model, build a directory containing exactly the files listed above plus:
- the upstream `LICENSE` (FireRedPunc Apache-2.0, Edge-Punct-Casing Apache-2.0, SaT MIT);
- a model card naming the upstream repo, the exact conversion command from `benchmark/punctuation-restoration/tools/`, and the measured numbers from `docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md`;
- the sha256 of every file.

Source files are already on this machine under `~/.cache/sokuji-punct-bench/`: `fireredpunc-onnx/`, `sherpa/sherpa-onnx-online-punct-en-2024-08-06/` and `sat/sat-3l-sm-q8w-gather/`.

**Then stop and ask.** Uploading is an outward publication. Ask jiangzhuo naming each target repository explicitly — `jiangzhuo9357/fireredpunc-onnx`, `jiangzhuo9357/edge-punct-casing-en-onnx`, `jiangzhuo9357/sat-3l-sm-onnx` — and wait. After the upload, replace each `'TODO-COMMIT-SHA'` with the real 40-character commit sha, exactly as `supertonic-3` does at `modelManifest.ts:3035`.

- [ ] **Step 6: Run the manifest tests and the typecheck**

Run: `npm run test -- src/lib/local-inference/modelManifest.punctuation.test.ts src/lib/local-inference/modelName.test.ts src/components/Settings/engine/StoragePage.test.tsx && npx tsc --noEmit`
Expected: PASS. `modelName.test.ts` buckets by `m.type`, so the three new entries only risk colliding with each other, and their names differ.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-inference/modelManifest.ts src/lib/local-inference/modelManifest.punctuation.test.ts src/components/Settings/engine/StoragePage.tsx
git commit -m "feat(segmentation): add the three punctuation models to the manifest"
```

---

## Task 10: `PunctuationRuntime`

The `SegmentationRuntime` implementation: routing, lazy worker creation, downloads, health, idle unload, memory guard. It follows `TranslationEngine` (`WorkerSession` + `RequestRegistry`) and imports **no store and no `report.ts`** — it emits events the app layer forwards in slice 2.

**Files:**
- Create: `src/lib/segmentation/PunctuationRuntime.ts`
- Create: `src/lib/segmentation/PunctuationRuntime.test.ts`

**Interfaces:**
- Consumes: `SegmentationRuntime`, `PunctuationResult`, `PunctuationModelId`; `baseLang` from `./sentenceEnd`; `createPunctuationWorker`; `WorkerSession` from `../local-inference/engine/WorkerSession`; `RequestRegistry` from `../local-inference/engine/RequestRegistry`; `ModelManager` from `../local-inference/ModelManager`; `checkWebGPU` from `../../utils/webgpu`.
- Produces: `PunctuationRuntime` (implements `SegmentationRuntime`, plus `dispose(): void` for the app-layer owner to call on unmount), `PunctuationRuntimeOptions`, `PunctuationStatus`, `modelForLanguage(lang)`, `MODEL_IDS`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PunctuationRuntime, modelForLanguage } from './PunctuationRuntime';

describe('modelForLanguage', () => {
  it.each([
    ['zh', 'fireredpunc'],
    ['zh-CN', 'fireredpunc'],
    ['cmn-CN', 'fireredpunc'],
    ['yue', 'fireredpunc'],
    ['en', 'edge-punct-en'],
    ['en-US', 'edge-punct-en'],
    ['ja', 'sat-3l-sm'],
    ['ko', 'sat-3l-sm'],
    ['ru', 'sat-3l-sm'],
    ['auto', 'sat-3l-sm'],
    ['', 'sat-3l-sm'],
  ])('%s -> %s', (lang, model) => {
    expect(modelForLanguage(lang)).toBe(model);
  });
});
```

Then the runtime behaviour, with a fake worker following the `WorkerSession.test.ts` pattern (`src/lib/local-inference/engine/testing/mockWorker.ts` provides `MockWorker` and `installMockWorker()`):

```typescript
describe('PunctuationRuntime', () => {
  // Cases to cover, each with the fake worker and fake ModelManager:
  //  - punctuate() returns null and starts one download when the model is
  //    not downloaded, and does not start a second on the next call;
  //  - punctuate() returns null while the model is loading;
  //  - a loaded model returns the worker's result;
  //  - the worker is created lazily: no Worker before the first punctuate();
  //  - three consecutive failures disable that model for the session;
  //  - a worker crash restarts once; the second crash disables models;
  //  - a WebGPU load failure recreates the worker with the wasm entry;
  //  - a call that exceeds 3 s resolves null;
  //  - navigator.deviceMemory <= 4 loads nothing and always returns null;
  //  - a model unused for 2 minutes unloads (vi.useFakeTimers), and the
  //    worker terminates once it holds none;
  //  - enabled === false makes punctuate() return null without touching
  //    the worker or the ModelManager;
  //  - a download failure does NOT retry automatically in the same launch:
  //    a second punctuate() for that model returns null without a second
  //    download, and the status stays 'error' until a manual retry;
  //  - a manual retry after a failure starts exactly one new download;
  //  - once the median call latency stays above 500 ms, that model goes
  //    rule-only for the session (feed it slow fake responses and assert
  //    punctuate() starts returning null without reaching the worker);
  //  - dispose() rejects every in-flight request and terminates the worker,
  //    and a result arriving after dispose() touches nothing.
});
```

Write each of those as a real `it(...)` before implementing. They are the failure table from the spec, one row each.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- src/lib/segmentation/PunctuationRuntime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the runtime**

```typescript
import { WorkerSession } from '../local-inference/engine/WorkerSession';
import { RequestRegistry } from '../local-inference/engine/RequestRegistry';
import { ModelManager } from '../local-inference/ModelManager';
import { checkWebGPU } from '../../utils/webgpu';
import { baseLang } from './sentenceEnd';
import { createPunctuationWorker } from './createPunctuationWorker';
import type {
  PunctuationModelId,
  PunctuationResult,
  SegmentationRuntime,
} from './SegmentationRuntime';

/** Manifest ids, keyed by the model each adapter implements. */
export const MODEL_IDS: Record<PunctuationModelId, string> = {
  'fireredpunc': 'punct-zh-fireredpunc',
  'edge-punct-en': 'punct-en-edge',
  'sat-3l-sm': 'punct-multi-sat',
};

export type PunctuationStatus =
  | 'not-downloaded' | 'downloading' | 'downloaded'
  | 'loading' | 'ready' | 'error' | 'disabled';

/** Which model serves a language. Everything not zh/yue/en goes to SaT, which
 *  covers 85 languages; so does `auto` with nothing detected yet. */
export function modelForLanguage(lang: string): PunctuationModelId {
  const base = baseLang(lang);
  if (base === 'zh' || base === 'yue') return 'fireredpunc';
  if (base === 'en') return 'edge-punct-en';
  return 'sat-3l-sm';
}

const INFERENCE_TIMEOUT_MS = 3_000;
const IDLE_UNLOAD_MS = 2 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_WORKER_CRASHES = 2;
const MIN_DEVICE_MEMORY_GB = 4;

export interface PunctuationRuntimeOptions {
  /** The user setting. A disabled runtime never downloads and never loads. */
  isEnabled(): boolean;
  /** Status, progress and failure events for the app layer to forward to the
   *  store and to diagnostics. The runtime itself imports neither. */
  onStatus?(model: PunctuationModelId, status: PunctuationStatus, detail?: string): void;
  onDownloadProgress?(model: PunctuationModelId, percent: number): void;
  /** Reported once per model load, for the segmentation_model_load event. */
  onLoaded?(model: PunctuationModelId, backend: 'webgpu' | 'wasm', loadMs: number): void;
}
```

The implementation follows `TranslationEngine.ts:132-208` closely:
- one `WorkerSession`, created on first need, with `makeWorker: () => createPunctuationWorker(backend)` where `backend` is `'webgpu'` when `(await checkWebGPU()).available` and WebGPU has not been disabled for this launch;
- a `RequestRegistry<PunctuationResult>` resolved from the router's `case 'result'` and rejected from `case 'error'` when `msg.id` is present;
- request ids `pn_${++counter}`;
- `revokeBlobs: () => manager.revokeBlobUrls(fileUrls)` per loaded model, exactly as the engines do;
- `ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href`;
- `numThreads`: pinned, not inherited. Use `1` when `crossOriginIsolated` is false (the extension has no COOP/COEP), otherwise `Math.min(4, navigator.hardwareConcurrency ?? 1)`. Edge-Punct's int8 logits are not bit-identical across thread counts, so this must be a deliberate constant rather than ORT's default.

The memory guard reuses the shape already in `src/services/providers/localParticipantConfig.ts:116` so a tester can simulate a small machine the same way:

```typescript
function deviceMemoryGb(): number {
  try {
    const override = localStorage.getItem('debug:device-memory');
    if (override !== null) {
      const n = Number(override);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  } catch { /* localStorage unavailable */ }
  return (navigator as { deviceMemory?: number }).deviceMemory ?? MIN_DEVICE_MEMORY_GB;
}
```

`punctuate()` resolves `null` — never rejects — in every one of these cases: disabled; `deviceMemoryGb() <= MIN_DEVICE_MEMORY_GB`; the model is disabled for this session; not downloaded (kick off one background download and return); downloading or loading; the request timed out at `INFERENCE_TIMEOUT_MS`; the worker rejected it.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm run test -- src/lib/segmentation/PunctuationRuntime.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Confirm the console ledger is still satisfied**

Run: `npm run test -- src/lib/diagnostics/consoleLedger.consistency.test.ts`
Expected: PASS. `src/lib/segmentation/` is inside the scanned roots and is not in the LEDGER, so every file added by this slice must contain zero `console.error` / `console.warn`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/segmentation/PunctuationRuntime.ts src/lib/segmentation/PunctuationRuntime.test.ts
git commit -m "feat(segmentation): add PunctuationRuntime over one lazily created worker"
```

---

## Task 11: Quality regression against the benchmark corpus

The shipped adapters must reproduce the measured numbers, or a port bug would ship silently. The benchmark harness already scores everything; this task teaches it to load the production code.

**Files:**
- Create: `benchmark/punctuation-restoration/models/app-adapters.mjs`
- Create: `benchmark/punctuation-restoration/app-parity.test.ts`

- [ ] **Step 1: Write the harness shim**

`benchmark/punctuation-restoration/models/app-adapters.mjs` exposes the three shipped adapters through the harness's `{ info, create(deps) }` contract, so `eval-quality.mjs --models app-fireredpunc,app-edge-punct-en,app-sat` scores them with exactly the same code that scored the ports. The harness calls `mod.create({ ort, Tokenizer, readFile, executionProviders })` and then `model.punctuate(input, lang)`; the shim adapts `PunctuationAdapter.run()` to that, returning `result.text` for the two punct models and, for SaT, the text with `'\n'` at each boundary so `hypothesisFor` scores it as `output: 'boundary'`.

- [ ] **Step 2: Write the vitest entry that skips without cached models**

`benchmark/**` is **not** in `vitest.config.ts`'s exclude list, so a test file there runs in CI. It must therefore skip itself cleanly:

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE = join(homedir(), '.cache', 'sokuji-punct-bench');
const haveModels = existsSync(join(CACHE, 'fireredpunc-onnx', 'punc.q8w.onnx'));

describe.skipIf(!haveModels)('shipped punctuation adapters reproduce the benchmark', () => {
  it('matches the measured breakpoint F1 within 0.5 points', async () => {
    // Runs eval-quality.mjs against models/app-adapters.mjs and compares with
    // the numbers in docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md:
    //   zh FireRedPunc breakpoint F1 91.5
    //   en Edge-Punct breakpoint F1 92.3
    //   ja SaT sentence-end F1 94.1, ko 90.9, ru 96.6
    expect(true).toBe(true);
  }, 600_000);
});
```

Fill the body in with the real comparison; the `describe.skipIf` guard and the 10-minute timeout are what make it safe in CI.

- [ ] **Step 3: Run it locally with the models present**

Run: `npm run test -- benchmark/punctuation-restoration/app-parity.test.ts`
Expected: PASS locally. On a machine without `~/.cache/sokuji-punct-bench/`, expect SKIPPED.

- [ ] **Step 4: Commit**

```bash
git add benchmark/punctuation-restoration/models/app-adapters.mjs benchmark/punctuation-restoration/app-parity.test.ts
git commit -m "test(segmentation): score the shipped adapters on the benchmark corpus"
```

---

## Task 12: Renderer memory measurement

The spec calls this out as a must-measure-before-shipping: WebGPU sessions kept an extra 1.1–1.9 GB of renderer working set in the benchmark, unexplained. It has to be answered before slice 3 wires anything to a session.

**Files:** none (a measurement, recorded in the notes file)

- [ ] **Step 1: Measure**

Use `benchmark/punctuation-restoration/tools/electron-bench.cjs`, which already mirrors the app's GPU switches (`enable-unsafe-webgpu`, `enable-features=Vulkan,SharedArrayBuffer`) and reads `app.getAppMetrics()`. Load each model through the **shipped** worker entries (not the benchmark ports) and record renderer and GPU-process working set: idle, after load, after 50 calls, after unload.

- [ ] **Step 2: Try the two candidate fixes**

Release the model bytes after `InferenceSession.create` returns, and try ORT's arena settings. Record whether either recovers the 1.1–1.9 GB.

- [ ] **Step 3: Record the answer**

Append a section to `docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md` with the table and the verdict. If the memory is not recoverable, say so and state the consequence for slice 2: idle unload has to be more aggressive than 2 minutes, and the memory guard may need to rise above 4 GB.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md
git commit -m "docs(segmentation): measure renderer memory for the shipped workers"
```

---

## Done when

- `npm run test` is green and `npx tsc --noEmit` is clean.
- `src/lib/segmentation/` holds a runtime nothing imports yet.
- The three models are in the manifest, downloadable, and absent from every engine and model-management surface.
- The shipped adapters reproduce the benchmark numbers on the corpus.
- The WebGPU memory question has an answer in the notes.

Slice 2 adds the settings, the store and the section UI; slice 3 wires Local Inference and Local Native; slice 4 does the online providers, the first-download notice, diagnostics and analytics.
