# MainPanel Seams S5 — Managed Voice Prep onto prepareToStart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The managed-Soniox cloned-voice preparation (~98 lines in `connectConversation` + guard 2 at config-build + the notice append) migrates onto the `prepareToStart` hook of `KizunaAISonioxProviderConfig` — the twin ONLY, never BYOK Soniox — with the two-phase stale-selection guard running generically in MainPanel's S4 dispatch. The `voicePreparing` state and its ladder rungs retire into `InitPhase`.

**Architecture:** Stage S5 of the spec. The pure core (`prepareManagedVoice`/`resolveVoicePrepOutcome` — deliberately React/store/i18n-free, verified) relocates beside its new caller (S2 precedent). The hook returns the full envelope: `sessionPatch` (the voice override), `settingsPatch` (the rebuilt UUID write-through — now via S4's `updateProviderSlice`, killing the old comment's "no generic action" rationale), `expect` (guard 1: pre-prep snapshot, checked at hook return, mismatch discards ALL), `expectAtApply` (guard 2: re-checked immediately before merging into the session config, mismatch drops patch + notice), and a display-ready `notice`. Session-shape gating (`speakerWillStart && !textOnly`) arrives through a `PreparePorts.sessionShape` extension. Moving the prep from after the no-channel guard to the dispatch position (before it) is behavior-neutral: the hook gates on `speakerWillStart`, which is false in every case the guard would have returned early on.

**Tech Stack:** TypeScript, React, zustand, vitest 4, i18next.

## Global Constraints

- Repo/worktree: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/soniox-tts-v2`, branch `refactor/mainpanel-provider-seams` (S1-S4 complete, HEAD ≈ `f26e6660`).
- **Zero behavior change.** The two guards' exact semantics are the stage's heart: guard 1 (post-await, stored voice ≠ pre-prep snapshot → discard outcome entirely, log info); guard 2 (at config-build, stored voice ≠ expected → skip the voice override AND null the notice, log info). Both get dedicated pure-function tests.
- The deep rationale comments move with the code: the "cache entries, not registrations" block → the hook; the "dropdown stays live" race comments → the guards' new homes; guard 2's "Theirs wins" comment stays at the apply site. The old "no generic per-slice update action" comment DIES — S4's `updateProviderSlice` repealed its premise; the plan notes this.
- The settingsPatch write stays fire-and-forget (the old `updateKizunaSoniox(...)` call was not awaited — preserve exact timing with `void`).
- The hook lands on `KizunaAISonioxProviderConfig` ONLY. BYOK `SonioxProviderConfig` stays hookless (the old gate required `isKizunaManagedProvider`).
- Full suite green every task end; `npx vite build` green at Tasks 4-5. Locate edits by grepped identifiers. Commit per task; do not push. Sweeps: generic `Provider\.[A-Z_]+`.

---

### Task 1: Relocate the pure core beside its new caller

**Files:**
- Move: `src/components/MainPanel/prepareManagedVoice.ts` → `src/services/providers/managedVoicePrep.ts`
- Move: `src/components/MainPanel/prepareManagedVoice.test.ts` → `src/services/providers/managedVoicePrep.test.ts`
- Move: `src/components/MainPanel/voicePrepWiring.test.ts` → `src/services/providers/voicePrepWiring.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx` (one import path)

- [ ] **Step 1: Move with git mv** (all three), update the two test files' relative imports and MainPanel's import (`from './prepareManagedVoice'` → `from '../../services/providers/managedVoicePrep'`). Add one line to the module header: `// Moved beside its caller (KizunaAISonioxProviderConfig.prepareToStart, S5); deliberately React-, store- and i18n-free — a descriptor calls it without cycles.` Grep for any other importer (there are none in production; splitDegraded/participantTelemetry only mention it in comments — leave those).

- [ ] **Step 2: Run** the two moved test files + full suite → green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(providers): move the managed voice-prep core beside its future caller

