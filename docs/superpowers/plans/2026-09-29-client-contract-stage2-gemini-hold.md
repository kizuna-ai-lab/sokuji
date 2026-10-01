# Client contract — Stage 2 follow-up: Gemini 3.x holds its input until the model's turn ends

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–4 are **the owner's decisions** (2026-09-29, in conversation, on the evidence of his own wire probes): the hold itself (「按『暂存到 turnComplete 再补发』写计划」, rulings 1 and 2), its adaptive cap (「就按自适应上限来」, ruling 3, which replaced the fixed `HOLD_MAX_MS` the first brief named), and, on the probe batches he ran for this plan, its two rules for automatic turns (「按turn2改计划」, ruling 4). Where a ruling left a sub-decision to this plan, the answer is a numbered *choice* below, and the self-review lists each one; choice 10 (a hold carried across a reconnect) and choice 2's input-transcription guard are the controller's rulings on the plan's independent review (Revision 1), choice 10's bound on the carried gap audio its ruling on the re-review (Revision 2), choices 14 and 15 carry ruling 4 (Revision 3), and the coordinator's rulings on the third re-review set the split's wait, derive the split's pause from the session's silence setting and the wait from the audio a split let go, fix two pieces of stale state and narrow the START rule's exception for a split's hold (Revision 4; choices 2, 4, 14, 15), and on the fourth re-check make the hold's notion of content `GeminiTurns`' own and keep a split's wait from a `waitingForInput` (Revision 5; choices 2, 4, 14). This plan runs **after** the Stage 2 Palabra plan, whose code and record have landed in the same worktree (`15a07f0a`, `b7aaf60d`, `07b67bd9`, `ced275ae`, `ac8ccdd1`, `42072b5b`, `78aab5fd`, `ba48e426`); Task 5 anchors by content.

**Goal:** On a Gemini 3.x dialogue model — the family that barges in (the Gemini/AST2 follow-up's ruling 5) — keep every translation whole and every utterance heard from its start, **as the owner's probes measured it**: two utterances 1.57–2.47 s apart, 12 of 12 whole; and, with ruling 4, three Japanese sentences 0.8–1.5 s apart or a five-sentence monologue, every utterance translated whole in 10 of 10 sessions, where the hold without ruling 4 managed 5 and today's barge-in none (research notes, "Found in the owner's multi batches"). Noisy rooms, other voices and long monologues are unprobed: the owner's live test watches them. Once the server has closed the user's turn, the adapter holds what the leg would send — the microphone's audio, a press's activity marks, typed text — until the model's `turnComplete`, then sends it in order, the audio as one frame, and goes on live. Concretely:
- **Automatic turns** (the speaker's, and always the participant's): the hold begins at the server's `voiceActivity` ACTIVITY_END — a message the adapter reads for the first time — or, when none comes, at a model turn's first output, or its first input transcription on a session that has heard no voice activity (choice 2). **Two more rules** (ruling 4): an ACTIVITY_START while a hold is on lets it go at once — the server is hearing speech that went up before the hold — and a release lets one utterance go: the held audio up to its first pause after speech 100 ms longer than the session's own end-of-speech silence (600 ms at the default), found by an energy gate over the held audio, while the rest stays held until the server's ACTIVITY_END for what went up, then to that answer's `turnComplete` — or, without that END, for 2 s, or half as long as the released audio plays when that is longer (choices 14, 15).
- **Push-to-talk:** it begins when the leg's own `activityEnd` goes out, for a release with voice or for typed text's own marks (choice 3). A press made while it holds waits: its `activityStart`, its audio and its release go at `turnComplete`; a press released without voice while its `activityStart` is still held is withdrawn whole, nothing sent (choice 7). The leg's own marks already end each utterance: ruling 4's rules do not apply (choice 14).
- **It lets go** at `turnComplete` (or `waitingForInput`), after `GeminiTurns` has ended the turn (choice 4); or at its cap — 2 s past the model's computed playback end (its first audio's arrival plus all the audio it sent), or 10 s after it began while no model audio has come (ruling 3; choice 6). A cap releases, never discards. A lost connection — a GoAway included — carries what is held to the next connection, with at most the gap's first 5 s of audio under automatic turns, and that connection lets it go once set up (choice 10); a stop drops it silently (choice 11).
- 2.5 dialogue models and Live Translate are unchanged (ruling 2).

It ends with the controller's docs task and the owner's live test (Task 5).

**Architecture:**
- **A new pure module,** `src/providers/gemini/hold.ts` (`InputHold`), shaped as `tail.ts` is: a clock and three callbacks. It decides when a hold begins — from the server's signals under automatic turns, from the adapter's own `activityEnd` under manual ones — keeps the held entries in order (copies of the audio, and opaque held sends), arms the cap on the request's clock, carries a hold across a lost connection with no cap and, under automatic turns, at most `HOLD_CARRY_MS` of the gap's audio, and at the release sends each unbroken run of audio as one frame and runs each held send in its place, stopping where a held send begins a new hold. Under automatic turns it lets a hold go at an ACTIVITY_START, and splits a release at the held audio's first pause after speech, holding the rest in a hold of its own that waits for the server's close (ruling 4).
- **`adapter.ts`** builds one when the config is a dialogue model with `START_OF_ACTIVITY_INTERRUPTS` (derived, no knob: choice 1). It routes `appendAudio`, a press's start and end, and typed text through it while it holds — split into `pressStart`, `pressEnd` and `sendText`, the sends that run at once or when the hold lets go of them; feeds it the server's `voiceActivity`, the transcriptions, each model part with its audio's length and whether `GeminiTurns` takes it as content, `interrupted`, `turnComplete` and `waitingForInput`; has it carry a hold across a reconnect, and lets the carried hold go after the ladder has restarted a press still down (unless the hold still holds that press's own start); cancels it on stop. It tracks whether an activity is open on the wire (`activityOpen`), which now decides typed text's own marks (choice 9).
- **`wire.ts`** types the server's `voiceActivity` message as the wire spells it; **`testing.ts`** gains three server frames.
- **Unchanged:** `turns.ts` (the held calls reach it when their frames go out: choice 13), `tail.ts` (Live Translate only), `config.ts`, `settings.ts`, the contract, the runner, L1, the view. No contract change, no new locale key, no store change.

**Tech Stack:** TypeScript (strict), Vitest, the adapter test kit (`FakeSocket`, `fakeSockets`, `runScenario`, `runLifecycles`, `trackedClock`, `flush`), `@google/genai` 2.16.0 (its types only).

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended through the Stage 2 Gemini/AST2 follow-up and the Stage 2 Palabra plan's record. The parts this plan meets: "L0 — the client contract" → "What every adapter must honour" (the `appendText` and `frame` bullets; every timer on the request's clock), "Turns" → "What each provider can do" and "The design" (Gemini's rows, the owed flag's limit). Task 5 amends it.

