# Client contract — Stage 2 follow-up: the translation follows the source's cuts (OpenAI Translate and Gemini Live Translate)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–3 are **the owner's decisions** (2026-09-30, in conversation, on the spike he asked for): the rule itself — 「按你方案先spike测试，看看测试结果如何」, then, on its results, 「如果测试结果好，就按你推荐」 (ruling 1; the spike's results were good: research notes); the translation segment stating its origin, the recommendation he accepted with it (ruling 2); and Gemini Live Translate too — 「的确Gemini Live Translate有同样的问题」 (ruling 3). Where a ruling leaves a sub-decision to this plan, the answer is a numbered *choice* below, and the self-review lists each one. **Choices 7, 8 and 9 go beyond what the spike ran** — cases its three sessions never met, found while writing — and are marked so wherever they land. **Revision 1** carries the controller's rulings on the plan's independent review (2026-09-30; Ready after fixes — 1 Critical, 2 Important, 10 Minor), binding like the rest: the terminal marks of the scripts ruling 1 does not name, and the mid-sentence hold only once the translation's stream has shown a sentence end (C1; choices 3, 6 — a stated departure, not an owner's question); a translation beginning for a newer open source drops the stale cuts, a translation that follows no cut continues the source that closed last, and typed text clears that continuation (I1; choices 8, 9, 12); one sentence-end rule shared by every count, with the cases that pin it (I2; choice 3); and the ten Minors, among them a fourth fixture from a recorded Gemini Live Translate session and the new starting point `43437057` (the self-review lists each). The controller ruled choices 7–9, with those fixes, adapter heuristics serving the owner's stated goal, not his decisions: none is left open for him. **Revision 2** carries the controller's rulings on the re-check of Revision 1 (2026-09-30; Ready after fixes — 0 Critical, 1 Important, 3 Minor), binding likewise: no mid-sentence hold for a target whose script writes no sentence-final mark — a Thai or Lao target, read from Gemini Live Translate's config — since one stray Latin mark latched the hold for the whole session (N1; choices 6, 12), and Khmer's `។៕` counted as the other scripts' marks (N1, M3; choice 3); the Gemini fixture named as the push-to-talk session it is (M1); and a case that the pause to begin ends once a translation begins (M2). This plan runs after the Stage 2 Gemini hold plan, whose code and record have landed in the same worktree (`95860d69` through `0a421e1f`), and after the spike (`8a177214`); every anchor is by content.

**Goal:** On OpenAI Translate and Gemini Live Translate — the two providers whose streams have no turns, so the adapter cuts both sides — give each source segment its own translation, as the owner's live session did not: the source is still cut by its own silence timer, and the translation is **cut where its source was**, stating that source as its origin, so the panel groups each pair as *stated*, never by proximity. Concretely:
- **A source segment that closes owes the translation one cut:** `{ origin, n, lastAt }` — `n` its sentence ends, at least one; `lastAt` the request clock's time of its last delta.
- **The cut:** once the open translation holds `n` sentence ends, the latest of them arriving strictly after `lastAt`, the next translation delta closes it and opens the next segment with itself. Audio that arrives before that delta stays with the segment that closes.
- **Sentence ends:** a CJK `。？！` wherever it stands, a Latin `.?!` only before whitespace or at the end — and the marks of the scripts ruling 1 does not name, Hindi's `।` and Khmer's `។` among them, as the CJK ones (choice 3). One rule, shared by every count.
- **The translation's own quiet** still closes it, but only at a sentence end: a translation that stops mid-sentence waits once more, to 5 s after its last activity — once its stream has shown a sentence end, and never for a target whose script writes none (Thai, Lao), which would otherwise be held for good (choice 6). A quiet close takes the cut owed first as its origin, and drops any other still owed (choice 8).
- **OpenAI Translate's output frames below RMS 0.002** — its noise floor — neither open the translation nor hold it open; they still play inside an open one (ruling 1 (vii); choice 11). Gemini's audio keeps its own rules (ruling 3).
- **Each translation cut is framed** for the Logs, `translation.cut`, with why it closed (choice 14).

On the spike's three recorded sessions (19 source segments), today's rule, through the panel's own pairing, puts 12 sources beside a translation and leaves 3 translations standing alone; this plan's, **19 of 19, stated, none alone** — by pause and by sentence, and with the translation's pause at 3 s, where the cuts alone do the work; and 19 of 19 with the translation's marks rewritten as Hindi's dandas (research notes, "Found while writing" 1–2; "Found in review" 1). On a recorded Gemini Live Translate session, 2 of 2, stated, none alone, where today's half, at a 0.8 s translation pause, leaves seven fragments alone ("Found in review" 4).

It ends with the controller's docs task and the owner's live test (Task 4).

