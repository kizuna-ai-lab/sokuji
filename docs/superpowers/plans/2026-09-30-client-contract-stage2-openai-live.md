# Client contract — Stage 2, provider 8: OpenAI Live (`openai_live`, own key, WebSocket through the header seam)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–9 are **the owner's decisions** (2026-09-30, in conversation): he answered the survey's nine questions 「1-9 按推荐」, and the owner's wire probe, run with his key the same day, settled questions 2, 3 and 5 before he answered. Each ruling is restated below with the probe results behind it and where it lands. Where a ruling left a sub-decision to this plan, the answer is a numbered *choice*; the self-review lists each. This plan runs **after** the Stage 2 session-end and wizard plan (`2648b390`, landed as `55e4a192`…`7c96f2ac`, recorded by `04ba9b28` and `6093ca87`, and its fix `a3eab634`): it consumes that plan's kit rule (a frame may follow an ending until `stop()` has returned), its `session.close` pattern for OpenAI Translate, and `textInput(s)` (`b5153784`).
>
> **Revision 1** (this version) answers the independent review of the first version (`e98b90be`; `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/openai-live-plan-review.md`: Ready after fixes, 0 Critical, 2 Important, 6 Minor, 6 Nit) with the rulings in `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/openai-live-plan/revision1-rulings.md`. Two are **the owner's**, new rulings 10 and 11: Live's source is cut only at a timeline pause of at least the source pause (「C：停顿 ≥1.5 s 才换行」, the review's I2), replacing the old client's 600 ms / 4 s rule in `segments.ts` alone; and the extension's startup sweep also removes the old client's rule id 4000 (「启动时一并清掉」, the review's M5). The rest are **the controller's**: a push-to-talk tap no longer reads as a stall (I1); the seam lets its gate go when a registration never answers (M1); the sender check reads the pages' base from the browser (M2); two live-test items corrected (M3, M4); the group check's grep (M6); and six nits (N1–N6). "Found in review" (research notes) lists each with where it lands; the self-review lists the case and the mutant that pin it. The whole plan was replayed again on a fresh copy of `a3eab634` and every count below is Revision 1's.

**Goal:** OpenAI Live — `gpt-live-1`, a simultaneous interpreter made one by its instructions — with the user's own key (`openai_live`) on the new contract, on the desktop app and the extension, so the owner can run it live. Concretely:
- **F14, the header seam, built at its first user** (ruling 7): the Live endpoint takes the key only as a real `Authorization: Bearer` upgrade header and refuses any `Origin` (U9), which no browser socket can do. Three parts, each with its own tests:
  - Electron: a path-aware, one-shot rule module (`electron/ws-header-rules.js`) inside `main.js`'s one `onBeforeSendHeaders` listener, a host-wide rule behaving as every rule did before (choice 2);
  - the extension: a generic `WS_HEADERS_SET` / `WS_HEADERS_CLEAR` pair in the background worker, answering only the extension's own pages (their base read from the browser), scoped by path and to the extension, swept at start with the old client's rule id 4000 (ruling 11); the old `OPENAI_LIVE_*` pair untouched (choice 3);
  - the renderer: `OpenHeaderSocket` in `src/lib/contract/headerSocket.ts` — asynchronous, one upgrade at a time per host and path, bounded, clearing its rule before it lets the next leg in, a registration that never answers included, in fixed words — with `platformHeaderSocket` and the kit's `fakeHeaderSockets` (choice 1).
- **The provider** in `src/providers/openai_live/`: settings, builder, a model-list check, the hand-typed wire, the segments, the adapter, its view and definition; `platforms: ['electron', 'extension']` — the first definition without the web — `speech: 'optional'` (ruling 1), `textInput: () => false`, registered after OpenAI Translate (ruling 9).
- **Pairing stated by the translation cuts module** (ruling 3): `ContinuousSegments` holds both sides; the source is cut at a pause of at least the source pause on the input's timeline (ruling 10; choice 6), every N sentences by sentence (ruling 4; choice 7), capped at 8 s and 12 s; the translation is cut where its source was, stating it. The module gains three small members for an adapter with its own source rules and a connection that can be lost (choice 5).
- **Karaoke on the output's timeline** (ruling 2): each voiced audio frame placed on the output's sample clock and given the characters its window's stamps cover — real ranges under D4, computed as the frame arrives (choices 9, 10).
- **Push-to-talk by mute** (ruling 5): a release sends `session.input_audio.mute` and stops the appends, a press `session.input_audio.unmute`; no tail.
- **One reconnect, then `connection_lost`**, the 60 s grace, the stall watchdog armed only by 2 s of voiced audio sent between two equal usage reports — so a push-to-talk tap is none — an actionable error failing in its own words (ruling 6; choice 14); **Stop** sends `session.close` and closes at once; the session's expiry ends the run (ruling 8).
- **Lifted at their third user** (ruling 9): OpenAI's server-event decoder and error words (`src/lib/provider/openaiWire.ts`) and its model-list check (`src/lib/provider/openaiModels.ts`); OpenAI Translate and OpenAI Realtime re-export them (choice 4).
- **Regression fixtures from the owner's recorded sessions** and replay tests through the real `segments.ts`, L1 and L2: the pairing under ruling 10, U4's karaoke, and the karaoke across the mute gap (choice 18).

It ends with the controller's group check — builds, the extension suite, the D24 greps, a render check of Live's tab on a faked desktop platform with no request to OpenAI (choice 19) — and the controller's docs task with the owner's live test (Task 11). **The old Live code stays compiled and unreachable** (`OpenAILiveClient`, `OpenAILiveProviderConfig`, its store slice's prefill, the background's `OPENAI_LIVE_*` pair): its deletion is a later plan, after the live test (Task 11 records the inventory).

**Architecture:**
- **F14 is three modules behind one interface.** `OpenHeaderSocket(url, { set, remove }, { signal, clock }) → Promise<WebSocket>` (`src/lib/contract/headerSocket.ts`). The rule's key is the URL's host and its path to the last `/` (`api.openai.com` + `/v1/live/`). Per key, process-wide in the renderer, one leg registers and upgrades at a time: the rule goes in, the socket is made, and at the socket's first `open`, `error` or `close` — or an abort, or the 15 s bound — the rule is cleared, and only then is the next leg let in. The platform's part is a `HeaderRegistrar` — Electron's `ws-headers-set` / `ws-headers-clear` invoke (a path now sent), the extension's runtime message — or none on the web, which refuses. `electron/ws-header-rules.js` and `extension/background/wsHeaderRule.js` are pure and tested; `main.js` and `background.js` call them.
- **One folder,** `src/providers/openai_live/`:
  - the definition's data — `settings.ts` (`S`, the 22 voices, the 55 languages, `K`, the model family), `config.ts` (`C`, `build`, `describe`), `check.ts` (the lifted model list, Live's family);
  - the session side — `wire.ts` (the URL, the upgrade headers, the client frames, the server events typed by hand; pure), `segments.ts` (deltas and audio → segments over `ContinuousSegments`; pure, on the request's clock), `adapter.ts` (one leg over the seam);
  - `LiveSettings.tsx` and `provider.ts`; `testing.ts` holds the suites' fixtures and harness; `recordings/` three generated JSON fixtures.
- **Shared pieces changed:** `ContinuousSegments` gains `cutSource()`, `translationContinues(text)` and `closeAll()` (choice 5); the recordings' replay harness carries a delta's stamps and returns the leg L1 holds at the end (choice 18); OpenAI Translate's and Realtime's `wire.ts` and `check.ts` re-export the lifted helpers (choice 4); the registry and its order tests.
- **No contract change.** `src/lib/contract/adapter.ts`, `events.ts`, the runner, L1, L2, `shape.ts`, `src/lib/provider/types.ts` and the stores are read, not changed: Live needs no hook, no `startBoth` (two sessions on one key work, U11), no new event, and no locale key (`providers.openai_live.*` exist).

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, Vitest + @testing-library/react (jsdom), the adapter test kit (`FakeSocket`, `fakeSockets`, `runScenario`, `runLifecycles`, `trackedClock`, `createVirtualClock`, `flush`, `recordEvents`) and its new `fakeHeaderSockets`, the recorded-session replay (`replay.testing.ts`), L1 (`Conversation`) and L2 (`createProjector`), a stub `fetch` answering `Response` objects, the TypeScript compiler API for the wire's key scan, CommonJS `require` in the Electron suite, headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`) at the group check.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended through the session-end and wizard plan's record. The parts this plan implements: "L0 — the client contract" and "What every adapter must honour" (the `frame` bullet as the session-end plan amended it); "Turns" (Live's two rows, which it amends); "Provider capability" (Live's row); "The provider definition" → "Sockets that need upgrade headers" (F14, which it builds and closes) and "What adding a provider then touches" (Live's sentence); "Session lifecycle" (the reconnect paragraph; "Legs rise and fall together"'s serialization sentence); "Migration" item 9. Task 11 amends each.

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-openai-live-survey.md`, cited as *survey §x*: §1 the old implementation as protocol documentation, §2 the mapping onto the new contract, §3 the unknowns, §4 the nine questions, §5 the outline, §6 the spec statements it shows wrong. Its brief: `…/tmp/stage2-openai-live-brief.md`. `OLC` = `src/services/clients/OpenAILiveClient.ts`, `OLPC` = `src/services/providers/OpenAILiveProviderConfig.ts`.
- **The probe:** `scripts/dev/wire-probe/live.mts` (`2b9d891a`, `43437057`), run by the owner with his key on 2026-09-30. Its results table, U1–U13, is `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/live-probe/results.md`, cited as *U<n>*; its raw logs are `.superpowers/wire-probes/openai-live/` in the worktree (git-ignored): `report.md`, one `.jsonl` per run (arrival `t` in ms, direction, event type, the event's fields — the audio as `samples` and `rms`, never pcm) and the pcm. No key appears in any of them.
- **Found while writing** (at `a3eab634`, in the scratch copy; each is where a rule below comes from):
  1. **Two clocks, not one.** An input delta's `start_ms` / `end_ms` stand on the session's clock (0 at `session.started`); an output delta's stand on the output's own sample clock — every output frame's samples, the noise floor's included, ÷ 24, from the session's first output frame, which came 1.9 s after `session.started` on the timeline run. `live.mts` computes U4 on that sample clock (`karaoke()`), and U5's "translation follows the source's cuts" on arrival (`translationFollows`). So the stamps cannot compare a translation with its source; the arrival clock — the request's — is the one both sides share, and is the module's guard clock as it stands (ruling 3; choice 6).
  2. **The text leads its audio.** On the sample clock a delta's words are spoken after the delta arrived: 295 of the timeline run's 315 voiced frames find their delta already there (1 349 of 1 454 over the eight legs the probe recorded). The old design's "deltas arrive ~600 ms after `end_ms`" is not what the recordings show. So a frame's range is computed as it arrives from the stamps already held — no `speechRanges` fill-in (choice 9).
  3. **The stamps leave gaps the audio fills.** The other 105 voiced frames (7 %; 20 of the timeline run's 315) lie between one delta's `end_ms` and the next's `start_ms` (" noodles," ends at 6 800 ms, voiced frames run to 7 200, " and the" starts at 7 400): the tail of the words just stamped, or the head of the words stamped next — the stamps start late at an utterance's first word (" soup.", "Surprisingly"). A frame goes to the delta whose stamps lie nearest it (choice 9). "The latest delta starting at or before the frame" gave an utterance's first frames to the row before and lit the next row's first words late — a p90 of 803 ms under the first version's rows, past U4's 800 — where the nearest rule lit the 196 word edges it reached through L1 at a median of 200 ms and a p90 of 760 ms from whisper-1's, as the stamps themselves do. A frame nearest a closed row plays on it as its last words and holds nothing open (choice 10): the text leads, so the next row is often open already. **Under ruling 10's rows** (Revision 1) the same measure reaches 198 edges at a median of 200 ms and a p90 of 803 ms, the stamps' own still 760: the two edges added are " it.", whose stamps (25 600–25 800 ms) fall on the stream's floor — whisper-1 heard the word at 25 400–25 600, where the voiced frames end — so no voiced frame's window reaches its characters, and the light passes it only with its row's next voiced frame, at 28 100 ms. Under the first version's rows that frame belonged to the next row, " it." was never passed, and its edges were not counted. No placement rule changed; the row boundary moved (What this plan leaves).
  4. **Live's output drops the space where it joins two utterances** across a pause on its timeline: " Japanese." then "The decor", " are" then "really". The module's Latin sentence end needs whitespace after the mark (translation cuts, ruling 1 (iii)), so "Japanese.The" is no sentence end, and the row reads run together. The space is restored where the output's timeline paused between two word characters in scripts written with spaces (choice 8).
  5. **The output's marks come late too.** The translation's deltas carry a sentence's final mark at the head of the next delta a few times per run (". Anyway": the timeline run once, the release run four times, the mute run's ",", ";" and ","). With a cut due, the module would take the cut before that delta and open the next row with ". ": the marks now end the open translation first (`translationContinues`; choice 8).
  6. **The input's marks come late, and there is no sentence end.** Every recorded run speaks the owner's Chinese clip. Its transcript sends no sentence-final mark at all (0 of 107, 107 and 59 source deltas) and puts each comma at the head of the next delta after the pause (",老板" 830 ms after "面"; 9, 10 and 6 such deltas). The old client's rule — a leading mark belongs to the text before the pause — is kept (choice 6), so no source row opens with a mark. This is the deferred English → Chinese item's first half on another transcript (below, "What this plan leaves").
  7. **U5 through the real module, and ruling 10.** *The first version*, with the old client's source rule (a 600 ms timeline gap ending a source of 4 s), paired the timeline run 7 of 7, stated — U5's count — but not each with its own translation: the model joined the first two sources into one sentence ("…from Sichuan—at any rate, definitely not Japanese."), where the timeline's 800 ms pause at a comma had cut the source after "四川人,"; each source owes one cut, so the next three pairs sat a sentence late ("反正肯定不是日本人" beside "The decor inside the shop is nice…") until the 4 s pause before "下午" resynced them. The release and mute runs — the same clip, other pauses — paired 6 of 7 and 4 of 5: each run's first source was cut at that comma, its translation began only once the next source had opened and followed it (the translation cuts plan's choice 8), leaving the first row with no translation and the rows after it a sentence late. The review measured that a longer translation pause changes none of it (its I2): U5's "7/7, 0 orphaned" came from the probe's simpler follow rule, without choice 8's drop. **Ruling 10** (the owner, on the review's option C) cuts the source only at a timeline pause of at least the source pause (1.5 s): no comma's pause ends a row. Through the real module, by pause and by sentence three to a row, the three runs now pair **5 of 5, 5 of 5 and 3 of 3, every row stated, none without its translation and none holding another source's content** — the review's measure. The cost: longer rows, and a translation longer than its row's sentence count runs over into the next row, three times cut mid-sentence there ("It looks like | they put a lot of effort into it." on the release run by pause, "…The owner | seemed like…" on the mute run by pause, "…You can tell they really put | thought into it." on the timeline run by sentence); by the review's count 2, 3 and 2 rows by pause gain or lose a neighbour's clause. The run-over is the module's stated leftover, "a sentence-count mismatch until the next real pause" — the Chinese source has no sentence mark, so each row owes one cut however many sentences its translation holds — and the deferred English → Chinese item's second half. The replays pin every pair's two ends as they are (choice 18); the live test watches for both (Task 11, items 4 and 5).
  8. **`gpt-live-1` translates mid-sentence** (U5: a translation's first delta a median 628 ms before its source's last input delta), so a translation often opens while its source is open; the module then states that source (translation cuts, choice 5).
  9. **The session-side guard requires an `adapter.ts` in every provider folder** (`sessionSide.consistency.test.ts`): Task 6, the first to write into the new folder, seeds one, and Task 9 replaces it, as the OpenAI Translate and Palabra plans did.
  10. **Electron's main-process entry map is checked:** `electron/entry-map.consistency.test.js` requires every module `main.js` requires to be listed in `vite.config.ts`' Electron entry map, so Task 1 adds `ws-header-rules` there.
  11. **The extension's background is copied, not bundled** (`extension/vite.config.ts`, `viteStaticCopy`): a module it imports must be copied beside it — Task 2 copies `wsHeaderRule.js`. Neither `main.js` nor `background.js` can be loaded in a test (Electron, the MV3 service worker): their wiring is pinned on their source text — `main.js`' as `closeHandshake.wiring.test.js` already pins its own, `background.js`' the same way — and their rules through the pure modules.
  12. **U3 bounds the watchdog.** With no audio appended there are no frames and no billing, and the server did not close in 180 s: a leg muted by push-to-talk, or a silent room, must never read as stalled. The old watchdog counted a stall only across two equal usage reports with voiced input sent between them (`OLC:931-942`), which U3 confirms is the right arming. It never ran under push-to-talk, though: one voiced chunk is not enough (the review's I1; Revision 1, choice 14).
  13. **The old client reconnected on `expired`** (`OLC:956-967`); ruling 8 ends the run at the session's expiry, as OpenAI Translate's does: a stated departure.
- **Found in review** (Revision 1; each the owner's or the controller's ruling in `revision1-rulings.md`; the review's reproductions are under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/openai-live-plan-review/repo/review/`):
  1. **I1, a push-to-talk tap read as a stall** (`ptt-stall.test.ts`): one voiced chunk between two equal usage reports armed the watchdog; billing counts whole seconds, so a 0.17 s tap near a report reconnected the leg, and a second within 60 s failed it. Ruled: 2 s of voiced audio between equal reports (choice 14); the reproduction is Task 9's case; live-test item 9.
  2. **I2, the first row left without its translation** (`pairing-pause.test.ts`, `variants.test.ts`): research note 7. Ruled by the owner: ruling 10 (choice 6; Task 8's replays re-pinned); live-test items 4 and 5.
  3. **M1, the seam's gate unbounded** (`seam-gate.test.ts`): a registration that never answered held the gate until reload — the cap rejected the leg, but `letGo()` waited in the `finally` after `await platform.set(rule)`. Ruled: the attempt races the registration against its own end, sends the clear and lets the gate go (choice 1); Task 3's new case.
  4. **M2, the sender check tied to Chrome's scheme:** ruled: the pages' base from `chrome.runtime.getURL('')`, handed in by `background.js` (choice 3); Task 2's case; an Edge start in the live test.
  5. **M3, the first version's live-test item 7 not runnable** (the Text only switch is locked while a run is live): ruled: OpenAI Translate's item 5, a start with Text only on (now item 7).
  6. **M4, the first version's live-test item 3 proving nothing** (the rule is gone once the socket opens): dropped; `wsHeaderRule.test.ts` pins `initiatorDomains`. The items after it moved up one; items 5 (commas) and 9 (taps) are new.
  7. **M5, the old client's rule 4000 never swept:** ruled by the owner: ruling 11 (choice 3); Task 2's case.
  8. **M6, the group check's grep counting the comment too:** it greps `from './wsHeaderRule.js'`.
  9. **N1–N6:** the survey citations dropped from production comments, and the seed's task number stated as the one exception (Global Constraints); `size` a getter in Task 1's Interfaces; two pins added to the deletion inventory; overlapping keys recorded (choice 1; What this plan leaves); the close before `session.started` keeps OpenAI Translate's name, `session.connection_lost` (choice 15); the karaoke across the mute gap pinned (choice 18). Found while pinning N6: after the unmute the stream picks up with the last 100 ms of the word the pending translation had reached (" thoug" of "thoughtful"), then speaks the new sentence.
- **A scratch copy of the tree** at `a3eab634` (a `git archive`, `node_modules`, `extension/node_modules` and the probe logs linked, outside the repository, 2026-09-30) ran every code and test block below before it was written down; each new file below is that copy's file, and every diff is generated from it. Then the plan was replayed task by task, from this document's own blocks, on a fresh copy of `a3eab634`: every diff taken by `patch -p1` with no offset and no fuzz, each task's red step run against the code before it and its green step after it, and every count came out as quoted. Revision 1 was replayed the same way, the whole plan again, on a fresh copy of `a3eab634`. At `a3eab634`: **577 files passed and 1 skipped, 7 551 tests passed and 2 skipped**. After Wave 1: **583 + 1 files, 7 594 + 2 tests**; after Wave 2: **587 + 1, 7 631 + 2**; after Wave 3: **588 + 1, 7 669 + 2**; after Wave 4: **590 + 1, 7 679 + 2**; no unhandled errors; the typecheck gate exactly the baseline's 20 lines and the full tree at 259 after each wave. `npx vitest run electron`: 32 files, 465 tests → 34 files, 477 tests; `npx vitest run extension`: 7 files, 45 tests → 9 files, 56 tests; `npx vitest run src/services`: 49 files, 1 039 tests before and after. Sixty-eight hand mutants — the first version's sixty-two, re-anchored where Revision 1 moved their lines, less the two whose code ruling 10 removed, and eight for Revision 1's rules — ran against the result, each failing at least one test (the self-review lists them). Last, this document itself was checked: its ten diffs (by `patch -p1`, no offset, no fuzz), its thirty-four file blocks and its generator, taken in order on a fresh copy of `a3eab634`, rebuild a tree identical to the scratch result, whose gates read as above.
- **The roadmap:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` — the items naming OpenAI Live in the foundation's section (`:1315`), the Volcengine AST2 section (`:3807`, `:3821`, `:3861`), the OpenAI Translate section (`:4075-4079`, `:4418`, `:4446`, `:4457`), the OpenAI Realtime section (`:4750-4755`, `:5077`, `:5189`, `:5310`, `:5336`, `:5348`), the Palabra section (`:6410`, `:6436`, `:6437`), the translation cuts section (`:7173`, `:7252` and its deferred English → Chinese item) and the session-end section. The inheritance table below takes or leaves each.
- **The earlier Stage 2 plans** are this plan's form models, above all the OpenAI Translate plan (the same vendor), the Palabra plan (a provider written from scratch, with seeded lifecycles), the translation cuts plan (the module and its replays) and the session-end and wizard plan (its Global Constraints and replay).

## Global Constraints

- **Starting point.** HEAD `a3eab634` on `worktree-client-contract-stage2`. Every task anchors its edits by content, not by line: a line number cited here was read at `a3eab634`. Other commits may land first; every anchor is by content.
- **Edits shown as diffs, new files in full.** A change to an existing file is a unified diff with its context lines, generated from the scratch copy; its hunk headers count the lines at `a3eab634`. Apply a hunk by its content all the same (`patch -p1` took every one in the replay, with no offset and no fuzz). A new file is shown in full. The three recordings are generated by a committed script and checked by their `sha256sum` (Task 8).
- **What this plan touches:**
  - `electron/ws-header-rules.js`, `electron/ws-header-rules.test.js`, `electron/wsHeaderRules.wiring.test.js` (new), `electron/main.js`, `vite.config.ts` (the Electron entry map) — Task 1;
  - `extension/background/wsHeaderRule.js`, `extension/background/wsHeaderRule.test.ts`, `extension/background/background.wsHeaders.test.ts` (new), `extension/background/background.js`, `extension/vite.config.ts` — Task 2;
  - `src/lib/contract/headerSocket.ts`, `src/lib/contract/headerSocket.test.ts`, `src/lib/contract/testing/headerSocket.ts`, `src/lib/contract/testing/headerSocket.test.ts` (new), `src/lib/contract/socket.ts` (its header comment) — Task 3;
  - `src/lib/provider/{openaiWire,openaiWire.test,openaiModels,openaiModels.test}.ts` (new), `src/providers/openai_translate/{wire,check}.ts`, `src/providers/openai/{wire,check}.ts` — Task 4;
  - `src/lib/segmentation/{continuousSegments,continuousSegments.test}.ts` — Task 5;
  - `src/providers/openai_live/adapter.ts` (the seed), `src/providers/openai_live/{settings,settings.test,config,config.test}.ts` (new) — Task 6;
  - `src/providers/openai_live/{wire,wire.test,check,check.test}.ts` (new) — Task 7;
  - `scripts/dev/wire-probe/live-fixtures.mts`, `src/providers/openai_live/recordings/{timeline,release,mute}.json`, `src/providers/openai_live/{segments,segments.test,segments.replay.test}.ts` (new), `src/lib/segmentation/recordings/replay.testing.ts` — Task 8;
  - `src/providers/openai_live/adapter.ts` (replacing the seed), `src/providers/openai_live/{adapter.test,testing}.ts` (new), `src/providers/sessionSide.consistency.test.ts` — Task 9;
  - `src/providers/openai_live/{LiveSettings.tsx,LiveSettings.test.tsx,provider.ts,provider.test.ts}` (new), `src/providers/registry.ts`, `src/providers/registry.test.ts`, `src/providers/openai_translate/provider.test.ts` (its order case) — Task 10;
  - the spec and the roadmap — Task 11.
- **Read only.** `src/services/**` — the old client, its descriptor, its test and `OpenAIClient.fetchOpenAIModelsList` are ported by copying, never imported; the old settings UI; `src/stores/**` (the old `openaiLive` slice and its key prefill stay, unread by the new provider: ruling 9); `src/lib/contract/{adapter,events,socket,clock,framePayload,pcm64}.ts` but for `socket.ts`' comment; `src/lib/conversation/**`, `src/lib/projection/**`, `src/lib/session/**`, `src/lib/provider/{types,instructions,languages,boundedFetch}.ts`; the 30 locale catalogs (no new key); `extension/manifest.json` (it lists `wss://api.openai.com/*` and the CSP origin already, `manifest.json:38, 116`); the old `OPENAI_LIVE_*` handlers and the AST2 and Bing blocks in `background.js`, and every line of `main.js` but the four places Task 1's diff changes; `package.json` and the lockfiles. `npx vitest run src/services` stays green.
- **Import rules:**
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock. Live's session side is `adapter.ts`, `segments.ts` and `wire.ts` (pinned in Task 9); `config.ts` and `settings.ts` are reached as types only. The seam in `src/lib/contract/` arms its bound on the caller's clock too.
  - No provider imports another provider's folder: what OpenAI Translate and OpenAI Realtime share with Live is lifted to `src/lib/provider/` (choice 4), and the languages and voices are copied (ruling 9). Nothing imports `src/services/**`.
  - `testing.ts`, the kit's `testing/headerSocket.ts` and `replay.testing.ts` are test-only (the kit rule in `sessionSide.consistency.test.ts`): only tests import them.
- **Diagnostics** (CLAUDE.md, "Error Handling"): the adapter never reports or logs; it says what happened through its events — `failed`, `closed`, `degraded` (`parse_error`), `reconnecting` / `reconnected`, `frame`. The seam throws in fixed words and carries the platform's failure as `cause` only. `main.js` and `background.js` log header names, never a value, on their existing `console` channels (outside the policy: the main process and the worker).
- **Frames** (a Logs line each; never audio, never a credential, never a URL — the kit's `frame-secret` and `frame-url` rules): `session.headers` (`out`; `{ host, path, set: [names], remove: [names] }`), `session.start` (`out`; model, voice, delegation, instructions), `session.started`, the two transcript `.delta` frames with their stamps, `session.output_audio.delta` for a voiced frame only (`{ samples, rms }`), `session.usage.updated`, `session.stalled`, `session.closed`, `session.error`, `session.connection_lost`, `session.reconnecting` (`out`), `session.reconnected`, `session.reconnect_failed`, `session.socket_error`, `session.unreadable`, `session.unknown`, `session.info`, the server's acknowledgements as named, `session.input_audio.mute` / `.unmute` (`out`; `{ eventId }`), `translation.cut` (`out`) and `session.close` (`out`). **No append frame** (ruling 9). No `logStore` row: the `.delta` frames group by their own type, and no other name is anyone's row (choice 15). Nothing in `src/`, `extension/` or `electron/` holds `session.headers` or `WS_HEADERS_SET` at `a3eab634` (checked).
- **Locales.** No new key: `providers.openai_live.name` / `.description` exist in every catalog, the notices reuse existing codes (`auth`, `rate_limit`, `client`, `server`, `network`, `connection_lost`), and the credential field reuses `setup.credentials.apiKey`.
- **No network, no keys.** No test or step calls a provider: the adapter runs over the seam's fake on a virtual clock, the check over a stub `fetch`, and the fixtures generator reads local files. No step types a key into Live's field in a browser (its readiness check would call `/v1/models`).
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `a3eab634` on 2026-09-30, in a scratch copy: **577 test files passed and 1 skipped (578); 7 551 tests passed and 2 skipped (7 553); no unhandled errors.** The numbers after each wave (research notes) are references, not the gate: the gate is the rule. (The `Not implemented: window.open` stderr lines are pre-existing, `ChildWindowPopover`'s.)
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. Every file this plan edits or creates under `src/` is inside the regex (`lib/(contract|provider)`, `providers`) but `src/lib/segmentation/**`, which the next bullet covers. `headerSocket.ts` imports `src/utils/environment.ts`, whose two baseline lines stay the baseline's own.

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    The same command is `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh`; its output must equal `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate-baseline.txt` — exactly these **20** lines, re-measured at `a3eab634`:

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

    Do not fix them; do not add to them. The TS lib is ES2020: no `Array.prototype.at`, `String.prototype.replaceAll`, `Array.prototype.findLast` or `Error` options in a test either (`HeaderSocketError` sets its `cause` itself).
  - **The full tree, for the files outside the regex.** `npx tsc --noEmit -p tsconfig.json 2>&1 | command grep -c 'error TS'` prints **259** (measured at `a3eab634`, the ceiling), and `npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -c 'src/lib/segmentation/'` prints **0**. The Electron and extension files lie outside `tsconfig.json`'s `include` (`src`, `index.html`); their suites are their gate (`npx vitest run electron`, `npx vitest run extension`).
  - **Gates in a parallel wave.** Wave 1 runs Tasks 1–6 at once, Wave 2 Tasks 7 and 8, in this one working tree, so each sees the others' red phases:
    - a test failure, or an extra gate line, in a file another task of the wave is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, the exact baseline, and the full tree's 259; after Waves 1 and 4 also `npx vitest run electron` and `npx vitest run extension`.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere its change could reach, it says why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides.
  - **No task mutates the tree to prove a guard, and no temporary file is written inside `src/`.** A mutant a reviewer wants to try runs in a scratch copy under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`.
- **The process-wide code** (Tasks 1 and 2) carries its own risk, stated in each task: Electron's one `onBeforeSendHeaders` listener serves Better Auth's cookie, Bing's and Edge TTS's headers and the old AST2 client; the background worker's `declarativeNetRequest` chain serves the old AST2 and OpenAI Live rules. Each task's back-compat tests pin that a rule set with no path behaves as every rule did before, and that the old blocks are untouched.
- **Builds, at the group check only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension` and `npx vitest run electron`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
  - The new code shipped: `command grep -rlF 'session.headers' build extension/dist` and `command grep -rlF 'WS_HEADERS_SET' build extension/dist` each name at least one file under `build/` and one under `extension/dist/`; `extension/dist/wsHeaderRule.js` exists beside `extension/dist/background.js`.
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. The fixtures' generator is none of them: it reads local files, opens no socket, and Task 8 runs it.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `;` and `&&` chains, heredocs other than a commit's, `cd … &&`. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`, each agent in a directory named for its task and role (`t2-impl/`, `t7-review/`).
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: another plan's tasks stage into the same index. Never stage a whole directory.
  - In a parallel wave two commits can meet on `.git/index.lock`: a commit that fails that way is retried as it was; the lock is never deleted.
  - Production comments cite this plan's rulings and choices as "(Stage 2 OpenAI Live, ruling N)" / "(Stage 2 OpenAI Live, choice N)" — inside `src/providers/openai_live/` a bare "ruling N" / "choice N" is this plan's — and the earlier plans' as they already do; never a task number, a review finding or the survey. The one exception is Task 6's `adapter.ts` seed, which names Task 9, the task that replaces it, as the OpenAI Translate and Palabra plans' seeds did. English only.
  - Never push.

## Rulings

Cited as *ruling N* (in code outside the provider's folder, "Stage 2 OpenAI Live, ruling N"). Rulings 1–9 are the owner's (「1-9 按推荐」, 2026-09-30), each the survey's recommendation (survey §4) as the probe corrected it. Rulings 10 and 11 are his answers to the independent review's two questions (Revision 1, 2026-09-30). Each is restated with its evidence and where it lands.

1. **`speech: 'optional'`** — a stated departure from the old `textOnlyCapability: 'never'` (`OLPC:125`). Text only is a playback control: the API always speaks, and bills the audio, and a leg that does not speak drops it; the participant speaks on its switch (the old participant was text-only, `OLPC.test:70-74`). As OpenAI Translate's ruling 4. Lands in: Task 6 (the builder builds the same config either way), Task 9 (`play: context.speech`), Task 10 (the definition).
2. **Karaoke on the timeline.** U4: the output's `start_ms` / `end_ms` against whisper-1's word times on the output's sample clock — median 200 ms, p90 760 ms over 202 edges, inside the 300 / 800 bars. The stream is not continuous (it has gaps), and its audio frames carry no stamps. This plan defines the placement exactly (choice 9): the ranges come **from the adapter, as each frame arrives** — not through `speechRanges`' fill-in (research note 2) — and they are real ranges under D4, not a stated arrival exception. Lands in: Task 8 (choices 9, 10), Task 9, Task 11 (the capability row).
3. **Pairing by the translation cuts module, with stated origins.** U5: "the translation follows the source's cuts" paired 7 of 7 with none orphaned under the old client's source rules, 5 of 5 with one orphan on a plain 1.5 s pause; L2's proximity paired 3 of 7. `ContinuousSegments` holds both sides; the source is cut by the old client's rules (choice 6) — **amended by ruling 10**: at a pause of the source pause, no longer the old 600 ms / 4 s rule — the translation where its source was, stating it. **The guard clock** is the module's own, the arrival clock: the probe applied the rule on arrival (`translationFollows`), and the stamps stand on two clocks that cannot compare the sides (research note 1). Lands in: Tasks 5, 8, 9.
4. **By sentence, a segment is cut every N sentences, N the display's setting; by pause, one; the caps in both.** `segments.ts` reads the segmentation mode and the sentences per row from `shared.segmentation`, through the builder, as LocalInference's builder does. How it composes with the module's own source rules is choice 7. Lands in: Task 6 (`sentencesPerSegment`), Task 8.
5. **Push-to-talk by mute.** A release sends `session.input_audio.mute` and stops the appends; a press sends `session.input_audio.unmute` and resumes; no tail. U2': with nothing appended after the mute the pending translation finished (voiced output within 3.75 s) and billing stopped soon after (0.43 s per s over the window); U1: stopping the appends alone did not finish the last sentence; U2: the acknowledgements `session.input_audio.muted` (106 ms) and `session.input_audio.unmuted` (104 ms). Lands in: Task 7 (the frames), Task 9 (choice 11).
6. **Reconnect with the old client's parity:** one attempt, then `connection_lost`, with the 60 s grace (`OLC:80, 665-721`). The stall watchdog is armed only while audio is appended (U3: with no appends, no frames, no billing, and no server close in 180 s) — and, by the controller's ruling on the review's I1, only by 2 s of voiced audio between two equal usage reports, so a push-to-talk tap near a report is no stall (choice 14). An actionable `auth` or `rate_limit` refusal fails the leg in its own words. Lands in: Task 9 (choices 13, 14).
7. **F14's shape.** A generic background `WS_HEADERS_SET` / `WS_HEADERS_CLEAR` pair with a sender check and a startup sweep, the old `OPENAI_LIVE_*` pair untouched until the deletion; a path-aware Electron rule, extracted to a tested module; the renderer seam (`OpenHeaderSocket` / `platformHeaderSocket`) and its fake. U9: the upgrade must carry `Authorization: Bearer` and no `Origin` — `Origin` gets a 403, the subprotocol alone a 401 `missing_authorization`, a bogus Bearer a 401 `invalid_api_key`. This reverses #552's decision not to scope by path. Electron's one `onBeforeSendHeaders` is process-wide (Better Auth, Bing, Edge TTS and the old AST2 client share it), so back-compat tests are required. Lands in: Tasks 1–3 (choices 1–3), Task 9.
8. **Stop:** send `session.close`, then close at once without waiting. U7: `session.closed` (`close_requested`) came 0.73 s later. Framed as `session.close` (`out`), as the session-end plan did for OpenAI Translate (its ruling 2 (iii)). A session lasts 2 h (`expires_at`, U7: 7 199 s); at its expiry the run ends, OpenAI Translate's parity — a stated departure from the old client, which reconnected (research note 13). Lands in: Task 7, Task 9 (choice 16).
9. **Housekeeping, as the survey recommends:**
   - no key prefill: Live reads its own key (`settings.openaiLive.apiKey`), never OpenAI Realtime's — the old store's one-time copy (`settingsStore.ts:753-773`) stays with the old code;
   - hand-typed wire types: the installed `openai` 6.39.1 has no Live types;
   - `decodeServerEvent` / `errorCode` / `errorWords` and the `/v1/models` check lifted at this third user (roadmap `:5348`), where the lift pays;
   - the 55 languages and the 22 voices copied;
   - the registry position after OpenAI Translate;
   - a refused upgrade worded as the network with the key named (`never_opened`);
   - no append frames;
   - `textInput: () => false`.

   Lands in: Task 4 (choice 4), Tasks 6, 7, 9, 10.
10. **Live's source is cut at a pause of at least the source pause** (the owner, 「C：停顿 ≥1.5 s 才换行」, on the review's I2, its option C). Through the real module, the old client's rule — a 600 ms gap on the timeline ending a source that held 4 s, twice the source pause ending any — cut the release and mute recordings' first source at a comma's 800 ms pause; its translation began after the next source had opened and followed it (the translation cuts plan's choice 8), leaving that row with no translation and the rows after it a sentence late (research note 7). Now a gap on the input's timeline of at least the source pause — the user's setting, 1.5 s by default, as OpenAI Translate's and Gemini Live Translate's sources end — ends the open source, whatever it holds; the pause's leading mark still goes to the source it ends. The module's arrival pause, the sentence-N cut and the 8 s / 12 s caps stay; `holdSource` goes (choice 6). The shared `ContinuousSegments` gets nothing for it: `segments.ts` alone. **A stated departure from ruling 3's "the old client's rules".** Its costs — longer rows, an occasional translation split mid-sentence at a row boundary, English input untested — are in "What this plan leaves" and the live test. Lands in: Task 8 (choice 6), Task 5 (`holdSource` not added), Task 11.
11. **The extension's startup sweep removes the old rule id 4000 too** (the owner, 「启动时一并清掉」, on the review's M5). The old client's rule has the generic rule's filter and initiator, so one it left behind — a crash between its set and its clear — would hold an old key on disk and reach the new Live upgrade at equal priority. The sweep at `onStartup` / `onInstalled` takes id 4000 with 5000–5099. It deletes a leftover network rule: not data migration, so the no-one-time-migration rule does not apply. The old `OPENAI_LIVE_*` handlers stay until the deletion plan; were the old client somehow running, its rule would be swept only at the next start, which is harmless. Lands in: Task 2 (choice 3).

**Probe facts the plan carries:** U10 — an invalid voice gets `invalid_request_error` / `forbidden` "Voice session access denied." before `session.started`, then the socket closes 1006: a refused start in OpenAI's words (choice 12); a mid-session `invalid_audio` (non-base64, or an odd byte count) does not end the session: a Logs line. U12 — `delegation: null` is refused (`invalid_type`); `{ type: 'client' }` produced no `session.delegation.created`: kept. U11 — two sessions on one key both ran: Both is two legs, no `startBoth`. U13 — billing after an abrupt close was not probed; low risk given U3 (What this plan leaves).

The standing rules hold: no one-time migration code, and production comments cite rulings and choices.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **The renderer seam** (ruling 7), `src/lib/contract/headerSocket.ts`:
   - **Asynchronous:** `OpenHeaderSocket(url, headers, { signal, clock }) → Promise<WebSocket>`, resolving once the socket is open with its own listeners gone. Electron's registration is an `ipcMain.handle` round trip and the extension's a runtime message; the old client awaited it (`OLC:446`; survey §6 item 4). The spec's `openSocket(url, { set, remove }) → WebSocket` is amended (Task 11).
   - **The rule's key** is the URL's host and its path to the last `/` (`ruleFor`: `/v1/live/sessions` → `api.openai.com` + `/v1/live/`): a Live rule never reaches OpenAI Realtime's or Translate's upgrade on the same host (the spec's amendment 10, carried by the Translate and Realtime records).
   - **One upgrade at a time per key, in the seam** — process-wide state in the renderer, not a definition's (survey §6 item 5): the rule goes in, the socket is made, and at the socket's first `open`, `error` or `close`, an abort, or the bound, the rule is cleared (a no-op on Electron, whose upgrade consumed it), and only then does the next leg at the same key register. Two legs of Both, or two reconnects after one drop, never race one rule. Keys that differ do not wait — though they can still overlap: an extension rule for a path also reaches the paths under it, and two app windows or extension pages running Live at once share one rule. Only Live uses the seam today (What this plan leaves).
   - **The bound:** `HEADER_SOCKET_CAP_MS` = 15 000 — the old client's cap on its upgrade gate (`UPGRADE_GATE_CAP_MS`, `OLC:82`) — now counting the registration too, armed on the caller's clock once the gate is held. **Revision 1** (the controller's ruling on the review's M1): the attempt waits for the registration's answer *or* its own end, whichever comes first, so when its bound fires or it is aborted with the registration still unanswered, it sends the clear at once and lets the gate go. Both platforms' channels are ordered — Electron's IPC, the extension's runtime messages — so the clear lands after the hung set, and the next leg's set after the clear. So the wait at the gate is bounded by the holder's own bound: a registration that never answers holds the next leg no longer than 15 s, where the first version held it until the page reloaded. An abort rejects at once and opens nothing.
   - **Fixed words, no value:** `HeaderSocketError` with `reason` `unsupported` (the web), `register` (the platform refused), `never_opened` (an `error` or `close` before `open`) or `timeout`, its `cause` the platform's failure for the console; a browser that refuses the socket is `nativeSocket`'s fixed words. No header value leaves the seam but in the registration.
   - **The platforms:** `electronRegistrar` (`ws-headers-set` with `{ host, path, headers, removeHeaders }`, `ws-headers-clear` with `{ host, path }`), `extensionRegistrar` (`WS_HEADERS_SET` with `{ host, path, set, remove }`, `WS_HEADERS_CLEAR`), `platformRegistrar()` read at each open (none on the web), and `platformHeaderSocket`, the app's one seam.
   - **The fake,** `fakeHeaderSockets(sockets?)` in `src/lib/contract/testing/headerSocket.ts`: the real seam over a registrar the test drives, handing out `FakeSocket`s from the sockets it is given (a lifecycle run's), recording each rule and its clear, and able to refuse or hold the next registration. The kit's own, so a later header user reuses it.
   - `socket.ts`' header comment points at it.
2. **Electron's rules,** `electron/ws-header-rules.js` (ruling 7): `createWsHeaderRules()` → `{ set, clear, take, size }`, keyed by host and path.
   - `take(url, requestHeaders)` finds the rules of the upgrade's host whose path the URL's path starts with, **the longest path winning**, applies it — the listed headers removed case-insensitively, then the set ones — and deletes it: **one-shot**, as every rule was.
   - **A rule with no path is host-wide**, as every rule was before: Edge TTS's and the old AST2 client's `ws-headers-set` calls send none and behave as they did; a path rule and a host-wide rule on one host each apply to their own upgrades.
   - `set` refuses a rule with no host, no headers, or a path that does not start with `/`, in the main process's words; values are coerced to strings and a `null` or empty one dropped.
   - `main.js`' one listener calls `take` for a WebSocket request between Better Auth's cookie and Bing's headers, where the old map was read; the `ws-headers-set` / `ws-headers-clear` handlers call `set` / `clear` and log the header names alone. `vite.config.ts`' Electron entry map lists the module (research note 10).
3. **The extension's pair,** `extension/background/wsHeaderRule.js` (ruling 7):
   - `WS_HEADERS_SET { host, path, set, remove }` and `WS_HEADERS_CLEAR { host, path }`, generic — no provider named.
   - **The sender first:** a message from anything but the extension's own pages (`sender.id` the runtime's and `sender.url` under `chrome.runtime.getURL('')`) is refused before anything is read: a content script's sender is the web page it runs in. **Revision 1** (the controller's ruling on the review's M2): the pages' base comes from the browser, handed in by `background.js` as the id is, not a hard-coded `chrome-extension://`, so a browser that serves its pages under another scheme is answered all the same; the live test starts Live on Edge.
   - **The rule:** a `modifyHeaders` rule setting and removing the headers, for `resourceTypes: ['websocket']`, `urlFilter` `||<host><path>`, `initiatorDomains: [<the extension's id>]` — so no page's socket is ever authenticated as the user — at an id in its own range, 5000–5099 (the old AST2 rules hold 2000–2009, Edge TTS's 3000–3009, the old Live rule 4000, Bing's 9301): the id its host and path already hold, else the lowest free, none when the range is full.
   - **Validated before the shared chain,** then every update chained on the background's one `dnrUpdatePromise`, which is never left rejected.
   - **Swept** of every rule in its range, and of the old client's rule id 4000 (ruling 11; `OLD_LIVE_RULE_ID`), when the browser or the extension starts (`onStartup`, `onInstalled`): dynamic rules outlive both, and a rule left by a worker that died between set and clear would otherwise stay. Never another block's id.
   - The old `OPENAI_LIVE_*` pair and its rules are untouched (their tests pin it). `extension/vite.config.ts` copies the module beside `background.js` (research note 11).
4. **The lifts at the third user** (ruling 9): `src/lib/provider/openaiWire.ts` (`ServerEvent`, `decodeServerEvent`, `OpenAIError`, `OpenAIErrorCode`, `errorCode`, `errorWords`) and `src/lib/provider/openaiModels.ts` (`OPENAI_MODELS_URL`, `CHECK_TIMEOUT_MS`, `ModelFamily`, `OpenAIModelCheckDeps`, `createOpenAIModelCheck(family, deps)`). OpenAI Translate's and OpenAI Realtime's `wire.ts` re-export the four helpers under their old names, so no importer changes; Realtime keeps its own `session_expired` → `segment_ended` in front of the shared `errorCode`. Their `check.ts` become thin wrappers over the shared check with their own family and refusal. Both suites pass unchanged (the pin that they do: Task 4, step 5).
5. **Three members for `ContinuousSegments`** (the translation cuts module; rulings 3, 4): `cutSource()` — an adapter's own source cut, the open source closing now and owing its cut as its pause would; `translationContinues(text)` — text that continues the open translation whatever cut is due, counted and shown and its activity as a delta is (choice 8); `closeAll()` — both sides closed as they stand, every cut owed dropped, no timer left, the refs counting on, a new `CutReason` `lost`. Nothing else in the module changes: its existing users (OpenAI Translate, Gemini Live Translate) call none of them, and their suites pass unchanged. **Revision 1:** the first version also added a `holdSource` option for the old client's short-source grace; ruling 10 removed its reason (choice 6), so the module gains three members, not four.
6. **Live's source rules, on the input's timeline** (rulings 3, 10), in `segments.ts` over the module:
   - a gap on the timeline — the delta's `start_ms` at least the source pause after the last delta's `end_ms` — ends the open source, whatever it holds (ruling 10). The source pause is the user's setting (`silence.sourceMs`, 1.5 s by default), the pause that ends OpenAI Translate's and Gemini Live Translate's sources by arrival;
   - a delta's leading marks belong to the text before it: at such a pause they go to the source it ends; with no source open they are dropped, and a new source starts at its first word (the old client's rule, `OLC:768-840`);
   - the module's own pause still closes a source by arrival, deferred mid-sentence in sentence mode;
   - sentence and clause cuts: choice 7.

   **Why the timeline as well as arrival:** the timeline pause is the speaker's, where arrival adds the model's jitter, and it is read at the next delta, so its leading mark can go to the row it ends. **Revision 1, a departure from ruling 3 by ruling 10:** the first version kept the old client's rule — a 600 ms gap ending a source that held 4 s (`SOURCE_GAP_MS`, `SOURCE_MIN_SPAN_MS`, `OLC:65-67`), twice the source pause ending any — and cut rows at a comma's pause (research note 7). **`holdSource` goes with it.** It was the old rule's other half (`OLC:1017-1024`): a source shorter than 4 s survived one arrival pause, as the 4 s span let short sources run on through the timeline's pauses. Under ruling 10 a pause of the source pause ends a row whatever it holds; kept, `holdSource` would hold a short row open one pause longer only when no speech follows, and let arrival jitter cut a long row but not a short one. On the three recordings, by pause and by sentence, it changes no row (measured with it and without it).
7. **Sentences per segment** (ruling 4): `sentencesPerSegment` is the display's N (`shared.segmentation.sentencesPerRow`, rounded, 0 for none) in sentence mode, and 1 by pause or off. A source is cut inside a delta right after its N-th sentence end, counted on the whole source (abbreviations read as the module reads them), several in one delta cut in turn. **In every mode** a source past `SOURCE_CLAUSE_MS` (8 000) is cut at its last clause mark and at `SOURCE_CAP_MS` (12 000) anywhere. **With the module:** its source pause is deferred mid-sentence in sentence mode (`deferMidSentence`, as OpenAI Translate's is); a timeline pause of the source pause cuts in every mode, as the caps do; its translation side is unchanged — each source cut owes one translation cut, due at the translation's matching sentence end.
8. **The translation side** (ruling 3; research notes 4, 5): a delta's leading marks — `LEADING_PUNCT_RE` without its whitespace — end the open translation's text through `translationContinues` before any due cut is taken; with no translation open, they are dropped. And where the output's timeline paused between two deltas (`start_ms` after the last `end_ms`) that the stream joined with no space, between a word character or Latin mark and a letter or digit, in scripts written with spaces, one space is restored — never inside a word, never in Chinese, Japanese, Thai, Lao, Khmer or Myanmar.
9. **The karaoke's clock** (ruling 2): every output frame advances the output's sample clock — the floor's too — by its samples ÷ 24 ms, from 0 at the connection's first output frame, as `live.mts` computes U4. A voiced frame's window `[t0, t1)` is placed by the delta whose stamps lie nearest its middle (the later on a tie), and its range is that segment's characters from where `t0` falls to where `t1` falls — interpolated inside a delta by its share of the delta's stamps, held at a delta's end through a gap — snapped past a surrogate pair, never before the segment's last range (ranges ascend and never overlap). Computed as the frame arrives, from the stamps already held; a frame whose segment has no stamped text yet plays rangeless. Stamps are kept 60 s behind the audio. A lost connection starts both timelines again.
10. **Audio attribution and activity** (rulings 1, 2; research note 3): a frame at or below RMS 0.002 is the dithered floor (`OLC:50-60`: floor 1.3e-5 – 5.8e-4, speech 0.03 – 0.08) — it counts on the clock, plays nothing, frames nothing, opens nothing. A voiced frame nearest the open translation, or with no stamped text yet, is the translation's activity (it opens one and holds it, as a delta does); one nearest a closed segment plays on that segment as its last words and holds nothing. A leg that does not speak plays nothing; its voiced audio is activity all the same.
11. **Turns** (ruling 5): under `turns: 'manual'` a release (`endTurn`) and a cancel (`cancelTurn`) send `session.input_audio.mute` once, framed with its `event_id`, and drop every append until a press (`beginTurn`) sends `session.input_audio.unmute`; nothing is sent twice in a row, and automatic turns never mute. The acknowledgements are Logs lines. No tail, no clear: what the press appended is the model's input already.
12. **The start** (ruling 7; U9, U10): `session.headers` is framed (the rule's place and the header names), the seam registers and upgrades, `session.start` goes out on the open socket (the old shape, `OLC:100-109`: PCM16 at 24 kHz both ways, the voice, the prompt, `delegation: { type: 'client' }`), and the start resolves on `session.started` — all within `START_TIMEOUT_MS` (30 000, `OLC:76`) on the request's clock. Refusals, each an `AdapterStartError`: an `error` before `session.started` — U10's `forbidden` — in OpenAI's words and code; a `session.closed` or a close before it, `server`; the seam's `never_opened`, the network with the key named ("OpenAI's socket did not open (check the network, and that the API key is still valid).": a refused key is a 401 on the upgrade, which no browser reads; ruling 9); its `timeout`, the network; `unsupported`, "OpenAI Live needs the desktop app or the browser extension." (`client`); `register`, "The app could not prepare the connection to OpenAI: restart it and try again." (`client`, the platform's failure as `cause`). An abort rejects with its reason and opens nothing.
13. **The reconnect and the error window** (ruling 6): an unexpected end while live — the socket closing with no `session.closed`, a `session.closed` that is not the expiry, a stall — is framed `session.connection_lost` with its cause, then: within `ERROR_WORDS_MS` (10 000) of an actionable mid-session `error` (`auth`, `rate_limit`), the leg fails in that error's words, no attempt (OpenAI Translate's ruling 3); within `RECONNECT_GRACE_MS` (60 000) of the last reconnect, it fails with `connection_lost`; else **one attempt**, break before make: both sides close as they stand (`closeAll`), the leg reports `reconnecting`, and `connect` runs again through the seam, which registers the rule again. It succeeds (`reconnected`) or fails the leg — in the refusal's own words when the attempt was refused for the key or a limit, else `connection_lost`. A mid-session error that is not followed by an end — `invalid_audio`, U10 — is a Logs line only.
14. **The stall watchdog** (ruling 6; research note 12): two consecutive `session.usage.updated` with the same `seconds`, with at least `STALL_VOICED_SAMPLES` — 48 000, 2 s at 24 kHz — of voiced audio (chunks with any non-zero sample) appended between them, is a stall — framed `session.stalled`, then an unexpected end. The count starts again at each report and at a reconnect. With nothing appended, equal reports are silence, never a stall (U3): a muted leg or a silent room is never torn down. No timer: the reports are the clock. **Revision 1** (the controller's ruling on the review's I1): the first version counted one voiced chunk. Billing counts whole seconds and moves only with appended audio (U2'), so a push-to-talk tap of 0.17 s near a report left the seconds where they were and read as a stall — a reconnect, and a second tap within 60 s failed the leg (the review reproduced both). 2 s of voice that moves no billing second is a stall; a tap is not.
15. **Frames** (Global Constraints): no append frame (ruling 9); an output audio frame only when voiced, `{ samples, rms }`, rounded to four places; each transcript delta with its text and stamps; `session.headers` with names only; `session.unreadable` once per ok → failing transition of each of two latches (a frame, an audio delta), with one `degraded` (`parse_error`) each. No `logStore` row: the three `.delta` frames group under their own type by the Logs' rule for every provider, `session.error`, `session.reconnect_failed` and `session.socket_error` read as errors by their suffix, and no other name is anyone's row. **A close before `session.started`** is framed `session.connection_lost { code, reason }` — OpenAI Translate's own name for the same close (its `onClose`), kept by the controller's ruling on the review's N5 ("follow OpenAI Translate's name … if it has one"); the start's refusal after it says it was the start's, and its payload differs from a live loss's `{ cause, … }`.
16. **Stop** (ruling 8): while live with an open socket, `session.close` is sent and framed, then the leg shuts down before its first `await` — the socket closed, every timer cancelled, an attempt in flight aborted (its rule cleared by the seam). `session.closed` and whatever the server flushes are not read: a tail at Stop is dropped, as OpenAI Translate's. **The expiry:** a `session.closed` with `reason: 'expired'` ends the leg with `closed { reason: 'expired' }` — the run ends (Translate's parity; research note 13).
17. **The definition and the view:** `platforms: ['electron', 'extension']` — the first definition without `'web'` (the web cannot set the header); `kind: 'own-key'`; the old id and slice (`openai_live`, `openaiLive`), so a stored selection, the key, the pair and the voice carry over; the OpenAI setup guide; `checkReads: []` (the model list reads no setting); `boundaries: () => 'silence'`; `turns: () => ['auto', 'manual']`; `speech: 'optional'` (ruling 1); `textInput: () => false` (ruling 9). `LiveSettingsView` draws the shared `InstructionsField` (its preview resolved for the pair, Auto-detect named "the spoken language") and `VoiceField` with the 22 voices — no model, no turn detection, no noise reduction: the endpoint has none.
18. **Fixtures and replays:** `scripts/dev/wire-probe/live-fixtures.mts` writes three recordings from the probe's logs — `timeline` (U4, U5; with whisper-1's words placed on the sample clock as `live.mts` placed them), `release` (U1) and `mute` (U2') — each event its arrival, its kind, a delta's text and stamps, or an audio frame's length and RMS; no pcm, no key. The translation cuts plan's `replay.testing.ts` gains the stamps (`Stamps`, passed to the target's `input` / `output`) and each segment's leg in its result, its old users unchanged. `segments.replay.test.ts` replays the three through the real `segments.ts`, L1 and L2, by pause and by sentence, and pins every pair's two ends (rulings 3, 10; research note 7), U4's karaoke on the timeline run (research note 3), and — Revision 1, the controller's ruling on the review's N6 — the karaoke across the mute run's gap: no frame rangeless, and the frames after the unmute on the text said around it.
19. **The render check** (the group check): the web build does not offer Live, so the check fakes the desktop platform as the tutorial harness did — `window.electronAPI = {}` and a `window.electron` whose `invoke` answers every channel and records it, injected by `Page.addScriptToEvaluateOnNewDocument` before the app loads — and asserts 0 requests to `api.openai.com` and no `ws-headers-set` invoke.

## What this plan consumes from the earlier plans

Named as landed, so a reconciliation is mechanical. Where a landed name or text differs from what is quoted here, the implementer follows the landed one and reports it.

| From | What it is | Consumed by |
|---|---|---|
| The kit (Stage 1; the Palabra plan's ruling 15; the session-end plan's choice 3): `FakeSocket`, `fakeSockets`, `FakeSockets.create` / `.last()`, `runScenario`, `scenarioNames`, `AdapterHarness`, `runLifecycles` / `LifecycleHarness`, `trackedClock`, `flush`, `recordEvents`, `checkConformance`; the `stopped` marker (a frame may follow an ending until `stop()` returns) | the rules the adapter must pass; the seam's fake hands out `FakeSocket`s | Tasks 3, 9 |
| The contract: `AdapterStartError(message, code, …, { cause })`, `Adapter`, `AdapterSession`, `AdapterEvents`, `StartRequest`, `SessionContext`, `Ref`, `TextRange`, `framePayload`, `WS_OPEN`, `nativeSocket` (`socket.ts`), `pcmToBase64` / `base64ToPcm` (`pcm64.ts`), `Clock` / `realClock` | the adapter's shape and helpers | Tasks 3, 7–9 |
| The translation cuts plan: `ContinuousSegments` (`sourceText`, `translationText`, `audio(pcm, { play, active })`, `stop`, `CutSummary`, `SegmentSink`), `sentenceEnds`, `lastClauseEnd`, `LEADING_PUNCT_RE` (`sentenceEnd.ts`), `replay.testing.ts` (`replay`, `RecordedEvent`, `Recording`, `ReplayTarget`), the `translation.cut` frame | the pairing module and its replay | Tasks 5, 8, 9 |
| The OpenAI Translate plan: `decodeServerEvent`, `errorCode`, `errorWords`, `ServerEvent` in its `wire.ts`; `checkTranslate` / `createTranslateCheck` and `isTranslateModelId`; its parity on the tail at Stop; its ruling 3 (a mid-session error's words for the end that follows); `segmentPauseMs`, `clampSegmentPauseMs` | what is lifted, and the patterns Live follows | Tasks 4, 6, 9 |
| The OpenAI Realtime plan: its copies of the decoder and words in `wire.ts` (its `session_expired` → `segment_ended`), `checkRealtime` / `createRealtimeCheck`, `isRealtimeModelId`, `REALTIME_LANGUAGES` (the 55) and its voice list; its `liveLanguageName` rule for Auto-detect | lifted, copied | Tasks 4, 6 |
| The Gemini plan: `InstructionsSettings`, `INSTRUCTIONS_DEFAULTS`, `INSTRUCTION_LEGACY_KEYS`, `migrateInstructions`, `resolveInstructions`, `InstructionsField`, `VoiceField` | the prompt Live owns, and its view's fields | Tasks 6, 10 |
| The foundation plan: the `connection_lost` notice alias; `Provider`, `ProviderRefusal`, `SharedSettings` (`segmentation`, `pauses`, `reversed`), `CheckContext` / `CheckResult`, `boundedFetch`, the registry's `RELEASED` list and its invariants | the definition's shape and wording | Tasks 6, 7, 10 |
| The session-end and wizard plan: OpenAI Translate's `session.close` pattern (sent and framed while live and open, then the close); the runner's `session.stopped` after it; `textInput(s)` (`b5153784`) | Live's Stop, and its definition | Tasks 9, 10 |
| The Palabra plan: the plain seam in `src/lib/contract/socket.ts` (`nativeSocket`'s fixed words) and its seeded lifecycles' harness shape | the header seam opens through it; the lifecycle harness | Tasks 3, 9 |

## File Structure

| File | Task | Change |
|---|---|---|
| `electron/ws-header-rules.js`, `electron/ws-header-rules.test.js`, `electron/wsHeaderRules.wiring.test.js` (new), `electron/main.js`, `vite.config.ts` | 1 | the path-aware one-shot rules, and `main.js` on them |
| `extension/background/wsHeaderRule.js`, `extension/background/wsHeaderRule.test.ts`, `extension/background/background.wsHeaders.test.ts` (new), `extension/background/background.js`, `extension/vite.config.ts` | 2 | the generic pair, its sender check and sweep |
| `src/lib/contract/headerSocket.ts`, `src/lib/contract/headerSocket.test.ts`, `src/lib/contract/testing/headerSocket.ts`, `src/lib/contract/testing/headerSocket.test.ts` (new), `src/lib/contract/socket.ts` | 3 | F14's seam and its fake |
| `src/lib/provider/{openaiWire,openaiWire.test,openaiModels,openaiModels.test}.ts` (new), `src/providers/openai_translate/{wire,check}.ts`, `src/providers/openai/{wire,check}.ts` | 4 | the lifts |
| `src/lib/segmentation/{continuousSegments,continuousSegments.test}.ts` | 5 | `cutSource`, `translationContinues`, `closeAll` |
| `src/providers/openai_live/adapter.ts` (the seed), `src/providers/openai_live/{settings,settings.test,config,config.test}.ts` | 6 | `S`, `K`, the lists, the builder |
| `src/providers/openai_live/{wire,wire.test,check,check.test}.ts` | 7 | the wire, the check |
| `scripts/dev/wire-probe/live-fixtures.mts`, `src/providers/openai_live/recordings/{timeline,release,mute}.json`, `src/providers/openai_live/{segments,segments.test,segments.replay.test}.ts`, `src/lib/segmentation/recordings/replay.testing.ts` | 8 | the segments on the timeline, the fixtures and their replays |
| `src/providers/openai_live/adapter.ts` (replacing the seed), `src/providers/openai_live/{adapter.test,testing}.ts`, `src/providers/sessionSide.consistency.test.ts` | 9 | the adapter, its harness, its session side pinned |
| `src/providers/openai_live/{LiveSettings.tsx,LiveSettings.test.tsx,provider.ts,provider.test.ts}`, `src/providers/{registry,registry.test}.ts`, `src/providers/openai_translate/provider.test.ts` | 10 | the view, the definition, the registration |
| the spec, the roadmap | 11 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Tasks 1–6, at once. Disjoint files: Electron, the extension, the contract's seam, the lifts (`src/lib/provider/` and the two OpenAI folders), the module, and the new folder's settings side. None needs another. Task 6 writes its `adapter.ts` seed before any other file of the new folder (research note 9); a concurrent task that still sees "every provider keeps its adapter in adapter.ts" fail names it as Task 6's work in progress.
- **Wave 2:** Task 7 (needs Task 3's `UpgradeHeaders`, Task 4's lifts, Task 6's `C` and `K`) and Task 8 (needs Task 5's members and Task 6's `C`). Disjoint files: `wire.ts` and `check.ts`; `segments.ts`, the fixtures and the replay harness. Task 8's `segments.ts` holds the floor constant and `computeRms`, so neither task imports the other.
- **Wave 3:** Task 9 (needs Tasks 3, 7, 8; replaces the seed).
- **Wave 4:** Task 10 (needs Tasks 6, 7, 9).
- **The group check** (controller) after Wave 4; **Task 11** (controller) last.

---

### Task 1: Electron's upgrade header rules, by host and path (Wave 1)

**Files:**
- Create: `electron/ws-header-rules.js`
- Modify: `electron/main.js` (the `require` list; the rules' declaration above `initWebSocketHeaderInjection`; the WebSocket branch inside its one `onBeforeSendHeaders` listener; the `ws-headers-set` and `ws-headers-clear` handlers), `vite.config.ts` (the Electron main entry map)
- Test: `electron/ws-header-rules.test.js`, `electron/wsHeaderRules.wiring.test.js` (both new)

**Interfaces:**
- Consumes: nothing from this plan.
- Produces: `createWsHeaderRules()` → `{ set(args: { host, path?, headers, removeHeaders? }): { success: true } | { success: false, error }, clear(args: { host, path? }): same, take(url: string, requestHeaders: object): boolean, get size(): number }` — `size` a getter, read as `rules.size`; the IPC contract Task 3's `electronRegistrar` speaks: `ws-headers-set` with `{ host, path, headers, removeHeaders }`, `ws-headers-clear` with `{ host, path }`.

**The risk, stated** (ruling 7): this listener is process-wide. It carries Better Auth's cookie and `Origin` for `sokuji.kizuna.ai`, Bing's identity headers, and every WebSocket upgrade rule — Edge TTS's `User-Agent` (`src/lib/edge-tts/EdgeTtsConnection.ts`) and the old AST2 client's credentials, both of which call `ws-headers-set` with a host and no path. A mistake here breaks sign-in, the Bing translator or Edge TTS, none of which a provider suite runs. So: the rules' behaviour is pinned in the module's own suite, a host-wide rule behaving exactly as every rule did before (one-shot, any path, remove before set, values coerced, `null` / empty dropped); the listener's wiring is pinned on `main.js`' source text — the rules applied inside the one listener, after Better Auth's block and before Bing's, and the handlers logging names alone; and nothing else in `main.js` changes (the wiring test's anchors are Better Auth's and Bing's own lines).

- [ ] **Step 1: Write the failing tests.** Create `electron/ws-header-rules.test.js`:

```js
// electron/ws-header-rules.test.js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { createWsHeaderRules } = nodeRequire('./ws-header-rules.js');

/** An upgrade's headers as Chromium hands them over: its own Origin and User-Agent among them. */
const upgrade = () => ({ Origin: 'file://', 'User-Agent': 'Chrome', 'Sec-WebSocket-Version': '13' });
const LIVE = { host: 'api.openai.com', path: '/v1/live/', headers: { Authorization: 'Bearer sk-live' }, removeHeaders: ['Origin'] };

describe('the WebSocket upgrade header rules (Stage 2 OpenAI Live, ruling 7; choice 2)', () => {
  it("a host-wide rule — Edge TTS's, the old AST2 client's — applies to any path on its host, once, as every rule did before", () => {
    const rules = createWsHeaderRules();
    expect(rules.set({ host: 'speech.platform.bing.com', headers: { 'User-Agent': 'Edg/143' } })).toEqual({ success: true });
    const h = upgrade();
    expect(rules.take('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?X=1', h)).toBe(true);
    expect(h['User-Agent']).toBe('Edg/143');
    expect(h.Origin).toBe('file://');
    // One-shot: the next upgrade takes nothing.
    const again = upgrade();
    expect(rules.take('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1', again)).toBe(false);
    expect(again).toEqual(upgrade());
  });

  it("a rule with a path applies only under it: OpenAI Live's never reaches OpenAI Realtime's or Translate's upgrade on the same host", () => {
    const rules = createWsHeaderRules();
    rules.set(LIVE);
    for (const url of ['wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', 'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate', 'wss://api.openai.com/v1/live']) {
      const h = upgrade();
      expect(rules.take(url, h), url).toBe(false);
      expect(h).toEqual(upgrade());
    }
    const h = upgrade();
    expect(rules.take('wss://api.openai.com/v1/live/sessions', h)).toBe(true);
    expect(h).toEqual({ 'User-Agent': 'Chrome', 'Sec-WebSocket-Version': '13', Authorization: 'Bearer sk-live' });
    expect(rules.size).toBe(0);
  });

  it('the longest path wins, and a host-wide rule stays for the next upgrade it matches', () => {
    const rules = createWsHeaderRules();
    rules.set({ host: 'api.openai.com', headers: { 'X-Host': 'wide' } });
    rules.set(LIVE);
    const live = upgrade();
    rules.take('wss://api.openai.com/v1/live/sessions', live);
    expect(live).toMatchObject({ Authorization: 'Bearer sk-live' });
    expect(live).not.toHaveProperty('X-Host');
    const other = upgrade();
    rules.take('wss://api.openai.com/v1/realtime', other);
    expect(other).toMatchObject({ 'X-Host': 'wide' });
  });

  it('removes a listed header whatever its case, coerces values to strings, and drops null or empty ones', () => {
    const rules = createWsHeaderRules();
    rules.set({ host: 'h.example', headers: { 'X-App-Id': 1714584595, 'X-Empty': '', 'X-Null': null }, removeHeaders: [' ORIGIN ', '', 7] });
    const h = { origin: 'x', Other: 'y' };
    rules.take('wss://h.example/ws', h);
    expect(h).toEqual({ Other: 'y', 'X-App-Id': '1714584595' });
  });

  it('refuses a rule with no host, no headers, or a path that is not one', () => {
    const rules = createWsHeaderRules();
    expect(rules.set({ headers: {} })).toEqual({ success: false, error: 'Invalid arguments: host and headers required' });
    expect(rules.set({ host: 'h.example' })).toEqual({ success: false, error: 'Invalid arguments: host and headers required' });
    expect(rules.set({ host: 'h.example', path: 'v1', headers: {} })).toEqual({ success: false, error: 'Invalid arguments: path must start with /' });
    expect(rules.set(undefined)).toMatchObject({ success: false });
    expect(rules.size).toBe(0);
  });

  it('clears by host and path; a clear with no path clears the host-wide rule alone; a second set replaces the first', () => {
    const rules = createWsHeaderRules();
    rules.set({ host: 'api.openai.com', headers: { 'X-Host': 'wide' } });
    rules.set(LIVE);
    rules.set({ ...LIVE, headers: { Authorization: 'Bearer sk-newer' } });
    expect(rules.size).toBe(2);
    expect(rules.clear({ host: 'api.openai.com' })).toEqual({ success: true });
    const h = upgrade();
    rules.take('wss://api.openai.com/v1/live/sessions', h);
    expect(h.Authorization).toBe('Bearer sk-newer');
    rules.set(LIVE);
    rules.clear({ host: 'api.openai.com', path: '/v1/live/' });
    expect(rules.size).toBe(0);
    expect(rules.clear({})).toEqual({ success: false, error: 'Invalid arguments: host required' });
  });

  it('leaves an upgrade to another host, or to a URL it cannot read, as it was', () => {
    const rules = createWsHeaderRules();
    rules.set(LIVE);
    const h = upgrade();
    expect(rules.take('wss://api.openai.com.evil.example/v1/live/sessions', h)).toBe(false);
    expect(rules.take('not a url', h)).toBe(false);
    expect(h).toEqual(upgrade());
    expect(rules.size).toBe(1);
  });
});
```

Create `electron/wsHeaderRules.wiring.test.js`:

```js
// electron/wsHeaderRules.wiring.test.js
//
// main.js cannot be booted in vitest: its wiring of the upgrade header rules
// is asserted on its source text, as closeHandshake.wiring.test.js does. The
// one onBeforeSendHeaders listener is shared with Better Auth's cookies and
// Origin and Bing's headers; those stay as they were (Stage 2 OpenAI Live,
// choice 2).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const main = readFileSync(join(__dirname, 'main.js'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
function at(text, needle) {
  const i = text.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
}

/** The source of the `ipcMain.handle(channel, …)` registration. */
function handler(channel) {
  const start = at(main, `ipcMain.handle('${channel}'`);
  const rest = main.slice(start);
  return rest.slice(0, at(rest, '\n});') + 4);
}

describe('the upgrade header rules wiring', () => {
  it('builds its rules from the module, and keeps no map of its own', () => {
    expect(main).toContain("const { createWsHeaderRules } = require('./ws-header-rules.js');");
    expect(main).toContain('const wsHeaderRules = createWsHeaderRules();');
    expect(main).not.toMatch(/wsHeaderRules\.(get|delete)\(/);
  });

  it('applies the rule an upgrade matches inside the one listener, after Better Auth and before Bing', () => {
    const listener = main.slice(at(main, 'session.defaultSession.webRequest.onBeforeSendHeaders('));
    const auth = at(listener, 'authConfig.injectCookies(requestHeaders);');
    const take = at(listener, "if (details.resourceType === 'webSocket') {\n        wsHeaderRules.take(details.url, requestHeaders);\n      }");
    const bing = at(listener, "details.url.startsWith('https://www.bing.com/translator')");
    expect(auth).toBeLessThan(take);
    expect(take).toBeLessThan(bing);
    expect(at(listener, 'callback({ requestHeaders });')).toBeGreaterThan(bing);
  });

  it('registers and clears through the module, logging header names only', () => {
    const set = handler('ws-headers-set');
    expect(set).toContain('const result = wsHeaderRules.set(args);');
    expect(set).toContain('Object.keys(headers)');
    expect(set).not.toMatch(/Object\.values\(headers\)|headers\[/);
    expect(set).toContain('return result;');
    const clear = handler('ws-headers-clear');
    expect(clear).toContain('const result = wsHeaderRules.clear(args);');
    expect(clear).toContain('return result;');
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run electron/ws-header-rules.test.js electron/wsHeaderRules.wiring.test.js`
Expected: FAIL — `Test Files 2 failed (2)`, `Tests 3 failed (3)`: the rules' suite does not load (`Error: Cannot find module './ws-header-rules.js'`), and the wiring suite's three cases fail on `main.js`' source (no `createWsHeaderRules` require, no `take` in the listener, the handlers still building their own map).

- [ ] **Step 3: Write the module.** Create `electron/ws-header-rules.js`:

```js
// electron/ws-header-rules.js
//
// The WebSocket upgrade header rules the renderer registers over IPC
// ('ws-headers-set' / 'ws-headers-clear') and main's one onBeforeSendHeaders
// listener applies to the next upgrade they match. A browser cannot set an
// upgrade's headers itself: Edge TTS needs a User-Agent, the old Doubao AST 2.0
// client its credentials, and OpenAI Live a real Authorization and no Origin.
//
// A rule is keyed by host and path (Stage 2 OpenAI Live, ruling 7; choice 2):
// it applies to an upgrade to its host whose path starts with the rule's path,
// the longest such path winning, and a rule with no path applies to every path
// on its host, as every rule did before — so Edge TTS and the old AST2 client
// keep working unchanged. A Live rule under /v1/live/ therefore never reaches
// OpenAI Realtime's /v1/realtime or Translate's /v1/realtime/translations on
// the same host. A rule is one-shot: the upgrade it applies to consumes it.

/** A rule's key in the map: its host and its path, '' for every path. */
const keyOf = (host, path) => `${host}\u0000${path}`;

function createWsHeaderRules() {
  // key → { host, path, set: Map<name, value>, remove: Set<lowercased name> }
  const rules = new Map();

  /**
   * Registers a rule: `host` and a `headers` object are required; `path`, when
   * given, starts with '/'; `removeHeaders` names headers to strip from the
   * same upgrade, case-insensitively. Values are coerced to strings —
   * Chromium silently drops a header with a non-string value, and IPC can
   * turn a numeric string into a number — and a null or empty value is
   * dropped. A rule for the same host and path replaces it.
   */
  function set(args) {
    const { host, path, headers, removeHeaders } = args || {};
    if (!host || typeof host !== 'string' || !headers || typeof headers !== 'object') {
      return { success: false, error: 'Invalid arguments: host and headers required' };
    }
    if (path !== undefined && path !== '' && (typeof path !== 'string' || !path.startsWith('/'))) {
      return { success: false, error: 'Invalid arguments: path must start with /' };
    }
    const setHeaders = new Map(
      Object.entries(headers)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    );
    const remove = new Set(
      (Array.isArray(removeHeaders) ? removeHeaders : [])
        .filter((n) => typeof n === 'string' && n.trim() !== '')
        .map((n) => n.trim().toLowerCase()),
    );
    const rulePath = path || '';
    rules.set(keyOf(host, rulePath), { host, path: rulePath, set: setHeaders, remove });
    return { success: true };
  }

  /** Removes the rule for `host` and `path` ('' or absent: the host-wide one), if it is still there. */
  function clear(args) {
    const { host, path } = args || {};
    if (!host) return { success: false, error: 'Invalid arguments: host required' };
    rules.delete(keyOf(host, path || ''));
    return { success: true };
  }

  /**
   * Applies the rule an upgrade to `url` takes — its host's, the longest path
   * that prefixes the URL's path — to `requestHeaders`, and consumes it. The
   * header names and values of every other rule stay. Returns whether one
   * applied; a malformed URL takes none.
   */
  function take(url, requestHeaders) {
    let target;
    try {
      target = new URL(url);
    } catch {
      return false;
    }
    let best = null;
    for (const rule of rules.values()) {
      if (rule.host !== target.host) continue;
      if (rule.path && !target.pathname.startsWith(rule.path)) continue;
      if (!best || rule.path.length > best.path.length) best = rule;
    }
    if (!best) return false;
    if (best.remove.size > 0) {
      for (const name of Object.keys(requestHeaders)) {
        if (best.remove.has(name.toLowerCase())) delete requestHeaders[name];
      }
    }
    for (const [name, value] of best.set.entries()) requestHeaders[name] = value;
    rules.delete(keyOf(best.host, best.path));
    return true;
  }

  return {
    set,
    clear,
    take,
    /** How many rules wait for their upgrade: for tests. */
    get size() {
      return rules.size;
    },
  };
}

module.exports = { createWsHeaderRules };
```

- [ ] **Step 4: Wire `main.js` to it, and list it in the Electron entry map** (research note 10: `electron/entry-map.consistency.test.js` fails for a module `main.js` requires that the map does not list).

```diff
diff --git a/electron/main.js b/electron/main.js
--- a/electron/main.js
+++ b/electron/main.js
@@ -7,6 +7,7 @@
 const { setupPopoverWindowHandlers } = require('./popover-windows.js');
 const { setupTranscriptSaveHandler } = require('./transcript-save.js');
 const { createCloseHandshake } = require('./close-handshake.js');
+const { createWsHeaderRules } = require('./ws-header-rules.js');
 const { applyLinuxGpuFlags } = require('./linux-gpu-flags');
 const { acquireSingleInstanceLock, createFocusRelay } = require('./single-instance');
 
@@ -1063,10 +1064,10 @@
 // opening a WebSocket connection. This replaces the previous per-provider IPC
 // bridges (Volcengine, Edge TTS) that proxied every frame through main process.
 
-// Map<host, { set: Map<headerName, headerValue>, remove: Set<lowercased headerName> }>
-// `remove` exists for endpoints that reject a header the browser always adds:
-// OpenAI's Live WebSocket answers 403 to any upgrade carrying `Origin`.
-const wsHeaderRules = new Map();
+// The rules by host and path, one-shot (electron/ws-header-rules.js). A rule
+// may remove a header the browser always adds: OpenAI's Live WebSocket answers
+// 403 to any upgrade carrying `Origin`.
+const wsHeaderRules = createWsHeaderRules();
 
 function initWebSocketHeaderInjection() {
   // Retrieve Better Auth config (stored by better-auth-adapter.js)
@@ -1111,26 +1112,10 @@
       }
 
       // ── WebSocket: inject custom headers for provider connections ────
-      // One-shot: headers are consumed on first use and removed from the map,
-      // so they only apply to the intended upgrade handshake.
+      // One-shot: the rule the upgrade's host and path match is consumed by
+      // it, so it only applies to the intended upgrade handshake.
       if (details.resourceType === 'webSocket') {
-        try {
-          const url = new URL(details.url);
-          const rule = wsHeaderRules.get(url.host);
-          if (rule) {
-            if (rule.remove.size > 0) {
-              for (const name of Object.keys(requestHeaders)) {
-                if (rule.remove.has(name.toLowerCase())) delete requestHeaders[name];
-              }
-            }
-            for (const [name, value] of rule.set.entries()) {
-              requestHeaders[name] = value;
-            }
-            wsHeaderRules.delete(url.host);
-          }
-        } catch {
-          // Invalid URL — pass through unchanged
-        }
+        wsHeaderRules.take(details.url, requestHeaders);
       }
 
       // Bing Translator (HTTP): inject browser-like identity so the unofficial
@@ -1159,37 +1144,23 @@
   console.log('[Sokuji] [Main] Combined header injection initialized');
 }
 
-// IPC: renderer registers headers for a host before opening a WebSocket
-ipcMain.handle('ws-headers-set', (event, { host, headers, removeHeaders }) => {
-  if (!host || !headers || typeof headers !== 'object') {
-    return { success: false, error: 'Invalid arguments: host and headers required' };
-  }
-  // Coerce all values to strings — Chromium silently drops headers with non-string values.
-  // IPC serialization can turn numeric strings (e.g. App ID "1714584595") into numbers.
-  const entries = Object.entries(headers)
-    .filter(([, v]) => v != null && v !== '')
-    .map(([k, v]) => [k, String(v)]);
-  const headerMap = new Map(entries);
-  // Optional: header names to strip from the same upgrade (matched case-insensitively).
-  const remove = new Set(
-    (Array.isArray(removeHeaders) ? removeHeaders : [])
-      .filter((n) => typeof n === 'string' && n.trim() !== '')
-      .map((n) => n.trim().toLowerCase()),
-  );
-  wsHeaderRules.set(host, { set: headerMap, remove });
-  const removed = remove.size > 0 ? ` (removing: ${[...remove].join(', ')})` : '';
-  console.log(`[Sokuji] [Main] WS headers registered for ${host}: ${[...headerMap.keys()].join(', ')}${removed}`);
-  return { success: true };
-});
-
-// IPC: renderer clears headers for a host after disconnecting
-ipcMain.handle('ws-headers-clear', (event, { host }) => {
-  if (!host) {
-    return { success: false, error: 'Invalid arguments: host required' };
-  }
-  wsHeaderRules.delete(host);
-  console.log(`[Sokuji] [Main] WS headers cleared for ${host}`);
-  return { success: true };
+// IPC: renderer registers headers for a host, and optionally a path, before opening a WebSocket
+ipcMain.handle('ws-headers-set', (event, args) => {
+  const result = wsHeaderRules.set(args);
+  if (result.success) {
+    // Header names only, never a value: a value may be a credential.
+    const { host, path, headers, removeHeaders } = args;
+    const removed = Array.isArray(removeHeaders) && removeHeaders.length > 0 ? ` (removing: ${removeHeaders.join(', ')})` : '';
+    console.log(`[Sokuji] [Main] WS headers registered for ${host}${path || ''}: ${Object.keys(headers).join(', ')}${removed}`);
+  }
+  return result;
+});
+
+// IPC: renderer clears the headers for a host, and optionally a path, after disconnecting
+ipcMain.handle('ws-headers-clear', (event, args) => {
+  const result = wsHeaderRules.clear(args);
+  if (result.success) console.log(`[Sokuji] [Main] WS headers cleared for ${args.host}${args.path || ''}`);
+  return result;
 });
 
 // Screen recording permission check for macOS system audio capture
diff --git a/vite.config.ts b/vite.config.ts
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -160,7 +160,8 @@
             'update-manager': 'electron/update-manager.js',
             'update-payload': 'electron/update-payload.js',
             'window-caption-dblclick': 'electron/window-caption-dblclick.js',
-            'window-caption-menu': 'electron/window-caption-menu.js'
+            'window-caption-menu': 'electron/window-caption-menu.js',
+            'ws-header-rules': 'electron/ws-header-rules.js'
           },
           onstart(args) {
             // SOKUJI_DEV_NO_ELECTRON=1 serves the renderer alone, for headless
```

- [ ] **Step 5: Run the Electron suites.**

Run: `npx vitest run electron/ws-header-rules.test.js electron/wsHeaderRules.wiring.test.js`
Expected: PASS — 2 files, 10 tests.

Run: `npx vitest run electron`
Expected: PASS — 34 files, 477 tests (32 files, 465 tests at `a3eab634`), `entry-map.consistency.test.js` among them.

- [ ] **Step 6: The gates.** No file under `src/` changed: the suite and the typecheck gate as the wave finds them (a failure in another task's files is that task's).

- [ ] **Step 7: Commit.**

```bash
git add electron/ws-header-rules.js electron/ws-header-rules.test.js electron/wsHeaderRules.wiring.test.js electron/main.js vite.config.ts
```

```bash
git commit -q -F - -- electron/ws-header-rules.js electron/ws-header-rules.test.js electron/wsHeaderRules.wiring.test.js electron/main.js vite.config.ts <<'EOF'
feat(electron): scope WebSocket upgrade header rules by path

The upgrade header rules move out of main.js into a tested module keyed
by host and path: a rule applies to an upgrade whose path starts with
its own, the longest winning, once. A rule with no path applies to the
whole host as before, so Edge TTS and the old AST2 client are unchanged,
and a rule for OpenAI Live's path never reaches OpenAI Realtime's or
Translate's upgrade on the same host. The handlers log header names
only.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: The extension's generic upgrade header rules (Wave 1)

**Files:**
- Create: `extension/background/wsHeaderRule.js`
- Modify: `extension/background/background.js` (the module import; three functions and two start listeners after `openaiLiveClearDNRHeaders`, before the Bing block; one message branch after the `OPENAI_LIVE_CLEAR_HEADERS` branch), `extension/vite.config.ts` (the static copy list)
- Test: `extension/background/wsHeaderRule.test.ts`, `extension/background/background.wsHeaders.test.ts` (both new)

**Interfaces:**
- Consumes: nothing from this plan.
- Produces: the messages `{ type: 'WS_HEADERS_SET', host, path, set, remove }` and `{ type: 'WS_HEADERS_CLEAR', host, path }`, answered `{ success: true }` or `{ success: false, error }` — what Task 3's `extensionRegistrar` sends; `wsHeaderRule.js`: `WS_RULE_ID_MIN` (5000), `WS_RULE_ID_MAX` (5099), `urlFilterFor(host, path)`, `ruleProblem(message)`, `ruleIdsFor(existing, host, path)`, `OLD_LIVE_RULE_ID` (4000), `sweepIds(existing)` (the range and 4000; ruling 11), `buildRule(existing, message, runtimeId)`, `isExtensionPage(sender, runtimeId, pageBase)` (`pageBase` = `chrome.runtime.getURL('')`, handed in by `background.js`).

**The risk, stated** (ruling 7): the background worker's `declarativeNetRequest` chain (`dnrUpdatePromise`) serializes every dynamic-rule update — the old AST2 rules, Edge TTS's, the old OpenAI Live rule, Bing's — and one rejected link would stall them all; a rule without `initiatorDomains` would authenticate any page's socket to the host as the user (the spec's AST2 finding). So: the rules are built by pure functions with their own suite (the id range, the filter, `initiatorDomains`, the sender test against the pages' base the browser gives, the sweep taking the old Live rule 4000 and never another block's ids); the worker's wiring is pinned on its source text (an MV3 module service worker cannot be loaded in a test): the sender checked before anything against `chrome.runtime.getURL('')`, validation before the chain, every link caught so the chain never stays rejected, the sweep at `onStartup` and `onInstalled`, and the old `OPENAI_LIVE_*` pair unchanged. **Revision 1:** the sender's base read from the browser (the controller's ruling on the review's M2) and id 4000 swept (ruling 11).

- [ ] **Step 1: Write the failing tests.** Create `extension/background/wsHeaderRule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRule, isExtensionPage, OLD_LIVE_RULE_ID, ruleIdsFor, ruleProblem, sweepIds, urlFilterFor, WS_RULE_ID_MAX, WS_RULE_ID_MIN } from './wsHeaderRule.js';

const RUNTIME = 'abcdefghijklmnopabcdefghijklmnop';
/** What `chrome.runtime.getURL('')` answers in Chrome. */
const PAGES = `chrome-extension://${RUNTIME}/`;
const LIVE = { host: 'api.openai.com', path: '/v1/live/', set: { Authorization: 'Bearer sk-live' }, remove: ['Origin'] };
/** Dynamic rules as `getDynamicRules()` returns them: the old providers' among them. */
const OLD = [
  { id: 2000, condition: { urlFilter: '||openspeech.bytedance.com' } },
  { id: 3000, condition: { urlFilter: '||speech.platform.bing.com' } },
  { id: 4000, condition: { urlFilter: '||api.openai.com/v1/live/' } },
  { id: 9301, condition: { urlFilter: '||api-edge.cognitive.microsofttranslator.com' } },
];

describe("the extension's generic upgrade header rules (Stage 2 OpenAI Live, ruling 7; choice 3)", () => {
  it('builds a websocket rule for the host and path, setting and removing the headers, scoped to the extension itself, at the first free id of its range', () => {
    expect(urlFilterFor('api.openai.com', '/v1/live/')).toBe('||api.openai.com/v1/live/');
    expect(buildRule(OLD, LIVE, RUNTIME)).toEqual({
      id: WS_RULE_ID_MIN,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Authorization', operation: 'set', value: 'Bearer sk-live' }, { header: 'Origin', operation: 'remove' }],
      },
      condition: { urlFilter: '||api.openai.com/v1/live/', resourceTypes: ['websocket'], initiatorDomains: [RUNTIME] },
    });
  });

  it('reuses the id its host and path already hold, takes the lowest free one otherwise, and has none when the range is full', () => {
    const held = [...OLD, { id: 5000, condition: { urlFilter: '||h.example/a/' } }, { id: 5002, condition: { urlFilter: '||api.openai.com/v1/live/' } }];
    expect(buildRule(held, LIVE, RUNTIME)?.id).toBe(5002);
    expect(buildRule(held, { ...LIVE, path: '/v2/' }, RUNTIME)?.id).toBe(5001);
    const full = Array.from({ length: WS_RULE_ID_MAX - WS_RULE_ID_MIN + 1 }, (_, i) => ({ id: WS_RULE_ID_MIN + i, condition: { urlFilter: `||h${i}.example/` } }));
    expect(buildRule(full, LIVE, RUNTIME)).toBeNull();
  });

  it("finds a host and path's rules to clear, and sweeps every generic rule and the old Live rule — never another provider's (ruling 11)", () => {
    const rules = [...OLD, { id: 5000, condition: { urlFilter: '||api.openai.com/v1/live/' } }, { id: 5001, condition: { urlFilter: '||h.example/' } }];
    expect(ruleIdsFor(rules, 'api.openai.com', '/v1/live/')).toEqual([5000]);
    expect(ruleIdsFor(rules, 'api.openai.com', '/v1/')).toEqual([]);
    expect(OLD_LIVE_RULE_ID).toBe(4000);
    expect(sweepIds(rules)).toEqual([4000, 5000, 5001]);
    expect(sweepIds(OLD.filter((r) => r.id !== 4000))).toEqual([]);
  });

  it('refuses a message that names no rule it would install', () => {
    expect(ruleProblem(LIVE)).toBeNull();
    expect(ruleProblem({ ...LIVE, remove: [] })).toBeNull();
    expect(ruleProblem(undefined)).toBe('host must be a host name');
    expect(ruleProblem({ ...LIVE, host: 'api.openai.com/v1' })).toBe('host must be a host name');
    expect(ruleProblem({ ...LIVE, path: 'v1/live/' })).toBe('path must start with / and hold no filter marks');
    expect(ruleProblem({ ...LIVE, path: '/v1/*' })).toBe('path must start with / and hold no filter marks');
    expect(ruleProblem({ ...LIVE, set: [] })).toBe('set must be an object of headers');
    expect(ruleProblem({ ...LIVE, set: { 'Bad Name': 'x' } })).toBe('set must map header names to values');
    expect(ruleProblem({ ...LIVE, set: { Authorization: 7 } })).toBe('set must map header names to values');
    expect(ruleProblem({ ...LIVE, remove: 'Origin' })).toBe('remove must list header names');
    expect(ruleProblem({ ...LIVE, set: {}, remove: [] })).toBe('the rule sets and removes nothing');
  });

  it("takes a message from the extension's own pages alone: never a content script's, whose sender is a web page", () => {
    expect(isExtensionPage({ id: RUNTIME, url: `${PAGES}fullpage.html` }, RUNTIME, PAGES)).toBe(true);
    expect(isExtensionPage({ id: RUNTIME, url: 'https://meet.google.com/abc', tab: { id: 1 } }, RUNTIME, PAGES)).toBe(false);
    expect(isExtensionPage({ id: 'another', url: `${PAGES}fullpage.html` }, RUNTIME, PAGES)).toBe(false);
    expect(isExtensionPage(undefined, RUNTIME, PAGES)).toBe(false);
    expect(isExtensionPage({ id: RUNTIME, url: `${PAGES}fullpage.html` }, RUNTIME, '')).toBe(false);
  });

  it("reads the pages' base from the browser, assuming no scheme: a browser that serves its pages elsewhere is answered all the same", () => {
    const elsewhere = `extension://${RUNTIME}/`;
    expect(isExtensionPage({ id: RUNTIME, url: `${elsewhere}sidepanel.html` }, RUNTIME, elsewhere)).toBe(true);
    expect(isExtensionPage({ id: RUNTIME, url: `${PAGES}sidepanel.html` }, RUNTIME, elsewhere)).toBe(false);
  });
});
```

Create `extension/background/background.wsHeaders.test.ts`:

```ts
// The background worker cannot be booted in vitest (it imports a build-generated
// table and registers chrome listeners at load): its wiring of the generic
// upgrade header rules is asserted on its source text, as Electron's wiring
// tests do (Stage 2 OpenAI Live, choice 3).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const background = readFileSync(join(__dirname, 'background.js'), 'utf8');
const viteConfig = readFileSync(join(__dirname, '..', 'vite.config.ts'), 'utf8');

/** Index of `needle` in `text`; fails (rather than returning -1) when it is gone. */
function at(text: string, needle: string): number {
  const i = text.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
}

/** A function's source, to its closing brace at the start of a line. */
function fn(name: string): string {
  const rest = background.slice(at(background, `function ${name}(`));
  return rest.slice(0, at(rest, '\n}') + 2);
}

describe('the background worker: the generic upgrade header rules', () => {
  it('imports the pure rules, which the build copies beside it', () => {
    expect(background).toContain("import { buildRule, isExtensionPage, ruleIdsFor, ruleProblem, sweepIds } from './wsHeaderRule.js';");
    expect(viteConfig).toContain("{ src: 'background/wsHeaderRule.js', dest: '.' },");
  });

  it("answers WS_HEADERS_SET and WS_HEADERS_CLEAR only for the extension's own pages, checking the sender before anything", () => {
    const branch = background.slice(at(background, "if (message.type === 'WS_HEADERS_SET' || message.type === 'WS_HEADERS_CLEAR') {"));
    const check = at(branch, "if (!isExtensionPage(sender, chrome.runtime.id, chrome.runtime.getURL(''))) {");
    expect(check).toBeLessThan(at(branch, 'wsHeadersSet(message)'));
    expect(check).toBeLessThan(at(branch, 'wsHeadersClear(message)'));
    expect(branch.slice(check)).toContain("sendResponse({ success: false, error: 'Sender is not an extension page' });");
  });

  it('validates before the shared chain, chains every update on it, and never leaves it rejected', () => {
    const set = fn('wsHeadersSet');
    expect(at(set, 'ruleProblem(message)')).toBeLessThan(at(set, 'dnrUpdatePromise.then('));
    for (const name of ['wsHeadersSet', 'wsHeadersClear', 'wsHeadersSweep']) {
      const body = fn(name);
      expect(body, name).toContain('dnrUpdatePromise.then(');
      expect(body, name).toContain('dnrUpdatePromise = run.catch(() => {});');
    }
    expect(fn('wsHeadersSet')).toContain('removeRuleIds: [rule.id], addRules: [rule]');
    expect(fn('wsHeadersClear')).toContain('ruleIdsFor(');
    expect(fn('wsHeadersSweep')).toContain('sweepIds(');
  });

  it('sweeps the generic rules and the old Live rule when the browser or the extension starts, since dynamic rules outlive both (ruling 11)', () => {
    expect(background).toContain('chrome.runtime.onStartup.addListener(() => { void wsHeadersSweep(); });');
    expect(background).toContain('chrome.runtime.onInstalled.addListener(() => { void wsHeadersSweep(); });');
  });

  it("leaves the old OpenAI Live pair as it was: it goes with the old client", () => {
    expect(background).toContain("if (message.type === 'OPENAI_LIVE_SET_HEADERS') {");
    expect(background).toContain("if (message.type === 'OPENAI_LIVE_CLEAR_HEADERS') {");
    expect(background).toContain('const OPENAI_LIVE_DNR_RULE_ID = 4000;');
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run extension/background`
Expected: FAIL — `Test Files 2 failed (2)`, `Tests 4 failed | 1 passed (5)`: the rules' suite does not load (`Failed to resolve import "./wsHeaderRule.js"`), and four of the wiring suite's five cases fail on `background.js`' source. Its fifth, "leaves the old OpenAI Live pair as it was", passes before as after: it pins what must not change.

- [ ] **Step 3: Write the pure rules.** Create `extension/background/wsHeaderRule.js`:

```js
// extension/background/wsHeaderRule.js
//
// The WebSocket upgrade header rules the background installs for the
// extension's own pages (`WS_HEADERS_SET` / `WS_HEADERS_CLEAR`), as pure
// functions: a declarativeNetRequest dynamic rule per host and path, the
// headers set and removed, scoped to websocket upgrades the extension itself
// makes (`initiatorDomains`), in an id range of their own (Stage 2 OpenAI
// Live, ruling 7; choice 3). OpenAI Live is the first user: a real
// Authorization and no Origin, which every browser adds and its endpoint
// answers with 403. The old per-provider pairs stay until their clients go.
// No chrome.* here: background.js reads the rules, hands in the extension's id
// and its pages' base URL, and applies what these return.

/** The range the generic rules live in: a rule a crash left behind is found here, and nothing else is touched. */
export const WS_RULE_ID_MIN = 5000;
export const WS_RULE_ID_MAX = 5099;

/** An HTTP header name (RFC 9110 `token`). */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HOST = /^[A-Za-z0-9.-]+(:\d+)?$/;

/** The rule's URL filter: its host, anchored at a domain boundary, and the path under it. */
export function urlFilterFor(host, path) {
  return `||${host}${path}`;
}

/** Why a message names no rule this background will install, or null: a host, a path under it, and headers set or removed by name. */
export function ruleProblem(message) {
  const { host, path, set, remove } = message || {};
  if (typeof host !== 'string' || !HOST.test(host)) return 'host must be a host name';
  if (typeof path !== 'string' || !path.startsWith('/') || /[*|^]/.test(path)) return 'path must start with / and hold no filter marks';
  if (!set || typeof set !== 'object' || Array.isArray(set)) return 'set must be an object of headers';
  for (const [name, value] of Object.entries(set)) {
    if (!TOKEN.test(name) || typeof value !== 'string' || value === '') return 'set must map header names to values';
  }
  if (!Array.isArray(remove) || remove.some((name) => typeof name !== 'string' || !TOKEN.test(name))) return 'remove must list header names';
  if (Object.keys(set).length === 0 && remove.length === 0) return 'the rule sets and removes nothing';
  return null;
}

/**
 * The old OpenAI Live client's rule (`OPENAI_LIVE_DNR_RULE_ID` in
 * background.js): the same filter, the same initiator. One its client left
 * behind would hold an old key and reach the new upgrade, so the sweep takes it
 * too (Stage 2 OpenAI Live, ruling 11).
 */
export const OLD_LIVE_RULE_ID = 4000;

const inRange = (rule) => rule.id >= WS_RULE_ID_MIN && rule.id <= WS_RULE_ID_MAX;

/** The generic rules' ids for this host and path: what a clear removes. */
export function ruleIdsFor(existing, host, path) {
  const filter = urlFilterFor(host, path);
  return existing.filter((r) => inRange(r) && r.condition?.urlFilter === filter).map((r) => r.id);
}

/** Every generic rule's id, and the old Live rule's: what the sweep at a start removes. */
export function sweepIds(existing) {
  return existing.filter((r) => inRange(r) || r.id === OLD_LIVE_RULE_ID).map((r) => r.id);
}

/**
 * The rule for `message`, under the id its host and path already hold, else
 * the lowest free one in the range; null when the range is full. Scoped to
 * websocket upgrades the extension's own pages make: while it is installed, no
 * other page opening a socket to the host gets its headers.
 */
export function buildRule(existing, message, runtimeId) {
  const filter = urlFilterFor(message.host, message.path);
  const held = existing.find((r) => inRange(r) && r.condition?.urlFilter === filter);
  let id = held?.id;
  if (id === undefined) {
    const taken = new Set(existing.filter(inRange).map((r) => r.id));
    for (let candidate = WS_RULE_ID_MIN; candidate <= WS_RULE_ID_MAX; candidate++) {
      if (!taken.has(candidate)) {
        id = candidate;
        break;
      }
    }
  }
  if (id === undefined) return null;
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        ...Object.entries(message.set).map(([header, value]) => ({ header, operation: 'set', value })),
        ...message.remove.map((header) => ({ header, operation: 'remove' })),
      ],
    },
    condition: { urlFilter: filter, resourceTypes: ['websocket'], initiatorDomains: [runtimeId] },
  };
}

/**
 * A message from one of the extension's own pages — the side panel, the full
 * page — never a content script's, whose sender is a web page. `pageBase` is
 * `chrome.runtime.getURL('')`, so no browser's scheme is assumed.
 */
export function isExtensionPage(sender, runtimeId, pageBase) {
  return !!sender && sender.id === runtimeId && typeof pageBase === 'string' && pageBase !== '' && typeof sender.url === 'string' && sender.url.startsWith(pageBase);
}
```

- [ ] **Step 4: Wire the worker, and copy the module beside it** (research note 11).

```diff
diff --git a/extension/background/background.js b/extension/background/background.js
--- a/extension/background/background.js
+++ b/extension/background/background.js
@@ -8,6 +8,8 @@
 // globalThis.SOKUJI_PLATFORMS before any of our handlers fire. The generated
 // file is emitted to the build root next to background.js (see vite.config.ts).
 import './platforms.generated.js';
+// The generic upgrade header rules, as pure functions: copied beside this file at build (vite.config.ts).
+import { buildRule, isExtensionPage, ruleIdsFor, ruleProblem, sweepIds } from './wsHeaderRule.js';
 
 // Uninstall feedback URL - hosted on backend
 const UNINSTALL_FEEDBACK_BASE_URL = 'https://sokuji.kizuna.ai/uninstall-feedback';
@@ -445,6 +447,50 @@
   return run;
 }
 
+// ─── Generic WebSocket upgrade header rules ─────────────────────────────────
+// One message pair for every provider whose upgrade needs a header a browser
+// cannot set (wsHeaderRule.js): a rule per host and path, scoped to the
+// extension's own pages, removed as soon as the upgrade is made (Stage 2
+// OpenAI Live, ruling 7; choice 3). Chained on the shared dnrUpdatePromise and
+// never left rejected. The per-provider pairs above go with their old clients.
+async function wsHeadersSet(message) {
+  // Validate before touching the shared chain.
+  const problem = ruleProblem(message);
+  if (problem) throw new Error(`WS headers: ${problem}`);
+  const run = dnrUpdatePromise.then(async () => {
+    const rule = buildRule(await chrome.declarativeNetRequest.getDynamicRules(), message, chrome.runtime.id);
+    if (!rule) throw new Error('WS headers: no rule id is free');
+    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [rule.id], addRules: [rule] });
+    // The filter, never a header value.
+    console.debug('[Sokuji] [Background] WS header rule registered:', rule.condition.urlFilter);
+  });
+  // The shared chain must never stay rejected; the caller still sees the failure via `run`.
+  dnrUpdatePromise = run.catch(() => {});
+  return run;
+}
+
+async function wsHeadersClear(message) {
+  const run = dnrUpdatePromise.then(async () => {
+    const ids = ruleIdsFor(await chrome.declarativeNetRequest.getDynamicRules(), message.host, message.path);
+    if (ids.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
+  });
+  dnrUpdatePromise = run.catch(() => {});
+  return run;
+}
+
+// Dynamic rules outlive a browser restart: one a crash left installed goes when the browser or the extension next starts,
+// and so does the old OpenAI Live client's, which nothing else will clear once that client is gone (ruling 11).
+function wsHeadersSweep() {
+  const run = dnrUpdatePromise.then(async () => {
+    const ids = sweepIds(await chrome.declarativeNetRequest.getDynamicRules());
+    if (ids.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
+  });
+  dnrUpdatePromise = run.catch(() => {});
+  return run.catch((error) => console.error('[Sokuji] [Background] Failed to sweep WS header rules:', error));
+}
+chrome.runtime.onStartup.addListener(() => { void wsHeadersSweep(); });
+chrome.runtime.onInstalled.addListener(() => { void wsHeadersSweep(); });
+
 // ─── Bing Translator declarativeNetRequest header injection ───────────────────
 // Bing Translator's /ttranslatev3 endpoint requires browser-like headers or it
 // returns 403/empty responses. We inject them via declarativeNetRequest so the
@@ -602,6 +648,21 @@
         sendResponse({ success: false, error: error.message });
       });
     return true;
+  }
+
+  // Generic WebSocket upgrade header rules: from the extension's own pages alone.
+  if (message.type === 'WS_HEADERS_SET' || message.type === 'WS_HEADERS_CLEAR') {
+    if (!isExtensionPage(sender, chrome.runtime.id, chrome.runtime.getURL(''))) {
+      sendResponse({ success: false, error: 'Sender is not an extension page' });
+      return false;
+    }
+    (message.type === 'WS_HEADERS_SET' ? wsHeadersSet(message) : wsHeadersClear(message))
+      .then(() => sendResponse({ success: true }))
+      .catch((error) => {
+        console.error('[Sokuji] [Background] Failed to update WS header rules:', error);
+        sendResponse({ success: false, error: error.message });
+      });
+    return true;
   }
 
   // Handle Bing Translator DNR header injection
diff --git a/extension/vite.config.ts b/extension/vite.config.ts
--- a/extension/vite.config.ts
+++ b/extension/vite.config.ts
@@ -61,6 +61,8 @@
         targets: [
           // Content scripts and background (vanilla JS, no bundling needed)
           { src: 'background/background.js', dest: '.' },
+          // Its generic upgrade header rules, which it imports as a module.
+          { src: 'background/wsHeaderRule.js', dest: '.' },
           { src: 'content/content.js', dest: '.' },
           { src: 'content/zoom-content.js', dest: '.' },
           { src: 'content/subtitle-overlay-content.js', dest: '.' },
```

- [ ] **Step 5: Run the extension's suites.**

Run: `npx vitest run extension/background`
Expected: PASS — 2 files, 11 tests.

Run: `npx vitest run extension`
Expected: PASS — 9 files, 56 tests (7 files, 45 tests at `a3eab634`).

- [ ] **Step 6: The gates.** No file under `src/` changed: the suite and the typecheck gate as the wave finds them. The extension's build is the group check's (`npm run extension:build`, then `extension/dist/wsHeaderRule.js` beside `background.js`).

- [ ] **Step 7: Commit.**

```bash
git add extension/background/wsHeaderRule.js extension/background/wsHeaderRule.test.ts extension/background/background.wsHeaders.test.ts extension/background/background.js extension/vite.config.ts
```

```bash
git commit -q -F - -- extension/background/wsHeaderRule.js extension/background/wsHeaderRule.test.ts extension/background/background.wsHeaders.test.ts extension/background/background.js extension/vite.config.ts <<'EOF'
feat(extension): generic WebSocket upgrade header rules

WS_HEADERS_SET and WS_HEADERS_CLEAR install and remove one
declarativeNetRequest rule per host and path, for the extension's own
pages only: the sender is checked first, against the pages' base the
browser gives, the rule sets initiatorDomains to the extension,
validation runs before the shared rule chain, and the chain is never
left rejected. Rules left by a crash, and the old OpenAI Live client's
rule, are swept when the browser or the extension starts. The old
per-provider pairs are left as they are.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: F14, the header seam, and its fake (Wave 1)

**Files:**
- Create: `src/lib/contract/headerSocket.ts`, `src/lib/contract/testing/headerSocket.ts` (test-only)
- Modify: `src/lib/contract/socket.ts` (its header comment)
- Test: `src/lib/contract/headerSocket.test.ts`, `src/lib/contract/testing/headerSocket.test.ts` (both new)

**Interfaces:**
- Consumes: `nativeSocket` (`src/lib/contract/socket.ts`), `Clock` (`./clock`), `getEnvironment` (`src/utils/environment.ts`), `fakeSockets` / `FakeSockets` (`./testing/fakeSocket`); the IPC contract of Task 1 and the messages of Task 2 (their names and fields only: no import).
- Produces:
  - `headerSocket.ts`: `UpgradeHeaders { set: Readonly<Record<string, string>>; remove?: readonly string[] }`; `OpenHeaderSocket = (url: string, headers: UpgradeHeaders, o: { signal: AbortSignal; clock: Pick<Clock, 'setTimeout'> }) => Promise<WebSocket>`; `HeaderRule { host; path; set; remove }`; `HeaderRegistrar { set(rule): Promise<void>; clear(rule: Pick<HeaderRule, 'host' | 'path'>): void }`; `HEADER_SOCKET_CAP_MS` (15 000); `HeaderSocketFailure = 'unsupported' | 'register' | 'never_opened' | 'timeout'`; `class HeaderSocketError extends Error { reason; cause? }`; `ruleFor(url, headers): HeaderRule`; `createHeaderSocket(registrar: () => HeaderRegistrar | null, openSocket?: (url: string) => WebSocket): OpenHeaderSocket`; `electronRegistrar`, `extensionRegistrar`, `platformRegistrar()`, `platformHeaderSocket`.
  - `testing/headerSocket.ts`: `Registration extends HeaderRule { cleared: boolean }`; `FakeHeaderSockets { open; sockets; registrations; refuseNext(reason?); holdNext(): () => void }`; `fakeHeaderSockets(sockets?: FakeSockets): FakeHeaderSockets`.

- [ ] **Step 1: Write the failing tests.** Create `src/lib/contract/headerSocket.test.ts`:

```ts
/**
 * F14, the header seam (Stage 2 OpenAI Live, ruling 7; choice 1): the rule
 * before the socket, cleared at the socket's first open, error or close; one
 * upgrade at a time per rule key; the bound; an abort anywhere; the web's
 * refusal; each platform's registrar; and fixed words that carry no header
 * value. Over `FakeSocket`s on a virtual clock.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from './clock';
import {
  createHeaderSocket, electronRegistrar, extensionRegistrar, HEADER_SOCKET_CAP_MS, HeaderSocketError, platformRegistrar, ruleFor,
  type HeaderRegistrar, type HeaderRule,
} from './headerSocket';
import { flush } from './testing/drive';
import { FakeSocket, fakeSockets } from './testing/fakeSocket';

afterEach(() => {
  vi.unstubAllGlobals();
});

const URL_LIVE = 'wss://api.openai.com/v1/live/sessions';
const HEADERS = { set: { Authorization: 'Bearer sk-proj-seamKey0123456789' }, remove: ['Origin'] };

/** A registrar that records what it was asked, answering each registration when the test says. */
function registrar() {
  const calls: string[] = [];
  const pending: Array<{ rule: HeaderRule; answer(error?: Error): void }> = [];
  const r: HeaderRegistrar = {
    set: (rule) => new Promise<void>((resolve, reject) => {
      calls.push(`set ${rule.host}${rule.path}`);
      pending.push({ rule, answer: (error) => (error ? reject(error) : resolve()) });
    }),
    clear: (rule) => { calls.push(`clear ${rule.host}${rule.path}`); },
  };
  return { r, calls, answer: (error?: Error) => pending.shift()?.answer(error) };
}

function seam() {
  const sockets = fakeSockets();
  const reg = registrar();
  const clock = createVirtualClock(0);
  const open = createHeaderSocket(() => reg.r, (url) => sockets.create(url));
  const controller = new AbortController();
  return { sockets, reg, clock, open, controller, start: (url = URL_LIVE, signal = controller.signal) => open(url, HEADERS, { signal, clock }) };
}

describe('the header seam (F14)', () => {
  it("keys a rule by the URL's host and its path to the last slash, the endpoint's own", () => {
    expect(ruleFor(URL_LIVE, HEADERS)).toEqual({ host: 'api.openai.com', path: '/v1/live/', set: HEADERS.set, remove: ['Origin'] });
    expect(ruleFor('wss://speech.example.test:8443/ws', { set: { 'User-Agent': 'x' } })).toEqual({ host: 'speech.example.test:8443', path: '/', set: { 'User-Agent': 'x' }, remove: [] });
  });

  it('installs the rule before it makes the socket, resolves with the socket once open, and clears the rule then', async () => {
    const h = seam();
    let socket: WebSocket | null = null;
    void h.start().then((s) => { socket = s; });
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/']);
    expect(h.sockets.all).toEqual([]);
    h.reg.answer();
    await flush();
    expect(h.sockets.last().url).toBe(URL_LIVE);
    expect(socket).toBeNull();
    h.sockets.last().open();
    await flush();
    expect(socket).toBe(h.sockets.last());
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/']);
    expect(h.clock.pending()).toBe(0);
  });

  it('a socket that errors or closes before it opens is refused as never opened; its rule is cleared', async () => {
    for (const end of [(s: FakeSocket) => s.drop(), (s: FakeSocket) => s.serverClose(1011)]) {
      const h = seam();
      const opening = h.start();
      await flush();
      h.reg.answer();
      await flush();
      end(h.sockets.last());
      await expect(opening).rejects.toMatchObject({ name: 'HeaderSocketError', reason: 'never_opened', message: 'The socket closed before it opened.' });
      await flush();
      expect(h.reg.calls.slice(-1)).toEqual(['clear api.openai.com/v1/live/']);
      expect(h.clock.pending()).toBe(0);
    }
  });

  it('a registration the platform refuses opens nothing and clears nothing, in fixed words that keep its cause', async () => {
    const h = seam();
    const opening = h.start();
    await flush();
    const cause = new Error('ws-headers-set: Invalid arguments');
    h.reg.answer(cause);
    const error = await opening.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HeaderSocketError);
    expect(error).toMatchObject({ reason: 'register', message: "The app could not set the socket's upgrade headers.", cause });
    expect(h.sockets.all).toEqual([]);
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/']);
  });

  it('an abort before the call registers nothing; during the registration it rejects at once and sends the clear at once — the channel is ordered, so it lands after the set — no socket made', async () => {
    const before = seam();
    before.controller.abort(new Error('stopped'));
    await expect(before.start()).rejects.toThrow('stopped');
    await flush();
    expect(before.reg.calls).toEqual([]);

    const during = seam();
    const opening = during.start();
    await flush();
    during.controller.abort(new Error('stopped'));
    await expect(opening).rejects.toThrow('stopped');
    await flush();
    expect(during.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/']);
    during.reg.answer();
    await flush();
    expect(during.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/']);
    expect(during.sockets.all).toEqual([]);
    expect(during.clock.pending()).toBe(0);
  });

  it(`a registration that never answers holds the gate no longer than the leg's ${HEADER_SOCKET_CAP_MS / 1000} s: its clear is sent, and the next leg at the key registers and upgrades`, async () => {
    const h = seam();
    const first = h.start();
    const second = h.start();
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/']);
    h.clock.advance(HEADER_SOCKET_CAP_MS);
    await expect(first).rejects.toMatchObject({ reason: 'timeout' });
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/', 'set api.openai.com/v1/live/']);
    expect(h.sockets.all).toEqual([]);
    // The first answer, however late, opens nothing; the second's leg upgrades.
    h.reg.answer();
    h.reg.answer();
    await flush();
    expect(h.sockets.all).toHaveLength(1);
    h.sockets.last().open();
    await expect(second).resolves.toBe(h.sockets.last());
  });

  it('an abort while the socket connects closes it and clears the rule', async () => {
    const h = seam();
    const opening = h.start();
    await flush();
    h.reg.answer();
    await flush();
    h.controller.abort(new Error('stopped'));
    await expect(opening).rejects.toThrow('stopped');
    await flush();
    expect(h.sockets.last().readyState).toBe(FakeSocket.CLOSED);
    expect(h.reg.calls.slice(-1)).toEqual(['clear api.openai.com/v1/live/']);
  });

  it(`registration and upgrade are bounded at ${HEADER_SOCKET_CAP_MS / 1000} s from the gate, on the caller's clock`, async () => {
    const h = seam();
    const opening = h.start();
    await flush();
    h.clock.advance(HEADER_SOCKET_CAP_MS - 1);
    h.reg.answer();
    await flush();
    h.clock.advance(1);
    await expect(opening).rejects.toMatchObject({ reason: 'timeout', message: `The socket did not open within ${HEADER_SOCKET_CAP_MS / 1000} s.` });
    await flush();
    expect(h.sockets.last().readyState).toBe(FakeSocket.CLOSED);
    expect(h.reg.calls.slice(-1)).toEqual(['clear api.openai.com/v1/live/']);
    expect(h.clock.pending()).toBe(0);
  });

  it('upgrades one leg at a time per rule key — the second registers once the first has opened and its rule is cleared — and a different key does not wait', async () => {
    const h = seam();
    const first = h.start();
    const second = h.start();
    const other = h.start('wss://api.openai.com/v1/realtime?model=x');
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'set api.openai.com/v1/']);
    h.reg.answer();
    h.reg.answer();
    await flush();
    h.sockets.all[0].open();
    await first;
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'set api.openai.com/v1/', 'clear api.openai.com/v1/live/', 'set api.openai.com/v1/live/']);
    h.reg.answer();
    await flush();
    h.sockets.all[1].open();
    h.sockets.all[2].open();
    await expect(Promise.all([second, other])).resolves.toHaveLength(2);
  });

  it('a leg that gives up while it waits at the gate never registers, and the queue moves on', async () => {
    const h = seam();
    const first = h.start();
    const waiting = new AbortController();
    const second = h.start(URL_LIVE, waiting.signal);
    const third = h.start();
    await flush();
    waiting.abort(new Error('stopped'));
    await expect(second).rejects.toThrow('stopped');
    h.reg.answer();
    await flush();
    h.sockets.last().open();
    await first;
    await flush();
    expect(h.reg.calls).toEqual(['set api.openai.com/v1/live/', 'clear api.openai.com/v1/live/', 'set api.openai.com/v1/live/']);
    h.reg.answer();
    await flush();
    h.sockets.last().open();
    await expect(third).resolves.toBe(h.sockets.last());
  });

  it("the web has no platform to install a rule: it refuses in fixed words", async () => {
    const clock = createVirtualClock(0);
    const open = createHeaderSocket(() => null, () => { throw new Error('no socket may be made'); });
    await expect(open(URL_LIVE, HEADERS, { signal: new AbortController().signal, clock })).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it("a browser that refuses the socket is rethrown in fixed words, the key never quoted", async () => {
    class RefusingWebSocket {
      constructor(url: string) {
        throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' is invalid. ${HEADERS.set.Authorization}`, 'SyntaxError');
      }
    }
    vi.stubGlobal('WebSocket', RefusingWebSocket);
    const reg = registrar();
    const clock = createVirtualClock(0);
    const opening = createHeaderSocket(() => reg.r)(URL_LIVE, HEADERS, { signal: new AbortController().signal, clock });
    await flush();
    reg.answer();
    const error = (await opening.catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
    expect(`${error.message} ${String(error)}`).not.toContain('sk-proj');
  });
});

describe("the header seam's registrars", () => {
  it("Electron's: ws-headers-set with the path, then ws-headers-clear; a refusal in the main process's words", async () => {
    const invoke = vi.fn().mockResolvedValue({ success: true });
    const r = electronRegistrar({ invoke });
    const rule = ruleFor(URL_LIVE, HEADERS);
    await r.set(rule);
    r.clear(rule);
    expect(invoke.mock.calls).toEqual([
      ['ws-headers-set', { host: 'api.openai.com', path: '/v1/live/', headers: HEADERS.set, removeHeaders: ['Origin'] }],
      ['ws-headers-clear', { host: 'api.openai.com', path: '/v1/live/' }],
    ]);
    invoke.mockResolvedValueOnce({ success: false, error: 'Invalid arguments: host and headers required' });
    await expect(r.set(rule)).rejects.toThrow('ws-headers-set: Invalid arguments: host and headers required');
    // A clear that fails is nobody's business: its rejection is swallowed.
    invoke.mockRejectedValueOnce(new Error('gone'));
    r.clear(rule);
    await flush();
  });

  it("the extension's: WS_HEADERS_SET and WS_HEADERS_CLEAR to the background; no answer, or a refusal, rejects", async () => {
    const sent: unknown[] = [];
    let reply: unknown = { success: true };
    const runtime: { sendMessage(m: unknown, cb?: (r: unknown) => void): void; lastError?: { message?: string } } = {
      sendMessage: (m, cb) => { sent.push(m); cb?.(reply); },
    };
    const r = extensionRegistrar(runtime);
    const rule = ruleFor(URL_LIVE, HEADERS);
    await r.set(rule);
    r.clear(rule);
    expect(sent).toEqual([
      { type: 'WS_HEADERS_SET', host: 'api.openai.com', path: '/v1/live/', set: HEADERS.set, remove: ['Origin'] },
      { type: 'WS_HEADERS_CLEAR', host: 'api.openai.com', path: '/v1/live/' },
    ]);
    reply = { success: false, error: 'Sender is not an extension page' };
    await expect(r.set(rule)).rejects.toThrow('WS_HEADERS_SET: Sender is not an extension page');
    runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
    reply = undefined;
    await expect(r.set(rule)).rejects.toThrow('WS_HEADERS_SET: Could not establish connection. Receiving end does not exist.');
  });

  it("the platform picks its own: Electron's invoke, the extension's runtime, none on the web", async () => {
    expect(platformRegistrar()).toBeNull();
    const invoke = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('electronAPI', {});
    vi.stubGlobal('electron', { invoke });
    await platformRegistrar()?.set(ruleFor(URL_LIVE, HEADERS));
    expect(invoke).toHaveBeenCalledWith('ws-headers-set', expect.objectContaining({ path: '/v1/live/' }));
    vi.unstubAllGlobals();
    const sendMessage = vi.fn((_m: unknown, cb?: (r: unknown) => void) => cb?.({ success: true }));
    vi.stubGlobal('chrome', { runtime: { id: 'abcdefghijklmnop', sendMessage } });
    await platformRegistrar()?.set(ruleFor(URL_LIVE, HEADERS));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'WS_HEADERS_SET' }), expect.any(Function));
  });
});
```

Create `src/lib/contract/testing/headerSocket.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../clock';
import { flush } from './drive';
import { fakeSockets } from './fakeSocket';
import { fakeHeaderSockets } from './headerSocket';

const URL_LIVE = 'wss://api.openai.com/v1/live/sessions';
const HEADERS = { set: { Authorization: 'Bearer sk-proj-fakeKey0123456789' }, remove: ['Origin'] };

describe("the header seam's fake (Stage 2 OpenAI Live, choice 1)", () => {
  it('runs the real seam over FakeSockets from the sockets it is given, recording each rule and its clear', async () => {
    const sockets = fakeSockets();
    const seam = fakeHeaderSockets(sockets);
    expect(seam.sockets).toBe(sockets);
    const clock = createVirtualClock(0);
    const opening = seam.open(URL_LIVE, HEADERS, { signal: new AbortController().signal, clock });
    await flush();
    expect(seam.registrations).toEqual([{ host: 'api.openai.com', path: '/v1/live/', set: HEADERS.set, remove: ['Origin'], cleared: false }]);
    sockets.last().open();
    await expect(opening).resolves.toBe(sockets.last());
    await flush();
    expect(seam.registrations[0].cleared).toBe(true);
  });

  it('refuses the next registration once, and holds the next one until it is let go', async () => {
    const seam = fakeHeaderSockets();
    const clock = createVirtualClock(0);
    const signal = new AbortController().signal;
    seam.refuseNext('no');
    await expect(seam.open(URL_LIVE, HEADERS, { signal, clock })).rejects.toMatchObject({ reason: 'register' });
    const letGo = seam.holdNext();
    const opening = seam.open(URL_LIVE, HEADERS, { signal, clock });
    await flush();
    expect(seam.sockets.all).toEqual([]);
    letGo();
    await flush();
    seam.sockets.last().open();
    await expect(opening).resolves.toBe(seam.sockets.last());
    expect(seam.registrations.map((r) => r.cleared)).toEqual([false, true]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/contract/headerSocket.test.ts src/lib/contract/testing/headerSocket.test.ts`
Expected: FAIL — `Test Files 2 failed (2)`, no test runs: each fails to resolve `./headerSocket` (`Failed to resolve import "./headerSocket"`).

- [ ] **Step 3: Write the seam.** Create `src/lib/contract/headerSocket.ts`:

```ts
/**
 * F14, the header seam (spec: "Sockets that need upgrade headers"): a socket
 * opened with upgrade headers set and others removed, which a browser cannot
 * do itself. Its first user is OpenAI Live, whose upgrade needs a real
 * `Authorization: Bearer` and no `Origin` (the owner's probe, U9: `Origin`
 * 403, subprotocol alone 401). Each platform installs a rule where the
 * upgrade is made — Electron's main process, the extension's background —
 * behind one interface (Stage 2 OpenAI Live, ruling 7; choice 1):
 *
 * - **The rule's key** is the URL's host and path: Electron's rule applies
 *   to an upgrade whose path starts with it, so a Live rule never reaches
 *   OpenAI Realtime's or Translate's upgrade on the same host (the spec's
 *   amendment 10), and the extension's rule is path-scoped the same way.
 * - **One upgrade at a time per key**, process-wide: Electron's rule is
 *   one-shot and the extension's is cleared as soon as the upgrade is made,
 *   so two legs — at the start, or reconnecting after the same drop —
 *   register and upgrade one after the other. Keys that differ do not wait —
 *   though an extension rule for a path also reaches the paths under it, and
 *   two windows share one rule: only OpenAI Live uses the seam today.
 * - **The bound**: registration and upgrade within `HEADER_SOCKET_CAP_MS` of
 *   the gate, on the caller's clock. The holder lets the gate go when its
 *   bound fires, even with its registration unanswered, so the wait at the
 *   gate is bounded by the holder's own.
 * - **The ending**: the rule is cleared at the socket's first `open`,
 *   `error` or `close` — a no-op on Electron, whose upgrade consumed it —
 *   and after an abort or the bound, and only then is the gate let go, so a
 *   clear never lands on the next leg's rule. An abort rejects at once and
 *   opens nothing. A registration still in flight when the attempt ends is
 *   cleared at once: each platform's channel is ordered — Electron's IPC,
 *   the extension's runtime messages — so the clear lands after it.
 * - **The words**: fixed. No header value leaves the seam — the key rides
 *   in the registration alone — and a browser that refuses the socket is
 *   rethrown by `nativeSocket` without its message.
 *
 * It resolves with the socket once it is open, its own listeners gone: the
 * caller attaches its handlers in the microtask after, before any message
 * task. The web build has no platform to install a rule: it refuses.
 */
import type { Clock } from './clock';
import { nativeSocket } from './socket';
import { getEnvironment } from '../../utils/environment';

/** The headers an upgrade needs: set, by name; removed, by name, case-insensitively. */
export interface UpgradeHeaders {
  set: Readonly<Record<string, string>>;
  remove?: readonly string[];
}

export type OpenHeaderSocket = (url: string, headers: UpgradeHeaders, o: { signal: AbortSignal; clock: Pick<Clock, 'setTimeout'> }) => Promise<WebSocket>;

/** One rule as a platform installs it: the upgrade's host, the path it applies under, the headers set and the names removed. */
export interface HeaderRule {
  host: string;
  path: string;
  set: Readonly<Record<string, string>>;
  remove: readonly string[];
}

/** A platform's way to install a rule and take it away. */
export interface HeaderRegistrar {
  /** Resolves once the rule is installed; rejects when the platform would not. */
  set(rule: HeaderRule): Promise<void>;
  /** Removes the rule if it is still installed; answers nothing. */
  clear(rule: Pick<HeaderRule, 'host' | 'path'>): void;
}

/** How long registration and upgrade may take once the gate is held: the old client's cap, now counting the registration too. */
export const HEADER_SOCKET_CAP_MS = 15_000;

export type HeaderSocketFailure = 'unsupported' | 'register' | 'never_opened' | 'timeout';

/** Why the seam gave no socket, in fixed words; `cause` is the platform's own failure, for the console. Set here, not passed to `super`: this project's lib (ES2020) has no `Error` options. */
export class HeaderSocketError extends Error {
  readonly cause?: unknown;

  constructor(readonly reason: HeaderSocketFailure, message: string, cause?: unknown) {
    super(message);
    this.name = 'HeaderSocketError';
    this.cause = cause;
  }
}

/** The rule a URL's upgrade takes: its host, and its path up to the last `/`, which the endpoint's own paths share (`/v1/live/sessions` → `/v1/live/`). */
export function ruleFor(url: string, headers: UpgradeHeaders): HeaderRule {
  const u = new URL(url);
  return { host: u.host, path: u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1), set: { ...headers.set }, remove: [...(headers.remove ?? [])] };
}

export function createHeaderSocket(registrar: () => HeaderRegistrar | null, openSocket: (url: string) => WebSocket = nativeSocket): OpenHeaderSocket {
  /** Per rule key, the tail of the queue: a leg waits for every leg before it. */
  const gates = new Map<string, Promise<void>>();
  const acquire = (key: string): Promise<() => void> => {
    const before = gates.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const tail = before.then(() => mine);
    gates.set(key, tail);
    return before.then(() => () => {
      release();
      if (gates.get(key) === tail) gates.delete(key);
    });
  };

  return (url, headers, o) => new Promise<WebSocket>((resolve, reject) => {
    if (o.signal.aborted) {
      reject(o.signal.reason ?? new Error('aborted'));
      return;
    }
    const platform = registrar();
    if (!platform) {
      reject(new HeaderSocketError('unsupported', 'This build cannot set a socket\'s upgrade headers: the desktop app or the browser extension can.'));
      return;
    }
    const rule = ruleFor(url, headers);
    let settled = false;
    /** Wakes the attempt from its wait — on the registration, then on the socket: it opened or failed, an abort, the bound. */
    let wake: () => void = () => {};
    let socket: WebSocket | null = null;
    const listeners = {
      open: () => {
        if (settled) return;
        settled = true;
        detach();
        wake();
        resolve(socket as WebSocket);
      },
      failed: () => fail(new HeaderSocketError('never_opened', 'The socket closed before it opened.')),
    };
    const detach = () => {
      socket?.removeEventListener('open', listeners.open);
      socket?.removeEventListener('error', listeners.failed);
      socket?.removeEventListener('close', listeners.failed);
    };
    const onAbort = () => fail(o.signal.reason ?? new Error('aborted'));
    o.signal.addEventListener('abort', onAbort, { once: true });
    let cancelCap: () => void = () => {};
    function fail(error: unknown): void {
      if (settled) return;
      settled = true;
      detach();
      if (socket && socket.readyState <= 1) socket.close();
      wake();
      reject(error);
    }

    void (async () => {
      const letGo = await acquire(`${rule.host}${rule.path}`);
      /** The rule went to the platform and was not refused: however the attempt ends, it is cleared. */
      let sent = false;
      try {
        if (settled) return;
        /** The attempt's end: the socket's first open, error or close, an abort, or the bound. */
        const ended = new Promise<void>((resolve) => { wake = resolve; });
        cancelCap = o.clock.setTimeout(() => fail(new HeaderSocketError('timeout', `The socket did not open within ${HEADER_SOCKET_CAP_MS / 1000} s.`)), HEADER_SOCKET_CAP_MS);
        sent = true;
        // The registration's answer or the attempt's end, whichever comes first: a registration that never answers holds the gate no longer than the bound.
        const refused = await Promise.race([
          platform.set(rule).then(() => null, (error: unknown) => ({ error })),
          ended.then(() => null),
        ]);
        if (refused) {
          sent = false;
          fail(new HeaderSocketError('register', 'The app could not set the socket\'s upgrade headers.', refused.error));
          return;
        }
        if (settled) return;
        try {
          socket = openSocket(url);
        } catch (error) {
          fail(error);
          return;
        }
        socket.addEventListener('open', listeners.open);
        socket.addEventListener('error', listeners.failed);
        socket.addEventListener('close', listeners.failed);
        await ended;
      } finally {
        cancelCap();
        o.signal.removeEventListener('abort', onAbort);
        // Electron's rule went with the upgrade; the extension's goes now. A registration still in flight is cleared too: each
        // platform's channel is ordered, so the clear lands after it, and the next leg's registration after the clear.
        if (sent) platform.clear(rule);
        letGo();
      }
    })();
  });
}

interface ElectronInvoke { invoke(channel: string, data?: unknown): Promise<unknown> }
interface ChromeRuntime { sendMessage(message: unknown, callback?: (response: unknown) => void): void; lastError?: { message?: string } }

/** Electron's main process (`electron/ws-header-rules.js`): its rule applies to the next upgrade under the path, once. */
export function electronRegistrar(electron: ElectronInvoke): HeaderRegistrar {
  return {
    async set(rule) {
      const answer = (await electron.invoke('ws-headers-set', { host: rule.host, path: rule.path, headers: rule.set, removeHeaders: rule.remove })) as { success?: boolean; error?: unknown } | undefined;
      if (!answer?.success) throw new Error(`ws-headers-set: ${typeof answer?.error === 'string' ? answer.error : 'no answer'}`);
    },
    clear(rule) {
      void electron.invoke('ws-headers-clear', { host: rule.host, path: rule.path }).catch(() => {});
    },
  };
}

/** The extension's background (`WS_HEADERS_SET` / `WS_HEADERS_CLEAR`): a rule scoped to the path and to the extension's own pages. */
export function extensionRegistrar(runtime: ChromeRuntime): HeaderRegistrar {
  return {
    set: (rule) => new Promise<void>((resolve, reject) => {
      runtime.sendMessage({ type: 'WS_HEADERS_SET', host: rule.host, path: rule.path, set: rule.set, remove: rule.remove }, (response) => {
        const answer = response as { success?: boolean; error?: unknown } | undefined;
        if (runtime.lastError) reject(new Error(`WS_HEADERS_SET: ${runtime.lastError.message ?? 'no answer'}`));
        else if (!answer?.success) reject(new Error(`WS_HEADERS_SET: ${typeof answer?.error === 'string' ? answer.error : 'no answer'}`));
        else resolve();
      });
    }),
    clear(rule) {
      try {
        runtime.sendMessage({ type: 'WS_HEADERS_CLEAR', host: rule.host, path: rule.path }, () => {
          // Read, so Chrome does not warn of an unchecked error when nothing answers.
          void runtime.lastError;
        });
      } catch {
        // The background is gone: its rules are swept at its next start.
      }
    },
  };
}

/** The registrar this platform has, read at each open: none on the web. */
export function platformRegistrar(): HeaderRegistrar | null {
  const env = getEnvironment();
  if (env === 'electron' && typeof window.electron?.invoke === 'function') return electronRegistrar(window.electron);
  const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  if (env === 'extension' && runtime && typeof runtime.sendMessage === 'function') return extensionRegistrar(runtime);
  return null;
}

/** The app's seam: one queue per rule key for the whole renderer. */
export const platformHeaderSocket: OpenHeaderSocket = createHeaderSocket(platformRegistrar);
```

- [ ] **Step 4: Write its fake** (test-only; the kit's). Create `src/lib/contract/testing/headerSocket.ts`:

```ts
/**
 * The header seam for tests (Stage 2 OpenAI Live, choice 1): the real seam —
 * its gate per rule key, its bound, its ending — over a registrar the test
 * drives, handing out `FakeSocket`s from the sockets it is given (a
 * lifecycle run's, whose sends it watches). It records every rule installed
 * and whether it was cleared since, and can refuse or hold the next
 * registration: a platform that would not take it, a round trip still in
 * flight. Test-only, like the rest of the kit.
 */
import { createHeaderSocket, type HeaderRule, type OpenHeaderSocket } from '../headerSocket';
import { fakeSockets, type FakeSockets } from './fakeSocket';

export interface Registration extends HeaderRule {
  cleared: boolean;
}

export interface FakeHeaderSockets {
  readonly open: OpenHeaderSocket;
  readonly sockets: FakeSockets;
  /** Every rule installed, in order, and whether it was cleared since. */
  readonly registrations: readonly Registration[];
  /** The next registration fails, as a platform that would not install it. */
  refuseNext(reason?: string): void;
  /** The next registration waits until the returned function is called. */
  holdNext(): () => void;
}

export function fakeHeaderSockets(sockets: FakeSockets = fakeSockets()): FakeHeaderSockets {
  const registrations: Registration[] = [];
  let refusal: string | null = null;
  let held: Promise<void> | null = null;
  const open = createHeaderSocket(
    () => ({
      set(rule) {
        const registration: Registration = { host: rule.host, path: rule.path, set: { ...rule.set }, remove: [...rule.remove], cleared: false };
        registrations.push(registration);
        const reason = refusal;
        refusal = null;
        if (reason !== null) return Promise.reject(new Error(reason));
        const wait = held ?? Promise.resolve();
        held = null;
        return wait;
      },
      clear(rule) {
        for (let i = registrations.length - 1; i >= 0; i--) {
          const r = registrations[i];
          if (r.host === rule.host && r.path === rule.path && !r.cleared) {
            r.cleared = true;
            return;
          }
        }
      },
    }),
    (url) => sockets.create(url),
  );
  return {
    open,
    sockets,
    registrations,
    refuseNext: (reason = 'the platform would not take the rule') => { refusal = reason; },
    holdNext() {
      let release!: () => void;
      held = new Promise<void>((resolve) => { release = resolve; });
      return () => release();
    },
  };
}
```

- [ ] **Step 5: Point the plain seam's comment at it.**

```diff
diff --git a/src/lib/contract/socket.ts b/src/lib/contract/socket.ts
--- a/src/lib/contract/socket.ts
+++ b/src/lib/contract/socket.ts
@@ -8,7 +8,8 @@
  * re-export it, each keeping the `OpenSocket` its adapter calls (with
  * subprotocols or without). Soniox's own seam stays its own: it rethrows
  * nothing, and the old client's streams read it. F14, the header seam,
- * joins this one when OpenAI Live builds it.
+ * sits beside it in `headerSocket.ts`, built by OpenAI Live and opening
+ * its sockets through this one (Stage 2 OpenAI Live, choice 1).
  */
 export type OpenSocket = (url: string, protocols?: string[]) => WebSocket;
 
```

- [ ] **Step 6: Run the contract's suites.**

Run: `npx vitest run src/lib/contract`
Expected: PASS — 15 files, 153 tests (the two new files among them). The kit's other suites are unchanged: nothing they import changed.

- [ ] **Step 7: The gates.** The suite and the typecheck gate (in Wave 1, a failure in another task's files is that task's). `headerSocket.ts` imports `src/utils/environment.ts`, whose two baseline lines stay the baseline's.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/contract/headerSocket.ts src/lib/contract/headerSocket.test.ts src/lib/contract/testing/headerSocket.ts src/lib/contract/testing/headerSocket.test.ts src/lib/contract/socket.ts
```

```bash
git commit -q -F - -- src/lib/contract/headerSocket.ts src/lib/contract/headerSocket.test.ts src/lib/contract/testing/headerSocket.ts src/lib/contract/testing/headerSocket.test.ts src/lib/contract/socket.ts <<'EOF'
feat(contract): the header seam for sockets that need upgrade headers

F14: OpenHeaderSocket opens a WebSocket whose upgrade carries headers a
browser cannot set, through the desktop app's main process or the
extension's background, keyed by host and path. One leg per key
registers and upgrades at a time, bounded at 15 s on the caller's
clock; the rule is cleared once the socket opens, fails, or the attempt
ends, before the next leg goes, and a registration that never answers
is cleared and lets the gate go at the bound. The web build refuses.
Its fake runs the real seam over FakeSockets.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 4: OpenAI's decoder, error words and model check, lifted at their third user (Wave 1)

**Files:**
- Create: `src/lib/provider/openaiWire.ts`, `src/lib/provider/openaiModels.ts`
- Modify: `src/providers/openai_translate/wire.ts` (the SDK import, the re-export, the decoder and words removed), `src/providers/openai_translate/check.ts` (a wrapper), `src/providers/openai/wire.ts` (the re-export, `errorCode` over the shared one, the decoder and words removed), `src/providers/openai/check.ts` (a wrapper)
- Test: `src/lib/provider/openaiWire.test.ts`, `src/lib/provider/openaiModels.test.ts` (both new)

**Interfaces:**
- Consumes: `boundedFetch`, `CheckContext`, `CheckResult` (`src/lib/provider/`), `realClock` / `Clock` (`src/lib/contract/clock`).
- Produces:
  - `openaiWire.ts`: `ServerEvent = { type: string } & Record<string, unknown>`, `decodeServerEvent(data: unknown): ServerEvent`, `OpenAIError { type?; code?: string | null; message?; param?: string | null }`, `OpenAIErrorCode = 'auth' | 'rate_limit' | 'client' | 'server'`, `errorCode(e: OpenAIError): OpenAIErrorCode`, `errorWords(e: OpenAIError): string`;
  - `openaiModels.ts`: `OPENAI_MODELS_URL`, `CHECK_TIMEOUT_MS` (15 000), `ModelFamily { keep(id): boolean; none: { code; reason } }`, `OpenAIModelCheckDeps { fetch?; clock? }`, `createOpenAIModelCheck(family, deps?): (apiKey: string, ctx: CheckContext) => Promise<CheckResult>`;
  - unchanged for their importers: OpenAI Translate's `wire.ts` still exports `decodeServerEvent`, `errorCode`, `errorWords`, `ErrorCode` and `ServerEvent`, and OpenAI Realtime's `decodeServerEvent`, `errorCode` (its `session_expired` → `segment_ended` first), `errorWords` and `ServerEvent`; both `check.ts` keep their exports (`createTranslateCheck` / `checkTranslate` and `createRealtimeCheck` / `checkRealtime`, `CHECK_TIMEOUT_MS`, `OPENAI_MODELS_URL`, their deps types).

- [ ] **Step 1: Write the failing tests.** Create `src/lib/provider/openaiWire.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decodeServerEvent, errorCode, errorWords } from './openaiWire';

describe("OpenAI's decoder and error words, lifted at their third user (Stage 2 OpenAI Live, choice 4)", () => {
  it('decodes a text frame or an ArrayBuffer into an event with a string type', () => {
    expect(decodeServerEvent('{"type":"session.started","session":{"id":"live_1"}}')).toEqual({ type: 'session.started', session: { id: 'live_1' } });
    expect(decodeServerEvent(new TextEncoder().encode('{"type":"error"}').buffer)).toEqual({ type: 'error' });
  });

  it('throws on anything else', () => {
    expect(() => decodeServerEvent(new Blob(['{}']))).toThrow('a server frame of an unexpected kind ([object Blob])');
    expect(() => decodeServerEvent('not json')).toThrow();
    expect(() => decodeServerEvent('[1]')).toThrow('a server frame that is not a JSON object');
    expect(() => decodeServerEvent('{"kind":"x"}')).toThrow('a server frame with no type');
  });

  it("reads a key refused, a limit or a quota, an invalid request, else the service's", () => {
    expect(errorCode({ code: 'invalid_api_key' })).toBe('auth');
    expect(errorCode({ code: 'rate_limit_exceeded' })).toBe('rate_limit');
    expect(errorCode({ code: 'insufficient_quota', type: 'insufficient_quota' })).toBe('rate_limit');
    expect(errorCode({ type: 'invalid_request_error', code: 'forbidden' })).toBe('client');
    expect(errorCode({ type: 'server_error' })).toBe('server');
  });

  it("words an error as OpenAI said it: its code, else its type, and its message", () => {
    expect(errorWords({ type: 'invalid_request_error', code: 'forbidden', message: 'Voice session access denied.' })).toBe('[OpenAI forbidden] Voice session access denied.');
    expect(errorWords({ type: 'server_error' })).toBe('[OpenAI server_error] the server reported an error');
    expect(errorWords({})).toBe('[OpenAI error] the server reported an error');
  });
});
```

Create `src/lib/provider/openaiModels.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { CHECK_TIMEOUT_MS, createOpenAIModelCheck, OPENAI_MODELS_URL } from './openaiModels';
import type { CheckContext } from './types';

const KEY = 'sk-proj-modelsKey0123456789';
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'en', target: 'ja' }, legs: ['speaker'], signal });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const listing = (...models: Array<[string, number]>) => json({ object: 'list', data: models.map(([id, created]) => ({ id, object: 'model', created, owned_by: 'system' })) });
const FAMILY = { keep: (id: string) => id.startsWith('gpt-live-'), none: { code: 'no_family_model', reason: 'This key lists no family model.' } };

describe("OpenAI's model-list check, lifted at its third user (Stage 2 OpenAI Live, choice 4)", () => {
  it('GETs the list with the key as a Bearer token, never in the URL, and keeps the family alone, newest first, each id once', async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime', 3], ['gpt-live-1', 1], ['gpt-live-2026-10-01', 2], ['gpt-live-1', 1]));
    await expect(createOpenAIModelCheck(FAMILY, { fetch, clock: createVirtualClock(0) })(KEY, ctx())).resolves.toEqual({ ok: true, models: [{ id: 'gpt-live-2026-10-01' }, { id: 'gpt-live-1' }] });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENAI_MODELS_URL);
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${KEY}` } });
  });

  it("answers a list with none of the family in the family's own code and words", async () => {
    const fetch = vi.fn(async () => listing(['gpt-realtime', 3]));
    await expect(createOpenAIModelCheck(FAMILY, { fetch, clock: createVirtualClock(0) })(KEY, ctx())).resolves.toEqual({ ok: false, code: 'no_family_model', reason: 'This key lists no family model.' });
  });

  it('reads a region, a refused key and a rate limit as codes; any other status throws', async () => {
    const answer = (status: number, body: unknown = { error: { message: 'said' } }) => createOpenAIModelCheck(FAMILY, { fetch: vi.fn(async () => json(body, status)), clock: createVirtualClock(0) })(KEY, ctx());
    await expect(answer(403, { error: { message: 'no', code: 'unsupported_country_region_territory' } })).resolves.toMatchObject({ ok: false, code: 'region_unsupported', reason: 'HTTP 403: no' });
    await expect(answer(401)).resolves.toMatchObject({ ok: false, code: 'auth', reason: 'HTTP 401: said' });
    await expect(answer(403)).resolves.toMatchObject({ ok: false, code: 'auth' });
    await expect(answer(429)).resolves.toMatchObject({ ok: false, code: 'rate_limit' });
    await expect(answer(503)).rejects.toThrow('OpenAI answered the model list with HTTP 503.');
  });

  it(`gives up after ${CHECK_TIMEOUT_MS / 1000} s in its own words`, async () => {
    const clock = createVirtualClock(0);
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const checking = createOpenAIModelCheck(FAMILY, { fetch, clock })(KEY, ctx());
    clock.advance(CHECK_TIMEOUT_MS);
    await expect(checking).rejects.toThrow(`OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/provider/openaiWire.test.ts src/lib/provider/openaiModels.test.ts`
Expected: FAIL — `Test Files 2 failed (2)`, no test runs: `Failed to resolve import "./openaiWire"` and `"./openaiModels"`.

- [ ] **Step 3: Write the two shared modules.** Create `src/lib/provider/openaiWire.ts`:

```ts
/**
 * OpenAI's server events and errors, as the three OpenAI adapters read them:
 * a frame decoded into a typed event, and a server `error` as a notice code
 * and OpenAI's own words. Written in OpenAI Translate's wire, copied into
 * OpenAI Realtime's, and lifted here at their third user, OpenAI Live
 * (Stage 2 OpenAI Live, ruling 9; choice 4): a provider never imports
 * another's folder. The two wires re-export them; Realtime's own code for
 * its 60-minute cap stays its own. Pure.
 */

/** A server event as an adapter reads it: a JSON object with a string `type`, read through its own type after. */
export type ServerEvent = { type: string } & Record<string, unknown>;

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, decoded at once: text, or a binary frame read as an ArrayBuffer. Throws when it is not a JSON object with a string `type`. */
export function decodeServerEvent(data: unknown): ServerEvent {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  if (typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('a server frame with no type');
  return parsed as ServerEvent;
}

/** A server `error` event's `error`: the fields the three endpoints send (the SDK's `RealtimeError`, and OpenAI Live's, which the SDK does not type). */
export interface OpenAIError {
  type?: string;
  code?: string | null;
  message?: string;
  param?: string | null;
}

export type OpenAIErrorCode = 'auth' | 'rate_limit' | 'client' | 'server';

/**
 * A server `error` as a notice code: OpenAI's codes for a bad key, a rate
 * limit and an exhausted quota first, then an invalid request, else the
 * service's (Stage 2 OpenAI Translate, choice 9).
 */
export function errorCode(e: OpenAIError): OpenAIErrorCode {
  if (e.code === 'invalid_api_key') return 'auth';
  if (e.code === 'rate_limit_exceeded' || e.code === 'insufficient_quota') return 'rate_limit';
  if (e.type === 'invalid_request_error') return 'client';
  return 'server';
}

/** A server `error` in OpenAI's own words, as the `{{detail}}` of its notice: `[OpenAI <code, else type>] <message>`. */
export function errorWords(e: OpenAIError): string {
  return `[OpenAI ${e.code || e.type || 'error'}] ${e.message || 'the server reported an error'}`;
}
```

Create `src/lib/provider/openaiModels.ts`:

```ts
/**
 * An OpenAI key's readiness for one family of models: the model list, as
 * OpenAI Translate's and OpenAI Realtime's checks each read it, lifted at its
 * third user, OpenAI Live (Stage 2 OpenAI Live, ruling 9; choice 4). The
 * request is bounded by `CHECK_TIMEOUT_MS` and the caller's signal
 * (`boundedFetch`); the key rides in the `Authorization` header, never the
 * URL; a region OpenAI does not serve, a refused key (a restricted project
 * key's 403 among them) and a rate limit answer a code the surfaces put into
 * words, and a status the key does not explain (a 404, a 5xx) or a failed
 * fetch throws. A family with no model listed answers its provider's own
 * code. The settings side: no session code runs it, so it may use the real
 * clock by default.
 */
import { realClock, type Clock } from '../contract/clock';
import { boundedFetch } from './boundedFetch';
import type { CheckContext, CheckResult } from './types';

export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
/** As long as the other checks wait. */
export const CHECK_TIMEOUT_MS = 15_000;

interface ModelList { data?: Array<{ id?: unknown; created?: unknown }> }
interface ErrorBody { error?: { message?: unknown; code?: unknown } }

/** Which models make a key ready, and the refusal when it lists none. */
export interface ModelFamily {
  keep(id: string): boolean;
  none: { code: string; reason: string };
}

export interface OpenAIModelCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

/** The family's models this key lists, newest first — each id once, the id breaking a tie — or why not. */
export function createOpenAIModelCheck(family: ModelFamily, deps: OpenAIModelCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return (apiKey: string, ctx: CheckContext): Promise<CheckResult> => {
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const late = `OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`;
    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ErrorBody;
        const said = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'OpenAI did not accept this key.';
        const reason = `HTTP ${response.status}: ${said}`;
        // A region OpenAI does not serve reads as such, whatever the status (`OpenAIClient.ts:170-179`).
        if (body.error?.code === 'unsupported_country_region_territory') return { ok: false, code: 'region_unsupported', reason };
        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason };
        if (response.status === 429) return { ok: false, code: 'rate_limit', reason };
        throw new Error(`OpenAI answered the model list with HTTP ${response.status}.`);
      }
      const body = (await response.json()) as ModelList;
      const models = (body.data ?? [])
        .flatMap((m) => (typeof m.id === 'string' && family.keep(m.id) ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []))
        .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const ids = [...new Set(models.map((m) => m.id))];
      if (ids.length === 0) return { ok: false, ...family.none };
      return { ok: true, models: ids.map((id) => ({ id })) };
    });
  };
}
```

- [ ] **Step 4: Re-export them from the two OpenAI providers, and wrap their checks.**

```diff
diff --git a/src/providers/openai_translate/wire.ts b/src/providers/openai_translate/wire.ts
--- a/src/providers/openai_translate/wire.ts
+++ b/src/providers/openai_translate/wire.ts
@@ -7,7 +7,6 @@
  * the typecheck. Pure: no socket, no timer.
  */
 import type {
-  RealtimeError,
   RealtimeTranslationInputAudioBufferAppendEvent,
   RealtimeTranslationSessionCloseEvent,
   RealtimeTranslationSessionUpdateEvent,
@@ -18,6 +17,14 @@
 
 /** Lifted to the contract at their third user (Stage 2 OpenAI Realtime, choice 1); re-exported, so this wire's importers are unchanged. */
 export { base64ToPcm, pcmToBase64 } from '../../lib/contract/pcm64';
+/**
+ * The decoder and the error's code and words: lifted at their third user,
+ * OpenAI Live (Stage 2 OpenAI Live, choice 4); re-exported, so this wire's
+ * importers are unchanged. The `.done` events the old client handled are not
+ * among the SDK's seven (choice 18); a server `error` reads as a code first
+ * as the live test's `session.error` frames settle (choice 9).
+ */
+export { decodeServerEvent, errorCode, errorWords, type OpenAIErrorCode as ErrorCode, type ServerEvent } from '../../lib/provider/openaiWire';
 
 /** The translations endpoint (`OpenAITranslateGAClient.ts:23`); the model rides in its query, fixed at creation. */
 export const TRANSLATE_WS_URL = 'wss://api.openai.com/v1/realtime/translations';
@@ -76,26 +83,6 @@
  */
 export const SESSION_CLOSE: RealtimeTranslationSessionCloseEvent = { type: 'session.close' };
 
-/**
- * A server event as the adapter reads it: a JSON object with a string
- * `type`. The SDK's `RealtimeTranslationServerEvent` types the seven it
- * lists; the adapter reads each through its SDK type. The `.done` events the
- * old client handled are not among them (choice 18).
- */
-export type ServerEvent = { type: string } & Record<string, unknown>;
-
-const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';
-
-/** A server frame, decoded at once: text, or a binary frame read as an ArrayBuffer (choice 17). Throws when it is not a JSON object with a string `type`. */
-export function decodeServerEvent(data: unknown): ServerEvent {
-  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
-  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
-  const parsed: unknown = JSON.parse(text);
-  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
-  if (typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('a server frame with no type');
-  return parsed as ServerEvent;
-}
-
 /** The rate an output audio delta that names none is taken at: PCM16 at 24 kHz, the old client's default (`OpenAITranslateGAClient.ts:604`). */
 export const OUTPUT_RATE = 24_000;
 
@@ -137,23 +124,3 @@
 export function elapsedMsOf(e: { elapsed_ms?: unknown }): number | null {
   return typeof e.elapsed_ms === 'number' ? e.elapsed_ms : null;
 }
-
-export type ErrorCode = 'auth' | 'rate_limit' | 'client' | 'server';
-
-/**
- * A server `error` as a notice code (choice 9): OpenAI's codes for a bad key,
- * a rate limit and an exhausted quota first, then an invalid request, else
- * the service's. A hypothesis for this endpoint: the live test's
- * `session.error` frames settle it.
- */
-export function errorCode(e: Partial<RealtimeError>): ErrorCode {
-  if (e.code === 'invalid_api_key') return 'auth';
-  if (e.code === 'rate_limit_exceeded' || e.code === 'insufficient_quota') return 'rate_limit';
-  if (e.type === 'invalid_request_error') return 'client';
-  return 'server';
-}
-
-/** A server `error` in OpenAI's own words, as the `{{detail}}` of `notices.<code>`: `[OpenAI <code, else type>] <message>`. */
-export function errorWords(e: Partial<RealtimeError>): string {
-  return `[OpenAI ${e.code || e.type || 'error'}] ${e.message || 'the server reported an error'}`;
-}
diff --git a/src/providers/openai_translate/check.ts b/src/providers/openai_translate/check.ts
--- a/src/providers/openai_translate/check.ts
+++ b/src/providers/openai_translate/check.ts
@@ -6,55 +6,22 @@
  * status the key does not explain (a 404, a 5xx) or a failed fetch throws,
  * where the old one called every failure an invalid key (survey §1.14.9);
  * and a refusal answers a code the surfaces put into words. The key rides in
- * the `Authorization` header, never the URL. The settings side: not reached
- * by the adapter, so it may use the real clock by default.
+ * the `Authorization` header, never the URL. The check itself is OpenAI's
+ * model list, lifted at its third user (Stage 2 OpenAI Live, choice 4); this
+ * provider's part is its family and its refusal. The settings side: not
+ * reached by the adapter, so it may use the real clock by default.
  */
-import { realClock, type Clock } from '../../lib/contract/clock';
-import { boundedFetch } from '../../lib/provider/boundedFetch';
+import { createOpenAIModelCheck, type OpenAIModelCheckDeps } from '../../lib/provider/openaiModels';
 import type { CheckContext, CheckResult } from '../../lib/provider/types';
 import { isTranslateModelId, type TranslateCredentials, type TranslateSettings } from './settings';
 
-export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
-/** As long as Soniox's, Gemini's and Doubao's checks wait. */
-export const CHECK_TIMEOUT_MS = 15_000;
+export { CHECK_TIMEOUT_MS, OPENAI_MODELS_URL } from '../../lib/provider/openaiModels';
 
-interface ModelList { data?: Array<{ id?: unknown; created?: unknown }> }
-interface ErrorBody { error?: { message?: unknown; code?: unknown } }
-
-export interface TranslateCheckDeps {
-  fetch?: typeof fetch;
-  clock?: Pick<Clock, 'setTimeout'>;
-}
+export type TranslateCheckDeps = OpenAIModelCheckDeps;
 
 export function createTranslateCheck(deps: TranslateCheckDeps = {}) {
-  const clock = deps.clock ?? realClock;
-  return (k: TranslateCredentials, _s: TranslateSettings, ctx: CheckContext): Promise<CheckResult> => {
-    // Read at call time, so a test's stubbed global is seen.
-    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
-    const late = `OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`;
-    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
-      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${k.apiKey}` }, signal });
-      if (!response.ok) {
-        const body = (await response.json().catch(() => ({}))) as ErrorBody;
-        const said = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'OpenAI did not accept this key.';
-        const reason = `HTTP ${response.status}: ${said}`;
-        // A region OpenAI does not serve reads as such, whatever the status (`OpenAIClient.ts:170-179`).
-        if (body.error?.code === 'unsupported_country_region_territory') return { ok: false, code: 'region_unsupported', reason };
-        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason };
-        if (response.status === 429) return { ok: false, code: 'rate_limit', reason };
-        throw new Error(`OpenAI answered the model list with HTTP ${response.status}.`);
-      }
-      const body = (await response.json()) as ModelList;
-      const models = (body.data ?? [])
-        .flatMap((m) => (typeof m.id === 'string' && isTranslateModelId(m.id) ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []))
-        // Newest first, as the old list sorted them (`OpenAITranslateGAClient.ts:231-234`); the id breaks a tie.
-        .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
-      // Each id once: a readiness answer's models are keyed by id.
-      const ids = [...new Set(models.map((m) => m.id))];
-      if (ids.length === 0) return { ok: false, code: 'no_translate_model', reason: 'This key lists no gpt-realtime-translate model.' };
-      return { ok: true, models: ids.map((id) => ({ id })) };
-    });
-  };
+  const check = createOpenAIModelCheck({ keep: isTranslateModelId, none: { code: 'no_translate_model', reason: 'This key lists no gpt-realtime-translate model.' } }, deps);
+  return (k: TranslateCredentials, _s: TranslateSettings, ctx: CheckContext): Promise<CheckResult> => check(k.apiKey, ctx);
 }
 
 export const checkTranslate = createTranslateCheck();
diff --git a/src/providers/openai/wire.ts b/src/providers/openai/wire.ts
--- a/src/providers/openai/wire.ts
+++ b/src/providers/openai/wire.ts
@@ -21,10 +21,14 @@
   ResponseCreateEvent,
 } from 'openai/resources/realtime/realtime';
 import { pcmToBase64 } from '../../lib/contract/pcm64';
+import { errorCode as openaiErrorCode } from '../../lib/provider/openaiWire';
 import type { RealtimeConfig, TurnDetection } from './config';
 import type { RealtimeCredentials } from './settings';
 import type { TranscriptionHint } from './transcription';
 
+/** The decoder and the error's words: lifted at their third user, OpenAI Live (Stage 2 OpenAI Live, choice 4); re-exported, so this wire's importers are unchanged. */
+export { decodeServerEvent, errorWords, type ServerEvent } from '../../lib/provider/openaiWire';
+
 /** The GA endpoint the SDK dials (`openai/realtime/internal-base.js:41-50`); the model rides in its query, fixed at creation. */
 export const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime';
 
@@ -156,21 +160,6 @@
   return response.conversation_id === null || metadata?.purpose === ANCHOR_METADATA.purpose;
 }
 
-/** A server event as the adapter reads it: a JSON object with a string `type`; the adapter reads each through its SDK type. */
-export type ServerEvent = { type: string } & Record<string, unknown>;
-
-const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';
-
-/** A server frame, decoded at once: text, or a binary frame read as an ArrayBuffer (choice 15). Throws when it is not a JSON object with a string `type`. */
-export function decodeServerEvent(data: unknown): ServerEvent {
-  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
-  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
-  const parsed: unknown = JSON.parse(text);
-  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
-  if (typeof (parsed as { type?: unknown }).type !== 'string') throw new Error('a server frame with no type');
-  return parsed as ServerEvent;
-}
-
 /**
  * A translation's final text (choice 5): trimmed, and unwrapped when the
  * model answered in JSON (`{"final_text": …}`) — copied from
@@ -200,21 +189,13 @@
 
 /**
  * A server `error` as a notice code (choice 14): OpenAI Translate's mapping
- * (its choice 9), copied, and one more — the 60-minute cap's
- * `session_expired` is the run's end, worded as the segment ended
- * (`segment_ended`: "This segment has ended — tap Start Session to
- * continue."), not a refused request. A hypothesis the live test's
- * `session.error` frames settle.
+ * (its choice 9), lifted with it (Stage 2 OpenAI Live, choice 4), and one
+ * more — the 60-minute cap's `session_expired` is the run's end, worded as
+ * the segment ended (`segment_ended`: "This segment has ended — tap Start
+ * Session to continue."), not a refused request. A hypothesis the live
+ * test's `session.error` frames settle.
  */
 export function errorCode(e: Partial<RealtimeError>): ErrorCode {
   if (e.code === 'session_expired') return 'segment_ended';
-  if (e.code === 'invalid_api_key') return 'auth';
-  if (e.code === 'rate_limit_exceeded' || e.code === 'insufficient_quota') return 'rate_limit';
-  if (e.type === 'invalid_request_error') return 'client';
-  return 'server';
-}
-
-/** A server `error` in OpenAI's own words, as the `{{detail}}` of its notice: `[OpenAI <code, else type>] <message>`. */
-export function errorWords(e: Partial<RealtimeError>): string {
-  return `[OpenAI ${e.code || e.type || 'error'}] ${e.message || 'the server reported an error'}`;
+  return openaiErrorCode(e);
 }
diff --git a/src/providers/openai/check.ts b/src/providers/openai/check.ts
--- a/src/providers/openai/check.ts
+++ b/src/providers/openai/check.ts
@@ -4,58 +4,25 @@
  * changes (choice 16) — the request is bounded (`boundedFetch`, choice 2);
  * a status the key does not explain (a 404, a 5xx) or a failed fetch
  * throws, where the old one called every failure an invalid key; and a
- * refusal answers a code the surfaces put into words. The key rides in the
- * `Authorization` header, never the URL. It reads no setting (ruling 9:
- * `checkReads: []`). The settings side: not reached by the adapter, so it
- * may use the real clock by default.
+ * refusal answers a code the surfaces put into words — a restricted project
+ * key's 403 a refused key, as the old validation did (ruling 17). The key
+ * rides in the `Authorization` header, never the URL. It reads no setting
+ * (ruling 9: `checkReads: []`). The check itself is OpenAI's model list,
+ * lifted at its third user (Stage 2 OpenAI Live, choice 4); this provider's
+ * part is its family and its refusal. The settings side: not reached by the
+ * adapter, so it may use the real clock by default.
  */
-import { realClock, type Clock } from '../../lib/contract/clock';
-import { boundedFetch } from '../../lib/provider/boundedFetch';
+import { createOpenAIModelCheck, type OpenAIModelCheckDeps } from '../../lib/provider/openaiModels';
 import type { CheckContext, CheckResult } from '../../lib/provider/types';
 import { isRealtimeModelId, type RealtimeCredentials, type RealtimeSettings } from './settings';
 
-export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
-/** As long as the other checks wait. */
-export const CHECK_TIMEOUT_MS = 15_000;
+export { CHECK_TIMEOUT_MS, OPENAI_MODELS_URL } from '../../lib/provider/openaiModels';
 
-interface ModelList { data?: Array<{ id?: unknown; created?: unknown }> }
-interface ErrorBody { error?: { message?: unknown; code?: unknown } }
-
-export interface RealtimeCheckDeps {
-  fetch?: typeof fetch;
-  clock?: Pick<Clock, 'setTimeout'>;
-}
+export type RealtimeCheckDeps = OpenAIModelCheckDeps;
 
 export function createRealtimeCheck(deps: RealtimeCheckDeps = {}) {
-  const clock = deps.clock ?? realClock;
-  return (k: RealtimeCredentials, _s: RealtimeSettings, ctx: CheckContext): Promise<CheckResult> => {
-    // Read at call time, so a test's stubbed global is seen.
-    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
-    const late = `OpenAI did not answer the model list within ${CHECK_TIMEOUT_MS / 1000} s.`;
-    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
-      const response = await doFetch(OPENAI_MODELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${k.apiKey}` }, signal });
-      if (!response.ok) {
-        const body = (await response.json().catch(() => ({}))) as ErrorBody;
-        const said = typeof body.error?.message === 'string' && body.error.message ? body.error.message : 'OpenAI did not accept this key.';
-        const reason = `HTTP ${response.status}: ${said}`;
-        // A region OpenAI does not serve reads as such, whatever the status (`OpenAIClient.ts:170-179`).
-        if (body.error?.code === 'unsupported_country_region_territory') return { ok: false, code: 'region_unsupported', reason };
-        // A restricted project key's 403 reads as a refused key, as the old validation did (ruling 17).
-        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason };
-        if (response.status === 429) return { ok: false, code: 'rate_limit', reason };
-        throw new Error(`OpenAI answered the model list with HTTP ${response.status}.`);
-      }
-      const body = (await response.json()) as ModelList;
-      const models = (body.data ?? [])
-        .flatMap((m) => (typeof m.id === 'string' && isRealtimeModelId(m.id) ? [{ id: m.id, created: typeof m.created === 'number' ? m.created : 0 }] : []))
-        // Newest first, as the old list sorted them (`OpenAIClient.ts:329-335`); the id breaks a tie.
-        .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
-      // Each id once: a readiness answer's models are keyed by id.
-      const ids = [...new Set(models.map((m) => m.id))];
-      if (ids.length === 0) return { ok: false, code: 'no_realtime_model', reason: 'This key lists no gpt-realtime model.' };
-      return { ok: true, models: ids.map((id) => ({ id })) };
-    });
-  };
+  const check = createOpenAIModelCheck({ keep: isRealtimeModelId, none: { code: 'no_realtime_model', reason: 'This key lists no gpt-realtime model.' } }, deps);
+  return (k: RealtimeCredentials, _s: RealtimeSettings, ctx: CheckContext): Promise<CheckResult> => check(k.apiKey, ctx);
 }
 
 export const checkRealtime = createRealtimeCheck();
```

- [ ] **Step 5: Run the new suites and both providers' own.** The two providers' suites are unchanged: every name they import from their `wire.ts` and `check.ts` is still there, with the same behaviour — which is the lift's pin.

Run: `npx vitest run src/lib/provider/openaiWire.test.ts src/lib/provider/openaiModels.test.ts`
Expected: PASS — 2 files, 8 tests.

Run: `npx vitest run src/providers/openai/ src/providers/openai_translate/`
Expected: PASS — 24 files, 290 tests, as at `a3eab634`.

- [ ] **Step 6: The gates.** The suite and the typecheck gate (in Wave 1, a failure in another task's files is that task's).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/provider/openaiWire.ts src/lib/provider/openaiWire.test.ts src/lib/provider/openaiModels.ts src/lib/provider/openaiModels.test.ts src/providers/openai_translate/wire.ts src/providers/openai_translate/check.ts src/providers/openai/wire.ts src/providers/openai/check.ts
```

```bash
git commit -q -F - -- src/lib/provider/openaiWire.ts src/lib/provider/openaiWire.test.ts src/lib/provider/openaiModels.ts src/lib/provider/openaiModels.test.ts src/providers/openai_translate/wire.ts src/providers/openai_translate/check.ts src/providers/openai/wire.ts src/providers/openai/check.ts <<'EOF'
refactor(provider): lift OpenAI's event decoder, error words and model check

OpenAI Translate and OpenAI Realtime each carried a copy of the server
event decoder, the error's code and words, and the model-list check.
OpenAI Live is their third user, so they move to src/lib/provider/;
both providers re-export the helpers under their old names and keep
their own model family and refusal. Realtime keeps its own reading of
session_expired.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 5: `ContinuousSegments` takes an adapter's own source rules and a lost connection (Wave 1)

**Files:**
- Modify: `src/lib/segmentation/continuousSegments.ts` (the header, `CutReason`, three methods)
- Test: `src/lib/segmentation/continuousSegments.test.ts` (the stop case, and a new `describe` after it)

**Interfaces:**
- Consumes: the module as the translation cuts plan landed it.
- Produces: `CutReason` gains `'lost'`; `cutSource(): void`; `translationContinues(text: string): void`; `closeAll(): void` (choice 5). **Revision 1:** no `holdSource` option — ruling 10 removed its reason (choice 6).

**Its users:** OpenAI Translate's `segments.ts` and Gemini's Live Translate call none of the new members: their suites, and the translation cuts plan's replays, run unchanged (step 5).

- [ ] **Step 1: Write the failing tests.** The stop case also asks that the new members say nothing after a stop; the new `describe` pins each member:

```diff
diff --git a/src/lib/segmentation/continuousSegments.test.ts b/src/lib/segmentation/continuousSegments.test.ts
--- a/src/lib/segmentation/continuousSegments.test.ts
+++ b/src/lib/segmentation/continuousSegments.test.ts
@@ -753,6 +753,9 @@
       s.typed('late');
       s.done('source');
       s.endTurn();
+      s.cutSource();
+      s.translationContinues('.');
+      s.closeAll();
       expect(timers()).toBe(0);
       expect(log.length).toBe(n);
       expect(cuts.length).toBe(c);
@@ -760,6 +763,60 @@
   });
 });
 
+describe("an adapter's own source rules and a lost connection (Stage 2 OpenAI Live, choice 5)", () => {
+  it('cutSource closes the open source now, owing its cut as its pause would; with none open it does nothing', () => {
+    const { s, closed, opened, timers } = segments();
+    s.cutSource();
+    expect(closed()).toEqual([]);
+    s.sourceText('今天我吃了');
+    s.cutSource();
+    expect(closed()).toEqual([{ ref: 1 }]);
+    // Owed: the translation that begins now states that source; its pause to begin runs.
+    expect(timers()).toBe(1);
+    s.translationText('Today I ate');
+    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
+  });
+
+  it('translationContinues ends the open translation with its marks before a cut due is taken — counted, shown, its activity — and with none open does nothing', () => {
+    const { s, at, texts, closed, opened } = segments();
+    s.sourceText('你好');
+    s.cutSource();
+    at(100);
+    s.translationText('Hello there');
+    s.translationContinues('.');
+    expect(texts(2)).toEqual(['Hello there', 'Hello there.']);
+    s.translationText(' Bye');
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
+    expect(opened()[2]).toEqual({ ref: 3, side: 'translation' });
+    const none = segments();
+    none.s.translationContinues('.');
+    expect(none.log).toEqual([]);
+  });
+
+  it('closeAll closes both sides as they stand, drops every cut owed, leaves no timer; the refs count on, and the next translation follows no source before it', () => {
+    const { s, at, closed, opened, cuts, timers } = segments();
+    s.sourceText('一。');
+    s.cutSource();
+    at(100);
+    s.translationText('One');
+    s.sourceText('二');
+    s.closeAll();
+    expect(closed()).toEqual([{ ref: 1 }, { ref: 3 }, { ref: 2 }]);
+    expect(cuts).toEqual([{ reason: 'lost', origin: 's1', sentences: 0, owed: 0, dropped: 1 }]);
+    expect(timers()).toBe(0);
+    s.translationText('Again.');
+    expect(opened()[3]).toEqual({ ref: 4, side: 'translation' });
+    at(1_600);
+    expect(closed()[3]).toEqual({ ref: 4 });
+    // With no translation open, what is owed is dropped as idle.
+    const idle = segments();
+    idle.s.sourceText('你好');
+    idle.s.closeAll();
+    expect(idle.cuts).toEqual([{ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 }]);
+    expect(idle.timers()).toBe(0);
+  });
+});
+
 describe("the spike's three recorded sessions (translation cuts, ruling 1; choice 15)", () => {
   it.each([
     ['at the default pauses', SILENCE],
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/segmentation/continuousSegments.test.ts`
Expected: FAIL — `Tests 4 failed | 40 passed (44)`: the stop case and the three new ones, each on `TypeError: s.cutSource is not a function`.

- [ ] **Step 3: Add the members.**

```diff
diff --git a/src/lib/segmentation/continuousSegments.ts b/src/lib/segmentation/continuousSegments.ts
--- a/src/lib/segmentation/continuousSegments.ts
+++ b/src/lib/segmentation/continuousSegments.ts
@@ -26,6 +26,12 @@
  *   its pause to begin; if none begins, every owed cut is dropped, and one that
  *   begins while a newer source is already open follows that source (choice
  *   8).
+ * - An adapter with source rules of its own — OpenAI Live's timeline pause,
+ *   sentence count and caps — cuts the source itself (`cutSource`), and ends
+ *   the open translation's text with a delta's leading marks before a due cut
+ *   (`translationContinues`); a lost connection closes both sides as they
+ *   stand (`closeAll`). The cuts owed, and the translation that follows
+ *   them, are the same (Stage 2 OpenAI Live, choice 5).
  *
  * Pure: every timer on the clock it is handed, every time from its `now()`.
  */
@@ -79,10 +85,11 @@
 /**
  * Why a translation closed (choice 14): `sentences`, the cut owed first was
  * due; `quiet`, its own pause; `done`, the endpoint's `.done`; `turn`, a turn
- * end on a stream with none. `idle`: owed cuts dropped with no translation
- * to close — none began within its pause, or one began for a newer source.
+ * end on a stream with none; `lost`, the connection (Stage 2 OpenAI Live,
+ * choice 5). `idle`: owed cuts dropped with no translation to close — none
+ * began within its pause, or one began for a newer source.
  */
-export type CutReason = 'sentences' | 'quiet' | 'done' | 'turn' | 'idle';
+export type CutReason = 'sentences' | 'quiet' | 'done' | 'turn' | 'lost' | 'idle';
 
 /** One cut, for the Logs (`translation.cut`; choice 14): never text. */
 export interface CutSummary {
@@ -201,6 +208,21 @@
   }
 
   /**
+   * Text that continues the open translation whatever cut is due: OpenAI
+   * Live's leading marks, which end the text before them (Stage 2 OpenAI
+   * Live, choice 8). Counted, shown and its activity as a delta is; with no
+   * translation open, nothing.
+   */
+  translationContinues(text: string): void {
+    const tr = this.translation;
+    if (this.stopped || !text || !tr) return;
+    this.readEnds(tr, text);
+    tr.text += text;
+    this.o.sink.segmentText({ ref: tr.ref, text: tr.text });
+    this.active();
+  }
+
+  /**
    * The translation's audio. `active`: it opens a translation when none is
    * open and is the translation's activity, as a delta is (OpenAI Translate's
    * frames above its noise floor); otherwise it does neither (Gemini's, and
@@ -253,6 +275,33 @@
     if (this.translation) this.settle('turn');
   }
 
+  /** The adapter's own source cut (Stage 2 OpenAI Live, choice 5): the open source closes now, owing its cut, as its pause would close it. */
+  cutSource(): void {
+    if (this.stopped) return;
+    this.closeSource();
+  }
+
+  /**
+   * The connection is gone (Stage 2 OpenAI Live, choice 5): the source and
+   * the translation close as they stand, every cut still owed is dropped,
+   * and no timer is left. The refs keep counting — a ref is never reused in
+   * one session — and the next translation follows no source of the old
+   * connection.
+   */
+  closeAll(): void {
+    if (this.stopped) return;
+    this.closeSource();
+    if (this.translation) this.closeTranslation('lost');
+    else this.dropOwed();
+    this.cancelSource();
+    this.cancelTranslation();
+    this.deferral.reset();
+    this.beginning = false;
+    this.held = false;
+    this.waiting = false;
+    this.lastClosed = undefined;
+  }
+
   /** No timer is left, and nothing is said after it: L1 finalizes what is open. */
   stop(): void {
     this.stopped = true;
```

- [ ] **Step 4: Run the module's suite.**

Run: `npx vitest run src/lib/segmentation/continuousSegments.test.ts`
Expected: PASS — 44 tests.

- [ ] **Step 5: Run its users.**

Run: `npx vitest run src/lib/segmentation src/providers/openai_translate src/providers/gemini`
Expected: PASS — 36 files, 690 tests: the module's other suites, the translation cuts replays, OpenAI Translate's and Gemini's — none changed.

- [ ] **Step 6: The gates.** The suite and the typecheck gate; and the full tree still prints 259, none of its lines naming `src/lib/segmentation/` (outside the gate's regex).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/segmentation/continuousSegments.ts src/lib/segmentation/continuousSegments.test.ts
```

```bash
git commit -q -F - -- src/lib/segmentation/continuousSegments.ts src/lib/segmentation/continuousSegments.test.ts <<'EOF'
feat(segmentation): let an adapter cut the source and survive a lost connection

ContinuousSegments gains what OpenAI Live needs: cutSource() for an
adapter's own source rules, translationContinues() for marks that end
the open translation before a due cut, and closeAll() to close both
sides as they stand when the connection is lost. Its current users call
none of them.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 6: OpenAI Live's settings, lists, credentials and builder (Wave 1)

**Files:**
- Create: `src/providers/openai_live/adapter.ts` (a seed, first), `src/providers/openai_live/settings.ts`, `src/providers/openai_live/config.ts`
- Test: `src/providers/openai_live/settings.test.ts`, `src/providers/openai_live/config.test.ts`

**Interfaces:**
- Consumes: `AUTO` (`src/lib/provider/languages`); `InstructionsSettings`, `INSTRUCTIONS_DEFAULTS`, `INSTRUCTION_LEGACY_KEYS`, `migrateInstructions`, `resolveInstructions` (`src/lib/provider/instructions`); `CredentialsMissing`, `LanguageOption`, `MigrationInputs`, `Provider`, `ProviderRefusal`, `SharedSettings` (`src/lib/provider/types`); `SessionContext` (`src/lib/contract/adapter`); `clampSegmentPauseMs`, `segmentPauseMs` (`src/lib/segmentation/segmentationMode`).
- Produces:
  - `settings.ts`: `LiveSettings extends InstructionsSettings { voice: string }` (`S`), `LIVE_MODEL` (`'gpt-live-1'`), `LIVE_DEFAULT_VOICE` (`'marin'`), `LIVE_DEFAULTS`, `LIVE_LEGACY_KEYS`, `LIVE_VOICES` (22), `migrateLiveSettings(stored, inputs): LiveSettings`, `LIVE_LANGUAGES` (55), `liveLanguages` (`sources`, `targets`, `initial`), `liveLanguageName(code): string`, `LiveCredentials { apiKey }` (`K`), `liveCredentials`, `isLiveModelId(id): boolean`;
  - `config.ts`: `LiveConfig` (`C`: `{ model, instructions, voice, silence: { sourceMs, translationMs, deferMidSentence }, sentencesPerSegment, transport: 'websocket' }`), `buildLive(context, s, shared): LiveConfig | ProviderRefusal`, `describeLive(c): { translationModel; asrModel }`.

- [ ] **Step 1: Seed the folder's `adapter.ts` first** (research note 9). The session-side guard requires one in every folder under `src/providers`; Task 9 replaces it. Create `src/providers/openai_live/adapter.ts`:

```ts
/**
 * OpenAI Live's session side (plan: Stage 2 OpenAI Live). The adapter lands
 * in its Task 9; until then this seed is the `adapter.ts` the session-side
 * guard (`sessionSide.consistency.test.ts`) requires of every provider
 * folder.
 */
export {};
```

Run: `npx vitest run src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 8 tests (the walk from the seed finds `adapter.ts` alone; nothing pins Live's session side yet).

- [ ] **Step 2: Write the failing tests.** Create `src/providers/openai_live/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS } from '../../lib/provider/instructions';
import { AUTO, reverseSupported } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import {
  isLiveModelId, LIVE_DEFAULTS, LIVE_LANGUAGES, LIVE_LEGACY_KEYS, LIVE_VOICES, liveCredentials, liveLanguageName, liveLanguages, migrateLiveSettings,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const migrate = (stored: Record<string, unknown>, legacy: Record<string, unknown> = {}) => migrateLiveSettings(stored, { legacy, credentials: { apiKey: '' } });

describe("OpenAI Live's settings", () => {
  it("starts from the old voice, marin, and the instructions it now owns; reads the instructions' legacy keys and nothing else", () => {
    expect(LIVE_DEFAULTS).toEqual({ ...INSTRUCTIONS_DEFAULTS, voice: 'marin' });
    expect(LIVE_LEGACY_KEYS).toEqual(INSTRUCTION_LEGACY_KEYS);
  });

  it("loads an old profile field by field, converting nothing: a voice outside the 22 falls to marin, and the old slice's key, pair and pauses are not read into S", () => {
    const s = migrate({ apiKey: 'sk-x', sourceLanguage: 'ja', targetLanguage: 'en', voice: 'cedar', userSilenceDuration: 800, assistantSilenceDuration: 1200 });
    expect(s).toEqual({ ...INSTRUCTIONS_DEFAULTS, voice: 'cedar' });
    expect(migrate({ voice: 'nova' }).voice).toBe('marin');
    expect(migrate({ voice: 7 }).voice).toBe('marin');
  });

  it("reads the global instructions until its own are written, as every provider that owns them does", () => {
    const s = migrate({}, { 'settings.common.useTemplateMode': false, 'settings.common.systemInstructions': 'Interpret faithfully.' });
    expect(s).toMatchObject({ useTemplateMode: false, systemInstructions: 'Interpret faithfully.' });
  });

  it('offers the 22 voices — the ten Realtime ones, then the twelve Live added — in the old order', () => {
    expect(LIVE_VOICES.map((v) => v.value)).toEqual([
      'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse',
      'quartz', 'ripple', 'vesper', 'willow', 'stone', 'gleam', 'meridian', 'bossa', 'tempo', 'beacon', 'delta', 'cinder',
    ]);
  });
});

describe("OpenAI Live's languages (D20)", () => {
  it('hears Auto-detect and the 55, speaks the 55, and starts from English into Chinese (China)', () => {
    expect(LIVE_LANGUAGES).toHaveLength(55);
    expect(liveLanguages.sources(LIVE_DEFAULTS)[0].value).toBe(AUTO);
    expect(liveLanguages.sources(LIVE_DEFAULTS).slice(1)).toEqual(LIVE_LANGUAGES);
    expect(liveLanguages.targets('ja', LIVE_DEFAULTS)).toEqual(LIVE_LANGUAGES);
    expect(liveLanguages.initial?.(LIVE_DEFAULTS)).toEqual({ source: 'en', target: 'zh_CN' });
  });

  it('refuses Both for an Auto-detect source, as D20 does for every provider — no provider rule is left to write', () => {
    const p = { languages: liveLanguages };
    expect(reverseSupported(p, LIVE_DEFAULTS, { source: AUTO, target: 'en' })).toBe(false);
    expect(reverseSupported(p, LIVE_DEFAULTS, { source: 'en', target: 'zh_CN' })).toBe(true);
  });

  it('names a language in English for the template; Auto-detect is "the spoken language", where the old client wrote "auto"', () => {
    expect(liveLanguageName('zh_CN')).toBe('Chinese (China)');
    expect(liveLanguageName(AUTO)).toBe('the spoken language');
    expect(liveLanguageName('xx')).toBe('xx');
  });
});

describe("OpenAI Live's credentials and model family", () => {
  it("reads its own key, trimmed — not OpenAI Realtime's or Translate's, and no prefill (ruling 9)", () => {
    expect(liveCredentials.keys).toEqual(['apiKey']);
    expect(liveCredentials.fields(LIVE_DEFAULTS)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
    expect(liveCredentials.read({ apiKey: '  sk-live \n' }, signedOut)).toEqual({ apiKey: 'sk-live' });
    expect(liveCredentials.read({ apiKey: ' ' }, signedOut)).toEqual({ missing: 'Enter your OpenAI API key.' });
  });

  it('takes gpt-live-1 and any dated gpt-live snapshot, never the transcription model', () => {
    expect(['gpt-live-1', 'GPT-LIVE-1', 'gpt-live-2026-10-01'].every(isLiveModelId)).toBe(true);
    expect(['gpt-live-transcribe', 'gpt-live-transcribe-2026', 'gpt-realtime', 'gpt-live'].some(isLiveModelId)).toBe(false);
  });
});
```

Create `src/providers/openai_live/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import { INSTRUCTIONS_TEMPLATE } from '../../lib/provider/instructions';
import { AUTO } from '../../lib/provider/languages';
import type { SharedSettings } from '../../lib/provider/types';
import { buildLive, describeLive } from './config';
import { LIVE_DEFAULTS } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 2 },
  reversed: (d) => d.source === 'zh_CN' && d.target === 'en',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-live-1' }],
};
const SPEAKER: SessionContext = { direction: { source: 'en', target: 'zh_CN' }, speech: true, turns: 'auto' };
const PARTICIPANT: SessionContext = { direction: { source: 'zh_CN', target: 'en' }, speech: false, turns: 'auto' };

describe("OpenAI Live's builder", () => {
  it("builds gpt-live-1 with this direction's prompt, the voice, both pauses and one sentence a segment by pause", () => {
    expect(buildLive(SPEAKER, { ...LIVE_DEFAULTS, voice: 'cedar' }, SHARED)).toEqual({
      model: 'gpt-live-1',
      instructions: INSTRUCTIONS_TEMPLATE.replace(/\{\{SOURCE_LANGUAGE\}\}/g, 'English').replace(/\{\{TARGET_LANGUAGE\}\}/g, 'Chinese (China)'),
      voice: 'cedar',
      silence: { sourceMs: 1500, translationMs: 2000, deferMidSentence: false },
      sentencesPerSegment: 1,
      transport: 'websocket',
    });
  });

  it("cuts every N sentences by sentence, N the display's own (ruling 4) — none at 0 — and one when the display cuts nothing", () => {
    const at = (segmentation: SharedSettings['segmentation']) => {
      const c = buildLive(SPEAKER, LIVE_DEFAULTS, { ...SHARED, segmentation });
      return 'refused' in c ? c : [c.sentencesPerSegment, c.silence.deferMidSentence];
    };
    expect(at({ mode: 'sentences', sentencesPerRow: 3 })).toEqual([3, true]);
    expect(at({ mode: 'sentences', sentencesPerRow: 0 })).toEqual([0, true]);
    expect(at({ mode: 'off', sentencesPerRow: 2 })).toEqual([1, false]);
  });

  it("gives the participant's direction Other's prompt in Advanced mode, and builds the same whether the leg speaks or not (ruling 1)", () => {
    const s = { ...LIVE_DEFAULTS, useTemplateMode: false, systemInstructions: 'Mine.', participantSystemInstructions: 'Theirs.' };
    const c = buildLive(PARTICIPANT, s, SHARED);
    expect(c).toMatchObject({ instructions: 'Theirs.' });
    expect(buildLive({ ...PARTICIPANT, speech: true }, s, SHARED)).toEqual(c);
  });

  it('names an Auto-detect source "the spoken language" in the template', () => {
    const c = buildLive({ ...SPEAKER, direction: { source: AUTO, target: 'ja' } }, LIVE_DEFAULTS, SHARED);
    expect('refused' in c ? c.refused : c.instructions).toContain('translate the spoken language → Japanese');
  });

  it('refuses a target outside the 55 in words, and asks for marin in place of a voice outside the 22', () => {
    expect(buildLive({ ...SPEAKER, direction: { source: 'en', target: 'yue' } }, LIVE_DEFAULTS, SHARED)).toEqual({ refused: 'OpenAI Live does not translate into yue.' });
    expect(buildLive(SPEAKER, { ...LIVE_DEFAULTS, voice: 'nova' }, SHARED)).toMatchObject({ voice: 'marin' });
  });

  it('describes one model for both sides: it hears as well as translates', () => {
    const c = buildLive(SPEAKER, LIVE_DEFAULTS, SHARED);
    if ('refused' in c) throw new Error(c.refused);
    expect(describeLive(c)).toEqual({ translationModel: 'gpt-live-1', asrModel: 'gpt-live-1' });
  });
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `npx vitest run src/providers/openai_live`
Expected: FAIL — `Test Files 2 failed (2)`, no test runs: `Failed to resolve import "./settings"` and `"./config"`.

- [ ] **Step 4: Write the settings side.** Create `src/providers/openai_live/settings.ts`:

```ts
/**
 * OpenAI Live's `S`, languages, voices and credentials. `S` is
 * the old slice (`OpenAILiveProviderConfig.ts:10-24`) without what leaves it
 * — the key (a credential, its own: no prefill from OpenAI Realtime's,
 * ruling 9), the pair (`providerStore`, same keys) — plus the instructions
 * it now owns (Stage 2 Gemini, ruling 4). Stored under `settings.openaiLive.*`
 * as before; `userSilenceDuration` / `assistantSilenceDuration`, which two
 * builds carried, are not read. The language and voice lists are the old
 * descriptor's, copied: nothing here imports `src/services` or another
 * provider (ruling 9).
 */
import { AUTO } from '../../lib/provider/languages';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS, migrateInstructions, type InstructionsSettings } from '../../lib/provider/instructions';
import type { CredentialsMissing, LanguageOption, MigrationInputs, Provider } from '../../lib/provider/types';

export interface LiveSettings extends InstructionsSettings {
  /** One of `LIVE_VOICES`: the voice `session.start` asks for. */
  voice: string;
}

/** The model every session runs (`OpenAILiveProviderConfig.ts:79`): the check requires it, nothing chooses it. */
export const LIVE_MODEL = 'gpt-live-1';
export const LIVE_DEFAULT_VOICE = 'marin';

export const LIVE_DEFAULTS: LiveSettings = { ...INSTRUCTIONS_DEFAULTS, voice: LIVE_DEFAULT_VOICE };

/** The instructions' legacy keys (Stage 2 Gemini, choice 1): nothing else is read that `S` does not name. */
export const LIVE_LEGACY_KEYS: readonly string[] = INSTRUCTION_LEGACY_KEYS;

/** The ten Realtime voices in their order, then the twelve Live added (`OpenAILiveProviderConfig.ts:27-41`). */
export const LIVE_VOICES: readonly { value: string; name: string }[] = [
  { name: 'Alloy', value: 'alloy' },
  { name: 'Ash', value: 'ash' },
  { name: 'Ballad', value: 'ballad' },
  { name: 'Cedar', value: 'cedar' },
  { name: 'Coral', value: 'coral' },
  { name: 'Echo', value: 'echo' },
  { name: 'Marin', value: 'marin' },
  { name: 'Sage', value: 'sage' },
  { name: 'Shimmer', value: 'shimmer' },
  { name: 'Verse', value: 'verse' },
  { name: 'Quartz', value: 'quartz' },
  { name: 'Ripple', value: 'ripple' },
  { name: 'Vesper', value: 'vesper' },
  { name: 'Willow', value: 'willow' },
  { name: 'Stone', value: 'stone' },
  { name: 'Gleam', value: 'gleam' },
  { name: 'Meridian', value: 'meridian' },
  { name: 'Bossa', value: 'bossa' },
  { name: 'Tempo', value: 'tempo' },
  { name: 'Beacon', value: 'beacon' },
  { name: 'Delta', value: 'delta' },
  { name: 'Cinder', value: 'cinder' },
];

/**
 * What was stored, made valid field by field: a voice not among the
 * twenty-two falls to `marin`, and the instructions come from
 * `migrateInstructions`. Nothing is converted, nothing written back (the
 * owner's rule).
 */
export function migrateLiveSettings(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): LiveSettings {
  const voice = LIVE_VOICES.some((v) => v.value === stored.voice) ? (stored.voice as string) : LIVE_DEFAULT_VOICE;
  return { ...migrateInstructions(stored, inputs.legacy), voice };
}

/** The 55 languages the old provider offered (`OpenAIProviderConfig.LANGUAGES`, `OpenAILiveProviderConfig.ts:112`): every one a source and a target. */
export const LIVE_LANGUAGES: readonly LanguageOption[] = [
  { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  { name: 'አማርኛ', value: 'am', englishName: 'Amharic' },
  { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
  { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
  { name: 'Català', value: 'ca', englishName: 'Catalan' },
  { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  { name: 'Dansk', value: 'da', englishName: 'Danish' },
  { name: 'Deutsch', value: 'de', englishName: 'German' },
  { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
  { name: 'English', value: 'en', englishName: 'English' },
  { name: 'English (Australia)', value: 'en_AU', englishName: 'English (Australia)' },
  { name: 'English (Great Britain)', value: 'en_GB', englishName: 'English (Great Britain)' },
  { name: 'English (USA)', value: 'en_US', englishName: 'English (USA)' },
  { name: 'Español', value: 'es', englishName: 'Spanish' },
  { name: 'Español (Latinoamérica)', value: 'es_419', englishName: 'Spanish (Latin America and Caribbean)' },
  { name: 'Eesti', value: 'et', englishName: 'Estonian' },
  { name: 'فارسی', value: 'fa', englishName: 'Persian' },
  { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  { name: 'Filipino', value: 'fil', englishName: 'Filipino' },
  { name: 'Français', value: 'fr', englishName: 'French' },
  { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
  { name: 'עברית', value: 'he', englishName: 'Hebrew' },
  { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
  { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  { name: 'Italiano', value: 'it', englishName: 'Italian' },
  { name: '日本語', value: 'ja', englishName: 'Japanese' },
  { name: 'ಕನ್ನಡ', value: 'kn', englishName: 'Kannada' },
  { name: '한국어', value: 'ko', englishName: 'Korean' },
  { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
  { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
  { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
  { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
  { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
  { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  { name: 'Polski', value: 'pl', englishName: 'Polish' },
  { name: 'Português (Brasil)', value: 'pt_BR', englishName: 'Portuguese (Brazil)' },
  { name: 'Português (Portugal)', value: 'pt_PT', englishName: 'Portuguese (Portugal)' },
  { name: 'Română', value: 'ro', englishName: 'Romanian' },
  { name: 'Русский', value: 'ru', englishName: 'Russian' },
  { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
  { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
  { name: 'Српски', value: 'sr', englishName: 'Serbian' },
  { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
  { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
  { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
  { name: 'ไทย', value: 'th', englishName: 'Thai' },
  { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  { name: '中文 (中国)', value: 'zh_CN', englishName: 'Chinese (China)' },
  { name: '中文 (台灣)', value: 'zh_TW', englishName: 'Chinese (Taiwan)' },
];

/** "Auto-detect" stays a source: the model hears any language. Named as the other providers name it; the picker shows `common.autoDetect`. */
const AUTO_SOURCE: LanguageOption = { value: AUTO, name: 'Auto', englishName: 'Auto' };

/**
 * `AUTO` first, then the 55, as the old picker listed them; every language a
 * target for every source, the source included. D20 refuses Both for an
 * `AUTO` source — the old `reversesDirectionViaSourceLanguage` has no
 * successor to write.
 */
export const liveLanguages: Provider<LiveSettings, never, never>['languages'] = {
  sources: () => [AUTO_SOURCE, ...LIVE_LANGUAGES],
  targets: () => LIVE_LANGUAGES,
  initial: () => ({ source: 'en', target: 'zh_CN' }),
};

/**
 * A code's English name, for the instructions' template: the code when
 * unnamed, and `AUTO` "the spoken language" — OpenAI Realtime's rule, where
 * the old client rendered the literal "auto" (a stated departure).
 */
export function liveLanguageName(code: string): string {
  if (code === AUTO) return 'the spoken language';
  return LIVE_LANGUAGES.find((o) => o.value === code)?.englishName || code;
}

export interface LiveCredentials {
  apiKey: string;
}

export const liveCredentials: Provider<LiveSettings, LiveCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): LiveCredentials | CredentialsMissing => {
    // Trimmed: the key rides in an upgrade header, where a pasted trailing newline or space is no valid token.
    const apiKey = (values.apiKey ?? '').trim();
    // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
    return apiKey ? { apiKey } : { missing: 'Enter your OpenAI API key.' };
  },
};

/** `gpt-live-1` and any dated `gpt-live-…` snapshot, never the transcription model (`OpenAILiveClient.ts:251-255`). */
export function isLiveModelId(id: string): boolean {
  const name = id.toLowerCase();
  if (name.startsWith('gpt-live-transcribe')) return false;
  return name === LIVE_MODEL || name.startsWith('gpt-live-');
}
```

Create `src/providers/openai_live/config.ts`:

```ts
/**
 * OpenAI Live's `C`, `build` and `describe`. One builder for
 * both legs: the participant is the same call on the reversed direction, so
 * its prompt (Other's, in Advanced mode) follows from `context` — the old
 * participant swap (`OpenAILiveProviderConfig.ts:101-103`) is gone, and D20
 * refuses an `auto` source for it. A leg that does not speak builds the same
 * config: the API always speaks, and the adapter drops the audio (ruling 1).
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { clampSegmentPauseMs, segmentPauseMs } from '../../lib/segmentation/segmentationMode';
import { LIVE_DEFAULT_VOICE, LIVE_LANGUAGES, LIVE_MODEL, LIVE_VOICES, liveLanguageName, type LiveSettings } from './settings';

export interface LiveConfig {
  model: typeof LIVE_MODEL;
  /** This direction's prompt: the whole of what makes the model an interpreter. */
  instructions: string;
  /** One of `LIVE_VOICES`. */
  voice: string;
  /** Each side's silence timer, and the source's mid-sentence deferral in sentence mode (as OpenAI Translate's). */
  silence: { sourceMs: number; translationMs: number; deferMidSentence: boolean };
  /**
   * The source sentences a segment holds before it is cut (ruling 4; choice
   * 7): the display's N in sentence mode, 0 for none there; 1 by pause or
   * off.
   */
  sentencesPerSegment: number;
  /** WebSocket only. It reaches `info.transport`, which analytics reports. */
  transport: 'websocket';
}

export function buildLive(context: SessionContext, s: LiveSettings, shared: SharedSettings): LiveConfig | ProviderRefusal {
  const { source, target } = context.direction;
  // A guard: the languages offer the 55 targets only, so the runner never builds another.
  if (!LIVE_LANGUAGES.some((o) => o.value === target)) return { refused: `OpenAI Live does not translate into ${target}.` };
  const sentences = shared.segmentation.mode === 'sentences';
  return {
    model: LIVE_MODEL,
    // The participant's direction reads Other's prompt, as the other builders do.
    instructions: resolveInstructions(s, { participant: shared.reversed(context.direction), source: liveLanguageName(source), target: liveLanguageName(target) }),
    voice: LIVE_VOICES.some((v) => v.value === s.voice) ? s.voice : LIVE_DEFAULT_VOICE,
    silence: {
      sourceMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.sourceSeconds)),
      translationMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.translationSeconds)),
      deferMidSentence: sentences,
    },
    sentencesPerSegment: sentences ? Math.max(0, Math.round(shared.segmentation.sentencesPerRow)) : 1,
    transport: 'websocket',
  };
}

/** One model: it transcribes both sides itself. */
export function describeLive(c: LiveConfig): { translationModel: string; asrModel: string } {
  return { translationModel: c.model, asrModel: c.model };
}
```

- [ ] **Step 5: Run them.**

Run: `npx vitest run src/providers/openai_live`
Expected: PASS — 2 files, 15 tests.

- [ ] **Step 6: The gates.** The suite and the typecheck gate (in Wave 1, a failure in another task's files is that task's).

- [ ] **Step 7: Commit.**

```bash
git add src/providers/openai_live/adapter.ts src/providers/openai_live/settings.ts src/providers/openai_live/settings.test.ts src/providers/openai_live/config.ts src/providers/openai_live/config.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_live/adapter.ts src/providers/openai_live/settings.ts src/providers/openai_live/settings.test.ts src/providers/openai_live/config.ts src/providers/openai_live/config.test.ts <<'EOF'
feat(openai-live): settings, languages, voices, credentials and builder

OpenAI Live's own settings: the voice and the instructions it now owns,
read from the old slice with nothing converted; the 22 voices and the
55 languages copied from the old descriptor; its own key, trimmed, with
no prefill from OpenAI Realtime's. The builder gives each direction its
prompt, the voice, both pauses and the sentences a segment holds: the
display's count by sentence, one by pause. The adapter's seed holds the
folder's place until the adapter lands.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Wave 1 check (controller)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the replay: 583 files passed and 1 skipped, 7 594 tests passed and 2 skipped); the typecheck gate at exactly the baseline; the full tree at 259, none naming `src/lib/segmentation/`.
- [ ] `npx vitest run electron` (34 files, 477 tests) and `npx vitest run extension` (9 files, 56 tests).

---

### Task 7: OpenAI Live's wire and check (Wave 2)

**Files:**
- Create: `src/providers/openai_live/wire.ts`, `src/providers/openai_live/check.ts`
- Test: `src/providers/openai_live/wire.test.ts`, `src/providers/openai_live/check.test.ts`

**Interfaces:**
- Consumes: Task 3's `UpgradeHeaders` (type); Task 4's `decodeServerEvent`, `errorCode`, `errorWords`, `OpenAIError`, `ServerEvent` (`src/lib/provider/openaiWire`) and `createOpenAIModelCheck`, `OpenAIModelCheckDeps` (`src/lib/provider/openaiModels`); Task 6's `LiveConfig`, `LiveCredentials`, `LiveSettings`, `isLiveModelId`, `buildLive`, `LIVE_DEFAULTS`; `pcmToBase64` / `base64ToPcm` (`src/lib/contract/pcm64`).
- Produces:
  - `wire.ts`: `LIVE_WS_URL` (`'wss://api.openai.com/v1/live/sessions'`), `liveHeaders(k): UpgradeHeaders` (`{ set: { Authorization: 'Bearer <key>' }, remove: ['Origin'] }`, the one function of the session side that reads the key), `SessionStart`, `sessionStart(c, eventId)`, `appendFrame(pcm): string`, `muteFrame(eventId)`, `unmuteFrame(eventId)`, `SESSION_CLOSE`, the server events `SessionStartedEvent`, `TranscriptDeltaEvent`, `OutputAudioDeltaEvent`, `UsageUpdatedEvent`, `SessionClosedEvent`, `ErrorEvent`, `stampOf(v): number | null`; re-exported: `base64ToPcm`, `decodeServerEvent`, `errorCode`, `errorWords`, `OpenAIError`, `ServerEvent`;
  - `check.ts`: `createLiveCheck(deps?)`, `checkLive(k, s, ctx): Promise<CheckResult>` (none listed: `no_realtime_model`, "This key lists no gpt-live model.").

- [ ] **Step 1: Write the failing tests.** The wire's suite reads `wire.ts` with the compiler API and pins that the key is read in `liveHeaders` alone, as OpenAI Translate's does for its subprotocol. Create `src/providers/openai_live/wire.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { buildLive, type LiveConfig } from './config';
import { LIVE_DEFAULTS } from './settings';
import { appendFrame, LIVE_WS_URL, liveHeaders, muteFrame, SESSION_CLOSE, sessionStart, stampOf, unmuteFrame } from './wire';

const KEY = { apiKey: 'sk-proj-liveWire0123456789' };
const CONFIG = buildLive(
  { direction: { source: 'zh_CN', target: 'en' }, speech: true, turns: 'auto' },
  LIVE_DEFAULTS,
  { pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 }, reversed: () => false, segmentation: { mode: 'pause', sentencesPerRow: 0 }, models: [] },
) as LiveConfig;

/** The names the key is read through: the credentials' type and its one field, a string literal naming either too, and any use of the header builder outside its own declaration (OpenAI Translate's `wire.test.ts` scan). */
const SECRET_NAMES = new Set(['LiveCredentials', 'apiKey']);
const BUILDER_NAME = 'liveHeaders';

/** The functions of a module that name the key, `<module>` for a use outside any function; an import names nothing. */
function secretReaders(source: string): string[] {
  const readers = new Set<string>();
  const enclosing = (node: ts.Node): string => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
      if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    }
    return '<module>';
  };
  const isBuilderDeclaration = (node: ts.Identifier): boolean => ts.isFunctionDeclaration(node.parent) && node.parent.name === node;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && (SECRET_NAMES.has(node.text) || (node.text === BUILDER_NAME && !isBuilderDeclaration(node)))) readers.add(enclosing(node));
    if (ts.isStringLiteralLike(node) && SECRET_NAMES.has(node.text)) readers.add(enclosing(node));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true));
  return [...readers].sort();
}

describe("OpenAI Live's wire (ruling 7; U9)", () => {
  it('dials the Live endpoint bare — no query, no subprotocol — with a Bearer header and Origin removed', () => {
    expect(LIVE_WS_URL).toBe('wss://api.openai.com/v1/live/sessions');
    expect(liveHeaders(KEY)).toEqual({ set: { Authorization: `Bearer ${KEY.apiKey}` }, remove: ['Origin'] });
  });

  it('reads the key, in `wire.ts`, in the header builder alone', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['liveHeaders']);
    // The scan's control: a read elsewhere is named; an import is not.
    expect(secretReaders([
      "import type { LiveCredentials } from './settings';",
      'export function url(k: LiveCredentials) { return k.apiKey; }',
      "export function leakIndexed(k: Record<string, string>) { return k['apiKey']; }",
      'export function leakForwarded(k: Parameters<typeof liveHeaders>[0]) { return liveHeaders(k).set; }',
    ].join('\n'))).toEqual(['leakForwarded', 'leakIndexed', 'url']);
  });

  it("starts the session as the old client did: PCM16 at 24 kHz, the voice, the prompt, delegation to the client — null is refused (U12)", () => {
    expect(sessionStart(CONFIG, 'start_1')).toEqual({
      type: 'session.start',
      event_id: 'start_1',
      session: { model: 'gpt-live-1', instructions: CONFIG.instructions, audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } }, delegation: { type: 'client' } },
    });
  });

  it('sends audio as base64 of its own bytes, and the mute, unmute and close frames by name', () => {
    const pcm = new Int16Array([1, -2, 300, -32768]);
    const frame = JSON.parse(appendFrame(pcm.subarray(1, 3))) as { type: string; audio: string };
    expect(frame.type).toBe('session.input_audio.append');
    expect(base64ToPcm(frame.audio)).toEqual(new Int16Array([-2, 300]));
    expect(muteFrame('mute_2')).toEqual({ type: 'session.input_audio.mute', event_id: 'mute_2' });
    expect(unmuteFrame('unmute_3')).toEqual({ type: 'session.input_audio.unmute', event_id: 'unmute_3' });
    expect(SESSION_CLOSE).toEqual({ type: 'session.close' });
  });

  it('reads a stamp as a finite number, else null', () => {
    expect([stampOf(1_600), stampOf('1600'), stampOf(null), stampOf(Number.NaN)]).toEqual([1_600, null, null, null]);
  });
});
```

Create `src/providers/openai_live/check.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { createLiveCheck } from './check';
import { LIVE_DEFAULTS } from './settings';

const K = { apiKey: 'sk-proj-liveCheck0123456789' };
const ctx: CheckContext = { pair: { source: 'en', target: 'zh_CN' }, legs: ['speaker'] };
const listing = (...models: Array<[string, number]>) => new Response(JSON.stringify({ object: 'list', data: models.map(([id, created]) => ({ id, object: 'model', created })) }), { status: 200 });
const check = (fetch: typeof globalThis.fetch) => createLiveCheck({ fetch, clock: createVirtualClock(0) })(K, LIVE_DEFAULTS, ctx);

describe("OpenAI Live's check (ruling 9; choice 4)", () => {
  it('is ready with gpt-live-1 and the dated snapshots, newest first — never the transcription model — asked with its own key', async () => {
    const fetch = vi.fn(async () => listing(['gpt-live-1', 1], ['gpt-live-transcribe', 3], ['gpt-live-2026-10-01', 2], ['gpt-realtime', 4]));
    await expect(check(fetch)).resolves.toEqual({ ok: true, models: [{ id: 'gpt-live-2026-10-01' }, { id: 'gpt-live-1' }] });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ headers: { Authorization: `Bearer ${K.apiKey}` } });
  });

  it("answers a key that lists no Live model with the old validation's words (`no_realtime_model`)", async () => {
    await expect(check(vi.fn(async () => listing(['gpt-live-transcribe', 1], ['gpt-realtime', 2])))).resolves.toEqual({ ok: false, code: 'no_realtime_model', reason: 'This key lists no gpt-live model.' });
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/openai_live/wire.test.ts src/providers/openai_live/check.test.ts`
Expected: FAIL — `Test Files 2 failed (2)`, no test runs: `Failed to resolve import "./wire"` and `"./check"`.

- [ ] **Step 3: Write the wire.** Create `src/providers/openai_live/wire.ts`:

```ts
/**
 * OpenAI Live's wire (the old client's, and the owner's probe, `live.mts`): the
 * endpoint and its upgrade headers, the client frames the adapter sends, and
 * the server's events as the probe recorded them. The installed `openai` SDK
 * (6.39.1) has no Live types, so the frames are typed here by hand (ruling
 * 9). Pure: no socket, no timer.
 */
import type { UpgradeHeaders } from '../../lib/contract/headerSocket';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { OpenAIError } from '../../lib/provider/openaiWire';
import type { LiveConfig } from './config';
import type { LiveCredentials } from './settings';

export { base64ToPcm } from '../../lib/contract/pcm64';
/** OpenAI's decoder and error words, lifted at this third user (ruling 9; choice 4). */
export { decodeServerEvent, errorCode, errorWords, type OpenAIError, type ServerEvent } from '../../lib/provider/openaiWire';

/** No query, no subprotocol: the key rides in the upgrade's header (`OpenAILiveClient.ts:44`). */
export const LIVE_WS_URL = 'wss://api.openai.com/v1/live/sessions';

/**
 * The upgrade's headers (ruling 7; U9): a real `Authorization: Bearer` — the
 * subprotocol is refused, 401 `missing_authorization` — and no `Origin`,
 * which every browser adds and the endpoint answers with 403. The one
 * function of the session side that reads the key; what it returns goes to
 * the header seam alone, never a frame, a word or a log.
 */
export function liveHeaders(k: LiveCredentials): UpgradeHeaders {
  return { set: { Authorization: `Bearer ${k.apiKey}` }, remove: ['Origin'] };
}

/** The first frame (`OpenAILiveClient.ts:100-109`): PCM16 at 24 kHz both ways, the contract's own rate. */
export interface SessionStart {
  type: 'session.start';
  event_id: string;
  session: {
    model: string;
    instructions: string;
    audio: { format: { type: 'audio/pcm'; rate: 24000 }; output: { voice: string } };
    /** `{ type: 'client' }`: `null` is refused, `invalid_type` (U12). */
    delegation: { type: 'client' };
  };
}

export function sessionStart(c: Pick<LiveConfig, 'model' | 'instructions' | 'voice'>, eventId: string): SessionStart {
  return {
    type: 'session.start',
    event_id: eventId,
    session: {
      model: c.model,
      instructions: c.instructions,
      audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: c.voice } },
      delegation: { type: 'client' },
    },
  };
}

/** One chunk as it goes up: base64 of little-endian Int16, as it came (parity). */
export function appendFrame(pcm: Int16Array): string {
  return JSON.stringify({ type: 'session.input_audio.append', audio: pcmToBase64(pcm) });
}

/** A push-to-talk release and press (ruling 5; U2'): acknowledged `session.input_audio.muted` / `.unmuted`, the pending translation finishing while muted. */
export function muteFrame(eventId: string): { type: 'session.input_audio.mute'; event_id: string } {
  return { type: 'session.input_audio.mute', event_id: eventId };
}

export function unmuteFrame(eventId: string): { type: 'session.input_audio.unmute'; event_id: string } {
  return { type: 'session.input_audio.unmute', event_id: eventId };
}

/** The graceful end (ruling 8; U7: `session.closed`, `close_requested`, 0.73 s later), sent at Stop just before the close. */
export const SESSION_CLOSE = { type: 'session.close' } as const;

/** `session.started`: the session's id and its expiry, in seconds since the epoch — two hours on (U7). */
export interface SessionStartedEvent { type: 'session.started'; session?: { id?: unknown; expires_at?: unknown } }
/** A transcript delta: its text and its stamps — the input's on the session's timeline, the output's on its own sample clock (U4, U5). */
export interface TranscriptDeltaEvent { type: string; delta?: unknown; start_ms?: unknown; end_ms?: unknown }
/** An output audio delta: base64 PCM16 at 24 kHz and nothing else — no stamp (U4). */
export interface OutputAudioDeltaEvent { type: 'session.output_audio.delta'; delta?: unknown }
/** About every 15 s, the seconds billed so far. */
export interface UsageUpdatedEvent { type: 'session.usage.updated'; usage?: { seconds?: unknown } }
/** Why the session ended — `close_requested`, `expired`, `content`, `remote_hangup`, `connection_lost` — and the seconds billed. */
export interface SessionClosedEvent { type: 'session.closed'; reason?: unknown; usage?: { seconds?: unknown } }
export interface ErrorEvent { type: 'error'; error?: OpenAIError }

/** A stamp as a number, else null. */
export function stampOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
```

- [ ] **Step 4: Write the check.** Create `src/providers/openai_live/check.ts`:

```ts
/**
 * OpenAI Live's readiness (spec: "Readiness is one check"): the key lists
 * `gpt-live-1` or a dated `gpt-live-…` snapshot, never the transcription
 * model — the old validation's filter (`OpenAILiveClient.ts:251-290`) — on
 * OpenAI's model list, lifted at this third user (ruling 9; choice 4). None
 * listed answers `no_realtime_model`, worded by the old validation's
 * "Realtime model is not available". It proves the key lists the model, not
 * that its account may open a Live session (parity). It reads no setting
 * (`checkReads: []`). The settings side: not reached by the adapter.
 */
import { createOpenAIModelCheck, type OpenAIModelCheckDeps } from '../../lib/provider/openaiModels';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import { isLiveModelId, type LiveCredentials, type LiveSettings } from './settings';

export function createLiveCheck(deps: OpenAIModelCheckDeps = {}) {
  const check = createOpenAIModelCheck({ keep: isLiveModelId, none: { code: 'no_realtime_model', reason: 'This key lists no gpt-live model.' } }, deps);
  return (k: LiveCredentials, _s: LiveSettings, ctx: CheckContext): Promise<CheckResult> => check(k.apiKey, ctx);
}

export const checkLive = createLiveCheck();
```

- [ ] **Step 5: Run them.**

Run: `npx vitest run src/providers/openai_live/wire.test.ts src/providers/openai_live/check.test.ts`
Expected: PASS — 2 files, 7 tests.

- [ ] **Step 6: The gates.** The suite and the typecheck gate (in Wave 2, a failure in Task 8's files is Task 8's).

- [ ] **Step 7: Commit.**

```bash
git add src/providers/openai_live/wire.ts src/providers/openai_live/wire.test.ts src/providers/openai_live/check.ts src/providers/openai_live/check.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_live/wire.ts src/providers/openai_live/wire.test.ts src/providers/openai_live/check.ts src/providers/openai_live/check.test.ts <<'EOF'
feat(openai-live): the wire and the model check

The Live endpoint dialed bare, its upgrade carrying a Bearer header and
no Origin; session.start as the old client sent it, delegation to the
client; appends, mute, unmute and close frames; the server events typed
by hand, since the SDK has none. The check lists the key's gpt-live
models through the shared model-list check.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 8: OpenAI Live's segments on the timeline, its recorded sessions, and their replays (Wave 2)

**Files:**
- Create: `scripts/dev/wire-probe/live-fixtures.mts`; generated by it: `src/providers/openai_live/recordings/timeline.json`, `src/providers/openai_live/recordings/release.json`, `src/providers/openai_live/recordings/mute.json`; `src/providers/openai_live/segments.ts`
- Modify: `src/lib/segmentation/recordings/replay.testing.ts` (the event type, `words`, `Stamps`, the target's two text methods, the result's `leg`)
- Test: `src/providers/openai_live/segments.test.ts`, `src/providers/openai_live/segments.replay.test.ts`

**Interfaces:**
- Consumes: Task 5's `cutSource`, `translationContinues`, `closeAll` and the module's `ContinuousSegments`, `CutSummary`, `SegmentSink`; `sentenceEnds`, `lastClauseEnd`, `LEADING_PUNCT_RE` (`src/lib/segmentation/sentenceEnd`); Task 6's `LiveConfig` (type); `Ref`, `TextRange`, `Clock`; the replay harness (`replay`, `Recording`, `RecordedEvent`); `REPO` (`scripts/dev/wire-probe/common.mts`).
- Produces:
  - `segments.ts` (the source cut at a timeline pause of `silence.sourceMs`, ruling 10 — no gap or span constant): `SOURCE_CLAUSE_MS` (8 000), `SOURCE_CAP_MS` (12 000), `FLOOR_RMS` (0.002), `computeRms(pcm): number`, `LiveSegmentsOptions { clock; silence; sentencesPerSegment; sink; cut? }`, `class LiveSegments { input(delta, startMs, endMs); output(delta, startMs, endMs); audio(pcm, { voiced, play }); connectionLost(); stop() }`;
  - `replay.testing.ts`: `RecordedEvent` gains the stamps (`[arrival, 's' | 't', delta, start?, end?]`), `Recording.words?`, `Stamps { startMs; endMs }`, `ReplayTarget.input(delta, stamps)` / `.output(delta, stamps)`, `ReplayResult.leg` (the leg L1 holds at the end).

**The recordings** (choice 18): the generator reads the owner's probe logs in the worktree's git-ignored `.superpowers/wire-probes/openai-live/` and writes three small committed fixtures — no pcm, no key. It opens no socket.

- [ ] **Step 1: Write the generator.** Create `scripts/dev/wire-probe/live-fixtures.mts`:

```ts
/**
 * The recorded OpenAI Live sessions the port's tests replay (`live.mts`,
 * run by the owner on 2026-09-30), written as small fixtures. Each keeps
 * what a leg's segments see, in the order and at the time it arrived: each
 * transcript delta's text with its `start_ms` / `end_ms`, and every output
 * audio frame's length and RMS — the noise floor's frames too, since they
 * count on the output's sample clock the karaoke reads. The `timeline`
 * session also keeps whisper-1's word times for its voiced output, placed on
 * that sample clock as the probe placed them (U4). No pcm, no key: the
 * recordings hold neither, and the rest is not read.
 *
 *   npx tsx scripts/dev/wire-probe/live-fixtures.mts
 *
 * Reads `live.mts`' `.jsonl` recordings under
 * `.superpowers/wire-probes/openai-live/` (git-ignored) and writes
 * `src/providers/openai_live/recordings/<name>.json`. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './common.mts';

const PROBES = path.join(REPO, '.superpowers/wire-probes/openai-live');
const TO = path.join(REPO, 'src/providers/openai_live/recordings');
/** `live.mts`' floor: a frame at or below it is the stream's dithered silence. */
const FLOOR_RMS = 0.002;
const RATE = 24_000;

type Line = { t: number; dir: string; type: string; d?: Record<string, unknown> };
const stamp = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `[arrival, 's' | 't', delta, start_ms, end_ms]`, or `[arrival, 'a', samples, rms]`. */
function read(l: Line): unknown[] | null {
  const d = l.d ?? {};
  if (l.type === 'session.input_transcript.delta' && typeof d.delta === 'string' && d.delta) return [l.t, 's', d.delta, stamp(d.start_ms), stamp(d.end_ms)];
  if (l.type === 'session.output_transcript.delta' && typeof d.delta === 'string' && d.delta) return [l.t, 't', d.delta, stamp(d.start_ms), stamp(d.end_ms)];
  if (l.type === 'session.output_audio.delta' && typeof d.samples === 'number' && d.samples > 0) return [l.t, 'a', d.samples, typeof d.rms === 'number' ? d.rms : 0];
  return null;
}

/** whisper-1's words on the played (voiced-only) stream, placed on the full stream's sample clock in ms, as `live.mts`' `karaoke()` placed them. */
function placeWords(lines: Line[], file: string): Array<[number, number, string]> {
  const words = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ word: string; start: number; end: number }>;
  const played: Array<{ off: number; samples: number; at: number }> = [];
  let off = 0;
  let at = 0;
  for (const l of lines) {
    if (l.dir !== 'in' || l.type !== 'session.output_audio.delta') continue;
    const samples = Number(l.d?.samples ?? 0);
    if (Number(l.d?.rms ?? 0) > FLOOR_RMS) { played.push({ off, samples, at }); at += samples; }
    off += samples;
  }
  const locate = (secs: number, edge: 'start' | 'end'): number | null => {
    const smp = secs * RATE - (edge === 'end' ? 1 : 0);
    const p = played.find((x) => smp >= x.at && smp < x.at + x.samples);
    return p ? Math.round((p.off + (smp - p.at) + (edge === 'end' ? 1 : 0)) / (RATE / 1000)) : null;
  };
  return words.flatMap((w) => {
    const s = locate(w.start, 'start');
    const e = locate(Math.max(w.start, w.end), 'end');
    return s !== null && e !== null ? [[s, e, w.word] as [number, number, string]] : [];
  });
}

const FIXTURES: Array<[name: string, run: string, words?: string]> = [
  // U4, U5: 1 s with no appends, the owner's six sentences with his pauses, 15 s of silence.
  ['timeline', '2026-09-29T18-32-45-timeline-client', '2026-09-29T18-32-45-timeline-client.words.json'],
  // U1: the same clip, then 20 s with no appends, then 10 s of paced silence.
  ['release', '2026-09-29T18-32-45-release'],
  // U2': three sentences, mute and nothing appended for 20 s, unmute, one sentence, 10 s of silence — the push-to-talk release (ruling 5).
  ['mute', '2026-09-29T18-41-24-mute-noappend'],
];

fs.mkdirSync(TO, { recursive: true });
for (const [name, run, words] of FIXTURES) {
  const lines = fs.readFileSync(path.join(PROBES, `${run}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Line);
  const events = lines.filter((l) => l.dir === 'in').map(read).filter((e) => e !== null).map((e) => JSON.stringify(e));
  const placed = words ? placeWords(lines, path.join(PROBES, words)).map((w) => JSON.stringify(w)) : null;
  const file = path.join(TO, `${name}.json`);
  const wordsPart = placed ? `,\n  "words": [\n    ${placed.join(',\n    ')}\n  ]` : '';
  fs.writeFileSync(file, `{\n  "run": ${JSON.stringify(run)},\n  "events": [\n    ${events.join(',\n    ')}\n  ]${wordsPart}\n}\n`);
  console.log(`${path.relative(REPO, file)}: ${events.length} events${placed ? `, ${placed.length} words` : ''}`);
}
```

- [ ] **Step 2: Generate the recordings, and check them.**

Run: `npx tsx scripts/dev/wire-probe/live-fixtures.mts`
Expected: three lines — `src/providers/openai_live/recordings/timeline.json: 819 events, 121 words`, `src/providers/openai_live/recordings/release.json: 801 events`, `src/providers/openai_live/recordings/mute.json: 502 events`.

Run: `sha256sum src/providers/openai_live/recordings/timeline.json src/providers/openai_live/recordings/release.json src/providers/openai_live/recordings/mute.json`
Expected (the files are 28 452, 24 639 and 14 922 bytes):

```
c8ca25295ef8e96c82188dd0f64c294c68142bfb4415b3fb416ad0085faa32d3  src/providers/openai_live/recordings/timeline.json
3d658cd5c2c6f3848c49864e8a1cfca2cae4563c018871ae8f2e0a0e1b228ae8  src/providers/openai_live/recordings/release.json
aa95a3feed20a1615e52e350087a1654e01a376488199d2830a467f78994f340  src/providers/openai_live/recordings/mute.json
```

A different sum means the probe logs differ from the owner's: stop and report it.

Run: `command grep -c 'sk-' src/providers/openai_live/recordings/timeline.json src/providers/openai_live/recordings/release.json src/providers/openai_live/recordings/mute.json`
Expected: each `0`.

- [ ] **Step 3: Carry the stamps through the replay harness.** Its current users — the translation cuts replays, OpenAI Translate's and Gemini's — pass targets whose `input` / `output` read the delta alone, and read nothing of the new `leg`: they run unchanged (step 7).

```diff
diff --git a/src/lib/segmentation/recordings/replay.testing.ts b/src/lib/segmentation/recordings/replay.testing.ts
--- a/src/lib/segmentation/recordings/replay.testing.ts
+++ b/src/lib/segmentation/recordings/replay.testing.ts
@@ -15,6 +15,7 @@
 import { createVirtualClock, type VirtualClock } from '../../contract/clock';
 import { eventsFrom } from '../../contract/events';
 import { Conversation } from '../../conversation/Conversation';
+import type { Leg } from '../../conversation/types';
 import { createProjector, DEFAULT_PROJECTION } from '../../projection/project';
 import type { Pairing } from '../../projection/types';
 import geminiLiveTranslate from './gemini-live-translate.json';
@@ -23,23 +24,30 @@
 import user from './user.json';
 
 /**
- * `[arrival ms, 's' | 't', delta]` — a source or translation transcript
- * delta — or `[arrival ms, 'a', samples, rms?]`, an output audio frame
- * (heartbeats left out; no RMS where the probe measured none).
+ * `[arrival ms, 's' | 't', delta, start ms?, end ms?]` — a source or
+ * translation transcript delta, with its stamps where the provider sends
+ * them (OpenAI Live's `start_ms` / `end_ms`) — or `[arrival ms, 'a',
+ * samples, rms?]`, an output audio frame (heartbeats left out; no RMS where
+ * the probe measured none).
  */
-export type RecordedEvent = [number, 's' | 't', string] | [number, 'a', number, number?];
+export type RecordedEvent = [number, 's' | 't', string, (number | null)?, (number | null)?] | [number, 'a', number, number?];
 
 export interface Recording {
   run: string;
   events: RecordedEvent[];
+  /** whisper-1's words for the voiced output, `[start ms, end ms, word]` on the output's sample clock, where the probe measured them (OpenAI Live's U4). */
+  words?: Array<[number, number, string]>;
 }
 
+/** A transcript delta's stamps: null where the recording has none. */
+export interface Stamps { startMs: number | null; endMs: number | null }
+
 export const RECORDINGS = { user, tight, long, geminiLiveTranslate } as unknown as Readonly<Record<'user' | 'tight' | 'long' | 'geminiLiveTranslate', Recording>>;
 
 /** What a leg is fed: each side's transcript, and the translation's audio. */
 export interface ReplayTarget {
-  input(delta: string): void;
-  output(delta: string): void;
+  input(delta: string, stamps: Stamps): void;
+  output(delta: string, stamps: Stamps): void;
   audio(pcm: Int16Array): void;
 }
 
@@ -54,6 +62,8 @@
   pairings: Pairing[];
   /** Each exchange, in order: its source text and its translation text, trimmed. */
   exchanges: Array<[string, string]>;
+  /** The leg as L1 holds it at the end: its segments, their speech and its ranges. */
+  leg: Leg;
 }
 
 /** The level a frame with no measured RMS is filled at: speech, 0.03. */
@@ -82,8 +92,8 @@
   for (const e of recording.events) {
     clock.advance(e[0] - clock.now());
     if (e[1] === 'a') leg.audio(frameAt(e[2], e[3]));
-    else if (e[1] === 's') leg.input(e[2]);
-    else leg.output(e[2]);
+    else if (e[1] === 's') leg.input(e[2], { startMs: e[3] ?? null, endMs: e[4] ?? null });
+    else leg.output(e[2], { startMs: e[3] ?? null, endMs: e[4] ?? null });
   }
   clock.advance(30_000);
   const snapshot = conversation.snapshot();
@@ -97,5 +107,6 @@
     orphans: withTranslation.filter((e) => e.source.length === 0).length,
     pairings: withTranslation.map((e) => e.pairing),
     exchanges: exchanges.map((e) => [text(e.source), text(e.translation)]),
+    leg: snapshot,
   };
 }
```

- [ ] **Step 4: Write the failing tests.** Create `src/providers/openai_live/segments.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { CutSummary } from '../../lib/segmentation/continuousSegments';
import type { LiveConfig } from './config';
import { computeRms, FLOOR_RMS, LiveSegments, SOURCE_CAP_MS, SOURCE_CLAUSE_MS } from './segments';

const PAUSE: LiveConfig['silence'] = { sourceMs: 1500, translationMs: 1500, deferMidSentence: false };

function live(o: { silence?: LiveConfig['silence']; n?: number } = {}) {
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const cuts: CutSummary[] = [];
  const s = new LiveSegments({ clock, silence: o.silence ?? PAUSE, sentencesPerSegment: o.n ?? 1, sink: events, cut: (c) => cuts.push(c) });
  const of = <K extends AdapterEvent['kind']>(k: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === k);
  /** Each segment's last text, by ref. */
  const texts = () => {
    const out = new Map<number, string>();
    for (const e of of('segmentText')) out.set(e.payload.ref, e.payload.text);
    return [...out.entries()];
  };
  const closed = () => of('segmentClosed').map((e) => e.payload.ref);
  const audio = () => of('audio').map((e) => [e.payload.ref, e.payload.range ?? null]);
  const at = (ms: number) => clock.advance(ms - clock.now());
  return { s, clock, timers, log, cuts, of, texts, closed, audio, at };
}
/** 100 ms of speech, and of the floor, as the stream sends them. */
const VOICED = { voiced: true, play: true };
const FLOOR = { voiced: false, play: true };
const frame = (ms = 100) => new Int16Array(ms * 24).fill(900);

describe("OpenAI Live's source cuts: a pause of the source pause on the timeline (ruling 10; choice 6)", () => {
  it(`keeps the old client's caps: a clause at ${SOURCE_CLAUSE_MS} ms, anywhere at ${SOURCE_CAP_MS} ms`, () => {
    expect([SOURCE_CLAUSE_MS, SOURCE_CAP_MS]).toEqual([8_000, 12_000]);
  });

  it("drops a delta's leading marks when no source is open — their sentence is closed — and starts a source at its first word", () => {
    const h = live();
    h.s.input(', 你好', 0, 200);
    h.s.input(' Next', 200, 400);
    expect(h.texts()).toEqual([[1, '你好 Next']]);
  });

  it('a gap on the timeline of the source pause or more ends the open source, whatever it holds: its leading mark goes with the text before it, the rest opens the next', () => {
    const h = live();
    h.s.input('你好', 0, 400);
    h.s.input(',老板', 400 + 1_500, 2_100);
    expect(h.texts()).toEqual([[1, '你好,'], [2, '老板']]);
    expect(h.closed()).toEqual([1]);
  });

  it("a shorter gap ends nothing — a comma's pause stays in its row — and the pause is the user's setting", () => {
    const h = live();
    h.s.input('今天我吃了一家不错的牛肉面', 0, 3_800);
    h.s.input(',老板', 3_800 + 1_499, 5_500);
    expect(h.closed()).toEqual([]);
    expect(h.texts()).toEqual([[1, '今天我吃了一家不错的牛肉面,老板']]);
    const short = live({ silence: { ...PAUSE, sourceMs: 800 } });
    short.s.input('你好', 0, 400);
    short.s.input('再见', 400 + 800, 1_400);
    expect(short.texts()).toEqual([[1, '你好'], [2, '再见']]);
  });

  it('by pause, a source is cut after each sentence end inside a delta, its abbreviations read on the whole source', () => {
    const h = live();
    h.s.input('I met Dr', 0, 200);
    h.s.input('. Smith today. He', 200, 400);
    h.s.input(' said hi.', 400, 600);
    expect(h.texts()).toEqual([[1, 'I met Dr. Smith today.'], [2, 'He said hi.']]);
    expect(h.closed()).toEqual([1, 2]);
  });

  it('by sentence, every N-th end cuts — N the display setting (ruling 4) — and several in one delta are cut in turn', () => {
    const h = live({ n: 2 });
    h.s.input('一。二。三。', 0, 600);
    h.s.input('四。五', 600, 800);
    expect(h.texts()).toEqual([[1, '一。二。'], [2, '三。四。'], [3, '五']]);
    const none = live({ n: 0 });
    none.s.input('一。二。三。', 0, 600);
    expect(none.closed()).toEqual([]);
  });

  it(`with no sentence end, a source past ${SOURCE_CLAUSE_MS / 1000} s is cut at its last clause mark, and at ${SOURCE_CAP_MS / 1000} s anywhere — by sentence too`, () => {
    for (const n of [1, 3]) {
      const h = live({ n });
      h.s.input('第一句话', 0, 4_000);
      h.s.input('还在说,还没', 4_000, 8_000);
      expect(h.texts()).toEqual([[1, '第一句话还在说,'], [2, '还没']]);
      h.s.input('停下来的意思', 8_200, 20_000);
      expect(h.closed()).toEqual([1, 2]);
    }
  });

  it('by arrival, a source closes at its pause whatever it holds, a delta arriving in between restarting it — no short source is held a pause more', () => {
    const h = live();
    h.s.input('你好', 0, 400);
    h.at(1_500);
    expect(h.closed()).toEqual([1]);
    const g = live();
    g.s.input('你好', 0, 400);
    g.at(1_000);
    g.s.input('吗', 400, 600);
    g.at(2_499);
    expect(g.closed()).toEqual([]);
    g.at(2_500);
    expect(g.closed()).toEqual([1]);
  });

  it("by sentence, the module's deferral keeps a source open mid-sentence while it grows", () => {
    const h = live({ silence: { ...PAUSE, deferMidSentence: true }, n: 3 });
    h.s.input('今天我吃了一家不错的牛肉面', 0, 4_000);
    h.at(1_500);
    expect(h.closed()).toEqual([]);
    h.at(3_000);
    expect(h.closed()).toEqual([1]);
  });
});

describe("OpenAI Live's translation (ruling 3; choice 8)", () => {
  it("follows the source's cut, stating it; a delta's leading marks end the open translation before the cut is taken", () => {
    const h = live();
    h.s.input('你好。', 0, 200);
    h.at(100);
    h.s.output('Hello there', 0, 400);
    h.at(200);
    // A source that closed at its sentence end owes the translation one sentence.
    h.s.input('再见', 400, 600);
    h.at(300);
    h.s.output('.', 400, 600);
    h.s.output(' Bye', 600, 800);
    expect(h.texts()).toEqual([[1, '你好。'], [2, 'Hello there.'], [3, '再见'], [4, ' Bye']]);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([
      { ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' }, { ref: 3, side: 'source', origin: 's3' }, { ref: 4, side: 'translation', origin: 's3' },
    ]);
  });

  it('drops leading marks with no translation open', () => {
    const h = live();
    h.s.output('. Hello', 0, 200);
    expect(h.texts()).toEqual([[1, 'Hello']]);
  });

  it('restores the space the stream drops where its timeline paused between two words — never inside a word, never in a script written without spaces', () => {
    const h = live();
    h.s.output('Not Japanese.', 0, 400);
    h.s.output('The decor', 1_000, 1_200);
    h.s.output(' to me', 1_200, 1_400);
    h.s.output('altime', 1_400, 1_600);
    h.s.output(' walls are', 1_600, 1_800);
    h.s.output('really', 2_600, 2_800);
    expect(h.texts()[0][1]).toBe('Not Japanese. The decor to mealtime walls are really');
    const zh = live();
    zh.s.output('今天天气很好。', 0, 400);
    zh.s.output('我们', 1_000, 1_200);
    expect(zh.texts()[0][1]).toBe('今天天气很好。我们');
  });
});

describe("OpenAI Live's karaoke on the output's sample clock (ruling 2; choices 9, 10)", () => {
  it("sets the floor at RMS 0.002, which Live's dithered silence stays under and its speech passes", () => {
    expect(FLOOR_RMS).toBe(0.002);
    expect(computeRms(new Int16Array(2_400).fill(20))).toBeLessThan(FLOOR_RMS);
    expect(computeRms(frame())).toBeGreaterThan(FLOOR_RMS);
    expect(computeRms(new Int16Array(0))).toBe(0);
  });

  it('every frame advances the clock, the floor too; a voiced one plays the characters its window covers, interpolated in a delta, held through a gap', () => {
    const h = live();
    h.s.output('Hello', 0, 200);
    h.s.output(' world', 400, 600);
    // [0, 100) is the floor: counted, not played.
    h.s.audio(frame(), FLOOR);
    for (let i = 0; i < 6; i++) h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[1, [3, 5]], [1, [5, 5]], [1, [5, 5]], [1, [5, 8]], [1, [8, 11]], [1, [11, 11]]]);
  });

  it('a frame goes to the segment whose stamps lie nearest it: before a new segment\'s first delta, its own; after a closed one\'s last, that one, without holding the open one', () => {
    const h = live();
    h.s.input('你好。', 0, 200);
    h.at(100);
    h.s.output('Hi.', 0, 200);
    h.s.input('再见', 200, 400);
    h.s.output(' Bye', 1_000, 1_200);
    expect(h.closed()).toContain(2);
    // [200, 300): nearest "Hi." — the closed segment's last words; [900, 1000): nearest " Bye".
    h.s.audio(frame(200), FLOOR);
    h.s.audio(frame(), VOICED);
    h.s.audio(frame(600), FLOOR);
    h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[2, [3, 3]], [4, [0, 0]]]);
  });

  it("a closed segment's last words play on it and open nothing: the stream's audio trails its text", () => {
    const h = live();
    h.s.input('你好。', 0, 200);
    h.at(100);
    h.s.output('Hi.', 0, 200);
    h.at(1_600);
    expect(h.closed()).toEqual([1, 2]);
    h.s.audio(frame(200), FLOOR);
    h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[2, [3, 3]]]);
    expect(h.of('segmentOpened')).toHaveLength(2);
  });

  it("a segment's ranges ascend and never overlap, and none splits a surrogate pair", () => {
    const h = live();
    h.s.output('😀😀😀', 0, 300);
    for (let i = 0; i < 3; i++) h.s.audio(frame(), VOICED);
    const ranges = h.audio().map((a) => a[1] as [number, number]);
    expect(ranges).toEqual([[0, 2], [2, 4], [4, 6]]);
  });

  it('a leg that does not speak plays nothing, yet its voiced audio opens the translation and holds it', () => {
    const h = live();
    h.s.audio(frame(), { voiced: true, play: false });
    expect(h.audio()).toEqual([]);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'translation' }]);
    h.at(1_400);
    h.s.audio(frame(), { voiced: true, play: false });
    h.at(2_800);
    expect(h.closed()).toEqual([]);
    h.at(20_000);
    expect(h.closed()).toEqual([1]);
  });

  it('audio before any text opens a translation and plays rangeless on it: which characters it speaks is not yet known', () => {
    const h = live();
    h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[1, null]]);
  });
});

describe("OpenAI Live's segments: a lost connection and stop", () => {
  it('a lost connection closes both sides as they stand and starts the timelines again; the refs count on', () => {
    const h = live();
    h.s.input('你好', 0, 200);
    h.s.output('Hi', 0, 200);
    h.s.audio(frame(), VOICED);
    h.s.connectionLost();
    expect(h.closed()).toEqual([1, 2]);
    expect(h.cuts.map((c) => c.reason)).toEqual(['lost']);
    expect(h.timers()).toBe(0);
    // The new session's stamps start at 0 again, and so does its sample clock.
    h.s.output('Again', 0, 200);
    h.s.audio(frame(), VOICED);
    expect(h.audio()).toEqual([[2, [0, 1]], [3, [0, 3]]]);
  });

  it('stop leaves no timer and says nothing after', () => {
    const h = live();
    h.s.input('你好', 0, 200);
    h.s.output('Hi', 0, 200);
    h.s.stop();
    const n = h.log.length;
    h.s.input('再见', 200, 400);
    h.s.output(' there', 200, 400);
    h.s.audio(frame(), VOICED);
    h.clock.advance(60_000);
    expect(h.log.length).toBe(n);
    expect(h.timers()).toBe(0);
  });
});
```

Create `src/providers/openai_live/segments.replay.test.ts` — the pairing on the three recordings, by pause and by sentence, every pair's two ends pinned as they come (rulings 3, 10; research note 7); U4's karaoke through L1 (research note 3); and the karaoke across the mute run's gap:

```ts
import { describe, it, expect } from 'vitest';
import type { AdapterEvents } from '../../lib/contract/adapter';
import { replay, type Recording, type RecordedEvent } from '../../lib/segmentation/recordings/replay.testing';
import type { LiveConfig } from './config';
import mute from './recordings/mute.json';
import release from './recordings/release.json';
import timeline from './recordings/timeline.json';
import { computeRms, FLOOR_RMS, LiveSegments } from './segments';

const RECORDED = { timeline, release, mute } as unknown as Readonly<Record<'timeline' | 'release' | 'mute', Recording>>;
const BY_PAUSE: [LiveConfig['silence'], number] = [{ sourceMs: 1500, translationMs: 1500, deferMidSentence: false }, 1];
const BY_SENTENCE: [LiveConfig['silence'], number] = [{ sourceMs: 1500, translationMs: 1500, deferMidSentence: true }, 3];

/** One emitted `audio` event: its segment, its range, its window on the output's sample clock (ms), and when it arrived. */
interface Played { ref: number; range?: [number, number]; t0: number; t1: number; at: number }

/** Plays a recorded session into OpenAI Live's real segments, and through L1 and L2, recording where each played frame sat on the sample clock. */
function replayLive(recording: Recording, [silence, n]: [LiveConfig['silence'], number]) {
  const played: Played[] = [];
  let samples = 0;
  let window = { t0: 0, t1: 0 };
  const result = replay(recording, (clock, events) => {
    const sink: AdapterEvents = { ...events, audio: (e) => { played.push({ ref: e.ref as number, range: e.range, ...window, at: clock.now() }); events.audio(e); } };
    const s = new LiveSegments({ clock, silence, sentencesPerSegment: n, sink });
    return {
      input: (d, st) => s.input(d, st.startMs, st.endMs),
      output: (d, st) => s.output(d, st.startMs, st.endMs),
      audio: (pcm) => {
        window = { t0: samples / 24, t1: (samples + pcm.length) / 24 };
        samples += pcm.length;
        s.audio(pcm, { voiced: computeRms(pcm) > FLOOR_RMS, play: true });
      },
    };
  });
  return { ...result, played };
}

/** Each exchange as its two ends: its source's first four characters, its translation's first two words and last word. */
const ends = (exchanges: Array<[string, string]>) => exchanges.map(([source, translation]) => {
  const words = translation.split(' ');
  return [source.slice(0, 4), words.slice(0, 2).join(' '), words[words.length - 1]];
});

/** The pairs each recording makes, by pause and by sentence, three to a row: every source stated, none alone, none without its translation. */
const PAIRS: Array<[string, 'timeline' | 'release' | 'mute', [LiveConfig['silence'], number], string[][]]> = [
  ['timeline, by pause', 'timeline', BY_PAUSE, [
    ['今天我吃', 'Today I', 'Japanese.'], ['店里的装', 'The decor', 'randomly.'], ['下午快接', 'You can', 'alone.'], ['排骨有点', 'The spare', 'soup.'], ['店里的贩', 'Surprisingly, the', 'bills.'],
  ]],
  ['timeline, by sentence', 'timeline', BY_SENTENCE, [
    ['今天我吃', 'Today I', 'Japanese.'], ['店里的装', 'The decor', 'put'], ['下午快接', 'thought into', 'alone.'], ['排骨有点', 'The spare', 'soup.'], ['店里的贩', 'Surprisingly, the', 'bills.'],
  ]],
  ['release, by pause', 'release', BY_PAUSE, [
    ['今天我吃', 'Today I', 'noodles.'], ['店里的装', 'The owner', 'like'], ['下午快接', 'they put', 'everything.'], ['排骨有点', 'The ribs', 'soup.'], ['店里的贩', 'The vending', 'bills.'],
  ]],
  ['release, by sentence', 'release', BY_SENTENCE, [
    ['今天我吃', 'Today I', 'Sichuan.'], ['店里的装', 'Anyway, definitely', 'it.'], ['下午快接', 'In the', 'everything.'], ['排骨有点', 'The ribs', 'soup.'], ['店里的贩', 'The vending', 'bills.'],
  ]],
  ['mute, by pause', 'mute', BY_PAUSE, [
    ['今天我吃', 'Today I', 'owner'], ['店里的装', 'seemed like', 'thoughtful.'], ['天气有点', 'The weather', 'nice.'],
  ]],
  ['mute, by sentence', 'mute', BY_SENTENCE, [
    ['今天我吃', 'Today I', 'Sichuan,'], ['店里的装', 'Anyway, definitely', 'thoughtful.'], ['天气有点', 'The weather', 'nice.'],
  ]],
];

describe("OpenAI Live's segments on the owner's recorded sessions (rulings 3, 10; choice 18)", () => {
  it.each(PAIRS)(
    '%s: a row ends only at a pause of the source pause, so no comma\'s pause leaves a row without its translation; a translation longer than its row\'s sentence count runs over into the next row, and may be cut mid-sentence there',
    (_name, recording, settings, expected) => {
      const r = replayLive(RECORDED[recording], settings);
      expect({ sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ sources: expected.length, paired: expected.length, orphans: 0 });
      expect(r.pairings).toEqual(new Array(expected.length).fill('stated'));
      expect(r.exchanges.filter(([, translation]) => translation === '')).toEqual([]);
      expect(ends(r.exchanges)).toEqual(expected);
    },
  );
});

/** Words, lower-cased, with where each starts and ends in its text (the probe's `norm`, for an English translation). */
function words(text: string): Array<{ w: string; at: number; end: number }> {
  const out: Array<{ w: string; at: number; end: number }> = [];
  for (const m of text.matchAll(/[\p{L}\p{N}']+/gu)) {
    const at = m.index ?? 0;
    const w = m[0].toLowerCase().replace(/^'+|'+$/g, '');
    if (w) out.push({ w, at, end: at + m[0].length });
  }
  return out;
}

/** The longest common subsequence of two word lists, as index pairs (the probe's `lcs`). */
function lcs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const W = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * W);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++; else j++;
  }
  return out;
}

const quantile = (xs: readonly number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};

describe("OpenAI Live's karaoke on the timeline session, through L1 (ruling 2; choice 9)", () => {
  const r = replayLive(RECORDED.timeline, BY_PAUSE);
  const translations = r.leg.segments.filter((s) => s.side === 'translation');
  const byRef = new Map<number, Played[]>();
  for (const p of r.played) byRef.set(p.ref, [...(byRef.get(p.ref) ?? []), p]);
  /** When the karaoke, sweeping each entry's range over its window, reaches position `c` of a segment, and when it passes it. */
  const reach = (ref: number, c: number) => {
    const p = byRef.get(ref)?.find((x) => x.range && x.range[1] > c);
    if (!p || !p.range) return null;
    const [a, b] = p.range;
    return b > a ? p.t0 + (Math.max(0, c - a) / (b - a)) * (p.t1 - p.t0) : p.t0;
  };
  const pass = (ref: number, c: number) => {
    const p = byRef.get(ref)?.find((x) => x.range && x.range[1] >= c && x.range[1] > x.range[0]);
    if (!p || !p.range) return null;
    const [a, b] = p.range;
    return p.t0 + (Math.min(b - a, Math.max(0, c - a)) / (b - a)) * (p.t1 - p.t0);
  };

  it("holds every range L1 was given, and lights every voiced frame's window it plays", () => {
    const entries = translations.flatMap((s) => s.speech.map((sp) => [s.ref, sp.range ?? null]));
    expect(entries).toEqual(r.played.map((p) => [p.ref, p.range ?? null]));
    expect(r.played).toHaveLength(315);
    expect(r.played.filter((p) => !p.range)).toEqual([]);
  });

  it("lights each output delta's words where whisper-1 hears them about as closely as the deltas' own stamps do — a median of 200 ms; a p90 of 803 ms against their 760, since ' it.', whose stamps fall on the stream's floor, is passed only by its row's next voiced frame, 2.5 s on", () => {
    const outs = RECORDED.timeline.events.filter((e): e is Extract<RecordedEvent, [number, 's' | 't', string, (number | null)?, (number | null)?]> => e[1] === 't');
    const heard = (RECORDED.timeline.words ?? []).flatMap(([start, end, word]) => words(word).map((w) => ({ w: w.w, start, end })));
    const shown = translations.flatMap((s) => words(s.text).map((w) => ({ ...w, ref: s.ref })));
    const sent = outs.flatMap((e, i) => words(e[2]).map((w) => ({ w: w.w, delta: i })));
    const shownOf = new Map(lcs(shown.map((x) => x.w), heard.map((x) => x.w)).map(([a, b]) => [b, a]));
    /** Per delta: whisper's first start and last end, the karaoke's reach and pass of the same words. */
    const perDelta = new Map<number, { heardStart: number; heardEnd: number; litStart: number | null; litEnd: number | null }>();
    for (const [c, b] of lcs(sent.map((x) => x.w), heard.map((x) => x.w))) {
      const a = shownOf.get(b);
      if (a === undefined) continue;
      const { delta } = sent[c];
      const lit = { litStart: reach(shown[a].ref, shown[a].at), litEnd: pass(shown[a].ref, shown[a].end) };
      const d = perDelta.get(delta);
      if (!d) perDelta.set(delta, { heardStart: heard[b].start, heardEnd: heard[b].end, ...lit });
      else { d.heardEnd = heard[b].end; d.litEnd = lit.litEnd; }
    }
    const karaoke: number[] = [];
    const stamps: number[] = [];
    for (const [i, d] of perDelta) {
      const [, , , startMs, endMs] = outs[i];
      if (d.litStart !== null && typeof startMs === 'number') { karaoke.push(Math.abs(d.litStart - d.heardStart)); stamps.push(Math.abs(startMs - d.heardStart)); }
      if (d.litEnd !== null && typeof endMs === 'number') { karaoke.push(Math.abs(d.litEnd - d.heardEnd)); stamps.push(Math.abs(endMs - d.heardEnd)); }
    }
    expect(karaoke).toHaveLength(198);
    expect({ median: Math.round(quantile(karaoke, 0.5)), p90: Math.round(quantile(karaoke, 0.9)) }).toEqual({ median: 200, p90: 803 });
    expect({ median: Math.round(quantile(stamps, 0.5)), p90: Math.round(quantile(stamps, 0.9)) }).toEqual({ median: 200, p90: 760 });
  });
});

describe("OpenAI Live's karaoke across the push-to-talk mute, through L1 (rulings 2, 5)", () => {
  it('lights every voiced frame of the mute session; after the unmute the stream picks up where it paused, then plays the sentence said after it, its ranges running on from its first character', () => {
    const r = replayLive(RECORDED.mute, BY_PAUSE);
    expect(r.played.filter((p) => !p.range)).toEqual([]);
    const rows = r.leg.segments.filter((s) => s.side === 'translation');
    const last = rows[rows.length - 1];
    expect(last.text.startsWith('The weather is a bit cold')).toBe(true);
    // The probe unmuted 44.3 s in (its log's `session.input_audio.unmute`). The output's sample clock waited with the stream:
    // its first frame after, 100 ms of the word the pending translation had reached, plays on that row.
    const [resumed, ...weather] = r.played.filter((p) => p.at > 44_328);
    expect(rows.find((s) => s.ref === resumed.ref)?.text).toBe(' It looks really thoughtful.');
    expect(resumed.range).toEqual([16, 22]);
    expect(new Set(weather.map((p) => p.ref))).toEqual(new Set([last.ref]));
    const ranges = weather.map((p) => p.range as [number, number]);
    expect(ranges[0][0]).toBe(0);
    ranges.forEach(([a, b], i) => {
      expect(b).toBeGreaterThanOrEqual(a);
      if (i > 0) expect(a).toBe(ranges[i - 1][1]);
    });
    expect(ranges[ranges.length - 1][1]).toBeGreaterThanOrEqual('The weather is a bit cold'.length);
  });
});
```

- [ ] **Step 5: Run them to see them fail.**

Run: `npx vitest run src/providers/openai_live/segments.test.ts src/providers/openai_live/segments.replay.test.ts`
Expected: FAIL — `Test Files 2 failed (2)`, no test runs: `Failed to resolve import "./segments"`.

- [ ] **Step 6: Write the segments.** Create `src/providers/openai_live/segments.ts`:

```ts
/**
 * OpenAI Live's deltas and audio → segments, on the request's clock
 * (rulings 2–4). `ContinuousSegments` holds both sides (ruling 3): the
 * translation is cut where the source was, and states that source as its
 * origin. What is Live's own sits around it:
 *
 * - **The source's cuts** are read off the input's `start_ms` / `end_ms` —
 *   the session's timeline (choice 6): a gap on it of at least the source
 *   pause ends the open source, whatever it holds (ruling 10), and a delta's
 *   leading marks belong to the text before them (dropped with none open); a
 *   source is cut inside a delta after every `sentencesPerSegment`-th
 *   sentence end (ruling 4; choice 7); past 8 s at its last clause mark and
 *   at 12 s anywhere, in every mode — the old client's caps. The module's own
 *   pause still closes a source by arrival, deferred mid-sentence in sentence
 *   mode.
 * - **The translation**: a delta's leading marks dropped with none open, and
 *   a space restored where the output's timeline paused between two words
 *   that the stream joined without one (choice 8).
 * - **The audio** (ruling 2; choices 9, 10): every output frame advances the
 *   output's sample clock — the noise floor's too — on which `start_ms` /
 *   `end_ms` stand: 0 at the session's first output frame, samples ÷ 24 ms. A
 *   voiced frame speaks the text whose stamps its window covers: the
 *   segment of the delta whose stamps lie nearest the frame's middle, and,
 *   within that segment, the characters from where its start falls to where
 *   its end falls — interpolated inside a delta, held at a delta's end
 *   through a gap. Real ranges, computed as the frame arrives (the text
 *   leads its audio, U4), never filled in later.
 *
 * Pure: every timer is the module's, on the clock it is handed.
 */
import type { Ref, TextRange } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import { ContinuousSegments, type CutSummary, type SegmentSink } from '../../lib/segmentation/continuousSegments';
import { lastClauseEnd, LEADING_PUNCT_RE, sentenceEnds } from '../../lib/segmentation/sentenceEnd';
import type { LiveConfig } from './config';

/** Past this span a source is cut at its last clause mark (`OpenAILiveClient.ts:69`)… */
export const SOURCE_CLAUSE_MS = 8_000;
/** …and at this one anywhere (`:70`), in every mode (ruling 4). */
export const SOURCE_CAP_MS = 12_000;
/**
 * At or below this RMS an output frame is the stream's dithered floor, not
 * speech (`OpenAILiveClient.ts:50-60`: the floor measured 1.3e-5 – 5.8e-4,
 * speech 0.03 – 0.08): it counts on the clock and nothing else. Not OpenAI
 * Translate's exact-zero heartbeat: Live's floor is never zero.
 */
export const FLOOR_RMS = 0.002;

/** RMS over [0, 1]: the floor test, and the Logs' audio frames. */
export function computeRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length) / 32768;
}

/** The output's sample clock: 24 samples a millisecond. */
const SAMPLES_PER_MS = 24;
/** A delta's stamps kept this long behind the audio: no frame arrives that late. */
const SPAN_KEEP_MS = 60_000;

/** A delta's leading marks — `LEADING_PUNCT_RE` without its whitespace: they end the text before them. */
const LEADING_MARKS_RE = /^[。．！？!?.,，、;；:：—–"'”’」』）)\]]+/;
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** What may end a word before a space: a letter, a digit, a Latin mark or a closer. */
const WORD_END = /[\p{L}\p{N}.,!?;:'"”’)\]]/u;
const WORD_START = /[\p{L}\p{N}]/u;
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Two words the stream joined with no space, across a pause on its timeline
 * ("Japanese." then "The decor", "are" then "really" — the probe's sessions),
 * need one: both sides written with spaces between words (choice 8).
 */
function needsSpace(before: string, after: string): boolean {
  return WORD_END.test(before) && WORD_START.test(after) && !SPACELESS.test(before) && !SPACELESS.test(after);
}

/** One translation delta on the output's timeline: its characters in its segment, `[c0, c1)`, and its stamps, `[s, e)` ms. */
interface Span { ref: Ref; s: number; e: number; c0: number; c1: number }

export interface LiveSegmentsOptions {
  clock: Pick<Clock, 'setTimeout' | 'now'>;
  silence: LiveConfig['silence'];
  sentencesPerSegment: number;
  sink: SegmentSink;
  /** Each translation cut, for the Logs (Stage 2 translation cuts, choice 14). */
  cut?: (summary: CutSummary) => void;
}

export class LiveSegments {
  private readonly core: ContinuousSegments;
  /** The open segments, as the module opened them. */
  private sourceRef: Ref | null = null;
  private translationRef: Ref | null = null;
  /** The open source's text, and the timeline's start of its first delta. */
  private sourceText = '';
  private sourceStartMs: number | null = null;
  /** The last input delta's `end_ms`, across sources: a pause is measured from it. */
  private lastEndMs: number | null = null;
  /** Each translation segment's text as sent, while its stamps are kept. */
  private readonly texts = new Map<Ref, string>();
  /** The translation's deltas on the output's timeline, in arrival order. */
  private spans: Span[] = [];
  /** Where each segment's last range ended: ranges ascend and never overlap. */
  private readonly spoken = new Map<Ref, number>();
  /** Output samples so far this connection: the frame's place on the timeline. */
  private samples = 0;
  /** The last translation character sent and its delta's `end_ms`: a join's space is read off them. */
  private lastOut: { char: string; endMs: number | null } | null = null;
  private lastTextRef: Ref | null = null;
  private stopped = false;

  constructor(private readonly o: LiveSegmentsOptions) {
    const sink: SegmentSink = {
      segmentOpened: (e) => {
        if (e.side === 'source') this.sourceRef = e.ref;
        else this.translationRef = e.ref;
        o.sink.segmentOpened(e);
      },
      segmentText: (e) => {
        if (e.ref === this.sourceRef) this.sourceText = e.text;
        else {
          this.texts.set(e.ref, e.text);
          this.lastTextRef = e.ref;
        }
        o.sink.segmentText(e);
      },
      segmentClosed: (e) => {
        if (e.ref === this.sourceRef) {
          this.sourceRef = null;
          this.sourceText = '';
          this.sourceStartMs = null;
        }
        if (e.ref === this.translationRef) this.translationRef = null;
        o.sink.segmentClosed(e);
      },
      // The module plays nothing: every frame is placed here, by the timeline.
      audio: () => {},
    };
    this.core = new ContinuousSegments({ clock: o.clock, silence: o.silence, sink, cut: o.cut });
  }

  /** A source transcript delta and its stamps on the session's timeline. */
  input(delta: string, startMs: number | null, endMs: number | null): void {
    if (this.stopped) return;
    const lead = LEADING_PUNCT_RE.exec(delta)?.[0] ?? '';
    let text = delta;
    if (this.sourceRef === null) {
      // Punctuation whose sentence is already closed has no home.
      text = delta.slice(lead.length);
    } else if (this.pauseEnds(startMs)) {
      // The speaker paused: the mark at the head of this delta belongs to the text before the pause.
      const mark = lead.trimEnd();
      if (mark) this.appendSource(mark, startMs);
      this.core.cutSource();
      text = delta.slice(lead.length);
    }
    this.takeSource(text, startMs, endMs);
    if (endMs !== null) this.lastEndMs = endMs;
  }

  /**
   * A translation transcript delta and its stamps on the output's sample
   * clock. With a translation open, its leading marks end that
   * translation's text before any cut due is taken, and a space is restored
   * where the timeline paused; with none open, they are dropped (choice 8).
   */
  output(delta: string, startMs: number | null, endMs: number | null): void {
    if (this.stopped) return;
    let text = delta;
    let marks = '';
    if (this.translationRef === null) text = delta.slice((LEADING_PUNCT_RE.exec(delta)?.[0] ?? '').length);
    else {
      marks = LEADING_MARKS_RE.exec(delta)?.[0] ?? '';
      text = delta.slice(marks.length);
      if (!marks && this.lastOut && startMs !== null && this.lastOut.endMs !== null && startMs > this.lastOut.endMs && needsSpace(this.lastOut.char, text[0] ?? '')) text = ` ${text}`;
    }
    const sent = marks + text;
    if (!sent) return;
    let marksRef: Ref | null = null;
    if (marks) {
      this.core.translationContinues(marks);
      marksRef = this.lastTextRef;
    }
    if (text) this.core.translationText(text);
    const ref = this.lastTextRef;
    const whole = ref === null ? undefined : this.texts.get(ref);
    if (ref !== null && whole !== undefined && startMs !== null && endMs !== null && endMs > startMs) {
      if (marksRef !== null && marksRef !== ref) {
        // A cut fell between the marks and the text: the marks end the earlier segment's last delta, the stamps go with the text.
        for (let i = this.spans.length - 1; i >= 0; i--) if (this.spans[i].ref === marksRef) { this.spans[i].c1 += marks.length; break; }
        this.spans.push({ ref, s: startMs, e: endMs, c0: whole.length - text.length, c1: whole.length });
      } else this.spans.push({ ref, s: startMs, e: endMs, c0: whole.length - sent.length, c1: whole.length });
      this.prune();
    }
    this.lastOut = { char: sent[sent.length - 1], endMs };
  }

  /**
   * An output audio frame, in arrival order. Every frame advances the
   * timeline; a voiced one is the translation's activity when it speaks the
   * open segment's text, or text not yet come, and plays on the segment its
   * window's text is in — a closed one's too, as that segment's last words
   * (choice 10). The noise floor's frames never play (parity).
   */
  audio(pcm: Int16Array, o: { voiced: boolean; play: boolean }): void {
    if (this.stopped) return;
    const t0 = this.samples / SAMPLES_PER_MS;
    this.samples += pcm.length;
    const t1 = this.samples / SAMPLES_PER_MS;
    if (!o.voiced || pcm.length === 0) return;
    let ref = this.refAt((t0 + t1) / 2);
    if (ref === null || ref === this.translationRef) {
      this.core.audio(pcm, { play: false, active: true });
      ref = ref ?? this.translationRef;
    }
    if (!o.play || ref === null) return;
    const range = this.rangeOf(ref, t0, t1);
    this.o.sink.audio(range ? { pcm, ref, range } : { pcm, ref });
  }

  /** The connection is gone: both sides close as they stand, and the next connection's timelines start again at 0. */
  connectionLost(): void {
    this.core.closeAll();
    this.reset();
  }

  /** No timer is left, and nothing is said after it: L1 finalizes what is open. */
  stop(): void {
    this.stopped = true;
    this.core.stop();
    this.reset();
  }

  private reset(): void {
    this.lastEndMs = null;
    this.texts.clear();
    this.spans = [];
    this.spoken.clear();
    this.samples = 0;
    this.lastOut = null;
    this.lastTextRef = null;
  }

  /**
   * A gap on the timeline before `startMs` of at least the source pause — the
   * user's setting, as OpenAI Translate's and Gemini Live Translate's sources
   * end — ends the open source, whatever it holds (ruling 10). Not the old
   * client's 600 ms gap with a 4 s span: it cut rows at a comma's pause.
   */
  private pauseEnds(startMs: number | null): boolean {
    if (startMs === null || this.lastEndMs === null) return false;
    return startMs - this.lastEndMs >= this.o.silence.sourceMs;
  }

  /** The text of one delta into the source, cut after every N-th sentence end, and past 8 s at a clause, at 12 s anywhere. */
  private takeSource(text: string, startMs: number | null, endMs: number | null): void {
    let rest = text;
    while (rest.length > 0) {
      const start = this.sourceStartMs ?? startMs;
      const span = start !== null && endMs !== null ? endMs - start : null;
      let split = this.sentenceCut(rest);
      if (split <= 0 && span !== null && span >= SOURCE_CLAUSE_MS) split = lastClauseEnd(rest);
      if (split <= 0) {
        this.appendSource(rest, startMs);
        if (span !== null && span >= SOURCE_CAP_MS) this.core.cutSource();
        return;
      }
      this.appendSource(rest.slice(0, split), startMs);
      this.core.cutSource();
      rest = rest.slice(split);
    }
  }

  /** Where in `text` the open source reaches its N-th sentence end, or -1 (ruling 4; choice 7). */
  private sentenceCut(text: string): number {
    const n = this.o.sentencesPerSegment;
    if (n <= 0) return -1;
    const prefix = this.sourceText;
    const ends = sentenceEnds(prefix + text);
    for (let j = n - 1; j < ends.length; j++) if (ends[j] > prefix.length) return ends[j] - prefix.length;
    return -1;
  }

  private appendSource(text: string, startMs: number | null): void {
    // A new source starts at its first word.
    const piece = this.sourceRef === null ? text.replace(/^\s+/, '') : text;
    if (!piece) return;
    if (this.sourceStartMs === null) this.sourceStartMs = startMs;
    this.core.sourceText(piece);
  }

  /** The segment whose text is spoken at `t`: that of the delta whose stamps lie nearest it, the later on a tie. */
  private refAt(t: number): Ref | null {
    let best: Span | null = null;
    let bestDistance = Infinity;
    for (let i = this.spans.length - 1; i >= 0; i--) {
      const sp = this.spans[i];
      const distance = t < sp.s ? sp.s - t : t >= sp.e ? t - sp.e : 0;
      if (distance < bestDistance) {
        best = sp;
        bestDistance = distance;
      }
      // Spans before this one end earlier still: none of them is nearer.
      if (sp.e <= t) break;
    }
    return best?.ref ?? null;
  }

  /** The characters of `ref` spoken over `[t0, t1)`, after the last range it had; none while it has no stamped text. */
  private rangeOf(ref: Ref, t0: number, t1: number): TextRange | undefined {
    const spans = this.spans.filter((sp) => sp.ref === ref);
    const text = this.texts.get(ref);
    if (spans.length === 0 || text === undefined) return undefined;
    const from = this.spoken.get(ref) ?? 0;
    const start = Math.max(from, snap(text, charAt(spans, t0)));
    const end = Math.max(start, snap(text, charAt(spans, t1)));
    this.spoken.set(ref, end);
    return [start, end];
  }

  /** Stamps the audio has passed long ago: no frame will read them. */
  private prune(): void {
    const behind = this.samples / SAMPLES_PER_MS - SPAN_KEEP_MS;
    if (this.spans.length === 0 || this.spans[0].e >= behind) return;
    this.spans = this.spans.filter((sp) => sp.e >= behind);
    const live = new Set(this.spans.map((sp) => sp.ref));
    for (const ref of [...this.texts.keys()]) {
      if (live.has(ref) || ref === this.translationRef) continue;
      this.texts.delete(ref);
      this.spoken.delete(ref);
    }
  }
}

/** Where the text stands at `t` on one segment's deltas: inside a delta, in proportion; in a gap, at the end of the delta before it. */
function charAt(spans: readonly Span[], t: number): number {
  if (t <= spans[0].s) return spans[0].c0;
  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i];
    if (t < sp.s) return spans[i - 1].c1;
    if (t < sp.e) return sp.c0 + Math.round(((sp.c1 - sp.c0) * (t - sp.s)) / (sp.e - sp.s));
  }
  return spans[spans.length - 1].c1;
}

/** A boundary inside a surrogate pair moves past it (as `tileSpan`'s). */
function snap(text: string, i: number): number {
  return i > 0 && i < text.length && isHigh(text.charCodeAt(i - 1)) && isLow(text.charCodeAt(i)) ? i + 1 : i;
}
```

- [ ] **Step 7: Run them, and the harness's other users.**

Run: `npx vitest run src/providers/openai_live/segments.test.ts src/providers/openai_live/segments.replay.test.ts`
Expected: PASS — 2 files, 30 tests.

Run: `npx vitest run src/lib/segmentation src/providers/openai_translate/segments.replay.test.ts src/providers/gemini`
Expected: PASS — 26 files, 560 tests, as after Task 5.

- [ ] **Step 8: The gates.** The suite and the typecheck gate (in Wave 2, a failure in Task 7's files is Task 7's); the full tree still at 259, none naming `src/lib/segmentation/`.

- [ ] **Step 9: Commit.**

```bash
git add scripts/dev/wire-probe/live-fixtures.mts src/providers/openai_live/recordings/timeline.json src/providers/openai_live/recordings/release.json src/providers/openai_live/recordings/mute.json src/lib/segmentation/recordings/replay.testing.ts src/providers/openai_live/segments.ts src/providers/openai_live/segments.test.ts src/providers/openai_live/segments.replay.test.ts
```

```bash
git commit -q -F - -- scripts/dev/wire-probe/live-fixtures.mts src/providers/openai_live/recordings/timeline.json src/providers/openai_live/recordings/release.json src/providers/openai_live/recordings/mute.json src/lib/segmentation/recordings/replay.testing.ts src/providers/openai_live/segments.ts src/providers/openai_live/segments.test.ts src/providers/openai_live/segments.replay.test.ts <<'EOF'
feat(openai-live): segments on the session's timelines, with recorded replays

OpenAI Live's deltas become segments over ContinuousSegments: the
source cut at a pause of the source pause on the session's timeline,
every N sentences by sentence, capped in every mode; the translation
cut where its source
was, stating it, its late marks and dropped spaces restored. Each voiced
audio frame is placed on the output's sample clock and plays the
characters its stamps cover. Three of the owner's recorded sessions,
generated as small fixtures, replay through L1 and L2: the pairing and
the karaoke are pinned as measured.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Wave 2 check (controller)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the replay: 587 files passed and 1 skipped, 7 631 tests passed and 2 skipped); the typecheck gate at exactly the baseline; the full tree at 259.

---

### Task 9: The OpenAI Live adapter (Wave 3)

**Files:**
- Create: `src/providers/openai_live/testing.ts` (test-only)
- Modify: `src/providers/openai_live/adapter.ts` (the seed, replaced), `src/providers/sessionSide.consistency.test.ts` (after Palabra's pin: Live's session side pinned)
- Test: `src/providers/openai_live/adapter.test.ts`

**Interfaces:**
- Consumes: Task 3's `HeaderSocketError`, `platformHeaderSocket`, `OpenHeaderSocket`, `fakeHeaderSockets`; Task 7's wire (`LIVE_WS_URL`, `liveHeaders`, `sessionStart`, `appendFrame`, `muteFrame`, `unmuteFrame`, `SESSION_CLOSE`, the event types, `stampOf`, `base64ToPcm`, `decodeServerEvent`, `errorCode`, `errorWords`); Task 8's `LiveSegments`, `computeRms`, `FLOOR_RMS`; Task 6's `LiveConfig`, `LiveCredentials`, `buildLive`, `LIVE_DEFAULTS`; the contract (`AdapterStartError`, `Adapter`, `AdapterEvents`, `AdapterSession`, `StartRequest`, `framePayload`, `WS_OPEN`), `describeCause`; the kit (`FakeSocket`, `runScenario`, `scenarioNames`, `AdapterHarness`, `runLifecycles`, `LifecycleHarness`, `trackedClock`, `flush`, `recordEvents`).
- Produces:
  - `adapter.ts`: `START_TIMEOUT_MS` (30 000), `NEVER_OPENED`, `RECONNECT_GRACE_MS` (60 000), `ERROR_WORDS_MS` (10 000), `CONNECTION_LOST`, `LiveAdapterDeps { openHeaderSocket: OpenHeaderSocket }`, `createLiveAdapter(deps?: Partial<LiveAdapterDeps>): Adapter<LiveConfig, LiveCredentials>` (the platform's seam by default);
  - `testing.ts`: `KEY`, `SHARED`, `AUTO_CTX`, `MANUAL_CTX`, `configFor(context?, patch?, shared?)`, `b64(samples, fill?)`, `SERVER` (`started`, `input`, `output`, `audio`, `floor`, `usage`, `closed`, `error`, `forbidden`, `muted`, `unmuted`, `bare`), `startLive(o?)`, `openLive(o?)`, `liveSession(o?)`.

- [ ] **Step 1: Write the fixtures** (test-only: only tests import them). Create `src/providers/openai_live/testing.ts`:

```ts
/**
 * The OpenAI Live suites' fixtures: a key, the settings the suites build
 * from, the server's events as the JSON text frames the endpoint sends (the
 * shapes the owner's probe recorded), and the harness that starts a leg over
 * the header seam's fake on a tracked virtual clock. Test-only: nothing but
 * a test imports it (the session-side guard's kit rule), and the adapter's
 * session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { flush } from '../../lib/contract/testing/drive';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { SharedSettings } from '../../lib/provider/types';
import { createLiveAdapter } from './adapter';
import { buildLive, type LiveConfig } from './config';
import { LIVE_DEFAULTS, type LiveCredentials, type LiveSettings } from './settings';
import { base64ToPcm } from './wire';

/** Shaped as a real key (`sk-…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: LiveCredentials = { apiKey: 'sk-proj-liveKey0123456789' };

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1.5, translationSeconds: 1.5 },
  reversed: (d) => d.source === 'en' && d.target === 'zh_CN',
  segmentation: { mode: 'pause', sentencesPerRow: 0 },
  models: [{ id: 'gpt-live-1' }],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'zh_CN', target: 'en' }, speech: true, turns: 'auto' };
export const MANUAL_CTX: SessionContext = { ...AUTO_CTX, turns: 'manual' };

/** A leg's config: the defaults, patched. A refusal is a fixture bug: it throws. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<LiveSettings> = {}, shared: SharedSettings = SHARED): LiveConfig {
  const c = buildLive(context, { ...LIVE_DEFAULTS, ...patch }, shared);
  if ('refused' in c) throw new Error(c.refused);
  return c;
}

/** `samples` of 24 kHz pcm16 as an audio delta carries it. `fill` 900 is speech (RMS 0.027); 20 is the floor (0.0006). */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const event = (e: Record<string, unknown>) => JSON.stringify({ event_id: 'event_1', ...e });

/** The server's events, by name, as the endpoint sends them (`.superpowers/wire-probes/openai-live/*.jsonl`). */
export const SERVER = {
  started: (id = 'live_1') => event({ type: 'session.started', client_event_id: 'start_1', session: { id, expires_at: 1_790_713_967, model: 'gpt-live-1', status: 'active' } }),
  input: (delta: string, startMs: number | null = 0, endMs: number | null = 200) => event({ type: 'session.input_transcript.delta', start_ms: startMs, end_ms: endMs, delta }),
  output: (delta: string, startMs: number | null = 0, endMs: number | null = 200) => event({ type: 'session.output_transcript.delta', start_ms: startMs, end_ms: endMs, delta }),
  /** 100 ms of output, the stream's frame: speech by default. */
  audio: (o: { samples?: number; fill?: number } = {}) => event({ type: 'session.output_audio.delta', delta: b64(o.samples ?? 2_400, o.fill ?? 900) }),
  /** 100 ms of the stream's dithered floor. */
  floor: (samples = 2_400) => event({ type: 'session.output_audio.delta', delta: b64(samples, 20) }),
  usage: (seconds: number) => event({ type: 'session.usage.updated', usage: { seconds } }),
  closed: (reason = 'close_requested', seconds = 0) => event({ type: 'session.closed', reason, session: { id: 'live_1' }, usage: { seconds } }),
  error: (e: { type?: string; code?: string | null; message?: string; param?: string | null } = {}) =>
    event({ type: 'error', error: { type: 'invalid_request_error', code: null, message: 'Something was wrong.', param: null, ...e } }),
  /** U10: an invalid voice at `session.start`. */
  forbidden: () => event({ type: 'error', error: { type: 'invalid_request_error', code: 'forbidden', message: 'Voice session access denied.' } }),
  muted: () => event({ type: 'session.input_audio.muted', client_event_id: 'mute_1' }),
  unmuted: () => event({ type: 'session.input_audio.unmuted', client_event_id: 'unmute_1' }),
  /** An event by its type alone. */
  bare: (type: string) => event({ type }),
};

/** An OpenAI Live leg started over the header seam's fake on a tracked virtual clock; its registration not yet answered, its socket not yet made. */
export function startLive(o: { context?: SessionContext; patch?: Partial<LiveSettings>; credentials?: LiveCredentials; shared?: SharedSettings } = {}) {
  const seam = fakeHeaderSockets();
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const controller = new AbortController();
  const context = o.context ?? AUTO_CTX;
  const config = configFor(context, o.patch, o.shared);
  const starting = createLiveAdapter({ openHeaderSocket: seam.open }).start({ context, config, credentials: o.credentials ?? KEY, clock, signal: controller.signal }, events);
  const socket = () => seam.sockets.last();
  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
  /** The payloads of the frames of one type, in order. */
  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
  /** What the client sent on the newest socket, parsed. */
  const sent = () => socket().sentJson<Record<string, unknown>>();
  /** The pcm of every append sent on the newest socket, in order. */
  const appended = () => sent().filter((m) => m.type === 'session.input_audio.append').map((m) => base64ToPcm(m.audio as string));
  /** The log without its frames: what L1 folds. */
  const content = () => log.filter((e) => e.kind !== 'frame');
  return { seam, clock, timers, log, controller, config, starting, socket, of, frames, sent, appended, content };
}

/** The registration answered and the socket open: `session.start` sent. */
export async function openLive(o?: Parameters<typeof startLive>[0]) {
  const h = startLive(o);
  await flush();
  h.socket().open();
  await flush();
  return h;
}

/** Started: the start resolved. */
export async function liveSession(o?: Parameters<typeof startLive>[0]) {
  const h = await openLive(o);
  h.socket().receive(SERVER.started());
  const session = await h.starting;
  return { ...h, session };
}
```

- [ ] **Step 2: Write the failing tests.** The kit's conformance scenarios (all but typed text: `textInput: false`), three hundred seeded lifecycles over the seam's fake — the header registered at each start and each reconnect, the socket dropped, silent, refused, closed or unanswered while opening — and a case for each rule. Create `src/providers/openai_live/adapter.test.ts`:

```ts
/**
 * OpenAI Live's adapter: the conformance suite and the seeded lifecycles,
 * the start over the header seam and its refusals in words, the audio going
 * up, push-to-talk, the messages to segments and frames, the watchdog, the
 * reconnect and the ends, stop. On the header seam's fake, `FakeSocket`s and
 * a virtual clock — no network, no fake timers.
 */
import { describe, it, expect } from 'vitest';
import { AdapterStartError } from '../../lib/contract/adapter';
import type { AdapterEvent } from '../../lib/contract/events';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { FakeSocket } from '../../lib/contract/testing/fakeSocket';
import { fakeHeaderSockets } from '../../lib/contract/testing/headerSocket';
import { runLifecycles, type LifecycleHarness } from '../../lib/contract/testing/lifecycle';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import { recordEvents } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import {
  CONNECTION_LOST, createLiveAdapter, ERROR_WORDS_MS, NEVER_OPENED, RECONNECT_GRACE_MS, STALL_VOICED_SAMPLES, START_TIMEOUT_MS,
} from './adapter';
import type { LiveConfig } from './config';
import type { LiveCredentials } from './settings';
import { AUTO_CTX, configFor, KEY, liveSession, MANUAL_CTX, openLive, SERVER, startLive } from './testing';
import { LIVE_WS_URL, sessionStart } from './wire';

/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);
/** What no event, failure or refusal may carry: the key, and the header it rides in. */
const SECRETS = [KEY.apiKey, 'Bearer'];
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value, (_k, v: unknown) => (v instanceof Int16Array ? `pcm(${v.length})` : v instanceof Error ? v.message : v));
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};
const kinds = (log: readonly AdapterEvent[]) => log.filter((e) => e.kind !== 'frame').map((e) => e.kind);

function harness(): AdapterHarness<LiveConfig, LiveCredentials> {
  let seam = fakeHeaderSockets();
  const last = () => seam.sockets.last();
  const reply = (frame: () => string): ScenarioStep => ({ run: () => last().receive(frame()) });
  return {
    adapter: createLiveAdapter({ openHeaderSocket: (url, headers, o) => seam.open(url, headers, o) }),
    config: (context) => { seam = fakeHeaderSockets(); return configFor(context); },
    credentials: KEY,
    // The registration answers first; the socket exists only then.
    opening: () => [{ flush: true }, { run: () => last().open() }, { flush: true }, reply(SERVER.started), { flush: true }],
    exchange: [
      reply(() => SERVER.input('你好', 0, 200)),
      reply(() => SERVER.output('Hello.', 0, 200)),
      reply(() => SERVER.audio()),
      { advance: 5_000 },
    ],
    // The server drops the session; the one attempt's socket drops before it opens: the leg fails.
    serverClose: [
      { run: () => last().serverClose(1011, 'Internal error') }, { flush: true },
      { run: () => { if (last().readyState === FakeSocket.CONNECTING) last().drop(); } }, { flush: true },
    ],
    refuse: [{ flush: true }, { run: () => last().drop() }, { flush: true }],
    reconnect: [
      { run: () => last().serverClose(1011, 'Internal error') }, { flush: true },
      { run: () => last().open() }, { flush: true },
      reply(SERVER.started), { flush: true },
    ],
  };
}

describe('the OpenAI Live adapter: conformance', () => {
  const h = harness();

  it('runs every scenario but typed text, which Live takes none of', () => {
    expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close', 'reconnect']);
  });

  it.each(scenarioNames(h))('%s', async (name) => {
    const report = await runScenario(h, name);
    expect(report.violations).toEqual([]);
    expect(report.problems).toEqual([]);
  });
});

describe('the OpenAI Live adapter: the seeded lifecycles', () => {
  const lifecycles: LifecycleHarness<LiveConfig, LiveCredentials> = {
    adapter: (run) => createLiveAdapter({ openHeaderSocket: fakeHeaderSockets(run.sockets).open }),
    config: (context) => configFor(context),
    credentials: KEY,
    secrets: SECRETS,
    textInput: false,
    startBoundMs: START_TIMEOUT_MS,
    opening: async (run) => {
      // The registration answers first: the socket exists only after it.
      await flush();
      const socket = run.sockets.all[run.sockets.all.length - 1];
      if (!socket) return;
      const r = run.rand();
      if (r < 0.04) { run.count('harness.drop'); return socket.drop(); }
      if (r < 0.07) { run.count('harness.silent'); return; }
      socket.open();
      await flush();
      if (r < 0.1) { run.count('harness.forbidden'); return socket.receive(SERVER.forbidden()); }
      if (r < 0.12) { run.count('harness.closed'); return socket.receive(SERVER.closed('remote_hangup')); }
      if (r < 0.14) { run.count('harness.close_1011'); return socket.serverClose(1011); }
      // Opened, and no answer yet: the kit may abort mid-handshake, else the start's bound runs out.
      if (r < 0.3) { run.count('harness.unanswered'); return; }
      socket.receive(SERVER.started());
    },
    server: async (run) => {
      const socket = run.sockets.all[run.sockets.all.length - 1];
      if (!socket) return;
      // A reconnect's attempt: its registration answered, its socket connecting.
      if (socket.readyState === FakeSocket.CONNECTING) {
        if (run.rand() < 0.8) {
          socket.open();
          await flush();
          if (run.rand() < 0.9) { run.count('harness.reconnected'); socket.receive(SERVER.started(`live_${run.index}`)); }
          else socket.receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
        } else socket.drop();
        return;
      }
      if (socket.readyState !== FakeSocket.OPEN) return;
      const r = run.rand();
      const at = Math.floor(run.rand() * 60) * 200;
      if (r < 0.15) socket.receive(SERVER.input(run.pick(['你好', ',老板', '好', '。']), at, at + 200));
      else if (r < 0.3) socket.receive(SERVER.output(run.pick(['Hello', ' there.', '.', 'The', ' owner,']), at, at + 200));
      else if (r < 0.5) socket.receive(SERVER.audio({ fill: run.pick([900, 20, 0]) }));
      else if (r < 0.6) socket.receive(SERVER.usage(run.pick([0, 15, 15, 30])));
      else if (r < 0.63) socket.receive(SERVER.closed(run.pick(['expired', 'content', 'remote_hangup', 'connection_lost'])));
      else if (r < 0.66) socket.receive(SERVER.error({ code: run.pick(['invalid_audio', 'invalid_api_key', 'rate_limit_exceeded']) }));
      else if (r < 0.68) socket.receive('not json');
      else if (r < 0.7) socket.receive(JSON.stringify({ type: 'session.output_audio.delta', delta: 7 }));
      else if (r < 0.74) socket.receive(run.pick([SERVER.muted(), SERVER.unmuted(), SERVER.bare('session.delegation.created'), SERVER.bare('info'), SERVER.bare('something.new')]));
      else if (r < 0.78) socket.serverClose(run.pick([1000, 1011]));
      else run.clock.advance(run.pick([200, 1_600, 16_000, RECONNECT_GRACE_MS]));
    },
  };

  // 300 lives, about a second alone: the bound is for a loaded machine.
  it('every life settles, ends clean, and leaves no timer, socket or send behind', async () => {
    const report = await runLifecycles(lifecycles, { seed: 20260930, runs: 300 });
    expect(report.failures).toEqual([]);
    for (const key of [
      'refused', 'live', 'stopped', 'end.failed.connection_lost', 'end.failed.auth', 'end.failed.rate_limit', 'end.closed', 'opening.bound', 'opening.abort', 'opening.abort.late',
      'harness.drop', 'harness.silent', 'harness.forbidden', 'harness.closed', 'harness.close_1011', 'harness.unanswered', 'harness.reconnected',
    ]) expect(report.stats[key] ?? 0, key).toBeGreaterThan(0);
  }, 20_000);
});

describe('the OpenAI Live adapter: the start over the header seam (ruling 7; choice 12)', () => {
  it('registers the rule first — a Bearer key, Origin removed, under /v1/live/ — then dials the bare URL, framing the header names alone', async () => {
    const h = startLive();
    expect(h.seam.sockets.all).toEqual([]);
    await flush();
    expect(h.seam.registrations).toEqual([{ host: 'api.openai.com', path: '/v1/live/', set: { Authorization: `Bearer ${KEY.apiKey}` }, remove: ['Origin'], cleared: false }]);
    expect(h.socket().url).toBe(LIVE_WS_URL);
    expect(h.socket().protocols).toBeUndefined();
    expect(h.frames('session.headers')).toEqual([{ host: 'api.openai.com', path: '/v1/live/', set: ['Authorization'], remove: ['Origin'] }]);
    noSecret(h.log);
  });

  it('sends session.start once the socket opens, and clears the rule then: the upgrade has been made', async () => {
    const h = await openLive();
    expect(h.socket().binaryType).toBe('arraybuffer');
    expect(h.sent()).toEqual([sessionStart(h.config, 'start_1')]);
    expect(h.sent()[0]).toMatchObject({ session: { model: 'gpt-live-1', audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } }, delegation: { type: 'client' } } });
    expect(h.frames('session.start')).toEqual([{ model: 'gpt-live-1', voice: 'marin', delegation: 'client', instructions: h.config.instructions }]);
    expect(h.seam.registrations[0].cleared).toBe(true);
  });

  it('resolves on session.started, emitting nothing but frames, over a websocket, its bound cancelled', async () => {
    const h = await openLive();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.started('live_abc'));
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('session.started')).toEqual([{ id: 'live_abc', expiresAt: 1_790_713_967 }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it("refuses an invalid voice in OpenAI's words before the session starts (U10), closing the socket, saying nothing but frames", async () => {
    const h = await openLive();
    h.socket().receive(SERVER.forbidden());
    await expect(h.starting).rejects.toEqual(new AdapterStartError('[OpenAI forbidden] Voice session access denied.', 'client'));
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    expect(h.frames('session.error')).toEqual([{ type: 'invalid_request_error', code: 'forbidden', message: 'Voice session access denied.', param: null }]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a socket that fails before it opens reads as the network with the key named — a refused key is a 401 a browser cannot read (ruling 9)', async () => {
    const h = startLive();
    await flush();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    expect(NEVER_OPENED).toBe("OpenAI's socket did not open (check the network, and that the API key is still valid).");
    expect(h.seam.registrations[0].cleared).toBe(true);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a registration the platform refuses opens nothing, in fixed words', async () => {
    const seam = fakeHeaderSockets();
    seam.refuseNext(`refused with ${KEY.apiKey}`);
    const { clock } = trackedClock();
    const { events, log } = recordEvents();
    const starting = createLiveAdapter({ openHeaderSocket: seam.open }).start({ context: AUTO_CTX, config: configFor(), credentials: KEY, clock, signal: new AbortController().signal }, events);
    await expect(starting).rejects.toMatchObject({ code: 'client', message: 'The app could not prepare the connection to OpenAI: restart it and try again.' });
    expect(seam.sockets.all).toEqual([]);
    noSecret(log);
  });

  it('a stop while the rule is being registered rejects at once and opens nothing; the rule is cleared at once, and its late answer changes nothing', async () => {
    const h = startLive();
    // The registration goes out a hop after the start: this holds it in flight.
    const land = h.seam.holdNext();
    await flush();
    h.controller.abort(new Error('stopped'));
    await expect(h.starting).rejects.toThrow('stopped');
    await flush();
    expect(h.seam.registrations.map((r) => r.cleared)).toEqual([true]);
    expect(h.seam.sockets.all).toEqual([]);
    land();
    await flush();
    expect(h.seam.registrations).toHaveLength(1);
    expect(h.seam.registrations[0].cleared).toBe(true);
    expect(h.seam.sockets.all).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it(`no answer within ${START_TIMEOUT_MS / 1000} s rejects, closing the socket`, async () => {
    const h = await openLive();
    h.clock.advance(START_TIMEOUT_MS);
    await expect(h.starting).rejects.toMatchObject({ code: 'server', message: `OpenAI did not start the session within ${START_TIMEOUT_MS / 1000} s.` });
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);
  });

  it('a session.closed or a close before the start is a refusal', async () => {
    const a = await openLive();
    a.socket().receive(SERVER.closed('remote_hangup'));
    await expect(a.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the session before it started.' });
    const b = await openLive();
    b.socket().serverClose(1011, 'Internal error');
    await expect(b.starting).rejects.toMatchObject({ code: 'server', message: 'OpenAI closed the connection before the session started (1011 Internal error).' });
  });

  it('the web build has no platform to set the header: the default seam refuses in words', async () => {
    const { clock } = trackedClock();
    const { events } = recordEvents();
    const starting = createLiveAdapter().start({ context: AUTO_CTX, config: configFor(), credentials: KEY, clock, signal: new AbortController().signal }, events);
    await expect(starting).rejects.toMatchObject({ code: 'client', message: 'OpenAI Live needs the desktop app or the browser extension.' });
  });
});

describe('the OpenAI Live adapter: audio up, and push-to-talk (ruling 5)', () => {
  it('sends each chunk as it came, base64, with no frame per chunk; nothing before the start or after a stop', async () => {
    const h = await liveSession();
    const n = h.log.length;
    h.session.appendAudio(chunk(1_000));
    h.session.appendAudio(chunk(-3));
    expect(h.appended()).toEqual([chunk(1_000), chunk(-3)]);
    expect(h.log.length).toBe(n);
    await h.session.stop();
    h.session.appendAudio(chunk());
    expect(h.appended()).toHaveLength(2);
  });

  it('a release mutes the session once, framed, and drops what follows; a press unmutes it; a cancel is a release', async () => {
    const h = await liveSession({ context: MANUAL_CTX });
    // The first press: the session was never muted.
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.session.endTurn();
    h.session.appendAudio(chunk());
    expect(h.sent().map((m) => m.type)).toEqual(['session.start', 'session.input_audio.append', 'session.input_audio.mute']);
    expect(h.sent()[2]).toEqual({ type: 'session.input_audio.mute', event_id: 'mute_2' });
    expect(h.frames('session.input_audio.mute')).toEqual([{ eventId: 'mute_2' }]);
    h.socket().receive(SERVER.muted());
    expect(h.frames('session.input_audio.muted')).toEqual([undefined]);
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.cancelTurn();
    expect(h.sent().slice(3).map((m) => m.type)).toEqual(['session.input_audio.unmute', 'session.input_audio.append', 'session.input_audio.mute']);
    expect(h.frames('session.input_audio.unmute')).toEqual([{ eventId: 'unmute_3' }]);
  });

  it('automatic turns never mute', async () => {
    const h = await liveSession();
    h.session.beginTurn();
    h.session.endTurn();
    h.session.cancelTurn();
    expect(h.sent().map((m) => m.type)).toEqual(['session.start']);
  });
});

describe('the OpenAI Live adapter: messages to segments and frames', () => {
  it('frames each delta with its stamps and cuts it into segments; frames voiced audio, never the floor', async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.input('你好', 0, 200));
    h.socket().receive(SERVER.output('Hello.', 0, 200));
    h.socket().receive(SERVER.floor());
    h.socket().receive(SERVER.audio());
    expect(h.frames('session.input_transcript.delta')).toEqual([{ delta: '你好', startMs: 0, endMs: 200 }]);
    expect(h.frames('session.output_transcript.delta')).toEqual([{ delta: 'Hello.', startMs: 0, endMs: 200 }]);
    expect(h.frames('session.output_audio.delta')).toEqual([{ samples: 2_400, rms: 0.0275 }]);
    // The floor's frame counted on the clock: the voiced one is [100, 200) ms, the second half of "Hello." [0, 200).
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.range])).toEqual([[2, [3, 6]]]);
  });

  it('a leg that does not speak plays nothing, yet its voiced audio opens and holds the translation', async () => {
    const h = await liveSession({ context: { ...AUTO_CTX, speech: false } });
    h.socket().receive(SERVER.audio());
    expect(h.of('audio')).toEqual([]);
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([{ ref: 1, side: 'translation' }]);
  });

  it("a mid-session error that does not end it — invalid audio (U10) — is a Logs line, and the session goes on", async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.error({ code: 'invalid_audio', param: 'audio', message: 'PCM16 audio must contain an even number of bytes' }));
    expect(h.frames('session.error')).toEqual([{ type: 'invalid_request_error', code: 'invalid_audio', message: 'PCM16 audio must contain an even number of bytes', param: 'audio' }]);
    h.socket().receive(SERVER.input('还在', 0, 200));
    expect(kinds(h.log)).toEqual(['segmentOpened', 'segmentText']);
  });

  it('a frame that will not read says so once, a Logs line and a degraded, until one reads again', async () => {
    const h = await liveSession();
    h.socket().receive('not json');
    h.socket().receive('still not json');
    expect(h.frames('session.unreadable')).toHaveLength(1);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error']);
    h.socket().receive(SERVER.usage(0));
    h.socket().receive('not json again');
    expect(h.of('degraded')).toHaveLength(2);
  });

  it('frames what it reads and names what it does not', async () => {
    const h = await liveSession();
    for (const type of ['session.delegation.created', 'session.updated', 'info', 'something.new']) h.socket().receive(SERVER.bare(type));
    expect(h.of('frame').slice(-4).map((e) => [e.payload.type, e.payload.payload])).toEqual([
      ['session.delegation.created', undefined], ['session.updated', undefined], ['session.info', undefined], ['session.unknown', { type: 'something.new' }],
    ]);
  });
});

describe('the OpenAI Live adapter: the watchdog, the reconnect and the ends (ruling 6; choices 13, 14)', () => {
  /** A reconnect's attempt, answered: its registration, its socket open, its session started. */
  async function answerAttempt(h: Awaited<ReturnType<typeof liveSession>>, id = 'live_2') {
    await flush();
    h.socket().open();
    await flush();
    h.socket().receive(SERVER.started(id));
    await flush();
  }

  it('a close with no session.closed is tried again once — the header registered again — and the leg carries on, its refs counting on', async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.input('你好', 0, 200));
    const first = h.socket();
    first.serverClose(1011, 'Internal error');
    await flush();
    expect(h.frames('session.connection_lost')).toEqual([{ cause: 'socket_closed', code: 1011, reason: 'Internal error' }]);
    expect(kinds(h.log)).toEqual(['segmentOpened', 'segmentText', 'segmentClosed', 'reconnecting']);
    // Audio in the gap is dropped.
    h.session.appendAudio(chunk());
    await answerAttempt(h);
    expect(h.seam.registrations).toHaveLength(2);
    expect(h.socket()).not.toBe(first);
    expect(kinds(h.log).slice(-1)).toEqual(['reconnected']);
    expect(h.frames('session.reconnected')).toEqual([undefined]);
    h.socket().receive(SERVER.input('再见', 0, 200));
    expect(h.of('segmentOpened').map((e) => e.payload.ref)).toEqual([1, 2]);
    expect(h.appended()).toEqual([]);
  });

  it(`a second loss within ${RECONNECT_GRACE_MS / 1000} s of the reconnect fails the leg; one after it is tried again`, async () => {
    const h = await liveSession();
    h.socket().serverClose(1011);
    await answerAttempt(h);
    h.clock.advance(RECONNECT_GRACE_MS - 1);
    h.socket().serverClose(1011);
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: CONNECTION_LOST }]);
    expect(h.seam.registrations).toHaveLength(2);

    const g = await liveSession();
    g.socket().serverClose(1011);
    await answerAttempt(g);
    g.clock.advance(RECONNECT_GRACE_MS);
    g.socket().serverClose(1011);
    await flush();
    expect(g.of('failed')).toEqual([]);
    expect(g.seam.registrations).toHaveLength(3);
  });

  it('an attempt that fails ends the leg as the lost connection; one refused for the key, in its words', async () => {
    const h = await liveSession();
    h.socket().serverClose(1011);
    await flush();
    h.socket().drop();
    await flush();
    expect(h.frames('session.reconnect_failed')).toEqual([{ message: NEVER_OPENED }]);
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: CONNECTION_LOST }]);
    expect(h.timers()).toBe(0);

    const g = await liveSession();
    g.socket().serverClose(1011);
    await flush();
    g.socket().open();
    await flush();
    g.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    await flush();
    expect(g.of('failed').map((e) => e.payload)).toEqual([{ code: 'auth', message: '[OpenAI invalid_api_key] Incorrect API key provided.' }]);
  });

  it(`an end within ${ERROR_WORDS_MS / 1000} s of an actionable error fails in its words, with no attempt; later, the connection is tried again`, async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.error({ type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota.' }));
    h.clock.advance(ERROR_WORDS_MS);
    h.socket().serverClose(1011);
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([{ code: 'rate_limit', message: '[OpenAI insufficient_quota] You exceeded your current quota.' }]);
    expect(h.seam.registrations).toHaveLength(1);

    const g = await liveSession();
    g.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided.' }));
    g.clock.advance(ERROR_WORDS_MS + 1);
    g.socket().serverClose(1011);
    await flush();
    expect(g.of('failed')).toEqual([]);
    expect(kinds(g.log)).toContain('reconnecting');
  });

  it("the session's expiry ends the run (ruling 8); any other session.closed unrequested is a lost connection", async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.closed('expired', 7_199));
    expect(h.frames('session.closed')).toEqual([{ reason: 'expired', seconds: 7_199 }]);
    expect(h.of('closed').map((e) => e.payload)).toEqual([{ reason: 'expired' }]);
    expect(h.socket().closedByClient).not.toBeNull();

    const g = await liveSession();
    g.socket().receive(SERVER.closed('remote_hangup', 12));
    await flush();
    expect(g.frames('session.connection_lost')).toEqual([{ cause: 'session_closed', reason: 'remote_hangup' }]);
    expect(kinds(g.log)).toEqual(['reconnecting']);
  });

  it(`two equal usage reports with ${STALL_VOICED_SAMPLES / 24_000} s of voiced audio sent between them are a stall, tried again; with none sent, silence (U3)`, async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.usage(14));
    h.socket().receive(SERVER.usage(14));
    expect(h.frames('session.stalled')).toEqual([]);
    for (let i = 0; i < 30; i++) h.session.appendAudio(chunk(0));
    h.socket().receive(SERVER.usage(14));
    expect(h.frames('session.stalled')).toEqual([]);
    // 24 chunks of 2 048 samples: 49 152, just past 2 s.
    for (let i = 0; i < 24; i++) h.session.appendAudio(chunk(5));
    h.socket().receive(SERVER.usage(14));
    expect(h.frames('session.usage.updated')).toEqual([{ seconds: 14 }, { seconds: 14 }, { seconds: 14 }, { seconds: 14 }]);
    expect(h.frames('session.stalled')).toEqual([{ seconds: 14 }]);
    expect(h.frames('session.connection_lost')).toEqual([{ cause: 'stalled', seconds: 14 }]);
    expect(kinds(h.log)).toEqual(['reconnecting']);
  });

  it('a push-to-talk tap between two equal reports is no stall: billing counts whole seconds, and 0.17 s has not moved it', async () => {
    const h = await liveSession({ context: MANUAL_CTX });
    h.socket().receive(SERVER.usage(26));
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.socket().receive(SERVER.usage(26));
    await flush();
    expect(h.frames('session.stalled')).toEqual([]);
    // Taps the same minute: none reconnects, and none fails the leg.
    for (let tap = 0; tap < 3; tap++) {
      h.session.beginTurn();
      h.session.appendAudio(chunk());
      h.session.endTurn();
      h.socket().receive(SERVER.usage(26));
      await flush();
    }
    expect(kinds(h.log)).toEqual([]);
    // A long press, just short of 2 s between each two reports: still none, the count starting again at each report.
    h.session.beginTurn();
    for (let i = 0; i < 23; i++) h.session.appendAudio(chunk());
    h.socket().receive(SERVER.usage(26));
    for (let i = 0; i < 23; i++) h.session.appendAudio(chunk());
    h.socket().receive(SERVER.usage(26));
    h.session.endTurn();
    await flush();
    expect(h.frames('session.stalled')).toEqual([]);
    expect(kinds(h.log)).toEqual([]);
  });
});

describe('the OpenAI Live adapter: stop (ruling 8)', () => {
  it('sends session.close, framed, closes the socket before it returns, leaves no timer, and says nothing after', async () => {
    const h = await liveSession();
    h.socket().receive(SERVER.input('你好', 0, 200));
    h.socket().receive(SERVER.output('Hi', 0, 200));
    const n = h.log.length;
    const stopping = h.session.stop();
    expect(h.sent().slice(-1)).toEqual([{ type: 'session.close' }]);
    expect(h.log.slice(n)).toEqual([{ kind: 'frame', payload: { direction: 'out', type: 'session.close' } }]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await stopping;
    expect(h.timers()).toBe(0);
    h.clock.advance(60_000);
    await flush();
    expect(h.log.length).toBe(n + 1);
  });

  it('a stop while reconnecting ends the attempt: its rule cleared, its socket closed, nothing said after', async () => {
    const h = await liveSession();
    h.socket().serverClose(1011);
    await flush();
    const attempt = h.socket();
    const n = h.log.length;
    await h.session.stop();
    await flush();
    expect(attempt.readyState).toBe(FakeSocket.CLOSED);
    expect(h.seam.registrations.every((r) => r.cleared)).toBe(true);
    expect(h.log.length).toBe(n);
    expect(h.timers()).toBe(0);
  });

  it('no event carries the key', async () => {
    const h = await liveSession({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    // OpenAI masks the key it quotes (U9): "sk-bogus************0000".
    h.socket().receive(SERVER.error({ code: 'invalid_api_key', message: 'Incorrect API key provided: sk-proj-************6789.' }));
    h.socket().serverClose(1011);
    await flush();
    noSecret(h.log);
  });
});
```

And pin Live's session side — `adapter.ts`, `segments.ts` and `wire.ts`, the builder, the check and the settings reached as types only, no `socket.ts` of its own:

```diff
diff --git a/src/providers/sessionSide.consistency.test.ts b/src/providers/sessionSide.consistency.test.ts
--- a/src/providers/sessionSide.consistency.test.ts
+++ b/src/providers/sessionSide.consistency.test.ts
@@ -264,6 +264,14 @@
       'src/providers/palabraai/items.ts',
       'src/providers/palabraai/wire.ts',
     ]);
+
+    // OpenAI Live's sockets come from the contract's header seam (Stage 2 OpenAI Live, choice 1): no `socket.ts` of its own. The builder, the check, the settings, the view, the definition and the fixtures are not the session's.
+    const live = sessionSide(REPO_ROOT, 'src/providers/openai_live');
+    expect(live).toEqual([
+      'src/providers/openai_live/adapter.ts',
+      'src/providers/openai_live/segments.ts',
+      'src/providers/openai_live/wire.ts',
+    ]);
   });
 
   it('reads imports the way the compiler does', () => {
```

- [ ] **Step 3: Run them to see them fail.**

Run: `npx vitest run src/providers/openai_live/adapter.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: FAIL — `Test Files 2 failed (2)`, `Tests 1 failed | 7 passed (8)`: `adapter.test.ts` fails to collect (`TypeError: createLiveAdapter is not a function` — the seed exports nothing), and the guard's walk case fails (`expected [ Array(1) ] to deeply equal [ …(3) ]`: from the seed it finds `adapter.ts` alone); its other seven cases pass.

- [ ] **Step 4: Write the adapter.** Replace `src/providers/openai_live/adapter.ts` with:

```ts
/**
 * OpenAI Live on the new contract (spec: "L0 — the client contract"), ported
 * from `OpenAILiveClient` (`src/services/clients/`, compiled until the
 * deletion after the live test) without its items, ids, karaoke bookkeeping
 * or segmentation stage: one leg, one WebSocket to the Live endpoint, opened
 * through the header seam with a Bearer header and no `Origin` (F14; ruling
 * 7). The start resolves on `session.started`, within a bound, and a refused
 * one rejects in words (choice 12). Deltas and audio become segments
 * (`segments.ts`): the translation cut where the source was, stating it
 * (ruling 3), its audio placed by the output's timeline, with real ranges
 * (ruling 2). A push-to-talk release mutes the session and a press unmutes
 * it (ruling 5). A lost connection is tried again once, then the leg fails
 * (ruling 6). Stop sends `session.close` and closes at once (ruling 8).
 * Every timer reads the request's clock, and nothing is said but through
 * events (CLAUDE.md, "Inside an IClient session").
 */
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { HeaderSocketError, platformHeaderSocket, type OpenHeaderSocket } from '../../lib/contract/headerSocket';
import { WS_OPEN } from '../../lib/contract/socket';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { LiveConfig } from './config';
import { computeRms, FLOOR_RMS, LiveSegments } from './segments';
import type { LiveCredentials } from './settings';
import {
  appendFrame,
  base64ToPcm,
  decodeServerEvent,
  errorCode,
  errorWords,
  LIVE_WS_URL,
  liveHeaders,
  muteFrame,
  SESSION_CLOSE,
  sessionStart,
  stampOf,
  unmuteFrame,
  type ErrorEvent,
  type OpenAIError,
  type OutputAudioDeltaEvent,
  type ServerEvent,
  type SessionClosedEvent,
  type SessionStartedEvent,
  type TranscriptDeltaEvent,
  type UsageUpdatedEvent,
} from './wire';

/** The old client's bound on the start (`OpenAILiveClient.ts:76`), now on the request's clock, the header seam's registration and upgrade inside it (choice 12). */
export const START_TIMEOUT_MS = 30_000;
/** A socket that failed before it opened: a browser cannot read why — a refused key is a 401 on the upgrade (ruling 9; choice 12). */
export const NEVER_OPENED = "OpenAI's socket did not open (check the network, and that the API key is still valid).";
/** A second unexpected end this soon after a reconnect is not tried again (`OpenAILiveClient.ts:80`; ruling 6). */
export const RECONNECT_GRACE_MS = 60_000;
/** How long a mid-session `error` words the end that follows it (OpenAI Translate's ruling 3; choice 13). */
export const ERROR_WORDS_MS = 10_000;
/**
 * How much voiced audio must go up between two equal usage reports for them
 * to read as a stall: 2 s at 24 kHz. Billing counts whole seconds and moves
 * only with appended audio (U2'), so a push-to-talk tap near a report is not
 * one (choice 14).
 */
export const STALL_VOICED_SAMPLES = 48_000;
/** Why the leg fails when its connection is gone for good: worded by the `connection_lost` alias. */
export const CONNECTION_LOST = 'The connection to OpenAI was lost and could not be restored.';
/** Refusals the user can act on: an end that follows one, or a reconnect refused so, fails in its words (ruling 6). */
const ACTIONABLE = new Set(['auth', 'rate_limit']);
/** Where the rule the seam installs applies: the Logs name it, never a value. */
const RULE = { host: 'api.openai.com', path: '/v1/live/' };

export interface LiveAdapterDeps {
  /** The header seam (F14): the platform's in the app, `fakeHeaderSockets().open` in tests. */
  openHeaderSocket: OpenHeaderSocket;
}

type Phase = 'opening' | 'live' | 'reconnecting' | 'ended';

/** Hears nothing more from a socket the leg has moved on from. */
function detach(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
}

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/**
 * The seam's refusal in the start's words (choice 12). A browser that would
 * not open the socket comes as `nativeSocket` words it — fixed, quoting
 * nothing; an abort is passed on as it came.
 */
function seamRefusal(error: unknown): unknown {
  if (!(error instanceof HeaderSocketError)) {
    return error instanceof Error && error.message.startsWith('The browser would not open the socket')
      ? new AdapterStartError(error.message, 'network')
      : error;
  }
  switch (error.reason) {
    case 'never_opened':
      return new AdapterStartError(NEVER_OPENED, 'network');
    case 'timeout':
      return new AdapterStartError('OpenAI did not open the connection in time (check the network).', 'network');
    case 'unsupported':
      return new AdapterStartError('OpenAI Live needs the desktop app or the browser extension.', 'client');
    default:
      return new AdapterStartError('The app could not prepare the connection to OpenAI: restart it and try again.', 'client', undefined, { cause: error.cause });
  }
}

class LiveLeg implements AdapterSession {
  readonly info = { transport: 'websocket' };
  private phase: Phase = 'opening';
  /** The connection in use: started, and heard. Null while opening and while reconnecting. */
  private socket: WebSocket | null = null;
  private readonly segments: LiveSegments;
  /** A reconnect's attempt, which a stop aborts. */
  private attempt: AbortController | null = null;
  /** When the last reconnect succeeded: a second end within the grace is not tried again. */
  private reconnectedAt: number | null = null;
  /** Push-to-talk: the session is muted — a release's (ruling 5). */
  private muted = false;
  /** The last usage seconds, and the voiced samples sent since: two equal reports around `STALL_VOICED_SAMPLES` of them are a stall (choice 14). */
  private usage: number | null = null;
  private voicedSamples = 0;
  /** The last mid-session `error`, and when (choice 13). */
  private lastError: { code: string; message: string; at: number } | null = null;
  /** `session.unreadable` on the ok → failing transition only, a frame's and an audio delta's each. */
  private readable = true;
  private audioReadable = true;
  private eventIds = 0;

  constructor(
    private readonly request: StartRequest<LiveConfig, LiveCredentials>,
    private readonly events: AdapterEvents,
    private readonly openHeaderSocket: OpenHeaderSocket,
  ) {
    const { config, clock } = request;
    this.segments = new LiveSegments({
      clock,
      silence: config.silence,
      sentencesPerSegment: config.sentencesPerSegment,
      sink: events,
      // Each translation cut and why, for the live test (Stage 2 translation cuts, choice 14).
      cut: (summary) => this.frame('out', 'translation.cut', summary),
    });
  }

  async open(): Promise<AdapterSession> {
    try {
      await this.connect(this.request.signal);
      return this;
    } catch (error) {
      this.shutDown();
      throw error;
    }
  }

  /** One chunk as it came, while live and not muted — no frame per chunk (the hot-path rule). */
  appendAudio(pcm: Int16Array): void {
    const ws = this.live();
    if (!ws || this.muted) return;
    ws.send(appendFrame(pcm));
    if (pcm.some((s) => s !== 0)) this.voicedSamples += pcm.length;
  }

  /** OpenAI Live takes no typed text (`textInput: () => false`). */
  appendText(): void {}

  /** A press unmutes a session a release muted (ruling 5). */
  beginTurn(): void {
    const ws = this.manual();
    if (!ws || !this.muted) return;
    const frame = unmuteFrame(this.nextId('unmute'));
    ws.send(JSON.stringify(frame));
    this.frame('out', frame.type, { eventId: frame.event_id });
    this.muted = false;
  }

  /** A release mutes: what was said still finishes translating, and a muted session with nothing appended stops billing (ruling 5; U2'). */
  endTurn(): void {
    this.mute();
  }

  /** The same: what the press appended is the model's input already, and no clear exists. */
  cancelTurn(): void {
    this.mute();
  }

  /** `session.close`, framed, then the close before its first `await`: nothing waits for `session.closed` (ruling 8; choice 16). */
  stop(): Promise<void> {
    const ws = this.socket;
    if (this.phase === 'live' && ws && ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(SESSION_CLOSE));
      this.frame('out', 'session.close');
    }
    this.shutDown();
    return Promise.resolve();
  }

  private mute(): void {
    const ws = this.manual();
    if (!ws || this.muted) return;
    const frame = muteFrame(this.nextId('mute'));
    ws.send(JSON.stringify(frame));
    this.frame('out', frame.type, { eventId: frame.event_id });
    this.muted = true;
  }

  /** The connection, while live under manual turns. */
  private manual(): WebSocket | null {
    return this.request.context.turns === 'manual' ? this.live() : null;
  }

  private live(): WebSocket | null {
    const ws = this.socket;
    return this.phase === 'live' && ws !== null && ws.readyState === WS_OPEN ? ws : null;
  }

  /** The phase as it stands now: read past an `await`, where the compiler would keep an earlier assignment's narrowing. */
  private is(phase: Phase): boolean {
    return this.phase === phase;
  }

  private nextId(kind: string): string {
    this.eventIds += 1;
    return `${kind}_${this.eventIds}`;
  }

  /**
   * One connection: the seam, `session.start`, its answer (choice 12).
   * Resolves once `session.started` is heard, the connection adopted and the
   * leg live; rejects, leaving nothing open, when the seam refuses, the
   * server refuses or closes, `START_TIMEOUT_MS` passes, or `signal` aborts.
   */
  private connect(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const { clock, config, credentials } = this.request;
      const seam = new AbortController();
      let ws: WebSocket | null = null;
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cancelBound();
        signal.removeEventListener('abort', onAbort);
        if (error === undefined) {
          resolve();
          return;
        }
        seam.abort(error);
        if (ws) {
          detach(ws);
          if (ws.readyState <= WS_OPEN) ws.close(1000);
        }
        reject(error);
      };
      const onAbort = () => settle(signal.reason ?? new Error('aborted'));
      const cancelBound = clock.setTimeout(() => settle(ws
        ? new AdapterStartError(`OpenAI did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`OpenAI did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
      signal.addEventListener('abort', onAbort, { once: true });

      const headers = liveHeaders(credentials);
      // The rule's place and header names, never a value.
      this.frame('out', 'session.headers', { ...RULE, set: Object.keys(headers.set), remove: headers.remove ?? [] });
      this.openHeaderSocket(LIVE_WS_URL, headers, { signal: seam.signal, clock }).then((socket) => {
        if (settled) {
          detach(socket);
          socket.close(1000);
          return;
        }
        ws = socket;
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (e: MessageEvent) => {
          if (!settled) this.handshake(socket, e.data, settle);
          else if (socket === this.socket) this.onMessage(e.data);
        };
        // A Logs line: the close that follows says what it did to the session.
        socket.onerror = () => this.frame('in', 'session.socket_error');
        socket.onclose = (e: CloseEvent) => {
          if (!settled) {
            // OpenAI Translate's name for the same close; the refusal that follows says it was the start's (choice 15).
            this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
            settle(new AdapterStartError(`OpenAI closed the connection before the session started (${closeWords(e)}).`, 'server'));
          } else if (socket === this.socket) this.unexpected('socket_closed', { code: e.code, reason: e.reason });
        };
        const start = sessionStart(config, this.nextId('start'));
        socket.send(JSON.stringify(start));
        this.frame('out', 'session.start', { model: start.session.model, voice: start.session.audio.output.voice, delegation: start.session.delegation.type, instructions: start.session.instructions });
      }, (error: unknown) => settle(seamRefusal(error)));
    });
  }

  /** A frame before `session.started`: its answer settles the connection; anything else is a Logs line. */
  private handshake(ws: WebSocket, data: unknown, settle: (error?: unknown) => void): void {
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.frame('in', 'session.unreadable', { message: describeCause(error) });
      return;
    }
    if (e.type === 'session.started') {
      const s = (e as unknown as SessionStartedEvent).session;
      this.socket = ws;
      this.phase = 'live';
      this.frame('in', 'session.started', { id: typeof s?.id === 'string' ? s.id : null, expiresAt: typeof s?.expires_at === 'number' ? s.expires_at : null });
      settle();
    } else if (e.type === 'error') {
      // U10: an invalid voice is `invalid_request_error` `forbidden` "Voice session access denied." — a refused start, in OpenAI's words.
      const error = (e as unknown as ErrorEvent).error ?? {};
      this.errorFrame(error);
      settle(new AdapterStartError(errorWords(error), errorCode(error)));
    } else if (e.type === 'session.closed') {
      this.closedFrame(e as unknown as SessionClosedEvent);
      settle(new AdapterStartError('OpenAI closed the session before it started.', 'server'));
    } else this.frame('in', 'session.unknown', { type: e.type });
  }

  private onMessage(data: unknown): void {
    if (this.phase !== 'live') return;
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.unreadable('frame', error);
      return;
    }
    this.readable = true;
    switch (e.type) {
      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta':
        this.transcript(e as unknown as TranscriptDeltaEvent);
        return;
      case 'session.output_audio.delta':
        this.audio(e as unknown as OutputAudioDeltaEvent);
        return;
      case 'session.usage.updated':
        this.usageUpdated(e as unknown as UsageUpdatedEvent);
        return;
      case 'session.closed':
        this.serverClosed(e as unknown as SessionClosedEvent);
        return;
      case 'error':
        this.serverError((e as unknown as ErrorEvent).error ?? {});
        return;
      case 'session.input_audio.muted':
      case 'session.input_audio.unmuted':
      case 'session.delegation.created':
      case 'session.instructions.appended':
      case 'session.thinking.appended':
      case 'session.commentary.appended':
      case 'session.updated':
      case 'session.started':
        this.frame('in', e.type);
        return;
      case 'info':
        this.frame('in', 'session.info');
        return;
      default:
        this.frame('in', 'session.unknown', { type: e.type });
    }
  }

  /** A transcript delta, framed with its stamps, into its side. */
  private transcript(e: TranscriptDeltaEvent): void {
    const startMs = stampOf(e.start_ms);
    const endMs = stampOf(e.end_ms);
    this.frame('in', e.type, { delta: typeof e.delta === 'string' ? e.delta : null, startMs, endMs });
    if (typeof e.delta !== 'string' || !e.delta) return;
    if (e.type === 'session.input_transcript.delta') this.segments.input(e.delta, startMs, endMs);
    else this.segments.output(e.delta, startMs, endMs);
  }

  /** An output frame: every one advances the timeline; one above the floor is framed and, on a leg that speaks, played (choice 10). */
  private audio(e: OutputAudioDeltaEvent): void {
    if (typeof e.delta !== 'string') {
      this.unreadable('audio', new Error('an audio delta with no base64 string'));
      return;
    }
    let pcm: Int16Array;
    try {
      pcm = base64ToPcm(e.delta);
    } catch (error) {
      this.unreadable('audio', error);
      return;
    }
    this.audioReadable = true;
    const rms = computeRms(pcm);
    const voiced = rms > FLOOR_RMS;
    if (voiced) this.frame('in', e.type, { samples: pcm.length, rms: Math.round(rms * 10_000) / 10_000 });
    this.segments.audio(pcm, { voiced, play: this.request.context.speech });
  }

  /** The seconds billed, framed; two equal reports with 2 s of voiced audio sent between them are a stall (choice 14). */
  private usageUpdated(e: UsageUpdatedEvent): void {
    const seconds = stampOf(e.usage?.seconds);
    this.frame('in', e.type, { seconds });
    if (seconds === null) return;
    const frozen = this.usage !== null && seconds === this.usage && this.voicedSamples >= STALL_VOICED_SAMPLES;
    this.usage = seconds;
    this.voicedSamples = 0;
    if (frozen) {
      this.frame('in', 'session.stalled', { seconds });
      this.unexpected('stalled', { seconds });
    }
  }

  /** The server ended the session: at its expiry the run ends (ruling 8); any other end unrequested is a lost connection (ruling 6). */
  private serverClosed(e: SessionClosedEvent): void {
    this.closedFrame(e);
    const reason = typeof e.reason === 'string' ? e.reason : null;
    if (reason === 'expired') this.end({ reason: 'expired' });
    else this.unexpected('session_closed', { reason });
  }

  /** Mid-session, a Logs line, kept for the end that may follow (choice 13): `invalid_audio` and its kin do not end the session (U10). */
  private serverError(error: OpenAIError): void {
    this.errorFrame(error);
    this.lastError = { code: errorCode(error), message: errorWords(error), at: this.request.clock.now() };
  }

  private errorFrame(error: OpenAIError): void {
    this.frame('in', 'session.error', { type: error.type ?? null, code: error.code ?? null, message: error.message ?? null, param: error.param ?? null });
  }

  private closedFrame(e: SessionClosedEvent): void {
    this.frame('in', 'session.closed', { reason: typeof e.reason === 'string' ? e.reason : null, seconds: stampOf(e.usage?.seconds) });
  }

  /** The last mid-session error when it came within `ERROR_WORDS_MS`, and not from a clock stepped back. */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const age = this.request.clock.now() - last.at;
    return age < 0 || age > ERROR_WORDS_MS ? null : { code: last.code, message: last.message };
  }

  /**
   * The connection is gone while live (ruling 6): after an actionable error,
   * in its words; within the grace of the last reconnect, for good; else
   * one attempt. Said once: a second cause while reconnecting is the same.
   */
  private unexpected(cause: 'socket_closed' | 'session_closed' | 'stalled', detail: Record<string, unknown>): void {
    if (this.phase !== 'live') return;
    this.frame('in', 'session.connection_lost', { cause, ...detail });
    const recent = this.recentError();
    if (recent && ACTIONABLE.has(recent.code)) {
      this.end({ failed: recent });
      return;
    }
    const reconnectedAt = this.reconnectedAt;
    if (reconnectedAt !== null && this.request.clock.now() - reconnectedAt < RECONNECT_GRACE_MS) {
      this.end({ failed: { code: 'connection_lost', message: CONNECTION_LOST } });
      return;
    }
    void this.reconnect();
  }

  /** Break before make: the old socket closes, both sides close as they stand, then one attempt, the seam registering again. */
  private async reconnect(): Promise<void> {
    this.phase = 'reconnecting';
    const old = this.socket;
    this.socket = null;
    if (old) {
      detach(old);
      if (old.readyState <= WS_OPEN) old.close(1000);
    }
    this.segments.connectionLost();
    // A new session starts unmuted, unbilled and readable.
    this.muted = false;
    this.usage = null;
    this.voicedSamples = 0;
    this.readable = true;
    this.audioReadable = true;
    this.lastError = null;
    this.frame('out', 'session.reconnecting');
    this.events.reconnecting();
    const attempt = new AbortController();
    this.attempt = attempt;
    try {
      await this.connect(attempt.signal);
    } catch (error) {
      // A stop while the attempt ran has said all there is to say.
      if (this.attempt !== attempt || this.is('ended')) return;
      this.attempt = null;
      this.frame('in', 'session.reconnect_failed', { message: describeCause(error) });
      // A key revoked or a quota spent reads as its cause, in the words a refused start gives (ruling 6).
      const refused = error instanceof AdapterStartError && ACTIONABLE.has(error.code);
      this.end(refused ? { failed: { code: error.code, message: error.message } } : { failed: { code: 'connection_lost', message: CONNECTION_LOST } });
      return;
    }
    if (this.attempt !== attempt || !this.is('live')) return;
    this.attempt = null;
    this.reconnectedAt = this.request.clock.now();
    this.frame('in', 'session.reconnected');
    this.events.reconnected();
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only. */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    this.events.degraded({ code: 'parse_error', message: `A message from OpenAI could not be read: ${describeCause(error)}`, cause: error });
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(how: { failed: { code: string; message: string } } | { reason: string }): void {
    if (this.phase !== 'live' && this.phase !== 'reconnecting') return;
    this.shutDown();
    if ('failed' in how) this.events.failed(how.failed);
    else this.events.closed({ reason: how.reason });
  }

  /** Every way a leg ends: no timer left, no attempt running, the socket closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    const attempt = this.attempt;
    this.attempt = null;
    attempt?.abort(new Error('The session stopped.'));
    this.segments.stop();
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      detach(ws);
      if (ws.readyState <= WS_OPEN) ws.close(1000);
    }
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (this.phase === 'ended') return;
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createLiveAdapter(deps: Partial<LiveAdapterDeps> = {}): Adapter<LiveConfig, LiveCredentials> {
  const openHeaderSocket = deps.openHeaderSocket ?? platformHeaderSocket;
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      return new LiveLeg(request, events, openHeaderSocket).open();
    },
  };
}
```

- [ ] **Step 5: Run them, and the folder.**

Run: `npx vitest run src/providers/openai_live/adapter.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 2 files, 46 tests (the adapter's 38: the eight scenarios and the case that names them, the lifecycles' one, and twenty-eight cases, the push-to-talk tap among them).

Run: `npx vitest run src/providers/openai_live`
Expected: PASS — 7 files, 90 tests.

- [ ] **Step 6: The gates.** The suite and the typecheck gate.

- [ ] **Step 7: Commit.**

```bash
git add src/providers/openai_live/testing.ts src/providers/openai_live/adapter.ts src/providers/openai_live/adapter.test.ts src/providers/sessionSide.consistency.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_live/testing.ts src/providers/openai_live/adapter.ts src/providers/openai_live/adapter.test.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
feat(openai-live): the adapter over the header seam

One leg, one WebSocket to the Live endpoint opened through the header
seam, the start resolving on session.started within 30 s and a refusal
worded, an invalid voice in OpenAI's own words. Deltas and audio go to
the segments; a push-to-talk release mutes the session and a press
unmutes it; a lost connection is tried again once, a second loss within
60 s, an actionable error or a refused attempt failing the leg in its
words; two equal usage reports are a stall only with 2 s of voiced
audio sent between them, so a push-to-talk tap is none. Stop sends
session.close and closes at once, and the session's expiry ends the
run.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Wave 3 check (controller)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the replay: 588 files passed and 1 skipped, 7 669 tests passed and 2 skipped); the typecheck gate at exactly the baseline; the full tree at 259.

---

### Task 10: The view, the definition and the registration (Wave 4)

**Files:**
- Create: `src/providers/openai_live/LiveSettings.tsx`, `src/providers/openai_live/provider.ts`
- Modify: `src/providers/registry.ts` (the import, `RELEASED`, its comment)
- Test: `src/providers/openai_live/LiveSettings.test.tsx`, `src/providers/openai_live/provider.test.ts` (both new); `src/providers/registry.test.ts` (the order case), `src/providers/openai_translate/provider.test.ts` (its order case)

**Interfaces:**
- Consumes: Task 6's settings side and builder, Task 7's `checkLive`, Task 9's `createLiveAdapter`; `InstructionsField`, `VoiceField` (`src/components/providers/fields/`), `resolveInstructions`, `SettingsProps`, `Provider`; `OpenAIIcon`.
- Produces: `LiveSettingsView`; `openaiLiveProvider: Provider<LiveSettings, LiveCredentials, LiveConfig> & { id: 'openai_live' }`; `RELEASED` with `openaiLiveProvider` after `openaiTranslateProvider`, before `sonioxProvider`.

**What the registration changes elsewhere:** the registry's invariant suite now runs over Live; the setup wizard's own-key path lists Live on the desktop app and the extension, after OpenAI Translate, and its subtitles-only scenario does not grey it (`speech: 'optional'`, as the OpenAI Translate plan found). No wizard file changes: `npx vitest run src/components/SetupWizard` stays green (step 6).

- [ ] **Step 1: Write the failing tests.** Create `src/providers/openai_live/LiveSettings.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback : key;
      return options ? text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name])) : text;
    },
  }),
}));
vi.mock('../../components/Tooltip/Tooltip', () => ({ default: () => null }));

import type { SettingsProps } from '../../lib/provider/types';
import { LiveSettingsView } from './LiveSettings';
import { LIVE_DEFAULTS, type LiveSettings } from './settings';

const props = (patch: Partial<SettingsProps<LiveSettings>> = {}): SettingsProps<LiveSettings> => ({
  settings: LIVE_DEFAULTS,
  update: vi.fn(),
  pair: { source: 'ja', target: 'en' },
  ...patch,
});
const headings = (container: HTMLElement) => Array.from(container.querySelectorAll('.settings-section > h2')).map((h) => h.textContent);

describe('LiveSettingsView (choice 17)', () => {
  it('draws its instructions and its voice, and nothing else: no model, turn detection or noise reduction', () => {
    const { container } = render(<LiveSettingsView {...props()} />);
    expect(headings(container)).toEqual(['settings.systemInstructions', 'settings.voice']);
    expect(screen.queryByLabelText('settings.model')).toBeNull();
    expect(screen.queryByLabelText('settings.noiseReduction')).toBeNull();
  });

  it("previews Quick's prompt for the pair — Auto-detect as the spoken language — and edits its own instructions", () => {
    const update = vi.fn();
    const { container } = render(<LiveSettingsView {...props({ update })} />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.preview' }));
    expect(container.querySelector('.preview-content')?.textContent).toContain('translate Japanese → English.');
    fireEvent.click(screen.getByRole('button', { name: 'settings.advanced' }));
    expect(update).toHaveBeenCalledWith({ useTemplateMode: false });
    const { container: auto } = render(<LiveSettingsView {...props({ pair: { source: 'auto', target: 'zh_CN' } })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.preview' })[1]);
    expect(auto.querySelector('.preview-content')?.textContent).toContain('translate the spoken language → Chinese (China).');
  });

  it('offers the 22 voices and writes the one chosen; locked while a run is not idle', () => {
    const update = vi.fn();
    render(<LiveSettingsView {...props({ update })} />);
    const voice = screen.getByLabelText('settings.voice') as HTMLSelectElement;
    expect(voice.options).toHaveLength(22);
    expect(voice.value).toBe('marin');
    fireEvent.change(voice, { target: { value: 'cinder' } });
    expect(update).toHaveBeenCalledWith({ voice: 'cinder' });
    const { container } = render(<LiveSettingsView {...props({ disabled: true })} />);
    expect((container.querySelector('select[aria-label="settings.voice"]') as HTMLSelectElement).disabled).toBe(true);
  });
});
```

Create `src/providers/openai_live/provider.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { readCredentials } from '../../lib/provider/credentials';
import { AUTO } from '../../lib/provider/languages';
import { contextsFor, gate } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { presentProviders, PROVIDERS } from '../registry';
import { buildLive, describeLive, type LiveConfig } from './config';
import { LiveSettingsView } from './LiveSettings';
import { openaiLiveProvider } from './provider';
import { LIVE_DEFAULTS, LIVE_LEGACY_KEYS, liveCredentials, liveLanguages, migrateLiveSettings, type LiveSettings } from './settings';
import { AUTO_CTX, configFor, KEY, SHARED } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

const both = (pair: { source: string; target: string }, patch: Partial<RunShape> = {}) =>
  ({ provider: openaiLiveProvider, settings: LIVE_DEFAULTS, pair, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false, turnMode: 'auto', ...patch }) as unknown as RunShape;
const noAuth = { signedIn: false, getToken: async () => null };
const env = (platform: 'electron' | 'extension' | 'web') => ({ platform, dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false });

describe('the OpenAI Live definition', () => {
  it('is OpenAI Live with your own key, under its old id and slice, linking the OpenAI setup guide — on the desktop app and the extension only (choice 17)', () => {
    expect(openaiLiveProvider).toMatchObject({
      id: 'openai_live',
      kind: 'own-key',
      platforms: ['electron', 'extension'],
      icon: OpenAIIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',
      settings: { key: 'openaiLive', defaults: LIVE_DEFAULTS, legacyKeys: LIVE_LEGACY_KEYS, migrate: migrateLiveSettings },
      Settings: LiveSettingsView,
      credentials: liveCredentials,
      checkReads: [],
      languages: liveLanguages,
      build: buildLive,
      describe: describeLive,
    });
    for (const absent of ['flagged', 'i18nKey', 'TurnDetection', 'session', 'participantSpeech'] as const) {
      expect(openaiLiveProvider, absent).not.toHaveProperty(absent);
    }
  });

  it('offers Text only (ruling 1), takes no typed text (ruling 9), ends segments on our own timers, and offers both turn modes (ruling 5)', () => {
    expect(openaiLiveProvider.speech).toBe('optional');
    expect(openaiLiveProvider.textInput(LIVE_DEFAULTS)).toBe(false);
    expect(openaiLiveProvider.boundaries(LIVE_DEFAULTS)).toBe('silence');
    expect(openaiLiveProvider.turns(LIVE_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits after OpenAI Translate, before Soniox (ruling 9), and is offered on the desktop app and the extension, never on the web', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids.indexOf('openai_live')).toBe(ids.indexOf('openai_translate') + 1);
    expect(ids.indexOf('openai_live')).toBe(ids.indexOf('soniox') - 1);
    expect(presentProviders(env('electron')).map((p) => p.id)).toContain('openai_live');
    expect(presentProviders(env('extension')).map((p) => p.id)).toContain('openai_live');
    expect(presentProviders(env('web')).map((p) => p.id)).not.toContain('openai_live');
  });

  it("lets the participant speak on its switch, with Other's prompt (ruling 1), and refuses Both for Auto-detect (D20)", () => {
    const participant = contextsFor(both({ source: 'en', target: 'zh_CN' }, { participantSpeech: true })).participant!;
    expect(participant).toEqual({ direction: { source: 'zh_CN', target: 'en' }, speech: true, turns: 'auto' });
    const s: LiveSettings = { ...LIVE_DEFAULTS, useTemplateMode: false, systemInstructions: 'Mine.', participantSystemInstructions: "Other's." };
    expect(openaiLiveProvider.build(participant, s, { ...SHARED, reversed: (d) => d.source === 'zh_CN' && d.target === 'en' })).toMatchObject({ instructions: "Other's." });
    expect(contextsFor(both({ source: 'en', target: 'zh_CN' })).participant!.speech).toBe(false);
    expect(gate(both({ source: AUTO, target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'en', target: 'zh_CN' }), 'electron')).toBeNull();
  });

  it('a start whose signal already aborted registers nothing and opens no socket', async () => {
    const opened = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    const invoke = vi.fn();
    vi.stubGlobal('electronAPI', {});
    vi.stubGlobal('electron', { invoke });
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(openaiLiveProvider.start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    )).rejects.toBe(reason);
    expect(invoke).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it('loads an old profile as it was — the key, the pair, the voice — reading neither the old pauses nor anything else, and writes nothing', async () => {
    stored.set('settings.openaiLive.apiKey', 'sk-proj-oldLiveKey0123');
    stored.set('settings.openaiLive.sourceLanguage', 'ja');
    stored.set('settings.openaiLive.targetLanguage', 'en');
    stored.set('settings.openaiLive.voice', 'cedar');
    stored.set('settings.openaiLive.userSilenceDuration', 900);
    stored.set('settings.common.useTemplateMode', false);
    stored.set('settings.common.systemInstructions', 'Interpret faithfully.');
    await useProviderStore.getState().load(openaiLiveProvider);
    const entry = useProviderStore.getState().entries.openai_live;
    expect(entry.settings as LiveSettings).toEqual({ useTemplateMode: false, systemInstructions: 'Interpret faithfully.', participantSystemInstructions: '', voice: 'cedar' });
    expect(readCredentials(openaiLiveProvider, entry.settings, entry.credentials, noAuth)).toEqual({ apiKey: 'sk-proj-oldLiveKey0123' });
    expect(entry.pair).toEqual({ source: 'ja', target: 'en' });
    const config = openaiLiveProvider.build({ direction: entry.pair, speech: true, turns: 'auto' }, entry.settings as LiveSettings, SHARED) as LiveConfig;
    expect(config).toMatchObject({ model: 'gpt-live-1', voice: 'cedar', instructions: 'Interpret faithfully.', transport: 'websocket' });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('keeps its readiness through a voice or a prompt edit: Start stays on and nothing is listed again; a new key forgets it', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-live-1', created: 1 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = useProviderStore.getState();
    await store.load(openaiLiveProvider);
    store.setCredential(openaiLiveProvider, 'apiKey', 'sk-proj-readyKey0123');
    await store.refreshReadiness(openaiLiveProvider, noAuth);
    expect(useProviderStore.getState().readiness.openai_live).toEqual({ state: 'ready', models: [{ id: 'gpt-live-1' }] });
    store.updateSettings(openaiLiveProvider, { voice: 'coral' });
    store.updateSettings(openaiLiveProvider, { systemInstructions: 'A new prompt.' });
    expect(useProviderStore.getState().readiness.openai_live).toEqual({ state: 'ready', models: [{ id: 'gpt-live-1' }] });
    const entry = useProviderStore.getState().entries.openai_live;
    await store.refreshReadiness(openaiLiveProvider, noAuth, { settings: entry.settings, credentials: entry.credentials, pair: entry.pair, legs: ['speaker'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    store.setCredential(openaiLiveProvider, 'apiKey', 'sk-proj-otherKey0123');
    expect(useProviderStore.getState().readiness.openai_live).toEqual({ state: 'unknown' });
  });
});
```

And place it in the two order cases:

```diff
diff --git a/src/providers/registry.test.ts b/src/providers/registry.test.ts
--- a/src/providers/registry.test.ts
+++ b/src/providers/registry.test.ts
@@ -322,8 +322,8 @@
     const releaseBuild = await import('./registry');
     // each provider plan adds its id where the owner orders it (spec: "one line in the order test").
     // Kizuna Soniox first, unflagged (Stage 2 Kizuna Soniox, ruling 6): the owner's 2026-09-12
-    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), OpenAI Realtime (Stage 2 OpenAI Realtime, ruling 18), OpenAI Translate (Stage 2 OpenAI Translate, ruling 11), Soniox with your own key, and Palabra AI last (Stage 2 Palabra, ruling 14).
-    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox', 'palabraai']);
+    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), OpenAI Realtime (Stage 2 OpenAI Realtime, ruling 18), OpenAI Translate (Stage 2 OpenAI Translate, ruling 11), OpenAI Live (Stage 2 OpenAI Live, ruling 9), Soniox with your own key, and Palabra AI last (Stage 2 Palabra, ruling 14).
+    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'openai_live', 'soniox', 'palabraai']);
   });
 
   it('a development build adds exactly the two fakes', () => {
diff --git a/src/providers/openai_translate/provider.test.ts b/src/providers/openai_translate/provider.test.ts
--- a/src/providers/openai_translate/provider.test.ts
+++ b/src/providers/openai_translate/provider.test.ts
@@ -67,9 +67,10 @@
     expect(openaiTranslateProvider.turns(TRANSLATE_DEFAULTS)).toEqual(['auto', 'manual']);
   });
 
-  it('sits before Soniox (ruling 11)', () => {
+  it('sits before Soniox (ruling 11), OpenAI Live between them (Stage 2 OpenAI Live, ruling 9)', () => {
     const ids = PROVIDERS.map((p) => p.id);
-    expect(ids.indexOf('openai_translate')).toBe(ids.indexOf('soniox') - 1);
+    expect(ids.indexOf('openai_translate')).toBe(ids.indexOf('openai_live') - 1);
+    expect(ids.indexOf('openai_live')).toBe(ids.indexOf('soniox') - 1);
   });
 
   it("lets the participant speak when its switch is on, into the pair's source (ruling 5), and a speaker on Text only not speak (ruling 4)", () => {
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/openai_live/LiveSettings.test.tsx src/providers/openai_live/provider.test.ts src/providers/registry.test.ts src/providers/openai_translate/provider.test.ts`
Expected: FAIL — `Test Files 4 failed (4)`, `Tests 2 failed | 30 passed (32)`: the two new suites fail to resolve `./LiveSettings`; the registry's order case (`expected [ 'kizunaai_soniox', …(7) ] to deeply equal [ 'kizunaai_soniox', …(8) ]`) and OpenAI Translate's (`expected 5 to be -2`: Live is not registered) fail; their other cases pass.

- [ ] **Step 3: Write the view.** Create `src/providers/openai_live/LiveSettings.tsx`:

```tsx
import { InstructionsField } from '../../components/providers/fields/InstructionsField';
import { VoiceField } from '../../components/providers/fields/VoiceField';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { SettingsProps } from '../../lib/provider/types';
import { LIVE_VOICES, liveLanguageName, liveLanguages, type LiveSettings as S } from './settings';

/**
 * OpenAI Live's own settings (D18): what the old tab showed for it once the
 * pair, the key and the speech mode have their generic homes — its
 * instructions, previewed for the pair as `build` resolves them, and the
 * voice (choice 17). No model (it is fixed), no turn detection, no noise
 * reduction: the endpoint has none of them.
 */
export function LiveSettingsView({ settings, update, disabled = false, pair }: SettingsProps<S>) {
  const initial = liveLanguages.initial?.(settings);
  const source = pair?.source ?? initial?.source ?? '';
  const target = pair?.target ?? initial?.target ?? '';
  const preview = resolveInstructions(settings, { participant: false, source: liveLanguageName(source), target: liveLanguageName(target) });
  return (
    <>
      <InstructionsField value={settings} onChange={update} preview={preview} disabled={disabled} />
      <VoiceField value={settings.voice} options={LIVE_VOICES} onChange={(voice) => update({ voice })} disabled={disabled} />
    </>
  );
}
```

- [ ] **Step 4: Write the definition.** Create `src/providers/openai_live/provider.ts`:

```ts
import { OpenAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createLiveAdapter } from './adapter';
import { checkLive } from './check';
import { buildLive, describeLive, type LiveConfig } from './config';
import { LiveSettingsView } from './LiveSettings';
import {
  LIVE_DEFAULTS,
  LIVE_LEGACY_KEYS,
  liveCredentials,
  liveLanguages,
  migrateLiveSettings,
  type LiveCredentials,
  type LiveSettings,
} from './settings';

const adapter = createLiveAdapter();

/**
 * OpenAI Live with the user's own key (Stage 2 OpenAI Live): `gpt-live-1`, a
 * simultaneous interpreter made one by its instructions, one WebSocket per
 * leg. The old enum's id and slice, so a stored selection, the key, the pair
 * and the voice carry over. Its upgrade needs a real `Authorization` header
 * and no `Origin`, which only the desktop app and the extension can set — the
 * header seam (F14; ruling 7) — so it is the first definition without the
 * web (choice 17). The extension's manifest already lists its host and CSP
 * origin (PR #552). Released after OpenAI Translate, unflagged, as the old
 * provider was (ruling 9).
 */
export const openaiLiveProvider: Provider<LiveSettings, LiveCredentials, LiveConfig> & { id: 'openai_live' } = {
  id: 'openai_live',
  kind: 'own-key',
  platforms: ['electron', 'extension'],
  icon: OpenAIIcon,
  // The OpenAI setup guide: the same kind of key. Today's TUTORIAL_URLS value for OpenAI, as a literal (no import from src/services).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/openai-setup',

  settings: { key: 'openaiLive', defaults: LIVE_DEFAULTS, legacyKeys: LIVE_LEGACY_KEYS, migrate: migrateLiveSettings },
  Settings: LiveSettingsView,

  credentials: liveCredentials,
  check: (k, s, ctx) => checkLive(k, s, ctx),
  // The model list reads no setting: a voice or a prompt edit keeps Start on.
  checkReads: [],

  languages: liveLanguages,

  // Text only is offered (ruling 1): the API always speaks — and bills the audio — and a leg that does not speak drops it; the participant speaks on its switch.
  speech: 'optional',
  // An interpreter takes no typed text (ruling 9).
  textInput: () => false,
  // Our own silence timers end segments (the old offer: pause, no auto, sizes).
  boundaries: () => 'silence',
  // Both turn modes: a release mutes the session, a press unmutes it (ruling 5).
  turns: () => ['auto', 'manual'],

  build: buildLive,
  describe: describeLive,
  start: adapter.start,
};
```

- [ ] **Step 5: Register it after OpenAI Translate.**

```diff
diff --git a/src/providers/registry.ts b/src/providers/registry.ts
--- a/src/providers/registry.ts
+++ b/src/providers/registry.ts
@@ -11,14 +11,15 @@
 import { geminiProvider } from './gemini/provider';
 import { localInferenceProvider } from './localInference/provider';
 import { openaiProvider } from './openai/provider';
+import { openaiLiveProvider } from './openai_live/provider';
 import { openaiTranslateProvider } from './openai_translate/provider';
 import { palabraProvider } from './palabraai/provider';
 import { kizunaSonioxProvider } from './soniox/kizuna';
 import { sonioxProvider } from './soniox/provider';
 import { volcengineAst2Provider } from './volcengine_ast2/provider';
 
-/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11; Stage 2 OpenAI Realtime, ruling 18; Stage 2 Palabra, ruling 14): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate, Soniox and Palabra AI with your own key. */
-const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiProvider, openaiTranslateProvider, sonioxProvider, palabraProvider] as const;
+/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11; Stage 2 OpenAI Realtime, ruling 18; Stage 2 Palabra, ruling 14; Stage 2 OpenAI Live, ruling 9): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate, OpenAI Live, Soniox and Palabra AI with your own key. */
+const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiProvider, openaiTranslateProvider, openaiLiveProvider, sonioxProvider, palabraProvider] as const;
 /** Compiled into development builds only (D24): the fake, and the leased fake that carries the session hooks (Stage 2 foundation, choice 1). */
 const DEV_ONLY = [fakeProvider, fakeLeasedProvider] as const;
 
```

- [ ] **Step 6: Run them, and every definition's suite.**

Run: `npx vitest run src/providers/openai_live/LiveSettings.test.tsx src/providers/openai_live/provider.test.ts src/providers/registry.test.ts src/providers/openai_translate/provider.test.ts`
Expected: PASS — 4 files, 42 tests.

Run: `npx vitest run src/providers src/components/SetupWizard`
Expected: PASS — 138 files, 1 982 tests.

- [ ] **Step 7: The gates.** The suite and the typecheck gate.

- [ ] **Step 8: Commit.**

```bash
git add src/providers/openai_live/LiveSettings.tsx src/providers/openai_live/LiveSettings.test.tsx src/providers/openai_live/provider.ts src/providers/openai_live/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/providers/openai_translate/provider.test.ts
```

```bash
git commit -q -F - -- src/providers/openai_live/LiveSettings.tsx src/providers/openai_live/LiveSettings.test.tsx src/providers/openai_live/provider.ts src/providers/openai_live/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/providers/openai_translate/provider.test.ts <<'EOF'
feat(openai-live): the provider, its settings view and its registration

OpenAI Live joins the registry after OpenAI Translate, on the desktop
app and the extension only: its upgrade needs a header the web cannot
set. Text only is offered, typed text is not, both turn modes are, and
its own settings show the instructions and the 22 voices. The old id
and slice carry a stored selection, the key, the pair and the voice
over.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Group check (controller, after Wave 4)

No step types a key into Live's field or presses Start with Live selected: its readiness check would call `/v1/models`. Outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/live-group/`.

- [ ] **The full gates:** `npx vitest run src` at 0 failed with no unhandled errors (the replay: 590 files passed and 1 skipped, 7 679 tests passed and 2 skipped); the typecheck gate at exactly the baseline; the full tree at 259. `npx vitest run src/services`: 49 files, 1 039 tests, unchanged. `npx vitest run electron`: 34 files, 477 tests; `npx vitest run extension`: 9 files, 56 tests.
- [ ] **The builds:** `npm run build`, then `npm run extension:build` (if `extension/node_modules` is missing, `npm ci --prefix extension` first); both exit 0.
- [ ] **The D24 greps** print nothing (Global Constraints).
- [ ] **The new code shipped:** `command grep -rlF 'session.headers' build extension/dist` and `command grep -rlF 'WS_HEADERS_SET' build extension/dist` each name at least one file under `build/` and one under `extension/dist/`; `ls extension/dist/wsHeaderRule.js extension/dist/background.js` lists both, and `command grep -c "from './wsHeaderRule.js'" extension/dist/background.js` prints 1 (its import; the bare file name prints 2, its comment naming it too — Revision 1, the review's M6).
- [ ] **Live's tab, rendered on a faked desktop platform** (choice 19), with a fresh vite (`SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`) driven by `scripts/dev/headless.mjs` with the flags `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required`, on a fresh profile. Before the app loads, `Page.addScriptToEvaluateOnNewDocument` injects the tutorial harness's fake: `window.electronAPI = {}` and a `window.electron` whose `invoke(channel, data)` records the channel and resolves `undefined` — but for the channels the app's audio start-up reads, which the tutorial harness answered: `get-audio-status` `{}`, `supports-system-audio-capture` `false`, `list-system-audio-sources` `[]`, with `on` / `receive` / `send` / `removeAllListeners` no-ops. `Network.enable` records every request. Open Settings before reading its DOM (its panel sits in React's `<Activity>`):
  - the provider picker lists **OpenAI Live** after OpenAI Translate, with the OpenAI icon and the setup guide's link (`…/docs/tutorials/openai-setup`); choosing it shows one "API key" row with its placeholder, empty; Start is off and says the key is missing (`credentials_missing`: "Enter your API key in Settings before starting.");
  - the advanced layout's Provider tab shows the instructions field — its preview naming English and Chinese (China), the initial pair — and the voice select with 22 voices, Marin chosen; no model, turn detection or noise reduction control. Compare each field's markup with OpenAI Realtime's same field (the match-sibling rule). The simple layout shows neither (a provider's own settings are Advanced's);
  - the language picker, in the simple layout: Auto-detect first, then the 55 sources in the old order; 55 targets;
  - the Speech section offers **Text only** (ruling 1), and the turn mode offers push-to-talk (ruling 5);
  - the setup wizard's own-key path lists OpenAI Live after OpenAI Translate;
  - **0 requests to `api.openai.com`**, and the recorded `invoke` channels hold no `ws-headers-set` (the seam registers only at a Start). Screenshots of each.
  - Then the same page with no fake (the web preview): OpenAI Live is **not** offered anywhere — the picker and the wizard.
- [ ] Stop the vite; record the numbers and the screenshots' paths for Task 11.

---

### Task 11: The spec's amendments and the roadmap's record (controller)

The controller's docs task, after the group check. It edits only the spec and the roadmap, and commits them together. Every anchor below is by heading and content; the line numbers, read at `a3eab634`, are hints only — re-read each anchor before editing.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

- [ ] **Step 1: Amend the spec.** Each amendment is marked "(Stage 2 OpenAI Live, ruling / choice N)" in the text, as the earlier plans' are. The survey's §6 items 1–5 are amendments 1–6 below; its item 6 is ruling 1 (not a spec statement), and its item 7 is history.
  1. **"Provider capability", Live's row** (`:1141`, survey §6 item 1): "per audio frame, **exists today**" and "inferred (`end_ms` timeline)" were never true — the old karaoke was by arrival (`OLC:902-915`) and L2 has no timeline rule. Replace the row's two cells with: karaoke "per audio frame, **on the output's timeline**: every output frame advances the output's sample clock by its samples ÷ 24 ms, the noise floor's included; a voiced frame's range is the characters its window's `start_ms` / `end_ms` cover in the segment of the delta whose stamps lie nearest it — interpolated inside a delta, held at its end through a gap — computed as the frame arrives, since the text leads its audio. A real range under D4, not a stated exception: U4 measured the stamps against whisper-1's words at a median of 200 ms and a p90 of 760 ms, and the ranges through L1 match them but for a word whose stamps fall on the stream's floor, which no voiced frame covers and the light passes at its row's next voiced frame (Stage 2 OpenAI Live, ruling 2; choices 9, 10)"; pairing "source cut ↔ translation cut — **stated**, by the translation cuts module, the source cut at a pause of at least the source pause on the input's timeline (rulings 3, 10; choice 6)".
  2. **"Turns" → "What each provider can do", Live's row** (`:508`, survey §6 item 2): "a continuous stream; there are no turns on the wire, no commit and no server VAD; `session.input_audio.mute` / `.unmute`, acknowledged `…muted` / `…unmuted` in about 105 ms (U2)" | "a mute: the pending translation finishes while muted, and a muted session with nothing appended stops billing (U2'); stopping the appends alone does not finish the last sentence (U1); a tap is no stall — two equal usage reports read as one only across 2 s of voiced audio (choice 14)" | "after the model's own finish" — marked (Stage 2 OpenAI Live, ruling 5).
  3. **"The design", Live's row** (`:539`): `beginTurn` "`session.input_audio.unmute`, appends resumed" | `endTurn` "`session.input_audio.mute`, appends dropped until the next press; no tail" | `cancelTurn` "the same mute — what the press appended is the model's input already, and no clear exists" (ruling 5; choice 11). And **"Coverage"** (`:679-685`): after Palabra's sentence, "OpenAI Live's landed with its Stage 2 plan, by mute (ruling 5)."
  4. **"Sockets that need upgrade headers"** (`:1721-1795`, survey §6 items 4, 5), F14 closed:
     - the table: Electron's life "per host and path, **one-shot** — the next upgrade under the path consumes it; a rule with no path, the whole host, as before"; the extension's "**persistent** until cleared — the seam clears it once the upgrade is made, and the worker sweeps its range, and the old Live rule 4000, at start (ruling 11)";
     - the paragraph "What unifies is the interface…": replace "`openSocket(url, { set, remove }) → WebSocket`, one implementation per platform" with "`OpenHeaderSocket(url, { set, remove }, { signal, clock }) → Promise<WebSocket>` (`src/lib/contract/headerSocket.ts`), one registrar per platform — asynchronous, since Electron's registration is an IPC round trip and the extension's a runtime message", and "two legs opening the same host are serialized in one place" with "two legs opening the same host and path are serialized in the seam itself, process-wide in the renderer, each rule cleared before the next leg registers — a registration that never answers is cleared at the holder's own 15 s bound and lets the next leg go, each platform's channel being ordered (Stage 2 OpenAI Live, choice 1)";
     - "OpenAI Live's and Bing's rules set `initiatorDomains`, and Live's is removed once the session has started": append "; the generic pair's rules (`WS_HEADERS_SET`) set it too, answer only the extension's own pages — their base read from `chrome.runtime.getURL('')` — and are removed as soon as the upgrade is made (Stage 2 OpenAI Live, choice 3)";
     - "When OpenAI Live makes the seam's first use, its Electron rule scopes by path…": append "**Done** by the Stage 2 OpenAI Live plan (choice 2): `electron/ws-header-rules.js`, the longest path winning; Edge TTS and the old AST2 client, which send no path, keep a host-wide rule";
     - "F14, the header seam, joins it there when OpenAI Live builds it." → "F14, the header seam, joined it there, built by the Stage 2 OpenAI Live plan (ruling 7; choices 1–3): `headerSocket.ts` and its fake `fakeHeaderSockets`, Electron's `ws-header-rules.js`, and the extension's `WS_HEADERS_SET` / `WS_HEADERS_CLEAR` (`wsHeaderRule.js`). Its first user needs `Authorization: Bearer` set and `Origin` removed (U9)."
  5. **"Session lifecycle" → "A run", "Legs start in parallel"** (`:1970-1971`): "serialized by the socket seam in the provider definition" → "serialized by the header seam in `src/lib/contract/headerSocket.ts`, per host and path (Stage 2 OpenAI Live, choice 1; its survey §6 item 5)".
  6. **"What adding a provider then touches"** (`:1854-1855`, survey §6 item 3): replace "For OpenAI Live that is two code files outside its folder, plus the manifest, against 21 today." with "For OpenAI Live it was its folder, one registry line and two order tests; no locale key and no manifest change (`manifest.json:38, 116` already list its host and CSP origin). What else it touched was first-user work, not a provider's cost: F14 (the seam and its fake, Electron's rules, the extension's pair), the OpenAI helpers lifted at their third user, three members of the translation cuts module and the replay harness's stamps (Stage 2 OpenAI Live, choices 1–5, 18)."
  7. **"The session request", the reconnect paragraph** (`:458-463`): after the Gemini sentence, "OpenAI Live's is one attempt, then `connection_lost`, a second loss within 60 s of the last reconnect not tried again; its header seam registers the rule again for the attempt. A stall is one of its losses: two equal usage reports with 2 s of voiced audio sent between them, so neither a silent room nor a push-to-talk tap reads as one (Stage 2 OpenAI Live, ruling 6; choices 13, 14)."
  8. **L2, the timed-window paragraph** (`:893-903`): "and OpenAI Live may state its origins by the same cuts instead" → "and OpenAI Live states its origins by the same cuts and emits no `timing` (Stage 2 OpenAI Live, ruling 3)".
  9. **"Risks", the inference bullet** (`:2667-2669`): "Doubao AST 2.0 still needs it, and OpenAI Live will unless it states its own" → "Doubao AST 2.0 still needs it; OpenAI Live states its own (Stage 2 OpenAI Live, ruling 3)".
  10. **"Migration", item 9** (`:2501`): append "Ported by the Stage 2 OpenAI Live plan: the old span caps kept, the timeline's pause read at the source pause (ruling 10) as its source rules on `ContinuousSegments`, the `end_ms` timeline as the karaoke's clock, F14 built for it."
  11. **The `frame` bullet** (`:328-366`), before "No frame payload holds a `ws://` or `wss://` URL": "OpenAI Live's need no row either: its three `.delta` frames group under their own type, `session.error`, `session.reconnect_failed` and `session.socket_error` read as errors by their suffix, and none of `session.headers` (the rule's host, path and header names, never a value), `session.start`, `session.started`, `session.usage.updated`, `session.stalled`, `session.closed`, `session.connection_lost`, `session.reconnecting`, `session.reconnected`, `session.unreadable`, `session.unknown`, `session.info`, `session.input_audio.mute` / `.unmute` and their acknowledgements, `translation.cut` or `session.close` is anyone's row; it frames no append, and a close before `session.started` is `session.connection_lost`, OpenAI Translate's name for the same close (Stage 2 OpenAI Live, choice 15)."
- [ ] **Step 2: Write the roadmap's section.** Append `## Scheduled by the Stage 2 OpenAI Live plan` as the roadmap's last section, in the earlier sections' form:
  - **What landed:** the plan's path and commit, the commit range and its `+/−` lines and files (from `git diff --shortstat`), the waves as run, each task's review rounds, the group check with its numbers (the suites, the builds, the D24 greps, the render check's screenshots and its 0 requests); Task 11 is the record.
  - **Departures, stated:**
    - OpenAI Live offers **Text only** (ruling 1), where the old provider could not stop speaking; the participant speaks on its switch;
    - **push-to-talk and push-to-translate** for the first time, by mute (ruling 5);
    - **the karaoke on the output's timeline**, a real range, where the old one was by arrival (ruling 2);
    - **the pairing stated** by the translation cuts module, where the old client inferred it from its own items (ruling 3);
    - **the source cut at a pause of the source pause** (1.5 s by default), no longer the old client's 600 ms gap with its 4 s span nor its short-source grace: longer rows, none left without its translation on the recordings (ruling 10);
    - **a push-to-talk tap is no stall**: 2 s of voiced audio between equal usage reports makes one (choice 14);
    - **the extension's start sweeps the old client's rule id 4000** (ruling 11);
    - **Stop sends `session.close` and does not wait**, where the old client waited up to 5 s for `session.closed` (ruling 8);
    - **the session's expiry ends the run**, where the old client reconnected (ruling 8; research note 13);
    - **no key prefill** from OpenAI Realtime's key (ruling 9);
    - **not on the web** — as before, now by the definition's `platforms` (choice 17);
    - Auto-detect named "the spoken language" in the instructions, where the old client wrote "auto".
  - **Before any release from the branch:** the owner's live test below.
  - **The owner's live test** (own key; switch diagnostic logs on in Help before Start; each item names what settles it):
    1. **The desktop app starts** (ruling 7; U9): select OpenAI Live, a key, 中文 (中国) → English, Start. The Logs show `session.headers` (`host: api.openai.com`, `path: /v1/live/`, `set: ['Authorization']`, `remove: ['Origin']` — names only), `session.start`, `session.started`; the session runs. The main process's console shows "WS headers registered for api.openai.com/v1/live/: Authorization (removing: Origin)". Record the time from Start to `session.started`.
    2. **The extension starts, on Chrome and on Edge** (choice 3): the same on the extension. In the service worker's console, at the Verbose level, "WS header rule registered: ||api.openai.com/v1/live/"; once the session has started, `chrome.declarativeNetRequest.getDynamicRules()` holds no rule with an id in 5000–5099. Then restart the browser without starting a session: still none, and none with id 4000 (the sweep; ruling 11). Then install the extension on Edge and start Live there: it starts as on Chrome — the sender check reads the pages' base from the browser (Revision 1; the review's M2). Record Edge's `chrome.runtime.getURL('')`.
    3. **Nothing else broke in the main process** (Task 1's risk): sign in and out on the desktop app; use a LocalInference voice that speaks through Edge TTS; if the Bing translator is in use, translate with it. Each works as before.
    4. **Pairing** (rulings 3, 10; research note 7): speak the probe's paragraph, or any monologue of six sentences with natural pauses. Each source row states its translation; record every source row left with no translation, and every row whose translation holds the neighbouring sentence or begins mid-sentence. Then in sentence mode with three sentences a row (ruling 4).
    5. **A speaker who pauses at commas** (ruling 10): speak long sentences with pauses of about a second at each comma and longer ones between sentences: rows stay whole — no row ends at a comma's pause — and each has its own translation. Record how long the rows grow, and any translation cut mid-sentence at a row boundary.
    6. **Karaoke** (ruling 2): the speaker leg speaking, watch the lit words against the voice; record rows where the light runs visibly ahead or behind, words it passes over without lighting, and whether the last words of a row stay lit on it while the next row opens (choice 10).
    7. **Text only** (ruling 1; OpenAI Translate's item 5): start with Text only on — the switch is locked while a run is live. There is no audio on the monitor or the virtual microphone; the Logs still show `session.output_audio.delta`; the rows are the same as with speech. The participant leg in Both speaks only with its switch on.
    8. **Push-to-talk** (ruling 5): hold, speak a sentence, release: the translation finishes after the release; the Logs show `session.input_audio.mute` and `session.input_audio.muted` about 0.1 s later; `session.usage.updated`'s `seconds` stops rising within a few seconds; press again: `session.input_audio.unmute` and `…unmuted`, and the next sentence translates. The same in push-to-translate.
    9. **Short taps** (choice 14; the review's I1): under push-to-talk, tap the key several times within a minute, each tap well under a second, some with a word: no `session.stalled`, no `session.reconnecting`, and the leg goes on.
    10. **Both** (U11): speaker and participant together: two `session.headers`, one after the other; each tab its own lines; both translate.
    11. **A lost connection** (ruling 6): turn the network off for five seconds mid-session: `session.connection_lost`, `session.reconnecting`, a second `session.headers`, `session.reconnected`, and the session goes on. Again within a minute: the leg fails with the connection-lost notice. Record each time.
    12. **A start with the network off** (choice 12): with the key already checked, turn the network off and Start: the start fails in the network's words ("OpenAI's socket did not open (check the network, and that the API key is still valid).") within 15 s, or "did not open the connection in time".
    13. **Stop** (ruling 8): Stop mid-sentence: `session.close`, then the runner's `session.stopped`; no `session.error`.
    14. **A silent room** (ruling 6; U3): automatic turns, nobody speaking, three minutes: no `session.stalled`, no reconnect.
    15. **The deferred English → Chinese item** (research notes 5–7): English → 中文 (中国), a few sentences with pauses: record whether the English transcript sends a sentence's "." with the next word (source rows would still not open with ". ": the lead rule), whether a row ends only at a pause of the source pause on English too (ruling 10), and whether rows are left with no translation when the model merges sentences.
    16. **Optional, U13:** close the app abruptly mid-session (kill it); later, compare the account's usage dashboard with the session's last `session.usage.updated`.
    17. **Optional, the expiry** (ruling 8): a session left running two hours ends with `session.closed` (`expired`) and the run's end, no reconnect.
  - **Open questions for the owner:** none; the review's two were ruled (rulings 10, 11), and the live test's findings may raise new ones.
  - **The deletion inventory**, for the plan after the live test (the old code stays compiled and unreachable until then): `src/services/clients/OpenAILiveClient.ts` and its test; `src/services/providers/OpenAILiveProviderConfig.ts` and its test, its registration in `ProviderConfigFactory.ts`, and its rows in `descriptorRegistry.test.ts` and `providerOrder.test.ts`; the pins on the old code the new tests hold — `background.wsHeaders.test.ts`' case "leaves the old OpenAI Live pair as it was" and `src/lib/setup/providerPath.test.ts`' `OPENAI_LIVE` row (Revision 1, the review's N3); the old settings UI's Live branches (`ProviderSpecificSettings.tsx`, `ProviderSection.tsx`, `LanguageSection.tsx`); the `openaiLive` slice and its key prefill in `settingsStore.ts` (the stored keys stay: the new provider reads them); `IClient.ts`' Live members; the background's `OPENAI_LIVE_SET_HEADERS` / `OPENAI_LIVE_CLEAR_HEADERS` pair, `openaiLiveSetDNRHeaders` / `openaiLiveClearDNRHeaders` and their rule ids; `mainPanel.openaiLiveConnectionLost` in the 30 catalogs, if nothing else reads it. Kept: `electron/main.js`' `ws-headers-set` / `ws-headers-clear` (the seam's), `wsHeaderRule.js`' sweep of id 4000 (a profile upgraded from an old build may still hold the rule; ruling 11), `scripts/dev/wire-probe/live.mts` (a research instrument), and the `openai_live` enum value while any old code reads it.
  - **Amend in place** (mark each "**Changed by the Stage 2 OpenAI Live plan** (…)"): the foundation section's "**OpenAI Live:** F14 (reused)" (`:1315`) — F14 built here, its first user; the Volcengine AST2 section's `:3807` ("OpenAI Live's seam will use it"), `:3821` and `:3861` — done, the seam in `src/lib/contract/headerSocket.ts` beside the plain one; the OpenAI Translate section's F14 paragraph (`:4075-4079`) and inheritance rows (`:4418`, `:4446`) — the Electron rule scopes by path now, and `socket.ts` moved without F14 (Palabra); its wizard item (`:4457`) and the OpenAI Realtime section's (`:5189`, `:5336`) — "OpenAI" is true for all three OpenAI providers now, on the desktop app and the extension; the OpenAI Realtime section's F14 paragraph (`:4750-4755`) — the path scope is built; its "copies to lift" (`:5348`) — the decoder and words **done** here (choice 4), with the model check; the translation cuts section's "OpenAI Live's pairing" (`:7173`, `:7252`) — **done** (ruling 3, with its source cut at the source pause, ruling 10).
  - **The roadmap's inheritance, item by item,** **what it leaves** and **the open questions:** the three lists below, as landed.
- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec, roadmap): OpenAI Live on the new structure

F14 is built and closed: the header seam's interface, its serialization
and its platform rules. Live's turns, its karaoke on the output's
timeline, its stated pairing with the source cut at the source pause,
its reconnect and stall watchdog, and what adding it cost.
The roadmap records the port, the owner's live test, the deletion
inventory and the earlier sections' items it settles.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Every item the earlier sections' "What it leaves" lists name OpenAI Live by, and the rules this plan meets: taken (and where), or left (and why).

| Item | Disposition |
|---|---|
| The foundation section: "**OpenAI Live:** F14 (reused); the `connection_lost` alias" (`:1315`) | F14 **built** here, its first user (Tasks 1–3); the alias consumed (Task 9: `failed { code: 'connection_lost' }`) |
| The Volcengine AST2 section: keep `electron/main.js`' generic `ws-headers-set/clear` — "OpenAI Live's seam will use it" (`:3807`) | met: the seam's Electron registrar speaks it, a path now added (Tasks 1, 3; choice 2) |
| The Volcengine AST2 section: "OpenAI Live: F14 (reused) — becomes F14's first user" (`:3821`) and "F14, the header seam, for OpenAI Live" (`:3861`) | met: `src/lib/contract/headerSocket.ts` beside the plain `socket.ts` (Task 3; choice 1) |
| The OpenAI Translate section: F14 stays Live's; "its Electron rule should scope by path (the spec's amendment 10)" — a stale Live rule would reach a Translate upgrade (`:4075-4079`, `:4418`) | met: `ws-header-rules.js`, the longest path winning, and the renderer's key `api.openai.com` + `/v1/live/` (Tasks 1, 3; choices 1, 2) |
| The OpenAI Translate section: "Turns": Translate's row split from OpenAI Live's (`:4086`) | met: Live's rows amended — mute, unmute, no tail (Task 11; ruling 5) |
| The OpenAI Translate section: Translate's `socket.ts` "moves … when F14 lands" (`:4446`) | superseded by the Palabra plan (`:6410`): moved without F14; nothing left |
| The OpenAI Translate section, "Before any release": the wizard's own-key description, "OpenAI Live wait[s] for [its] port" (`:4457`) | met: "OpenAI" is true for all three OpenAI providers on the desktop app and the extension; no locale change (the web offers two of them, as before) |
| The OpenAI Realtime section: F14 stays Live's; the stale per-host rule reaches Realtime's upgrade too, so the seam's rule scopes by path (`:4750-4755`) | met, as the Translate row |
| The OpenAI Realtime section: "The Stage 2 order … Palabra → OpenAI Live → Local Native" (`:5077`) | this plan is the Live step; Local Native is next |
| The OpenAI Realtime section: the wizard's description, "OpenAI Live waits" (`:5189`, `:5336`) | met, as the Translate row |
| The OpenAI Realtime section: F14's owner, `socket.ts` "to move with the others" (`:5310`) | superseded by the Palabra plan (`:6410`) |
| The OpenAI Realtime section, "The copies to lift": `decodeServerEvent`, `errorCode` and `errorWords` at a third user (`:5348`) | **done** at this third user, with the model-list check (Task 4; ruling 9; choice 4) |
| The Palabra section: `socket.ts` lifted without F14, "F14 stays OpenAI Live's and joins it" (`:6410`) | met: the header seam joins it in `src/lib/contract/`, opening its sockets through `nativeSocket` (Task 3) |
| The Palabra section: the silence rule and the re-chunker "at a third user" (`:6436`) | left: Live is not a third user — it needs no real-time silence (U3: with nothing appended there are no frames, no billing and no close within 180 s; a push-to-talk release mutes) |
| The Palabra section: "The seeded lifecycles for the other adapters … each earlier port gains a harness in its own change" (`:6437`) | met for Live: three hundred seeded lives over the header seam's fake (Task 9); the other ports' harnesses stay their own changes |
| The translation cuts section: "OpenAI Live's pairing (its survey, question 3) — `ContinuousSegments` is the candidate; its own plan decides" (`:7173`, `:7252`) | met: ruling 3 — the module, three members added (Tasks 5, 8; choices 5–8) — with the source cut at a pause of the source pause (ruling 10) |
| The translation cuts section, "What it leaves": a sentence-count mismatch until the next real pause | **applies to Live**, changed in kind by ruling 10: under the old rule the first row was left without its translation on two recordings and the rows after it sat a sentence late; under ruling 10 no row is left without its translation, and a translation longer than its row's count runs over into the next row, three times cut mid-sentence there (research note 7); pinned by the replays, left with the deferred item below |
| The translation cuts section, "What it leaves": the one-word audio boundary (audio handed over by arrival) | changed for Live: its audio is placed by the stamps on the output's timeline, not by arrival (choices 9, 10); the translation cuts' boundary stays OpenAI Translate's and Gemini's |
| The translation cuts section, "What it leaves": the guard reads the wall clock | applies to Live's guard too, the module's own (ruling 3) |
| The translation cuts section: **the deferred English → Chinese item** (the owner, 2026-09-30) | **left, tied to it, not fixed** (the brief). Live's recordings are all Chinese → English: the input sends no sentence-final mark (0 of 273 source deltas) and each comma at the head of the next delta after the pause — the item's first half in another script, kept out of the rows by the old client's lead rule (choice 6); the output's late "." (". Anyway") is handled by `translationContinues` (choice 8); the item's second half — a model that merges or splits sentences against the source's count — shows on all three recordings, under ruling 10 as a translation running over into the next row rather than a row left empty (research note 7). English input on Live was not recorded: live-test item 15 |
| The session-end and wizard section: the kit lets an ending frame itself until `stop()` has returned; OpenAI Translate's `session.close`; the runner's `session.stopped` | consumed: Live's `session.close` is framed inside `stop()` (Task 9; ruling 8); the runner's line follows it |
| The OpenAI Translate section's ruling 3 (a recent error's words for the close that follows) and `ERROR_WORDS_MS` | consumed (choice 13) |
| Readiness narrowing (the Realtime section: "each declares its `checkReads` in its own change") | met: `checkReads: []`, pinned by `provider.test.ts`' readiness case |
| A kit-wide "no ws(s) URL in a frame" rule; the seam's fixed words; `trackedClock` | consumed: `session.headers` carries a host and a path, never a URL; the seam's words are fixed; the harness runs on `trackedClock` |

## What this plan leaves

- **Ruling 10's costs** (the owner's, stated with his ruling):
  - **longer rows:** a row runs to the speaker's pause of the source pause — 5, 5 and 3 rows on the recordings, where the old rule made 7, 7 and 5 — and at most to the 12 s cap;
  - **a translation that runs over its row:** the Chinese source has no sentence mark, so each row owes one cut however many sentences its translation holds; a longer translation runs over into the next row, three times of six runs cut mid-sentence there ("It looks like | they put…", "…The owner | seemed…", "…really put | thought into it."), and by the review's count 2, 3 and 2 rows by pause gain or lose a neighbour's clause (research note 7). The translation cuts module's own leftover, "a sentence-count mismatch until the next real pause"; tied to the deferred English → Chinese item. Relating the two stamp clocks (research note 1) to cut by time is not built — the output's clock starts at its first frame, whose offset from the session's is not sent;
  - **English input untested:** whether `gpt-live-1`'s English transcript sends "." with the next word, and how ruling 10's rows read on English, is not known (live-test item 15).
- **No short-source grace** (choice 6): a short row closes at its first arrival pause of the source pause, as a long one does; `holdSource` went with the old rule.
- **A word whose stamps fall on the stream's floor** is never lit: no voiced frame covers it, and the light passes it with its row's next voiced frame (research note 3: " it." on the timeline run, passed 2.5 s late — the karaoke's p90 of 803 ms under ruling 10's rows against the stamps' 760). Filling such a word in later (`speechRanges`) would be a design change.
- **After an unmute the stream picks up where it paused:** its first frame may be the last 100 ms of the word the pending translation had reached, played on that row (the mute run; research note "Found in review", N6).
- **U13, billing after an abrupt close,** was not probed (live-test item 16, optional).
- **A `session.closed` for `content`,** like any unrequested close but the expiry, is tried again once (parity with the old client's reconnect): a moderation close reconnects once before it fails.
- **The extension's sweep runs when the browser or the extension starts,** not at every worker wake: a rule left by a worker that died between set and clear stays until then — scoped to the extension, so no page rides it, and the next set at the same host and path reuses its id. The old client's rule 4000 is swept at the same moments (ruling 11); were the old client somehow running, its rule would go only at the next start, which is harmless.
- **Keys that differ can still overlap** (choice 1; the review's N4): an extension rule for a path also reaches an upgrade under a longer path (`/v1/` and `/v1/live/`), and two app windows or extension pages running Live at once share one rule, one gate per renderer. Only Live uses the seam today.
- **The old `OPENAI_LIVE_*` pair and the old code** stay until the deletion plan (Task 11's inventory).
- **Stamps are kept 60 s behind the audio:** a voiced frame more than a minute behind its text would play rangeless. No recording comes near it.
- **The locale description** `providers.openai_live.description` says "billed per session minute including silence": true while audio is appended, but a push-to-talk release now stops the billing (U2'). No locale change here (no new key, no native-speaker check); a copy change is the owner's call.
- **The seam's cap counts the registration**, so a slow IPC round trip or runtime message shortens the upgrade's share of the 15 s; the start's own 30 s bound still holds around it.

## Open questions for the owner

None. The nine questions are ruled, and the review's two by rulings 10 and 11; what the live test finds (the rows' length and the run-over above all) may raise new ones.


## Self-review

- **Brief coverage.**
  - Rulings 1–9, each restated with its evidence and where it lands (Rulings); the probe facts U10, U12, U11 and U13 carried (Rulings, "Probe facts"; choices 12, 13; What this plan leaves).
  - Ruling 2: the placement defined exactly — the sample clock, gaps and floor included, the nearest stamps, interpolation, the range at emission — and the answer to "adapter or `speechRanges`": the adapter, at emission, because the text leads its audio (research note 2; choice 9); real ranges under D4 (the capability row's amendment).
  - Ruling 3: the probe's rule read (arrival, `translationFollows`) and the guard clock justified (research note 1).
  - Ruling 4: `shared.segmentation` read by the builder; its composition with the module's pause and `SilenceDeferral` stated (choice 7).
  - Ruling 5: the acks' exact names read from the raw log (`session.input_audio.muted` / `.unmuted`).
  - Ruling 7: three parts, each with its own tests and a stated risk (Tasks 1–3), back-compat pinned (a host-wide rule, the old pair untouched).
  - Ruling 8: the session-end pattern and the expiry.
  - Ruling 9: every item, the lifts at `:5348`.
  - The build list: F14's three parts; the provider's files; `platforms` without `'web'`; `textInput: () => false`; regression fixtures (arrival, type, text and stamps, audio length and RMS; no pcm, no key) with replays through the real `segments.ts`, L1 and L2 asserting the pairing and U4's karaoke; tests first everywhere; `runScenario` for all but `text`; `runLifecycles` with the seam's fake, three hundred lives.
  - The docs task: §6's items 1–5 as amendments 1–6, F14 closed, the Turns rows, the capability row, "What adding a provider then touches"; the roadmap section with the live test, what it leaves, the deletion inventory and the inheritance table covering every item that names OpenAI Live in the Translate, Realtime, translation cuts and session-end sections (and the foundation's, AST2's and Palabra's).
  - The group check: builds, the extension and Electron suites, the D24 greps, the new code shipped, a render check of Live's tab on a faked desktop platform with 0 requests to `api.openai.com`.
  - The late-marks check on Live's recorded input: done (research notes 5, 6), recorded as a leftover tied to the deferred item.
- **Revision 1, ruling by ruling** (`revision1-rulings.md`), each with the case that pins it and the mutant it catches:
  - **Ruling 10, the source cut at the source pause** (the owner; I2): `pauseEnds` reads `silence.sourceMs`, the 600 ms / 4 s constants and "twice the pause" gone, the pause's leading mark still the ended row's (Task 8, choice 6). `segments.test.ts`' three source-cut cases — a gap of the pause ends a row whatever it holds; 1 499 ms does not, and the pause is the user's (800 ms cuts at 800); the arrival pause holds no short row a pause more — and `segments.replay.test.ts`' six pinned runs (5 of 5, 5 of 5 and 3 of 3 by pause, as the review measured; the same counts by sentence), none without its translation (mutants M1, M2 the old 600 ms gap, M7 a gap of exactly the pause not cutting). **`holdSource` goes**, stated: it was the old rule's short-source half, and it changed no row on the recordings with or without it (choice 6); Task 5 no longer adds it. Research note 7, choices 5–7, ruling 3's text and the costs in "What this plan leaves" and live-test items 4, 5 and 15 carry it; the shared module gets nothing for it.
  - **Ruling 11, the old rule 4000 swept** (the owner; M5): `OLD_LIVE_RULE_ID` in `sweepIds`, never another block's id (Task 2's sweep case; X8); the worker's comment and wiring case; live-test item 2 checks id 4000 after a restart; the deletion inventory keeps the sweep.
  - **I1, a tap is no stall:** `STALL_VOICED_SAMPLES` (48 000) counted since the last report, reset at each report and at a reconnect (choice 14). The review's reproduction is Task 9's case "a push-to-talk tap between two equal reports is no stall", with repeated taps and a long press just short of 2 s per report; the stall case now sends 2 s (A7 any equal reports, A14 one chunk arms — the first version's rule —, A15 the count kept across reports). Amendments 2 and 7 (the Turns row, the reconnect paragraph) and live-test item 9.
  - **M1, the gate bounded:** the attempt races the registration's answer against its own end, and its `finally` clears what it sent and lets the gate go (choice 1; the seam's header comment corrected). Task 3's new case "a registration that never answers holds the gate no longer than the leg's 15 s" from the review's `seam-gate.test.ts`; the abort-during-registration case now sees the clear at once, and so does the adapter's (S6 the gate held by an unanswered registration, S7 an in-flight registration not cleared).
  - **M2, the sender's base from the browser:** `isExtensionPage(sender, runtimeId, pageBase)`, `background.js` handing in `chrome.runtime.getURL('')` (choice 3). Task 2's case for a base under another scheme and the wiring case (X6 Chrome's scheme assumed, X7 the worker hands in no base); an Edge start in live-test item 2.
  - **M3, M4:** item 7 is OpenAI Translate's item 5, a start with Text only on; the old item 3 is dropped.
  - **M6:** the group check greps `from './wsHeaderRule.js'` and expects 1.
  - **N1:** the three "survey §…" citations dropped from `settings.ts`, `config.ts` and `wire.ts`; the seed's task number stated as the one exception in Global Constraints, as the OpenAI Translate and Palabra plans did. **N2:** `size` a getter in Task 1's Interfaces. **N3:** the two pins on the old code in the deletion inventory. **N4:** overlapping keys in choice 1, the seam's comment and "What this plan leaves". **N5:** the close before `session.started` keeps `session.connection_lost` — OpenAI Translate's name for the same close, which the ruling says to follow — stated in choice 15, the frame bullet's amendment and an adapter comment. **N6:** `segments.replay.test.ts`' mute-gap case: no frame rangeless; after the unmute, the resumed word's last frame on its row, then the new sentence's frames on its own, their ranges running on from its first character.
- **Choices made inside the rulings:** 1–19, listed above; each is cited where it lands. Revision 1 changed choices 1, 3, 5, 6, 7, 14, 15 and 18, each marked.
- **Departures from the brief, each with its reason:**
  - **`replay.testing.ts` is edited** (Task 8), a shared harness: its events carry the stamps and its result the leg, so Live's replays run through the same harness as the translation cuts' — its users unchanged.
  - **`ContinuousSegments` gains `translationContinues` and the `lost` reason** beyond the survey's outline (research notes 4, 5; choice 5): Live's late output marks would otherwise open rows with ". ".
  - **`FLOOR_RMS` and `computeRms` live in `segments.ts`**, not `wire.ts`, so Wave 2's two tasks import nothing of each other.
  - **`vite.config.ts` is touched** (Task 1): the Electron entry map's consistency test requires it (research note 10).
  - **`main.js` and `background.js` are tested on their source text**, not booted (research note 11); their rules are tested as pure modules.
  - **The extension sweeps at `onStartup` and `onInstalled`**, not at every worker wake (What this plan leaves).
  - **A space is restored at the output's utterance joins** (choice 8): not asked by the brief; without it the module's Latin sentence end misses those ends (research note 4).
  - **Revision 1: the source rule is ruling 10's**, a stated departure from ruling 3's "the old client's rules", and **`holdSource` is dropped** with it — the rulings allowed either, asking that it be said (choice 6).
  - **Revision 1: N5 renames nothing.** OpenAI Translate frames the same close `session.connection_lost`, and the ruling says to follow its name where it has one.
- **Probe findings against the rulings' reading:** U5's "7/7, 0 orphaned" is a count from the probe's simpler follow rule; through the real module the first version's rows shifted and left a first row without its translation — ruled by the owner (ruling 10), after which the rows pair whole and a translation may run over into the next row (research note 7). The old design's "deltas arrive ~600 ms after `end_ms`" is contradicted: the text leads its audio (research note 2). The output drops spaces at utterance joins (research note 4). The input and output stamps stand on two clocks (research note 1). Under ruling 10's rows the karaoke's p90 over 198 edges reads 803 ms against the stamps' 760: one word the audio never voices, now counted (research note 3).
- **Placeholders.** None: every new file is the tested scratch copy's, every diff generated from it and applied by `patch -p1` in the replay. The templates are the commit messages' `<implementing model>`, which Global Constraints says to fill in, and Task 11's numbers, filled from the run.
- **Type consistency.** Checked in the scratch copy, where every file compiled — the gate at its baseline and the full tree at 259 after each wave: `OpenHeaderSocket`, `UpgradeHeaders`, `HeaderRule`, `HeaderRegistrar`, `HeaderSocketError.reason`, `HEADER_SOCKET_CAP_MS`, `fakeHeaderSockets` (`open`, `sockets`, `registrations`, `refuseNext`, `holdNext`); `createWsHeaderRules` (`set`, `clear`, `take`, the getter `size`); `WS_HEADERS_SET` / `WS_HEADERS_CLEAR` with `{ host, path, set, remove }`, `ws-headers-set` with `{ host, path, headers, removeHeaders }`; `isExtensionPage(sender, runtimeId, pageBase)`, `OLD_LIVE_RULE_ID`, `sweepIds`; `decodeServerEvent`, `errorCode`, `errorWords`, `OpenAIError`, `createOpenAIModelCheck`; `cutSource`, `translationContinues`, `closeAll`, `CutReason` `'lost'`; `LiveSettings`, `LiveCredentials`, `LiveConfig` (`sentencesPerSegment`, `silence.sourceMs`, `silence.deferMidSentence`), `buildLive`, `liveHeaders`, `sessionStart`, `muteFrame`, `unmuteFrame`, `SESSION_CLOSE`, `stampOf`; `LiveSegments` (`input`, `output`, `audio`, `connectionLost`, `stop`), `SOURCE_CLAUSE_MS`, `SOURCE_CAP_MS`, `FLOOR_RMS`, `computeRms`; `Stamps`, `ReplayResult.leg`; `createLiveAdapter`, `START_TIMEOUT_MS`, `RECONNECT_GRACE_MS`, `ERROR_WORDS_MS`, `STALL_VOICED_SAMPLES`, `NEVER_OPENED`; `openaiLiveProvider` — each spelled the same in every task that names it.
- **The replay,** from this document's own blocks on a fresh copy of `a3eab634`, every red and green count as quoted in each task, and the totals after each wave as in the research notes; Revision 1 replayed the whole plan again. One sequencing fix the first replay found is folded in: the folder's `adapter.ts` seed (Task 6), without which Waves 1 and 2 left the session-side guard's "every provider keeps its adapter in adapter.ts" red.
- **Mutants tried in the scratch copy,** sixty-eight, each run against the suites of the task that owns the code, each failing at least one test (Revision 1's new or changed ones marked †):
  - **Task 1, Electron:** E1 a path rule applies host-wide (1 failing); E2 the shortest path wins (1); E3 not one-shot (2); E4 remove by exact case (1); E5 `main.js` applies no rule (1).
  - **Task 2, the extension:** X1 no `initiatorDomains` (1); X2 any sender is an extension page (2); X3 the sweep takes every rule (1); X4 no sender check in the worker (1); X5 no id reuse (1); X6† the sender check assumes Chrome's scheme (1); X7† the worker hands in no base (1); X8† the sweep skips the old Live rule 4000 (1).
  - **Task 3, the seam:** S1 the rule never cleared (14); S2 no gate (3); S3 no bound (2); S4 the gate let go before the clear (4); S5 an abort during registration opens the socket anyway (4); S6† a registration that never answers holds the gate (2); S7† a registration in flight is not cleared (3).
  - **Task 4, the lifts:** L1 an exhausted quota not a rate limit (2); L2 every model kept (6); L3 one refusal code for every family (2); L4 Realtime loses its segment end (1).
  - **Task 5, the module:** C1 `cutSource` does nothing (3); C3 `translationContinues` counts no end (1); C4 `closeAll` keeps the last source (1); C5 `closeAll` drops nothing with no translation open (1). (The first version's C2, "`holdSource` never asked", went with the option.)
  - **Task 6, the settings:** G1 any voice kept (1); G2 one sentence a segment by sentence (1); G3 Auto-detect named "auto" (2); G4 no mid-sentence deferral (1).
  - **Task 7, the wire:** W1 `Origin` kept (2); W2 `delegation: null` (1); W3 the transcription model kept (3).
  - **Task 8, the segments:** M1† no timeline pause (4); M2† the old 600 ms gap (8); M7† a gap of exactly the source pause does not cut (2); M3 the pause's leading mark dropped (1); M4 every sentence cuts (1); M5 no clause cut (1); M6 no cap (1); M8 no space restored (5); M9 the floor off the clock (5); M10 the latest delta, not the nearest (3); M11 a closed segment's frames hold the open one (2); M12 no interpolation (5); M13 the clock kept across a drop (1); M14 leading marks open the next segment (1). (The first version's M7, "no short-source grace", went with `holdSource`.)
  - **Task 9, the adapter:** A1 a release does not mute (1); A2 appends while muted (1); A3 a press does not unmute (1); A4 no grace (1); A5 an actionable error reconnects (2); A6 the expiry reconnects (2); A7† a stall on any two equal reports (2); A8 no `session.close` (1); A9 a stop leaves the attempt running (2); A10 a refused attempt never in its words (1); A11 an error before the start ignored (2); A12 the timeline kept across a drop (1); A13 the floor framed too (1); A14† one voiced chunk arms the stall — the first version's rule (1); A15† the voiced count kept across reports (1).
  - **Task 10, the definition:** D1 offered on the web (2); D2 the check reads every setting (2); D3 registered after Soniox (3); D4 the view drops the voice (2).
- **Red before green, each measured:** every task's red step ran on the code before it, with the counts quoted. The one case a diff adds that passes before its task's code as after it pins what must not change: Task 2's "leaves the old OpenAI Live pair as it was".