**Research notes:**
- **The evidence:**
  - the research: `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/gemini-nodrop-research.md` — Part 1: no server setting queues input on 3.x; 3.8 paces `turnComplete` to a simulated playback of its answer, `generationComplete` 3–4 s earlier, and in every uninterrupted probe turn `turnComplete` came at the first audio's arrival plus the answer's total audio within ±20 ms (§1.0); Part 2: the hold's design and file-by-file estimate, written for a release at `generationComplete` — this plan adapts it to `turnComplete`;
  - the concurrent-turns research: `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/gemini-concurrent-turns-research.md` — §2 ("What the probes cannot tell": more than two utterances, real pauses), §4 (every connection gets a GoAway about every 9–10 min, `time_left=50s`; Google DevRel's live-translator replays unanswered audio into its replacement session across a GoAway), §5 (Live Translate's measured latency);
  - the probe's `hold` mode, committed (`72223a27`): `scripts/dev/wire-probe/gemini-hold.mts` — its hold and release logic is this plan's reference behaviour — and `gemini.mts hold`; the reports, git-ignored: `.superpowers/wire-probes/gemini/report.md`, sections `2026-09-29T06-25-52`, `06-35-42`, `06-36-01` and `07-02-13` (batch 2f, the long clip);
  - the owner's multi batches (2026-09-29), ruling 4's evidence: batch 1, `10-34-00`, 24 sessions in mixed languages, and batch 2, `12-13-51`, 30 sessions in Japanese only — `seq` (three sentences, pauses 800/950/1 100/1 500 ms) and `mono` (five sentences, pauses 800/1 200/1 000/1 500 ms), each under `none` (today's barge-in), `turn` (ruling 1 alone) and `turn2` (with ruling 4), on 3.8 and 3.1; the report's sections under those stamps and the logs `.superpowers/wire-probes/gemini/*-multi-*.jsonl`, git-ignored; the analysis `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/gemini-hold-probe/multi-analysis.md`; the probe's `turn2` policy, committed (`ef2f61d3`, `gemini-hold.mts`: `SPLIT_MS`, `SPLIT_WAIT_MS`, `splitAt`) — ruling 4's reference behaviour;
  - the owner's live log (3.1, push-to-talk): `session.opened` … `realtime_input.activity_start` (his second press) … `server_content.interrupted` with no `generation_complete` — a true cut, set off by the adapter's own `activityStart`;
  - the plan's independent review, Revision 1's source: `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/gemini-hold-plan-review.md`, its scratch scenarios S1–S6 under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/gemini-hold-review/`.
- **What the probes show** (the numbers this plan relies on):
  - today (barge-in, no hold): 3.8 cut answer 1 at clip gaps of 600 and 900 ms, 3.1 at 600, 900 and 1 500 ms;
  - held to `generationComplete`: answer 1 always whole, but the start of utterance 2 was often transcribed and not translated;
  - **held to `turnComplete`: both translations whole, 12 of 12** (3.8 and 3.1 × automatic and push-to-talk × burst and paced release); the audible gap between the answers 2.35–3.38 s; clip 2's end → answer 2's first audio 0.94–1.62 s on 3.8, 1.3–2.6 s on 3.1;
  - the holds lasted 4.6–7.5 s for answers of about 4.5 s; 2f's long clip (the sentence pair three times, one utterance) was collapsed by both models into one 4.4–4.7 s answer, held 5.27–5.97 s: no cut — the probe's own verdict line reads FAIL only because each model translated the thrice-repeated pair once — so no probe bounds a genuinely long answer (ruling 3);
  - `voiceActivity` ACTIVITY_END carries an `audioOffset`: the server's close, later than its 500 ms `silenceDurationMs` setting — **0.71–0.79 s after the speech's end** on the multi batches' cut clips (batch 2: 0.63–0.91 s, 55 of 69 closes within 0.72–0.79 s; Revision 3 corrects the 0.92–0.96 s of the first probes, measured to the end of a clip's tail, not its speech) — and the client began its hold 0.03–0.04 s (3.8) or 0.12–0.19 s (3.1) after that offset, in stream time; under push-to-talk it mirrors the client's own marks; in all 44 3.x runs (88 transcriptions) of the first probes the input transcription arrived while the voice activity was still open; `audioOffset` counts audio time, the held time inside it; a burst and a 4× paced release came out the same.
- **What the first probes did not cover** (Revision 1, from the review's I1):
  - **the probe's "gap" is silence between two 6.16 s clip files,** each with about 0.61 s of lead-in and 0.36 s of tail: the speech gaps were 1.57, 1.87 and 2.47 s (clip gaps 600, 900 and 1 500 ms);
  - **in every automatic run the hold began before utterance 2 was spoken,** 0.50–0.91 s ahead of its onset;
  - **only two utterances were ever sent.** Two automatic-turn failure modes were therefore unprobed — (a) speech that starts just after the server's close, before its ACTIVITY_END reaches the client, and (b) a released burst that itself contains a server turn close — until the owner's multi batches, below.
- **Found in the owner's multi batches** (Revision 3; the numbers ruling 4 rests on):
  1. **Ruling 1 alone fixes answer 1:** whole in 12 of 12 batch-1 sessions, against 1 of 12, late, under barge-in (21 true cuts).
  2. **It breaks what follows a release** — failure mode (b)'s cause, in two forms. The server reads a released burst at about 3× real time: the ACTIVITY_END for an utterance inside it arrived 1.0–3.7 s behind its `audioOffset` (live: 0.03 s on 3.8, 0.16–0.19 s on 3.1), and the next utterance's ACTIVITY_START, from the same burst, 15–260 ms later. A hold begun on that late END kept the end of an utterance the server already had open, which it could then never close, until the idle cap — **the gap**, 7 holds in batch 1 (3.8 ×4, 3.1 ×3), 4 in batch 2 — or, on 3.1, the START cut the pending answer before any output ((b), 3 in batch 1, 4 in batch 2). On 3.8 a START before the answer's first output produces no `interrupted`: the two utterances merge.
  3. **Failure mode (a) did not happen in 54 sessions.** The close came 0.71–0.79 s (batch 2: 0.63–0.91 s) after the speech, the hold 0.03–0.19 s after that, and the server's ACTIVITY_START needs 0.14–0.18 s of the Japanese speech (0.27–0.56 s of the English): onsets that went up before a hold began (21–452 ms of them) never set one off.
  4. **Inside a burst a pause closes a turn less readily than live:** 800 and 950 ms (3.8, `seq`) and 1.2 s (3.8, `mono`) did not, 1 050, 1 200 and 1 500 ms did (batch 1).
  5. **Batch 2, Japanese only: every utterance translated whole in 10 of 10 `turn2` sessions, 5 of 10 `turn`, 0 of 10 `none`.** Its 22 splits — 11 at the next utterance's onset, 11 on held audio that ended in the pause, none inside an utterance: the server's END for what went up came 0.76–1.41 s after 18 of them; on 4, all on 3.1, the 1.5 s wait ran out and the END followed about 50–90 ms later. On two of those only silence went up then; on the other two the next utterance's onset did, and 3.1 cut the pending answer before any output and answered the two utterances together, whole. Ruling 4's START rule let 2 holds go (3.1, `mono`, each begun on such a late END), 89 and 189 ms after they began, never at the idle cap.
  6. **The cost is lag:** each utterance waits for the answer before it to finish its simulated playback. Batch 2, `seq` (a 5.2 s sentence, then 1.5 s and 2.6 s ones): the second and third sentences' lag was 3.25–7.36 s under `turn2`, against 2.12–3.66 s for `turn`'s merged answers where `turn` did not stall, and 0.9–1.5 s under barge-in, with answers cut. The five-sentence monologue: 1.39 → 3.09 → 2.54 → 3.38 → 2.89 s (3.8); on 3.1 about 1.1 s, its utterances merged in pairs. The lag follows choice 1's formula (3.8 at 1 100 ms: 5.20 and 4.58 s predicted, 5.24 and 4.59 s measured).
  7. **Of the multi batches' 53 interrupts, 3 reached the client before the ACTIVITY_START that set them off** (all 3.1, under barge-in); the other 50 after it.
- **Found while writing** (at `15a07f0a`; unchanged at `ced275ae` and `ef2f61d3`):
  1. **The wire spells the voice activity's field `type`; the SDK's own `VoiceActivity` says `voiceActivityType`.** `@google/genai` 2.16's converter renames it only for Vertex (`voiceActivityFromVertex`) and assigns a Developer API message untouched (`index.mjs:14761-14783`), so `GeminiServerMessage` types the field itself (choice 12). 2.16's `LiveServerContent` already carries `waitingForInput`, never seen in the probes.
  2. **A hold cannot let go at `interrupted`.** The landed one-end rule (the follow-up's research note 8, settled at its final review) takes a `turnComplete` with no content since `interrupted` as the rest of that end, and typed text resets it (`GeminiTurns.typed`). A held text sent at `interrupted` would make the `turnComplete` trailing it by about 5 ms an end of its own, and the text's answer would open under a third origin. So the hold lets go at that trailing `turnComplete` (choice 4); pinned in Task 4.
  3. **Typed text's marks read the key, and a held text can outlive a withdrawn press.** `appendText` wraps its text in activity marks under manual turns "with no press held" (`!turnOpen`). A text typed while a held press is down queues inside that press; if the press is withdrawn, or the text goes out after a press's release while the next key is down, the key says nothing about the wire. So the adapter tracks whether an activity is open on the wire (`activityOpen`) and reads it when the text goes (choice 9). Outside a hold the two agree; the landed tests, the Live Translate tail's among them, pass unchanged.
  4. **The landed barge-in tap case cannot happen while a hold runs** (`adapter.test.ts`, "a voiceless tap during an answer, released before the server's interrupted arrives"): under push-to-talk a tap during an answer is now withdrawn before any server sees it. Task 4 keeps the case, driven past the cap, where the landed path — the tap's `activityStart` barging in — still runs.
  5. **The hold sends the server what the microphone heard during the answer.** On speakers that includes the answer's own voice: 3.8 under `NO_INTERRUPTION` discarded it, and today's barge-in lets it cut the answer's simulated playback; held, it reaches the server after `turnComplete`, as input. The speaker leg's recorder asks for echo cancellation (Chromium's), whose far-end reference may or may not include the app's own playback by platform and output device; the participant capture has it off by design; the echo monitor only detects. The same echo may leave the held audio no pause the split's gate can find (choice 15). Live-test item 5 settles it.
  6. **The runner feeds audio under manual turns only while a key is held** (`run.ts`, `send`): a push-to-talk hold holds only the presses made during it, and every audio entry held after a press's `activityStart` is that press's own — what `withdraw` relies on (choice 7).
  7. **The kit's seeded lifecycles are cheap here** (about 90 lines, the Palabra plan's shape): Task 4 runs 300 lives over both turn modes, the ladder and every server signal, and checks that each hold is said once at its begin and once at its end, never two at once, and that no mark or text goes up while one is on; and (Revision 3) that a split's hold follows at once the release that kept something, and only that one, that an ACTIVITY_START ends a split's hold only after the server's ACTIVITY_END has come (Revision 4) and a split's hold times out only before it, that only a split's hold times out, and that push-to-talk never splits. The kit sends every chunk at one level, which has no pause: the harness turns a chunk in three into a silence 100 ms longer than the split's pause at the session's silence setting — 700 ms at the default, the same under push-to-talk, where none may split — and the 300 lives then split 13 times, time out 5 splits and let 19 holds go at a START.
  8. **The Palabra plan landed first** — its code (`15a07f0a`, `b7aaf60d`, `07b67bd9`, `ced275ae`, `42072b5b`; `src/providers/palabraai/**`, the registry, `providerPaths.test.ts`, `appShape.test.ts`) and its record (`ac8ccdd1`, `78aab5fd`, `ba48e426`) — with Palabra's roster in `sessionSide.consistency.test.ts` below Gemini's; this plan's hunk there anchors on Gemini's roster lines. `42072b5b` and `ba48e426` edited the kit's comments and reworded one of its failure lines (`… send(s) after the session ended or into a closed socket`), which no test of this plan reads; `f0956d70` and `fb563efd` are this plan's own revisions, `57c3785d` and `ef2f61d3` the probe's `multi` mode and `turn2`. None of this plan's code files moved.
- **Found in review** (Revision 1; each a controller's ruling, 2026-09-29):
  1. **On 3.x the input-transcription fallback could only fire late** (the review's I2): the guard against an open voice activity blocked every real one (note above), so it fired only on a transcription that came after its own `turnComplete` — and then held all of the user's live speech for the idle cap, 10 s, since nothing the server never heard could end it (scenario S1). Once any voice activity has come, the input fallback is off (choice 2).
  2. **A GoAway during a hold dropped the start of the next utterance** (the review's I3): about every 9–10 min per connection, while holds are on for about 5 s of every 4.5 s answer. The hold is now carried to the new connection (choice 10).
  3. **Tests that could not fail:** "a press still held when the hold lets go" looked at nothing before `turnComplete` (now it does), and the seeded lifecycles checked only that holds nest (now also that no mark or text goes up during one).
- **Found in re-review** (Revision 2; the re-review at `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/gemini-hold-plan-rereview.md`, each a controller's ruling, 2026-09-29):
  1. **The carried gap had no bound but the ladder's:** a slow ladder — two setup timeouts, then success — turned a 35 s gap into one 40 s burst (960 000 samples, one 2.56 MB frame); the worst successful gap is about 50 s. A failed ladder already dropped it cleanly. Under automatic turns the gap's audio is now bounded at `HOLD_CARRY_MS` = 5 000 (choice 10).
  2. **Failure mode (a)'s window was mis-measured,** by comparing the run clock with audio time: the probe's stream clock lags its run clock by about 0.35 s. In stream time the client begins its hold 0.01–0.03 s (3.8) or 0.14–0.23 s (3.1) after the server's close, so (a)'s band is pauses of roughly 0.92–1.1 s, not 1.0–1.4 s; corrected everywhere (research note above, choice 4, live-test items 10 and 12, "What this plan leaves", the probe batch). Revision 3 corrects the close itself, from the multi batches: 0.71–0.79 s.
- **Found while writing Revision 3** (at `ef2f61d3`):
  1. **An `interrupted` can reach the client before the ACTIVITY_START that set it off** (3 of the multi batches' 53, note 7 above). A START that lets a hold go there would send held text between `interrupted` and the `turnComplete` that trails it — research note 2's hazard: in the scratch copy the text's answer then opened under a third origin (`t3` for a `t2` text). The START's release waits for that `turnComplete` instead (choice 14).
  2. **A capture's chunks can be smaller than the gate's 10 ms frame** (an AudioWorklet's render quantum is 128 samples, 5.3 ms at 24 kHz): the probe framed each 100 ms chunk alone, which on such chunks finds no frame and never splits. The gate frames the held audio as one stream (choice 15).
  3. **Nothing in the adapter changes for ruling 4** but two comments — and, since Revision 4, the session's silence setting handed to the hold (choice 15), and since Revision 5 a model part's content as `GeminiTurns` counts it (choice 2): it already hands every `voiceActivity` to the hold, and frames the hold's causes and summaries as they come. The rules live in `hold.ts`.
- **A scratch copy of the tree** at `15a07f0a` (outside the repository, 2026-09-29) ran every code and test block below before it was written down, and again after Revisions 1 and 2, and at `ef2f61d3` after Revisions 3–5; each block is that copy's file, and every diff is generated from it. Each task's red step was run against the code before the task, and each green step after it, with the counts quoted in the steps; Revision 3's new cases were also run against Revision 2's code first, Revision 4's against Revision 3's and Revision 5's against Revision 4's, and each failed there for the rule it pins (the self-review). Then the revised plan was replayed on a fresh copy of `ef2f61d3`, task by task, from this document's own blocks, every diff taken by `patch -p1`, and every step's count came out as quoted. At `ef2f61d3`: 571 files passed and 1 skipped, 7 360 tests passed and 2 skipped. After Wave 1: **572 files passed and 1 skipped, 7 401 tests passed and 2 skipped**; after Wave 2: **573 files passed and 1 skipped, 7 429 tests passed and 2 skipped**; after Wave 3: **573 files passed and 1 skipped, 7 446 tests passed and 2 skipped**; no unhandled errors; the typecheck at 259 lines in the full tree and exactly the gate's 20 after every wave. The seeded lifecycles also ran 5 000 more lives (seeds 1–8, 31337 and 7777, 500 each) with no failure, each seed splitting, timing a split out and letting a hold go at a START at least once, and fifty-four hand mutants each failed at least one test (the self-review lists them).

## Global Constraints

- **Starting point.** HEAD `ef2f61d3` on `worktree-client-contract-stage2`. Every task anchors its edits by content, not by line: a line number cited here was read at `ef2f61d3` (the same at `15a07f0a` and `ced275ae` for every file this plan's code tasks touch). The Palabra plan has landed, its record included; other commits may land first, and every anchor is by content.
- **Edits shown as diffs.** A change to an existing file is a unified diff with its context lines, generated from the scratch copy; its hunk headers count the lines at `ef2f61d3` — or, for a file an earlier task of this plan also edits, at that task's result. Apply a hunk by its content all the same (`patch -p1` took every one in the replay). A new file is shown in full.
- **What this plan touches:**
  - `src/providers/gemini/{hold,hold.test}.ts` (new) — Task 1;
  - `src/providers/gemini/{wire,testing,adapter,adapter.test}.ts` — Task 2;
  - `src/providers/gemini/{adapter,adapter.test}.ts`, `src/providers/gemini/adapter.hold.test.ts` (new), `src/providers/sessionSide.consistency.test.ts` — Task 3;
  - `src/providers/gemini/{adapter,adapter.test,adapter.hold.test}.ts` — Task 4;
  - the spec and the roadmap — Task 5.
- **Read only.** Every other file of `src/providers/gemini/` (`turns.ts`, `tail.ts`, `config.ts`, `settings.ts` and their tests stay as they are); `src/providers/palabraai/**` and the registry (another plan's); `src/lib/**` (the contract, the kit, the runner); `src/services/**`, `src/stores/**`, `src/components/**`; the locale catalogs; `scripts/dev/wire-probe/**` (the probe keeps its own hold, the research instrument); `electron/**`, `extension/**`; `package.json` and the lockfile. `npx vitest run src/services` stays green.
- **Import rules:**
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock. Gemini's session side gains `hold.ts` (it imports the contract's `SAMPLE_RATE` and the `Clock` type, and times only through the clock it is handed); Task 3 lists it in `sessionSide.consistency.test.ts`.
  - No provider imports another provider's folder.
- **Diagnostics** (CLAUDE.md, "Error Handling"): the adapter never reports and never logs; it says what happened through `frame`, as it does now. Nothing new is said but frames.
- **Frames** (a Logs line each; never audio, never text, never a credential; the hot-path rule — one or two a turn, never one per chunk): Gemini gains `server.voice_activity` (`in`), `server_content.waiting_for_input` (`in`), `turn.hold` (`out`) and `turn.hold_end` (`out`) — payloads in choice 12. No `logStore` row is needed: none of these names is anyone's row (`logStore.ts` groups Gemini's frames by exact name; a new name stands alone).
- **Locales.** No new key.
- **No network.** No test or step calls Google. The adapter is tested over `FakeSocket` on a virtual clock. The group check types no key.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `ef2f61d3` on 2026-09-29, in a scratch copy: **571 test files passed and 1 skipped (572); 7 360 tests passed and 2 skipped (7 362); no unhandled errors.** The scratch copy's numbers after each wave (research notes) are references, not the gate: the gate is the rule. (The `Not implemented: window.open` stderr lines are pre-existing, `ChildWindowPopover`'s.)
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. Every file this plan edits is already inside the regex.

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    The same command is `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh`; its output must equal `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate-baseline.txt` — exactly these **20** lines, re-measured at `ef2f61d3` (**259** lines in the full tree, the ceiling):

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

    Do not fix them; do not add to them. The TS lib is ES2020: no `Array.prototype.at` in a test either.
  - **Gates in a parallel wave.** Wave 1 runs Tasks 1 and 2 at once in this one working tree, so each sees the other's red phase:
    - a test failure, or an extra gate line, in a file the other task is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, and the exact baseline.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere its change could reach, it says why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides.
  - **No task mutates the tree to prove a guard, and no temporary file is written inside `src/`.** A mutant a reviewer wants to try runs in a scratch copy under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`.
- **Builds, at the group check only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
  - The new Gemini code shipped: `command grep -rlF 'turn.hold_end' build extension/dist` names at least one file under `build/` and one under `extension/dist/`. Nothing in `src/`, `extension/` or `electron/` holds that name at `ef2f61d3` (checked).
- **Dev servers, probes and builds** are the controller's; an implementer never starts one.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, heredocs other than a commit's, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`, each agent in a directory named for its task and role (`t3-impl/`, `t4-review/`).
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: another plan's tasks stage into the same index. Never stage a whole directory.
  - Production comments cite this plan's rulings and choices as "(Gemini hold, ruling N)" / "(Gemini hold, choice N)", and the earlier plans' as they already do; never a task number, a review finding or a probe's file name. English only.
  - Never push.

## Rulings

Cited as *ruling N* (in code, "Gemini hold, ruling N"). All four are the owner's (2026-09-29). Each is restated with where it lands.

1. **A 3.x dialogue model holds the leg's input from the user's turn close to its `turnComplete`.** Once the server has closed the user's turn, the adapter holds the microphone's audio, a press's activity marks and typed text locally until the model's `turnComplete`, then releases what it held and goes on live. Under automatic turns the hold begins at the server's `voiceActivity` ACTIVITY_END, falling back to the first `inputTranscription` or the first model output of the turn. Under push-to-talk it begins when the adapter's own `activityEnd` goes out; a press during the hold defers its `activityStart` and its audio until `turnComplete`, then sends `activityStart` and the held audio, and `activityEnd` if the press has already ended. Lands in: Task 1 (the hold), Task 2 (the signal on the wire), Task 3 (automatic turns), Task 4 (push-to-talk and typed text), Task 5.
2. **Only the family that barges in holds.** The 2.5 dialogue models and Live Translate are unchanged: they do not barge in, and 2.5 under `NO_INTERRUPTION` hears the overlap whole. The follow-up's ruling 5 stays — 3.x barges in — and with the hold the server never sees the overlap. Lands in: Task 3 (choice 1), Task 5.
3. **The cap is adaptive** (「就按自适应上限来」, confirmed 2026-09-29 on the controller's proposal from the owner's probe batch 2f). A hold releases at `turnComplete`; if that has not come, at the first model audio's arrival plus the total received audio's duration plus `HOLD_MARGIN_MS` (2 000), recomputed as audio arrives; with no model audio at all, `HOLD_IDLE_MS` (10 000) after it began. The cap always releases what it holds, never discards it; everything on the request's clock. Lands in: Task 1 (choice 6), Task 3, Task 5.
4. **Under automatic turns, a new start lets a hold go, and a release lets one utterance go** (「按turn2改计划」, 2026-09-29, on the multi batches he ran for this plan: the probe's `turn2` policy). (ii) An ACTIVITY_START while a hold is on releases it at once — except the hold a split release itself begins, while it waits for its END. (iii) A release sends the held audio only up to its first pause after speech of at least the split's pause, found by an energy gate over the held audio, and keeps the rest held until the server's ACTIVITY_END for what went up, then until that answer's `turnComplete`; with no ACTIVITY_END within the split's wait, it sends the rest. The owner adopted the probe's values, a 600 ms pause and a 1 500 ms wait; the coordinator's rulings on the third re-review (Revision 4) set the wait to `SPLIT_END_MS` (2 000) or half the released audio's length, whichever is longer, the pause to `max(200, silenceMs + 100)` — 600 at the default silence — and end (ii)'s exception at the split's END (choices 14, 15). The adaptive cap (ruling 3), the participant leg's hold (choice 1), the carry across a reconnect with `HOLD_CARRY_MS` (choice 10) and ruling 2 stand. Lands in: Task 1 (choices 14, 15), Task 3, Task 4 (the seeded lifecycles), Task 5.

The standing rules hold: no one-time migration code (nothing is stored here), and production comments cite rulings and choices.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **Which sessions hold: derived, no knob.** `config.kind === 'dialogue' && config.activityHandling === 'START_OF_ACTIVITY_INTERRUPTS'` — exactly the models the follow-up's ruling 5 makes barge in (a dialogue model of family 3.0 or later) — builds an `InputHold`; every other session has none. No `GeminiConfig` field, no setting: the probe keeps its own hold for experiments. Both legs, both turn modes. **The participant leg holds the same** (its turns are always automatic): the server paces its `turnComplete` to a playback nobody may hear on a leg that does not speak, and the same input is at risk — without the hold, remote speakers, who do not wait for translations, are where barge-in cuts most. **The cost, and that it can accumulate:** answer n+1 cannot start before answer n's simulated playback ends, and under ruling 4 each utterance is its own n, so the lag behind the end of utterance n+1 is roughly L(n+1) ≈ max(L(n) + A(n) − P − U(n+1) + c′, c) + f — A an answer's audio length, P the pause, U the next utterance's length, c′ the server's close of a held utterance once it goes up (0.76–1.41 s in batch 2), c its close of live speech (0.63–0.91 s), f 0.3–0.8 s to first audio. The lag grows by A − U − P + c′ + f per sentence whenever translations run longer than the speech that follows, with no bound until a long pause: in batch 2 it reached 7.36 s behind a short sentence that followed a long one, and on the five-sentence monologue it stayed within 1.4–3.4 s (3.8; research note 6 of the multi batches). Nothing is lost: it is sent late, not dropped. For a participant leg that mostly listens to long monologues, Live Translate — the default model — has no turns and no such lag (about 0.5 s measured; the concurrent-turns research §5). **The owner confirmed it on 2026-09-29: 「参会方要暂存」.**
2. **What begins a hold under automatic turns.** The server's `voiceActivity` ACTIVITY_END: it has closed the user's turn. Failing that, a model turn's first model output — an output transcription, or a model part that `GeminiTurns` takes as content: playable audio or the model's text, not a thought, nor audio it cannot decode or does not play (Revision 5, re-check 4's Minor 2) — or, **only on a session that has heard no voice activity**, its first input transcription. Two more guards on the fallbacks: none while the server says the user is speaking (an ACTIVITY_START with no ACTIVITY_END yet — an output while the user speaks closes no turn); and one per model turn — once a hold has begun in a model turn its later output begins none, even after a cap let it go, until `turnComplete`, `interrupted` or `waitingForInput` ends that turn. ACTIVITY_END always begins one — except the one a split's hold waits for, which ends that wait instead; and a release that kept the next utterance begins a split's hold itself (ruling 4; choice 14). Typed text under automatic turns begins none itself: its answer's first output does, which is why the output fallback stays. This is the probe's cascade (`CASCADE.activity_end`), less its `generation` policy's "none after `generationComplete`" guard, which a hold to `turnComplete` does not need: a late signal still holds to `turnComplete`, which is what protects the input. **Why the input fallback is off once voice activity has come** (the controller's ruling on the review's I2): in all 44 3.x probe runs the transcription arrived while the voice activity was still open, so on a model that sends voice activity it is never a turn close — only a transcription that comes after its own `turnComplete` (Google: "no guaranteed ordering") could reach the fallback, and that one would hold all of the user's live speech, which no server signal could end, until the idle cap, 10 s (the review's scenario S1, pinned in Task 3). "Heard" is the model's property, kept across a reconnect. A model that sends no voice activity keeps the input fallback. **A missed ACTIVITY_END** leaves `speaking` set: neither fallback begins a hold for that model turn or the next, which fall back to barge-in, until the next ACTIVITY_END ("What this plan leaves"); a split's hold whose ACTIVITY_END is missed lets the rest go after its wait (2 s, or half the audio it let go).
3. **What begins a hold under push-to-talk: the leg's own `activityEnd`,** when it closes a turn the model answers — a release with voice, and typed text's own marks. The server's voice activity, which under push-to-talk only mirrors the client's marks (the probe), and the fallbacks begin nothing. **A release without voice begins none** — a departure from the brief's wording, which has the hold begin "when our own `activityEnd` goes out (a release)": whether the server answers an empty activity is unknown (the Gemini section's live-test item 6), and a hold waiting for an answer that never comes would keep the next press back until the idle cap. So a press made while a tap's answer, if any, streams goes up at once and barges in — cutting an answer the tap's drop hides anyway (the Gemini plan's ruling 8). The runner already classes a press under `MIN_VOICED_SAMPLES` (500 ms) as a tap. Ruling 4's two rules do not apply under push-to-talk (choice 14).
4. **What lets go: `turnComplete`, and `waitingForInput`** — and under automatic turns an ACTIVITY_START, or a split's wait run out (ruling 4; choice 14). At `turnComplete`, after `GeminiTurns` has ended the turn, so a held release and a held text are owed from a closed turn (choice 13). At `waitingForInput` — the model "is not generating content because it is waiting for more input from the user" — at once: holding would keep from it the input it waits for; its turn is over, as at `turnComplete` (the coordinator's ruling D on re-review 3) — except while a split's hold awaits its END, which its own wait bounds (choice 14). **Not `generationComplete`:** the probe's `generation` policy kept answer 1 whole but left utterance 2's start transcribed and not translated — input inside the simulated playback is mishandled even under barge-in. **Not `interrupted`:** with the hold it should not come, but it can. The server closes the user's turn at the ACTIVITY_END's `audioOffset`, 0.71–0.79 s after the speech's end on the multi batches' clips (batch 2: 0.63–0.91 s; later than its 500 ms `silenceDurationMs` setting), and the client begins the hold 0.03–0.04 s (3.8) or 0.12–0.19 s (3.1) after that, in stream time: speech that starts in that window reaches the server before the hold begins, and once the server has heard 0.14–0.18 s of it (the Japanese clips; 0.27–0.56 s of English) its ACTIVITY_START may barge into answer 1 as it starts generating, a true cut (failure mode (a), "What this plan leaves") — so on 3.8 it needs more speech than the window lets through, on 3.1 a narrow band; it did not happen in 54 sessions. Speech that starts before the close merges into the same turn. A released burst that itself holds a turn close could also end in `interrupted` (failure mode (b)); ruling 4 leaves that only where a split's wait runs out before the server's close (choice 14). Either way `interrupted` itself lets nothing go: the hold goes on to the `turnComplete` Google says follows it ("interrupted > turn_complete"; about 5 ms in the probes), because a held text let go at `interrupted` would break the one-end rule (research note 2). The ACTIVITY_START behind an `interrupted` lets a hold go at once when it comes first, as 50 of the multi batches' 53 did — the held text then goes before the `interrupted`, as text typed at that moment would — and at that trailing `turnComplete` when it comes between the two, unless content has come since the `interrupted`, which ends that end as `GeminiTurns` reads it (choice 14). Should no `turnComplete` follow, the cap lets go.
5. **The release: in order, the audio as one frame per unbroken run.** Each held send — a press's start or end, typed text — runs in its place; each run of audio between them goes up as one `realtimeInput.audio` frame, the probe's burst (a paced release made no difference; Google's own examples send a whole utterance as one message; `audioOffset` counts audio time). A held send that begins a new hold — a release's `activityEnd`, typed text's own marks — stops the release there; what follows it stays held until that hold lets go. Held audio is a copy: the capture may reuse its buffer. **Size:** a burst is as long as the held audio — about 5 s in the probes, 240 KB of pcm, 320 KB as base64 JSON (`pcmToBase64` encodes in 32 KiB steps); Google documents no size limit for a realtime message, and live-test item 2 watches a long one. **Under automatic turns the burst stops at the held audio's first pause after speech** (ruling 4; choice 14): a burst that held the end of one utterance, a pause the server closes a turn on, and the start of the next let the server read both at once — the gap and failure mode (b) in the multi batches.
6. **The cap's details, inside ruling 3.** The computed end counts the model turn's audio at each part's own rate, whether this leg plays it or not, and the audio that came before the hold began; it is recomputed at each part. **Why computed:** in every probe run a 3.x `turnComplete` came at first audio plus total audio within ±20 ms (research §1.0), so the adapter can know the end itself, where a fixed cap would either cut a long answer's hold short or keep a short one waiting; 2f collapsed its long clip into one ~4.5 s answer, so no probe bounds a long answer's hold. **What an early cap costs:** it lands inside the simulated playback, after `generationComplete` so long as the model generates ahead of real time — 4.4–4.9× in every probe turn, which puts the computed end past the last part's arrival — so a simulated cut only: answer 1's text and audio are whole, and utterance 2's start may go untranslated, as under the `generation` policy; not a true cut. A model that stalls mid-answer for longer than the audio it has sent plus 2 s could be cut truly. **The clock:** the cap is a timer on the request's clock, never an end compared with `now()`; its delay is at most the audio received plus the margin, so a wall clock stepped back cannot stretch it (OpenAI Translate's tail's lesson); a wall clock stepped forward lets go early, a simulated cut at worst. `turn.hold_end` carries `playbackEndMs` beside `heldMs`: what the live test tunes the margin by. Pinned with a virtual clock: a long answer holds past 8 s; a short answer lets go at its computed end when `turnComplete` is late; a hold with no model audio lets go at 10 s. No cap runs while a hold is carried across a reconnect (choice 10). A split's hold has the same cap — armed at its begin, the idle cap since its answer has no audio yet, and recomputed as that answer's audio arrives — beside its own shorter wait for the server's close (choice 14).
7. **A press during a hold waits its turn.** Its `activityStart` — with `GeminiTurns.beginTurn()` — is held, its audio after it, and its release — with `GeminiTurns.endTurn()` or `cancelTurn()` — too: each call reaches `GeminiTurns` when its frame goes out. At the release they go in order; a press still held when the hold lets go goes on live, its release sent at once. **A press released without voice while its `activityStart` is still held is withdrawn** — a departure from the brief's wording, which has a deferred press "then send `activityStart` + held audio (+ `activityEnd`…)": that start and every audio entry held after it — the press's own, since audio comes only while a key is held (research note 6) — go, and nothing is sent. It never reached the server, so nothing answers it and nothing needs dropping (no `cancelTurn()`): strictly better than sending it. A text typed inside it stays and goes in its own marks (choice 9). `turn.hold_end` counts it in `withdrawn`.
8. **Typed text during a hold is held whole:** its source segment and owed answer (`GeminiTurns.typed()`) and its marks run when it goes up. So it shows when it is sent, under the next turn's origin, paired with its own answer, where a text shown at once would take the answering turn's origin (in the panel and in exports). The cost: the row appears up to one hold late (4.6–7.5 s in the probes). Under automatic turns it goes bare, as today — in its place between held audio, and Google documents no ordering across modalities (live-test item 13); a text held before a split's pause goes with its utterance, one held after it waits with the next (choice 14); under push-to-talk in its own marks, whose `activityEnd` begins the next hold (choice 3). While a hold is carried across a reconnect, text typed in the gap is held too (choice 10). Outside a hold, text typed while the connection is down is still dropped, with no segment (the Gemini plan's choice 17, a stated departure).
9. **Typed text's marks are read on the wire, not off the key.** `activityOpen` — an `activityStart` sent with no `activityEnd` after it, a press's or a Live Translate tail's — replaces `turnOpen` in the wrap rule (`sendText`). Set where `ACTIVITY_START` goes (a press; the ladder's restart), cleared where `ACTIVITY_END` goes (the one helper every release and tail end uses) and on a reconnect (the old connection's activity is gone). Outside a hold it equals "a press is held, or a tail runs", and a tail is ended before any text: nothing landed changes. Inside one, a held text can outlive a withdrawn press, or go after a press's release while the next key is down (research note 3).
10. **A lost connection carries the hold over** (the controller's ruling on the review's I3, 2026-09-29). A GoAway — every connection gets one about every 9–10 min, `time_left` 50 s (the concurrent-turns research §4) — or an unexpected close, during a hold: what the hold kept is not dropped. Under automatic turns it *is* the start of the next utterance, which the new session must hear; Google DevRel's live-translator likewise replays unanswered audio into its replacement session across a GoAway. So the hold goes on through the reconnect gap — keeping what the leg sends meanwhile, audio, presses and typed text — with no cap, since no model turn can end on a connection that is gone. **The gap's audio is bounded under automatic turns** (the controller's ruling on the re-review, Revision 2): of the audio sent in the gap, the hold keeps at most `HOLD_CARRY_MS` = 5 000 — the gap's first 5 s, a chunk straddling the bound trimmed — and drops the rest, as today's gap drops all of it; everything held before the loss is carried whole, and held marks and text always. Why the first: it is the start of what is being said, which the carry exists for; dropping it instead would splice a jump into the middle of the burst. Why 5 s: a GoAway, or a close resumed at once, costs about one setup (median 205–211 ms, 183–357 ms, n = 62; the concurrent-turns research §4), and a first attempt that fails fast plus the 2 s backoff and a second setup about 2.2–2.6 s; anything longer is the ladder waiting out a 15 s setup timeout, by which time the speech is stale — the re-review's slow ladder turned a 35 s gap into one 40 s, 2.56 MB burst, several turn closes' worth (failure mode (b) many times over). Push-to-talk is not capped: the user's own presses bound it, and a carried burst stops at the first carried release's `activityEnd` (choice 5). `turn.hold_end` says `droppedMs`. The old session's speaking state and model turn are forgotten, its voice activity's "heard" kept (choice 2). Once the new connection's setup is answered, the ladder restarts a press still down (the follow-up's choice 14) **unless the hold still holds that press's own `activityStart`** — then the hold sends it, once, before the press's audio: never two `activityStart`s. Then the hold lets go at once, in order: the new session has no model turn in flight, so it holds nothing for the old turn; a held release's or text's own `activityEnd` begins the next hold there as anywhere; under automatic turns it lets one utterance go, as at `turnComplete`, and holds the rest for the new connection's ACTIVITY_END (choice 14). A split's wait, like the cap, stops with the lost connection: no ACTIVITY_END can come on it. Framed `turn.hold_end { reason: 'reconnect', carried: true, … }` after the new connection's `server.setup_complete`. Should the ladder fail, the leg fails and the stop drops it silently (choice 11). Outside a hold the gap keeps its landed rules: audio and text sent while no connection is set up are dropped.
11. **Stop drops the hold silently** — while it holds, while a split waits for the server's close, and while it is carried across a reconnect: nothing goes up after it (the socket is closed first anyway), nothing is said, no timer is left.
12. **The frames and the wire.**
    - `server.voice_activity` (`in`): `{ type, audioOffset }`, each only when present, for every voice activity message on every model (2.5 sends none);
    - `server_content.waiting_for_input` (`in`), no payload;
    - `turn.hold` (`out`): `{ cause }` — `voice_activity`, `input_transcription`, `model_output`, `activity_end`, or `split` (a release that kept the next utterance: choice 14);
    - `turn.hold_end` (`out`): `{ reason, heldMs, audioMs, actions, withdrawn, playbackEndMs, carried?, droppedMs?, keptMs? }` — `reason` one of `turn_complete`, `waiting_for_input`, `cap`, `idle`, `reconnect` (let go on the new connection after a lost one, and then `carried: true`), `voice_activity_start` or `split_timeout` (choice 14); `droppedMs` the gap's audio dropped past `HOLD_CARRY_MS`, only when some was (choice 10); `keptMs` the part of `audioMs` a split kept held for the next utterance, 0 when the held audio ended in the pause, only when the release split (choice 14); `audioMs` and `actions` what the hold held when it let go (entries a hold begun inside its release keeps are counted again in that hold's own); `playbackEndMs` the computed playback end from the hold's begin, `null` with no model audio (always after a reconnect: the model turn was the old session's).
    - No audio, no text, no credential; no `logStore` row. `GeminiServerMessage.voiceActivity` is typed as the wire spells it (`type`), not as the SDK's `VoiceActivity` (research note 1).
13. **`GeminiTurns` is unchanged; the held calls meet it when their frames go out.**
    - **Automatic turns** state origins by turn (`t<n>`): a burst's speech is transcribed after the answer's `turnComplete` has moved the turn on, so each answer pairs with its own utterance (pinned: `t1`, then `t2`). Held typed text is owed from the closed turn (`owed`, never `owedNext`) — a split's hold lets go at a `turnComplete` too. A START's release (choice 14) sends held text at once, where it takes the landed path of text typed at that moment: `owed`, or `owedNext` should an answer be streaming (failure mode (a)'s case) — never between `interrupted` and its `turnComplete` (pinned in Task 4: the text pairs with its own answer, where letting go there opened that answer under a third origin).
    - **Push-to-talk:** a press made during a hold reaches `GeminiTurns` — `beginTurn()`, then `endTurn()` — only after the answer before it has ended (`closeTurn` clears `answering` before the release), so `endTurn()` finds no answer streaming and sets `owed`, never `owedNext`; a tap during a hold is withdrawn and never reaches it (no `cancelTurn()`, no drop). **The owed flag's limit** (the roadmap's follow-up section, "What it leaves": two answers waiting at once to start are one claim; a queued tap's answer taking a release's claim) **cannot arise while holds run**: every voiced release and every text's own marks begin a hold that lasts to that answer's `turnComplete`, so no second claim is made before the first ends and no tap in that window reaches the server. It can again in two cases, where the landed rules apply unchanged: after a hold let go at its cap; and on a model that answers taps — a tap begins no hold (choice 3), so a voiced press released while the tap's answer streams takes the `owedNext` path. On 2.5, unchanged. A carried release or text reaches `GeminiTurns` on the new connection, after `connectionLost()` closed the old turn: owed there.
    - `interruptedEnd`: the hold lets go at the `turnComplete` that trails `interrupted`, after `GeminiTurns` has folded it (choice 4). `suppressAfterAnswer` is set only by a tap that reaches the server: outside a hold.
    - **Karaoke by arrival** (the follow-up's ruling 2) is unaffected: its ranges come from the model's output as it arrives, and the hold changes only what goes up. **The release tail** (`tail.ts`) is unaffected: Live Translate never holds, and a dialogue model never tails.
14. **Ruling 4's rules, in detail** (automatic turns only; the probe's `turn2`, with the departures named here, and the coordinator's rulings on re-review 3, Revision 4).
    - **A new start lets go.** An ACTIVITY_START while a hold is on lets it go at once, everything it holds, in order, framed `turn.hold_end { reason: 'voice_activity_start' }`, and the release is not split. Nothing goes up while a hold is on, so the START concerns speech that went up before it — the multi batches' gap: a hold begun on an ACTIVITY_END that lagged a released burst by 1.0–3.7 s, the next utterance's START 15–130 ms after, and the idle cap (research notes, multi batches, note 2). Holding on keeps that utterance's end from a server that already has it open and can then never close it. The START's own effect — a cut on 3.1, on 3.8 a merge before the answer's first output — has happened by the time it arrives: letting go costs nothing measured. **Three exceptions.** A split's own hold while it waits for its END (below): its utterance's START is expected once the server reads that utterance's onset; once the END has come, a START lets it go like any other (departure 6). Between `interrupted` and the `turnComplete` that trails it, the hold lets go at that `turnComplete`, still saying `voice_activity_start`: a held text sent between the two would make the trailing `turnComplete` an end of its own (research note 2; found while writing Revision 3, note 1); content since the `interrupted` ends that wait, as it ends `GeminiTurns`' own one-end window, so a trailing `turnComplete` that never comes cannot leave the START rule off (the coordinator's ruling D). Content is what `GeminiTurns` counts, exactly: an input or output transcription with text, a model part with playable audio or the model's text; a thought, audio that will not decode, and audio at a rate it does not play are none (Revision 5, re-check 4's Minor 2). A part `GeminiTurns` ignores that ended the hold's wait would send held text between the two ends — its answer under a third origin, as departure 3 guards against (pinned in Task 4). Push-to-talk (below).
    - **One utterance per release.** On a session that has heard voice activity, a release at `turnComplete`, at `waitingForInput` or on a new connection sends what is held only up to the first entry after the first pause that follows speech and lasts at least the split's pause — `max(SPLIT_PAUSE_FLOOR_MS, silenceMs + SPLIT_PAUSE_MARGIN_MS)`, 600 ms at the default silence (choice 15) — the next utterance's audio, from the chunk its first speech frame begins in, or a send held after the pause. The rest stays held in a hold of its own, framed `turn.hold { cause: 'split' }`, which waits for the server's ACTIVITY_END for what went up: `SPLIT_END_MS` = 2 000, or half as long as the audio it let go plays, whichever is longer. That END begins no hold; the split's hold then runs to that answer's `turnComplete`, as any hold does, its caps included (choice 6). With no END within the wait the pause closed no turn: all the rest goes, as one burst, unsplit, framed `reason: 'split_timeout'` — a merge, not a loss. Held audio that ends in such a pause goes up whole and the leg holds on the same way (`keptMs: 0`), so speech right after the release cannot reach the server before the released utterance is answered. With no such pause the release goes whole, as before ruling 4. The cap, the idle cap, a START and a split's own timeout never split: each exists so that nothing waits longer. Evidence: research notes, multi batches, note 5 — every utterance whole in 10 of 10 sessions; 22 splits, the server's END 0.76–1.41 s after 18 of them.
    - **The wait: 2 s** — `SPLIT_END_MS` is 2 000, the coordinator's ruling on re-review 3 (ruling A there): at the probe's 1 500, all four of batch 2's timeouts were 3.1 closes landing 1 561–1 611 ms after the split; at 2 000 they are caught, and nothing else in the ten sessions changes (re-review 3, §3, replaying them through this plan's adapter).
    - **The wait grows with what went up** (ruling C there). The server reads a released burst at about 2–4× real time, so its close comes later the more it has to read: on 3.1, 2.1 s released → its END 0.96 s later, 3.5 s → 1.25 s, 4.9 s → 1.39 s, and 3.3–6.4 s → 1.56–1.61 s where the 1.5 s wait ran out (re-review 3, §5). Half the released audio covers the slowest rate measured (3.1, 2.1×) and leaves 2 s wherever 4 s or less went up; batch 2 never released more than 6.4 s. The END ends the wait early, so the longer wait costs lag only on a pause the server does not close — and there nothing bounds it but the hold's own cap: a 16 s released part waits 8 s before the rest goes, merged ("What this plan leaves"). Pinned: 8.8 s released waits 4.4 s, and an END at 3.9 s is consumed.
    - **Where this departs from the probe's `turn2`** — none of the six changes a decision on batch 2's sessions, which had no reconnect, no typed text, voice activity always heard, no `interrupted` ahead of its START under `turn2`, no START after a split's END, and 100 ms chunks of whole frames (Task 3 replays two of them through the adapter; re-review 3 replayed all ten): (1) a release on a new connection splits too, since carried audio can hold several utterances and one burst of them on a fresh connection is the burst the gap and (b) came from; (2) the split waits only on a session that has heard voice activity, since on a model that sends none every release would wait its 2 s for an END that never comes; (3) a START between `interrupted` and its `turnComplete` waits for that `turnComplete`; (4) a send held after the pause stays with the next utterance (choice 8); (5) the gate frames across chunks (choice 15); (6) **a split's hold lets a START go once its END has come** — the coordinator's ruling E on re-review 3. After the END the server has closed the released utterance, so a START is a new user turn the hold cannot protect against, and holding on to it reproduces the gap's stall to the idle cap; letting go merges the held audio into that turn, exactly the START rule. The probe exempted a split's hold for its whole life. If this is wrong — a START after the END that still belongs to the released utterance — the kept onset goes up while that answer is pending: failure mode (b), a cut on 3.1 or a merge on 3.8, as a timeout sends it. Beside the six, the coordinator's rulings set the wait (2 s where the probe had 1.5 s, and longer for long released parts) and derive the pause from the session's silence (the probe's 600 at the default): at batch 2's setting the first turns its four timeouts into closes caught, and nothing else moves.
    - **Push-to-talk splits nothing, and a START lets nothing go there.** The leg's own marks already end each utterance: a release's `activityEnd` begins the next hold and stops the drain there (choice 5), so a press's burst never carries the next press's onset; the server closes no turn inside a press — its automatic detection is off — so a pause inside a press is not a turn and cutting there would break the user's own turn in two; and the server's voice activity only mirrors the leg's marks (choice 3), so a START during a hold is the echo of a mark already sent. `InputHold` takes no silence setting under push-to-talk, and has no split's pause there.
    - **With what stands.** The adaptive cap (ruling 3): a split's hold is a hold (choice 6). The participant leg (choice 1): its turns are automatic, so both rules apply, at its own Silence Duration, and its lag per sentence is choice 1's formula. A lost connection (choice 10): a split's wait stops with it; what a split kept was held before the loss and is carried whole, the gap's audio bounded by `HOLD_CARRY_MS` after it; the new connection's release splits again and waits there. 2.5 and Live Translate never hold (ruling 2). `waitingForInput` ends the model's turn before it lets go, as `turnComplete` does, and releases split, so a split's hold arms its cap from a fresh turn, not the last answer's audio (the coordinator's ruling D). **While a split's hold awaits its END, `waitingForInput` does nothing** (Revision 5, re-check 4's Minor 3): that split was just released — by the `turnComplete` the adapter reads first when both ride one message — the END it waits for is still to come, and its own wait bounds it. Letting go there would re-split the kept onset, find no pause in it, and send it while the released utterance's close is pending: failure mode (b). After the END, `waitingForInput` lets go as ever. Typed text: held in its place (choice 8), and a START's release sends it with the rest — owed as text typed at that moment would be (choice 13). Presses: push-to-talk, above. Stop: the split's wait stops with the hold (choice 11).
15. **The split's pause, and the gate that finds it** (ruling 4; the probe's `splitAt`; the coordinator's ruling B on re-review 3).
    - **The pause follows the session's own end-of-speech silence.** `splitPauseMs(silenceMs)` = `max(SPLIT_PAUSE_FLOOR_MS, silenceMs + SPLIT_PAUSE_MARGIN_MS)` = max(200, silenceMs + 100), `silenceMs` the session's `activity.silenceMs` under automatic turns — the Silence Duration slider, 50–3 000 ms, default 500 (`config.ts` clamps it), on both legs; the adapter hands it to `InputHold`, which takes none under push-to-talk. At the default the pause is 600, the probe's, so every batch-2 decision stands (Task 3's replays run at the default). **The direction of error:** a split pause shorter than the server's close costs a wait — lag only, the rest going up merged; one longer than the close misses it — failure mode (b), and on 3.8 the gap. `silenceMs + 100` errs toward the first: at the default the server closed 0.63–0.91 s after the speech, every close above 600. Only the default setting is measured; `END_SENSITIVITY_LOW` closes later still, the safe side. The floor keeps the gaps between words from splitting; below a `silenceMs` of about 100 it lets closes shorter than 200 ms through unsplit ("What this plan leaves"). A fixed 600, as in the probe, would split every pause of 0.6 s up to the server's close at a 1 500 ms setting — a wait and a merge each, inside sentences too — and miss every close under 600 ms at a 300 ms one (re-review 3, Important 1).
    - **The gate.** The held audio, as one stream, in `GATE_FRAME_MS` = 10 frames; a frame is speech when its RMS is above the loudest held frame's RMS divided by `GATE_PEAK_DIVISOR` = 10 — 20 dB under it — and a pause is a run of frames that are not; a held send breaks the stream. The probe framed each of its 100 ms chunks alone; a capture's chunks may be smaller than a frame (an AudioWorklet's render quantum is 128 samples), where that finds no frame and never splits, so frames here run across chunks and each is counted to the chunk it begins in (found while writing Revision 3, note 2). On batch 2's audio in 128-sample chunks the split lands 113–157 ms later than the probe's, the onset's quiet rise going with the released utterance, and every decision is the same (re-review 3, §3).
    - **What the thresholds rest on, and what they do not.** On batch 2's clips — synthesised Japanese sentences with digital silence between them — every split fell at an utterance's boundary, none inside one; the default pause, 600, sits under every close the server made (0.63–0.91 s after the speech), so every pause the server closes a turn on is a split point, and a shorter one it does not close on costs the split's wait, then goes up merged. Ten sessions (batch 2's `turn2`), two TTS voices, clean audio, one silence setting. Re-review 3 measured the gate in scratch on batch 2's audio: steady white noise still split at 22 dB under the loudest speech frame and no longer at 20 dB — the gate's cliff, `GATE_PEAK_DIVISOR` — while a speech-shaped echo still split down to 10 dB. Unprobed live: a noise floor within 20 dB of the voice (no pause is found and the release goes whole, as under ruling 1 alone, with the START rule still ending any stall), other voices, the answer's own echo in held audio on speakers (research note 5; the same fallback), a speaker who pauses past the split's pause inside a sentence (split there: the server closes on it only if it would have live, else the wait, then a merge), and any Silence Duration but the default. Live-test items 5, 6, 12, 14, 15 and 17 watch them.

## What this plan consumes from the earlier plans

Named as landed, so a reconciliation is mechanical. Where a landed name or text differs from what is quoted here, the implementer follows the landed one and reports it.

| From | What it is | Consumed by |
|---|---|---|
| The Gemini plan: `GeminiSession` (`beginTurn`, `endTurn`, `appendText`, `reconnect`, `ladder`, `shutdown`, `onMessage`, `onContent`, `onModelTurn`), `GeminiTurns` (`input`, `output`, `interrupted`, `turnComplete`, `typed`, `beginTurn`, `endTurn`, `cancelTurn`, `connectionLost`), the fixtures (`liveGemini`, `SERVER`, `serverFrame`, `configFor`, `AUTO_CTX`, `KEY`, `DIALOGUE`, `TRANSLATE`) | what the hold wraps | Tasks 2–4 |
| The Gemini/AST2 follow-up: `GeminiConfig.activityHandling` and `geminiActivityHandling` (ruling 5), `BARGE_IN`, `ReleaseTail` (`tail.ts`: the shape of a pure timed module, and its lesson on the clock), the one-end rule (`interruptedEnd`), the owed flag (`owed`, `owedNext`) | which models hold; the module's shape; what the release must respect | Tasks 1, 3, 4 |
| The Palabra plan: `runLifecycles` / `LifecycleHarness` (the kit's seeded lifecycles, its ruling 15) | the seeded lives | Task 4 |
| The kit: `FakeSocket`, `fakeSockets`, `runScenario` / `scenarioNames`, `trackedClock`, `flush` | every test | Tasks 1–4 |
| The probe: `gemini-hold.mts` (`createHold`, `CASCADE`, `RELEASED_BY.turn`, `sendBurst`; `turn2`'s `SPLIT_MS`, `SPLIT_WAIT_MS`, `splitAt`) | the reference behaviour | Tasks 1, 3, 4 |

## File Structure

| File | Task | Change |
|---|---|---|
| `src/providers/gemini/{hold,hold.test}.ts` (new) | 1 | the hold, pure |
| `src/providers/gemini/{wire,testing,adapter,adapter.test}.ts` | 2 | the server's voice activity and wait for input, read and framed |
| `src/providers/gemini/{adapter,adapter.test}.ts`, `src/providers/gemini/adapter.hold.test.ts` (new), `src/providers/sessionSide.consistency.test.ts` | 3 | the hold under automatic turns, one utterance per release, carried across a reconnect |
| `src/providers/gemini/{adapter,adapter.test,adapter.hold.test}.ts` | 4 | the hold under push-to-talk, and typed text |
| the spec, the roadmap | 5 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Tasks 1 and 2. Disjoint files: Task 1 only creates `hold.ts` and its test; Task 2 edits `wire.ts`, `testing.ts`, `adapter.ts` and `adapter.test.ts`.
- **Wave 2:** Task 3 (needs Task 1: `hold.ts`; and Task 2: the fixtures, `voiceActivity` on the wire, the adapter's frames).
- **Wave 3:** Task 4 (needs Task 3: the same adapter and tests).
- **The group check** (controller) after Wave 3.
- **Task 5** (controller) last.

---

### Task 1: The hold, pure (Wave 1)

**Files:**
- Create: `src/providers/gemini/hold.ts`
- Test: `src/providers/gemini/hold.test.ts` (new)

**Interfaces:**
- Consumes: `SAMPLE_RATE` (`src/lib/contract/adapter`), `Clock` (`src/lib/contract/clock`), `trackedClock` (the kit).
- Produces: `src/providers/gemini/hold.ts` — `HOLD_MARGIN_MS` (2 000), `HOLD_IDLE_MS` (10 000), `HOLD_CARRY_MS` (5 000), `SPLIT_PAUSE_MARGIN_MS` (100), `SPLIT_PAUSE_FLOOR_MS` (200), `SPLIT_END_MS` (2 000), `GATE_FRAME_MS` (10), `GATE_PEAK_DIVISOR` (10), `splitPauseMs(silenceMs: number): number`, `type HoldCause = 'voice_activity' | 'input_transcription' | 'model_output' | 'activity_end' | 'split'`, `type HoldEnd = 'turn_complete' | 'waiting_for_input' | 'cap' | 'idle' | 'reconnect' | 'voice_activity_start' | 'split_timeout'`, `interface HoldSummary { reason: HoldEnd; heldMs: number; audioMs: number; actions: number; withdrawn: number; playbackEndMs: number | null; carried?: true; droppedMs?: number; keptMs?: number }`, `interface HeldAction { readonly run: () => void }`, `type InputHoldOptions = { clock: Pick<Clock, 'setTimeout' | 'now'>; send(pcm: Int16Array): void; began(cause: HoldCause): void; ended(summary: HoldSummary): void } & ({ manual: true } | { manual: false; silenceMs: number })`, `class InputHold { constructor(o: InputHoldOptions); get holding(): boolean; voiceActivity(type: string | undefined): void; input(): void; output(audioMs?: number, content?: boolean): void; interrupted(): void; turnComplete(): void; waitingForInput(): void; begin(cause: HoldCause): void; audio(pcm: Int16Array): void; defer(run: () => void): HeldAction; holds(action: HeldAction | null): boolean; withdraw(action: HeldAction): boolean; carry(): void; reconnected(): void; cancel(): void }`. Tasks 3 and 4 wire it into the adapter.

- [ ] **Step 1: Write the failing tests** (rulings 1, 3, 4; choices 2–7, 10, 11, 14, 15), `src/providers/gemini/hold.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import {
  GATE_FRAME_MS,
  GATE_PEAK_DIVISOR,
  HOLD_CARRY_MS,
  HOLD_IDLE_MS,
  HOLD_MARGIN_MS,
  InputHold,
  SPLIT_END_MS,
  SPLIT_PAUSE_FLOOR_MS,
  SPLIT_PAUSE_MARGIN_MS,
  splitPauseMs,
  type HoldCause,
  type HoldSummary,
} from './hold';

/** A hold: under automatic turns, at the default end-of-speech silence, every probe session's, unless one is given. */
function hold(o: { manual?: boolean; silenceMs?: number } = {}) {
  const { clock, timers } = trackedClock();
  const sent: Int16Array[] = [];
  const began: HoldCause[] = [];
  const ended: HoldSummary[] = [];
  /** Every callback and held send, in the order they ran. */
  const log: string[] = [];
  const h = new InputHold({
    clock,
    ...(o.manual ? { manual: true as const } : { manual: false as const, silenceMs: o.silenceMs ?? 500 }),
    send: (pcm) => { sent.push(pcm); log.push(`audio ${Array.from(pcm.subarray(0, 4)).join(',')} ×${pcm.length}`); },
    began: (cause) => { began.push(cause); log.push(`began ${cause}`); },
    ended: (s) => { ended.push(s); log.push(`ended ${s.reason}`); },
  });
  /** A held send that logs its name when it runs. */
  const action = (name: string, then?: () => void) => h.defer(() => { log.push(name); then?.(); });
  return { h, clock, timers, sent, began, ended, log, action };
}
/** `n` samples of 24 kHz pcm, each `fill`: 2 400 are 100 ms. */
const pcm = (n: number, fill = 1) => new Int16Array(n).fill(fill);
/** `ms` of 24 kHz audio at one level: speech at 1 000 by default. */
const tone = (ms: number, level = 1_000) => pcm((ms * 24_000) / 1000, level);
/** `ms` of silence. */
const hush = (ms: number) => tone(ms, 0);

describe("a 3.x dialogue model's input hold (Gemini hold, ruling 1)", () => {
  it('lets go 2 s past the computed playback end, and 10 s after its begin while no model audio has come (ruling 3); carries at most 5 s of a reconnect gap\'s audio under automatic turns (choice 10); lets one utterance go at a time — up to a pause 100 ms past the session\'s silence and at least 200 ms, waiting at least 2 s for its close — found by 10 ms frames 20 dB under the loudest (choices 14, 15)', () => {
    expect([HOLD_MARGIN_MS, HOLD_IDLE_MS, HOLD_CARRY_MS]).toEqual([2_000, 10_000, 5_000]);
    expect([SPLIT_PAUSE_MARGIN_MS, SPLIT_PAUSE_FLOOR_MS, SPLIT_END_MS, GATE_FRAME_MS, GATE_PEAK_DIVISOR]).toEqual([100, 200, 2_000, 10, 10]);
  });

  it("begins at the server's ACTIVITY_END, holds what comes, and lets it go at turnComplete — the audio as one frame — saying what it held (choices 2, 4, 5)", () => {
    const { h, clock, timers, sent, began, ended, log, action } = hold();
    h.voiceActivity('ACTIVITY_START');
    h.voiceActivity('ACTIVITY_END');
    expect(began).toEqual(['voice_activity']);
    expect(h.holding).toBe(true);
    h.audio(pcm(2_400, 1));
    clock.advance(300);
    h.output(2_000);
    h.audio(pcm(2_400, 2));
    action('a held send');
    clock.advance(2_000);
    expect(sent).toEqual([]);
    h.turnComplete();
    expect(log).toEqual(['began voice_activity', 'ended turn_complete', 'audio 1,1,1,1 ×4800', 'a held send']);
    expect(Array.from(sent[0].subarray(2_398, 2_402))).toEqual([1, 1, 2, 2]);
    expect(ended).toEqual([{ reason: 'turn_complete', heldMs: 2_300, audioMs: 200, actions: 1, withdrawn: 0, playbackEndMs: 2_300 }]);
    expect(h.holding).toBe(false);
    expect(timers()).toBe(0);
  });

  it('keeps the order: each unbroken run of audio one frame, each held send in its place (choice 5)', () => {
    const { h, log, action } = hold();
    h.begin('voice_activity');
    h.audio(pcm(2, 1));
    action('A');
    h.audio(pcm(2, 2));
    h.audio(pcm(2, 3));
    action('B');
    h.turnComplete();
    expect(log).toEqual(['began voice_activity', 'ended turn_complete', 'audio 1,1 ×2', 'A', 'audio 2,2,3,3 ×4', 'B']);
  });

  it('a held send that begins a new hold stops the release there: what follows it stays held until that hold lets go (choice 5)', () => {
    const { h, log, action, ended } = hold({ manual: true });
    h.begin('activity_end');
    action('press 2 starts');
    h.audio(pcm(2, 2));
    action('press 2 ends', () => h.begin('activity_end'));
    action('press 3 starts');
    h.audio(pcm(2, 3));
    h.turnComplete();
    expect(log).toEqual(['began activity_end', 'ended turn_complete', 'press 2 starts', 'audio 2,2 ×2', 'press 2 ends', 'began activity_end']);
    expect(h.holding).toBe(true);
    h.turnComplete();
    expect(log.slice(6)).toEqual(['ended turn_complete', 'press 3 starts', 'audio 3,3 ×2']);
    // Each hold says what it held when it let go: the first, all of it; the second, what the first's release left.
    expect(ended.map((s) => s.actions)).toEqual([3, 1]);
  });

  it("falls back to a model turn's first model output when no ACTIVITY_END came — or its first input transcription, on a session that has heard no voice activity — never while the server says the user is speaking (choice 2)", () => {
    const input = hold();
    input.h.input();
    expect(input.began).toEqual(['input_transcription']);

    const output = hold();
    output.h.output();
    expect(output.began).toEqual(['model_output']);

    const speaking = hold();
    speaking.h.voiceActivity('ACTIVITY_START');
    // 3.8 transcribes the turn just before its ACTIVITY_END, with the activity still open (the owner's probe).
    speaking.h.input();
    speaking.h.output(100);
    expect(speaking.began).toEqual([]);
    speaking.h.voiceActivity('ACTIVITY_END');
    expect(speaking.began).toEqual(['voice_activity']);

    // A transcription that comes after its own turnComplete, on a session that has heard voice activity: no turn close.
    const heard = hold();
    heard.h.voiceActivity('ACTIVITY_START');
    heard.h.voiceActivity('ACTIVITY_END');
    heard.h.turnComplete();
    heard.h.input();
    expect(heard.began).toEqual(['voice_activity']);
    expect(heard.h.holding).toBe(false);
    // Its answer's output still is (a typed text's, say).
    heard.h.output();
    expect(heard.began).toEqual(['voice_activity', 'model_output']);
  });

  it('a fallback begins one hold per model turn: once a hold has begun in it, the turn\'s later output begins none, even after a cap; ACTIVITY_END always does (choice 2)', () => {
    const { h, clock, began, ended } = hold();
    h.output(100);
    clock.advance(100 + HOLD_MARGIN_MS);
    expect(ended.map((s) => s.reason)).toEqual(['cap']);
    h.output(100);
    h.input();
    expect(began).toEqual(['model_output']);
    // The user speaks again inside the same model turn: the server's close still begins a hold.
    h.voiceActivity('ACTIVITY_START');
    h.voiceActivity('ACTIVITY_END');
    expect(began).toEqual(['model_output', 'voice_activity']);
    h.turnComplete();
    // A new model turn: its first output begins one again.
    h.output(100);
    expect(began).toEqual(['model_output', 'voice_activity', 'model_output']);
  });

  it("under manual turns the server's signals begin nothing: the leg's own activityEnd does (choice 3)", () => {
    const { h, began } = hold({ manual: true });
    h.voiceActivity('ACTIVITY_START');
    h.voiceActivity('ACTIVITY_END');
    h.input();
    h.output(100);
    expect(began).toEqual([]);
    h.begin('activity_end');
    expect(began).toEqual(['activity_end']);
  });

  it('begins one hold at a time: a second begin is the same hold, one timer', () => {
    const { h, began, timers } = hold();
    h.begin('voice_activity');
    h.begin('activity_end');
    h.voiceActivity('ACTIVITY_END');
    expect(began).toEqual(['voice_activity']);
    expect(timers()).toBe(1);
  });

  it('interrupted lets nothing go: the turnComplete that trails it does (choice 4)', () => {
    const { h, sent, ended } = hold();
    h.begin('voice_activity');
    h.audio(pcm(2));
    h.interrupted();
    expect(h.holding).toBe(true);
    expect(sent).toEqual([]);
    h.turnComplete();
    expect(ended.map((s) => s.reason)).toEqual(['turn_complete']);
    expect(sent).toHaveLength(1);
  });

  it('waitingForInput lets go at once: the model waits for the user (choice 4)', () => {
    const { h, sent, ended } = hold();
    h.waitingForInput();
    expect(ended).toEqual([]);
    h.begin('voice_activity');
    h.audio(pcm(2));
    h.waitingForInput();
    expect(ended.map((s) => s.reason)).toEqual(['waiting_for_input']);
    expect(sent).toHaveLength(1);
  });

  it('turnComplete with nothing held says nothing and sends nothing', () => {
    const { h, sent, ended, timers } = hold();
    h.turnComplete();
    expect([sent, ended]).toEqual([[], []]);
    expect(timers()).toBe(0);
  });

  it('holds a copy: the capture may reuse its buffer', () => {
    const { h, sent } = hold();
    h.begin('voice_activity');
    const buffer = pcm(3, 7);
    h.audio(buffer);
    buffer.fill(0);
    h.turnComplete();
    expect(Array.from(sent[0])).toEqual([7, 7, 7]);
  });

  describe('the cap (choice 6)', () => {
    /** The model's answer: `chunks` parts of `ms` each, the first `lead` ms after the begin, then one every `every` ms — faster than real time, as every probe turn was. */
    function answer(t: ReturnType<typeof hold>, o: { lead: number; chunks: number; ms: number; every: number }) {
      t.clock.advance(o.lead);
      for (let i = 0; i < o.chunks; i++) {
        if (i > 0) t.clock.advance(o.every);
        t.h.output(o.ms);
      }
    }

    it('a long answer holds past 8 s, to its turnComplete at its playback end', () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      t.h.audio(pcm(2_400));
      // 20 s of answer, generated in under 5 s.
      answer(t, { lead: 300, chunks: 20, ms: 1_000, every: 220 });
      t.clock.advance(8_000 - t.clock.now());
      expect(t.h.holding).toBe(true);
      t.clock.advance(20_300 - t.clock.now());
      expect(t.h.holding).toBe(true);
      t.h.turnComplete();
      expect(t.ended).toEqual([{ reason: 'turn_complete', heldMs: 20_300, audioMs: 100, actions: 0, withdrawn: 0, playbackEndMs: 20_300 }]);
      expect(t.timers()).toBe(0);
    });

    it('with turnComplete late, a long answer still holds to its playback end plus the margin, recomputed as the audio arrives', () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      answer(t, { lead: 300, chunks: 20, ms: 1_000, every: 220 });
      t.clock.advance(20_300 + HOLD_MARGIN_MS - 1 - t.clock.now());
      expect(t.h.holding).toBe(true);
      t.clock.advance(1);
      expect(t.ended).toEqual([{ reason: 'cap', heldMs: 20_300 + HOLD_MARGIN_MS, audioMs: 0, actions: 0, withdrawn: 0, playbackEndMs: 20_300 }]);
    });

    it('a short answer lets go at its computed end when turnComplete is late, and the late turnComplete lets nothing go twice', () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      t.h.audio(pcm(2_400, 5));
      answer(t, { lead: 300, chunks: 4, ms: 1_000, every: 200 });
      t.clock.advance(4_300 + HOLD_MARGIN_MS - 1 - t.clock.now());
      expect(t.sent).toEqual([]);
      t.clock.advance(1);
      expect(t.ended).toEqual([{ reason: 'cap', heldMs: 4_300 + HOLD_MARGIN_MS, audioMs: 100, actions: 0, withdrawn: 0, playbackEndMs: 4_300 }]);
      expect(t.sent).toHaveLength(1);
      t.clock.advance(1_000);
      t.h.turnComplete();
      expect(t.ended).toHaveLength(1);
      expect(t.sent).toHaveLength(1);
      expect(t.timers()).toBe(0);
    });

    it('a hold with no model audio lets go 10 s after it began', () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      t.h.audio(pcm(2_400));
      // A transcription or a text part is no audio: nothing to compute an end from.
      t.h.output();
      t.clock.advance(HOLD_IDLE_MS - 1);
      expect(t.h.holding).toBe(true);
      t.clock.advance(1);
      expect(t.ended).toEqual([{ reason: 'idle', heldMs: HOLD_IDLE_MS, audioMs: 100, actions: 0, withdrawn: 0, playbackEndMs: null }]);
      expect(t.sent).toHaveLength(1);
    });

    it("counts the model turn's audio that came before the hold began", () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_START');
      t.h.output(1_000);
      t.clock.advance(2_500);
      t.h.voiceActivity('ACTIVITY_END');
      // Its 1 s of audio began at 0: the cap is due 1 s plus the margin from 0, not from the begin.
      const due = 1_000 + HOLD_MARGIN_MS - 2_500;
      t.clock.advance(due - 1);
      expect(t.h.holding).toBe(true);
      t.clock.advance(1);
      expect(t.ended).toEqual([{ reason: 'cap', heldMs: due, audioMs: 0, actions: 0, withdrawn: 0, playbackEndMs: -1_500 }]);
    });

    it('a hold begun by a turnComplete\'s release counts from the next turn: no audio yet, so 10 s', () => {
      const t = hold({ manual: true });
      t.h.begin('activity_end');
      t.h.output(1_000);
      t.h.defer(() => t.h.begin('activity_end'));
      t.h.turnComplete();
      expect(t.began).toEqual(['activity_end', 'activity_end']);
      t.clock.advance(HOLD_IDLE_MS);
      expect(t.ended.map((s) => s.reason)).toEqual(['turn_complete', 'idle']);
    });

    it('a wall clock stepped back never stretches it past the audio received plus the margin', () => {
      const { clock: base, timers } = trackedClock();
      let offset = 0;
      const clock = { now: () => base.now() - offset, setTimeout: (fn: () => void, ms: number) => base.setTimeout(fn, ms) };
      const ended: HoldSummary[] = [];
      const h = new InputHold({ clock, manual: false, silenceMs: 500, send: () => {}, began: () => {}, ended: (s) => ended.push(s) });
      h.voiceActivity('ACTIVITY_END');
      h.output(1_000);
      base.advance(500);
      offset = 3_600_000;
      h.output(1_000);
      // The 2 s of audio received plus the margin, from the second part: an hour's step back adds nothing.
      base.advance(2_000 + HOLD_MARGIN_MS - 1);
      expect(ended).toEqual([]);
      base.advance(1);
      expect(ended.map((s) => s.reason)).toEqual(['cap']);
      expect(timers()).toBe(0);
    });
  });

  it("withdraws a held send and the audio held after it — a voiceless press's — keeping a held send that follows, and says so; false once it has gone (choice 7)", () => {
    const { h, log, action, ended, sent } = hold({ manual: true });
    h.begin('activity_end');
    const press = action('press starts');
    h.audio(pcm(2_400));
    action('typed text');
    h.audio(pcm(2_400));
    expect(h.holds(press)).toBe(true);
    expect(h.withdraw(press)).toBe(true);
    expect(h.holds(press)).toBe(false);
    h.turnComplete();
    expect(log).toEqual(['began activity_end', 'ended turn_complete', 'typed text']);
    expect(sent).toEqual([]);
    expect(ended).toEqual([{ reason: 'turn_complete', heldMs: 0, audioMs: 0, actions: 1, withdrawn: 1, playbackEndMs: null }]);
    expect(h.withdraw(press)).toBe(false);

    const gone = hold({ manual: true });
    gone.h.begin('activity_end');
    const sentPress = gone.action('press starts');
    gone.h.turnComplete();
    expect(gone.h.holds(sentPress)).toBe(false);
    expect(gone.h.holds(null)).toBe(false);
    expect(gone.h.withdraw(sentPress)).toBe(false);
  });

  it("a lost connection carries what is held, and what comes before the next connection is set up, with no cap meanwhile; that setup lets it all go, in order, said as carried (choice 10)", () => {
    const { h, clock, log, action, ended, timers } = hold();
    h.voiceActivity('ACTIVITY_START');
    h.voiceActivity('ACTIVITY_END');
    h.output(1_000);
    h.audio(pcm(2_400, 1));
    action('typed text');
    h.carry();
    expect(h.holding).toBe(true);
    expect(timers()).toBe(0);
    // Past both caps: nothing lets go while there is no connection.
    clock.advance(HOLD_IDLE_MS + HOLD_MARGIN_MS);
    h.audio(pcm(2_400, 2));
    expect(ended).toEqual([]);
    h.reconnected();
    expect(log).toEqual(['began voice_activity', 'ended reconnect', 'audio 1,1,1,1 ×2400', 'typed text', 'audio 2,2,2,2 ×2400']);
    expect(ended).toEqual([{ reason: 'reconnect', heldMs: HOLD_IDLE_MS + HOLD_MARGIN_MS, audioMs: 200, actions: 1, withdrawn: 0, playbackEndMs: null, carried: true }]);
    expect(h.holding).toBe(false);
    expect(timers()).toBe(0);
    // Nothing carried, nothing to let go.
    h.reconnected();
    expect(ended).toHaveLength(1);
  });

  it("under automatic turns a carried hold keeps at most 5 s of the gap's audio — its first, a chunk straddling the bound trimmed — and says what it dropped; what it held before the loss, and its held sends, are kept whole (choice 10)", () => {
    const { h, log, action, ended, sent } = hold();
    h.voiceActivity('ACTIVITY_END');
    // 3 s held before the loss: never bounded.
    h.audio(pcm(72_000, 1));
    h.carry();
    // 8 s of the gap, in 2 s chunks, then text: 5 s kept (2 + 2 + 1 of the third), 3 s dropped (1 of the third, and the fourth whole).
    for (const fill of [2, 3, 4, 5]) h.audio(pcm(48_000, fill));
    action('typed text');
    h.reconnected();
    expect(log.slice(2)).toEqual(['audio 1,1,1,1 ×192000', 'typed text']);
    expect(sent[0].length).toBe(72_000 + (HOLD_CARRY_MS * 24_000) / 1000);
    expect(Array.from(sent[0].subarray(191_998))).toEqual([4, 4]);
    expect(ended).toEqual([{ reason: 'reconnect', heldMs: 0, audioMs: 8_000, actions: 1, withdrawn: 0, playbackEndMs: null, carried: true, droppedMs: 3_000 }]);
  });

  it('under manual turns a carried hold keeps all of the gap: the presses bound it, and says nothing dropped (choice 10)', () => {
    const { h, ended, sent } = hold({ manual: true });
    h.begin('activity_end');
    h.carry();
    for (let i = 0; i < 4; i++) h.audio(pcm(48_000));
    h.reconnected();
    expect(sent.map((p) => p.length)).toEqual([192_000]);
    expect(ended).toEqual([{ reason: 'reconnect', heldMs: 0, audioMs: 8_000, actions: 0, withdrawn: 0, playbackEndMs: null, carried: true }]);
  });

  it("a lost connection forgets the old session's speaking state and model turn, but not that the model sends voice activity: the input fallback stays off, the output one is armed (choices 2, 10)", () => {
    // A fresh hold, never told of voice activity, falls back to a transcription again after a lost connection.
    const fresh = hold();
    fresh.h.input();
    fresh.h.carry();
    fresh.h.reconnected();
    fresh.h.input();
    expect(fresh.began).toEqual(['input_transcription', 'input_transcription']);

    // One that has heard it does not, across the loss; the user left speaking on the old session speaks on no new one.
    const heard = hold();
    heard.h.voiceActivity('ACTIVITY_START');
    heard.h.carry();
    heard.h.reconnected();
    heard.h.input();
    expect(heard.began).toEqual([]);
    heard.h.output();
    expect(heard.began).toEqual(['model_output']);
  });

  it('cancel drops what is held and says nothing: nothing goes up after it, and no timer is left (choice 11)', () => {
    const { h, clock, log, action, ended, sent, timers } = hold();
    h.begin('voice_activity');
    h.audio(pcm(2_400));
    action('typed text');
    h.cancel();
    expect(timers()).toBe(0);
    clock.advance(HOLD_IDLE_MS);
    h.turnComplete();
    expect([sent, ended]).toEqual([[], []]);
    expect(log).toEqual(['began voice_activity']);
  });

  describe('a new start, and one utterance per release (choice 14)', () => {
    it('an ACTIVITY_START during a hold lets it go at once: the server is hearing speech that went up before the hold, and must hear its end', () => {
      const { h, clock, sent, began, ended, timers } = hold();
      // Batch 2, 3.8 at a 1 100 ms pause under the first rule: a hold begun on an ACTIVITY_END that lagged a released
      // burst, and the next utterance's ACTIVITY_START 10 ms later — then held to the idle cap. Now let go at once.
      h.voiceActivity('ACTIVITY_START');
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(100));
      clock.advance(10);
      h.voiceActivity('ACTIVITY_START');
      expect(ended).toEqual([{ reason: 'voice_activity_start', heldMs: 10, audioMs: 100, actions: 0, withdrawn: 0, playbackEndMs: null }]);
      expect(sent.map((p) => p.length)).toEqual([2_400]);
      expect(h.holding).toBe(false);
      expect(timers()).toBe(0);
      // Live until the server closes that utterance.
      h.voiceActivity('ACTIVITY_END');
      expect(began).toEqual(['voice_activity', 'voice_activity']);
    });

    it('under manual turns an ACTIVITY_START lets nothing go: the server only mirrors the leg\'s own marks (choice 3)', () => {
      const { h, sent } = hold({ manual: true });
      h.begin('activity_end');
      h.audio(tone(100));
      h.voiceActivity('ACTIVITY_START');
      expect(h.holding).toBe(true);
      expect(sent).toEqual([]);
    });

    it('an ACTIVITY_START between interrupted and the turnComplete that trails it lets go at that turnComplete: nothing held goes between the two (choice 4)', () => {
      const { h, log, action, sent } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(100));
      action('typed text');
      // 3 of the multi batches' 53 interrupts reached the client before the ACTIVITY_START that set them off.
      h.interrupted();
      h.voiceActivity('ACTIVITY_START');
      expect(h.holding).toBe(true);
      expect(sent).toEqual([]);
      h.turnComplete();
      expect(log).toEqual(['began voice_activity', 'ended voice_activity_start', 'audio 1000,1000,1000,1000 ×2400', 'typed text']);
      expect(h.holding).toBe(false);
      // That end is over: the next hold's START lets it go at once again.
      h.voiceActivity('ACTIVITY_END');
      h.voiceActivity('ACTIVITY_START');
      expect(h.holding).toBe(false);
    });

    it("a release lets one utterance go — the held audio up to the first pause after speech of 600 ms, at the default silence — and holds the next onset, and what comes, until the server's ACTIVITY_END for what went up, then to that answer's turnComplete", () => {
      const { h, clock, sent, began, ended, timers } = hold();
      h.voiceActivity('ACTIVITY_START');
      h.voiceActivity('ACTIVITY_END');
      // Held while the answer plays: the end of one utterance, a pause, the next one's onset.
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      h.output(1_000);
      clock.advance(1_000);
      h.turnComplete();
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000]]);
      expect(ended).toEqual([{ reason: 'turn_complete', heldMs: 1_000, audioMs: 1_300, actions: 0, withdrawn: 0, playbackEndMs: 1_000, keptMs: 300 }]);
      expect(began).toEqual(['voice_activity', 'split']);
      h.audio(tone(200, 3_000));
      // The utterance that went up opens and closes at the server: its START is expected, its END awaited — neither
      // lets go, nor begins another hold.
      h.voiceActivity('ACTIVITY_START');
      clock.advance(900);
      h.voiceActivity('ACTIVITY_END');
      expect(began).toEqual(['voice_activity', 'split']);
      clock.advance(SPLIT_END_MS);
      expect(h.holding).toBe(true);
      h.output(500);
      clock.advance(500);
      h.turnComplete();
      expect(ended[1]).toEqual({ reason: 'turn_complete', heldMs: 1_400 + SPLIT_END_MS, audioMs: 500, actions: 0, withdrawn: 0, playbackEndMs: 1_400 + SPLIT_END_MS });
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000], [2_000, 12_000]]);
      expect(h.holding).toBe(false);
      expect(timers()).toBe(0);
    });

    it("with no ACTIVITY_END within its wait, a split's hold lets all the rest go, pauses and all: that pause closed no turn; the late END begins a hold of its own, which the next START lets go", () => {
      const { h, clock, sent, began, ended, timers } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      h.turnComplete();
      h.audio(tone(100, 3_000));
      h.audio(hush(700));
      h.audio(tone(100, 4_000));
      clock.advance(SPLIT_END_MS - 1);
      expect(h.holding).toBe(true);
      clock.advance(1);
      expect(ended[1]).toEqual({ reason: 'split_timeout', heldMs: SPLIT_END_MS, audioMs: 1_200, actions: 0, withdrawn: 0, playbackEndMs: null });
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000], [2_000, 28_800]]);
      // An END after the wait has run out — 70 ms, and the next utterance's START 89 ms after it: the shape batch 2's 3.1
      // monologue showed twice at a 1.5 s wait.
      clock.advance(70);
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(100));
      clock.advance(89);
      h.voiceActivity('ACTIVITY_START');
      expect(began).toEqual(['voice_activity', 'split', 'voice_activity']);
      expect(ended.map((s) => s.reason)).toEqual(['turn_complete', 'split_timeout', 'voice_activity_start']);
      expect(timers()).toBe(0);
    });

    it("the split's pause follows the session's end-of-speech silence: 100 ms past it, never under 200 ms (choice 15)", () => {
      expect([50, 500, 1_500].map(splitPauseMs)).toEqual([200, 600, 1_600]);
      // A 700 ms pause: a close at the default silence, 500 ms, and so a split; not one at 1 500 ms.
      const held = (t: ReturnType<typeof hold>) => {
        t.h.voiceActivity('ACTIVITY_END');
        t.h.audio(tone(300));
        t.h.audio(hush(700));
        t.h.audio(tone(300, 2_000));
        t.h.turnComplete();
      };
      const slow = hold({ silenceMs: 1_500 });
      held(slow);
      expect(slow.sent.map((p) => p.length)).toEqual([31_200]);
      expect(slow.began).toEqual(['voice_activity']);
      const usual = hold({ silenceMs: 500 });
      held(usual);
      expect(usual.sent.map((p) => p.length)).toEqual([24_000]);
      expect(usual.began).toEqual(['voice_activity', 'split']);
    });

    it("the split's wait grows with what it let go — half as long as that audio plays, when that is past 2 s: an 8.8 s utterance waits 4.4 s, and its END at 3.9 s is consumed", () => {
      const t = hold();
      t.h.voiceActivity('ACTIVITY_END');
      t.h.audio(tone(8_100));
      t.h.audio(hush(700));
      t.h.audio(tone(300, 2_000));
      t.h.turnComplete();
      expect(t.ended[0]).toMatchObject({ audioMs: 9_100, keptMs: 300 });
      t.clock.advance(3_900);
      t.h.voiceActivity('ACTIVITY_END');
      t.clock.advance(1_000);
      expect(t.h.holding).toBe(true);
      expect(t.ended).toHaveLength(1);
      // Without that END the wait runs out at 4.4 s, not 2 s.
      const u = hold();
      u.h.voiceActivity('ACTIVITY_END');
      u.h.audio(tone(8_100));
      u.h.audio(hush(700));
      u.h.audio(tone(300, 2_000));
      u.h.turnComplete();
      u.clock.advance(4_399);
      expect(u.h.holding).toBe(true);
      u.clock.advance(1);
      expect(u.ended[1]).toMatchObject({ reason: 'split_timeout', heldMs: 4_400 });
    });

    it("after a split's END a START lets its hold go, as any START does: that utterance is closed, and the START is a new one", () => {
      const { h, clock, sent, began, ended, timers } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      h.turnComplete();
      h.voiceActivity('ACTIVITY_START');
      clock.advance(900);
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(100, 3_000));
      clock.advance(100);
      h.voiceActivity('ACTIVITY_START');
      expect(ended.map((e) => e.reason)).toEqual(['turn_complete', 'voice_activity_start']);
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000], [2_000, 9_600]]);
      expect(began).toEqual(['voice_activity', 'split']);
      expect(timers()).toBe(0);
    });

    it('content after an interrupted ends its wait for the trailing turnComplete: a START during a hold then lets it go at once (choice 4)', () => {
      for (const content of ['output', 'input'] as const) {
        const { h, ended } = hold();
        h.voiceActivity('ACTIVITY_END');
        // No turnComplete follows this one.
        h.interrupted();
        if (content === 'output') h.output();
        else h.input();
        h.audio(tone(100));
        h.voiceActivity('ACTIVITY_START');
        expect(ended.map((e) => e.reason)).toEqual(['voice_activity_start']);
      }
    });

    it("waitingForInput ends the model's turn before it lets go: a split's hold arms its cap from a fresh turn, not the last answer's audio (choice 4)", () => {
      const { h, clock, ended } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.output(1_000);
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      clock.advance(500);
      h.waitingForInput();
      h.voiceActivity('ACTIVITY_END');
      // The last answer's 1 s would cap it 2.5 s from here; a fresh turn has no audio, so the idle cap.
      clock.advance(1_000 + HOLD_MARGIN_MS);
      expect(h.holding).toBe(true);
      clock.advance(HOLD_IDLE_MS - 1_000 - HOLD_MARGIN_MS);
      expect(ended.map((e) => [e.reason, e.playbackEndMs])).toEqual([['waiting_for_input', 1_000], ['idle', null]]);
    });

    it('held audio that ends in such a pause goes up whole, and the leg holds on the same way: speech right after it waits', () => {
      const { h, sent, began, ended } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      h.audio(hush(700));
      h.turnComplete();
      expect(sent.map((p) => p.length)).toEqual([24_000]);
      expect(ended[0].keptMs).toBe(0);
      expect(began).toEqual(['voice_activity', 'split']);
      h.audio(tone(100));
      expect(sent).toHaveLength(1);
    });

    it('no pause of 600 ms after speech, or none after any speech, and the release lets all go as one frame', () => {
      const cases: Array<[Int16Array[], number[]]> = [
        [[tone(300), hush(590), tone(300)], [28_560]],
        [[hush(700), tone(300)], [24_000]],
        [[hush(700)], [16_800]],
        [[tone(300), hush(600), tone(300)], [21_600]],
      ];
      for (const [parts, lengths] of cases) {
        const t = hold();
        t.h.voiceActivity('ACTIVITY_END');
        for (const p of parts) t.h.audio(p);
        t.h.turnComplete();
        expect(t.sent.map((p) => p.length)).toEqual(lengths);
      }
    });

    it('a held send made before the pause goes with its utterance; one made after it waits with the next (choice 8)', () => {
      const { h, log, action } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      action('text 1');
      h.audio(tone(100));
      h.audio(hush(700));
      action('text 2');
      h.audio(tone(300, 2_000));
      h.turnComplete();
      expect(log).toEqual(['began voice_activity', 'ended turn_complete', 'audio 1000,1000,1000,1000 ×7200', 'text 1', 'audio 1000,1000,1000,1000 ×19200', 'began split']);
      h.voiceActivity('ACTIVITY_END');
      h.turnComplete();
      expect(log.slice(6)).toEqual(['ended turn_complete', 'text 2', 'audio 2000,2000,2000,2000 ×7200']);
    });

    it('only automatic turns split, on a session that has heard voice activity, at turnComplete, waitingForInput or a reconnect; the cap and the idle cap let all go', () => {
      const held = (t: ReturnType<typeof hold>) => {
        t.h.audio(tone(300));
        t.h.audio(hush(700));
        t.h.audio(tone(300));
      };
      // Push-to-talk: the leg's own marks already end each utterance (choice 5) — whatever voice activity the server mirrors.
      const manual = hold({ manual: true });
      manual.h.voiceActivity('ACTIVITY_START');
      manual.h.voiceActivity('ACTIVITY_END');
      manual.h.begin('activity_end');
      held(manual);
      manual.h.turnComplete();
      // A model that sends no voice activity sends no ACTIVITY_END for a split to wait for.
      const unheard = hold();
      unheard.h.output();
      held(unheard);
      unheard.h.turnComplete();
      const cap = hold();
      cap.h.voiceActivity('ACTIVITY_END');
      held(cap);
      cap.h.output(100);
      cap.clock.advance(100 + HOLD_MARGIN_MS);
      const idle = hold();
      idle.h.voiceActivity('ACTIVITY_END');
      held(idle);
      idle.clock.advance(HOLD_IDLE_MS);
      for (const t of [manual, unheard, cap, idle]) {
        expect(t.sent.map((p) => p.length)).toEqual([31_200]);
        expect(t.h.holding).toBe(false);
      }
      const waiting = hold();
      waiting.h.voiceActivity('ACTIVITY_END');
      held(waiting);
      waiting.h.waitingForInput();
      const reconnect = hold();
      reconnect.h.voiceActivity('ACTIVITY_END');
      held(reconnect);
      reconnect.h.carry();
      reconnect.h.reconnected();
      for (const t of [waiting, reconnect]) {
        expect(t.sent.map((p) => p.length)).toEqual([24_000]);
        expect(t.began).toEqual(['voice_activity', 'split']);
      }
    });

    it("a lost connection ends a split's wait — no timer runs while carried — and the new connection's release splits again; a stop leaves no timer (choices 10, 11)", () => {
      const { h, clock, sent, began, ended, timers } = hold();
      h.voiceActivity('ACTIVITY_END');
      h.audio(tone(300));
      h.audio(hush(700));
      h.audio(tone(300, 2_000));
      h.turnComplete();
      h.carry();
      expect(timers()).toBe(0);
      clock.advance(SPLIT_END_MS + HOLD_IDLE_MS);
      expect(h.holding).toBe(true);
      // The gap: the held onset's utterance ends, a pause, the next one starts.
      h.audio(hush(700));
      h.audio(tone(100, 3_000));
      h.reconnected();
      expect(ended[1]).toEqual({ reason: 'reconnect', heldMs: SPLIT_END_MS + HOLD_IDLE_MS, audioMs: 1_100, actions: 0, withdrawn: 0, playbackEndMs: null, carried: true, keptMs: 100 });
      expect(sent.map((p) => [p[0], p.length])).toEqual([[1_000, 24_000], [2_000, 24_000]]);
      expect(began).toEqual(['voice_activity', 'split', 'split']);
      expect(timers()).toBe(2);
      h.cancel();
      expect(timers()).toBe(0);
      clock.advance(SPLIT_END_MS);
      expect(sent).toHaveLength(2);
    });

    it('the gate: speech is a 10 ms frame above a tenth of the held audio\'s loudest, its frames running across chunks of any size (choice 15)', () => {
      // A voice at 1 000, a floor between at 100 (a tenth: a pause) or 101 (speech: no pause), in 128-sample chunks —
      // an AudioWorklet's render quantum, smaller than a frame.
      const run = (floor: number) => {
        const t = hold();
        t.h.voiceActivity('ACTIVITY_END');
        const stream = new Int16Array(31_200);
        stream.fill(1_000, 0, 7_200);
        stream.fill(floor, 7_200, 24_000);
        stream.fill(1_000, 24_000);
        for (let i = 0; i < stream.length; i += 128) t.h.audio(stream.slice(i, i + 128));
        t.h.turnComplete();
        return t;
      };
      const pause = run(100);
      // The onset's first frame begins in the chunk from sample 23 936: that chunk, and what follows, stays held.
      expect(pause.sent.map((p) => p.length)).toEqual([23_936]);
      expect(pause.ended[0].keptMs).toBe(303);
      expect(run(101).sent.map((p) => p.length)).toEqual([31_200]);
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini/hold.test.ts`
Expected: FAIL — the file does not load: `Failed to resolve import "./hold"`.

- [ ] **Step 3: Write the hold**, `src/providers/gemini/hold.ts` (rulings 1, 3, 4; choices 2–7, 10, 11, 14, 15):

```ts
/**
 * A 3.x dialogue model's input, held while the model's turn runs (Gemini
 * hold, ruling 1). Such a model barges in (Gemini/AST2 follow-up, ruling 5),
 * and its turn lasts until its `turnComplete`, which the server paces to a
 * simulated real-time playback of the answer: its `generationComplete`
 * comes 3–4 s earlier. Input that reaches it inside that turn cuts the
 * answer, or is heard without its start (the owner's probes). So once the
 * user's turn has closed, what the leg would send — audio, a press's
 * activity marks, typed text — is held here, in order, and let go at the
 * model's `turnComplete`: each unbroken run of audio as one frame, each
 * held send in its place (choice 5).
 *
 * What begins a hold: under automatic turns the server's `voiceActivity`
 * ACTIVITY_END, or else a model turn's first model output — or its first
 * input transcription, on a session that has heard no voice activity —
 * while the server has not said the user is speaking (choice 2); under
 * manual turns the leg's own `activityEnd`, which the adapter reports
 * (choice 3). What ends it: `turnComplete` or `waitingForInput` (choice 4);
 * the cap — the model's computed playback end plus `HOLD_MARGIN_MS`, or
 * `HOLD_IDLE_MS` with no model audio at all — which lets go of what it
 * holds, never drops it (ruling 3; choice 6); a lost connection carries it
 * over — with at most `HOLD_CARRY_MS` of the gap's own audio under
 * automatic turns — and the next connection's setup lets it go (choice 10);
 * the session's end drops it, silently (choice 11). Under automatic turns
 * two more rules (Gemini hold, ruling 4): an ACTIVITY_START during a hold
 * lets it go at once, and a release lets one utterance go — up to the first
 * pause after speech a little longer than the session's own end-of-speech
 * silence — holding the rest until the server has closed that one and
 * answered it (choices 14, 15). Pure: a clock and three callbacks — the
 * adapter sends and frames.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';

/** Past the model's computed playback end, a hold whose `turnComplete` has not come lets go after this much more (Gemini hold, ruling 3). */
export const HOLD_MARGIN_MS = 2_000;
/** With no model audio since the hold began, it lets go this long after it began: a model that declines to answer, or a stall (Gemini hold, ruling 3). */
export const HOLD_IDLE_MS = 10_000;
/** Under automatic turns, at most this much of a reconnect gap's audio is carried: the gap's first; later gap audio is dropped, as outside a hold (choice 10). */
export const HOLD_CARRY_MS = 5_000;
/** Under automatic turns a release lets the held audio go up to the first pause after speech at least this much longer than the session's end-of-speech silence: one utterance (Gemini hold, ruling 4; choice 15). */
export const SPLIT_PAUSE_MARGIN_MS = 100;
/** …and never shorter than this, so that the gaps between words never split (choice 15). */
export const SPLIT_PAUSE_FLOOR_MS = 200;
/** The hold such a release begins waits at least this long for the server's ACTIVITY_END for what went up, then lets the rest go: that pause closed no turn (Gemini hold, ruling 4; choice 14). */
export const SPLIT_END_MS = 2_000;
/** The pause's gate reads the held audio in frames this long (choice 15). */
export const GATE_FRAME_MS = 10;
/** A frame is speech when its RMS is above the held audio's loudest frame's divided by this: 20 dB under it (choice 15). */
export const GATE_PEAK_DIVISOR = 10;
const CARRY_SAMPLES = (HOLD_CARRY_MS * SAMPLE_RATE) / 1000;
const GATE_FRAME = (GATE_FRAME_MS * SAMPLE_RATE) / 1000;

/** The split's pause for a session whose server closes a turn after `silenceMs` of silence: at the default 500, 600 (choice 15). */
export function splitPauseMs(silenceMs: number): number {
  return Math.max(SPLIT_PAUSE_FLOOR_MS, silenceMs + SPLIT_PAUSE_MARGIN_MS);
}

/**
 * What began a hold: the server's `voiceActivity` ACTIVITY_END, the first
 * input transcription or model output of a model turn (automatic turns),
 * the leg's own `activityEnd` (manual turns), or a release that let one
 * utterance go and holds the rest (`split`, automatic turns).
 */
export type HoldCause = 'voice_activity' | 'input_transcription' | 'model_output' | 'activity_end' | 'split';
/**
 * What ended it: the model's turn or its wait for input; the cap past the computed playback end, or with no model
 * audio; the next connection's setup, after a lost one; an ACTIVITY_START; a split's wait for its ACTIVITY_END run out.
 */
export type HoldEnd = 'turn_complete' | 'waiting_for_input' | 'cap' | 'idle' | 'reconnect' | 'voice_activity_start' | 'split_timeout';

/** What one hold did, for the Logs (`turn.hold_end`): what the live test reads the cap's constants by. */
export interface HoldSummary {
  reason: HoldEnd;
  /** From its begin to its end. */
  heldMs: number;
  /** The microphone audio it held when it let go: what went up as one frame per unbroken run, or kept by a split. */
  audioMs: number;
  /** The held sends — a press's marks, typed text — it held when it let go. */
  actions: number;
  /** Presses released without voice while their `activityStart` was still held: withdrawn, never sent (choice 7). */
  withdrawn: number;
  /** The model's computed playback end — its first audio's arrival plus all its audio — from the hold's begin; null with no model audio. */
  playbackEndMs: number | null;
  /** It was carried across a lost connection and let go on the next one (choice 10). */
  carried?: true;
  /** The gap's audio dropped past `HOLD_CARRY_MS` while carried, under automatic turns (choice 10); absent when none was. */
  droppedMs?: number;
  /** Of `audioMs`, what a split kept held, from the next utterance's onset: 0 when the held audio ended in the pause; absent when the release let all go (choice 14). */
  keptMs?: number;
}

/** A held send: run in its place when the hold lets go. The adapter may withdraw it while it is still held. */
export interface HeldAction {
  readonly run: () => void;
}

type HeldAudio = { readonly pcm: Int16Array };
type Entry = HeldAudio | HeldAction;

export type InputHoldOptions = {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  /** Sends one unbroken run of held audio up, as one frame. */
  send(pcm: Int16Array): void;
  began(cause: HoldCause): void;
  /** Before what it held goes up; never on `cancel`. */
  ended(summary: HoldSummary): void;
} & (
  /** Manual turns: only the leg's own `activityEnd` begins a hold; the server's signals begin none, and nothing splits (choices 3, 14). */
  | { manual: true }
  /** Automatic turns: the session's end-of-speech silence (`activity.silenceMs`), which the split's pause follows (choice 15). */
  | { manual: false; silenceMs: number }
);

interface Run {
  cause: HoldCause;
  beganAt: number;
  withdrawn: number;
  /** A lost connection carries it to the next one: no cap runs until that one is set up (choice 10). */
  carried: boolean;
  /** The gap's audio kept while carried, and dropped past `HOLD_CARRY_MS`, in samples (choice 10). */
  gapKept: number;
  gapDropped: number;
  stop: () => void;
  /** A split's hold waits for the server's ACTIVITY_END for what went up: this stops that wait. While it runs, a START is that utterance's own (choice 14). */
  awaiting: (() => void) | null;
  /** An ACTIVITY_START came between `interrupted` and the `turnComplete` that trails it: it lets go there (choices 4, 14). */
  startWaits: boolean;
}

/** A release: the entries a split kept held (none kept is an empty list), or null when it let all go; and how much audio it let go, in ms. */
type Release = { kept: Entry[] | null; sentMs: number };

/** Each unbroken run of audio as one frame (choice 5). */
function join(run: readonly HeldAudio[]): Int16Array {
  if (run.length === 1) return run[0].pcm;
  let length = 0;
  for (const e of run) length += e.pcm.length;
  const out = new Int16Array(length);
  let at = 0;
  for (const e of run) {
    out.set(e.pcm, at);
    at += e.pcm.length;
  }
  return out;
}

function samplesIn(entries: readonly Entry[]): number {
  let samples = 0;
  for (const e of entries) if ('pcm' in e) samples += e.pcm.length;
  return samples;
}

const ms = (samples: number) => Math.round((samples * 1000) / SAMPLE_RATE);

export class InputHold {
  private run: Run | null = null;
  private readonly queue: Entry[] = [];
  /** The server said the user is speaking: an ACTIVITY_START with no ACTIVITY_END yet. */
  private speaking = false;
  /**
   * The session has heard voice activity: its model marks the user's turns itself, so an input transcription is no
   * turn close — the 3.x models send it while the activity is still open, and one that comes later is late
   * (choice 2) — and a split has an ACTIVITY_END to wait for (choice 14). A property of the model, kept across a lost
   * connection.
   */
  private heard = false;
  /** A transcription or an output may begin a hold: none has begun since the model's last turn ended (choice 2). */
  private armed = true;
  /** This model turn's audio: when its first part arrived, and how long all of it plays (choice 6). */
  private firstAudioAt: number | null = null;
  private answerMs = 0;
  /** An `interrupted` has come, and neither the `turnComplete` that trails it nor any content since (choice 4). */
  private cut = false;
  /** The split's pause; null under manual turns, which never split (choice 15). */
  private readonly pauseMs: number | null;

  constructor(private readonly o: InputHoldOptions) {
    this.pauseMs = o.manual ? null : splitPauseMs(o.silenceMs);
  }

  get holding(): boolean {
    return this.run !== null;
  }

  /**
   * The server's voice activity. ACTIVITY_END is the user's turn closing (choice 2) — or, on a split's hold, the close
   * it waits for. Under automatic turns an ACTIVITY_START during a hold lets it go: nothing goes up while one is on,
   * so the server is hearing speech that went up before it, and must hear its end — unless it is a split's hold still
   * waiting for its END, whose own utterance's START is expected (choice 14).
   */
  voiceActivity(type: string | undefined): void {
    this.heard = true;
    const run = this.run;
    if (type === 'ACTIVITY_START') {
      this.speaking = true;
      if (!run || this.o.manual || run.awaiting) return;
      // Between `interrupted` and the `turnComplete` that trails it, a held send would split that end in two: it lets go there (choice 4).
      if (this.cut) run.startWaits = true;
      else this.letGo(this.finish('voice_activity_start'));
      return;
    }
    if (type !== 'ACTIVITY_END') return;
    this.speaking = false;
    if (this.o.manual) return;
    if (run?.awaiting) {
      // What the split let go is closed: the hold now runs to its answer's `turnComplete`, as any hold does.
      run.awaiting();
      run.awaiting = null;
      return;
    }
    this.begin('voice_activity');
  }

  /** An input transcription with text: a turn close only on a session that has heard no voice activity (choice 2). */
  input(): void {
    // Content: the `interrupted` is behind it, as `GeminiTurns` reads it (choice 4).
    this.cut = false;
    if (!this.heard) this.fallback('input_transcription');
  }

  /**
   * Model output — an output transcription, a model part — and how much of it is audio, in ms. `content` is false for
   * a part `GeminiTurns` takes as none — audio at a rate it does not play: the cap still counts that audio (choice 6),
   * but it neither ends an `interrupted`'s wait nor begins a hold (choices 2, 4).
   */
  output(audioMs = 0, content = true): void {
    if (content) this.cut = false;
    if (audioMs > 0) {
      if (this.firstAudioAt === null) this.firstAudioAt = this.o.clock.now();
      this.answerMs += audioMs;
      // Recomputed as the audio arrives (ruling 3; choice 6).
      if (this.run) this.arm();
    }
    if (content) this.fallback('model_output');
  }

  /** The model's turn was cut. A hold goes on to the `turnComplete` that trails it (choice 4). */
  interrupted(): void {
    this.cut = true;
    this.newTurn();
  }

  /** The model's turn ended: what is held goes up, after the adapter has ended the turn (choice 4). */
  turnComplete(): void {
    this.cut = false;
    const release = this.finish(this.run?.startWaits ? 'voice_activity_start' : 'turn_complete');
    this.newTurn();
    this.letGo(release);
  }

  /**
   * The model is not generating: it waits for the user, its turn over (choice 4). Not while a split's hold awaits its
   * END: that split was just released — by a `turnComplete` in the same message, say — its END is still to come, and
   * its own wait bounds it (choice 14).
   */
  waitingForInput(): void {
    if (this.run?.awaiting) return;
    const release = this.finish('waiting_for_input');
    this.newTurn();
    this.letGo(release);
  }

  /** Begins a hold, unless one is on. The adapter's own `activityEnd` comes here (choice 3). */
  begin(cause: HoldCause): void {
    if (this.run) return;
    this.armed = false;
    this.run = {
      cause,
      beganAt: this.o.clock.now(),
      withdrawn: 0,
      carried: false,
      gapKept: 0,
      gapDropped: 0,
      stop: () => {},
      awaiting: null,
      startWaits: false,
    };
    this.arm();
    this.o.began(cause);
  }

  /**
   * Held, as a copy: the capture may reuse its buffer. Only while holding. Carried across a lost connection under
   * automatic turns, the gap's audio is kept up to `HOLD_CARRY_MS` — its first, the start of what is being said —
   * and dropped past it, as outside a hold; under manual turns the presses bound it (choice 10).
   */
  audio(pcm: Int16Array): void {
    const run = this.run;
    if (!run) return;
    let kept = pcm;
    if (run.carried && !this.o.manual) {
      const room = Math.max(0, CARRY_SAMPLES - run.gapKept);
      if (kept.length > room) kept = kept.subarray(0, room);
      run.gapKept += kept.length;
      run.gapDropped += pcm.length - kept.length;
      if (kept.length === 0) return;
    }
    this.queue.push({ pcm: kept.slice() });
  }

  /** A send held in its place. Only while holding. */
  defer(run: () => void): HeldAction {
    const action: HeldAction = { run };
    if (this.run) this.queue.push(action);
    return action;
  }

  /** The held send is still held: not yet gone out, nor withdrawn. */
  holds(action: HeldAction | null): boolean {
    return action !== null && this.queue.includes(action);
  }

  /**
   * A press released without voice while its `activityStart` is still held
   * never reached the server: that action goes, with every audio entry held
   * after it — the press's own, since audio comes only while a key is held —
   * and nothing of them is sent (choice 7). False when it has gone out.
   */
  withdraw(action: HeldAction): boolean {
    const at = this.queue.indexOf(action);
    if (at < 0) return false;
    const kept = this.queue.slice(at + 1).filter((e) => !('pcm' in e));
    this.queue.splice(at, this.queue.length - at, ...kept);
    if (this.run) this.run.withdrawn += 1;
    return true;
  }

  /**
   * A lost connection (choice 10): a hold goes on — it keeps what it held and what comes before the next connection
   * is set up — with no cap, since no model turn can end on a connection that is gone, and no split's wait, since no
   * ACTIVITY_END can come on it (choice 14). The server's speaking state and the model turn were the old session's.
   */
  carry(): void {
    this.speaking = false;
    this.cut = false;
    this.newTurn();
    const run = this.run;
    if (!run) return;
    run.stop();
    run.stop = () => {};
    run.awaiting?.();
    run.awaiting = null;
    run.startWaits = false;
    run.carried = true;
  }

  /** The next connection is set up: a carried hold lets go at once — no model turn is in flight on it (choice 10). */
  reconnected(): void {
    if (this.run?.carried) this.letGo(this.finish('reconnect'));
  }

  /** The session ends: nothing more goes up, nothing is said, no timer is left (choice 11). */
  cancel(): void {
    const run = this.run;
    this.run = null;
    run?.stop();
    run?.awaiting?.();
    this.queue.length = 0;
  }

  private fallback(cause: HoldCause): void {
    if (this.o.manual || this.run || !this.armed || this.speaking) return;
    this.begin(cause);
  }

  private newTurn(): void {
    this.armed = true;
    this.firstAudioAt = null;
    this.answerMs = 0;
  }

  /**
   * The cap (ruling 3; choice 6): the model's computed playback end — its
   * first audio's arrival plus all the audio it sent — plus `HOLD_MARGIN_MS`;
   * `HOLD_IDLE_MS` from the begin while no model audio has come. Never
   * longer than the audio received plus the margin from now, so a wall
   * clock stepped back cannot stretch it.
   */
  private arm(): void {
    const run = this.run!;
    run.stop();
    const first = this.firstAudioAt;
    if (first === null) {
      run.stop = this.o.clock.setTimeout(() => this.letGo(this.finish('idle')), HOLD_IDLE_MS);
      return;
    }
    const most = this.answerMs + HOLD_MARGIN_MS;
    const delay = Math.max(0, Math.min(first + most - this.o.clock.now(), most));
    run.stop = this.o.clock.setTimeout(() => this.letGo(this.finish('cap')), delay);
  }

  /**
   * Ends the hold and says what it held; the caller lets it go. Under automatic turns, on a session that has heard
   * voice activity, a release at `turnComplete`, `waitingForInput` or a new connection lets one utterance go and keeps
   * the rest (choice 14); the cap, the idle cap, an ACTIVITY_START and a split's own wait let all go — each is there
   * so that nothing waits longer. Null when none was on.
   */
  private finish(reason: HoldEnd): Release | null {
    const run = this.run;
    if (!run) return null;
    this.run = null;
    run.stop();
    run.awaiting?.();
    let samples = 0;
    let actions = 0;
    for (const e of this.queue) {
      if ('pcm' in e) samples += e.pcm.length;
      else actions += 1;
    }
    const pauseMs = this.pauseMs;
    const splits = pauseMs !== null && this.heard && (reason === 'turn_complete' || reason === 'waiting_for_input' || reason === 'reconnect');
    const at = splits ? this.splitAt(pauseMs) : undefined;
    const kept = at === undefined ? null : this.queue.splice(at);
    const keptSamples = kept ? samplesIn(kept) : 0;
    this.o.ended({
      reason,
      heldMs: this.o.clock.now() - run.beganAt,
      audioMs: ms(samples),
      actions,
      withdrawn: run.withdrawn,
      playbackEndMs: this.firstAudioAt === null ? null : Math.round(this.firstAudioAt + this.answerMs - run.beganAt),
      ...(run.carried ? { carried: true as const } : {}),
      ...(run.gapDropped > 0 ? { droppedMs: ms(run.gapDropped) } : {}),
      ...(kept ? { keptMs: ms(keptSamples) } : {}),
    });
    return { kept, sentMs: ms(samples - keptSamples) };
  }

  /**
   * Where a release splits what is held (choice 14): at the first entry after a pause of at least `pauseMs`
   * that follows speech — the next utterance's audio, or a send held after the pause; the queue's end when the held
   * audio ends in such a pause; none without one. The gate (choice 15): `GATE_FRAME_MS` frames over the held audio as
   * one stream, whatever its chunks, each counted to the entry it begins in; speech above the loudest frame's RMS
   * divided by `GATE_PEAK_DIVISOR`. A held send breaks the stream.
   */
  private splitAt(pauseMs: number): number | undefined {
    const frames: Array<{ at: number; rms: number }> = [];
    let peak = 0;
    let sum = 0;
    let n = 0;
    let from = 0;
    this.queue.forEach((e, at) => {
      if (!('pcm' in e)) {
        frames.push({ at, rms: -1 });
        sum = 0;
        n = 0;
        return;
      }
      for (const s of e.pcm) {
        if (n === 0) from = at;
        sum += s * s;
        n += 1;
        if (n === GATE_FRAME) {
          const rms = Math.sqrt(sum / GATE_FRAME);
          peak = Math.max(peak, rms);
          frames.push({ at: from, rms });
          sum = 0;
          n = 0;
        }
      }
    });
    if (peak === 0) return undefined;
    let speech = false;
    let quiet = 0;
    for (const f of frames) {
      const paused = speech && quiet >= pauseMs;
      if (f.rms < 0) {
        if (paused) return f.at;
        continue;
      }
      if (f.rms > peak / GATE_PEAK_DIVISOR) {
        if (paused) return f.at;
        speech = true;
        quiet = 0;
      } else quiet += GATE_FRAME_MS;
    }
    return speech && quiet >= pauseMs ? this.queue.length : undefined;
  }

  /**
   * What a release let go goes up in order, until none is left or a held send begins a new hold, which keeps the rest
   * (choice 5). What a split kept stays held, in a hold of its own that waits for the server's ACTIVITY_END for what
   * went up: `SPLIT_END_MS`, or half as long as that audio plays when that is longer — the server reads a released
   * burst at about 2–4× real time, and its close comes later the more it has to read (choice 14).
   */
  private letGo(release: Release | null): void {
    if (!release) return;
    this.drain();
    if (!release.kept) return;
    this.queue.push(...release.kept);
    if (this.run) return;
    this.begin('split');
    const run = this.run!;
    run.awaiting = this.o.clock.setTimeout(() => {
      run.awaiting = null;
      this.letGo(this.finish('split_timeout'));
    }, Math.max(SPLIT_END_MS, Math.ceil(release.sentMs / 2)));
  }

  private drain(): void {
    while (this.queue.length > 0 && !this.run) {
      const head = this.queue[0];
      if ('pcm' in head) {
        let n = 1;
        while (n < this.queue.length && 'pcm' in this.queue[n]) n += 1;
        this.o.send(join(this.queue.splice(0, n) as HeldAudio[]));
        continue;
      }
      this.queue.shift();
      head.run();
    }
  }
}
```

- [ ] **Step 4: Run it.**

Run: `npx vitest run src/providers/gemini/hold.test.ts`
Expected: PASS — 1 file, 41 tests.

- [ ] **Step 5: The gates.** `npx vitest run src` (0 failed, no unhandled errors; in Wave 1 name any failure in Task 2's files) and the typecheck gate (the baseline). Nothing imports `hold.ts` yet, so no other suite can move.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/hold.ts src/providers/gemini/hold.test.ts
```

```bash
git commit -q -F - -- src/providers/gemini/hold.ts src/providers/gemini/hold.test.ts <<'EOF'
feat(gemini): a pure hold for a 3.x dialogue model's input

A 3.x model paces its turnComplete to a simulated playback of its answer,
and input inside that turn cuts the answer or loses its own start. The
hold keeps what the leg would send, in order, from the user's turn close
to turnComplete, then sends each unbroken run of audio as one frame and
each held send in its place. Its cap lets go 2 s past the model's
computed playback end, or 10 s after it began with no model audio, and
releases what it holds, never drops it. A lost connection carries it to
the next one, with at most 5 s of the gap's audio under automatic turns.
Under automatic turns a new ACTIVITY_START lets a hold go, and a release
lets one utterance go, up to its first pause 100 ms past the session's
own silence setting (an energy gate finds it), holding the rest until
the server has closed that one and answered it, or for at least 2 s
without the close, longer when more went up. Not wired yet.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: The server's voice activity and wait for input, read and framed (Wave 1)

**Files:**
- Modify: `src/providers/gemini/wire.ts` (`GeminiServerMessage`, `:108-117`), `src/providers/gemini/adapter.ts` (`onMessage`, `onContent`; `:232-282`)
- Test: `src/providers/gemini/testing.ts` (`SERVER`, `:59-69`), `src/providers/gemini/adapter.test.ts` (the frames case, `:353-380`)

**Interfaces:**
- Consumes: `decodeServerMessage` (landed: `JSON.parse`, no field list), the adapter's `frame`.
- Produces: `GeminiServerMessage.voiceActivity?: { type?: string; audioOffset?: string }`; `SERVER.generationComplete()`, `SERVER.waitingForInput()`, `SERVER.voiceActivity(type: 'ACTIVITY_START' | 'ACTIVITY_END', audioOffset = '0.000s')`; the frames `server.voice_activity` and `server_content.waiting_for_input`. No behaviour change. Tasks 3 and 4 build on all three files.

- [ ] **Step 1: Write the failing test** (choice 12): three server frames for the suites, and the frames case with the voice activity (a full one and an empty one) and the wait for input.

```diff
diff --git a/src/providers/gemini/testing.ts b/src/providers/gemini/testing.ts
--- a/src/providers/gemini/testing.ts
+++ b/src/providers/gemini/testing.ts
@@ -64,6 +64,10 @@
   audio: (samples = 2400, mimeType = 'audio/pcm;rate=24000') => serverFrame({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType, data: b64(samples) } }] } } }),
   turnComplete: () => serverFrame({ serverContent: { turnComplete: true } }),
   interrupted: () => serverFrame({ serverContent: { interrupted: true } }),