**Architecture:**
- **A new pure module, `src/lib/segmentation/continuousSegments.ts` (`ContinuousSegments`)**, on the request's clock: both sides of a continuous interpreter — the source's segments, its silence timer and its mid-sentence deferral (moved, not changed), the translation's segments, the cuts the sources owe, the origins, and the translation's audio with its ranges by arrival. One class, because both sides share one ref counter and the source's close is the cause of the translation's cut (choice 1). It says each cut to an optional callback.
- **OpenAI Translate's `segments.ts`** becomes a wrapper around it: what is its own is the noise floor (`wire.ts` gains `QUIET_RMS` and `isQuietFrame`) and the `.done` events (choices 11, 13).
- **Gemini's `turns.ts`** hands its Live Translate half to the module — the dialogue half is untouched — reading the source with Gemini 3.x's CJK spaces removed; its audio neither opens nor holds a translation, as before (ruling 3; choice 12). Its adapter turns the module's mid-sentence hold off for a Thai or Lao target (`writesSentenceMarks`, choice 6); OpenAI Translate's thirteen targets all write marks, and it keeps the hold.
- **Each adapter** frames `translation.cut` (`out`) from the module's callback (choice 14).
- **The recordings:** the spike's three sessions and one recorded Gemini Live Translate session as four small JSON fixtures, a committed generator that writes them from the git-ignored recordings, and a test-only replay (`replay.testing.ts`, under the kit rule) that feeds a leg at each event's own arrival time and reads the result through L1 and L2 — the panel's own pairing (choice 15).
- **`sessionSide.consistency.test.ts`** gains two lines: the kit rule covers every `*.testing.ts`, and the session-side timer scan reads the shared module by name, which the walk does not reach (choice 1).
- **Unchanged:** the contract (`segmentOpened` / `segmentClosed` already carry `origin?`), L1, L2 (`pair.ts` infers only for segments that state no origin, and both providers now state every spoken source's), the runner, the view, `GeminiTurns`' dialogue half, `hold.ts`, both providers' `tail.ts`, `config.ts`, `settings.ts`, the settings views, the stores, the locale catalogs. No contract change, no new locale key, no store change.

**Tech Stack:** TypeScript (strict), Vitest, the adapter test kit (`trackedClock`, `createVirtualClock`, `recordEvents`, `eventsFrom`, `FakeSocket`, `runScenario`), L1 (`Conversation`) and L2 (`createProjector`) in the replays, `tsx` for the generator, `SENTENCE_CLOSERS` (`src/lib/segmentation/sentenceEnd.ts`) and `DEFAULT_SEGMENT_PAUSE_MS` (`src/lib/segmentation/segmentationMode.ts`), both pure constants.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended through the Stage 2 Gemini hold plan's record. The parts this plan meets: D6 (source↔translation: "stated by the client where the provider supplies one; inferred in L2 otherwise"); "L0 — the client contract" (`segmentOpened` / `segmentClosed` with `origin?`; every timer on the request's clock; the `frame` bullet); "L2 — the projection" (origin inference, F16's window); "Segmentation is one fact"; "Provider capability" (the pairing column of `OpenAITranslateGAClient` and `GeminiClient`). Task 4 amends it.

**Research notes:**
- **The evidence:**
  - the owner's live session (2026-09-30), the problem: OpenAI Translate cut each side by that side's own silence timer (`src/providers/openai_translate/segments.ts`), as Gemini's Live Translate half does (`src/providers/gemini/turns.ts`, which `segments.ts` was copied from), and neither states an origin, so L2 pairs by proximity (`src/lib/projection/pair.ts`: a translation pairs with the nearest unpaired source opened within 4 s before it). A continuous interpreter uses the speaker's pauses to catch up, so its own pauses are shorter — 1.0–1.4 s measured where the speaker paused 1.8–2.4 s: the source splits into rows, the translation does not, and several source rows end up with no translation, their translations all inside one earlier translation segment. And OpenAI Translate's near-silent output frames (RMS 0.0001–0.0009, not exactly zero) count as content audio and re-arm the translation's timer;
  - the spike, committed `8a177214`: `scripts/dev/wire-probe/openai-translate.mts` (`simulate`, rule `proposed`, hand `arrival`; `GUARD=arrival` guards by arrival instead of `elapsed_ms`) — its `proposed` rule is this plan's reference behaviour; its first version counted `。` only before whitespace and cut one sentence early (its header records the bug);
  - its three recorded sessions and its report, git-ignored, under `.superpowers/wire-probes/openai-translate/`: `2026-09-29T17-19-57-user` (the owner's six sentences with his own pauses: 500, 2 400, 400, 2 200, 1 800 and 1 400 ms), `2026-09-29T17-21-44-tight` (every pause 1.7 s, just over the source's 1.5 s) and `2026-09-29T17-24-18-long` (an eight-sentence mix), each a `.jsonl` of every frame's arrival and `elapsed_ms`, the output pcm and the input clip; `report.md`;
  - two recorded Gemini Live Translate sessions (`gemini-3.5-live-translate-preview`, ja → en), git-ignored, under `.superpowers/wire-probes/gemini/`: `2026-09-28T19-15-21-translate-…` and `2026-09-28T19-41-14-translate-…` — each transcription's and audio part's arrival, no RMS;
  - the plan's independent review (Revision 1's source): `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/translate-cuts-plan-review.md`, its scratch and the fixes it tried under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/translate-cuts-review/` (`variant-f.ts`, `terminals.test.ts`, `explore.test.ts`, `typed.test.ts`, `fuzz.test.ts`, `measure.test.ts`); the controller's rulings on it: `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/translate-cuts-plan/rulings1.md`.
- **What the spike showed:** three real sessions, 19 source segments. Today's rule: 12 paired, 5 translation fragments orphaned (empty audio-only segments among them). The rule: 19 of 19 paired, none orphaned, each translation segment's audio saying its text (whisper-1's word timestamps), bar one word — the next sentence's first word, whose audio arrived before its text — landing in the previous segment twice across 16 sentence boundaries; handing the audio over by arrival was best of the three hand-offs it compared. With either guard (`elapsed_ms`, or arrival).
- **Found while writing** (at `8a177214`, in the scratch copy):
  1. **Through the panel's own pairing** (L1, then L2, as this plan's replays read it), today's rule puts 12 of the 19 sources beside a translation and leaves 3 translations standing alone (`user` 5 of 6; `tight` 4 of 6 and 2 alone; `long` 3 of 7 and 1 alone): the spike's 5 orphaned fragments include empty audio-only segments, which L2 draws as no row. By sentence, today's rule also pairs 12, and leaves none alone; with the translation's pause at 3 s, 3 of 19, and 3 alone. Gemini's Live Translate half today, fed the same deltas under its own audio rules, 15 of 19, and 4 alone. This plan's rule: 19 of 19, stated, none alone, in all four.
  2. **On these sessions the cuts alone suffice:** with the translation's pause at 3 s — past every pause the interpreter made — the rule still pairs 19 of 19; and treating the noise floor as speech (ruling 1 (vii) undone) changes no pair on them. Ruling 1 (vii) is pinned by its own cases (the self-review's P1, P2).
  3. **At the default pauses most translations now close on their own quiet, not at a cut** — 5 of 6, 5 of 6 and 4 of 7 — because the noise floor no longer holds them open; the cut does the work where the interpreter pauses less than its own pause, the owner's live case, which each suite pins with a case of its own.
  4. **Three cases the spike never met**, found by sweeping the pause settings over the recordings and by constructing them (choices 7–9):
     - a translation that goes quiet at a sentence end with nothing owed while its source is still open — the interpreter caught up, the speaker still talking; likelier once the translation's pause is set shorter than the source's. The spike would close it with no origin: an orphan;
     - a source the interpreter never translates — a filler, the target language spoken (Live Translate "produces nothing": the Gemini section's live-test item 8), a fragment of a sentence split by a short source pause. Its cut would take the next source's translation, and the one after it, across every real pause: the brief's "an error does not propagate past a real pause" holds only if a quiet drops it — and, when the next sentence begins before that quiet, only if a translation that begins for it drops the stale cut (Revision 1, "Found in review" 2);
     - a translation with nothing owed and no source open — the rest of a translation cut one sentence early, or a translation that began after its own cut was dropped: an orphan too.
  5. **The sweep** (the review's, re-run on Revision 1's code): 36 settings — the source's pause 1, 1.5 and 2 s, the translation's 0.5–3 s, by pause and by sentence — over the three recordings, through both OpenAI Translate's `TranslateSegments` and Gemini's `GeminiTurns`: 1 344 of 1 380 sources beside a translation, and no translation alone in any run; Revision 0's code gave the same counts. **A source pause below the transcript's own gaps splits sentences** (a 1 s source pause over `user`: its last sentence's transcript arrived as 店里的 / 贩卖机 / 竟然不支持…, with just over 1 s — 1 021 and 1 010 ms — between those deltas). The interpreter waits for the sentence; the first two fragments' cuts are dropped (choice 8) and the translation sits beside the last: 6 of 8 sources paired, none alone, where today's rule pairs 5 of 8 and leaves none alone. "What this plan leaves".
  6. **The spike counted sentence ends per delta:** a Latin terminal that ended one delta counted at once. Ruling 1 (iii) says "only before whitespace or the end", which across deltas needs the next delta's first character — "1." then "5" is no end (choice 3). The recordings hold no such case, so their replays are the same either way; Task 1's cases pin it (the self-review's A5, B6).
  7. **Ruling 1 (ii)'s "at least one" is implied by the guard:** a cut is due only when an end arrived after `lastAt`, so it needs one end whatever `n` says; kept as the ruling's own words (the self-review's M3, an equivalent mutant).
  8. **The session-side guard does not follow `src/lib/**`** (`sessionSide.consistency.test.ts`, "The limit"): the module's own test pins its clock rule — at stop, in every state that holds a timer, none is left — and, since Revision 1, the guard's timer scan reads the module by name (choice 1).
  9. **The contract already carries a stated origin both ways**, and every layer above keeps it: `segmentOpened` / `segmentClosed` take `origin?` (`src/lib/contract/adapter.ts:77-80`); L1 keeps the origin a close states (`Conversation.close`, `src/lib/conversation/Conversation.ts:230-234`: `origin ?? seg.origin`); L2 groups by it and infers only for segments that state none (`pair.ts:25-26`). OpenAI Realtime's landed form states the origin when a segment opens and closes it with `{ ref }` (`src/providers/openai/items.ts:219-248`): this plan does the same wherever the origin is known at the open (choice 5).
  10. **OpenAI Live is next in Stage 2 and meets the same question** (its survey, `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-openai-live-survey.md`, question 3: proximity will pair its translations, 4–30 s late, with the next sentence). `ContinuousSegments` is the candidate there — its source is cut by its own rules, and the translation can follow those cuts; not built here.
- **Found in review** (Revision 1; the independent review, and the controller's rulings on it, 2026-09-30):
  1. **A target whose sentence end is neither `。？！` nor `.?!` collapsed every translation into one row** (C1). With the three recordings' translation marks rewritten as Hindi's danda, today's rule paired 12 of 19 and Revision 0's rule 3: no cut was ever due, every quiet read as mid-sentence, the 5 s hold never ran out. With no marks at all (Thai, Lao), 3 of 19 again. Hindi is one of OpenAI Translate's thirteen targets; Gemini Live Translate offers Hindi, Bengali, Marathi, Urdu `۔`, Arabic `؟`, Burmese `။`, Armenian `։`, Amharic `።`, Thai and Lao among its 78. Revision 1's rule — the other scripts' marks counted as the CJK ones, and the hold only once the stream has shown a sentence end (choices 3, 6) — pairs the danda sessions 19 of 19 and the no-mark ones 18 of 19 through the module (15 of 19 through OpenAI Translate's segments, whose speech audio holds a translation open as a delta does), none alone; the recorded ones are unchanged. Rulings 1 (iii) and (vi) name no mark for these scripts: how they read there is a stated departure (Task 4).
  2. **Choices 8 and 9, as Revision 0 wrote them, mis-paired three plausible cases that today's proximity pairs right** (I1): (a) a filler, or a sentence in the target language, then the next sentence within about the translation's pause plus the interpreter's lag — the next translation took the filler's cut, and the sentence it translates stood alone, until the next quiet; (b) a translation beginning more than its pause after its source closed, with no source open — its cut dropped, it joined the previous exchange as the last one paid; (c) an answer to typed text on Live Translate, should one come — it streamed beside its typed row, inferred, then jumped into the last spoken exchange at its close. The review's fixes, tried in its scratch and ruled: a translation that begins, within its pause to begin, while a newer source is already open follows that source and drops the stale cuts (choice 8); a translation that follows no cut continues the spoken source that closed last, not the last one paid (choice 9); typed text clears that continuation (choices 9, 12). The 36-setting sweep gives the same counts with them.
  3. **The translation side's count was under-pinned** (I2): its per-delta reading re-implemented the source's count, and six mutants survived the full suites — a Latin mark within a delta counted without the whitespace after it ("1.5" in one delta), a CJK mark within one counted only before whitespace (the spike's own first bug, on the side that decides every cut for en → ja and en → zh), the first end's time read where ruling 1 (iv) says the last, three ways, and a settled trailing end stamped with the next delta's arrival. One rule now serves every count (`endsSentence`, choice 3), and the cases that pin it are Task 1's.
  4. **Two Gemini Live Translate sessions had been recorded** (`.superpowers/wire-probes/gemini/2026-09-28T19-15-21-…`, `…19-41-14-…`), which Revision 0 said none had. The second is the fourth fixture. **It is a push-to-talk session** (automatic activity detection off: the clip went up in two presses, 2.5 s apart — Revision 2, M1): its source splits mid-sentence (お手伝い | します。, 3.6 s apart) at the gap between those presses, not at a speaker's pause; and today's half at a 0.8 s translation pause leaves seven translation fragments alone. Through this plan's `GeminiTurns`, 2 of 2, stated, none alone, at 1.5 s and at 0.8 s — the first translation closing at "…I'm" where the source did, its mid-sentence pause coming before the stream's first sentence end (choice 6's cost; "What this plan leaves"), and "here to help." with the source that holds します。. By sentence, "…I'm here to help." with the first.
  5. **The Minors** (the self-review lists each): the hold's constant pinned; the continuation case with two paid cuts; a quiet close with a cut owed while the next source is open; the replay named `replay.testing.ts` under the kit rule; the module in the session-side timer scan by name; closing quotes skipped before a text's last mark; `GeminiTurns` Live Translate by its kind alone; the new starting point.
- **Found in re-check** (Revision 2; the re-check of Revision 1, `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/translate-cuts-plan-rereview.md`, and the controller's rulings on it, 2026-09-30):
  1. **The "shown an end" gate latched for the session** (N1): in a Thai or Lao translation — the scripts it exists for — one early Latin mark (a question mark, an era's abbreviation "พ.ศ.", a decimal split across deltas) turned the mid-sentence hold on for good, and C1's collapse came back: with the three recordings' translation marks removed but the first one kept, 4 of 19 through either provider, where today's rule pairs 12. Thai text carries such marks routinely. The fix, ruled: the module takes `holdMidSentence`, and Gemini's adapter turns it off for a `th` or `lo` target (choices 6, 12) — the same run then pairs 18 of 19 through the module, none alone, as with no marks at all; OpenAI Translate's thirteen targets all write marks, so it keeps the hold. The gate stays: under the key it only decides when a session's first hold may start in a script that writes marks, the trailing-Latin-mark trigger with it (the re-check accepts it with this fix). And Khmer's `។៕` are counted (choice 3): Khmer, a Live Translate target, writes `?` too, so it would have latched the same way.
  2. **The Gemini fixture is push-to-talk** (M1): named so in "Found in review" 4, choice 15, the generator's comment, the replay's header and the replay case.
  3. **That the pause to begin ends when a translation opens was unpinned** (M2; the re-check's mutant R-F1c, `beginning` not cleared at the open, survived): a translation that began inside the pause to begin, cut at its sentences while the speaker is on a newer source, would have its next segment drop the owed cut and follow the open source. The case now pins it (Task 1).
  4. **Khmer is no longer a leftover** (M3); Tibetan and Greek stay, as stated.
- **A scratch copy of the tree** at `8a177214` (a `git archive`, `node_modules` linked, outside the repository, 2026-09-30) ran every code and test block below before it was written down; each block is that copy's file, and every diff is generated from it; Revisions 1 and 2 were written the same way on a scratch copy of `43437057`. Each task's red step was run against the code before the task and each green step after it, with the counts quoted in the steps; then the plan as revised (Revision 2) was replayed on a fresh copy of `43437057`, task by task, from this document's own blocks — every diff taken by `patch -p1`, every new file written from its block, the recordings generated by the generator block and checked against the hashes quoted — and every step's count came out as quoted. At `43437057` (as at `8a177214`): **573 files passed and 1 skipped, 7 453 tests passed and 2 skipped**. After Wave 1: **574 files passed and 1 skipped, 7 492 tests passed and 2 skipped**; after Wave 2: **576 files passed and 1 skipped, 7 509 tests passed and 2 skipped**; no unhandled errors; the typecheck gate exactly the baseline's 20 lines after each wave, and the full tree at 259 lines, none naming a new file. Sixty-one hand mutants ran against the result — the review's and the re-check's survivors among them — and fifty-seven failed at least one test; the other four are equivalent (the self-review lists them). The review's seeded fuzz, 3 000 seeds, its vocabulary widened by a danda and a Thai delta, found no violation of its invariants, on Revision 1 and again on Revision 2.

## Global Constraints

- **Starting point.** `43437057` on `worktree-client-contract-stage2` (Revisions 1 and 2). Since the spike, `8a177214`, two probe commits of another session have landed in this worktree, `2b9d891a` and `43437057`, and this plan's own `726c0d34`: they touch only `scripts/dev/wire-probe/live.mts` and this document, so `src/` is byte-identical to `8a177214`'s, and `docs/` differs by this document alone. Since `43437057`, two documents only: this plan's Revision 1, `89f8b53f`, and the session-end-and-wizard plan, `0a0a1f4d`. Task 1 writes into the same `scripts/dev/wire-probe/` folder: the pathspec commits keep another session's files out. The session-end-and-wizard plan (`docs/superpowers/plans/2026-09-30-client-contract-stage2-session-end-and-wizard.md`) executes after this one and shares three of its files, `src/providers/openai_translate/{wire,adapter,adapter.test}.ts` — `wire.ts`'s header and imports and `adapter.ts`'s `stop()` among its hunks; its own replay applied them on this plan's Revision 1 result, and Revision 2 changes none of this plan's hunks in those files. Every task anchors its edits by content, not by line: a line number cited here was read at `43437057`. Other commits may land first; every anchor is by content.
- **Edits shown as diffs.** A change to an existing file is a unified diff with its context lines, generated from the scratch copy; its hunk headers count the lines at `43437057`. Apply a hunk by its content all the same (`patch -p1` took every one in the replay). A new file is shown in full, and so is the one file rewritten whole, OpenAI Translate's `segments.ts`: replace its content. The recordings are not shown: the generator block writes them, and their SHA-256 hashes are quoted.
- **What this plan touches:**
  - `src/lib/segmentation/{continuousSegments,continuousSegments.test}.ts`, `src/lib/segmentation/recordings/{replay.testing.ts,user.json,tight.json,long.json,gemini-live-translate.json}` and `scripts/dev/wire-probe/translation-cuts-fixtures.mts` (all new), `src/providers/sessionSide.consistency.test.ts` — Task 1;
  - `src/providers/openai_translate/{wire,wire.test,segments,segments.test,adapter,adapter.test}.ts`, `src/providers/openai_translate/segments.replay.test.ts` (new) — Task 2;
  - `src/providers/gemini/{turns,turns.test,adapter,adapter.test}.ts`, `src/providers/gemini/turns.replay.test.ts` (new) — Task 3;
  - the spec and the roadmap — Task 4.
- **Read only.** `src/lib/segmentation/silenceDeferral.ts` (the module imports it, unchanged); `src/lib/contract/**`, `src/lib/conversation/**`, `src/lib/projection/**` (`pair.ts` included: it already leaves a stated origin alone); `src/providers/openai/**` (OpenAI Realtime's stated origins, the form followed); every other file of `src/providers/openai_translate/` and `src/providers/gemini/` (`tail.ts`, `hold.ts`, `config.ts`, `settings.ts`, `testing.ts`, the views and their tests); `src/lib/segmentation/sentenceEnd.ts` and `segmentationMode.ts` (their constants read); `src/services/**`, `src/stores/**`, `src/components/**`; the locale catalogs; `scripts/dev/wire-probe/openai-translate.mts` (the spike keeps its own `simulate`, the research instrument), `gemini.mts` and every other probe, `live.mts` another session's; `.superpowers/**` (the recordings: read, never written); `electron/**`, `extension/**`; `package.json` and the lockfile. `npx vitest run src/services` stays green.
- **Import rules:**
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock. `segments.ts` and `turns.ts` stay on their session sides and now value-import `src/lib/segmentation/continuousSegments.ts`, which imports only types from the contract, `./silenceDeferral` and `./sentenceEnd`'s `SENTENCE_CLOSERS` (both pure), and times only through the clock it is handed; `turns.ts` also imports `DEFAULT_SEGMENT_PAUSE_MS` (`segmentationMode.ts`, pure constants). The walk of `sessionSide.consistency.test.ts` does not follow `src/lib/**` ("The limit"): the module's own test pins its clock rule, and Task 1 adds the module to the guard's timer scan by name (research note 8; choice 1).
  - No provider imports another provider's folder: the shared module and the recordings live in `src/lib/segmentation/`.
  - The recordings and `recordings/replay.testing.ts` are test-only: the replay's `.testing.ts` name puts it under the kit rule, which Task 1 widens to every `*.testing.ts`, so a production import of it fails `sessionSide.consistency.test.ts` (it value-imports L1 and L2, which a session side must never reach).
- **Diagnostics** (CLAUDE.md, "Error Handling"): no adapter reports or logs; each says what happened through `frame`, as now. Nothing new is said but one frame.
- **Frames** (a Logs line each; never audio, never text, never a credential; the hot-path rule — one per translation segment, never one per delta): OpenAI Translate and Gemini gain `translation.cut` (`out`) — its payload in choice 14. No `logStore` row: the name is no one's row, and stands alone. Nothing in `src/`, `extension/` or `electron/` holds that name at `43437057` (checked).
- **Locales.** No new key.
- **No network.** No test or step calls OpenAI or Google. The generator reads local recordings and needs no key; the adapters are tested over `FakeSocket` on a virtual clock.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `43437057` on 2026-09-30, in a scratch copy: **573 test files passed and 1 skipped (574); 7 453 tests passed and 2 skipped (7 455); no unhandled errors.** The scratch copy's numbers after each wave (research notes) are references, not the gate: the gate is the rule. (The `Not implemented: window.open` stderr lines are pre-existing, `ChildWindowPopover`'s.)
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. Every provider file this plan edits is inside the regex; `src/lib/segmentation/` is not — the next bullet covers it.

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    The same command is `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh`; its output must equal `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate-baseline.txt` — exactly these **20** lines, re-measured at `43437057`:

    ```
    src/App.tsx: error TS6133: 'React' is declared but its value is never read.
    src/components/MainLayout/MainLayout.tsx: error TS6133: 'useTranslation' is declared but i
    src/components/Settings/sections/ProviderSpecificSettings.tsx: error TS6133: 'templateSyst
    src/components/Settings/sections/ProviderSpecificSettings.tsx: error TS6133: 'setTemplateS
    src/components/Settings/sections/SystemAudioSection.tsx: error TS2345: Argument of type '"
    src/components/Settings/sections/VoiceLibrarySection.tsx: error TS2345: Argument of type '
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/components/Subtitle/SubtitleBar.test.tsx: error TS2322: Type 'SessionControl' is not a
    src/lib/analytics.ts: error TS6133: 'response' is declared but its value is never read.
    src/routes/Home.tsx: error TS6133: 'React' is declared but its value is never read.
    src/stores/logStore.ts: error TS2345: Argument of type 'StateCreator<LogStore, [], [["zust
    src/stores/logStore.ts: error TS2554: Expected 0-1 arguments, but got 2.
    src/stores/settingsStore.ts: error TS2353: Object literal may only specify known propertie
    src/stores/settingsStore.ts: error TS2353: Object literal may only specify known propertie
    src/utils/environment.ts: error TS2717: Subsequent property declarations must have the sam
    src/utils/environment.ts: error TS2339: Property 'create' does not exist on type '{ query(
    ```

    Do not fix them; do not add to them. The TS lib is ES2020: no `Array.prototype.at`, `String.prototype.replaceAll` or `Array.prototype.findLast` in a test either.
  - **The full tree, for the files outside the regex.** `npx tsc --noEmit -p tsconfig.json 2>&1 | command grep -c 'error TS'` prints **259** (measured at `43437057`, the ceiling), and `npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -c 'src/lib/segmentation/'` prints **0**.
  - **Gates in a parallel wave.** Wave 2 runs Tasks 2 and 3 at once in this one working tree, so each sees the other's red phase:
    - a test failure, or an extra gate line, in a file the other task is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, the exact baseline, and the full tree's 259.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere its change could reach, it says why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides.
  - **No task mutates the tree to prove a guard, and no temporary file is written inside `src/`.** A mutant a reviewer wants to try runs in a scratch copy under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`.
- **Builds, at the group check only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
  - The new code shipped: `command grep -rlF 'translation.cut' build extension/dist` names at least one file under `build/` and one under `extension/dist/`.
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. The fixtures' generator is none of them: it reads local files, opens no socket, and Task 1 runs it.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, heredocs other than a commit's, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`, each agent in a directory named for its task and role (`t2-impl/`, `t3-review/`).
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: another plan's tasks stage into the same index. Never stage a whole directory.
  - Production comments cite this plan's rulings and choices as "(Stage 2 translation cuts, ruling N)" where a file first names the plan, else "(translation cuts, ruling N)" / "(translation cuts, choice N)"; the earlier plans' as they already do; never a task number, a review finding or a probe's file name. English only.
  - Never push.

## Rulings

Cited as *ruling N* (in code, "translation cuts, ruling N"). All three are the owner's (2026-09-30). Each is restated with where it lands.

1. **The translation follows the source's cuts — the spike's rule** (「按你方案先spike测试，看看测试结果如何 / 如果测试结果好，就按你推荐」; the spike's results were good). Its parts, cited as ruling 1 (i)–(viii):
   - (i) **The source side is unchanged:** its own silence timer, and in sentence mode the mid-sentence deferral, as today.
   - (ii) **When a source segment closes**, the translation owes one cut: `{ ref, n, lastAt }` — `n` the source segment's sentence ends, at least 1; `lastAt` the request clock's time of that segment's last delta.
   - (iii) **Sentence ends:** a CJK `。？！` wherever it stands; a Latin `.?!` only before whitespace or the end (not "1.5", not "U.S").
   - (iv) **The cut:** while cuts are owed, count the translation's sentence ends since its segment opened, and the clock time of the last one. When the count reaches the head's `n` and that sentence end came after the head's `lastAt` (strictly), the cut is pending — checked on each translation delta and when a cut is owed. The next translation text delta closes the translation segment (origin = the head's source, stated), pops the head, and opens the next segment with itself.
   - (v) **Audio by arrival:** audio arriving between the sentence end and that next delta stays with the closing segment; after it, the new one.
   - (vi) **The translation's own silence** still closes the segment, but only at a sentence end; a translation that stops mid-sentence (the interpreter waiting for the source) is held once more, to 5 s after its last activity. A silence close takes the owed head as its origin, if any (the resync: an error does not propagate past a real pause).
   - (vii) **OpenAI Translate's output audio:** a frame below RMS 0.002 (the Live client's `OUTPUT_SILENCE_RMS`) neither opens a translation segment nor re-arms its timer; it still plays in an open segment as today. Exact-zero frames stay heartbeats.
   - (viii) **The guard's clock** is the request clock (arrival), not `elapsed_ms`: the spike's `GUARD=arrival` gave the same 19 of 19, and Gemini stamps nothing. So one pure module serves both providers.

   Lands in: Task 1 (all of it but (vii); choices 1–10), Task 2 ((vii); choice 11), Task 3, Task 4.
2. **The translation segment states its origin:** the source segment whose cut it closed for — the recommendation the owner accepted with ruling 1. So L2 infers nothing for these two providers: the pairing is stated, by the adapter's own rule, as OpenAI Realtime's "newest unanswered" fallback is (Stage 2 OpenAI Realtime, choice 8). Lands in: Task 1 (choices 2, 5), Tasks 2 and 3 (the pairing through L1 and L2), Task 4 (D6, the capability table).
3. **Gemini Live Translate too** (「的确Gemini Live Translate有同样的问题」): its Live Translate half is cut by the same module, the text-side rule only — its audio keeps its own rules, never opening nor holding a translation and playing unattributed outside one (the Stage 2 Gemini plan's choice 8) — and its dialogue models are untouched. Lands in: Task 3 (choice 12), Task 4.

The standing rules hold: no one-time migration code (nothing is stored here), and production comments cite rulings and choices.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **One module, in `src/lib/segmentation/`, both sides.** `ContinuousSegments` owns the source's segments (its timer and the `SilenceDeferral` moved from each provider, unchanged — ruling 1 (i)), the translation's segments, the cuts owed, the origins and the translation's ranges by arrival. Both sides in one class because they share one ref counter — refs are never reused within a session (`src/lib/contract/adapter.ts:18`) — and because the source's close is the cause of the translation's cut. `src/lib/segmentation/`, beside `SilenceDeferral`, because no provider imports another's folder. What stays with each provider: OpenAI Translate's noise floor and `.done` events (choices 11, 13); Gemini's CJK spaces (handed in as `showSource`), its audio rules, typed text, a turn end and the reconnect (choice 12). The module is pure: a clock, a sink, an optional `cut` callback; its timers are the source's pause, and one for the translation — its pause, its mid-sentence hold, or, none open, its pause to begin. The session-side guard's walk does not follow `src/lib/**`, so its timer scan reads the module by name (Revision 1, Minor 6).
2. **A source states its origin when it opens: `s<ref>`.** Every source these two providers open states one, and a close never restates it — OpenAI Realtime's form (research note 9). So `pair.ts`, which infers only for segments that state no origin, leaves every one of them alone, as ruling 2 asks; a translation that states none — one that closes before any cut was paid (choice 9) — shows unpaired, as an OpenAI Realtime translation left with no origin does. Typed text on Live Translate is the exception, and states none (choice 12).
3. **Sentence ends: ruling 1 (iii), counted across deltas, by one rule — and the other scripts' marks.** One predicate, `endsSentence(mark, next)`, decides every count (Revision 1, I2): a mark of `ANYWHERE_ENDS` ends a sentence wherever it stands; a Latin `.?!` only before whitespace, and with nothing after it yet what follows decides — `undefined`. `countSentenceEnds(text)` counts with it, a Latin mark at the text's end counted ("or the end"); `atSentenceEnd(text)` asks whether the text, trailing whitespace and closing quotes and brackets (`SENTENCE_CLOSERS`) aside, ends on one (Revision 1, Minor 7); the translation counts its deltas with it as they arrive, a Latin mark that ends a delta settled by the next delta's first character and stamped with its own delta's arrival — so "It is 1." then "5" is no end, where the spike, counting each delta alone, counted one (research note 6). **`ANYWHERE_ENDS` is `。？！` and the marks of the scripts ruling 1 (iii) does not name** — Devanagari and Bengali `।॥`, Urdu `۔`, Arabic `؟`, Burmese `။`, Armenian `։`, Ethiopic `።`, Khmer `។៕` (Revision 2, N1), the fullwidth `．` and the halfwidth `｡` — counted like the CJK ones (the controller's ruling on C1). **A stated departure:** ruling 1 (iii) names CJK and Latin marks only; read for a script it does not name, a Hindi or Urdu target would never reach a cut, and every quiet would read as mid-sentence ("Found in review" 1); so that script's sentence end is its own mark. Not `sentenceEnd.ts`' rule (its `sentenceEnds`, which `cut.ts` uses for rows): its abbreviations and lowercase continuations were not what the spike ran, and ruling 1 names its own; only its `SENTENCE_CLOSERS` is read. A Latin mark inside a closing quote (`."`) is not counted, as ruling 1 (iii) reads ("What this plan leaves").
4. **The cut is due at the next translation delta.** Ruling 1 (iv)'s pending cut takes effect only there, so it is read there: before a delta is appended, the cut owed first is due when the open translation holds its `n` sentence ends — the delta read as the lookahead of a trailing Latin terminal — the latest arriving strictly after its `lastAt`. Then the open segment closes, and the delta opens the next. The same decision as the spike's flag, set on each delta and each source close, without the flag. Audio arriving before that delta goes to the open segment, the one that closes (ruling 1 (v)).
5. **The translation's origin is stated when it opens, when it is known then.** At its open, the cut owed first names it — unless it begins in its pause to begin with a newer source open, whose it then is (choice 8); with none owed, the source still open, whose cut is the next owed. Else it is stated when it closes: the cut it closes for, else the spoken source that closed last (choice 9). **Why at the open:** a translation stated only at its close has no origin while it streams, so L2 draws it apart — no source states none to pair it with — and it jumps into its source's exchange when it closes, every time. **The invariant**, pinned: a translation that states its origin at its open closes for that same cut, and never states another. Only its own close takes an owed cut, the drops of choice 8 happen at its close or with none open, and a source opened while it runs closes after the one it named.
6. **The translation's own quiet, and what counts as activity.** Its pause is the translation's setting, from its last activity: a delta, or audio that counts — OpenAI Translate's frames at or above the noise floor (choice 11); none of Gemini's (ruling 3). At its expiry: at a sentence end, it settles (choices 7, 8); mid-sentence, it waits once more — the hold, `MID_SENTENCE_HOLD_MS` = 5 000, measured from the last activity: a timer of `5 000 − its pause` armed at the expiry, which fired its pause after that activity, so no end is ever compared with `now()` (the release tail's lesson on the wall clock); activity ends the hold, and gives the next pause its hold again. In every mode: ruling 1 (vi) names none, and the translation side no longer reads the deferral, which stays the source's. **Only once the translation's stream has shown a sentence-end mark** — a counted end, or a Latin mark closing a delta, which may be one (the controller's ruling on C1): until the stream shows one, a pause is all there is, and the quiet settles at once. **And never for a target whose script writes no sentence-final mark** (the controller's ruling on N1, Revision 2): the module's `holdMidSentence` option, true by default, which Gemini's adapter sets false for a Thai or Lao target (choice 12). A script that writes none never reaches a sentence end, so every pause would read as mid-sentence; and the gate alone does not protect it, since one stray Latin mark — a question mark, an era's abbreviation, a split decimal — would show "an end" and hold every later pause for the session ("Found in re-check" 1). OpenAI Translate's thirteen targets all write marks: it keeps the default. The stated departure of choice 3 extends to ruling 1 (vi): "only at a sentence end" is unobservable in a script without marks. **The cost:** before a session's first translated sentence end, a translation that pauses mid-sentence closes at its pause ("What this plan leaves"; the Gemini fixture's first translation, "Found in review" 4).
7. **Beyond the spike: a translation with nothing owed waits for a source still open.** When its quiet comes at a sentence end — or after its hold — with no cut owed and a source open, it does not close: it is that source's translation, and closes for that source's cut. That source's close gives it its pause again, from there; activity meanwhile goes on as ever. The case: a translation that pauses at a sentence end while the speaker is still talking (research note 4) — likelier once the translation's pause is set shorter than the source's. The spike would close it with no origin, an orphan; here its source's cut pays it, and the translation of that source's rest joins it.
8. **Beyond the spike: a quiet settles what is owed.** A quiet close — its pause at a sentence end, the end of its hold, an endpoint's `.done` or a turn end (choices 12, 13) — takes the cut owed first as its origin, per ruling 1 (vi), **and drops every other cut still owed**; a cut at its sentences leaves them owed. And a source that closes with no translation open gives the translation its pause to begin; when none begins, every cut owed is dropped. **And a translation that begins within that pause while a newer source is already open follows that source, and drops the cuts still owed** (Revision 1, I1's F1): the speaker had moved on before the interpreter said anything for the sources that closed, so what begins now is the newer one's — the filler case, 「嗯。」 then the next sentence within about the translation's pause plus the interpreter's lag ("Found in review" 2 (a)). Both drops are framed `idle`. The pause to begin ends when a translation opens: the segment that follows a cut at its sentences takes the cut owed next, whatever source is open by then — it does not begin afresh (Revision 2, M2). **Why:** a source the interpreter never translates (research note 4) would otherwise leave its cut at the head of the queue, and every later translation would close for the source before its own, across every real pause. The interpreter translates in order and lags the speaker by about a second: once it has gone quiet for its pause, or said nothing for its pause after a source closed, or said nothing for a source until the next one had begun, what it has not answered it will not. With the drops, ruling 1 (vi)'s "an error does not propagate past a real pause" holds — a source never translated no longer shifts the translations after it, whether the next sentence starts after that pause or within it. **The cost:** a lagging interpreter that says nothing for a source until the next has begun — the trade the review named, pinned — puts that translation beside the newer source; and a translation that begins more than its pause after its source closed, with no source open, closes as that source's continuation (choice 9).
9. **Beyond the spike: with nothing owed and no source open, a translation continues the spoken source that closed last.** It closes stating that source's origin (Revision 1, I1's F2): the rest of a translation cut one sentence early, whose source has already been paid, or a translation that began more than its pause after its source closed, whose cut was dropped ("Found in review" 2 (b)) — where the last one paid would name the source before it. **Typed text clears it** (I1's typed reset): an answer to typed text, should Live Translate send one, then states no origin, and L2 pairs it with its typed row, which states none either — as today ("Found in review" 2 (c); choice 12). Before any spoken source it states none, and shows unpaired.
10. **The guard's clock, ruling 1 (viii).** `lastAt` and each sentence end are stamped with the request clock's `now()` as their deltas arrive: arrival, as the spike's `GUARD=arrival` did, for both providers. A wall clock stepped back between a source's last delta and the translation's sentence end makes the cut not due; the translation's quiet settles it instead (choice 8). `elapsed_ms` stays framed on every OpenAI Translate delta and read by nothing.
11. **OpenAI Translate's noise floor, ruling 1 (vii).** `wire.ts` gains `QUIET_RMS` = 0.002 — the Live client's `OUTPUT_SILENCE_RMS` — and `isQuietFrame(pcm)`: RMS **below** it, as ruling 1 (vii) words it (the Live client's own test is `<=`; the two differ only on a frame exactly at 0.002). `segments.ts` reads it: such a frame neither opens the translation nor counts as its activity; inside an open translation it plays with its range, as today; **outside one it is dropped, as a heartbeat is** — the spike dropped it too, and the Live client drops the noise floor everywhere ("noise for the timeline and for the conversation"). The adapter is unchanged but a comment: it still drops an exact-zero frame as a heartbeat before anything, and still frames every other frame with its RMS. **Not the release tail:** `tail.output()` still hears every non-heartbeat frame, as today; the tail's quiet (1 s) and cap (3 s) were tuned by their own live test, and a floor frame keeping it to its cap costs silence sent, not a cut ("What this plan leaves").
12. **Gemini Live Translate, ruling 3.** `GeminiTurns` builds a `ContinuousSegments` when `kind` is `'translate'` and hands it every Live Translate call: the input and output transcriptions; the model's audio, with `play` the leg's `speech` and never `active` — so it neither opens a translation nor holds one open, and plays with no ref outside one (Gemini choice 8, kept); the source read with its CJK spaces removed (`normalizeCjkSpaces`, as shown today). **Typed text** is a source row of its own, opened, written and closed at once, stating no origin and owing no cut — as today, now with a ref from the module's one counter: whether Live Translate answers typed text at all is still the Gemini section's open question (its live-test item 7); a cut owed to a text never answered would take the next spoken source's translation until a quiet. A text owing none clears the continuation origin (choice 9), so an answer that begins after it with nothing owed and no source open states no origin, and L2 pairs it with the typed row, as today; an answer that begins while a spoken source is open or owed joins that source's translation. **A `turnComplete` or an `interrupted`**, should Live Translate send one: the source closes (its cut owed) and the translation settles for it — today's close of both sides, kept (the Gemini section's live-test item 8 still asks whether they come). **A reconnect** changes nothing: the segments ride their timers and the cuts stay owed, as today (Gemini choice 14); a quiet settles any the new connection does not answer. **The mid-sentence hold keyed by target** (Revision 2, N1): `writesSentenceMarks(config.translationTargetCode)` — false for Thai and Lao, read by base language — is what the adapter hands `GeminiTurns` as `holdMidSentence`, which it forwards to the module (choice 6). **By its kind alone:** `kind === 'translate'` builds it, its pauses the config's — which `buildGemini` always sets for Live Translate — or the app's default, 1.5 s each, should none come, so the dialogue path never sees Live Translate (Revision 1, Minor 9). The dialogue half of `GeminiTurns` is untouched but for the dead Live Translate branches and timers it no longer needs.
13. **The `.done` events** (OpenAI Translate's choice 18: "should the endpoint send one" — the SDK lists none). A source's `.done` closes the source now, and its cut is owed. **A translation's `.done` settles the translation as its quiet would, without the hold** — a departure from choice 18's "that side closes now": with nothing owed and its source still open, a translation that closed at once would state no origin and orphan the rest of its source's translation (choice 7).
14. **The frame `translation.cut`** (`out`), one per translation close, and one when owed cuts are dropped with no translation open: `{ reason, origin, sentences, owed, dropped }` — `reason` `sentences` (a cut at its sentences), `quiet` (its pause, or the end of its hold), `done` (an endpoint's `.done`), `turn` (a turn end on Live Translate) or `idle` (no translation began within its pause after a source closed); `origin` the source it closed for, `null` for `idle` or a translation that followed none; `sentences` the translation's sentence ends; `owed` the cuts still owed after it; `dropped` the cuts dropped there (choice 8). No text, no audio. What the live test reads a cut one sentence late or early by (Task 4, items 5 and 6).
15. **The recordings: small, committed, generated.** `scripts/dev/wire-probe/translation-cuts-fixtures.mts` reads the spike's three `.jsonl` recordings and one recorded Gemini Live Translate session (`2026-09-28T19-41-14-translate-…`, a push-to-talk session whose source splits mid-sentence at the gap between its two presses: "Found in review" 4) and writes `src/lib/segmentation/recordings/{user,tight,long,gemini-live-translate}.json` — 8.9, 9.0, 10.9 and 3.4 KB: each event's arrival time and kind, a transcript delta's text, an audio frame's length and, where the probe measured it, its RMS (Gemini's did not); no pcm, no `elapsed_ms`, no key (the recordings hold none); the heartbeats left out, which the adapter drops before its segments. Committed because the recordings are git-ignored, and a later session can be added the same way. `recordings/replay.testing.ts` — test-only, its name under the kit rule, which Task 1 widens to every `*.testing.ts` (Revision 1, Minor 5) — plays a recording into a leg on a virtual clock, every event at its own arrival time, a frame's pcm filled at its recorded RMS, or at speech level with none (never all zero), lets every timer run out, folds what the leg emitted into L1 as it came, and reads the exchanges L2 projects: sources with text, the sources beside a translation, translations standing alone, each exchange's pairing and texts. Four replays: through the module, the text alone, as recorded, with the translation's marks rewritten as dandas or removed, and with all but the first removed and the mid-sentence hold off (Task 1); through OpenAI Translate's real `segments.ts`, with its noise floor, pinning each exchange's two ends against the spike's report (Task 2); through `GeminiTurns` under Gemini's audio rules, the recorded Live Translate session among them, its exchanges pinned (Task 3).

## What this plan consumes from the earlier plans

Named as landed, so a reconciliation is mechanical. Where a landed name or text differs from what is quoted here, the implementer follows the landed one and reports it.

| From | What it is | Consumed by |
|---|---|---|
| The Stage 2 OpenAI Translate plan: `TranslateSegments` (`input`, `output`, `audio(pcm, play)`, `done`, `stop`), the adapter (`audioDelta`: `isSilentFrame`, `computeRms`, the audio frame; `done`), its fixtures (`liveTranslate`, `SERVER`, `configFor`, `AUTO_CTX`), `ReleaseTail`; its choices 5 (Text only changes playback), 6 and ruling 6 (ranges by arrival), 18 (`.done`) | what the cuts wrap, and the rules kept | Task 2 |
| The Stage 2 Gemini plan and the Gemini/AST2 follow-up: `GeminiTurns` (its Live Translate half: `input`, `output`, `audio`, `modelText`, `typed`, `turnComplete`, `interrupted`, `connectionLost`, `stop`), `normalizeCjkSpaces`, `turns()` / `liveGemini` / `SERVER` / `TRANSLATE`; karaoke by arrival (follow-up ruling 2; choice 7), audio outside an open translation (Gemini choice 8), the mid-sentence deferral (Gemini choice 7), segments across a reconnect (Gemini choice 14) | what the cuts replace in Live Translate, and the rules kept | Tasks 1, 3 |
| `SilenceDeferral` (`src/lib/segmentation/silenceDeferral.ts`) | the source's mid-sentence deferral, moved into the module unchanged | Task 1 |
| The Stage 2 OpenAI Realtime plan: `RealtimeItems` (origins stated at the open, `segmentClosed({ ref })`), its "newest unanswered" fallback (choice 8) | the form of a stated origin, and the argument for one the adapter decides | Tasks 1–4 |
| L1 `Conversation` (`apply`, `snapshot`, `Retention`), L2 `createProjector` / `DEFAULT_PROJECTION`, `pair.ts` | the replays; pairing inference, unchanged | Tasks 1–3 |
| The kit: `trackedClock`, `createVirtualClock`, `recordEvents`, `eventsFrom`, `FakeSocket`, `runScenario` | every test | Tasks 1–3 |
| The spike: `openai-translate.mts` (`simulate`, `sentenceEnds`, `QUIET_RMS`, `MID_HOLD_MS`), its three recordings and `report.md` | the reference behaviour, the fixtures, the pinned pairs | Tasks 1–3 |
| Gemini's probe (`gemini.mts`): the recorded Live Translate session `2026-09-28T19-41-14-translate-…` | the fourth fixture, Gemini's only real stream in the suite | Tasks 1, 3 |
| The review's scratch: `variant-f.ts` (F1, F2, the typed reset), `terminals.test.ts`, `fuzz.test.ts`, `measure.test.ts` | Revision 1's reference for choices 3, 6, 8, 9; the fuzz and the sweep re-run on the result | Task 1 |
| `SENTENCE_CLOSERS` (`sentenceEnd.ts`), `DEFAULT_SEGMENT_PAUSE_MS` (`segmentationMode.ts`) | closing quotes skipped before a text's last mark; Live Translate's pauses when none are given | Tasks 1, 3 |

## File Structure

| File | Task | Change |
|---|---|---|
| `src/lib/segmentation/{continuousSegments,continuousSegments.test}.ts` (new) | 1 | the two sides of a continuous interpreter, pure |
| `src/lib/segmentation/recordings/{replay.testing.ts,user.json,tight.json,long.json,gemini-live-translate.json}` (new), `scripts/dev/wire-probe/translation-cuts-fixtures.mts` (new) | 1 | the recorded sessions, and their replay through L1 and L2 |
| `src/providers/sessionSide.consistency.test.ts` | 1 | the kit rule over `*.testing.ts`; the module in the timer scan |
| `src/providers/openai_translate/{wire,wire.test,segments,segments.test,adapter,adapter.test}.ts`, `src/providers/openai_translate/segments.replay.test.ts` (new) | 2 | OpenAI Translate on the module, its noise floor, the frame |
| `src/providers/gemini/{turns,turns.test,adapter,adapter.test}.ts`, `src/providers/gemini/turns.replay.test.ts` (new) | 3 | Gemini Live Translate on the module, the frame |
| the spec, the roadmap | 4 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Task 1.
- **Wave 2:** Tasks 2 and 3, at once. Both need Task 1 (the module, the recordings, the replay); their files are disjoint — Task 2 edits `src/providers/openai_translate/` alone, Task 3 `src/providers/gemini/` alone; neither touches `sessionSide.consistency.test.ts`, whose walk both run.
- **The group check** (controller) after Wave 2.
- **Task 4** (controller) last.

---

### Task 1: The two sides of a continuous interpreter, pure, and the recorded sessions (Wave 1)

**Files:**
- Create: `scripts/dev/wire-probe/translation-cuts-fixtures.mts`
- Create (generated by it): `src/lib/segmentation/recordings/user.json`, `src/lib/segmentation/recordings/tight.json`, `src/lib/segmentation/recordings/long.json`, `src/lib/segmentation/recordings/gemini-live-translate.json`
- Create: `src/lib/segmentation/recordings/replay.testing.ts` (test-only)
- Create: `src/lib/segmentation/continuousSegments.ts`
- Test: `src/lib/segmentation/continuousSegments.test.ts` (new), `src/providers/sessionSide.consistency.test.ts` (`inKit`, `:147-148`; the timer scan, `:296-298`)

**Interfaces:**
- Consumes: `AdapterEvents`, `Ref` (`src/lib/contract/adapter`), `Clock`, `createVirtualClock`, `VirtualClock` (`src/lib/contract/clock`), `SilenceDeferral` (`./silenceDeferral`), `SENTENCE_CLOSERS` (`./sentenceEnd`), `recordEvents`, `eventsFrom`, `AdapterEvent` (`src/lib/contract/events`), `trackedClock` (the kit), `Conversation` (L1), `createProjector`, `DEFAULT_PROJECTION` (L2), `Pairing` (`src/lib/projection/types`); `REPO` (`scripts/dev/wire-probe/common.mts`); the consistency test's `globalTimerCalls`, `readFileSync`, `join`, `REPO_ROOT`.
- Produces:
  - `src/lib/segmentation/continuousSegments.ts` — `MID_SENTENCE_HOLD_MS` (5 000), `endsSentence(mark: string, next: string | undefined): boolean | undefined`, `countSentenceEnds(text: string): number`, `atSentenceEnd(text: string): boolean`, `type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>`, `type CutReason = 'sentences' | 'quiet' | 'done' | 'turn' | 'idle'`, `interface CutSummary { reason: CutReason; origin: string | null; sentences: number; owed: number; dropped: number }`, `interface ContinuousSegmentsOptions { clock: Pick<Clock, 'setTimeout' | 'now'>; silence: { sourceMs: number; translationMs: number; deferMidSentence: boolean }; sink: SegmentSink; showSource?: (text: string) => string; cut?: (summary: CutSummary) => void; holdMidSentence?: boolean }`, `class ContinuousSegments { constructor(o: ContinuousSegmentsOptions); get translating(): boolean; sourceText(delta: string): void; translationText(delta: string): void; audio(pcm: Int16Array, o: { play: boolean; active: boolean }): void; typed(text: string): void; done(side: 'source' | 'translation'): void; endTurn(): void; stop(): void }`. Tasks 2 and 3 wire it in.
  - `src/lib/segmentation/recordings/replay.testing.ts` (test-only) — `type RecordedEvent = [number, 's' | 't', string] | [number, 'a', number, number?]`, `interface Recording { run: string; events: RecordedEvent[] }`, `RECORDINGS: Readonly<Record<'user' | 'tight' | 'long' | 'geminiLiveTranslate', Recording>>`, `interface ReplayTarget { input(delta: string): void; output(delta: string): void; audio(pcm: Int16Array): void }`, `interface ReplayResult { sources: number; paired: number; orphans: number; pairings: Pairing[]; exchanges: Array<[string, string]> }`, `frameAt(samples: number, rms?: number): Int16Array`, `replay(recording: Recording, build: (clock: VirtualClock, events: AdapterEvents) => ReplayTarget): ReplayResult`. Tasks 2 and 3 replay through it.
  - The kit rule: every `*.testing.ts` under `src/` is kit, whatever imports it test-only.

- [ ] **Step 1: Write the recordings' generator**, `scripts/dev/wire-probe/translation-cuts-fixtures.mts` (choice 15):

```ts
/**
 * The recorded sessions the translation-cuts tests replay, written as small
 * fixtures: the OpenAI Translate spike's three (`openai-translate.mts
 * record`) and one Gemini Live Translate session (`gemini.mts`). Each keeps
 * what a leg's segments see, in the order and at the time it arrived — each
 * transcript delta's text, and each audio frame's length and, where the probe
 * measured it, its RMS. No pcm, no `elapsed_ms`, no key: the recordings hold
 * none of the last, and the rest is not read. An all-zero frame (a heartbeat)
 * is left out, since the adapter drops it before its segments.
 *
 *   npx tsx scripts/dev/wire-probe/translation-cuts-fixtures.mts
 *
 * Reads the probes' `.jsonl` recordings under `.superpowers/wire-probes/`
 * (git-ignored) and writes `src/lib/segmentation/recordings/<name>.json`.
 * No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './common.mts';

const PROBES = path.join(REPO, '.superpowers/wire-probes');
const TO = path.join(REPO, 'src/lib/segmentation/recordings');

type Line = { t: number; dir: string; type: string; d?: Record<string, unknown> };
type Reader = (l: Line) => unknown[] | null;

/** OpenAI Translate's spike: each frame's arrival `t`, its delta, or its frame's length, RMS and whether it was all zero. */
const openaiTranslate: Reader = (l) => {
  const d = l.d ?? {};
  const t = typeof d.t === 'number' ? d.t : l.t;
  if (l.type === 'session.input_transcript.delta' && typeof d.delta === 'string' && d.delta) return [t, 's', d.delta];
  if (l.type === 'session.output_transcript.delta' && typeof d.delta === 'string' && d.delta) return [t, 't', d.delta];
  if (l.type === 'session.output_audio.delta' && typeof d.len === 'number' && d.len > 0 && d.zero !== true) return [t, 'a', d.len, typeof d.rms === 'number' ? d.rms : 0];
  return null;
};