React/store/i18n-free by design (its own header says so); the S5 hook on
the kizuna-soniox descriptor becomes its only production caller."
```

---

### Task 2: Contract extensions — sessionShape, nullable onPhase, display-ready notice, preparing-voice phase

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts`
- Modify: `src/services/providers/prepareToStart.local.test.ts` (ports fixture gains the new fields)
- Modify: `src/components/MainPanel/MainPanel.tsx` (dispatch supplies the new port fields; label helper gains the phase)

**Interfaces (the deltas — everything else unchanged):**

```ts
export interface PreparePorts {
  // ... existing ...
  /** The session shape this Start is about to create. Provider-agnostic
   *  facts the component owns; hooks gate on them instead of re-deriving
   *  (the kizuna-soniox hook prepares a voice only when the speaker channel
   *  will actually speak). */
  sessionShape: { speakerWillStart: boolean; participantWillStart: boolean; textOnly: boolean };
  /** null clears the phase (a hook's finally). */
  onPhase: (phase: InitPhase | null) => void;
}

export type PrepareOutcome =
  | { ok: true;
      sessionPatch?: Record<string, unknown>;
      settingsPatch?: Record<string, unknown>;
      expect?: Record<string, unknown>;
      expectAtApply?: Record<string, unknown>;
      /** Display-ready user notice (the hook owns i18n, S4-T3 precedent) —
       *  replaces the never-consumed noticeKey. */
      notice?: string }
  | { ok: false; message: string };

export type InitPhase =
  | { phase: 'loading-models'; completed: number; total: number }
  | { phase: 'loading-native-asr' }
  | { phase: 'preparing-voice' };
```

- [ ] **Step 1:** Apply the three deltas (replace `noticeKey?: string` with `notice?: string`, comment included; add `sessionShape`; widen `onPhase`; add the phase variant).

- [ ] **Step 2:** Fix the compile fallout, exactly two places: the local test fixture's `ports(...)` helper gains `sessionShape: { speakerWillStart: true, participantWillStart: false, textOnly: false }`; MainPanel's dispatch adds `sessionShape: { speakerWillStart, participantWillStart, textOnly },` to the ports object (all three are in-scope render captures already in the dep array — verify by grep). `initPhaseLabel` gains:

```ts
    case 'preparing-voice':
      return site === 'simple'
        ? t('simplePanel.preparingVoice', 'Preparing your voice…')
        : t('mainPanel.preparingVoice', 'Preparing your voice…');
```

(Existing keys — zero locale churn. The rung swap that USES it is Task 4.)

- [ ] **Step 3:** Full suite → green. Commit:

```bash
git add src/services/providers/ProviderDescriptor.ts src/services/providers/prepareToStart.local.test.ts src/components/MainPanel/MainPanel.tsx
git commit -m "feat(providers): prepareToStart learns the session shape, phase clearing, display-ready notices"
```

---

### Task 3: The twin's hook

**Files:**
- Modify: `src/services/providers/KizunaAISonioxProviderConfig.ts`
- Modify: `src/services/providers/descriptorRegistry.test.ts` (presence: 3 ids)
- Test: `src/services/providers/prepareToStart.kizunaSoniox.test.ts` (new)

- [ ] **Step 1: Red** — presence test → `WITH_HOOK = [LOCAL_INFERENCE, LOCAL_NATIVE, KIZUNA_AI_SONIOX]` (BYOK SONIOX explicitly asserted hookless: add `expect(ProviderConfigFactory.getDescriptor(Provider.SONIOX).prepareToStart).toBeUndefined();` as its own line with a comment — the managed flow must never run for BYOK).

- [ ] **Step 2: Red** — unit tests (mock `./managedVoicePrep` with `vi.mock`; ports fixture with controllable slice/sessionShape):

