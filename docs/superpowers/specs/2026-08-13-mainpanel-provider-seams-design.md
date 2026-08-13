# MainPanel Provider Seams — Design

**Date**: 2026-08-13
**Status**: Approved (brainstormed with user; audit run against `575c0c86`, spec verified against `5d4633fa` — MainPanel identical at both; adversarially reviewed, 29 findings incorporated)

## Summary

Remove provider-specific logic from `MainPanel.tsx` by widening `ProviderDescriptor` — the repo's own declared deep module ("answers *every* question about one provider", CONTEXT.md) — with the seams it is missing. After this refactor MainPanel dispatches on **capabilities and data, never on provider identity**; its only provider-naming call is `ProviderConfigFactory.getDescriptor(provider)`.

This is a pure refactor: **zero behavior change**, staged so every stage lands independently, is independently revertible, and deletes the MainPanel branches it replaces in the same commit that adds the seam.

## The problem, measured

A ten-agent audit of `MainPanel.tsx` (4509 lines) catalogued **75 provider-specific touchpoints covering 1314 unique lines — 29% of the file** — verified complete by mechanical grep cross-check. Every provider appears; the largest blocks:

| Lines | Providers | Mechanism |
|---|---|---|
| ~56 | kizuna_ai_soniox | managed lease budget countdown: state L1409-1452, JSX ×2 L4302-4306/L4448-4452 |
| ~37 | kizuna soniox, local ×2 | provider-specific init-label ladder ×2 L4262-4273/L4395-4404 + state/plumbing |
| ~150 | all eleven provider tags | `createParticipantSessionConfig` direction-reversal switch (L934-1085; the 14 registered descriptors map onto these 11 tags — 3 kizuna twins reuse base tags) |
| ~85 | kizuna_ai_soniox | managed cloned-voice preparation (L1974-2058, applied at L2245-2264) |
| ~120 | kizuna_ai_soniox | managed lease lifecycle: acquire (L2112-2184), release inside `afterBothLegs` (L1840-1851), abort release (lease portion of L2661-2699) |
| ~71 | openai | WebRTC→WebSocket fallback (L2287-2357) |
| ~79 | openai family | anti-drift anchor policy + wiring (L3794-3874) |
| ~30 | local ×2 | pre-start model-readiness revalidation (L1918-1947) |

History shows extraction alone does not arrest this: 8 pure-decision modules were extracted while the file grew 2527 → 4509 lines over the last true six months (+78%, 163 commits in that window; 283 lifetime), because each new provider mechanism still lands in MainPanel first — the descriptor cannot answer the question, so MainPanel switches on the enum.

The settings side (`ProviderSpecificSettings.tsx`) already dispatches on `config.capabilities.*`; MainPanel is the side that fell behind the repo's own standard.

## Gap → seam → stage map

The abstraction audit identified 12 gaps; one further touchpoint (mode vocabulary) is folded in:

| # | Audited gap | Seam | Stage |
|---|---|---|---|
| 1 | Participant (reverse-direction) session config | `buildParticipantSessionConfig` | S2 |
| 2 | Text-input support (hardcoded 5-provider list) | `capabilities.supportsTextInput` | S1 |
| 3 | System-instructions source (local prompt) | `capabilities.usesLocalPromptTemplate` | S1 |
| 4 | Transport policy (palabra forced webrtc) | `capabilities.forcedTransport` | S1 |
| 5 | PTT finalization strategy | `capabilities.pttFinalization` | S1 |
| 6 | Text queueing while AI responds | `capabilities.queuesTextWhileResponding` | S1 |
| 7 | Pre-start re-validation (local models) | `prepareToStart` + `revalidate` port | S4 |
| 8 | Managed session lease lifecycle | `acquireSessionResources` / `SessionResources` | S6 |
| 9 | Managed cloned-voice preparation | `prepareToStart` | S5 |
| 10 | Both-mode session shape | `planBothMode` | S3 |
| 11 | Auto-source reversal blocking | `reversesDirectionViaSourceLanguage` | S3 |
| 12 | Analytics enrichment | `describeSessionForAnalytics` | S8 (optional) |
| + | Mode-name vocabulary (`isPttLikeMode`) | `capabilities.pushGatedModes` | S1 |

## Decisions