+  generationComplete: () => serverFrame({ serverContent: { generationComplete: true } }),
+  waitingForInput: () => serverFrame({ serverContent: { waitingForInput: true } }),
+  /** A message of its own, as the 3.x models send it: `{"voiceActivity":{"type":"ACTIVITY_END","audioOffset":"6.760s"}}`. */
+  voiceActivity: (type: 'ACTIVITY_START' | 'ACTIVITY_END', audioOffset = '0.000s') => serverFrame({ voiceActivity: { type, audioOffset } }),
   goAway: () => serverFrame({ goAway: { timeLeft: '50s' } }),
   handle: (newHandle: string, resumable = true) => serverFrame({ sessionResumptionUpdate: { newHandle, resumable } }),
 };
```

```diff
diff --git a/src/providers/gemini/adapter.test.ts b/src/providers/gemini/adapter.test.ts
--- a/src/providers/gemini/adapter.test.ts
+++ b/src/providers/gemini/adapter.test.ts
@@ -350,26 +350,33 @@
     expect(h.frames('server_content.model_turn')).toEqual([{ audioBytes: 0, text: 'Bonjour' }]);
   });
 
-  it('frames what the server says under domain.event names — never the audio, the key or a handle — and keeps a transcript language in the Logs (choices 13, 19)', async () => {
+  it('frames what the server says under domain.event names — never the audio, the key or a handle — and keeps a transcript language in the Logs (choices 13, 19; Gemini hold, choice 12)', async () => {
     const h = await liveGemini();
     h.socket().receive(serverFrame({ usageMetadata: { totalTokenCount: 12 } }));
     h.socket().receive(serverFrame({ toolCall: { functionCalls: [] } }));
     h.socket().receive(SERVER.handle('secret-handle-1'));
+    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END', '6.760s'));
+    h.socket().receive(serverFrame({ voiceActivity: {} }));
     h.socket().receive(serverFrame({ serverContent: { inputTranscription: { text: 'Hi', finished: true, languageCode: 'en-US' } } }));
     h.socket().receive(serverFrame({ serverContent: { generationComplete: true } }));
     h.socket().receive(SERVER.interrupted());
     h.socket().receive(serverFrame({ serverContent: { turnComplete: true, turnCompleteReason: 'NEED_MORE_INPUT' } }));
+    h.socket().receive(SERVER.waitingForInput());
     expect(h.of('frame').map((f) => `${f.payload.direction} ${f.payload.type}`)).toEqual([
       'out session.opened',
       'in server.setup_complete',
       'in server.usage_metadata',
       'in server.tool_call',
       'in server.session_resumption_update',
+      'in server.voice_activity',
+      'in server.voice_activity',
       'in server_content.input_transcription',
       'in server_content.generation_complete',
       'in server_content.interrupted',
       'in server_content.turn_complete',
+      'in server_content.waiting_for_input',
     ]);
+    expect(h.frames('server.voice_activity')).toEqual([{ type: 'ACTIVITY_END', audioOffset: '6.760s' }, {}]);
     expect(h.frames('server.session_resumption_update')).toEqual([{ resumable: true, hasHandle: true }]);
     expect(h.frames('server_content.input_transcription')).toEqual([{ text: 'Hi', finished: true, languageCode: 'en-US' }]);
     expect(h.frames('server_content.turn_complete')).toEqual([{ reason: 'NEED_MORE_INPUT' }]);
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/providers/gemini/adapter.test.ts`
Expected: FAIL — `1 failed | 61 passed (62)`: the frames case — the adapter frames no `server.voice_activity` and no `server_content.waiting_for_input`.

- [ ] **Step 3: Type the message, and frame both.**

```diff
diff --git a/src/providers/gemini/wire.ts b/src/providers/gemini/wire.ts
--- a/src/providers/gemini/wire.ts
+++ b/src/providers/gemini/wire.ts
@@ -114,6 +114,14 @@
   usageMetadata?: UsageMetadata;
   goAway?: LiveServerGoAway;
   sessionResumptionUpdate?: LiveServerSessionResumptionUpdate;
+  /**
+   * The server's voice activity, a message of its own: `type` as the wire
+   * spells it, which the SDK's own `VoiceActivity` renames
+   * `voiceActivityType` — so typed here, not taken from the SDK (Gemini
+   * hold, choice 12). The 3.x dialogue models send it under both turn
+   * modes; the 2.5 model sends none (the owner's probes).
+   */
+  voiceActivity?: { type?: string; audioOffset?: string };
 }
 
 const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';
```

```diff
diff --git a/src/providers/gemini/adapter.ts b/src/providers/gemini/adapter.ts
--- a/src/providers/gemini/adapter.ts
+++ b/src/providers/gemini/adapter.ts
@@ -241,6 +241,13 @@
       if (update.resumable && update.newHandle) this.handle = update.newHandle;
       this.frame('in', 'server.session_resumption_update', { resumable: update.resumable === true, hasHandle: Boolean(update.newHandle) });
     }
+    const activity = m.voiceActivity;
+    if (activity) {
+      this.frame('in', 'server.voice_activity', {
+        ...(activity.type ? { type: activity.type } : {}),
+        ...(activity.audioOffset ? { audioOffset: activity.audioOffset } : {}),
+      });
+    }
     if (m.serverContent) this.onContent(m.serverContent);
     if (m.goAway) {
       this.frame('in', 'server.go_away', m.goAway.timeLeft ? { timeLeft: m.goAway.timeLeft } : {});
@@ -279,6 +286,7 @@
       this.frame('in', 'server_content.turn_complete', c.turnCompleteReason ? { reason: c.turnCompleteReason } : {});
       this.turns.turnComplete();
     }
+    if (c.waitingForInput) this.frame('in', 'server_content.waiting_for_input');
   }
 
   private onModelTurn(parts: readonly Part[]): void {
```

- [ ] **Step 4: Run the suites the change reaches.**

Run: `npx vitest run src/providers/gemini/adapter.test.ts src/providers/gemini/adapter.reconnect.test.ts src/providers/gemini/adapter.tail.test.ts src/providers/gemini/wire.test.ts src/providers/gemini/wire.oracle.test.ts`
Expected: PASS — 5 files, 113 tests. Only new frames are said: the other cases count frames by type, and the oracle pins the setup frame alone.

- [ ] **Step 5: The gates.** The suite and the typecheck gate (in Wave 1, a failure in `hold.ts` or `hold.test.ts` is Task 1's).

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/wire.ts src/providers/gemini/adapter.ts src/providers/gemini/testing.ts src/providers/gemini/adapter.test.ts
```

```bash
git commit -q -F - -- src/providers/gemini/wire.ts src/providers/gemini/adapter.ts src/providers/gemini/testing.ts src/providers/gemini/adapter.test.ts <<'EOF'
feat(gemini): read the server's voice activity and wait for input, and frame them

The 3.x models send voiceActivity (ACTIVITY_START / ACTIVITY_END) as a
message of its own, which the adapter did not read. The wire spells its
field `type`, where the SDK's own type says voiceActivityType, so the
message type names it itself. It and waitingForInput are now Logs lines.
No behaviour change.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: A 3.x dialogue model holds its input under automatic turns, one utterance per release, and carries it across a reconnect (Wave 2)

**Files:**
- Modify: `src/providers/gemini/adapter.ts` (the header, the import, a field, the constructor, `appendAudio`, `onMessage`, `onContent`, `onModelTurn`, `reconnect`, `ladder`, `shutdown`)
- Test: `src/providers/gemini/adapter.hold.test.ts` (new), `src/providers/gemini/adapter.test.ts` (the conformance list, `:64`), `src/providers/sessionSide.consistency.test.ts` (Gemini's roster, anchored by content: the Palabra roster below it is another plan's)

**Interfaces:**
- Consumes: `InputHold`, `HOLD_MARGIN_MS`, `HOLD_IDLE_MS`, `HOLD_CARRY_MS`, `SPLIT_END_MS` (Task 1); `SETUP_TIMEOUT_MS` (the adapter, landed); `SERVER.voiceActivity`, `SERVER.generationComplete`, `SERVER.waitingForInput`, `GeminiServerMessage.voiceActivity` (Task 2); `BARGE_IN` (`gemini-3.8-live`, a model that barges in).
- Produces: `GeminiSession.hold: InputHold | null`; the frames `turn.hold` and `turn.hold_end`, ruling 4's causes and reasons among them (they come from `hold.ts`: the adapter already hands it every voice activity). Under manual turns no hold begins yet: Task 4 wires the presses and typed text, and the ladder's coordination with a held press.

- [ ] **Step 1: Write the failing tests** (rulings 1–4; choices 1, 2, 4–6, 10, 11, 14, 15): a new suite, `src/providers/gemini/adapter.hold.test.ts` — among its cases one that the session's Silence Duration reaches the split and one that a `waitingForInput` riding with the `turnComplete` that began a split leaves it be, and its last two replay two of the owner's batch-2 sessions through the adapter, the server's messages at their real times (research notes, multi batches), the 3.1 one to its first split's ACTIVITY_END; the 3.x model in the conformance list; `hold.ts` on Gemini's session side.

```ts
/**
 * A 3.x dialogue model's input held while the model's turn runs (Gemini
 * hold, ruling 1): from the user's turn close to the model's
 * `turnComplete`, then sent in order, the audio as one frame. The owner's
 * probes showed why: a 3.x model paces `turnComplete` to a simulated
 * real-time playback of its answer, and input inside that turn cut the
 * answer or lost its own start; held to `turnComplete`, both translations
 * came through whole, 12 of 12. On `FakeSocket` and a virtual clock.
 */
import { describe, it, expect } from 'vitest';
import { flush } from '../../lib/contract/testing/drive';
import { SETUP_TIMEOUT_MS } from './adapter';
import { HOLD_CARRY_MS, HOLD_IDLE_MS, HOLD_MARGIN_MS, SPLIT_END_MS } from './hold';
import { AUTO_CTX, BARGE_IN, DIALOGUE, liveGemini, SERVER, serverFrame, TRANSLATE } from './testing';
import { base64ToPcm } from './wire';

type Live = Awaited<ReturnType<typeof liveGemini>>;

/** A capture chunk: 2 048 samples of 24 kHz voice, `fill` each. */
const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);

type Sent = { setup?: unknown; realtimeInput?: { audio?: { data: string }; activityStart?: object; activityEnd?: object; text?: string } };

/** What went up, by kind — an audio frame as `audio ×<samples>` — after the setup. */
function wire(sent: Sent[]): string[] {
  return sent.slice(1).map((f) => {
    const input = f.realtimeInput!;
    if (input.audio) return `audio ×${base64ToPcm(input.audio.data).length}`;
    return Object.keys(input)[0];
  });
}

describe('a 3.x dialogue model under automatic turns (Gemini hold, ruling 1)', () => {
  it("holds the microphone from the server's ACTIVITY_END to the model's turnComplete, sends what it held as one frame, and goes on live: each answer pairs with its own utterance", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.session.appendAudio(chunk());
    // The probe: 3.8 transcribes the turn just before its ACTIVITY_END, the activity still open (choice 2).
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START', '0.760s'));
    h.socket().receive(SERVER.input('Lyrical Time の番組へようこそ。'));
    expect(h.frames('turn.hold')).toEqual([]);
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END', '6.760s'));
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }]);
    // The second utterance starts while the first's answer plays: held.
    for (let i = 0; i < 3; i++) h.session.appendAudio(chunk(2_000 + i));
    h.clock.advance(300);
    h.socket().receive(SERVER.output('Welcome to the Lyrical Time program.'));
    h.socket().receive(SERVER.audio(48_000));
    h.socket().receive(SERVER.generationComplete());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
    // The server's simulated playback of those 2 s ends.
    h.clock.advance(2_000);
    h.socket().receive(SERVER.turnComplete());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048', 'audio ×6144']);
    const burst = base64ToPcm((h.sent()[2] as { realtimeInput: { audio: { data: string } } }).realtimeInput.audio.data);
    expect([burst[0], burst[2_048], burst[4_096]]).toEqual([2_000, 2_001, 2_002]);
    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'turn_complete', heldMs: 2_300, audioMs: 256, actions: 0, withdrawn: 0, playbackEndMs: 2_300 }]);
    const order = h.of('frame').map((f) => f.payload.type);
    expect(order.slice(order.indexOf('server_content.turn_complete'))).toEqual(['server_content.turn_complete', 'turn.hold_end']);
    // Live again.
    h.session.appendAudio(chunk());
    expect(wire(h.sent() as Sent[])).toHaveLength(3);
    // The burst's own turn: its ACTIVITY_END holds again, and its answer is turn 2.
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START', '7.520s'));
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END', '13.520s'));
    h.socket().receive(SERVER.input('Real Time の翻訳機へようこそ。'));
    h.socket().receive(SERVER.output('Welcome to the real-time translator.'));
    h.socket().receive(SERVER.turnComplete());
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'voice_activity' }]);
    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([['source', 't1'], ['translation', 't1'], ['source', 't2'], ['translation', 't2']]);
    expect(h.timers()).toBe(0);
  });

  it('with no voice activity from the server, the first input transcription of a model turn begins it, else its first output — a transcription or a part (choice 2)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.input('Hello.'));
    h.socket().receive(SERVER.output('こんにちは。'));
    h.socket().receive(SERVER.turnComplete());
    h.socket().receive(SERVER.output('どうも。'));
    h.socket().receive(SERVER.turnComplete());
    h.socket().receive(SERVER.audio(2_400));
    h.socket().receive(SERVER.turnComplete());
    expect(h.frames('turn.hold')).toEqual([{ cause: 'input_transcription' }, { cause: 'model_output' }, { cause: 'model_output' }]);
  });

  it("on a model that sends voice activity, a transcription that comes after its own turnComplete begins no hold: the user's next words go up live, not after the idle cap (choice 2)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.socket().receive(SERVER.output('Answer one.'));
    h.socket().receive(SERVER.audio(2_400));
    h.socket().receive(SERVER.turnComplete());
    // Google: the transcription is sent "independently", with "no guaranteed ordering".
    h.socket().receive(SERVER.input('late words'));
    h.session.appendAudio(chunk());
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }]);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
  });

  it("interrupted and waitingForInput end the model's turn for the fallbacks, as turnComplete does: the next turn's first output begins a hold (choices 2, 4)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.audio(2_400));
    h.clock.advance(100 + HOLD_MARGIN_MS);
    // Let go at its cap: the same model turn's later output begins none.
    h.socket().receive(SERVER.output('b'));
    expect(h.frames('turn.hold')).toHaveLength(1);
    h.socket().receive(SERVER.interrupted());
    h.socket().receive(SERVER.output('c'));
    expect(h.frames('turn.hold')).toHaveLength(2);
    h.socket().receive(SERVER.waitingForInput());
    h.socket().receive(SERVER.output('d'));
    expect(h.frames('turn.hold')).toEqual([{ cause: 'model_output' }, { cause: 'model_output' }, { cause: 'model_output' }]);
  });

  it("counts every model audio part at its own rate toward the cap, on a leg that does not speak too — the participant's, the same as the speaker's (ruling 3; choices 1, 6)", async () => {
    const h = await liveGemini({ model: BARGE_IN, context: { ...AUTO_CTX, speech: false } });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    // 200 ms at 24 kHz, and 100 ms at 16 kHz, which is skipped: the server plays both.
    h.socket().receive(SERVER.audio(4_800));
    h.socket().receive(SERVER.audio(1_600, 'audio/pcm;rate=16000'));
    expect(h.of('audio')).toEqual([]);
    h.clock.advance(300 + HOLD_MARGIN_MS - 1);
    expect(wire(h.sent() as Sent[])).toEqual([]);
    h.clock.advance(1);
    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'cap', heldMs: 300 + HOLD_MARGIN_MS, audioMs: 85, actions: 0, withdrawn: 0, playbackEndMs: 300 }]);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
    // The late turnComplete lets nothing go twice.
    h.socket().receive(SERVER.turnComplete());
    expect(h.frames('turn.hold_end')).toHaveLength(1);
  });

  it('interrupted during a hold lets nothing go; the turnComplete that trails it does (choice 4)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    h.socket().receive(SERVER.interrupted());
    expect(wire(h.sent() as Sent[])).toEqual([]);
    h.socket().receive(SERVER.turnComplete());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
  });

  it("the split's pause follows the session's own Silence Duration: a 700 ms pause splits a release at the default 500 ms, not at 1 500 ms (choice 15)", async () => {
    const causes: string[][] = [];
    for (const vadSilenceDurationMs of [500, 1_500]) {
      const h = await liveGemini({ model: BARGE_IN, patch: { vadSilenceDurationMs } });
      h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
      h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
      for (const fill of [1_000, 1_000, 1_000, 0, 0, 0, 0, 0, 0, 0, 2_000, 2_000, 2_000]) h.session.appendAudio(new Int16Array(2_400).fill(fill));
      h.socket().receive(SERVER.turnComplete());
      causes.push((h.frames('turn.hold') as Array<{ cause: string }>).map((p) => p.cause));
    }
    expect(causes).toEqual([['voice_activity', 'split'], ['voice_activity']]);
  });

  it("a waitingForInput in the same message as the turnComplete that began a split leaves that split's hold alone: the next onset stays held until the server's END for what went up, or the split's wait (choices 4, 14)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    // Held: an utterance's end, a 700 ms pause, the next onset.
    for (const fill of [1_000, 1_000, 1_000, 0, 0, 0, 0, 0, 0, 0, 2_000, 2_000, 2_000]) h.session.appendAudio(new Int16Array(2_400).fill(fill));
    h.socket().receive(serverFrame({ serverContent: { turnComplete: true, waitingForInput: true } }));
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'split' }]);
    expect(h.frames('turn.hold_end')).toMatchObject([{ reason: 'turn_complete', keptMs: 300 }]);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×24000']);
    h.clock.advance(SPLIT_END_MS - 1);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×24000']);
    // Its own wait bounds it: 2 s for the 1 s that went up.
    h.clock.advance(1);
    expect(h.frames('turn.hold_end')).toMatchObject([{ reason: 'turn_complete' }, { reason: 'split_timeout' }]);
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×24000', 'audio ×7200']);
  });

  it('waitingForInput lets go at once: the model is not generating (choice 4)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    h.socket().receive(SERVER.waitingForInput());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
    expect(h.frames('turn.hold_end').map((s) => (s as { reason: string }).reason)).toEqual(['waiting_for_input']);
  });

  it.each([
    ['a goAway', (h: Live) => h.socket().receive(SERVER.goAway())],
    ['a close', (h: Live) => h.socket().serverClose(1011, 'Internal error')],
  ] as const)("%s during a hold carries what was held, and the gap's audio after it, to the new connection, sent as one frame once its setup is answered; no cap runs meanwhile, and the new connection holds nothing (choice 10)", async (_cause, lose) => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk(7));
    const first = h.socket();
    lose(h);
    await flush();
    // The user goes on speaking while the connection is re-made; the idle cap would have let go by now.
    h.session.appendAudio(chunk(8));
    h.clock.advance(HOLD_IDLE_MS);
    expect(h.frames('turn.hold_end')).toEqual([]);
    h.socket().open();
    h.socket().receive(SERVER.setupComplete());
    await flush();
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×4096']);
    const burst = base64ToPcm((h.sent()[1] as { realtimeInput: { audio: { data: string } } }).realtimeInput.audio.data);
    expect([burst[0], burst[2_048]]).toEqual([7, 8]);
    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'reconnect', heldMs: HOLD_IDLE_MS, audioMs: 171, actions: 0, withdrawn: 0, playbackEndMs: null, carried: true }]);
    // Nothing of it went to the old connection; after it, live.
    expect(wire(first.sentJson<Sent>())).toEqual([]);
    h.session.appendAudio(chunk());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×4096', 'audio ×2048']);
    expect(h.timers()).toBe(0);
  });

  it("a slow reconnect carries at most 5 s of the gap's audio under automatic turns: the held start whole, the gap's first 5 s, the rest dropped and said (choice 10)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk(7));
    h.socket().serverClose(1011, 'Internal error');
    await flush();
    // The first attempt opens and never answers; the user speaks on through its setup's bound and the backoff: 17 s.
    h.socket().open();
    for (let i = 0; i < 170; i++) h.session.appendAudio(new Int16Array(2_400).fill(8));
    h.clock.advance(SETUP_TIMEOUT_MS);
    await flush();
    h.clock.advance(2_000);
    await flush();
    h.socket().open();
    h.socket().receive(SERVER.setupComplete());
    await flush();
    expect(wire(h.sent() as Sent[])).toEqual([`audio ×${2_048 + (HOLD_CARRY_MS * 24_000) / 1000}`]);
    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'reconnect', heldMs: SETUP_TIMEOUT_MS + 2_000, audioMs: 5_085, actions: 0, withdrawn: 0, playbackEndMs: null, carried: true, droppedMs: 12_000 }]);
    expect(h.timers()).toBe(0);
  });

  it('stop during the reconnect sends nothing of what was held, on either connection, says nothing, and leaves no timer (choice 11)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    const first = h.socket();
    h.socket().receive(SERVER.goAway());
    await flush();
    const attempt = h.socket();
    await h.session.stop();
    await flush();
    h.clock.advance(20_000);
    expect(wire(first.sentJson<Sent>())).toEqual([]);
    expect(attempt.sent).toEqual([]);
    expect(h.sockets.all).toHaveLength(2);
    expect(h.frames('turn.hold_end')).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('stop during a hold sends nothing more, says nothing, and leaves no timer (choice 11)', async () => {
    const h = await liveGemini({ model: BARGE_IN });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.session.appendAudio(chunk());
    const sent = h.socket().sent.length;
    await h.session.stop();
    expect(h.timers()).toBe(0);
    h.clock.advance(20_000);
    expect(h.socket().sent).toHaveLength(sent);
    expect(h.frames('turn.hold_end')).toEqual([]);
  });

  it.each([['2.5', DIALOGUE], ['Live Translate', TRANSLATE]] as const)('%s never holds: its audio goes live whatever the server says (ruling 2)', async (_name, model) => {
    const h = await liveGemini({ model });
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
    h.socket().receive(SERVER.input('Hello.'));
    h.socket().receive(SERVER.output('こんにちは。'));
    h.session.appendAudio(chunk());
    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048']);
    expect(h.frames('turn.hold')).toEqual([]);
  });
});

