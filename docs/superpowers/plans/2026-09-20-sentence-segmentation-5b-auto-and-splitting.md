# Sentence Segmentation — Slice 5 phase 2: Auto Everywhere, and Splitting What a Server Decided — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps phase 1 shipped deliberately — the local engines cannot punctuate without splitting, and the five splittable server-definite providers cannot split.

**Architecture:** Auto (size 0) becomes a value a client can actually receive and act on, instead of one the resolver hides. A provider whose boundaries someone else decides gains a size of 1–5, which splits its already-final text into N-sentence items; a local engine gains Auto, which means it stops building a `SentenceStream` and punctuates the utterance whole. No new surface, no new setting: the capability table gains three `true`s and the clients learn what the numbers mean.

**Tech Stack:** TypeScript, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`, Amendment A2. Phase 1's carry-forward names both gaps: `docs/superpowers/notes/2026-09-20-sentence-segmentation-slice-5-carry-forward.md`.

**Depends on:** slice 5 phase 1, all landed on this branch.

---

## Global Constraints

- **English only** in code, comments and commits; real translations in all 30 locale catalogs if a key is added.
- **Typecheck baseline is 319 errors**; zero new ones.
- **Run the suite as** `npx vitest run --exclude ".superpowers/**"`. Four unhandled rejections in `settingsStore.nativeGate.test.ts` are pre-existing.
- **A server's boundary is still the server's.** Splitting a definite segment adds cuts *inside* what the server sent; it never merges two of them, never moves the outer edges, and never reorders.
- **Never push, never open or edit a PR.** The controller commits per task.

## The capability table after this slice

| Provider | phase 1 | now |
|---|---|---|
| OpenAI Live, OpenAI Translate (+ Kizuna twin), Gemini | `{ pause: true, auto: false, sizes: true }` | unchanged |
| Soniox (+ twin), Volcengine ST, Volcengine AST2 (+ twin), Palabra, Zoom | `{ pause: false, auto: true, sizes: false }` | **`sizes: true`** |
| OpenAI Realtime, OpenAI-Compatible | `{ pause: false, auto: true, sizes: false }` | unchanged — its GA client attaches audio to items, so a split would strand the karaoke timing |
| Local Inference, Local Native | `{ pause: false, auto: false, sizes: true }` | **`auto: true`** |

---

## Task 1: Auto becomes a value, not a hole

**Files:**
- Modify: `src/components/MainPanel/segmentationForProvider.ts` (+ test), `src/components/MainPanel/MainPanel.tsx`
- Modify: the seven descriptors in the table (+ `descriptorRegistry.test.ts`)

**Interfaces:**
- Produces: `ProviderSegmentation.sentencesPerChunk` may now be `0`, and `0` means Auto to every client. Tasks 2 and 3 consume exactly that.

- [ ] **Step 1: Write the failing tests.** `segmentationForProvider` returns `sentencesPerChunk: 0` for Auto on a provider that also offers sizes, instead of throwing; the registry table asserts the three changed rows; a sweep over every provider × mode × stored size still yields a state the section can render and a client can use.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement.** Delete the throw (phase 1 put it there to force this task to exist) and pass `size` through as `sentencesPerChunk`, 0 included. Flip the three capability rows. Check the Kizuna twins' `...base` spread rather than assuming.
- [ ] **Step 4: Run, typecheck, commit.** Clients still ignore a 0 at this point — they treat it as their own default — so nothing changes for a user yet. Say that in the commit body.

---

## Task 2: A definite segment can be split

**Files:**
- Modify: `src/services/clients/punctuateDefinite.ts` (+ test)
- Modify: `SonioxClient.ts`, `VolcengineSTClient.ts`, `VolcengineAST2Client.ts`, `PalabraAIClient.ts`, `ZoomAIClient.ts` (+ tests)

**Interfaces:**
- Consumes: `sentencesPerChunk` of 0 (Auto, today's behaviour) or 1–5.
- Produces: a second export beside `punctuateDefinite`, which returns the pieces rather than one string. Name it and document it so the five call sites read the same way.

- [ ] **Step 1: Write the failing tests for the helper.** With a size of 0 it returns exactly one piece, byte-identical to what `punctuateDefinite` returns today. With 1–5 it returns the punctuated text cut every N sentence ends, the remainder as a last piece, and never an empty piece. A text with fewer than N sentence ends is one piece. The sentence-end rule is `sentenceEnds` from `sentenceEnd.ts`, the same one the stage counts with — not a new regex.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement the helper.**
- [ ] **Step 4: Make each of the five clients emit one item per piece.** This is the task's real work and every one of slice 4's lessons applies:
  - the write-ordering lane still orders the writes, and a split segment's pieces are one unit within it — they must not interleave with the next segment's;
  - `disconnect()`'s flush must write every piece, not the first, and must write raw text when the punctuation never arrived;
  - `createdAt` decides the rendered order (`MainPanel` sorts by it), so pieces of one segment need increasing timestamps captured before the await, the way the Volcengine clients already capture theirs;
  - a client that pairs a source item with a translation item must not break that pairing when one side splits into three and the other into two — say in your report what each client does about it;
  - none of these five attaches audio to an item; verify that per client rather than trusting this sentence, and stop if one does.
- [ ] **Step 5: End-to-end for two clients, not one.** Soniox (which has `detectedLanguage`) and Volcengine ST (which does not): a long unpunctuated definite segment at N = 2 becomes two items with the server's outer boundary intact, and the same input at Auto stays one item.
- [ ] **Step 6: Run, typecheck, commit.**

---

## Task 3: Auto on the local engines

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts`, `LocalNativeClient.ts` (+ tests)

- [ ] **Step 1: Write the failing tests.** With `sentencesPerChunk: 0` the client builds no `SentenceStream`, emits one item per utterance exactly as it does with the stage off, and the final text carries the punctuation the model filled in. With 1–5 nothing changes from today. With the stage off, nothing changes from `main`.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** Auto is the `punctuateDefinite` shape, not the stream shape: the utterance's final text goes through the same helper the server-definite clients use, and the streaming partials stay raw. Both clients already hold a frozen `sessionSegmentation`; the size is the session's too, so decide once per session which shape a client is in and say so in a comment. Do not leave a stream built but inert — slice 4 paid for that.
- [ ] **Step 4: Run, typecheck, commit.**

---

## Task 4: Look at it, and write it down

- [ ] **Step 1: Run everything.** Full suite green, typecheck at 319.
- [ ] **Step 2: Render** the section on a server-definite provider (Auto plus 1–5 now) and on a local engine (Auto plus 1–5) at 450 and 300 px, in de, ru, ja and ar, with the probe in `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/render/`.
- [ ] **Step 3: Write `docs/superpowers/notes/2026-09-20-sentence-segmentation-slice-5b-carry-forward.md`:** what closed, what each client does about translation pairing when the two sides split differently, and what is still true of OpenAI Realtime (Auto for ever, and why).
- [ ] **Step 4: Commit.**

---

## Done when

- Every provider that can split offers 1–5, and choosing 3 on Soniox produces three-sentence bubbles inside the server's own segment boundaries.
- Every provider whose boundaries someone else decides offers Auto, including the local engines, where it means one bubble per utterance with the punctuation filled in.
- OpenAI Realtime still offers Auto alone.
- With the mode Off, every provider behaves as it does on `main`.
- `npx vitest run --exclude ".superpowers/**"` is green and `npx tsc --noEmit` stays at 319.