Cases: (1) `speakerWillStart:false` → bare `{ok:true}`, core never called; (2) `textOnly:true` → same; (3) built-in voice in slice → same; (4) empty voice → same; (5) cloned UUID → core called with a ManagedVoicesClient + loadClip closure; outcome mapped: `sessionPatch:{voice: outcome.sessionVoice}`, `settingsPatch` passthrough, `expect:{voice:<pre-prep>}`, `expectAtApply:{voice: settingsPatch?.voice ?? <pre-prep>}`, `notice` = i18n'd string when outcome.notice present; (6) `onPhase({phase:'preparing-voice'})` before the await and `onPhase(null)` in finally — asserted via mock call order even when the core rejects (it never throws by contract, but the finally must hold anyway); (7) `sessionVoice:null` outcome (never-attempted shapes) → `{ok:true}` with NO sessionPatch.

- [ ] **Step 3: Implement** on `KizunaAISonioxProviderConfig` (NOT the base):

```ts
  /** Managed cloned voices are cache entries, not registrations: the one
   *  selected days ago may have been evicted since. Claim (and if needed
   *  rebuild) it now, before any client exists — the backend pins the slot
   *  for a short start window, which session-started then extends to the
   *  session's own expiry. Only the speaker channel speaks, so a
   *  participant-only or text-only session has no voice to prepare.
   *
   *  The envelope's two expectations carry the dropdown-stays-live race
   *  rule (the caller enforces it): preparation takes seconds, Settings is
   *  mounted throughout, and a choice the user made meanwhile must not be
   *  silently overwritten — `expect` guards the whole outcome at hook
   *  return, `expectAtApply` re-guards the session-config override after
   *  the further awaits between prep and connect. */
  async prepareToStart(slice: unknown, ports: PreparePorts): Promise<PrepareOutcome> {
    if (!ports.sessionShape.speakerWillStart || ports.sessionShape.textOnly) return { ok: true };
    const voice = (slice as { voice?: string })?.voice;
    const builtIn = new Set(this.getConfig().voices.map((v) => v.value));
    if (!voice || builtIn.has(voice)) return { ok: true };

    ports.onPhase({ phase: 'preparing-voice' });
    try {
      const result = await prepareManagedVoice({
        client: new ManagedVoicesClient(ports.getAuthToken),
        // Scoped to the signed-in account: the clip is one record on a
        // device several people may share, and handing this account
        // somebody else's recording would upload their voice under this
        // account. A mismatch (or nobody signed in) reads as "no clip
        // here", which the routine already degrades to a built-in voice.
        loadClip: () => loadVoiceClip(ports.userId),
      });
      const outcome = resolveVoicePrepOutcome(result, voice, SONIOX_DEFAULT_VOICE);
      return {
        ok: true,
        ...(outcome.sessionVoice ? { sessionPatch: { voice: outcome.sessionVoice } } : {}),
        ...(outcome.settingsPatch ? { settingsPatch: outcome.settingsPatch } : {}),
        expect: { voice },
        expectAtApply: { voice: outcome.settingsPatch?.voice ?? voice },
        ...(outcome.notice ? { notice: i18n.t(outcome.notice.key, outcome.notice.defaultValue) } : {}),
      };
    } finally {
      ports.onPhase(null);
    }
  }
```

Imports: `prepareManagedVoice, resolveVoicePrepOutcome` from `'./managedVoicePrep'`; `ManagedVoicesClient` from `'../clients/ManagedVoicesClient'`; `loadVoiceClip` from `'../../lib/soniox/voiceClipStorage'`; `SONIOX_DEFAULT_VOICE` from `'../../lib/soniox/ttsCatalog'`; `i18n` from `'../../locales'`; `PreparePorts, PrepareOutcome` from `'./ProviderDescriptor'`. Verify each path resolves from this file's location; check `loadVoiceClip(userId)`'s param type accepts `string | null` (the old call passed the same `userId`).

- [ ] **Step 4:** Green (new file + registry + full suite). Commit:

```bash
git add src/services/providers/KizunaAISonioxProviderConfig.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(providers): the kizuna-soniox twin prepares its managed voice through the hook

Twin only — BYOK Soniox stays hookless, pinned in the registry test. The
envelope carries both stale-selection expectations; the caller enforces
them."
```

---

### Task 4: MainPanel — envelope application, guard 2, the old block dies