/** Utterances' speech in the stream: from, to (ms). */
type Speech = ReadonlyArray<readonly [number, number]>;

/**
 * One of the owner's batch-2 probe sessions (2026-09-29, Japanese speech), replayed through the adapter: the capture's
 * 100 ms chunks — each a steady level inside an utterance's speech and silence outside it: the clips stand in by their
 * loudness only — and the server's messages the hold reads, each at its time in the stream. Each answer's audio comes
 * as one part at its first part's arrival, all of its length: the cap reads only those two.
 */
function replay(h: Live, speech: Speech, streamMs: number, server: ReadonlyArray<readonly [number, ArrayBuffer]>): void {
  const t0 = h.clock.now();
  const to = (at: number) => h.clock.advance(t0 + at - h.clock.now());
  let next = 0;
  const upTo = (at: number) => {
    for (; next < server.length && server[next][0] <= at; next++) {
      to(server[next][0]);
      h.socket().receive(server[next][1]);
    }
  };
  for (let at = 0; at < streamMs; at += 100) {
    upTo(at);
    to(at);
    const voiced = speech.some(([from, until]) => at < until && at + 100 > from);
    h.session.appendAudio(new Int16Array(2_400).fill(voiced ? 1_000 : 0));
  }
  upTo(Infinity);
}