/** Gemini's probe: each message's arrival `t`, a transcription's text, or an audio part's length — it measured no RMS. */
const geminiLiveTranslate: Reader = (l) => {
  const d = l.d ?? {};
  if (l.type === 'inputTranscription' && typeof d.text === 'string' && d.text) return [l.t, 's', d.text];
  if (l.type === 'outputTranscription' && typeof d.text === 'string' && d.text) return [l.t, 't', d.text];
  if (l.type === 'audio' && typeof d.samples === 'number' && d.samples > 0) return [l.t, 'a', d.samples];
  return null;
};

const FIXTURES: Array<[name: string, run: string, read: Reader]> = [
  ['user', 'openai-translate/2026-09-29T17-19-57-user', openaiTranslate],
  ['tight', 'openai-translate/2026-09-29T17-21-44-tight', openaiTranslate],
  ['long', 'openai-translate/2026-09-29T17-24-18-long', openaiTranslate],
  // Push-to-talk: the clip went up in two presses 2.5 s apart, so its source splits where the first press ended.
  ['gemini-live-translate', 'gemini/2026-09-28T19-41-14-translate-gemini-3.5-live-translate-preview', geminiLiveTranslate],
];

fs.mkdirSync(TO, { recursive: true });
for (const [name, run, read] of FIXTURES) {
  const lines = fs.readFileSync(path.join(PROBES, `${run}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Line);
  const events = lines.filter((l) => l.dir === 'in').map(read).filter((e) => e !== null).map((e) => JSON.stringify(e));
  const file = path.join(TO, `${name}.json`);
  fs.writeFileSync(file, `{\n  "run": ${JSON.stringify(path.basename(run))},\n  "events": [\n    ${events.join(',\n    ')}\n  ]\n}\n`);
  console.log(`${path.relative(REPO, file)}: ${events.length} events`);
}
```

- [ ] **Step 2: Run it, and check what it wrote.** The recordings are git-ignored and live in this worktree only, under `.superpowers/wire-probes/openai-translate/` and `.superpowers/wire-probes/gemini/`; if any of the four `.jsonl` files is missing, stop and report — do not record anew (a probe is the controller's, and needs a key).

Run: `npx tsx scripts/dev/wire-probe/translation-cuts-fixtures.mts`
Expected: four lines — `src/lib/segmentation/recordings/user.json: 351 events`, `…/tight.json: 353 events`, `…/long.json: 427 events`, `…/gemini-live-translate.json: 140 events`.

Run: `sha256sum src/lib/segmentation/recordings/user.json src/lib/segmentation/recordings/tight.json src/lib/segmentation/recordings/long.json src/lib/segmentation/recordings/gemini-live-translate.json`
Expected (the first three are Revision 0's, unchanged):

```
838751ffaee28374f0cf0a87953381836a738724495cb575fc5fb2cd75141111  src/lib/segmentation/recordings/user.json
b08f1124fa5b4f64052261292473346e3248c6c08c5815a7925624e0992ad184  src/lib/segmentation/recordings/tight.json
62e3bb099ad1b83f9eaaf398a495d37bf59b6e44b6e7ac888e37a133c24ff387  src/lib/segmentation/recordings/long.json
37b26a831e966a3c5b717c0ad0f2d3ebb1e56bdf1b7b85f09252c8b8feda1f92  src/lib/segmentation/recordings/gemini-live-translate.json
```

Each file begins as `user.json` does, one event a line; the Gemini one's audio frames carry no RMS (`[3857,"a",6000]`):

```json
{
  "run": "2026-09-29T17-19-57-user",
  "events": [
    [1781,"a",9600,0.00014],
    [3167,"s","今天"],
    [3373,"s","我"],
    [3549,"t","Today"],
```

- [ ] **Step 3: Write the replay** (test-only), `src/lib/segmentation/recordings/replay.testing.ts` (choice 15):

```ts
/**
 * Test-only (its `.testing.ts` name puts it under the kit rule: only tests
 * may import it): recorded sessions, as
 * `scripts/dev/wire-probe/translation-cuts-fixtures.mts` wrote them — the
 * OpenAI Translate spike's three (the owner's six sentences with his own
 * pauses, `user`; every pause 1.7 s, `tight`; an eight-sentence mix, `long`)
 * and one Gemini Live Translate session, pushed to talk in two presses
 * (`geminiLiveTranslate`) — replayed
 * into a leg at each event's own arrival time, and what the conversation
 * panel then shows (L1, then L2): which sources have a translation beside
 * them, and which translations stand alone (Stage 2 translation cuts,
 * choice 15).
 */
import type { AdapterEvents } from '../../contract/adapter';
import { createVirtualClock, type VirtualClock } from '../../contract/clock';
import { eventsFrom } from '../../contract/events';
import { Conversation } from '../../conversation/Conversation';
import { createProjector, DEFAULT_PROJECTION } from '../../projection/project';
import type { Pairing } from '../../projection/types';
import geminiLiveTranslate from './gemini-live-translate.json';
import long from './long.json';
import tight from './tight.json';
import user from './user.json';

/**
 * `[arrival ms, 's' | 't', delta]` — a source or translation transcript
 * delta — or `[arrival ms, 'a', samples, rms?]`, an output audio frame
 * (heartbeats left out; no RMS where the probe measured none).
 */
export type RecordedEvent = [number, 's' | 't', string] | [number, 'a', number, number?];

export interface Recording {
  run: string;
  events: RecordedEvent[];
}

export const RECORDINGS = { user, tight, long, geminiLiveTranslate } as unknown as Readonly<Record<'user' | 'tight' | 'long' | 'geminiLiveTranslate', Recording>>;

/** What a leg is fed: each side's transcript, and the translation's audio. */
export interface ReplayTarget {
  input(delta: string): void;
  output(delta: string): void;
  audio(pcm: Int16Array): void;
}

export interface ReplayResult {
  /** Source segments with text. */
  sources: number;
  /** Of those, the ones whose exchange holds a translation. */
  paired: number;
  /** Exchanges that hold a translation and no source: fragments standing alone. */
  orphans: number;
  /** Each exchange that holds a translation: how it was paired. */
  pairings: Pairing[];
  /** Each exchange, in order: its source text and its translation text, trimmed. */
  exchanges: Array<[string, string]>;
}

/** The level a frame with no measured RMS is filled at: speech, 0.03. */
const SPEECH_RMS = 0.03;

/** A frame of `samples` at the recorded RMS, or at speech level when none was measured; never all zero, which the adapter would have dropped as a heartbeat. */
export function frameAt(samples: number, rms = SPEECH_RMS): Int16Array {
  return new Int16Array(samples).fill(Math.max(1, Math.round(rms * 32768)));
}

/**
 * Plays `recording` into the leg `build` makes on a virtual clock — every
 * event at its own arrival time — lets every timer run out, and folds what
 * the leg emitted into L1 as it came, so each segment opens at its own time.
 */
export function replay(recording: Recording, build: (clock: VirtualClock, events: AdapterEvents) => ReplayTarget): ReplayResult {
  const clock = createVirtualClock(0);
  const conversation = new Conversation({
    leg: 'speaker',
    session: recording.run,
    languages: { source: 'zh', target: 'en' },
    clock,
    retention: { keepPcm: false, maxPcmBytes: 0 },
  });
  const leg = build(clock, eventsFrom((e) => conversation.apply(e)));
  for (const e of recording.events) {
    clock.advance(e[0] - clock.now());
    if (e[1] === 'a') leg.audio(frameAt(e[2], e[3]));
    else if (e[1] === 's') leg.input(e[2]);
    else leg.output(e[2]);
  }
  clock.advance(30_000);
  const snapshot = conversation.snapshot();
  const entries = createProjector().project([snapshot], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
  const exchanges = entries.flatMap((e) => (e.kind === 'exchange' ? [e] : []));
  const text = (rows: ReadonlyArray<{ text: string }>) => rows.map((r) => r.text).join('').trim();
  const withTranslation = exchanges.filter((e) => e.translation.length > 0);
  return {
    sources: snapshot.segments.filter((s) => s.side === 'source' && s.text.trim() !== '').length,
    paired: withTranslation.reduce((n, e) => n + new Set(e.source.map((r) => r.segmentId)).size, 0),
    orphans: withTranslation.filter((e) => e.source.length === 0).length,
    pairings: withTranslation.map((e) => e.pairing),
    exchanges: exchanges.map((e) => [text(e.source), text(e.translation)]),
  };
}
```

- [ ] **Step 4: Write the failing tests** (rulings 1, 2; choices 1–10, 12–15): the consistency test's two lines, in the diff after the module's cases — the kit rule over every testing module, and the module in the timer scan by name — and the module's cases, `src/lib/segmentation/continuousSegments.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../contract/events';
import { trackedClock } from '../contract/testing/trackedClock';
import {
  atSentenceEnd, ContinuousSegments, countSentenceEnds, endsSentence, MID_SENTENCE_HOLD_MS, type ContinuousSegmentsOptions, type CutSummary,
} from './continuousSegments';
import { RECORDINGS, replay, type RecordedEvent, type Recording } from './recordings/replay.testing';

const SILENCE: ContinuousSegmentsOptions['silence'] = { sourceMs: 1500, translationMs: 1500, deferMidSentence: false };

function segments(silence = SILENCE, showSource?: (text: string) => string, holdMidSentence?: boolean) {
  // `timers()` counts what has neither fired nor been cancelled: the clock rule's proof that no timer outlives what should end it.
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const cuts: CutSummary[] = [];
  const s = new ContinuousSegments({ clock, silence, sink: events, showSource, holdMidSentence, cut: (c) => cuts.push(c) });
  const of = <K extends AdapterEvent['kind']>(k: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === k);
  const texts = (ref: number) => of('segmentText').filter((e) => e.payload.ref === ref).map((e) => e.payload.text);
  const opened = () => of('segmentOpened').map((e) => e.payload);
  const closed = () => of('segmentClosed').map((e) => e.payload);
  const audio = () => of('audio').map((e) => [e.payload.ref, e.payload.range]);
  /** Advances the clock to `at`, from wherever it stands. */
  const at = (ms: number) => clock.advance(ms - clock.now());
  return { s, clock, timers, log, cuts, of, texts, opened, closed, audio, at };
}
const pcm = () => new Int16Array(4_800).fill(900);
const ACTIVE = { play: true, active: true };
const INACTIVE = { play: true, active: false };

describe('sentence ends (translation cuts, ruling 1; choice 3)', () => {
  it(`holds a translation that stops mid-sentence for ${MID_SENTENCE_HOLD_MS} ms after its last activity (choice 6)`, () => {
    expect(MID_SENTENCE_HOLD_MS).toBe(5_000);
  });

  it('counts a CJK 。？！ wherever it stands, and a Latin .?! only before whitespace or at the end — not "1.5", not "U.S"', () => {
    expect(countSentenceEnds('今天。好吗？是的！')).toBe(3);
    expect(countSentenceEnds('「行こう。」と言った。')).toBe(2);
    expect(countSentenceEnds('It costs 1.5 dollars.')).toBe(1);
    expect(countSentenceEnds('The U.S economy grew.')).toBe(1);
    expect(countSentenceEnds('Really?! Yes... fine')).toBe(2);
    expect(countSentenceEnds('No end here')).toBe(0);
    expect(countSentenceEnds('')).toBe(0);
  });

  it("counts the other scripts' own marks wherever they stand, as the CJK ones", () => {
    // Devanagari and Bengali, Urdu, Arabic, Burmese, Armenian, Ethiopic, fullwidth and halfwidth, then Khmer.
    expect(countSentenceEnds('यह पहला है। यह दूसरा है॥')).toBe(2);
    expect(countSentenceEnds('یہ پہلا ہے۔ کیا یہ دوسرا ہے؟')).toBe(2);
    expect(countSentenceEnds('ပထမ။ ဒုတိယ။')).toBe(2);
    expect(countSentenceEnds('Առաջին։ Երկրորդ։')).toBe(2);
    expect(countSentenceEnds('አንድ። ሁለት።')).toBe(2);
    expect(countSentenceEnds('一つ目．二つ目｡')).toBe(2);
    // Khmer.
    expect(countSentenceEnds('ប្រយោគទីមួយ។ ទីពីរ៕')).toBe(2);
    // Thai writes none.
    expect(countSentenceEnds('ประโยคแรก ประโยคที่สอง')).toBe(0);
  });

  it('is one rule: a mark with the character after it — an end, none, or, for a Latin mark with nothing after it yet, what follows decides', () => {
    expect(endsSentence('。', 'x')).toBe(true);
    expect(endsSentence('।', undefined)).toBe(true);
    expect(endsSentence('.', ' ')).toBe(true);
    expect(endsSentence('.', '5')).toBe(false);
    expect(endsSentence('.', undefined)).toBe(undefined);
    expect(endsSentence(',', undefined)).toBe(false);
  });

  it('reads a text as ending at a sentence end when its last mark, trailing whitespace and closing quotes aside, is one', () => {
    expect(atSentenceEnd('Done.  ')).toBe(true);
    expect(atSentenceEnd('好。')).toBe(true);
    expect(atSentenceEnd('Is it?')).toBe(true);
    expect(atSentenceEnd('「行こう。」')).toBe(true);
    expect(atSentenceEnd('He said "go."')).toBe(true);
    expect(atSentenceEnd('यह ठीक है।')).toBe(true);
    expect(atSentenceEnd('Waiting for')).toBe(false);
    expect(atSentenceEnd('Well,')).toBe(false);
    expect(atSentenceEnd('"')).toBe(false);
    expect(atSentenceEnd('')).toBe(false);
  });
});

describe('the source: its own pause, its origin stated (translation cuts, ruling 2; choice 2)', () => {
  it('opens on its first delta stating its origin, sends the whole text, closes on its own pause without restating it, and owes the translation a cut', () => {
    const { s, clock, timers, opened, closed, texts } = segments();
    s.sourceText('今天');
    s.sourceText('好。');
    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 's1' }]);
    expect(texts(1)).toEqual(['今天', '今天好。']);
    clock.advance(1499);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    // The cut it owes names the translation that follows it.
    s.translationText('Today is good.');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);
  });

  it('in sentence mode a mid-sentence pause waits while the text grows (Gemini choice 7), and reads the text as shown', () => {
    const { s, clock, timers, closed, texts } = segments({ ...SILENCE, deferMidSentence: true }, (t) => t.replace(/ /g, ''));
    s.sourceText('他 说');
    expect(texts(1)).toEqual(['他说']);
    clock.advance(1500);
    expect(closed()).toEqual([]);
    s.sourceText(' 我们');
    clock.advance(1500);
    expect(closed()).toEqual([]);
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }]);
    // Its pause to begin a translation, then nothing is left.
    clock.advance(1500);
    expect(timers()).toBe(0);
  });
});

describe("the translation: cut at the source's cuts (translation cuts, rulings 1, 2; choices 4, 5)", () => {
  it("the owner's case: the interpreter pauses less than the speaker, yet each source gets its own translation, stated", () => {
    const { s, at, opened, closed, texts, cuts } = segments();
    at(0);
    s.sourceText('第一句');
    at(1_000);
    s.sourceText('话。');
    at(1_200);
    s.translationText('The first');
    at(1_800);
    s.translationText(' sentence.');
    // The speaker pauses 2 s, past the source's own 1.5 s: it closes at 2 500, owing one cut.
    at(3_000);
    s.sourceText('第二句。');
    // The interpreter's pause, 1.4 s, is shorter than its own 1.5 s: it goes on in the same stream.
    at(3_200);
    s.translationText(' The second.');
    expect(opened()).toEqual([
      { ref: 1, side: 'source', origin: 's1' },
      { ref: 2, side: 'translation', origin: 's1' },
      { ref: 3, side: 'source', origin: 's3' },
      { ref: 4, side: 'translation', origin: 's3' },
    ]);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(texts(2)).toEqual(['The first', 'The first sentence.']);
    expect(texts(4)).toEqual([' The second.']);
    expect(cuts).toEqual([{ reason: 'sentences', origin: 's1', sentences: 1, owed: 0, dropped: 0 }]);
    // The second source closes at 4 500; the translation's quiet at 4 700 closes it for that cut.
    at(4_700);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
    expect(cuts[1]).toEqual({ reason: 'quiet', origin: 's3', sentences: 1, owed: 0, dropped: 0 });
  });

  it("cuts after as many sentence ends as the source had, at least one: two for a two-sentence source, one for a source with none", () => {
    const { s, at, closed, texts } = segments();
    s.sourceText('一。二。');
    at(1_500);
    s.translationText('One.');
    s.translationText(' Two.');
    expect(closed()).toEqual([{ ref: 1 }]);
    s.sourceText('三');
    s.translationText(' Three');
    // The cut came before ' Three', which opened the next translation.
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(texts(2)).toEqual(['One.', 'One. Two.']);
    expect(texts(4)).toEqual([' Three']);
    at(3_000);
    // The source with no sentence end owes one: the translation's first end after its last delta, then the next delta.
    s.translationText(' four.');
    s.translationText(' Five');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
    expect(texts(4)).toEqual([' Three', ' Three four.']);
  });

  it("counts only the sentence ends that arrived after the source's last delta, strictly (the guard), each at its own delta's arrival", () => {
    const { s, at, closed } = segments();
    at(0);
    s.sourceText('一。');
    at(500);
    s.translationText('One.');
    at(1_000);
    s.sourceText('还有');
    // Closed at 2 500: one sentence end, its last delta at 1 000. The translation's end came at 500, before it.
    at(2_600);
    s.translationText(' And');
    expect(closed()).toEqual([{ ref: 1 }]);
    // ' And' settled 'One.' as an end: stamped 500, its own arrival, not 2 600, it is still not due.
    at(2_700);
    s.translationText(' more.');
    expect(closed()).toEqual([{ ref: 1 }]);
    at(2_800);
    s.translationText(' Next');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);

    // An end that arrives at the same moment as the source's last delta is not after it.
    const same = segments({ ...SILENCE, translationMs: 3_000 });
    same.s.sourceText('一。');
    same.s.translationText('One.');
    same.at(1_600);
    same.s.translationText(' Two');
    expect(same.closed()).toEqual([{ ref: 1 }]);
  });

  it('compares the latest sentence end, not the first: one before the source\'s last delta and one after it make the cut due — across deltas, within them, and in CJK', () => {
    for (const [first, second, third, next] of [
      ['One.', ' Two.', ' And', ' more'],
      ['One. ', 'Two. ', 'And', ' more'],
      ['一つ目。', '二つ目。', 'そして', 'もっと'],
    ]) {
      const { s, at, closed } = segments();
      s.sourceText('一。');
      at(600);
      s.translationText(first);
      at(1_000);
      s.sourceText('二。');
      at(1_100);
      s.translationText(second);
      at(1_200);
      s.translationText(third);
      // The source closes at 2 500, owing two: the first end came at 600, before its last delta at 1 000, the second at 1 100, after it.
      at(2_600);
      expect(closed()).toEqual([{ ref: 1 }]);
      s.translationText(next);
      expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    }
  });

  it('counts a Latin mark within a delta only before whitespace, and a CJK one wherever it stands: "1.5" in one delta cuts nothing, 「一つ目。二つ目」 counts one', () => {
    const latin = segments();
    latin.s.sourceText('一。二。');
    latin.at(1_600);
    latin.s.translationText('It costs 1.5 dollars.');
    latin.at(1_700);
    latin.s.translationText(' And');
    expect(latin.closed()).toEqual([{ ref: 1 }]);
    latin.at(1_800);
    latin.s.translationText(' the rest.');
    latin.at(1_900);
    latin.s.translationText(' Next');
    expect(latin.closed()).toEqual([{ ref: 1 }, { ref: 2 }]);

    const cjk = segments();
    cjk.s.sourceText('一。二。');
    cjk.at(1_600);
    cjk.s.translationText('一つ目。二つ目');
    cjk.at(1_700);
    cjk.s.translationText('。');
    expect(cjk.closed()).toEqual([{ ref: 1 }]);
    cjk.at(1_800);
    cjk.s.translationText('三つ目');
    expect(cjk.closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cjk.texts(2)).toEqual(['一つ目。二つ目', '一つ目。二つ目。']);
  });

  it("cuts a translation in another script at its own marks — a Hindi one at its dandas (choice 3)", () => {
    const { s, at, closed, texts } = segments();
    s.sourceText('一。二。');
    at(1_600);
    s.translationText('पहला वाक्य। दूसरा');
    at(1_700);
    s.translationText(' वाक्य।');
    at(1_800);
    s.translationText(' तीसरा');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(texts(2)).toEqual(['पहला वाक्य। दूसरा', 'पहला वाक्य। दूसरा वाक्य।']);
  });

  it('reads a Latin end that closes a delta by the next one: "1." then "5" is no end, "done." then " Next" is', () => {
    const { s, at, closed, texts } = segments();
    s.sourceText('一点五。');
    at(1_500);
    s.translationText('It is 1.');
    s.translationText('5');
    expect(closed()).toEqual([{ ref: 1 }]);
    s.translationText(' kilos, done.');
    s.translationText(' Next');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(texts(2)).toEqual(['It is 1.', 'It is 1.5', 'It is 1.5 kilos, done.']);
  });

  it('keeps the audio that arrives between the sentence end and the next delta with the segment it closes; after it, the new one ranges from 0 (ruling 1)', () => {
    const { s, at, audio } = segments();
    s.sourceText('好。');
    at(1_500);
    s.translationText('Done.');
    s.audio(pcm(), ACTIVE);
    s.translationText(' Next');
    s.audio(pcm(), ACTIVE);
    expect(audio()).toEqual([[2, [0, 5]], [3, [0, 5]]]);
  });

  it('states its origin when it opens, when known — the cut owed first, else the source still open — and never another; else it states it as it closes', () => {
    const { s, at, opened, closed } = segments();
    // Nothing owed, no source: no origin yet.
    s.translationText('Hello');
    expect(opened()).toEqual([{ ref: 1, side: 'translation' }]);
    // A source opens and closes while it is open: the cut it owes is the one it closes for, stated as it closes.
    at(100);
    s.sourceText('你好。');
    at(200);
    s.translationText('.');
    at(1_600);
    s.translationText(' Hi.');
    expect(closed()).toEqual([{ ref: 2 }, { ref: 1, origin: 's2' }]);
    at(3_100);
    // The source still open when the next translation opens: stated then, and not again.
    s.sourceText('再见。');
    s.translationText('Bye.');
    expect(opened().slice(3)).toEqual([{ ref: 4, side: 'source', origin: 's4' }, { ref: 5, side: 'translation', origin: 's4' }]);
    at(10_000);
    expect(closed().filter((c) => c.ref === 5)).toEqual([{ ref: 5 }]);

    // A cut owed from a source that closed with no translation open, and the next source already open when one begins:
    // it follows the open source, and the older cut is dropped (choice 8).
    const both = segments();
    both.s.sourceText('一。');
    both.at(1_500);
    both.s.sourceText('二。');
    both.s.translationText('Two.');
    expect(both.opened()[2]).toEqual({ ref: 3, side: 'translation', origin: 's2' });
    expect(both.cuts).toEqual([{ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 }]);
  });

  it('a cut at its sentences leaves the later cuts owed: a translation running behind two sources answers each in turn', () => {
    const { s, at, opened, cuts } = segments({ ...SILENCE, translationMs: 3_000 });
    s.sourceText('一。');
    at(1_500);
    s.sourceText('二。');
    at(3_000);
    // Both closed before the interpreter began, inside its pause to begin; it keeps talking, so no quiet settles anything.
    s.translationText('One.');
    s.translationText(' Two');
    expect(opened().slice(2)).toEqual([{ ref: 3, side: 'translation', origin: 's1' }, { ref: 4, side: 'translation', origin: 's2' }]);
    expect(cuts).toEqual([{ reason: 'sentences', origin: 's1', sentences: 1, owed: 1, dropped: 0 }]);

    // Two sources behind while the speaker is on a third: the next translation follows the cut owed first, not the open source.
    const behind = segments({ ...SILENCE, translationMs: 3_000 });
    behind.s.sourceText('一。');
    behind.at(100);
    behind.s.translationText('One');
    behind.at(1_600);
    behind.s.sourceText('二。');
    behind.at(1_700);
    behind.s.translationText(' is');
    behind.at(3_200);
    behind.s.sourceText('三');
    behind.at(3_300);
    behind.s.translationText('.');
    behind.at(3_400);
    behind.s.translationText(' Two');
    expect(behind.opened().slice(3)).toEqual([{ ref: 4, side: 'source', origin: 's4' }, { ref: 5, side: 'translation', origin: 's3' }]);

    // The same, the translation beginning inside its pause to begin: once it has begun, that pause is over, and its next
    // segment still follows the cut owed first.
    const late = segments({ ...SILENCE, translationMs: 3_000 });
    late.s.sourceText('一。');
    late.at(1_500);
    // The first source closed with no translation open: the pause to begin runs; the translation begins inside it.
    late.at(1_600);
    late.s.translationText('One');
    late.at(1_700);
    late.s.sourceText('二。');
    late.at(2_500);
    late.s.translationText(' is');
    late.at(3_300);
    late.s.sourceText('三');
    late.at(3_400);
    late.s.translationText(' done.');
    late.at(3_500);
    late.s.translationText(' Two');
    expect(late.opened().slice(3)).toEqual([{ ref: 4, side: 'source', origin: 's4' }, { ref: 5, side: 'translation', origin: 's3' }]);
    expect(late.cuts).toEqual([{ reason: 'sentences', origin: 's1', sentences: 1, owed: 1, dropped: 0 }]);
  });
});