**Files:**
- Create: `src/components/MainPanel/prepareEnvelope.ts` + `prepareEnvelope.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: The pure guard helper (TDD)**

`prepareEnvelope.ts`:
```ts
/** Does the live slice still match a prepareToStart expectation? Every key in
 *  `expectation` must strictly equal the slice's current value. The two-phase
 *  stale-selection rule (see PrepareOutcome) runs on this: guard 1 discards
 *  the whole outcome, guard 2 drops only the session patch and its notice —
 *  both because the settings UI stays live while Start awaits, and a choice
 *  the user made meanwhile must not be silently overwritten. */
export function expectationHolds(
  expectation: Record<string, unknown> | undefined,
  slice: unknown,
): boolean {
  if (!expectation) return true;
  const s = (slice ?? {}) as Record<string, unknown>;
  return Object.entries(expectation).every(([k, v]) => s[k] === v);
}
```
Tests: holds on match / undefined expectation / empty object; fails on one-key mismatch, missing key, null slice vs non-undefined expectation value; multi-key all-must-match.

- [ ] **Step 2: Extend the S4 dispatch (grep `startDescriptor.prepareToStart`)**

After the `if (!prepared.ok) { … return; }` block, replace the `// sessionPatch/settingsPatch/notice application lands with S5` comment with:

```ts
        // The envelope, under guard 1: `expect` is the hook's pre-prep
        // snapshot. Preparation takes seconds and the settings UI stays
        // mounted throughout, so the user may have changed the value while
        // the hook awaited; theirs wins — the WHOLE outcome stands down
        // (patch, notice, session override), same rule as
        // SonioxVoiceSection's finishCreate.
        if (expectationHolds(prepared.expect, useSettingsStore.getState()[startDescriptor.settingsSliceKey as keyof SettingsStore])) {
          if (prepared.settingsPatch) {
            // Fire-and-forget, as the old named-action write was: a rebuilt
            // voice comes back with a DIFFERENT id, so every ensure response
            // is authoritative — writing it through keeps the settings
            // dropdown pointing at a voice that actually exists.
            void useSettingsStore.getState().updateProviderSlice(startDescriptor.settingsSliceKey, prepared.settingsPatch);
          }
          if (prepared.sessionPatch) {
            pendingSessionPatch = prepared.sessionPatch;
            pendingExpectAtApply = prepared.expectAtApply;
          }
          prepareNotice = prepared.notice ?? null;
        } else {
          console.info('[Sokuji] [MainPanel] prepareToStart finished after its inputs changed — leaving the newer choice alone.');
        }
```

with locals declared just above the dispatch block (replacing the deleted ones):
```ts
      // prepareToStart's session-config override + its guard-2 expectation
      // and user notice; see the envelope application below.
      let pendingSessionPatch: Record<string, unknown> | null = null;
      let pendingExpectAtApply: Record<string, unknown> | undefined;
      let prepareNotice: string | null = null;
```

- [ ] **Step 3: Guard 2 (grep `sessionVoiceOverride`)** — the old apply site becomes:

```ts
        // Same shape as the `bidirectional` override below: sessionConfig is a
        // plain object built for this connect() alone, so this override never
        // touches settings.
        if (pendingSessionPatch) {
          // Re-checked here, not only at prep time: everything in between is
          // awaited (audio service init, client construction, listener
          // wiring) and the settings UI stays live the whole way, so the
          // user may have changed the value since. Theirs wins — including
          // over the fallback and its notice, which would otherwise explain
          // a substitution that did not happen.
          if (expectationHolds(pendingExpectAtApply, useSettingsStore.getState()[startDescriptor.settingsSliceKey as keyof SettingsStore])) {
            Object.assign(sessionConfig, pendingSessionPatch);
          } else {
            console.info('[Sokuji] [MainPanel] Selection changed after preparation — using the newly selected value for this session.');
            // The patch is simply not applied. The notice IS cleared, because
            // it is read further down (after connect()) and would otherwise
            // announce a substitution this session did not take.
            prepareNotice = null;
          }
        }
```

(`startDescriptor` must still be in scope here — it is declared with `const` inside the same `try`; verify, else re-derive with getDescriptor(provider).)

