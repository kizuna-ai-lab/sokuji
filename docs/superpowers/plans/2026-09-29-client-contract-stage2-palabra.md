# Client contract — Stage 2, provider 7: Palabra AI (`palabraai`, platform key or app pair, a WebSocket client from scratch)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Standing of the rulings below.** Rulings 1–18 are **the owner's answers** to the survey's eighteen questions (2026-09-29, in conversation; `palabra-owner-answers.md`), in the survey's order: the platform key straight to the socket and the app pair through a REST session of its own (1); no migration, as stated departures (2); real-time silence after half a second without audio, required (3); the start resolving when the task runs (4); 320 ms chunks (5); karaoke by Soniox's fill-in, the audio replayable (6); Text only offered (7); Palabra's documented language tables (8); a `languages.reverse` hook (9); the settings as the API takes them (10); OpenAI's error rule (11); no reconnect (12); Stop dropping what is in flight (13); unflagged, registered last (14); the kit-level seeded lifecycle scenario with the kit's four parked items (15); the `input` seam deleted (16); the old code's deletion a later plan (17); the setup guide later (18). Rulings 19–21 are his standing decisions the brief names: a WebSocket client written from scratch, the old LiveKit client not ported (19, 2026-09-29); no one-time migration code (20, standing since 2026-09-28; ruling 2 is its application here); and the judging standard, "does adding a new provider get simpler?" (21). Where a ruling left a sub-decision to this plan ("decide and state", "pick the bound and say why"), the answer is a numbered *choice* below, and the self-review lists each. Where the owner's live probe decided something the text says so — "(the owner's probe)", "(the follow-up probe)"; an inference is marked **[inf]**.

**Goal:** Palabra AI — speech to speech, with the user's own platform key or legacy app pair — on the new contract, as a WebSocket client written from scratch, so the owner can run it live and the old LiveKit client can go. Concretely:
- **two ways in** (ruling 1): the platform key dials `wss://streaming.palabra.ai/streaming-api/<random>/v1/speech-to-speech/stream?token=<key>` straight, and the server cleans the session up; the app pair creates a REST session (`POST /session-storage/session`), dials its `ws_url` with the publisher token, and deletes that session — its own, never the account's others — bounded, on every ending, `pagehide` included; a create the leg outlives runs on its own signal and bound, so it still lands and its session is deleted (choice 9). `credentials.choice` keeps both; the readiness check lists the REST sessions, bounded, per mode (choice 16);
- **a start that resolves when the task runs** (ruling 4): `set_task` on open, then `get_task` 2.1 s later and every 2.1 s until `current_task` says `running`; a `set_task` Palabra refuses rejects the start in its words; bounded at 20 s on the request's clock (choice 6);
- **audio up in 320 ms chunks** (ruling 5), and **real-time silence** once no audio has come for 500 ms — one chunk a beat on the request's clock, never ahead of it (ruling 3; choice 7);
- **segments paired by `transcription_id`**, a translation per `translation_part_id`, each chunk of speech on its sentence — attributable and replayable — and **karaoke by Soniox's fill-in** once a sentence's burst is whole (ruling 6; choice 12);
- **Text only** offered: a leg that does not speak sends `output_stream: null` (ruling 7);
- **Palabra's documented languages**, `auto` first, the hidden targets left out (ruling 8), reversed by its documented codes through **a new generic `languages.reverse` hook** that the swap button, the participant leg and `SharedSettings.reversed` all read (ruling 9; choices 3, 5);
- the settings as the API takes them (ruling 10), OpenAI's error rule (ruling 11), no reconnect (ruling 12), Stop dropping what is in flight (ruling 13), registered last and unflagged (ruling 14);
- **shared pieces built at their due users:** the plain socket seam lifted to `src/lib/contract/socket.ts` (fifth user; choice 1), Soniox's `tileSpan` to `src/lib/contract/ranges.ts` (second user; choice 2), the `input` seam deleted (ruling 16), the kit's four parked items (ruling 15; choice 4), **the kit's seeded lifecycle scenario** (`src/lib/contract/testing/lifecycle.ts`, ruling 15), a kit-wide `frame-url` rule with two redaction shapes (choice 10), and the Logs' rows (choice 11).

**The old code is not ported, and not deleted here** (rulings 17, 19): `PalabraAIClient`, its descriptor, the store's Palabra readers and migrations, the old UI's branches, `isPalabraAIEnabled` and its forwarding, and `livekit-client` stay compiled and unreachable once the new definition is registered — the protocol documentation, as every port's old code was. Their deletion is one later plan after the owner's live test; Task 15 records its inventory. The setup guide is updated later (ruling 18): the definition links today's page.

**Architecture:**
- **One folder,** `src/providers/palabraai/` — the id, as every port names its folder (choice 20):
  - the definition's data — `settings.ts` (`S`, its validation and clamps, the voices, the credentials `K` and their choice, the languages and their reverse), `config.ts` (`C`, `build`, `describe`), `check.ts` (one bounded REST list);
  - the session side — `wire.ts` (the URLs, the REST headers and bodies, the task, the audio going up, the server's messages read, an error's code and words; pure), `audioIn.ts` (the 320 ms re-chunker; pure), `items.ts` (messages → segments, paired by sentence, ranged at a burst's end; pure), `adapter.ts` (one leg, one socket);
  - the view — `PalabraSettings.tsx`, `PalabraTurnDetection.tsx`; and `provider.ts`; `testing.ts` holds the suites' fixtures and the harness.
- **No `socket.ts` of its own:** the plain seam is the contract's now (choice 1), and the four copies re-export it.
- **Two contract changes, both optional or deletions:** `languages.reverse?` on the provider definition (ruling 9) — every provider that does not declare it behaves as before, pinned by a registry invariant (choice 3); and `StartRequest.input` / `Source.track` deleted (ruling 16) — nothing read them.
- **The kit grows** (ruling 15): `VirtualClock.pending()`, a `FakeSocket` that refuses what a browser refuses, a flush after every exchange, manual-end's segment check, a timers-left check in every scenario, and `runLifecycles` — the seeded scenario, first run over Palabra's adapter in both credential modes (choice 19).
- **The old Palabra code stays compiled and unreachable** (ruling 17): nothing new imports `src/services`, and the new adapter imports no LiveKit.

**Tech Stack:** TypeScript (strict), React 19, zustand, i18next, Vitest + @testing-library/react (jsdom), the adapter test kit (`FakeSocket`, `driveAdapter`, `runScenario`, the virtual clock, `trackedClock`, and the new `runLifecycles`), a fake REST server answering `Response` objects, the TypeScript compiler API for the wire's credential scan, headless Chromium over the DevTools protocol (`scripts/dev/headless.mjs`) at group check B.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — the binding authority, as amended by the Stage 2 foundation, Soniox, Kizuna Soniox, Gemini, Volcengine AST2, OpenAI Translate and OpenAI Realtime plans and the Gemini/AST2 follow-up. The parts this plan implements: "L0 — the client contract" and "What every adapter must honour" (the seam gone; stop before its first `await`; frames); "Turns" (Palabra's rows, both modes); "The session request" (the participant as the reversed call, by the provider's own reverse; D20); "Provider capability" (Palabra's row: attributable, replayable, stated pairing); "The provider definition" (`languages.reverse`, `credentials.choice`, `checkReads`); "Readiness is one check" (bounded, over REST); "Languages are two functions" (`AUTO`; the reverse); "Sockets that need upgrade headers" (none: the credential rides in the query); "Segmentation is one fact" (`'provider'`); "Persisted settings that move" (nothing converted); "Capture belongs to the runner" (the track seam gone); "Testing" (conformance, the seeded lifecycles). It amends the spec in Task 15.

**Research notes:**
- **The survey this plan is written from:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/stage2-palabra-survey.md`, cited as *survey §x*: §0 (findings), §1 (the old surface), §2 (the proposed shape), §3 (contract and spec deltas), §4 (inherited roadmap items), §5 (the questions, now rulings 1–18), §6 (risks, and the owner's live test). It was read at `a505e5ad`. **This plan is anchored at `024266a0`.** It was first written and replayed at `7ab709e1`, then reviewed on `024266a0` (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/palabra-plan-review.md`: Critical 0, Important 4, Minor 11) and revised on the controller's rulings (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/palabra-plan-rulings.md`). Between `7ab709e1` and `024266a0` the Stage 2 Gemini/AST2 follow-up and the owed-flag fix landed; of the files this plan touches they changed `src/providers/sessionSide.consistency.test.ts` (Task 13), the spec and the roadmap (Task 15) — the rest are as they were. Every file:line this plan relies on was re-read at `024266a0`. Old-code abbreviations: `PAC` = `src/services/clients/PalabraAIClient.ts`, `PPC` = `src/services/providers/PalabraAIProviderConfig.ts`, `PSS` = `src/components/Settings/sections/ProviderSpecificSettings.tsx`.
- **The owner's answers:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/palabra-owner-answers.md` — rulings 1–18 as above. Where they differ from the survey's recommendations (Q7 settled by the follow-up probe; Q8 the documented tables; Q9 the reverse hook), the answers win.
- **The owner's live probe:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/palabra-probe-findings.md` (40 runs over three connect modes, 2026-09-28, and the follow-up of 2026-09-29), its redacted frames `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/palabra-probe/*.jsonl`, and the probe itself, `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/palabra-ws-probe.mjs`. **Its facts override the docs.** What it decided here: the start's poll and bound (choice 6: `set_task` unacknowledged, the first `get_task` 2.1 s later answered `running`, the timings of every stage); the silence rule being required (ruling 3: ten seconds without audio → `SERVICE_TIMEOUT`, then a close 1008; a sentence confirmed only by silence heard after it); Text only (ruling 7: `output_stream: null` → text, no audio); a wrong key being a bare 403 at the upgrade (choice 8); `VALIDATION_ERROR`'s words living in `desc` (choice 8); `translation_part_id` a string in audio and a number in text, bursts of 200 ms chunks, no word timing for CJK (choice 12); `VOICE_NOT_FOUND` on a target with no voice (ruling 11); two sessions on one credential (Both); the session id shaped as a JWT (choices 9, 10); `end_task` delivering its tail (ruling 13 drops it with `force: true`). The fixtures in `testing.ts` use the probe's shapes and texts; the probe redacted every credential, and the fixtures' own are made up.
- **The research report and the language tables:** `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/palabra-research.md` (the docs, the SDKs, the old code), and `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/palabra-research/models-map.json` — the docs' own `source_languages_meta` (58, `auto` included) and `target_languages_meta` (66, three marked `hidden`), each row with its `to_target` / `to_source`. `settings.ts`' two tables are that file's rows, less `hidden` (ruling 8).
- **Found while writing** (at `7ab709e1`, each re-checked at `024266a0`):
  - **Q8 meets Q9 at Chinese:** the documented `to_target` of the source `zh` is the plain target `zh`, which the docs hide. A reverse into a target that is not offered would refuse Both for every pair whose source is Chinese; the hook maps a hidden target to the first offered target of the same source, so `zh → en` reverses to `en → zh-hans`, and `en → zh-hans` to `zh → en-us` (choice 5).
  - **Thirteen offered codes have no documented reverse on one side:** the targets `fil`, `kk`, `mk`, `sr` carry no `to_source` though each is also an offered source, and the sources `eu`, `bn`, `yue`, `ga`, `mt`, `mr`, `mn`, `fa`, `ug` carry no `to_target`. Both refuses such a pair in words (D20), as the docs say; a plain swap would have run the four targets' pairs [inf: the docs may simply be incomplete there]. Of all these, only a source of `bn`, `mr` or `fa` ran Both in the old app — reversed into a target its list held (`PPC:248-306`); those three are no documented targets now (ruling 8), so their Both goes with them. The old source list had no `fil`, `kk`, `mk`, `sr` or `yue` (`PPC:188-240`), and no `eu`, `ga`, `mt`, `mn` or `ug` target.
  - **The hidden targets widen ruling 2's departure, and a source falls elsewhere than a target:** the owner named the stored `vn` / `ba` / `eo` / `ia`. `normalizePair` takes each side's first offered value, and Palabra's first source is Auto-detect: a stored `ba`, `eo` or `ia` source falls to **Auto-detect**, which also refuses Both (D20). A stored `vn` target falls to the first target, **Arabic** — and so does any of six more the old target list held: plain `zh` (its Simplified Chinese), `en-au` and `en-ca` — hidden now — and `bn`, `mr` and `fa`, which the docs do not list as targets (`PPC:248-306`). A stored plain `zh` target is likely the largest group [inf].
  - **The session id is shaped as a JWT** (the owner's probe logged `id` among the create's keys, and its value has a token's shape): the survey's `session.created { id }` frame would carry a token-shaped value. Neither the id nor the publisher is framed; the create is framed with its status alone (choice 9), and `redact()` gains a JWT rule as the net (choice 10).
  - **The survey's `end_task`:** its §2.8 sends none on stop; the brief sends it best-effort. This plan sends `{ force: true }` — the docs' "drop the pipeline and disconnect immediately, without processing the tail" — before the close, never awaited, and frames nothing after (ruling 13; choice 9).
  - **`reverse-audit.mts` passed `{ speaks: true }` and `{ speaks: false }`,** which no language function reads (the field is `speech`): its "speaks" and "text only" rows were the no-context row again. The registry invariant (Task 4) runs the three contexts properly, over each provider's defaults and the settings shapes whose offer differs from them — since the follow-up, Gemini's offer reads its saved model's family (its choice 16) — and holds in every one.
  - **Every word the port shows is an existing key,** each checked present and non-empty in all 30 catalogs at `024266a0` (32 keys, listed in Global Constraints). No new key, no new notice alias.
  - **A browser rejects the body of a request aborted after its answer came** (the review's I1; MDN, fetch(): "If the request is aborted after the fetch() call has been fulfilled but before the response body has been read, then attempting to read the response body will reject with an AbortError exception"). The first draft aborted the app pair's create when the leg ended, and its fake REST server answered a body that ignored the signal, so its test of a late create passed while a browser would leak the session. The create now runs on its own signal and bound (choice 9), and `fakeRest` reads bodies as a browser does. Under the browser-true fake the first draft's adapter fails exactly the revised cases — the app pair's seeded lifecycles ("0 session delete(s) where 1 was due", 8 of 300 runs), the late create, the late and the in-time answers that name only an id, the create's own bound, and the four other revised cases (choices 7 and 8: a release idle at once, ended and cancelled, a wall clock stepped back, `task.not_found`) — 9 failed of 60 — and the review's probe (`palabra-plan-review/tree/review-probes/lateCreate.test.ts`) sees exactly one `DELETE` in both of its timings against the revised adapter, where it saw none.
  - **No audio reaches the adapter while the microphone is muted, or between push-to-talk presses.** A muted capture delivers nothing to any listener: `if (ended || stopping || options.muted()) return;` (`src/lib/audio/capture/core.ts:89`). Under manual turns the runner sends the speaker's audio only while a turn is open (`src/lib/session/run.ts:457-460`, `if (!this.turn?.isOpen) return;`), and a release closes the turn (`src/lib/session/turn.ts:40-43`) before it calls `endTurn()` / `cancelTurn()` (`run.ts:347-351`) — so nothing follows a release until the next press. Hence the silence rule carries every idle, and a release is idle at once (choice 7). The keepalive runs on a timer, and a hidden page throttles timers — Chrome, after about 5 minutes hidden and silent, to about one wake-up a minute [inf: Chrome's intensive wake-up throttling]: then Palabra hears nothing for 10 s and ends the session. Electron's main window is exempt (`backgroundThrottling: false`, `electron/main.js:397`); the extension side panel and the web build are not [inf]. Live-test item 5 measures it.
  - **Each push-to-talk release ran the stream a little further ahead of real time** (the re-review's N1). A release sends what waits at once, padded with silence to a chunk, and the next beat a chunk of silence (choice 7); until the stream kept its own clock nothing took that padding back, so each press left up to a chunk more in the stream than time had passed, and nothing between presses absorbs it — no audio comes then. The re-review's probe (`palabra-plan-review/rereview/lead.test.ts`: 40 presses of 1.2 s, idles of 0.7–1.0 s) measured the round-2 adapter at +4.0 s after 40 presses (+2.9 s with idles of 2.0–2.3 s), where the first draft, which waited `IDLE_MS` after each release, ended 13.6 s behind. Palabra's docs ask for chunks "at the real-time rate" and name a pacing warning, `AUDIO_STREAM_TOO_FAST` (`palabra-research.md:203-210`); a server that paces its input would turn a lead into recognition latency [inf]. With the stream's own clock the same probe ends 0.2 s ahead (0.0 s with the longer idles) and 0.4 s at most along the run — a release's padding, never two chunks. Automatic turns are unchanged: the stream trails real time by what each pause leaves before its first idle beat (−26 s over 40 utterances), which live-test item 5's warnings would show. The round-2 adapter fails the 40-press case (`expected 4014 to be less than or equal to 320`) and the in-time case of choice 9 (an answer that names only an id) — 2 failed of 60.
  - **Other providers keep a session alive on a timer too**, so the throttled page is not Palabra's alone: Soniox's STT stream checks every 5 s and sends a `keepalive` frame after 15 s without audio, against a server that times out at about 20 s (`src/providers/soniox/sttStream.ts:15-17`, `:95-96`, `:245-254`); Soniox's TTS stream keeps alive every 20 s (`src/providers/soniox/ttsStream.ts:167`, `:535`); Doubao AST 2.0 sends an 80 ms silent packet every 80 ms after 250 ms without audio (`src/providers/volcengine_ast2/adapter.ts:278`, `:293-300`; `audioIn.ts:17`, `:25`). Silence that rode the audio clock would cover all of them, and it needs two sites changed: the capture delivering zeros while muted (`core.ts:89` drops a muted chunk), and the runner forwarding zeros — or a capture tick — between presses (its turn gate drops the capture's audio then, `run.ts:457-460`). It is an open question for the owner (Task 15), not built here.
  - **Every file this plan creates or edits is already inside the typecheck gate's regex** (`lib/(session|audio|provider|contract|diagnostics/…redact)`, `providers`, `SetupWizard/providerPaths…`, `stores/logStore`), so the gate's regex needs no widening.
  - **A scratch copy of the tree** (outside the repository) ran every code and test block below before it was written down; each block is that copy's file, and every diff is generated from it against `024266a0` (or, for the two files two tasks edit, against the earlier task's result). The revised plan was then applied again, task by task, to a fresh `git archive 024266a0` — each task's red step first, then its green step, each wave's full gates after it — and the result was byte-identical to the tested tree. The numbers each step expects, and each wave's gates, are that replay's (Global Constraints). Both builds, the extension suite and the Palabra and D24 greps were run on the replay too, at group check A's state and at group check B's.
- **The roadmap:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` (anchors read at `024266a0`) — 1b's F5 item (`:181-182`), 1c-1's and 1c-3's `Source.track` (`:206-209`, `:405`), the foundation plan's Palabra items (`:1196-1201`, `:1299-1302`, `:1321-1325`, `:1352-1363`), the Soniox plan's "Found here" (`:1740-1750`, two of its rows now marked Done by the follow-up), the Volcengine AST2 plan's (`:3775-3780`, `:3807`, `:3849`, `:3855`), the OpenAI Realtime plan's record — the owner's WebRTC decision (`:5060-5104`: the kit-level scenario reassigned, Palabra next), its tables (`:5292-5322`) and "What it leaves" (`:5324-5336`) — and the Gemini/AST2 follow-up's section (`:5339-5731`, its "What it leaves" `:5714-5731`), which says it runs before this plan. Survey §4 lists the earlier items; "The roadmap's inheritance, item by item" below carries each.
- **Form models:** the OpenAI Realtime plan (`docs/superpowers/plans/2026-09-28-client-contract-stage2-openai-realtime.md`) and the Volcengine AST2 plan (two credential modes through `credentials.choice`, a from-scratch socket client, a keepalive of real-time silence). The landed code this port mirrors: `src/providers/volcengine_ast2/` (the keepalive, a refused upgrade), `src/providers/openai_translate/` and `src/providers/openai/` (the leg's skeleton, the error window, the unreadable latches), `src/providers/soniox/speech.ts` (the fill-in), `src/lib/contract/testing/` (the kit). The OpenAI final reviews' and final fix wave's fuzzes (`/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/ort-final-review/fuzz.mts`, `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/ort-final-fix/fuzz.mts`, `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oat-final-review/fuzz.mts`) are the lifecycle scenario's models.

## Global Constraints

- **Starting point.** HEAD `024266a0` on `worktree-client-contract-stage2` (re-anchored from the first draft's `7ab709e1`; research notes). If it moves further, anchor by content, not by line: a line number cited here was read at `024266a0`.
- **Edits shown as diffs.** A change to an existing file is a unified diff with its context lines, generated from the scratch copy (research notes); its hunk headers count the lines at `024266a0` — or, for the two files two tasks edit (`src/providers/registry.test.ts`, Tasks 4 and 14; `src/providers/palabraai/testing.ts`, Tasks 9 and 13), at the earlier task's result. Apply a hunk by its content all the same. A new file is shown in full; `src/providers/palabraai/adapter.ts` is a seed in Task 8 and is replaced whole in Task 13.
- **What this plan touches:**
  - `src/lib/contract/socket.ts` (+ test) and the four copies (`src/providers/{gemini,volcengine_ast2,openai_translate,openai}/socket.ts`) — Task 1;
  - `src/lib/contract/ranges.ts` (+ test), `src/providers/soniox/speech.ts` — Task 2;
  - `src/lib/contract/adapter.ts`, `src/lib/contract/testing/drive.ts`, `src/lib/session/{source,run}.ts`, `src/lib/session/{runner,runner.hooks}.test.ts`, `src/lib/audio/appCapture.ts`, `src/lib/audio/capture/{core,mic,systemAudio,tab}.ts`, `src/lib/audio/capture/{core,mic}.test.ts`, `src/providers/fake/generate.ts` (comments) — Task 3;
  - `src/lib/provider/{types,languages}.ts`, `src/lib/provider/languages.test.ts`, `src/lib/session/{shape,shared,appShape}.ts`, `src/lib/session/{shape,shared}.test.ts`, `src/providers/registry.test.ts` — Task 4;
  - `src/lib/contract/clock.ts` (+ test), `src/lib/contract/testing/{trackedClock,fakeSocket,scenarios}.ts`, `src/lib/contract/testing/{fakeSocket,scenarios}.test.ts` — Task 5;
  - `src/lib/diagnostics/redact.ts` (+ test), `src/lib/contract/conformance.ts` (+ test), `src/stores/logStore.ts` (+ test) — Task 6;
  - `src/lib/contract/testing/lifecycle.ts` (+ test) — Task 7;
  - `src/providers/palabraai/**` (new) — Tasks 8–14;
  - `src/providers/sessionSide.consistency.test.ts` — Task 13;
  - `src/providers/registry.ts` (+ test), `src/components/SetupWizard/providerPaths.test.ts` — Task 14;
  - the spec and the roadmap — Task 15.
- **Read only.** `src/services/**` (the old client, the descriptor and their tests are the protocol's documentation, ported by reading, never imported); the old settings UI (`ProviderSpecificSettings.tsx`, `ProviderSection.tsx`, `LanguageSection.tsx`); `src/stores/settingsStore.ts`, `src/stores/providerStore.ts`; `src/lib/view/**` (every notice and alias exists); `src/lib/provider/{credentials,boundedFetch}.ts`; the 30 locale catalogs (no new key); `electron/**` and `extension/**` (no header, no background change: the extension's CSP already lists `https://*.palabra.ai` and `wss://*.palabra.ai`, `extension/manifest.json:116`); `package.json` and the lockfiles (`livekit-client` and its pin stay until the deletion plan, ruling 17); `CLAUDE.md`. `npx vitest run src/services` stays green.
- **Import rules:**
  - `src/lib/**` never imports React or `src/app/**`. `src/lib/contract/testing/**` is test-only; so is `src/providers/palabraai/testing.ts` (the session-side guard's kit rule).
  - A provider's session side — `adapter.ts` and every file of its folder it reaches by a value import — imports no store and no reporter and runs no global timer: every timer reads the request's clock (`clock.setTimeout`, `every(clock, …)`, `clock.now()`). Palabra's session side is exactly `adapter.ts`, `audioIn.ts`, `items.ts` and `wire.ts` (pinned by Task 13); `adapter.ts` and `wire.ts` import `config.ts` and `settings.ts` **as types only**. `check.ts` is the settings side and keeps its own clock; nothing on the session side imports it.
  - New code imports nothing from `src/services/**`, `src/stores/settingsStore`, another provider's folder or `livekit-client` (ruling 19). A shared piece a second provider needs is lifted to `src/lib/` first (choices 1, 2). Both fakes reach a bundle only through the registry's `import.meta.env.DEV` literal (D24).
- **Diagnostics** (CLAUDE.md, "Error Handling"): the adapter never reports and never logs; it says what happened through `failed`, `degraded` (`parse_error`, `voice_fallback`) and `frame`. A socket's `error` event, a mid-session server `error` and every `warning` are Logs lines (ruling 11). The check throws when it could not find out; the readiness store reports it.
- **Secrets.** The plan and its fixtures carry no credential: the owner's key appears nowhere, and every credential in `testing.ts` is made up (`plbr_testKey0123456789abcdef`, an app pair of no key shape, and JWT-shaped strings whose payloads read `{"sub":"session","room":"test"}`). A credential is read in four functions of `wire.ts` alone — `restHeaders`, `directUrl`, `readCreated`, `sessionUrl` (pinned by a TypeScript-AST scan, Task 9) — and the adapter reads no more of the credentials than their `kind`, which picks the path. No frame, error, notice or log line of ours carries a URL (the kit's new `frame-url` rule, choice 10), a key, the publisher token or the session id (choice 9). `redact()` masks the query's `token`, a bare `plbr_…` key and a JWT wherever one reaches a sink anyway (choice 10). A browser that refuses the socket quotes its URL, the credential in it: the seam rethrows in fixed words (choice 1), and the start rejects in them.
- **Frames** (choice 17) are `domain.event`, never audio, never a credential, never a URL: out — `session.create`, `task.set` (the task as sent: nothing secret in it), `task.get`, `audio.idle` (`{ sinceMs }`), `audio.resumed`, `turn.flush` (`{ ms, cancelled? }`); in — `session.create_failed` (`{ status?, message }`), `session.created` (`{ status }`), `session.opened` (`{ path: 'key' | 'session' }`), `task.not_found` (before the task runs: the expected answer to an early ask, choice 8), `task.current` (`{ status }`), `transcription.partial` / `transcription.validated` (`{ id, text, start, end }`, the latter with `language`), `translation.partial` / `translation.final` (`{ id, part, text }`, the latter with `language`), `audio.output` (`{ id, part, last, samples }`), `session.warning` (`{ code, message }`), `session.error` (`{ code, desc, msg, param }`), `session.end_of_stream`, `session.unknown` (`{ type }`), `session.unreadable` (`{ message }`), `session.socket_error`, `session.connection_lost` (`{ code, reason }`). No frame per chunk going up (the hot-path rule); nothing after a stop or an ending (the kit's `stop-silence`, `ended-silence`); the REST delete is never framed (it may run after the leg has ended).
- **Locales.** No new key, and no new notice alias. Every word is an existing key — 32 in all, each checked present and non-empty in all 30 catalogs at `024266a0`: the view's `settings.{voice,voiceTooltip,speechProcessing,sentenceSplitter,translatePartialTranscriptions,enabled,disabled,queueConfiguration,desiredQueueLevel,maxQueueLevel,autoTempo}`, the turn detection's `settings.{vadSettings,silenceThreshold}`; the credentials' `setup.credentials.apiKey` and `providers.palabraai.{apiKeyPlaceholder,clientIdPlaceholder,clientSecretPlaceholder,authModePlatform,authModeApp}`; the definition's `providers.palabraai.{name,description}`; the notices `notices.{auth,rate_limit,network,server,client,credentials_missing,participant_unsupported,parse_error,voice_fallback}` and the alias `connection_lost` → `mainPanel.sonioxConnectionLost`; the picker's `common.autoDetect`. The three English-only tooltips of the old Palabra block are dropped (ruling 10), not localized.
- **No network.** No test, probe or step calls Palabra. The adapter is tested over `FakeSocket` and a fake REST server on a virtual clock; the check over a stub `fetch`. No group check types a credential into Palabra's fields (the readiness driver would call `GET /session-storage/sessions` 800 ms later) or presses Start with it selected.
- **Gates for every task:**
  - **The suite.** `npx vitest run src` shows 0 failed and no unhandled errors. Measured at `024266a0` on 2026-09-29: **557 test files passed and 1 skipped (558); 7 125 tests passed and 2 skipped (7 127); no unhandled errors.** The replay after each wave (research notes): after Wave 1, 559 files passed and 1 skipped, 7 151 tests passed and 2 skipped; after Wave 2, 562 and 1, 7 180 and 2; after Wave 3, 566 and 1, 7 209 and 2; after Wave 4, 568 and 1, 7 227 and 2; after Wave 5, 569 and 1, 7 287 and 2; with every task, **570 files passed and 1 skipped, 7 296 tests passed and 2 skipped, 0 failed, no unhandled errors**; the typecheck at exactly the gate's 20 lines and 259 in the full tree after every wave — references, not the gate: the gate is the rule. (The `Not implemented: window.open` stderr lines and their React stack traces are pre-existing, `ChildWindowPopover`'s: 13, as at `024266a0`.)
  - **The typecheck.** The gate prints exactly the baseline lines below. The shell's `grep` is a ugrep wrapper that mis-parses this regex, so use `command grep` exactly as written. The regex is the Volcengine AST2 plan's, unchanged: every file this plan creates or edits is already inside it (research notes). The controller runs the same bytes as `zsh /home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate.sh` and compares with `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/oar-gate-baseline.txt`.

    ```
    npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts|diagnostics/(consoleLedger|clientDiagnostics|redact))|lib/modern-audio/BaseAudioRecorder|providers|services/(clients/(SonioxSttStream|SonioxTtsStream|PcmMixer|SonioxSideTracker|SonioxTtsRest|SonioxVoicesClient|SonioxClient|ManagedVoicesClient|managedVoicePolling|VolcengineAST2Client|volcengine-ast2/ast2-proto\.d)|providers/(SonioxProviderConfig|KizunaAISonioxProviderConfig|managedVoicePrep|managedVoicePrep\.test|prepareToStart\.kizunaSoniox\.test))\.ts|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.|panel/|SessionCountdown)|MainLayout/(MainLayout|useSignInProviderSwitch)|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/((SpeechSection|VoiceLibrarySection)(\.test)?\.tsx|(ParticipantSpeechSwitch(\.test)?|SentenceSegmentationSection|SystemAudioSection|SonioxVoiceSection|ProviderSpecificSettings)\.tsx|voiceLibrarySource(\.test)?\.ts))|SettingsInitializer/|SetupWizard/(SetupWizard(\.test)?\.tsx|(setupDraft|applySetup|useApplySetup)(\.test)?\.ts|providerPaths(\.test|\.managedFit\.test)?\.ts|steps/(StepLanguagePair|StepLanguagePair\.test|StepCredentials|StepCredentials\.test|StepFinish|StepProviderPath|StepScenario)\.tsx)|TitleBar/(AccountButton(\.test)?\.tsx|useBalanceShortfall)|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview|wireTally|gapCounter))|contexts/UserProfileContext|locales/(index\.ts|showLanguageUncached)|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|accountStore|logStore|settingsStore\.ts)|utils/(environment|conversationExport)|subtitle-overlay-entry|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
    ```

    **The baseline** — exactly these **20** lines, re-measured at `024266a0` (the Realtime plan's own 20; **259** lines in the full tree, the ceiling):

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

    Do not fix them; do not add to them. The full tree's count (`npx tsc --noEmit -p tsconfig.json 2>&1 | command grep -c 'error TS'`) stays at 259. The TS lib is ES2020: no `Array.prototype.at` in a test either.
  - **Gates in a parallel wave** (as the earlier Stage 2 plans). Waves run tasks at once in this one working tree, so each task sees the others' red phases:
    - a test failure, or an extra gate line, in a file another concurrent task is changing is that task's work in progress: the implementer names it in the report and never touches it;
    - the task's own files must be green, and the gate must print the baseline plus only such named lines;
    - after each wave the controller runs the full gates: the suite at 0 failed with no unhandled errors, the exact baseline, and the full tree at 259.
  - **A task edits only the files in its Files list**, and commits exactly those. Where a step names tests elsewhere that its change could reach, it names why each stays green. If one fails anyway, the implementer stops, reports the failure with its output, and leaves the file untouched: the controller decides. No task edits a read-only file or a file another task of the same wave edits.
  - **No task mutates the tree to prove a guard, and no temporary file is written inside `src/`** (the Translate execution's lesson). Every guard proves itself with controls inside its own test; a mutant a reviewer wants to try runs in a scratch copy under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`.
- **Builds, at the group checks only** (the controller's):
  - `npm run build` and `npm run extension:build`. If `extension/node_modules` is missing, run `npm ci --prefix extension` first.
  - `npx vitest run extension`.
  - The D24 check: each of these prints nothing —
    - `command grep -rlF 'The fake degraded its speech' build extension/dist`
    - `command grep -rlF 'Lease ended by the leased fake' build extension/dist`
    - `command grep -rlF 'The leased fake refused the lease' build extension/dist`
  - The Palabra check: `command grep -rlF 'task.current' build extension/dist` — at group check A it prints nothing (the adapter is not registered yet); at group check B it names at least one file under `build/` and one under `extension/dist/`, the new adapter shipped in both. Nothing under `src`, `electron` or `extension` holds that string at `024266a0` (checked); Task 6's `logStore.test.ts` case, which names it, is a test.
- **Dev servers, probes and builds** are the controller's; an implementer never starts one. Checks run against a fresh vite: `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`. Restart it after edits: a worktree's vite can serve stale transforms.
- **Shell forms.** This worktree's guard refuses compound shell forms: brace groups, loops, `cd … &&` chains. Every command in this plan is a single command or a plain pipeline, run as its own call from the worktree root. Use `command grep`. The shell is zsh: quote globs; `echo ====` is an error. Checks write their outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/`, never `/tmp`, each agent in a directory named for its task and role (`t13-impl/`, `t9-review/`).
- **Commits:**
  - Conventional, in English. Every message ends with the implementing model's own `Co-Authored-By:` line, then `Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe`, and nothing after it. The examples below write the first as `Co-Authored-By: <implementing model> <noreply@anthropic.com>`: fill in your own model's name.
  - Run `git add <paths>`, then `git commit -q -F - -- <the same paths> <<'EOF' … EOF`, as two separate calls. The `--` pathspec is mandatory: parallel tasks stage into the same index. Never stage a whole directory that is not wholly the task's.
  - Production comments cite rulings, choices, D rulings and F items — never a task number or a review finding. The one exception is Task 8's `adapter.ts` seed, which Task 13 replaces.
  - Never push.

## Rulings

Cited as *ruling N*. Rulings 1–18 are the owner's answers (2026-09-29); 19–21 his standing decisions. Each is restated with where it lands.

1. **Two ways in, both kept** (Q1 B). The platform key connects directly: `wss://streaming.palabra.ai/streaming-api/<random>/v1/speech-to-speech/stream?token=<key>`, and the server cleans the session up when the socket closes. The legacy app pair takes REST: `POST https://api.palabra.ai/session-storage/session` `{ data: { intent: 'api' } }` with `ClientId` / `ClientSecret`, then `ws_url?token=<publisher>`, then our own `DELETE /session-storage/sessions/{id}` — only our own (the old delete-all ended Both's other leg), bounded, also on `pagehide`. `credentials.choice` keeps both, as AST2's. The check is REST: `GET /session-storage/sessions`, bounded, per mode. Lands in: Task 8 (`K`, `fields`, `choice`), Task 9 (the URLs, the headers, the create's answer), Task 12 (the check), Task 13 (the two paths; choice 9), Task 14 (`checkReads: ['authMode']`).
2. **No migration, as stated departures** (Q2 (a)). A profile from before 2026-07-30, which stored app credentials and no `authMode`, opens in the platform mode — one click on the app pair's option, and the pair it kept reads again. A stored `vn` target and `ba` / `eo` / `ia` sources — and any code the documented tables do not offer — fall to the list's first entry, as every unoffered stored value does (`normalizePair`): a source to Auto-detect, which also refuses Both, a target to Arabic. `S` has no `legacyKeys` and the languages no `migratePair`; F5 stays in the tree for its other users, its comments no longer naming Palabra as its reason. Lands in: Task 4 (the two comments), Task 8 (`migratePalabraSettings`), Task 14 (the old profile's cases), Task 15 (the departures).
3. **Real-time silence while no audio comes — required** (Q3 (a)). Once no audio has come for about half a second, the adapter sends silence, 320 ms per 320 ms: ten seconds without input is `SERVICE_TIMEOUT` and a close 1008, and a sentence is confirmed only by silence heard after it (the follow-up probe). The timer discipline, and what happens when audio resumes between beats, are choice 7. Lands in: Task 9 (`IDLE_MS`, `SILENCE`, the flush), Task 13 (the keepalive).
4. **The start resolves when the task runs** (Q4 (a)): `get_task` → `current_task` with `task_status: 'running'`, first asked about 2 s after `set_task`, then every 2 s (the docs' rate: one `set_task` or `get_task` per 2 s); a refused `set_task` rejects the start in Palabra's words (in `desc`: the probe shows no top-level `msg`); `NOT_FOUND` answers are expected, not failures; bounded on the request's clock. The bound and the cadence are choice 6. Lands in: Task 9 (`setTask`, `GET_TASK`, `NOT_FOUND`, `validationWords`), Task 13.
5. **320 ms chunks** (Q5 (a)): the input re-chunked to the docs' and the probe's chunk. Lands in: Task 9 (`Rechunker`), Task 13.
6. **Karaoke by Soniox's fill-in, the audio replayable** (Q6 (b)): at a sentence's `last_chunk`, `speechRanges` tiles its translation's text over its chunks by sample count; each chunk is audio on its sentence's translation — attributable, so replayable (spec D3 amended). Lands in: Task 2 (`tileSpan` lifted), Task 11 (`items.ts`; choice 12), Task 13, Task 15 (D3).
7. **Text only is offered: `speech: 'optional'`** (Q7, settled by the follow-up probe): a leg that does not speak sends `output_stream: null` and gets the text alone. Lands in: Task 8 (`C.speech`), Task 9 (`setTask`), Task 13 (speech the leg did not ask for is not played), Task 14.
8. **Palabra's documented languages** (Q8, confirmed by the owner): the offer is the docs' `source_languages_meta` and `target_languages_meta` minus the entries marked hidden — `auto` a source, with Auto-detect's existing rules (Both refused in words, as OpenAI Realtime's); `bn`, `mr` and `fa` not targets; `en-au`, `en-ca` and plain `zh` not offered. Lands in: Task 8 (the tables; choice 13), Task 14 (the gate's refusals).
9. **A `languages.reverse` hook** (Q9 (b)): optional on the provider definition, the plain swap by default; `reverseSupported`, `swapped` and the participant's direction go through it; Palabra's uses its documented `to_source` (target → source: `en-us` → `en`) and `to_target` (source → target: `en` → `en-us`). Pinned generically: no provider without a hook offers a target outside its sources. Spec D20 amended. Lands in: Task 4 (choice 3), Task 8 (Palabra's; choice 5), Task 14, Task 15.
10. **The settings as the API takes them** (Q10): the silence threshold's floor 0.3; the max buffer kept above the target — the max slider's minimum follows the target, and the builder raises a stored max that is not above it; timbre detection always off (a stated departure); our buffer defaults (8 000 / 24 000 ms, adaptive speed off); the three English-only tooltips dropped. Lands in: Task 8 (the clamps; choice 14), Task 9 (the task), Task 10 (the view; choice 15), Task 15.
11. **OpenAI's error rule** (Q11): an `error` is a red `session.error` Logs line, its words kept for a close within `ERROR_WORDS_MS` (10 s) — so `SERVICE_TIMEOUT`'s 1008 reads in its words, and a bare 1008, the connection limit, in its own; `VOICE_NOT_FOUND` → the `voice_fallback` notice, once per session; `AUDIO_STREAM_*` → Logs only. Lands in: Task 6 (the Logs), Task 9 (`errorWords`, `errorCode`), Task 13 (choice 8).
12. **No reconnect** (Q12): a drop ends the run in words. Lands in: Task 13.
13. **Stop drops what is in flight** (Q13): `stop()` closes before its first `await`; `end_task` is sent best-effort, never awaited. Lands in: Task 9 (`END_TASK`), Task 13 (choice 9).
14. **Unflagged, registered last**, after Soniox (Q14); `VITE_ENABLE_PALABRA_AI` retires with the old code. Lands in: Task 14.
15. **The kit-level seeded lifecycle scenario, now** (Q15), in `src/lib/contract/testing/`, first run over Palabra's adapter, with the kit's four parked items (`{ flush: true }` after an awaited answer, `FakeSocket`'s close codes, the clock's `pending()` count, manual-end's segment check), modelled on the OpenAI final reviews' fuzzes. Lands in: Task 5 (choice 4), Task 7, Task 13 (choice 19).
16. **`StartRequest.input` and the runner's `Source.track` threading are deleted** (Q16): no adapter sends a native track. Lands in: Task 3.
17. **The old code's deletion is a later plan**, after the owner's live test (Q17): this plan records its inventory only — the old client, the descriptor, the store's readers and migrations, the old UI's branches, `isPalabraAIEnabled` and its forwarding, the logStore rows, `livekit-client` and its pin with CLAUDE.md's text, `WebRTCAudioBridge.ts`'s LiveKit import. Lands in: Task 15.
18. **The setup guide later** (Q18): the definition links today's page. Lands in: Task 14.
19. **A WebSocket client written from scratch; the old LiveKit client not ported** (2026-09-29). Lands in: every Palabra task — nothing new imports `src/services` or `livekit-client`.
20. **No one-time migration code** (standing, 2026-09-28): stored values the new code cannot read fall to their defaults, as stated departures. Lands in: Tasks 4, 8, 14 (ruling 2 is its application).
21. **The judging standard: does adding a new provider get simpler?** Lands in: the shared pieces lifted or built at their due users (Tasks 1, 2, 4, 5, 7) rather than copied into the folder; Task 15's record weighs what the next port inherits.

## Choices this plan makes inside the rulings

Cited as *choice N*.

1. **The plain socket seam lifted to `src/lib/contract/socket.ts`** at its fifth user: `OpenSocket = (url, protocols?) => WebSocket`; `nativeSocket` dials `new WebSocket(url)` when no protocols are asked for and `new WebSocket(url, protocols)` otherwise, and rethrows a constructor's failure as `The browser would not open the socket (<name>).` with the name kept — a browser quotes the URL or the subprotocols, either of which may carry a credential; `WS_OPEN`. Gemini's, Doubao AST 2.0's, OpenAI Translate's and OpenAI Realtime's `socket.ts` each keep their own `OpenSocket` type — their adapters' deps and their tests' stubs (`(_url, protocols: string[]) => …`) are typed by it — and re-export `nativeSocket` and `WS_OPEN`, so every importer of theirs is unchanged and their suites are the net. Soniox's seam stays its own (it rethrows nothing, and the old client's streams read it). Palabra has no `socket.ts`. F14, the header seam, joins this module when OpenAI Live builds it.
2. **`tileSpan` lifted to `src/lib/contract/ranges.ts`** at its second user (ruling 6), byte for byte Soniox's (`speech.ts:36-59`): a provider never imports another provider's folder. `soniox/speech.ts` imports it and re-exports it, so its importers are unchanged; the lib's own test pins the tiling, the last range's end, the surrogate pair, a chunk whose share rounds to nothing, and a sentence tiled over a burst of 200 ms chunks.
3. **The reverse hook's shape** (ruling 9): `languages.reverse?(pair, s): LanguagePair | null` on the provider definition, `null` for a pair with no reverse. **`reversedPair(p, s, pair)`** in `src/lib/provider/languages.ts` is the one door — the hook where the provider states one, else the plain swap. `reverseSupported` asks whether the reversed pair is offered (its source among the sources, its target among that source's targets); `swapped` returns it, or null when it is not offered or is the same pair; `contextsFor` gives the participant it (the gate refused a pair with none first; the plain swap answers only a shape nothing gated); `buildSharedSettings` takes the participant's direction, not the pair, so `SharedSettings.reversed` names it — `appShape.ts` passes `reversedPair(…)`. A registry invariant pins what the controller's audit found: **a provider with no reverse of its own offers no target outside its sources, in every settings shape its offer reads and every language context** — so the plain swap reverses what it offers, and a provider that ever breaks that must state its reverse. The shapes are declared by name: each provider's defaults, and Gemini's three whose offers differ (Live Translate's, a 2.5 native-audio dialogue model's, a 3.x Live dialogue model's — its offer reads the saved model's family since the follow-up, its choice 16); a control checks the declared shapes reach both of Gemini's offers, so the list cannot go stale unseen. It holds for every registered provider in every shape (Palabra is skipped: it states its own).
4. **The kit's four parked items, as built** (ruling 15):
   - `VirtualClock.pending()`: the timers armed and not yet fired or cancelled — a fired timer counts no longer, a second cancel counts nothing, an `every()` still running never reaches zero; `trackedClock` passes it through;
   - `FakeSocket` refuses what a browser refuses — `close(code)` outside `1000` and `3000–4999` throws `InvalidAccessError`, a reason over 123 UTF-8 bytes `SyntaxError`, before anything closes — and a server's close frame is clean whatever its code (1008 included), where it was clean only at 1000; 1005, 1006 and 1015 arrive unclean, as no frame carries them; `serverClose` with a code no browser reports throws: the test is wrong. One existing case changes with it (a 1011 is clean now);
   - `runScenario` appends `{ flush: true }` to the harness's exchange before a server close or a reconnect, so an answer after an `await` lands before the close;
   - `manual-end` checks that the release and the exchange produced a segment;
   - and every scenario that did not hang checks `clock.pending()` is zero once the session has ended and the clock has run on — the parked item's point: an interval that outlives its session. Every registered provider's conformance passes the stricter kit.
5. **A hidden target in Palabra's reverse** (ruling 9 meets ruling 8): the hook maps a documented `to_target` the docs hide to the first offered target of the same source — `zh`'s `zh` becomes `zh-hans` — so a Chinese source reverses at all.
6. **The start's bound and cadence** (ruling 4): `POLL_MS = 2 100` — the docs allow one `set_task` or `get_task` per 2 s, counted together, and the probe asked 2.1 s after `set_task` and was answered `running` every run; asking at exactly 2 s would race the limit on a late timer. `START_TIMEOUT_MS = 20 000` on the request's clock, armed with the abort before anything opens: twice the sum of each stage's slowest time in the probe — a REST create up to 2.8 s (measured with a key; the app pair's took ~0.32 s, and the platform key's path makes none), the upgrade up to 4.0 s, the task running at the first ask 2.1 s after it opened — 8.9 s, rounded up: generous for either path. It rejects `network` when the socket never opened ("Palabra did not open the connection within 20 s.") and `server` when it did ("Palabra did not start the task within 20 s."), and closes the socket and deletes a created REST session on the way.
7. **The silence rule's discipline** (ruling 3): `IDLE_MS = 500` — past the capture's 85.3 ms chunk and the ScriptProcessor fallback's 341 ms one, so a gap between two chunks of speech is never taken for an idle (the gap AST2's 250 ms left open, roadmap:3779). One `every(clock, CHUNK_MS)` beat runs from the start to the end, on the request's clock: a beat that finds audio within `IDLE_MS` sends nothing; the first idle beat frames `audio.idle` and sends what waits in the re-chunker, padded with silence to a chunk — or, when nothing waits, a chunk of silence — and each later idle beat one chunk of silence, on `every()`'s drift-free grid. **The stream keeps its own clock** (the re-review's N1): it counts what has gone up since the leg went live — 320 ms a chunk, whether audio, a padded remainder or silence — and an idle beat sends silence only while that count is not ahead of the time since then. So silence never takes the stream more than one chunk past real time: the audio itself comes in real time, and a release's padded remainder may add up to one chunk more, which the next beats absorb by sending nothing. **Audio that resumes mid-silence** starts a chunk of its own — what waited went up when the idle began, so no silence is spliced into speech — frames `audio.resumed` once, and the next beat finds the audio recent and sends nothing. **A push-to-talk release is idle from the next beat** (the controller's ruling on the review's m11): no audio reaches the adapter between presses (`src/lib/session/run.ts:457-460`; `turn.ts:40-43` closes the turn before `endTurn()` / `cancelTurn()`), so the padded remainder goes up at the release and silence at the next beat — within the stream's own clock — rather than after `IDLE_MS`: it cuts up to about 0.8 s of dead air before Palabra's threshold silence, while the server hears silence from the release on. `cancelTurn` goes idle at the next beat as `endTurn` does (the controller's ruling): the runner sends no audio after either (`run.ts:347-351`), so there is no reason to treat them apart — pinned by a case of its own. The ruling's stated cost, "up to 320 ms of silence before a late chunk that belongs to a finished press", holds for a runner that ever sent audio after a release (the resume path takes it); it missed a second one, which the re-review measured: without the stream's own clock each release's padded remainder and next-beat silence left the stream a little further ahead of real time — about 70–100 ms a press, without bound (+4.0 s after 40 presses). The stream's clock removes it: after 40 presses the stream ends 0.2 s ahead at most, never 2 chunks, and a 40-press case pins it. **A wall clock stepped back** (`realClock.now()` is `Date.now()`) rebases the wait — `lastAudioAt` becomes now — and the stream's own clock — its time since it began carries on from the last beat's — as `every()` rebases its grid, so the silence still starts 500 ms after the step rather than after the size of the jump, which could exceed Palabra's 10 s. A beat a throttled page could not keep is skipped, not caught up (`every()`'s rule): the stream then carries less silence than real time, which slows a sentence's confirmation but never floods the server [inf: whether Palabra warns about it is live-test item 5]. The silent chunk is encoded once per page, not per beat.
8. **Failures in words and codes** (ruling 11):
   - **The app pair's create:** a failed fetch → `network` ("Palabra's session service could not be reached.", or the offline words); 401 / 403 → `auth`, 429 → `rate_limit`, 5xx → `server`, any other status → `client`, each in Palabra's REST words `HTTP <status>: <detail, else title, else ours>`; an answer with no socket to reach, or an address that is no URL → `server`.
   - **A socket that fails before it opens:** offline → `network` ("The device is offline: Palabra could not be reached."); the platform key's, online → `auth`, "Palabra refused the connection before it opened: check the API key." — a wrong key is a bare 403 on the upgrade, which a browser reads only as a failed socket (the owner's probe), and the check already asked the key over REST [inf: a network fault while online reads the same]; the app pair's, online → `network`, "Palabra's socket did not open (check the network)." — its token is seconds old.
   - **A close after it opened, before the task runs:** 1008 → `rate_limit` (the connection limit, 20 a minute per key: the docs); any other → `server`, "Palabra closed the connection before the task started (<code> <reason>)."
   - **Before the task runs, an `error`:** `NOT_FOUND` is the expected answer to an early ask — framed `task.not_found`, not the red `session.error`: it is no failure (the controller's ruling on the review's m8; ruling 11's red rule is for failures) — and is otherwise ignored; after the start a `NOT_FOUND` is a `session.error` like any other; any other rejects the start — `VALIDATION_ERROR` as `client`, any other code as `server` [inf: a hypothesis past the probe's codes, which the live test's `session.error` frames settle] — in `[Palabra <code>] <words>`, the words `validationWords(desc)` (each message after the field it names: "segment_confirmation_silence_threshold: ensure this value is greater than or equal to 0.3"), else `msg`, else `desc` whole.
   - **Mid-session:** an `error` is a `session.error` frame, kept with its time (`NOT_FOUND` aside); a close within `ERROR_WORDS_MS` of it fails the run in its code and words — a negative age, a wall clock stepped back, is not recent (Translate's `04fc530d`); a close with no recent error: 1008 → `rate_limit`, "Palabra closed the connection with 1008: its limit is 20 connections a minute per key."; any other → `connection_lost` (the alias: "The connection was interrupted — tap Start Session in a moment to continue."). Nothing reconnects (ruling 12).
   - **A browser that will not open the socket:** `network`, in the seam's fixed words, with no cause — the constructor's message quotes the URL.
9. **The app pair's REST session** (ruling 1) **and the stop** (ruling 13):
   - the create is framed `session.create` out and `session.created { status }` in — neither the id nor the publisher is framed: both are token-shaped (the owner's probe);
   - **the create runs on its own signal**, bounded by `START_TIMEOUT_MS` from its send on the request's clock and cancelled when it settles — not on the leg's (the review's I1): a browser rejects the body of a request aborted after its answer came (MDN, fetch()), so a create the leg abandoned could never be read, and the session it made would outlive the leg. The leg's end (a stop, an abort, the start's bound) leaves the create to land; when it does, **its id alone** is read — all a delete needs — so an answer that names an id is deleted whatever else it lacks, and one that names none has nothing to delete; its socket is never dialled. The in-time path reads the whole answer (`readCreated`), which it needs to dial; an answer in time that names an id but no `publisher` or `ws_url` is refused ("without a socket to reach"), and the session it names is deleted by the refusal (the re-review's N3). A create that never answers is abandoned at its own bound, with nothing to delete;
   - **the one case that cannot delete:** a `pagehide` inside the create's round trip — the page is gone before the answer, so no id comes back; the session then expires on Palabra's side [inf: the docs say only that `expires_at` is extended every minute while a connection is active; they give no lifetime for a session nobody connected to]. Live-test item 9 cancels during the create and starts again at once;
   - the delete goes out the moment the leg ends — before `stop()`'s first `await`, so `pagehide`'s unawaited stop still sends it — with `keepalive: true`, bounded by `RELEASE_TIMEOUT_MS = 5 000` on the request's clock (the spec's bound on a release), once; a delete that fails leaves the session to expire on its own [inf: as above]; it is not framed. Cost if the create's answer was already moot: a bounded extra `DELETE` — harmless;
   - `stop()` sends `end_task { force: true }` when the task is live — the docs' "drop the pipeline and disconnect immediately, without processing the tail" — then closes the socket 1000, before its first `await`; it awaits only the REST delete, bounded; nothing is framed after it;
   - no session hooks (`startBoth`, `prepare`): Both is two independent sessions, which the probe ran on one credential;
   - the suites' `fakeRest` reads bodies as a browser does — an aborted request rejects, and so does reading an answer's body once its request is aborted — so a regression to the leg's signal fails the late-create case and the app pair's seeded lifecycles.
10. **Redaction and the kit's `frame-url` rule:** `redact()` gains `plbr_` in the bare-key rule — Palabra's documented key shape, a net for a key its own words might quote — and a JWT rule (`eyJ…` in three dot-separated base64url parts, masked whole), the net for the publisher token and the session id, and what lets the kit's `frame-secret` rule catch one; its query rule's `token` gains a comment naming Palabra. `checkConformance` gains `frame-url`: a frame payload that holds a `ws://` or `wss://` URL anywhere — Gemini's key, Doubao's credentials and Palabra's token each ride a socket's query, and `redact()` masks only the parameters it names (roadmap:3780). Every registered provider passes it.
11. **The Logs' rows:** `transcription.partial`, `translation.partial` and `audio.output` — a partial's snapshots, about four a second, and a sentence's audio, a burst of 200 ms chunks — each grouped under its own type when consecutive, the `.delta` rule's way; none of Palabra's other names takes a key or collides with the microphone's, Doubao's or the old client's rows (which leave with the old code).
12. **Segments and karaoke, `items.ts`** (ruling 6), pure and timer-free:
    - a source opens at its sentence's first partial (or its validated text), streams each whole text that differs, and closes once when validated; a partial after that, or a second validation, is ignored; a validated text with no id is a segment of its own, paired with nothing; a partial with no id is dropped (none was seen);
    - a translation is one per `(transcription_id, translation_part_id)` — the part a string in audio (`"0"`) and a number in text (`0`), read alike (the owner's probe) — opened at its first text or its first audio, whichever comes first, so audio never waits for a segment (the Gemini lesson; `Conversation.afterAudio`'s pending path unused), and closed once at its final text;
    - every segment's origin is its `transcription_id`: the pairing is stated;
    - a chunk of speech is `audio` on its part's translation, rangeless; a sentence's `last_chunk` ends the speech of every part of it [inf: the probe saw part 0 only; live-test item 17 records whether `last_chunk` comes once per sentence or once per part, and whether parts' bursts interleave — were it per part and interleaved, a later part would be ranged over its chunks so far and its later chunks play rangeless]; a part whose speech has ended and whose text is final gets `speechRanges`, its text tiled over its chunks by sample count (`tileSpan`), once; a chunk after that plays with no range; an empty chunk plays nothing and still ends a burst; a chunk with no id plays on no segment;
    - the source's text carries the `language` the server heard — under an `auto` source, the row's badge and the fill-in read it (ruling 8); `timing` is not emitted: the pairing is stated, and a partial's `end` moves on every snapshot;
    - nothing after `stop()`;
    - the two maps (sources, and translations per part) keep every sentence for the session's life, unpruned: one or two small entries per sentence — a few hundred bytes each over hours of speech, negligible against the audio L1 holds — and a late message for an old sentence still finds its segment (the controller's ruling on the review's m10).
13. **The languages as offered** (ruling 8): Auto-detect first (`{ value: AUTO, name: 'Auto' }`, as every detecting provider offers it), then the docs' sources in English-name order, each with the docs' native and English names; the targets the same, and the same whatever the source or whether the run speaks — no `LanguageContext` branch; `initial` en → es (the old defaults, `PPC:31-32`). `build` refuses a direction the two lists do not offer, a guard the store and the gate keep unreachable.
14. **Settings made valid, and clamped where they are used** (ruling 10): `migratePalabraSettings` keeps each stored field of the right kind and drops the rest to its default — a number out of range is kept and clamped at use, nothing written back. `effectiveThreshold` clamps to 0.3–2.0; `effectiveQueue` clamps the target to the old slider's 3–15 s and the max to `[maxQueueFloor(target), 60 s]`, where `maxQueueFloor` is the max slider's first grid value above the target (never below its 12 s minimum). The builder sends and the view shows the same effective numbers. `C` has no timbre field: it is always off.
15. **The view** (ruling 10): `PalabraSettingsView` draws, in the old order (`PSS:1296-1463`), the shared `VoiceField`, "Speech Processing" (the sentence splitter and the partial translations, each an Enabled / Disabled pair as the old block drew them) and "Audio Buffer Configuration" (the target slider, the max slider whose minimum follows the target, adaptive speed); `TurnDetection` is a one-line **Summary** of existing words ("VAD Settings · Silence Threshold: 0.70s") and **Controls**, the threshold slider 0.3–2.0 under the VAD heading (`#palabra-vad-section`), drawn in every turn mode (under push-to-talk it is also how soon a released sentence closes); no `Help`, as the old slider had no tooltip. The Enabled / Disabled pair is a local `OnOff` (a `role="group"` with an `aria-label` — the one markup delta from the old block), and the sliders copy the old markup with an `aria-label`: the shared `SliderField` / toggle lift the survey proposed (§2.13) is left to its own change — it rewrites five other providers' markup, each of which needs its own render check ("What this plan leaves").
16. **The check** (ruling 1): `GET https://api.palabra.ai/session-storage/sessions` with `Accept` and the mode's headers (`Authorization: Bearer <key>`, or `ClientId` / `ClientSecret`), inside `boundedFetch` (`CHECK_TIMEOUT_MS = 15 s`) on an injected `fetch` and clock. 2xx → ready (the list is not read; nothing is created or billed); 401 / 403 → `auth` and 429 → `rate_limit`, each in Palabra's REST words; any other status, a failed fetch, the bound or the abort → it throws. `checkReads: ['authMode']` — the check reads the credentials alone, and `authMode` decides which show — so a slider or a switch keeps Start on.
17. **Frames:** the list in Global Constraints. Received audio is framed by size (`samples`), never content; a transcription's first segment's `start` / `end` ride its frame for the Logs.
18. **`describe(c)` = `{}`:** Palabra names no model, and the old start named none for it.
19. **The seeded lifecycles over Palabra** (ruling 15): two harnesses, the platform key and the app pair, 300 runs each on their own seeds (`20260929`, `20260930`). Besides the kit's own two (the start aborted, the newest socket dropped), the opening draws: a failed upgrade, a socket that never opens (the bound runs out), a refused task (the probe's `VALIDATION_ERROR`), a close 1008 before the task, a task that stays `paused`, or the task found running — at the first ask, or after a `NOT_FOUND`; the REST create is refused one run in ten (401, 429, 500, offline). The server draws: a partial, a validation, a translation (part 0 or 1, sometimes empty), a chunk of speech (part `"0"` or `"1"`, 0 / 2 400 / 4 800 samples, `last_chunk` sometimes), `VOICE_NOT_FOUND`, an `AUDIO_STREAM_STALLED` warning, `SERVICE_TIMEOUT`, a frame that is no JSON, audio with no base64 string, a type it does not know, `end_of_stream`, a `NOT_FOUND`, a close (1000, 1008, 1011). The harness's own check (`after`): the platform key makes no REST call; the app pair deletes each session it created exactly once — its own id, its own headers, `keepalive` — and none it did not. Its REST server is the browser-true `fakeRest` (choice 9): against the first draft's adapter, which aborted the create with the leg, this check fails on 8 of 300 runs. Each report names the paths it took, and the test pins that the refused, live, stopped and failed ones were all reached.
20. **The folder is `src/providers/palabraai/`,** the id's spelling, as every port names its folder (the survey's `palabra/` was a placeholder).

## What this plan consumes from the earlier plans

Named as landed, so a reconciliation is mechanical. Where a landed name or text differs from what is quoted here, the implementer follows the landed one and reports it.

| From | What it is | Consumed by |
|---|---|---|
| The Stage 2 foundation plan: `credentials` (`keys`, `fields(s)`, `read`, `CredentialsMissing`), F5 (`legacyKeys`, `migratePair`), `LEGACY_SLICE_KEYS` (`palabraai` resolves a stored selection), the provider store's pair per provider and `normalizePair`'s fallback to the first offered value, `ProviderRefusal`, the registry and its F17 invariants, the gate's `participant_unsupported` (D20), `contextsFor` | the definition's skeleton; ruling 2's departures fall out of the existing fallback with no new code | Tasks 4, 8, 14 |
| The Volcengine AST2 plan: F4, `credentials.choice` and its control (`2e13d179`); `trackedClock` (`e4ec0d34`); the refused-upgrade words and the keepalive of real-time silence (`src/providers/volcengine_ast2/adapter.ts`); `redact()`'s query rule | the credential mode above the fields; the start's words; the silence rule's shape | Tasks 8, 9, 13 |
| The Soniox plan (`c151d9d8`): `speechRanges` filled in when a segment's speech ends, `tileSpan` (`src/providers/soniox/speech.ts:36-59`) | karaoke by sample count | Tasks 2, 11 |
| The OpenAI Realtime plan: `pcmToBase64` / `base64ToPcm` (`2f7c681d`), `boundedFetch` (`bf2702ba`), `checkReads` (`eda82c05`, `2380007d`), the four `socket.ts` copies (the latest `deb7deaf`); the final fix wave (`f9fe8747`, `eaaf8ead`): an adapter frames only what went up, the error window pinned, `C.transport` the literal `'websocket'` | the wire's base64, the check, readiness narrowed, the seam lifted | Tasks 1, 9, 12, 13, 14 |
| The OpenAI Translate plan's leg, as Realtime copied it: `phase`, `opened`, `refuse`, `end`, `shutDown` nulling the socket's four handlers, the abort listener removed once the start settles, the bound armed before anything opens, `ERROR_WORDS_MS`, `recentError` refusing a negative age (`04fc530d`), the two unreadable latches | the adapter's skeleton | Task 13 |
| The kit: `FakeSocket` (`open`, `receive`, `drop`, `serverClose`, `sentJson`, `closedByClient`), `fakeSockets`, `driveAdapter`, `flush`, `runScenario`, `scenarioNames`, `recordEvents`, `recordConformance`, `checkConformance`, `framePayload`, `AdapterStartError`, `every()` (`be199ce4`: it counts beats; an early fire never doubles a tick) | the tests; the beat | Tasks 5, 7, 13 |
| The Gemini plan: `VoiceField`; the `TurnDetection` Summary / Controls shape under the VAD heading | the view | Task 10 |
| The Stage 2 Gemini/AST2 follow-up (`1558d161` and its fix rounds): Gemini's offer by its saved model's family (its choice 16) and its `migratePair`, which converts nothing (its choice 17); the `sessionSide.consistency.test.ts` roster with `gemini/tail.ts` | the invariant's declared shapes; the `migratePair` comment; the guard's pin site | Tasks 4, 13 |
| The registry as landed: `RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiProvider, openaiTranslateProvider, sonioxProvider]`, its order pin, `ownKeyOptions('understand-others')` → `['gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox', 'fake']` | the registration | Task 14 appends `palabraProvider` |

## File Structure

| File | Task | Change |
|---|---|---|
| `src/lib/contract/socket.ts` (+ test), `src/providers/{gemini,volcengine_ast2,openai_translate,openai}/socket.ts` | 1 | the plain seam lifted; the copies re-export it |
| `src/lib/contract/ranges.ts` (+ test), `src/providers/soniox/speech.ts` | 2 | `tileSpan` lifted; Soniox re-exports it |
| `src/lib/contract/adapter.ts`, `src/lib/contract/testing/drive.ts`, `src/lib/session/{source,run}.ts` (+ `runner.test.ts`, `runner.hooks.test.ts`), `src/lib/audio/appCapture.ts`, `src/lib/audio/capture/{core,mic,systemAudio,tab}.ts` (+ `core.test.ts`, `mic.test.ts`), `src/providers/fake/generate.ts` | 3 | the `input` seam deleted |
| `src/lib/provider/{types,languages}.ts` (+ `languages.test.ts`), `src/lib/session/{shape,shared,appShape}.ts` (+ `shape.test.ts`, `shared.test.ts`), `src/providers/registry.test.ts` | 4 | `languages.reverse`, `reversedPair`, its readers, the registry invariant |
| `src/lib/contract/clock.ts` (+ test), `src/lib/contract/testing/{trackedClock,fakeSocket,scenarios}.ts` (+ `fakeSocket.test.ts`, `scenarios.test.ts`) | 5 | the kit's four parked items |
| `src/lib/diagnostics/redact.ts` (+ test), `src/lib/contract/conformance.ts` (+ test), `src/stores/logStore.ts` (+ test) | 6 | two redaction shapes, `frame-url`, the Logs' rows |
| `src/lib/contract/testing/lifecycle.ts` (+ test) | 7 | the seeded lifecycle scenario |
| `src/providers/palabraai/{adapter,settings,config}.ts` (+ `settings.test.ts`, `config.test.ts`) | 8 | the seed; `S`, `K`, the languages; `C`, the builder |
| `src/providers/palabraai/{wire,audioIn,testing}.ts` (+ `wire.test.ts`, `audioIn.test.ts`) | 9 | the wire, the re-chunker, the fixtures |
| `src/providers/palabraai/{PalabraSettings,PalabraTurnDetection}.tsx` (+ tests) | 10 | the view |
| `src/providers/palabraai/items.ts` (+ test) | 11 | messages → segments |
| `src/providers/palabraai/check.ts` (+ test) | 12 | the bounded REST check |
| `src/providers/palabraai/adapter.ts` (replaced), `adapter.test.ts`, `testing.ts` (the harness), `src/providers/sessionSide.consistency.test.ts` | 13 | the adapter |
| `src/providers/palabraai/provider.ts` (+ test), `src/providers/registry.ts` (+ test), `src/components/SetupWizard/providerPaths.test.ts` | 14 | the definition, registered |
| the spec, the roadmap | 15 | the controller's amendments and record |

**Order and parallelism.**
- **Wave 1:** Tasks 1–6. Disjoint files. Task 5's stricter kit and Task 6's `frame-url` rule run every registered provider's conformance: each passes both (the scratch copy's), so neither needs another's change. Task 3 edits `drive.ts` and Task 5 the kit's other files: `scenarios.ts` calls `driveAdapter` with no `input`, so neither sees the other's red phase.
- **Wave 2:** Task 7 (needs Task 5's `pending()`), Task 8 (needs Task 4's `languages.reverse`). Disjoint files. Task 8 writes its `adapter.ts` seed before any other file of the new folder: the session-side guard requires an `adapter.ts` in every folder under `src/providers`. A concurrent task that still sees "every provider keeps its adapter in adapter.ts" fail names it as Task 8's work in progress and does not touch the guard.
- **Wave 3:** Task 9 (needs Task 8), Task 10 (needs Task 8). Disjoint files: Task 9 alone writes `testing.ts`, and no Task 10 file imports it.
- **Wave 4:** Task 11 (needs Tasks 2, 9), Task 12 (needs Task 9). Disjoint files.
- **Wave 5:** Task 13 (needs Tasks 1, 3, 5, 6, 7, 9, 11; replaces the seed, appends the harness to `testing.ts`).
- **Group check A** (controller) after Wave 5: the adapter, the check and the view are complete; nothing is registered.
- **Wave 6:** Task 14 (needs Tasks 4, 10, 12, 13).
- **Group check B** (controller) after Wave 6.
- **Task 15** (controller) last.

---

### Task 1: Lift the plain socket seam to the contract (Wave 1)

**Files:**
- Create: `src/lib/contract/socket.ts`, `src/lib/contract/socket.test.ts`
- Modify: `src/providers/gemini/socket.ts` (`:1-22`, the whole body), `src/providers/volcengine_ast2/socket.ts` (`:1-23`), `src/providers/openai_translate/socket.ts` (`:1-23`), `src/providers/openai/socket.ts` (`:1-23`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `OpenSocket = (url: string, protocols?: string[]) => WebSocket`, `nativeSocket: OpenSocket`, `WS_OPEN = 1` in `src/lib/contract/socket.ts` (choice 1). The four provider `socket.ts` files keep exporting `OpenSocket` (their own narrower type), `nativeSocket` and `WS_OPEN`, so their importers are untouched.

- [ ] **Step 1: Write the failing test.** Create `src/lib/contract/socket.test.ts`:

```ts
/**
 * The plain socket seam (Stage 2 Palabra, choice 1). A browser that will
 * not open a socket throws an error that quotes its URL or its
 * subprotocols, and either may carry a credential: what leaves the seam
 * names the error, never repeats it.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeSocket, WS_OPEN } from './socket';

afterEach(() => {
  vi.unstubAllGlobals();
});

function thrownBy(f: () => unknown): Error {
  try {
    f();
  } catch (error) {
    return error as Error;
  }
  throw new Error('nothing was thrown');
}

const URL_WITH_KEY = 'wss://stream.example.test/v1/stream?token=plbr_seamKey0123456789';
const PROTOCOLS = ['realtime', 'openai-insecure-api-key.sk-proj-seamKey0123456789'];

/** A browser that will not open the socket, as Chromium refuses one: a DOMException named SyntaxError whose message quotes what it was given. */
class RefusingWebSocket {
  constructor(url: string, protocols?: string | string[]) {
    throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' or the subprotocol '${String(protocols)}' is invalid.`, 'SyntaxError');
  }
}

describe('the plain socket seam', () => {
  it('opens the socket the browser builds, with the URL alone, or with the subprotocols it is given', () => {
    const built: unknown[][] = [];
    class RecordingWebSocket {
      constructor(...args: unknown[]) {
        built.push(args);
      }
    }
    vi.stubGlobal('WebSocket', RecordingWebSocket);
    expect(nativeSocket(URL_WITH_KEY)).toBeInstanceOf(RecordingWebSocket);
    expect(nativeSocket(URL_WITH_KEY, PROTOCOLS)).toBeInstanceOf(RecordingWebSocket);
    // No subprotocols: the constructor is called with the URL alone, as the four copies called it.
    expect(built).toEqual([[URL_WITH_KEY], [URL_WITH_KEY, PROTOCOLS]]);
  });

  it("a socket the browser will not open is rethrown in fixed words, under the browser's error name, never its message", () => {
    const secrets = [URL_WITH_KEY, 'plbr_seamKey0123456789', PROTOCOLS[1]];
    // The control: the browser's own error quotes every one of them.
    const own = thrownBy(() => new RefusingWebSocket(URL_WITH_KEY, PROTOCOLS));
    for (const secret of secrets) expect(own.message).toContain(secret);

    vi.stubGlobal('WebSocket', RefusingWebSocket);
    for (const error of [thrownBy(() => nativeSocket(URL_WITH_KEY)), thrownBy(() => nativeSocket(URL_WITH_KEY, PROTOCOLS))]) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ name: 'SyntaxError', message: 'The browser would not open the socket (SyntaxError).' });
      expect((error as { cause?: unknown }).cause).toBeUndefined();
      for (const text of [error.message, String(error), error.stack ?? '']) {
        for (const secret of secrets) expect(text).not.toContain(secret);
      }
    }
  });

  it("reads WebSocket.OPEN as the constant it is", () => {
    expect(WS_OPEN).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/lib/contract/socket.test.ts`
Expected: FAIL — `Failed to resolve import "./socket" from "src/lib/contract/socket.test.ts"`.

- [ ] **Step 3: Write the seam.** Create `src/lib/contract/socket.ts`:

```ts
/**
 * The plain socket seam a provider's session side opens its sockets
 * through (F9's convention): `new WebSocket(url)` — or `(url, protocols)`,
 * for a provider that authenticates by subprotocol — in the app, a
 * `FakeSocket` factory in tests. Gemini's, Doubao AST 2.0's, OpenAI
 * Translate's and OpenAI Realtime's `socket.ts` each held a copy; lifted
 * at its fifth user, Palabra (Stage 2 Palabra, choice 1), the four copies
 * re-export it, each keeping the `OpenSocket` its adapter calls (with
 * subprotocols or without). Soniox's own seam stays its own: it rethrows
 * nothing, and the old client's streams read it. F14, the header seam,
 * joins this one when OpenAI Live builds it.
 */
export type OpenSocket = (url: string, protocols?: string[]) => WebSocket;

/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
export const nativeSocket: OpenSocket = (url, protocols) => {
  try {
    return protocols === undefined ? new WebSocket(url) : new WebSocket(url, protocols);
  } catch (e) {
    // A browser that refuses a socket quotes its URL or its subprotocols, and either may carry a credential: the message is dropped, the error's name kept (a start words a refusal by it).
    const name = (e as Error).name;
    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
  }
};

/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
export const WS_OPEN = 1;
```

- [ ] **Step 4: Switch the four copies to it.** Each keeps its own `OpenSocket` — its adapter's deps and its tests' stubs are typed by it (OpenAI Translate's and Realtime's stubs take `protocols: string[]`, which the lib's optional parameter would not accept) — and re-exports the rest. In `src/providers/gemini/socket.ts`:

```diff
--- a/src/providers/gemini/socket.ts
+++ b/src/providers/gemini/socket.ts
@@ -1,22 +1,11 @@
 /**
- * The one seam Gemini's session side opens sockets through (as Soniox's
- * `socket.ts`): `new WebSocket(url)` in the app, a `FakeSocket` factory in
- * tests. The key rides in the URL's query, so no upgrade header is needed
- * (spec: "Sockets that need upgrade headers" does not apply). Both move to
- * `src/lib/contract/` with F14.
+ * The one seam Gemini's session side opens sockets through: `new
+ * WebSocket(url)` in the app, a `FakeSocket` factory in tests. The key
+ * rides in the URL's query, so no upgrade header is needed (spec: "Sockets
+ * that need upgrade headers" does not apply). The seam itself is the
+ * contract's, lifted at its fifth user (Stage 2 Palabra, choice 1);
+ * re-exported, so this folder's importers are unchanged.
  */
 export type OpenSocket = (url: string) => WebSocket;
 
-/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
-export const nativeSocket: OpenSocket = (url) => {
-  try {
-    return new WebSocket(url);
-  } catch (e) {
-    // The URL carries a credential, and a browser that refuses the socket quotes it in its message: the message is dropped, the error's name kept.
-    const name = (e as Error).name;
-    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
-  }
-};
-
-/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
-export const WS_OPEN = 1;
+export { nativeSocket, WS_OPEN } from '../../lib/contract/socket';
```

In `src/providers/volcengine_ast2/socket.ts`:

```diff
--- a/src/providers/volcengine_ast2/socket.ts
+++ b/src/providers/volcengine_ast2/socket.ts
@@ -1,23 +1,12 @@
 /**
  * The one seam Doubao AST 2.0's session side and its check open sockets
- * through (as Soniox's and Gemini's `socket.ts`): `new WebSocket(url)` in
- * the app, a `FakeSocket` factory in tests. The credentials ride in the
- * URL's query (ruling 2 — measured with real credentials, 2026-09-28), so
- * no upgrade header is needed: F14, the header seam, is not built here.
- * The three move to `src/lib/contract/` with F14.
+ * through: `new WebSocket(url)` in the app, a `FakeSocket` factory in
+ * tests. The credentials ride in the URL's query (ruling 2 — measured with
+ * real credentials, 2026-09-28), so no upgrade header is needed: F14, the
+ * header seam, is not built here. The seam itself is the contract's, lifted
+ * at its fifth user (Stage 2 Palabra, choice 1); re-exported, so this
+ * folder's importers are unchanged.
  */
 export type OpenSocket = (url: string) => WebSocket;
 
-/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
-export const nativeSocket: OpenSocket = (url) => {
-  try {
-    return new WebSocket(url);
-  } catch (e) {
-    // The URL carries a credential, and a browser that refuses the socket quotes it in its message: the message is dropped, the error's name kept (the start words a refusal by it).
-    const name = (e as Error).name;
-    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
-  }
-};
-
-/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
-export const WS_OPEN = 1;
+export { nativeSocket, WS_OPEN } from '../../lib/contract/socket';
```

In `src/providers/openai_translate/socket.ts`:

```diff
--- a/src/providers/openai_translate/socket.ts
+++ b/src/providers/openai_translate/socket.ts
@@ -1,23 +1,11 @@
 /**
- * The one seam OpenAI Translate's session side opens sockets through (as
- * Soniox's, Gemini's and Doubao's `socket.ts`): `new WebSocket(url,
- * protocols)` in the app, a `FakeSocket` factory in tests. The key rides in
- * a subprotocol (choice 3), which a browser sets itself, so no upgrade
- * header is needed and F14 is not this provider's; this seam moves to
- * `src/lib/contract/` with the other three when F14 lands.
+ * The one seam OpenAI Translate's session side opens sockets through: `new
+ * WebSocket(url, protocols)` in the app, a `FakeSocket` factory in tests.
+ * The key rides in a subprotocol (choice 3), which a browser sets itself,
+ * so no upgrade header is needed and F14 is not this provider's. The seam
+ * itself is the contract's, lifted at its fifth user (Stage 2 Palabra,
+ * choice 1); re-exported, so this folder's importers are unchanged.
  */
 export type OpenSocket = (url: string, protocols: string[]) => WebSocket;
 
-/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
-export const nativeSocket: OpenSocket = (url, protocols) => {
-  try {
-    return new WebSocket(url, protocols);
-  } catch (e) {
-    // A key that is no valid subprotocol token makes the browser quote the subprotocol, the key in it: the message is dropped, the error's name kept (the start words a refusal by it).
-    const name = (e as Error).name;
-    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
-  }
-};
-
-/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
-export const WS_OPEN = 1;
+export { nativeSocket, WS_OPEN } from '../../lib/contract/socket';
```

In `src/providers/openai/socket.ts`:

```diff
--- a/src/providers/openai/socket.ts
+++ b/src/providers/openai/socket.ts
@@ -1,23 +1,11 @@
 /**
- * The one seam OpenAI Realtime's session side opens sockets through, copied
- * from OpenAI Translate's (choice 7): `new WebSocket(url, protocols)` in
- * the app, a `FakeSocket` factory in tests. The key rides in a subprotocol,
- * which a browser sets itself, so no upgrade header is needed and F14 is
- * not this provider's; this seam moves to `src/lib/contract/` with the
- * others when F14 lands.
+ * The one seam OpenAI Realtime's session side opens sockets through: `new
+ * WebSocket(url, protocols)` in the app, a `FakeSocket` factory in tests.
+ * The key rides in a subprotocol, which a browser sets itself, so no
+ * upgrade header is needed and F14 is not this provider's. The seam itself
+ * is the contract's, lifted at its fifth user (Stage 2 Palabra, choice 1);
+ * re-exported, so this folder's importers are unchanged.
  */
 export type OpenSocket = (url: string, protocols: string[]) => WebSocket;
 
-/** Read at call time, so a test's `vi.stubGlobal('WebSocket')` is seen. */
-export const nativeSocket: OpenSocket = (url, protocols) => {
-  try {
-    return new WebSocket(url, protocols);
-  } catch (e) {
-    // A key that is no valid subprotocol token makes the browser quote the subprotocol, the key in it: the message is dropped, the error's name kept (the start words a refusal by it).
-    const name = (e as Error).name;
-    throw Object.assign(new Error(`The browser would not open the socket (${name}).`), { name });
-  }
-};
-
-/** `WebSocket.OPEN`, read as the constant it is: the socket may be an injected one. */
-export const WS_OPEN = 1;
+export { nativeSocket, WS_OPEN } from '../../lib/contract/socket';
```

- [ ] **Step 5: Run the lib's test and every user's suite.** The four providers' suites, unchanged, are the net: their adapters, checks and seam tests import from their own `socket.ts`, which re-exports the lifted seam.

Run: `npx vitest run src/lib/contract/socket.test.ts src/providers/gemini src/providers/volcengine_ast2 src/providers/openai_translate src/providers/openai`
Expected: PASS — 53 files, 699 tests.

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/contract/socket.ts src/lib/contract/socket.test.ts src/providers/gemini/socket.ts src/providers/volcengine_ast2/socket.ts src/providers/openai_translate/socket.ts src/providers/openai/socket.ts
```

```bash
git commit -q -F - -- src/lib/contract/socket.ts src/lib/contract/socket.test.ts src/providers/gemini/socket.ts src/providers/volcengine_ast2/socket.ts src/providers/openai_translate/socket.ts src/providers/openai/socket.ts <<'EOF'
refactor(contract): lift the plain socket seam at its fifth user

Gemini, Doubao AST 2.0, OpenAI Translate and OpenAI Realtime each held a
copy; Palabra would be the fifth. Each copy keeps its own OpenSocket type
and re-exports the rest, so every importer of theirs is unchanged.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 2: Lift `tileSpan` to the contract (Wave 1)

**Files:**
- Create: `src/lib/contract/ranges.ts`, `src/lib/contract/ranges.test.ts`
- Modify: `src/providers/soniox/speech.ts` (`:13-16` the imports; `:36-59` the function and its two helpers)

**Interfaces:**
- Consumes: `TextRange` (`src/lib/contract/adapter`).
- Produces: `tileSpan(span: TextRange, samples: readonly number[], text: string): TextRange[]` in `src/lib/contract/ranges.ts` (choice 2); `soniox/speech.ts` keeps exporting it (re-exported).

- [ ] **Step 1: Write the failing test.** Create `src/lib/contract/ranges.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tileSpan } from './ranges';

describe('tileSpan (Stage 2 Palabra, choice 2: lifted from Soniox, byte for byte)', () => {
  it("tiles a span by sample count, the last range ending at the span's end", () => {
    expect(tileSpan([0, 10], [100, 100], 'x'.repeat(10))).toEqual([[0, 5], [5, 10]]);
    expect(tileSpan([3, 9], [1, 2, 3], 'x'.repeat(9))).toEqual([[3, 4], [4, 6], [6, 9]]);
    expect(tileSpan([2, 7], [480], 'x'.repeat(7))).toEqual([[2, 7]]);
  });

  it('never ends a range inside a surrogate pair', () => {
    expect(tileSpan([0, 4], [1, 1], 'a😀b')).toEqual([[0, 3], [3, 4]]);
  });

  it('a chunk whose share rounds to nothing gets an empty range: harmless, pinned', () => {
    // Under half a code unit each: rounding gives some chunks [n, n]. The kit rejects only start > end, and karaoke holds at the boundary.
    expect(tileSpan([0, 3], [1, 1, 1, 1, 1], 'abc')).toEqual([[0, 1], [1, 1], [1, 2], [2, 2], [2, 3]]);
  });

  it("tiles a whole sentence over a burst of 200 ms chunks and a short last one, as Palabra's audio arrives (ruling 6)", () => {
    const text = 'Welcome to real-time translation.';
    const ranges = tileSpan([0, text.length], [4_800, 4_800, 4_800, 2_859], text);
    expect(ranges[0][0]).toBe(0);
    expect(ranges[ranges.length - 1][1]).toBe(text.length);
    for (let k = 1; k < ranges.length; k++) expect(ranges[k][0]).toBe(ranges[k - 1][1]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/lib/contract/ranges.test.ts`
Expected: FAIL — `Failed to resolve import "./ranges" from "src/lib/contract/ranges.test.ts"`.

- [ ] **Step 3: Write the module.** Create `src/lib/contract/ranges.ts` — Soniox's function and helpers, byte for byte:

```ts
/**
 * Ranges filled in once a segment's speech has ended (spec: "A range known
 * only later is filled in"): the span divided among the speech entries by
 * their sample counts. Written for Soniox's TTS segments (Stage 2 Soniox,
 * choice 4) and lifted here at its second user, Palabra's sentences
 * (Stage 2 Palabra, ruling 6; choice 2): a provider never imports another
 * provider's folder. Pure.
 */
import type { TextRange } from './adapter';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * A segment's span divided among its chunks in proportion to their sample
 * counts (every count positive), so consecutive ranges tile the span; the
 * last ends at the span's end. A boundary inside a surrogate pair moves
 * past it (Stage 2 Soniox, choice 4). `text` is the ref's text the span indexes.
 */
export function tileSpan(span: TextRange, samples: readonly number[], text: string): TextRange[] {
  const [a, b] = span;
  const total = samples.reduce((sum, n) => sum + n, 0);
  const out: TextRange[] = [];
  let start = a;
  let cum = 0;
  samples.forEach((n, k) => {
    cum += n;
    let end = k === samples.length - 1 ? b : Math.max(start, a + Math.round(((b - a) * cum) / total));
    if (end > start && end < b && isHigh(text.charCodeAt(end - 1)) && isLow(text.charCodeAt(end))) end += 1;
    out.push([start, end]);
    start = end;
  });
  return out;
}
```

- [ ] **Step 4: Switch Soniox to it.** In `src/providers/soniox/speech.ts`:

```diff
--- a/src/providers/soniox/speech.ts
+++ b/src/providers/soniox/speech.ts
@@ -13,6 +13,7 @@
 import { SAMPLE_RATE, type AdapterEvents, type Ref, type TextRange } from '../../lib/contract/adapter';
 import type { Clock } from '../../lib/contract/clock';
 import { framePayload } from '../../lib/contract/framePayload';
+import { tileSpan } from '../../lib/contract/ranges';
 import { describeCause } from '../../lib/diagnostics/describeCause';
 import type { SonioxRegion } from '../../lib/soniox/regions';
 import { SONIOX_TTS_MODEL } from '../../lib/soniox/ttsCatalog';
@@ -33,30 +34,8 @@
 
 type Pending = { kind: 'text'; text: string; language: string; tag: TextTag } | { kind: 'end' };
 
-const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
-const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
-
-/**
- * A segment's span divided among its chunks in proportion to their sample
- * counts (every count positive), so consecutive ranges tile the span; the
- * last ends at the span's end. A boundary inside a surrogate pair moves
- * past it (choice 4). `text` is the ref's text the span indexes.
- */
-export function tileSpan(span: TextRange, samples: readonly number[], text: string): TextRange[] {
-  const [a, b] = span;
-  const total = samples.reduce((sum, n) => sum + n, 0);
-  const out: TextRange[] = [];
-  let start = a;
-  let cum = 0;
-  samples.forEach((n, k) => {
-    cum += n;
-    let end = k === samples.length - 1 ? b : Math.max(start, a + Math.round(((b - a) * cum) / total));
-    if (end > start && end < b && isHigh(text.charCodeAt(end - 1)) && isLow(text.charCodeAt(end))) end += 1;
-    out.push([start, end]);
-    start = end;
-  });
-  return out;
-}
+/** Lifted to the contract at its second user (Stage 2 Palabra, choice 2); re-exported, so this module's importers are unchanged. */
+export { tileSpan } from '../../lib/contract/ranges';
 
 export class LegSpeech {
   private stream: SonioxTtsStream | null = null;
```

- [ ] **Step 5: Run the lib's test and Soniox's suites.** Soniox's `speech.test.ts` (its `tileSpan` cases import it from `./speech`) and the adapters' fill-in cases are the net.

Run: `npx vitest run src/lib/contract/ranges.test.ts src/providers/soniox`
Expected: PASS — 30 files, 480 tests.

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/contract/ranges.ts src/lib/contract/ranges.test.ts src/providers/soniox/speech.ts
```

```bash
git commit -q -F - -- src/lib/contract/ranges.ts src/lib/contract/ranges.test.ts src/providers/soniox/speech.ts <<'EOF'
refactor(contract): lift tileSpan at its second user

Soniox's fill-in divides a segment's span over its chunks by sample
count; Palabra's sentences need the same, and a provider never imports
another's folder. Soniox re-exports it, so its importers are unchanged.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 3: Delete the `input` seam (Wave 1)

No adapter sends a native track now that Palabra's port is a WebSocket one: `StartRequest.input`, `Source.track` and the runner's two threading sites go (ruling 16), with the capture core's `track` option that fed them.

**Files:**
- Modify: `src/lib/contract/adapter.ts` (`:35-41`, `StartRequest`), `src/lib/contract/testing/drive.ts` (`:63`, `:126`), `src/lib/session/source.ts` (`:17-18`), `src/lib/session/run.ts` (`:279-283`, `startBoth`'s requests; `:415-417`, one leg's), `src/lib/audio/appCapture.ts` (`:64-66`), `src/lib/audio/capture/core.ts` (`:26`, `:84-86`), `src/lib/audio/capture/mic.ts` (`:62`), `src/lib/audio/capture/systemAudio.ts` (`:126`), `src/lib/audio/capture/tab.ts` (`:51`), `src/providers/fake/generate.ts` (`:17-19`, `:45`: comments)
- Test: `src/lib/audio/capture/core.test.ts` (`:21`, `:126-132`), `src/lib/audio/capture/mic.test.ts` (`:110`), `src/lib/session/runner.test.ts` (`:886-915`, the capture carry-over block), `src/lib/session/runner.hooks.test.ts` (`:271-290`, `startBoth`'s track case)

**Interfaces:**
- Consumes: nothing new.
- Produces: `StartRequest<C, K>` without `input`; `Source` without `track`; `SourceCoreOptions` without `track()`; `DriveOptions` without `input`. Nothing reads any of them at `024266a0`: every adapter takes the runner's pcm through `appendAudio`.

- [ ] **Step 1: Write the failing tests.** In `src/lib/audio/capture/core.test.ts`:

```diff
--- a/src/lib/audio/capture/core.test.ts
+++ b/src/lib/audio/capture/core.test.ts
@@ -18,7 +18,7 @@
 
 function setup(o: { muted?: () => boolean } = {}) {
   const release = vi.fn(async () => {});
-  const core = createSourceCore({ muted: o.muted ?? (() => false), track: () => undefined, release });
+  const core = createSourceCore({ muted: o.muted ?? (() => false), release });
   return { core, release };
 }
 
@@ -123,13 +123,9 @@
     expect(ended).not.toHaveBeenCalled();
   });
 
-  it('exposes the current track', () => {
-    const { track } = fakeStream();
-    let current: MediaStreamTrack | undefined;
-    const core = createSourceCore({ muted: () => false, track: () => current, release: async () => {} });
-    expect(core.track).toBeUndefined();
-    current = track;
-    expect(core.track).toBe(track);
+  it('exposes no track: every adapter takes the pcm (Stage 2 Palabra, ruling 16)', () => {
+    const { core } = setup();
+    expect(core).not.toHaveProperty('track');
   });
 
   it("reports each listener's own failing streak", () => {
```

In `src/lib/audio/capture/mic.test.ts`:

```diff
--- a/src/lib/audio/capture/mic.test.ts
+++ b/src/lib/audio/capture/mic.test.ts
@@ -107,7 +107,8 @@
     fake.push();
     expect(fake.calls).toEqual(['ns:standard', 'begin:mic-1', 'record']);
     expect(heard).toHaveBeenCalledTimes(1);
-    expect(source.track).toBe(fake.track);
+    // No track leaves the source: every adapter takes the pcm (Stage 2 Palabra, ruling 16).
+    expect(source).not.toHaveProperty('track');
   });
 
   it("rejects with the recorder's message when the device will not open, and disposes the recorder it built rather than just ending it", async () => {
```

In `src/lib/session/runner.test.ts` — the two carry-over cases become one that pins the request's keys:

```diff
--- a/src/lib/session/runner.test.ts
+++ b/src/lib/session/runner.test.ts
@@ -883,35 +883,23 @@
 });
 
 describe('runner — capture carry-over', () => {
-  /** The fake provider, with every request it starts recorded. */
-  function recordingInputs() {
-    const inputs: Array<MediaStreamTrack | undefined> = [];
+  it('hands the adapter a request of the context, config, credentials, clock, signal and punctuator alone — no track, even from a source that has one (Stage 2 Palabra, ruling 16)', async () => {
+    const requests: Array<StartRequest<never, never>> = [];
     const provider = {
       ...fakeProvider,
       async start(request: StartRequest<never, never>, events: AdapterEvents) {
-        inputs.push(request.input);
+        requests.push(request);
         return fakeProvider.start(request, events);
       },
     } as unknown as AnyProvider;
-    return { inputs, provider };
-  }
-
-  it("hands the adapter the source's track, and builds the request once the source has opened", async () => {
-    const track = { kind: 'audio' } as MediaStreamTrack;
-    const { inputs, provider } = recordingInputs();
     const { runner } = setup({
       shape: { provider },
-      openSource: async () => Object.assign(createFakeSource(createVirtualClock(0)), { track }),
+      // A capture that still carries its device track: nothing reads it.
+      openSource: async () => Object.assign(createFakeSource(createVirtualClock(0)), { track: { kind: 'audio' } as MediaStreamTrack }),
     });
     await runner.start();
-    expect(inputs).toEqual([track]);
-  });
-
-  it('builds a request without input when the source has no track', async () => {
-    const { inputs, provider } = recordingInputs();
-    const { runner } = setup({ shape: { provider } });
-    await runner.start();
-    expect(inputs).toEqual([undefined]);
+    expect(requests).toHaveLength(1);
+    expect(Object.keys(requests[0]).sort()).toEqual(['clock', 'config', 'context', 'credentials', 'punctuate', 'signal']);
   });
 
   it('keeps capturing when the adapter throws on audio, and reports it once per failing streak', async () => {
```

In `src/lib/session/runner.hooks.test.ts` — `Object.assign` keeps the fake source's own type, so a capture that still carries a track compiles without the field:

```diff
--- a/src/lib/session/runner.hooks.test.ts
+++ b/src/lib/session/runner.hooks.test.ts
@@ -268,7 +268,7 @@
     });
   });
 
-  it("hands startBoth each leg's own track", async () => {
+  it("hands startBoth each leg's own request, with no track in either (Stage 2 Palabra, ruling 16)", async () => {
     const clock = createVirtualClock(0);
     let requestsSeen!: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>;
     const startBoth = vi.fn(async (requests: Record<'speaker' | 'participant', StartRequest<unknown, unknown>>, events: Record<'speaker' | 'participant', AdapterEvents>) => {
@@ -281,12 +281,12 @@
     const { runner } = setup(
       withHooks({ startBoth }),
       ['speaker', 'participant'],
-      (leg) => ({ ...createFakeSource(clock), track: { id: `${leg}-track` } as unknown as MediaStreamTrack }),
+      // Captures that still carry their device tracks: nothing reads them.
+      (leg) => Object.assign(createFakeSource(clock), { track: { id: `${leg}-track` } as unknown as MediaStreamTrack }),
     );
     await runner.start();
-    expect(requestsSeen.speaker.input).toMatchObject({ id: 'speaker-track' });
-    expect(requestsSeen.participant.input).toMatchObject({ id: 'participant-track' });
-    expect(requestsSeen.speaker.input).not.toBe(requestsSeen.participant.input);
+    expect(requestsSeen.speaker.context.direction).not.toEqual(requestsSeen.participant.context.direction);
+    for (const leg of ['speaker', 'participant'] as const) expect(requestsSeen[leg]).not.toHaveProperty('input');
   });
 
   // Split Both opens two sockets; the faster one can hear the server before
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/audio/capture/core.test.ts src/lib/audio/capture/mic.test.ts src/lib/session/runner.test.ts src/lib/session/runner.hooks.test.ts`
Expected: FAIL — 4 failed, 147 passed: `core.test.ts`'s new case (`TypeError: options.track is not a function` — the core still calls the option the test no longer passes), `mic.test.ts`'s (the source still has a `track`), `runner.test.ts`'s (the request's keys include `input`) and `runner.hooks.test.ts`'s (`startBoth`'s requests still carry `input`).

- [ ] **Step 3: Delete the seam.** In `src/lib/contract/adapter.ts`:

```diff
--- a/src/lib/contract/adapter.ts
+++ b/src/lib/contract/adapter.ts
@@ -32,13 +32,15 @@
 /** Asks a punctuation model for `text` with marks. Null: no answer. */
 export type Punctuator = (lang: string, text: string) => Promise<string | null>;
 
+/**
+ * Every adapter takes the runner's pcm through `appendAudio`: none sends a
+ * native track since Palabra's port over WebSocket, so the request carries
+ * none (Stage 2 Palabra, ruling 16).
+ */
 export interface StartRequest<C, K> {
   context: SessionContext;
   config: C;
   credentials: K;
-  /** A track from the runner's capture graph, for adapters that send a native
-   *  track (WebRTC). Absent in tests and ignored by adapters that take pcm. */
-  input?: MediaStreamTrack;
   /** Every timer the adapter runs reads this clock; tests pass a virtual one. */
   clock: Clock;
   /** Aborted when the run is cancelled; an adapter still opening rejects and opens nothing. */
```

In `src/lib/contract/testing/drive.ts`:

```diff
--- a/src/lib/contract/testing/drive.ts
+++ b/src/lib/contract/testing/drive.ts
@@ -60,7 +60,6 @@
   steps?: readonly ScenarioStep[];
   /** After the steps the session is stopped (unless a step did), then the clock runs this much further. Default 10 000 ms. */
   settleMs?: number;
-  input?: MediaStreamTrack;
   punctuate?: Punctuator;
 }
 
@@ -123,7 +122,7 @@
   let started: Promise<AdapterSession>;
   try {
     started = adapter.start(
-      { context: o.context, config: o.config, credentials: o.credentials, clock, signal: controller.signal, input: o.input, punctuate: o.punctuate },
+      { context: o.context, config: o.config, credentials: o.credentials, clock, signal: controller.signal, punctuate: o.punctuate },
       recorder.events,
     );
   } catch (error) {
```

In `src/lib/session/source.ts`:

```diff
--- a/src/lib/session/source.ts
+++ b/src/lib/session/source.ts
@@ -14,8 +14,6 @@
   onEnded(listener: (reason: string) => void): () => void;
   /** Still delivering, but worse: app capture fell back to whole-system capture. */
   onDegraded(listener: (notice: SourceNotice) => void): () => void;
-  /** The capture's own track, for an adapter that sends a native track (WebRTC); absent where there is none. */
-  readonly track?: MediaStreamTrack;
   /** Stops capturing before its first `await`: on `pagehide` it is called and not awaited. */
   stop(): Promise<void>;
 }
```

In `src/lib/session/run.ts`:

```diff
--- a/src/lib/session/run.ts
+++ b/src/lib/session/run.ts
@@ -276,11 +276,6 @@
     }])) as Record<LegName, StartRequest<unknown, unknown>>;
 
     if (together) {
-      // Built without a track; a source with a track hands it to the adapter (WebRTC).
-      shape.legs.forEach((leg, i) => {
-        const track = sources![i].track;
-        if (track) requests[leg] = { ...requests[leg], input: track };
-      });
       const events = { speaker: this.eventsFor('speaker'), participant: this.eventsFor('participant') };
       let sessions: Record<LegName, AdapterSession>;
       try {
@@ -412,9 +407,7 @@
     try {
       const source = opened ?? await this.openSource(leg);
       this.setLegState(leg, 'opening');
-      // Built without a track; a source with a track hands it to the adapter (WebRTC).
-      const withInput = source.track ? { ...request, input: source.track } : request;
-      const session = await this.shape.provider.start(withInput, this.eventsFor(leg));
+      const session = await this.shape.provider.start(request, this.eventsFor(leg));
       this.stack.defer(`${leg} session`, () => session.stop());
       this.throwIfAborted();
       this.connect(leg, source, session);
```

In `src/lib/audio/appCapture.ts`:

```diff
--- a/src/lib/audio/appCapture.ts
+++ b/src/lib/audio/appCapture.ts
@@ -61,9 +61,6 @@
     onPcm: (listener) => source.onPcm(listener),
     onEnded: (listener) => source.onEnded(listener),
     onDegraded: (listener) => source.onDegraded(listener),
-    get track() {
-      return source.track;
-    },
     async stop() {
       if (!cleaned) {
         cleaned = true;
```

In `src/lib/audio/capture/core.ts`:

```diff
--- a/src/lib/audio/capture/core.ts
+++ b/src/lib/audio/capture/core.ts
@@ -23,7 +23,6 @@
 export interface SourceCoreOptions {
   /** Read on every chunk: mute takes effect at once. */
   muted(): boolean;
-  track(): MediaStreamTrack | undefined;
   /** Stops the recorders; called once, by the first `stop()`. */
   release(): Promise<void>;
 }
@@ -81,9 +80,6 @@
       }
       return off;
     },
-    get track() {
-      return options.track();
-    },
 
     deliver(pcm) {
       if (ended || stopping || options.muted()) return;
```

In `src/lib/audio/capture/mic.ts`:

```diff
--- a/src/lib/audio/capture/mic.ts
+++ b/src/lib/audio/capture/mic.ts
@@ -59,7 +59,6 @@
 
   const core = createSourceCore({
     muted: () => settings.muted(),
-    track: () => recorder.getStream()?.getAudioTracks()[0],
     release: async () => {
       // `Source.stop` stops capturing before its first `await` (roadmap 1e-1): a
       // `pagehide` never awaits this, and a device switch in flight must not keep
```

In `src/lib/audio/capture/systemAudio.ts`:

```diff
--- a/src/lib/audio/capture/systemAudio.ts
+++ b/src/lib/audio/capture/systemAudio.ts
@@ -123,7 +123,6 @@
 
   const core = createSourceCore({
     muted: () => settings.muted(),
-    track: () => recorder?.getStream?.()?.getAudioTracks()[0],
     release: async () => {
       unsubscribe();
       await chain;
```

In `src/lib/audio/capture/tab.ts`:

```diff
--- a/src/lib/audio/capture/tab.ts
+++ b/src/lib/audio/capture/tab.ts
@@ -48,7 +48,6 @@
   let open = false;
   const core = createSourceCore({
     muted: () => settings.muted(),
-    track: () => recorder.getStream()?.getAudioTracks()[0],
     release: async () => {
       unwatch();
       if (!open) return;
```

- [ ] **Step 4: Correct the fake's comments.** Its `refless-stream` script described the old Palabra client; it stays as an L1 fixture (the revision rule, ref-less audio), and no provider emits it now. In `src/providers/fake/generate.ts`:

```diff
--- a/src/providers/fake/generate.ts
+++ b/src/providers/fake/generate.ts
@@ -14,9 +14,11 @@
 }
 
 /**
- * Palabra's shape (F10): text with stated origins — a translation's text
- * revised after it closed, as Palabra's `partial_` → `validated_` — and one
- * continuous speech stream that names no segment. The stream arrives in
+ * The old Palabra client's shape (F10), kept as an L1 fixture: text with
+ * stated origins — a translation's text revised after it closed — and one
+ * continuous speech stream that names no segment. No provider emits it
+ * since Palabra's port, whose audio names its sentence and whose text
+ * closes once (Stage 2 Palabra, ruling 6). The stream arrives in
  * real time in 20–200 ms chunks: jittered by at most 20 ms for its first
  * `steadyMs`, then every `hiccupEvery`-th chunk `hiccupMs` late, the chunks
  * behind it arriving with it (G3's measurement, group check A).
@@ -42,7 +44,7 @@
       { at: 1000, open: { ref: ref + 1, side: 'translation', origin } },
       { at: 1000, text: { ref: ref + 1, text: partials[k] } },
       { at: 1400, close: { ref: ref + 1, origin } },
-      // `partial_` → `validated_`: the closed translation's text, revised.
+      // The closed translation's text, revised: what L1 must take (the spec's revision rule), though no provider sends it now.
       { at: 2400, text: { ref: ref + 1, text: translations[k] } },
     ] });
   }
```

- [ ] **Step 5: Run the capture, the session and the kit.** Every other capture test (`systemAudio`, `tab`, `appCapture`), the runner's suites and the fake's scripts are the net: nothing else named the track.

Run: `npx vitest run src/lib/audio src/lib/session src/lib/contract src/providers/fake`
Expected: PASS — 50 files, 639 tests.

Then confirm nothing outside the tests names a track on this path:

Run: `command grep -rl MediaStreamTrack src/lib/contract src/lib/session src/lib/audio --include='*.ts' --exclude='*.test.ts' | wc -l`
Expected: `0`.

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/contract/adapter.ts src/lib/contract/testing/drive.ts src/lib/session/source.ts src/lib/session/run.ts src/lib/session/runner.test.ts src/lib/session/runner.hooks.test.ts src/lib/audio/appCapture.ts src/lib/audio/capture/core.ts src/lib/audio/capture/core.test.ts src/lib/audio/capture/mic.ts src/lib/audio/capture/mic.test.ts src/lib/audio/capture/systemAudio.ts src/lib/audio/capture/tab.ts src/providers/fake/generate.ts
```

```bash
git commit -q -F - -- src/lib/contract/adapter.ts src/lib/contract/testing/drive.ts src/lib/session/source.ts src/lib/session/run.ts src/lib/session/runner.test.ts src/lib/session/runner.hooks.test.ts src/lib/audio/appCapture.ts src/lib/audio/capture/core.ts src/lib/audio/capture/core.test.ts src/lib/audio/capture/mic.ts src/lib/audio/capture/mic.test.ts src/lib/audio/capture/systemAudio.ts src/lib/audio/capture/tab.ts src/providers/fake/generate.ts <<'EOF'
refactor(session): no adapter takes a native track

StartRequest.input and Source.track waited for a WebRTC adapter; Palabra's
port is a WebSocket one and the OpenAI WebRTC clients are abandoned, so the
seam and the runner's two threading sites go with the capture's track option.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 4: A provider may state its own reverse (Wave 1)

**Files:**
- Modify: `src/lib/provider/types.ts` (`:232-233`, `legacyKeys`' comment; `:324-327`, `migratePair`'s comment and the new member after it), `src/lib/provider/languages.ts` (`:13`, `:21-33`), `src/lib/session/shape.ts` (`:3`, `:40`, `:53`), `src/lib/session/shared.ts` (`:3-19`), `src/lib/session/appShape.ts` (`:8`, `:89`)
- Test: `src/lib/provider/languages.test.ts` (`:2`; appended), `src/lib/session/shape.test.ts` (after `:49`, after `:103`), `src/lib/session/shared.test.ts` (the whole file), `src/providers/registry.test.ts` (after `:229`, a new invariant)

**Interfaces:**
- Consumes: `LanguagePair`, `LanguageContext`, `Provider['languages']` (`src/lib/provider/types`).
- Produces:
  - `Provider['languages'].reverse?(pair: LanguagePair, s: S): LanguagePair | null` (ruling 9; choice 3);
  - `reversedPair<S>(p, s, pair): LanguagePair | null` in `src/lib/provider/languages.ts` — the hook, else the plain swap;
  - `reverseSupported` and `swapped`, same signatures, reading it;
  - `buildSharedSettings(participant: LanguagePair | null, pauses, segmentation)` — its first parameter is now the participant's direction, not the pair; its one caller (`appShape.ts`) passes `reversedPair(…)`.

- [ ] **Step 1: Write the failing tests.** In `src/lib/provider/languages.test.ts` — a provider shaped as Palabra, and the control with the same lists and no hook:

```diff
--- a/src/lib/provider/languages.test.ts
+++ b/src/lib/provider/languages.test.ts
@@ -1,5 +1,5 @@
 import { describe, it, expect } from 'vitest';
-import { AUTO, normalizePair, reverseSupported, swapped } from './languages';
+import { AUTO, normalizePair, reversedPair, reverseSupported, swapped } from './languages';
 import type { LanguageContext, LanguageOption } from './types';
 
 const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });
@@ -90,3 +90,54 @@
     expect(reverseSupported(p, s, { source: 'en', target: 'ja' }, { speech: false })).toBe(true);
   });
 });
+
+/**
+ * A provider that states its reverse (Stage 2 Palabra, ruling 9), shaped as
+ * Palabra: `en` is a source and `en-us` a target of the same language; `xx`
+ * is a source with no reverse; `yy` a target whose reverse it does not offer.
+ */
+const regional = {
+  languages: {
+    sources: () => [opt(AUTO), opt('en'), opt('ja'), opt('xx')],
+    targets: () => [opt('en-us'), opt('ja'), opt('yy')],
+    reverse: (pair: { source: string; target: string }) => {
+      const toSource: Record<string, string> = { 'en-us': 'en', ja: 'ja', yy: 'zz' };
+      const toTarget: Record<string, string> = { en: 'en-us', ja: 'ja' };
+      const source = toSource[pair.target];
+      const target = toTarget[pair.source];
+      return source !== undefined && target !== undefined ? { source, target } : null;
+    },
+  },
+};
+
+describe("a provider's own reverse (Stage 2 Palabra, ruling 9)", () => {
+  it('is the plain swap when the provider states none', () => {
+    expect(reversedPair(p, s, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en' });
+  });
+
+  it("is the provider's own when it states one, null where it has none", () => {
+    expect(reversedPair(regional, s, { source: 'ja', target: 'en-us' })).toEqual({ source: 'en', target: 'ja' });
+    expect(reversedPair(regional, s, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en-us' });
+    expect(reversedPair(regional, s, { source: 'xx', target: 'ja' })).toBeNull();
+  });
+
+  it('reverses a region target by its source code, where the plain swap finds no source', () => {
+    expect(reverseSupported(regional, s, { source: 'ja', target: 'en-us' })).toBe(true);
+    // The control: the same lists with no reverse of their own.
+    const plain = { languages: { sources: regional.languages.sources, targets: regional.languages.targets } };
+    expect(reverseSupported(plain, s, { source: 'ja', target: 'en-us' })).toBe(false);
+  });
+
+  it('refuses a pair its reverse leaves without one, or leads outside the offer', () => {
+    expect(reverseSupported(regional, s, { source: 'xx', target: 'ja' })).toBe(false);
+    expect(reverseSupported(regional, s, { source: 'ja', target: 'yy' })).toBe(false);
+    expect(reverseSupported(regional, s, { source: AUTO, target: 'ja' })).toBe(false);
+  });
+
+  it("swaps into the provider's reverse, and not at all when that is the same pair", () => {
+    expect(swapped(regional, s, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en-us' });
+    expect(swapped(regional, s, { source: 'ja', target: 'en-us' })).toEqual({ source: 'en', target: 'ja' });
+    expect(swapped(regional, s, { source: 'ja', target: 'ja' })).toBeNull();
+    expect(swapped(regional, s, { source: 'en', target: 'en-us' })).toBeNull();
+  });
+});
```

In `src/lib/session/shape.test.ts`:

```diff
--- a/src/lib/session/shape.test.ts
+++ b/src/lib/session/shape.test.ts
@@ -47,6 +47,12 @@
     expect(contextsFor(shape({ provider: { ...fakeProvider, speech: 'never' } })).speaker?.speech).toBe(false);
   });
 
+  it("gives the participant the provider's own reverse where it states one (Stage 2 Palabra, ruling 9)", () => {
+    // A reverse that is no plain swap: en → ja runs its participant zh → en.
+    const provider = { ...fakeProvider, languages: { ...fakeProvider.languages, reverse: () => ({ source: 'zh', target: 'en' }) } };
+    expect(contextsFor(shape({ provider, legs: ['speaker', 'participant'] })).participant?.direction).toEqual({ source: 'zh', target: 'en' });
+  });
+
   it("gives the participant no speech while its provider's flag is off, whatever the opt-in; speech again once it is on", () => {
     const off = contextsFor(shape({ provider: { ...fakeProvider, participantSpeech: false }, legs: ['speaker', 'participant'], participantSpeech: true }));
     expect(off.participant?.speech).toBe(false);
@@ -101,6 +107,15 @@
       .toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
   });
 
+  it("reads the provider's own reverse: a pair it gives none refuses the participant leg, one it maps into the offer passes (Stage 2 Palabra, ruling 9)", () => {
+    const none = { ...fakeProvider, languages: { ...fakeProvider.languages, reverse: () => null } };
+    expect(gate(shape({ provider: none, legs: ['speaker', 'participant'] }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
+    // `en → ja` has a plain swap the fake offers; `en → en` has none, and the provider's own reverse maps it into the offer.
+    const mapped = { ...fakeProvider, languages: { ...fakeProvider.languages, reverse: () => ({ source: 'zh', target: 'en' }) } };
+    expect(gate(shape({ legs: ['speaker', 'participant'], pair: { source: 'en', target: 'en' } }), 'electron')).toMatchObject({ code: 'participant_unsupported' });
+    expect(gate(shape({ provider: mapped, legs: ['speaker', 'participant'], pair: { source: 'en', target: 'en' } }), 'electron')).toBeNull();
+  });
+
   it('refuses the participant leg where the platform has no participant source', () => {
     expect(gate(shape({ legs: ['speaker', 'participant'] }), 'web')).toMatchObject({ code: 'participant_source_unavailable', leg: 'participant' });
   });
```

In `src/lib/session/shared.test.ts`:

```diff
--- a/src/lib/session/shared.test.ts
+++ b/src/lib/session/shared.test.ts
@@ -1,23 +1,33 @@
 import { describe, it, expect } from 'vitest';
 import { buildSharedSettings } from './shared';
 
-const pair = { source: 'en', target: 'ja' };
+/** The participant's direction for the pair en → ja, as `reversedPair` gives it by the plain swap. */
+const participant = { source: 'ja', target: 'en' };
 const pauses = { sourceSeconds: 1.2, translationSeconds: 0.8 };
 const segmentation = { mode: 'off' as const, sentencesPerRow: 0 };
 
 describe('buildSharedSettings', () => {
   it('passes the pauses through', () => {
-    expect(buildSharedSettings(pair, pauses, segmentation).pauses).toEqual(pauses);
+    expect(buildSharedSettings(participant, pauses, segmentation).pauses).toEqual(pauses);
   });
 
   it("says which direction is the participant's, and carries the display segmentation", () => {
-    const shared = buildSharedSettings(pair, pauses, { mode: 'sentences', sentencesPerRow: 0 });
+    const shared = buildSharedSettings(participant, pauses, { mode: 'sentences', sentencesPerRow: 0 });
     expect(shared.reversed({ source: 'en', target: 'ja' })).toBe(false);
     expect(shared.reversed({ source: 'ja', target: 'en' })).toBe(true);
     expect(shared.segmentation).toEqual({ mode: 'sentences', sentencesPerRow: 0 });
   });
 
+  it("names the provider's own reverse, and none when the pair has none (Stage 2 Palabra, ruling 9)", () => {
+    // Palabra's `ja → en-us` runs its participant `en → ja`: the target's source code, not a plain swap.
+    const palabra = buildSharedSettings({ source: 'en', target: 'ja' }, pauses, segmentation);
+    expect(palabra.reversed({ source: 'en', target: 'ja' })).toBe(true);
+    expect(palabra.reversed({ source: 'en-us', target: 'ja' })).toBe(false);
+    const none = buildSharedSettings(null, pauses, segmentation);
+    expect(none.reversed({ source: 'en', target: 'ja' })).toBe(false);
+  });
+
   it("carries no instructions: they are each provider's own setting (Stage 2 Gemini, ruling 4)", () => {
-    expect(buildSharedSettings(pair, pauses, segmentation)).not.toHaveProperty('instructions');
+    expect(buildSharedSettings(participant, pauses, segmentation)).not.toHaveProperty('instructions');
   });
 });
```

In `src/providers/registry.test.ts` — the invariant the controller's audit found true, now a test, run over each provider's defaults and the settings shapes whose offer differs from them, declared by name (Gemini's three: its offer reads its saved model's family since the follow-up); with two controls, one that the declared shapes reach both of Gemini's offers and one a region target no source names:

```diff
--- a/src/providers/registry.test.ts
+++ b/src/providers/registry.test.ts
@@ -227,6 +227,31 @@
     expect(offenders([{ id: 'x', settings: { key: 'x', defaults: { a: 1 } }, checkReads: ['a', 'b'] }])).toEqual(['x: b']);
   });
 
+  it("a provider with no reverse of its own offers no target outside its sources, in every settings shape its offer reads and every language context: the plain swap reverses what it offers (Stage 2 Palabra, ruling 9)", () => {
+    const opt = (value: string) => ({ value, name: value, englishName: value });
+    // Each provider's defaults, and the shapes whose offer differs from theirs, by name: Gemini's offer reads its saved model's family (Stage 2 Gemini/AST2 follow-up, choice 16) — Live Translate's, a 2.5 native-audio dialogue model's, a 3.x Live dialogue model's.
+    const SHAPES: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
+      gemini: [{ model: 'gemini-3.5-live-translate-preview' }, { model: 'gemini-2.5-flash-native-audio-preview-12-2025' }, { model: 'gemini-3.1-flash-live-preview' }],
+    };
+    const shapesOf = (p: AnyProvider): unknown[] => [p.settings.defaults, ...(SHAPES[p.id] ?? []).map((patch) => ({ ...(p.settings.defaults as object), ...patch }))];
+    const offenders = (ps: readonly AnyProvider[]) => ps.flatMap((p) => {
+      if (p.languages.reverse) return [];
+      return shapesOf(p).flatMap((s, shape) => [undefined, { speech: true }, { speech: false }].flatMap((context) => {
+        const sources = new Set(p.languages.sources(s, context).map((o: { value: string }) => o.value));
+        const outside = new Set([...sources].flatMap((source) => p.languages.targets(source, s, context).map((o: { value: string }) => o.value)).filter((t) => !sources.has(t)));
+        return [...outside].map((t) => `${p.id}: ${t} (shape ${shape}, speech ${String(context?.speech)})`);
+      }));
+    });
+    expect(offenders(PROVIDERS)).toEqual([]);
+    // The declared shapes reach both of Gemini's offers: the list names no stale shape.
+    const gemini = PROVIDERS.find((p) => p.id === 'gemini')!;
+    expect(new Set(shapesOf(gemini).map((s) => gemini.languages.sources(s).length)).size).toBe(2);
+    // The control: a region target none of its sources names, with no reverse of its own — and with one, which states its own answer.
+    const regional = { ...fakeProvider, id: 'regional', languages: { sources: () => [opt('en')], targets: () => [opt('en-us')] } } as unknown as AnyProvider;
+    expect(offenders([regional])).toEqual(['regional: en-us (shape 0, speech undefined)', 'regional: en-us (shape 0, speech true)', 'regional: en-us (shape 0, speech false)']);
+    expect(offenders([{ ...regional, languages: { ...regional.languages, reverse: () => null } } as AnyProvider])).toEqual([]);
+  });
+
   it('an initial pair is one the provider offers', () => {
     const withInitial = PROVIDERS.filter((p) => p.languages.initial !== undefined);
     expect(withInitial.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/provider/languages.test.ts src/lib/session/shape.test.ts src/lib/session/shared.test.ts src/providers/registry.test.ts`
Expected: FAIL — 8 failed, 66 passed: four in `languages.test.ts` (`reversedPair is not a function`; the region target and the swap found no reverse), two in `shape.test.ts` (the participant still the plain swap; the gate ignores the hook), two in `shared.test.ts` (the first parameter still read as the pair). The registry invariant passes already: it pins what every registered provider does.

- [ ] **Step 3: The member.** In `src/lib/provider/types.ts` — the new member, and F5's two comments no longer name Palabra as their reason (ruling 2); `migratePair`'s names its user, Gemini (the follow-up's choice 17):

```diff
--- a/src/lib/provider/types.ts
+++ b/src/lib/provider/types.ts
@@ -229,8 +229,9 @@
     defaults: S;
     /**
      * Keys read with no default at load and handed to `migrate` (F5): a setting this
-     * version no longer has (OpenAI's `turnDetectionMode`), or a field whose
-     * absence must be told from its default (Palabra's `authMode`). May name
+     * version no longer has, or a field whose absence must be told from its
+     * default (built for Palabra's `authMode`, which its port does not take:
+     * Stage 2 Palabra, ruling 2). May name
      * a field of `defaults`. May name a whole storage key
      * (`settings.common.systemInstructions`), read there, never written.
      * Nothing is written back.
@@ -321,10 +322,22 @@
     initial?(s: S): Partial<LanguagePair>;
     /**
      * Rewrites the stored pair before it is normalized (F5): a code the
-     * provider renamed (Palabra's `vn` → `vi`). '' in a side means nothing
-     * is stored there; a side returned as '' falls back to `initial`.
+     * provider renamed, or one its offer no longer holds. '' in a side means
+     * nothing is stored there; a side returned as '' falls back to
+     * `initial`. First named for Palabra's `vn` → `vi`, which Palabra's port
+     * does not take (Stage 2 Palabra, ruling 2); Gemini reads its stored
+     * pair through it (Stage 2 Gemini/AST2 follow-up, choice 17).
      */
     migratePair?(stored: LanguagePair, s: S): LanguagePair;
+    /**
+     * The pair the other way round (Stage 2 Palabra, ruling 9): the
+     * participant leg's direction (D17, D20) and the swap button's result.
+     * Absent: the plain swap, `{ source: target, target: source }`. For a
+     * provider whose targets and sources are coded apart — Palabra's `en-us`
+     * target is its `en` source — or null when this pair has no reverse.
+     * Whether the provider offers the answer is still its two lists' to say.
+     */
+    reverse?(pair: LanguagePair, s: S): LanguagePair | null;
   };
 
   // the only capabilities generic code reads
```

- [ ] **Step 4: The one door and its readers.** In `src/lib/provider/languages.ts`:

```diff
--- a/src/lib/provider/languages.ts
+++ b/src/lib/provider/languages.ts
@@ -10,7 +10,7 @@
 /** The source value that asks the provider to detect the language. Never a target. */
 export const AUTO = 'auto';
 
-/** Only the two language functions are read, so a provider of any `K` and `C` fits. */
+/** Only the language functions are read, so a provider of any `K` and `C` fits. */
 type Languages<S> = Pick<Provider<S, never, never>, 'languages'>;
 
 function offers(options: readonly LanguageOption[], value: string): boolean {
@@ -18,19 +18,31 @@
 }
 
 /**
- * Whether the provider supports the reversed pair: the target among its
- * sources, and the source among that target's targets. It decides both the
- * swap button and whether the participant leg may open (D20). `AUTO` is never
- * a target, so an `AUTO` source never reverses.
+ * The pair the other way round, by the provider's own `reverse` where it
+ * states one (Stage 2 Palabra, ruling 9: Palabra's documented target → source
+ * and source → target codes) and otherwise the plain swap. Null: this pair
+ * has no reverse. Whether the provider offers it is `reverseSupported`'s.
+ */
+export function reversedPair<S>(p: Languages<S>, s: S, pair: LanguagePair): LanguagePair | null {
+  return p.languages.reverse ? p.languages.reverse(pair, s) : { source: pair.target, target: pair.source };
+}
+
+/**
+ * Whether the provider supports the reversed pair: its source among the
+ * provider's sources, and its target among that source's targets. It decides
+ * both the swap button and whether the participant leg may open (D20). `AUTO`
+ * is never a target, so an `AUTO` source never reverses.
  */
 export function reverseSupported<S>(p: Languages<S>, s: S, pair: LanguagePair, context?: LanguageContext): boolean {
-  return offers(p.languages.sources(s, context), pair.target) && offers(p.languages.targets(pair.target, s, context), pair.source);
+  const reversed = reversedPair(p, s, pair);
+  return reversed !== null && offers(p.languages.sources(s, context), reversed.source) && offers(p.languages.targets(reversed.source, s, context), reversed.target);
 }
 
 /** The reversed pair; null when the provider does not support it, or when it is the same pair. */
 export function swapped<S>(p: Languages<S>, s: S, pair: LanguagePair, context?: LanguageContext): LanguagePair | null {
-  if (pair.source === pair.target || !reverseSupported(p, s, pair, context)) return null;
-  return { source: pair.target, target: pair.source };
+  const reversed = reversedPair(p, s, pair);
+  if (reversed === null || !reverseSupported(p, s, pair, context)) return null;
+  return reversed.source === pair.source && reversed.target === pair.target ? null : reversed;
 }
 
 /**
```

In `src/lib/session/shape.ts`:

```diff
--- a/src/lib/session/shape.ts
+++ b/src/lib/session/shape.ts
@@ -1,6 +1,6 @@
 import type { SessionContext } from '../contract/adapter';
 import type { LegName } from '../conversation/types';
-import { reverseSupported } from '../provider/languages';
+import { reversedPair, reverseSupported } from '../provider/languages';
 import type { AnyProvider, LanguageContext, Platform } from '../provider/types';
 import { formatUsdFloor } from '../../utils/formatters';
 import type { RunNoticeCode } from './codes';
@@ -37,7 +37,11 @@
   return { speech: legs.some((leg) => legSpeaks(p, leg, inputs)) };
 }
 
-/** What each leg's adapter is told (spec: "The session request"). The participant leg runs the reverse, always with automatic turns. */
+/**
+ * What each leg's adapter is told (spec: "The session request"). The
+ * participant leg runs the reverse — the provider's own where it states one
+ * (Stage 2 Palabra, ruling 9) — always with automatic turns.
+ */
 export function contextsFor(shape: RunShape): Partial<Record<LegName, SessionContext>> {
   const { provider: p, pair } = shape;
   const contexts: Partial<Record<LegName, SessionContext>> = {};
@@ -50,7 +54,8 @@
   }
   if (shape.legs.includes('participant')) {
     contexts.participant = {
-      direction: { source: pair.target, target: pair.source },
+      // The gate refused a pair with no reverse before anything asks (D20); the plain swap only answers a shape nothing gated.
+      direction: reversedPair(p, shape.settings, pair) ?? { source: pair.target, target: pair.source },
       speech: legSpeaks(p, 'participant', shape),
       turns: 'auto',
     };
```

In `src/lib/session/shared.ts`:

```diff
--- a/src/lib/session/shared.ts
+++ b/src/lib/session/shared.ts
@@ -3,17 +3,20 @@
 /**
  * What every builder may read beyond its own settings, resolved once per
  * run: the segmentation pauses, which direction is the participant's, and
- * the display segmentation. The system instructions are each provider's
- * own setting (Stage 2 Gemini, ruling 4; `src/lib/provider/instructions.ts`).
+ * the display segmentation. The participant's direction is the pair's
+ * reverse as the provider states it (`reversedPair`; Stage 2 Palabra,
+ * ruling 9), null when the pair has none. The system instructions are each
+ * provider's own setting (Stage 2 Gemini, ruling 4;
+ * `src/lib/provider/instructions.ts`).
  */
 export function buildSharedSettings(
-  pair: LanguagePair,
+  participant: LanguagePair | null,
   pauses: SharedSettings['pauses'],
   segmentation: SharedSettings['segmentation'],
 ): Omit<SharedSettings, 'models'> {
   return {
     pauses,
     segmentation,
-    reversed: (direction) => direction.source === pair.target && direction.target === pair.source,
+    reversed: (direction) => participant !== null && direction.source === participant.source && direction.target === participant.target,
   };
 }
```

In `src/lib/session/appShape.ts`:

```diff
--- a/src/lib/session/appShape.ts
+++ b/src/lib/session/appShape.ts
@@ -6,6 +6,7 @@
  */
 import type { LegName } from '../conversation/types';
 import { participantSpeechHeard } from '../modern-audio/participantSource';
+import { reversedPair } from '../provider/languages';
 import type { AnyProvider, AuthContext, Platform, Readiness } from '../provider/types';
 import { presentProviders } from '../../providers/registry';
 import { useAccountStore } from '../../stores/accountStore';
@@ -86,7 +87,7 @@
     participantSpeech: participantSpeechFromStores(provider),
     keepReplayAudio: st.keepReplayAudio,
     shared: buildSharedSettings(
-      entry.pair,
+      reversedPair(provider, entry.settings, entry.pair),
       { sourceSeconds: st.segmentationSourcePause, translationSeconds: st.segmentationTranslationPause },
       { mode: st.segmentationMode, sentencesPerRow: st.sentenceSegmentationChunkSentences },
     ),
```

- [ ] **Step 5: Run the providers' languages, the session and the app.** No registered provider states a reverse, so every existing swap, gate and `reversed` answer is the plain swap's, as before — the language pickers' tests (`src/components`), the gate's and the builders' (`src/providers`) are the net.

Run: `npx vitest run src/lib/provider src/lib/session src/app src/providers src/components/Settings`
Expected: PASS — 196 files, 2 673 tests.

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/provider/types.ts src/lib/provider/languages.ts src/lib/provider/languages.test.ts src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/shared.ts src/lib/session/shared.test.ts src/lib/session/appShape.ts src/providers/registry.test.ts
```

```bash
git commit -q -F - -- src/lib/provider/types.ts src/lib/provider/languages.ts src/lib/provider/languages.test.ts src/lib/session/shape.ts src/lib/session/shape.test.ts src/lib/session/shared.ts src/lib/session/shared.test.ts src/lib/session/appShape.ts src/providers/registry.test.ts <<'EOF'
feat(provider): a provider may state the pair's reverse

An optional languages.reverse, the plain swap by default: the swap button,
the participant's direction and SharedSettings.reversed read it through
one function. A provider without one must offer no target outside its
sources, an invariant every registered provider meets.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 5: The kit's four parked items (Wave 1)

**Files:**
- Modify: `src/lib/contract/clock.ts` (`VirtualClock`, `:108-114`; `createVirtualClock`, `:125-156`), `src/lib/contract/testing/trackedClock.ts` (`:15`), `src/lib/contract/testing/fakeSocket.ts` (the header `:9-10`; `close`, `:53`; `serverClose`, `:76-79`), `src/lib/contract/testing/scenarios.ts` (`:89`, `:106`, `:116`, `:121`, `:134`)
- Test: `src/lib/contract/clock.test.ts` (after `:45`), `src/lib/contract/testing/fakeSocket.test.ts` (`:60-83`; a case after it), `src/lib/contract/testing/scenarios.test.ts` (`:2`; after `:180`)

**Interfaces:**
- Consumes: `every` (`src/lib/contract/clock`).
- Produces (choice 4): `VirtualClock.pending(): number`; `trackedClock()`'s clock passes it through; `FakeSocket.close(code?, reason?)` throws `InvalidAccessError` / `SyntaxError` as a browser does; `FakeSocket.serverClose(code, reason)` clean except at 1005 / 1006 / 1015, throwing outside 1000–4999; `runScenario` flushing after the exchange, checking manual-end's segment, and reporting `<n> timer(s) still armed after the session ended`.

- [ ] **Step 1: Write the failing tests.** In `src/lib/contract/clock.test.ts`:

```diff
--- a/src/lib/contract/clock.test.ts
+++ b/src/lib/contract/clock.test.ts
@@ -43,6 +43,33 @@
     clock.advance(50);
     expect(seen).toEqual([10, 20]);
   });
+
+  it('counts the timers armed and not yet fired or cancelled (the kit\'s pending count; Stage 2 Palabra, ruling 15)', () => {
+    const clock = createVirtualClock();
+    expect(clock.pending()).toBe(0);
+    const cancelA = clock.setTimeout(() => {}, 10);
+    clock.setTimeout(() => {}, 20);
+    expect(clock.pending()).toBe(2);
+    cancelA();
+    // A second cancel, or a cancel after it fired, counts nothing.
+    cancelA();
+    expect(clock.pending()).toBe(1);
+    clock.advance(20);
+    expect(clock.pending()).toBe(0);
+    const cancelFired = clock.setTimeout(() => {}, 5);
+    clock.advance(5);
+    cancelFired();
+    expect(clock.pending()).toBe(0);
+  });
+
+  it('never reaches zero while an interval runs, and does once it is cancelled', () => {
+    const clock = createVirtualClock();
+    const stop = every(clock, 100, () => {});
+    clock.advance(1_000);
+    expect(clock.pending()).toBe(1);
+    stop();
+    expect(clock.pending()).toBe(0);
+  });
 });
 
 describe('every', () => {
```

In `src/lib/contract/testing/fakeSocket.test.ts` — one existing case changes: a server's close frame is clean whatever its code, as a browser reports it:

```diff
--- a/src/lib/contract/testing/fakeSocket.test.ts
+++ b/src/lib/contract/testing/fakeSocket.test.ts
@@ -57,7 +57,7 @@
     expect(onclose).toHaveBeenCalledTimes(1);
   });
 
-  it('a server close is clean only at 1000; a drop is an error, then an unclean 1006', async () => {
+  it("a server's close frame is clean whatever its code, one no frame carries is not, a code no browser reports throws; a drop is an error, then an unclean 1006 (Stage 2 Palabra, ruling 15)", async () => {
     const s = new FakeSocket('wss://x', undefined);
     const onclose = vi.fn();
     s.onclose = onclose;
@@ -65,7 +65,21 @@
     s.serverClose(1011, 'err');
     await Promise.resolve();
     expect(onclose).toHaveBeenCalledTimes(1);
-    expect(onclose.mock.calls[0][0]).toMatchObject({ code: 1011, reason: 'err', wasClean: false });
+    expect(onclose.mock.calls[0][0]).toMatchObject({ code: 1011, reason: 'err', wasClean: true });
+
+    for (const [code, clean] of [[1008, true], [4001, true], [1006, false], [1005, false], [1015, false]] as const) {
+      const c = new FakeSocket('wss://c', undefined);
+      const seen = vi.fn();
+      c.onclose = seen;
+      c.open();
+      c.serverClose(code);
+      await Promise.resolve();
+      expect(seen.mock.calls[0][0], String(code)).toMatchObject({ code, wasClean: clean });
+    }
+    const bad = new FakeSocket('wss://b', undefined);
+    bad.open();
+    expect(() => bad.serverClose(999)).toThrow('no browser reports that close code');
+    expect(() => bad.serverClose(5000)).toThrow('no browser reports that close code');
 
     const d = new FakeSocket('wss://y', undefined);
     const onerror = vi.fn();
@@ -81,6 +95,21 @@
     expect(dropClose.mock.calls[0][0]).toMatchObject({ code: 1006, wasClean: false });
   });
 
+  it("refuses a close code or reason a browser refuses, as a browser does: before anything closes (Stage 2 Palabra, ruling 15)", () => {
+    const s = new FakeSocket('wss://x', undefined);
+    s.open();
+    for (const code of [1001, 1006, 1008, 2999, 5000]) {
+      expect(() => s.close(code), String(code)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
+    }
+    expect(() => s.close(1000, 'x'.repeat(124))).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
+    expect(s.readyState).toBe(FakeSocket.OPEN);
+    expect(s.closedByClient).toBeNull();
+    // What a browser takes: no code, 1000, 3000–4999, and a reason of 123 bytes.
+    expect(() => new FakeSocket('wss://a', undefined).close()).not.toThrow();
+    expect(() => new FakeSocket('wss://b', undefined).close(3000, 'x'.repeat(123))).not.toThrow();
+    expect(() => new FakeSocket('wss://c', undefined).close(4999)).not.toThrow();
+  });
+
   it('closing a socket that never opened fails it, as a browser does: error, then an unclean 1006, after the call returns', async () => {
     const s = new FakeSocket('wss://x', undefined);
     const seen: string[] = [];
```

In `src/lib/contract/testing/scenarios.test.ts` — each new case has its control in the same file (the template harness passes):

```diff
--- a/src/lib/contract/testing/scenarios.test.ts
+++ b/src/lib/contract/testing/scenarios.test.ts
@@ -1,5 +1,6 @@
 import { describe, it, expect } from 'vitest';
 import { AdapterStartError, type Adapter, type AdapterSession, type SessionContext } from '../adapter';
+import { every } from '../clock';
 import { createFakeAdapter, type FakeConfig, type FakeCredentials } from '../../../providers/fake/adapter';
 import { exchange } from '../../../providers/fake/script';
 import { driveAdapter } from './drive';
@@ -178,6 +179,46 @@
     }
   });
 
+  it("lets an exchange answered after an await land before the server's close, with no flush in the harness (Stage 2 Palabra, ruling 15)", async () => {
+    // Answers each frame a few microtasks late and says `closed` on a close it did not ask for: without the kit's flush, the answer would come after `closed`.
+    const lateClosing: Pick<Adapter<EchoConfig, { key: string }>, 'start'> = {
+      start: (request, events) => new Promise<AdapterSession>((resolve) => {
+        const ws = request.config.openSocket('wss://echo.test/translate');
+        let ended = false;
+        ws.onopen = () => resolve(idle(async () => { ended = true; ws.close(1000); }));
+        ws.onmessage = async () => {
+          await hops(3)();
+          events.segmentOpened({ ref: 1, side: 'source' });
+          events.segmentText({ ref: 1, text: 'Hello.' });
+          events.segmentClosed({ ref: 1 });
+        };
+        ws.onclose = () => { if (!ended) { ended = true; events.closed({ reason: 'the server went away' }); } };
+      }),
+    };
+    const report = await runScenario({ ...echoHarness, adapter: lateClosing, serverClose: [{ run: () => sockets.last().serverClose(1011, 'server error') }] }, 'server-close');
+    expect(report).toEqual({ name: 'server-close', violations: [], problems: [] });
+  });
+
+  it('catches a release that produces no segment (Stage 2 Palabra, ruling 15)', async () => {
+    const report = await runScenario(brokenHarness, 'manual-end');
+    expect(report.problems).toContain('the release and the exchange steps produced no segment');
+  });
+
+  it('catches a timer that outlives the session, and counts none for an adapter that cancels its own (Stage 2 Palabra, ruling 15)', async () => {
+    // The template, with a keep-alive it never stops.
+    const leaking: Pick<Adapter<EchoConfig, { key: string }>, 'start'> = {
+      start: async (request, events) => {
+        const session = await createEchoAdapter().start(request, events);
+        every(request.clock, 100, () => {});
+        return session;
+      },
+    };
+    const leaked = await runScenario({ ...echoHarness, adapter: leaking }, 'open-stop');
+    expect(leaked.problems).toContain('1 timer(s) still armed after the session ended');
+    // The control: the template as it is.
+    expect((await runScenario(echoHarness, 'open-stop')).problems).toEqual([]);
+  });
+
   it('asks a harness only for what it has', async () => {
     const names = scenarioNames({});
     expect(names).not.toContain('text');
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/contract/clock.test.ts src/lib/contract/testing/fakeSocket.test.ts src/lib/contract/testing/scenarios.test.ts`
Expected: FAIL — 7 failed, 31 passed: `clock.pending is not a function` (two), the 1011 close still unclean, `close(1001)` not refused, the late exchange's answer landing after `closed`, manual-end's missing segment and the leaked timer not reported.

- [ ] **Step 3: The pending count.** In `src/lib/contract/clock.ts`:

```diff
--- a/src/lib/contract/clock.ts
+++ b/src/lib/contract/clock.ts
@@ -106,12 +106,20 @@
    *  insertion. A timer scheduled by a callback fires in the same advance
    *  when it falls due inside it. */
   advance(ms: number): void;
+  /**
+   * The timers armed and not yet fired or cancelled: what a session's stop
+   * must leave at zero. An interval that outlives `stop()` re-arms on every
+   * beat and never reaches zero (the kit's parked item; Stage 2 Palabra,
+   * ruling 15).
+   */
+  pending(): number;
 }
 
 interface Timer {
   at: number;
   seq: number;
   fn: () => void;
+  /** Cancelled, or fired: either way no longer pending. */
   cancelled: boolean;
 }
 
@@ -123,6 +131,8 @@
    *  schedules tens of thousands of timers; a linear scan per pop would be
    *  quadratic. */
   const timers: Timer[] = [];
+  /** Armed, not yet fired or cancelled. */
+  let live = 0;
 
   const before = (a: Timer, b: Timer) => a.at < b.at || (a.at === b.at && a.seq < b.seq);
 
@@ -137,7 +147,12 @@
         if (before(timers[mid], timer)) lo = mid + 1; else hi = mid;
       }
       timers.splice(lo, 0, timer);
-      return () => { timer.cancelled = true; };
+      live += 1;
+      return () => {
+        if (timer.cancelled) return;
+        timer.cancelled = true;
+        live -= 1;
+      };
     },
     advance(ms) {
       const target = now + ms;
@@ -148,11 +163,15 @@
       while (i < timers.length && timers[i].at <= target) {
         const due = timers[i++];
         if (due.cancelled) continue;
+        // Fired: no longer pending, and a cancel from inside its callback counts nothing.
+        due.cancelled = true;
+        live -= 1;
         now = due.at;
         due.fn();
       }
       timers.splice(0, i);
       now = target;
     },
+    pending: () => live,
   };
 }
```

In `src/lib/contract/testing/trackedClock.ts`:

```diff
--- a/src/lib/contract/testing/trackedClock.ts
+++ b/src/lib/contract/testing/trackedClock.ts
@@ -13,6 +13,7 @@
   const clock: VirtualClock = {
     now: () => inner.now(),
     advance: (ms) => inner.advance(ms),
+    pending: () => inner.pending(),
     setTimeout(fn, ms) {
       const id = Symbol('timer');
       live.add(id);
```

- [ ] **Step 4: A socket that refuses what a browser refuses.** In `src/lib/contract/testing/fakeSocket.ts`:

```diff
--- a/src/lib/contract/testing/fakeSocket.ts
+++ b/src/lib/contract/testing/fakeSocket.ts
@@ -6,8 +6,10 @@
  * adapter's, the server's or a dropped connection's — fires `close` once,
  * on a microtask as a browser queues it, and nothing after it; an adapter
  * closing a socket that never opened fails it (`error`, then an unclean
- * 1006); a binary frame arrives as `binaryType` asks. Test-only: nothing
- * but a test imports `src/lib/contract/testing`.
+ * 1006), and a close code or reason a browser refuses throws as a browser
+ * does; a server's close frame is a clean close, whatever its code; a
+ * binary frame arrives as `binaryType` asks. Test-only: nothing but a test
+ * imports `src/lib/contract/testing`.
  */
 export type SocketData = string | ArrayBufferLike | Blob | ArrayBufferView;
 
@@ -51,6 +53,13 @@
   }
 
   close(code?: number, reason?: string): void {
+    // A browser refuses these before anything else (the kit's parked item; Stage 2 Palabra, ruling 15): a code only 1000 or 3000–4999, a reason of at most 123 bytes.
+    if (code !== undefined && code !== 1000 && !(code >= 3000 && code <= 4999)) {
+      throw new DOMException(`Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`, 'InvalidAccessError');
+    }
+    if (reason !== undefined && new TextEncoder().encode(reason).length > 123) {
+      throw new DOMException("Failed to execute 'close' on 'WebSocket': The close reason must not be greater than 123 UTF-8 bytes.", 'SyntaxError');
+    }
     if (this.readyState >= FakeSocket.CLOSING) return;
     this.closedByClient = { code, reason };
     // Before `open` a browser fails the connection: `error`, then an unclean 1006, whatever code was asked.
@@ -73,10 +82,17 @@
     this.fire(new MessageEvent('message', { data: delivered }));
   }
 
-  /** The server closes the connection: clean at 1000, unclean at any other code. */
+  /**
+   * The server closes the connection with a close frame: a clean close,
+   * whatever its code (1008, Palabra's rate limit, too). 1005, 1006 and 1015
+   * never travel in a frame — a browser reports them for a close no frame
+   * ended — so they arrive unclean. A code no browser reports throws: the
+   * test is wrong (the kit's parked item; Stage 2 Palabra, ruling 15).
+   */
   serverClose(code = 1000, reason = ''): void {
+    if (!(code >= 1000 && code <= 4999)) throw new Error(`serverClose(${code}): no browser reports that close code`);
     if (this.readyState >= FakeSocket.CLOSING) return;
-    this.closing(code, reason, code === 1000);
+    this.closing(code, reason, code !== 1005 && code !== 1006 && code !== 1015);
   }
 
   /** The connection drops: `error`, then an unclean `close` 1006. */
```

- [ ] **Step 5: The scenarios.** In `src/lib/contract/testing/scenarios.ts`:

```diff
--- a/src/lib/contract/testing/scenarios.ts
+++ b/src/lib/contract/testing/scenarios.ts
@@ -87,6 +87,8 @@
   const drive = (context: SessionContext, opening: readonly ScenarioStep[], steps: readonly ScenarioStep[]) =>
     driveAdapter(h.adapter, { context, config: h.config(context, name), credentials: h.credentials, opening, steps });
   const manual: SessionContext = { ...AUTO, turns: 'manual' };
+  // The exchange's answer lands before whatever the scenario does next: an adapter that answers after an `await` needs no flush of its harness's own (the kit's parked item; Stage 2 Palabra, ruling 15).
+  const exchange: readonly ScenarioStep[] = [...h.exchange, { flush: true }];
   let r: DriveResult;
   switch (name) {
     case 'open-stop':
@@ -104,6 +106,7 @@
       break;
     case 'manual-end':
       r = await drive(manual, h.opening(name), [{ turn: 'begin' }, { audio: 600 }, { turn: 'end' }, ...h.exchange]);
+      if (!kinds(untilStop(r.log)).includes('segmentOpened')) problems.push('the release and the exchange steps produced no segment');
       break;
     case 'manual-cancel':
       r = await drive(manual, h.opening(name), [{ turn: 'begin' }, { audio: 100 }, { turn: 'cancel' }, { advance: 5_000 }]);
@@ -113,12 +116,12 @@
       r = await drive(AUTO, h.opening(name), [{ text: 'typed words' }, ...h.answerText]);
       break;
     case 'server-close':
-      r = await drive(AUTO, h.opening(name), [...h.exchange, ...h.serverClose]);
+      r = await drive(AUTO, h.opening(name), [...exchange, ...h.serverClose]);
       if (!kinds(r.log).some((k) => k === 'closed' || k === 'failed')) problems.push('the server ended the session and the adapter did not say so (failed or closed)');
       break;
     case 'reconnect': {
       if (!h.reconnect) throw new Error('this harness does not reconnect');
-      r = await drive(AUTO, h.opening(name), [...h.exchange, ...h.reconnect, ...h.exchange]);
+      r = await drive(AUTO, h.opening(name), [...exchange, ...h.reconnect, ...h.exchange]);
       const k = kinds(r.log);
       const at = k.indexOf('reconnecting');
       if (at < 0 || k.indexOf('reconnected', at) < 0) problems.push('no reconnecting followed by reconnected');
@@ -132,5 +135,7 @@
     if (r.startOutcome === 'hung') problems.push('start neither resolved nor rejected after the opening steps (it hung)');
     if (r.startOutcome === 'rejected') problems.push(`start rejected: ${describeCause(r.startError)}`);
   }
+  // Stopped or refused, and the clock run on: an adapter leaves no timer armed — an interval that outlives its session re-arms forever (the kit's parked item; Stage 2 Palabra, ruling 15). A start that hung is still opening, its bound still armed: its own problem says so.
+  if (r.startOutcome !== 'hung' && r.clock.pending() > 0) problems.push(`${r.clock.pending()} timer(s) still armed after the session ended`);
   return { name, violations: r.violations, problems };
 }
```

- [ ] **Step 6: Run the kit and every provider's conformance.** Every registered provider's adapter runs the stricter scenarios — no timer left, a flush after each exchange, only codes a browser takes — and passes; a failure there is a real leak, and the implementer stops and reports it.

Run: `npx vitest run src/lib/contract src/providers`
Expected: PASS — 115 files, 1 566 tests: every provider's conformance under the stricter kit.

- [ ] **Step 7: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/contract/clock.ts src/lib/contract/clock.test.ts src/lib/contract/testing/trackedClock.ts src/lib/contract/testing/fakeSocket.ts src/lib/contract/testing/fakeSocket.test.ts src/lib/contract/testing/scenarios.ts src/lib/contract/testing/scenarios.test.ts
```

```bash
git commit -q -F - -- src/lib/contract/clock.ts src/lib/contract/clock.test.ts src/lib/contract/testing/trackedClock.ts src/lib/contract/testing/fakeSocket.ts src/lib/contract/testing/fakeSocket.test.ts src/lib/contract/testing/scenarios.ts src/lib/contract/testing/scenarios.test.ts <<'EOF'
test(contract): the kit's four parked items

The virtual clock counts what is still armed and every scenario checks it
is zero once the session has ended; FakeSocket refuses the close codes and
reasons a browser refuses; an exchange's answer lands before the server's
close; manual-end must make a segment.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 6: Two redaction shapes, a kit-wide URL rule, and the Logs' rows (Wave 1)

**Files:**
- Modify: `src/lib/diagnostics/redact.ts` (`:40-41`, the query rule's comment; `:62`, the bare-key rule, and a JWT rule after it), `src/lib/contract/conformance.ts` (`:204`, the frame case; after `:245`, `frameUrl`), `src/stores/logStore.ts` (`:433`)
- Test: `src/lib/diagnostics/redact.test.ts` (after `:73`), `src/lib/contract/conformance.test.ts` (after `:100`), `src/stores/logStore.test.ts` (after `:238`)

**Interfaces:**
- Consumes: nothing new.
- Produces (choices 10, 11): `redact()` masking a bare `plbr_…` key and a JWT; `checkConformance`'s rule `frame-url`; `logStore`'s grouping of `transcription.partial`, `translation.partial` and `audio.output` under their own types.

- [ ] **Step 1: Write the failing tests.** In `src/lib/diagnostics/redact.test.ts`:

```diff
--- a/src/lib/diagnostics/redact.test.ts
+++ b/src/lib/diagnostics/redact.test.ts
@@ -71,6 +71,33 @@
     expect(redact('?API_APP_KEY=a1&Api_Access_Key=b2')).toBe('?API_APP_KEY=[REDACTED]&Api_Access_Key=[REDACTED]');
   });
 
+  // palabraai/wire.ts `directUrl` and `sessionUrl` — Palabra's socket takes the
+  // platform key or a REST session's publisher token in its query (Stage 2
+  // Palabra, ruling 1): the parameter's name stays, the value goes.
+  it("redacts Palabra's socket token, keeping the parameter's name", () => {
+    expect(redact('wss://streaming.palabra.ai/streaming-api/4593a758/v1/speech-to-speech/stream?token=plbr_0123456789abcdef'))
+      .toBe('wss://streaming.palabra.ai/streaming-api/4593a758/v1/speech-to-speech/stream?token=[REDACTED]');
+  });
+
+  // palabraai/wire.ts `restHeaders` / `directUrl` — Palabra's platform key has a
+  // documented shape, `plbr_…` (Stage 2 Palabra, choice 10): masked wherever it
+  // stands bare, as the other providers' key shapes are.
+  it('redacts a bare Palabra platform key', () => {
+    expect(redact('Invalid API key plbr_Abc-def_0123456789 for this organization'))
+      .toBe('Invalid API key [REDACTED] for this organization');
+    expect(redact('plbr_short')).toBe('plbr_short');
+  });
+
+  // palabraai/wire.ts `readCreated` — a REST session's publisher token, and its
+  // id of the same shape in the owner's probe, are JWTs (Stage 2 Palabra,
+  // choice 10): masked whole. A string that only starts like one stays.
+  it('redacts a JWT whole', () => {
+    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwdWJsaXNoZXIifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
+    expect(redact(`publisher ${jwt} issued`)).toBe('publisher [REDACTED] issued');
+    expect(redact(`{"id":"${jwt}"}`)).toBe('{"id":"[REDACTED]"}');
+    expect(redact('eyJ is how every JWT starts')).toBe('eyJ is how every JWT starts');
+  });
+
   it('redacts Bearer tokens but keeps the scheme', () => {
     expect(redact('Authorization: Bearer sess_abcdef123456'))
       .toBe('Authorization: Bearer [REDACTED]');
```

In `src/lib/contract/conformance.test.ts`:

```diff
--- a/src/lib/contract/conformance.test.ts
+++ b/src/lib/contract/conformance.test.ts
@@ -98,6 +98,18 @@
     expect(rules(log)).toContain('frame-secret');
   });
 
+  it('flags a socket URL in a frame payload, whatever carries its credential (Stage 2 Palabra, choice 10)', () => {
+    // `redact()` masks `token=` already: the URL is flagged for being a socket URL, not for its secret.
+    const masked = [frame('out', 'session.opened', { url: 'wss://streaming.palabra.ai/streaming-api/ab12/v1/speech-to-speech/stream?token=[REDACTED]' })];
+    expect(rules(masked)).toContain('frame-url');
+    // A parameter no rule names, deep in the payload, in any case.
+    const unnamed = [frame('in', 'session.whatever', { attempts: [{ to: 'WS://host.example/stream?credential=abc' }] })];
+    expect(rules(unnamed)).toContain('frame-url');
+    // An https URL, or prose that mentions a socket, is no socket URL.
+    const fine = [frame('out', 'session.create', { endpoint: 'https://api.palabra.ai/session-storage/session', note: 'the ws transport' })];
+    expect(rules(fine)).not.toContain('frame-url');
+  });
+
   it('flags audio when speech is off', () => {
     const log: ConformanceLog = [opened(1, 'translation'), text(1, 'hi'), { kind: 'audio', payload: { ref: 1, pcm } }];
     expect(rules(log, { ...auto, speech: false })).toContain('no-audio-when-silent');
```

In `src/stores/logStore.test.ts` — every frame name the adapter (Task 13) emits, the three streamed ones grouped and the rest ungrouped:

```diff
--- a/src/stores/logStore.test.ts
+++ b/src/stores/logStore.test.ts
@@ -237,6 +237,24 @@
     for (const type of others) add(type);
     expect(entriesFor('speaker').slice(deltas.length).map((e) => [e.eventType, e.groupingKey])).toEqual(others.map((type) => [type, undefined]));
   });
+
+  it("groups Palabra's streamed frames each under its own type, and gives its other frames no key (Stage 2 Palabra, choice 11)", () => {
+    const add = (type: string) => useLogStore.getState().addRealtimeEvent({ type, data: {} } as any, 'server', type, 'speaker');
+    const streamed = ['transcription.partial', 'translation.partial', 'audio.output'];
+    for (const type of streamed) {
+      add(type);
+      add(type);
+    }
+    expect(entriesFor('speaker').map((e) => [e.groupingKey, e.events?.length])).toEqual(streamed.map((type) => [type, 2]));
+    // None of its other names is the microphone's row, one of Doubao's (`subtitle.*`, `tts.*`, `session.usage`, `session.audio_muted`), the old client's, or anyone's: one entry each, ungrouped.
+    const others = [
+      'session.create', 'session.created', 'session.create_failed', 'session.opened', 'task.set', 'task.get', 'task.not_found', 'task.current',
+      'transcription.validated', 'translation.final', 'audio.idle', 'audio.resumed', 'turn.flush',
+      'session.warning', 'session.error', 'session.end_of_stream', 'session.unknown', 'session.unreadable', 'session.socket_error', 'session.connection_lost',
+    ];
+    for (const type of others) add(type);
+    expect(entriesFor('speaker').slice(streamed.length).map((e) => [e.eventType, e.groupingKey])).toEqual(others.map((type) => [type, undefined]));
+  });
 });
 
 describe('logStore — channel filing', () => {
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/lib/diagnostics/redact.test.ts src/lib/contract/conformance.test.ts src/stores/logStore.test.ts`
Expected: FAIL — 4 failed, 70 passed: the bare `plbr_` key and the JWT not redacted, no `frame-url` rule, the three streamed frames ungrouped.

- [ ] **Step 3: The redaction.** In `src/lib/diagnostics/redact.ts`:

```diff
--- a/src/lib/diagnostics/redact.ts
+++ b/src/lib/diagnostics/redact.ts
@@ -38,6 +38,10 @@
   // credentials in the socket's query (`volcengine_ast2/wire.ts` `ast2Url`,
   // Stage 2 Volcengine AST2 ruling 2). The URL is never put in a frame, an
   // error or a notice; this is the net for one that reaches a sink anyway.
+  //
+  // `token`: Palabra's socket takes the platform key, or a REST session's
+  // publisher token, in its query (`palabraai/wire.ts` `directUrl` and
+  // `sessionUrl`, Stage 2 Palabra, ruling 1) — the same net.
   [
     /([?&](?:key|api_key|api_app_key|api_access_key|apikey|token|access_token|accessToken|secret|signature|x-credential|x-signature|x-security-token)=)[^&\s"']+/gi,
     `$1${REDACTED}`,
@@ -59,7 +63,17 @@
   // Bare provider key shapes. `sk-`/`AIza`/`key-` were already redacted by
   // errorTracking.ts:57; `ek_` is the OpenAI ephemeral client secret
   // (EphemeralTokenService.ts:190), which :200 could otherwise dump wholesale.
-  [/\b(?:sk-|AIza|key-|ek_)[A-Za-z0-9_-]{10,}\b/g, REDACTED],
+  // `plbr_` is Palabra's platform key, a documented shape (its OpenAPI's
+  // `APIKey` scheme), in the REST header and the direct socket's query
+  // (`palabraai/wire.ts` `restHeaders`, `directUrl`): a net for a key
+  // Palabra's own words might quote (Stage 2 Palabra, choice 10).
+  [/\b(?:sk-|AIza|key-|ek_|plbr_)[A-Za-z0-9_-]{10,}\b/g, REDACTED],
+  // A JWT, whole: Palabra's REST session hands out a publisher token (and an
+  // id of the same shape, as the owner's probe logged it) that rides the
+  // session socket's query (`palabraai/wire.ts` `readCreated`, `sessionUrl`;
+  // Stage 2 Palabra, choice 10). Neither is framed; this is the net, and
+  // what lets the kit's `frame-secret` rule catch one that is.
+  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, REDACTED],
   // Account addresses — named in #441. Reached via the wallet and auth paths
   // (UserProfileContext, settingsStore.ts:1121).
   [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, REDACTED],
```

- [ ] **Step 4: The rule.** In `src/lib/contract/conformance.ts`:

```diff
--- a/src/lib/contract/conformance.ts
+++ b/src/lib/contract/conformance.ts
@@ -202,6 +202,8 @@
         if (problem) flag('frame-clean', problem, index);
         const secret = frameSecret(payload);
         if (secret) flag('frame-secret', secret, index);
+        const url = frameUrl(payload);
+        if (url) flag('frame-url', url, index);
         break;
       }
       default:
@@ -243,6 +245,31 @@
   return null;
 }
 
+/**
+ * Where a frame payload holds a socket URL, or null (Stage 2 Palabra,
+ * choice 10): Gemini's key, Doubao AST 2.0's credentials and Palabra's
+ * token ride in their socket's query, and `redact()` masks only the
+ * parameters it names. No adapter frames its URL; this holds every one to
+ * it, whatever the parameter is called.
+ */
+function frameUrl(value: unknown, path = 'payload'): string | null {
+  if (typeof value === 'string') return /\bwss?:\/\//i.test(value) ? `${path} carries a socket URL` : null;
+  if (Array.isArray(value)) {
+    for (let i = 0; i < value.length; i++) {
+      const p = frameUrl(value[i], `${path}[${i}]`);
+      if (p) return p;
+    }
+    return null;
+  }
+  if (value && typeof value === 'object' && !(value instanceof Int16Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value))) {
+    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
+      const p = frameUrl(v, `${path}.${k}`);
+      if (p) return p;
+    }
+  }
+  return null;
+}
+
 /** Where a frame payload holds a string value `redact()` would change, or null: a credential by shape, not by key name. */
 function frameSecret(value: unknown, path = 'payload'): string | null {
   if (value instanceof Int16Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return null;
```

- [ ] **Step 5: The rows.** In `src/stores/logStore.ts`:

```diff
--- a/src/stores/logStore.ts
+++ b/src/stores/logStore.ts
@@ -430,7 +430,15 @@
         // Group Gemini input transcription events together
         groupingKey = 'gemini_input_transcription';
       }
-      // PalabraAI-specific grouping
+      // Palabra's frames that come in streams (Stage 2 Palabra, choice 11): a
+      // partial's snapshots, about four a second, and a sentence's audio, a
+      // burst of 200 ms chunks — each grouped under its own type when
+      // consecutive, the `.delta` rule's way, with no key another provider's
+      // frames could share.
+      else if (eventType === 'transcription.partial' || eventType === 'translation.partial' || eventType === 'audio.output') {
+        groupingKey = eventType;
+      }
+      // PalabraAI-specific grouping (the old client's names; they go with it)
       else if (eventType === 'partial_transcription') {
         // Group PalabraAI partial transcription events together
         groupingKey = 'palabraai_partial_transcription';
```

- [ ] **Step 6: Run the diagnostics, the kit, the Logs and every provider's conformance.** No adapter frames a socket URL (each passes `frame-url`), and no existing redaction case changes: the new shapes match nothing the old cases hold.

Run: `npx vitest run src/lib/diagnostics src/lib/contract src/stores/logStore.test.ts src/providers src/components/LogsPanel`
Expected: PASS — 120 files, 1 654 tests.

- [ ] **Step 7: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/diagnostics/redact.ts src/lib/diagnostics/redact.test.ts src/lib/contract/conformance.ts src/lib/contract/conformance.test.ts src/stores/logStore.ts src/stores/logStore.test.ts
```

```bash
git commit -q -F - -- src/lib/diagnostics/redact.ts src/lib/diagnostics/redact.test.ts src/lib/contract/conformance.ts src/lib/contract/conformance.test.ts src/stores/logStore.ts src/stores/logStore.test.ts <<'EOF'
feat(diagnostics): Palabra's key and tokens masked; no socket URL in a frame

redact() masks a bare plbr_ key and a JWT whole; the conformance kit
flags a frame that holds a ws(s) URL, whatever its credential is called;
the Logs group Palabra's three streamed frames by their own type.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```


---

### Task 7: The kit's seeded lifecycle scenario (Wave 2)

**Files:**
- Create: `src/lib/contract/testing/lifecycle.ts`, `src/lib/contract/testing/lifecycle.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `AdapterSession`, `SessionContext` (`src/lib/contract/adapter`); `createVirtualClock`, `VirtualClock` with Task 5's `pending()` (`src/lib/contract/clock`); `checkConformance`, `recordConformance`, `ConformanceLog` (`src/lib/contract/conformance`); `flush` (`./drive`); `FakeSocket`, `fakeSockets`, `FakeSockets` (`./fakeSocket`).
- Produces (ruling 15):
  - `LifecycleRun` — `{ index, rand(), pick(items), clock, sockets, context, count(key) }`;
  - `LifecycleHarness<C, K>` — `{ adapter(run), config(context, run), credentials, secrets, textInput, startBoundMs, opening(run), server(run), after?(run, log) }`;
  - `LifecycleReport` — `{ runs, failures, stats }`;
  - `runLifecycles<C, K>(h, { seed, runs }): Promise<LifecycleReport>`.

  Per run it draws the context (speech on seven runs in ten, manual turns in five), starts the adapter over the run's sockets, plays the opening — the kit's own abort or drop three runs in a hundred each, else the harness's — runs the start's bound out if the start is still pending, and fails a start that still has not settled. A live session then takes 20–99 random steps drawn the way the runner drives an adapter: a press, a release (four in five `endTurn`, else `cancelTurn`), audio in the capture's chunk sizes (always under automatic turns, only while a key is held under manual ones), typed text where the provider takes it, the harness's server step, the clock (10 ms – 10 s), a drop, or a stop. It stops a session that ended by itself, as the runner's unwind does, runs the clock 10 s on, and checks: no timer armed, every socket closed, no send once the session had ended, at most one `failed` / `closed`, no secret in any event, `checkConformance` less `text-input-answered` (a random stop may cut a typed text's answer short), and the harness's `after`. What `stop()` sends before it returns is its own; anything after is late.

- [ ] **Step 1: Write the failing test.** Create `src/lib/contract/testing/lifecycle.test.ts` — a template harness over an echo adapter that passes, the same seed replaying the same runs, and one broken adapter per check, each caught:

```ts
/**
 * The kit's seeded lifecycle scenario (Stage 2 Palabra, ruling 15), run over
 * the kit's template adapter — which it must pass, every path taken — and
 * over broken variants of it, each of which it must catch.
 */
import { describe, it, expect } from 'vitest';
import type { Adapter, AdapterSession } from '../adapter';
import { every } from '../clock';
import { createEchoAdapter, type EchoConfig } from './examples';
import { FakeSocket } from './fakeSocket';
import { runLifecycles, type LifecycleHarness } from './lifecycle';

type Echo = Pick<Adapter<EchoConfig, { key: string }>, 'start'>;

function echoHarness(adapter: Echo = createEchoAdapter()): LifecycleHarness<EchoConfig, { key: string }> {
  return {
    adapter: () => adapter,
    config: (_context, run) => ({ openSocket: run.sockets.create }),
    credentials: { key: 'test-key' },
    secrets: ['test-key'],
    textInput: true,
    // The template has no bound of its own: its every opening settles.
    startBoundMs: 0,
    opening: (run) => {
      if (run.rand() < 0.1) run.sockets.last().serverClose(4001, 'bad key');
      else run.sockets.last().open();
    },
    server: (run) => {
      const socket = run.sockets.last();
      if (socket.readyState !== FakeSocket.OPEN) return;
      const r = run.rand();
      if (r < 0.8) socket.receive(JSON.stringify({ source: 'Hello.', translation: 'こんにちは。' }));
      else if (r < 0.9) socket.receive('not json');
      else socket.serverClose(1011, 'server error');
    },
  };
}

/** The template, with its session wrapped: what each broken variant changes. */
function wrapped(change: (session: AdapterSession, request: Parameters<Echo['start']>[0], events: Parameters<Echo['start']>[1]) => AdapterSession): Echo {
  return {
    start: async (request, events) => change(await createEchoAdapter().start(request, events), request, events),
  };
}

describe('runLifecycles', () => {
  it('passes the kit\'s template adapter over every path: refused, live, ended by the server, stopped', async () => {
    const report = await runLifecycles(echoHarness(), { seed: 7, runs: 200 });
    expect(report.failures).toEqual([]);
    expect(report.runs).toBe(200);
    for (const key of ['refused', 'live', 'stopped', 'end.closed']) expect(report.stats[key], key).toBeGreaterThan(0);
  });

  it('plays the same runs for the same seed', async () => {
    const a = await runLifecycles(echoHarness(), { seed: 11, runs: 40 });
    const b = await runLifecycles(echoHarness(), { seed: 11, runs: 40 });
    expect(a.stats).toEqual(b.stats);
  });

  it('catches a timer the session leaves armed', async () => {
    const leaking = wrapped((session, request) => { every(request.clock, 100, () => {}); return session; });
    const report = await runLifecycles(echoHarness(leaking), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.endsWith('timer(s) still armed after the session ended'))).toBe(true);
  });

  it('catches a send after the session ended', async () => {
    // Its stop sends one frame after its first await, straight to the socket.
    const lateSender: Echo = {
      start: async (request, events) => {
        let socket: WebSocket | undefined;
        const session = await createEchoAdapter().start({ ...request, config: { openSocket: (url) => { socket = request.config.openSocket(url); return socket; } } }, events);
        return { ...session, stop: async () => { await Promise.resolve(); socket?.send('late'); await session.stop(); } };
      },
    };
    const report = await runLifecycles(echoHarness(lateSender), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.endsWith('send(s) after the session ended'))).toBe(true);
  });

  it('catches an event said after stop', async () => {
    const chatty = wrapped((session, request, events) => ({
      ...session,
      stop: async () => { await session.stop(); request.clock.setTimeout(() => events.segmentOpened({ ref: 999, side: 'source' }), 100); },
    }));
    const report = await runLifecycles(echoHarness(chatty), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.includes('conformance stop-silence'))).toBe(true);
  });

  it('catches a socket left open, and a secret in an event', async () => {
    const leaky: Echo = {
      start: async (request, events) => {
        const session = await createEchoAdapter().start(request, events);
        events.frame({ direction: 'out', type: 'session.key', payload: { note: `the key is ${request.credentials.key}` } });
        // Its stop forgets the socket.
        return { ...session, stop: async () => {} };
      },
    };
    const report = await runLifecycles(echoHarness(leaky), { seed: 7, runs: 20 });
    expect(report.failures.some((f) => f.endsWith('socket(s) left open after the session ended'))).toBe(true);
    expect(report.failures.some((f) => f.endsWith('a frame event carried a secret'))).toBe(true);
  });

  it('catches a start that never settles', async () => {
    const hangs: Echo = { start: () => new Promise<AdapterSession>(() => {}) };
    const report = await runLifecycles({ ...echoHarness(hangs), opening: () => {} }, { seed: 7, runs: 3 });
    expect(report.failures).toEqual([
      'run 0: the start neither resolved nor rejected once its bound had run',
      'run 1: the start neither resolved nor rejected once its bound had run',
      'run 2: the start neither resolved nor rejected once its bound had run',
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/lib/contract/testing/lifecycle.test.ts`
Expected: FAIL — `Failed to resolve import "./lifecycle" from "src/lib/contract/testing/lifecycle.test.ts"`.

- [ ] **Step 3: Write the scenario.** Create `src/lib/contract/testing/lifecycle.ts`:

```ts
/**
 * The kit's seeded lifecycle scenario (Stage 2 Palabra, ruling 15): many
 * random lives of one adapter, each driven the way the runner drives it —
 * audio always under automatic turns, only while a key is held under manual
 * ones; a press, a release with or without speech; typed text where the
 * provider takes it; the server's own steps, the clock, a dropped
 * connection, a stop — over FakeSockets on a virtual clock, and checked for
 * what every adapter owes whatever the interleaving. Modelled on the OpenAI
 * Translate and OpenAI Realtime final reviews' fuzzes; the conformance
 * scenarios pin one path each, this one many orders of the same steps.
 *
 * What it checks, per run:
 * - the start settles: it resolves or rejects once the opening and the
 *   start's own bound have run, never hangs;
 * - a refused start says nothing but frames — its rejection is the one
 *   report of it;
 * - once the session has ended — a `failed` or `closed`, or `stop()` has
 *   returned — nothing more goes up any socket, and at most one of
 *   `failed` / `closed` is said;
 * - with the clock run on after the end, no timer is armed and every
 *   socket the adapter opened is closed;
 * - no event carries a secret the harness names;
 * - the whole log passes `checkConformance`, less `text-input-answered`: a
 *   random stop may cut a typed text's answer short;
 * - and whatever the harness checks after a run (`after`).
 *
 * The generator is seeded: a failure names its run, and the same seed plays
 * the same runs. Test-only, like the rest of the kit.
 */
import type { Adapter, AdapterSession, SessionContext } from '../adapter';
import { createVirtualClock, type VirtualClock } from '../clock';
import { checkConformance, recordConformance, type ConformanceLog } from '../conformance';
import { flush } from './drive';
import { FakeSocket, fakeSockets, type FakeSockets } from './fakeSocket';

/** One run, as the harness sees it. */
export interface LifecycleRun {
  /** The run's number, from 0: what a failure names. */
  readonly index: number;
  /** The seeded generator, in [0, 1): the harness draws its choices from it, so a seed replays them. */
  rand(): number;
  pick<T>(items: readonly T[]): T;
  readonly clock: VirtualClock;
  /** The run's sockets: the harness hands `sockets.create` to its adapter. */
  readonly sockets: FakeSockets;
  readonly context: SessionContext;
  /** Counts an outcome of the harness's own in the report's stats. */
  count(key: string): void;
}

export interface LifecycleHarness<C, K> {
  /** A fresh adapter for one run, over the run's sockets and whatever else the harness fakes (a REST server). */
  adapter(run: LifecycleRun): Pick<Adapter<C, K>, 'start'>;
  config(context: SessionContext, run: LifecycleRun): C;
  credentials: K;
  /** No event may carry any of these: the credentials, and whatever the harness's fakes hand out as secret. */
  secrets: readonly string[];
  /** The provider takes typed text: typed text is one of the random steps. */
  textInput: boolean;
  /** The start's own bound: a start still pending once the opening has run is given this much clock. */
  startBoundMs: number;
  /**
   * One way the start goes, drawn from `run.rand`: the handshake answered,
   * or refused the harness's own ways. The kit adds two of its own: the
   * start's signal aborted, and the newest socket dropped.
   */
  opening(run: LifecycleRun): void | Promise<void>;
  /** One thing the server does while the session is live, drawn from `run.rand`: a message, an error, a close. */
  server(run: LifecycleRun): void | Promise<void>;
  /** After a run has ended and the clock has run on: the harness's own invariants, as problems. */
  after?(run: LifecycleRun, log: ConformanceLog): string[];
}

export interface LifecycleReport {
  runs: number;
  /** `run <n>: <problem>`, at most 40. */
  failures: string[];
  /** How often each path was taken: `refused`, `live`, `end.failed.<code>`, `end.closed`, `stopped`, and the harness's own counts. */
  stats: Record<string, number>;
}

/** A few microtask hops: a FakeSocket's close and an awaited fake answer land within them. */
const hops = async (n = 10) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
/** Capture chunk sizes the runner hands over: the worklet's 85 ms, the ScriptProcessor fallback's 341 ms, and odd ones. */
const CHUNKS = [480, 2_048, 2_400, 4_800, 8_192] as const;
const ADVANCES = [10, 100, 320, 500, 1_000, 2_100, 5_000, 10_000] as const;
const MAX_FAILURES = 40;

/** mulberry32: small, seeded, and the same on every platform. */
function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The payload as the checks read it: pcm elided, so a key scan never reads audio. */
const readable = (value: unknown) => JSON.stringify(value ?? {}, (_k, v: unknown) => (v instanceof Int16Array ? `pcm(${v.length})` : v));

export async function runLifecycles<C, K>(h: LifecycleHarness<C, K>, o: { seed: number; runs: number }): Promise<LifecycleReport> {
  const rand = seeded(o.seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const failures: string[] = [];
  const stats: Record<string, number> = {};
  const count = (key: string) => { stats[key] = (stats[key] ?? 0) + 1; };

  for (let index = 0; index < o.runs; index++) {
    const fail = (problem: string) => { if (failures.length < MAX_FAILURES) failures.push(`run ${index}: ${problem}`); };
    const context: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: rand() < 0.7, turns: rand() < 0.5 ? 'manual' : 'auto' };
    const clock = createVirtualClock(0);
    // Set the moment the session has ended: a send from then on is a failure.
    const state = { ended: false, lateSends: 0, terminals: 0 };
    const inner = fakeSockets();
    const sockets: FakeSockets = {
      create: (url, protocols) => {
        const ws = inner.create(url, protocols);
        const socket = inner.last();
        const send = socket.send.bind(socket);
        socket.send = (data) => {
          if (state.ended) state.lateSends += 1;
          send(data);
        };
        return ws;
      },
      get all() { return inner.all; },
      last: () => inner.last(),
    };
    const run: LifecycleRun = { index, rand, pick, clock, sockets, context, count };
    const recorder = recordConformance();
    const events = recorder.events;
    const watched = { ...events };
    watched.failed = (e) => { state.terminals += 1; state.ended = true; count(`end.failed.${e.code ?? 'none'}`); events.failed(e); };
    watched.closed = (e) => { state.terminals += 1; state.ended = true; count('end.closed'); events.closed(e); };

    const controller = new AbortController();
    const settled: { session?: AdapterSession; error?: unknown; done: boolean } = { done: false };
    let starting: Promise<AdapterSession>;
    try {
      starting = h.adapter(run).start({ context, config: h.config(context, run), credentials: h.credentials, clock, signal: controller.signal }, watched);
    } catch (error) {
      fail(`start threw rather than rejecting: ${String(error)}`);
      continue;
    }
    void starting.then((session) => { settled.session = session; settled.done = true; }, (error: unknown) => { settled.error = error; settled.done = true; });

    // The opening: the kit's two ways, or the harness's own.
    const roll = rand();
    if (roll < 0.03) controller.abort(new Error('the lifecycle cancelled the start'));
    else if (roll < 0.06 && sockets.all.length > 0) sockets.last().drop();
    else await h.opening(run);
    await hops();
    if (!settled.done) {
      clock.advance(h.startBoundMs);
      await hops();
      await flush();
    }
    if (!settled.done) {
      fail('the start neither resolved nor rejected once its bound had run');
      controller.abort(new Error('the lifecycle gave up on the start'));
      await flush();
      continue;
    }

    const session = settled.session;
    if (!session) {
      count('refused');
      state.ended = true;
      for (const e of recorder.log) {
        if (e.kind !== 'marker' && e.kind !== 'frame') fail(`a refused start said ${e.kind}`);
      }
    } else {
      count('live');
      let held = false;
      const steps = 20 + Math.floor(rand() * 80);
      for (let i = 0; i < steps && !state.ended; i++) {
        const op = rand();
        try {
          if (op < 0.1) {
            if (context.turns === 'manual' && !held) { held = true; session.beginTurn(); }
          } else if (op < 0.2) {
            if (context.turns === 'manual' && held) {
              held = false;
              if (rand() < 0.8) { recorder.mark('endTurn'); session.endTurn(); } else { recorder.mark('cancelTurn'); session.cancelTurn(); }
            }
          } else if (op < 0.45) {
            if (context.turns === 'auto' || held) session.appendAudio(new Int16Array(pick(CHUNKS)).fill(900));
          } else if (op < 0.5) {
            if (h.textInput) { const text = pick(['Hello.', 'こんにちは。', ' x ']); recorder.mark('appendText', text); session.appendText(text); }
          } else if (op < 0.8) {
            await h.server(run);
            await hops();
          } else if (op < 0.97) {
            clock.advance(pick(ADVANCES));
            await hops();
          } else if (op < 0.985) {
            if (sockets.all.length > 0) { sockets.last().drop(); await hops(); }
          } else {
            recorder.mark('stop');
            count('stopped');
            // What `stop()` sends before it returns — a goodbye frame, then the close — is its own; anything after is late.
            const ending = session.stop();
            state.ended = true;
            await ending;
          }
        } catch (error) {
          fail(`a step threw: ${String(error)}`);
        }
      }
      // A session that ended by itself is stopped, as the runner's unwind does; one still live, by the kit.
      if (!recorder.log.some((e) => e.kind === 'marker' && e.payload === 'stop')) {
        recorder.mark('stop');
        const ending = session.stop();
        state.ended = true;
        await ending;
      }
    }

    clock.advance(10_000);
    await hops();
    await flush();
    if (clock.pending() > 0) fail(`${clock.pending()} timer(s) still armed after the session ended`);
    const open = sockets.all.filter((s) => s.readyState !== FakeSocket.CLOSED).length;
    if (open > 0) fail(`${open} socket(s) left open after the session ended`);
    if (state.lateSends > 0) fail(`${state.lateSends} send(s) after the session ended`);
    if (state.terminals > 1) fail(`${state.terminals} failed/closed events: at most one`);
    for (const e of recorder.log) {
      if (e.kind === 'marker') continue;
      const text = readable(e.payload);
      for (const secret of h.secrets) if (text.includes(secret)) fail(`a ${e.kind} event carried a secret`);
    }
    for (const v of checkConformance(recorder.log, context)) {
      if (v.rule !== 'text-input-answered') fail(`conformance ${v.rule}: ${v.detail}`);
    }
    for (const problem of h.after?.(run, recorder.log) ?? []) fail(problem);
  }
  return { runs: o.runs, failures, stats };
}
```

- [ ] **Step 4: Run the kit.**

Run: `npx vitest run src/lib/contract/testing`
Expected: PASS — 5 files, 40 tests.

- [ ] **Step 5: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/contract/testing/lifecycle.ts src/lib/contract/testing/lifecycle.test.ts
```

```bash
git commit -q -F - -- src/lib/contract/testing/lifecycle.ts src/lib/contract/testing/lifecycle.test.ts <<'EOF'
test(contract): a seeded lifecycle scenario for any adapter

Many random lives of one adapter over FakeSockets on a virtual clock,
driven the way the runner drives it, each checked for what every adapter
owes: a start that settles, silence after its end, no timer or socket
left, no secret in an event, conformance.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 8: Palabra's settings, credentials, languages and builder (Wave 2)

**Files:**
- Create: `src/providers/palabraai/adapter.ts` (a seed, first), `src/providers/palabraai/settings.ts`, `src/providers/palabraai/config.ts`
- Test: `src/providers/palabraai/settings.test.ts`, `src/providers/palabraai/config.test.ts`

**Interfaces:**
- Consumes: `AUTO`, and Task 4's `reversedPair` in the test (`src/lib/provider/languages`); `CredentialField`, `CredentialsMissing`, `LanguageOption`, `LanguagePair`, `Provider`, `ProviderRefusal`, `SharedSettings` (`src/lib/provider/types`); `SessionContext` (`src/lib/contract/adapter`).
- Produces:
  - `settings.ts`: `PalabraAuthMode = 'platform' | 'app'`, `PalabraVoice = 'default_low' | 'default_high'`, `PalabraSettings` (`S`), `PALABRA_DEFAULTS`, `SILENCE_THRESHOLD_RANGE`, `DESIRED_QUEUE_RANGE`, `MAX_QUEUE_RANGE`, `maxQueueFloor(desiredMs)`, `effectiveQueue(s): { desiredMs; maxMs }`, `effectiveThreshold(s)`, `migratePalabraSettings(stored): PalabraSettings`, `PALABRA_VOICES`, `PalabraCredentials` (`K`: `{ kind: 'apiKey'; apiKey } | { kind: 'app'; clientId; clientSecret }`), `palabraCredentials` (with its `choice` on `authMode`), `palabraLanguages` (`sources`, `targets`, `initial`, `reverse`), `palabraOffers(direction)`;
  - `config.ts`: `PalabraConfig` (`C`: `{ source, target, speech, voiceId, silenceThreshold, sentenceSplitter, translatePartials, queue: { desiredMs, maxMs, autoTempo } }`), `buildPalabra(context, s, shared): PalabraConfig | ProviderRefusal`, `describePalabra(c): {}`.

- [ ] **Step 1: Seed the folder's `adapter.ts` first.** The session-side guard requires one in every folder under `src/providers`; Task 13 replaces it. Create `src/providers/palabraai/adapter.ts`:

```ts
/**
 * Palabra AI's session side (plan: Stage 2 Palabra). The adapter lands in
 * its Task 13; until then this seed is the `adapter.ts` the session-side
 * guard (`sessionSide.consistency.test.ts`) requires of every provider
 * folder.
 */
export {};
```

- [ ] **Step 2: Write the failing tests.** Create `src/providers/palabraai/settings.test.ts` — the documented tables are pinned against the docs' codes written out in the test, and the reverse against the docs' `to_source` / `to_target`:

```ts
import { describe, it, expect } from 'vitest';
import { AUTO, normalizePair, reversedPair, reverseSupported, swapped } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import {
  DESIRED_QUEUE_RANGE, effectiveQueue, effectiveThreshold, MAX_QUEUE_RANGE, maxQueueFloor, migratePalabraSettings, PALABRA_DEFAULTS, PALABRA_VOICES,
  palabraCredentials, palabraLanguages, palabraOffers, SILENCE_THRESHOLD_RANGE,
} from './settings';

const auth: AuthContext = { signedIn: false, getToken: async () => null };
const p = { languages: palabraLanguages };
const S = PALABRA_DEFAULTS;
const codes = (options: readonly { value: string }[]) => options.map((o) => o.value);

/** Palabra's docs' language tables as captured on 2026-09-29 (`models-map`, `source_languages_meta` / `target_languages_meta`): the codes, and the targets they hide. */
const DOC_SOURCES = [
  'ar', 'hy', 'auto', 'be', 'bg', 'bn', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fil', 'kk', 'mk', 'sr', 'fa', 'fi', 'fr', 'ga', 'gl', 'he', 'hi',
  'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'mn', 'mr', 'ms', 'mt', 'no', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'sw', 'ta', 'th', 'tr', 'ug', 'uk', 'ur', 'vi',
  'yue', 'zh',
];
const DOC_TARGETS = [
  'ar', 'ar-ae', 'ar-sa', 'az', 'hy', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'en-au', 'en-ca', 'en-gb', 'en-us', 'es', 'es-mx', 'es-co', 'es-ar', 'es-ch',
  'es-la', 'et', 'fi', 'fil', 'fr', 'fr-ca', 'gl', 'he', 'hi', 'hr', 'hu', 'id', 'is', 'it', 'ja', 'kk', 'ko', 'lt', 'lv', 'mk', 'ms', 'nl', 'no', 'pl', 'pt', 'pt-br', 'ro',
  'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'zh', 'zh-hans', 'zh-hant',
];
const DOC_HIDDEN_TARGETS = ['en-au', 'en-ca', 'zh'];

/** The API's own validator enums, captured from a VALIDATION_ERROR's `desc` on 2026-07-30 (`palabraLanguageCodes.test.ts`, which leaves with the old code). */
const API_SOURCE_LANGUAGES = new Set([
  'af', 'am', 'ar', 'as', 'auto', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'ga', 'gl', 'gu',
  'ha', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'ja', 'jv', 'ka', 'kk', 'km', 'kn', 'ko', 'ku', 'ky', 'lb', 'lg', 'ln', 'lo', 'lt', 'lv', 'mi', 'mk', 'ml',
  'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'no', 'ny', 'or', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'sk', 'sl', 'sn', 'so', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'tg',
  'th', 'tl', 'tr', 'ug', 'uk', 'ur', 'uz', 'vi', 'wo', 'xh', 'yue', 'zh', 'zu',
]);
const API_TARGET_LANGUAGES = new Set([
  'af', 'ar', 'ar-ae', 'ar-sa', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'en-au', 'en-ca', 'en-gb', 'en-us', 'es', 'es-ar', 'es-ch', 'es-co',
  'es-eu', 'es-la', 'es-mx', 'et', 'fa', 'fi', 'fil', 'fr', 'fr-ca', 'fr-eu', 'gl', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'ka', 'kk', 'kn', 'ko', 'lt',
  'lv', 'mi', 'mk', 'ml', 'mr', 'ms', 'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'pt-br', 'pt-eu', 'pt-la', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr',
  'uk', 'ur', 'vi', 'zh', 'zh-hans', 'zh-hant',
]);

describe("Palabra AI's settings", () => {
  it('defaults to the platform key, the low voice, a 0.7 s threshold, the splitter on, no partial translations, and our buffer: 8 s, 24 s, no adaptive speed (ruling 10)', () => {
    expect(PALABRA_DEFAULTS).toEqual({
      authMode: 'platform', voiceId: 'default_low', segmentConfirmationSilenceThreshold: 0.7, sentenceSplitterEnabled: true, translatePartialTranscriptions: false,
      desiredQueueLevelMs: 8_000, maxQueueLevelMs: 24_000, autoTempo: false,
    });
    expect(PALABRA_VOICES).toEqual([{ value: 'default_low', name: 'Default Low' }, { value: 'default_high', name: 'Default High' }]);
  });

  it('keeps what was stored field by field, a value of the wrong kind falling to its default, and converts nothing (ruling 2)', () => {
    expect(migratePalabraSettings({
      authMode: 'app', voiceId: 'default_high', segmentConfirmationSilenceThreshold: 0.1, sentenceSplitterEnabled: false, translatePartialTranscriptions: true,
      desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000, autoTempo: true,
    })).toEqual({
      // Out-of-range numbers are kept as stored: `build` clamps them where they are used.
      authMode: 'app', voiceId: 'default_high', segmentConfirmationSilenceThreshold: 0.1, sentenceSplitterEnabled: false, translatePartialTranscriptions: true,
      desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000, autoTempo: true,
    });
    expect(migratePalabraSettings({
      authMode: 'clientCredentials', voiceId: 'Default Low', segmentConfirmationSilenceThreshold: 'x', sentenceSplitterEnabled: 'yes',
      translatePartialTranscriptions: 1, desiredQueueLevelMs: Number.NaN, maxQueueLevelMs: null, autoTempo: undefined,
    })).toEqual(PALABRA_DEFAULTS);
  });

  it('opens a profile that stored no mode in the platform mode, whatever credentials it holds: a stated departure (ruling 2)', () => {
    // The old load pinned such a profile to the app pair (`settingsStore.ts:529-537`); nothing reads the credentials here.
    expect(migratePalabraSettings({}).authMode).toBe('platform');
  });

  it("clamps the threshold to the API's 0.3–2.0 and keeps the max buffer above the target, on the sliders' grids (ruling 10)", () => {
    expect(SILENCE_THRESHOLD_RANGE).toEqual({ min: 0.3, max: 2, step: 0.01 });
    expect(effectiveThreshold({ segmentConfirmationSilenceThreshold: 0.1 })).toBe(0.3);
    expect(effectiveThreshold({ segmentConfirmationSilenceThreshold: 0.7 })).toBe(0.7);
    expect(effectiveThreshold({ segmentConfirmationSilenceThreshold: 9 })).toBe(2);
    expect(DESIRED_QUEUE_RANGE).toEqual({ min: 3_000, max: 15_000, step: 1_000 });
    expect(MAX_QUEUE_RANGE).toEqual({ min: 12_000, max: 60_000, step: 3_000 });
    expect([3_000, 8_000, 11_000, 12_000, 14_000, 15_000].map(maxQueueFloor)).toEqual([12_000, 12_000, 12_000, 15_000, 15_000, 18_000]);
    for (let desired = DESIRED_QUEUE_RANGE.min; desired <= DESIRED_QUEUE_RANGE.max; desired += DESIRED_QUEUE_RANGE.step) {
      expect(maxQueueFloor(desired), String(desired)).toBeGreaterThan(desired);
      expect(maxQueueFloor(desired) % MAX_QUEUE_RANGE.step, String(desired)).toBe(0);
    }
    // The probe's refused pair: a 15 s target over a 12 s max is raised to 18 s.
    expect(effectiveQueue({ desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000 })).toEqual({ desiredMs: 15_000, maxMs: 18_000 });
    expect(effectiveQueue({ desiredQueueLevelMs: 8_000, maxQueueLevelMs: 24_000 })).toEqual({ desiredMs: 8_000, maxMs: 24_000 });
    expect(effectiveQueue({ desiredQueueLevelMs: 500, maxQueueLevelMs: 99_000 })).toEqual({ desiredMs: 3_000, maxMs: 60_000 });
  });
});

describe("Palabra AI's credentials (ruling 1)", () => {
  it('shows the API key in the platform mode, and the Client ID and Secret in the app mode, all three stored', () => {
    expect(palabraCredentials.keys).toEqual(['apiKey', 'clientId', 'clientSecret']);
    expect(palabraCredentials.fields(S).map((f) => [f.key, f.labelKey, f.secret, f.placeholderKey])).toEqual([
      ['apiKey', 'setup.credentials.apiKey', true, 'providers.palabraai.apiKeyPlaceholder'],
    ]);
    expect(palabraCredentials.fields({ ...S, authMode: 'app' }).map((f) => [f.key, f.labelKey, f.secret])).toEqual([
      ['clientId', 'providers.palabraai.clientIdPlaceholder', true],
      ['clientSecret', 'providers.palabraai.clientSecretPlaceholder', true],
    ]);
  });

  it('offers the choice above the fields, on authMode, in the old labels (F4)', () => {
    expect(palabraCredentials.choice).toEqual({
      setting: 'authMode',
      options: [{ value: 'platform', labelKey: 'providers.palabraai.authModePlatform' }, { value: 'app', labelKey: 'providers.palabraai.authModeApp' }],
    });
  });

  it('reads the mode its fields name, trimmed; a blank field is missing, in words the runner puts as credentials_missing', () => {
    expect(palabraCredentials.read({ apiKey: '  plbr_readKey0123456789 \n' }, auth)).toEqual({ kind: 'apiKey', apiKey: 'plbr_readKey0123456789' });
    expect(palabraCredentials.read({ clientId: ' id-1 ', clientSecret: 'secret-1' }, auth)).toEqual({ kind: 'app', clientId: 'id-1', clientSecret: 'secret-1' });
    expect(palabraCredentials.read({ apiKey: '   ' }, auth)).toEqual({ missing: 'Enter the API key of your Palabra AI account.' });
    expect(palabraCredentials.read({ clientId: 'id-1', clientSecret: '' }, auth)).toEqual({ missing: 'Enter the Client ID and the Client Secret of your Palabra AI app.' });
    // A number a store handed back as one reads as its text.
    expect(palabraCredentials.read({ clientId: 12345 as unknown as string, clientSecret: 's' }, auth)).toEqual({ kind: 'app', clientId: '12345', clientSecret: 's' });
  });
});

describe("Palabra AI's languages: its documented tables (ruling 8)", () => {
  it('offers Auto-detect first, then every documented source, in English-name order', () => {
    const sources = codes(palabraLanguages.sources(S));
    expect(sources[0]).toBe(AUTO);
    expect([...sources].sort()).toEqual([...DOC_SOURCES].sort());
    const names = palabraLanguages.sources(S).slice(1).map((o) => o.englishName);
    expect(names).toEqual([...names].sort());
  });

  it('offers every documented target the docs do not hide, in English-name order, whatever the source', () => {
    const targets = codes(palabraLanguages.targets('en', S));
    expect([...targets].sort()).toEqual(DOC_TARGETS.filter((c) => !DOC_HIDDEN_TARGETS.includes(c)).sort());
    const names = palabraLanguages.targets('en', S).map((o) => o.englishName);
    expect(names).toEqual([...names].sort());
    for (const source of codes(palabraLanguages.sources(S))) expect(codes(palabraLanguages.targets(source, S)), source).toEqual(targets);
  });

  it("offers only codes the API's validator accepts", () => {
    expect(codes(palabraLanguages.sources(S)).filter((c) => !API_SOURCE_LANGUAGES.has(c))).toEqual([]);
    expect(codes(palabraLanguages.targets('en', S)).filter((c) => !API_TARGET_LANGUAGES.has(c))).toEqual([]);
  });

  it('leaves out what the docs do not list: bn, mr and fa as targets, the hidden zh, en-au and en-ca, and the old app\'s vn, ba, eo and ia', () => {
    const targets = codes(palabraLanguages.targets('en', S));
    for (const code of ['bn', 'mr', 'fa', 'zh', 'en-au', 'en-ca', 'vn']) expect(targets, code).not.toContain(code);
    const sources = codes(palabraLanguages.sources(S));
    for (const code of ['ba', 'eo', 'ia']) expect(sources, code).not.toContain(code);
  });

  it('starts from en → es, and a stored code it no longer offers falls to the first of its list, nothing converted (ruling 2)', () => {
    expect(palabraLanguages.initial?.(S)).toEqual({ source: 'en', target: 'es' });
    expect(normalizePair(p, S, { source: 'ja', target: 'vn' })).toEqual({ source: 'ja', target: 'ar' });
    // The old app's plain `zh` target, Simplified Chinese: hidden in the docs, it falls too.
    expect(normalizePair(p, S, { source: 'ja', target: 'zh' })).toEqual({ source: 'ja', target: 'ar' });
    expect(normalizePair(p, S, { source: 'eo', target: 'ja' })).toEqual({ source: AUTO, target: 'ja' });
  });

  it("runs a direction its lists offer, and no other (build's guard)", () => {
    expect(palabraOffers({ source: 'ja', target: 'en-us' })).toBe(true);
    expect(palabraOffers({ source: AUTO, target: 'es' })).toBe(true);
    expect(palabraOffers({ source: 'ja', target: 'bn' })).toBe(false);
    expect(palabraOffers({ source: 'en-us', target: 'ja' })).toBe(false);
  });
});

describe("Palabra AI's reverse: its documented codes (ruling 9)", () => {
  it('reverses a target by its to_source and a source by its to_target', () => {
    expect(reversedPair(p, S, { source: 'ja', target: 'en-us' })).toEqual({ source: 'en', target: 'ja' });
    expect(reversedPair(p, S, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en-us' });
    expect(reversedPair(p, S, { source: 'pt', target: 'es-mx' })).toEqual({ source: 'es', target: 'pt' });
  });

  it("takes, for a documented target the docs hide, the first offered target of its source: Chinese reverses to Simplified Chinese (choice 5)", () => {
    expect(reversedPair(p, S, { source: 'zh', target: 'en' })).toEqual({ source: 'en', target: 'zh-hans' });
    expect(reversedPair(p, S, { source: 'en', target: 'zh-hant' })).toEqual({ source: 'zh', target: 'en-us' });
  });

  it('has none where the docs give none: an auto source, a source with no documented target, a target with no documented source', () => {
    expect(reversedPair(p, S, { source: AUTO, target: 'en' })).toBeNull();
    for (const source of ['bn', 'eu', 'fa', 'ga', 'mn', 'mr', 'mt', 'ug', 'yue']) expect(reversedPair(p, S, { source, target: 'en' }), source).toBeNull();
    for (const target of ['az', 'bs', 'fil', 'is', 'kk', 'mk', 'sr']) expect(reversedPair(p, S, { source: 'en', target }), target).toBeNull();
  });

  it('reverses every offered pair into the offer, or not at all', () => {
    for (const source of codes(palabraLanguages.sources(S))) {
      for (const target of codes(palabraLanguages.targets(source, S))) {
        const reversed = reversedPair(p, S, { source, target });
        expect(reverseSupported(p, S, { source, target }), `${source} → ${target}`).toBe(reversed !== null);
      }
    }
  });

  it('swaps into the reverse, and not at all when that is the same pair', () => {
    expect(swapped(p, S, { source: 'en', target: 'ja' })).toEqual({ source: 'ja', target: 'en-us' });
    expect(swapped(p, S, { source: 'ja', target: 'en-us' })).toEqual({ source: 'en', target: 'ja' });
    expect(swapped(p, S, { source: 'en', target: 'en-us' })).toBeNull();
    expect(swapped(p, S, { source: AUTO, target: 'ja' })).toBeNull();
  });
});
```

Create `src/providers/palabraai/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildPalabra, describePalabra } from './config';
import { PALABRA_DEFAULTS } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: () => false,
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
const ctx = (source: string, target: string, patch: Partial<SessionContext> = {}): SessionContext => ({ direction: { source, target }, speech: true, turns: 'auto', ...patch });

describe("Palabra AI's builder", () => {
  it('builds one leg from its direction and the settings, clamped as the API takes them (ruling 10)', () => {
    expect(buildPalabra(ctx('ja', 'en-us'), PALABRA_DEFAULTS, SHARED)).toEqual({
      source: 'ja', target: 'en-us', speech: true, voiceId: 'default_low', silenceThreshold: 0.7, sentenceSplitter: true, translatePartials: false,
      queue: { desiredMs: 8_000, maxMs: 24_000, autoTempo: false },
    });
    const stored = { ...PALABRA_DEFAULTS, voiceId: 'default_high' as const, segmentConfirmationSilenceThreshold: 0.1, desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000, autoTempo: true };
    expect(buildPalabra(ctx('ja', 'en'), stored, SHARED)).toMatchObject({ voiceId: 'default_high', silenceThreshold: 0.3, queue: { desiredMs: 15_000, maxMs: 18_000, autoTempo: true } });
  });

  it('asks for text alone on a leg that does not speak (ruling 7), and builds the participant as the same call on its direction (D17)', () => {
    expect(buildPalabra(ctx('ja', 'en', { speech: false }), PALABRA_DEFAULTS, SHARED)).toMatchObject({ speech: false });
    // `ja → en-us`'s participant, as Palabra's own reverse gives it (ruling 9).
    expect(buildPalabra(ctx('en', 'ja', { speech: false }), PALABRA_DEFAULTS, { ...SHARED, reversed: () => true })).toMatchObject({ source: 'en', target: 'ja', speech: false });
    expect(buildPalabra(ctx('auto', 'es'), PALABRA_DEFAULTS, SHARED)).toMatchObject({ source: 'auto', target: 'es' });
  });

  it('refuses a direction its lists do not offer, a guard the store and the gate keep unreachable', () => {
    expect(buildPalabra(ctx('ja', 'bn'), PALABRA_DEFAULTS, SHARED)).toEqual({ refused: 'Palabra AI does not translate ja → bn.' });
    expect(buildPalabra(ctx('en-us', 'ja'), PALABRA_DEFAULTS, SHARED)).toEqual({ refused: 'Palabra AI does not translate en-us → ja.' });
  });

  it('names no model: the old start named none for Palabra', () => {
    const c = buildPalabra(ctx('ja', 'en'), PALABRA_DEFAULTS, SHARED);
    if ('refused' in c) throw new Error(c.refused);
    expect(describePalabra(c)).toEqual({});
  });
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `npx vitest run src/providers/palabraai`
Expected: FAIL — `Failed to resolve import "./config"` and `"./settings"` (2 files).

- [ ] **Step 4: Write `S`, `K` and the languages.** Create `src/providers/palabraai/settings.ts` — the two tables are `models-map.json`'s rows, less the three hidden targets (ruling 8):

```ts
/**
 * Palabra AI's `S`, credentials and languages (survey §2.3–2.6). `S` is the
 * old slice (`PalabraAIProviderConfig.ts:8-24`) without what leaves it — the
 * three credentials (same keys), the pair (`providerStore`, same keys) and
 * the two fields nothing read (`subscriberCount`, `publisherCanSubscribe`).
 * Stored under `settings.palabraai.*` as before; nothing is converted on the
 * way in (ruling 2). Nothing here imports `src/services`.
 */
import { AUTO } from '../../lib/provider/languages';
import type { CredentialField, CredentialsMissing, LanguageOption, LanguagePair, Provider } from '../../lib/provider/types';

/** Which credentials a run sends (ruling 1): the platform's API key, or the legacy app's Client ID and Client Secret. */
export type PalabraAuthMode = 'platform' | 'app';
/** Palabra's two built-in voices (`PalabraAIProviderConfig.ts:321-324`). */
export type PalabraVoice = 'default_low' | 'default_high';

export interface PalabraSettings {
  /** Picked in the credential form (F4). A profile that stored none opens in the platform mode (ruling 2). */
  authMode: PalabraAuthMode;
  voiceId: PalabraVoice;
  /** Seconds of silence that confirm a sentence (`segment_confirmation_silence_threshold`); `build` clamps it to `SILENCE_THRESHOLD_RANGE`. */
  segmentConfirmationSilenceThreshold: number;
  sentenceSplitterEnabled: boolean;
  translatePartialTranscriptions: boolean;
  /** The translated speech Palabra keeps buffered, in ms; `build` clamps it to `DESIRED_QUEUE_RANGE`. */
  desiredQueueLevelMs: number;
  /** The buffer's ceiling, in ms; `build` keeps it above the target (`effectiveQueue`). */
  maxQueueLevelMs: number;
  autoTempo: boolean;
}

/** The old defaults (`PalabraAIProviderConfig.ts:26-42`), ours rather than Palabra's recommended 5 000 / 20 000 with adaptive speed on (ruling 10). */
export const PALABRA_DEFAULTS: PalabraSettings = {
  authMode: 'platform',
  voiceId: 'default_low',
  segmentConfirmationSilenceThreshold: 0.7,
  sentenceSplitterEnabled: true,
  translatePartialTranscriptions: false,
  desiredQueueLevelMs: 8_000,
  maxQueueLevelMs: 24_000,
  autoTempo: false,
};

/** The silence threshold's range: the API's own — the owner's probe saw 0.1 refused, "ensure this value is greater than or equal to 0.3" — and the slider's (ruling 10). */
export const SILENCE_THRESHOLD_RANGE = { min: 0.3, max: 2, step: 0.01 } as const;
/** The target buffer's slider, as the old one (`ProviderSpecificSettings.tsx:1398-1406`). */
export const DESIRED_QUEUE_RANGE = { min: 3_000, max: 15_000, step: 1_000 } as const;
/** The max buffer's slider, as the old one; its floor follows the target (`maxQueueFloor`). */
export const MAX_QUEUE_RANGE = { min: 12_000, max: 60_000, step: 3_000 } as const;

const clamp = (value: number, range: { min: number; max: number }) => Math.min(range.max, Math.max(range.min, value));

/**
 * The max buffer's floor for a target (ruling 10): the first value of the
 * max slider's grid above it, and never below the slider's own minimum.
 * The API refuses a max that is not above the target — the owner's probe:
 * "`max_queue_level_ms` must be greater than `desired_queue_level_ms`".
 */
export function maxQueueFloor(desiredMs: number): number {
  return Math.max(MAX_QUEUE_RANGE.min, (Math.floor(desiredMs / MAX_QUEUE_RANGE.step) + 1) * MAX_QUEUE_RANGE.step);
}

/** The buffer a session asks for, the same numbers the view shows: the target on its slider, the max on its own, raised to the target's floor (ruling 10). */
export function effectiveQueue(s: Pick<PalabraSettings, 'desiredQueueLevelMs' | 'maxQueueLevelMs'>): { desiredMs: number; maxMs: number } {
  const desiredMs = clamp(s.desiredQueueLevelMs, DESIRED_QUEUE_RANGE);
  return { desiredMs, maxMs: clamp(s.maxQueueLevelMs, { min: maxQueueFloor(desiredMs), max: MAX_QUEUE_RANGE.max }) };
}

/** The threshold a session sends, the same number the view shows (ruling 10). */
export function effectiveThreshold(s: Pick<PalabraSettings, 'segmentConfirmationSilenceThreshold'>): number {
  return clamp(s.segmentConfirmationSilenceThreshold, SILENCE_THRESHOLD_RANGE);
}

const AUTH_MODES: readonly unknown[] = ['platform', 'app'];
const VOICES: readonly unknown[] = ['default_low', 'default_high'];
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** What was stored, made valid field by field; a number out of range is kept and clamped where it is used. Nothing is written back. */
export function migratePalabraSettings(stored: Readonly<Record<string, unknown>>): PalabraSettings {
  const d = PALABRA_DEFAULTS;
  return {
    authMode: AUTH_MODES.includes(stored.authMode) ? (stored.authMode as PalabraAuthMode) : d.authMode,
    voiceId: VOICES.includes(stored.voiceId) ? (stored.voiceId as PalabraVoice) : d.voiceId,
    segmentConfirmationSilenceThreshold: finite(stored.segmentConfirmationSilenceThreshold, d.segmentConfirmationSilenceThreshold),
    sentenceSplitterEnabled: flag(stored.sentenceSplitterEnabled, d.sentenceSplitterEnabled),
    translatePartialTranscriptions: flag(stored.translatePartialTranscriptions, d.translatePartialTranscriptions),
    desiredQueueLevelMs: finite(stored.desiredQueueLevelMs, d.desiredQueueLevelMs),
    maxQueueLevelMs: finite(stored.maxQueueLevelMs, d.maxQueueLevelMs),
    autoTempo: flag(stored.autoTempo, d.autoTempo),
  };
}

/** Palabra's two voices, named in English as the old list named them. */
export const PALABRA_VOICES: ReadonlyArray<{ value: PalabraVoice; name: string }> = [
  { value: 'default_low', name: 'Default Low' },
  { value: 'default_high', name: 'Default High' },
];

/** One leg's credentials: the kind decides the connect path (ruling 1; `wire.ts`). */
export type PalabraCredentials =
  | { kind: 'apiKey'; apiKey: string }
  | { kind: 'app'; clientId: string; clientSecret: string };

const API_KEY: CredentialField = { key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'providers.palabraai.apiKeyPlaceholder' };
/** Labelled by the old placeholders, as the old wizard labelled them (`PalabraAIProviderConfig.ts:59-62`). */
const CLIENT_ID: CredentialField = { key: 'clientId', labelKey: 'providers.palabraai.clientIdPlaceholder', secret: true };
const CLIENT_SECRET: CredentialField = { key: 'clientSecret', labelKey: 'providers.palabraai.clientSecretPlaceholder', secret: true };

/** A stored value as text: a store may hand a value stored as a number back as one. */
const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();

export const palabraCredentials: Provider<PalabraSettings, PalabraCredentials, never>['credentials'] = {
  keys: ['apiKey', 'clientId', 'clientSecret'],
  fields: (s) => (s.authMode === 'app' ? [CLIENT_ID, CLIENT_SECRET] : [API_KEY]),
  // `values` holds exactly the fields `fields(s)` shows, so its keys name the mode.
  read: (values): PalabraCredentials | CredentialsMissing => {
    if ('apiKey' in values) {
      const apiKey = text(values.apiKey);
      // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
      return apiKey ? { kind: 'apiKey', apiKey } : { missing: 'Enter the API key of your Palabra AI account.' };
    }
    const clientId = text(values.clientId);
    const clientSecret = text(values.clientSecret);
    return clientId && clientSecret ? { kind: 'app', clientId, clientSecret } : { missing: 'Enter the Client ID and the Client Secret of your Palabra AI app.' };
  },
  choice: {
    setting: 'authMode',
    options: [
      { value: 'platform', labelKey: 'providers.palabraai.authModePlatform' },
      { value: 'app', labelKey: 'providers.palabraai.authModeApp' },
    ],
  },
};

/**
 * Palabra's documented languages (ruling 8): the docs' own tables, read
 * from the `models-map` their language page loads (2026-09-29) — each row
 * its code, its native name, its English name, and the code its docs give
 * the other way round (`to_target` for a source, `to_source` for a target;
 * null where they give none). In English-name order. The targets the docs
 * hide (`en-au`, `en-ca`, and plain `zh`) are not offered.
 */
type Row = readonly [code: string, name: string, englishName: string, other: string | null];

const SOURCE_ROWS: readonly Row[] = [
  ['ar', 'العربية', 'Arabic', 'ar'],
  ['hy', 'Հայերեն', 'Armenian', 'hy'],
  ['eu', 'Euskara', 'Basque', null],
  ['be', 'Беларуская', 'Belarusian', 'be'],
  ['bn', 'বাংলা', 'Bengali', null],
  ['bg', 'Български', 'Bulgarian', 'bg'],
  ['yue', '粵語', 'Cantonese', null],
  ['ca', 'Català', 'Catalan', 'ca'],
  ['zh', '中文', 'Chinese', 'zh'],
  ['hr', 'Hrvatski', 'Croatian', 'hr'],
  ['cs', 'Čeština', 'Czech', 'cs'],
  ['da', 'Dansk', 'Danish', 'da'],
  ['nl', 'Nederlands', 'Dutch', 'nl'],
  ['en', 'English', 'English', 'en-us'],
  ['et', 'Eesti', 'Estonian', 'et'],
  ['fil', 'Filipino', 'Filipino', 'fil'],
  ['fi', 'Suomi', 'Finnish', 'fi'],
  ['fr', 'Français', 'French', 'fr'],
  ['gl', 'Galego', 'Galician', 'gl'],
  ['de', 'Deutsch', 'German', 'de'],
  ['el', 'Ελληνικά', 'Greek', 'el'],
  ['he', 'עברית', 'Hebrew', 'he'],
  ['hi', 'हिन्दी', 'Hindi', 'hi'],
  ['hu', 'Magyar', 'Hungarian', 'hu'],
  ['id', 'Bahasa Indonesia', 'Indonesian', 'id'],
  ['ga', 'Gaeilge', 'Irish', null],
  ['it', 'Italiano', 'Italian', 'it'],
  ['ja', '日本語', 'Japanese', 'ja'],
  ['kk', 'Қазақша', 'Kazakh', 'kk'],
  ['ko', '한국어', 'Korean', 'ko'],
  ['lv', 'Latviešu', 'Latvian', 'lv'],
  ['lt', 'Lietuvių', 'Lithuanian', 'lt'],
  ['mk', 'Македонски', 'Macedonian', 'mk'],
  ['ms', 'Bahasa Melayu', 'Malay', 'ms'],
  ['mt', 'Malti', 'Maltese', null],
  ['mr', 'मराठी', 'Marathi', null],
  ['mn', 'Монгол', 'Mongolian', null],
  ['no', 'Norsk', 'Norwegian', 'no'],
  ['fa', 'فارسی', 'Persian', null],
  ['pl', 'Polski', 'Polish', 'pl'],
  ['pt', 'Português', 'Portuguese', 'pt'],
  ['ro', 'Română', 'Romanian', 'ro'],
  ['ru', 'Русский', 'Russian', 'ru'],
  ['sr', 'Српски', 'Serbian', 'sr'],
  ['sk', 'Slovenčina', 'Slovak', 'sk'],
  ['sl', 'Slovenščina', 'Slovenian', 'sl'],
  ['es', 'Español', 'Spanish', 'es'],
  ['sw', 'Kiswahili', 'Swahili', 'sw'],
  ['sv', 'Svenska', 'Swedish', 'sv'],
  ['ta', 'தமிழ்', 'Tamil', 'ta'],
  ['th', 'ไทย', 'Thai', 'th'],
  ['tr', 'Türkçe', 'Turkish', 'tr'],
  ['uk', 'Українська', 'Ukrainian', 'uk'],
  ['ur', 'اردو', 'Urdu', 'ur'],
  ['ug', 'ئۇيغۇرچە', 'Uyghur', null],
  ['vi', 'Tiếng Việt', 'Vietnamese', 'vi'],
  ['cy', 'Cymraeg', 'Welsh', 'cy'],
];

const TARGET_ROWS: readonly Row[] = [
  ['ar', 'العربية الفصحى', 'Arabic', 'ar'],
  ['ar-sa', 'العربية (السعودية)', 'Arabic (Saudi Arabia)', 'ar'],
  ['ar-ae', 'العربية (الإمارات)', 'Arabic (UAE)', 'ar'],
  ['hy', 'Հայերեն', 'Armenian', 'hy'],
  ['az', 'Azərbaycan dili', 'Azerbaijani', null],
  ['be', 'Беларуская', 'Belarusian', 'be'],
  ['bs', 'Bosanski', 'Bosnian', null],
  ['bg', 'Български', 'Bulgarian', 'bg'],
  ['ca', 'Català', 'Catalan', 'ca'],
  ['zh-hans', '简体中文', 'Chinese (Simplified)', 'zh'],
  ['zh-hant', '繁體中文', 'Chinese (Traditional)', 'zh'],
  ['hr', 'Hrvatski', 'Croatian', 'hr'],
  ['cs', 'Čeština', 'Czech', 'cs'],
  ['da', 'Dansk', 'Danish', 'da'],
  ['nl', 'Nederlands', 'Dutch', 'nl'],
  ['en', 'English', 'English', 'en'],
  ['en-gb', 'English (UK)', 'English (UK)', 'en'],
  ['en-us', 'English (US)', 'English (US)', 'en'],
  ['et', 'Eesti', 'Estonian', 'et'],
  ['fil', 'Filipino', 'Filipino', null],
  ['fi', 'Suomi', 'Finnish', 'fi'],
  ['fr', 'Français', 'French', 'fr'],
  ['fr-ca', 'Français (Canada)', 'French (Canada)', 'fr'],
  ['gl', 'Galego', 'Galician', 'gl'],
  ['de', 'Deutsch', 'German', 'de'],
  ['el', 'Ελληνικά', 'Greek', 'el'],
  ['he', 'עברית', 'Hebrew', 'he'],
  ['hi', 'हिन्दी', 'Hindi', 'hi'],
  ['hu', 'Magyar', 'Hungarian', 'hu'],
  ['is', 'Íslenska', 'Icelandic', null],
  ['id', 'Bahasa Indonesia', 'Indonesian', 'id'],
  ['it', 'Italiano', 'Italian', 'it'],
  ['ja', '日本語', 'Japanese', 'ja'],
  ['kk', 'Қазақ тілі', 'Kazakh', null],
  ['ko', '한국어', 'Korean', 'ko'],
  ['lv', 'Latviešu', 'Latvian', 'lv'],
  ['lt', 'Lietuvių', 'Lithuanian', 'lt'],
  ['mk', 'Македонски', 'Macedonian', null],
  ['ms', 'Bahasa Melayu', 'Malay', 'ms'],
  ['no', 'Norsk', 'Norwegian', 'no'],
  ['pl', 'Polski', 'Polish', 'pl'],
  ['pt', 'Português', 'Portuguese', 'pt'],
  ['pt-br', 'Português (Brasil)', 'Portuguese (Brazil)', 'pt'],
  ['ro', 'Română', 'Romanian', 'ro'],
  ['ru', 'Русский', 'Russian', 'ru'],
  ['sr', 'Српски', 'Serbian', null],
  ['sk', 'Slovenčina', 'Slovak', 'sk'],
  ['sl', 'Slovenščina', 'Slovenian', 'sl'],
  ['es', 'Español', 'Spanish', 'es'],
  ['es-ar', 'Español (Argentina)', 'Spanish (Argentina)', 'es'],
  ['es-ch', 'Español (Chile)', 'Spanish (Chile)', 'es'],
  ['es-co', 'Español (Colombia)', 'Spanish (Colombia)', 'es'],
  ['es-la', 'Español (Latin America)', 'Spanish (Latin America)', 'es'],
  ['es-mx', 'Español (México)', 'Spanish (Mexico)', 'es'],
  ['sw', 'Kiswahili', 'Swahili', 'sw'],
  ['sv', 'Svenska', 'Swedish', 'sv'],
  ['ta', 'தமிழ்', 'Tamil', 'ta'],
  ['th', 'ไทย', 'Thai', 'th'],
  ['tr', 'Türkçe', 'Turkish', 'tr'],
  ['uk', 'Українська', 'Ukrainian', 'uk'],
  ['ur', 'اردو', 'Urdu', 'ur'],
  ['vi', 'Tiếng Việt', 'Vietnamese', 'vi'],
  ['cy', 'Cymraeg', 'Welsh', 'cy'],
];

/** The targets the docs hide, with their source code: `zh` is still one source's documented `to_target`. */
const HIDDEN_TARGETS: Readonly<Record<string, string>> = { zh: 'zh', 'en-au': 'en', 'en-ca': 'en' };

const option = ([value, name, englishName]: Row): LanguageOption => ({ value, name, englishName });
/** Auto-detect first, as every provider that detects offers it (ruling 8), then the documented sources. */
const SOURCES: readonly LanguageOption[] = [{ value: AUTO, name: 'Auto', englishName: 'Auto' }, ...SOURCE_ROWS.map(option)];
const TARGETS: readonly LanguageOption[] = TARGET_ROWS.map(option);
const TO_TARGET: ReadonlyMap<string, string | null> = new Map(SOURCE_ROWS.map(([code, , , other]) => [code, other]));
const TO_SOURCE: ReadonlyMap<string, string | null> = new Map(TARGET_ROWS.map(([code, , , other]) => [code, other]));

/**
 * A source's documented target, as offered: one the docs hide takes the
 * first offered target of its own source — `zh`'s documented `to_target`
 * is the hidden `zh`, so Chinese reverses to Simplified Chinese (choice 5).
 */
function offeredTarget(code: string | null | undefined): string | null {
  if (!code) return null;
  if (TO_SOURCE.has(code)) return code;
  const source = HIDDEN_TARGETS[code];
  return source === undefined ? null : (TARGET_ROWS.find(([, , , other]) => other === source)?.[0] ?? null);
}

/**
 * Palabra's languages (ruling 8): its documented tables, the same whatever
 * the source and whether the run speaks — `bn`, `mr` and `fa`, which the
 * docs do not list as targets, are not offered. Its reverse (ruling 9) is
 * its documented codes, not a plain swap: a target reverses to its
 * `to_source` (`en-us` → `en`) and a source to its `to_target` (`en` →
 * `en-us`), and a pair either side of which has none has no reverse — an
 * `auto` source among them.
 */
export const palabraLanguages: Provider<PalabraSettings, never, never>['languages'] = {
  sources: () => SOURCES,
  targets: () => TARGETS,
  // The old defaults (`PalabraAIProviderConfig.ts:31-32`).
  initial: () => ({ source: 'en', target: 'es' }),
  reverse: (pair: LanguagePair) => {
    const source = TO_SOURCE.get(pair.target) ?? null;
    const target = offeredTarget(TO_TARGET.get(pair.source));
    return source !== null && target !== null ? { source, target } : null;
  },
};

/** Whether Palabra runs this direction: `build`'s guard, over the same two lists. */
export function palabraOffers(direction: LanguagePair): boolean {
  return SOURCES.some((o) => o.value === direction.source) && TARGETS.some((o) => o.value === direction.target);
}
```

- [ ] **Step 5: Write `C` and the builder.** Create `src/providers/palabraai/config.ts`:

```ts
/**
 * Palabra AI's `C`, `build` and `describe` (survey §2.7). One builder for
 * both legs: the participant is the same call on the reversed direction
 * (D17) — Palabra's own reverse (ruling 9) — and it speaks when its switch
 * is on; a leg that does not speak asks for text alone (ruling 7).
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { effectiveQueue, effectiveThreshold, palabraOffers, type PalabraSettings, type PalabraVoice } from './settings';

export interface PalabraConfig {
  source: string;
  target: string;
  /** Translated speech at all: without it the task's `output_stream` is null, and Palabra sends the text alone (ruling 7; the owner's probe). */
  speech: boolean;
  voiceId: PalabraVoice;
  /** Clamped to the API's range (ruling 10). */
  silenceThreshold: number;
  sentenceSplitter: boolean;
  translatePartials: boolean;
  /** The max always above the target (ruling 10). */
  queue: { desiredMs: number; maxMs: number; autoTempo: boolean };
}

export function buildPalabra(context: SessionContext, s: PalabraSettings, _shared: SharedSettings): PalabraConfig | ProviderRefusal {
  const { source, target } = context.direction;
  // A guard: the provider store keeps the pair within the offer, and the gate refused a participant whose reverse is not offered (D20).
  if (!palabraOffers(context.direction)) return { refused: `Palabra AI does not translate ${source} → ${target}.` };
  return {
    source,
    target,
    speech: context.speech,
    voiceId: s.voiceId,
    silenceThreshold: effectiveThreshold(s),
    sentenceSplitter: s.sentenceSplitterEnabled,
    translatePartials: s.translatePartialTranscriptions,
    queue: { ...effectiveQueue(s), autoTempo: s.autoTempo },
  };
}

/** No model to name: the old start reported none for Palabra (survey §1.8). */
export function describePalabra(_c: PalabraConfig): Record<string, never> {
  return {};
}
```

- [ ] **Step 6: Run the folder and the guard.** The guard finds the seed `adapter.ts`, which imports nothing.

Run: `npx vitest run src/providers/palabraai src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 3 files, 30 tests.

- [ ] **Step 7: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 8: Commit.**

```bash
git add src/providers/palabraai/adapter.ts src/providers/palabraai/settings.ts src/providers/palabraai/settings.test.ts src/providers/palabraai/config.ts src/providers/palabraai/config.test.ts
```

```bash
git commit -q -F - -- src/providers/palabraai/adapter.ts src/providers/palabraai/settings.ts src/providers/palabraai/settings.test.ts src/providers/palabraai/config.ts src/providers/palabraai/config.test.ts <<'EOF'
feat(palabraai): Palabra AI's settings, credentials, languages and builder

Its old slice without what leaves it; the platform key or the app pair,
picked above the fields; its documented language tables, reversed by
their own codes; one builder for both legs, clamped as the API takes it.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```


---

### Task 9: The wire, the re-chunker and the fixtures (Wave 3)

**Files:**
- Create: `src/providers/palabraai/wire.ts`, `src/providers/palabraai/audioIn.ts`, `src/providers/palabraai/testing.ts` (the fixtures; Task 13 appends the harness)
- Test: `src/providers/palabraai/wire.test.ts`, `src/providers/palabraai/audioIn.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_RATE` (`src/lib/contract/adapter`); `pcmToBase64` (`src/lib/contract/pcm64`); `PalabraConfig`, `buildPalabra` (`./config`); `PalabraCredentials`, `PalabraSettings`, `PALABRA_DEFAULTS` (`./settings`); `SharedSettings` (`src/lib/provider/types`).
- Produces:
  - `wire.ts`: `PALABRA_API`, `SESSIONS_URL`, `CREATE_SESSION_URL`, `STREAMING_BASE`, `CREATE_SESSION_BODY`, `POLICY_VIOLATION` (1008), `restHeaders(k)`, `directUrl(hash, k)`, `CreatedSession { id, publisher, wsUrl }`, `readCreated(body)`, `sessionUrl(created)`, `sessionDeleteUrl(id)`, `restWords(status, body, fallback)`, `SetTaskMessage`, `setTask(c)`, `GET_TASK`, `END_TASK`, `inputAudio(pcm)`, `PalabraMessage { type, data }`, `decodeMessage(data)`, `Transcription { id?, part?, language?, text, start?, end? }`, `transcriptionOf(data)`, `OutputAudio { id?, part?, last, audio }`, `outputAudioOf(data)`, `PalabraError { code?, desc?, msg?, param? }`, `errorOf(data)`, `warningOf(data)`, `taskStatusOf(data)`, `NOT_FOUND`, `SERVICE_TIMEOUT`, `VOICE_NOT_FOUND`, `validationWords(desc)`, `errorWords(e)`, `errorCode(e): 'client' | 'server'`;
  - `audioIn.ts`: `CHUNK_MS` (320), `CHUNK_SAMPLES` (7 680), `IDLE_MS` (500), `SILENCE`, `Rechunker { push(pcm): Int16Array[]; flush(): { chunk; samples } | null }`;
  - `testing.ts`: `KEY`, `APP`, `SESSION_ID`, `PUBLISHER`, `SESSION_WS_URL`, `CREATED_BODY`, `SHARED`, `AUTO_CTX`, `MANUAL_CTX`, `configFor(context?, patch?)`, `b64(samples, fill?)`, `JA`, `EN`, `SENTENCE`, `SERVER` (the server's messages by name, as the probe logged them), `RestCall`, `RestAnswer` (`'ok' | 'offline' | 'hang' | 'later' | <status>`), `fakeRest({ create?, list?, remove? })` → `{ fetch, calls, of(method), answer() }` — a REST server that behaves as a browser's fetch: an aborted request rejects, and reading an answer's body once its request is aborted rejects (choice 9); `'later'` holds an answer until `answer()`.

- [ ] **Step 1: Write the fixtures.** Create `src/providers/palabraai/testing.ts` — every message is the owner's probe's shape and text, every credential is made up, and the REST server reads bodies as a browser does, so a create aborted with the leg cannot pass for one that was deleted (choice 9):

```ts
/**
 * The Palabra AI suites' fixtures: two credentials, the settings the suites
 * build from, the server's messages as the owner's live probe logged them
 * (2026-09-28/29: its shapes and texts, never a credential — the probe
 * redacted every one, and these are made up), and a REST server that
 * records what it is asked. Test-only: nothing but a test imports it (the
 * session-side guard's kit rule counts every provider's `testing.ts` as kit
 * and holds it to that), and the adapter's session walk never reaches it.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildPalabra, type PalabraConfig } from './config';
import { PALABRA_DEFAULTS, type PalabraCredentials, type PalabraSettings } from './settings';

/** Shaped as a real platform key (`plbr_…`), which `redact()` masks: a frame that carried it fails the kit's `frame-secret` rule. */
export const KEY: Extract<PalabraCredentials, { kind: 'apiKey' }> = { kind: 'apiKey', apiKey: 'plbr_testKey0123456789abcdef' };
/** A legacy app pair. Neither value has a key's shape: the suites scan for them by value. */
export const APP: Extract<PalabraCredentials, { kind: 'app' }> = { kind: 'app', clientId: 'palabra-client-id-4f2a', clientSecret: 'palabra-client-secret-9c7e' };

/** Shaped as the JWTs the probe logged — the id and the publisher alike — and made up: `{"sub":"<who>","room":"test"}`, base64url. */
const JWT = (payload: string) => `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.c2lnbmF0dXJlLW9mLXRoZS10ZXN0LXRva2Vu`;
export const SESSION_ID = JWT('eyJzdWIiOiJzZXNzaW9uIiwicm9vbSI6InRlc3QifQ');
export const PUBLISHER = JWT('eyJzdWIiOiJwdWJsaXNoZXIiLCJyb29tIjoidGVzdCJ9');
/** The probe's `ws_url` host: `streaming.palabra.ai`, eight hex digits, the speech-to-speech path. */
export const SESSION_WS_URL = 'wss://streaming.palabra.ai/streaming-api/bc6ae467/v1/speech-to-speech/stream';
/** A create's answer, as the probe's keys listed it: `publisher, subscriber, webrtc_room_name, webrtc_url, ws_url, intent, id, organization`. */
export const CREATED_BODY = {
  ok: true,
  data: {
    publisher: PUBLISHER,
    subscriber: [JWT('eyJzdWIiOiJzdWJzY3JpYmVyIiwicm9vbSI6InRlc3QifQ')],
    webrtc_room_name: 'room-test',
    webrtc_url: 'wss://streaming.palabra.ai/livekit/',
    ws_url: SESSION_WS_URL,
    intent: 'api',
    id: SESSION_ID,
    organization: 'org-test',
  },
};

export const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: (d) => d.source === 'en' && d.target === 'ja',
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
export const AUTO_CTX: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };
export const MANUAL_CTX: SessionContext = { ...AUTO_CTX, turns: 'manual' };

/** A leg's config: the defaults, patched. A refusal is a fixture bug, not a case any suite means to build — it throws loudly rather than hiding behind a cast. */
export function configFor(context: SessionContext = AUTO_CTX, patch: Partial<PalabraSettings> = {}): PalabraConfig {
  const c = buildPalabra(context, { ...PALABRA_DEFAULTS, ...patch }, SHARED);
  if ('refused' in c) throw new Error(c.refused);
  return c;
}

/** `samples` of 24 kHz pcm16 as an audio chunk carries it: base64 of little-endian Int16. */
export function b64(samples: number, fill = 900): string {
  let binary = '';
  for (const byte of new Uint8Array(new Int16Array(samples).fill(fill).buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The probe's first sentence, ja → en (`translate-direct-ja-en`). */
export const JA = 'リアルタイム翻訳へようこそ、自然な会話をお手伝いします。';
export const EN = "Welcome to real-time translation. I'm here to help you have natural conversations.";
export const SENTENCE = '1a0e9048dfeed5a3';

const message = (message_type: string, data: unknown) => JSON.stringify({ message_type, data });
const transcription = (id: string, text: string, o: { part?: number; language?: string; start?: number; end?: number } = {}) => ({
  transcription: {
    transcription_id: id,
    ...(o.part === undefined ? {} : { translation_part_id: o.part }),
    language: o.language ?? (o.part === undefined ? 'ja' : 'en'),
    text,
    segments: [{ text, start: o.start ?? 0.32, end: o.end ?? 5.66, start_timestamp: 1_790_615_783.549207, end_timestamp: 1_790_615_788.889207, words: [{ word: text, start: o.start ?? 0.32, end: o.end ?? 5.66 }] }],
  },
});

/** The server's messages, by name, as the probe logged them: JSON text frames, `{ message_type, data }`. */
export const SERVER = {
  currentTask: (status = 'running') => message('current_task', {
    input_stream: { content_type: 'audio', source: { type: 'ws', format: 'pcm_s16le', sample_rate: 24_000, channels: 1 } },
    output_stream: { content_type: 'audio', target: { type: 'ws', format: 'pcm_s16le' } },
    pipeline: {},
    task_status: status,
  }),
  notFound: () => message('error', { code: 'NOT_FOUND', desc: 'No active task found', param: null }),
  /** The probe's refused threshold, word for word. */
  thresholdRefused: () => message('error', {
    code: 'VALIDATION_ERROR',
    desc: "ValidationError(model='SetTaskRequestMessage', errors=[{'loc': ('pipeline', 'transcription', 'segment_confirmation_silence_threshold'), 'msg': 'ensure this value is greater than or equal to 0.3', 'type': 'value_error.number.not_ge', 'ctx': {'limit_value': 0.3}}])",
    param: null,
  }),
  /** The probe's refused buffer, word for word. */
  queueRefused: () => message('error', {
    code: 'VALIDATION_ERROR',
    desc: "ValidationError(model='SetTaskRequestMessage', errors=[{'loc': ('pipeline', 'translation_queue_configs', 'global', '__root__'), 'msg': '`max_queue_level_ms` must be greater than `desired_queue_level_ms`', 'type': 'value_error'}])",
    param: null,
  }),
  /** The follow-up probe's timeout, 9.95 s after the last chunk, word for word; a close 1008 follows. */
  serviceTimeout: () => message('error', { code: 'SERVICE_TIMEOUT', desc: 'No input audio received for 10s. Use the pause_task command for intentional pauses.', param: null }),
  error: (code: string, desc: string) => message('error', { code, desc, param: null }),
  /** The probe's `bn` warning, word for word. */
  voiceNotFound: () => message('warning', { code: 'VOICE_NOT_FOUND', message: "Voice ID 'default_low' is not available, using default voice" }),
  warning: (code: string, text: string) => message('warning', { code, message: text }),
  partial: (text: string, id = SENTENCE, end?: number) => message('partial_transcription', transcription(id, text, { end })),
  validated: (text = JA, id = SENTENCE) => message('validated_transcription', transcription(id, text)),
  translationPartial: (text: string, id = SENTENCE, part = 0) => message('partial_translated_transcription', transcription(id, text, { part })),
  translated: (text = EN, id = SENTENCE, part = 0) => message('translated_transcription', transcription(id, text, { part })),
  /** A chunk of speech: 200 ms by default, its part a string as the probe saw it ("0"). */
  audio: (o: { id?: string; part?: string | number; samples?: number; last?: boolean } = {}) => message('output_audio_data', {
    transcription_id: o.id ?? SENTENCE,
    translation_part_id: o.part ?? '0',
    language: 'en',
    last_chunk: o.last ?? false,
    data: b64(o.samples ?? 4_800),
    chunk_generation_delta: null,
  }),
  endOfStream: () => message('end_of_stream', {}),
  /** A message by its type alone. */
  bare: (type: string) => message(type, {}),
  /** The data field sent as JSON text, as the Python SDK notes it can come. */
  doubleEncoded: (type: string, data: unknown) => JSON.stringify({ message_type: type, data: JSON.stringify(data) }),
};

/** One REST call as the fake server saw it. */
export interface RestCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  keepalive?: boolean;
  signal?: AbortSignal;
}

/** How the fake answers a request: its script's answer, a failed fetch, one that waits for its signal, or one held until `answer()`. */
export type RestAnswer = 'ok' | 'offline' | 'hang' | 'later' | number;

const aborted = (signal: AbortSignal) => signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');

/**
 * A response whose body reads as a browser's does: once the request's
 * signal has aborted, reading it rejects — "If the request is aborted after
 * the fetch() call has been fulfilled but before the response body has been
 * read, then attempting to read the response body will reject with an
 * AbortError exception" (MDN, fetch()). A body that ignored the signal hid
 * a leaked session (choice 9).
 */
function honouring(response: Response, signal: AbortSignal | undefined): Response {
  if (!signal) return response;
  const json = response.json.bind(response);
  const text = response.text.bind(response);
  return Object.assign(response, {
    json: () => (signal.aborted ? Promise.reject(aborted(signal)) : json()),
    text: () => (signal.aborted ? Promise.reject(aborted(signal)) : text()),
  });
}

/**
 * A fake of Palabra's REST server that behaves as a browser's fetch: `fetch`
 * answers from a script and records every call; an aborted request rejects,
 * and so does reading an answer's body once its request is aborted.
 * `create` answers the session create — `'ok'` (201, `CREATED_BODY`), a
 * status with Palabra's error envelope, `'offline'` (a failed fetch),
 * `'hang'` (an answer that waits for its signal) or `'later'` (held until
 * `answer()`, rejected if aborted first); the delete answers 204; the list
 * answers `list`.
 */
export function fakeRest(o: { create?: RestAnswer; list?: RestAnswer; remove?: RestAnswer } = {}) {
  const calls: RestCall[] = [];
  const held: Array<() => void> = [];
  const answer = (how: RestAnswer, ok: () => Response, signal: AbortSignal | undefined): Promise<Response> => {
    if (how === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    if (how === 'hang' || how === 'later') {
      return new Promise<Response>((resolve, reject) => {
        if (how === 'later') held.push(() => resolve(honouring(ok(), signal)));
        signal?.addEventListener('abort', () => reject(aborted(signal)), { once: true });
      });
    }
    if (how === 'ok') return Promise.resolve(honouring(ok(), signal));
    return Promise.resolve(honouring(new Response(JSON.stringify({ ok: false, errors: [{ title: 'Unauthorized', detail: `Refused with ${how}.` }] }), { status: how }), signal));
  };
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const call: RestCall = {
      method: init.method ?? 'GET',
      url: String(input),
      headers: { ...(init.headers as Record<string, string> | undefined) },
      ...(typeof init.body === 'string' ? { body: init.body } : {}),
      ...(init.keepalive === undefined ? {} : { keepalive: init.keepalive }),
      ...(init.signal ? { signal: init.signal } : {}),
    };
    calls.push(call);
    if (init.signal?.aborted) return Promise.reject(aborted(init.signal));
    if (call.method === 'POST') return answer(o.create ?? 'ok', () => new Response(JSON.stringify(CREATED_BODY), { status: 201 }), init.signal ?? undefined);
    if (call.method === 'DELETE') return answer(o.remove ?? 'ok', () => new Response(null, { status: 204 }), init.signal ?? undefined);
    return answer(o.list ?? 'ok', () => new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 }), init.signal ?? undefined);
  };
  return {
    fetch,
    calls,
    of: (method: string) => calls.filter((c) => c.method === method),
    /** Answers every request held as `'later'`, in order. */
    answer: () => { for (const go of held.splice(0)) go(); },
  };
}
```

- [ ] **Step 2: Write the failing tests.** Create `src/providers/palabraai/wire.test.ts` — one case scans `wire.ts` with the TypeScript compiler for every function that reads a credential, so a fifth reader fails it:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { redact } from '../../lib/diagnostics/redact';
import {
  CREATE_SESSION_BODY, CREATE_SESSION_URL, decodeMessage, directUrl, errorCode, errorOf, errorWords, GET_TASK, inputAudio, outputAudioOf, PALABRA_API,
  POLICY_VIOLATION, readCreated, restHeaders, restWords, sessionDeleteUrl, SESSIONS_URL, sessionUrl, setTask, taskStatusOf, transcriptionOf, validationWords,
  warningOf,
} from './wire';
import { APP, AUTO_CTX, configFor, CREATED_BODY, EN, JA, KEY, PUBLISHER, SENTENCE, SERVER, SESSION_ID, SESSION_WS_URL } from './testing';

/** The names a credential is read through: the credentials' type, its three fields, and a REST session's publisher token. */
const SECRET_NAMES = new Set(['PalabraCredentials', 'apiKey', 'clientId', 'clientSecret', 'publisher']);

/** The functions of a module that name a credential, `<module>` for a use outside any function; an import, or a type declared, names nothing. */
function secretReaders(source: string): string[] {
  const readers = new Set<string>();
  const enclosing = (node: ts.Node): string => {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
      if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
    }
    return '<module>';
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isInterfaceDeclaration(node)) return;
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && SECRET_NAMES.has(node.text)) readers.add(enclosing(node));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true));
  return [...readers].sort();
}

const parse = (frame: string) => decodeMessage(frame);

describe("Palabra AI's wire: the two ways in (ruling 1)", () => {
  it('sends the platform key as a Bearer token and the app pair as its two headers', () => {
    expect(restHeaders(KEY)).toEqual({ Authorization: `Bearer ${KEY.apiKey}` });
    expect(restHeaders(APP)).toEqual({ ClientId: APP.clientId, ClientSecret: APP.clientSecret });
  });

  it("dials the platform key straight to the streaming endpoint, the key in the query, as the owner's probe did", () => {
    const url = directUrl('4593a7584de94538900fe318b855be17', KEY);
    expect(url).toBe(`wss://streaming.palabra.ai/streaming-api/4593a7584de94538900fe318b855be17/v1/speech-to-speech/stream?token=${KEY.apiKey}`);
    expect(directUrl('h', { kind: 'apiKey', apiKey: 'a b&c' })).toBe('wss://streaming.palabra.ai/streaming-api/h/v1/speech-to-speech/stream?token=a%20b%26c');
    // Wherever it lands, the carrier masks it.
    expect(redact(url)).not.toContain(KEY.apiKey);
  });

  it("creates a session for the app pair, and reaches its own address with the publisher token in the query", () => {
    expect(CREATE_SESSION_URL).toBe(`${PALABRA_API}/session-storage/session`);
    expect(JSON.parse(CREATE_SESSION_BODY)).toEqual({ data: { intent: 'api' } });
    const created = readCreated(CREATED_BODY);
    expect(created).toEqual({ id: SESSION_ID, publisher: PUBLISHER, wsUrl: SESSION_WS_URL });
    expect(sessionUrl(created!)).toBe(`${SESSION_WS_URL}?token=${PUBLISHER}`);
    expect(redact(sessionUrl(created!))).not.toContain(PUBLISHER);
    // Its own id alone is deleted — the id, too, is JWT-shaped, and masked wherever it lands.
    expect(sessionDeleteUrl(SESSION_ID)).toBe(`${SESSIONS_URL}/${SESSION_ID}`);
    expect(redact(SESSION_ID)).toBe('[REDACTED]');
  });

  it('reads no session from an answer without a socket to reach', () => {
    expect(readCreated({ data: { id: 'x', publisher: 'y' } })).toBeNull();
    expect(readCreated({ errors: [] })).toBeNull();
    expect(readCreated(null)).toBeNull();
  });

  it("words a REST refusal in Palabra's own words: its detail, else its title, else ours", () => {
    expect(restWords(401, { errors: [{ title: 'Unauthorized', detail: 'Invalid credentials.' }] }, 'x')).toBe('HTTP 401: Invalid credentials.');
    expect(restWords(403, { errors: [{ title: 'Forbidden resource' }] }, 'x')).toBe('HTTP 403: Forbidden resource');
    expect(restWords(401, {}, 'Palabra did not accept these credentials.')).toBe('HTTP 401: Palabra did not accept these credentials.');
  });

  it('reads a credential in `wire.ts` in the four builders alone', () => {
    expect(secretReaders(readFileSync(resolve(__dirname, 'wire.ts'), 'utf-8'))).toEqual(['directUrl', 'readCreated', 'restHeaders', 'sessionUrl']);
    // The scan's control: a read anywhere else is named — in a function, an arrow, at the top level, or indexed; an import or an interface is not.
    expect(secretReaders([
      "import type { PalabraCredentials } from './settings';",
      'interface Held { publisher: string }',
      'export function url(k: PalabraCredentials) { return k.kind; }',
      'export const frame = (k: { apiKey: string }) => k.apiKey;',
      "const leaked = { clientSecret: 'x' };",
      "export function indexed(k: Record<string, string>) { return k['clientId']; }",
    ].join('\n'))).toEqual(['<module>', 'frame', 'indexed', 'url']);
  });
});

describe("Palabra AI's wire: the task", () => {
  it("configures a speaking leg as the owner's probe did: 24 kHz pcm both ways over this socket, timbre detection off (rulings 7, 10)", () => {
    expect(setTask(configFor())).toEqual({
      message_type: 'set_task',
      data: {
        input_stream: { content_type: 'audio', source: { type: 'ws', format: 'pcm_s16le', sample_rate: 24_000, channels: 1 } },
        output_stream: { content_type: 'audio', target: { type: 'ws', format: 'pcm_s16le' } },
        pipeline: {
          transcription: { source_language: 'ja', detectable_languages: [], segment_confirmation_silence_threshold: 0.7, sentence_splitter: { enabled: true } },
          translations: [{
            target_language: 'en',
            translate_partial_transcriptions: false,
            speech_generation: { voice_cloning: false, voice_id: 'default_low', voice_timbre_detection: { enabled: false, high_timbre_voices: ['default_high'], low_timbre_voices: ['default_low'] } },
          }],
          translation_queue_configs: { global: { desired_queue_level_ms: 8_000, max_queue_level_ms: 24_000, auto_tempo: false } },
          allowed_message_types: ['translated_transcription', 'partial_transcription', 'partial_translated_transcription', 'validated_transcription'],
        },
      },
    });
  });

  it('asks for text alone on a leg that does not speak (ruling 7), and sends the settings as built', () => {
    expect(setTask(configFor({ ...AUTO_CTX, speech: false })).data.output_stream).toBeNull();
    const c = configFor(AUTO_CTX, { voiceId: 'default_high', segmentConfirmationSilenceThreshold: 1.2, sentenceSplitterEnabled: false, translatePartialTranscriptions: true, desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000, autoTempo: true });
    const { pipeline } = setTask(c).data;
    expect(pipeline.transcription).toMatchObject({ segment_confirmation_silence_threshold: 1.2, sentence_splitter: { enabled: false } });
    expect(pipeline.translations[0]).toMatchObject({ translate_partial_transcriptions: true, speech_generation: { voice_id: 'default_high', voice_timbre_detection: { enabled: false } } });
    expect(pipeline.translation_queue_configs.global).toEqual({ desired_queue_level_ms: 15_000, max_queue_level_ms: 18_000, auto_tempo: true });
  });

  it('asks for the task as the probe did, and sends a chunk as base64 pcm', () => {
    expect(GET_TASK).toEqual({ message_type: 'get_task', data: { exclude_hidden: true } });
    const pcm = new Int16Array(7_680).map((_, i) => (i % 200) - 100);
    const frame = JSON.parse(inputAudio(pcm)) as { message_type: string; data: { data: string } };
    expect(frame.message_type).toBe('input_audio_data');
    expect(frame.data.data).toHaveLength(20_480);
    expect(Array.from(base64ToPcm(frame.data.data))).toEqual(Array.from(pcm));
  });
});

describe("Palabra AI's wire: the server's messages", () => {
  it('reads a text frame, a binary one, and a data field sent as JSON text', () => {
    expect(parse(SERVER.currentTask())).toMatchObject({ type: 'current_task', data: { task_status: 'running' } });
    expect(decodeMessage(new TextEncoder().encode(SERVER.endOfStream()).buffer)).toEqual({ type: 'end_of_stream', data: {} });
    expect(parse(SERVER.doubleEncoded('current_task', { task_status: 'paused' }))).toEqual({ type: 'current_task', data: { task_status: 'paused' } });
    expect(parse(JSON.stringify({ message_type: 'x', data: 'not json' }))).toEqual({ type: 'x', data: {} });
    expect(parse(JSON.stringify({ message_type: 'x' }))).toEqual({ type: 'x', data: {} });
  });

  it('throws on a frame that is no JSON object with a message_type', () => {
    for (const bad of ['not json', '[]', 'null', JSON.stringify({ data: {} }), JSON.stringify({ message_type: 7 })]) expect(() => decodeMessage(bad), bad).toThrow();
    expect(() => decodeMessage(new Blob(['{}']))).toThrow('a server frame of an unexpected kind');
  });

  it("reads a transcription as the probe logged it, the part a string whether it came as one or as a number", () => {
    expect(transcriptionOf(parse(SERVER.partial('リアルタイム', SENTENCE, 1.22)).data)).toEqual({ id: SENTENCE, part: undefined, language: 'ja', text: 'リアルタイム', start: 0.32, end: 1.22 });
    expect(transcriptionOf(parse(SERVER.validated()).data)).toMatchObject({ id: SENTENCE, text: JA });
    expect(transcriptionOf(parse(SERVER.translated()).data)).toMatchObject({ id: SENTENCE, part: '0', language: 'en', text: EN });
    expect(transcriptionOf({})).toEqual({ id: undefined, part: undefined, language: undefined, text: '', start: undefined, end: undefined });
  });

  it('reads a chunk of speech, its part as a string and its last flag', () => {
    const audio = outputAudioOf(parse(SERVER.audio({ last: true, samples: 2_859 })).data);
    expect(audio).toMatchObject({ id: SENTENCE, part: '0', last: true });
    expect(base64ToPcm(audio.audio as string)).toHaveLength(2_859);
    expect(outputAudioOf(parse(SERVER.audio({ part: 1 })).data)).toMatchObject({ part: '1', last: false });
  });

  it('reads an error, a warning and a task status', () => {
    expect(errorOf(parse(SERVER.notFound()).data)).toEqual({ code: 'NOT_FOUND', desc: 'No active task found', msg: undefined, param: null });
    expect(warningOf(parse(SERVER.voiceNotFound()).data)).toEqual({ code: 'VOICE_NOT_FOUND', message: "Voice ID 'default_low' is not available, using default voice" });
    expect(taskStatusOf(parse(SERVER.currentTask('paused')).data)).toBe('paused');
    expect(taskStatusOf({})).toBeUndefined();
  });

  it("words the probe's refusals by the field and its message, from the `desc` a pydantic error carries (ruling 4)", () => {
    const threshold = errorOf(parse(SERVER.thresholdRefused()).data);
    expect(validationWords(threshold.desc)).toBe('segment_confirmation_silence_threshold: ensure this value is greater than or equal to 0.3');
    expect(errorWords(threshold)).toBe('[Palabra VALIDATION_ERROR] segment_confirmation_silence_threshold: ensure this value is greater than or equal to 0.3');
    expect(errorWords(errorOf(parse(SERVER.queueRefused()).data))).toBe('[Palabra VALIDATION_ERROR] global: `max_queue_level_ms` must be greater than `desired_queue_level_ms`');
    // A message holding an apostrophe is quoted with double quotes in Python's repr.
    expect(validationWords(`ValidationError(model='M', errors=[{'loc': ('a', 'b'), 'msg': "value isn't valid", 'type': 't'}, {'loc': ('c',), 'msg': 'second', 'type': 't'}])`)).toBe("b: value isn't valid; c: second");
  });

  it('falls back to the message, then the whole desc, then words of its own', () => {
    expect(errorWords(errorOf(parse(SERVER.serviceTimeout()).data))).toBe('[Palabra SERVICE_TIMEOUT] No input audio received for 10s. Use the pause_task command for intentional pauses.');
    expect(errorWords({ code: 'X', msg: 'from msg', desc: 'no pydantic here' })).toBe('[Palabra X] from msg');
    expect(errorWords({})).toBe('[Palabra error] the server reported an error');
  });

  it("puts a refused task as the request's, anything else as the service's", () => {
    expect(errorCode({ code: 'VALIDATION_ERROR' })).toBe('client');
    expect(errorCode({ code: 'SERVICE_TIMEOUT' })).toBe('server');
    expect(errorCode({})).toBe('server');
    expect(POLICY_VIOLATION).toBe(1008);
  });
});
```

Create `src/providers/palabraai/audioIn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { CHUNK_MS, CHUNK_SAMPLES, IDLE_MS, Rechunker, SILENCE } from './audioIn';

/** 24 kHz pcm whose samples count up from `from`, so order and loss show. */
const ramp = (length: number, from: number) => new Int16Array(length).map((_, i) => (from + i) % 30_000);

describe("What Palabra hears (rulings 3, 5)", () => {
  it('cuts 320 ms chunks, and waits past the capture\'s slowest chunk before it calls a gap an idle', () => {
    expect(CHUNK_MS).toBe(320);
    expect(CHUNK_SAMPLES).toBe(7_680);
    expect(SILENCE).toHaveLength(CHUNK_SAMPLES);
    expect(SILENCE.every((s) => s === 0)).toBe(true);
    // The ScriptProcessor fallback delivers 8 192 samples a chunk: 341 ms.
    expect(IDLE_MS).toBeGreaterThan((8_192 / SAMPLE_RATE) * 1000);
  });

  it("re-chunks the worklet's 2 048-sample chunks into whole 320 ms ones, every sample in order", () => {
    const r = new Rechunker();
    const out: Int16Array[] = [];
    for (let k = 0; k < 15; k++) out.push(...r.push(ramp(2_048, k * 2_048)));
    // 15 × 2 048 = 30 720 = 4 × 7 680: four chunks, nothing left.
    expect(out.map((c) => c.length)).toEqual([7_680, 7_680, 7_680, 7_680]);
    const joined = new Int16Array(30_720);
    out.forEach((c, i) => joined.set(c, i * 7_680));
    expect(Array.from(joined)).toEqual(Array.from(ramp(30_720, 0)));
    expect(r.flush()).toBeNull();
  });

  it('cuts a chunk larger than one, and keeps each chunk it hands out its own', () => {
    const r = new Rechunker();
    const out = r.push(ramp(8_192 * 2, 0));
    expect(out.map((c) => c.length)).toEqual([7_680, 7_680]);
    out[0][0] = -1;
    const next = r.push(ramp(7_680, 0));
    expect(next[0][0]).not.toBe(-1);
  });

  it('flushes what waits padded with silence to a whole chunk, saying how much of it was audio; nothing, when nothing waits', () => {
    const r = new Rechunker();
    expect(r.flush()).toBeNull();
    r.push(ramp(1_000, 5));
    const flushed = r.flush()!;
    expect(flushed.samples).toBe(1_000);
    expect(flushed.chunk).toHaveLength(CHUNK_SAMPLES);
    expect(Array.from(flushed.chunk.subarray(0, 1_000))).toEqual(Array.from(ramp(1_000, 5)));
    expect(flushed.chunk.subarray(1_000).every((s) => s === 0)).toBe(true);
    expect(r.flush()).toBeNull();
    // What comes after a flush starts a chunk of its own.
    expect(r.push(ramp(7_680, 0))[0][0]).toBe(0);
  });
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `npx vitest run src/providers/palabraai/wire.test.ts src/providers/palabraai/audioIn.test.ts`
Expected: FAIL — `Failed to resolve import "./wire"` and `"./audioIn"` (2 files).

- [ ] **Step 4: Write the wire.** Create `src/providers/palabraai/wire.ts`:

```ts
/**
 * Palabra AI's wire (survey §2.8; the owner's live probe, 2026-09-28/29):
 * the two ways to its streaming socket — the platform key straight in the
 * URL's query, or a REST session's publisher token (ruling 1) — the REST
 * requests, the task the socket is configured with, the audio going up, and
 * the server's messages read. Pure: no socket, no timer, no fetch.
 * `restHeaders`, `directUrl`, `readCreated` and `sessionUrl` are the only
 * readers of a credential: nothing they return is framed, worded or logged,
 * and `redact()` masks the query's `token` and a key's or a token's shape
 * wherever one reaches a sink anyway.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { pcmToBase64 } from '../../lib/contract/pcm64';
import type { PalabraConfig } from './config';
import type { PalabraCredentials } from './settings';

export const PALABRA_API = 'https://api.palabra.ai';
/** The REST sessions: listed by the check (`GET`), one deleted by its id (`DELETE`). */
export const SESSIONS_URL = `${PALABRA_API}/session-storage/sessions`;
/** Where the app pair's REST session is created (`POST`; ruling 1). */
export const CREATE_SESSION_URL = `${PALABRA_API}/session-storage/session`;
/** The streaming endpoint; the path's first segment is any URL-safe string, which spreads connections over its servers (the docs). */
export const STREAMING_BASE = 'wss://streaming.palabra.ai/streaming-api';
/** The create's body, as the old client and the probe sent it. */
export const CREATE_SESSION_BODY = JSON.stringify({ data: { intent: 'api' } });
/** The close Palabra sends past its connection limit — 20 a minute per key (the docs) — and after its own `SERVICE_TIMEOUT` (the owner's probe). */
export const POLICY_VIOLATION = 1008;

/** The REST headers for a credential (ruling 1): the platform key as a Bearer token, or the legacy app's pair as its two headers (`PalabraAIClient.ts:202-206`). */
export function restHeaders(k: PalabraCredentials): Record<string, string> {
  return k.kind === 'apiKey' ? { Authorization: `Bearer ${k.apiKey}` } : { ClientId: k.clientId, ClientSecret: k.clientSecret };
}

/** The platform key's socket (ruling 1): straight to the streaming endpoint, the key in the query; the server makes the session and cleans it up when the socket closes. */
export function directUrl(hash: string, k: Extract<PalabraCredentials, { kind: 'apiKey' }>): string {
  return `${STREAMING_BASE}/${hash}/v1/speech-to-speech/stream?token=${encodeURIComponent(k.apiKey)}`;
}

/** What a REST session's answer holds that the app pair's path uses. Its id is shaped as a JWT (the owner's probe), and the publisher is one: neither is framed. */
export interface CreatedSession {
  id: string;
  publisher: string;
  wsUrl: string;
}

/** A create's answer, `{ data: { id, publisher, ws_url, … } }`; null when it holds no socket to reach. */
export function readCreated(body: unknown): CreatedSession | null {
  const data = (body as { data?: unknown } | null)?.data as { id?: unknown; publisher?: unknown; ws_url?: unknown } | undefined;
  if (!data || typeof data.id !== 'string' || typeof data.publisher !== 'string' || typeof data.ws_url !== 'string') return null;
  return { id: data.id, publisher: data.publisher, wsUrl: data.ws_url };
}

/** The app pair's socket (ruling 1): the session's own address, the publisher token in its query. Throws on an address that is no URL. */
export function sessionUrl(created: CreatedSession): string {
  const url = new URL(created.wsUrl);
  url.searchParams.set('token', created.publisher);
  return url.toString();
}

/** One REST session, deleted by its id: only our own, never the account's others (the old delete-all ended the other leg of Both). */
export function sessionDeleteUrl(id: string): string {
  return `${SESSIONS_URL}/${encodeURIComponent(id)}`;
}

/** A REST refusal in Palabra's words: `HTTP <status>: <detail, else title, else ours>` — its envelope is `{ errors: [{ title, detail }] }`. */
export function restWords(status: number, body: unknown, fallback: string): string {
  const first = (body as { errors?: Array<{ title?: unknown; detail?: unknown }> } | null)?.errors?.[0];
  const said = typeof first?.detail === 'string' && first.detail ? first.detail : typeof first?.title === 'string' && first.title ? first.title : fallback;
  return `HTTP ${status}: ${said}`;
}

/** The task a leg runs (the owner's probe's `set_task`, which every run started with). */
export interface SetTaskMessage {
  message_type: 'set_task';
  data: {
    input_stream: { content_type: 'audio'; source: { type: 'ws'; format: 'pcm_s16le'; sample_rate: number; channels: 1 } };
    output_stream: { content_type: 'audio'; target: { type: 'ws'; format: 'pcm_s16le' } } | null;
    pipeline: {
      transcription: { source_language: string; detectable_languages: string[]; segment_confirmation_silence_threshold: number; sentence_splitter: { enabled: boolean } };
      translations: Array<{
        target_language: string;
        translate_partial_transcriptions: boolean;
        speech_generation: {
          voice_cloning: false;
          voice_id: string;
          voice_timbre_detection: { enabled: false; high_timbre_voices: string[]; low_timbre_voices: string[] };
        };
      }>;
      translation_queue_configs: { global: { desired_queue_level_ms: number; max_queue_level_ms: number; auto_tempo: boolean } };
      allowed_message_types: string[];
    };
  };
}

/**
 * The task (survey §2.7): 24 kHz pcm in, the contract's own rate — no
 * resampling — and 24 kHz pcm out, over this socket. A leg that does not
 * speak sends `output_stream: null` and gets the text alone (ruling 7; the
 * owner's follow-up probe). Timbre detection is always off, so the voice
 * picked is the voice heard (ruling 10). The old client's `verification`
 * block, marked a work in progress in the docs, is not sent; the probe ran
 * without it.
 */
export function setTask(c: PalabraConfig): SetTaskMessage {
  return {
    message_type: 'set_task',
    data: {
      input_stream: { content_type: 'audio', source: { type: 'ws', format: 'pcm_s16le', sample_rate: SAMPLE_RATE, channels: 1 } },
      output_stream: c.speech ? { content_type: 'audio', target: { type: 'ws', format: 'pcm_s16le' } } : null,
      pipeline: {
        transcription: {
          source_language: c.source,
          detectable_languages: [],
          segment_confirmation_silence_threshold: c.silenceThreshold,
          sentence_splitter: { enabled: c.sentenceSplitter },
        },
        translations: [{
          target_language: c.target,
          translate_partial_transcriptions: c.translatePartials,
          speech_generation: {
            voice_cloning: false,
            voice_id: c.voiceId,
            voice_timbre_detection: { enabled: false, high_timbre_voices: ['default_high'], low_timbre_voices: ['default_low'] },
          },
        }],
        translation_queue_configs: { global: { desired_queue_level_ms: c.queue.desiredMs, max_queue_level_ms: c.queue.maxMs, auto_tempo: c.queue.autoTempo } },
        allowed_message_types: ['translated_transcription', 'partial_transcription', 'partial_translated_transcription', 'validated_transcription'],
      },
    },
  };
}

/** Asks whether the task runs: answered by `current_task`, or `NOT_FOUND` until it does (the docs; the probe's `get_task`). */
export const GET_TASK = { message_type: 'get_task', data: { exclude_hidden: true } } as const;

/** Ends the task at once, what is still being translated dropped — "drop the pipeline and disconnect immediately, without processing the tail" (the docs): Stop's, sent best-effort before the close (ruling 13). */
export const END_TASK = { message_type: 'end_task', data: { force: true } } as const;

/** One chunk as it goes up: base64 of little-endian 24 kHz pcm (the docs: a payload of 1 KB to 512 KB; a 320 ms chunk is 20 480 characters). */
export function inputAudio(pcm: Int16Array): string {
  return JSON.stringify({ message_type: 'input_audio_data', data: { data: pcmToBase64(pcm) } });
}

/** A server message: its type, and its `data` as an object — a `data` that is itself JSON text is read (the Python SDK's note; `PalabraAIClient.ts:864`). */
export interface PalabraMessage {
  type: string;
  data: Record<string, unknown>;
}

const isArrayBuffer = (data: unknown): data is ArrayBuffer => Object.prototype.toString.call(data) === '[object ArrayBuffer]';

/** A server frame, read at once: text, or a binary frame as an ArrayBuffer. Throws when it is no JSON object with a string `message_type`. */
export function decodeMessage(data: unknown): PalabraMessage {
  const text = typeof data === 'string' ? data : isArrayBuffer(data) ? new TextDecoder().decode(data) : null;
  if (text === null) throw new Error(`a server frame of an unexpected kind (${Object.prototype.toString.call(data)})`);
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a server frame that is not a JSON object');
  const type = (parsed as { message_type?: unknown }).message_type;
  if (typeof type !== 'string') throw new Error('a server frame with no message_type');
  let body = (parsed as { data?: unknown }).data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // A string that is no JSON: read as no data.
    }
  }
  return { type, data: body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {} };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** A sentence's id or part as a string: the audio carries its part as "0", the text as 0 (the owner's probe). */
const idOf = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);

/** A transcription or translation message's content (the four text messages). */
export interface Transcription {
  /** The sentence (`transcription_id`), the same on all four kinds and on its audio. */
  id?: string;
  /** Which part of the sentence's translation (`translation_part_id`), on a translation only. */
  part?: string;
  language?: string;
  text: string;
  /** The first segment's times, seconds from the stream's start: the Logs' alone. */
  start?: number;
  end?: number;
}

export function transcriptionOf(data: Record<string, unknown>): Transcription {
  const t = (data.transcription ?? {}) as Record<string, unknown>;
  const first = Array.isArray(t.segments) ? (t.segments[0] as Record<string, unknown> | undefined) : undefined;
  return {
    id: idOf(t.transcription_id),
    part: idOf(t.translation_part_id),
    language: str(t.language),
    text: str(t.text) ?? '',
    start: num(first?.start),
    end: num(first?.end),
  };
}

/** A chunk of translated speech (`output_audio_data`): 24 kHz mono pcm, 200 ms a chunk, a sentence's last marked (the owner's probe). */
export interface OutputAudio {
  id?: string;
  part?: string;
  last: boolean;
  /** The base64 pcm; anything but a string is no audio. */
  audio: unknown;
}

export function outputAudioOf(data: Record<string, unknown>): OutputAudio {
  return { id: idOf(data.transcription_id), part: idOf(data.translation_part_id), last: data.last_chunk === true, audio: data.data };
}

/** An `error` message (the probe: `{ code, desc, param }`; the docs add `msg`). */
export interface PalabraError {
  code?: string;
  desc?: string;
  msg?: string;
  param?: unknown;
}

export function errorOf(data: Record<string, unknown>): PalabraError {
  return { code: str(data.code), desc: str(data.desc), msg: str(data.msg), param: data.param };
}

/** A `warning` message: `{ code, message }` (the probe's `VOICE_NOT_FOUND`; the docs' `AUDIO_STREAM_*`). */
export function warningOf(data: Record<string, unknown>): { code?: string; message?: string } {
  return { code: str(data.code), message: str(data.message) };
}

/** A `current_task`'s status: `running`, `paused` or `unknown` (the docs). */
export function taskStatusOf(data: Record<string, unknown>): string | undefined {
  return str(data.task_status);
}

/** What `get_task` answers until the task runs: expected, never a failure (ruling 4). */
export const NOT_FOUND = 'NOT_FOUND';
/** The server stops a stream that sent no audio for 10 s (the owner's follow-up probe), then closes 1008. */
export const SERVICE_TIMEOUT = 'SERVICE_TIMEOUT';
/** The voice the task asked for is not available, and another speaks (the probe's `bn`): the `voice_fallback` notice (ruling 11). */
export const VOICE_NOT_FOUND = 'VOICE_NOT_FOUND';

/**
 * A pydantic `ValidationError(...)`'s messages, each after the field it
 * names — `segment_confirmation_silence_threshold: ensure this value is
 * greater than or equal to 0.3` — joined by "; ". Null when `desc` holds
 * none: the words then fall back to `desc` whole (survey §6).
 */
export function validationWords(desc: string | undefined): string | null {
  if (!desc) return null;
  const words: string[] = [];
  const entry = /'loc': \(([^)]*)\), 'msg': (?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  for (let m = entry.exec(desc); m !== null; m = entry.exec(desc)) {
    const fields = m[1].split(',').map((f) => f.trim().replace(/^'|'$/g, '')).filter((f) => f !== '' && f !== '__root__');
    const message = m[2] ?? m[3] ?? '';
    words.push(fields.length > 0 ? `${fields[fields.length - 1]}: ${message}` : message);
  }
  return words.length > 0 ? words.join('; ') : null;
}

/** An `error` in Palabra's words, the `{{detail}}` of `notices.<code>` (ruling 11): `[Palabra <code>] <its message>`. */
export function errorWords(e: PalabraError): string {
  return `[Palabra ${e.code || 'error'}] ${validationWords(e.desc) || e.msg || e.desc || 'the server reported an error'}`;
}

/** An `error` as a notice code: a task Palabra refused is the request's (`client`); anything else the service's (`server`). A hypothesis past the probe's codes: the live test's `session.error` frames settle it. */
export function errorCode(e: PalabraError): 'client' | 'server' {
  return e.code === 'VALIDATION_ERROR' ? 'client' : 'server';
}
```

- [ ] **Step 5: Write the re-chunker.** Create `src/providers/palabraai/audioIn.ts`:

```ts
/**
 * What Palabra hears (rulings 3 and 5): the contract's 24 kHz pcm — the
 * rate the task declares, no resampling — cut into the 320 ms chunks its
 * docs ask for "at the real-time rate" and the owner's probe sent; a
 * release's remainder padded to a chunk with silence; the silence an idle
 * stream carries, one chunk a beat. Pure: no socket, no timer — the adapter
 * sends the chunks and runs the idle rule on the request's clock.
 */
import { SAMPLE_RATE } from '../../lib/contract/adapter';

/** One chunk's length (ruling 5; the docs; the probe). */
export const CHUNK_MS = 320;
/** 320 ms at 24 kHz: 7 680 samples, 15 360 bytes — 20 480 base64 characters, inside the docs' 1 KB–512 KB. */
export const CHUNK_SAMPLES = (SAMPLE_RATE * CHUNK_MS) / 1000;
/**
 * How long no audio must have come before the silence starts (ruling 3).
 * The capture delivers a chunk every 85.3 ms, or every 341 ms on the
 * ScriptProcessor fallback: 500 ms is past both, so a gap between two
 * chunks of speech is never taken for an idle and filled with silence —
 * the gap Doubao AST 2.0's 250 ms left open on the fallback.
 */
export const IDLE_MS = 500;
/** One chunk of silence: what an idle beat sends. */
export const SILENCE: Int16Array = new Int16Array(CHUNK_SAMPLES);

/** The stream cut into 320 ms chunks; the rest waits for the next audio, or a flush. */
export class Rechunker {
  private pending = new Int16Array(CHUNK_SAMPLES);
  private filled = 0;

  /** The chunks this audio completes, in order. */
  push(pcm: Int16Array): Int16Array[] {
    const out: Int16Array[] = [];
    let i = 0;
    while (i < pcm.length) {
      const n = Math.min(CHUNK_SAMPLES - this.filled, pcm.length - i);
      this.pending.set(pcm.subarray(i, i + n), this.filled);
      this.filled += n;
      i += n;
      if (this.filled === CHUNK_SAMPLES) {
        out.push(this.pending);
        this.pending = new Int16Array(CHUNK_SAMPLES);
        this.filled = 0;
      }
    }
    return out;
  }

  /**
   * What waits, padded with silence to a whole chunk — a chunk under the
   * docs' 1 KB floor would not go up — and how many of its samples are
   * audio; null when nothing waits. A release, and an idle's start, send it.
   */
  flush(): { chunk: Int16Array; samples: number } | null {
    if (this.filled === 0) return null;
    const flushed = { chunk: this.pending, samples: this.filled };
    this.pending = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
    return flushed;
  }
}
```

- [ ] **Step 6: Run the folder.**

Run: `npx vitest run src/providers/palabraai src/providers/sessionSide.consistency.test.ts`
Expected: PASS — 5 files, 51 tests.

- [ ] **Step 7: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 8: Commit.**

```bash
git add src/providers/palabraai/wire.ts src/providers/palabraai/wire.test.ts src/providers/palabraai/audioIn.ts src/providers/palabraai/audioIn.test.ts src/providers/palabraai/testing.ts
```

```bash
git commit -q -F - -- src/providers/palabraai/wire.ts src/providers/palabraai/wire.test.ts src/providers/palabraai/audioIn.ts src/providers/palabraai/audioIn.test.ts src/providers/palabraai/testing.ts <<'EOF'
feat(palabraai): Palabra AI's wire and its 320 ms re-chunker

The two ways to its socket, the REST session's create and delete, the
task, the audio going up, the server's messages read and an error's code
and words; the credentials read in four functions alone. Fixtures in the
owner's probe's shapes, their credentials made up.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 10: The settings view and the turn detection (Wave 3)

**Files:**
- Create: `src/providers/palabraai/PalabraSettings.tsx`, `src/providers/palabraai/PalabraTurnDetection.tsx`
- Test: `src/providers/palabraai/PalabraSettings.test.tsx`, `src/providers/palabraai/PalabraTurnDetection.test.tsx`

**Interfaces:**
- Consumes: `VoiceField` (`src/components/providers/fields/VoiceField`); `SettingsProps` (`src/lib/provider/types`); `DESIRED_QUEUE_RANGE`, `MAX_QUEUE_RANGE`, `SILENCE_THRESHOLD_RANGE`, `effectiveQueue`, `effectiveThreshold`, `maxQueueFloor`, `PALABRA_VOICES`, `PalabraSettings`, `PalabraVoice` (`./settings`).
- Produces: `PalabraSettingsView(props: SettingsProps<PalabraSettings>)`; `PalabraTurnDetectionSummary`, `PalabraTurnDetectionControls` (same props). The old block's markup (`PSS:1296-1463`): `settings-section` / `setting-item` / `setting-label` / `setting-value`, `slider`, and `turn-detection-options` with `option-button` for the Enabled / Disabled pairs — the classes every sibling provider's view draws (choice 15).

- [ ] **Step 1: Write the failing tests.** Create `src/providers/palabraai/PalabraSettings.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { PalabraSettingsView } from './PalabraSettings';
import { PALABRA_DEFAULTS } from './settings';

const slider = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const buttons = (label: string) => within(screen.getByRole('group', { name: label })).getAllByRole('button');

describe("Palabra AI's settings view (D18)", () => {
  it('draws, in the old order, the voice, speech processing and the audio buffer, and nothing in English of its own (ruling 10)', () => {
    const { container } = render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={vi.fn()} />);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['settings.voice', 'settings.speechProcessing', 'settings.queueConfiguration']);
    expect((screen.getByLabelText('settings.voice') as HTMLSelectElement).value).toBe('default_low');
    expect(Array.from((screen.getByLabelText('settings.voice') as HTMLSelectElement).options).map((o) => [o.value, o.textContent])).toEqual([
      ['default_low', 'Default Low'], ['default_high', 'Default High'],
    ]);
    // The old three `title` tooltips, English-only, are gone.
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('writes the voice and each switch to its own field', () => {
    const update = vi.fn();
    render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={update} />);
    fireEvent.change(screen.getByLabelText('settings.voice'), { target: { value: 'default_high' } });
    fireEvent.click(buttons('settings.sentenceSplitter')[1]);
    fireEvent.click(buttons('settings.translatePartialTranscriptions')[0]);
    fireEvent.click(buttons('settings.autoTempo')[0]);
    expect(update.mock.calls).toEqual([
      [{ voiceId: 'default_high' }], [{ sentenceSplitterEnabled: false }], [{ translatePartialTranscriptions: true }], [{ autoTempo: true }],
    ]);
    expect(buttons('settings.sentenceSplitter').map((b) => [b.textContent, b.className])).toEqual([
      ['settings.enabled', 'option-button active'], ['settings.disabled', 'option-button '],
    ]);
  });

  it('draws the buffer on the old sliders, the max slider\'s floor following the target (ruling 10)', () => {
    const update = vi.fn();
    render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={update} />);
    const desired = slider('settings.desiredQueueLevel');
    expect([desired.min, desired.max, desired.step, desired.value]).toEqual(['3000', '15000', '1000', '8000']);
    const max = slider('settings.maxQueueLevel');
    expect([max.min, max.max, max.step, max.value]).toEqual(['12000', '60000', '3000', '24000']);
    expect(screen.getByText('8.0s')).toBeInTheDocument();
    expect(screen.getByText('24.0s')).toBeInTheDocument();
    fireEvent.change(desired, { target: { value: '9000' } });
    fireEvent.change(max, { target: { value: '30000' } });
    expect(update.mock.calls).toEqual([[{ desiredQueueLevelMs: 9_000 }], [{ maxQueueLevelMs: 30_000 }]]);
  });

  it('shows a stored max that is not above the target raised to its floor, as a session sends it', () => {
    render(<PalabraSettingsView settings={{ ...PALABRA_DEFAULTS, desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000 }} update={vi.fn()} />);
    const max = slider('settings.maxQueueLevel');
    expect([max.min, max.value]).toEqual(['18000', '18000']);
    expect(screen.getByText('18.0s')).toBeInTheDocument();
  });

  it('locks every control while disabled', () => {
    render(<PalabraSettingsView settings={PALABRA_DEFAULTS} update={vi.fn()} disabled />);
    expect(screen.getByLabelText('settings.voice')).toBeDisabled();
    expect(slider('settings.desiredQueueLevel')).toBeDisabled();
    expect(slider('settings.maxQueueLevel')).toBeDisabled();
    for (const label of ['settings.sentenceSplitter', 'settings.translatePartialTranscriptions', 'settings.autoTempo']) {
      for (const b of buttons(label)) expect(b).toBeDisabled();
    }
  });
});
```

Create `src/providers/palabraai/PalabraTurnDetection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});

import { PalabraTurnDetectionControls, PalabraTurnDetectionSummary } from './PalabraTurnDetection';
import { PALABRA_DEFAULTS } from './settings';

describe('PalabraTurnDetectionSummary', () => {
  it('is one line of existing words: the VAD heading and the threshold a session sends', () => {
    const { container } = render(<PalabraTurnDetectionSummary settings={PALABRA_DEFAULTS} update={() => {}} />);
    expect(container.textContent).toBe('VAD Settings · Silence Threshold: 0.70s');
    // A stored 0.1, below the API's floor, reads as the 0.3 it is sent as (ruling 10).
    const { container: low } = render(<PalabraTurnDetectionSummary settings={{ ...PALABRA_DEFAULTS, segmentConfirmationSilenceThreshold: 0.1 }} update={() => {}} />);
    expect(low.textContent).toBe('VAD Settings · Silence Threshold: 0.30s');
  });
});

describe('PalabraTurnDetectionControls', () => {
  it('draws the threshold slider under the VAD heading, from 0.3 to 2.0 (ruling 10), writing a number', () => {
    const update = vi.fn();
    const { container } = render(<PalabraTurnDetectionControls settings={PALABRA_DEFAULTS} update={update} />);
    expect(container.querySelector('#palabra-vad-section h2')?.textContent).toBe('VAD Settings');
    const threshold = screen.getByLabelText('Silence Threshold') as HTMLInputElement;
    expect([threshold.min, threshold.max, threshold.step, threshold.value]).toEqual(['0.3', '2', '0.01', '0.7']);
    expect(screen.getByText('0.70s')).toBeInTheDocument();
    fireEvent.change(threshold, { target: { value: '1.25' } });
    expect(update).toHaveBeenCalledWith({ segmentConfirmationSilenceThreshold: 1.25 });
  });

  it('locks while disabled', () => {
    render(<PalabraTurnDetectionControls settings={PALABRA_DEFAULTS} update={() => {}} disabled />);
    expect(screen.getByLabelText('Silence Threshold')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/palabraai/PalabraSettings.test.tsx src/providers/palabraai/PalabraTurnDetection.test.tsx`
Expected: FAIL — `Failed to resolve import "./PalabraSettings"` and `"./PalabraTurnDetection"` (2 files).

- [ ] **Step 3: Write the view.** Create `src/providers/palabraai/PalabraSettings.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { VoiceField } from '../../components/providers/fields/VoiceField';
import type { SettingsProps } from '../../lib/provider/types';
import { DESIRED_QUEUE_RANGE, effectiveQueue, MAX_QUEUE_RANGE, maxQueueFloor, PALABRA_VOICES, type PalabraSettings as S, type PalabraVoice } from './settings';

/** An Enabled / Disabled pair, as the old block drew each of its three switches (`ProviderSpecificSettings.tsx:1341-1382, 1446-1461`). */
function OnOff({ label, value, onChange, disabled }: { label: string; value: boolean; onChange(value: boolean): void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="turn-detection-options" role="group" aria-label={label}>
      <button type="button" className={`option-button ${value ? 'active' : ''}`} onClick={() => onChange(true)} disabled={disabled}>
        {t('settings.enabled', 'Enabled')}
      </button>
      <button type="button" className={`option-button ${!value ? 'active' : ''}`} onClick={() => onChange(false)} disabled={disabled}>
        {t('settings.disabled', 'Disabled')}
      </button>
    </div>
  );
}

/**
 * Palabra AI's own settings (D18): the old UI's Palabra sections
 * (`ProviderSpecificSettings.tsx:1296-1463`) in their old order — the voice
 * (the shared `VoiceField`), speech processing, and the audio buffer. The
 * silence threshold is its `TurnDetection`; the pair is the generic
 * section's; the credentials and their mode the credential form's. The
 * buffer shows what a session asks for: the max slider's floor follows the
 * target, and a stored max not above it shows raised (ruling 10). The three
 * English-only tooltips are gone (ruling 10); no new locale key.
 */
export function PalabraSettingsView({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  const queue = effectiveQueue(settings);
  const splitter = t('settings.sentenceSplitter', 'Sentence Splitter');
  const partials = t('settings.translatePartialTranscriptions', 'Translate Partial Transcriptions');
  const desired = t('settings.desiredQueueLevel', 'Target Audio Buffer');
  const max = t('settings.maxQueueLevel', 'Max Audio Buffer');
  const tempo = t('settings.autoTempo', 'Adaptive Speech Speed');
  return (
    <>
      <VoiceField value={settings.voiceId} options={PALABRA_VOICES} onChange={(voiceId) => update({ voiceId: voiceId as PalabraVoice })} disabled={disabled} />
      <div className="settings-section">
        <h2>{t('settings.speechProcessing', 'Speech Processing')}</h2>
        <div className="setting-item">
          <div className="setting-label">
            <span>{splitter}</span>
          </div>
          <OnOff label={splitter} value={settings.sentenceSplitterEnabled} onChange={(sentenceSplitterEnabled) => update({ sentenceSplitterEnabled })} disabled={disabled} />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>{partials}</span>
          </div>
          <OnOff label={partials} value={settings.translatePartialTranscriptions} onChange={(translatePartialTranscriptions) => update({ translatePartialTranscriptions })} disabled={disabled} />
        </div>
      </div>
      <div className="settings-section">
        <h2>{t('settings.queueConfiguration', 'Audio Buffer Configuration')}</h2>
        <div className="setting-item">
          <div className="setting-label">
            <span>{desired}</span>
            <span className="setting-value">{(queue.desiredMs / 1000).toFixed(1)}s</span>
          </div>
          <input
            type="range" aria-label={desired}
            min={DESIRED_QUEUE_RANGE.min} max={DESIRED_QUEUE_RANGE.max} step={DESIRED_QUEUE_RANGE.step}
            value={queue.desiredMs}
            onChange={(e) => update({ desiredQueueLevelMs: parseInt(e.target.value, 10) })}
            className="slider" disabled={disabled}
          />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>{max}</span>
            <span className="setting-value">{(queue.maxMs / 1000).toFixed(1)}s</span>
          </div>
          <input
            type="range" aria-label={max}
            min={maxQueueFloor(queue.desiredMs)} max={MAX_QUEUE_RANGE.max} step={MAX_QUEUE_RANGE.step}
            value={queue.maxMs}
            onChange={(e) => update({ maxQueueLevelMs: parseInt(e.target.value, 10) })}
            className="slider" disabled={disabled}
          />
        </div>
        <div className="setting-item">
          <div className="setting-label">
            <span>{tempo}</span>
          </div>
          <OnOff label={tempo} value={settings.autoTempo} onChange={(autoTempo) => update({ autoTempo })} disabled={disabled} />
        </div>
      </div>
    </>
  );
}
```

Create `src/providers/palabraai/PalabraTurnDetection.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { SettingsProps } from '../../lib/provider/types';
import { effectiveThreshold, SILENCE_THRESHOLD_RANGE, type PalabraSettings as S } from './settings';

/** One line, existing words only: the VAD heading and the silence threshold a session sends. */
export function PalabraTurnDetectionSummary({ settings }: SettingsProps<S>) {
  const { t } = useTranslation();
  return <>{`${t('settings.vadSettings', 'VAD Settings')} · ${t('settings.silenceThreshold', 'Silence Threshold')}: ${effectiveThreshold(settings).toFixed(2)}s`}</>;
}

/**
 * Palabra's one knob of its automatic segmentation (its `TurnDetection`
 * Controls): the old silence threshold slider (`ProviderSpecificSettings.tsx:1323-1340`)
 * under the VAD heading, its floor 0.3 — the API refuses less (ruling 10).
 * The Provider tab draws it in every turn mode: under push-to-talk it is
 * also how soon a released sentence closes. No `Help`: the old slider had
 * no tooltip.
 */
export function PalabraTurnDetectionControls({ settings, update, disabled = false }: SettingsProps<S>) {
  const { t } = useTranslation();
  const label = t('settings.silenceThreshold', 'Silence Threshold');
  const value = effectiveThreshold(settings);
  return (
    <div className="settings-section" id="palabra-vad-section">
      <h2>{t('settings.vadSettings', 'VAD Settings')}</h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>{label}</span>
          <span className="setting-value">{value.toFixed(2)}s</span>
        </div>
        <input
          type="range" aria-label={label}
          min={SILENCE_THRESHOLD_RANGE.min} max={SILENCE_THRESHOLD_RANGE.max} step={SILENCE_THRESHOLD_RANGE.step}
          value={value}
          onChange={(e) => update({ segmentConfirmationSilenceThreshold: parseFloat(e.target.value) })}
          className="slider" disabled={disabled}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run them.**

Run: `npx vitest run src/providers/palabraai/PalabraSettings.test.tsx src/providers/palabraai/PalabraTurnDetection.test.tsx`
Expected: PASS — 2 files, 8 tests.

- [ ] **Step 5: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/palabraai/PalabraSettings.tsx src/providers/palabraai/PalabraSettings.test.tsx src/providers/palabraai/PalabraTurnDetection.tsx src/providers/palabraai/PalabraTurnDetection.test.tsx
```

```bash
git commit -q -F - -- src/providers/palabraai/PalabraSettings.tsx src/providers/palabraai/PalabraSettings.test.tsx src/providers/palabraai/PalabraTurnDetection.tsx src/providers/palabraai/PalabraTurnDetection.test.tsx <<'EOF'
feat(palabraai): Palabra AI's settings view and silence threshold

The old block's voice, speech processing and audio buffer in their old
order, the max buffer's floor following the target; the threshold under
the VAD heading from 0.3 s. No English-only tooltip, no new locale key.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```


---

### Task 11: Messages become segments (Wave 4)

**Files:**
- Create: `src/providers/palabraai/items.ts`
- Test: `src/providers/palabraai/items.test.ts`

**Interfaces:**
- Consumes: `AdapterEvents`, `Ref` (`src/lib/contract/adapter`); `tileSpan` (Task 2, `src/lib/contract/ranges`); `OutputAudio`, `Transcription` (`./wire`, types only); in the test, `decodeMessage`, `transcriptionOf`, `outputAudioOf` (`./wire`) and `SERVER`, `JA`, `EN`, `SENTENCE` (`./testing`).
- Produces: `PalabraItems` — `constructor(events)`, `sourcePartial(t)`, `sourceFinal(t)`, `translationPartial(t)`, `translationFinal(t)`, `audio(a, pcm)`, `stop()` (choice 12). The adapter hands it each message in order, and frames it itself.

- [ ] **Step 1: Write the failing test.** Create `src/providers/palabraai/items.test.ts` — each case feeds the probe's frames through the wire's readers, as the adapter does:

```ts
import { describe, it, expect } from 'vitest';
import type { AdapterEvents, SessionContext } from '../../lib/contract/adapter';
import { checkConformance } from '../../lib/contract/conformance';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { PalabraItems } from './items';
import { EN, JA, SENTENCE, SERVER } from './testing';
import { decodeMessage, outputAudioOf, transcriptionOf } from './wire';

const AUTO: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };

function items() {
  const { events, log } = recordEvents();
  const it = new PalabraItems(events);
  /** Feeds a server frame as the adapter does: decoded, then the kind's reader. */
  const feed = (frame: string, pcm?: Int16Array) => {
    const m = decodeMessage(frame);
    if (m.type === 'partial_transcription') it.sourcePartial(transcriptionOf(m.data));
    else if (m.type === 'validated_transcription') it.sourceFinal(transcriptionOf(m.data));
    else if (m.type === 'partial_translated_transcription') it.translationPartial(transcriptionOf(m.data));
    else if (m.type === 'translated_transcription') it.translationFinal(transcriptionOf(m.data));
    else if (m.type === 'output_audio_data') it.audio(outputAudioOf(m.data), pcm ?? new Int16Array(4_800));
  };
  /** The payloads of one kind of event, in order. */
  const of = <K extends AdapterEvent['kind']>(kind: K): Array<Parameters<AdapterEvents[K]>[0]> =>
    log.filter((e) => e.kind === kind).map((e) => e.payload as Parameters<AdapterEvents[K]>[0]);
  return { items: it, log, feed, of };
}

describe("Palabra AI's segments: one sentence, one id (survey §2.8)", () => {
  it("makes a sentence as the owner's probe saw it: the source grows and closes, its translation follows under the same origin", () => {
    const h = items();
    h.feed(SERVER.partial('リ'));
    h.feed(SERVER.partial('リアルタイム'));
    // A partial that says the same again is no new text.
    h.feed(SERVER.partial('リアルタイム'));
    h.feed(SERVER.validated());
    h.feed(SERVER.translated());
    expect(h.log.filter((e) => e.kind !== 'audio')).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: SENTENCE } },
      { kind: 'segmentText', payload: { ref: 1, text: 'リ', language: 'ja' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'リアルタイム', language: 'ja' } },
      { kind: 'segmentText', payload: { ref: 1, text: JA, language: 'ja' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: SENTENCE } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: SENTENCE } },
      { kind: 'segmentText', payload: { ref: 2, text: EN } },
      { kind: 'segmentClosed', payload: { ref: 2, origin: SENTENCE } },
    ]);
  });

  it("tiles the translation over its burst once the last chunk is in, by sample count (ruling 6)", () => {
    const h = items();
    h.feed(SERVER.validated());
    h.feed(SERVER.translated());
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.audio(), new Int16Array(4_800));
    expect(h.of('speechRanges')).toEqual([]);
    h.feed(SERVER.audio({ last: true }), new Int16Array(2_400));
    expect(h.of('audio').map((a) => [a.ref, a.pcm.length, a.range])).toEqual([[2, 4_800, undefined], [2, 4_800, undefined], [2, 2_400, undefined]]);
    const [filled] = h.of('speechRanges');
    expect(filled.ref).toBe(2);
    expect(filled.ranges.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(filled.ranges[0].range[0]).toBe(0);
    expect(filled.ranges[2].range[1]).toBe(EN.length);
    // 4 800 : 4 800 : 2 400 of the text.
    expect(filled.ranges.map((r) => r.range)).toEqual([[0, 33], [33, 66], [66, EN.length]]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('opens the translation empty for speech that comes before its text, and fills its ranges once the text is final', () => {
    const h = items();
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.audio({ last: true }), new Int16Array(4_800));
    expect(h.log.slice(0, 2)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'translation', origin: SENTENCE } },
      { kind: 'audio', payload: { pcm: expect.any(Int16Array), ref: 1 } },
    ]);
    expect(h.of('speechRanges')).toEqual([]);
    h.feed(SERVER.translated('Hello there.'));
    expect(h.of('speechRanges')).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 12] }] }]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it("puts a text's part and its audio's on one translation, the text's a number and the audio's a string (the owner's probe)", () => {
    const h = items();
    h.feed(SERVER.translated());
    h.feed(SERVER.audio({ part: '0', last: true }));
    expect(h.of('segmentOpened')).toHaveLength(1);
    expect(h.of('audio')[0].ref).toBe(1);
  });

  it('gives each part of a sentence its own translation under the one origin; its last chunk ends them all, each filled once final', () => {
    const h = items();
    h.feed(SERVER.translated('First part.', SENTENCE, 0));
    h.feed(SERVER.audio({ part: '0' }), new Int16Array(4_800));
    h.feed(SERVER.audio({ part: '1' }), new Int16Array(4_800));
    h.feed(SERVER.audio({ part: '1', last: true }), new Int16Array(4_800));
    h.feed(SERVER.translated('Second part.', SENTENCE, 1));
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'translation', origin: SENTENCE },
      { ref: 2, side: 'translation', origin: SENTENCE },
    ]);
    expect(h.of('speechRanges')).toEqual([
      { ref: 1, ranges: [{ index: 0, range: [0, 11] }] },
      { ref: 2, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 12] }] },
    ]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('plays a chunk that comes after the ranges were filled, rangeless; an empty last chunk ends the burst with no entry', () => {
    const h = items();
    h.feed(SERVER.translated('Hi.'));
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.audio({ last: true }), new Int16Array(0));
    expect(h.of('audio')).toHaveLength(1);
    expect(h.of('speechRanges')).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 3] }] }]);
    h.feed(SERVER.audio({ last: true }), new Int16Array(4_800));
    expect(h.of('audio')).toHaveLength(2);
    expect(h.of('speechRanges')).toHaveLength(1);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('ignores a partial after its final, and a final said twice', () => {
    const h = items();
    h.feed(SERVER.validated());
    h.feed(SERVER.partial('late'));
    h.feed(SERVER.validated('again'));
    h.feed(SERVER.translated());
    h.feed(SERVER.translationPartial('late'));
    h.feed(SERVER.translated('again'));
    expect(h.of('segmentText').map((t) => t.text)).toEqual([JA, EN]);
    expect(h.of('segmentClosed')).toHaveLength(2);
  });

  it('streams a partial translation into the translation it then closes (translate partials on)', () => {
    const h = items();
    h.feed(SERVER.translationPartial('Welcome'));
    h.feed(SERVER.translated());
    expect(h.of('segmentText')).toEqual([{ ref: 1, text: 'Welcome' }, { ref: 1, text: EN }]);
    expect(h.of('segmentClosed')).toEqual([{ ref: 1, origin: SENTENCE }]);
  });

  it('gives a final with no id a segment of its own, paired with nothing; drops a partial with no id; plays audio with no id on no segment', () => {
    const h = items();
    const bare = (type: string, transcription: Record<string, unknown>) => JSON.stringify({ message_type: type, data: { transcription } });
    h.feed(bare('partial_transcription', { text: 'lost' }));
    h.feed(bare('validated_transcription', { text: 'Alone.', language: 'en' }));
    h.feed(bare('translated_transcription', { text: 'Seul.' }));
    h.feed(JSON.stringify({ message_type: 'output_audio_data', data: { last_chunk: true, data: '' } }), new Int16Array(240));
    expect(h.log).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'Alone.', language: 'en' } },
      { kind: 'segmentClosed', payload: { ref: 1 } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'Seul.' } },
      { kind: 'segmentClosed', payload: { ref: 2 } },
      { kind: 'audio', payload: { pcm: expect.any(Int16Array) } },
    ]);
  });

  it('keeps sentences apart: two in flight at once pair each with its own', () => {
    const h = items();
    h.feed(SERVER.partial('一つ目', 'a'));
    h.feed(SERVER.partial('二つ目', 'b'));
    h.feed(SERVER.validated('一つ目。', 'a'));
    h.feed(SERVER.translated('Second.', 'b'));
    h.feed(SERVER.validated('二つ目。', 'b'));
    h.feed(SERVER.translated('First.', 'a'));
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'a' },
      { ref: 2, side: 'source', origin: 'b' },
      { ref: 3, side: 'translation', origin: 'b' },
      { ref: 4, side: 'translation', origin: 'a' },
    ]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('says nothing once stopped', () => {
    const h = items();
    h.feed(SERVER.partial('リ'));
    h.items.stop();
    h.feed(SERVER.validated());
    h.feed(SERVER.translated());
    h.feed(SERVER.audio({ last: true }));
    expect(h.log).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/providers/palabraai/items.test.ts`
Expected: FAIL — `Failed to resolve import "./items" from "src/providers/palabraai/items.test.ts"`.

- [ ] **Step 3: Write the machine.** Create `src/providers/palabraai/items.ts`:

```ts
/**
 * Palabra's messages become segments (survey §2.8; ruling 6). One sentence
 * is one `transcription_id`, on all four of its text messages and on every
 * chunk of its speech (the owner's probe): the origin that pairs each
 * translation with its source, stated. A source opens at its first partial
 * and closes when validated; a translation — one per `translation_part_id`
 * — opens at its first text or its first audio, whichever comes first, and
 * closes at its final text. A sentence's speech arrives as a burst after
 * its text, ending at `last_chunk`: once both are in, the text is tiled
 * over the chunks by their sample counts (`speechRanges`, Soniox's fill-in),
 * so karaoke lights a sentence once its burst is whole. Pure and
 * timer-free: the adapter hands it what the server said, in order, and
 * frames it.
 */
import type { AdapterEvents, Ref } from '../../lib/contract/adapter';
import { tileSpan } from '../../lib/contract/ranges';
import type { OutputAudio, Transcription } from './wire';

interface Source { ref: Ref; text: string; closed: boolean }

interface Translation {
  ref: Ref;
  sentence: string;
  text: string;
  closed: boolean;
  /** The sample count of each chunk of speech emitted for this ref, in order: the entries `speechRanges` names by index. */
  samples: number[];
  /** Its sentence's last chunk has come: no more speech is expected. */
  spoken: boolean;
  /** Its ranges are filled in: a chunk after that plays with none. */
  ranged: boolean;
}

/** The first part when a message names none: the probe's every sentence was part 0. */
const FIRST_PART = '0';

export class PalabraItems {
  private nextRef = 1;
  private readonly sources = new Map<string, Source>();
  private readonly translations = new Map<string, Translation>();
  private stopped = false;

  constructor(private readonly events: AdapterEvents) {}

  /** A partial transcription: the sentence's source opened, and its whole text so far. Ignored once the sentence is validated, and without an id (none was ever seen). */
  sourcePartial(t: Transcription): void {
    if (this.stopped || t.id === undefined) return;
    const source = this.source(t.id);
    if (source.closed) return;
    this.sourceText(source, t);
  }

  /** A validated transcription: the sentence's final text, and its source closed — once. With no id, a source of its own, paired with nothing. */
  sourceFinal(t: Transcription): void {
    if (this.stopped) return;
    if (t.id === undefined) {
      const ref = this.nextRef++;
      this.events.segmentOpened({ ref, side: 'source' });
      this.events.segmentText({ ref, text: t.text, ...(t.language ? { language: t.language } : {}) });
      this.events.segmentClosed({ ref });
      return;
    }
    const source = this.source(t.id);
    if (source.closed) return;
    this.sourceText(source, t);
    source.closed = true;
    this.events.segmentClosed({ ref: source.ref, origin: t.id });
  }

  /** A partial translation (only with `translate_partial_transcriptions` on): its whole text so far. Ignored once final, and without an id. */
  translationPartial(t: Transcription): void {
    if (this.stopped || t.id === undefined) return;
    const translation = this.translation(t.id, t.part ?? FIRST_PART);
    if (translation.closed) return;
    this.translationText(translation, t.text);
  }

  /** A translated transcription: the part's final text, and its translation closed — once. With no id, a translation of its own, paired with nothing. */
  translationFinal(t: Transcription): void {
    if (this.stopped) return;
    if (t.id === undefined) {
      const ref = this.nextRef++;
      this.events.segmentOpened({ ref, side: 'translation' });
      this.events.segmentText({ ref, text: t.text });
      this.events.segmentClosed({ ref });
      return;
    }
    const translation = this.translation(t.id, t.part ?? FIRST_PART);
    if (translation.closed) return;
    this.translationText(translation, t.text);
    translation.closed = true;
    this.events.segmentClosed({ ref: translation.ref, origin: t.id });
    this.fill(translation);
  }

  /**
   * A chunk of speech, on its part's translation — opened empty when no
   * text came first, so audio never waits for a segment. Its sentence's
   * last chunk ends the speech of every part of it; each fills in its
   * ranges once its text is final too. A chunk with no id plays with no
   * segment. An empty chunk emits nothing, and still ends a burst.
   */
  audio(a: Pick<OutputAudio, 'id' | 'part' | 'last'>, pcm: Int16Array): void {
    if (this.stopped) return;
    if (a.id === undefined) {
      if (pcm.length > 0) this.events.audio({ pcm });
      return;
    }
    const translation = this.translation(a.id, a.part ?? FIRST_PART);
    if (pcm.length > 0) {
      this.events.audio({ pcm, ref: translation.ref });
      if (!translation.ranged) translation.samples.push(pcm.length);
    }
    if (!a.last) return;
    for (const t of this.translations.values()) {
      if (t.sentence !== a.id || t.samples.length === 0 || t.spoken) continue;
      t.spoken = true;
      this.fill(t);
    }
  }

  /** Nothing more is emitted: the leg has ended. */
  stop(): void {
    this.stopped = true;
  }

  private source(id: string): Source {
    let source = this.sources.get(id);
    if (!source) {
      source = { ref: this.nextRef++, text: '', closed: false };
      this.sources.set(id, source);
      this.events.segmentOpened({ ref: source.ref, side: 'source', origin: id });
    }
    return source;
  }

  private sourceText(source: Source, t: Transcription): void {
    if (t.text === source.text) return;
    source.text = t.text;
    // The language the server heard: under an `auto` source, what the row's badge and the fill-in read (ruling 8).
    this.events.segmentText({ ref: source.ref, text: t.text, ...(t.language ? { language: t.language } : {}) });
  }

  private translation(id: string, part: string): Translation {
    const key = `${id}\u0000${part}`;
    let translation = this.translations.get(key);
    if (!translation) {
      translation = { ref: this.nextRef++, sentence: id, text: '', closed: false, samples: [], spoken: false, ranged: false };
      this.translations.set(key, translation);
      this.events.segmentOpened({ ref: translation.ref, side: 'translation', origin: id });
    }
    return translation;
  }

  private translationText(translation: Translation, text: string): void {
    if (text === translation.text) return;
    translation.text = text;
    this.events.segmentText({ ref: translation.ref, text });
  }

  /** The part's text tiled over its chunks by sample count, once its burst is whole and its text final (ruling 6): the entries in order, 0 first. */
  private fill(t: Translation): void {
    if (t.ranged || !t.spoken || !t.closed || t.samples.length === 0 || t.text.length === 0) return;
    t.ranged = true;
    const ranges = tileSpan([0, t.text.length], t.samples, t.text);
    this.events.speechRanges({ ref: t.ref, ranges: ranges.map((range, index) => ({ index, range })) });
  }
}
```

- [ ] **Step 4: Run it.**

Run: `npx vitest run src/providers/palabraai/items.test.ts src/lib/contract/ranges.test.ts`
Expected: PASS — 2 files, 15 tests.

- [ ] **Step 5: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/palabraai/items.ts src/providers/palabraai/items.test.ts
```

```bash
git commit -q -F - -- src/providers/palabraai/items.ts src/providers/palabraai/items.test.ts <<'EOF'
feat(palabraai): Palabra AI's messages as segments, paired by sentence

One source and a translation per part under each transcription_id; audio
on its part's translation, opened empty when it comes first; the text
tiled over a sentence's chunks by sample count once its burst is whole.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

### Task 12: The readiness check (Wave 4)

**Files:**
- Create: `src/providers/palabraai/check.ts`
- Test: `src/providers/palabraai/check.test.ts`

**Interfaces:**
- Consumes: `boundedFetch` (`src/lib/provider/boundedFetch`); `realClock`, `Clock` (`src/lib/contract/clock`); `CheckContext`, `CheckResult` (`src/lib/provider/types`); `restHeaders`, `restWords`, `SESSIONS_URL` (`./wire`); `PalabraCredentials`, `PalabraSettings` (`./settings`).
- Produces: `CHECK_TIMEOUT_MS` (15 000), `PalabraCheckDeps { fetch?, clock? }`, `createPalabraCheck(deps?)`, `checkPalabra` (choice 16).

- [ ] **Step 1: Write the failing test.** Create `src/providers/palabraai/check.test.ts` — self-contained: its stubs answer `Response` objects, and it imports no fixture:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import type { CheckContext } from '../../lib/provider/types';
import { CHECK_TIMEOUT_MS, createPalabraCheck } from './check';
import { PALABRA_DEFAULTS, type PalabraCredentials } from './settings';
import { SESSIONS_URL } from './wire';

const KEY: Extract<PalabraCredentials, { kind: 'apiKey' }> = { kind: 'apiKey', apiKey: 'plbr_checkKey0123456789abcdef' };
const APP: PalabraCredentials = { kind: 'app', clientId: 'check-client-id', clientSecret: 'check-client-secret' };
const ctx = (signal?: AbortSignal): CheckContext => ({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const check = (fetch: typeof globalThis.fetch, k: PalabraCredentials = KEY) => createPalabraCheck({ fetch, clock: createVirtualClock(0) })(k, PALABRA_DEFAULTS, ctx());

/** A fetch stub that rejects once its request's `signal` aborts, with the signal's reason, as a real `fetch` does. */
function abortableFetchStub() {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
    });
  });
  return { fetch, aborted: () => !!signal?.aborted };
}

/** A virtual clock whose cancel functions are spied: a settled check proves its timer was cancelled, not merely left to fire. */
function spiedClock(): { clock: Pick<Clock, 'setTimeout'>; advance: (ms: number) => void; cancels: ReturnType<typeof vi.fn>[] } {
  const inner = createVirtualClock(0);
  const cancels: ReturnType<typeof vi.fn>[] = [];
  return {
    clock: { setTimeout: (fn, ms) => { const spy = vi.fn(inner.setTimeout(fn, ms)); cancels.push(spy); return spy; } },
    advance: inner.advance,
    cancels,
  };
}

describe("Palabra AI's check (ruling 1)", () => {
  it('lists the REST sessions with the key as a Bearer token, or the app pair as its headers — never in the URL', async () => {
    const fetch = vi.fn(async () => json({ ok: true, data: [] }));
    await check(fetch);
    await check(fetch, APP);
    const [[url, init], [, appInit]] = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(url).toBe(SESSIONS_URL);
    expect(url).not.toContain(KEY.apiKey);
    expect(init).toMatchObject({ method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${KEY.apiKey}` } });
    expect(appInit.headers).toEqual({ Accept: 'application/json', ClientId: 'check-client-id', ClientSecret: 'check-client-secret' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers ready for a list, whatever it holds: it reads nothing of it and creates nothing', async () => {
    await expect(check(vi.fn(async () => json({ ok: true, data: [{ id: 'x' }] })))).resolves.toEqual({ ok: true });
    await expect(check(vi.fn(async () => new Response('', { status: 200 })))).resolves.toEqual({ ok: true });
  });

  it("answers refused credentials not ready with the auth code and Palabra's own words (401, 403)", async () => {
    const fetch = vi.fn(async () => json({ ok: false, errors: [{ title: 'Unauthorized', detail: 'Invalid API key.' }] }, 401));
    await expect(check(fetch)).resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 401: Invalid API key.' });
    const forbidden = vi.fn(async () => json({ errors: [{ title: 'Forbidden resource' }] }, 403));
    await expect(check(forbidden, APP)).resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 403: Forbidden resource' });
    const bare = vi.fn(async () => new Response('', { status: 401 }));
    await expect(check(bare)).resolves.toEqual({ ok: false, code: 'auth', reason: 'HTTP 401: Palabra did not accept these credentials.' });
  });

  it('answers a rate limit with its code', async () => {
    await expect(check(vi.fn(async () => json({}, 429)))).resolves.toEqual({ ok: false, code: 'rate_limit', reason: 'HTTP 429: Palabra is limiting requests.' });
  });

  it("throws on a status the credentials do not explain, or a failed fetch: it could not find out", async () => {
    await expect(check(vi.fn(async () => json({}, 500)))).rejects.toThrow('Palabra answered the credential check with HTTP 500.');
    await expect(check(vi.fn(async () => json({}, 404)))).rejects.toThrow('Palabra answered the credential check with HTTP 404.');
    const offline = new TypeError('Failed to fetch');
    await expect(check(vi.fn(async () => { throw offline; }))).rejects.toBe(offline);
  });

  it('bounds its request: still pending at 14 999 ms, the late words at 15 000 ms, the request aborted', async () => {
    const { clock, advance } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const answer = createPalabraCheck({ fetch, clock })(KEY, PALABRA_DEFAULTS, ctx());
    const settled = vi.fn();
    answer.then(settled, settled);
    advance(CHECK_TIMEOUT_MS - 1);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    advance(1);
    await expect(answer).rejects.toThrow('Palabra did not answer the credential check within 15 s.');
    expect(aborted()).toBe(true);
  });

  it("aborts with the caller's signal, cancels its timer, and throws the caller's reason before a request when already aborted", async () => {
    const { clock, cancels } = spiedClock();
    const { fetch, aborted } = abortableFetchStub();
    const caller = new AbortController();
    const reason = new Error('superseded');
    const answer = createPalabraCheck({ fetch, clock })(KEY, PALABRA_DEFAULTS, ctx(caller.signal));
    caller.abort(reason);
    await expect(answer).rejects.toBe(reason);
    expect(aborted()).toBe(true);
    expect(cancels[0]).toHaveBeenCalled();
    const never = vi.fn();
    await expect(createPalabraCheck({ fetch: never, clock })(KEY, PALABRA_DEFAULTS, ctx(AbortSignal.abort(reason)))).rejects.toBe(reason);
    expect(never).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run: `npx vitest run src/providers/palabraai/check.test.ts`
Expected: FAIL — `Failed to resolve import "./check" from "src/providers/palabraai/check.test.ts"`.

- [ ] **Step 3: Write the check.** Create `src/providers/palabraai/check.ts`:

```ts
/**
 * Palabra AI's readiness (spec: "Readiness is one check"; ruling 1): the
 * REST session list the old validation read (`PalabraAIClient.ts:215-273`),
 * with the credentials of either mode in its headers. It creates nothing
 * and bills nothing. Not the socket: a wrong key there is a bare 403 on the
 * upgrade, which a browser sees only as a failed socket (the owner's probe).
 * Bounded by `CHECK_TIMEOUT_MS` and the caller's signal; a status the
 * credentials do not explain, or a failed fetch, throws — the store answers
 * "could not find out", where the old called every failure a bad key. The
 * settings side: not reached by the adapter, so it may use the real clock
 * by default.
 */
import { realClock, type Clock } from '../../lib/contract/clock';
import { boundedFetch } from '../../lib/provider/boundedFetch';
import type { CheckContext, CheckResult } from '../../lib/provider/types';
import type { PalabraCredentials, PalabraSettings } from './settings';
import { restHeaders, restWords, SESSIONS_URL } from './wire';

/** As long as every other provider's check waits. */
export const CHECK_TIMEOUT_MS = 15_000;

export interface PalabraCheckDeps {
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'setTimeout'>;
}

export function createPalabraCheck(deps: PalabraCheckDeps = {}) {
  const clock = deps.clock ?? realClock;
  return (k: PalabraCredentials, _s: PalabraSettings, ctx: CheckContext): Promise<CheckResult> => {
    // Read at call time, so a test's stubbed global is seen.
    const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const late = `Palabra did not answer the credential check within ${CHECK_TIMEOUT_MS / 1000} s.`;
    return boundedFetch({ clock, ms: CHECK_TIMEOUT_MS, signal: ctx.signal, late }, async (signal): Promise<CheckResult> => {
      const response = await doFetch(SESSIONS_URL, { method: 'GET', headers: { Accept: 'application/json', ...restHeaders(k) }, signal });
      if (response.ok) return { ok: true };
      const body: unknown = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', reason: restWords(response.status, body, 'Palabra did not accept these credentials.') };
      if (response.status === 429) return { ok: false, code: 'rate_limit', reason: restWords(response.status, body, 'Palabra is limiting requests.') };
      throw new Error(`Palabra answered the credential check with HTTP ${response.status}.`);
    });
  };
}

export const checkPalabra = createPalabraCheck();
```

- [ ] **Step 4: Run it.**

Run: `npx vitest run src/providers/palabraai/check.test.ts`
Expected: PASS — 1 file, 7 tests.

- [ ] **Step 5: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/palabraai/check.ts src/providers/palabraai/check.test.ts
```

```bash
git commit -q -F - -- src/providers/palabraai/check.ts src/providers/palabraai/check.test.ts <<'EOF'
feat(palabraai): Palabra AI's readiness is one bounded REST list

The REST session list with either mode's credentials, as the old
validation read it: ready on 2xx, the credentials' words on 401/403 and
429, and anything else "could not find out", bounded at 15 s.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```


---

### Task 13: The adapter (Wave 5)

**Files:**
- Create: `src/providers/palabraai/adapter.ts` (replacing Task 8's seed), `src/providers/palabraai/adapter.test.ts`
- Modify: `src/providers/palabraai/testing.ts` (the harness appended; its imports), `src/providers/sessionSide.consistency.test.ts` (after `:256`, the Realtime pin: Palabra's session side pinned)

**Interfaces:**
- Consumes: `AdapterStartError`, `SAMPLE_RATE`, `Adapter`, `AdapterEvents`, `AdapterSession`, `StartRequest` (`src/lib/contract/adapter`, `input` gone — Task 3); `every` (`src/lib/contract/clock`); `framePayload`; `base64ToPcm` (`src/lib/contract/pcm64`); `nativeSocket`, `WS_OPEN`, `OpenSocket` (Task 1, `src/lib/contract/socket`); `describeCause`; `CHUNK_MS`, `IDLE_MS`, `Rechunker`, `SILENCE` (`./audioIn`); `PalabraItems` (`./items`); the wire's readers and builders (`./wire`); `PalabraConfig`, `PalabraCredentials` as types. In the tests, Task 5's kit and Task 7's `runLifecycles`.
- Produces:
  - `adapter.ts`: `START_TIMEOUT_MS` (20 000), `POLL_MS` (2 100), `ERROR_WORDS_MS` (10 000), `RELEASE_TIMEOUT_MS` (5 000), `REFUSED_UPGRADE`, `OFFLINE`, `NEVER_OPENED`, `RATE_LIMITED`, `PalabraAdapterDeps { openSocket, fetch, newId, online }`, `createPalabraAdapter(deps?): Adapter<PalabraConfig, PalabraCredentials>` — one leg, `info.transport` `'websocket'`;
  - `testing.ts`: `startPalabra(o?)` (a leg started over `FakeSocket`s and the fake REST server on a tracked clock) and `livePalabra(o?)` (the same, opened, the task set and found running).

The leg, in the order it lives (choices 6–9):
- **Constructed:** the start's bound (`START_TIMEOUT_MS`) and the abort listener are armed before anything opens; the platform key dials `directUrl(newId(), k)` at once; the app pair frames `session.create` and POSTs the create on the create's own signal and bound, then dials `sessionUrl(created)` — the leg is `creating`, then `opening`.
- **Opened:** frames `session.opened { path }`, sends `set_task` (framed `task.set` only once it went up), and asks `get_task` `POLL_MS` later and every `POLL_MS` after, each framed `task.get` — a `NOT_FOUND` answer framed `task.not_found` — until `current_task` says `running`: the start resolves with no content, and the leg is `live` with one timer — the beat (`every(clock, CHUNK_MS)`).
- **Live:** `appendAudio` cuts 320 ms chunks (no frame per chunk); the beat carries silence once `IDLE_MS` has passed without audio (choice 7); `endTurn` / `cancelTurn` under manual turns send what waits at once, padded (`turn.flush`), and the leg is idle from the next beat, its silence bounded by the stream's own clock; the server's messages go to `PalabraItems`, each framed; `output_audio_data` plays on a leg that speaks; an `error` is kept for the close that may follow it; `VOICE_NOT_FOUND` degrades once (`voice_fallback`).
- **Ended** — by `stop()`, a refusal or a close: `shutDown` stops the beat and the poll, stops the items, nulls the socket's four handlers and closes it 1000, and sends the REST session's delete — all before any `await`; nothing is framed after. A create still in flight is not aborted: it lands on its own bound, and the session it made is deleted then (choice 9).

- [ ] **Step 1: Write the failing tests.** Append the harness to `src/providers/palabraai/testing.ts`:

```diff
--- a/src/providers/palabraai/testing.ts
+++ b/src/providers/palabraai/testing.ts
@@ -8,7 +8,13 @@
  * and holds it to that), and the adapter's session walk never reaches it.
  */
 import type { SessionContext } from '../../lib/contract/adapter';
+import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
+import { base64ToPcm } from '../../lib/contract/pcm64';
+import { flush } from '../../lib/contract/testing/drive';
+import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
+import { trackedClock } from '../../lib/contract/testing/trackedClock';
 import type { SharedSettings } from '../../lib/provider/types';
+import { createPalabraAdapter, POLL_MS } from './adapter';
 import { buildPalabra, type PalabraConfig } from './config';
 import { PALABRA_DEFAULTS, type PalabraCredentials, type PalabraSettings } from './settings';
 
@@ -204,3 +210,45 @@
     answer: () => { for (const go of held.splice(0)) go(); },
   };
 }
+
+/** A Palabra leg started over `FakeSocket`s and the fake REST server, on a tracked virtual clock; nothing opened yet. The platform key's socket exists at once; the app pair's once its create is answered (a flush). */
+export function startPalabra(o: {
+  context?: SessionContext;
+  patch?: Partial<PalabraSettings>;
+  credentials?: PalabraCredentials;
+  rest?: Parameters<typeof fakeRest>[0];
+  online?: boolean;
+} = {}) {
+  const sockets = fakeSockets();
+  const rest = fakeRest(o.rest);
+  const { clock, timers } = trackedClock();
+  const { events, log } = recordEvents();
+  const controller = new AbortController();
+  const context = o.context ?? AUTO_CTX;
+  const config = configFor(context, o.patch);
+  const adapter = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: rest.fetch, newId: () => 'test-hash', online: () => o.online ?? true });
+  const starting = adapter.start({ context, config, credentials: o.credentials ?? KEY, clock, signal: controller.signal }, events);
+  const socket = () => sockets.last();
+  const of = <K extends AdapterEvent['kind']>(kind: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === kind);
+  /** The payloads of the frames of one type, in order. */
+  const frames = (type: string) => of('frame').filter((e) => e.payload.type === type).map((e) => e.payload.payload);
+  /** What the client sent on the leg's socket, parsed. */
+  const sent = () => socket().sentJson<{ message_type: string; data: Record<string, unknown> }>();
+  /** The pcm of every chunk sent, in order. */
+  const appended = () => sent().filter((m) => m.message_type === 'input_audio_data').map((m) => base64ToPcm(m.data.data as string));
+  /** The log without its frames: what L1 folds. */
+  const content = () => log.filter((e) => e.kind !== 'frame');
+  return { sockets, rest, clock, timers, log, controller, config, starting, socket, of, frames, sent, appended, content };
+}
+
+/** Started, opened, the task set and found running: the start resolved. */
+export async function livePalabra(o?: Parameters<typeof startPalabra>[0]) {
+  const h = startPalabra(o);
+  // The app pair's socket waits for its create's answer.
+  await flush();
+  h.socket().open();
+  h.clock.advance(POLL_MS);
+  h.socket().receive(SERVER.currentTask());
+  const session = await h.starting;
+  return { ...h, session };
+}
```

Create `src/providers/palabraai/adapter.test.ts` — the kit's scenarios in both modes, the seeded lifecycles in both modes, and a case per rule, among them a create the leg outlives in both timings (its answer in, its body unread; its answer still out), a late answer and an in-time answer that name only an id, a create that never answers, a release idle at once — ended or cancelled — forty presses that never run the stream ahead of real time, a wall clock stepped back, and `task.not_found`; every case scans what it emitted for the credentials:

```ts
/**
 * Palabra AI's adapter: the conformance suite and the seeded lifecycles in
 * both credential modes, the two ways in and the start's refusals in
 * words, the audio going up and the idle rule, the messages to segments,
 * failures, and stop with a REST session's delete. On `FakeSocket`, a fake
 * REST server and a virtual clock — no network, no fake timers.
 */
import { describe, it, expect, vi } from 'vitest';
import { AdapterStartError, SAMPLE_RATE, type AdapterEvents } from '../../lib/contract/adapter';
import { createVirtualClock, type Clock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { flush, type ScenarioStep } from '../../lib/contract/testing/drive';
import { fakeSockets } from '../../lib/contract/testing/fakeSocket';
import { runLifecycles, type LifecycleHarness } from '../../lib/contract/testing/lifecycle';
import { runScenario, scenarioNames, type AdapterHarness } from '../../lib/contract/testing/scenarios';
import {
  createPalabraAdapter, ERROR_WORDS_MS, NEVER_OPENED, OFFLINE, POLL_MS, RATE_LIMITED, REFUSED_UPGRADE, RELEASE_TIMEOUT_MS, START_TIMEOUT_MS,
} from './adapter';
import { CHUNK_MS, CHUNK_SAMPLES, IDLE_MS } from './audioIn';
import type { PalabraConfig } from './config';
import type { PalabraCredentials } from './settings';
import {
  APP, AUTO_CTX, configFor, EN, fakeRest, JA, KEY, livePalabra, MANUAL_CTX, PUBLISHER, SENTENCE, SERVER, SESSION_ID, SESSION_WS_URL, startPalabra,
} from './testing';
import { directUrl, sessionDeleteUrl, setTask } from './wire';

/** A capture chunk: 2 048 samples of 24 kHz voice, 85.3 ms. */
const chunk = (fill = 1_000) => new Int16Array(2_048).fill(fill);
const isSilent = (pcm: Int16Array) => pcm.every((s) => s === 0);
/** What no frame, failure or refusal may carry: the key, the app pair, and a REST session's tokens. */
const SECRETS = [KEY.apiKey, APP.clientId, APP.clientSecret, PUBLISHER, SESSION_ID, 'token='];
const noSecret = (value: unknown) => {
  const text = JSON.stringify(value, (_k, v: unknown) => (v instanceof Int16Array ? `pcm(${v.length})` : v instanceof Error ? v.message : v));
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};

function harness(credentials: PalabraCredentials): AdapterHarness<PalabraConfig, PalabraCredentials> {
  let sockets = fakeSockets();
  let rest = fakeRest();
  const last = () => sockets.last();
  const reply = (frame: () => string): ScenarioStep => ({ run: () => last().receive(frame()) });
  return {
    adapter: createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: (input, init) => rest.fetch(input, init), newId: () => 'test-hash', online: () => true }),
    config: (context) => { sockets = fakeSockets(); rest = fakeRest(); return configFor(context); },
    credentials,
    // The app pair's socket waits for its create's answer: the first flush lets it land.
    opening: () => [{ flush: true }, { run: () => last().open() }, { advance: POLL_MS }, reply(() => SERVER.currentTask()), { flush: true }],
    exchange: [
      reply(() => SERVER.partial('リアルタイム')),
      reply(() => SERVER.validated()),
      reply(() => SERVER.translated()),
      reply(() => SERVER.audio()),
      reply(() => SERVER.audio({ last: true })),
    ],
    serverClose: [{ run: () => last().serverClose(1011, 'Internal error') }, { flush: true }],
    refuse: [{ flush: true }, { run: () => last().drop() }, { flush: true }],
  };
}

describe('the Palabra AI adapter: conformance', () => {
  for (const [mode, credentials] of [['the platform key', KEY], ['the app pair', APP]] as const) {
    const h = harness(credentials);

    it(`runs every scenario but typed text and reconnecting, which Palabra has neither of (${mode})`, () => {
      expect(scenarioNames(h)).toEqual(['open-stop', 'speech-off', 'abort-while-opening', 'refused-while-opening', 'manual-end', 'manual-cancel', 'server-close']);
    });

    it.each(scenarioNames(h))(`%s (${mode})`, async (name) => {
      const report = await runScenario(h, name);
      expect(report.violations).toEqual([]);
      expect(report.problems).toEqual([]);
    });
  }
});

describe('the Palabra AI adapter: the seeded lifecycles (ruling 15)', () => {
  /** The adapter's lives as the kit plays them, over a REST server that may refuse the create; the app pair's sessions are checked deleted, each once. */
  function lifecycles(credentials: PalabraCredentials): LifecycleHarness<PalabraConfig, PalabraCredentials> {
    let rest = fakeRest();
    let created = false;
    return {
      adapter: (run) => {
        const create = run.rand() < 0.1 ? run.pick([401, 429, 500, 'offline'] as const) : 'ok';
        created = create === 'ok';
        rest = fakeRest({ create });
        return createPalabraAdapter({ openSocket: (url) => run.sockets.create(url), fetch: rest.fetch, newId: () => `run-${run.index}`, online: () => true });
      },
      config: (context) => configFor(context),
      credentials,
      secrets: SECRETS,
      textInput: false,
      startBoundMs: START_TIMEOUT_MS,
      opening: async (run) => {
        // The app pair's socket waits for its create's answer.
        await flush();
        const socket = run.sockets.all[run.sockets.all.length - 1];
        if (!socket) return;
        const r = run.rand();
        // A refused upgrade; or nothing at all, and the kit runs the start's bound out.
        if (r < 0.04) return socket.drop();
        if (r < 0.07) return;
        socket.open();
        if (r < 0.1) return socket.receive(SERVER.thresholdRefused());
        if (r < 0.12) return socket.serverClose(1008);
        run.clock.advance(POLL_MS);
        if (r < 0.2) {
          socket.receive(SERVER.notFound());
          run.clock.advance(POLL_MS);
        }
        socket.receive(SERVER.currentTask(r < 0.22 ? 'paused' : 'running'));
      },
      server: (run) => {
        const socket = run.sockets.all[run.sockets.all.length - 1];
        if (!socket || socket.readyState !== 1) return;
        const r = run.rand();
        const id = run.pick(['s1', 's2', 's3']);
        if (r < 0.2) socket.receive(SERVER.partial(run.pick(['リ', 'リアル', 'リアルタイム']), id));
        else if (r < 0.35) socket.receive(SERVER.validated(JA, id));
        else if (r < 0.5) socket.receive(SERVER.translated(run.pick([EN, 'Hi.', '']), id, run.pick([0, 1])));
        else if (r < 0.72) socket.receive(SERVER.audio({ id, part: run.pick(['0', '1']), last: run.rand() < 0.3, samples: run.pick([0, 2_400, 4_800]) }));
        else if (r < 0.76) socket.receive(SERVER.voiceNotFound());
        else if (r < 0.79) socket.receive(SERVER.warning('AUDIO_STREAM_STALLED', 'The stream stalled.'));
        else if (r < 0.82) socket.receive(SERVER.serviceTimeout());
        else if (r < 0.84) socket.receive('not json');
        else if (r < 0.86) socket.receive(JSON.stringify({ message_type: 'output_audio_data', data: { transcription_id: id, data: 7 } }));
        else if (r < 0.88) socket.receive(SERVER.bare('session_heartbeat'));
        else if (r < 0.9) socket.receive(SERVER.endOfStream());
        else if (r < 0.93) socket.receive(SERVER.notFound());
        else socket.serverClose(run.pick([1000, 1008, 1011]));
      },
      after: () => {
        if (credentials.kind === 'apiKey') return rest.calls.length > 0 ? ['the platform key made a REST call'] : [];
        const problems: string[] = [];
        const deletes = rest.of('DELETE');
        if (deletes.length !== (created ? 1 : 0)) problems.push(`${deletes.length} session delete(s) where ${created ? 1 : 0} was due`);
        for (const d of deletes) {
          if (d.url !== sessionDeleteUrl(SESSION_ID) || d.keepalive !== true || d.headers.ClientId !== APP.clientId) problems.push('a delete that was not our own session\'s, with its credentials and keepalive');
        }
        return problems;
      },
    };
  }

  // 300 lives each, about a second alone: the bound is for a loaded machine.
  it('the platform key: every life settles, ends clean, and leaves no timer, socket or REST call behind', async () => {
    const report = await runLifecycles(lifecycles(KEY), { seed: 20260929, runs: 300 });
    expect(report.failures).toEqual([]);
    for (const key of ['refused', 'live', 'stopped', 'end.failed.connection_lost', 'end.failed.rate_limit', 'end.failed.server']) expect(report.stats[key], key).toBeGreaterThan(0);
  }, 20_000);

  it("the app pair: the same, and every REST session created is deleted, once", async () => {
    const report = await runLifecycles(lifecycles(APP), { seed: 20260930, runs: 300 });
    expect(report.failures).toEqual([]);
    for (const key of ['refused', 'live', 'stopped', 'end.failed.connection_lost']) expect(report.stats[key], key).toBeGreaterThan(0);
  }, 20_000);
});

describe('the Palabra AI adapter: the platform key goes straight in (ruling 1)', () => {
  it('dials the streaming endpoint with the key in its query, reads binary frames as ArrayBuffers, and makes no REST call', async () => {
    const h = startPalabra();
    expect(h.socket().url).toBe(directUrl('test-hash', KEY));
    expect(h.socket().binaryType).toBe('arraybuffer');
    expect(h.rest.calls).toEqual([]);
    h.socket().open();
    expect(h.frames('session.opened')).toEqual([{ path: 'key' }]);
    // The task goes up at once, framed as sent; the URL, the key, never.
    expect(h.sent()).toEqual([setTask(h.config)]);
    expect(h.frames('task.set')).toEqual([setTask(h.config).data]);
    noSecret(h.log);
  });

  it('a socket that fails before it opens reads as the key, online — a wrong key is a bare 403 on the upgrade — and as the network offline', async () => {
    const online = startPalabra();
    online.socket().drop();
    await expect(online.starting).rejects.toMatchObject({ code: 'auth', message: REFUSED_UPGRADE });
    expect(REFUSED_UPGRADE).toBe('Palabra refused the connection before it opened: check the API key.');
    expect(online.content()).toEqual([]);
    expect(online.timers()).toBe(0);
    const offline = startPalabra({ online: false });
    offline.socket().drop();
    await expect(offline.starting).rejects.toMatchObject({ code: 'network', message: OFFLINE });
  });
});

describe('the Palabra AI adapter: the app pair goes through a REST session of its own (ruling 1)', () => {
  it("creates a session with the pair's headers, dials its address with the publisher token, and frames neither token", async () => {
    const h = startPalabra({ credentials: APP });
    expect(h.sockets.all).toEqual([]);
    expect(h.rest.calls).toMatchObject([{ method: 'POST', url: 'https://api.palabra.ai/session-storage/session', body: '{"data":{"intent":"api"}}' }]);
    expect(h.rest.calls[0].headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json', ClientId: APP.clientId, ClientSecret: APP.clientSecret });
    await flush();
    expect(h.socket().url).toBe(`${SESSION_WS_URL}?token=${PUBLISHER}`);
    h.socket().open();
    expect(h.frames('session.create')).toEqual([undefined]);
    expect(h.frames('session.created')).toEqual([{ status: 201 }]);
    expect(h.frames('session.opened')).toEqual([{ path: 'session' }]);
    noSecret(h.log);
  });

  it.each([
    [401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [500, 'server'], [400, 'client'],
  ] as const)("a create refused with %i rejects the start in Palabra's words, as %s, and opens nothing", async (status, code) => {
    const h = startPalabra({ credentials: APP, rest: { create: status } });
    await expect(h.starting).rejects.toMatchObject({ code, message: `HTTP ${status}: Refused with ${status}.` });
    expect(h.sockets.all).toEqual([]);
    expect(h.frames('session.create_failed')).toEqual([{ status, message: `HTTP ${status}: Refused with ${status}.` }]);
    expect(h.rest.of('DELETE')).toEqual([]);
    expect(h.timers()).toBe(0);
  });

  it('a create that never reached Palabra reads as the network, offline or not', async () => {
    const online = startPalabra({ credentials: APP, rest: { create: 'offline' } });
    await expect(online.starting).rejects.toMatchObject({ code: 'network', message: "Palabra's session service could not be reached." });
    const offline = startPalabra({ credentials: APP, rest: { create: 'offline' }, online: false });
    await expect(offline.starting).rejects.toMatchObject({ code: 'network', message: OFFLINE });
  });

  it("the session's socket failing before it opens reads as the network — its token is fresh — and the session is deleted", async () => {
    const h = startPalabra({ credentials: APP });
    await flush();
    h.socket().drop();
    await expect(h.starting).rejects.toMatchObject({ code: 'network', message: NEVER_OPENED });
    await flush();
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: { ClientId: APP.clientId, ClientSecret: APP.clientSecret } }]);
  });

  it('a create the leg outlives still lands, and the session it made is deleted, never dialled — its answer in or still out when the start is cancelled (choice 9)', async () => {
    const reason = new Error('cancelled');
    // The answer in, its body unread: the body is read on the create's own signal, which the leg's end does not abort.
    const read = startPalabra({ credentials: APP });
    read.controller.abort(reason);
    await expect(read.starting).rejects.toBe(reason);
    await flush();
    expect(read.sockets.all).toEqual([]);
    expect(read.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: { ClientId: APP.clientId, ClientSecret: APP.clientSecret } }]);
    expect(read.timers()).toBe(0);

    // The answer still out: the create is not aborted, its own bound the one timer left; it lands later, and its session goes.
    const out = startPalabra({ credentials: APP, rest: { create: 'later' } });
    out.controller.abort(reason);
    await expect(out.starting).rejects.toBe(reason);
    expect(out.rest.calls[0].signal?.aborted).toBe(false);
    expect(out.timers()).toBe(1);
    out.rest.answer();
    await flush();
    expect(out.sockets.all).toEqual([]);
    expect(out.rest.of('DELETE')).toHaveLength(1);
    expect(out.frames('session.created')).toEqual([]);
    expect(out.timers()).toBe(0);
  });

  /** An app-pair leg whose create answers with the session's id and nothing else; the delete goes to a fake server that records it. */
  function idOnly() {
    const rest = fakeRest();
    const fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> =>
      init.method === 'POST' ? Promise.resolve(new Response(JSON.stringify({ ok: true, data: { id: SESSION_ID } }), { status: 201 })) : rest.fetch(input, init);
    const sockets = fakeSockets();
    const clock = createVirtualClock(0);
    const controller = new AbortController();
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: APP, clock, signal: controller.signal },
      recordEvents().events,
    );
    return { rest, sockets, clock, controller, starting };
  }

  it('a late create is deleted by its id alone: an answer that names no publisher or socket address is still deleted, exactly once (choice 9)', async () => {
    const h = idOnly();
    h.controller.abort(new Error('cancelled'));
    await expect(h.starting).rejects.toThrow('cancelled');
    await flush();
    expect(h.sockets.all).toEqual([]);
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: { ClientId: APP.clientId, ClientSecret: APP.clientSecret } }]);
    h.clock.advance(RELEASE_TIMEOUT_MS * 2);
    await flush();
    expect(h.rest.of('DELETE')).toHaveLength(1);
  });

  it('an answer in time that names its id but no socket to reach is refused, and the session it names deleted, exactly once (choice 9)', async () => {
    const h = idOnly();
    await expect(h.starting).rejects.toMatchObject({ code: 'server', message: 'Palabra answered the session request without a socket to reach.' });
    await flush();
    expect(h.sockets.all).toEqual([]);
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true }]);
    h.clock.advance(RELEASE_TIMEOUT_MS * 2);
    await flush();
    expect(h.rest.of('DELETE')).toHaveLength(1);
  });

  it("a create that never answers is given the start's bound from its send, then abandoned: nothing opens, nothing is left to delete", async () => {
    const h = startPalabra({ credentials: APP, rest: { create: 'hang' } });
    h.controller.abort(new Error('cancelled'));
    await expect(h.starting).rejects.toThrow('cancelled');
    h.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(h.rest.calls[0].signal?.aborted).toBe(false);
    h.clock.advance(1);
    await flush();
    expect(h.rest.calls[0].signal?.aborted).toBe(true);
    expect(h.sockets.all).toEqual([]);
    expect(h.rest.of('DELETE')).toEqual([]);
    expect(h.timers()).toBe(0);
  });
});

describe('the Palabra AI adapter: the start resolves when the task runs (ruling 4)', () => {
  it('asks 2.1 s after the task went up and every 2.1 s after, never sooner, through NOT_FOUND — framed as the expected answer it is, not red (choice 8) — and resolves on running with no content and one timer: the beat', async () => {
    const h = startPalabra();
    let resolved = false;
    void h.starting.then(() => { resolved = true; });
    h.socket().open();
    const asks = () => h.sent().filter((m) => m.message_type === 'get_task').length;
    h.clock.advance(POLL_MS - 1);
    expect(asks()).toBe(0);
    h.clock.advance(1);
    expect(asks()).toBe(1);
    expect(h.sent()[1]).toEqual({ message_type: 'get_task', data: { exclude_hidden: true } });
    h.socket().receive(SERVER.notFound());
    h.clock.advance(POLL_MS - 1);
    expect(asks()).toBe(1);
    h.clock.advance(1);
    expect(asks()).toBe(2);
    h.socket().receive(SERVER.currentTask('paused'));
    await flush();
    expect(resolved).toBe(false);
    h.socket().receive(SERVER.currentTask());
    const session = await h.starting;
    expect(session.info).toEqual({ transport: 'websocket' });
    expect(h.frames('task.get')).toEqual([undefined, undefined]);
    expect(h.frames('task.current')).toEqual([{ status: 'paused' }, { status: 'running' }]);
    expect(h.frames('task.not_found')).toEqual([undefined]);
    expect(h.frames('session.error')).toEqual([]);
    expect(h.content()).toEqual([]);
    expect(h.timers()).toBe(1);
    h.clock.advance(POLL_MS * 3);
    expect(asks()).toBe(2);
  });

  it("a task Palabra refuses rejects the start in its words, as the request's, and closes the socket", async () => {
    const h = startPalabra({ credentials: APP });
    await flush();
    h.socket().open();
    h.socket().receive(SERVER.thresholdRefused());
    await expect(h.starting).rejects.toMatchObject({
      code: 'client',
      message: '[Palabra VALIDATION_ERROR] segment_confirmation_silence_threshold: ensure this value is greater than or equal to 0.3',
    });
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.content()).toEqual([]);
    await flush();
    // The session made for it is deleted, and the delete's bound goes with its answer.
    expect(h.rest.of('DELETE')).toHaveLength(1);
    expect(h.timers()).toBe(0);
  });

  it('bounds the start at 20 s on the request\'s clock: the network when the socket never opened, the service when it did', async () => {
    const never = startPalabra();
    never.clock.advance(START_TIMEOUT_MS);
    await expect(never.starting).rejects.toMatchObject({ code: 'network', message: 'Palabra did not open the connection within 20 s.' });
    expect(never.socket().closedByClient).not.toBeNull();
    expect(never.timers()).toBe(0);

    const silent = startPalabra();
    let settled = false;
    void silent.starting.catch(() => { settled = true; });
    silent.socket().open();
    silent.clock.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    silent.clock.advance(1);
    await expect(silent.starting).rejects.toMatchObject({ code: 'server', message: 'Palabra did not start the task within 20 s.' });
    expect(silent.timers()).toBe(0);
  });

  it('a close after the socket opened, before the task runs: 1008 is the connection limit, anything else the service', async () => {
    const limited = startPalabra();
    limited.socket().open();
    limited.socket().serverClose(1008);
    await expect(limited.starting).rejects.toMatchObject({ code: 'rate_limit', message: RATE_LIMITED });
    const closed = startPalabra();
    closed.socket().open();
    closed.socket().serverClose(1011, 'boom');
    await expect(closed.starting).rejects.toMatchObject({ code: 'server', message: 'Palabra closed the connection before the task started (1011 boom).' });
    expect(closed.frames('session.connection_lost')).toEqual([{ code: 1011, reason: 'boom' }]);
  });

  it('an abort while opening rejects with its reason and closes the socket; a start already aborted opens nothing', async () => {
    const h = startPalabra();
    h.socket().open();
    const reason = new Error('cancelled');
    h.controller.abort(reason);
    await expect(h.starting).rejects.toBe(reason);
    expect(h.socket().closedByClient).not.toBeNull();
    expect(h.timers()).toBe(0);

    const sockets = fakeSockets();
    const rest = fakeRest();
    const controller = new AbortController();
    controller.abort(reason);
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: rest.fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: APP, clock: createVirtualClock(0), signal: controller.signal },
      recordEvents().events,
    );
    await expect(starting).rejects.toBe(reason);
    expect(sockets.all).toEqual([]);
    expect(rest.calls).toEqual([]);
  });

  it("a browser that will not open the socket rejects in fixed words, never its own, which quote the key — and the app pair's session is deleted", async () => {
    const refusing = (url: string): WebSocket => { throw new DOMException(`Failed to construct 'WebSocket': The URL '${url}' is invalid.`, 'SyntaxError'); };
    for (const credentials of [KEY, APP]) {
      const rest = fakeRest();
      const { events, log } = recordEvents();
      const starting = createPalabraAdapter({ openSocket: refusing, fetch: rest.fetch }).start(
        { context: AUTO_CTX, config: configFor(), credentials, clock: createVirtualClock(0), signal: new AbortController().signal },
        events,
      );
      const error = await starting.then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AdapterStartError);
      expect(error).toMatchObject({ code: 'network', message: 'The browser would not open the socket (SyntaxError).' });
      expect((error as AdapterStartError).cause).toBeUndefined();
      noSecret([error, log]);
      await flush();
      expect(rest.of('DELETE')).toHaveLength(credentials === APP ? 1 : 0);
    }
  });
});

describe('the Palabra AI adapter: audio up (rulings 3, 5)', () => {
  it('sends 320 ms chunks, each as it fills, and frames none of them (the hot-path rule)', async () => {
    const h = await livePalabra();
    for (let i = 0; i < 4; i++) h.session.appendAudio(chunk(i + 1));
    // 8 192 samples: one chunk of 7 680, 512 waiting.
    expect(h.appended().map((p) => p.length)).toEqual([CHUNK_SAMPLES]);
    expect(Array.from(h.appended()[0].subarray(2_046, 2_050))).toEqual([1, 1, 2, 2]);
    expect(h.of('frame').filter((f) => f.payload.direction === 'out').map((f) => f.payload.type)).toEqual(['task.set', 'task.get']);
  });

  it('carries real-time silence once no audio has come for 500 ms: what waits first, padded, then one chunk a beat — never ahead of the clock', async () => {
    const h = await livePalabra();
    const liveAt = h.clock.now();
    h.session.appendAudio(chunk());
    // The beat runs every 320 ms from the start; the idle begins at the first beat 500 ms after the last audio.
    h.clock.advance(CHUNK_MS);
    expect(h.appended()).toEqual([]);
    h.clock.advance(CHUNK_MS);
    expect(h.appended().map((p) => [p.length, isSilent(p)])).toEqual([[CHUNK_SAMPLES, false]]);
    expect(Array.from(h.appended()[0].subarray(2_046, 2_050))).toEqual([1_000, 1_000, 0, 0]);
    expect(h.frames('audio.idle')).toEqual([{ sinceMs: 2 * CHUNK_MS }]);
    h.clock.advance(CHUNK_MS);
    expect(h.appended().slice(1).map((p) => [p.length, isSilent(p)])).toEqual([[CHUNK_SAMPLES, true]]);
    // A minute of idle: one chunk a beat, never more than the time allows.
    h.clock.advance(60_000);
    const sentMs = h.appended().length * CHUNK_MS;
    expect(sentMs).toBeLessThanOrEqual(h.clock.now() - liveAt);
    expect(h.frames('audio.idle')).toHaveLength(1);
  });

  it('resumed audio starts a chunk of its own, framed once; the beats then send nothing while audio keeps coming — no silence spliced into speech', async () => {
    const h = await livePalabra();
    h.clock.advance(IDLE_MS + CHUNK_MS);
    const idleChunks = h.appended().length;
    expect(idleChunks).toBeGreaterThan(0);
    // Speech again, one worklet chunk every 85 ms, for 2 s.
    for (let t = 0; t < 2_000; t += 85) {
      h.session.appendAudio(chunk(7));
      h.clock.advance(85);
    }
    const speech = h.appended().slice(idleChunks);
    expect(speech.length).toBe(Math.floor((24 * 2_048) / CHUNK_SAMPLES));
    for (const p of speech) expect(p.every((s) => s === 7)).toBe(true);
    expect(h.frames('audio.resumed')).toHaveLength(1);
  });

  it("waits past the ScriptProcessor fallback's 341 ms chunks: its gaps are no idle", async () => {
    const h = await livePalabra();
    for (let i = 0; i < 20; i++) {
      h.session.appendAudio(new Int16Array(8_192).fill(3));
      h.clock.advance(341);
    }
    expect(h.frames('audio.idle')).toEqual([]);
    for (const p of h.appended()) expect(p.every((s) => s === 3)).toBe(true);
  });

  it('under push-to-talk a release sends what waits at once, padded to a chunk; an empty press too; the idle silence follows', async () => {
    const h = await livePalabra({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.appended().map((p) => [p.length, p[0], p[CHUNK_SAMPLES - 1]])).toEqual([[CHUNK_SAMPLES, 1_000, 0]]);
    expect(h.frames('turn.flush')).toEqual([{ ms: Math.round((2_048 * 1000) / SAMPLE_RATE) }]);
    h.session.beginTurn();
    h.session.cancelTurn();
    expect(h.frames('turn.flush')[1]).toEqual({ ms: 0, cancelled: true });
    h.clock.advance(IDLE_MS + CHUNK_MS);
    expect(h.appended().slice(1).every(isSilent)).toBe(true);
    expect(h.appended().length).toBeGreaterThan(1);
  });

  it('a release is idle from the next beat, not 500 ms after the last audio: silence follows the padded remainder at once; the next press resumes (choice 7)', async () => {
    const h = await livePalabra({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    expect(h.appended()).toHaveLength(1);
    // The next beat, 320 ms on: the runner sends no audio between presses, so it is silence at once.
    h.clock.advance(CHUNK_MS);
    expect(h.appended().slice(1).map(isSilent)).toEqual([true]);
    expect(h.frames('audio.idle')).toEqual([{ sinceMs: CHUNK_MS }]);
    // The next press's audio ends the idle, and the beats stop sending while it comes.
    h.session.beginTurn();
    h.session.appendAudio(chunk(5));
    expect(h.frames('audio.resumed')).toHaveLength(1);
    const before = h.appended().length;
    h.clock.advance(CHUNK_MS);
    expect(h.appended()).toHaveLength(before);
  });

  it('a cancelled release is idle from the next beat too: the runner sends no audio after either (choice 7)', async () => {
    const h = await livePalabra({ context: MANUAL_CTX });
    h.session.beginTurn();
    h.session.cancelTurn();
    expect(h.frames('turn.flush')).toEqual([{ ms: 0, cancelled: true }]);
    expect(h.appended()).toEqual([]);
    h.clock.advance(CHUNK_MS);
    expect(h.appended().map(isSilent)).toEqual([true]);
    expect(h.frames('audio.idle')).toEqual([{ sinceMs: CHUNK_MS }]);
  });

  it('push-to-talk never runs the stream ahead of real time: over 40 presses, what went up is at most a chunk past the time elapsed (choice 7)', async () => {
    const h = await livePalabra({ context: MANUAL_CTX });
    const liveAt = h.clock.now();
    // A capture chunk every 85⅓ ms: 85, 85 and 86 ms in turn.
    const steps = [85, 85, 86];
    let step = 0;
    // Every chunk that goes up is 320 ms, whatever it holds; counted without decoding it.
    const lead = () => h.socket().sent.filter((d) => typeof d === 'string' && d.startsWith('{"message_type":"input_audio_data"')).length * CHUNK_MS - (h.clock.now() - liveAt);
    let most = -Infinity;
    for (let press = 0; press < 40; press++) {
      h.session.beginTurn();
      for (let k = 0; k < 14; k++) {
        h.session.appendAudio(chunk());
        h.clock.advance(steps[step++ % 3]);
      }
      h.session.endTurn();
      most = Math.max(most, lead());
      // An idle of 0.7–1.0 s, its phase against the beat varied.
      const idle = 700 + ((press * 37) % 320);
      for (let t = 0; t < idle; t += 40) {
        h.clock.advance(40);
        most = Math.max(most, lead());
      }
    }
    expect(lead()).toBeLessThanOrEqual(CHUNK_MS);
    // A release's padded remainder may add a chunk the silence did not: never two.
    expect(most).toBeLessThan(2 * CHUNK_MS);
  });

  it('a wall clock stepped back rebases the idle rule: the silence starts 500 ms after the step, not after the size of the jump (choice 7)', async () => {
    // A clock whose `now()` the test sets, its timers on a virtual clock: `realClock.now()` is `Date.now()`, which the system may move.
    let now = 50_000;
    const inner = createVirtualClock(0);
    const stepped: Clock = { now: () => now, setTimeout: (fn, ms) => inner.setTimeout(fn, ms) };
    const beat = () => { now += CHUNK_MS; inner.advance(CHUNK_MS); };
    const sockets = fakeSockets();
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: fakeRest().fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: stepped, signal: new AbortController().signal },
      recordEvents().events,
    );
    sockets.last().open();
    now += POLL_MS;
    inner.advance(POLL_MS);
    sockets.last().receive(SERVER.currentTask());
    const session = await starting;
    const audio = () => sockets.last().sentJson<{ message_type: string }>().filter((m) => m.message_type === 'input_audio_data');
    session.appendAudio(chunk());
    // Ten seconds back: without the rebase, the silence would wait ten seconds more — long enough for SERVICE_TIMEOUT.
    now -= 10_000;
    for (let i = 0; i < 4; i++) beat();
    // The first beat after the step rebases; the third is the first 500 ms past it: what waits, padded, then silence.
    expect(audio()).toHaveLength(2);
  });

  it('under automatic turns a release sends nothing of its own', async () => {
    const h = await livePalabra();
    h.session.appendAudio(chunk());
    h.session.endTurn();
    h.session.cancelTurn();
    expect(h.appended()).toEqual([]);
    expect(h.frames('turn.flush')).toEqual([]);
  });
});

describe("the Palabra AI adapter: a sentence's messages", () => {
  it("makes the probe's sentence into a source and its translation, paired by its id, the speech ranged once its burst is whole (ruling 6)", async () => {
    const h = await livePalabra();
    h.socket().receive(SERVER.partial('リアルタイム'));
    h.socket().receive(SERVER.validated());
    h.socket().receive(SERVER.translated());
    h.socket().receive(SERVER.audio());
    h.socket().receive(SERVER.audio({ last: true, samples: 2_859 }));
    expect(h.of('segmentOpened').map((e) => e.payload)).toEqual([
      { ref: 1, side: 'source', origin: SENTENCE },
      { ref: 2, side: 'translation', origin: SENTENCE },
    ]);
    expect(h.of('audio').map((e) => [e.payload.ref, e.payload.pcm.length])).toEqual([[2, 4_800], [2, 2_859]]);
    expect(h.of('speechRanges').map((e) => e.payload)).toEqual([{ ref: 2, ranges: [{ index: 0, range: [0, 51] }, { index: 1, range: [51, EN.length] }] }]);
    expect(h.frames('transcription.partial')).toEqual([{ id: SENTENCE, text: 'リアルタイム', start: 0.32, end: 5.66 }]);
    expect(h.frames('transcription.validated')).toEqual([{ id: SENTENCE, language: 'ja', text: JA, start: 0.32, end: 5.66 }]);
    expect(h.frames('translation.final')).toEqual([{ id: SENTENCE, part: '0', language: 'en', text: EN }]);
    expect(h.frames('audio.output')).toEqual([{ id: SENTENCE, part: '0', last: false, samples: 4_800 }, { id: SENTENCE, part: '0', last: true, samples: 2_859 }]);
  });

  it('on a leg that does not speak, frames the speech it gets anyway and plays none of it (ruling 7)', async () => {
    const h = await livePalabra({ context: { ...AUTO_CTX, speech: false } });
    expect(h.sent()[0]).toMatchObject({ data: { output_stream: null } });
    h.socket().receive(SERVER.translated());
    h.socket().receive(SERVER.audio({ last: true }));
    expect(h.of('audio')).toEqual([]);
    expect(h.frames('audio.output')).toHaveLength(1);
  });

  it("says the voice fell back once, on the first VOICE_NOT_FOUND; a stream's pacing warnings are the Logs' alone (ruling 11)", async () => {
    const h = await livePalabra();
    h.socket().receive(SERVER.voiceNotFound());
    h.socket().receive(SERVER.voiceNotFound());
    h.socket().receive(SERVER.warning('AUDIO_STREAM_TOO_SLOW', 'Too slow.'));
    expect(h.of('degraded').map((e) => e.payload)).toEqual([
      { code: 'voice_fallback', message: "Palabra did not have the voice asked for, and speaks in another: Voice ID 'default_low' is not available, using default voice" },
    ]);
    expect(h.frames('session.warning')).toEqual([
      { code: 'VOICE_NOT_FOUND', message: "Voice ID 'default_low' is not available, using default voice" },
      { code: 'VOICE_NOT_FOUND', message: "Voice ID 'default_low' is not available, using default voice" },
      { code: 'AUDIO_STREAM_TOO_SLOW', message: 'Too slow.' },
    ]);
  });

  it('frames a type it does not know, and end_of_stream; says a frame that will not read once per episode, and a chunk that will not decode as its own', async () => {
    const h = await livePalabra();
    h.socket().receive(SERVER.bare('session_heartbeat'));
    h.socket().receive(SERVER.endOfStream());
    h.socket().receive('not json');
    h.socket().receive('still not json');
    h.socket().receive(JSON.stringify({ message_type: 'output_audio_data', data: { transcription_id: SENTENCE, data: 7 } }));
    h.socket().receive(SERVER.audio());
    h.socket().receive('not json again');
    expect(h.frames('session.unknown')).toEqual([{ type: 'session_heartbeat' }]);
    expect(h.frames('session.end_of_stream')).toEqual([undefined]);
    expect(h.of('degraded').map((e) => e.payload.code)).toEqual(['parse_error', 'parse_error', 'parse_error']);
    expect(h.frames('session.unreadable')).toHaveLength(3);
  });

  it('frames what comes before the task runs, and makes nothing of it', async () => {
    const h = startPalabra();
    h.socket().open();
    h.socket().receive(SERVER.validated());
    h.socket().receive(SERVER.audio({ last: true }));
    expect(h.frames('transcription.validated')).toHaveLength(1);
    expect(h.content()).toEqual([]);
  });
});

describe('the Palabra AI adapter: a session that ends (rulings 11, 12)', () => {
  it("a close within 10 s of an error reads in that error's words — SERVICE_TIMEOUT's 1008 among them — at the window's edge too", async () => {
    const h = await livePalabra();
    h.socket().receive(SERVER.serviceTimeout());
    h.clock.advance(ERROR_WORDS_MS);
    h.socket().serverClose(1008);
    await flush();
    expect(h.of('failed').map((e) => e.payload)).toEqual([
      { code: 'server', message: '[Palabra SERVICE_TIMEOUT] No input audio received for 10s. Use the pause_task command for intentional pauses.' },
    ]);
    expect(h.frames('session.error')).toEqual([{ code: 'SERVICE_TIMEOUT', desc: 'No input audio received for 10s. Use the pause_task command for intentional pauses.', msg: null, param: null }]);
  });

  it('past the window a 1008 is the connection limit, and any other close the lost connection; nothing reconnects', async () => {
    const late = await livePalabra();
    late.socket().receive(SERVER.serviceTimeout());
    late.clock.advance(ERROR_WORDS_MS + 1);
    late.socket().serverClose(1008);
    await flush();
    expect(late.of('failed').map((e) => e.payload)).toEqual([{ code: 'rate_limit', message: RATE_LIMITED }]);

    const dropped = await livePalabra();
    dropped.socket().drop();
    await flush();
    expect(dropped.of('failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to Palabra closed (1006).' }]);
    expect(dropped.sockets.all).toHaveLength(1);
    expect(dropped.timers()).toBe(0);
  });

  it('never words a close by an answer to its own ask, or by an error from a wall clock stepped back', async () => {
    const found = await livePalabra();
    found.socket().receive(SERVER.notFound());
    // After the start a NOT_FOUND is no expected answer: a red line, as any error.
    expect(found.frames('session.error')).toEqual([{ code: 'NOT_FOUND', desc: 'No active task found', msg: null, param: null }]);
    expect(found.frames('task.not_found')).toEqual([]);
    found.socket().serverClose(1011);
    await flush();
    expect(found.of('failed')[0].payload.code).toBe('connection_lost');

    // A clock whose `now()` the test sets: the error is stamped after the close it would word.
    let now = 50_000;
    const inner = createVirtualClock(0);
    const stepped: Clock = { now: () => now, setTimeout: (fn, ms) => inner.setTimeout(fn, ms) };
    const sockets = fakeSockets();
    const { events, log } = recordEvents();
    const starting = createPalabraAdapter({ openSocket: (url) => sockets.create(url), fetch: fakeRest().fetch }).start(
      { context: AUTO_CTX, config: configFor(), credentials: KEY, clock: stepped, signal: new AbortController().signal },
      events as AdapterEvents,
    );
    sockets.last().open();
    inner.advance(POLL_MS);
    sockets.last().receive(SERVER.currentTask());
    await starting;
    sockets.last().receive(SERVER.serviceTimeout());
    now = 40_000;
    sockets.last().serverClose(1011);
    await flush();
    expect(log.filter((e) => e.kind === 'failed').map((e) => e.payload)).toEqual([{ code: 'connection_lost', message: 'The connection to Palabra closed (1011).' }]);
  });

  it('an ending says failed once, then nothing; the app pair\'s session is deleted, and a later stop deletes nothing more', async () => {
    const h = await livePalabra({ credentials: APP });
    h.socket().serverClose(1011);
    await flush();
    h.socket().serverClose(1011);
    expect(h.of('failed')).toHaveLength(1);
    expect(h.rest.of('DELETE')).toHaveLength(1);
    await h.session.stop();
    expect(h.rest.of('DELETE')).toHaveLength(1);
    expect(h.timers()).toBe(0);
  });
});

describe('the Palabra AI adapter: stop (ruling 13)', () => {
  it('ends the task and closes the socket before its first await, what is in flight dropped; nothing is said after, and no timer is left', async () => {
    const h = await livePalabra();
    h.session.appendAudio(chunk());
    const logged = h.log.length;
    void h.session.stop();
    expect(h.sent().slice(-1)).toEqual([{ message_type: 'end_task', data: { force: true } }]);
    expect(h.socket().closedByClient).toEqual({ code: 1000, reason: undefined });
    await flush();
    h.clock.advance(60_000);
    expect(h.log.length).toBe(logged);
    expect(h.timers()).toBe(0);
  });

  it("the app pair's stop sends its session's delete before its first await, with keepalive, and resolves once it is answered", async () => {
    const h = await livePalabra({ credentials: APP });
    const stopping = h.session.stop();
    expect(h.rest.of('DELETE')).toMatchObject([{ url: sessionDeleteUrl(SESSION_ID), keepalive: true, headers: { ClientId: APP.clientId, ClientSecret: APP.clientSecret } }]);
    await expect(stopping).resolves.toBeUndefined();
    expect(h.timers()).toBe(0);
  });

  it('a delete that never answers is given 5 s on the request\'s clock, then the stop resolves', async () => {
    const h = await livePalabra({ credentials: APP, rest: { remove: 'hang' } });
    const done = vi.fn();
    void h.session.stop().then(done);
    h.clock.advance(RELEASE_TIMEOUT_MS - 1);
    await flush();
    expect(done).not.toHaveBeenCalled();
    h.clock.advance(1);
    await flush();
    expect(done).toHaveBeenCalled();
    expect(h.rest.of('DELETE')[0].signal?.aborted).toBe(true);
    expect(h.timers()).toBe(0);
  });
});
```

In `src/providers/sessionSide.consistency.test.ts`:

```diff
--- a/src/providers/sessionSide.consistency.test.ts
+++ b/src/providers/sessionSide.consistency.test.ts
@@ -254,6 +254,15 @@
       'src/providers/openai/socket.ts',
       'src/providers/openai/wire.ts',
     ]);
+
+    // Palabra's seam is the contract's (Stage 2 Palabra, choice 1): no `socket.ts` of its own. The builder, the check, the settings, the view, the definition and the fixtures are not the session's.
+    const palabra = sessionSide(REPO_ROOT, 'src/providers/palabraai');
+    expect(palabra).toEqual([
+      'src/providers/palabraai/adapter.ts',
+      'src/providers/palabraai/audioIn.ts',
+      'src/providers/palabraai/items.ts',
+      'src/providers/palabraai/wire.ts',
+    ]);
   });
 
   it('reads imports the way the compiler does', () => {
```

- [ ] **Step 2: Run them to see them fail.** The seed exports nothing, so the harness's `createPalabraAdapter` is undefined, and the walk from the seed finds no `audioIn.ts`, `items.ts` or `wire.ts`.

Run: `npx vitest run src/providers/palabraai/adapter.test.ts src/providers/sessionSide.consistency.test.ts`
Expected: FAIL — `adapter.test.ts` fails to collect (`TypeError: createPalabraAdapter is not a function`), and the guard's case fails (`expected [ Array(1) ] to deeply equal [ …(4) ]`: the walk from the seed finds `adapter.ts` alone); its other 7 cases pass.

- [ ] **Step 3: Write the adapter.** Replace `src/providers/palabraai/adapter.ts` with:

```ts
/**
 * Palabra AI on the new contract (spec: "L0 — the client contract"),
 * written from scratch over WebSocket — the old LiveKit client
 * (`src/services/clients/PalabraAIClient.ts`, still compiled until the
 * deletion plan) is not ported (the owner, 2026-09-29). One leg, one socket.
 * The platform key dials the streaming endpoint straight; the legacy app
 * pair first creates a REST session and dials its address with the
 * publisher token, and deletes that session — its own, no other — when the
 * leg ends (ruling 1). The start resolves once `get_task` finds the task
 * running (ruling 4). What goes up is cut into 320 ms chunks (ruling 5), and
 * a stream with no audio carries real-time silence (ruling 3). Messages
 * become segments paired by their sentence, speech ranged once its burst is
 * whole (`items.ts`; ruling 6). Every timer reads the request's clock, and
 * nothing is said but through events (CLAUDE.md, "Inside an IClient
 * session").
 */
import {
  AdapterStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { every } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { nativeSocket, WS_OPEN, type OpenSocket } from '../../lib/contract/socket';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { CHUNK_MS, IDLE_MS, Rechunker, SILENCE } from './audioIn';
import type { PalabraConfig } from './config';
import { PalabraItems } from './items';
import type { PalabraCredentials } from './settings';
import {
  CREATE_SESSION_BODY,
  CREATE_SESSION_URL,
  decodeMessage,
  directUrl,
  END_TASK,
  errorCode,
  errorOf,
  errorWords,
  GET_TASK,
  inputAudio,
  NOT_FOUND,
  outputAudioOf,
  POLICY_VIOLATION,
  readCreated,
  restHeaders,
  restWords,
  sessionDeleteUrl,
  sessionUrl,
  setTask,
  taskStatusOf,
  transcriptionOf,
  VOICE_NOT_FOUND,
  warningOf,
  type PalabraMessage,
} from './wire';

/**
 * The start's bound on the request's clock (ruling 4): twice the sum of
 * each stage's slowest time in the owner's probe — a REST create up to
 * 2.8 s, the upgrade up to 4.0 s, the task running at the first ask 2.1 s
 * later, 8.9 s in all — rounded up (choice 6).
 */
export const START_TIMEOUT_MS = 20_000;
/** Between two asks whether the task runs (ruling 4): the docs allow one `set_task` or `get_task` per 2 s, and the probe asked 2.1 s apart and was always answered (choice 6). */
export const POLL_MS = 2_100;
/** How long a mid-session `error` words the close that follows it (ruling 11): OpenAI's value; the probe's `SERVICE_TIMEOUT` closed 0.26 s after its error. */
export const ERROR_WORDS_MS = 10_000;
/** How long deleting a REST session may take (ruling 1): the spec's bound on a release. */
export const RELEASE_TIMEOUT_MS = 5_000;

/** The platform key's socket, failed before it opened while online: a wrong key is a bare 403 on the upgrade (the owner's probe), which a browser cannot see. */
export const REFUSED_UPGRADE = 'Palabra refused the connection before it opened: check the API key.';
/** A socket or a request that failed while the device is offline: it says nothing about the credentials. */
export const OFFLINE = 'The device is offline: Palabra could not be reached.';
/** The app pair's socket, failed before it opened while online: its token is seconds old, so the network or the service. */
export const NEVER_OPENED = "Palabra's socket did not open (check the network).";
/** A close 1008 with no error before it: past Palabra's connection limit (the docs). */
export const RATE_LIMITED = 'Palabra closed the connection with 1008: its limit is 20 connections a minute per key.';

export interface PalabraAdapterDeps {
  /** `new WebSocket(url)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
  /** The app pair's REST calls: the session's create and delete. */
  fetch: typeof fetch;
  /** The streaming URL's first segment for the platform key: any URL-safe string. */
  newId: () => string;
  /** False: the device is offline. */
  online: () => boolean;
}

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/** An idle beat's frame, the same every time: encoded once, not three times a second. */
let silentFrame: string | null = null;
const silence = (): string => (silentFrame ??= inputAudio(SILENCE));

/** A thrown value's name alone (`SyntaxError`, `SecurityError`), never its message: a browser that refuses a socket quotes its URL, a credential in it. */
function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown error';
}

/** A REST refusal's notice code. */
function restCode(status: number): string {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return status >= 500 ? 'server' : 'client';
}

class PalabraLeg implements AdapterSession {
  readonly info = { transport: 'websocket' };
  readonly opening: Promise<AdapterSession>;
  /** `creating` while the app pair's REST session is asked for; `opening` until the task runs; then `live`. */
  private phase: 'creating' | 'opening' | 'live' | 'ended' = 'opening';
  private socket: WebSocket | null = null;
  private opened = false;
  /** The id of the REST session this leg created: deleted when the leg ends, whichever way (ruling 1). */
  private sessionId: string | null = null;
  private releasing: Promise<void> | null = null;
  private readonly items: PalabraItems;
  private readonly chunks = new Rechunker();
  private lastAudioAt = 0;
  private idle = false;
  /** A push-to-talk release came, and no audio since: the leg is idle from the next beat (choice 7). */
  private released = false;
  /** The stream's own clock (choice 7): when it began, the wall clock at the last beat, and how much has gone up — 320 ms a chunk, whatever it holds. */
  private streamFrom = 0;
  private lastBeatAt = 0;
  private streamedMs = 0;
  private stopKeepalive: () => void = () => {};
  private cancelPoll: () => void = () => {};
  /** The last frame parsed: `session.unreadable` on the ok → failing transition only. */
  private readable = true;
  /** The last chunk of speech decoded: its own episode, since every frame that parses re-arms `readable`. */
  private audioReadable = true;
  /** `voice_fallback` said: once per session (ruling 11). */
  private voiceFellBack = false;
  /** The last mid-session `error`, and when: the words of a close that follows it closely (ruling 11). */
  private lastError: { code: string; message: string; at: number } | null = null;
  private settle: { resolve(): void; reject(error: unknown): void } | null = null;

  constructor(
    private readonly request: StartRequest<PalabraConfig, PalabraCredentials>,
    private readonly events: AdapterEvents,
    private readonly deps: PalabraAdapterDeps,
  ) {
    this.items = new PalabraItems(events);
    // The bound and the abort are armed before anything opens, so nothing can leave a socket behind (the OpenAI Realtime review's hardening).
    this.opening = new Promise<AdapterSession>((resolve, reject) => {
      const { clock, signal } = request;
      const cancelTimer = clock.setTimeout(() => this.refuse(this.opened
        ? new AdapterStartError(`Palabra did not start the task within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`Palabra did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
      const onAbort = () => this.refuse(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      const done = () => { cancelTimer(); signal.removeEventListener('abort', onAbort); };
      this.settle = {
        resolve: () => { done(); resolve(this); },
        reject: (error) => { done(); reject(error); },
      };
    });
    const { credentials } = request;
    if (credentials.kind === 'apiKey') {
      this.connect(directUrl(deps.newId(), credentials), 'key');
    } else {
      this.phase = 'creating';
      void this.create();
    }
  }

  /** Cut into 320 ms chunks as it comes (ruling 5), no frame per chunk (the hot-path rule); an idle ends here. */
  appendAudio(pcm: Int16Array): void {
    if (this.phase !== 'live') return;
    for (const chunk of this.chunks.push(pcm)) this.sendAudio(chunk);
    this.lastAudioAt = this.request.clock.now();
    this.released = false;
    if (this.idle) {
      this.idle = false;
      this.frame('out', 'audio.resumed');
    }
  }

  /** Palabra takes no typed text (`textInput: false`). */
  appendText(): void {}

  /** Nothing to mark: Palabra's own segmentation finds the speech. */
  beginTurn(): void {}

  endTurn(): void {
    this.flushTurn(false);
  }

  cancelTurn(): void {
    this.flushTurn(true);
  }

  /**
   * The close before its first `await`, what is still being translated
   * dropped (ruling 13): `end_task` best-effort, then the close; a REST
   * session's delete goes out now and is the one thing awaited, bounded.
   * Nothing is framed after a stop.
   */
  stop(): Promise<void> {
    if (this.phase === 'live') this.send(JSON.stringify(END_TASK));
    this.shutDown();
    return this.releasing ?? Promise.resolve();
  }

  /**
   * The app pair's REST session (ruling 1): created, then its own address
   * dialled with the publisher token. The create runs on its own signal,
   * bounded by `START_TIMEOUT_MS` from its send on the request's clock — not
   * the leg's: a browser rejects the body of a request aborted after its
   * answer came, so a create the leg abandoned could never be read, and the
   * session it made would outlive the leg (choice 9). A create that lands
   * after the leg ended is read for its id alone — all a delete needs — and
   * its session deleted; nothing opens.
   */
  private async create(): Promise<void> {
    this.frame('out', 'session.create');
    const controller = new AbortController();
    const cancelBound = this.request.clock.setTimeout(() => controller.abort(), START_TIMEOUT_MS);
    let response: Response;
    let body: unknown;
    try {
      response = await this.deps.fetch(CREATE_SESSION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...restHeaders(this.request.credentials) },
        body: CREATE_SESSION_BODY,
        signal: controller.signal,
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      // No answer — its own bound, or the network — after the leg ended: nothing to delete, nothing to say.
      if (this.phase !== 'creating') return;
      this.frame('in', 'session.create_failed', { message: describeCause(error) });
      this.refuse(new AdapterStartError(this.deps.online() ? "Palabra's session service could not be reached." : OFFLINE, 'network', undefined, { cause: error }));
      return;
    } finally {
      cancelBound();
    }
    // The session's id is all a delete needs: an answer that names one made a session, whatever else it lacks; one that names none has nothing to delete (choice 9).
    const named = response.ok ? (body as { data?: { id?: unknown } } | null)?.data?.id : undefined;
    const id = typeof named === 'string' && named !== '' ? named : null;
    if (this.phase !== 'creating') {
      // Made after the leg gave up: still ours to delete, and never dialled.
      if (id) {
        this.sessionId = id;
        this.release();
      }
      return;
    }
    // In time, the whole answer: the socket needs its address and the publisher token.
    const created = response.ok ? readCreated(body) : null;
    if (!response.ok) {
      const message = restWords(response.status, body, 'Palabra refused to create a session.');
      this.frame('in', 'session.create_failed', { status: response.status, message });
      this.refuse(new AdapterStartError(message, restCode(response.status)));
      return;
    }
    if (!created) {
      // Refused, and the session it names deleted by the refusal's shutDown.
      this.sessionId = id;
      this.frame('in', 'session.create_failed', { status: response.status, message: 'no socket to reach' });
      this.refuse(new AdapterStartError('Palabra answered the session request without a socket to reach.', 'server'));
      return;
    }
    // Neither the id nor the publisher is framed: both are shaped as tokens (the owner's probe).
    this.sessionId = created.id;
    this.frame('in', 'session.created', { status: response.status });
    let url: string;
    try {
      url = sessionUrl(created);
    } catch {
      this.refuse(new AdapterStartError('Palabra answered the session request with an address that is no URL.', 'server'));
      return;
    }
    this.phase = 'opening';
    this.connect(url, 'session');
  }

  private connect(url: string, path: 'key' | 'session'): void {
    let socket: WebSocket;
    try {
      socket = this.deps.openSocket(url);
    } catch (error) {
      // In fixed words and with no cause: a browser that refuses the socket quotes its URL, the key or the token in it.
      this.refuse(new AdapterStartError(`The browser would not open the socket (${errorName(error)}).`, 'network'));
      return;
    }
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => this.onOpen(path);
    socket.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    // A Logs line: the close that follows says what it did to the session.
    socket.onerror = () => this.frame('in', 'session.socket_error');
    socket.onclose = (e: CloseEvent) => this.onClose(e, path);
  }

  /** The socket opened: the task goes up, and the first ask whether it runs follows 2.1 s later (ruling 4). */
  private onOpen(path: 'key' | 'session'): void {
    if (this.phase !== 'opening') return;
    this.opened = true;
    this.frame('in', 'session.opened', { path });
    const task = setTask(this.request.config);
    if (!this.send(JSON.stringify(task))) return;
    this.frame('out', 'task.set', task.data);
    this.cancelPoll = this.request.clock.setTimeout(() => this.poll(), POLL_MS);
  }

  /** Asks whether the task runs, every 2.1 s until it does: `set_task` is not acknowledged, and `get_task` answers `NOT_FOUND` until then (ruling 4). */
  private poll(): void {
    if (this.phase !== 'opening') return;
    if (this.send(JSON.stringify(GET_TASK))) this.frame('out', 'task.get');
    this.cancelPoll = this.request.clock.setTimeout(() => this.poll(), POLL_MS);
  }

  private onMessage(data: unknown): void {
    if (this.phase === 'ended') return;
    let m: PalabraMessage;
    try {
      m = decodeMessage(data);
    } catch (error) {
      this.unreadable('frame', error);
      return;
    }
    this.readable = true;
    switch (m.type) {
      case 'current_task': return this.currentTask(m.data);
      case 'error': return this.serverError(m.data);
      case 'warning': return this.warning(m.data);
      case 'partial_transcription': {
        const t = transcriptionOf(m.data);
        this.frame('in', 'transcription.partial', { id: t.id ?? null, text: t.text, start: t.start ?? null, end: t.end ?? null });
        if (this.phase === 'live') this.items.sourcePartial(t);
        return;
      }
      case 'validated_transcription': {
        const t = transcriptionOf(m.data);
        this.frame('in', 'transcription.validated', { id: t.id ?? null, language: t.language ?? null, text: t.text, start: t.start ?? null, end: t.end ?? null });
        if (this.phase === 'live') this.items.sourceFinal(t);
        return;
      }
      case 'partial_translated_transcription': {
        const t = transcriptionOf(m.data);
        this.frame('in', 'translation.partial', { id: t.id ?? null, part: t.part ?? null, text: t.text });
        if (this.phase === 'live') this.items.translationPartial(t);
        return;
      }
      case 'translated_transcription': {
        const t = transcriptionOf(m.data);
        this.frame('in', 'translation.final', { id: t.id ?? null, part: t.part ?? null, language: t.language ?? null, text: t.text });
        if (this.phase === 'live') this.items.translationFinal(t);
        return;
      }
      case 'output_audio_data': return this.outputAudio(m.data);
      case 'end_of_stream': return this.frame('in', 'session.end_of_stream');
      default: return this.frame('in', 'session.unknown', { type: m.type });
    }
  }

  private currentTask(data: Record<string, unknown>): void {
    const status = taskStatusOf(data) ?? null;
    this.frame('in', 'task.current', { status });
    if (this.phase === 'opening' && status === 'running') this.started();
  }

  /** The task runs: the start resolves (ruling 4), and the idle rule's beat starts (ruling 3). */
  private started(): void {
    this.phase = 'live';
    this.cancelPoll();
    const now = this.request.clock.now();
    this.lastAudioAt = now;
    this.streamFrom = now;
    this.lastBeatAt = now;
    this.stopKeepalive = every(this.request.clock, CHUNK_MS, () => this.keepalive());
    const settle = this.settle;
    this.settle = null;
    settle?.resolve();
  }

  /**
   * An `error` is a red Logs line (ruling 11). Before the task runs it
   * refuses the start in Palabra's words — a `set_task` it would not take
   * (ruling 4) — except `NOT_FOUND`, the expected answer to an ask made
   * before the task runs: no failure, so framed `task.not_found`, not red
   * (choice 8). Mid-session it is kept, with its time, for the close that
   * may follow it.
   */
  private serverError(data: Record<string, unknown>): void {
    const e = errorOf(data);
    if (e.code === NOT_FOUND && this.phase === 'opening') {
      this.frame('in', 'task.not_found');
      return;
    }
    this.frame('in', 'session.error', { code: e.code ?? null, desc: e.desc ?? null, msg: e.msg ?? null, param: e.param ?? null });
    if (e.code === NOT_FOUND) return;
    const refusal = { code: errorCode(e), message: errorWords(e) };
    if (this.phase === 'opening') {
      this.refuse(new AdapterStartError(refusal.message, refusal.code));
      return;
    }
    if (this.phase === 'live') this.lastError = { ...refusal, at: this.request.clock.now() };
  }

  /** A `warning` is a Logs line; `VOICE_NOT_FOUND` is also the `voice_fallback` notice, once per session (ruling 11). The stream's pacing warnings (`AUDIO_STREAM_*`) are the Logs' alone. */
  private warning(data: Record<string, unknown>): void {
    const w = warningOf(data);
    this.frame('in', 'session.warning', { code: w.code ?? null, message: w.message ?? null });
    if (this.phase !== 'live' || w.code !== VOICE_NOT_FOUND || this.voiceFellBack) return;
    this.voiceFellBack = true;
    this.events.degraded({ code: 'voice_fallback', message: `Palabra did not have the voice asked for, and speaks in another: ${w.message ?? VOICE_NOT_FOUND}` });
  }

  /** A chunk of speech: framed by its size, never its content; played on a leg that speaks. */
  private outputAudio(data: Record<string, unknown>): void {
    const a = outputAudioOf(data);
    // No base64 string where the audio should be: the same episode as audio that will not decode, in fixed words that quote nothing of the frame.
    if (typeof a.audio !== 'string') {
      this.unreadable('audio', new Error('an audio chunk with no base64 string'));
      return;
    }
    let pcm: Int16Array;
    try {
      pcm = base64ToPcm(a.audio);
    } catch (error) {
      this.unreadable('audio', error);
      return;
    }
    this.audioReadable = true;
    this.frame('in', 'audio.output', { id: a.id ?? null, part: a.part ?? null, last: a.last, samples: pcm.length });
    // A leg that does not speak asked for text alone (`output_stream: null`, ruling 7): audio it gets anyway is not played.
    if (this.phase === 'live' && this.request.context.speech) this.items.audio(a, pcm);
  }

  /**
   * The idle rule (ruling 3). Nothing reaches the server while the
   * microphone is muted or between push-to-talk turns, and Palabra ends a
   * stream that sent no audio for 10 s — `SERVICE_TIMEOUT`, then a close
   * 1008 — and confirms a sentence only by the silence heard after it (the
   * owner's follow-up probe). Once no audio has come for `IDLE_MS`, each
   * beat sends one 320 ms chunk: first what waits, padded with silence, then
   * silence — but silence only while what has gone up since the leg went
   * live (320 ms a chunk, whatever it holds) is not ahead of the time since:
   * silence never takes the stream more than a chunk past real time, however
   * many releases pad a chunk. Audio that resumes between beats starts a
   * chunk of its own (what waited went up when the idle began), so no
   * silence is spliced into speech; the next beat finds the audio recent and
   * sends nothing. A push-to-talk release is idle from the next beat, no
   * `IDLE_MS` wait: no audio follows a release. A beat a throttled page could
   * not keep is skipped, not caught up, and a wall clock stepped back rebases
   * the wait and the stream's own clock, as `every()` rebases its grid
   * (choice 7). Framed on the transitions only.
   */
  private keepalive(): void {
    if (this.phase !== 'live') return;
    const now = this.request.clock.now();
    // A wall clock stepped back (`realClock.now()` is `Date.now()`): the stream's time since it began, and the idle wait, carry on from where they were.
    if (now < this.lastBeatAt) this.streamFrom -= this.lastBeatAt - now;
    this.lastBeatAt = now;
    if (now < this.lastAudioAt) this.lastAudioAt = now;
    const since = now - this.lastAudioAt;
    if (since < IDLE_MS && !this.released) return;
    if (!this.idle) {
      this.idle = true;
      this.frame('out', 'audio.idle', { sinceMs: since });
      const rest = this.chunks.flush();
      if (rest) {
        this.sendAudio(rest.chunk);
        return;
      }
    }
    // Never past real time: a release's padded remainder, or a chunk audio resumed inside, may already cover this beat.
    if (this.streamedMs > now - this.streamFrom) return;
    this.sendChunk(silence());
  }

  /**
   * A release, with or without speech (rulings 3, 5): what waits goes up at
   * once, padded to a chunk, and the idle rule's silence confirms the
   * sentence at the threshold — from the next beat, since the runner sends
   * no audio between presses (choice 7). Nothing on Palabra's wire ends an
   * utterance sooner: `interrupt_task` did not stop the sentence under way,
   * and delayed the next (the owner's probe). What a press sent cannot be
   * taken back.
   */
  private flushTurn(cancelled: boolean): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    const rest = this.chunks.flush();
    if (rest) this.sendAudio(rest.chunk);
    this.frame('out', 'turn.flush', { ms: rest ? Math.round((rest.samples * 1000) / SAMPLE_RATE) : 0, ...(cancelled ? { cancelled: true } : {}) });
    this.released = true;
  }

  private sendAudio(chunk: Int16Array): void {
    this.sendChunk(inputAudio(chunk));
  }

  /** A chunk up, counted on the stream's own clock when it went. */
  private sendChunk(frame: string): void {
    if (this.send(frame)) this.streamedMs += CHUNK_MS;
  }

  /** A frame, or a chunk of speech, that will not read: a Logs line, and `parse_error` on each latch's ok → failing transition only. */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    if (this.phase === 'live') this.events.degraded({ code: 'parse_error', message: `A message from Palabra could not be read: ${describeCause(error)}`, cause: error });
  }

  /** The last mid-session error, when the close follows it within `ERROR_WORDS_MS`; a negative age — a wall clock stepped back — is not recent either. */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const age = this.request.clock.now() - last.at;
    if (age < 0 || age > ERROR_WORDS_MS) return null;
    return { code: last.code, message: last.message };
  }

  /** What goes up, when the socket is open; nothing on a closed one. True when it went up: only what went up is framed. */
  private send(data: string): boolean {
    if (!this.socket || this.socket.readyState !== WS_OPEN) return false;
    this.socket.send(data);
    return true;
  }

  private onClose(e: CloseEvent, path: 'key' | 'session'): void {
    if (this.phase === 'ended') return;
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    if (this.phase !== 'live') {
      // A browser cannot see the upgrade's status: the platform key's refused upgrade is a bare 403 (the owner's probe); the app pair's token is fresh.
      const offline = !this.deps.online();
      this.refuse(this.opened
        ? e.code === POLICY_VIOLATION
          ? new AdapterStartError(RATE_LIMITED, 'rate_limit')
          : new AdapterStartError(`Palabra closed the connection before the task started (${closeWords(e)}).`, 'server')
        : offline
          ? new AdapterStartError(OFFLINE, 'network')
          : path === 'key'
            ? new AdapterStartError(REFUSED_UPGRADE, 'auth')
            : new AdapterStartError(NEVER_OPENED, 'network'));
      return;
    }
    // A close right after an error reads in its words — `SERVICE_TIMEOUT`'s 1008 among them; a bare 1008 is the connection limit; any other close, the lost connection (rulings 11, 12). Nothing reconnects.
    this.end(this.recentError() ?? (e.code === POLICY_VIOLATION
      ? { code: 'rate_limit', message: RATE_LIMITED }
      : { code: 'connection_lost', message: `The connection to Palabra closed (${closeWords(e)}).` }));
  }

  /** A start that will not resolve: rejected once, everything shut, nothing emitted but frames. */
  private refuse(error: unknown): void {
    if (this.phase === 'live' || this.phase === 'ended') return;
    this.shutDown();
    const settle = this.settle;
    this.settle = null;
    settle?.reject(error);
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(failed: { code: string; message: string }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    this.events.failed(failed);
  }

  /**
   * Every way a leg ends: nothing more emitted, the socket closed and no
   * longer heard, a REST session deleted. A create still in flight is left
   * to land on its own bound, and what it made is deleted then (choice 9):
   * its bound, and the delete's, are the only timers an ending leaves.
   */
  private shutDown(): void {
    this.phase = 'ended';
    this.stopKeepalive();
    this.cancelPoll();
    this.items.stop();
    const socket = this.socket;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState <= WS_OPEN) socket.close(1000);
    }
    this.release();
  }

  /**
   * Deletes the REST session this leg created, once (ruling 1): its own id
   * alone, bounded by `RELEASE_TIMEOUT_MS`, with `keepalive` so a page that is
   * going away still sends it. The request goes out before any `await`. Not
   * framed: it may run after the session has ended.
   */
  private release(): void {
    if (!this.sessionId || this.releasing) return;
    const controller = new AbortController();
    const cancel = this.request.clock.setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS);
    let sent: Promise<unknown>;
    try {
      sent = this.deps.fetch(sessionDeleteUrl(this.sessionId), { method: 'DELETE', headers: restHeaders(this.request.credentials), keepalive: true, signal: controller.signal });
    } catch (error) {
      sent = Promise.reject(error);
    }
    // A delete that failed leaves the session to expire on its own [inf: the docs say only that `expires_at` is extended every minute while a connection is active].
    this.releasing = sent.then(() => undefined, () => undefined).then(() => cancel());
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (this.phase === 'ended') return;
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createPalabraAdapter(deps: Partial<PalabraAdapterDeps> = {}): Adapter<PalabraConfig, PalabraCredentials> {
  const resolved: PalabraAdapterDeps = {
    openSocket: deps.openSocket ?? nativeSocket,
    // Read at call time, so a test's stubbed global is seen.
    fetch: deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)),
    newId: deps.newId ?? (() => crypto.randomUUID().replace(/-/g, '')),
    online: deps.online ?? (() => navigator.onLine !== false),
  };
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      return new PalabraLeg(request, events, resolved).opening;
    },
  };
}
```

- [ ] **Step 4: Run the folder, the guard and the kit.** The lifecycles run 300 lives in each mode (about a second each alone; the case's 20 s bound is for a loaded machine).

Run: `npx vitest run src/providers/palabraai src/providers/sessionSide.consistency.test.ts src/lib/contract`
Expected: PASS — 23 files, 243 tests.

- [ ] **Step 5: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 6: Commit.**

```bash
git add src/providers/palabraai/adapter.ts src/providers/palabraai/adapter.test.ts src/providers/palabraai/testing.ts src/providers/sessionSide.consistency.test.ts
```

```bash
git commit -q -F - -- src/providers/palabraai/adapter.ts src/providers/palabraai/adapter.test.ts src/providers/palabraai/testing.ts src/providers/sessionSide.consistency.test.ts <<'EOF'
feat(palabraai): the Palabra AI adapter over WebSocket

The platform key straight to the socket, the app pair through a REST
session of its own, deleted on every ending; a start that resolves when
the task runs, bounded at 20 s; 320 ms chunks and real-time silence while
nothing is said; Stop drops what is in flight. Conformance and 300 seeded
lives in each mode.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```


---

### Group check A (controller, after Wave 5)

Nothing is registered yet: the adapter, the check and the view are complete and unreachable.

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the replay: 569 files passed and 1 skipped, 7 287 tests passed and 2 skipped); the typecheck gate at exactly the baseline; the full tree at 259.
- [ ] `npx vitest run src/services` green: the old client and descriptor are untouched.
- [ ] `npm run build`, then `npm run extension:build`; `npx vitest run extension`.
- [ ] The three D24 greps print nothing.
- [ ] `command grep -rlF 'task.current' build extension/dist` prints nothing: the adapter is in no bundle before Task 14 registers it (the replay's builds at this point: none).
- [ ] Record the numbers in the controller's notes for Task 15.

---

### Task 14: The definition, registered (Wave 6)

**Files:**
- Create: `src/providers/palabraai/provider.ts`
- Test: `src/providers/palabraai/provider.test.ts`
- Modify: `src/providers/registry.ts` (`:14`, the import; `:19-20`, `RELEASED` and its comment), `src/providers/registry.test.ts` (the order pin, `:318-319` after Task 4), `src/components/SetupWizard/providerPaths.test.ts` (`:28`; after `:41`)

**Interfaces:**
- Consumes: everything above; `PalabraAIIcon` (`src/components/Icons/ProviderIcons`, kept).
- Produces: `palabraProvider: Provider<PalabraSettings, PalabraCredentials, PalabraConfig> & { id: 'palabraai' }` — `kind: 'own-key'`, every platform, the old id and slice, no `legacyKeys` (ruling 2), `checkReads: ['authMode']`, `speech: 'optional'` (ruling 7), `textInput: false` (parity), `boundaries: () => 'provider'`, `turns: () => ['auto', 'manual']`, today's guide URL as a literal (ruling 18); no `flagged`, `i18nKey`, `session` hooks or `participantSpeech`. `RELEASED` gains it last (ruling 14).

- [ ] **Step 1: Write the failing tests.** Create `src/providers/palabraai/provider.test.ts` — through the real provider store (its settings service mocked), an old profile loads as it was, a pre-July one opens in the platform mode, and nothing is written:

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

import { PalabraAIIcon } from '../../components/Icons/ProviderIcons';
import { createVirtualClock } from '../../lib/contract/clock';
import { recordEvents } from '../../lib/contract/events';
import { readCredentials } from '../../lib/provider/credentials';
import { AUTO } from '../../lib/provider/languages';
import { contextsFor, gate } from '../../lib/session/shape';
import type { RunShape } from '../../lib/session/types';
import { useProviderStore } from '../../stores/providerStore';
import { PROVIDERS } from '../registry';
import { buildPalabra, describePalabra, type PalabraConfig } from './config';
import { PalabraSettingsView } from './PalabraSettings';
import { PalabraTurnDetectionControls, PalabraTurnDetectionSummary } from './PalabraTurnDetection';
import { palabraProvider } from './provider';
import { migratePalabraSettings, PALABRA_DEFAULTS, palabraCredentials, palabraLanguages, type PalabraSettings } from './settings';
import { APP, AUTO_CTX, configFor, KEY, SHARED } from './testing';

const noAuth = { signedIn: false, getToken: async () => null };

afterEach(() => {
  vi.unstubAllGlobals();
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, selectionLocked: false, legs: ['speaker'], speech: { textOnly: false, participantSpeech: false } });
});

const both = (pair: { source: string; target: string }, patch: Partial<RunShape> = {}) =>
  ({ provider: palabraProvider, settings: PALABRA_DEFAULTS, pair, legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false, turnMode: 'auto', ...patch }) as unknown as RunShape;

describe('the Palabra AI definition', () => {
  it('is Palabra AI with your own credentials, on every platform, under its old id and slice, linking its setup guide', () => {
    expect(palabraProvider).toMatchObject({
      id: 'palabraai',
      kind: 'own-key',
      platforms: ['electron', 'extension', 'web'],
      icon: PalabraAIIcon,
      guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/palabraai-setup',
      settings: { key: 'palabraai', defaults: PALABRA_DEFAULTS, migrate: migratePalabraSettings },
      Settings: PalabraSettingsView,
      TurnDetection: { Summary: PalabraTurnDetectionSummary, Controls: PalabraTurnDetectionControls },
      credentials: palabraCredentials,
      checkReads: ['authMode'],
      languages: palabraLanguages,
      build: buildPalabra,
      describe: describePalabra,
    });
    // No `legacyKeys`, nothing converted (ruling 2); unflagged (ruling 14).
    for (const absent of ['flagged', 'i18nKey', 'session', 'participantSpeech', 'testerSwitch'] as const) expect(palabraProvider, absent).not.toHaveProperty(absent);
    expect(palabraProvider.settings).not.toHaveProperty('legacyKeys');
    expect(palabraProvider.TurnDetection).not.toHaveProperty('Help');
  });

  it("offers Text only (ruling 7), takes no typed text, keeps the server's boundaries, and offers both turn modes", () => {
    expect(palabraProvider.speech).toBe('optional');
    expect(palabraProvider.textInput).toBe(false);
    expect(palabraProvider.boundaries(PALABRA_DEFAULTS)).toBe('provider');
    expect(palabraProvider.turns(PALABRA_DEFAULTS)).toEqual(['auto', 'manual']);
  });

  it('sits last, after Soniox (ruling 14)', () => {
    const ids = PROVIDERS.filter((p) => !p.id.startsWith('fake')).map((p) => p.id);
    expect(ids[ids.length - 1]).toBe('palabraai');
    expect(ids.indexOf('palabraai')).toBe(ids.indexOf('soniox') + 1);
  });

  it("runs the participant in Palabra's own reverse — a region target by its source code — and speaks it when its switch is on (rulings 7, 9)", () => {
    const participant = contextsFor(both({ source: 'ja', target: 'en-us' }, { participantSpeech: true })).participant!;
    expect(participant).toEqual({ direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' });
    expect(palabraProvider.build(participant, PALABRA_DEFAULTS, SHARED)).toMatchObject({ source: 'en', target: 'ja', speech: true });
    expect(gate(both({ source: 'ja', target: 'en-us' }), 'electron')).toBeNull();
    // The other way: English reverses to its documented US English.
    expect(contextsFor(both({ source: 'en', target: 'ja' })).participant!.direction).toEqual({ source: 'ja', target: 'en-us' });
    // A participant that does not speak asks for text alone.
    expect((palabraProvider.build(contextsFor(both({ source: 'ja', target: 'en-us' })).participant!, PALABRA_DEFAULTS, SHARED) as PalabraConfig).speech).toBe(false);
  });

  it('refuses Both where the docs give no reverse: an Auto-detect source, or a target with no source code (D20, ruling 8)', () => {
    expect(gate(both({ source: AUTO, target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'en', target: 'az' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    expect(gate(both({ source: 'bn', target: 'en' }), 'electron')).toMatchObject({ code: 'participant_unsupported', leg: 'participant' });
    // Speaker alone, Auto-detect translates.
    expect(gate({ ...both({ source: AUTO, target: 'en' }), legs: ['speaker'] }, 'electron')).toBeNull();
  });

  it('a start whose signal already aborted opens no socket and asks no REST server', async () => {
    const opened = vi.fn();
    const fetched = vi.fn();
    vi.stubGlobal('WebSocket', opened);
    vi.stubGlobal('fetch', fetched);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    for (const credentials of [KEY, APP]) {
      await expect(palabraProvider.start(
        { context: AUTO_CTX, config: configFor(), credentials, clock: createVirtualClock(0), signal: controller.signal },
        recordEvents().events,
      )).rejects.toBe(reason);
    }
    expect(opened).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('loads an old profile as it was — the key, the pair, the settings, a threshold the API refuses sent as its floor — and writes nothing', async () => {
    stored.set('settings.palabraai.authMode', 'platform');
    stored.set('settings.palabraai.apiKey', 'plbr_oldProfileKey0123456789');
    stored.set('settings.palabraai.sourceLanguage', 'ja');
    stored.set('settings.palabraai.targetLanguage', 'en-us');
    stored.set('settings.palabraai.voiceId', 'default_high');
    stored.set('settings.palabraai.segmentConfirmationSilenceThreshold', 0.1);
    stored.set('settings.palabraai.subscriberCount', 2);
    await useProviderStore.getState().load(palabraProvider);
    const entry = useProviderStore.getState().entries.palabraai;
    expect(entry.settings as PalabraSettings).toEqual({ ...PALABRA_DEFAULTS, voiceId: 'default_high', segmentConfirmationSilenceThreshold: 0.1 });
    expect(readCredentials(palabraProvider, entry.settings, entry.credentials, noAuth)).toEqual({ kind: 'apiKey', apiKey: 'plbr_oldProfileKey0123456789' });
    expect(entry.pair).toEqual({ source: 'ja', target: 'en-us' });
    expect((palabraProvider.build({ direction: entry.pair, speech: true, turns: 'auto' }, entry.settings as PalabraSettings, SHARED) as PalabraConfig).silenceThreshold).toBe(0.3);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('opens a profile from before the platform key in the platform mode, its app pair kept but not read, and a target it no longer offers at the first of its list: stated departures (ruling 2)', async () => {
    stored.set('settings.palabraai.clientId', 'legacy-client-id');
    stored.set('settings.palabraai.clientSecret', 'legacy-client-secret');
    stored.set('settings.palabraai.sourceLanguage', 'ja');
    stored.set('settings.palabraai.targetLanguage', 'vn');
    await useProviderStore.getState().load(palabraProvider);
    const entry = useProviderStore.getState().entries.palabraai;
    expect((entry.settings as PalabraSettings).authMode).toBe('platform');
    expect(readCredentials(palabraProvider, entry.settings, entry.credentials, noAuth)).toMatchObject({ missing: expect.any(String) });
    // One click on the app pair's option, and the pair it kept reads again.
    const app = { ...(entry.settings as PalabraSettings), authMode: 'app' as const };
    expect(readCredentials(palabraProvider, app, entry.credentials, noAuth)).toEqual({ kind: 'app', clientId: 'legacy-client-id', clientSecret: 'legacy-client-secret' });
    expect(entry.pair).toEqual({ source: 'ja', target: 'ar' });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('keeps its readiness through an edit to a slider or a switch; the credential mode, or a credential, asks again (checkReads)', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = useProviderStore.getState();
    await store.load(palabraProvider);
    store.setCredential(palabraProvider, 'apiKey', 'plbr_readyKey0123456789');
    await store.refreshReadiness(palabraProvider, noAuth);
    expect(useProviderStore.getState().readiness.palabraai).toEqual({ state: 'ready', models: [] });
    store.updateSettings(palabraProvider, { segmentConfirmationSilenceThreshold: 1.1 });
    store.updateSettings(palabraProvider, { autoTempo: true });
    expect(useProviderStore.getState().readiness.palabraai).toEqual({ state: 'ready', models: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    store.updateSettings(palabraProvider, { authMode: 'app' });
    expect(useProviderStore.getState().readiness.palabraai).toEqual({ state: 'unknown' });
  });
});
```

In `src/providers/registry.test.ts` (after Task 4's invariant):

```diff
--- a/src/providers/registry.test.ts
+++ b/src/providers/registry.test.ts
@@ -322,8 +322,8 @@
     const releaseBuild = await import('./registry');
     // each provider plan adds its id where the owner orders it (spec: "one line in the order test").
     // Kizuna Soniox first, unflagged (Stage 2 Kizuna Soniox, ruling 6): the owner's 2026-09-12
-    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), OpenAI Realtime (Stage 2 OpenAI Realtime, ruling 18), OpenAI Translate (Stage 2 OpenAI Translate, ruling 11), then Soniox with your own key.
-    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox']);
+    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), OpenAI Realtime (Stage 2 OpenAI Realtime, ruling 18), OpenAI Translate (Stage 2 OpenAI Translate, ruling 11), Soniox with your own key, and Palabra AI last (Stage 2 Palabra, ruling 14).
+    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox', 'palabraai']);
   });
 
   it('a development build adds exactly the two fakes', () => {
```

In `src/components/SetupWizard/providerPaths.test.ts`:

```diff
--- a/src/components/SetupWizard/providerPaths.test.ts
+++ b/src/components/SetupWizard/providerPaths.test.ts
@@ -25,7 +25,7 @@
   });
 
   it("lists the registered own-key providers in registry order, in the old enum's spelling", () => {
-    expect(ownKeyOptions('understand-others').map((o) => o.id)).toEqual(['gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox', 'fake']);
+    expect(ownKeyOptions('understand-others').map((o) => o.id)).toEqual(['gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox', 'palabraai', 'fake']);
   });
 
   it("judges a provider's fit from its speech", () => {
@@ -39,6 +39,8 @@
     expect(text[Provider.OPENAI_TRANSLATE]).toEqual({ ok: true });
     // OpenAI Realtime asks for text alone when a leg does not speak (Stage 2 OpenAI Realtime), as the old provider offered.
     expect(text[Provider.OPENAI]).toEqual({ ok: true });
+    // Palabra AI asks for text alone too when a leg does not speak (Stage 2 Palabra, ruling 7).
+    expect(text[Provider.PALABRA_AI]).toEqual({ ok: true });
   });
 
   it("judges the managed card's fit from the definition's speech", () => {
```

- [ ] **Step 2: Run them to see them fail.**

Run: `npx vitest run src/providers/palabraai/provider.test.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts`
Expected: FAIL — `provider.test.ts` fails to resolve `"./provider"`; the release order pin (7 ids, not 8), the wizard's own-key list (no `palabraai`) and its fit (`undefined` for `palabraai`) fail — 3 failed, 36 passed.

- [ ] **Step 3: Write the definition.** Create `src/providers/palabraai/provider.ts`:

```ts
import { PalabraAIIcon } from '../../components/Icons/ProviderIcons';
import type { Provider } from '../../lib/provider/types';
import { createPalabraAdapter } from './adapter';
import { checkPalabra } from './check';
import { buildPalabra, describePalabra, type PalabraConfig } from './config';
import { PalabraSettingsView } from './PalabraSettings';
import { PalabraTurnDetectionControls, PalabraTurnDetectionSummary } from './PalabraTurnDetection';
import { migratePalabraSettings, PALABRA_DEFAULTS, palabraCredentials, palabraLanguages, type PalabraCredentials, type PalabraSettings } from './settings';

const adapter = createPalabraAdapter();

/**
 * Palabra AI with the user's own credentials (Stage 2 Palabra): speech to
 * speech, one WebSocket per leg — written anew, the old LiveKit client not
 * ported (the owner, 2026-09-29). The old enum's id and slice (controller
 * ruling 2 of the foundation), so a stored selection, the credentials, the
 * pair and every setting carry over. The platform key or the legacy app
 * pair, picked above the fields (ruling 1). Its REST calls are plain CORS
 * and its socket takes its credential in the query, so it runs on every
 * platform, and the extension's CSP already lists `*.palabra.ai`: no
 * manifest or background change. Released last, after Soniox, unflagged
 * (ruling 14): `VITE_ENABLE_PALABRA_AI` is the old code's, and goes with it.
 */
export const palabraProvider: Provider<PalabraSettings, PalabraCredentials, PalabraConfig> & { id: 'palabraai' } = {
  id: 'palabraai',
  kind: 'own-key',
  platforms: ['electron', 'extension', 'web'],
  icon: PalabraAIIcon,
  // Today's TUTORIAL_URLS value, as a literal (no import from src/services); its text is updated later (ruling 18).
  guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/palabraai-setup',

  // No `legacyKeys`: nothing stored is converted (ruling 2).
  settings: { key: 'palabraai', defaults: PALABRA_DEFAULTS, migrate: migratePalabraSettings },
  Settings: PalabraSettingsView,
  TurnDetection: { Summary: PalabraTurnDetectionSummary, Controls: PalabraTurnDetectionControls },

  credentials: palabraCredentials,
  check: (k, s, ctx) => checkPalabra(k, s, ctx),
  // The session list reads the credentials alone; `authMode` decides which show. A slider or a switch keeps Start on.
  checkReads: ['authMode'],

  // Its documented tables, and its documented reverse (rulings 8, 9).
  languages: palabraLanguages,

  // A leg that does not speak asks for text alone (ruling 7): Text only is offered.
  speech: 'optional',
  // It takes audio only (parity).
  textInput: false,
  // A validated transcription ends a segment (the old offer: pause off, auto and sizes on).
  boundaries: () => 'provider',
  turns: () => ['auto', 'manual'],

  build: buildPalabra,
  describe: describePalabra,
  start: adapter.start,
};
```

- [ ] **Step 4: Register it last.** In `src/providers/registry.ts`:

```diff
--- a/src/providers/registry.ts
+++ b/src/providers/registry.ts
@@ -12,12 +12,13 @@
 import { localInferenceProvider } from './localInference/provider';
 import { openaiProvider } from './openai/provider';
 import { openaiTranslateProvider } from './openai_translate/provider';
+import { palabraProvider } from './palabraai/provider';
 import { kizunaSonioxProvider } from './soniox/kizuna';
 import { sonioxProvider } from './soniox/provider';
 import { volcengineAst2Provider } from './volcengine_ast2/provider';
 
-/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11; Stage 2 OpenAI Realtime, ruling 18): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate and Soniox with your own key. */
-const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiProvider, openaiTranslateProvider, sonioxProvider] as const;
+/** Shipped providers, in UI order (Stage 2 Kizuna Soniox, ruling 6; Stage 2 Gemini, ruling 6; Stage 2 Volcengine AST2, ruling 5; Stage 2 OpenAI Translate, ruling 11; Stage 2 OpenAI Realtime, ruling 18; Stage 2 Palabra, ruling 14): the managed Kizuna Soniox, the free LocalInference, then Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate, Soniox and Palabra AI with your own key. */
+const RELEASED = [kizunaSonioxProvider, localInferenceProvider, geminiProvider, volcengineAst2Provider, openaiProvider, openaiTranslateProvider, sonioxProvider, palabraProvider] as const;
 /** Compiled into development builds only (D24): the fake, and the leased fake that carries the session hooks (Stage 2 foundation, choice 1). */
 const DEV_ONLY = [fakeProvider, fakeLeasedProvider] as const;
 
```

- [ ] **Step 5: Run the providers, the wizard, the app and the stores.** Every registry invariant now runs over Palabra too (its credential choice, `checkReads` naming fields of its defaults, its initial pair offered, its reverse); the wizard's own-key list gains it; nothing else enumerates the registry's order. The old Palabra tests (`src/services`, `ProviderSection.palabraai.test.tsx`) still pass: they test the old code.

Run: `npx vitest run src/providers src/components/SetupWizard src/app src/stores src/services src/components/Settings`
Expected: PASS — 283 files, 4 154 tests.

- [ ] **Step 6: Gates.** The suite at 0 failed; the typecheck gate prints exactly the baseline.

- [ ] **Step 7: Commit.**

```bash
git add src/providers/palabraai/provider.ts src/providers/palabraai/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts
```

```bash
git commit -q -F - -- src/providers/palabraai/provider.ts src/providers/palabraai/provider.test.ts src/providers/registry.ts src/providers/registry.test.ts src/components/SetupWizard/providerPaths.test.ts <<'EOF'
feat(palabraai): register Palabra AI, last and unflagged

Its old id and slice, so a stored selection, the credentials, the pair
and every setting carry over; Text only offered; its readiness reads the
credential mode alone. The old client stays compiled until its deletion.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```


---

### Group check B (controller, after Wave 6)

- [ ] The full gates: `npx vitest run src` at 0 failed with no unhandled errors (the replay: 570 files passed and 1 skipped, 7 296 tests passed and 2 skipped); the typecheck gate at exactly the baseline; the full tree at 259; `npx vitest run src/services` green.
- [ ] `npm run build`, then `npm run extension:build`; `npx vitest run extension`.
- [ ] The three D24 greps print nothing.
- [ ] `command grep -rlF 'task.current' build extension/dist` names at least one file under `build/` and one under `extension/dist/`: the adapter ships in both (the replay's: `build/static/index-<hash>.js` and its map, and `extension/dist/fullpage.js`).
- [ ] **Rendered, with no request to Palabra** (a fresh vite, `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort --force`, driven by `scripts/dev/headless.mjs`; outputs under `/home/jiangzhuo/.claude/jobs/ac3aa5d5/tmp/group-b/`). No credential is typed into Palabra's fields and Start is never pressed with it selected:
  - select Palabra AI in the picker: the credential form shows the mode above the fields — "Platform API Key" and "App Client ID/Secret" (the old labels) — with the API key field in the platform mode; choosing the app pair shows the "Client ID" and "Client Secret" fields, empty, and choosing the platform mode again shows the key;
  - the Provider tab, in the advanced layout, shows the voice (Default Low), Speech Processing (Sentence Splitter enabled, Translate Partial Transcriptions disabled) and Audio Buffer Configuration (8.0s, 24.0s, Adaptive Speech Speed disabled), with no tooltip icon beside any but the voice; moving the target to 15.0s raises the max slider's `min` to 18000. The simple layout shows none of them (every port's rule). Compare each block's markup with the old Palabra block's and Gemini's same field (the match-sibling rule);
  - the Speech section's turn-detection summary reads "VAD Settings · Silence Threshold: 0.70s"; its controls sit under the VAD heading, the slider from 0.30 to 2.00;
  - the language picker: Auto Detect first among the sources, then the documented sources in their English names' order — `ar` first, `cy` last — each shown by its native name; no `bn`, `mr` or `fa` among the targets, and no plain `zh`, `en-au` or `en-ca`; the swap button on `ja → en-us` gives `en → ja`, and on `en → ja` gives `ja → en-us` (the web build has no participant source, so Both's refusals are the unit tests' — Task 14's `gate` cases);
  - Start is off, and says the key is missing (`credentials_missing`: "Enter your API key in Settings before starting.");
  - the setup wizard's own-key list reads, in order, Google Gemini, Doubao AST 2.0, OpenAI Realtime, OpenAI Translate, Soniox, Palabra AI (then the development build's fake);
  - an old profile: with `localStorage` holding `settings.common.provider` = `palabraai`, made-up `settings.palabraai.clientId` / `settings.palabraai.clientSecret` and no `settings.palabraai.authMode`, `settings.palabraai.sourceLanguage` = `eo` and `settings.palabraai.targetLanguage` = `vn`, reload: Palabra AI is selected, the credential form opens in the platform mode with an empty key field (ruling 2), the source reads Auto Detect (the first source) and the target the first target, `ar` (shown as "العربية الفصحى"), and none of those keys is rewritten — do not choose the app pair here, or the readiness driver would check the made-up pair against Palabra;
  - the network log holds no request to `palabra.ai`.
- [ ] Stop the vite; record the numbers and the screenshots' paths for Task 15.

---

### Task 15: The spec's amendments and the roadmap's record (controller)

The controller's docs task, after group check B. It edits only the spec and the roadmap, and commits them together.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-client-contract-design.md`, `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`

- [ ] **Step 1: Amend the spec.** Each amendment is marked "(Stage 2 Palabra, ruling / choice N)" in the text, as the earlier plans' are. Anchors are by heading and content (lines read at `024266a0`):
  1. **"Decisions", D3** (`:81`): "Every provider whose audio can be attributed to a segment does replay; only Palabra cannot." → "Every provider replays: Palabra's audio names its sentence since its WebSocket port (ruling 6). Replay does not require precision." And "Provider capability", **the paragraph that begins "Two findings are worth stating plainly"** (`:1092`): its Palabra finding goes — no client is left that cannot replay; the contract keeps ref-less `audio`, which only the fake's `refless-stream` fixture produces.
  2. **D20** (`:98`), **"The participant rule (D20)"** (`:1483`) and **"Languages are two functions"**' opening (`:405`, "whether a direction is supported (… Palabra's check)"): the participant leg opens when the pair's reverse — **the provider's own, where it states one (`languages.reverse`), else the plain swap** — is offered in the participant's language context (ruling 9; choice 3); `auto` never reverses — never a target for the swap, and a provider's own reverse gives none. Palabra reverses by its documented codes: a target by its `to_source` (`en-us` → `en`), a source by its `to_target` (`en` → `en-us`), a hidden `to_target` by the first offered target of its source (`zh` → `zh-hans`, choice 5); a pair either side of which has none refuses Both. A provider with no reverse of its own offers no target outside its sources, **in every settings shape the offer reads** — a registry invariant over declared shapes (Gemini's offer reads its model). Say in "The provider definition" → "The shape" (`:1146`) that `languages` has a third optional member, `reverse`, with a one-line comment.
  3. **"L0 — the client contract"**: the `StartRequest` listing loses `input` (ruling 16); the comment "Palabra builds its LiveKit track from appended pcm" (`:188`) goes; "ref absent — attributable to no segment (Palabra)" (`:213`) → "(no provider now; the fake's `refless-stream` fixture)"; the fabrication note naming `OpenAIWebRTCClient` and `PalabraAIClient:1327` (`:245`) is kept as history, marked "both clients retired from the contract (Stage 2 OpenAI Realtime; Stage 2 Palabra)". **"Capture belongs to the runner"**' amendment (`:1924-1925`: "this waits for an adapter that would"): the seam is deleted — no adapter takes a native track (ruling 16).
  4. **`ref`'s rationale** (`:230`) and **the revision rule** (`:297`): Palabra's `partial` → `validated` is an open → close, not a revision; Palabra needs `ref` because several `transcription_id`s are in flight at once. The revision rule stays — L1 must take it — with its example restated: no provider revises closed text now; the fake's fixture keeps the rule tested.
  5. **"Turns"** — "What each provider can do", Palabra's row (`:467`): automatic = the server's segmentation after its silence threshold; ending on release = what waits sent at once, padded, and **the adapter's real-time silence from the next beat** confirming the sentence at the threshold (ruling 3; choice 7) — not "the track (`dtx:false`) carries silence". Its row at `:498`: `beginTurn` sends nothing; `endTurn` / `cancelTurn` flush the re-chunker and make the leg idle; `interrupt_task` does not help (the owner's probe). `:602`: Palabra now offers push-to-talk and push-to-translate, as the spec promised.
  6. **"Provider capability", the table's `PalabraAIClient` row** (`:1065`) → "Palabra (`palabraai`, WebSocket)": audio "**yes** — each chunk names its sentence; ranges by sample count once its burst is whole (Soniox's fill-in, ruling 6; choice 12)"; pairing "**`transcription_id`** — stated". Against **D4** (`:82`), whose list names the stated exceptions: Palabra's tiling is a range filled in later, as Soniox's ("A range known only later is filled in", `:253`) — not a stated exception, so D4's list is unchanged. **"The provider definition", "`start` owns the transport"** (`:1260-1262`): "Palabra's `forcedTransport: 'webrtc'` … always uses LiveKit" → "Palabra's port is WebSocket, written from scratch (ruling 19)".
  7. **"Readiness is one check"** (`:1354`): Palabra's check lists the REST sessions — not the socket, whose refusal a browser cannot read — and declares `checkReads: ['authMode']`, the first provider whose credential fields depend on a setting to declare it (choice 16).
  8. **"Sockets that need upgrade headers"** (`:1571`): Palabra needs none — the platform key, or a REST session's publisher token, rides the query's `token`, which `redact()` masks; a wrong key is a bare 403 on the upgrade, worded as the key while online (choice 8), as Doubao's is. The plain seam now lives in `src/lib/contract/socket.ts` (choice 1); F14 joins it there.
  9. **"Persisted settings that move"** (`:1633`): Palabra's `authMode` and pair codes — nothing converted (rulings 2, 20): a profile with no stored `authMode` opens in the platform mode; a stored `ba`, `eo` or `ia` source falls to Auto-detect (the first source), which also refuses Both; a stored `vn` target, and the stored targets the documented tables no longer offer (`zh`, `en-au`, `en-ca`, `bn`, `mr`, `fa`), fall to Arabic (the first target). F5's `legacyKeys` and `migratePair` stay for their users, no longer named for Palabra.
  10. **"What adding a provider then touches", item 4** (`:1657`): Palabra needs no manifest change (`extension/manifest.json:116` lists `*.palabra.ai`); its REST is plain CORS [inf: live-test item 3].
  11. **"Session hooks on the provider definition"** (`:1829`): Palabra uses none — the old delete-all `prepare` is gone; each leg deletes only its own REST session, a create the leg outlives included (choice 9).
  12. **"What the surveys' defects become"**, its "Not removed by construction" (`:2051-2053`): "LiveKit reconnects not surfaced" goes with the transport; "Palabra's `deleteSession` having no timeout" → bounded at 5 s with `keepalive`, its own session only, the create on its own signal so a session made after the leg ended is deleted too (choice 9).
  13. **"Testing"** (`:2058`): the kit's seeded lifecycle scenario (`runLifecycles`, ruling 15), `VirtualClock.pending()` checked after every scenario, a `FakeSocket` that refuses what a browser refuses, the flush after an exchange, manual-end's segment check, and the `frame-url` rule (choices 4, 10); a provider's fake REST server reads bodies as a browser's fetch does (choice 9).
  14. **"Migration", item 8** (`:2202`): "Palabra (`palabraai`) — the degenerate extreme: `audio` without `ref`, no `range`" → "Palabra (`palabraai`) — ported by the Stage 2 Palabra plan as a WebSocket client written from scratch (ruling 19): attributable audio per sentence, stated pairing, ranges at a burst's end." The deletion paragraph: Palabra's old code and `livekit-client` wait for its live test (ruling 17).
  15. **"Stage 2 — open for the plans that meet them"**, item 9 (`:2353-2354`, "OpenAI and Palabra use it first") → "OpenAI and Gemini use F5 (`legacyKeys`; Gemini's `migratePair`, which converts nothing); Palabra, for which it was first named, does not (rulings 2, 20)."
  16. **"Risks"** (`:2356`): the silence rule rides a timer, and a hidden page throttles timers — at about one wake-up a minute (Chrome's intensive throttling, after about 5 minutes hidden and silent [inf]) **no timer keepalive can survive**: Palabra hears nothing for 10 s, sends `SERVICE_TIMEOUT` and closes 1008, whenever no audio reaches the adapter (muted, or between push-to-talk presses). Electron's main window is exempt (`backgroundThrottling: false`); the extension side panel and the web build are not [inf]; Soniox's and Doubao's keepalives share the exposure (live-test item 5; the open question "Silence on the audio clock"). At about 1 Hz a throttled page still keeps the session, with less silence than real time (choice 7). And: a socket URL carries the credential, and DevTools' own console prints a failed socket's URL, outside our sinks (Doubao's accepted question, now Palabra's too).
- [ ] **Step 2: Write the roadmap's section.** Append `## Scheduled by the Stage 2 Palabra plan` after the last section, `## Scheduled by the Stage 2 Gemini/AST2 follow-up plan` (`:5339`, which says it runs before this plan), in its form:
  - **What landed:** the plan's path and commit, the commit range and its `+/−` lines and files (from `git diff --shortstat`), the waves as run, each task's review rounds, group checks A and B with their numbers; Task 15 is the record.
  - **Departures, stated:** a profile with no stored `authMode` opens in the platform mode (ruling 2); stored `ba` / `eo` / `ia` sources fall to Auto-detect (the first source), which also refuses Both; the stored `vn`, `zh`, `en-au`, `en-ca`, `bn`, `mr` and `fa` targets fall to Arabic (rulings 2, 8); timbre detection is off — the voice picked is the voice heard (ruling 10); a stored threshold under 0.3 is sent as 0.3, a stored max buffer not above its target raised (ruling 10); Both refuses a pair with no documented reverse — targets `az`, `bs`, `fil`, `is`, `kk`, `mk`, `sr` (of which `fil`, `kk`, `mk`, `sr` are sources too, so a plain swap would have run them), and sources `bn`, `eu`, `fa`, `ga`, `mn`, `mr`, `mt`, `ug`, `yue`, of which `bn`, `mr` and `fa` ran Both in the old app (rulings 8, 9); Stop drops what is still being translated (ruling 13); each leg deletes only its own REST session (choice 9); the three English-only tooltips are gone (ruling 10). New: Text only (ruling 7), push-to-talk and push-to-translate, `auto`, the languages the docs add.
  - **Before any release from the branch:** the registry's order, pinned (ruling 14); the release notes say that stored `ba` / `eo` / `ia` sources now read Auto-detect (the first source), which also refuses Both, and the stored `vn`, `zh`, `en-au`, `en-ca`, `bn`, `mr` and `fa` targets Arabic; that a pre-July profile opens in the platform mode (one click back); and that timbre detection is off; no new key, so no native-speaker check; `VITE_ENABLE_PALABRA_AI` no longer gates anything the user sees.
  - **The owner's live test** (own credentials, real Palabra; switch diagnostic logs on in Help first; each item names what settles it):
    1. **The check, both modes** (ruling 1; choice 16): a valid key is ready; a wrong key reads as the credentials with Palabra's words; a valid and a wrong app pair; offline: not ready, with no words about the key; a slider or a switch edit sends no new `/session-storage/sessions` request (`checkReads`).
    2. **The start, per mode** (ruling 4; choices 6, 8): the Logs show, in order, `session.create` and `session.created` (the pair only), `session.opened`, `task.set`, `task.get`, a `task.not_found` if an ask came before the task ran (expected, and not red), `task.current` `running`; record the time from Start to live per mode against the 20 s bound. A stored threshold of 0.1 (edited into storage) starts at 0.3.
    3. **Connections, per platform** (survey §6): the web build, the extension side panel (its CSP, and CORS on the REST calls with their custom headers — a preflight each) and Electron: items 2, 4 and 9 on each. Origin is unchecked (the owner's probe, from Node): confirm from a real page.
    4. **Automatic turns, ja → en** (rulings 6, 11; choice 12): source rows grow on `transcription.partial` and close on `transcription.validated`; each translation sits under its source as a stated pair — in the panel, the Electron subtitle takeover, the extension overlay and the export; speech plays once on the monitor and once in the virtual mic; karaoke lights a sentence by sample count once its burst is whole; replay works per translation row with keep-audio on; no clicks at the 200 ms seams, no gaps inside a sentence, over ten minutes (G3's heir).
    5. **The silence rule** (ruling 3; choice 7). No audio reaches the adapter while the microphone is muted (`src/lib/audio/capture/core.ts:89`) or between push-to-talk presses (`src/lib/session/run.ts:457-460`), so only then does the keepalive carry the session:
       - push-to-talk: a release closes its sentence about 1.9 s after it at the default threshold, 0.7 (the probe's speech end → `validated_transcription`, the threshold already inside it), plus up to one beat (320 ms), scaling with the threshold — the silence starts at the next beat, not after `IDLE_MS`; record release-to-close times; an empty press gives no row; push-to-translate sends the raw voice while the key is up;
       - many presses in a row (twenty or more, a second or so apart): record whether release-to-close time grows along the run, and whether a `session.warning` `AUDIO_STREAM_TOO_FAST` appears (the stream's own clock, choice 7);
       - **a hidden window with no audio** — on the extension side panel and on the web build: hide or minimize the browser window, with the microphone muted under automatic turns, for 10 minutes or more; then again idle under push-to-talk (no press) for 10 minutes or more. Record whether `SERVICE_TIMEOUT` ends the session and after how long; if it does, its words read "[Palabra SERVICE_TIMEOUT] No input audio received for 10s…". Electron is exempt (`backgroundThrottling: false`, `electron/main.js:397`): run it there once as the control;
       - visible, muted for a minute under automatic turns: the session survives and the sentence spoken before the mute closes; record any `session.warning` (`AUDIO_STREAM_*`) or close over minutes of real-time silence.
    6. **Both** (rulings 8, 9; D20): two sessions on one credential; the participant is reversed by Palabra's codes (`ja → en-us` runs `en → ja`, `en → ja` runs `ja → en-us`, `zh → en` runs `en → zh-hans`); its speech follows its switch; either leg ending ends both; Auto-detect and a pair ending on `fil` are refused in words.
    7. **Text only** (ruling 7): no audio at all, no `audio.output` frames, the rows paired.
    8. **`auto`** (ruling 8): each source row carries the language the server heard; speaker only.
    9. **Stop, and a cancelled create** (ruling 13; choice 9): nothing plays after Stop; for the pair, the REST delete goes out (DevTools' network panel: `DELETE` 204, `keepalive`); **cancel during the app pair's create** (press Stop, or switch provider, within a moment of Start), then Start again at once: the new start must not be refused for parallel sessions, and the network panel shows the first session's `DELETE` after its create's answer; close the side panel mid-session, then Start within a minute — whether the `pagehide` delete got through its preflight, and whether a lingering session blocks the next.
    10. **Failures** (rulings 11, 12; choice 8): Wi-Fi off mid-session → the connection-lost words, with the time until them; ten quick Start / Stop rounds in Both (two connections each) to cross 20 connections a minute → the 1008 words; nothing reconnects.
    11. **Voices and the fallback** (rulings 10, 11): `default_low` against `default_high`; a target with no voice — try the added ones (`az`, `bs`, `is`, `kk`, `mk`, `sr`) — shows the `voice_fallback` notice once and a `session.warning` per sentence.
    12. **Languages** (ruling 8): `mr` and `fa` as sources; two or three of the added sources and targets translate and speak.
    13. **The Logs** (choices 8, 10, 11, 17): the three streamed frames grouped; `session.error` red, `task.not_found` not; no key, no JWT and no URL anywhere, the export included; record any `session.unknown` type.
    14. **An old profile** (ruling 2): key, pair and settings saved by an earlier build are ready without re-entry; a pre-July profile opens in the platform mode and one click brings its pair back; a stored `vn` target reads Arabic; a stored `eo` source reads Auto-detect, and Both is refused for it.
    15. **Analytics:** `translation_session_start` with `provider: 'palabraai'`, `transport: 'websocket'`; a refused start → `api_error` with its code.
    16. **The wizard:** Palabra AI last among the own-key providers; its credential step offers both modes and validates.
    17. **Sentences in parts** (choice 12's `last_chunk` rule, [inf]): long sentences, with the sentence splitter and partial translations on, until a `translation_part_id` of 1 appears in the `audio.output` frames; record whether `last_chunk` comes once per sentence or once per part, and whether the parts' bursts interleave; watch the karaoke of each part.
    18. **The settings take effect** (ruling 10): change each Provider-tab setting in turn — the sentence splitter off; partial translations on (`translation.partial` rows, and a translation streaming before it closes); the buffer's target and max; adaptive speech speed — run a session after each, and record the `task.set` frame and what changes in the behaviour.
  - **Open questions for the owner:** each live-test hypothesis — the start's bound against the times measured (item 2), the silence rule on a hidden page (item 5), whether minutes of real-time silence draw warnings (item 5), `errorCode`'s mapping past `VALIDATION_ERROR` (the frames of item 10), a refused upgrade online worded as the key (choice 8), `ERROR_WORDS_MS`, `last_chunk` per sentence or per part (item 17); **silence on the audio clock** — the silence rule could ride the audio instead of a timer, and no throttled timer could end a session. It needs two sites changed: while muted, the capture drops the chunk (`src/lib/audio/capture/core.ts:89`) and would deliver zeros instead; between presses, the capture still delivers and the runner's turn gate drops it (`src/lib/session/run.ts:457-460`), which would forward zeros instead (or a capture tick); not built here, and not Palabra's alone: Soniox's STT keepalive (`src/providers/soniox/sttStream.ts:245-254`: a check every 5 s, a `keepalive` frame after 15 s without audio, against a server that times out at about 20 s), Soniox's TTS keepalive (`src/providers/soniox/ttsStream.ts:535`, every 20 s) and Doubao AST 2.0's real-time silence (`src/providers/volcengine_ast2/adapter.ts:278`, 80 ms packets after 250 ms without audio) share the exposure; the idle bill — Palabra bills while the task runs, silence included [doc], as the old always-on track did, and `pause_task` would stop it at the cost of a resume on the next speech; the docs' missing reverses (targets `fil`, `kk`, `mk`, `sr`), which a plain swap would run; Palabra's own guidance that the API key belongs on a server [doc], which every own-key browser provider already departs from.
  - **The deletion inventory** (ruling 17), after the owner's live test — one plan, read at `024266a0` (none of these files moved since `7ab709e1`):
    - `src/services/clients/PalabraAIClient.ts` (+ test), `src/services/providers/PalabraAIProviderConfig.ts` (+ test), `palabraLanguageCodes.test.ts`, and every old test naming `Provider.PALABRA_AI` or `isPalabraAIEnabled` (`command grep -rln -e PALABRA_AI -e isPalabraAIEnabled src`), each checked first for what it pins of live code (`providerPaths.test.ts` pins the new definition's fit through the enum, and stays);
    - `ProviderConfigFactory.ts:8, 80-83`; `tutorialUrls.ts:17`;
    - `settingsStore.ts`: the slice's import, types and defaults (`:51-52`, `:88`, `:96`, `:288`, `:418`, `:654`, `:703`, `:970`), `migrateRejectedPalabraLanguages` (`:500-520`), `migratePalabraAuthMode` (`:522-537`), the load's two migrations (`:1354-1362`), `usePalabraAISettings` (`:1538`) and `useUpdatePalabraAI` (`:1622`) — the storage keys stay;
    - the old UI's Palabra branches: `ProviderSpecificSettings.tsx:17, 37, 128, 152, 391-392, 470, 728, 957, 1226-1463, 2283`; `ProviderSection.tsx:15, 22, 107, 115, 471-476` and the `palabraai-credentials-group` block from `:757` (with its styles); `LanguageSection.tsx:16, 98, 151-152, 246-247`;
    - `logStore.ts`: the old type classification (`:87-100`) and the old grouping rows (`:433-465` at `024266a0`, eight lines lower after Task 6);
    - `isPalabraAIEnabled` (`src/utils/environment.ts:238-253`) and its forwarding — `extension/vite.config.ts:179-181`, `.github/workflows/build.yml:220, 274, 314, 416, 518`, the feature-gate forwarding test — and every test's `isPalabraAIEnabled` mock;
    - `livekit-client` in `package.json:184` and the lockfile, with CLAUDE.md's pin text (`:390`, `:395-415`);
    - `src/lib/modern-audio/WebRTCAudioBridge.ts:14` (`import type { RemoteAudioTrack } from 'livekit-client'`), coordinated with the OpenAI deletion, which orphans the bridge and its pcm worklet copy (`extension/vite.config.ts:76`): whichever plan runs second deletes the bridge;
    - **keep:** `Provider.PALABRA_AI` and `LEGACY_SLICE_KEYS.palabraai` (the live id; a stored selection still resolves), `PalabraAIIcon`, the locale keys the new definition reads, the credential-choice styles.
  - **The roadmap's inheritance, item by item,** and **what it leaves:** the two sections below, as landed.
- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md
```

```bash
git commit -q -F - -- docs/superpowers/specs/2026-09-22-client-contract-design.md docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md <<'EOF'
docs(spec, roadmap): Palabra's amendments and its live test

Every provider replays; a provider may state its reverse; the input seam
is gone; the kit's seeded lifecycles and its stricter scenarios; the
owner's live test and the old Palabra code's deletion inventory.

Co-Authored-By: <implementing model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q5eVcuCVVhSpoUCA5C7bDe
EOF
```

---

## The roadmap's inheritance, item by item

Taken (and where), deferred (and why), or already done. Survey §4 lists the earlier items; anchors are the roadmap's at `024266a0`.

From plans 1b, 1c-1 and 1c-3:

| Item | Disposition |
|---|---|
| 1b: "With Palabra: `migrate` cannot tell absent from default and cannot see credentials" (`:181-182`) | F5 was built for it; **Palabra does not use it** (rulings 2, 20). F5 stays for its users (OpenAI's and Gemini's `legacyKeys`, Gemini's `migratePair`); its comments no longer name Palabra as their reason (Task 4) |
| 1c-1 / 1c-3: `Source.track` / `StartRequest.input` "waits for an adapter that would" (`:206-209`, `:405`) | **deleted** (ruling 16; Task 3): no adapter will |

From "Scheduled by the Stage 2 foundation plan":

| Item | Disposition |
|---|---|
| Palabra → F4, the credential-adjacent control (`:1299`) | consumed: `credentials.choice` on `authMode` (Task 8) |
| Palabra → `authMode` via `legacyKeys`, `vn` → `vi` via `migratePair` (`:1300`) | **not taken** (rulings 2, 20): stated departures |
| Palabra → `deleteSession` with a timeout (`:1301`) | **taken** for the app pair's session: 5 s, `keepalive`, its own only, a create the leg outlives included (choice 9); moot for the platform key |
| Palabra → the G3 latency a stall leaves (`:1196-1201`, `:1302`) | mostly moot [inf]: a sentence's audio is a faster-than-real-time burst, so the clip queue has lead within it; live-test item 4 listens for gaps |
| The kit's parked items (`:1321-1325`) | **taken** (ruling 15; Task 5; choice 4) |
| "Before any release": the release flags and the registry order (`:1352-1363`) | unflagged (ruling 14): nothing added to `VITE_ENABLED_PROVIDERS`; `VITE_ENABLE_PALABRA_AI` goes with the deletion |

From the Soniox plan's "Found here" (`:1740-1750`):

| Item | Disposition |
|---|---|
| Readiness re-probes on every edit | met by `checkReads: ['authMode']` (Task 14) |
| `audio.range` after fill-in (`:1743`) | **Done** by the Gemini/AST2 follow-up (its choice 19) for every provider; Palabra sends no `audio.range` at all — its ranges come by `speechRanges` over the final text, which L1 re-anchors on a punctuation fill-in (Palabra's text arrives punctuated, so it is a no-op [inf]) |
| Two TTS sockets per key | its analogue, two sessions per credential, settled by the owner's probe |
| `Conversation.afterAudio`'s pending drop (`:1747`) | **Done** by the follow-up (its choice 6); Palabra never reaches it: the translation opens on its first text or its first audio (choice 12) |

From "Scheduled by the Stage 2 Gemini plan":

| Item | Disposition |
|---|---|
| Leading audio opens the translation segment | done by construction (choice 12) |
| Name the leg in `SessionContext` | n/a: Palabra sends no instructions |
| `session.closed` on Stop | the same: nothing after stop |

From "Scheduled by the Stage 2 Volcengine AST2 plan":

| Item | Disposition |
|---|---|
| Palabra's use of F4 (`:3807`, `:3849`) | taken (Task 8) |
| Generic frame names grouped under Doubao's Logs keys (`:3855`) | respected: none of Palabra's names collides (Task 6's pin) |
| A kit-wide "no ws(s) URL in a frame" rule (`:3780`) | **built** (choice 10): Palabra is its third query-credential user |
| Each check opens a real session (`:3775`) | n/a: a GET that creates nothing |
| Superseded checks are never aborted (`:3778`) | applies, harmlessly: a GET, rarer with `checkReads` |
| The ScriptProcessor's 341 ms chunks against `IDLE_MS` (`:3779`) | avoided by construction: Palabra's `IDLE_MS` is 500 ms (choice 7); AST2's own stays its question |

From "Scheduled by the Stage 2 OpenAI Translate plan" and "… OpenAI Realtime plan":

| Item | Disposition |
|---|---|
| `pcmToBase64` / `base64ToPcm`, `boundedFetch` | reused (Tasks 9, 12) |
| `ERROR_WORDS_MS` and a negative age (`:4545`, `:5314`) | reused (ruling 11; choice 8); the same rule now also rebases the idle wait (choice 7) |
| `socket.ts` "to move with the others when F14 lands" (`:5330`) | **lifted now** without F14 (choice 1); F14 stays OpenAI Live's and joins it |
| `checkReads`' obligation: every field that decides the credential fields (`:5335`) | met: `authMode` is listed — the first provider whose fields depend on a setting to declare `checkReads` |
| The orphaned socket on an unreachable path (`:5336`) | applied from the start: the bound and the abort are armed before anything opens |
| The kit-level seeded lifecycle scenario, "reassigned … Palabra next" (`:5098-5104`, `:5308`) | **built** (ruling 15; Task 7), first run over Palabra (choice 19) |
| The kit's parked items (`:5322`) | taken (Task 5) |
| The merged OpenAI deletion (`:5077-5083`) | coordinated: it orphans `WebRTCAudioBridge` (a `livekit-client` type import) and the pcm worklet copy — recorded in Task 15's inventory |
| F15, the processed track (`:5085-5089`, "closed … the items wait for an adapter that would") | closed for good: the seam is deleted (ruling 16) |

From "Scheduled by the Stage 2 Gemini/AST2 follow-up plan", its "What it leaves" (`:5714-5731`):

| Item | Disposition |
|---|---|
| `clear()` against a whole-text `End` | **applies**, the same accepted, cosmetic case: `PalabraItems` skips a text equal to the last one it sent (`sourceText`, `translationText`; choice 12), so after a user's clear a final that repeats the last partial leaves the segment blank, and a later `speechRanges` `[0, length]` is dropped with `range_out_of_text`. The contract question stays the follow-up's |
| The release tail's lift | n/a: Palabra's release flushes the re-chunker and relies on the silence rule, not a tail |
| The pair's fall on a model switch | n/a: Palabra's offer reads no setting (choice 13) |
| Gemini's per-model offer (its choice 16) | taken into Task 4's invariant: Gemini's three offer shapes are declared by name (choice 3) |
| Readiness narrowing (`checkReads`) for Gemini and Doubao | not Palabra's; Palabra declares its own (Task 14) |

Stage 2 items no plan took and this one does not either: `RunnerDeps.replayAudio`'s guard, the notice-code namespace, the account's compile-time narrowing.

## What this plan leaves

- **The Palabra deletion plan** (ruling 17; Task 15's inventory), after the owner's live test — coordinated with the OpenAI deletion over `WebRTCAudioBridge`.
- **The setup guide** (ruling 18): the definition links today's page.
- **Silence on the audio clock** (an open question for the owner, Task 15): zeros that rode the audio — the capture delivering them while muted (`core.ts:89`), and the runner forwarding them between presses, where its turn gate drops the capture's audio (`run.ts:457-460`) — would keep every provider's session alive on a throttled page; not built — the rule's timer is Palabra's, Soniox's and Doubao's alike.
- **The shared `SliderField` and on/off field** (choice 15): Palabra's view is the sixth copy of the slider markup; the lift rewrites five providers' views, each with its own render check.
- **The silence rule and the re-chunker at a third user:** AST2's and Palabra's are two; lift them when a third provider needs real-time silence. AST2's keepalive reads `now - lastAudioAt` as Palabra's did before choice 7's rebase: a wall clock stepped back delays its silence too — for its own change.
- **The seeded lifecycles for the other adapters:** the kit is ready (ruling 21); each earlier port gains a harness in its own change.
- **One plain swap left outside the hook:** `src/lib/export/transcript.ts:107` (`pairOf`) rebuilds the speaker's pair from the participant's as `{ source: participant.target, target: participant.source }`, so a participant-only export of Palabra's `ja → en-us` reads `ja → en` in its header. Cosmetic; routing it through `reversedPair` needs the provider in the export.
- **`pause_task` for idle billing:** an open question (Task 15), not built.
- **Typed text through `tts_task`:** not proposed; `textInput: false` stays at parity.
- **The owner's open questions,** each with the live-test item that settles it.
- **Nothing on the old code:** the old client, descriptor, slice readers and UI branches stay compiled and unreachable, as the protocol documentation.

## Self-review

- **Spec coverage.** "L0 — the client contract" and "What every adapter must honour": conformance in Task 13 (every kit scenario but typed text and reconnecting, both modes), stop before its first `await` and silence after it (Task 13; the lifecycles), frames (Tasks 6, 13), the `input` seam gone (Task 3). "Turns": both modes, the release's flush, its idle from the next beat, and the silence rule (Task 13; choice 7). "The session request": the participant as the reversed call by the provider's own reverse (Tasks 4, 14), D20's refusals (Task 14), `describe` (choice 18). "Provider capability": attributable, replayable audio, stated pairing, ranges at a burst's end (Tasks 11, 13). "The provider definition": `languages.reverse` (Task 4), `credentials.choice` (Task 8), `checkReads` (Task 14). "Readiness is one check": bounded, over REST (Task 12). "Languages are two functions": the documented tables, `AUTO` (Task 8). "Sockets": the query credential and the seam (Tasks 1, 9). "Segmentation is one fact": `'provider'` (Task 14). "Persisted settings that move": nothing converted (Tasks 8, 14). "Capture belongs to the runner": Task 3. "Testing": conformance, the seeded lifecycles, the stricter kit and a browser-true fake REST server (Tasks 5, 7, 9, 13). The spec's corrections: Task 15.
- **Placeholders.** None: every code block is the tested scratch copy's file or diff, and every "Expected" is the replay's. The one template is the commit messages' `<implementing model>`, which Global Constraints says to fill in; Task 15's record fills its numbers from the run.
- **Type consistency.** Checked against the scratch copy, where every file compiled at the gate and the full tree stayed at 259: `OpenSocket`, `nativeSocket`, `WS_OPEN`, `tileSpan`, `reversedPair`, `reverseSupported`, `swapped`, `buildSharedSettings`, `pending`, `LifecycleRun`, `LifecycleHarness`, `LifecycleReport`, `runLifecycles`, `PalabraSettings`, `PalabraAuthMode`, `PalabraVoice`, `PALABRA_DEFAULTS`, `effectiveQueue`, `effectiveThreshold`, `maxQueueFloor`, `migratePalabraSettings`, `PalabraCredentials`, `palabraCredentials`, `palabraLanguages`, `palabraOffers`, `PalabraConfig`, `buildPalabra`, `describePalabra`, `restHeaders`, `directUrl`, `readCreated`, `sessionUrl`, `sessionDeleteUrl`, `restWords`, `setTask`, `GET_TASK`, `END_TASK`, `inputAudio`, `decodeMessage`, `transcriptionOf`, `outputAudioOf`, `errorOf`, `warningOf`, `taskStatusOf`, `validationWords`, `errorWords`, `errorCode`, `CHUNK_MS`, `CHUNK_SAMPLES`, `IDLE_MS`, `SILENCE`, `Rechunker`, `PalabraItems`, `createPalabraCheck`, `checkPalabra`, `CHECK_TIMEOUT_MS`, `createPalabraAdapter`, `START_TIMEOUT_MS`, `POLL_MS`, `ERROR_WORDS_MS`, `RELEASE_TIMEOUT_MS`, `palabraProvider`, `startPalabra`, `livePalabra`, `fakeRest`, `RestAnswer` — each spelled the same in every task that names it.
- **Choices made inside the rulings:** 1–20, listed above; each is cited where it lands. The review's findings, ruled by the controller, land in choices 3 (m1), 7 (m5, m11), 8 (m8), 9 (I1), 12 (m4, m10), in the research notes (I2, m2), in Task 4's `types.ts` comment and amendment 15 (I4), in the departures and group check B (I3), and in Task 15 and "What this plan leaves" (I2, m3, m4, m7, m9); the one test that duplicated another is gone (m6). The re-review's findings land in choice 7 (N1, the stream's own clock; N2, the cancelled release's case), choice 9 and the adapter's `release` (N3, an in-time answer that names only an id; N6, the expiry marked [inf]), the research notes, the open question and "What this plan leaves" (N4, the two sites), and live-test item 5 (N1, N5).
- **Departures, stated in the plan:** a profile with no `authMode` in the platform mode (ruling 2); stored `ba` / `eo` / `ia` sources falling to Auto-detect, which refuses Both, and `vn` and six stored targets to Arabic (rulings 2, 8); timbre detection off, a stored threshold or buffer clamped (ruling 10); Both refused where the docs give no reverse, `bn` / `mr` / `fa` sources among them (rulings 8, 9); Stop dropping the tail (ruling 13); only our own REST session deleted (choice 9); the tooltips gone (ruling 10).
- **Departures from the survey:** the folder is `palabraai/` (choice 20); `bn` leaves the targets outright rather than by a `LanguageContext` (ruling 8); `C` has no timbre field (ruling 10); the start's bound is 20 s and its poll 2.1 s, not 30 s and 2 s (choice 6); `end_task { force: true }` is sent on stop, where §2.8 sent none (the brief; ruling 13); `session.created` is framed with its status, not its token-shaped id, and the delete is not framed (choice 9); the create is not aborted with the leg, where §2.8 aborted it (choice 9); `audio.output` names its sentence `id`, not `t`; the `SliderField` lift is left (choice 15); the Logs group by rows (choice 11, the controller's option in §2.9); `language` rides every source segment, `auto` being a source (ruling 8).
- **Departures from the brief:** none in the rulings. Its "first asked 2 s after `set_task`, then every 2 s" is 2.1 s here (choice 6: the probe's own cadence, clear of the rate limit). Beyond Palabra's folder, the plan edits tests the brief did not list, each needed by a ruling: the capture and runner tests (ruling 16), one `FakeSocket` case whose expectation a browser contradicts (ruling 15), the shape and shared-settings tests (ruling 9), and the wizard's own-key pin (ruling 14).