describe("the translation's own quiet (translation cuts, ruling 1; choices 6–9)", () => {
  it('at a sentence end its quiet closes it for the cut owed, which its sentences never reached (the resync)', () => {
    const { s, at, closed, cuts } = segments();
    s.sourceText('一。二。');
    at(1_500);
    s.translationText('One and two.');
    at(2_999);
    expect(closed()).toEqual([{ ref: 1 }]);
    at(3_000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'quiet', origin: 's1', sentences: 1, owed: 0, dropped: 0 }]);
  });

  it(`mid-sentence it waits once more, to ${MID_SENTENCE_HOLD_MS} ms after its last activity, then closes`, () => {
    const { s, at, closed, timers } = segments();
    s.sourceText('一。二。');
    at(1_500);
    s.translationText('One. Waiting for');
    at(3_000);
    expect(closed()).toEqual([{ ref: 1 }]);
    expect(timers()).toBe(1);
    at(1_500 + MID_SENTENCE_HOLD_MS - 1);
    expect(closed()).toEqual([{ ref: 1 }]);
    at(1_500 + MID_SENTENCE_HOLD_MS);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);

    // A delta during the hold gives it its pause, and its hold, again.
    const again = segments();
    again.s.sourceText('一。二。');
    again.at(1_500);
    again.s.translationText('One. Waiting');
    again.at(3_500);
    again.s.translationText(' for');
    again.at(3_500 + 1_500);
    expect(again.closed()).toEqual([{ ref: 1 }]);
    again.at(3_500 + MID_SENTENCE_HOLD_MS);
    expect(again.closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('holds nothing mid-sentence until the stream has shown a sentence end: a script that writes none closes at its pause (choice 6)', () => {
    // Thai writes no sentence-final mark: every pause would read as mid-sentence, and the hold would keep one translation open for the session.
    const { s, at, closed } = segments();
    s.sourceText('一。');
    at(1_600);
    s.translationText('ประโยคแรก');
    at(3_100);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    // Once a mark has shown, the hold holds.
    s.sourceText('二。');
    at(4_600);
    s.translationText('第二句。そして');
    at(6_100);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    at(4_600 + MID_SENTENCE_HOLD_MS);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);

    // A Latin mark closing a delta shows one too, though nothing followed it before its translation closed.
    const latin = segments();
    latin.s.sourceText('一。');
    latin.at(1_600);
    latin.s.translationText('First.');
    latin.at(3_100);
    latin.s.sourceText('二。');
    latin.at(4_600);
    latin.s.translationText('Then the');
    latin.at(6_100);
    expect(latin.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    latin.at(4_600 + MID_SENTENCE_HOLD_MS);
    expect(latin.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
  });

  it('holds nothing mid-sentence for a target whose script writes no mark, whatever stray Latin mark its stream shows: `holdMidSentence: false` (choice 6)', () => {
    // A Thai translation with one early Latin mark — a question, an era's abbreviation — then none: with the hold, that one mark
    // would hold every later pause for 5 s, and no cut would ever come due.
    const run = (holdMidSentence: boolean) => {
      const h = segments(SILENCE, undefined, holdMidSentence);
      h.s.sourceText('一。');
      h.at(1_600);
      h.s.translationText('ใช่ไหม?');
      // Its quiet at 3 100, at a sentence end: it closes for the first source.
      h.at(3_200);
      h.s.sourceText('二。');
      h.at(4_800);
      h.s.translationText('ปี พ ศ 2567 เราไป');
      h.at(6_300);
      return h;
    };
    const off = run(false);
    expect(off.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
    // The default holds it — the latch the option exists to keep away from such a target.
    const on = run(true);
    expect(on.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    on.at(4_800 + MID_SENTENCE_HOLD_MS);
    expect(on.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
  });

  it("with nothing owed and a source still open it waits for that source's cut, then has its pause again (choice 7)", () => {
    const { s, at, closed, timers, opened } = segments();
    s.sourceText('我们');
    s.translationText('We.');
    at(1_000);
    s.sourceText('走吧');
    // Its quiet at 1 500: nothing owed, the source open until 2 500. It waits, with no timer of its own.
    at(1_500);
    expect(closed()).toEqual([]);
    expect(timers()).toBe(1);
    at(2_500);
    expect(closed()).toEqual([{ ref: 1 }]);
    at(3_999);
    expect(closed()).toEqual([{ ref: 1 }]);
    at(4_000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
    expect(timers()).toBe(0);
  });

  it('a quiet close drops every other cut still owed: a source never translated does not shift the translations after it (choice 8)', () => {
    const { s, at, opened, cuts } = segments();
    s.sourceText('第一。第二。');
    s.translationText('First. Second');
    at(1_500);
    // The first source closed; a filler the interpreter will not translate follows while it still speaks.
    s.sourceText('嗯。');
    at(1_600);
    s.translationText(' one.');
    // The filler closes at 3 000; the translation's quiet at 3 100 closes it for the first and drops the filler's cut.
    at(3_100);
    expect(cuts).toEqual([{ reason: 'quiet', origin: 's1', sentences: 2, owed: 0, dropped: 1 }]);
    s.sourceText('第三。');
    at(3_300);
    s.translationText('Third.');
    expect(opened()[4]).toEqual({ ref: 5, side: 'translation', origin: 's4' });
  });

  it('a source that closes with no translation open gives it its pause to begin; with none begun its cut is dropped (choice 8)', () => {
    const { s, at, opened, cuts, timers } = segments();
    // Spoken in the target language: the interpreter says nothing.
    s.sourceText('Hello there.');
    at(2_999);
    expect(cuts).toEqual([]);
    at(3_000);
    expect(cuts).toEqual([{ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 }]);
    expect(timers()).toBe(0);
    s.sourceText('你好。');
    at(3_200);
    s.translationText('Hello.');
    expect(opened()[2]).toEqual({ ref: 3, side: 'translation', origin: 's2' });

    // One that begins within the pause takes the cut.
    const late = segments();
    late.s.sourceText('你好。');
    late.at(2_900);
    late.s.translationText('Hello.');
    expect(late.opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
  });

  it('a filler, then speech within the pause to begin: the translation that begins then follows the speech, and the filler stands alone (choice 8)', () => {
    const { s, at, opened, closed, cuts } = segments();
    s.sourceText('我觉得这个方案不错。');
    at(700);
    s.translationText('I think this plan is good.');
    // The first source closes at 1 500, the translation for it at 2 200.
    at(2_200);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    at(2_700);
    s.sourceText('嗯。');
    // The filler closes at 4 200 with no translation open: the translation's pause to begin runs to 5 700.
    at(4_600);
    s.sourceText('我们明天开始吧。');
    at(5_200);
    s.translationText("Let's start tomorrow.");
    expect(opened().slice(3)).toEqual([{ ref: 4, side: 'source', origin: 's4' }, { ref: 5, side: 'translation', origin: 's4' }]);
    expect(cuts[1]).toEqual({ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 });
    at(10_000);
    expect(closed().slice(2)).toEqual([{ ref: 3 }, { ref: 4 }, { ref: 5 }]);
  });

  it('a translation that begins more than its pause after its source closed, with no source open, closes as that source\'s (choice 9)', () => {
    const { s, at, opened, closed, cuts } = segments();
    s.sourceText('今天天气很好。');
    at(600);
    s.translationText('The weather is nice today.');
    at(5_000);
    s.sourceText('好。');
    // It closes at 6 500; nothing begins within the pause, and its cut is dropped at 8 000.
    at(8_000);
    expect(cuts[1]).toEqual({ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 });
    at(8_500);
    s.translationText('OK.');
    expect(opened()[3]).toEqual({ ref: 4, side: 'translation' });
    at(10_000);
    expect(closed().slice(3)).toEqual([{ ref: 4, origin: 's3' }]);
  });

  it('a quiet close with a cut owed takes that cut even while the next source is open: only a translation with nothing owed waits (choices 7, 8)', () => {
    const { s, at, closed, cuts } = segments();
    s.sourceText('一。');
    at(1_600);
    s.translationText('One.');
    at(2_000);
    s.sourceText('二');
    // Its quiet at 3 100: the first source's cut is owed, the second source open. It closes for the first.
    at(3_100);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'quiet', origin: 's1', sentences: 1, owed: 0, dropped: 0 }]);
  });

  it('with nothing owed and no source open it closes as the rest of the spoken source that closed last; before any, stating none (choice 9)', () => {
    const { s, at, closed } = segments();
    s.translationText('Before anything.');
    at(1_500);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.sourceText('你好。');
    s.translationText('Hello.');
    at(3_000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    // The rest of that translation, after its cut: no source to follow, so the one that closed last.
    s.translationText(' And welcome.');
    at(4_500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4, origin: 's2' }]);
    // A second source, paid: the rest after it is its own, not the first's.
    s.sourceText('再见。');
    s.translationText('Goodbye.');
    at(6_000);
    s.translationText(' See you.');
    at(7_500);
    expect(closed().slice(4)).toEqual([{ ref: 5 }, { ref: 6 }, { ref: 7, origin: 's5' }]);
  });
});

describe("the translation's audio", () => {
  it('audio that counts opens a translation and is its activity; audio that does not neither, and plays with no ref outside one; play off emits none', () => {
    const { s, at, opened, audio, timers, closed } = segments();
    s.audio(pcm(), INACTIVE);
    expect(opened()).toEqual([]);
    expect(timers()).toBe(0);
    s.audio(pcm(), ACTIVE);
    expect(opened()).toEqual([{ ref: 1, side: 'translation' }]);
    expect(timers()).toBe(1);
    s.translationText('Hello.');
    at(1_000);
    s.audio(pcm(), INACTIVE);
    // Its pause runs from the last delta: audio that does not count does not hold it.
    at(1_500);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.audio(pcm(), { play: false, active: true });
    expect(opened()).toEqual([{ ref: 1, side: 'translation' }, { ref: 2, side: 'translation' }]);
    expect(audio()).toEqual([[undefined, undefined], [1, [0, 0]], [1, [0, 6]]]);
    // Held by audio that counts: its pause starts again with each frame.
    at(2_900);
    s.audio(pcm(), { play: false, active: true });
    at(4_399);
    expect(closed()).toEqual([{ ref: 1 }]);
  });
});

describe('typed text, .done, a turn end, stop (translation cuts, choices 12, 13)', () => {
  it('typed text is a source row of its own: no origin, no cut', () => {
    const { s, opened, closed, texts, timers } = segments();
    s.typed('typed words');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
    expect(texts(1)).toEqual(['typed words']);
    expect(closed()).toEqual([{ ref: 1 }]);
    expect(timers()).toBe(0);
    s.translationText('Typed.');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation' });
  });

  it("an answer to typed text states no origin, even after a spoken exchange: it follows no spoken source, so L2 pairs it with its typed row (choices 9, 12)", () => {
    const { s, at, closed } = segments();
    s.sourceText('你好。');
    s.translationText('Hello.');
    at(1_500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    s.typed('谢谢');
    at(2_000);
    s.translationText('Thank you.');
    at(3_500);
    expect(closed().slice(2)).toEqual([{ ref: 3 }, { ref: 4 }]);
  });

  it("a source's .done closes it now, owing its cut; the translation's settles it as its quiet would, without the hold", () => {
    const { s, closed, cuts } = segments();
    s.sourceText('你好');
    s.translationText('Hello and');
    s.done('translation');
    // Nothing owed, the source open: the translation waits for it.
    expect(closed()).toEqual([]);
    s.done('source');
    expect(closed()).toEqual([{ ref: 1 }]);
    s.done('translation');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'done', origin: 's1', sentences: 0, owed: 0, dropped: 0 }]);
  });

  it('a turn end closes the source and settles the translation for it', () => {
    const { s, closed, cuts, timers } = segments();
    s.sourceText('你好');
    s.translationText('Hello');
    s.endTurn();
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'turn', origin: 's1', sentences: 0, owed: 0, dropped: 0 }]);
    expect(timers()).toBe(0);
  });

  it('stop cancels every timer — a hold, a wait, the pause to begin — and says nothing after it', () => {
    type Harness = ReturnType<typeof segments>;
    for (const setUp of [
      // The mid-sentence hold.
      ({ s, at }: Harness) => { s.sourceText('一。'); s.translationText('One. Waiting for'); at(3_000); },
      // The wait for a source still open.
      ({ s, at }: Harness) => { s.sourceText('我们'); s.translationText('We.'); at(1_000); s.sourceText('走吧'); at(2_000); },
      // The pause to begin, after a source closed.
      ({ s, at }: Harness) => { s.sourceText('你好。'); at(2_000); },
    ]) {
      const h = segments();
      const { s, at, timers, log, cuts } = h;
      setUp(h);
      expect(timers()).toBe(1);
      const n = log.length;
      const c = cuts.length;
      s.stop();
      expect(timers()).toBe(0);
      at(20_000);
      s.sourceText('late');
      s.translationText('late.');
      s.audio(pcm(), ACTIVE);
      s.typed('late');
      s.done('source');
      s.endTurn();
      expect(timers()).toBe(0);
      expect(log.length).toBe(n);
      expect(cuts.length).toBe(c);
    }
  });
});

describe("the spike's three recorded sessions (translation cuts, ruling 1; choice 15)", () => {
  it.each([
    ['at the default pauses', SILENCE],
    ["with the translation's pause at 3 s, past every pause of the interpreter's: the cuts alone", { ...SILENCE, translationMs: 3_000 }],
  ])('pairs every source with its own translation, stated, none alone — the text alone, audio holding nothing — %s', (_name, silence) => {
    for (const [name, sources] of [['user', 6], ['tight', 6], ['long', 7]] as const) {
      const r = replay(RECORDINGS[name], (clock, sink) => {
        const s = new ContinuousSegments({ clock, silence, sink });
        return { input: (d) => s.sourceText(d), output: (d) => s.translationText(d), audio: (p) => s.audio(p, INACTIVE) };
      });
      expect({ name, sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ name, sources, paired: sources, orphans: 0 });
      expect(r.pairings).toEqual(new Array(sources).fill('stated'));
    }
  });

  /** A recording whose translation writes other marks: each of its deltas mapped. */
  const retarget = (r: Recording, map: (text: string) => string): Recording =>
    ({ run: r.run, events: r.events.map((e) => (e[1] === 't' ? [e[0], 't', map(e[2])] : e)) as RecordedEvent[] });

  /** A target that writes no mark whose stream still shows one, early — a question, an abbreviation — as Thai text may: the first delta's first mark kept, every other removed. */
  const oneEarlyMark = () => {
    let seen = false;
    return (t: string) => {
      const i = t.search(/[.?!]/);
      if (seen || i < 0) return t.replace(/[.?!]/g, '');
      seen = true;
      return t.slice(0, i + 1) + t.slice(i + 1).replace(/[.?!]/g, '');
    };
  };

  it.each([
    ['a target that ends its sentences with dandas, as Hindi does, pairs them all', () => (t: string) => t.replace(/[.?!]/g, '।'), [6, 6, 7], true],
    ['a target that writes no sentence-final mark, as Thai does, leaves none alone', () => (t: string) => t.replace(/[.?!]/g, ''), [6, 6, 6], true],
    ['the same, its stream showing one early Latin mark, with no mid-sentence hold for such a target', oneEarlyMark, [6, 6, 6], false],
  ] as const)('the same sessions, their translation in another script: %s (choices 3, 6)', (_name, make, paired, holdMidSentence) => {
    (['user', 'tight', 'long'] as const).forEach((name, i) => {
      const r = replay(retarget(RECORDINGS[name], make()), (clock, sink) => {
        const s = new ContinuousSegments({ clock, silence: SILENCE, sink, holdMidSentence });
        return { input: (d) => s.sourceText(d), output: (d) => s.translationText(d), audio: (p) => s.audio(p, INACTIVE) };
      });
      expect({ name, paired: r.paired, orphans: r.orphans }).toEqual({ name, paired: paired[i], orphans: 0 });
    });
  });
});
```

```diff
diff --git a/src/providers/sessionSide.consistency.test.ts b/src/providers/sessionSide.consistency.test.ts
--- a/src/providers/sessionSide.consistency.test.ts
+++ b/src/providers/sessionSide.consistency.test.ts
@@ -144,8 +144,8 @@
 }
 
 const isTest = (f: string) => /\.test\.tsx?$/.test(f);