/** The wire's runs: each entry with how many times it came in a row. */
function runs(list: readonly string[]): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last[0] === e) last[1] += 1;
    else out.push([e, 1]);
  }
  return out;
}

describe('a 3.x dialogue model under automatic turns: one utterance per release, and a new start (Gemini hold, ruling 4)', () => {
  it("3.8, three sentences 1.1 s apart: each release lets one utterance go and holds the next onset until the server has closed and answered it — three answers, one per utterance, where the first rule's single burst stalled on the idle cap (choice 14)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    // Batch 2, `seq` at 1 100 ms on gemini-3.8-live, its `turn2` session (the first rule's `turn` session of the same
    // clips released U2's end and U3's onset in one burst; the server opened U3 while a hold begun on U2's lagging
    // ACTIVITY_END kept its end, to the idle cap). At the default silence, 500 ms, the probe's own: a 600 ms split pause.
    replay(h, [[60, 5_250], [6_350, 7_800], [8_900, 11_470]], 18_600, [
      [287, SERVER.voiceActivity('ACTIVITY_START', '0.240s')],
      [6_074, SERVER.input('Lyrical Theme of Fanfare にようこそ。自然な会話をお手伝いします。')],
      [6_075, SERVER.voiceActivity('ACTIVITY_END', '6.040s')],
      [6_532, SERVER.audio(116_401)],
      [6_532, SERVER.output('Welcome to Lyrical ')],
      [7_713, SERVER.generationComplete()],
      [11_415, SERVER.turnComplete()],
      [11_848, SERVER.voiceActivity('ACTIVITY_START', '6.600s')],
      [12_393, SERVER.input('少々お待ちください。')],
      [12_393, SERVER.voiceActivity('ACTIVITY_END', '8.520s')],
      [13_044, SERVER.audio(25_921)],
      [13_044, SERVER.output('Please wait ')],
      [13_299, SERVER.generationComplete()],
      [14_136, SERVER.turnComplete()],
      [14_314, SERVER.voiceActivity('ACTIVITY_START', '9.040s')],
      [15_252, SERVER.input('電車が十分遅れています。')],
      [15_252, SERVER.voiceActivity('ACTIVITY_END', '12.280s')],
      [16_062, SERVER.audio(60_240)],
      [16_062, SERVER.output('The train is ')],
      [16_560, SERVER.generationComplete()],
      [18_577, SERVER.turnComplete()],
    ]);
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'split' }, { cause: 'split' }]);
    expect(h.frames('turn.hold_end')).toEqual([
      { reason: 'turn_complete', heldMs: 5_340, audioMs: 5_400, actions: 0, withdrawn: 0, playbackEndMs: 5_307, keptMs: 2_600 },
      { reason: 'turn_complete', heldMs: 2_721, audioMs: 5_300, actions: 0, withdrawn: 0, playbackEndMs: 2_709, keptMs: 0 },
      { reason: 'turn_complete', heldMs: 4_441, audioMs: 4_400, actions: 0, withdrawn: 0, playbackEndMs: 4_436 },
    ]);
    // U2 and its pause at answer 1's end; U3, from its onset, only at answer 2's; the silence after it at answer 3's.
    const sent = wire(h.sent() as Sent[]);
    expect(runs(sent)).toEqual([['audio ×2400', 61], ['audio ×67200', 1], ['audio ×127200', 1], ['audio ×105600', 1]]);
    const bursts = (h.sent() as Sent[]).slice(62).map((f) => base64ToPcm(f.realtimeInput!.audio!.data));
    expect(bursts.map((b) => [b[0], b[b.length - 1]])).toEqual([[0, 0], [1_000, 0], [0, 0]]);
    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([
      ['source', 't1'], ['translation', 't1'], ['source', 't2'], ['translation', 't2'], ['source', 't3'], ['translation', 't3'],
    ]);
    expect(h.timers()).toBe(0);
  });

  it("3.1, a monologue: the split's hold consumes the server's close of what it let go, 1.58 s after it and inside its 2 s wait — where the probe's 1.5 s wait ran out (choice 14)", async () => {
    const h = await liveGemini({ model: BARGE_IN });
    // Batch 2, `mono` (pauses 800/1 200/1 000/1 500 ms) on gemini-3.1-flash-live-preview, its `turn2` session, to its
    // first split's ACTIVITY_END. The probe's own wait was 1.5 s: it ran out 70 ms before that END, 3.1 cut the pending
    // answer before any output (failure mode (b)) and answered two utterances together. The session's later messages
    // answer what that timeout sent, so the replay stops at the END; the late-END path is `hold.test.ts`'s.
    replay(h, [[50, 3_470], [4_270, 6_530], [7_730, 10_660], [11_660, 14_170], [15_670, 18_710]], 9_400, [
      [182, SERVER.voiceActivity('ACTIVITY_START', '0.160s')],
      [4_398, SERVER.input('今日 は 雨 が 降り そう な の で 傘 を 持っ て 行き ます 。')],
      [4_398, SERVER.voiceActivity('ACTIVITY_END', '4.280s')],
      [4_535, SERVER.audio(77_761)],
      [4_535, SERVER.output('It looks')],
      [5_437, SERVER.generationComplete()],
      [7_806, SERVER.turnComplete()],
      [8_317, SERVER.voiceActivity('ACTIVITY_START', '4.600s')],
      [9_388, SERVER.input('ドア を 閉め て ください 。')],
      [9_388, SERVER.voiceActivity('ACTIVITY_END', '7.160s')],
    ]);
    // Split at 7 806 ms (3.3 s let go, so a 2 s wait), its END at 9 388: consumed, no hold of its own.
    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'split' }]);
    expect(h.frames('turn.hold_end')).toEqual([
      { reason: 'turn_complete', heldMs: 3_408, audioMs: 3_500, actions: 0, withdrawn: 0, playbackEndMs: 3_377, keptMs: 200 },
    ]);
    // The wait is over: past it the split's hold still holds U3's onset, for its answer's turnComplete.
    h.clock.advance(SPLIT_END_MS);
    expect(h.frames('turn.hold_end')).toHaveLength(1);
    const sent = wire(h.sent() as Sent[]);
    expect(runs(sent)).toEqual([['audio ×2400', 44], ['audio ×79200', 1]]);
  });
});
```

```diff
diff --git a/src/providers/gemini/adapter.test.ts b/src/providers/gemini/adapter.test.ts
--- a/src/providers/gemini/adapter.test.ts
+++ b/src/providers/gemini/adapter.test.ts
@@ -61,7 +61,7 @@
   };
 }
 
