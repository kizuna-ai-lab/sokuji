# Local Native as four units — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local Native (`local_native`, the Electron sidecar provider) runs on the provider structure again: flagged, Electron only, behind its tester switch. It has four units that mirror LocalInference's, so each of its stages can combine with another provider's (kizuna-ai-lab/sokuji#578; spec §10, step 5).

**Architecture:**
- **Re-apply, do not replay.** The earlier port (#587, branch `worktree-local-native-port`, head ec7eecb14, base a75b38257) is re-applied file by file on a fresh branch from `origin/main` 17642a804. No cherry-pick, no rebase.
  - Bring over and adapt the pieces that still fit main: the seams, the adapter, speech, voice, settings, the views, and the store and UI edits.
  - Rewrite on main's patterns what no longer fits: the definition, the builder, the check, the Engine and the bridge.
- **One port onto this device's native facts.** `NativeModels` (`src/lib/local-inference/native/nativeModels.ts`) is implemented over the native model store in `src/stores/nativeModels.ts`. It is handed the same ways `LocalModels` is: `SharedSettings`, `admit`, `CheckContext` and `watchReadiness`. Its session-side half (`NativeHost`) reaches a unit's start inside the unit's config. No module of the provider imports a store, except its views.
- **Four units**, as `src/providers/localInference/provider.ts:69-95`:
  - `whole`: #587's adapter;
  - `transcription`: the same adapter over a config that transcribes alone;
  - `translation`: the shared job translator over the sidecar's translate socket;
  - `speech`: a native speech session built from #587's speech and voice.
  - One `admit` dispatches by config shape.
- **Four stacked parts.** Each is its own reviewable, testable deliverable:
  - **A.** Groundwork, with no user-visible change.
  - **B.** The provider with its whole unit, flagged. Testers can run it again, as with #587.
  - **C.** The three split units.
  - **D.** The surfaces, a real session, and the record.
- **Two PRs.** PR 1 carries A + B + C (no user-visible change outside the tester switch); PR 2 carries D on top of it.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Playwright (Electron), and the sidecar WebSocket protocol, which this plan does not change.

**Spec:** `docs/superpowers/specs/2026-11-19-free-stage-combination-design.md`: §4 (units, stage interfaces), §7 (composite rules, §7.4 order, §7.5 failure) and §10 (Local Native's three open points).
- The issue: kizuna-ai-lab/sokuji#578.
- #587's plan: `git show worktree-local-native-port:docs/superpowers/plans/2026-10-02-local-native-port.md`. It holds rulings 1–16, and its "After this plan" lists the owner's live test.
- The patterns this plan follows:
  - `src/providers/localInference/`: `provider.ts`, `transcriptionUnit.ts`, `translationUnit.ts`, `speechUnit.ts`, `check.ts`;
  - the `LocalModels` port: `src/stores/localModels.ts`, and Task 3 of `2026-11-23-providers-step-4-cycles-and-local-facts.md`.
- To read a #587 file, run `git show worktree-local-native-port:<path>`. To read its change to a shared file, run `git diff a75b38257 worktree-local-native-port -- <path>`.

## Global Constraints

- **Branch and parts.**
  - Work on `feat/local-native-units` in this worktree, in the order A → B → C → D.
  - At the end of each part, mark its last commit with a local branch: `git branch feat/local-native-units-a` (then `-b`, `-c`). These are local markers only. Part D's head is `feat/local-native-units`.
  - Push nothing and open no PR until the owner says to, for that act. Then name each target:
    - PR 1: `kizuna-ai-lab/sokuji` `feat/local-native-units-c` (parts A–C) into `main`;
    - PR 2: `kizuna-ai-lab/sokuji` `feat/local-native-units` (part D) into `main`, after PR 1 merges (rebased onto it).
- **The renderer ↔ engine protocol does not change.** Another plan replaces the Python sidecar behind it with a TypeScript engine that speaks the same protocol; nothing here may depend on which engine answers, beyond the protocol and the launch variables of Task D3.
  - The message shapes in `src/lib/local-inference/native/nativeProtocol.ts` stay as they are.
  - At the end of every part, `git diff 17642a804 --stat -- src/lib/local-inference/native/nativeProtocol.ts` prints nothing (diffed against this plan's base, not `origin/main`, which moves).
- **Presence:**
  - `flagged: true`;
  - `testerSwitch: LOCAL_NATIVE_DEBUG_KEY` (`'debug:local-native'`, `src/utils/environment.ts`);
  - `platforms: ['electron']`, `kind: 'local'`.
  - A release offers it only with the tester switch on, or with `VITE_ENABLED_PROVIDERS=local_native`. The setup wizard does not change (ruling 12).
- **The old path stays compiled and unreachable**, untouched except where a task names it. It is:
  - `IClient`, `LocalNativeClient`, `LocalNativeProviderConfig`, `ProviderConfigFactory`, `ClientFactory`;
  - the `localNative` slice and `validateApiKey`'s native arm;
  - `VITE_ENABLE_LOCAL_NATIVE` and `isLocalNativeEnabled()`.
  - Deleting it is a later plan; the last section lists what goes.
- **No new locale key.**
  - Notices reuse the `settings.localNative*` sentences.
  - Names reuse `providers.local_native.name` ("Free (Native)") and `.description`. Both exist in every catalog.
- **Settings** persist under `settings.localNative.<field>`, with the old slice's field names (ruling 7). No migration code.
- **Language and comments.**
  - English in code, comments, commits and docs.
  - Production comments cite rulings as `#578 ruling N` (1–28, below), never plans, tasks or reviews.
  - The repository is public. Write no machine names, people, internal services or usage data. "A Linux arm64 machine with an NVIDIA GB10" is fine.
- **The session side** (`src/providers/sessionSide.consistency.test.ts`) imports no store and no reporter. It runs no global timer: every timer reads the request's clock. An adapter never calls `report()` or `console.*`.
- **Rule suites.**
  - Every adapter session test asserts that `checkConformance(log, context)` is `[]`.
  - Every translation session test asserts that `checkTranslation(log)` is `[]`.
  - Every speech session test asserts that `checkSpeech(log)` is `[]`.
- **How files move.**
  - Moves use `git mv`.
  - A #587 file comes over with `git show worktree-local-native-port:<path> > <path>`, then is adapted.
- **Baselines.** Record these once, before Task A1:
  - `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'`. No task raises the count, and no touched file has an error.
  - The failures of `npx vitest run`. No task adds one.
- **Commands.**
  - Run with Node 24 on `PATH`.
  - For a step, run `npx vitest run <paths>`.
  - Before each commit, run `npx vitest run` and tsc.
  - Run vite, Electron and the e2e suite only in this worktree, and only in Task D3.
- **Commits.**
  - Stage explicit paths (`git add <paths>`).
  - Use the conventional format.
  - End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Rulings

**From #587, kept.** Each is adapted where the note says.

1. **Place and presence.**
   - Flagged, with its tester switch, Electron only, `kind: 'local'`.
   - In `RELEASED` it sits right after `localInferenceProvider`, before Bing and Edge.
2. **No re-chunking.** Audio goes straight to the sidecar and the VAD worker. This holds for the whole unit and the transcription unit.
3. **`SentenceCut` moves to `src/lib/segmentation/sentenceCut.ts`.** The whole unit needs it: it cuts jobs every N sentences, and a provider imports no other provider's folder. The split translation unit uses the shared cutter (`src/lib/translation/cutter.ts`) instead.
4. **Two legs are refused by `admit`.**
   - The refusal is English detail with no code of its own.
   - Every unit's `admit` refuses `speaker` and `participant` together.
5. **Readiness says why by code.**
   - The six `native_*` codes are aliased to the `settings.localNative*` sentences.
   - Their notice target is `provider-options`, no longer `provider`.
6. **The provider owns `settings.localNative.*`.**
   - The store stops pruning and re-validating the old slice.
   - It takes its selections and mode from the caller.
7. **Old field names.** `S` keeps the old slice's fields, without the pair and the turn mode, plus `participantSystemPrompt`.
8. **The whole unit streams translation partials into its segment.** The split translation unit does not (ruling 21).
9. **Speech ranges.**
   - One-shot synthesis: one ranged clip per sentence.
   - Streaming synthesis: chunks unranged, then the sentence's range is tiled over them (`tileSpan`) through `speechRanges`.
10. **Failures by effect.**
    - The ASR, translation or VAD socket or worker dying gives `failed`.
    - TTS dying, failing to load, or a clone-only model with no clip gives `tts_degraded`.
11. **The old path and its gates stay** until the owner's live test.
12. **The setup wizard does not change.**
13. **The Engine gets the app's preview port.** `ProviderEngine` passes `preview` again.
14. **Resolved plans travel through an injected host**, now `NativeHost` (ruling 18). The device badges read them.
15. **Load order.** The whole unit keeps ASR first (`asrFirst`, from the catalog's tiers and sizes). Split units follow the composite's fixed order (ruling 26).
16. **`check` passes `textOnly: false`.** TTS never gates readiness.

**Added here.**

17. **Four units, mirroring LocalInference:** `whole`, `transcription`, `translation`, `speech`. For a line-up all on Local Native, the composer takes the whole unit, because it takes the fewest units first.
18. **One port, `NativeModels`.** Builders, `admit`, `check` and `watchReadiness` read this device's native facts from it.
    - A unit's start reads the port's session-side half, `NativeHost`, from its config (`config.host`). `StartRequest` carries no shared settings.
19. **Capabilities state only what is structural.**
    - The split translation unit `translates(source, target)` when the source is fixed (not `auto`), the target is fixed, and the two differ. The sidecar loads one fixed pair.
    - The speech unit declares no `speaks`.
    - Whatever depends on the sidecar's runtime catalog belongs to readiness (`native_translation_missing`) or to the build (a leg built silent, said at open).
20. **Readiness by stage.**
    - The engine's lifecycle gates every unit: engine absent, an update due, unavailable, starting.
    - The ASR model gates only a unit that transcribes. The translation model gates only a unit that translates. TTS never gates (ruling 16).
21. **The split translation unit gives one final answer per job**, like every other job translator, with no partials.
    - Its job timeout is 60 s (`NATIVE_JOB_TIMEOUT_MS`).
    - The renderer client's 30 s request timeout (`SidecarConnection.ts:4`) answers first. The job then reports `translation_failed`, as the whole unit does.
22. **Co-loaded models for the split translation unit.** `translate_init` is told:
    - the ASR model, when `shared.lineUp?.transcription === 'local_native'`;
    - the TTS model, when `shared.lineUp?.speech === 'local_native' && shared.speaks`.
    - Both resolve with the same selections. Counting a model that does not load is safe.
    - The ASR case is defensive only: when transcription and translation are both Local Native the composer takes the whole unit (ruling 17), so no real plan reaches it. Its tests say so in their names.
23. **A clock is injected.**
    - `SidecarConnection.request` and the TTS stream's timers read a `Clock` they are given. The default is `realClock`.
    - Every native unit passes its request's clock.
24. **TTS ranges per sentence.**
    - A sentence's range is offset by its stretch's `span`.
    - In the speech unit, audio indices come from `request.counts`.
    - `NativeSpeechEmit.audio` returns the index the entry got, and `speechRanges` names those indices.
25. **`admit` dispatches by config shape.** Each unit refuses two legs (ruling 4). The detail names the unit.
26. **Split units follow the composite's fixed open order** (spec §7.4): speech, not awaited; then translation; then transcription.
27. **Where the native library lives: Models and storage, beside the in-app models** (decided).
    - Part B keeps a stopgap inside Local Native's Engine (a slot's Browse shows that stage of the library under the slots), so testers can download models from PR 1.
    - Task D1 moves it to Models and storage and removes the stopgap.
28. **Decided for the tester phase, revisited before release** (the earlier open questions):
    - Native voices stay in the library's TTS card; they do not move to the speech card yet.
    - Both is refused whenever a Local Native unit is in the line-up (ruling 4), including a voice-only leg.
    - A Local Native voice alone keeps the engine gate (ruling 20). Once the engine ships inside the app, the gate never trips.
    - Languages stay the static lists from the in-app manifest.
    - The picker keeps it right after This device (ruling 1).

### Accepted differences (internal; tell the owner)

1. **A unit's config carries a port reference** (`host: NativeHost`), not only data. `describe` and `admit` ignore it.
2. **The generic API grows again for one provider:**
   - `SharedSettings.nativeModels?`;
   - `CheckContext.nativeModels?`;
   - `RunnerDeps.nativeModels?`;
   - a third argument for `watchReadiness`.
   - A local provider's check is handed both ports.
3. **The native readiness gate's input gains** `selections` and `mode` (from #587), and `needs` (ruling 20).
4. **In Part B, Local Native has only a whole unit and is not end to end.** `capsOf.test.ts`'s `NOT_END_TO_END` lists it until Task C4.
5. **Every pin of the registry order moves:** the registry test, the Gemini and LocalInference neighbour pins, and any test that lists `RELEASED`.
6. **Spec deviations.** §4.3 step 3 wants the speech unit to offer the target; ruling 19 declares no `speaks`, so an unsupported target is said at open instead. §7.2's `recycle` is not implemented: the engine's ASR socket does not reconnect.

## Review Focus

1. **The sidecar dies mid-session.**
   - A person expects the leg to end with a notice. A silent leg that transcribes nothing is wrong.
   - Losing the voice must only degrade speech.
   - Pinned:
     - Task B3: "a closed ASR socket fails the session".
     - Task C2: "a closed socket fails the session and nothing follows".
     - Task C3: "a closed socket degrades speech once, and nothing more is read".
     - Task D3: "the sidecar killed mid-session ends it with a notice @real".
2. **Readiness that churns.**
   - `check` refreshes model statuses, and the watch listens to the store. A person expects one re-check per real change, never a loop.
   - A download that is running must keep its status.
   - Pinned in Task A4: the watch's de-duplication and `starting` cases. Pinned in Task B4: `check.driver.test.ts`.
3. **Both legs with any Local Native unit.**
   - A person expects a clear refusal at Start. Two legs must never fight over one engine per stage.
   - This includes a Local Native voice beside another provider's text.
   - Pinned in Task C4: "refuses two legs whatever unit the configs are".
4. **A tester's saved choices.**
   - Models, devices and voice stored under `settings.localNative.*` read as they were.
   - An old stored `settings.provider = 'local_native'` becomes an all-Local Native line-up where the provider is offered. Where it is not, it falls back as today.
   - Pinned in Task B1: "reads the old slice's saved fields as they are". Pinned in Task B6: the storage prefix and the `migrate` case.
5. **A Local Native stage beside another provider's.**
   - A Local Native voice or translation alone must not ask for a recognition model.
   - A pair no catalog model translates is refused by readiness (`native_translation_missing`, leading to the provider's options), not at the start.
   - Pinned in Task C4: "asks the gate for the models its stages need", and the composition table.

---

## Part A — Groundwork (no user-visible change)

### Task A1: The native readiness gate takes selections, mode and needs from its caller

**Files:**
- Modify `src/lib/local-inference/native/nativeCatalog.ts`.
  - Add `export interface NativeNeeds { asr: boolean; translation: boolean }`.
  - `NativeReadinessInput` gains three members:
    - `selections: Selections`;
    - `mode: 'speaker' | 'participant' | 'both'`;
    - `needs?: NativeNeeds`.
  - The doc follows #587's diff, plus this line on `needs`: "the stages whose model the caller's start would load; absent, both. A stage not needed never blocks (#578 ruling 20)."
- Modify `src/stores/nativeModelStore.ts`. Re-apply #587's diff by hand: main added `bundleUsage` / `refreshBundleUsage` beside one of the deleted calls.
  - `ensureSelectionReady` reads `selection, selections, mode, textOnly, needs` from `read()`. It imports neither `settingsStore` nor `audioStore` for them.
  - The verdict is `ready = (!needs.asr || !!mandatory.asr) && (!needs.translation || !!mandatory.translation)`, with `needs` defaulting to both.
    - The reason is `'asr-incompatible'` when ASR is needed and missing; otherwise it is `'translation-incompatible'`.
    - The lifecycle reasons come first, unchanged.
  - `applyPrunes` and `revalidateNativeProvider` go, with every call to them (#578 ruling 6).
  - `catalogStatusRepos` reads its pins from `useProviderStore.getState().entries.local_native?.settings` (`selections`), through a dynamic import, as #587 does.
  - `refresh` never overwrites a running download's status (#587, 15e184ad4).
- Modify `src/stores/settingsStore.ts`. The old arm's thunk adds `selections: get().localNative.selections, mode: useAudioStore.getState().mode`. It passes no `needs`.
- Test: `src/stores/nativeModelStore.test.ts`.

**Interfaces:**
- Produces:
  - `NativeNeeds`;
  - `NativeReadinessInput { selection; selections; mode; textOnly; needs? }`;
  - `useNativeModelStore.getState().ensureSelectionReady(read: () => NativeReadinessInput)`, whose signature is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - Bring over #587's new cases, with its wording:
    - "resolves against the selections the caller hands in, never the old slice (#578 ruling 6)";
    - "writes nothing back, not even a dead id it found (#578 ruling 6)";
    - "the mandatory leg follows the caller's mode, not audioStore";
    - "notes a dead id on the PARTICIPANT direction and leaves it in place";
    - "an explicit variant pin in Local Native's own settings wins over the recommendation (#578 ruling 6)";
    - "never overwrites a running download: the download sets the final status (#578)";
    - "retrySidecar boots the sidecar and leaves the old store's validation alone (#578 ruling 6)".
  - Delete the cases of the behaviour that goes:
    - "applyPrunes writes to the localNative slice";
    - "prunes a dead id seeded on the PARTICIPANT-direction …";
    - "retrySidecar re-runs provider validation …".
  - Add:

```ts
it('a caller that needs no recognition model is ready without one (#578 ruling 20)', async () => {
  // catalog and statuses: a downloaded translation model for ja→en, no ASR card for ja
  const r = await useNativeModelStore.getState().ensureSelectionReady(() => ({ ...INPUT, needs: { asr: false, translation: true } }));
  expect(r).toMatchObject({ ready: true, reason: 'ready' });
});
it('a caller that needs no model at all is ready once the engine is, and answers the lifecycle first', async () => {
  // nothing downloaded; sidecar ready
  expect((await ensure({ needs: { asr: false, translation: false } })).ready).toBe(true);
  // bundle absent
  expect(await ensure({ needs: { asr: false, translation: false } })).toMatchObject({ ready: false, reason: 'engine-absent' });
});
it('with no needs given, both are needed, as before', async () => { /* ASR missing → 'asr-incompatible' */ });
```

- [ ] **Step 2:** Run `npx vitest run src/stores/nativeModelStore.test.ts`. Expected: the new and rewritten cases FAIL.
- [ ] **Step 3:** Make the changes listed under Files.
- [ ] **Step 4:** Verify.
  - Run `npx vitest run src/stores src/lib/local-inference/native`. Expected: PASS.
  - `git grep -n "applyPrunes\|revalidateNativeProvider" -- src/stores src/lib/local-inference/native src/components` prints nothing (`src/providers/localInference/check.ts:15` mentions `applyPrunes` in a comment and stays).
  - Then run the full suite and tsc.
- [ ] **Step 5:** Commit `refactor(native): readiness takes its selections, mode and needs from the caller; the store writes no settings (#578)`, with `src/lib/local-inference/native/nativeCatalog.ts src/stores/nativeModelStore.ts src/stores/nativeModelStore.test.ts src/stores/settingsStore.ts`.

### Task A2: The native UI takes settings, update and pair from its host

**Files:** re-apply #587's diffs (85f6cd810, ec7eecb14) to these files.
- `src/lib/local-inference/native/nativeCatalog.ts`. Add `export type NativeDevice = 'auto' | 'cpu' | 'gpu'`.
  - It replaces the local `DeviceMode` (`NativeDeviceControl.tsx:11`) and `DeviceSetting` (`SlotDeviceBadge.tsx:9`).
  - It lives in lib so that Local Native's settings (Task B1) can name it without importing a component.
- `src/components/Settings/engine/useNativeEngineAdapter.ts` (+ test). It declares the override types itself, as `useWasmEngineAdapter.ts` declares `WasmEngineAdapterOverride`. No provider folder exists yet.
- `src/components/Settings/engine/SlotDeviceBadge.tsx` (+ test). It takes `setting`.
  - A pinned setting shows alone.
  - On Auto, the badge shows the device a run used, or nothing at all.
- `src/components/Settings/sections/NativeDeviceControl.tsx` (+ test). It takes `value` and `onChange`.
- `src/components/Settings/sections/NativeModelManagementSection.tsx` (+ `NativeModelManagementSection.test.tsx` and `.licenseGate.test.tsx`). It takes `settings`, `update` and `pair`.
- Drop #587's edits to `StoragePage.tsx` and `ProviderSpecificSettings.tsx`. Both are deleted on main.

**Interfaces:**
- Produces `NativeDevice` in `nativeCatalog.ts`, and these in `useNativeEngineAdapter.ts`:

```ts
export interface NativeEngineSettings { selections: Selections; asrDevice: NativeDevice; translationDevice: NativeDevice; ttsDevice: NativeDevice; ttsVoice: string }
export interface NativeEngineOverride { settings: NativeEngineSettings; update(patch: Partial<NativeEngineSettings>): void; pair: LanguagePair }
export function useNativeEngineAdapter(isSessionActive: boolean, override: NativeEngineOverride): EngineAdapter;
```

- `SlotDeviceBadge` props: `{ stage, modelId, id, setting: NativeDevice }`.
- `NativeDeviceControl` props: `{ stage, value: NativeDevice, onChange(device: NativeDevice): void, disabled? }`.
- `NativeModelManagementSection` props gain `settings: NativeEngineSettings`, `update`, and `pair: LanguagePair`. With no `direction` given, the pair is the host's.

- [ ] **Step 1: Write the failing tests.** Use #587's cases as written:
  - in `SlotDeviceBadge.test.tsx`, its ten cases, from "auto with nothing resolved draws nothing …" to "shows the setting it is handed";
  - in `useNativeEngineAdapter.test.ts`: "reads the host's pair and settings, and writes through its update (#578)";
  - in `NativeDeviceControl.test.tsx`, its five cases (three "reports … through onChange" and two others);
  - in `NativeModelManagementSection.test.tsx`:
    - "takes its pair from the host, not a settings store (#578)";
    - "lists the ASR cards of the host's source …";
    - "writes a device pick through the host's update".
- [ ] **Step 2:** Run `npx vitest run src/components/Settings`. Expected: FAIL.
- [ ] **Step 3:** Apply the diffs. Each component reads nothing of the old slice.
- [ ] **Step 4:** Verify.
  - `git grep -n "useLocalNativeSettings\|useUpdateLocalNative" -- src/components` prints nothing.
  - Run `npx vitest run src/components/Settings`. Expected: PASS.
  - Then run the full suite and tsc.
- [ ] **Step 5:** Commit `refactor(native-ui): the native model UI takes settings, update and pair from its host (#578)`, with the files listed above.

### Task A3: The sidecar clients run on a clock they are given; the VAD worker factory moves to lib

**Files:**
- Modify `src/lib/local-inference/native/SidecarConnection.ts`.
  - The constructor becomes `constructor(private readonly clock: Clock = realClock)`.
  - `Pending.timer` becomes `cancel: (() => void) | null`, set from `clock.setTimeout`. Every `clearTimeout` becomes `cancel?.()`.
- Modify `src/lib/local-inference/native/NativeTtsClient.ts`.
  - The constructor becomes `constructor(conn: ISidecarConnection = new SidecarConnection(), clock: Clock = realClock)`.
  - The stream's `arm` / `clear` use `clock.setTimeout` and its cancel.
  - `NativeAsrClient` and `NativeTranslateClient` do not change: their only timers are the connection's.
- Move: `git mv src/services/clients/createNativeVadWorker.ts src/lib/local-inference/native/createNativeVadWorker.ts`.
  - Fix its importers: `src/services/clients/LocalNativeClient.ts`, and the mocked path in `LocalNativeClient.test.ts`.
- Modify `src/providers/sessionSide.consistency.test.ts`.
- Tests:
  - `src/lib/local-inference/native/SidecarConnection.test.ts`;
  - `src/lib/local-inference/native/NativeTtsClient.test.ts`;
  - the `sessionSide` case below.

**Interfaces:**
- Produces:
  - `new SidecarConnection(clock?: Clock)`;
  - `new NativeTtsClient(conn?: ISidecarConnection, clock?: Clock)`;
  - `createNativeVadWorker` at its new path.
  - The defaults keep every existing caller as it is: the management client, the preview and the old client.

- [ ] **Step 1: Write the failing tests.**

```ts
// SidecarConnection.test.ts (its existing socket harness)
it('a request times out on the clock it was given, not the global one (#578 ruling 23)', async () => {
  const clock = createVirtualClock(0);
  const conn = new SidecarConnection(clock);
  const answer = conn.request({ type: 'ping' }); // connected through the harness
  clock.advance(29_999); await flush();
  expect(settled(answer)).toBe(false);
  clock.advance(1);
  await expect(answer).rejects.toBeInstanceOf(SidecarTimeoutError);
});
// NativeTtsClient.test.ts
it("a stream's first-chunk budget and inactivity bound run on the clock it was given (#578 ruling 23)", …);
// sessionSide.consistency.test.ts, in "a session side runs no global timer"
// The walk does not follow `src/lib/**`: the sidecar clients every native unit drives, by name (#578 ruling 23).
for (const file of ['SidecarConnection.ts', 'NativeAsrClient.ts', 'NativeTranslateClient.ts', 'NativeTtsClient.ts', 'createNativeVadWorker.ts']) {
  expect(globalTimerCalls(readFileSync(join(REPO_ROOT, 'src/lib/local-inference/native', file), 'utf-8')), file).toEqual([]);
}
```

- [ ] **Step 2:** Run `npx vitest run src/lib/local-inference/native src/providers/sessionSide.consistency.test.ts`. Expected: FAIL. `createNativeVadWorker.ts` is not found, and `SidecarConnection.ts` lists `setTimeout` and `clearTimeout`.
- [ ] **Step 3:** Make the changes. Rename nothing else. Inside the moved `createNativeVadWorker.ts`, the worker URL becomes `new URL('../workers/native-vad.worker.ts', import.meta.url)` (as #587 has it): the tests mock the factory, so a stale path would only show as a 404 in the e2e build.
- [ ] **Step 4:** Verify.
  - Run `npx vitest run src/lib/local-inference/native src/services src/providers/sessionSide.consistency.test.ts src/providers/oldPath.consistency.test.ts`. Expected: PASS.
  - Then run the full suite and tsc.
- [ ] **Step 5:** Commit `refactor(native): the sidecar clients run on a clock they are given; the VAD worker factory moves to lib (#578)`.

### Task A4: This device's native facts, handed in

**Files:**
- Create `src/lib/local-inference/native/nativeModels.ts`. It is types only and imports types only:
  - from `./nativeProtocol`: `NativeModelInfo`, `NativeVoiceInfo`, `HardwareInfoResultMsg`;
  - from `./nativeCatalog`: `NativeReadinessInput`, `NativeReadinessResult`, `VoiceCustom`;
  - from `../selection/types`: `DirectionResult`, `Selections`.
  - It must not import `nativeVoiceStores.ts`, whose storage reaches the reporter and a store. That would put a store in the run contract's import graph.

```ts
export type NativeStage = 'asr' | 'translation' | 'tts';
/** What a stage's init reply reports: the sidecar's resolved plan. */
export interface NativeInitReport { loadTimeMs?: number; backend?: string; device?: string; computeType?: string; rtf?: number; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string }
/** A stage's resolved plan, as the library's device badges read it. */
export interface NativePlan extends NativeInitReport { model: string; device: string }
/** The custom-clip store a voice is applied from: what a session reads of `NativeVoiceStore`. */
export interface NativeClipStore {
  list(): Promise<Array<{ id: number; name: string; hasTranscript?: boolean }>>;
  resolveApply(id: number): Promise<{ kind: 'clip'; audio: Float32Array; sampleRate: number; transcript?: string } | null>;
}
/** What a unit's session asks of the app around it (#578 ruling 14): voices, clip stores, the machine, and where each stage's plan is shown. */
export interface NativeHost {
  listVoices(modelId: string): Promise<NativeVoiceInfo[]>;
  voiceStore(custom: VoiceCustom, modelId: string): NativeClipStore | null;
  hardware(): Promise<HardwareInfoResultMsg | null>;
  plan(stage: NativeStage, plan: NativePlan): void;
}
/**
 * This device's native facts, as Local Native reads them (#578 ruling 18): what a direction resolves to among the
 * sidecar's catalog and downloads, the catalog and download sizes its builders read, the readiness gate, and when
 * any of it changes; and, for its sessions, the host. The app gives it (`src/stores/nativeModels.ts`) as it gives
 * `LocalModels`: a run to every builder (`SharedSettings.nativeModels`) and to `admit`, the provider store to a
 * local provider's check (`CheckContext.nativeModels`), the readiness driver to `watchReadiness`.
 */
export interface NativeModels extends NativeHost {
  resolve(source: string, target: string, selections: Selections): DirectionResult;
  catalog(): Readonly<Record<string, NativeModelInfo>>;
  sizes(): Readonly<Record<string, number>>;
  /** The gate; rejects with the abort reason when `signal` fires first. */
  ensureSelectionReady(read: () => NativeReadinessInput, signal?: AbortSignal): Promise<NativeReadinessResult>;
  /** Calls back once per change of what readiness reads (never while the sidecar is `starting`); returns the unsubscribe. */
  watch(onChange: () => void): () => void;
}
```

- Create `src/stores/nativeModels.ts`, which exports `nativeModels: NativeModels` and `nativeReadinessKey(state)`.
  - `nativeReadinessKey`, the de-duplicated `watch` and the abort race all move from #587's `local_native/check.ts`.
  - `plan` is #587's `bridge.ts` `plan`. `listVoices` is `nativeListTtsVoices`, `hardware` is `nativeHardwareInfo`, and `voiceStore` is `voiceStoreFor`.
  - Header: "This device's native facts behind the `NativeModels` port: the native model store and the clip stores, read through whatever Local Native is handed. The provider imports no store."
- Create `src/lib/local-inference/native/nativeModels.testing.ts`, which exports `fakeNativeModels(over: Partial<NativeModels> = {}): NativeModels`. Its defaults:
  - `resolve` answers every stage null;
  - `catalog` and `sizes` answer `{}`;
  - `ensureSelectionReady` resolves `{ ready: true, reason: 'ready', notes: [] }`;
  - `watch` returns a no-op;
  - `listVoices` answers `[]`; `voiceStore` and `hardware` answer `null`; `plan` is a no-op.
- Modify `src/lib/run/types.ts`. `SharedSettings` gains, after `localModels`:
  - `nativeModels?: NativeModels`;
  - documented: "This device's native facts (`NativeModels`): what a Local Native builder resolves through and hands its session (`config.host`). Set by the run when its deps have them; absent where the caller is not a run."
- Modify `src/lib/provider/types.ts`.
  - `CheckContext` gains `nativeModels?: NativeModels`.
  - The signature becomes `watchReadiness?(onChange: () => void, localModels: LocalModels, nativeModels: NativeModels): () => void`.
  - LocalInference's `watchReadiness` does not change.
- Modify `src/lib/session/ports.ts`. `RunnerDeps` gains `nativeModels?: NativeModels`.
- Modify `src/lib/session/run.ts`. `sharedOf` adds `...(deps.nativeModels ? { nativeModels: deps.nativeModels } : {})`.
- Modify `src/app/session.ts`. `createRunner` gets `nativeModels`.
- Modify `src/stores/providerStore.ts`. A `kind === 'local'` check gets `{ localModels, nativeModels }`.
- Modify `src/app/readiness.ts`. The call becomes `p.watchReadiness?.(() => inputsChanged(p.id), localModels, nativeModels)`.
- Modify `src/providers/localInference/provider.test.ts:358`: its two-argument `watchReadiness` call gains the third argument (`fakeNativeModels()`), or tsc's error count rises.
- Tests:
  - `src/stores/nativeModels.test.ts` (new);
  - `src/lib/session/runner.hooks.test.ts`;
  - `src/stores/providerStore.readiness.test.ts`;
  - `src/lib/session/appShape.test.ts`;
  - `src/app/readiness.test.ts`;
  - `src/lib/run/types.cycle.test.ts`, which does not change and must pass.

**Interfaces:**
- Produces:
  - `NativeStage`, `NativeInitReport`, `NativePlan`, `NativeClipStore`, `NativeHost`, `NativeModels`;
  - `nativeModels`, `nativeReadinessKey`, `fakeNativeModels`;
  - the three optional members, and the three-argument `watchReadiness`.

- [ ] **Step 1: Write the failing tests.**
  - In `nativeModels.test.ts`, mock `./nativeModelStore` and `voiceStoreFor`. The cases:
    - "resolve, catalog and sizes read the native model store when asked".
    - "ensureSelectionReady hands the store the caller's input, and rejects with the abort reason when the signal fires first". This is #587's `raceSignal`.
    - #587's `check.test.ts` watch and key cases, onto `nativeModels.watch` and `nativeReadinessKey`:
      - "calls back when what readiness reads changes";
      - "a refresh that changes nothing does not call back";
      - "a start that fails ends where it began: no call back (#578)";
      - "a start that succeeds calls back once, when the sidecar is ready";
      - "reads a running download as absent: its start re-checks nothing, its completion does (#578)".
    - #587's `bridge.test.ts` case: "files each stage's plan where the library's badges read it (#578 ruling 14)".
    - "listVoices, voiceStore and hardware reach the store's management socket and the clip stores".
  - The handing cases:

```ts
// runner.hooks.test.ts
it("hands every builder and admit this device's native models", async () => {
  const native = fakeNativeModels();
  await setup(withHooks({ admit }, { build }), ['speaker'], undefined, undefined, undefined, { nativeModels: native }).runner.start();
  expect(build.mock.calls[0][2].nativeModels).toBe(native);
  expect(admit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nativeModels: native }));
});
// providerStore.readiness.test.ts, beside the localModels case
expect(check.mock.calls[0][2].nativeModels).toBe(handed ? nativeModels : undefined);
// appShape.test.ts: the local check's exact context gains `nativeModels`
// readiness.test.ts
expect(watch).toHaveBeenCalledWith(expect.any(Function), localModels, nativeModels);
```

- [ ] **Step 2:** Run the six test files. Expected: FAIL.
- [ ] **Step 3:** Make the changes listed under Files.
- [ ] **Step 4:** Verify.
  - Run the five files, `src/lib/run`, and `src/providers/localInference`. Expected: PASS.
  - Then run the full suite and tsc.
- [ ] **Step 5:** Commit `refactor(native): this device's native facts behind a port, handed to builders, admit, checks and the readiness watch (#578)`.

- [ ] **Part A gate.**
  - Run the full suite and tsc against the baselines.
  - The protocol diff prints nothing.
  - Run `git branch feat/local-native-units-a`.

---

## Part B — The provider with its whole unit (flagged)

### Task B1: Settings, languages, the builder and admit

**Files:**
- Create `src/providers/local_native/settings.ts` (+ `settings.test.ts`) from #587.
  - `LanguagePair` comes from `../../lib/run/types`.
  - `NativeDevice` comes from `nativeCatalog.ts` (Task A2).
  - `NativeEngineSettings` and `NativeEngineOverride` now live in the hook, which no module of the provider imports but its views. `LocalNativeSettings` satisfies `NativeEngineSettings`. `LocalNativeEngine` hands it over, and the type checker holds it there.
- Create `src/providers/local_native/engineLegs.ts` from #587, with the import fixed.
- Create `src/providers/local_native/config.ts` (+ `config.test.ts`), rewritten from #587:
  - `LocalNativeConfig` is #587's, plus `host: NativeHost`.
  - `nativeModelsOf(shared: Pick<SharedSettings, 'nativeModels'>): NativeModels`. It throws `Error("The Local Native build was asked without this device's native models (SharedSettings.nativeModels).")`.
  - `buildLocalNative(context, s, shared)` is #587's, with these changes:
    - `facts.resolve(source, target, s.selections)`, `facts.catalog()` and `facts.sizes()` replace the store;
    - it sets `host: facts`.
  - `describeLocalNative`, `asrLoadsFirst` and `localInstructions` are #587's.
  - `oneSideAtATime(configs, detail): true | ProviderRefusal` refuses `configs.speaker && configs.participant` with `{ refused: detail }`.
  - `ONE_SIDE_AT_A_TIME = 'Local Native translates one side at a time: choose Me or Other.'`
  - `admitLocalNative(configs) = oneSideAtATime(configs, ONE_SIDE_AT_A_TIME)`.

**Interfaces:**
- Consumes: Task A4's `NativeModels`, `NativeHost` and `fakeNativeModels`.
- Produces:
  - `LocalNativeSettings`, `LOCAL_NATIVE_DEFAULTS`, `localNativeLanguages`;
  - `modeOfLegs`, `FALLBACK_PAIR`;
  - `NativeStageConfig { modelId; variant?; device: NativeDevice }`;
  - `LocalNativeConfig { asr; vad; translation; tts?; asrFirst; jobSentences?; host }`;
  - `nativeModelsOf`, `buildLocalNative`, `describeLocalNative`, `asrLoadsFirst`, `localInstructions`, `oneSideAtATime`, `ONE_SIDE_AT_A_TIME`, `admitLocalNative`.

- [ ] **Step 1: Write the failing tests.**
  - Use #587's `settings.test.ts` cases. One must read "reads the old slice's saved fields as they are" (Review Focus 4).
  - Use #587's `config.test.ts` cases (resolution, devices, the explicit pick, `no_asr`, transcription only, TTS only where the leg speaks, prompts, `jobSentences`, load order, `asrLoadsFirst`, describe, two legs). They are handed `{ nativeModels: fakeNativeModels({ resolve, catalog, sizes }) }`.
  - Add:
    - "resolves through the native models the run hands it, and hands its session their host" (`expect(config.host).toBe(facts)`);
    - "throws when the run hands it no native models".
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native`. Expected: FAIL.
- [ ] **Step 3:** Bring the files over and adapt them.
- [ ] **Step 4:** Verify. The same run: PASS. Then tsc.
- [ ] **Step 5:** Commit `feat(local_native): settings, languages and the builder over this device's native facts (#578)`.

### Task B2: The seams, the voice and the speech

**Files:** create these from #587, each with its test:
- `src/providers/local_native/engines.ts` (+ test);
- `fakeEngines.ts`;
- `voice.ts` (+ test);
- `speech.ts` (+ test).

**Interfaces:**
- Consumes: Task A3's clocked clients and the VAD path. Task A4's `NativeHost`, `NativeInitReport` and `NativeStage`, imported from `nativeModels.ts`. Re-export none of them.
- Produces:
  - `NativeAsrLike`, `NativeTranslationLike`, `NativeTtsLike`, `NativeTtsReady`, `NativeVadLike` (as #587).
  - `LocalNativeEngines { asr(clock: Clock): NativeAsrLike; translation(clock: Clock): NativeTranslationLike; tts(clock: Clock): NativeTtsLike; vad(): NativeVadLike }`.
  - `nativeAsr(clock, conn = new SidecarConnection(clock))`, likewise `nativeTranslation`, and `nativeTts(clock, conn)`, which builds `new NativeTtsClient(conn, clock)`.
  - `nativeVad(factory?)` and `nativeEngines`.
  - In `fakeEngines.ts`: `FakeNativeAsr`, `FakeNativeTranslation`, `FakeNativeTts`, `FakeNativeVad`, `createFakeNativeEngines()` (whose factories record the clock they were handed), and `createFakeNativeHost(over?)`. The host is typed over the lib `NativeHost` and records `plans`.
  - `voiceClipMissing(config, host)` and `applyVoice(tts, config, language, ready, host)`, as #587.
  - `speakNative(tts, text, lang, opts, emit, isEnded, clock)`, as #587, except that `NativeSpeechEmit.audio(pcm: Int16Array, range?: TextRange): number` returns the index the entry got among its row's audio. `ranges` names those indices (#578 ruling 24).

- [ ] **Step 1: Write the failing tests.**
  - Bring over #587's cases for engines, voice and speech.
  - Add to `engines.test.ts`: "every socket is opened on the clock it is handed (#578 ruling 23)". A request through each seam times out on a virtual clock.
  - Add to `speech.test.ts`: "streaming: the ranges name the indices `audio` returned". The emitter starts its indices at 5, and the `ranges` entries are 5, 6 and 7.
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native`. Expected: FAIL.
- [ ] **Step 3:** Bring the files over and adapt them.
- [ ] **Step 4:** Verify. The same run: PASS. Then tsc.
- [ ] **Step 5:** Commit `feat(local_native): the sidecar and VAD seams on the run's clock, the voice and the ranged speech (#578)`.

### Task B3: `SentenceCut` moves to lib; the whole unit's adapter

**Files:**
- Move `SentenceCut` (#578 ruling 3; #587 d51a1bf8c, re-done by hand because main changed the file):
  - `git mv src/providers/localInference/sentenceCut.ts src/lib/segmentation/sentenceCut.ts`;
  - `git mv src/providers/localInference/sentenceCut.test.ts src/lib/segmentation/sentenceCut.test.ts`.
  - Fix the imports in `src/providers/localInference/adapter.ts` and in the moved test.
  - In `src/lib/translation/cutter.ts`, the header comment names the new path.
  - In `src/providers/sessionSide.consistency.test.ts`:
    - LocalInference's session-side list drops `sentenceCut.ts`;
    - add `expect(globalTimerCalls(<src/lib/segmentation/sentenceCut.ts>)).toEqual([])` beside the `continuousSegments` line.
- Create `src/providers/local_native/adapter.ts` (+ `adapter.test.ts`) from #587. The changes:
  - The factory is `createLocalNativeAdapter(engines: LocalNativeEngines = nativeEngines): Adapter<LocalNativeConfig, LocalNativeCredentials>`. The host is `request.config.host`.
  - Every seam is made with `request.clock`: `engines.asr(request.clock)`, and so on.
  - A job's answer `segmentText` carries `stableLen: text.length`. Partials carry none. A speech unit beside the whole unit can then read the answer before the segment closes (spec §7.1).
  - `speak` hands `speakNative` an `audio` emitter that returns the ref's next audio index.

**Interfaces:**
- Consumes: Tasks B1 and B2.
- Produces:
  - `createLocalNativeAdapter`;
  - `LocalNativeCredentials = Record<string, never>`;
  - `VAD_INIT_TIMEOUT_MS`;
  - `SentenceCut`, `runtimeOver` and `SentenceCutOptions` from `src/lib/segmentation/sentenceCut.ts`.

- [ ] **Step 1: Write the failing tests.**
  - Bring over #587's 29 adapter cases, each with `checkConformance(log, context)` equal to `[]`. Their configs carry `host: createFakeNativeHost()`.
  - Among them, pin these by name:
    - "a closed ASR socket fails the session";
    - "stop during a streaming sentence emits nothing after";
    - "stop ends every seam before its first await".
  - Add:
    - "a translation's answer states all of it stable; a partial states none (#578 ruling 8)";
    - "every seam is made on the request's clock" (`createFakeNativeEngines` records the clock handed to each factory);
    - "the host it reports plans to is the one its config carries (#578 ruling 18)".
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native src/lib/segmentation src/providers/localInference src/providers/sessionSide.consistency.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Move the files, then bring the adapter over and adapt it.
- [ ] **Step 4:** Verify. The same run: PASS. Then the full suite and tsc.
- [ ] **Step 5:** Commit `feat(local_native): the whole session's adapter on the client contract; SentenceCut moves to segmentation (#578)`.

### Task B4: Readiness — check, codes and their words

**Files:**
- Create `src/providers/local_native/check.ts` (+ `check.test.ts`, + `check.driver.test.ts`), rewritten from #587:
  - `NATIVE_READINESS_CODES` and the English reasons are #587's.
  - `checkLocalNative(s, ctx)`:
    - It throws `Error("The Local Native check was asked without this device's native models (CheckContext.nativeModels).")` when `ctx.nativeModels` is absent.
    - It returns `facts.ensureSelectionReady(() => ({ selection: { sourceLanguage: ctx.pair.source, targetLanguage: ctx.pair.target }, selections: s.selections, mode: modeOfLegs(ctx.legs), textOnly: false }), ctx.signal)`, mapped to `CheckResult`.
    - No `needs` yet. Task C4 adds it.
- Modify `src/lib/view/noticeText.ts` (+ `noticeText.test.ts`). Add #587's six aliases, `native_engine_update_required` … `native_translation_missing`, to the `settings.localNative*` sentences.
- Modify `src/lib/view/noticeTargets.ts` (+ its test). The six codes go to `'provider-options'` (#578 ruling 5).

**Interfaces:**
- Consumes: Task A4's `NativeModels` and `nativeModels`.
- Produces: `checkLocalNative(s: LocalNativeSettings, ctx: CheckContext): Promise<CheckResult>` and `NATIVE_READINESS_CODES`.

- [ ] **Step 1: Write the failing tests.**
  - Bring over #587's check cases onto `fakeNativeModels`:
    - "hands the gate the pair, its own selections, the legs as a mode, and never text-only (#578 ruling 16)";
    - "says why by a code for every reason (#578 ruling 5)".
  - Add:
    - "passes the start's signal to the gate";
    - "throws when not handed this device's native models".
  - In `check.driver.test.ts`, bring over #587's driver case under `driveReadiness`: "a download started schedules no check, and keeps its status through the next window (#578)". It uses a stub provider whose `check` is `checkLocalNative` and whose `watchReadiness` is `(cb, _l, n) => n.watch(cb)`, over the real `nativeModels`.
  - In `noticeTargets`: "Local Native's six readiness codes lead to the provider's options (#578 ruling 5)".
  - In `noticeText`: #587's alias cases.
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native src/lib/view`. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Verify. The same run: PASS. Then tsc.
- [ ] **Step 5:** Commit `feat(local_native): readiness through this device's native facts, worded by code (#578)`.

### Task B5: The views; the Engine gets the preview port

**Files:**
- Create `src/providers/local_native/LocalNativeSettings.tsx` (+ test) from #587.
  - Wrap the speed in `<StagePart stages={SP}>` and the prompt in `<StagePart stages={TL}>`, as `LocalInferenceSettings.tsx:71-89` does.
  - A view may read the store.
- Create `src/providers/local_native/LocalNativeTurnDetection.tsx` (+ test) from #587, unchanged.
- Create `src/providers/local_native/LocalNativeEngine.tsx` (+ test). It is rewritten in the manner of `LocalInferenceEngine.tsx`:
  - `VoicePreviewContext.Provider value={preview ?? null}` (#578 ruling 13) wraps:
    - `<EngineSection isSessionActive={disabled} />`, the engine card, which renders only actionable states;
    - `<EngineSurface adapter={useNativeEngineAdapter(disabled, override)} effectiveMode={modeOfLegs(legs)} initialSlot onInitialSlotConsumed onBrowse={setBrowsing} />`;
    - and, while `browsing` is set, `<NativeModelManagementSection stageFilter={browsing.stage} direction={browsing.dir} settings update pair isSessionActive={disabled} />` (#578 ruling 27, Part B).
  - `override` is memoised on the pair's languages, as LocalInference's is.
  - No `EngineSummary`. Its only host is the development preview.
- Modify `src/components/Settings/engine/EngineSurface.tsx`. Add the optional prop `onBrowse?: (slot: SlotId) => void`. Absent, it keeps today's `navigateToSettings(LIBRARY_TARGET[slot.stage])`.
- Modify `src/components/providers/ProviderOwnSettings.tsx` (+ test). `ProviderEngine` passes `preview={appVoicePreview}`.
- Modify `src/lib/provider/types.ts`. `SettingsProps.preview`'s doc becomes "Set by `ProviderOwnSettings` for `Settings` and by `ProviderEngine` for `Engine`; absent elsewhere."

**Interfaces:**
- Consumes: Tasks A2, B1 and B2.
- Produces:
  - `LocalNativeSettingsView`;
  - `LocalNativeTurnDetectionSummary`, `…Controls`, `…Help`;
  - `LocalNativeEngine`;
  - `EngineSurface`'s `onBrowse`.

- [ ] **Step 1: Write the failing tests.**
  - Bring over #587's cases for the settings and turn-detection views.
  - In `LocalNativeEngine.test.tsx`:
    - "draws the engine card and the slots over the host's settings, update and pair";
    - "a slot's Browse shows that stage of the native library for the slot's direction, under the slots";
    - "hands its voice previews the app's route (#578 ruling 13)".
  - In `ProviderOwnSettings.test.tsx`: "ProviderEngine hands the Engine the app's preview port".
  - In the `EngineSurface` test: "a host's onBrowse takes the slot; without one, Browse goes to Models and storage".
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native src/components/providers src/components/Settings/engine`. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Verify. The same run: PASS. Then tsc.
- [ ] **Step 5:** Commit `feat(local_native): its Engine, settings and turn detection views; the Engine gets the preview port (#578)`.

### Task B6: The definition, the registry and every guard

**Files:**
- Create `src/providers/local_native/provider.ts` (+ `provider.test.ts`):

```ts
const adapter = createLocalNativeAdapter();

/** Local Native's definition: LocalInference's sibling on the Electron sidecar, flagged until it ships (#578 ruling 1). */
export const localNativeProvider: Provider<LocalNativeSettings, LocalNativeCredentials, LocalNativeConfig> & { id: 'local_native' } = {
  id: 'local_native', kind: 'local', platforms: ['electron'], flagged: true, testerSwitch: LOCAL_NATIVE_DEBUG_KEY,
  icon: KizunaAIIcon, guideUrl: 'https://sokuji.kizuna.ai/docs/tutorials/local-native-setup',
  settings: { key: 'localNative', defaults: LOCAL_NATIVE_DEFAULTS },
  Settings: LocalNativeSettingsView, settingsStages: [TR, TL, SP], Engine: LocalNativeEngine,
  TurnDetection: { Summary: LocalNativeTurnDetectionSummary, Controls: LocalNativeTurnDetectionControls, Help: LocalNativeTurnDetectionHelp },
  credentials: { keys: [], fields: () => [], read: () => ({}) },
  check: (_k, s, ctx) => checkLocalNative(s, ctx),
  // Its models are per direction and its gate reads the audio mode: a pick or a mode switch is a new answer.
  checkReadsDirection: true,
  watchReadiness: (onChange, _local, native) => native.watch(onChange),
  languages: localNativeLanguages,
  units: [wholeUnitOf<LocalNativeSettings, LocalNativeCredentials, LocalNativeConfig>({
    speech: 'optional', textInput: () => true, boundaries: () => 'provider', turns: () => ['auto', 'manual'],
    build: buildLocalNative, describe: describeLocalNative, start: adapter.start,
  })],
  session: { admit: (configs) => admitLocalNative(configs) },
};
```

- Modify `src/providers/registry.ts`. Insert `localNativeProvider` right after `localInferenceProvider` in `RELEASED`, and add "and, flagged, Local Native (#578 ruling 1)" to its doc.
- Modify `src/providers/registry.test.ts`:
  - `WHOLE` gains `'local_native'`.
  - The `checkReadsDirection` list becomes `['local_inference', 'local_native']`.
  - `PORTED` gains `'local_native'` after `'local_inference'`. The storage-prefix case then pins `localNative`.
  - The release build's whole list (`:409`) gains it after `local_inference`.
- Modify the neighbour pin in `src/providers/gemini/provider.test.ts`: `slice(0, 7)`, with `local_native` fourth. `localInference/provider.test.ts:339` (`slice(0, 3)`) still holds unchanged.
- Modify `src/lib/lineup/catalog.testing.ts`. `RELEASED_CAPS` gains, after `local_inference`:
  - `{ id: 'local_native', stages: ALL, host: 'local_native', joint: ['transcription', 'translation'], account: 'none', voiceAlone: false, takesVoice: true }`.
- Modify `src/lib/plan/capsOf.test.ts`. `NOT_END_TO_END` gains `'local_native'`, commented "its whole unit alone until its split units come (Part C of this port)". Task C4 removes it.
- Modify `src/providers/sessionSide.consistency.test.ts`. Pin the session side:
  - `expect(sessionSide(REPO_ROOT, 'src/providers/local_native')).toEqual([adapter.ts, engines.ts, speech.ts, voice.ts])`, each under `src/providers/local_native/`;
  - and `not.toContain` `config.ts`, `check.ts` and `provider.ts`.
- Create `src/providers/local_native/noStoreRead.test.ts`, LocalInference's twin: "no module of Local Native but its views (.tsx) imports a store".
- Modify `src/providers/settingsStages.consistency.test.ts`. The `CASES` row is `['local_native', localNativeProvider, src('providers/local_native/LocalNativeSettings.tsx') + '<StagePart stages={TR}><StagePart stages={TL}><StagePart stages={SP}>']`.
- Modify `src/lib/lineup/migrate.test.ts`. Add: "an old stored Local Native becomes its own line-up on every stage (#578)": `lineUpFromToday({ provider: 'local_native', local: null })` gives `local_native` on all three stages under the released catalog.
- Modify every other test whose expectations list the registry order. The full run finds them. Change order pins only, never a behaviour expectation.

**Interfaces:**
- Consumes: Tasks B1–B5.
- Produces: `localNativeProvider`, and `'local_native'` in `ProviderId`.

- [ ] **Step 1: Write the failing tests.**
  - `provider.test.ts` brings over #587's three cases (id and slice key, presence, capabilities) and adds:
    - "declares its whole session as its one unit, which speaks optionally" (`units.map((u) => u.id)` equals `['whole']`);
    - "asks the native models it is handed when it watches (#578 ruling 18)";
    - "admit refuses two legs and admits one (#578 ruling 4)".
  - Then make the guard edits above.
- [ ] **Step 2:** Run `npx vitest run src/providers src/lib/plan src/lib/lineup`. Expected: FAIL. The provider is not registered.
- [ ] **Step 3:** Write the definition and register it.
- [ ] **Step 4:** Verify.
  - Run `npx vitest run`. Fix order pins only.
  - A failing invariant in `registry.test.ts` is the definition's to fix, never the invariant's.
  - Then run tsc.
- [ ] **Step 5:** Commit `feat(local_native): register Local Native on the provider structure, flagged, as its whole session (#578)`.

- [ ] **Part B gate.**
  - Run the full suite and tsc against the baselines.
  - The protocol diff prints nothing.
  - `git grep -n "stores/" -- 'src/providers/local_native/*.ts' ':!*.test.ts'` prints nothing.
  - Run `git branch feat/local-native-units-b`.

---

## Part C — The three split units

### Task C1: The transcription unit

**Files:**
- Modify `src/providers/local_native/config.ts`:
  - `LocalNativeConfig` gains `transcribesAlone?: true`;
  - add `noAsr(source): ProviderRefusal`, which is `{ refused, code: 'no_asr', params: { source } }`, the refusal `buildLocalNative` already gives.
- Modify `src/providers/local_native/adapter.ts`. Over a config with `transcribesAlone`, as `src/providers/localInference/adapter.ts:346,399,610` does:
  - no `translation_unavailable`, at the start or on typed text;
  - each final's closing `segmentText` carries `heard: { pieces: [], stableLen: text.length }`.
- Create `src/providers/local_native/transcriptionUnit.ts` (+ test), mirroring `localInference/transcriptionUnit.ts`:
  - `NATIVE_TRANSCRIPTION_UNIT = 'transcription'`.
  - `buildNativeTranscription(context, s, shared)` resolves the leg's ASR through `nativeModelsOf(shared)`, or refuses with `noAsr`. Its config is:
    - `asr` with its device;
    - `vad`;
    - `translation: null`, no `tts`, no `jobSentences`;
    - `asrFirst: true`, `transcribesAlone: true`, `host`.
  - `createNativeTranscriptionUnit(deps: { engines?: LocalNativeEngines } = {})`:
    - `occupies` gives TR only for exactly TR.
    - `capabilities()` is `{ speech: 'never', turns: ['auto','manual'], turnOwner: 'either', boundaries: 'provider', textInput: true, faceToFace: false, participantSpeech: true }`.
    - `describe` gives `{ asrModel }`.
    - `start` refuses a config that would translate or speak, or is not `transcribesAlone`, with `AdapterStartError(…, 'build_refused')` before any seam is made. Otherwise it is the whole adapter's start.
  - `nativeTranscriptionUnit`.
  - `areNativeTranscriptionConfigs(configs)`: `'asr' in c && c.transcribesAlone === true`, for every given config.
  - `admitNativeTranscription(configs)` is `oneSideAtATime(configs, 'Local Native transcribes one side at a time: choose Me or Other.')`.
  - The whole unit, the composite and the hardware probe stay the adapter's. Only this unit and the whole unit probe.

**Interfaces:**
- Consumes: Tasks B1–B3.
- Produces: `NATIVE_TRANSCRIPTION_UNIT`, `buildNativeTranscription`, `createNativeTranscriptionUnit`, `nativeTranscriptionUnit`, `areNativeTranscriptionConfigs`, `admitNativeTranscription`, `noAsr`.

- [ ] **Step 1: Write the failing tests** in `transcriptionUnit.test.ts`. Every session case asserts `checkConformance` equals `[]`.
  - "occupies transcription alone, and nothing else";
  - "declares what the whole session declares for transcription, and never speaks";
  - "builds the leg's recognition model with the device the settings pin, and no translation or voice";
  - "refuses a direction with no recognition model (no_asr)";
  - "says no translation_unavailable, and each final states all of it stable";
  - "typed text is shown as a source and nothing more";
  - "refuses at start a config that would translate or speak, before any seam is made";
  - "a closed ASR socket fails the session";
  - "areNativeTranscriptionConfigs takes this unit's configs and no other unit's".
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native`. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Verify. The same run: PASS. Then tsc.
- [ ] **Step 5:** Commit `feat(local_native): its recognition as a unit of its own (#578)`.

### Task C2: The translation unit

**Files:**
- Create `src/providers/local_native/translationSession.ts` (+ test). It is the session side.
  - `NativeTranslationConfig { modelId: string; variant?: string; device: NativeDevice; instructions: string; wrapTranscript: boolean; coLoaded: { asrModel?: string; ttsModel?: string }; host: NativeHost }`.
  - `NATIVE_JOB_TIMEOUT_MS = 60_000`.
  - `startNativeTranslation(makeEngine: (clock: Clock) => NativeTranslationLike, request: TranslationStartRequest<NativeTranslationConfig, unknown>, events: TranslationEvents): TranslationSession`. It runs `createJobTranslator` with:
    - `open`: makes the engine on `request.clock`, `init`s the leg's pair, model, device, variant and `coLoaded` ids, and files `host.plan('translation', …)`.
      - It rejects with `Translation engine init failed: …`.
      - A source that is `auto` is refused with `AdapterStartError(…, 'build_refused')`.
    - `translate`: `engine.translate(text, instructions, wrapTranscript)`, framed `local.native.translation.start` / `.end`.
    - `close`: dispose.
    - `timeoutMs: NATIVE_JOB_TIMEOUT_MS`, `language: target`.
  - The engine's own callbacks (members of `NativeTranslationLike`, not of `JobTranslatorOptions`), wired in `open` the way `died()` is in `src/lib/local-inference/sessions/translationSession.ts:184-189`:
    - `onPartial` is left unset (#578 ruling 21).
    - An id-less `onError` is a frame (`local.native.translation.error`).
    - `onClosed` stops the jobs, then says `failed` (`The local engine stopped: …`, #578 ruling 10).
- Create `src/providers/local_native/translationUnit.ts` (+ test). It is the settings side.
  - `nativeTranslates(source: string, target: string): boolean` is `source !== AUTO && target !== AUTO && source !== target` (#578 ruling 19).
  - `coLoadedOf(context, s, shared, facts): { asrModel?: string; ttsModel?: string }` (#578 ruling 22).
  - `createNativeTranslationUnit(deps: { engines?: Pick<LocalNativeEngines, 'translation'> } = {})`:
    - `occupies` gives TL only for exactly TL.
    - `capabilities()` is `{ speech: 'never', turns: ['auto','manual'], turnOwner: 'either', boundaries: 'provider', textInput: false, faceToFace: false, participantSpeech: true, translates: nativeTranslates }`.
    - `build` refuses an `auto` source.
      - It resolves the leg's translation with its device (`s.translationDevice`) and `localInstructions` / `wrapTranscript` as the whole build does.
      - With none, it refuses `{ refused: 'No translation model for ${source} → ${target}.', code: 'native_translation_missing' }`.
    - `describe` gives `{ translationModel }`.
    - `startTranslation` is `startNativeTranslation((clock) => engines.translation(clock), request, events)`.
  - `nativeTranslationUnit`.
  - `areNativeTranslationConfigs(configs)`: `'instructions' in c && 'coLoaded' in c && !('asr' in c)`.
  - `admitNativeTranslation(configs)`: `oneSideAtATime(configs, "Local Native's translation runs one side at a time: choose Me or Other.")`.

**Interfaces:**
- Consumes: Tasks A4, B1 and B2. `createJobTranslator` and `JOB_TIMEOUT_MS` from `src/lib/translation/jobTranslator.ts`.
- Produces: `NativeTranslationConfig`, `NATIVE_JOB_TIMEOUT_MS`, `startNativeTranslation`, `nativeTranslates`, `coLoadedOf`, `createNativeTranslationUnit`, `nativeTranslationUnit`, `areNativeTranslationConfigs`, `admitNativeTranslation`.

- [ ] **Step 1: Write the failing tests.** Every session case records with `recordTranslation` and asserts `checkTranslation(log)` equals `[]`.

```ts
it.each([
  // [lineUp TR, lineUp SP, shared.speaks, expected]
  ['local_native', 'local_native', true,  { asrModel: 'asr-ja', ttsModel: 'tts-en' }],
  ['local_native', 'edge',         true,  { asrModel: 'asr-ja' }],
  ['soniox',       'local_native', true,  { ttsModel: 'tts-en' }],
  ['soniox',       'local_native', false, {}],
])('tells the sidecar the models the line-up co-loads: %s / %s, speaks %s (#578 ruling 22)', (tr, sp, speaks, expected) => {
  const config = nativeTranslationUnit.build(JA_EN, DEFAULTS, { ...SHARED, speaks, lineUp: { transcription: tr, translation: 'local_native', speech: sp }, nativeModels: facts });
  expect((config as NativeTranslationConfig).coLoaded).toEqual(expected);
});
it('with no line-up handed, co-loads nothing', …);
it('each job is one translation segment, whole and final; a partial from the sidecar shows nothing (#578 ruling 21)', async () => {
  // FakeNativeTranslation pushes onPartial('Hel') before answering 'Hello.'
  expect(texts(h.log)).toEqual([{ text: 'Hello.', stableLen: 6 }]);
});
```

  - Also:
    - "occupies translation alone; translates a fixed source into another language, and never `auto`";
    - "resolves the leg's translation model with its device, variant and prompt";
    - "refuses a direction with no translation model (native_translation_missing)";
    - "inits the sidecar's translation once, with the leg's pair, model, device, variant and co-loaded ids";
    - "files the translation's plan where the library's badges read it (#578 ruling 14)";
    - "a failed job says translation_failed and the next job runs";
    - "a job past NATIVE_JOB_TIMEOUT_MS says translation_timeout and the next runs";
    - "a closed socket fails the session and nothing follows (#578 ruling 10)";
    - "an id-less error is a Logs line, not a failure";
    - "an init that fails rejects the open; a cancelled start rejects at once";
    - "stop lets the socket go before its first await";
    - "areNativeTranslationConfigs takes this unit's configs and no other unit's".
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native`. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Verify. The same run: PASS. Then tsc.
- [ ] **Step 5:** Commit `feat(local_native): its translation as a unit of its own, one answer per job (#578)`.

### Task C3: The speech unit

**Files:**
- Create `src/providers/local_native/speechSession.ts` (+ test). It is the session side, built from #587's `speech.ts` and `voice.ts` and the TTS half of its adapter: `loadTts`, `ttsDied`, `speak`.
  - The config types:
    - `NativeVoiceConfig = NonNullable<LocalNativeConfig['tts']> & { host: NativeHost }`;
    - `NativeSpeechOff = { off: true; unavailable?: TtsUnavailableCode }`, with the code type from `src/lib/local-inference/sessions/speech.ts`;
    - `NativeSpeechConfig = NativeVoiceConfig | NativeSpeechOff`.
  - `startNativeSpeech(makeTts: (clock: Clock) => NativeTtsLike, request: SpeechStartRequest<NativeSpeechConfig, unknown>, events: SpeechEvents): SpeechSession`.
  - A silent leg says `unavailable` once at open, with `ttsMissing(code, target)`. Otherwise it behaves like `startLocalSpeech` (`src/lib/local-inference/sessions/speechSession.ts`):
    - **open.** `open()` never rejects. A clip missing for a clone-only model, a load that fails, or a voice that fails is said `tts_degraded` once, and nothing is read. Otherwise it `init`s the leg's target, files `host.plan('tts', …)`, applies the voice, and says `voice_fallback` when it substituted.
    - **reading.** Stretches are read one at a time, in order. Each one goes through `speakNative` (#578 ruling 24):
      - an entry is counted in `request.counts` before it is said, and `audio` returns that index;
      - a range is offset by `span[0]`;
      - `speechRanges` names the counted indices.
      - A stretch whose language is not the leg's target is not read: a frame says so. The voice loads one language.
    - **setOn(false)** drops the queue, and what is in flight is not heard.
    - **A closed socket** is said `tts_degraded` once (#578 ruling 10).
    - **close** lets it go.
- Create `src/providers/local_native/speechUnit.ts` (+ test). It is the settings side.
  - `createNativeSpeechUnit(deps: { engines?: Pick<LocalNativeEngines, 'tts'> } = {})`:
    - `occupies` gives SP only for exactly SP.
    - `capabilities()` is `{ speech: 'optional', turns: ['auto','manual'], turnOwner: 'either', boundaries: 'silence', textInput: false, faceToFace: false, participantSpeech: true }`, with no `speaks` (#578 ruling 19).
    - `build` gives `{ off: true }` when `!context.speech`.
      - It resolves the leg's TTS through `nativeModelsOf(shared)`.
      - With none, it gives `{ off: true, unavailable: shared.reversed(direction) ? 'participant_tts_missing' : 'speaker_tts_missing' }`.
      - Otherwise it gives the voice: device, `speed`, `voice`, the catalog's `voiceCapability`, and `host`.
    - `describe` gives `{ ttsModel }` or `{}`.
    - `startSpeech` is `startNativeSpeech((clock) => engines.tts(clock), …)`.
  - `nativeSpeechUnit`.
  - `areNativeSpeechConfigs(configs)`: `off === true`, or `'speed' in c && 'voice' in c && !('asr' in c)`.
  - `admitNativeSpeech(configs)`: `oneSideAtATime(configs, "Local Native's voice reads one side at a time: choose Me or Other.")`.

**Interfaces:**
- Consumes: Tasks A4, B1 and B2.
- Produces: `NativeVoiceConfig`, `NativeSpeechOff`, `NativeSpeechConfig`, `startNativeSpeech`, `createNativeSpeechUnit`, `nativeSpeechUnit`, `areNativeSpeechConfigs`, `admitNativeSpeech`.

- [ ] **Step 1: Write the failing tests.** Every session case records with `recordSpeech` and asserts `checkSpeech(log)` equals `[]`.

```ts
it("a one-shot sentence is one clip, ranged in the row's whole translation (#578 ruling 24)", async () => {
  session.speak(7, 'Good night.', [12, 23], 'en');
  await drain();
  expect(audio(h.log)).toEqual([{ ref: 7, range: [12, 23] }]);
});
it("streaming chunks come unranged, then their ranges follow, indexed by the row's shared count (#578 ruling 24)", async () => {
  request.counts.set(7, 2);                         // another voice already said two entries of row 7
  session.speak(7, 'Good night.', [12, 23], 'en');  // three chunks
  await drain();
  expect(ranges(h.log)).toEqual([{ ref: 7, ranges: [{ index: 2, range: expect.any(Array) }, { index: 3, range: expect.any(Array) }, { index: 4, range: expect.any(Array) }] }]);
  expect(request.counts.get(7)).toBe(5);
});
```

  - Also:
    - "occupies speech alone, speaks optionally, and says no `speaks`";
    - "a leg that does not speak is built silent";
    - "a leg with no voice for its target is built silent, and says so when it opens";
    - "resolves the voice with its device, speed, voice and the catalog's capability";
    - "open never rejects: a load that fails says tts_degraded once";
    - "a clone-only model with no clip is not loaded, and says so (#578 ruling 10)";
    - "applies the stored built-in voice before the first sentence; a substituted clip says voice_fallback";
    - "files the voice's plan where the library's badges read it";
    - "switched off mid-stretch: nothing more of it is heard; switched on, the next stretch is read";
    - "a stretch in another language than the leg's target is not read";
    - "a closed socket degrades speech once, and nothing more is read";
    - "close lets the socket go, and nothing follows";
    - "areNativeSpeechConfigs takes this unit's configs and no other unit's".
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native`. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Verify. The same run: PASS. Then tsc.
- [ ] **Step 5:** Commit `feat(local_native): its voice as a unit of its own, ranged by sentence (#578)`.

### Task C4: Four units, admit by shape, readiness by stage, and what composes

**Files:**
- Modify `src/providers/local_native/provider.ts`:
  - `units: [whole, nativeTranscriptionUnit, nativeTranslationUnit, nativeSpeechUnit]` (#578 ruling 17);
  - `session.admit` dispatches by shape, in this order:
    - `areNativeSpeechConfigs` → `admitNativeSpeech`;
    - then translation → `admitNativeTranslation`;
    - then transcription → `admitNativeTranscription`;
    - else `admitLocalNative`.
  - It reads no `shared` (#578 ruling 25).
- Modify `src/providers/local_native/check.ts`.
  - Add `needsOf(stages?: readonly RunStage[]): NativeNeeds`:
    - absent: `{ asr: true, translation: true }`;
    - else `{ asr: stages.includes('transcription'), translation: stages.includes('translation') }`.
  - The gate's input adds `needs: needsOf(ctx.stages)` (#578 ruling 20).
- Modify `src/lib/lineup/catalog.testing.ts`. The `local_native` row becomes `{ id: 'local_native', stages: ALL, host: 'local_native', account: 'none', voiceAlone: true, takesVoice: true }`.
- Modify `src/lib/plan/capsOf.test.ts`. Remove `'local_native'` from `NOT_END_TO_END`.
- Modify `src/providers/sessionSide.consistency.test.ts`.
  - `TRANSLATION_SESSIONS['src/providers/local_native'] = ['translationSession.ts']`;
  - `VOICE_SESSIONS['src/providers/local_native'] = ['speechSession.ts']`.
  - The pinned session side becomes `adapter.ts`, `engines.ts`, `speech.ts`, `speechSession.ts`, `translationSession.ts`, `voice.ts`.
  - It holds none of `transcriptionUnit.ts`, `translationUnit.ts`, `speechUnit.ts`, `config.ts`, `check.ts`, `provider.ts`.
- Create `src/providers/local_native/units.run.test.ts`, on the model of `localInference/transcriptionUnit.run.test.ts`. All engines are fakes, and every leg asserts `checkConformance` equals `[]`. The legs:
  - **(a)** Local Native transcription, the fake translator, the fake voice: one leg (`startComposite`, `separateStages`), and the run through `createRunner`.
  - **(b)** The fake transcriber, Local Native translation, the fake voice.
  - **(c)** The fake transcriber, the fake translator, Local Native speech.
  - **(d)** Both legs of (a) through `createRunner` (`admit` runs in the runner, `src/lib/session/run.ts:312`; `startCompositeBoth` never calls it), refused with Local Native's transcription detail.
- Create `src/providers/local_native/provider.compose.test.ts`.
- Tests: `provider.test.ts` and `check.test.ts`.

**Interfaces:**
- Consumes: Tasks C1–C3.
- Produces: `needsOf`, and the four-unit `localNativeProvider`.

- [ ] **Step 1: Write the failing tests.**

```ts
// provider.compose.test.ts — the real definitions, composed under the released catalog
// Built like `offeredWithBingAndEdge` in src/providers/localInference/provider.test.ts (settings: () => undefined),
// with the released catalog registered the way that file does; line-ups are written as { transcription, translation, speech } objects.
const offered: ComposeInput = { providers: [localNativeProvider, localInferenceProvider, bingProvider, edgeProvider, sonioxProvider], settings: () => undefined };
it.each([
  // line-up (TR, TL, SP)                             → [provider:unit per planned unit, in plan order]
  [['local_native', 'local_native', 'local_native'],   ['local_native:whole']],
  [['local_native', 'local_native', 'edge'],           ['local_native:whole', 'edge:speech']],
  [['local_native', 'bing', 'edge'],                   ['local_native:transcription', 'bing:translation', 'edge:speech']],
  [['local_native', 'local_inference', 'local_inference'], ['local_native:transcription', 'local_inference:translation', 'local_inference:speech']],
  [['local_inference', 'local_native', 'local_native'], ['local_inference:transcription', 'local_native:translation', 'local_native:speech']],
  [['soniox', 'soniox', 'local_native'],               ['soniox:stt', 'local_native:speech']],
  [['soniox', 'local_native', 'edge'],                 [`soniox:${SONIOX_TRANSCRIPTION_UNIT}`, 'local_native:translation', 'edge:speech']],
])('composes %j', (stages, expected) => {
  const [transcription, translation, speech] = stages;
  const plan = compose({ transcription, translation, speech }, offered) as RunPlan;
  expect(isRefusal(plan)).toBe(false);
  expect(plan.units.map((u) => `${u.provider.id}:${u.unit.id}`)).toEqual(expected);
});

// provider.test.ts
it('refuses two legs whatever unit the configs are, naming the unit (#578 rulings 4, 25)', () => {
  for (const [config, detail] of [[WHOLE, /^Local Native translates one side/], [TRANSCRIBES, /transcribes one side/], [TRANSLATES, /translation runs one side/], [VOICE, /voice reads one side/]] as const) {
    expect(localNativeProvider.session!.admit!({ speaker: config, participant: config } as never, {} as never)).toMatchObject({ refused: expect.stringMatching(detail) });
    expect(localNativeProvider.session!.admit!({ speaker: config } as never, {} as never)).toBe(true);
  }
});

// check.test.ts
it.each([
  [undefined, { asr: true, translation: true }],
  [['transcription', 'translation', 'speech'], { asr: true, translation: true }],
  [['transcription'], { asr: true, translation: false }],
  [['translation'], { asr: false, translation: true }],
  [['translation', 'speech'], { asr: false, translation: true }],
  [['speech'], { asr: false, translation: false }],
])('asks the gate for the models its stages need: %j (#578 ruling 20)', async (stages, needs) => {
  await checkLocalNative(DEFAULTS, { ...CTX, ...(stages ? { stages } : {}), nativeModels: facts });
  expect(lastInput().needs).toEqual(needs);
});
```

  - Also, in `provider.test.ts`:
    - "declares four units: its whole session, its recognition, its translation and its voice (#578 ruling 17)";
    - "a line-up all on Local Native runs its whole session".
  - Also, in `check.test.ts`: "a voice alone is held back only by the engine (#578 ruling 20)". The gate answers `engine-absent` → `native_engine_required`; it answers ready with no models → ok.
- [ ] **Step 2:** Run `npx vitest run src/providers/local_native src/lib/plan src/providers/registry.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Verify. Run `npx vitest run`, then tsc.
- [ ] **Step 5:** Commit `feat(local_native): four units, admitted by shape and readied by stage; any stage combines with another provider's (#578)`.

- [ ] **Part C gate.**
  - Do Task D4's `CLAUDE.md` and `CONTEXT.md` edits now, so PR 1 registers Local Native and says so in the same change; D4 later adds only the library's new place.
  - Run the full suite and tsc against the baselines.
  - The protocol diff prints nothing.
  - Run `git branch feat/local-native-units-c`.
  - Ask the owner about PR 1, naming its target (see Global Constraints).

---

## Part D — The surfaces, a real session and the record

Task D1 carries ruling 27 (decided: the library moves to Models and storage); D2 moves the other places that name only `local_inference`.

### Task D1: The native library on Models and storage

**Files:**
- Create `src/components/SettingsPage/NativeModelsGroup.tsx` (+ test). It renders on Electron, only when `presentProviders()` offers `local_native`:
  - The group's title is `t('providers.local_native.name')`, and its hint is `t('providers.local_native.description')`.
  - `<EngineSection isSessionActive={locked} />`.
  - For each stage, `<NativeModelManagementSection stageFilter={stage} … />`, under the anchors `native-models-asr`, `native-models-translation` and `native-models-tts`.
    - It is fed the `local_native` entry's `settings`, `update` (`useProviderStore.updateSettings`) and `pair`.
    - It sits inside `VoicePreviewContext.Provider value={appVoicePreview}`.
  - The entry loads as `ModelsCategory` loads LocalInference's.
- Modify `src/components/SettingsPage/ModelsPage.tsx`:
  - It renders `NativeModelsGroup` after the in-app groups.
  - While Local Native is offered, the "On-device engine" group's B-19 hint ("no longer uses it") is not shown: the engine's size and Remove stay, under the native group.
  - When Local Native is not offered, nothing changes.
- Modify `src/components/SettingsPage/categories.ts` (+ `categories.test.ts`). Add three targets, `native-models-asr|translation|tts`, each `{ category: 'models', anchor: <same> }`.
- Modify `src/providers/local_native/LocalNativeEngine.tsx` (+ test):
  - `onBrowse` navigates to `native-models-${slot.stage}`;
  - the inline library and the `browsing` state go;
  - `EngineSection` stays, because the `native_engine_required` sentence sends the user to the provider's options.

- [ ] **Step 1: Write the failing tests.**
  - In `NativeModelsGroup.test.tsx`:
    - "on the desktop with Local Native offered, lists its library by stage under the native anchors, fed its own settings";
    - "renders nothing where Local Native is not offered".
  - In `ModelsPage.test.tsx`: "without Local Native, the on-device engine row reads as before (B-19)".
  - In `categories.test.ts`: the three targets.
  - In `LocalNativeEngine.test.tsx`: "a slot's Browse opens that stage of the native library in Models and storage".
- [ ] **Step 2:** Run `npx vitest run src/components/SettingsPage src/providers/local_native`. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Verify. The same run: PASS. Then the full suite and tsc.
- [ ] **Step 5:** Commit `feat(settings): Local Native's model library on Models and storage (#578)`.

### Task D2: Accounts and keys, and the other `local_inference` spots

**Files:**
- Modify `src/components/SettingsPage/AccountsCategory.tsx` (+ `AccountsCategory.test.tsx`):
  - When Local Native is offered, a `kind: 'local'` row `{ key: 'local_native', name: t('providers.local_native.name'), serves: ['local_native'], guide, icon }` follows This device's row.
  - Its line reuses `settingsPage.accounts.localModels` / `localNone`. The counts are the native catalog's models with status `ready`, and the sum of their `sizes`.
  - It opens `models`.
- Checked, no change. The reason is given here, not in code:
  - `LineUpCategory.tsx:346` (`LocalVoices`): Local Native's voices sit in its library's TTS card. See open question 2.
  - `LineUpCategory.tsx:482` (`graniteDirect`), and History `src/lib/history/capture/facts.ts:43`: the sidecar has no speech-to-translation model, so a Local Native record always keeps its original text.
  - `src/lib/lineup/localStages.ts:20` (`HOST`): Local Native's resolution has no Bing or Edge among its choices, and its split units read `shared.lineUp` directly.
  - `src/lib/lineup/catalog.ts:91,126` (`belongsTo`, `hostDefaults`): Local Native's own line-up is itself on every stage. That is the default for a host that serves all three.
  - `src/lib/lineup/migrate.ts:27`: pinned in Task B6.
  - `src/stores/lineUpStore.ts` and `src/lib/plan/fromStores.ts` (`unstoredProvider === 'local_inference'`): Local Native unstored runs its whole plan, as any provider does.
  - `ModelsPage.tsx:103` (`runsHere`) and `:225`: these concern the in-app models and imported voices. The native library marks its own models in use itself (`NativeModelManagementSection`).

- [ ] **Step 1: Write the failing tests.**
  - "lists Local Native's row after This device when it is offered, counting the desktop engine's models";
  - "no Local Native row where it is not offered".
- [ ] **Step 2:** Run `npx vitest run src/components/SettingsPage/AccountsCategory.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Make the changes.
- [ ] **Step 4:** Verify. The same run: PASS. Then the full suite and tsc.
- [ ] **Step 5:** Commit `feat(settings): Local Native in Accounts and keys (#578)`.

### Task D3: A real session on the sidecar (`@real`)

**Files:**
- Create `e2e/specs/real-local-native.spec.ts`.
  - Every test's title ends `@real`.
  - It is skipped unless `HF_HOME` and an engine are set: `SOKUJI_SIDECAR_PYTHON` while the Python sidecar exists, `SOKUJI_NATIVE_DIR` after the engine switch. The spec reads either; nothing else in it depends on which engine answers.
  - The header says how to run it, what it covers of the owner's live test, and what it cannot cover.
- Modify `e2e/README.md`, adding a "Local Native (real sidecar)" section with the steps below.

**Running it** (on a Linux arm64 machine with an NVIDIA GB10 the sidecar runs on Vulkan; it has no CUDA backend):
1. **A sidecar interpreter.** Run `PYTHON=python3.12 SOKUJI_VENV=<scratch venv> sidecar/setup.sh --no-models`.
   - Check: `<venv>/bin/python -c "import sokuji_native as s; s.init(); print(s.__version__, s.devices())"` names the pinned native version and a `Vulkan0` device.
2. **A scratch model cache.**
   - Hard-link (`cp -al`) the cached models into a scratch `HF_HOME`:
     - ASR `sense-voice` Q8_0;
     - translation `qwen2.5-0.5b` q8_0;
     - TTS `pocket-tts-en` q8_0 with its `alba` voice, and `qwen3-tts-0.6b` q8_0 for the clone cases.
   - The app's delete and staging steps then never touch the user's caches.
   - The spec takes each id from the engine's `models_catalog` reply (read through the app), not from the engine's source.
3. **The build.** Run `npm run e2e:build` in this worktree only. The seeded tester switch offers the provider.
4. **The run.** Run `SOKUJI_SIDECAR_PYTHON=<venv>/bin/python HF_HOME=<scratch> HF_HUB_OFFLINE=1 npm run e2e:real -- real-local-native`.
   - The first Vulkan load compiles pipelines: allow minutes. The first test's timeout is 15 minutes.

**The seed** (`baseStorage('local_native')`, plus):
- `debug:local-native: '1'`;
- the line-up;
- `ja` → `en`;
- `settings.common.keepReplayAudio: 'true'`;
- `e2e.mic: 'speech'`;
- `settings.localNative.selections`: the three picks above, keyed `directionKey('ja', 'en')`;
- `settings.localNative.ttsVoice: 'builtin:alba'`;
- the devices per case.

**The tests** say the eight Japanese clips with `say()` and `PAUSES_MS`, and read History with `readHistory`. The thresholds are heard ≥ 7 of 8 and translated ≥ 6 of 8. Measure them on the first run and record them in the header. Change them later only with a measured reason.
1. "a session on the GPU: heard, translated and spoken @real"
   - Devices are on Auto.
   - The thresholds hold.
   - Some row has replay audio.
   - The record's stages name `local_native` three times.
   - The transcription card's ASR slot badge names the GPU backend (`Vulkan`).
2. "the same on the CPU @real"
   - All three devices are `cpu`.
   - The badges read `CPU`.
3. "typed text, a sentences display and push-to-talk @real"
   - A typed sentence appears as typed, with its English.
   - Under the sentences display (one per row), two clips said back to back give two rows.
   - Under push-to-talk, a clip said while the key is held gives one row after release.
4. "the voices: built-in, a custom clip, and a clone-only model with no clip @real"
   - `alba` gives audio and no `voice_fallback`.
   - `qwen3-tts-0.6b` with a clip imported through the library gives audio. The import uses `answerOpenDialog` with a 3–20 s mono WAV.
   - `qwen3-tts-0.6b` with no clip shows the `tts_degraded` notice while the subtitles go on.
5. "Start is refused for Both @real"
   - With the audio mode set to Both, the start's refusal reads "one side at a time".
6. "the sidecar killed mid-session ends it with a notice @real"
   - After the second clip, SIGKILL the engine: the child of the app's main process (`app.process().pid`) that listens on the port the renderer's sockets connect to (`page.on('websocket')` on `127.0.0.1`).
   - The session ends with the failure notice, and the rows heard so far stay.
7. "transcription here, Bing's translation and Edge's voice @real"
   - This test needs the network.
   - The line-up is `{ local_native, bing, edge }`.
   - The thresholds hold.
   - Edge audio arrives.
   - The record's stages name the three.
   - No frame sent on the sidecar's sockets (`page.on('websocket')` on `127.0.0.1`) is a `translate_init`.

**Not automated** (the header says so): how the voices sound, the real microphone path, the packaged bundle's install, the device-profile control, and the owner's sign-off. While the Python sidecar exists, its own GPU and loopback suites are optional, after the run: `SOKUJI_RUN_TTS_LOOPBACK=1` and `SK_TEST_TTS_GPU=1`.

- [ ] **Step 1:** Write the spec and the README section.
- [ ] **Step 2:** Run `npm run e2e` (the suite without `@real`, in this worktree). Expected: no new failure, and the new spec is not collected.
- [ ] **Step 3:** On the machine above, run steps 1–4.
  - Expected: all seven PASS.
  - Record the measured counts in the spec's header.
  - A real failure goes to `superpowers:systematic-debugging`. Do not loosen an assertion to pass it.
- [ ] **Step 4:** Commit `test(e2e): a real Local Native session on the sidecar (#578)` with the spec and the README.

### Task D4: The record

**Files:**
- Modify `CLAUDE.md`. Rewrite the lines that call Local Native an exception. Read main's text before editing it:
  - line 11;
  - Provider Architecture, `:102-109`;
  - Code Organization, `:297-300`;
  - Error Handling, `:359-360`;
  - Environment Variables, `:449-453`;
  - Adding a New AI Provider, `:513-515`.
  The new text says:
  - Local Native runs on the provider structure (`src/providers/local_native/`). It is flagged, Electron only, behind `debug:local-native` or `VITE_ENABLED_PROVIDERS=local_native`.
  - It has four units, like LocalInference's.
  - It reads this device's native facts through `NativeModels` (`src/stores/nativeModels.ts`).
  - `VITE_ENABLE_LOCAL_NATIVE` now gates only the old path.
  - The old path stays compiled and unreachable until the owner's live test.
  - The Native runtime section gains one line: the renderer's sidecar clients take the run's clock.
- Modify `CONTEXT.md`, entries 7, 8, 9, 13 and 24:
  - Local Native is in the registry, as its own folder;
  - keep "two PEER providers … no unifying layer". The port and the moved `SentenceCut` are no provider seam.
  - The old path's equivalents survive only until the deletion plan.

- [ ] **Step 1:** Edit both files.
  - `git grep -n "until kizuna-ai-lab/sokuji#578\|until #578" -- CLAUDE.md CONTEXT.md` prints only the lines about the old path's deletion.
- [ ] **Step 2:** Commit `docs: Local Native runs on the provider structure as four units (#578)`.

- [ ] **Part D gate.**
  - Run the full suite and tsc against the baselines.
  - The protocol diff prints nothing.
  - Ask the owner about PR 2, naming its target (see Global Constraints). PR 1 was asked about at the Part C gate.

---

## Open questions for the owner

None. The library's place is ruling 27; the tester-phase choices that were open here are ruling 28.

## Later: deleting the old path

After the owner's live test passes (ruling 11), a plan of its own deletes:
- **The old client:**
  - `src/services/clients/LocalNativeClient.ts` and its test;
  - `ClientFactory.ts` and `ClientFactory.localnative.test.ts`;
  - `punctuateDefinite.ts` and its test, if the old client is still its only importer.
- **The old descriptor:**
  - `src/services/providers/LocalNativeProviderConfig.ts`, `ProviderConfigFactory.ts`, `ProviderDescriptor.ts` and `localParticipantConfig.ts`;
  - their tests: `descriptorRegistry`, `localNativeGating`, `participantConfig`, `prepareToStart.local`.
- `src/services/interfaces/IClient.ts`.
- **In `src/stores/settingsStore.ts`:**
  - the `localNative` slice, `updateLocalNative`, `useLocalNativeSettings` and `useUpdateLocalNative`;
  - `validateApiKey`'s native arm and `msgForNativeReason`;
  - the `ProviderConfigFactory` reads.
- **In `src/stores/nativeModelStore.ts`:**
  - `asrLoading` / `ttsLoading` and their setters;
  - `lastResolutionNotes`, if nothing reads it.
- **In `src/utils/environment.ts`:** `VITE_ENABLE_LOCAL_NATIVE` and `isLocalNativeEnabled()`. The tester switch and `flagged` go when Local Native ships, after `VITE_ENABLED_PROVIDERS=local_native` at a release.
- **The wizard's dead native branch:**
  - `StepProviderPath.tsx:141`;
  - `LOCAL_NATIVE` in `OFFLINE_PROVIDERS` (`src/lib/setup/providerPath.ts:17`);
  - `Provider.LOCAL_NATIVE` (`src/types/Provider.ts`), if unused.
- `EngineStatusLine.tsx`, if still unmounted.
- `src/providers/oldPath.consistency.test.ts`. Its four `SHARED` leaves move out of `src/services/{clients,providers,interfaces}/`.
- The `CLAUDE.md` and `CONTEXT.md` lines about the old path.
- **This stays:** `LEGACY_SLICE_KEYS.local_native` (`'localNative'`), which is the storage prefix.