| Decision | Choice |
|---|---|
| Mechanism | Widen `ProviderDescriptor` / `ProviderCapabilities`; no new registry, no parallel dispatch machinery |
| Dispatch rule | Capabilities and data only; `getDescriptor()` is the single provider-naming call left in MainPanel |
| Settings write-back | **Expose the existing module-private `updateProviderSlice(set, sliceKey, patch)` helper** (settingsStore.ts:685-701, already registry-driven via `PROVIDER_SLICE_REGISTRY`) as a public store action keyed by `descriptor.settingsSliceKey`. The write path is already generic internally; only the public surface is per-provider today. |
| `excludesNativeCapture` | **Dropped from the design.** `supportsWebRTC` already encodes native-WebRTC-capture semantics (palabra declares `false` while always running webrtc transport). S1 instead *re-documents* `supportsWebRTC` to say what it actually means, and adds only `forcedTransport`. |
| S8 hard cases (analytics, anchor policy, WebRTC fallback) | Specified here, staged last, **individually optional** — decided after S1–S7 land |
| Behavior | Unchanged. The full suite (2489 tests / 207 files at `5d4633fa`) passes at every stage boundary. A test may be relocated/rewired **only** when its stage moves the call site it wires, and the stage PR must list every modified test with the seam that moved it. |
| Comments | The per-provider rationale comments in the switches (e.g. palabra's code-space note at L1003-1017, the textOnly lease rule at L2140-2153) **move with the code** |

## Tier 1 — static capability flags (`ProviderCapabilities`)

Optional fields; only providers that deviate from the default declare them. Same home the settings side already reads.

```ts
export interface ProviderCapabilities {
  // ... existing fields ...

  /** Provider accepts typed text input into a live session. Default false.
   *  Kills MainPanel's hardcoded five-provider list. */
  supportsTextInput?: boolean;

  /** Queue text typed while the AI is responding, flush after. Default false
   *  (send immediately). Kills the OPENAI/OPENAI_COMPATIBLE special case. */
  queuesTextWhileResponding?: boolean;

  /** How a push-to-talk segment is finalized on release. Default
   *  { response: 'voice-gated' }. Kills usesLocalSileroVad() and the
   *  VOLCENGINE_AST2 five-silence-frame special case. */
  pttFinalization?: {
    silenceTailFrames?: number;          // trailing silence frames to flush VAD
    response: 'always' | 'server-decides' | 'voice-gated' | 'voice-gated-cancel';
  };

  /** Turn-detection mode names that behave as push-gated. Kills
   *  isPttLikeMode()'s knowledge that 'Disabled' is OpenAI's spelling of PTT. */
  pushGatedModes?: string[];

  /** System instructions come from the local prompt template
   *  (getProcessedLocalPrompt) instead of the shared system-instructions
   *  builder. Default false. Read by MainPanel when producing the (swapped)
   *  instructions it passes into buildSessionConfig /
   *  buildParticipantSessionConfig. */
  usesLocalPromptTemplate?: boolean;

  /** Transport this provider must run on, overriding the user preference.
   *  Kills the inline PALABRA_AI→'webrtc' mapping at L819. */
  forcedTransport?: TransportType;
}
```

S1 also updates `ProviderDescriptor.supportsWebRTC`'s doc comment to its real meaning ("MainPanel starts no native recorder; the client owns capture over WebRTC transport") — palabra's `supportsWebRTC = false` while always running webrtc transport is what falsifies the current comment.

`descriptorRegistry.test.ts` gains invariants covering **every** new flag: `pushGatedModes entries are unique non-empty strings drawn from the provider's settings vocabulary (turnDetection.modes is a settings-UI list — often empty — and is NOT a superset of the speech-mode vocabulary)`; `pttFinalization.silenceTailFrames` only with `response` set; `forcedTransport` implies the provider actually supports that transport; `usesLocalPromptTemplate` only on providers whose slice carries a local prompt; boolean flags simply asserted present-or-defaulted for all 14 registered descriptors.

## Tier 2 — sync config-transform methods (`ProviderDescriptor`, base defaults)

```ts
interface ProviderDescriptor {
  // ... existing ...

  /** Session config for the participant (reverse-direction) channel.
   *
   *  Returns null when this provider cannot run a participant leg right now
   *  (local providers: no ASR engine, memory exceeded) — MainPanel maps null
   *  to the existing participant-skip path (splitParticipantFailure =
   *  'no-participant-config'). `notices` carries the user-facing
   *  participant.error/.warning/.info events those branches emit today;
   *  MainPanel forwards them to addRealtimeEvent (side effects stay in the
   *  component, per house rule).
   *
   *  Base impl: buildSessionConfig(slice, swappedInstructions) + the two
   *  truly generic participant overrides (textOnly: true, semantic-VAD turn
   *  detection). Providers whose direction lives in config fields override to
   *  also reverse those fields; gemini's override additionally forces
   *  turnDetectionMode: 'Auto' (today's L949-951, which is gemini-only, NOT
   *  generic). `shell` carries the store-shell fields the old path read
   *  (keepReplayAudio). */
  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): {
    config: SessionConfig | null;
    notices: Array<{ channel: 'error' | 'warning' | 'info'; message: string }>;
  };

  /** Session shape for Both mode. Base: { shared: false, split: false }.
   *  Soniox overrides by delegating to sonioxBothModePlan. */
  planBothMode(slice: unknown, mode: string): { shared: boolean; split: boolean };

  /** Whether this provider+model reverses translation direction by swapping
   *  the source language (auto-source gating). Base: false. */
  reversesDirectionViaSourceLanguage(model: string | null | undefined): boolean;

  /** Flat analytics fields describing a session config. Base extracts
   *  `model`; providers with multi-model pipelines override. S8 — optional. */
  describeSessionForAnalytics(config: SessionConfig): Record<string, string | number>;
}
```

Direction-reversal helpers (`reverseTranscriptionDirection`, `reverseGeminiTranslationDirection`, volcengine/soniox/palabra field swaps) move into the respective descriptors as private implementation of `buildParticipantSessionConfig`, comments intact. (Landed as descriptor-imported sibling modules rather than inlined private code — they keep their own unit tests; and S2 additionally relocated the two local participant-config helpers out of settingsStore into services/providers/localParticipantConfig.ts, since a descriptor cannot import settingsStore.)

**Import hygiene (subtitle window), stated operationally**: the Electron subtitle window already transitively loads every descriptor and client (SubtitleApp → settingsStore → all descriptors), so no *new* weight is added there. The rule that must hold is narrower: subtitle-loaded **leaf modules** (`sessionStartGate.ts` and friends) keep consuming **derived primitives** (`sonioxBothSplit` stays an input computed by the caller); they never import a descriptor or the relocated `sonioxBothModePlan` module. S3 adds a test asserting `sessionStartGate.ts` has no import path to `ProviderConfigFactory`.

## Tier 3 — optional async lifecycle hooks

`connectConversation` is already async; ordering is unchanged — only ownership moves.

### `prepareToStart?`

```ts
type PrepareOutcome =
  | { ok: true;
      sessionPatch?: Partial<SessionConfig>;      // e.g. voice override
      settingsPatch?: Record<string, unknown>;    // via updateProviderSlice
      /** Two-phase stale-selection guard, mirroring today's L2029 + L2254:
       *  - expect: the pre-prepare slice values. Checked once when the hook
       *    returns; on mismatch MainPanel discards settingsPatch AND
       *    sessionPatch AND noticeKey and proceeds with Start unmodified
       *    (today's guard 1).
       *  - expectAtApply: the post-patch values. Re-checked immediately
       *    before merging sessionPatch into the built session config — after
       *    the intervening awaits (audio init, client construction) — on
       *    mismatch the sessionPatch is dropped and the notice suppressed,
       *    Start proceeds (today's guard 2). */
      expect?: Record<string, unknown>;
      expectAtApply?: Record<string, unknown>;
      noticeKey?: string }                        // i18n key for a user notice
  | { ok: false; message: string };               // blocks Start; display-ready text

interface PreparePorts {
  getAuthToken: () => Promise<string | null>;
  userId: string | null;
  /** Re-runs provider validation via the STORE action (validateApiKey) and
   *  reports the outcome. Exists because the revalidation authority IS
   *  settingsStore.validateApiKey — a store action with slice-writing side
   *  effects that a descriptor must not import (settingsStore imports every
   *  descriptor; the reverse edge is a cycle). MainPanel binds this port. */
  revalidate: () => Promise<{ valid: boolean; message?: string }>;
  onPhase: (phaseKey: string) => void;            // drives the generic init label
  signal: AbortSignal;                            // Start cancelled / aborted
}

prepareToStart?(slice: unknown, ports: PreparePorts): Promise<PrepareOutcome>;
```

**Error paths (normative)**: a *rejected* `prepareToStart` is treated as `{ ok: false, message: t('mainPanel.startPreparationFailed') }` — MainPanel catches, logs the original error, blocks Start, shows the generic message. If `ports.signal` has fired, the result (or rejection) is discarded silently and nothing is shown. `message` on an explicit `ok: false` is display-ready text (the local hook passes the store's `validationMessage` through verbatim, as today).

Absorbs, per provider:
- **local_inference / local_native**: pre-start model-readiness revalidation (L1918-1947). The hook calls `ports.revalidate()`; `valid: false` → `{ ok: false, message }`. Store writes stay in store land.
- **kizuna_ai_soniox**: managed cloned-voice preparation (L1974-2058 + apply at L2245-2264). The existing pure core (`prepareManagedVoice` / `resolveVoicePrepOutcome`) is reused as-is inside the descriptor hook; MainPanel applies the returned patches generically under the two-phase guard above.

### `acquireSessionResources?` / `SessionResources`

```ts
/** Provider-neutral; the soniox descriptor adapts its SonioxBudgetSnapshot. */
interface BudgetSnapshot { remainingMs: number; totalMs: number }

interface SessionResources {
  /** Per-leg additions to ClientOptions (today: the sonioxManaged bundle). */
  legClientOptions(role: 'speaker' | 'participant'): Partial<ClientOptions>;
  /** Present iff the session runs on a metered budget. Drives the generic
   *  countdown UI; returns null while unknown. */
  budget?: () => BudgetSnapshot | null;
  /** Idempotent. 'aborted' = Start failed mid-flight; 'disconnect' = normal.
   *  Called from afterBothLegs (both teardown sites) — see S6 scope note. */
  release(reason: 'disconnect' | 'aborted'): void;
}

acquireSessionResources?(ctx: {
  getAuthToken: () => Promise<string | null>;
  wiring: {
    speakerWillStart: boolean; participantWillStart: boolean;
    sharedBoth: boolean; splitBoth: boolean;
    /** Effective session text-only-ness, resolved by MainPanel as
     *  `speakerWillStart ? shellTextOnly : true` — a participant-only session
     *  must never buy speech output. The rule and its rationale comment
     *  (today's L2140-2153) live at the MainPanel computation site; the
     *  descriptor consumes the resolved value. */
    textOnly: boolean;
  };
  /** Closed vocabulary: 'session.retry' is the only event the lease emits
   *  today (per the L2155-2178 comment). MainPanel forwards it to
   *  addRealtimeEvent; unknown event types are ignored. */
  onEvent: (type: 'session.retry', data: unknown) => void;
}): Promise<SessionResources | null>;
```

- Base: undefined → MainPanel treats as `null` (no resources).
- **Error path (normative)**: `acquireSessionResources` must either return resources or **throw after cleaning up its own partial state** (`ManagedSonioxSession.end()` is already idempotent and no-ops without a lease, so the wrapper's catch can call it safely). MainPanel catches the throw, aborts Start through the existing abort path, and surfaces the error message. MainPanel **never** calls `release()` for a failed acquire.
- **KizunaAISonioxProviderConfig** implements it by wrapping today's `resolveManagedSonioxWiring` + `ManagedSonioxSession.acquire()` + `managedLegOptions`.
- **S6 scope, corrected by review**: within the teardown block L1793-1852 only `afterBothLegs` (L1840-1851, ~12 lines) is lease logic — the speaker/participant leg closures are provider-generic and **stay in MainPanel**, as does `teardownSessionLegs` and its nested-finally ordering ("every leg is down before session-end is signalled"). `release('disconnect')` is called from `afterBothLegs`; `release('aborted')` from the lease portion of the abort path (L2661-2699).
- `ClientOptions.sonioxManaged` keeps its name and shape (churn control), but is now produced *and* consumed inside the same descriptor module.
- MainPanel holds one provider-agnostic `sessionResourcesRef: SessionResources | null`.

### UI becomes data-driven

- **Countdown**: new `<SessionCountdown getSnapshot={...} />` component (owns the 1s interval, the low-threshold class, `formatRemainingTime`). Rendered when `sessionResources?.budget` exists — a data condition, not a provider condition. Kills the duplicated JSX at L4302-4306/L4448-4452 (the adjacent generic session-duration span L4299-4301/L4445-4447 stays) and the state block L1409-1452.
- **Init labels**: the generic `initPhaseKey: string | null` + i18n-lookup label is introduced **in S4** (not S7), so every migration stage deletes its own rungs of the old ladder as its provider moves to `onPhase` — no interim gap where migrated providers have no label. Existing label strings are reused under phase keys; no visible text changes. S7 removes whatever remains of the ladder alongside the countdown work.

## Explicitly staged-last (S8, individually optional)

1. **`describeSessionForAnalytics`** — also absorbs the four uncovered `provider || Provider.OPENAI` analytics-tag fallbacks (L853, L920, L1598, L1671; four more sit inside the WebRTC block below).
2. **Anti-drift anchor policy** (openai family, L3794-3874) — Tier-1 flag `needsAnchorPolicy` + extraction of the anchor logic into a module beside the OpenAI descriptor.
3. **WebRTC→WebSocket fallback** (openai, L2287-2357) — descriptor property `transportFallback?: TransportType` + a generic retry step in `connectConversation`. Registry invariant: `transportFallback` and `forcedTransport` are **mutually exclusive**, and `transportFallback` must differ from the primary transport. Highest risk: entangled with connect error flow; do last, alone.

## Out of scope (deliberate)

- No change to any provider's wire behavior, session semantics, or UI appearance.
- No async `createClient` — Tier 3 hooks make it unnecessary.
- No unification of Local Inference / Local Native beyond shared flags (CONTEXT.md forbids a unifying layer).
- `ProviderSpecificSettings.tsx` (2380 lines, its own dispatch hybrid) — separate effort.

## Stages

Each stage: add seam (+ base default) → migrate providers → **delete the MainPanel branches it replaces** → extend `descriptorRegistry.test.ts` invariants → add/extend wiring tests. One PR per stage; any stage is a stable stopping point. Estimates are post-review corrected.

| Stage | Content | MainPanel deletions | Done when |
|---|---|---|---|
| S1 | Tier-1 flags (6) + `supportsWebRTC` re-doc | ~120 | registry invariants for all flags; enum-ladder call sites replaced; full suite green |
| S2 | `buildParticipantSessionConfig` | ~150 | **golden test**: for every registered descriptor, new output deep-equals old `createParticipantSessionConfig` for the same inputs (incl. the null cases and notices); capture retired after landing |
| S3 | `planBothMode` + `reversesDirectionViaSourceLanguage` | ~40 | sessionStartGate import-hygiene test added; both-mode wiring tests moved with call site |
| S4 | `prepareToStart` + `revalidate` port + public `updateProviderSlice` + generic init label | ~45 | updateProviderSlice round-trip tests (patch merge, unknown key rejected, no cross-slice bleed); local revalidation wiring test; rejection→generic-message test |
| S5 | Migrate managed voice prep onto `prepareToStart` | ~100 | `voicePrepWiring` tests relocated and passing; **both** expect-mismatch branches asserted (guard 1 discards all, guard 2 drops sessionPatch + notice) |
| S6 | `acquireSessionResources` / `SessionResources`; migrate lease | ~95 | release-ordering assertion: release fires from afterBothLegs after both legs are down; abort path releases with 'aborted'; failed-acquire = no release() call; `managedSonioxSplit` tests intact |
| S7 | `<SessionCountdown>` + remaining ladder removal | ~55 | component render test (interval, low threshold); countdown gated on budget presence; no `soniox`-named identifier left in MainPanel render tree |
| S8 | Optional: analytics, anchor policy, WebRTC fallback | ~200 | per-item; WebRTC fallback keeps its own retry-path tests |

**Projected**: MainPanel −600..−650 lines for S1–S7; ~−800..−850 if all of S8 lands. (The audit's 1314 provider-specific lines exceed the deletions because a share becomes generic data-driven code that stays, and imports/types shrink rather than disappear.)

## Testing

- **Per-seam table tests**: each new descriptor method/flag gets a test iterating all 14 registered descriptors (house style: `descriptorRegistry.test.ts` invariants).
- **Behavior-preservation**: the full suite passes at every stage boundary. Wiring tests (`voicePrepWiring`, `splitDegradedWiring`, `participantTelemetryWiring`, `managedSonioxSplit`) may move only with their call site, itemized per stage PR.
- **S2 golden test** as specified in the stage table — the largest single behavioral surface gets an exhaustive equivalence check.
- **Store**: `updateProviderSlice` (public surface) gets persistence round-trip tests.
- Full suite + `vite build` green at every stage boundary.

## Risks

- **Hot path** (`connectConversation`) is touched by S4–S6. Mitigation: sync-only stages land first; each stage minimal and independently revertible; wiring tests assert ordering.
- **Store surface** grows by one public action. Mitigation: it wraps the existing registry-driven private helper; round-trip tested.
- **S2 equivalence** is the largest behavioral surface. Mitigation: golden comparison across all descriptors, null paths and notices included.
- **Anchors drift** as stages land — stage plans reference identifiers, not line numbers (line numbers in this spec are valid at `5d4633fa`).