-describe.each([['a dialogue model', DIALOGUE], ['Live Translate', TRANSLATE]] as const)('the Gemini adapter: conformance, %s', (_name, model) => {
+describe.each([['a dialogue model', DIALOGUE], ['a 3.x dialogue model, which holds its input (Gemini hold, ruling 1)', BARGE_IN], ['Live Translate', TRANSLATE]] as const)('the Gemini adapter: conformance, %s', (_name, model) => {
   const harness = harnessFor(model);
 
   it('runs every scenario', () => {
```

```diff
diff --git a/src/providers/sessionSide.consistency.test.ts b/src/providers/sessionSide.consistency.test.ts
--- a/src/providers/sessionSide.consistency.test.ts
+++ b/src/providers/sessionSide.consistency.test.ts
@@ -206,6 +206,7 @@
     const gemini = sessionSide(REPO_ROOT, 'src/providers/gemini');
     expect(gemini).toEqual(expect.arrayContaining([
       'src/providers/gemini/adapter.ts',
+      'src/providers/gemini/hold.ts',
       'src/providers/gemini/socket.ts',
       'src/providers/gemini/tail.ts',
       'src/providers/gemini/turns.ts',
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini/adapter.hold.test.ts src/providers/gemini/adapter.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: FAIL — `2 failed | 1 passed (3)` files, `16 failed | 82 passed (98)` tests: nothing holds, and the session side does not reach `hold.ts`. The stop-during-a-hold case and the 2.5 and Live Translate cases pass already, and so do the 3.x model's conformance runs: they guard what must not change.

- [ ] **Step 3: Hold under automatic turns, and carry a hold across a reconnect.** Ruling 4 needs nothing more here than the header, one comment and the session's silence setting handed to the hold under automatic turns (choice 15): its rules are `hold.ts`'s.

```diff
diff --git a/src/providers/gemini/adapter.ts b/src/providers/gemini/adapter.ts
--- a/src/providers/gemini/adapter.ts
+++ b/src/providers/gemini/adapter.ts
@@ -9,6 +9,9 @@
  * refused key or model rejects it in words and within a bound (choice 12).
  * A push-to-talk release on Live Translate sends a real-time silence tail
  * before its `activityEnd` (`tail.ts`; Gemini/AST2 follow-up, ruling 4).
+ * A 3.x dialogue model's input is held from the user's turn close to the
+ * model's `turnComplete` (`hold.ts`; Gemini hold, ruling 1), and under
+ * automatic turns let go one utterance at a time (ruling 4).
  * Every timer reads the request's clock, and nothing is said but through
  * events (CLAUDE.md, "Inside an IClient session").
  */
@@ -24,6 +27,7 @@
 import { framePayload } from '../../lib/contract/framePayload';
 import { describeCause } from '../../lib/diagnostics/describeCause';
 import type { GeminiConfig } from './config';
+import { InputHold } from './hold';
 import type { GeminiCredentials } from './settings';
 import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
 import { ReleaseTail, type TailSummary } from './tail';
@@ -100,6 +104,8 @@
   private readonly turns: GeminiTurns;
   /** Live Translate under manual turns: a release's silence, its press's activity held open until it ends (Gemini/AST2 follow-up, ruling 4; choice 11). */
   private readonly tail: ReleaseTail;
+  /** A model that barges in: the leg's input held from the user's turn close to the model's `turnComplete` (Gemini hold, ruling 1; choice 1). Null on every other model. */
+  private readonly hold: InputHold | null;
 
   constructor(private readonly request: GeminiRequest, private readonly events: AdapterEvents, private readonly openSocket: OpenSocket) {
     this.turns = new GeminiTurns({
@@ -114,6 +120,18 @@
       send: (pcm) => this.live()?.send(audioFrame(pcm)),
       ended: (summary) => this.tailEnded(summary),
     });
+    // Derived, no knob: the dialogue models that barge in, 3.x and later; 2.5 and Live Translate never hold (Gemini hold, ruling 2).
+    const { kind, activityHandling, activity } = request.config;
+    this.hold = kind === 'dialogue' && activityHandling === 'START_OF_ACTIVITY_INTERRUPTS'
+      ? new InputHold({
+          clock: request.clock,
+          // Under automatic turns the split's pause follows the server's own end-of-speech silence (Gemini hold, choice 15).
+          ...(activity.manual ? { manual: true as const } : { manual: false as const, silenceMs: activity.silenceMs }),
+          send: (pcm) => this.live()?.send(audioFrame(pcm)),
+          began: (cause) => this.frame('out', 'turn.hold', { cause }),
+          ended: (summary) => this.frame('out', 'turn.hold_end', summary),
+        })
+      : null;
   }
 
   /** Resolves once the server answers the setup; rejects, leaving nothing open, when it refuses, drops, does not answer in time, or the signal aborts. */
@@ -130,9 +148,11 @@
     return {
       info: { transport: 'websocket' },
       // No frame per chunk (the hot-path rule). Audio while no connection is set up is dropped (parity). Real audio ends a release's tail first.
+      // During a hold it waits its turn (Gemini hold, ruling 1).
       appendAudio: (pcm) => {
         this.tail.stop('audio');
-        this.live()?.send(audioFrame(pcm));
+        if (this.hold?.holding) this.hold.audio(pcm);
+        else this.live()?.send(audioFrame(pcm));
       },
       appendText: (text) => this.appendText(text),
       beginTurn: () => this.beginTurn(),
@@ -247,6 +267,9 @@
         ...(activity.type ? { type: activity.type } : {}),
         ...(activity.audioOffset ? { audioOffset: activity.audioOffset } : {}),
       });
+      // ACTIVITY_END is the server closing the user's turn, or the close a split waits for; an ACTIVITY_START during
+      // a hold lets it go (Gemini hold, choices 2, 14).
+      this.hold?.voiceActivity(activity.type);
     }
     if (m.serverContent) this.onContent(m.serverContent);
     if (m.goAway) {
@@ -266,6 +289,7 @@
         this.turns.input(input.text);
         // Either side's words mean the model is still working through the press (Gemini/AST2 follow-up, choice 12).
         this.tail.output();
+        this.hold?.input();
       }
     }
     const output = c.outputTranscription;
@@ -274,6 +298,7 @@
       if (output.text) {
         this.turns.output(output.text);
         this.tail.output();
+        this.hold?.output();
       }
     }
     if (c.modelTurn?.parts) this.onModelTurn(c.modelTurn.parts);
@@ -281,16 +306,25 @@
     if (c.interrupted) {
       this.frame('in', 'server_content.interrupted');
       this.turns.interrupted();
+      // A hold goes on to the `turnComplete` that trails it (Gemini hold, choice 4).
+      this.hold?.interrupted();
     }
     if (c.turnComplete) {
       this.frame('in', 'server_content.turn_complete', c.turnCompleteReason ? { reason: c.turnCompleteReason } : {});
       this.turns.turnComplete();
+      // After the turn has ended: what the hold lets go of is owed from a closed turn (Gemini hold, choices 4, 13).
+      this.hold?.turnComplete();
+    }
+    if (c.waitingForInput) {
+      this.frame('in', 'server_content.waiting_for_input');
+      this.hold?.waitingForInput();
     }
-    if (c.waitingForInput) this.frame('in', 'server_content.waiting_for_input');
   }
 
   private onModelTurn(parts: readonly Part[]): void {
     let audioBytes = 0;
+    /** How long the decoded parts play, at their own rates: the hold's cap counts it (Gemini hold, ruling 3). */
+    let audioMs = 0;
     let mimeType: string | undefined;
     let text = '';
     const playable: Int16Array[] = [];
@@ -310,6 +344,7 @@
         this.partsReadable = true;
         audioBytes += pcm.byteLength;
         const rate = pcmRate(mimeType);
+        audioMs += (pcm.length * 1000) / rate;
         if (rate === SAMPLE_RATE) playable.push(pcm);
         else this.foreignRate(rate);
       } else if (part.text && !part.thought) {
@@ -320,6 +355,11 @@
     this.frame('in', 'server_content.model_turn', { audioBytes, ...(mimeType ? { mimeType } : {}), ...(text ? { text } : {}) });
     for (const pcm of playable) this.turns.audio(pcm);
     if (text) this.turns.modelText(text);
+    // Every part's audio moves the hold's cap, played here or not (Gemini hold, ruling 3; choice 6). Only what `GeminiTurns` takes
+    // as content — playable audio, the model's text — is the model's turn under way; a thought, or a part that will not
+    // decode, is not (choices 2, 4).
+    const content = playable.some((pcm) => pcm.length > 0) || text !== '';
+    if (content || audioMs > 0) this.hold?.output(audioMs, content);
   }
 
   /** Audio at a rate this app does not play is skipped; a speaking leg says so once (choice 18). */
@@ -437,6 +477,8 @@
     }
     // The tail's activity was the old connection's: nothing of it reaches the new one.
     this.tail.cancel();
+    // Not what a hold kept back: that, and what comes until the next connection is set up, goes up on that one (Gemini hold, choice 10).
+    this.hold?.carry();
     this.frame('in', 'session.reconnecting', {
       cause: why.cause,
       ...(why.code !== undefined ? { code: why.code } : {}),
@@ -477,6 +519,8 @@
         this.frame('out', 'realtime_input.activity_start');
       }
       this.events.reconnected();
+      // What a hold carried across goes up now, in order: no model turn is in flight on the new connection (Gemini hold, choice 10).
+      this.hold?.reconnected();
       return;
     }
     this.frame('in', 'session.connection_lost', { attempts: RECONNECT_DELAYS_MS.length });
@@ -514,6 +558,7 @@
     for (const cancel of [...this.cancels]) cancel();
     this.cancels.clear();
     this.tail.cancel();
+    this.hold?.cancel();
     this.turns.stop();
     const ws = this.socket;
     this.socket = null;
```

- [ ] **Step 4: Run Gemini's suites and the session-side guard.**

Run: `npx vitest run src/providers/gemini src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 18 files, 329 tests. The landed barge-in cases pass unchanged: under automatic turns a hold begins at the first transcription (no voice activity in those cases) and lets go at each `turnComplete` without touching segments; under push-to-talk nothing holds yet. The landed reconnect cases (`adapter.reconnect.test.ts`) run the 2.5 model and Live Translate, which never hold. The session-side guard now walks `hold.ts` too: it imports no store, no reporter, and times only through the clock it is handed. The two replays pin, on batch 2's own timings at its default silence, three answers one per utterance where the first rule stalled (3.8), and the 3.1 monologue's first split consuming its ACTIVITY_END 1.58 s after it, inside the 2 s wait where the probe's 1.5 s ran out (3.1).

- [ ] **Step 5: The gates.** The suite and the typecheck gate.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/adapter.ts src/providers/gemini/adapter.hold.test.ts src/providers/gemini/adapter.test.ts src/providers/sessionSide.consistency.test.ts
```

```bash
git commit -q -F - -- src/providers/gemini/adapter.ts src/providers/gemini/adapter.hold.test.ts src/providers/gemini/adapter.test.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
feat(gemini): a 3.x dialogue model holds its input until turnComplete (automatic turns)

A 3.x model barges in, and paces its turnComplete to a simulated
playback of its answer: speech inside that turn cut the answer or lost
its own start. Once the server closes the user's turn (voiceActivity
ACTIVITY_END, or else the turn's first output), the microphone's audio
is held and sent as one frame at turnComplete; the cap lets go 2 s past
the computed playback end, or 10 s with no model audio. A new
ACTIVITY_START lets a hold go, and a release lets one utterance go, at
the session's own silence setting, holding the next until the server
has closed and answered this one: replayed on two of the owner's probe
sessions. A reconnect, a goAway
included, carries it to the new connection, with at most 5 s of the
gap's own audio; a stop drops it. 2.5 and Live Translate never hold.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 4: Push-to-talk and typed text wait for a 3.x model's turn to end (Wave 3)

**Files:**
- Modify: `src/providers/gemini/adapter.ts` (the import, two fields, `beginTurn` and a new `pressStart`, `endTurn` and a new `pressEnd`, `activityEnd`, `appendText` and a new `sendText`, `reconnect`, `ladder`)
- Test: `src/providers/gemini/adapter.hold.test.ts` (its imports, a push-to-talk and typed-text suite, the seeded lifecycles), `src/providers/gemini/adapter.test.ts` (the barge-in tap case, `:454-473` at `ef2f61d3`, driven past the cap)

**Interfaces:**
- Consumes: `InputHold.begin`, `defer`, `holds`, `withdraw`, `HeldAction`, `HOLD_MARGIN_MS`, `SPLIT_END_MS`, `splitPauseMs` (Task 1); the adapter's hold and its carry across a reconnect (Task 3); `runLifecycles`, `LifecycleHarness` (the kit).
- Produces: `GeminiSession.activityOpen`, `GeminiSession.heldPress`, `pressStart()`, `pressEnd(cancelled)`, `sendText(text)`.

- [ ] **Step 1: Write the failing tests** (rulings 1, 4; choices 3–5, 7–10, 13, 14): the suite's push-to-talk, typed-text and reconnect cases — among them a START that reaches the adapter after the `interrupted` it set off, with typed text held, and the same with a part `GeminiTurns` takes as no content in between — and its seeded lifecycles, whose audio has pauses so that releases split and whose checks let a START end a split's hold only after its END, and the landed tap case, which a hold now withdraws, driven past the cap (research note 4).

```diff
diff --git a/src/providers/gemini/adapter.hold.test.ts b/src/providers/gemini/adapter.hold.test.ts
--- a/src/providers/gemini/adapter.hold.test.ts
+++ b/src/providers/gemini/adapter.hold.test.ts
@@ -9,9 +9,13 @@
  */
 import { describe, it, expect } from 'vitest';
 import { flush } from '../../lib/contract/testing/drive';
-import { SETUP_TIMEOUT_MS } from './adapter';
-import { HOLD_CARRY_MS, HOLD_IDLE_MS, HOLD_MARGIN_MS, SPLIT_END_MS } from './hold';
-import { AUTO_CTX, BARGE_IN, DIALOGUE, liveGemini, SERVER, serverFrame, TRANSLATE } from './testing';
+import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
+import { runLifecycles, type LifecycleHarness } from '../../lib/contract/testing/lifecycle';
+import { createGeminiAdapter, SETUP_TIMEOUT_MS } from './adapter';
+import type { GeminiConfig } from './config';
+import { HOLD_CARRY_MS, HOLD_IDLE_MS, HOLD_MARGIN_MS, SPLIT_END_MS, splitPauseMs } from './hold';
+import type { GeminiCredentials } from './settings';
+import { AUTO_CTX, BARGE_IN, configFor, DIALOGUE, KEY, liveGemini, SERVER, serverFrame, TRANSLATE } from './testing';
 import { base64ToPcm } from './wire';
 
 type Live = Awaited<ReturnType<typeof liveGemini>>;
@@ -385,3 +389,423 @@
     expect(runs(sent)).toEqual([['audio ×2400', 44], ['audio ×79200', 1]]);
   });
 });
+
+const MANUAL = { ...AUTO_CTX, turns: 'manual' as const };
+
+describe('a 3.x dialogue model under push-to-talk, and typed text (Gemini hold, ruling 1)', () => {
+  it("a release's activityEnd begins the hold; a press during it waits its turn, and at turnComplete its activityStart, its audio as one frame and its activityEnd go up in order — that activityEnd beginning the next hold (choices 3, 5, 7)", async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'audio ×2048', 'activityEnd']);
+    expect(h.frames('turn.hold')).toEqual([{ cause: 'activity_end' }]);
+    h.socket().receive(SERVER.input('Hello there.'));
+    h.socket().receive(SERVER.output('こんにちは。'));
+    h.socket().receive(SERVER.audio(24_000));
+    // The second press, voiced, pressed and released while the first's answer plays: nothing goes up.
+    h.session.beginTurn();
+    h.session.appendAudio(chunk(2_000));
+    h.session.appendAudio(chunk(2_001));
+    h.session.endTurn();
+    expect(wire(h.sent() as Sent[])).toHaveLength(3);
+    expect(h.frames('realtime_input.activity_start')).toHaveLength(1);
+    h.clock.advance(1_000);
+    h.socket().receive(SERVER.generationComplete());
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[]).slice(3)).toEqual(['activityStart', 'audio ×4096', 'activityEnd']);
+    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'turn_complete', heldMs: 1_000, audioMs: 171, actions: 2, withdrawn: 0, playbackEndMs: 1_000 }]);
+    expect(h.frames('turn.hold')).toEqual([{ cause: 'activity_end' }, { cause: 'activity_end' }]);
+    const order = h.of('frame').map((f) => f.payload.type);
+    expect(order.slice(order.indexOf('server_content.turn_complete'))).toEqual([
+      'server_content.turn_complete', 'turn.hold_end', 'realtime_input.activity_start', 'realtime_input.activity_end', 'turn.hold',
+    ]);
+    // The second press's own answer is turn 2.
+    h.socket().receive(SERVER.input('Again.'));
+    h.socket().receive(SERVER.output('もう一度。'));
+    h.socket().receive(SERVER.turnComplete());
+    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([['source', 't1'], ['translation', 't1'], ['source', 't2'], ['translation', 't2']]);
+    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['Hello there.', 'こんにちは。', 'Again.', 'もう一度。']);
+    expect(h.timers()).toBe(0);
+  });
+
+  it('a press still held when the hold lets go goes up then, and goes on live: its audio at once, its release at once (choice 7)', async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.endTurn();
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'activityEnd']);
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'activityEnd', 'activityStart', 'audio ×2048']);
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    expect(wire(h.sent() as Sent[]).slice(4)).toEqual(['audio ×2048', 'activityEnd']);
+  });
+
+  it("a press released without voice while its activityStart is still held is withdrawn: nothing of it goes up, nothing is dropped for it, and the next press's answer shows (choice 7)", async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    h.socket().receive(SERVER.output('The answer.'));
+    h.socket().receive(SERVER.audio());
+    h.session.beginTurn();
+    h.session.appendAudio(new Int16Array(480));
+    h.session.cancelTurn();
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'audio ×2048', 'activityEnd']);
+    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'turn_complete', heldMs: 0, audioMs: 0, actions: 0, withdrawn: 1, playbackEndMs: 100 }]);
+    expect(h.frames('realtime_input.activity_end')).toEqual([undefined]);
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    h.socket().receive(SERVER.output('the next answer'));
+    h.socket().receive(SERVER.turnComplete());
+    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['The answer.', 'the next answer']);
+  });
+
+  it('typed text during a hold is held whole — its row, its owed answer and its marks — and goes at turnComplete under the next turn, its activityEnd beginning the next hold (choices 3, 8)', async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    h.socket().receive(SERVER.input('Hello.'));
+    h.socket().receive(SERVER.output('こんにちは。'));
+    h.session.appendText('  typed  ');
+    expect(wire(h.sent() as Sent[])).toHaveLength(3);
+    expect(h.of('segmentOpened')).toHaveLength(2);
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[]).slice(3)).toEqual(['activityStart', 'text', 'activityEnd']);
+    expect(h.frames('turn.hold')).toEqual([{ cause: 'activity_end' }, { cause: 'activity_end' }]);
+    h.socket().receive(SERVER.output('タイプ。'));
+    h.socket().receive(SERVER.turnComplete());
+    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([['source', 't1'], ['translation', 't1'], ['source', 't2'], ['translation', 't2']]);
+    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['Hello.', 'こんにちは。', 'typed', 'タイプ。']);
+  });
+
+  it('typed text held inside a withdrawn press still goes, in marks of its own: they are read on the wire, not off the key (choice 9)', async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.endTurn();
+    h.session.beginTurn();
+    h.session.appendText('typed');
+    h.session.cancelTurn();
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'activityEnd', 'activityStart', 'text', 'activityEnd']);
+    expect(h.frames('turn.hold_end')).toMatchObject([{ actions: 1, withdrawn: 1 }]);
+  });
+
+  it('typed text held between two presses goes in marks of its own though a key is down when it goes (choice 9)', async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.endTurn();
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    h.session.appendText('typed');
+    h.session.beginTurn();
+    // The second press goes, and its activityEnd begins a hold; then the text, whose own activityEnd begins one; then the third press.
+    h.socket().receive(SERVER.turnComplete());
+    h.socket().receive(SERVER.turnComplete());
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[])).toEqual([
+      'activityStart', 'activityEnd',
+      'activityStart', 'audio ×2048', 'activityEnd',
+      'activityStart', 'text', 'activityEnd',
+      'activityStart',
+    ]);
+    expect(h.frames('turn.hold')).toHaveLength(3);
+  });
+
+  it("a press's activity is the connection's: across a reconnect, text goes inside a press started again, and in marks of its own after a press released in the gap (choice 9)", async () => {
+    const again = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    again.session.beginTurn();
+    again.socket().serverClose(1011, 'Internal error');
+    await flush();
+    again.socket().open();
+    again.socket().receive(SERVER.setupComplete());
+    await flush();
+    again.session.appendText('inside');
+    expect(wire(again.sent() as Sent[])).toEqual(['activityStart', 'text']);
+
+    const gap = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    gap.session.beginTurn();
+    gap.socket().serverClose(1011, 'Internal error');
+    await flush();
+    gap.session.endTurn();
+    gap.socket().open();
+    gap.socket().receive(SERVER.setupComplete());
+    await flush();
+    gap.session.appendText('after');
+    expect(wire(gap.sent() as Sent[])).toEqual(['activityStart', 'text', 'activityEnd']);
+  });
+
+  it('a release without voice begins no hold: whether the server answers an empty press is unknown, and the next press goes at once (choice 3)', async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.cancelTurn();
+    h.session.beginTurn();
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'activityEnd', 'activityStart']);
+    expect(h.frames('turn.hold')).toEqual([]);
+  });
+
+  it('interrupted during a hold holds on to the turnComplete that trails it: typed text held there pairs with its own answer (choice 4)', async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    h.socket().receive(SERVER.output('こんにちは'));
+    h.session.appendText('typed');
+    h.socket().receive(SERVER.interrupted());
+    expect(wire(h.sent() as Sent[])).toHaveLength(3);
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[]).slice(3)).toEqual(['activityStart', 'text', 'activityEnd']);
+    h.socket().receive(SERVER.output('タイプ'));
+    h.socket().receive(SERVER.turnComplete());
+    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([['translation', 't1'], ['source', 't2'], ['translation', 't2']]);
+  });
+
+  it('a press still down across a reconnect sends one activityStart on the new connection, then its held audio — the gap\'s too — and its release at once (choice 10)', async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    // The second press, during the hold, still down when the connection goes.
+    h.session.beginTurn();
+    h.session.appendAudio(chunk(2_000));
+    h.socket().serverClose(1011, 'Internal error');
+    await flush();
+    h.session.appendAudio(chunk(2_001));
+    h.socket().open();
+    h.socket().receive(SERVER.setupComplete());
+    await flush();
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'audio ×4096']);
+    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'reconnect', heldMs: 0, audioMs: 171, actions: 1, withdrawn: 0, playbackEndMs: null, carried: true }]);
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'audio ×4096', 'audio ×2048', 'activityEnd']);
+    expect(h.frames('turn.hold').map((p) => (p as { cause: string }).cause)).toEqual(['activity_end', 'activity_end']);
+  });
+
+  it('a press held across a reconnect keeps all its gap audio, past 5 s: push-to-talk is not capped, the press bounds it (choice 10)', async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.session.endTurn();
+    h.session.beginTurn();
+    h.socket().serverClose(1011, 'Internal error');
+    await flush();
+    for (let i = 0; i < 70; i++) h.session.appendAudio(new Int16Array(2_400).fill(9));
+    h.socket().open();
+    h.socket().receive(SERVER.setupComplete());
+    await flush();
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'audio ×168000']);
+    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'reconnect', heldMs: 0, audioMs: 7_000, actions: 1, withdrawn: 0, playbackEndMs: null, carried: true }]);
+  });
+
+  it("a reconnect carries held text and a held press in order: the text's own marks go first and begin the next hold, which keeps the press until it lets go (choice 10)", async () => {
+    const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
+    h.session.beginTurn();
+    h.session.endTurn();
+    h.session.appendText('typed');
+    h.session.beginTurn();
+    h.session.appendAudio(chunk());
+    h.socket().serverClose(1011, 'Internal error');
+    await flush();
+    h.socket().open();
+    h.socket().receive(SERVER.setupComplete());
+    await flush();
+    expect(h.frames('turn.hold_end')).toEqual([{ reason: 'reconnect', heldMs: 0, audioMs: 85, actions: 2, withdrawn: 0, playbackEndMs: null, carried: true }]);
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'text', 'activityEnd']);
+    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['typed']);
+    // The text's answer ends: the press goes up, still down, and its release at once.
+    h.socket().receive(SERVER.turnComplete());
+    h.session.endTurn();
+    expect(wire(h.sent() as Sent[])).toEqual(['activityStart', 'text', 'activityEnd', 'activityStart', 'audio ×2048', 'activityEnd']);
+  });
+
+  it('text typed while a hold is carried across a reconnect goes up after the carried audio, on the new connection (choice 10)', async () => {
+    const h = await liveGemini({ model: BARGE_IN });
+    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
+    h.session.appendAudio(chunk());
+    h.socket().receive(SERVER.goAway());
+    await flush();
+    h.session.appendText('typed');
+    h.socket().open();
+    h.socket().receive(SERVER.setupComplete());
+    await flush();
+    expect(wire(h.sent() as Sent[])).toEqual(['audio ×2048', 'text']);
+    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['typed']);
+  });
+
+  it("typed text under automatic turns during a hold is held, sent bare at turnComplete, and its answer's first output begins the next hold (choices 2, 8)", async () => {
+    const h = await liveGemini({ model: BARGE_IN });
+    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
+    h.session.appendText('typed');
+    expect(h.of('segmentOpened')).toEqual([]);
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[])).toEqual(['text']);
+    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([['source', 't2']]);
+    h.socket().receive(SERVER.output('タイプ。'));
+    expect(h.frames('turn.hold')).toEqual([{ cause: 'voice_activity' }, { cause: 'model_output' }]);
+  });
+
+  it("an ACTIVITY_START that comes after the interrupted it set off lets go at the turnComplete that trails it: held text goes up after that end, owed from a closed turn, and pairs with its own answer (choices 4, 13, 14)", async () => {
+    const h = await liveGemini({ model: BARGE_IN });
+    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
+    h.socket().receive(SERVER.input('一つ目。'));
+    h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
+    h.session.appendText('typed');
+    h.socket().receive(SERVER.output('The first'));
+    h.socket().receive(SERVER.interrupted());
+    h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
+    expect(wire(h.sent() as Sent[])).toEqual([]);
+    h.socket().receive(SERVER.turnComplete());
+    expect(wire(h.sent() as Sent[])).toEqual(['text']);
+    expect(h.frames('turn.hold_end')).toMatchObject([{ reason: 'voice_activity_start', actions: 1 }]);
+    h.socket().receive(SERVER.output('タイプ。'));
+    h.socket().receive(SERVER.turnComplete());
+    expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([
+      ['source', 't1'], ['translation', 't1'], ['source', 't2'], ['translation', 't2'],
+    ]);
+    expect(h.of('segmentText').map((e) => e.payload.text)).toEqual(['一つ目。', 'The first', 'typed', 'タイプ。']);
+  });
+
+  it("a model part that is no content to GeminiTurns — a thought, audio that will not decode, audio at a rate it does not play — does not end an interrupted's wait for its turnComplete either: held text still goes up after that end, and pairs with its own answer (choices 2, 4, 13, 14)", async () => {
+    const noContent = [
+      serverFrame({ serverContent: { modelTurn: { parts: [{ text: 'thinking', thought: true }] } } }),
+      serverFrame({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: '%%not base64%%' } }] } } }),
+      SERVER.audio(1_600, 'audio/pcm;rate=16000'),
+    ];
+    for (const frame of noContent) {
+      const h = await liveGemini({ model: BARGE_IN });
+      h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
+      h.socket().receive(SERVER.input('一つ目。'));
+      h.socket().receive(SERVER.voiceActivity('ACTIVITY_END'));
+      h.session.appendText('typed');
+      h.socket().receive(SERVER.output('The first'));
+      h.socket().receive(SERVER.interrupted());
+      h.socket().receive(frame);
+      h.socket().receive(SERVER.voiceActivity('ACTIVITY_START'));
+      expect(wire(h.sent() as Sent[])).toEqual([]);
+      h.socket().receive(SERVER.turnComplete());
+      expect(wire(h.sent() as Sent[])).toEqual(['text']);
+      h.socket().receive(SERVER.output('タイプ。'));
+      h.socket().receive(SERVER.turnComplete());
+      expect(h.of('segmentOpened').map((e) => [e.payload.side, e.payload.origin])).toEqual([
+        ['source', 't1'], ['translation', 't1'], ['source', 't2'], ['translation', 't2'],
+      ]);
+    }
+  });
+});
+
+describe('a 3.x dialogue model: the seeded lifecycles (Gemini hold, ruling 1)', () => {
+  /** The kit's random lives over a 3.x model, both turn modes: the server's every signal, the ladder's attempts, drops, stops. */
+  const lifecycles: LifecycleHarness<GeminiConfig, GeminiCredentials> = {
+    adapter: (run) => {
+      const gemini = createGeminiAdapter({ openSocket: (url) => run.sockets.create(url) });
+      return {
+        async start(request, events) {
+          const session = await gemini.start(request, events);
+          // A chunk in three is a pause long enough to split on at the session's own silence — the default's under
+          // push-to-talk, where `after` requires that none splits — so that held audio has pauses (choices 14, 15).
+          const { activity } = request.config;
+          const pause = ((splitPauseMs(activity.manual ? 500 : activity.silenceMs) + 100) * 24_000) / 1000;
+          return { ...session, appendAudio: (pcm) => session.appendAudio(run.rand() < 1 / 3 ? new Int16Array(pause) : pcm) };
+        },
+      };
+    },
+    config: (context) => configFor(BARGE_IN, context),
+    credentials: KEY,
+    secrets: [KEY.apiKey, 'secret-handle'],
+    textInput: true,
+    startBoundMs: SETUP_TIMEOUT_MS,
+    opening: (run) => {
+      const socket = run.sockets.last();
+      const r = run.rand();
+      if (r < 0.04) return socket.drop();
+      socket.open();
+      if (r < 0.08) return socket.serverClose(1008, 'API key not valid. Please pass a valid API key.');
+      // Never answered: the kit runs the setup's bound out.
+      if (r < 0.1) return;
+      socket.receive(SERVER.setupComplete());
+    },
+    server: (run) => {
+      const socket = run.sockets.last();
+      if (!socket) return;
+      // The ladder's next attempt: answered, dropped, or refused.
+      if (socket.readyState === FakeSocket.CONNECTING) {
+        const a = run.rand();
+        if (a < 0.5) {
+          socket.open();
+          socket.receive(SERVER.setupComplete());
+        } else if (a < 0.85) socket.drop();
+        else {
+          socket.open();
+          socket.serverClose(1011, 'Internal error');
+        }
+        return;
+      }
+      if (socket.readyState !== FakeSocket.OPEN) return;
+      const r = run.rand();
+      if (r < 0.12) socket.receive(SERVER.voiceActivity(run.pick(['ACTIVITY_START', 'ACTIVITY_END'] as const)));
+      else if (r < 0.22) socket.receive(SERVER.input(run.pick(['Hello.', 'こんにちは。'])));
+      else if (r < 0.34) socket.receive(SERVER.output(run.pick(['Hi.', 'どうも。'])));
+      else if (r < 0.5) socket.receive(SERVER.audio(run.pick([2_400, 24_000, 48_000])));
+      else if (r < 0.55) socket.receive(SERVER.generationComplete());
+      else if (r < 0.61) socket.receive(SERVER.interrupted());
+      else if (r < 0.76) socket.receive(SERVER.turnComplete());
+      else if (r < 0.79) socket.receive(SERVER.waitingForInput());
+      else if (r < 0.83) socket.receive(SERVER.handle('secret-handle'));
+      else if (r < 0.85) socket.receive(SERVER.goAway());
+      else if (r < 0.87) socket.receive('{bad');
+      else if (r < 0.9) socket.serverClose(1011, 'Internal error');
+    },
+    // A hold is said at its begin and at its end, never two at once, and no mark or text goes up while one is on. A
+    // split's hold follows at once the release that kept something, and only that one; a START ends a split's hold
+    // only once the server's ACTIVITY_END has come, and a split's hold times out only before it; only a split's hold
+    // times out; push-to-talk never splits (choice 14).
+    after: (run, log) => {
+      let open: string | null = null;
+      let kept = false;
+      /** The open split's hold has had its ACTIVITY_END: the one it waits for is the first to come. */
+      let closed = false;
+      const problems: string[] = [];
+      for (const e of log) {
+        if (e.kind !== 'frame') continue;
+        const { type, payload } = e.payload;
+        if (open && type.startsWith('realtime_input.')) problems.push(`${type} went up while holding`);
+        if (type === 'server.voice_activity' && open === 'split' && (payload as { type?: string }).type === 'ACTIVITY_END') closed = true;
+        if (type === 'turn.hold') {
+          const { cause } = payload as { cause: string };
+          if (open) problems.push('a hold began inside a hold');
+          if (kept !== (cause === 'split')) problems.push(kept ? 'a release kept audio and no split followed' : 'a split followed no release that kept audio');
+          if (cause === 'split') run.count('hold.split');
+          open = cause;
+          kept = false;
+          closed = false;
+        } else if (type === 'turn.hold_end') {
+          const { reason, keptMs } = payload as { reason: string; keptMs?: number };
+          if (!open) problems.push('a hold ended that had not begun');
+          if (reason === 'voice_activity_start' && open === 'split' && !closed) problems.push("an ACTIVITY_START let a split's hold go before its END");
+          if (reason === 'split_timeout' && (open !== 'split' || closed)) problems.push(`a ${open} hold ended on a split's timeout${closed ? ' after its END' : ''}`);
+          if (run.context.turns === 'manual' && (keptMs !== undefined || reason === 'voice_activity_start')) problems.push(`push-to-talk ended a hold on ${reason}, keeping ${keptMs}`);
+          run.count(`hold.${reason}`);
+          kept = keptMs !== undefined;
+          open = null;
+        }
+      }
+      return problems;
+    },
+  };
+
+  // 300 lives each: about a second alone; the bound is for a loaded machine.
+  it('every life settles, ends clean, and leaves no timer or socket behind; nothing goes up after it ends; each hold begins and ends once', async () => {
+    const report = await runLifecycles(lifecycles, { seed: 20260929, runs: 300 });
+    expect(report.failures).toEqual([]);
+    for (const key of ['refused', 'live', 'stopped', 'end.failed.connection_lost', 'hold.split', 'hold.voice_activity_start', 'hold.split_timeout']) {
+      expect(report.stats[key], key).toBeGreaterThan(0);
+    }
+  }, 20_000);
+});
```

```diff
diff --git a/src/providers/gemini/adapter.test.ts b/src/providers/gemini/adapter.test.ts
--- a/src/providers/gemini/adapter.test.ts
+++ b/src/providers/gemini/adapter.test.ts
@@ -16,6 +16,7 @@
 import { createProjector, DEFAULT_PROJECTION } from '../../lib/projection/project';
 import { createGeminiAdapter, SETUP_TIMEOUT_MS } from './adapter';
 import type { GeminiConfig } from './config';