-/** The kit, and each provider's fixtures (`src/providers/<name>/testing.ts`): whatever imports either must itself be test-only. */
-const inKit = (f: string) => f.startsWith('src/lib/contract/testing/') || /^src\/providers\/[^/]+\/testing\.ts$/.test(f);
+/** The kit, each provider's fixtures (`src/providers/<name>/testing.ts`) and any `*.testing.ts` (the recorded sessions' replay, Stage 2 translation cuts): whatever imports one must itself be test-only. */
+const inKit = (f: string) => f.startsWith('src/lib/contract/testing/') || /^src\/providers\/[^/]+\/testing\.ts$/.test(f) || /\.testing\.ts$/.test(f);
 
 /** Every `.ts` / `.tsx` under `src` (no `.d.ts`), the files each imports by value (resolved), and who imports each. */
 function importGraph(root: string): { files: string[]; importers: Map<string, Set<string>>; targets: Map<string, string[]> } {
@@ -295,6 +295,8 @@
 
   it("a session side runs no global timer: every timer reads the request's clock", () => {
     expect(providerDirs().flatMap((dir) => timerOffenders(REPO_ROOT, dir))).toEqual([]);
+    // The walk does not follow `src/lib/**`: the one shared module two session sides cut their segments with, by name (Stage 2 translation cuts, choice 1).
+    expect(globalTimerCalls(readFileSync(join(REPO_ROOT, 'src/lib/segmentation/continuousSegments.ts'), 'utf-8'))).toEqual([]);
   });
 
   it("only test-only modules import the adapter test kit or a provider's fixtures", () => {
```

- [ ] **Step 5: Run them to see them fail.**

Run: `npx vitest run src/lib/segmentation/continuousSegments.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: FAIL — `Test Files  2 failed (2)`, `Tests  1 failed | 7 passed (8)`: the module's test file does not load (`Failed to resolve import "./continuousSegments" from "src/lib/segmentation/continuousSegments.test.ts"`), and the consistency test's timer scan finds no module to read (`ENOENT: … src/lib/segmentation/continuousSegments.ts`). Its kit rule passes: no `*.testing.ts` has a production importer.

- [ ] **Step 6: Write the module**, `src/lib/segmentation/continuousSegments.ts` (rulings 1, 2; choices 1–10, 12–14):

```ts
/**
 * A continuous interpreter's two sides as segments — OpenAI Translate's and
 * Gemini Live Translate's, whose streams have no turns, so the adapter cuts
 * both (Stage 2 translation cuts, rulings 1, 3). The source is cut by its own
 * silence timer, as before: in sentence mode deferred mid-sentence while its
 * text grows (`SilenceDeferral`). The translation is cut where the source
 * was: each source segment that closes owes the translation one cut, and the
 * translation segment states the source it is cut for as its origin (ruling
 * 2) — the adapter's own rule, as OpenAI Realtime's "newest unanswered" is,
 * so L2 infers nothing for either side.
 *
 * - A closing source owes `{ origin, n, lastAt }`: `n` its sentence ends, at
 *   least one; `lastAt` when its last delta arrived, on the request's clock.
 * - The cut: once the open translation holds `n` sentence ends, the latest
 *   arriving strictly after `lastAt`, the next translation delta closes it
 *   and opens the next with itself (choice 4). Audio that arrives before that
 *   delta stays with the segment that closes.
 * - The translation's own quiet settles it: at a sentence end it closes for
 *   the cut owed first and drops any other still owed; mid-sentence it waits
 *   once more, to `MID_SENTENCE_HOLD_MS` after its last activity — once its
 *   stream has shown a sentence end at all, and never for a target whose
 *   script writes none (choices 6, 8). With nothing owed
 *   it waits for a source still open (choice 7), else closes as the rest of
 *   the source that closed last (choice 9).
 * - A source that closes while no translation is open gives the translation
 *   its pause to begin; if none begins, every owed cut is dropped, and one that
 *   begins while a newer source is already open follows that source (choice
 *   8).
 *
 * Pure: every timer on the clock it is handed, every time from its `now()`.
 */
import type { AdapterEvents, Ref } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import { SENTENCE_CLOSERS } from './sentenceEnd';
import { SilenceDeferral } from './silenceDeferral';

/** A translation that stops mid-sentence closes this long after its last activity, not at its pause (translation cuts, ruling 1; choice 6). */
export const MID_SENTENCE_HOLD_MS = 5_000;

/**
 * Marks that end a sentence wherever they stand: CJK `。？！` (ruling 1 (iii)),
 * and those of the scripts the ruling does not name — Devanagari and Bengali
 * `।॥`, Urdu `۔`, Arabic `؟`, Burmese `။`, Armenian `։`, Ethiopic `።`, Khmer
 * `។៕`, the fullwidth `．` and the halfwidth `｡` (translation cuts, choice 3).
 */
const ANYWHERE_ENDS = '。？！।॥۔؟။։።។៕．｡';
/** Marks that end a sentence only before whitespace or at the end: not "1.5", not "U.S" (ruling 1 (iii)). */
const LATIN_ENDS = '.?!';
const SPACE = /\s/;

/**
 * The one sentence-end rule (ruling 1 (iii); choice 3): whether `mark`, with
 * `next` the character after it, ends a sentence — `true`, `false`, or
 * `undefined` for a Latin mark with nothing after it yet, which what follows
 * settles, and which ends the text if nothing does.
 */
export function endsSentence(mark: string, next: string | undefined): boolean | undefined {
  if (ANYWHERE_ENDS.includes(mark)) return true;
  if (!LATIN_ENDS.includes(mark)) return false;
  return next === undefined ? undefined : SPACE.test(next);
}

/** The sentence ends a text holds: a Latin mark at its end counts (choice 3). */
export function countSentenceEnds(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (endsSentence(text[i], text[i + 1]) !== false) n += 1;
  return n;
}

/** The text ends at a sentence end, trailing whitespace and closing quotes and brackets aside (choice 6). */
export function atSentenceEnd(text: string): boolean {
  let i = text.trimEnd().length - 1;
  while (i >= 0 && SENTENCE_CLOSERS.includes(text[i])) i--;
  return i >= 0 && endsSentence(text[i], undefined) !== false;
}

export type SegmentSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>;

/**
 * Why a translation closed (choice 14): `sentences`, the cut owed first was
 * due; `quiet`, its own pause; `done`, the endpoint's `.done`; `turn`, a turn
 * end on a stream with none. `idle`: owed cuts dropped with no translation
 * to close — none began within its pause, or one began for a newer source.
 */
export type CutReason = 'sentences' | 'quiet' | 'done' | 'turn' | 'idle';

/** One cut, for the Logs (`translation.cut`; choice 14): never text. */
export interface CutSummary {
  reason: CutReason;
  /** The source the translation closed for; null for `idle`, or a translation that followed none. */
  origin: string | null;
  /** The translation's sentence ends; 0 for `idle`. */
  sentences: number;
  /** Cuts still owed after this one. */
  owed: number;
  /** Owed cuts dropped here, unanswered (choice 8). */
  dropped: number;
}

export interface ContinuousSegmentsOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  /** Each side's pause, and the source's mid-sentence deferral in sentence mode. */
  silence: { sourceMs: number; translationMs: number; deferMidSentence: boolean };
  sink: SegmentSink;
  /** The source's text as shown, and as its pauses and sentences are read: Gemini 3.x's CJK spaces removed. The identity when absent. */
  showSource?: (text: string) => string;
  /**
   * A translation that stops mid-sentence is held (choice 6) — `false` for a
   * target whose script writes no sentence-final mark (Thai, Lao), where a
   * stray Latin mark would otherwise turn the hold on for good. True when absent.
   */
  holdMidSentence?: boolean;
  /** Each cut, for the Logs (choice 14). */
  cut?: (summary: CutSummary) => void;
}

interface OpenSource {
  ref: Ref;
  /** Stated when it opens: `s<ref>` (choice 2). */
  origin: string;
  text: string;
  lastAt: number;
}

interface OpenTranslation {
  ref: Ref;
  /** Stated when it opened, when known then; else stated when it closes (choice 5). */
  origin: string | undefined;
  text: string;
  /** Where the last played frame's range ended: ranges by arrival. */
  spoken: number;
  /** Its sentence ends so far, and when the latest arrived (choice 3). */
  ends: number;
  lastEndAt: number;
  /** A Latin mark that ends the text so far, and when it arrived: what follows settles it (choice 3). */
  trailing: { mark: string; at: number } | null;
}

/** A closed source's claim on the translation (ruling 2). */
interface Owed {
  origin: string;
  n: number;
  lastAt: number;
}

export class ContinuousSegments {
  private refs = 0;
  private source: OpenSource | null = null;
  private translation: OpenTranslation | null = null;
  /** One per closed source, oldest first. */
  private readonly owed: Owed[] = [];
  /** The spoken source that closed last: a translation that follows no cut is its rest; typed text clears it (choice 9). */
  private lastClosed: string | undefined;
  private sourceTimer: (() => void) | null = null;
  /** The translation's pause, its mid-sentence hold, or — none open — its pause to begin after a source closed. */
  private translationTimer: (() => void) | null = null;
  private readonly deferral = new SilenceDeferral();
  /** The pause to begin runs: a source closed with no translation open, and none has begun (choice 8). */
  private beginning = false;
  /** The translation's stream has shown a sentence-end mark, one a Latin mark closing a delta may be: only then is a quiet mid-sentence held (choice 6). */
  private shownEnd = false;
  /** The mid-sentence hold is spent, until the translation's next activity (choice 6). */
  private held = false;
  /** Quiet with nothing owed while a source is open: it closes for that source's cut (choice 7). */
  private waiting = false;
  private stopped = false;

  constructor(private readonly o: ContinuousSegmentsOptions) {}

  /** A translation segment is open. */
  get translating(): boolean {
    return this.translation !== null;
  }

  /** A source transcript delta. */
  sourceText(delta: string): void {
    if (this.stopped || !delta) return;
    let s = this.source;
    if (!s) {
      const ref = ++this.refs;
      s = { ref, origin: `s${ref}`, text: '', lastAt: 0 };
      this.source = s;
      this.o.sink.segmentOpened({ ref, side: 'source', origin: s.origin });
    }
    s.text += delta;
    s.lastAt = this.o.clock.now();
    this.o.sink.segmentText({ ref: s.ref, text: this.show(s.text) });
    this.armSource();
  }

  /** A translation transcript delta: a cut that is due is taken first, and this delta opens the next segment (choice 4). */
  translationText(delta: string): void {
    if (this.stopped || !delta) return;
    const open = this.translation;
    if (open && this.cutDue(open, delta)) this.closeTranslation('sentences');
    const tr = this.translation ?? this.openTranslation();
    this.readEnds(tr, delta);
    tr.text += delta;
    this.o.sink.segmentText({ ref: tr.ref, text: tr.text });
    this.active();
  }

  /**
   * The translation's audio. `active`: it opens a translation when none is
   * open and is the translation's activity, as a delta is (OpenAI Translate's
   * frames above its noise floor); otherwise it does neither (Gemini's, and
   * OpenAI Translate's quiet frames). Played only when `play`: inside the open
   * translation with the stretch of its text that had arrived with it — a
   * range by arrival — and outside one with no ref.
   */
  audio(pcm: Int16Array, o: { play: boolean; active: boolean }): void {
    if (this.stopped || pcm.length === 0) return;
    if (o.active) {
      if (!this.translation) this.openTranslation();
      this.active();
    }
    if (!o.play) return;
    const tr = this.translation;
    if (!tr) {
      this.o.sink.audio({ pcm });
      return;
    }
    const end = tr.text.length;
    this.o.sink.audio({ pcm, ref: tr.ref, range: [tr.spoken, end] });
    tr.spoken = end;
  }

  /**
   * Typed text: a source row of its own, opened, written and closed at once;
   * it states no origin and owes no cut, and an answer to it, if any, follows
   * no spoken source, so L2 can pair the two (choices 9, 12).
   */
  typed(text: string): void {
    if (this.stopped) return;
    const ref = ++this.refs;
    this.lastClosed = undefined;
    this.o.sink.segmentOpened({ ref, side: 'source' });
    this.o.sink.segmentText({ ref, text });
    this.o.sink.segmentClosed({ ref });
  }

  /** A side's `.done`, should the endpoint send one: the source closes now; the translation settles as its quiet would (choice 13). */
  done(side: 'source' | 'translation'): void {
    if (this.stopped) return;
    if (side === 'source') this.closeSource();
    else if (this.translation) this.settle('done');
  }

  /** A turn's end on a stream with no turns: the source closes, then the translation settles (choice 12). */
  endTurn(): void {
    if (this.stopped) return;
    this.closeSource();
    if (this.translation) this.settle('turn');
  }

  /** No timer is left, and nothing is said after it: L1 finalizes what is open. */
  stop(): void {
    this.stopped = true;
    this.cancelSource();
    this.cancelTranslation();
  }

  private show(text: string): string {
    return this.o.showSource ? this.o.showSource(text) : text;
  }

  private armSource(): void {
    this.cancelSource();
    this.sourceTimer = this.o.clock.setTimeout(() => {
      this.sourceTimer = null;
      const s = this.source;
      if (this.stopped || !s) return;
      // While the display cuts by sentences, a pause mid-sentence is the speaker resting: one more window, while the text still grows (Gemini choice 7).
      if (this.o.silence.deferMidSentence && this.deferral.deferAtExpiry(this.show(s.text))) {
        this.armSource();
        return;
      }
      this.closeSource();
    }, this.o.silence.sourceMs);
  }

  private closeSource(): void {
    this.cancelSource();
    this.deferral.reset();
    const s = this.source;
    if (!s) return;
    this.source = null;
    this.lastClosed = s.origin;
    this.o.sink.segmentClosed({ ref: s.ref });
    this.owed.push({ origin: s.origin, n: Math.max(1, countSentenceEnds(this.show(s.text))), lastAt: s.lastAt });
    // No translation open: it has its pause to begin (choice 8). One waiting for this source: its pause starts now (choice 7).
    if (!this.translation) {
      this.beginning = true;
      this.armQuiet(this.o.silence.translationMs);
    } else if (this.waiting) {
      this.waiting = false;
      this.armQuiet(this.o.silence.translationMs);
    }
  }

  private openTranslation(): OpenTranslation {
    // Beginning within its pause, but with a newer source already open: it follows that source, and what the older ones were owed will not be answered (choice 8).
    if (this.beginning && this.source && this.owed.length > 0) this.dropOwed();
    this.beginning = false;
    const ref = ++this.refs;
    // Known now (choice 5): the cut owed first, else the source still open, whose cut is owed next.
    const origin = this.owed[0]?.origin ?? this.source?.origin;
    this.o.sink.segmentOpened(origin !== undefined ? { ref, side: 'translation', origin } : { ref, side: 'translation' });
    const tr: OpenTranslation = { ref, origin, text: '', spoken: 0, ends: 0, lastEndAt: -Infinity, trailing: null };
    this.translation = tr;
    return tr;
  }

  /** The cut owed first is due before `next`: the translation holds its sentence ends, the latest after the source's last delta (ruling 1; choice 4). */
  private cutDue(tr: OpenTranslation, next: string): boolean {
    const head = this.owed[0];
    if (!head) return false;
    let ends = tr.ends;
    let lastEndAt = tr.lastEndAt;
    if (tr.trailing && endsSentence(tr.trailing.mark, next[0])) {
      ends += 1;
      lastEndAt = tr.trailing.at;
    }
    return ends >= head.n && lastEndAt > head.lastAt;
  }

  /** Counts the sentence ends `delta` brings, each at its own delta's arrival; a Latin one ending the text waits for what follows (choice 3). */
  private readEnds(tr: OpenTranslation, delta: string): void {
    const at = this.o.clock.now();
    if (tr.trailing) {
      if (endsSentence(tr.trailing.mark, delta[0])) this.countEnd(tr, tr.trailing.at);
      tr.trailing = null;
    }
    for (let i = 0; i < delta.length; i++) {
      const ends = endsSentence(delta[i], delta[i + 1]);
      if (ends === undefined) {
        tr.trailing = { mark: delta[i], at };
        this.shownEnd = true;
      } else if (ends) this.countEnd(tr, at);
    }
  }

  private countEnd(tr: OpenTranslation, at: number): void {
    tr.ends += 1;
    tr.lastEndAt = at;
    this.shownEnd = true;
  }

  /** A delta, or audio that counts: the translation's pause starts again, its hold and its wait end (choice 6). */
  private active(): void {
    this.held = false;
    this.waiting = false;
    this.armQuiet(this.o.silence.translationMs);
  }

  private armQuiet(ms: number): void {
    this.cancelTranslation();
    this.translationTimer = this.o.clock.setTimeout(() => this.quiet(), ms);
  }

  private quiet(): void {
    this.translationTimer = null;
    if (this.stopped) return;
    const tr = this.translation;
    if (!tr) {
      // No translation began within its pause after a source closed: what is owed will not be answered (choice 8).
      this.beginning = false;
      this.dropOwed();
      return;
    }
    // Mid-sentence, the interpreter is waiting for the source: once more, to the hold after its last activity, which was this pause ago (choice 6) —
    // unless its stream has shown no sentence end yet, or its target writes none (Thai, Lao): then a pause is all there is.
    if (!this.held && this.o.holdMidSentence !== false && this.shownEnd && !atSentenceEnd(tr.text)) {
      this.held = true;
      this.armQuiet(Math.max(0, MID_SENTENCE_HOLD_MS - this.o.silence.translationMs));
      return;
    }
    this.settle('quiet');
  }

  /** The translation has said what it will: it closes for the cut owed first, else waits for a source still open (choices 7, 8). */
  private settle(reason: 'quiet' | 'done' | 'turn'): void {
    if (this.owed.length === 0 && this.source) {
      this.cancelTranslation();
      this.waiting = true;
      return;
    }
    this.closeTranslation(reason);
  }

  /** Every owed cut dropped with no translation to close (choice 8). */
  private dropOwed(): void {
    const dropped = this.owed.length;
    this.owed.length = 0;
    if (dropped > 0) this.o.cut?.({ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped });
  }

  /**
   * Closes the open translation for the cut owed first: its origin is what it
   * stated when it opened, else that cut's, else the spoken source that
   * closed last (choices 5, 9). Any close but a cut at its sentences settles:
   * every other owed cut is dropped (choice 8).
   */
  private closeTranslation(reason: Exclude<CutReason, 'idle'>): void {
    const tr = this.translation;
    if (!tr) return;
    this.cancelTranslation();
    this.held = false;
    this.waiting = false;
    const head = this.owed.shift();
    const dropped = reason === 'sentences' ? 0 : this.owed.length;
    this.owed.length -= dropped;
    const origin = tr.origin ?? head?.origin ?? this.lastClosed;
    this.translation = null;
    this.o.sink.segmentClosed(tr.origin === undefined && origin !== undefined ? { ref: tr.ref, origin } : { ref: tr.ref });
    this.o.cut?.({ reason, origin: origin ?? null, sentences: tr.ends + (tr.trailing ? 1 : 0), owed: this.owed.length, dropped });
  }

  private cancelSource(): void {
    this.sourceTimer?.();
    this.sourceTimer = null;
  }

  private cancelTranslation(): void {
    this.translationTimer?.();
    this.translationTimer = null;
  }
}
```

- [ ] **Step 7: Run them.**

Run: `npx vitest run src/lib/segmentation/continuousSegments.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 2 files, 47 tests (39 and 8).

- [ ] **Step 8: The gates.** `npx vitest run src` (0 failed, no unhandled errors; the replay: 574 files passed and 1 skipped, 7 492 tests passed and 2 skipped), the typecheck gate (the baseline), and the full tree (259; none naming `src/lib/segmentation/`). Nothing but its own test imports the module and the replay yet, so no other suite can move; the consistency test's walk over every provider is unchanged but for the kit rule's wider net, which catches nothing.

- [ ] **Step 9: Commit.**

```bash
git add scripts/dev/wire-probe/translation-cuts-fixtures.mts src/lib/segmentation/recordings/user.json src/lib/segmentation/recordings/tight.json src/lib/segmentation/recordings/long.json src/lib/segmentation/recordings/gemini-live-translate.json src/lib/segmentation/recordings/replay.testing.ts src/lib/segmentation/continuousSegments.ts src/lib/segmentation/continuousSegments.test.ts src/providers/sessionSide.consistency.test.ts
```

```bash
git commit -q -F - -- scripts/dev/wire-probe/translation-cuts-fixtures.mts src/lib/segmentation/recordings/user.json src/lib/segmentation/recordings/tight.json src/lib/segmentation/recordings/long.json src/lib/segmentation/recordings/gemini-live-translate.json src/lib/segmentation/recordings/replay.testing.ts src/lib/segmentation/continuousSegments.ts src/lib/segmentation/continuousSegments.test.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
feat(segmentation): a continuous interpreter's two sides, the translation cut at its source's cuts

OpenAI Translate and Gemini Live Translate cut each side on its own
silence, so an interpreter that pauses less than the speaker leaves
sources with no translation beside them. ContinuousSegments cuts the
source on its own pause, as before, and the translation where the source
was: each closing source owes one cut, taken at the next delta once the
translation holds that source's sentence ends, the latest after its last
delta, and the translation states that source as its origin. One rule
counts sentence ends, the marks of scripts such as Hindi's and Khmer's
among them. Its own quiet closes it only at a sentence end, once its
stream has shown one, and never for a target whose script writes no
mark, and drops cuts no translation answered. Four recorded
sessions, committed as small fixtures with their generator, replay
through L1 and L2; the replay is kit, and the module is in the
session-side timer scan by name. Not wired yet.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: OpenAI Translate's translation at its source's cuts, and its noise floor (Wave 2)

**Files:**
- Modify: `src/providers/openai_translate/wire.ts` (after `computeRms`, `:104-110`), `src/providers/openai_translate/segments.ts` (rewritten whole), `src/providers/openai_translate/adapter.ts` (the header; the `TranslateSegments` it builds, `:107`; the audio comment, `:293`)
- Test: `src/providers/openai_translate/wire.test.ts` (the audio block, `:86-115`), `src/providers/openai_translate/segments.test.ts`, `src/providers/openai_translate/segments.replay.test.ts` (new), `src/providers/openai_translate/adapter.test.ts` (the "what comes down" block, `:333-442`)

**Interfaces:**
- Consumes: Task 1's `ContinuousSegments`, `CutSummary`, `SegmentSink`, `MID_SENTENCE_HOLD_MS`, `RECORDINGS`, `replay`; the landed `computeRms`, `liveTranslate`, `SERVER`.
- Produces: `QUIET_RMS` (0.002) and `isQuietFrame(pcm: Int16Array): boolean` in `wire.ts`; `TranslateSegmentsOptions` gains `cut?: (summary: CutSummary) => void` and its clock `Pick<Clock, 'setTimeout' | 'now'>`; `segments.ts` no longer exports `SegmentSink` (nothing imported it: the module's is the one); the frame `translation.cut`. `TranslateSegments`' public methods are unchanged.

- [ ] **Step 1: Write the failing tests** (rulings 1, 2; choices 5–7, 11, 13–15): the noise floor on the wire; the segments' cases rewritten for the new rule — each keeps what it pinned where that still holds — and one new; the replay of the spike's three sessions through the real `segments.ts`, each exchange's two ends pinned against the spike's report; and through the adapter, the owner's case with its frames, the noise floor, `.done`, and the pairing through L1 and L2 now stated.

```diff
diff --git a/src/providers/openai_translate/wire.test.ts b/src/providers/openai_translate/wire.test.ts
--- a/src/providers/openai_translate/wire.test.ts
+++ b/src/providers/openai_translate/wire.test.ts
@@ -5,8 +5,8 @@
 import { redact } from '../../lib/diagnostics/redact';
 import { configFor, KEY, SERVER } from './testing';
 import {
-  appendFrame, base64ToPcm, computeRms, decodeServerEvent, elapsedMsOf, errorCode, errorWords, isSilentFrame, OUTPUT_RATE, pcmToBase64, sessionUpdate,
-  TRANSLATE_WS_URL, translateProtocols, translateUrl,
+  appendFrame, base64ToPcm, computeRms, decodeServerEvent, elapsedMsOf, errorCode, errorWords, isQuietFrame, isSilentFrame, OUTPUT_RATE, pcmToBase64, QUIET_RMS,
+  sessionUpdate, TRANSLATE_WS_URL, translateProtocols, translateUrl,
 } from './wire';
 
 /** The names the key is read through: the credentials' type and its one field. A string literal naming either counts too (an indexed or dynamic-property read), and so does any use of the protocol builder outside its own declaration — nothing else in `wire.ts` may call it. */
@@ -112,6 +112,18 @@
     expect(computeRms(new Int16Array(10).fill(-32768))).toBe(1);
     expect(computeRms(new Int16Array(10).fill(1638))).toBeCloseTo(0.05, 3);
   });
+
+  it("reads a frame below 0.002 RMS as the noise floor, not speech — the spike's near-silent frames among them (Stage 2 translation cuts, choice 11)", () => {
+    expect(QUIET_RMS).toBe(0.002);
+    // 65 / 32768 is 0.00198; 66 / 32768 is 0.00201.
+    expect(isQuietFrame(new Int16Array(4_800).fill(65))).toBe(true);
+    expect(isQuietFrame(new Int16Array(4_800).fill(66))).toBe(false);
+    // The spike's floor frames, 0.0001–0.0009.
+    expect(isQuietFrame(new Int16Array(9_600).fill(5))).toBe(true);
+    expect(isQuietFrame(new Int16Array(9_600).fill(30))).toBe(true);
+    // A heartbeat is below it too: the adapter drops it before any of this.
+    expect(isQuietFrame(new Int16Array(4_800))).toBe(true);
+  });
 });
 
 describe("OpenAI Translate's wire: what comes down", () => {
```

```diff
diff --git a/src/providers/openai_translate/segments.test.ts b/src/providers/openai_translate/segments.test.ts
--- a/src/providers/openai_translate/segments.test.ts
+++ b/src/providers/openai_translate/segments.test.ts
@@ -1,6 +1,7 @@
 import { describe, it, expect } from 'vitest';
 import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
 import { trackedClock } from '../../lib/contract/testing/trackedClock';
+import { MID_SENTENCE_HOLD_MS } from '../../lib/segmentation/continuousSegments';
 import type { TranslateConfig } from './config';
 import { TranslateSegments } from './segments';
 
@@ -17,20 +18,22 @@
   return { s, clock, timers, log, of, texts, opened, closed, audio };
 }
 const pcm = (n = 4_800) => new Int16Array(n).fill(900);
+/** A frame at the stream's noise floor: RMS 0.0009, as the spike's near-silent frames measured. */
+const floor = (n = 4_800) => new Int16Array(n).fill(30);
 
-describe("OpenAI Translate's segments: each side on its own timer", () => {
-  it('opens each side on its first delta, sends the whole text each time, and closes each on its own pause, stating no origin (`OpenAITranslateGAClient.test.ts:146-638`)', () => {
+describe("OpenAI Translate's segments: the source on its own timer, the translation at its cuts", () => {
+  it("opens each side on its first delta and sends the whole text each time; the source closes on its own pause, and the translation states that source as its origin (`OpenAITranslateGAClient.test.ts:146-638`; Stage 2 translation cuts, ruling 2)", () => {
     const { s, clock, timers, texts, opened, closed } = segments({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
     s.input('こんにちは');
     s.input('、元気');
-    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
+    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 's1' }]);
     expect(texts(1)).toEqual(['こんにちは', 'こんにちは、元気']);
     clock.advance(699);
     expect(closed()).toEqual([]);
     clock.advance(1);
     expect(closed()).toEqual([{ ref: 1 }]);
-    s.output('Hello');
-    expect(opened()[1]).toEqual({ ref: 2, side: 'translation' });
+    s.output('Hello.');
+    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
     clock.advance(2499);
     expect(closed()).toHaveLength(1);
     clock.advance(1);
@@ -50,27 +53,34 @@
     expect(opened().map((o) => o.ref)).toEqual([1, 2]);
   });
 
-  it('times the two sides independently: output text goes to the translation alone', () => {
+  it('sends output text to the translation alone, which with no cut owed waits for the source still open, then has its pause (translation cuts, choice 7)', () => {
     const { s, clock, texts, closed } = segments();
     s.input('speaking');
-    s.output('translating');
+    s.output('translating.');
     expect(texts(1)).toEqual(['speaking']);
-    expect(texts(2)).toEqual(['translating']);
+    expect(texts(2)).toEqual(['translating.']);
     clock.advance(1000);
     s.input(' on');
     clock.advance(600);
-    expect(closed()).toEqual([{ ref: 2 }]);
+    expect(closed()).toEqual([]);
+    clock.advance(900);
+    expect(closed()).toEqual([{ ref: 1 }]);
+    clock.advance(1500);
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
   });
 
-  it('opens a new source while the translation of the last one still streams', () => {
+  it('opens a new source while the translation of the last one still streams, and cuts that translation only at its sentence end', () => {
     const { s, clock, opened, texts } = segments({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
     s.input('first');
     s.output('premier');
     clock.advance(700);
     s.input('second');
     s.output(' toujours');
-    expect(opened()).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }, { ref: 3, side: 'source' }]);
+    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' }, { ref: 3, side: 'source', origin: 's3' }]);
     expect(texts(2)).toEqual(['premier', 'premier toujours']);
+    s.output('.');
+    s.output(' Deuxième');
+    expect(opened()[3]).toEqual({ ref: 4, side: 'translation', origin: 's3' });
   });
 
   it('ignores an empty delta and an empty frame', () => {
@@ -146,25 +156,51 @@
     expect(opened().map((o) => o.ref)).toEqual([1, 2]);
     expect(audio()).toEqual([[1, [0, 5]], [2, [0, 0]]]);
   });
+
+  it('a frame at the noise floor neither opens the translation nor holds it open: it plays inside one and is dropped outside one, as a heartbeat is (Stage 2 translation cuts, choice 11)', () => {
+    const { s, clock, timers, opened, closed, audio } = segments();
+    s.audio(floor(), true);
+    expect(opened()).toEqual([]);
+    expect(audio()).toEqual([]);
+    expect(timers()).toBe(0);
+    s.output('Hello.');
+    s.audio(floor(), true);
+    expect(audio()).toEqual([[1, [0, 6]]]);
+    // Its pause runs from the delta: the floor's frames after it hold nothing.
+    clock.advance(1000);
+    s.audio(floor(), true);
+    clock.advance(500);
+    expect(closed()).toEqual([{ ref: 1 }]);
+    s.audio(floor(), true);
+    expect(opened()).toHaveLength(1);
+    expect(audio()).toEqual([[1, [0, 6]], [1, [6, 6]]]);
+    expect(timers()).toBe(0);
+  });
 });
 
 describe("OpenAI Translate's segments: sentence mode, the .done events, stop", () => {
-  it('under sentence mode a mid-sentence pause waits while the text grows, on each side, and closes once it stops (Gemini choice 7)', () => {
+  it("under sentence mode the source's mid-sentence pause waits while its text grows (Gemini choice 7); the translation's mid-sentence hold is its own, in every mode (translation cuts, choice 6)", () => {
     const { s, clock, timers, closed } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
     s.input('He said that');
-    s.output('Il a dit que');
     clock.advance(1000);
     expect(closed()).toEqual([]);
     s.input(' we should');
     clock.advance(1000);
-    // The translation's tail did not grow: it closes; the source's did, and waits once more.
-    expect(closed()).toEqual([{ ref: 2 }]);
+    expect(closed()).toEqual([]);
     clock.advance(1000);
-    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }]);
+    // Its tail stopped growing: it closes.
+    expect(closed()).toEqual([{ ref: 1 }]);
+    s.output('Il a dit. Et que');
+    // The translation stops mid-sentence, its stream having shown a sentence end: not the source's deferral, which would close it at its second window,
+    // but its own hold, to 5 s after its last activity.
+    clock.advance(2000);
+    expect(closed()).toEqual([{ ref: 1 }]);
+    clock.advance(MID_SENTENCE_HOLD_MS - 2000);
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
     expect(timers()).toBe(0);
     s.input('Done.');
     clock.advance(1000);
-    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }, { ref: 3 }]);
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
   });
 
   it('without sentence mode a mid-sentence pause closes at once', () => {
@@ -174,20 +210,24 @@
     expect(closed()).toEqual([{ ref: 1 }]);
   });
 
-  it('closes a side at a .done event, should one come (choice 18), and leaves the other on its timer', () => {
+  it("closes the source at its .done, should one come (choice 18), owing its cut; the translation's .done settles it as its quiet would (translation cuts, choice 13)", () => {
     const { s, clock, timers, closed, opened } = segments();
     s.input('speaking');
     s.output('translating');
     s.done('translation');
-    expect(closed()).toEqual([{ ref: 2 }]);
-    expect(timers()).toBe(1);
+    // No cut owed, its source still open: it waits for that source.
+    expect(closed()).toEqual([]);
+    s.done('source');
+    expect(closed()).toEqual([{ ref: 1 }]);
     s.done('translation');
-    expect(closed()).toHaveLength(1);
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
+    s.done('translation');
+    expect(closed()).toHaveLength(2);
     s.audio(pcm(), true);
     expect(opened().map((o) => o.ref)).toEqual([1, 2, 3]);
-    s.done('source');
+    // Audio with no text, in a stream that has shown no sentence end: its pause closes it, as the rest of the source that closed last.
     clock.advance(1500);
-    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }, { ref: 3 }]);
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3, origin: 's1' }]);
     expect(timers()).toBe(0);
   });
 
@@ -213,9 +253,9 @@
     s.input('He said that');
     s.output('Translated.');
     clock.advance(1000);
-    // The deferral re-armed the source's countdown; the translation, at a sentence end, closed.
+    // The deferral re-armed the source's countdown; the translation, at a sentence end with no cut owed, waits for that source with no timer of its own.
     expect(timers()).toBe(1);
-    // Content audio reopens the translation and arms its own timer again, so stop has both sides live to cancel.
+    // Content audio holds the translation and arms its own timer again, so stop has both sides live to cancel.
     s.audio(pcm(), true);
     expect(timers()).toBe(2);
     const n = log.length;
```

`src/providers/openai_translate/segments.replay.test.ts` (new):

```ts
import { describe, it, expect } from 'vitest';
import { RECORDINGS, replay } from '../../lib/segmentation/recordings/replay.testing';
import type { TranslateConfig } from './config';
import { TranslateSegments } from './segments';

/**
 * Each exchange the panel shows: its source's first four characters, and
 * its translation's first two words and last word — the pair's two ends.
 * Read from the spike's report, where the translation of each sentence is
 * the one whose audio says it (whisper-1's word timestamps).
 */
const EXPECTED = {
  user: [
    ['今天我去', 'Today I', 'Japanese.'], ['店里的装', 'The interior', 'up.'], ['看起来十', 'It looked', 'done.'],
    ['下午快接', 'Since it', 'rush.'], ['排骨有点', 'The ribs', 'soup.'], ['店里的贩', "The shop's", 'bills.'],
  ],
  tight: [
    ['今天我吃', 'Today I', 'Japanese.'], ['店里的装', 'The place', 'carelessly.'], ['看起来十', 'It looks', 'done.'],
    ['下午快接', 'By late', 'alone.'], ['排骨有点', 'The ribs', 'eat.'], ['店里的贩', 'The vending', 'bills.'],
  ],
  long: [
    ['今天我去', 'Today I', 'Japanese.'], ['店里的装', 'The place', 'it.'], ['下午快接', 'It was', 'it.'], ['排骨有点', 'The ribs', 'soup.'],
    ['店里的贩', 'The vending', 'notes.'], ['吃完以后', 'After I', 'while.'], ['天气有点', 'It was', 'lovely.'],
  ],
} as const;

describe("OpenAI Translate's segments on the spike's three recorded sessions (Stage 2 translation cuts, ruling 1; choice 15)", () => {
  it.each([
    ['by pause, at the default pauses', { sourceMs: 1500, translationMs: 1500, deferMidSentence: false }],
    ['by sentence', { sourceMs: 1500, translationMs: 1500, deferMidSentence: true }],
    ["with the translation's pause at 3 s, past every pause of the interpreter's", { sourceMs: 1500, translationMs: 3000, deferMidSentence: false }],
  ] as ReadonlyArray<[string, TranslateConfig['silence']]>)('gives every source its own translation, stated, and leaves none alone — %s', (_name, silence) => {
    for (const name of ['user', 'tight', 'long'] as const) {
      const r = replay(RECORDINGS[name], (clock, sink) => {
        const s = new TranslateSegments({ clock, silence, sink });
        return { input: (d) => s.input(d), output: (d) => s.output(d), audio: (pcm) => s.audio(pcm, true) };
      });
      const sources = EXPECTED[name].length;
      expect({ name, sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ name, sources, paired: sources, orphans: 0 });
      expect(r.pairings).toEqual(new Array(sources).fill('stated'));
      expect(r.exchanges.map(([source, translation]) => {
        const words = translation.split(' ');
        return [source.slice(0, 4), words.slice(0, 2).join(' '), words[words.length - 1]];
      })).toEqual(EXPECTED[name]);
    }
  });
});
```

```diff
diff --git a/src/providers/openai_translate/adapter.test.ts b/src/providers/openai_translate/adapter.test.ts
--- a/src/providers/openai_translate/adapter.test.ts
+++ b/src/providers/openai_translate/adapter.test.ts
@@ -331,13 +331,13 @@
 });
 
 describe('the OpenAI Translate adapter: what comes down', () => {
-  it('makes each side a segment with no origin, timing or language, and frames every delta with its elapsed_ms (ruling 6)', async () => {
+  it('makes each side a segment with no timing or language, the source stating its origin and the translation that source, and frames every delta with its elapsed_ms (ruling 6; Stage 2 translation cuts, ruling 2)', async () => {
     const h = await liveTranslate();
     h.socket().receive(SERVER.input('こんにちは', 200));
     h.socket().receive(SERVER.input('、元気?', 400));
     h.socket().receive(SERVER.output('Hello,', 1_000));
     h.socket().receive(SERVER.output(' how are you?', null));
-    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }]);
+    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' }]);
     expect(h.of('segmentText').map((e) => e.payload)).toEqual([
       { ref: 1, text: 'こんにちは' }, { ref: 1, text: 'こんにちは、元気?' }, { ref: 2, text: 'Hello,' }, { ref: 2, text: 'Hello, how are you?' },
     ]);
@@ -367,6 +367,46 @@
     expect(h.timers()).toBe(0);
   });
 
+  it('plays a frame at the noise floor inside an open translation and frames it, but it neither opens one nor holds it open (Stage 2 translation cuts, choice 11)', async () => {
+    const h = await liveTranslate();
+    h.socket().receive(SERVER.audio({ fill: 30 }));
+    expect(h.of('segmentOpened')).toEqual([]);
+    expect(h.frames('session.output_audio.delta')).toEqual([{ samples: 4_800, rms: 0.0009, elapsedMs: 0, sampleRate: 24_000 }]);
+    h.socket().receive(SERVER.output('Hello.'));
+    h.clock.advance(1_000);
+    h.socket().receive(SERVER.audio({ fill: 30 }));
+    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.range])).toEqual([[1, [0, 6]]]);
+    h.clock.advance(500);
+    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
+    expect(h.timers()).toBe(0);
+  });
+
+  it("cuts the translation where the source was cut, even when the interpreter pauses less than the speaker, and frames each cut (Stage 2 translation cuts, rulings 1, 2; choice 14)", async () => {
+    const h = await liveTranslate();
+    h.socket().receive(SERVER.input('第一句'));
+    h.clock.advance(1_000);
+    h.socket().receive(SERVER.input('话。'));
+    h.clock.advance(200);
+    h.socket().receive(SERVER.output('The first'));
+    h.clock.advance(600);
+    h.socket().receive(SERVER.output(' sentence.'));
+    // The speaker pauses 2 s, past the source's 1.5 s; the interpreter goes on 1.4 s after its sentence, inside its own 1.5 s.
+    h.clock.advance(1_200);
+    h.socket().receive(SERVER.input('第二句。'));
+    h.clock.advance(200);
+    h.socket().receive(SERVER.output(' The second.'));
+    h.clock.advance(1_500);
+    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([
+      { ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' },
+      { ref: 3, side: 'source', origin: 's3' }, { ref: 4, side: 'translation', origin: 's3' },
+    ]);
+    expect(h.of('segmentText').filter((e) => e.payload.ref === 2).map((e) => e.payload.text)).toEqual(['The first', 'The first sentence.']);
+    expect(h.frames('translation.cut')).toEqual([
+      { reason: 'sentences', origin: 's1', sentences: 1, owed: 0, dropped: 0 },
+      { reason: 'quiet', origin: 's3', sentences: 1, owed: 0, dropped: 0 },
+    ]);
+  });
+
   it('a leg that does not speak gets the same rows and sends the same configuration, and emits no audio: Text only changes playback alone (ruling 4; choice 5)', async () => {
     const run = async (speech: boolean) => {
       const h = await liveTranslate({ context: { ...AUTO_CTX, speech } });
@@ -405,22 +445,25 @@
     expect(silent.of('degraded')).toEqual([]);
   });
 
-  it('closes a side at a .done event should one come, and frames what it does not know (choice 18)', async () => {
+  it("closes the source at its .done should one come, owing its cut, settles the translation at its own, and frames what it does not know (choice 18; Stage 2 translation cuts, choices 13, 14)", async () => {
     const h = await liveTranslate();
     h.socket().receive(SERVER.input('speaking'));
     h.socket().receive(SERVER.output('translating'));
     h.socket().receive(SERVER.bare('session.output_audio.done'));
-    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 2 }]);
+    // No cut owed and its source still open: the translation waits for that source.
+    expect(h.of('segmentClosed')).toEqual([]);
     h.socket().receive(SERVER.bare('session.input_transcript.done'));
-    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 2 }, { ref: 1 }]);
+    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
     h.socket().receive(SERVER.bare('session.output_transcript.done'));
+    expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }, { ref: 2 }]);
     h.socket().receive(SERVER.bare('rate_limits.updated'));
     expect(h.frames('session.output_audio.done')).toHaveLength(1);
     expect(h.frames('session.input_transcript.done')).toHaveLength(1);
+    expect(h.frames('translation.cut')).toEqual([{ reason: 'done', origin: 's1', sentences: 0, owed: 0, dropped: 0 }]);
     expect(h.frames('session.unknown')).toEqual([{ type: 'rate_limits.updated' }]);
   });
 
-  it('pairs an exchange by proximity through the projection (F16): no origin stated, inferred', async () => {
+  it('pairs an exchange through the projection by the origin it states (Stage 2 translation cuts, ruling 2): stated, not inferred', async () => {
     const h = await liveTranslate();
     const conv = new Conversation({ leg: 'speaker', session: 'translate', languages: AUTO_CTX.direction, clock: h.clock });
     let folded = 0;
@@ -437,7 +480,7 @@
     const entries = createProjector().project([conv.snapshot()], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
     const exchanges = entries.filter((e) => e.kind === 'exchange');
     expect(exchanges).toHaveLength(1);
-    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('inferred'); }
+    for (const ex of exchanges) { if (ex.kind === 'exchange') expect(ex.pairing).toBe('stated'); }
   });
 });
 
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/openai_translate`
Expected: FAIL — `Test Files  4 failed | 7 passed (11)`, `Tests  15 failed | 116 passed (131)`:
- `wire.test.ts`, 1: the noise floor — `QUIET_RMS` and `isQuietFrame` do not exist;
- `segments.test.ts`, 6: the first case (the source states no origin), "sends output text to the translation alone …" (it closes at its pause, the source still open), "opens a new source while …" (no origins), the noise floor (it opens a translation), sentence mode (the translation's deferral closes it at its second window, 2 000 ms after its text, where the hold keeps it to 5 000 ms), the `.done` case (it closes at once);
- `segments.replay.test.ts`, 3 — today's rule: `{ name: 'user', sources: 6, paired: 5, orphans: 0 }` for a `paired` of 6 by pause (the three sessions: 12 of 19, and 3 alone), the same `user` line by sentence, and `paired: 1` with the translation's pause at 3 s;
- `adapter.test.ts`, 5: the segments case (no origins), the noise floor, the owner's case (one translation for both sources), the `.done` case, and the pairing through L1 and L2 (`inferred`).

- [ ] **Step 3: The noise floor, the segments on the module, and the frame.**

```diff
diff --git a/src/providers/openai_translate/wire.ts b/src/providers/openai_translate/wire.ts
--- a/src/providers/openai_translate/wire.ts
+++ b/src/providers/openai_translate/wire.ts
@@ -101,7 +101,7 @@
   return true;
 }
 
-/** RMS over [0, 1] (the old `computeRms`), for the Logs' audio frames only. */
+/** RMS over [0, 1] (the old `computeRms`): the Logs' audio frames, and the noise floor below. */
 export function computeRms(pcm: Int16Array): number {
   if (pcm.length === 0) return 0;
   let sum = 0;
@@ -109,6 +109,21 @@
   return Math.sqrt(sum / pcm.length) / 32768;
 }
 
+/**
+ * Below this RMS an output frame is the stream's noise floor, not speech:
+ * the OpenAI Live client's `OUTPUT_SILENCE_RMS`, set 3× above the floor it
+ * measured and 15× below the quietest speech. OpenAI Translate sends such
+ * frames beside its all-zero heartbeats — 0.0001–0.0009 in the spike's
+ * sessions — and they are not the translation speaking (Stage 2 translation
+ * cuts, ruling 1; choice 11).
+ */
+export const QUIET_RMS = 0.002;
+
+/** A frame below the noise floor: it neither opens the translation nor holds it open (choice 11). A heartbeat is one too, dropped before this. */
+export function isQuietFrame(pcm: Int16Array): boolean {
+  return computeRms(pcm) < QUIET_RMS;
+}
+
 /** A delta's `elapsed_ms` when it is a number, else null: framed on every delta (ruling 6), read for nothing else yet. */
 export function elapsedMsOf(e: { elapsed_ms?: unknown }): number | null {
   return typeof e.elapsed_ms === 'number' ? e.elapsed_ms : null;
```

Replace the whole of `src/providers/openai_translate/segments.ts` with:

```ts
/**
 * OpenAI Translate's deltas → segments (survey §2.9): a stream with no turns,
 * cut by `ContinuousSegments` (Stage 2 translation cuts, rulings 1, 2) — the
 * source by its own silence timer, the translation where the source was cut,
 * stating the source it follows as its origin, all on the request's clock.
 * Gemini's Live Translate half uses the same module (ruling 3).
 *
 * What is this provider's own is its audio. A frame at or above the noise
 * floor opens the translation when none is open and holds it as a delta
 * does, whether it plays or not, so Text only changes playback and nothing
 * else (choice 5); one below the floor does neither, plays inside an open
 * translation and is dropped outside one, as a heartbeat is (translation
 * cuts, choice 11). Each played frame carries the translation's text as it
 * stood at the frame's arrival — a range by arrival (ruling 6; choice 6).
 */
import type { Clock } from '../../lib/contract/clock';
import { ContinuousSegments, type CutSummary, type SegmentSink } from '../../lib/segmentation/continuousSegments';
import type { TranslateConfig } from './config';
import { isQuietFrame } from './wire';

export interface TranslateSegmentsOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  silence: TranslateConfig['silence'];
  sink: SegmentSink;
  /** Each translation cut, for the Logs (translation cuts, choice 14). */
  cut?: (summary: CutSummary) => void;
}

export class TranslateSegments {
  private readonly segments: ContinuousSegments;

  constructor(o: TranslateSegmentsOptions) {
    this.segments = new ContinuousSegments(o);
  }

  /** A source transcript delta. */
  input(delta: string): void {
    this.segments.sourceText(delta);
  }

  /** A translation transcript delta. */
  output(delta: string): void {
    this.segments.translationText(delta);
  }

  /** An output frame the adapter did not drop as a heartbeat; `play` when this leg plays it (choices 5, 16). */
  audio(pcm: Int16Array, play: boolean): void {
    if (pcm.length === 0) return;
    const quiet = isQuietFrame(pcm);
    if (quiet && !this.segments.translating) return;
    this.segments.audio(pcm, { play, active: !quiet });
  }

  /** A `.done` event, should the endpoint send one (choice 18; translation cuts, choice 13). */
  done(side: 'source' | 'translation'): void {
    this.segments.done(side);
  }

  stop(): void {
    this.segments.stop();
  }
}
```

```diff
diff --git a/src/providers/openai_translate/adapter.ts b/src/providers/openai_translate/adapter.ts
--- a/src/providers/openai_translate/adapter.ts
+++ b/src/providers/openai_translate/adapter.ts
@@ -6,7 +6,9 @@
  * the translations endpoint, the key in a subprotocol (choice 3). The start
  * resolves on `session.updated`, the configuration confirmed, so a refused
  * one rejects in words within a bound (choices 1, 2). Deltas become segments
- * (`segments.ts`); a push-to-talk release sends a real-time silence tail
+ * (`segments.ts`), the translation cut where the source was and stating it as
+ * its origin (Stage 2 translation cuts, rulings 1, 2); a push-to-talk release
+ * sends a real-time silence tail
  * (`tail.ts`, ruling 2). Every timer reads the request's clock, and nothing
  * is said but through events (CLAUDE.md, "Inside an IClient session").
  */
@@ -104,7 +106,13 @@
     const { config, clock, signal } = request;
     // WebSocket only (2026-09-29): every config says `websocket`.
     this.info = { transport: config.transport };
-    this.segments = new TranslateSegments({ clock, silence: config.silence, sink: events });
+    this.segments = new TranslateSegments({
+      clock,
+      silence: config.silence,
+      sink: events,
+      // Each translation cut and why, for the live test (Stage 2 translation cuts, choice 14).
+      cut: (summary) => this.frame('out', 'translation.cut', summary),
+    });
     this.tail = new ReleaseTail({ clock, send: (pcm) => this.send(pcm), ended: (summary) => this.tailEnded(summary) });
     this.socket = openSocket(translateUrl(config), translateProtocols(request.credentials));
     this.socket.binaryType = 'arraybuffer';
@@ -290,7 +298,7 @@
     const rate = typeof e.sample_rate === 'number' ? e.sample_rate : OUTPUT_RATE;
     this.frame('in', e.type, { samples: pcm.length, rms: Math.round(computeRms(pcm) * 10_000) / 10_000, elapsedMs: elapsedMsOf(e), sampleRate: rate });
     if (rate !== OUTPUT_RATE) this.foreignRate(rate);
-    // Played only on a leg that speaks, at the contract's rate; it holds the translation either way (choices 5, 16).
+    // Played only on a leg that speaks, at the contract's rate; above the noise floor it holds the translation either way (choices 5, 16; translation cuts, choice 11).
     this.segments.audio(pcm, this.request.context.speech && rate === OUTPUT_RATE);
     this.tail.output();
   }
```

- [ ] **Step 4: Run OpenAI Translate's suites and the session-side guard.**

Run: `npx vitest run src/providers/openai_translate src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 12 files, 139 tests. The conformance scenarios pass unchanged: they read what opens and what follows the stop, and no rule reads an origin; their exchange (`こんにちは。`, `Hello.`, a content frame, a heartbeat, 2 s) closes both sides as before, now stating one. `tail.test.ts` and the tail's adapter cases are untouched: `tail.output()` is called as before (choice 11). The session-side walk still lists `segments.ts` and `wire.ts`; it does not follow `src/lib/**`.

- [ ] **Step 5: The gates.** The suite and the typecheck gate, and the full tree (in Wave 2, a failure in `src/providers/gemini/` is Task 3's).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/openai_translate/wire.ts src/providers/openai_translate/wire.test.ts src/providers/openai_translate/segments.ts src/providers/openai_translate/segments.test.ts src/providers/openai_translate/segments.replay.test.ts src/providers/openai_translate/adapter.ts src/providers/openai_translate/adapter.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_translate/wire.ts src/providers/openai_translate/wire.test.ts src/providers/openai_translate/segments.ts src/providers/openai_translate/segments.test.ts src/providers/openai_translate/segments.replay.test.ts src/providers/openai_translate/adapter.ts src/providers/openai_translate/adapter.test.ts <<'EOF'
feat(openai-translate): the translation follows the source's cuts, and the noise floor holds nothing

The translation was cut on its own silence and paired by proximity, so an
interpreter that pauses less than the speaker left sources with no
translation, and near-silent output frames held the translation open.
Segments now come from ContinuousSegments: the translation is cut where
its source was and states that source as its origin. A frame below RMS
0.002 neither opens nor holds a translation; it still plays inside one.
Each translation cut is framed as translation.cut. The spike's three
recorded sessions pair 19 of 19, stated, where the old rule paired 12.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: Gemini Live Translate's translation at its source's cuts (Wave 2)

**Files:**
- Modify: `src/providers/gemini/turns.ts` (the header, the imports, `GeminiTurnsOptions`, a default for Live Translate's pauses, the fields, the constructor, the Live Translate paths of `input`, `output`, `audio`, `modelText`, `turnComplete`, `interrupted`, `typed`, `stop`; `close`, `arm`, `cancel`, `:305-336`), `src/providers/gemini/adapter.ts` (its `./turns` import, `:34`; the `GeminiTurns` it builds, `:115-121`)
- Test: `src/providers/gemini/turns.test.ts` (its `./turns` import; the Live Translate block, `:545-737`), `src/providers/gemini/turns.replay.test.ts` (new), `src/providers/gemini/adapter.test.ts` (the Live Translate case, `:261-271`, and a new one after it; the L1 and L2 block, `:618-648`)

**Interfaces:**
- Consumes: Task 1's `ContinuousSegments`, `CutSummary`, `MID_SENTENCE_HOLD_MS`, `RECORDINGS` (`geminiLiveTranslate` among them), `replay`; `DEFAULT_SEGMENT_PAUSE_MS` (`src/lib/segmentation/segmentationMode.ts`); the landed `normalizeCjkSpaces`, `liveGemini`, `SERVER`, `TRANSLATE`, `trackedClock`, `recordEvents`.
- Produces: `GeminiTurnsOptions` gains `cut?: (summary: CutSummary) => void`, `holdMidSentence?: boolean` (handed to the module) and its clock `Pick<Clock, 'setTimeout' | 'now'>`; `writesSentenceMarks(target: string | undefined): boolean` (`turns.ts`), false for a Thai or Lao target by its base language, which the adapter passes as `holdMidSentence`; `kind: 'translate'` alone makes a Live Translate `GeminiTurns`; the frame `translation.cut` on Live Translate. `GeminiTurns`' public methods are unchanged; its dialogue half is untouched.

- [ ] **Step 1: Write the failing tests** (rulings 1–3; choices 5–7, 9, 12, 14, 15): the Live Translate cases rewritten for the new rule — each keeps what it pinned where that still holds — and seven new, `GeminiTurns` as Live Translate by its kind alone among them, and the two of the target key (Revision 2, N1): which targets write sentence-final marks, and a `GeminiTurns` with no mid-sentence hold; the replay of the recorded push-to-talk Live Translate session, its exchanges pinned, and of the spike's sessions, through `GeminiTurns` under Gemini's audio rules; and through the adapter, the frame, a Thai target holding nothing mid-sentence where an English one holds, the pairing through L1 and L2 now stated, and an answer to typed text beside its typed row.

```diff
diff --git a/src/providers/gemini/turns.test.ts b/src/providers/gemini/turns.test.ts
--- a/src/providers/gemini/turns.test.ts
+++ b/src/providers/gemini/turns.test.ts
@@ -1,8 +1,9 @@
 import { describe, it, expect } from 'vitest';
 import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
+import { MID_SENTENCE_HOLD_MS } from '../../lib/segmentation/continuousSegments';
 import type { GeminiConfig } from './config';
 import { trackedClock } from './testing';
-import { GeminiTurns, normalizeCjkSpaces } from './turns';
+import { GeminiTurns, normalizeCjkSpaces, writesSentenceMarks } from './turns';
 
 function turns(o: { kind?: GeminiConfig['kind']; speech?: boolean; silence?: GeminiConfig['silence'] } = {}) {
   // `timers()` counts what has neither fired nor been cancelled: the clock rule's proof that no timer outlives what should end it.
@@ -542,18 +543,19 @@
   });
 });
 
-describe('Live Translate: no turns, each side on its own silence timer (ruling 1)', () => {
+describe("Live Translate: no turns — the source on its own silence timer, the translation at the source's cuts (ruling 1; Stage 2 translation cuts, ruling 3)", () => {
   const translate = (silence?: GeminiConfig['silence']) => turns({ kind: 'translate', silence });
 
-  it('runs each side on its own pause, and states no origin (`GeminiClient.test.ts:808`)', () => {
+  it('runs the source on its own pause, stating its origin, and the translation states that source (`GeminiClient.test.ts:808`; Stage 2 translation cuts, ruling 2)', () => {
     const { t, clock, timers, opened, closed } = translate({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
     t.input('first utterance');
-    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
+    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 's1' }]);
     clock.advance(699);
     expect(closed()).toEqual([]);
     clock.advance(1);
     expect(closed()).toEqual([{ ref: 1 }]);
     t.output('最初の翻訳。');
+    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
     clock.advance(2499);
     expect(closed()).toHaveLength(1);
     clock.advance(1);
@@ -577,14 +579,40 @@
     expect(texts(2)).toEqual(['second utterance']);
   });
 
-  it('times the two sides independently (`:864`)', () => {
+  it("cuts the translation where the source was, when the interpreter pauses less than the speaker, and reads the source with its CJK spaces removed (Stage 2 translation cuts, rulings 1, 3)", () => {
+    const { t, clock, opened, closed, texts } = translate();
+    t.input('第 一 句');
+    clock.advance(1000);
+    t.input(' 话 。');
+    clock.advance(200);
+    t.output('The first');
+    clock.advance(600);
+    t.output(' sentence.');
+    // The speaker pauses 2 s, past the source's 1.5 s; the interpreter's pause, 1.4 s, is inside its own.
+    clock.advance(1200);
+    t.input('第 二 句 。');
+    clock.advance(200);
+    t.output(' The second.');
+    expect(texts(1)).toEqual(['第一句', '第一句话。']);
+    expect(opened()).toEqual([
+      { ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' },
+      { ref: 3, side: 'source', origin: 's3' }, { ref: 4, side: 'translation', origin: 's3' },
+    ]);
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
+  });
+
+  it('a translation with no cut owed waits for the source still open, then closes for its cut (`:864`; Stage 2 translation cuts, choice 7)', () => {
     const { t, clock, closed } = translate();
     t.input('speaking');
-    t.output('translating');
+    t.output('translating.');
     clock.advance(1000);
     t.input(' and continuing');
     clock.advance(600);
-    expect(closed()).toEqual([{ ref: 2 }]);
+    expect(closed()).toEqual([]);
+    clock.advance(900);
+    expect(closed()).toEqual([{ ref: 1 }]);
+    clock.advance(1500);
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
   });
 
   it('audio never holds a timer open: it streams straight through pauses (`:881`)', () => {
@@ -597,6 +625,15 @@
     expect(closed()).toEqual([{ ref: 1 }]);
   });
 
+  it(`once its stream has shown a sentence end, a translation that stops mid-sentence waits to ${MID_SENTENCE_HOLD_MS} ms after its last text, not its pause (Stage 2 translation cuts, choice 6)`, () => {
+    const { t, clock, closed } = translate();
+    t.output('Il a dit. Et que');
+    clock.advance(1500);
+    expect(closed()).toEqual([]);
+    clock.advance(MID_SENTENCE_HOLD_MS - 1500);
+    expect(closed()).toEqual([{ ref: 1 }]);
+  });
+
   it("audio outside an open translation plays with no ref; inside one it is that segment's (choice 8)", () => {
     const { t, clock, timers, of, opened } = translate();
     t.audio(pcm());
@@ -630,14 +667,18 @@
     ]);
   });
 
-  it('keeps its open segments across a reconnect, closing them on their own timers (`:914`; choice 14)', () => {
-    const { t, clock, timers, closed } = translate();
+  it('keeps its open segments across a reconnect, closing them on their own timers, and the cut a source owes (`:914`; choice 14; Stage 2 translation cuts, choice 12)', () => {
+    const { t, clock, timers, closed, opened } = translate();
     t.input('interrupted mid-sentence');
     t.connectionLost();
     expect(closed()).toEqual([]);
     expect(timers()).toBe(1);
     clock.advance(1500);
     expect(closed()).toEqual([{ ref: 1 }]);
+    t.output('Cut short.');
+    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
+    clock.advance(1500);
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
     expect(timers()).toBe(0);
   });
 
@@ -651,10 +692,11 @@
     expect(closed()).toEqual([]);
     clock.advance(1000);
     expect(closed()).toEqual([{ ref: 1 }]);
-    expect(timers()).toBe(0);
     t.input('Done.');
     clock.advance(1000);
     expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
+    // Each closed source gave the translation its pause to begin (Stage 2 translation cuts, choice 8).
+    clock.advance(1000);
     expect(timers()).toBe(0);
   });
 
@@ -677,11 +719,65 @@
     expect(closed()).toEqual([{ ref: 1 }]);
   });
 
-  it('typed text states no origin', () => {
+  it('a turnComplete or an interrupted, should Live Translate send one, closes the source and settles the translation for it (Stage 2 translation cuts, choice 12)', () => {
+    const { t, timers, opened, closed } = translate();
+    t.input('你好');
+    t.output('Hello');
+    t.turnComplete();
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
+    t.input('再见');
+    t.output('Bye');
+    t.interrupted();
+    expect(opened()[3]).toEqual({ ref: 4, side: 'translation', origin: 's3' });
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
+    expect(timers()).toBe(0);
+  });
+
+  it('typed text is a row of its own: it states no origin, owes no cut, and takes a ref no other segment has (Stage 2 translation cuts, choice 12)', () => {
     const { t, timers, opened } = translate();
     t.typed('typed words');
     expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
     expect(timers()).toBe(0);
+    t.input('spoken');
+    t.typed('more words');
+    expect(opened()).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'source', origin: 's2' }, { ref: 3, side: 'source' }]);
+  });
+
+  it('reads a target as writing sentence-final marks but Thai and Lao, by its base language (Stage 2 translation cuts, choice 6)', () => {
+    expect(writesSentenceMarks('th')).toBe(false);
+    expect(writesSentenceMarks('lo')).toBe(false);
+    expect(writesSentenceMarks('th-TH')).toBe(false);
+    expect(writesSentenceMarks('km')).toBe(true);
+    expect(writesSentenceMarks('ja')).toBe(true);
+    expect(writesSentenceMarks('zh-Hant')).toBe(true);
+    expect(writesSentenceMarks(undefined)).toBe(true);
+  });
+
+  it('with no mid-sentence hold, a translation that stops mid-sentence closes at its pause, a sentence end shown or not (Stage 2 translation cuts, choice 6)', () => {
+    const { clock, timers } = trackedClock();
+    const { events, log } = recordEvents();
+    const t = new GeminiTurns({ kind: 'translate', speech: true, clock, silence: { sourceMs: 1500, translationMs: 1500, deferMidSentence: false }, sink: events, holdMidSentence: false });
+    t.output('ใช่ไหม? แล้วก็');
+    clock.advance(1_500);
+    expect(log.filter((e) => e.kind === 'segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }]);
+    expect(timers()).toBe(0);
+  });
+
+  it('is Live Translate by its kind alone: with no pauses given it takes the default ones, and its audio still opens no translation (Stage 2 translation cuts, ruling 3)', () => {
+    const { clock, timers } = trackedClock();
+    const { events, log } = recordEvents();
+    const t = new GeminiTurns({ kind: 'translate', speech: true, clock, sink: events });
+    t.audio(pcm());
+    t.input('你好');
+    expect(log.map((e) => e.kind)).toEqual(['audio', 'segmentOpened', 'segmentText']);
+    expect(log[1].payload).toEqual({ ref: 1, side: 'source', origin: 's1' });
+    clock.advance(1_499);
+    expect(log).toHaveLength(3);
+    clock.advance(1);
+    expect(log[3].payload).toEqual({ ref: 1 });
+    // Its pause to begin a translation, then nothing is left.
+    clock.advance(1_500);
+    expect(timers()).toBe(0);
   });
 
   it("ignores the model's text parts: its translation is the output transcript alone", () => {
```

`src/providers/gemini/turns.replay.test.ts` (new):

```ts
import { describe, it, expect } from 'vitest';
import { RECORDINGS, replay } from '../../lib/segmentation/recordings/replay.testing';
import type { GeminiConfig } from './config';
import { GeminiTurns } from './turns';

const PAUSE: NonNullable<GeminiConfig['silence']> = { sourceMs: 1500, translationMs: 1500, deferMidSentence: false };

/** A recording fed as Gemini's adapter feeds `GeminiTurns`: each transcription, and audio that neither opens a translation nor holds one open (choice 8). */
function live(name: keyof typeof RECORDINGS, silence: NonNullable<GeminiConfig['silence']>) {
  return replay(RECORDINGS[name], (clock, sink) => {
    const t = new GeminiTurns({ kind: 'translate', speech: true, clock, silence, sink });
    return { input: (d) => t.input(d), output: (d) => t.output(d), audio: (pcm) => t.audio(pcm) };
  });
}

describe("Gemini Live Translate's segments on recorded sessions (Stage 2 translation cuts, ruling 3; choice 15)", () => {
  it("a recorded Live Translate session, `3.5-live-translate-preview` ja → en, pushed to talk — its source split where one press ended and the next began: each source with its own translation, stated — at a 0.8 s translation pause too, where each side on its own left seven fragments alone", () => {
    const expected = [
      ['リアルタイムファンキアよそうシーズンな会話お手伝い', "Real-time Funky it is, so it's a seasonal conversation, I'm"],
      ['します。リアルタイムファンキアよそうシーズンな会話お手伝い', "here to help. Real-time Funky it is, so it's a seasonal conversation, I'm here to help."],
    ];
    for (const silence of [PAUSE, { ...PAUSE, translationMs: 800 }]) {
      const r = live('geminiLiveTranslate', silence);
      expect({ translationMs: silence.translationMs, sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ translationMs: silence.translationMs, sources: 2, paired: 2, orphans: 0 });
      expect(r.pairings).toEqual(['stated', 'stated']);
      expect(r.exchanges).toEqual(expected);
    }
  });

  it("the OpenAI Translate spike's sessions, fed as Live Translate feeds them: every source with its own translation, stated, none alone", () => {
    for (const [name, sources] of [['user', 6], ['tight', 6], ['long', 7]] as const) {
      const r = live(name, PAUSE);
      expect({ name, sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ name, sources, paired: sources, orphans: 0 });
      expect(r.pairings).toEqual(new Array(sources).fill('stated'));
    }
  });
});
```

```diff
diff --git a/src/providers/gemini/adapter.test.ts b/src/providers/gemini/adapter.test.ts
--- a/src/providers/gemini/adapter.test.ts
+++ b/src/providers/gemini/adapter.test.ts
@@ -258,16 +258,28 @@
     expect(h.content().map((e) => e.kind)).toEqual(['segmentOpened', 'segmentText', 'audio', 'segmentClosed']);
   });
 
-  it('Live Translate: each side closes on its own pause with no origin; audio outside an open translation plays with no ref (choice 8)', async () => {
+  it("Live Translate: the source states its origin and the translation that source, each closing at its pause, the cut framed; audio outside an open translation plays with no ref (choice 8; Stage 2 translation cuts, rulings 2, 3; choice 14)", async () => {
     const h = await liveGemini({ model: TRANSLATE });
     h.socket().receive(SERVER.audio(480));
     h.socket().receive(SERVER.input('Hello'));
-    h.socket().receive(SERVER.output('こんにちは'));
+    h.socket().receive(SERVER.output('こんにちは。'));
     h.socket().receive(SERVER.audio(480));
     h.clock.advance(1_500);
-    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }]);
+    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' }]);
     expect(h.of('audio').map((e) => e.payload.ref)).toEqual([undefined, 2]);
     expect(h.of('segmentClosed').map((e) => e.payload)).toEqual([{ ref: 1 }, { ref: 2 }]);
+    expect(h.frames('translation.cut')).toEqual([{ reason: 'quiet', origin: 's1', sentences: 1, owed: 0, dropped: 0 }]);
+  });
+
+  it('Live Translate into Thai, a script with no sentence-final mark, holds no translation mid-sentence, a stray Latin mark notwithstanding; into English it does (Stage 2 translation cuts, choice 6)', async () => {
+    const run = async (target: string) => {
+      const h = await liveGemini({ model: TRANSLATE, context: { ...AUTO_CTX, direction: { source: 'ja', target } } });
+      h.socket().receive(SERVER.output('ใช่ไหม? แล้วก็'));
+      h.clock.advance(1_500);
+      return h.of('segmentClosed').map((e) => e.payload);
+    };
+    expect(await run('th')).toEqual([{ ref: 1 }]);
+    expect(await run('en')).toEqual([]);
   });
 
   it('a leg that does not speak drops the model audio, and still logs the part', async () => {
@@ -616,7 +628,7 @@
 });
 
 describe('the Gemini adapter: through L1 and L2', () => {
-  it("Live Translate's segments pair by inference: two exchanges, each its own source and translation (ruling 1, F16)", async () => {
+  it("Live Translate's segments pair by the origin they state: two exchanges, each its own source and translation (ruling 1; Stage 2 translation cuts, rulings 2, 3)", async () => {
     // The adapter's events feed L1 as the runner's do, on the adapter's own clock (as `localInference/adapter.test.ts`'s u9 → u10 case).
     const clock = createVirtualClock(0);
     const conversation = new Conversation({ leg: 'speaker', session: 's', languages: AUTO_CTX.direction, clock });
@@ -629,7 +641,7 @@
     sockets.last().receive(SERVER.setupComplete());
     await starting;
     const socket = sockets.last();
-    // Each translation opens a second after its source, inside the 4 s proximity window; the second pair comes after a pause.
+    // Each translation opens a second after its source and states it as its origin; the second pair comes after a pause.
     socket.receive(SERVER.input('Hello.'));
     clock.advance(1_000);
     socket.receive(SERVER.output('こんにちは。'));
@@ -640,8 +652,35 @@
     clock.advance(1_500);
     const exchanges = createProjector().project([conversation.snapshot()], DEFAULT_PROJECTION).flatMap((e) => (e.kind === 'exchange' ? [e] : []));
     expect(exchanges.map((e) => [e.pairing, e.source.map((r) => r.text).join(''), e.translation.map((r) => r.text).join('')])).toEqual([
-      ['inferred', 'Hello.', 'こんにちは。'],
-      ['inferred', 'Goodbye.', 'さようなら。'],
+      ['stated', 'Hello.', 'こんにちは。'],
+      ['stated', 'Goodbye.', 'さようなら。'],
+    ]);
+  });
+
+  it('on Live Translate an answer to typed text, should one come, stays beside its typed row, inferred, after a spoken exchange (Stage 2 translation cuts, choices 9, 12)', async () => {
+    const clock = createVirtualClock(0);
+    const conversation = new Conversation({ leg: 'speaker', session: 's', languages: AUTO_CTX.direction, clock });
+    const sockets = fakeSockets();
+    const starting = createGeminiAdapter({ openSocket: sockets.create }).start(
+      { context: AUTO_CTX, config: configFor(TRANSLATE), credentials: KEY, clock, signal: new AbortController().signal },
+      eventsFrom((e) => conversation.apply(e)),
+    );
+    sockets.last().open();
+    sockets.last().receive(SERVER.setupComplete());
+    const session = await starting;
+    const socket = sockets.last();
+    socket.receive(SERVER.input('Hello.'));
+    clock.advance(1_000);
+    socket.receive(SERVER.output('こんにちは。'));
+    clock.advance(11_500);
+    session.appendText('Thank you');
+    clock.advance(500);
+    socket.receive(SERVER.output('ありがとう。'));
+    clock.advance(1_500);
+    const exchanges = createProjector().project([conversation.snapshot()], DEFAULT_PROJECTION).flatMap((e) => (e.kind === 'exchange' ? [e] : []));
+    expect(exchanges.map((e) => [e.pairing, e.source.map((r) => r.text).join(''), e.translation.map((r) => r.text).join('')])).toEqual([
+      ['stated', 'Hello.', 'こんにちは。'],
+      ['inferred', 'Thank you', 'ありがとう。'],
     ]);
   });
 });
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini`
Expected: FAIL — `Test Files  3 failed | 15 passed (18)`, `Tests  15 failed | 340 passed (355)`:
- `turns.test.ts`, 9: "runs the source on its own pause, stating its origin …", "cuts the translation where the source was …", "a translation with no cut owed waits …", "once its stream has shown a sentence end, a translation that stops mid-sentence waits …" (it closes at its pause), "keeps its open segments across a reconnect … and the cut a source owes", "a turnComplete or an interrupted …" (no origins), the typed-text case (its second row takes a ref of its own from the source's counter, and the source states no origin), "reads a target as writing sentence-final marks but Thai and Lao …" (`writesSentenceMarks` does not exist yet), and "is Live Translate by its kind alone …" (the source states no origin). The other new case, "with no mid-sentence hold …", passes: today's rule never holds, which is what it asks for once the module holds by default;
- `turns.replay.test.ts`, 2 — today's rule: the recorded Live Translate session pairs `['inferred', 'inferred']` (and at a 0.8 s translation pause leaves seven fragments alone); the spike's sessions, `{ name: 'user', sources: 6, paired: 5, orphans: 1 }` (the three: 15 of 19, and 4 alone);
- `adapter.test.ts`, 4: the Live Translate case (no origins, no `translation.cut`), the Thai-and-English case (into English, today's rule closes at the pause, `[{ ref: 1 }]`), the pairing through L1 and L2 (`inferred`), and the typed-text answer (the spoken exchange before it `inferred`).

- [ ] **Step 3: Hand Live Translate to the module, and frame its cuts.**

```diff
diff --git a/src/providers/gemini/turns.ts b/src/providers/gemini/turns.ts
--- a/src/providers/gemini/turns.ts
+++ b/src/providers/gemini/turns.ts
@@ -4,14 +4,17 @@
  * machine on the request's clock. A dialogue model ends a turn with
  * `turnComplete`, so its source and translation share the turn's origin,
  * stated (`t<n>`). Live Translate has no turns (`GeminiClient.ts:74-94`):
- * each side is its own segment, closed by its own silence timer, and its
- * origin is L2's to infer (F16). The audio a translation plays carries the
- * stretch of its text that had arrived with it — karaoke by arrival
- * (Gemini/AST2 follow-up, ruling 2; choice 7).
+ * its two sides are cut as OpenAI Translate's are, by `ContinuousSegments` —
+ * the source by its own silence timer, the translation where the source was,
+ * stating that source as its origin (Stage 2 translation cuts, rulings 2, 3).
+ * The audio a translation plays carries the stretch of its text that had
+ * arrived with it — karaoke by arrival (Gemini/AST2 follow-up, ruling 2;
+ * choice 7).
  */
 import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
 import type { Clock } from '../../lib/contract/clock';
-import { SilenceDeferral } from '../../lib/segmentation/silenceDeferral';
+import { ContinuousSegments, type CutSummary } from '../../lib/segmentation/continuousSegments';
+import { DEFAULT_SEGMENT_PAUSE_MS } from '../../lib/segmentation/segmentationMode';
 import type { GeminiConfig } from './config';
 
 export type TurnSink = Pick<AdapterEvents, 'segmentOpened' | 'segmentText' | 'segmentClosed' | 'audio'>;
@@ -20,12 +23,31 @@
   kind: GeminiConfig['kind'];
   /** The leg speaks: the model's audio is emitted; otherwise dropped (the conformance rule `no-audio-when-silent`). */
   speech: boolean;
-  clock: Pick<Clock, 'setTimeout'>;
+  clock: Pick<Clock, 'setTimeout' | 'now'>;
   /** Live Translate's silence timers (`C.silence`); absent for a dialogue model. */
   silence?: GeminiConfig['silence'];
   sink: TurnSink;
+  /** Live Translate: each translation cut, for the Logs (Stage 2 translation cuts, choice 14). */
+  cut?: (summary: CutSummary) => void;
+  /** Live Translate: a translation that stops mid-sentence is held — not for a target that writes no sentence-final mark (`writesSentenceMarks`). True when absent. */
+  holdMidSentence?: boolean;
 }
 
+/** Live Translate's targets whose script writes no sentence-final mark: Thai and Lao (Stage 2 translation cuts, choice 6). */
+const NO_SENTENCE_MARKS = new Set(['th', 'lo']);
+
+/** Whether a Live Translate target's script ends its sentences with a mark, read by its base language (`th-TH` as `th`). */
+export function writesSentenceMarks(target: string | undefined): boolean {
+  return target === undefined || !NO_SENTENCE_MARKS.has(target.split('-')[0].toLowerCase());
+}
+
+/** Live Translate's pauses when none are given: the app's default, 1.5 s each side, cut by pause. */
+const LIVE_TRANSLATE_DEFAULT_SILENCE: NonNullable<GeminiConfig['silence']> = {
+  sourceMs: DEFAULT_SEGMENT_PAUSE_MS,
+  translationMs: DEFAULT_SEGMENT_PAUSE_MS,
+  deferMidSentence: false,
+};
+
 const CJK = '\\u3000-\\u303f\\u3040-\\u309f\\u30a0-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef';
 const CJK_SPACE = new RegExp(`([${CJK}])\\s+([${CJK}])`, 'g');
 
@@ -55,8 +77,8 @@
   private refs = 0;
   private turn = 1;
   private readonly sides: Record<SideName, OpenSide | null> = { source: null, translation: null };
-  private readonly timers: Record<SideName, (() => void) | null> = { source: null, translation: null };
-  private readonly deferral: Record<SideName, SilenceDeferral> = { source: new SilenceDeferral(), translation: new SilenceDeferral() };
+  /** Live Translate's two sides; null on a dialogue model. */
+  private readonly live: ContinuousSegments | null;
   /** A dialogue turn's text parts: its translation when no transcript came. */
   private fallbackText = '';
   /** A dialogue model's answer is streaming: its output transcript, audio or text arrived since the last `turnComplete` / `interrupted` (choice 16). */
@@ -95,18 +117,35 @@
   private interruptedEnd = false;
   private stopped = false;
 
-  constructor(private readonly o: GeminiTurnsOptions) {}
+  constructor(private readonly o: GeminiTurnsOptions) {
+    // Live Translate: a stream with no turns, cut as OpenAI Translate's is; the source read with its CJK spaces removed (Stage 2 translation cuts,
+    // ruling 3). Its config always carries the pauses; the default ones stand in should one not, so the dialogue path never sees Live Translate.
+    this.live = o.kind === 'translate'
+      ? new ContinuousSegments({
+          clock: o.clock,
+          silence: o.silence ?? LIVE_TRANSLATE_DEFAULT_SILENCE,
+          sink: o.sink,
+          showSource: normalizeCjkSpaces,
+          cut: o.cut,
+          holdMidSentence: o.holdMidSentence,
+        })
+      : null;
+  }
 
   private get dialogue(): boolean {
     return this.o.kind === 'dialogue';
   }
 
-  /** A dialogue turn's origin; Live Translate states none. */
+  /** A dialogue turn's origin; Live Translate's are its segments' own (Stage 2 translation cuts, ruling 2). */
   private origin(): string | undefined {
     return this.dialogue ? `t${this.turn}` : undefined;
   }
 
   input(text: string): void {
+    if (this.live) {
+      this.live.sourceText(text);
+      return;
+    }
     if (this.stopped || !text) return;
     // Content, even content a drop swallows: a `turnComplete` after it ends an answer of its own.
     this.interruptedEnd = false;
@@ -114,10 +153,13 @@
     const side = this.ensure('source');
     side.text += text;
     this.o.sink.segmentText({ ref: side.ref, text: normalizeCjkSpaces(side.text) });
-    this.arm('source');
   }
 
   output(text: string): void {
+    if (this.live) {
+      this.live.translationText(text);
+      return;
+    }
     if (this.stopped || !text) return;
     this.interruptedEnd = false;
     if (this.suppressing) return;
@@ -125,7 +167,6 @@
     const side = this.ensure('translation');
     side.text += text;
     this.o.sink.segmentText({ ref: side.ref, text: side.text });
-    this.arm('translation');
   }
 
   /**
@@ -137,17 +178,17 @@
    * range ever needs stating again.
    */
   audio(pcm: Int16Array): void {
+    // Live Translate: audio outside an open translation plays and is no row's (choice 8). Audio opens none and holds none open: it streams straight through pauses (`GeminiClient.ts:1319-1324`).
+    if (this.live) {
+      this.live.audio(pcm, { play: this.o.speech, active: false });
+      return;
+    }
     if (this.stopped || pcm.length === 0) return;
     this.interruptedEnd = false;
     if (this.suppressing) return;
     // Streaming, whether or not this leg plays it.
     if (this.dialogue) this.answering = true;
     if (!this.o.speech) return;
-    // Live Translate: audio outside an open translation plays and is no row's (choice 8). Audio never re-arms a timer: it streams straight through pauses (`GeminiClient.ts:1319-1324`).
-    if (!this.dialogue && !this.sides.translation) {
-      this.o.sink.audio({ pcm });
-      return;
-    }
     const side = this.ensure('translation');
     const end = side.text.length;
     this.o.sink.audio({ pcm, ref: side.ref, range: [side.spoken, end] });
@@ -155,7 +196,8 @@
   }
 
   modelText(text: string): void {
-    if (this.stopped || !text) return;
+    // Live Translate: its translation is the output transcript alone.
+    if (this.live || this.stopped || !text) return;
     this.interruptedEnd = false;
     if (this.suppressing || !this.dialogue) return;
     this.answering = true;
@@ -163,6 +205,11 @@
   }
 
   turnComplete(): void {
+    // Live Translate, should it send one: the source closes and the translation settles for it (Stage 2 translation cuts, choice 12).
+    if (this.live) {
+      this.live.endTurn();
+      return;
+    }
     if (this.stopped) return;
     if (this.interruptedEnd) {
       // The rest of the end `interrupted` made: nothing more ends here, and a drop that end started goes on to the
@@ -183,6 +230,10 @@
   }
 
   interrupted(): void {
+    if (this.live) {
+      this.live.endTurn();
+      return;
+    }
     if (this.stopped) return;
     this.interruptedEnd = true;
     if (this.suppressing) {
@@ -193,6 +244,11 @@
   }
 
   typed(text: string): void {
+    // Live Translate: a row of its own, stating no origin and owing no cut (Stage 2 translation cuts, choice 12).
+    if (this.live) {
+      this.live.typed(text);
+      return;
+    }
     if (this.stopped) return;
     // Typed text starts an answer of its own: a cancel's drop, active or pending, ends here, as at the next press,
     // and a `turnComplete` after it is no longer the rest of an `interrupted`.
@@ -261,8 +317,7 @@
 
   stop(): void {
     this.stopped = true;
-    this.cancel('source');
-    this.cancel('translation');
+    this.live?.stop();
   }
 
   /**
@@ -303,35 +358,9 @@
   }
 
   private close(side: SideName, origin: string | undefined): void {
-    this.cancel(side);
-    this.deferral[side].reset();
     const open = this.sides[side];
     if (!open) return;
     this.sides[side] = null;
     this.o.sink.segmentClosed({ ref: open.ref, ...(origin ? { origin } : {}) });
   }
-
-  /** Live Translate only: (re)starts a side's silence countdown (`GeminiClient.ts:790-835`). */
-  private arm(side: SideName): void {
-    const silence = this.o.silence;
-    if (this.dialogue || !silence) return;
-    this.cancel(side);
-    this.timers[side] = this.o.clock.setTimeout(() => {
-      this.timers[side] = null;
-      const open = this.sides[side];
-      if (this.stopped || !open) return;
-      // While the display cuts by sentences, a pause mid-sentence is the speaker resting: one more window, while the text still grows (choice 7).
-      const text = side === 'source' ? normalizeCjkSpaces(open.text) : open.text;
-      if (silence.deferMidSentence && this.deferral[side].deferAtExpiry(text)) {
-        this.arm(side);
-        return;
-      }
-      this.close(side, undefined);
-    }, side === 'source' ? silence.sourceMs : silence.translationMs);
-  }
-
-  private cancel(side: SideName): void {
-    this.timers[side]?.();
-    this.timers[side] = null;
-  }
 }
```

```diff
diff --git a/src/providers/gemini/adapter.ts b/src/providers/gemini/adapter.ts
--- a/src/providers/gemini/adapter.ts
+++ b/src/providers/gemini/adapter.ts
@@ -31,7 +31,7 @@
 import type { GeminiCredentials } from './settings';
 import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
 import { ReleaseTail, type TailSummary } from './tail';
-import { GeminiTurns } from './turns';
+import { GeminiTurns, writesSentenceMarks } from './turns';
 import {
   ACTIVITY_END,
   ACTIVITY_START,
@@ -118,6 +118,10 @@
       clock: request.clock,
       silence: request.config.silence,
       sink: events,
+      // Live Translate: each translation cut and why, for the live test (Stage 2 translation cuts, choice 14).
+      cut: (summary) => this.frame('out', 'translation.cut', summary),
+      // No mid-sentence hold into a script that writes no sentence-final mark (Stage 2 translation cuts, choice 6).
+      holdMidSentence: writesSentenceMarks(request.config.translationTargetCode),
     });
     this.tail = new ReleaseTail({
       clock: request.clock,
```

- [ ] **Step 4: Run Gemini's suites and the session-side guard.**

Run: `npx vitest run src/providers/gemini src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 19 files, 363 tests. The dialogue models' cases, the hold's (`hold.test.ts`, `adapter.hold.test.ts`, its seeded lifecycles), the tail's and the reconnect's pass unchanged: no dialogue path moved, and a dialogue model never armed the timers removed. Live Translate's conformance scenarios pass unchanged: they read what opens and what follows the stop, and no rule reads an origin; its exchange (`Hello.`, `こんにちは。`, a chunk, 1.5 s) closes both sides as before, now stating one, and its typed text's answer, `入力された言葉`, which has no sentence end in a stream that has shown none, closes at its pause (choice 6). The session-side walk still lists `turns.ts`; it does not follow `src/lib/**`.

- [ ] **Step 5: The gates.** The suite and the typecheck gate, and the full tree (in Wave 2, a failure in `src/providers/openai_translate/` is Task 2's).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/turns.ts src/providers/gemini/turns.test.ts src/providers/gemini/turns.replay.test.ts src/providers/gemini/adapter.ts src/providers/gemini/adapter.test.ts
```

```bash
git commit -q -F - -- src/providers/gemini/turns.ts src/providers/gemini/turns.test.ts src/providers/gemini/turns.replay.test.ts src/providers/gemini/adapter.ts src/providers/gemini/adapter.test.ts <<'EOF'
feat(gemini): Live Translate's translation follows the source's cuts

Live Translate cut each side on its own silence and left the pairing to
proximity, the fault OpenAI Translate showed. Its two sides now come from
ContinuousSegments: the source on its own pause, read with Gemini 3.x's
CJK spaces removed, and the translation where the source was, stating
that source as its origin. Its audio still neither opens nor holds a
translation. Typed text stays a row of its own, and an answer to it
stays beside it; a turn end closes the source and settles the
translation; the kind alone makes Live Translate. Into Thai or Lao,
scripts that write no sentence-final mark, no translation is held
mid-sentence. Each translation cut is framed as translation.cut. A
recorded Live Translate session pairs 2 of 2, stated. The dialogue
models are untouched.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check (controller, after Wave 2)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the replay at `43437057`: 576 files passed and 1 skipped, 7 509 tests passed and 2 skipped); the typecheck gate at exactly the baseline; the full tree at 259, none naming `src/lib/segmentation/`.
- [ ] `npx vitest run src/services` green: the old clients are untouched (the replay: 49 files, 1 039 tests).
- [ ] `npm run build`, then `npm run extension:build`; `npx vitest run extension`.
- [ ] The three D24 greps print nothing.
- [ ] `command grep -rlF 'translation.cut' build extension/dist` names at least one file under `build/` and one under `extension/dist/`.
- [ ] No rendered check: the rows and their pairing show only in a live session; the replays already read them through L1 and L2. Record the numbers for Task 4.

---

### Task 4: The spec's amendments and the roadmap's record (controller)

The controller's docs task, after the group check. It edits only the spec and the roadmap, and commits them together. Every anchor below is by heading and content; the line numbers, read at `43437057`, are hints only — re-read each anchor before editing.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

- [ ] **Step 1: Amend the spec.** Each amendment is marked "(Stage 2 translation cuts, ruling / choice N)" in the text, as the earlier plans' are:
  1. **D6, "Source↔translation"** (`:84`): append "**Amended by the Stage 2 translation cuts plan:** or by the adapter's own rule where it cuts both sides of a stream with no turns — OpenAI Translate and Gemini Live Translate state, for each translation, the source whose cut it closed for, as OpenAI Realtime's 'newest unanswered' fallback is stated (rulings 1–3)."
  2. **D4, "Karaoke"** (`:82`): after "each by the owner's ruling ('Risks')", add "; on OpenAI Translate and Gemini Live Translate a range by arrival runs within one translation segment, which now closes at its source's cut: audio arriving before the next translation delta stays with the segment that closes, so a frame can carry the next sentence's first word into the previous segment — its range is by arrival, not a known correspondence (Stage 2 translation cuts, ruling 1 (v))".
  3. **"L0 — the client contract" → "What every adapter must honour", the `frame` bullet** (`:336-360`): after "Gemini's `server.voice_activity`, `server_content.waiting_for_input`, `turn.hold` and `turn.hold_end` need none either (Stage 2 Gemini hold, choice 12);", add "OpenAI Translate's and Gemini's `translation.cut` needs none (Stage 2 translation cuts, choice 14);".
  4. **"L2 — the projection", the F16 paragraph** (`:870-875`): after "OpenAI Translate's follow-up, should its `elapsed_ms` prove one timeline (Stage 2 OpenAI Translate, ruling 6).", add "OpenAI Translate now states its origins (Stage 2 translation cuts, ruling 2), so its pairing needs no timing; the timed window waits for a provider whose origins L2 infers and that emits `timing` — Doubao AST 2.0 emits none, and OpenAI Live may state its origins by the same cuts instead."
  5. **"Provider capability", the table** (`:1108-1122`): the `OpenAITranslateGAClient` row's last column becomes "source cut ↔ translation cut — **stated**: each closing source owes the translation one cut, taken once the translation holds as many sentence ends as the source, the latest arriving after the source's last delta; the translation states that source, at its open when known (the cut owed first, else the source still open), else at its close; a sentence end counted as ruling 1 (iii) says, and in the scripts it does not name at their own marks (`।॥۔؟။։።។៕．｡`, counted as the CJK ones); its own quiet settles it and drops cuts no translation answered, as does a translation that begins for a newer source; one that follows no cut continues the spoken source that closed last (Stage 2 translation cuts, rulings 1, 2; choices 3, 5–9). `elapsed_ms` is still framed, and read by nothing"; the `GeminiClient` row's last column becomes "dialogue models: same turn — stated; Live Translate: source cut ↔ translation cut — stated, as OpenAI Translate's, with no mid-sentence hold into Thai or Lao (Stage 2 translation cuts, ruling 3; choice 6)".
  6. **The paragraph below the table** "Gemini, not OpenAI Translate, is the first provider whose origins L2 infers …" (`:1128-1131`): append "**Amended by the Stage 2 translation cuts plan:** OpenAI Translate and Gemini Live Translate now state their origins; Doubao AST 2.0 is the one ported provider whose origins L2 still infers."
  7. **"Segmentation is one fact"** (`:1603-1615`): after "only Live Translate's end on our timers — the user tunes the pauses.", add "On OpenAI Translate and Live Translate the source's segments end on its timer and the translation's where its source's did; the translation's own pause only settles it — at a sentence end, or 5 s after its last activity mid-sentence once its stream has shown a sentence end, never into a script that writes no sentence-final mark — and bounds how long a closed source's cut waits for a translation to begin (Stage 2 translation cuts, ruling 1; choices 6, 8)."
  8. **"Provider order", items 3 and 5** (`:2386-2402`): item 3's "inferred for Live Translate" → "stated for Live Translate by the translation's cuts (the Stage 2 translation cuts plan)"; item 5's "inferred origin" → "origins stated by the translation's cuts (the Stage 2 translation cuts plan)".
  9. **"Risks", "`origin` inference has no ground truth to test against for the three providers that need it"** (`:2582-2585`): append "**Amended by the Stage 2 translation cuts plan:** of the three, OpenAI Translate and Gemini Live Translate now state their origins; Doubao AST 2.0 still needs it, and OpenAI Live will unless it states its own."
- [ ] **Step 2: Write the roadmap's section.** Append `## Scheduled by the Stage 2 translation cuts plan` as the roadmap's last section, after the Gemini hold plan's, in the earlier sections' form:
  - **What landed:** the plan's path and commit, the commit range and its `+/−` lines and files (from `git diff --shortstat`), the waves as run, each task's review rounds, the group check with its numbers; Task 4 is the record.
  - **Departures, stated:**
    - on OpenAI Translate and Gemini Live Translate the translation is cut where its source was, not on its own silence alone, and its pairing is stated, not inferred (rulings 1–3);
    - a translation that stops mid-sentence stays open to 5 s after its last activity, in every mode, where by pause it closed at its pause — once its stream has shown a sentence end, and never into Thai or Lao (ruling 1 (vi); choice 6);
    - **how rulings 1 (iii) and (vi) read for scripts they do not name** (the controller's ruling on the review's C1): a sentence end in Hindi, Bengali, Marathi, Urdu, Arabic, Burmese, Armenian, Amharic or Khmer is that script's own mark — `।॥۔؟။։።។៕`, and the fullwidth `．` and halfwidth `｡` — counted as the CJK ones; in a script that writes none, Thai or Lao, "only at a sentence end" is unobservable, so Gemini Live Translate into Thai or Lao holds no translation mid-sentence at all — its pause settles it, whatever stray Latin mark the stream shows (the controller's ruling on the re-check's N1) — and into any other target the hold waits for the stream to show a mark, the translation's pause settling it until then (choices 3, 6, 12);
    - OpenAI Translate's output frames below RMS 0.002 no longer open a translation or hold it open; outside one they are dropped, as heartbeats are (ruling 1 (vii); choice 11);
    - a translation with no cut owed waits for a source still open; a quiet close drops cuts no translation answered, and so does a pause with no translation after a source closed, and a translation that begins in that pause while a newer source is open, which follows the newer one; a translation with nothing owed and no source open continues the spoken source that closed last, and typed text clears that (choices 7–9: beyond the spike, ruled by the controller with the review's fixes);
    - a translation's `.done`, should the endpoint send one, settles it as its quiet would, where OpenAI Translate's choice 18 closed it at once (choice 13).
  - **Before any release from the branch:** the owner's live test below.
  - **The owner's live test** (own credentials; switch diagnostic logs on in Help before Start; each item names what settles it; `translation.cut` frames carry `reason`, `origin`, `sentences`, `owed` and `dropped`):
    1. **OpenAI Translate zh → en with the owner's pauses** (rulings 1, 2): six or so sentences with pauses of 1.8–2.4 s — the owner's live session — and the interpreter catching up in its shorter pauses: every source row has its own translation beside it, `pairing` stated in the export's JSON; no translation row stands alone; the Logs read one `translation.cut` per translation, `reason` `sentences` or `quiet`, `dropped: 0`. Record any row without its translation, with the frames around it.
    2. **OpenAI Translate ja → en**, the same: the terminal `。` wherever it stands; record a cut one sentence late or early.
    3. **Gemini Live Translate** (ruling 3), the default model, the same two directions: record the same; audio that arrives before its text still plays unattributed (Gemini choice 8).
    4. **A speaker who pauses mid-sentence** (ruling 1 (i), (vi); choices 6, 7): pauses of 1–1.5 s inside sentences, by pause and by sentence: the source as today (split by pause, held by sentence); the translation waits — no `translation.cut` for a source still open — and never stands alone.
    5. **A translator who merges or splits sentences** (choices 3, 4, 8): long compound sentences, lists, numbers ("1.5", "U.S."), and very short sentences: watch for a translation cut one sentence late (the next sentence's opening words at the end of a row) or early (a row's last words opening the next), and whether it resyncs at the next real pause — a `translation.cut` with `reason: 'quiet'` and a `dropped` — or drifts.
    6. **A source never translated** (choice 8): a sentence in the target language, a filler ("嗯", "えーと"), with the next sentence both 3 s later and within about 2 s: its source row alone, the next sentence's translation beside its own source; the Logs: `translation.cut` `reason: 'idle'` with `dropped: 1` — at the pause to begin's end, or as the next translation begins — or a `quiet` one with a `dropped`. Record any translation beside the filler.
    7. **Text only** (OpenAI Translate's choice 5): the same rows and pairs as with it off.
    8. **The participant leg** (Both): the same, on the other leg's stream, its own pauses.
    9. **The pause settings** (choices 6–8): the translation's pause shorter than the source's (0.8 against 1.5 s), and longer (3 s): rows still paired, and at 3 s every close a `sentences` or a `quiet` after 3 s; the source's pause at 1 s: sentences split into fragments, as today, the translation beside the last fragment ("What this plan leaves").
    10. **The noise floor** (ruling 1 (vii); choice 11): a translation row closes about its pause after its last word, not when the next sentence begins; `session.output_audio.delta` frames with an `rms` under 0.002 still appear in the Logs.
    11. **The one-word audio boundary** (ruling 1 (v)): keep-audio on, replay each translation row: its audio says its text, bar at most the next sentence's first word at its end (the spike: twice in 16 sentence boundaries).
    12. **A long monologue with short pauses** (choices 7, 8): a minute or more with pauses under the source's: the source and its translation grow together until a real pause; record a translation held open long after its source closed, and every `dropped`.
    13. **Other scripts** (choices 3, 6, 12; the stated departure): OpenAI Translate zh → hi (Hindi, its `।`), and Gemini Live Translate into Arabic or Urdu, into Khmer (its `។`) and into Thai: every source row with its own translation, none alone; for Thai, the rows cut where the interpreter pauses, the `translation.cut` frames `quiet`, none held 5 s — with a question, which Thai may end with a `?`, or a Buddhist-era year written `พ.ศ.`, early in the session, which must change nothing. Record a script whose marks are not counted — a whole session's translation in one row, or every row closing 5 s after its last word, is the sign.
    14. **The first sentence of a session** (choice 6's cost): a long first sentence the interpreter pauses inside — its first translation may close at its pause, before any sentence end has shown; record whether its rest joins the next row.
    15. **Typed text on Live Translate** (choices 9, 12; with the Gemini section's item 7): after a spoken exchange, type a sentence: if an answer comes, it stands beside the typed row, `inferred` in the export's JSON, and the spoken exchange before it keeps its own translation.
  - **Open questions for the owner:** this plan's, below.
  - **Amend in place** (mark each "**Changed by the Stage 2 translation cuts plan** (…)"): in the Gemini section, live-test item 8 ("Live Translate: … cut by pause, each side on its own; inferred pairing plausible" — now the translation is cut at its source's cuts and the pairing stated; this plan's items 3 and 6), and item 7 and its open question on typed text on Live Translate (a typed row owes no cut: choice 12); in the OpenAI Translate section, live-test item 4 ("rows cut by pause on each side" — now the translation at its source's cuts; this plan's item 1), item 7 ("speaking the target language → silence, rows empty" — the source row now stands alone and its cut is dropped: this plan's item 6), and item 6 and its open question "Timing and F16's timed window" (pairing no longer needs the timing; karaoke by `elapsed_ms` stays the follow-up); its "What it leaves" items "A translation spanning two source segments pairs with one" (addressed: rulings 1, 2) and "A `.done` before the last audio" (a translation's `.done` now settles it: choice 13), and the timing follow-up (pairing no longer needs it).
  - **The roadmap's inheritance, item by item,** **what it leaves** and **the open questions:** the three lists below, as landed.
- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec, roadmap): the translation cuts' amendments and live test

OpenAI Translate and Gemini Live Translate cut the translation where its
source was and state that source as its origin: D6, D4, the capability
table, segmentation and the risks amended; the owner's live test and the
earlier sections' items it changes.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Taken (and where), or left (and why).

| Item | Disposition |
|---|---|
| The owner's live session (2026-09-30): several OpenAI Translate source rows with no translation, their translations inside one earlier segment | met: the translation cut at its source's cuts, stated (Tasks 1, 2; rulings 1, 2) — 19 of 19 on the spike's sessions, where the old rule paired 12; live-test items 1, 2 |
| The same on Gemini Live Translate (ruling 3) | met: Task 3 — 19 of 19 on the same sessions under Gemini's audio rules, where the old half paired 15 and left 4 alone; on a recorded Live Translate session 2 of 2, stated, none alone, where the old half at a 0.8 s translation pause left seven fragments alone; live-test item 3 |
| The OpenAI Translate section, "What it leaves": a translation spanning two source segments pairs with one | met: the translation is cut at its source's cuts (rulings 1, 2) |
| The OpenAI Translate section, live-test item 7: the target language spoken, rows empty | changed: the source row stands alone and its cut is dropped, so the next translation is not shifted (choice 8); live-test item 6 |
| The OpenAI Translate section, the timing follow-up (F16's timed window, `elapsed_ms` as one timeline) | narrowed: pairing no longer needs timing (ruling 2); karaoke by `elapsed_ms` stays open |
| The OpenAI Translate section, "A `.done` before the last audio" | changed: a translation's `.done` settles it as its quiet would (choice 13) |
| The Gemini section, live-test item 8: Live Translate cut by pause, each side on its own, inferred pairing | changed: stated, the translation at its source's cuts (ruling 3); live-test items 3, 6 |
| The Gemini section, live-test item 7 and its open question: typed text on Live Translate | kept: a row of its own, no origin, no cut, and an answer to it, should one come, beside it, until the live test says whether Live Translate answers text (choices 9, 12); live-test item 15 |
| OpenAI Live's pairing (its survey, question 3) | left: `ContinuousSegments` is the candidate; its own plan decides (research note 10) |

## What this plan leaves

- **A sentence-count mismatch until the next real pause.** A translator that merges two source sentences into one, or splits one into two, meets a cut one sentence late or early; the next quiet close — its pause at a sentence end — takes the cut owed and drops any other, so the error does not pass a real pause (choice 8). Between two real pauses, a sentence of translation can sit in the neighbouring row. Live-test item 5.
- **The one-word audio boundary.** Audio is handed over by arrival: a frame that carries the next sentence's first word, arriving before that word's text, plays in the segment that closes (the spike: twice in 16 sentence boundaries). Live-test item 11.
- **A source pause below the transcript's own gaps** splits a sentence into fragments, as today; the interpreter waits for the sentence, and its translation sits beside the fragment open when it began, the earlier fragments alone — their cuts dropped (choice 8; research note 5). The sentence mode's deferral already keeps a sentence whole while its text grows. Live-test item 9.
- **The lagging interpreter's trade** (choice 8; the review's F1): an interpreter that says nothing for a source until the speaker's next sentence has begun has its translation put beside that newer source, the older one standing alone — pinned. The filler case it serves is the likelier. Live-test items 6, 12.
- **A translation that begins more than its pause after its source closed**, with no source open, closes as that source's continuation (choice 9); with a newer source open by then, it follows that one (choice 8).
- **Before a session's first translated sentence end, a mid-sentence pause closes the translation at its pause** (choice 6's cost): the hold waits for the stream to show a mark. The recorded Gemini session shows it — its first translation closes at "…I'm", where its source closed too, and "here to help." goes with the source that holds します。 ("Found in review" 4). Live-test item 14.
- **A script with no sentence-final mark** (Thai, Lao) is cut by the translation's pauses and the source's cuts alone: no cut is ever due, so each translation closes at its pause for the cut owed first — 18 of 19 on the recordings through the module, 15 of 19 through OpenAI Translate's segments, none alone, where today's rule pairs 12 and leaves 3 alone ("Found in review" 1). Gemini Live Translate, the provider that offers them, keys the hold off by its target (choices 6, 12), so a stray Latin mark changes nothing: 18 of 19 again with one mark kept, where the gate alone, latching on it, paired 4 ("Found in re-check" 1). The key is the target code: a Thai or Lao stream reached another way — a target not keyed, or text the interpreter leaves untranslated — reads as any other. Live-test item 13.
- **A Latin end inside a closing quote** (`He said "go." Then`) is not counted: the mark is followed by the quote, not whitespace, as ruling 1 (iii) reads; a cut there comes one sentence late, and the next quiet settles it. A text that ends so reads as at a sentence end (choice 3).
- **Scripts beyond the widened set**: a mark not in `ANYWHERE_ENDS` or `.?!` — Tibetan's `།`, Greek's `;` question mark — is not counted. A Greek question reads as mid-sentence, its cut one sentence late until the next `.` or real pause; a Tibetan target behaves as a script with no mark that is not keyed off, so a stray Latin mark would latch the hold for it as it did for Thai (choice 6). The live test names the targets that matter (item 13).
- **Typed text on Live Translate** owes no cut: an answer to it, should Live Translate send one, stands beside its typed row, inferred, when it begins with nothing owed and no source open; while a spoken source is open or owed, it joins that source's translation (choice 12). The Gemini section's open question.
- **The guard reads the wall clock** (`realClock.now()` is `Date.now()`): a clock stepped back between a source's last delta and the translation's sentence end makes that cut not due, and the quiet settles it (choice 10).
- **OpenAI Translate's release tail still hears the noise floor** (`tail.output()` for every frame that is not a heartbeat): a tail may run to its 3 s cap while floor frames come. Unchanged, and bounded (choice 11). `isQuietFrame` recomputes the RMS the adapter computed for the frame's Logs line — the review's Minor 10, left: one pass over 4 800 samples.
- **`MID_SENTENCE_HOLD_MS` = 5 000** is the spike's value; the live test observes it (items 4, 12, 14).
- **OpenAI Live's pairing:** `ContinuousSegments` is the candidate; not built here (research note 10).
- **The spike keeps its own `simulate`** (`scripts/dev/wire-probe/openai-translate.mts`), a research instrument; the module is not shared with it.
- **Doubao AST 2.0** is now the one ported provider whose origins L2 infers.

## Open questions for the owner

None. The controller ruled choices 7–9, with the review's fixes, adapter heuristics serving the owner's stated goal — each row its own translation, and no error outliving a real pause — and ruled the reading of rulings 1 (iii) and (vi) for scripts they do not name a stated departure, not a question (Task 4 states it). The live test observes what is left: `MID_SENTENCE_HOLD_MS` (items 4, 12, 14), other scripts (item 13), and whether Live Translate answers typed text (item 15, with the Gemini section's item 7, whose open question stands as it was).

## Self-review

- **Brief coverage.** The owner's decisions: ruling 1, the rule, each of its eight parts landing in Task 1 (i–vi, viii) and Task 2 (vii), with a test first for each: (i) the source's pause and deferral (the module's source cases), (ii) the owed cut and its `n` (the two-sentence and no-sentence cases), (iii) the sentence ends (the counting cases, CJK anywhere, "1.5" and "U.S" across and within deltas, the other scripts' marks, the one rule), (iv) the cut at the next delta (the owner's case, in all three suites; the latest end, not the first, three ways), (v) audio by arrival (its own case), (vi) the translation's quiet and hold (the resync and hold cases, in both providers; the hold once an end has shown, and never into Thai or Lao), (vii) the noise floor (the wire, segments and adapter cases), (viii) arrival (the guard cases, on the virtual clock, each end at its own delta's arrival). Ruling 2, the stated origin: choices 2 and 5, `s<ref>` at the open, the translation's at its open when known, pinned through L1 and L2 as `stated` in both adapters. Ruling 3, Gemini Live Translate: Task 3, the text rule only, its audio rules kept, by its kind alone. The one shared pure module: choice 1, in `src/lib/segmentation/`, on the request's clock; `SilenceDeferral` read and moved into it, unchanged; the import rules and `sessionSide.consistency.test.ts` held — its timer scan now reads the module by name, its kit rule covers the replay. The stated origin through the contract and OpenAI Realtime's landed form: research note 9, choice 2; `pair.ts` leaves them alone, unchanged. The regression fixtures: four JSON files of arrival time, type, text deltas, frame length and RMS — no pcm, no key — 32 KB in all; the replay through the real `segments.ts` asserts 19 of 19 paired and no orphan, each exchange's two ends pinned (Task 2), and fails on today's rule (12 of 19 through L2); the Gemini session's through `GeminiTurns` (Task 3). Tests first for every rule, both providers: every task's first step; the kit's lifecycles cover neither adapter (they cover the 3.x Gemini dialogue model and Palabra), and the conformance scenarios, which do, pass unchanged in both. The spec and roadmap: Task 4, the pairing rows argued stated (the adapter cuts the translation because of that source's cut, its own rule, as OpenAI Realtime's "newest unanswered" is), the D4 and karaoke note, the live test with each of the brief's items (1–3, 4, 5, 7, 8) and its leftovers (the sentence-count mismatch, the one-word boundary), and Revision 1's stated departure. OpenAI Live: research note 10, "What this plan leaves", Task 4's inheritance table; not built.
- **Revision 1** (the independent review: Ready after fixes, Critical 1, Important 2, Minor 10; the controller's rulings, 2026-09-30, binding):
  - **C1 — other scripts' sentence ends** (fixed as the review proposed): `ANYWHERE_ENDS` adds `।॥۔؟။։።．｡`, counted as the CJK marks wherever they stand, in the one shared predicate (choice 3); the mid-sentence hold only once the translation's stream has shown a sentence-end mark (choice 6). Tests first: the marks counted; a Hindi translation cut at its dandas; a Thai one closed at its pause, not held; the hold once a CJK or a Latin mark has shown; the three recordings with their translation's marks rewritten as dandas (19 of 19) and removed (18 of 19, none alone). Recorded as a stated departure in Task 4, not an owner's question.
  - **I1 — the stale cut, the continuation and typed text** (F1, F2 and the typed reset, the review's `variant-f.ts`): a translation that begins in its pause to begin while a newer source is already open drops the stale cuts, framed `idle`, and states the open source (choice 8); a translation that follows no cut continues the spoken source that closed last (choice 9); typed text clears that continuation (choices 9, 12). The case "a cut owed and the next source already open" rewritten to pin the new behaviour, with its `idle` frame; cases (a) the filler then speech within the pause to begin, (b) a translation beginning more than its pause after its source closed, (c) an answer to typed text — through the module, and on Live Translate through the adapter, L1 and L2 (inferred beside its typed row). Choice 8's claim, research note 4, choice 12's wording and "What this plan leaves" corrected. The 36-setting sweep re-run: 1 344 of 1 380, none alone, the review's counts.
  - **I2 — one sentence-end rule** (`endsSentence`, shared by `countSentenceEnds`, `atSentenceEnd` and the translation's per-delta count, carrying C1's set) and the review's four cases: "1.5" within one delta cuts nothing; 「一つ目。二つ目」 counts one, then 「。」 two; the first end before the source's last delta and the second after it make the cut due — across deltas, within them, and in CJK; 'One.' before `lastAt` settled by a delta after it stays stamped with its own arrival, not due (the guard case, strengthened). The review's A5, A6, B3, B3b, B3c and B6 now fail (below).
  - **Minors:** 1 `MID_SENTENCE_HOLD_MS` pinned at 5 000; 2 the continuation case with two paid cuts; 3 a quiet close with a cut owed while the next source is open closes for the cut; 4 `turns.replay.test.ts` no longer says no Live Translate session was recorded, and the fourth fixture, from `2026-09-28T19-41-14`, replays through `GeminiTurns`, its exchanges pinned; 5 `replay.testing.ts`, with the kit rule widened to every `*.testing.ts` (a production import fails the consistency test: R9 below); 6 the module in the session-side timer scan by name (a wall-clock read fails it: R10 below); 7 `atSentenceEnd` skips `SENTENCE_CLOSERS`; 8 the starting point `43437057`, the two probe commits and the session-end-and-wizard plan's later edit of `openai_translate/adapter.ts` named in Global Constraints; 9 `GeminiTurns` Live Translate by `kind === 'translate'` alone, with the app's default pauses should none come; 10 left, as ruled.
  - **Found while doing it:** with F1, the case that pinned the cut owed first against the source still open (Revision 0's M8) no longer could — a translation beginning in the pause to begin now follows the open source by rule; a new case pins it where it still holds, a translation two sources behind while the speaker is on a third, cut at its sentences (not beginning afresh). And the "shown an end" gate moved the recorded Gemini session's first translation: it closes at its pause at "…I'm", before the stream's first sentence end, where the review, measuring without the gate, saw "…I'm here to help." together — choice 6's cost, pinned and stated ("Found in review" 4; "What this plan leaves").
- **Revision 2** (the re-check of Revision 1: Ready after fixes, Critical 0, Important 1, Minor 3; the controller's rulings, 2026-09-30, binding):
  - **N1 — the gate latched for Thai and Lao** (fixed as ruled): the module's `holdMidSentence` option, true by default, turns the mid-sentence hold off; `writesSentenceMarks(target)` in `turns.ts` reads a target by its base language, false for `th` and `lo`; Gemini's adapter passes it for the config's `translationTargetCode`, and `GeminiTurns` forwards it (choices 6, 12). OpenAI Translate keeps the default. Khmer's `។៕` join `ANYWHERE_ENDS` (choice 3). The gate and its trailing-Latin-mark trigger stay. Tests first: a Thai-target stream with one early Latin mark (`ใช่ไหม?`) closes its later mid-sentence pause at its pause with the hold off, and 5 s after its last text with it on; a Khmer terminal counted (`ប្រយោគទីមួយ។ ទីពីរ៕`, two); the recordings with every translation mark removed but the first, 6, 6 and 6 through the module with the hold off (18 of 19, none alone); which targets write marks (`th`, `lo`, `th-TH` not; `km`, `ja`, `zh-Hant` and none given do); a `GeminiTurns` with the hold off; and through the adapter, a Thai target closing at its pause where an English one holds.
  - **M1 — the Gemini fixture is push-to-talk:** said so in "Found in review" 4, choice 15, the generator's comment, the replay's header and the replay case's title: its source splits where one press ended and the next began, not at a speaker's pause.
  - **M2 — the pause to begin ends when a translation opens:** a new case in "a cut at its sentences leaves the later cuts owed …": a translation that begins inside the pause to begin, cut at its sentences while the speaker is on a third source — its next segment states the second source, the cut owed, and the first cut is the only one framed, `dropped: 0`. The re-check's R-F1c now fails (below).
  - **M3:** Khmer out of "What this plan leaves"; Tibetan and Greek stay, each said how it reads.
  - **Found while doing it:** the new `GeminiTurns` case with the hold off passes on the code before Task 3 — today's rule never holds — so Task 3's red list names it as passing; the adapter's Thai-and-English case fails before it on its English half.
- **Choices made inside the rulings:** 1–15, listed above; each is cited where it lands. Choices 7, 8 and 9 go beyond the spike and are marked so in the choices, "What this plan leaves" and Task 4's departures; the controller ruled them, with the review's fixes.
- **Departures from the brief, each with its reason:**
  - **Choices 7–9 add rules to ruling 1 (vi)** for cases the spike never met (research note 4; "Found in review" 2): without them a translation that pauses with nothing owed, or the rest of one cut early, stands alone, and a source never translated shifts every translation after it across every real pause — the brief's own "an error does not propagate past a real pause" needs choice 8, and, when the next sentence starts within the translation's pause, its F1.
  - **Choices 3 and 6 read rulings 1 (iii) and (vi) for scripts they do not name** (the controller's rulings on C1 and N1): those scripts' own marks end their sentences, the hold waits for the stream to show one, and into Thai or Lao there is no hold — without them, a Hindi or Thai target put the whole session's translation in one row, and a Thai one with a stray Latin mark held every pause 5 s.
  - **Choice 3 counts ruling 1 (iii) across deltas**, not per delta as the spike did: the ruling's "only before whitespace or the end" read on each delta alone counts "1." in "1" + "." + "5"; the recordings are the same either way.
  - **Choice 13 changes the landed OpenAI Translate choice 18:** a translation's `.done` settles it rather than closing it at once, so it cannot orphan its source's rest.
  - **Choice 11 drops a noise-floor frame outside an open translation** rather than playing it unattributed: ruling 1 (vii) says only that it opens none; the spike and the Live client drop it.
  - **Choice 12 keeps typed text on Live Translate owing no cut** — the brief's "when a source segment closes" would owe one — while whether Live Translate answers text is still open; an answer, should one come, stays beside its row (choice 9's reset).
  - **The translation's origin is stated at its open when known** (choice 5), where ruling 1 (iv) words it at the close: the same origin, known earlier, so the row does not jump; pinned by the invariant, which the fuzz checks.
  - **Added, not asked:** the frame `translation.cut` (choice 14), for the live test's reading of a late or early cut; the fixtures' generator, committed (choice 15); the replays read through L1 and L2, not only the adapter's events, so what they count is what the panel shows.
- **Placeholders.** None: every code block is the tested scratch copy's file or diff; the recordings are written by the generator block and pinned by their hashes. The constants appear once each — `MID_SENTENCE_HOLD_MS` = 5 000 in the module, pinned by its own case; `QUIET_RMS` = 0.002 in `wire.ts`, pinned with its 65/66 boundary — and are read by name elsewhere; the module's `sentences`/`owed`/`dropped` counts pin the rule itself. The one template is the commit messages' `<implementing model>`, which Global Constraints says to fill in; Task 4 fills its numbers from the run.
- **Type consistency.** Checked in the scratch copy, where every file compiled — the gate at its baseline and the full tree at 259 after each wave: `ContinuousSegments`, `ContinuousSegmentsOptions` (`clock`, `silence`, `sink`, `showSource`, `cut`, `holdMidSentence`), `SegmentSink`, `CutReason`, `CutSummary` (`reason`, `origin`, `sentences`, `owed`, `dropped`), `MID_SENTENCE_HOLD_MS`, `endsSentence`, `countSentenceEnds`, `atSentenceEnd`, `translating`, `sourceText`, `translationText`, `audio(pcm, { play, active })`, `typed`, `done`, `endTurn`, `stop`; `RecordedEvent` (its audio RMS optional), `Recording`, `RECORDINGS` (`user`, `tight`, `long`, `geminiLiveTranslate`), `ReplayTarget`, `ReplayResult` (`sources`, `paired`, `orphans`, `pairings`, `exchanges`), `frameAt`, `replay`; `QUIET_RMS`, `isQuietFrame`; `TranslateSegmentsOptions.cut`, `GeminiTurnsOptions.cut`, `GeminiTurnsOptions.holdMidSentence`, `writesSentenceMarks`; the frame `translation.cut` — each spelled the same in every task that names it.
- **Mutants,** sixty-one, run on the replayed result against the three touched folders' suites (the consistency test alone for R9 and R10), each failing at least one test but the four equivalent:
  - **Revision 2's:** R-F1c, the re-check's survivor, the pause to begin not ended when a translation opens; N1, the re-check's, the hold latched for `th` — the module ignoring `holdMidSentence`; N1b the adapter keeping the hold for `th`; N1c `GeminiTurns` not forwarding the option; N1d the target read whole, `th-TH` held; N1e Lao left out; K1 Khmer's marks not counted — each caught;
  - **the review's survivors:** A5 a Latin mark within a delta counted without the whitespace; A6 a CJK mark within one counted only before whitespace; B3/B3b an end within a delta keeping the first end's time; B3c a settled trailing end keeping the first's; B6 a settled trailing end stamped with the next delta's arrival; C2 the hold at 4 s; F9b the continuation never updated after the first; F12 a quiet waiting whenever a source is open — each now caught;
  - **Revision 1's rules:** R1 no stale-cut drop (F1); R2 the continuation the last paid, not the source that closed last (F2 undone); R3 typed text leaving the continuation; R4 only CJK marks counted wherever they stand; R5 the hold whether or not an end has shown; R6 closing quotes not skipped; R7 a trailing Latin mark not showing an end; R8 Gemini Live Translate only with its pauses given; R9 a production import of the replay (the kit rule); R10 a wall-clock read in the module (the timer scan) — each caught;
  - **Revision 0's, re-run:** M1 the guard not strict; M4 no drop with no translation open; M5 a quiet close dropping nothing; M6 no wait for an open source; M7 no origin stated at the open; M8 the open source preferred to the cut owed (caught again by the two-behind case); M9 no continuation origin; M10 no hold; M11 the hold measured from its expiry; M12 activity leaving the hold spent; M13 a waiting translation not given its pause at its source's close; M14 no pause to begin; M15 no guard at all; M16 the source stating no origin; M17 a CJK end counted only before whitespace — the spike's first bug; M18 trailing whitespace hiding a sentence end; M19 audio that does not count holding an open translation; M20 every close restating its origin; M21 stop leaving the translation's timer; M22 typed text owing a cut; M23 a translation's `.done` closing it at once; M24 a turn end leaving the source open; M25 a cut at its sentences dropping the cuts after it; P1 the noise floor holding the translation; P2 the floor playing outside a translation; P4 no `translation.cut` frame (OpenAI Translate); G1 Gemini's audio counting as activity; G2 its source read with its CJK spaces; G3 a turn end not handed on; G4 typed text not handed on; G5 no `translation.cut` frame; G6 a leg that does not speak playing Live Translate's audio — each caught;
  - **equivalent (4):** A3, the source counted raw, not as shown — removing CJK spaces never changes a count; E6, a close stating the owed cut over its open origin — equal by the invariant; P3, the floor at `<=` — no integer fill lands on 0.002; M3, `n` without its "at least one" — the guard already needs an end after `lastAt` (research note 7).
- **The fuzz:** the review's, 3 000 seeds of random source and translation deltas (Latin, CJK, "1." then "5", "U.S", "です。次", and, added, a danda sentence and a Thai delta), audio counting and not, typed text, `.done`, turn ends, stop and clock jumps, at random pause settings, run once on Revision 1's result and once on Revision 2's, the mid-sentence hold on for even seeds and off for odd: no violation — never more than two timers and none after 60 s, nothing after stop, each ref opened once and closed at most once, no text after a close, no origin restated, every origin naming a source that exists and never going backwards, ranges contiguous and within the text, one spoken source and one translation open at a time. It has teeth: with M20 (every close restating its origin) it counted 6 104 violations on Revision 1's result.
- **Red before green, each measured:** Task 1's test file fails to load without the module, and the consistency test's timer scan finds no module to read; Task 2's 15 cases and Task 3's 15 fail on the code before them, each for the rule it pins (the steps list them); Task 3's one new case that passes before it, the hold off in `GeminiTurns`, asks for what today's rule already does. The cases a diff touches that pass before their task's code, as after it, are landed cases rewritten only so they still hold under the new rule: in Gemini's, a timer count moved past a source's pause to begin (sentence mode); in OpenAI Translate's, the stop case, whose comments alone changed.