- [ ] **Step 4: Delete the old block and its satellites**

- The whole managed voice-prep block (grep `Managed cloned voices are cache entries`) including `readStoredSonioxVoice`, `sessionVoiceOverride`, `voicePrepMessage`, `sonioxVoiceExpected` declarations — guard 2's old form was replaced in Step 3; the notice consumption site (grep `voicePrepMessage` near the post-connect items append) renames to `prepareNotice` (same append logic, verbatim).
- `voicePreparing` state + both ladder rungs: the rungs' `voicePreparing ? t(...preparingVoice...) :` head disappears — `initPhase` (fed by the hook's onPhase) now covers it via the Task-2 label case; delete the state.
- Dead imports/constants — grep each before removing: `prepareManagedVoice`, `resolveVoicePrepOutcome`, `ManagedVoicesClient`, `loadVoiceClip`, `SONIOX_BUILTIN_VOICES`, `SONIOX_DEFAULT_VOICE` (module-scope Set/const — verify no other user), and whether `kizunaBaseProvider`/`isKizunaManagedProvider` still have other call sites (they do, in the lease block — keep the imports).

- [ ] **Step 5: Gates**

`grep -n "voicePreparing\|sessionVoiceOverride\|voicePrepMessage\|readStoredSonioxVoice\|SONIOX_BUILTIN_VOICES" src/components/MainPanel/MainPanel.tsx` → no hits. `npx vitest run` all green; `npx vite build` success.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(mainpanel): the managed voice prep runs through the descriptor hook

The ~98-line kizuna-soniox block in connectConversation becomes generic
envelope application in the S4 dispatch: guard 1 discards a stale
outcome whole, guard 2 re-checks before the session-config override and
drops the patch with its notice. The settings write-through goes through
updateProviderSlice — S4 repealed the old comment's reason for the
hardcoded updateKizunaSoniox. voicePreparing retires into InitPhase."
```

---

### Task 5: Stage close-out

- [ ] **Step 1: Sweep + gates**

- `grep -nE "Provider\.[A-Z_]+" src/components/MainPanel/MainPanel.tsx` — classify all; the voice-prep kizuna gate must be GONE (expected residue: 8 analytics fallbacks, the lease/budget kizuna gates, comments). Any voice-prep hit = BLOCKED.
- `npx vitest run` all green; `npx vite build` success.

- [ ] **Step 2: Spec corrections** (one commit, the S4-precedent convention): record in the spec's prepareToStart section — (a) `PreparePorts.sessionShape` (the spec's ports lacked session-shape facts; the kizuna hook gates on them), (b) `notice` is display-ready text replacing the sketched `noticeKey` (hooks own i18n, S4-T3 precedent), (c) `onPhase` accepts null (phase clearing), (d) the InitPhase union gained 'preparing-voice'. Also strike/annotate the spec's S5 sentence claiming MainPanel re-reads "the slice still matches `expect`" *before applying settingsPatch* if its wording mismatches the landed guard-1-gates-everything shape — quote-check first, minimal edit.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md
git commit -m "docs(specs): record the landed S5 contract deltas"
```

---

## Self-review notes (already applied)

- **Spec coverage**: hook on the twin ✓ (T3, BYOK pinned hookless), pure core reused ✓ (T1/T3), envelope + both guards generic in MainPanel ✓ (T4, with the pure `expectationHolds` satisfying "both expect-mismatch branches asserted"), voicePrepWiring tests relocated ✓ (T1), voicePreparing → InitPhase ✓ (T2/T4), settingsPatch via updateProviderSlice ✓ (T4).
- **Position move argued**: prep moves before the no-channel guard with the dispatch; neutral because the hook's `speakerWillStart` gate is false whenever the guard would have returned first.
- **Deliberate deltas, each documented**: the repealed updateKizunaSoniox comment; noticeKey → notice; guard log lines generalized (provider-specific wording → value-neutral, same log level/prefix).
- **Type consistency**: `sessionShape`/`expectationHolds`/`pendingSessionPatch` naming used identically across T2-T4.