+import { HOLD_MARGIN_MS } from './hold';
 import type { GeminiCredentials } from './settings';
 import { AUTO_CTX, b64, BARGE_IN, configFor, DIALOGUE, KEY, liveGemini, RefusingWebSocket, SERVER, serverFrame, startGemini, trackedClock, TRANSLATE } from './testing';
 import { base64ToPcm, liveUrl, setupFrame } from './wire';
@@ -458,7 +459,7 @@
     expect(h.of('audio')).toHaveLength(1);
   });
 
-  it("on a model that barges in, a voiceless tap during an answer, released before the server's interrupted arrives, drops its own answer: interrupted and its trailing turnComplete are one end (Gemini/AST2 follow-up, ruling 5; ruling 8)", async () => {
+  it("on a model that barges in, a voiceless tap during an answer, once the release's hold has let go at its cap, and released before the server's interrupted arrives, drops its own answer: interrupted and its trailing turnComplete are one end (Gemini/AST2 follow-up, ruling 5; ruling 8; Gemini hold, ruling 3)", async () => {
     const h = await liveGemini({ model: BARGE_IN, context: MANUAL });
     h.session.beginTurn();
     h.session.appendAudio(new Int16Array(480));
@@ -466,6 +467,9 @@
     h.socket().receive(SERVER.input('Hello there.'));
     h.socket().receive(SERVER.output('こんにちは'));
     h.socket().receive(SERVER.audio());
+    // The answer's 100 ms have played and its turnComplete is late: the cap lets go, and the tap goes up as before the hold.
+    h.clock.advance(100 + HOLD_MARGIN_MS);
+    expect(h.frames('turn.hold_end').map((s) => (s as { reason: string }).reason)).toEqual(['cap']);
     h.session.beginTurn();
     h.session.cancelTurn();
     h.socket().receive(SERVER.interrupted());
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/gemini/adapter.hold.test.ts src/providers/gemini/adapter.test.ts`
Expected: FAIL — `2 failed (2)` files, `16 failed | 91 passed (107)` tests: nothing holds under push-to-talk, typed text goes at once, and the ladder would restart a press whose start a carried hold still holds. Choice 9's reconnect case and the release without voice pass already: they guard what must not change. The seeded lifecycles fail: presses and text go up while a hold is on.

- [ ] **Step 3: Hold the presses and typed text.**

```diff
diff --git a/src/providers/gemini/adapter.ts b/src/providers/gemini/adapter.ts
--- a/src/providers/gemini/adapter.ts
+++ b/src/providers/gemini/adapter.ts
@@ -27,7 +27,7 @@
 import { framePayload } from '../../lib/contract/framePayload';
 import { describeCause } from '../../lib/diagnostics/describeCause';
 import type { GeminiConfig } from './config';
-import { InputHold } from './hold';
+import { InputHold, type HeldAction } from './hold';
 import type { GeminiCredentials } from './settings';
 import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
 import { ReleaseTail, type TailSummary } from './tail';
@@ -85,6 +85,10 @@
   private socket: WebSocket | null = null;
   /** Manual turns: a press is held. */
   private turnOpen = false;
+  /** Manual turns: an `activityStart` is on the wire with no `activityEnd` after it — a press's, or a Live Translate tail's. Typed text brings its own marks only when none is (Gemini hold, choice 9). */
+  private activityOpen = false;
+  /** The press held during a hold: its `activityStart`, still held, which a release without voice withdraws (Gemini hold, choice 7). */
+  private heldPress: HeldAction | null = null;
   /** The last frame parsed: `server.unreadable` is said on the ok → failing transition only (as Soniox's `stt.unreadable`). */
   private readable = true;
   /**
@@ -392,10 +396,18 @@
     // A release's tail still running ends first, and with it the last press's activity.
     this.tail.stop('press');
     this.turnOpen = true;
+    // During a hold the press waits its turn: its `activityStart`, and the audio after it, go when the hold lets go (Gemini hold, ruling 1; choice 7).
+    if (this.hold?.holding) this.heldPress = this.hold.defer(() => this.pressStart());
+    else this.pressStart();
+  }
+
+  /** A press on the wire: at once, or when a hold lets go of it. */
+  private pressStart(): void {
     this.turns.beginTurn();
     const ws = this.live();
     if (!ws) return;
     ws.send(ACTIVITY_START);
+    this.activityOpen = true;
     this.frame('out', 'realtime_input.activity_start');
   }
 
@@ -404,11 +416,24 @@
    * instead has `GeminiTurns` drop the cancelled press's own answer — never the one owed or still streaming, and
    * nothing on Live Translate (ruling 8, choice 16). On Live Translate, a release — a cancel too — first runs the
    * tail, inside the press's activity, and `activityEnd` goes when it ends (Gemini/AST2 follow-up, ruling 4;
-   * choices 11, 12).
+   * choices 11, 12). During a hold it waits its turn, but a cancel whose press is still held withdraws that press
+   * whole: it never reached the server, so nothing answers it and nothing is dropped (Gemini hold, choice 7).
    */
   private endTurn(cancelled: boolean): void {
     if (this.ended || !this.request.config.activity.manual || !this.turnOpen) return;
     this.turnOpen = false;
+    const held = this.heldPress;
+    this.heldPress = null;
+    if (!this.hold?.holding) {
+      this.pressEnd(cancelled);
+      return;
+    }
+    if (cancelled && held && this.hold.withdraw(held)) return;
+    this.hold.defer(() => this.pressEnd(cancelled));
+  }
+
+  /** A release on the wire: at once, or when a hold lets go of it. */
+  private pressEnd(cancelled: boolean): void {
     const ws = this.live();
     if (cancelled) this.turns.cancelTurn();
     // Owed only once `activityEnd` goes out: a release in a reconnect gap reaches no server, so nothing answers it.
@@ -420,6 +445,8 @@
       return;
     }
     this.activityEnd(ws, cancelled);
+    // A release with voice closes a turn the model answers: the hold begins. A cancel's closes none (Gemini hold, choice 3).
+    if (!cancelled) this.hold?.begin('activity_end');
   }
 
   /** The tail ended by itself, or by a press, audio or typed text: the press's activity ends now (Gemini/AST2 follow-up, choice 11). */
@@ -431,18 +458,35 @@
 
   private activityEnd(ws: WebSocket, cancelled: boolean): void {
     ws.send(ACTIVITY_END);
+    this.activityOpen = false;
     this.frame('out', 'realtime_input.activity_end', cancelled ? { cancelled: true } : undefined);
   }
 
-  /** Typed text (choice 17): its own source segment, then `realtimeInput.text`; wrapped in activity marks under manual turns with no press held. */
+  /**
+   * Typed text (choice 17): its own source segment, then `realtimeInput.text`; wrapped in activity marks under manual
+   * turns with no activity open on the wire. During a hold it waits its turn, whole — its row, its owed answer and its
+   * marks (Gemini hold, choice 8) — a hold carried across a lost connection included (choice 10).
+   */
   private appendText(raw: string): void {
     const text = raw.trim();
-    const ws = this.live();
-    if (!text || !ws) return;
+    if (!text) return;
+    if (this.hold?.holding) {
+      this.hold.defer(() => this.sendText(text));
+      return;
+    }
+    if (!this.live()) return;
     // A release's tail ends first, its activity with it, so the text's own marks never nest in it.
     this.tail.stop('text');
+    this.sendText(text);
+  }
+
+  /** Typed text on the wire: at once, or when a hold lets go of it. */
+  private sendText(text: string): void {
+    const ws = this.live();
+    if (!ws) return;
     this.turns.typed(text);
-    const wrap = this.request.config.activity.manual && !this.turnOpen;
+    // Read on the wire, not off the key: a held text can outlive a withdrawn press (Gemini hold, choice 9).
+    const wrap = this.request.config.activity.manual && !this.activityOpen;
     if (wrap) {
       ws.send(ACTIVITY_START);
       this.frame('out', 'realtime_input.activity_start');
@@ -452,6 +496,8 @@
     if (wrap) {
       ws.send(ACTIVITY_END);
       this.frame('out', 'realtime_input.activity_end');
+      // Its own turn close, which the model answers: the hold begins (Gemini hold, choice 3).
+      this.hold?.begin('activity_end');
     }
   }
 
@@ -479,6 +525,7 @@
     this.tail.cancel();
     // Not what a hold kept back: that, and what comes until the next connection is set up, goes up on that one (Gemini hold, choice 10).
     this.hold?.carry();
+    this.activityOpen = false;
     this.frame('in', 'session.reconnecting', {
       cause: why.cause,
       ...(why.code !== undefined ? { code: why.code } : {}),
@@ -512,10 +559,12 @@
       // Single-use: dropped, unless the new session has already issued another.
       if (handle !== null && this.handle === handle) this.handle = null;
       this.reconnecting = false;
-      // A press held across the gap starts again on the new connection (choice 14).
+      // A press held across the gap starts again on the new connection (choice 14) — unless its `activityStart` is
+      // still held: the carried hold sends it, once, before the press's audio (Gemini hold, choice 10).
       const ws = this.live();
-      if (this.turnOpen && ws) {
+      if (this.turnOpen && ws && !this.hold?.holds(this.heldPress)) {
         ws.send(ACTIVITY_START);
+        this.activityOpen = true;
         this.frame('out', 'realtime_input.activity_start');
       }
       this.events.reconnected();
```

- [ ] **Step 4: Run Gemini's suites and the session-side guard.**

Run: `npx vitest run src/providers/gemini src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 18 files, 346 tests. The landed push-to-talk cases on the 2.5 model and on Live Translate pass unchanged (no hold there), the Live Translate tail's among them: the wrap rule reads `activityOpen`, which a tail's end clears before any text. `turns.test.ts` is untouched and green: the held calls reach `GeminiTurns` in the order the landed cases already use.

- [ ] **Step 5: The gates.** The suite and the typecheck gate.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/gemini/adapter.ts src/providers/gemini/adapter.hold.test.ts src/providers/gemini/adapter.test.ts
```

```bash
git commit -q -F - -- src/providers/gemini/adapter.ts src/providers/gemini/adapter.hold.test.ts src/providers/gemini/adapter.test.ts <<'EOF'
feat(gemini): push-to-talk and typed text wait for a 3.x model's turn to end

On a 3.x dialogue model a release with voice, and typed text's own
marks, begin the hold. A press made while it holds waits: its
activityStart, audio and release go at turnComplete, in order, and a
press released without voice while its start is still held is withdrawn
whole, nothing sent. Typed text is held with its row, and its own marks
are read on the wire, not off the key. Across a reconnect a press whose
start is still held gets one activityStart, then its audio. Seeded
lifecycles cover both turn modes, and split releases.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check (controller, after Wave 3)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the replay at `ef2f61d3`: 573 files passed and 1 skipped, 7 446 tests passed and 2 skipped); the typecheck gate at exactly the baseline, 259 lines in the full tree.
- [ ] `npx vitest run src/services` green: the old clients are untouched (the replay: 49 files, 1 039 tests).
- [ ] `npm run build`, then `npm run extension:build`; `npx vitest run extension`.
- [ ] The three D24 greps print nothing.
- [ ] `command grep -rlF 'turn.hold_end' build extension/dist` names at least one file under `build/` and one under `extension/dist/`.
- [ ] No rendered check: nothing on screen changes without a live session — the hold shows only in the Logs, and only live. Record the numbers for Task 5.

---

### Task 5: The spec's amendments and the roadmap's record (controller)

The controller's docs task, after the group check. It edits only the spec and the roadmap, and commits them together. The Palabra plan's record has landed in both files, the spec's `frame` bullet among its edits: every anchor below is by heading and content, and the line numbers, read at `ef2f61d3`, are hints only — re-read each anchor before editing.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

- [ ] **Step 1: Amend the spec.** Each amendment is marked "(Stage 2 Gemini hold, ruling / choice N)" in the text, as the earlier plans' are:
  1. **"L0 — the client contract" → "What every adapter must honour", the `appendText` bullet** (`:309-320`): after "Gemini departs from this: text typed while its connection is down is dropped, with no segment (Stage 2 Gemini, choice 17).", add "On a 3.x dialogue model, text typed while its input is held waits, with its segment, until the hold lets go — across a reconnect too, where it goes up on the new connection (Stage 2 Gemini hold, choices 8, 10)."
  2. **The same section, the `frame` bullet** (`:324-359`): after "Gemini's `turn.tail` and `turn.tail_end`, OpenAI Translate's names, need none;", add "Gemini's `server.voice_activity`, `server_content.waiting_for_input`, `turn.hold` and `turn.hold_end` need none either (Stage 2 Gemini hold, choice 12);".
  3. **"Turns" → "What each provider can do", the Gemini row** (`:483`): Automatic turns → append "; a 3.x dialogue model holds the leg's input from the server's turn close (`voiceActivity` ACTIVITY_END, else the turn's first output, or its first input transcription on a session that has heard no voice activity) to its `turnComplete`, then sends it in order, the audio as one frame; an ACTIVITY_START lets a hold go, and a release lets one utterance go — up to its first pause after speech 100 ms past the session's own silence setting — holding the rest until the server has closed and answered it, or for 2 s without the close, longer when more went up; a reconnect carries it over (Stage 2 Gemini hold, rulings 1, 2, 4; choices 2, 4, 5, 10, 14, 15)"; Ending on release → append "; on a 3.x dialogue model the release's `activityEnd` begins a hold, and a press made while it holds waits for `turnComplete` (choices 3, 7)".
  4. **"Turns" → "The design", the Gemini row** (`:514`): `beginTurn` → append "; on a 3.x dialogue model during a hold, held, with its audio, until the hold lets go (Stage 2 Gemini hold, choice 7)"; `endTurn` → append "; on a 3.x dialogue model it begins a hold, and during one it is held (choices 3, 7)"; `cancelTurn` → before the Live Translate clause, add "on a 3.x dialogue model a press whose `activityStart` is still held is withdrawn whole — nothing sent, nothing to drop — and the owed flag's limit cannot arise while holds run, only after a hold let go at its cap or on a model that answers taps (Stage 2 Gemini hold, choices 7, 13);".
  5. **After the paragraph "A Gemini dialogue model gets no tail: …"** (`:522-526`), add: "**A 3.x dialogue model holds its input while it answers** (Stage 2 Gemini hold, ruling 1). It paces `turnComplete` to a simulated real-time playback of its answer, and input inside that turn cut the answer or lost its own start, so from the user's turn close to `turnComplete` the adapter holds the audio, a press's marks and typed text, and sends them in order at `turnComplete` or `waitingForInput` — not at `generationComplete`, and not at `interrupted`, whose trailing `turnComplete` lets go (choice 4). Its cap lets go 2 s past the model's computed playback end — the first audio's arrival plus all its audio — or 10 s after it began with no model audio, on the request's clock, and releases, never discards (ruling 3). A lost connection, a GoAway included, carries what is held to the new connection — with at most 5 s of the gap's own audio under automatic turns — which lets it go once set up, a press whose start is still held sent once; a stop drops it silently (choices 10, 11). Typed text's own marks are read on the wire (choice 9). Under automatic turns an ACTIVITY_START lets a hold go at once — the server is hearing speech that went up before it, and must hear its end — and a release lets one utterance go, the held audio up to its first pause after speech of at least `max(200, silenceMs + 100)` ms, the session's own end-of-speech silence plus a margin (an energy gate over the held audio finds it), holding the rest until the server's ACTIVITY_END for what went up, then to that answer's `turnComplete`, or for 2 s — half as long as the released audio plays when that is longer — without that END (ruling 4; choices 14, 15). 2.5 and Live Translate never hold (ruling 2). Probed for two utterances 1.57–2.47 s apart and, with ruling 4, for three Japanese sentences 0.8–1.5 s apart and a five-sentence monologue: every utterance translated whole in 10 of 10 sessions, at the default silence; noisy rooms, other voices, long monologues and other silence settings are the live test's."
- [ ] **Step 2: Write the roadmap's section.** Append `## Scheduled by the Stage 2 Gemini hold plan` as the roadmap's last section, after the Palabra plan's, in the earlier sections' form:
  - **What landed:** the plan's path and commit, the commit range and its `+/−` lines and files (from `git diff --shortstat`), the waves as run, each task's review rounds, the group check with its numbers; the plan's Revisions 1–4 (the review's three Important findings and nine Minor ones, the re-review's two, and the controller's rulings on them; ruling 4, from the owner's multi batches; the third re-review's two Important findings and four Minor ones, and the coordinator's rulings A–F on them); Task 5 is the record.
  - **Departures, stated:**
    - on a 3.x dialogue model the second utterance, and a press or typed text made while an answer plays, reach the server only when the answer's simulated playback ends — the translation of a quick second sentence starts later (the probes: clip 2's end → answer 2's first audio 0.94–2.6 s), where barge-in cut the first (ruling 1);
    - a typed row appears when it is sent (choice 8);
    - a tap during an answer is withdrawn, never sent (choice 7);
    - under automatic turns each utterance waits for the answer before it to finish its simulated playback, and a split waits for a close that may not come — 2 s, or half as long as the audio it let go plays — then merges (ruling 4; choice 14): in the owner's batch 2 the second and third of three sentences were translated 3.25–7.36 s after they ended, against 2.12–3.66 s for the hold without ruling 4 where it did not stall, and 0.9–1.5 s under barge-in, which cut answers;
    - the participant leg's next sentence waits through a phantom playback, and over a monologue whose translations run longer than the speech that follows, that lag accumulates, one utterance at a time — L(n+1) ≈ max(L(n) + A(n) − P − U(n+1) + c′, c) + f (choice 1);
    - a reconnect during a hold — a GoAway, which every connection gets about every 9–10 min, or a close — carries what is held, and input sent in the gap (under automatic turns up to 5 s of the gap's audio, the rest dropped as today), to the new connection, where today's gap drops it all (choice 10).
  - **Before any release from the branch:** the owner's live test below.
  - **The owner's live test** (own credentials; switch diagnostic logs on in Help before Start; each item names what settles it):
    1. **Overlap under automatic turns on 3.8 and 3.1** (ruling 1; choices 2, 4, 5): two sentences with speech pauses of 1.5–2.5 s: both transcribed and translated whole; the Logs read `server.voice_activity` ACTIVITY_END → `turn.hold` (`cause: 'voice_activity'`) → … `server_content.turn_complete` → `turn.hold_end` (`reason: 'turn_complete'`, `heldMs` close to `playbackEndMs`; a `keptMs` when sentence 2 and a pause after it were held, then `turn.hold { cause: 'split' }`, choice 14), and no `server_content.interrupted`; record the gap between the answers.
    2. **A long answer** (ruling 3; choice 5): a **non-repetitive** 15–20 s passage in one go (2f's thrice-repeated pair was translated once, as one ~4.5 s answer, and bounded nothing), then a sentence: the hold lasts to `turnComplete` — no `cap` — and the second sentence is translated whole; record the largest `heldMs` and `audioMs` (the burst's length).
    3. **Push-to-talk on 3.8 and 3.1** (choices 3, 7): press, speak, release; press again while the first translation plays: the second press's `realtime_input.activity_start` comes only after `server_content.turn_complete` and `turn.hold_end`; both translated whole; the owner's live log's cut gone (no `server_content.interrupted`).
    4. **A tap during an answer on 3.x** (choice 7): no `realtime_input.*` line for the tap; `turn.hold_end` reads `withdrawn: 1`; the answer plays whole, and the next press's answer shows.
    5. **Speakers, no headphones** (research note 5): automatic turns on 3.8 with the answer audible in the room, **on Windows, macOS and Linux, and with the output on a non-default device**: does the held echo come back after `turnComplete` as input — a source row of the model's own words, or a translation of its translation? Record, per run, the recorder's echo-cancellation setting as logged, whether an EchoNotice showed (and which: `tts-echo`, `self-capture`, `far-end-echo`, `routing-loop`), and whether releases still split — a `keptMs` on `turn.hold_end` — with the answer audible: the echo may leave the held audio no pause (choice 15).
    6. **The participant leg on 3.x** (choice 1): a remote speaker's **monologue of at least 1 minute**: every sentence translated whole; record each participant `turn.hold_end` `heldMs`, `keptMs` and `reason` (how many `split_timeout`) — the participant capture has no echo cancellation or noise suppression, and meeting audio may carry music or crosstalk, so a release with no `keptMs` there means the gate found no pause — whether the lag behind the speaker grows over the minute against choice 1's formula, and any `server_content.interrupted` inside a hold (item 10).
    7. **Typed text during an answer on 3.x** (choice 8): under push-to-talk, the row appears when the answer's playback ends, then its own translation, paired, and no `server_content.interrupted`.
    8. **2.5 and Live Translate** (ruling 2): no `turn.hold` line; the behaviour as before.
    9. **A turn with no answer** (ruling 3): a cough under automatic turns on 3.8, and **a voiced release under push-to-talk that the model neither answers nor completes**: record whether `server_content.turn_complete` (with its reason) or `server_content.waiting_for_input` lets the hold go, or `turn.hold_end` reads `idle` after 10 s — under push-to-talk that keeps the next press back up to 10 s.
    10. **`interrupted` near a hold, and the gap** (choices 4, 5, 14): any `server_content.interrupted` just after a `turn.hold` has one of two causes. **(a) Speech that reached the server before the hold began** (a pause of about 0.63–0.91 s plus the hold's 0.03–0.19 s, and the server needing 0.14–0.56 s of that speech; unseen in 54 probe sessions): the `turn.hold` came after live audio, with no `turn.hold_end` in the second before it, then `server.voice_activity` ACTIVITY_START — whose `audioOffset` lies in audio sent before the hold began — and `turn.hold_end` `voice_activity_start` at once. **(b) A split whose wait ran out before the server's close:** `turn.hold_end` `split_timeout`, then within about 0.1 s `server.voice_activity` ACTIVITY_END — its `audioOffset` seconds behind the audio sent — a `turn.hold` on it, an ACTIVITY_START and `server_content.interrupted` with no `generation_complete`, and that hold's end `voice_activity_start`. Record which, and the pause. **The gap, which ruling 4 ends:** a `turn.hold` begun on an ACTIVITY_END that arrived seconds behind its `audioOffset`, an ACTIVITY_START within about 0.3 s, then `turn.hold_end` with `reason: 'idle'` 10 s later. With ruling 4 that hold ends `voice_activity_start` at the START instead: an `idle` there is a regression — record it with the Logs around it.
    11. **A reconnect during a hold** (choice 10): wait for a GoAway (about every 9–10 min; `server.go_away` in the Logs) while a translation plays and you speak, and force a close (drop the network briefly): `turn.hold_end` with `reason: 'reconnect'` and `carried: true` after the new connection's `server.setup_complete`, and the utterance spoken across the gap translated whole; record the gap (from `session.reconnecting` to the new `server.setup_complete`), `audioMs` and any `droppedMs` — a `droppedMs` means the gap passed 5 s of speech, and whether 5 s is right; under push-to-talk, a press held across it shows one `realtime_input.activity_start` on the new connection, then its audio.
    12. **Several sentences under automatic turns** (ruling 4; failure modes (a) and (b)): three or more short sentences with pauses of about 0.8–1.5 s — across both the merge boundary and failure mode (a)'s band — and a short sentence right after a long answer, on 3.8, on 3.1 and on the participant leg: every sentence translated whole, one answer per sentence. The Logs read, per release, `turn.hold_end` with a `keptMs`, then `turn.hold { cause: 'split' }`; the server's ACTIVITY_START and ACTIVITY_END for what went up inside that hold; then `server_content.turn_complete` and its `turn.hold_end` `turn_complete`. Record every `split_timeout` (and whether an `interrupted` followed it) and the lag per sentence; the other signatures are item 10's, the gap's among them.
    13. **Typed text under automatic turns while speaking** (choice 8): type during an answer while talking: the release sends audio, then the text, then audio (Google documents no ordering across modalities) — a text typed after the pause waits with the next sentence (choice 14) — record whether the text's answer and the speech's come out whole and in order.
    14. **A noisy room** (choice 15): item 12 again with steady noise — a fan, a café recording — at a level the voice clears by less than 20 dB: record whether releases split (a `keptMs`), any `split_timeout`, and any `turn.hold_end` `idle`; without a split the release goes whole, and the START rule still ends any stall.
    15. **The Silence Duration slider** (choice 15): item 12 again with the slider at 300 ms and at 1 500 ms, on 3.8 and 3.1: record the `split_timeout`s — at 1 500 a split's pause is 1.6 s — and any `server_content.interrupted` inside a hold — at 300, a close under the split's 400 ms pause goes up with the next onset.
    16. **Long sentences** (choice 14): 3.1, and the participant leg, with sentences of 5–10 s and pauses of about 1 s: record each `split_timeout` against the audio its split let go (`audioMs − keptMs` of the `turn.hold_end` before it) — the wait is half that, at least 2 s — and any `interrupted` after one.
    17. **A hesitating reader** (choice 15): on 3.8 and 3.1, read sentences with pauses of 0.6–1 s inside them: record the `split_timeout`s, and whether one sentence comes back as two answers.
  - **Open questions for the owner:** a release without voice begins no hold (choice 3) — to revisit if item 4 or the Gemini section's item 6 shows 3.x answering empty activity; the held echo (item 5); a typed row shown late against one shown at once under the answering turn's origin (choice 8).
  - **Amend in place** (mark each "**Changed by the Stage 2 Gemini hold plan** (…)"), in the Gemini/AST2 follow-up section: live-test items 7 (3.8 overlap: speaking again within about a second no longer cuts a translation still generating — the hold), 13 (3.8 under push-to-talk: a press while the translation generates now waits), 15 (the model's own voice in the room: now held and sent after `turnComplete`; this plan's item 5), 16 (typed text on 3.x while an answer streams: held to `turnComplete`), 17 (a voiceless tap on 3.8 while an answer streams: withdrawn during a hold; the one-end path only past a cap) and 18 (on 3.8, typed text during an answer, then a tap: the text held, the tap withdrawn); its "What it leaves" item "The owed flag's limit on dialogue models" (cannot arise on 3.x while holds run, only after a cap or on a model that answers taps: choice 13); its open question "Barge-in's cost on 3.8 under push-to-talk" (answered: a press during an answer waits).
  - **The roadmap's inheritance, item by item,** **what it leaves** and **the open questions:** the three lists below, as landed.
- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec, roadmap): the Gemini hold's amendments and live test

A 3.x dialogue model holds its input from the user's turn close to its
turnComplete, under both turn modes, with an adaptive cap, carried
across a reconnect, and under automatic turns lets it go one utterance
at a time; the owner's live test and the items of the Gemini/AST2
follow-up it changes.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Taken (and where), or left (and why).

| Item | Disposition |
|---|---|
| The Gemini/AST2 follow-up section: live-test item 7, 3.8 overlap ("speaking again within about a second … cuts a 3.8 translation still generating") | met: the hold (Tasks 3, 4; ruling 1), and for several sentences under automatic turns ruling 4 (Tasks 1, 3) — every utterance whole in batch 2's 10 `turn2` sessions, pauses 0.8–1.5 s; failure mode (a) unseen in 54 sessions — live-test items 1, 10, 12 |
| Its item 13, 3.8 under push-to-talk (a press while the previous translation generates) | met: the press waits (Task 4; choice 7); live-test item 3 |
| Its item 15, the model's own voice in the room | changed: held and sent after `turnComplete` (research note 5); live-test item 5 |
| Its item 16, typed text on a 3.x model while an answer streams | met: held to `turnComplete` (Task 4; choice 8); live-test items 7, 13 |
| Its item 17, a voiceless tap on 3.8 while an answer streams | changed: withdrawn during a hold (Task 4; choice 7); the landed one-end path runs only past a cap |
| Its item 18, a double press (on 3.8: typed text, then a tap) | changed on 3.x: the text held, the tap withdrawn (choices 7, 8); on 2.5 unchanged |
| Its "What it leaves": the owed flag's limit on dialogue models | narrowed: cannot arise on 3.x while holds run, only after a cap or on a model that answers taps (choice 13); unchanged on 2.5 |
| Its open question: barge-in's cost on 3.8 under push-to-talk | answered: a press during an answer waits, nothing is cut |
| The research's release at `generationComplete` (its "Variant B") | not taken: the probe's `generation` policy left utterance 2's start untranslated (choice 4) |

## What this plan leaves

- **Failure mode (a): speech that starts just after the server's close, narrowed, not closed.** The server closes the user's turn 0.71–0.79 s after the speech (batch 2: 0.63–0.91 s) and the client begins the hold 0.03–0.04 s (3.8) or 0.12–0.19 s (3.1) later; speech that starts in that window reaches the server before the hold, and once the server has 0.14–0.56 s of it, its ACTIVITY_START can barge into answer 1 — on 3.8 more speech than the window lets through, on 3.1 a narrow band. Ruling 4's START rule changes what follows, not the cut: the hold lets go at the START instead of keeping that utterance's end to the idle cap. Unseen in 54 sessions; live-test items 10 and 12.
- **Failure mode (b) where a split's wait runs out first.** The gap and (b) came from a released burst that held the next utterance's onset; ruling 4 keeps that onset held until the server has closed and answered the utterance before it, but only for the split's wait. At the probe's 1.5 s, 4 of batch 2's 22 splits (all 3.1) ran out 50–90 ms before the close, and where the next onset went up then (2 of the 4), 3.1 cut the pending answer before any output and answered the two utterances together — whole, one answer for two. At 2 s, or half the released audio, all 22 are caught; what is left is a server that reads a released part slower than 3.1's 2.1× (the wait's scale), a close later than 2 s after a short one, and a START after a split's END that still belongs to its utterance (choice 14, departure 6). Live-test items 6, 10, 12 and 16.
- **A long released part on a pause the server never closes** waits half its length before the rest goes: a 16 s part, 8 s, with nothing but the hold's own cap to bound it (choice 14). Lag only, the rest merged; live-test item 16.
- **A Silence Duration under about 100 ms** puts the split's pause on its 200 ms floor, above the server's close: a burst can hold a close under 200 ms and the next onset — (b), at a setting no probe used (choice 15). Only the default, 500, is measured; live-test item 15.
- **The gate's ground.** Ten sessions (batch 2's `turn2`) of clean speech from two TTS voices, with digital silence between sentences (choice 15). A noise floor within 20 dB of the voice, other voices, or the answer's echo in held audio can leave no pause to find: the release then goes whole, as under ruling 1 alone, and the START rule still ends a stall. A speaker who pauses past the split's pause inside a sentence — 600 ms at the default — is split there: the server closes on it only where it would have live; else the split's wait, then a merge. Live-test items 5, 6, 12, 14 and 17.
- **The lag ruling 4 costs** (choice 1; the departures): every utterance waits for the answer before it to finish its simulated playback, so on a monologue whose translations run longer than its sentences the lag grows by sentence, up to 7.36 s in batch 2's sentence-after-a-long-one case. No bound but a long pause; Live Translate for monologues.
- **A missed ACTIVITY_END** leaves the server's speaking state set: neither fallback begins a hold for that model turn or the next, which fall back to barge-in, until the next ACTIVITY_END recovers it (choice 2; the review's scenario S3). A split's hold whose END is missed lets the rest go after its wait.
- **A `turnComplete` lets go of whatever hold is on,** even one begun for a later turn. Reachable only after a cap let a hold go before its `turnComplete`, or after a tap's answer on a model that answers taps (choice 3): the next hold may then end early, and a press during it barges in as it did before this plan.
- **A model that sends no voice activity** keeps the input-transcription fallback, and with it the risk of a late transcription beginning a hold that waits for the idle cap; no 3.x model is such a model (choice 2).
- **A model that stalls mid-answer** longer than the audio it has sent plus 2 s is let go of by the cap before `generationComplete`, and may be cut truly (choice 6).
- **The probe keeps its own hold** (`scripts/dev/wire-probe/gemini-hold.mts`), a research instrument with its own policies; the adapter's `InputHold` is not shared with it.
- **The seeded lifecycles run the 3.x model only:** 2.5 and Live Translate still rest on the conformance scenarios and their own suites.
- **Trimming a held burst while the echo monitor reports `tts-echo`** — a later option if item 5 shows the held echo translated; outside this plan.
- **A pending indicator for held typed text** — the cheap UX follow-up to choice 8's late row.
- **Manual turns driven by a client VAD** (the research's §2.8) — only if the live test shows no reliable turn close.
- **Google's "playback status reporting"** (`turnComplete`'s doc), which could shorten the simulated playback, has no client field in the reference or SDK 2.24.0; a lever if Google ships it.
- **The owed flag's limit after a cap, or on a model that answers taps** (choice 13) keeps the landed rules; whether a count should replace the flag is still the follow-up's open question.

## Open questions for the owner

- **The participant leg** (choice 1): **decided 2026-09-29 — the owner: 「参会方要暂存」.** It keeps the hold, knowing its lag can accumulate over a monologue (the formula in choice 1, one utterance at a time under ruling 4); Live Translate, the default, is the no-turn option for monologues.
- **The probe batch before the live test** (the review's fix 6): **run by the owner on 2026-09-29 (「补一个探针我帮你跑」), twice** — batch 1, 24 sessions, and batch 2, 30, Japanese only; its results are ruling 4 (「按turn2改计划」).
- **`SPLIT_END_MS`** (choice 14): **decided — `SPLIT_END_MS` is 2 000 — coordinator's ruling: at 1 500 all four batch-2 timeouts were 3.1 closes landing at 1 561–1 611 ms; at 2 000 they are caught and nothing else changes (re-review 3, §3).** The wait also grows with the audio a split let go (the coordinator's ruling C), and the split's pause follows the session's Silence Duration (ruling B); live-test items 12, 15 and 16 count the `split_timeout`s.

## Self-review

- **Brief coverage.** The owner's decision: rulings 1 and 2 — automatic turns (Task 3: ACTIVITY_END, then the fallbacks), push-to-talk (Task 4: the hold at the release's `activityEnd`; a press deferred until `turnComplete`, then `activityStart`, the held audio and `activityEnd` if released), 2.5 and Live Translate unchanged, the follow-up's ruling 5 kept. The cap: ruling 3, the owner's, with its three tests (a long answer past 8 s, a short one at its computed end, no audio at 10 s). Every decision the brief asked for is a numbered choice: begin and release signals and their order (2, 3, 4), a cancelled press (7), typed text (8, 9), `interrupted` during a hold (4), reconnect (10), stop (11), the cap's details (6), the frames (12), karaoke and the owed flag (13), the participant leg (1). `sessionSide.consistency.test.ts` lists `hold.ts` (Task 3), its hunk anchored on Gemini's roster lines, above Palabra's. A Gemini lifecycle harness: cheap, taken (Task 4). The spec's amendments and the roadmap's record: Task 5. Ruling 4 (Revision 3, below): choices 14 and 15.
- **Revision 1** (the independent review: Ready after fixes, Critical 0, Important 3, Minor 9; the controller's rulings, 2026-09-29):
  - **I1** (the evidence covers two utterances with long pauses): the research notes state the clip gaps and the speech gaps, and that the hold always began before utterance 2; the Goal says what was probed; choice 4's window is corrected; "What this plan leaves" states failure modes (a) and (b), and the burst split as the follow-up only if (b) shows; live-test item 10 names both causes of an `interrupted` inside a hold and how to tell them apart, and item 12 (several sentences) is new; the optional probe batch is an open question, not a task.
  - **I2** (a late input transcription stalls input 10 s): the input fallback is off once any voice activity has come (`heard`, kept across a reconnect); `hold.test.ts` pins it both ways across a lost connection; Task 3 pins the review's scenario S1; choice 2's risk rewritten; the "late input transcription" bullet of "What this plan leaves" dropped.
  - **I3** (a GoAway during a hold dropped the next utterance's start): the controller's choice (b) — a reconnect carries the hold to the new connection (choice 10), a press whose start is still held sent once there (Task 4); tests first: a GoAway and a close carry the audio (Task 3), a press held across sends one `activityStart` then its audio (Task 4), a stop during the reconnect sends nothing (Task 3); choice 10, the departures and live-test item 11 name GoAway and its 9–10 min cadence.
  - **Minors:** 1 — the cap is ruling 3 and left the open questions, its code citations "ruling 3"; 2 — re-anchored at `ced275ae`, the counts re-measured, Palabra's Task 15 noted; 3 — the lifecycle's `after` flags any `realtime_input.*` frame during an open hold; 4 — the press-still-held case looks at the wire before `turnComplete`; 5 — a missed ACTIVITY_END stated; 6 — choices 3 and 7 listed as departures below; 7 — live-test items 2, 5, 6, 9, 11 and 13 and the open questions; 8 — 2f described as no cut, the repeats collapsed; 9 — the participant lag's formula in choice 1 and the departures; and choice 13 names the tap's-answer `owedNext` case.
- **Revision 2** (the re-review: Ready after fixes, Critical 0, Important 1, Minor 1; the controller's rulings, 2026-09-29):
  - **New-1** (the carried gap had no bound): under automatic turns a carried hold keeps at most `HOLD_CARRY_MS` = 5 000 of the gap's audio — its first, a straddling chunk trimmed — drops the rest as today's gap does, keeps what it held before the loss and its held sends whole, and says `droppedMs`; push-to-talk is not capped. Tests first: the pure bound and push-to-talk's absence of one (Task 1), a slow ladder's burst of the held start plus 5 s (Task 3), a press held across a 7 s gap keeping it all (Task 4). Choice 10, choice 12, the departures and live-test item 11 say so.
  - **New-2** (failure mode (a)'s window): pauses of roughly 0.92–1.1 s, not 1.0–1.4 s; the timing figures corrected in the research notes, choice 4, live-test item 10, "What this plan leaves"; item 12 and the probe batch widened to about 0.8–1.5 s, across both the merge boundary and (a)'s band.
- **Revision 3** (the owner's ruling 4, 「按turn2改计划」, 2026-09-29, on his multi batches; the controller's brief):
  - **(ii), a new start lets go:** `InputHold.voiceActivity` lets a hold go at an ACTIVITY_START under automatic turns, unsplit, `reason: 'voice_activity_start'` — not a split's own hold, not under push-to-talk, and between `interrupted` and its `turnComplete` at that `turnComplete` (found while writing, note 1). Tests first, each red on Revision 2's code: the gap's own timings (a hold, a START 10 ms later); push-to-talk untouched (green there too, as it must be); the START behind an `interrupted` (Task 1) and its typed text pairing with its own answer (Task 4).
  - **(iii), one utterance per release:** `finish` splits a release at `turnComplete`, `waitingForInput` or a new connection, under automatic turns on a session that has heard voice activity, at the first entry after a pause of `SPLIT_PAUSE_MS` = 600 that follows speech (Revision 4: `max(200, silenceMs + 100)`); the rest waits in a `split` hold for the server's ACTIVITY_END, which that hold consumes, for `SPLIT_END_MS` = 1 500 (Revision 4: 2 000, or half the released audio); the gate mirrors the probe's `splitAt` (`GATE_FRAME_MS` = 10, `GATE_PEAK_DIVISOR` = 10) with its frames across chunks; `turn.hold_end` gains `keptMs`. Push-to-talk splits nothing — its own marks already end each utterance (choice 14). Tests first, each red on Revision 2's code: the split and its wait, its timeout, held audio ending in the pause, no pause, the 600 ms boundary, held sends on either side of the pause, which releases split, a lost connection during a split's wait, the gate's ratio and cross-chunk frames (Task 1); batch 2's two sessions replayed through the adapter on their own timings — 3.8 at 1 100 ms, three answers one per utterance where the first rule stalled on the idle cap, and 3.1's monologue, two waits run out and the late ENDs' holds let go by the next START (Task 3; Revision 4 replays it to its first END, which the 2 s wait catches).
  - **The lifecycle harness:** the kit's audio has no pause, so a chunk in three becomes a 700 ms silence, and `after` checks that a split's hold follows at once and only the release that kept something, that a START never ends a split's hold and only a split's hold times out, and that push-to-talk never splits; the test requires splits, split timeouts and START releases to happen (Task 4).
  - **The rulings kept, rechecked:** the adaptive cap (choice 6), the participant leg's hold (choice 1), the carry and its bound (choice 10), 2.5 and Live Translate (ruling 2); `waitingForInput`, typed text, presses, stop and the owed flag (choices 4, 8, 11, 13, 14).
  - **Corrections:** the server's close is 0.71–0.79 s after the speech (the multi batches; 0.63–0.91 s in batch 2), not 0.92–0.96 s, which was measured to the end of a clip's tail; failure mode (a) was not seen in 54 sessions; "What this plan leaves" now says what ruling 4 leaves of (a) and (b); live-test items 10 and 12 carry the gap's signature, item 14 is new; the departures state the lag.
  - **Re-anchored** at `ef2f61d3` (the Palabra record, a Palabra fix touching the kit's comments and one failure line, this plan's own two commits, the probe's `multi` mode); replayed there whole, the counts re-measured.
- **Revision 4** (the third re-review: Ready after fixes, Critical 0, Important 2, Minor 4; the coordinator's rulings A–F on it, 2026-09-29):
  - **A — `SPLIT_END_MS` is 2 000** (the open question, ruled): the constant, its pin, the split cases' elapsed times read from it, and the timeout case's END made synthetic (70 ms after the wait, the shape batch 2 showed at 1.5 s); the 3.1 monologue replay now runs to its first split's ACTIVITY_END, which the split's hold consumes 1 582 ms after the split, inside the wait — the session's later messages answered what the probe's 1.5 s timeout sent, so the replay stops there; every prose line that said 1.5 s. Research note 5 of the multi batches stays as history.
  - **B — the split's pause follows the session's silence** (Important 1): `InputHold` takes `silenceMs` under automatic turns (`InputHoldOptions` is a union on `manual`), and the pause is `splitPauseMs(silenceMs)` = max(200, silenceMs + 100) — 600 at the default, so batch 2's replays are unchanged; choice 15 states the direction of error and that only the default is measured; "What this plan leaves" names the floor's gap under a `silenceMs` of about 100; live-test item 15. Tests first: 50/500/1 500 → 200/600/1 600, and a 700 ms pause that splits at 500 and not at 1 500 (Task 1); the session's Silence Duration reaching the split through the adapter (Task 3).
  - **C — the split's wait grows with what it let go** (Important 2): `max(SPLIT_END_MS, ceil(sentMs / 2))`; choice 14 and "What this plan leaves" state the unbounded case (16 s released, 8 s waited); live-test item 16. Test first: 8.8 s released waits 4.4 s, an END at 3.9 s consumed (Task 1).
  - **D — two pieces of stale state** (Minor 2): content — `output()` or `input()` — clears the `interrupted` mark, and `waitingForInput` ends the model's turn before it lets go. Tests first: an `interrupted` with no `turnComplete`, then content, then a START during a hold, let go at once; `waitingForInput`, then the split's hold capped from a fresh turn, at 10 s (Task 1); Task 3's fallback case now says `waitingForInput` ends the model's turn, and lets a cap release first to show one hold per model turn.
  - **E — a split's hold lets a START go once its END has come** (Minor 3): the exemption holds only while the split awaits its END; departure 6 from the probe, stated with what it costs if wrong (choice 14). Test first: a split, its END, then a START — let go at once, not at the idle cap (Task 1). The lifecycles' `after` now lets a START end a split's hold only after an ACTIVITY_END frame since it began, and flags a split's hold that times out after one.
  - **F — the live test** (Minor 4): items 15 (the slider at 300 and 1 500 ms), 16 (long sentences on 3.1 and the participant leg, timeouts against the audio let go) and 17 (a hesitating reader); item 6 says a missing `keptMs` on the participant leg means the gate found no pause.
  - **Found while doing it:** Revision 3's "push-to-talk splits" mutant had been caught only by the seeded lifecycles' push-to-talk pauses; the push-to-talk case in `hold.test.ts` now hears voice activity first, so it catches it alone, and the lifecycles keep their pauses under push-to-talk.
- **Revision 5** (the fourth re-check: Ready after fixes, 0/0/3; the coordinator's rulings, 2026-09-29):
  - **M1:** choice 2's missed-END sentence now says "after its wait (2 s, or half the audio it let go)", as "What this plan leaves" does.
  - **M2 — content means what `GeminiTurns` means.** `GeminiTurns` clears `interruptedEnd` on a non-empty input or output transcription, playable pcm (at the leg's own 24 kHz, non-empty) or non-empty model text (`turns.ts` `input`, `output`, `audio`, `modelText`). `onModelTurn` now tells the hold whether a part is such content; a thought, audio that will not decode and audio at another rate are not, so they neither clear `cut` nor begin the model-output fallback. The review's paraphrase — any audio or text — would have counted foreign-rate audio, which `GeminiTurns` does not play and so does not count; the cap still counts that audio (choice 6), so the adapter calls `output(audioMs, false)` for it rather than skipping the call (a departure in form from "call it only for content"). Test first, red on Revision 4's code, beside departure 3's case (Task 4): the reviewer's Y1 shape with a thought, an undecodable part and a 16 kHz part in turn between `interrupted` and a START — the text goes at the trailing `turnComplete` and pairs with its own answer.
  - **M3 — a split's wait outlasts `waitingForInput`.** `waitingForInput()` does nothing while the hold is a split awaiting its END (choices 4, 14). Test first, red on Revision 4's code (Task 3): the reviewer's Y2 shape — a held utterance end, a 700 ms pause, an onset, then one frame `{ turnComplete: true, waitingForInput: true }` — the onset stays held until the split's 2 s wait lets it go.
  - **Mutants:** the hold told every model part is content (M2), content read as any audio or text (the paraphrase), and `waitingForInput` releasing a split that awaits its END (M3) — each caught; Revision 4's twenty-seven rerun on the new code, all caught.
- **Placeholders.** None: every code block is the tested scratch copy's file or diff. The constants' values appear once each, in `hold.ts` (`HOLD_MARGIN_MS` = 2 000, `HOLD_IDLE_MS` = 10 000, `HOLD_CARRY_MS` = 5 000, `SPLIT_PAUSE_MARGIN_MS` = 100, `SPLIT_PAUSE_FLOOR_MS` = 200, `SPLIT_END_MS` = 2 000, `GATE_FRAME_MS` = 10, `GATE_PEAK_DIVISOR` = 10), and are pinned once, in `hold.test.ts`'s first case; the first three are read by name everywhere else — the first two set to 3 000 and 12 000 in the scratch copy, only that pin failed, so an override is a line each and the pin (the carry cases' figures are 5 s of 24 kHz audio, computed from `HOLD_CARRY_MS` in the burst lengths). Ruling 4's five are read by name where a case waits on them — `SPLIT_END_MS` in every split's wait and elapsed time — but the split cases' 590/600/700 ms pauses at the default silence, `splitPauseMs`' 200/600/1 600, the 8.8 s part's 4.4 s wait, the gate's floors of 100 and 101 against a voice at 1 000, and the two replays' outcomes pin the ruled values themselves: changing one is a ruling, and moves those cases with it. The one template is the commit messages' `<implementing model>`, which Global Constraints says to fill in; Task 5 fills its numbers from the run.
- **Type consistency.** Checked in the scratch copy, where every file compiled at the gate after every wave: `InputHold`, `HeldAction`, `HoldSummary` (with `carried`, `droppedMs` and `keptMs`), `HoldCause` (with `split`), `HoldEnd` (with `voice_activity_start` and `split_timeout`), `HOLD_MARGIN_MS`, `HOLD_IDLE_MS`, `HOLD_CARRY_MS`, `SPLIT_PAUSE_MARGIN_MS`, `SPLIT_PAUSE_FLOOR_MS`, `splitPauseMs`, `InputHoldOptions` (with `silenceMs` under automatic turns), `SPLIT_END_MS`, `GATE_FRAME_MS`, `GATE_PEAK_DIVISOR`, `holding`, `voiceActivity`, `input`, `output`, `interrupted`, `turnComplete`, `waitingForInput`, `begin`, `audio`, `defer`, `holds`, `withdraw`, `carry`, `reconnected`, `cancel`, `output(audioMs, content)`, `GeminiServerMessage.voiceActivity`, `SERVER.voiceActivity`, `SERVER.generationComplete`, `SERVER.waitingForInput`, `activityOpen`, `heldPress`, `pressStart`, `pressEnd`, `sendText` — each spelled the same in every task that names it.
- **Mutants tried in the scratch copy,** each failing at least one test: the cap's clamp removed; a release at `interrupted`; the speaking guard removed; the model turn's audio forgotten after the release instead of before; held audio not copied; a withdrawal keeping the press's audio; `begin` without its guard (the seeded lifecycles catch it too); an output transcription beginning no hold; model audio counted at 24 kHz whatever its rate; stop without `hold.cancel()`; the wrap rule read off the key; no `activityOpen` reset on a reconnect; a release without voice beginning a hold; and, in Revision 1: the input fallback ignoring `heard`; `heard` forgotten on a lost connection; the cap left running across a lost connection; the ladder never letting a carried hold go; the ladder restarting a press whose start is still held (and the lifecycles' new line flags it); a press never deferred (the lifecycles' new line, as the review found); the summary never saying `carried`; and, in Revision 2: no carry bound (Revision 1's code); the bound applied to push-to-talk too; a chunk straddling the bound dropped whole instead of trimmed; and, in Revision 3: no START release at all; a split's hold let go by a START; a START letting a push-to-talk hold go; a START between `interrupted` and its `turnComplete` letting go at once; `turnComplete` leaving that `interrupted` mark set; no split at all; the cap and the idle cap splitting; a split's timeout splitting again; push-to-talk splitting; a split on a session that has heard no voice activity; the awaited END leaving the split's wait running; a lost connection leaving it running; stop leaving it running; held audio that ends in the pause beginning no hold; a send held after the pause going with the utterance before it; the gate framing each chunk alone; the gate counting a frame at a tenth of the peak as speech; a pause needing more than 600 ms; and, in Revision 4 (with Revision 3's rerun on the new code, and re-review 3's R1–R6: a START releasing a split's hold before its END, a START between `interrupted` and its `turnComplete` letting go at once, no split on a new connection, a held send neither breaking the gate nor marking a split point, the probe's per-chunk framing, a split's wait running while carried): a split's hold ignoring every START, after its END too (ruling E); the wait back at 1 500; the pause fixed at 600; the pause with no floor; the wait fixed whatever went up; content leaving the `interrupted` mark set; `waitingForInput` keeping the model turn; the adapter handing the hold 500 whatever the session's silence; and, in Revision 5: every model part heard as content; content read as any audio or text, foreign-rate audio included; `waitingForInput` releasing a split that awaits its END.
- **Choices made inside the rulings:** 1–15, listed above; each is cited where it lands.
- **Departures, stated in the plan:** a quick second sentence on 3.x reaches the server only after the answer's simulated playback (ruling 1); a typed row appears when it is sent (choice 8); a tap during an answer is withdrawn (choice 7); the participant's next sentence waits through a phantom playback, and that lag can accumulate (choice 1); a reconnect during a hold carries what is held and the gap's input to the new connection — under automatic turns at most 5 s of the gap's audio (choice 10); under automatic turns each utterance waits for the answer before it, and a split waits for a close that may not come — 2 s, or half the audio it let go (ruling 4; choice 14).
- **Departures from the brief:** the cap is the adaptive rule with two constants, not `HOLD_MAX_MS` (ruling 3, the owner's); `waitingForInput` also lets go (choice 4), as the probe's `turn` policy did; a release without voice begins no hold, where the brief's wording has the hold begin at "our own `activityEnd` … (a release)" (choice 3); a press released without voice during a hold is withdrawn, where the brief's wording has a deferred press "then send `activityStart` + held audio (+ `activityEnd`…)" (choice 7); the input fallback is off on a session that has heard voice activity, where the brief lists it as a fallback (choice 2; the controller's ruling on the review); the wrap rule of typed text now reads the wire (choice 9) — needed once a text can be held inside a press that is withdrawn (research note 3); the landed barge-in tap case is driven past the cap (research note 4). From the probe's `turn2`, which ruling 4 adopts: a release on a new connection splits too; a split waits only on a session that has heard voice activity; a START between `interrupted` and its `turnComplete` lets go at that `turnComplete`; a send held after the pause waits with the next utterance; a split's hold lets a START go once its END has come (the coordinator's ruling E) (choice 14); the gate's frames run across chunks (choice 15). None changes a decision on batch 2's sessions. The coordinator's rulings also set the split's wait — 2 s, or half the audio let go, where the probe waited 1.5 s: batch 2's four timeouts become closes caught — and its pause from the session's silence setting, the probe's 600 at the default (choices 14, 15).
