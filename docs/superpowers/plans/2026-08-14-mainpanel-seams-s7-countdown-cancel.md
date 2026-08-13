# MainPanel Seams S7: SessionCountdown + Start Cancellability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the budget countdown into a testable `<SessionCountdown>` component (spec S7), and finish Start cancellability: the aborter survives through the resource acquire, the voice-prep network calls honor a caller signal, and both footer buttons cancel an in-flight Start.

**Architecture:** The countdown's interval/state/low-threshold/formatting move into a self-nulling component fed by a stable `getSnapshot` callback over `sessionResourcesRef` — MainPanel's render tree loses its last soniox-named identifiers. The S6 prepare-aborter is renamed to a Start-scoped aborter that stays live until the connect finally, closing the acquire-window gap with a post-acquire release('aborted'). `ManagedVoicesClient` gains an optional caller `AbortSignal` combined with its internal timeout per the repo's SonioxTtsRest precedent (manual controller + reason-name distinction — **not** `AbortSignal.any`), threaded from `ports.signal` through `prepareManagedVoice`.

**Tech Stack:** React + TypeScript, vitest + @testing-library/react + jsdom (already configured: `environment: 'jsdom'`, `css: true`, `setupFiles: './src/setupTests.ts'`).

**Spec:** `docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md` — S7 row (L295): component render test (interval, low threshold); countdown gated on budget presence; **no soniox-named identifier left in MainPanel's render tree**. UI section L253-266 + S6 landed correction L259.

## Global Constraints

- Spec S7 gate: after this stage, the only `soniox`-named identifiers in `MainPanel.tsx` are the Both-mode planning ones inside `connectConversation` (`sonioxBothPlan`/`sonioxSharedBoth`/`sonioxSplitBoth`) and comments — nothing soniox-named in the render tree or component state.
- No provider-identity dispatch anywhere; the countdown stays a pure data condition (budget presence).
- Component conventions (established by `DisplayModeButton.tsx` / `SplitDegradedChip.tsx`): props interface + `React.FC<Props>` arrow, own `.scss` imported by the component, `useTranslation()` called inside the component with inline English defaults, default export at bottom, a doc comment explaining why it exists as a separate component (MainPanel has no React harness — extraction is what makes it testable).
- Abort-combining precedent (`SonioxTtsRest.ts:79-88`): manual `AbortController` + `setTimeout`-driven `controller.abort(new DOMException(..., 'TimeoutError'))` + a `forwardAbort` listener forwarding the caller signal's reason. **Never `AbortSignal.any`** — the deadline and the caller's cancel must stay distinguishable at the catch site via the abort reason's `name`.
- `prepareManagedVoice` keeps its always-resolves contract: it catches everything internally and returns a `VoicePrepResult`; a caller-signal abort resolves through the same degrade path as deadline exhaustion, never rejects.
- Ref-null-before-release wherever resources are released (the S6 invariant).
- New locale keys must land in ALL 30 locale files (the locale-consistency test enforces parity; follow how S4's `preparingVoice` key landed).
- Per task: `npx vitest run` fully green; `npx tsc --noEmit 2>&1 | grep -c "error TS"` unchanged from the pre-task baseline; tasks touching MainPanel.tsx also run `npx vite build`. One commit per task with the exact message given; `git status --porcelain` clean after; do not push mid-stage.

## Key current-code facts (verified 2026-08-14, HEAD c3c8d4d1)

- Countdown state block: `MainPanel.tsx:1296-1317` — `sonioxCountdown` useState + polling useEffect (deps `[isSessionActive, provider]`) + `sonioxRemainingLow` (<20% rule). JSX consumers: 4111-4115 (basic footer) and 4255-4259 (advanced footer), byte-identical, each next to a generic `.session-duration` span that STAYS. SCSS: `.session-remaining-time` rules duplicated at `MainPanel.scss:369-382` (basic) and 447-460 (advanced), inside `.footer-metadata` under `.control-footer.basic`/`.advanced`.
- `formatRemainingTime` (`src/utils/formatters.ts:70-78`): only production callers are the two countdown JSX lines.
- The old init-label ladder is ALREADY fully gone — every isInitializing/initPhase touch point routes through the single generic `initPhase`/`initPhaseLabel`. S7's "remaining ladder removal" is a no-op; Task 6 records this in the spec.
- Aborter today: `prepareAbort` created at 1801-1802 inside `if (startDescriptor.prepareToStart)`; `prepareAbortRef.current = null` unconditionally at 1822 (BEFORE the aborted-check at 1823 and ~130 lines before the acquire await at 1951); disconnect fires it at 1584-1587; the connect finally (2630-2634) also nulls it. So a disconnect during the acquire await finds a null ref → abort no-ops → nothing checks the signal post-acquire → a metered session starts against a torn-down UI. `sessionResourcesRef.current = sessionResources` lands unconditionally right after the acquire await.
- Buttons: simple footer button (4069-4095) stays ENABLED during init (disabled expr `!canStartSession && !isSessionActive` ignores isInitializing) with onClick `isSessionActive ? disconnectConversation : connectConversation` — during init a click hits the re-entry guard and does nothing. Advanced button (4189-4227) is fully DISABLED during init (`(!isSessionActive && !canStartSession) || isInitializing`); its onClick wraps `trackEvent('session_control_clicked', { action, method: 'button' })`.
- Subtitle bridge `onStop: disconnectConversation` is unconditional — subtitle Stop already cancels whatever the aborter covers.
- `ManagedVoicesClient` (`src/services/clients/ManagedVoicesClient.ts`): three public methods `mine(budgetMs?)`, `ensure({pin, clip?, budgetMs?})`, `remove()`; private `request(path, init, timeoutMs)` builds every fetch signal internally as `AbortSignal.timeout(timeoutMs)` and maps `TimeoutError`/`AbortError` BOTH to `SonioxVoicesError('timeout', ..., 408)`. No caller-signal path exists.
- `prepareManagedVoice` (`src/services/providers/managedVoicePrep.ts:32-127`): deps `{client, loadClip, sleep?, now?, timeoutMs? (=60s), pollIntervalMs?}`; flow = warm `ensure` → `clip_required` → loadClip + `ensure` with clip (once) → `pool_exhausted` → sleep + retry (once) → `processing` → `mine` poll loop against the deadline. The deps JSDoc (37-55) documents the ~135s worst case and says cancelling mid-upload "would need an AbortSignal threaded through the client".
- The kizuna hook (`KizunaAISonioxProviderConfig.ts:87-122`) constructs `new ManagedVoicesClient(ports.getAuthToken)` and does NOT pass `ports.signal` into the deps; it only checks `ports.signal.aborted` after the core settles.
- `PreparePorts.signal` doc (ProviderDescriptor.ts:123-125) already says a hook must honor it.
- Component-test infra: `@testing-library/react` + `jest-dom` + jsdom installed; sibling component tests exist (`SplitDegradedChip.test.tsx` asserts against inline English defaults; `DisplaySettingsPopover.test.tsx` uses `vi.useFakeTimers`).
- i18n: no `cancel` key in mainPanel/simplePanel scopes; the repo convention is per-feature keys duplicated across all 30 locales.

---

### Task 1: The SessionCountdown component

**Files:**
- Create: `src/components/MainPanel/SessionCountdown.tsx`
- Create: `src/components/MainPanel/SessionCountdown.scss`
- Test: `src/components/MainPanel/SessionCountdown.test.tsx`

**Interfaces (Produces):** `SessionCountdownProps { active: boolean; getSnapshot: () => BudgetSnapshot | null }` — consumed by Task 2. `BudgetSnapshot` comes from `../../services/providers/ProviderDescriptor`.

- [ ] **Step 1: Write the component** (`SessionCountdown.tsx`):

```tsx
import React, { useEffect, useState } from 'react';
import type { BudgetSnapshot } from '../../services/providers/ProviderDescriptor';
import { formatRemainingTime } from '../../utils/formatters';
import './SessionCountdown.scss';

interface SessionCountdownProps {
  /** Poll while true (the session is active); renders nothing while false. */
  active: boolean;
  /** One snapshot of the session's metered budget, or null when the session
   *  has none (BYOK, non-metered providers) or it is not yet known. Called
   *  once a second while active — hand in a stable callback. */
  getSnapshot: () => BudgetSnapshot | null;
}

/**
 * The metered-session countdown, extracted from MainPanel's footers so it is
 * testable — MainPanel has no React harness in this repo, so inline JSX there
 * is untestable by construction. Owns the 1s poll, the <20% low-budget
 * emphasis, and the remaining-time formatting. Renders nothing when the
 * session has no budget: a data condition, not a provider condition.
 */
const SessionCountdown: React.FC<SessionCountdownProps> = ({ active, getSnapshot }) => {
  const [countdown, setCountdown] = useState<BudgetSnapshot | null>(null);
  useEffect(() => {
    if (!active) {
      setCountdown(null);
      return;
    }
    const update = () => setCountdown(getSnapshot());
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [active, getSnapshot]);
  if (!countdown) return null;
  // Below 20% of the granted budget, switch to the warning emphasis.
  const low = countdown.totalMs > 0 && countdown.remainingMs / countdown.totalMs < 0.2;
  return (
    <span className={`session-remaining-time${low ? ' low' : ''}`}>
      {formatRemainingTime(countdown.remainingMs)}
    </span>
  );
};

export default SessionCountdown;
```

- [ ] **Step 2: Write the stylesheet** (`SessionCountdown.scss`) — the rule that today sits duplicated inside both footers' `.footer-metadata`, now unnested (values byte-identical to `MainPanel.scss:369-382`; the nesting there only scoped, never varied):

```scss
// Metered-session remaining-time countdown. Below 20% of the session's
// granted budget it switches to the same warning red the footers use for
// error states.
.session-remaining-time {
  color: #888;
  font-size: 11px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;

  &.low {
    color: #e74c3c;
    font-weight: 600;
  }
}
```

- [ ] **Step 3: Write the tests** (`SessionCountdown.test.tsx`, @testing-library/react + `vi.useFakeTimers()`; assert against rendered text/classes):

1. `active: false` → renders nothing (container empty), and `getSnapshot` is never called.
2. `active: true`, `getSnapshot` returns null → renders nothing (budget-gated: the spec's data condition).
3. `active: true`, snapshot `{ remainingMs: 600_000, totalMs: 1_200_000 }` → renders `formatRemainingTime(600_000)`'s exact output (import the real formatter in the test and compare — no hand-computed string), and the span does NOT have the `low` class (50% > 20%).
4. Interval: `getSnapshot` returns `{ remainingMs: 600_000, totalMs: 1_200_000 }` first, then `{ remainingMs: 599_000, totalMs: 1_200_000 }`; after `vi.advanceTimersByTime(1000)` the rendered text updates to the second value's formatting. Assert `getSnapshot` call count grew by exactly 1 per elapsed second.
5. Low threshold: snapshot `{ remainingMs: 100_000, totalMs: 1_200_000 }` (~8%) → span has both classes `session-remaining-time low`; boundary check: exactly 20% (`240_000/1_200_000`) → NOT low (rule is strict `<`).
6. `totalMs: 0` → not low regardless of remainingMs (guard pinned).
7. Unmount clears the interval: unmount, advance timers, `getSnapshot` call count stops growing.
8. `active` flip true→false → renders nothing again and polling stops.

- [ ] **Step 4: Gates** — full suite green; tsc baseline unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/SessionCountdown.tsx src/components/MainPanel/SessionCountdown.scss src/components/MainPanel/SessionCountdown.test.tsx
git commit -m "feat(mainpanel): a testable SessionCountdown owns the budget countdown"
```

### Task 2: MainPanel renders it

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/components/MainPanel/MainPanel.scss`

- [ ] **Step 1: Add the stable snapshot callback** near the other session-scoped callbacks (its ref-read makes empty deps correct):

```ts
// Stable across renders: reads through the ref so the countdown component
// re-polls the live resources without re-arming its interval.
const getBudgetSnapshot = useCallback(
  () => sessionResourcesRef.current?.budget?.() ?? null,
  [],
);
```

- [ ] **Step 2: Delete the countdown state block** (`MainPanel.tsx:1296-1317`): the `sonioxCountdown` useState, the whole polling useEffect (its "Data condition, not a provider condition" comment moves into the component — already done in Task 1's doc comment; delete it here), and the `sonioxRemainingLow` derivation with its comment. Keep the preceding `sessionResourcesRef` declaration and its comment block untouched.

- [ ] **Step 3: Swap both JSX consumers.** In BOTH footers, replace the three-line countdown block:

```tsx
{isSessionActive && sonioxCountdown && (
  <span className={`session-remaining-time${sonioxRemainingLow ? ' low' : ''}`}>
    {formatRemainingTime(sonioxCountdown.remainingMs)}
  </span>
)}
```

with:

```tsx
<SessionCountdown active={isSessionActive} getSnapshot={getBudgetSnapshot} />
```

The adjacent `.session-duration` span stays untouched in both footers.

- [ ] **Step 4: Imports.** Add `import SessionCountdown from './SessionCountdown';`. Remove `formatRemainingTime` from the formatters import (its only two callers were the deleted JSX lines; keep the import statement if other formatters are still imported from that module — check).

- [ ] **Step 5: Delete both duplicated `.session-remaining-time` SCSS rules** (`MainPanel.scss` ~369-382 and ~447-460, including each rule's leading comment). The rest of `.footer-metadata` stays.

- [ ] **Step 6: Gates.** `grep -n "sonioxCountdown\|sonioxRemainingLow\|formatRemainingTime" src/components/MainPanel/MainPanel.tsx` → zero hits. `grep -n "session-remaining-time" src/components/MainPanel/MainPanel.scss` → zero hits. Full suite green; tsc baseline unchanged; `npx vite build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/components/MainPanel/MainPanel.scss
git commit -m "refactor(mainpanel): the footers render SessionCountdown"
```

### Task 3: The aborter survives through the acquire

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/services/providers/sessionResourcesWiring.test.ts` (one new mirror case)

Closes the S6 final review's I1: today a Stop landing during the acquire await is silently swallowed and a metered session starts anyway.

- [ ] **Step 1: Rename the aborter to Start scope.** `prepareAbortRef` → `startAbortRef` (declaration comment updated: it now covers prepare AND acquire), local `prepareAbort` → `startAbort`. Sites: the ref declaration (~1153), disconnect's abort lines (~1584-1587, comment updated: "Discard any in-flight Start: its prepare patches and its acquired resources would target the session this teardown is ending"), the controller creation (~1801-1802), the post-prepare check (~1822-1827), the finally (~2633).

- [ ] **Step 2: Hoist the controller out of the prepare-only block.** Move creation to just BEFORE `if (startDescriptor.prepareToStart) {`:

```ts
// One Start-scoped aborter per attempt: disconnectConversation fires it so a
// teardown racing this Start discards the prepare's result silently and
// releases a lease acquired after the teardown already ran. Live from here
// until the finally — the prepare check and the post-acquire check below are
// its two consumers.
const startAbort = new AbortController();
startAbortRef.current = startAbort;
```

and DELETE the unconditional `startAbortRef.current = null;` at the old post-prepare line (~1822) — the aborted-check line stays; the ref now lives until the finally nulls it. The prepare ports still pass `signal: startAbort.signal`.

- [ ] **Step 3: The post-acquire check.** Immediately after `sessionResourcesRef.current = sessionResources;`:

```ts
if (startAbort.signal.aborted) {
  // A teardown raced the acquire: the session this lease was bought for is
  // already gone, and the teardown's afterBothLegs ran before the ref was
  // set. Release it as an abort and bail silently — no client ever saw it.
  const abortedResources = sessionResourcesRef.current;
  sessionResourcesRef.current = null;
  abortedResources?.release('aborted');
  return;
}
```

- [ ] **Step 4: New golden mirror case** in `sessionResourcesWiring.test.ts`: "a Start aborted during the acquire releases 'aborted' exactly once" — acquire resources from the real twin (mocked ManagedSonioxSession), then mirror the new MainPanel lines with a fired AbortController: assert `end()` called exactly once, the mirror ref is null after, and a subsequent site-1 mirror teardown releases nothing further (end count stays 1). Follow the file's existing mirror-helper style.

- [ ] **Step 5: Gates.** Full suite green; tsc baseline unchanged; `npx vite build` succeeds. Grep: `prepareAbortRef` → zero hits.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/services/providers/sessionResourcesWiring.test.ts
git commit -m "fix(mainpanel): the start aborter survives through the resource acquire"
```

### Task 4: ManagedVoicesClient honors a caller signal

**Files:**
- Modify: `src/services/clients/ManagedVoicesClient.ts`
- Modify: `src/services/providers/managedVoicePrep.ts`
- Modify: `src/services/providers/KizunaAISonioxProviderConfig.ts` (thread `ports.signal`)
- Modify: `src/services/clients/ManagedVoicesClient.test.ts`, `src/services/providers/managedVoicePrep.test.ts` (new cases)

Closes the ~135s no-cancel worst case the prep core's own JSDoc documents. Read `src/services/clients/SonioxTtsRest.ts:79-96` first — its manual controller + `forwardAbort` + reason-`name` pattern is the required shape; `AbortSignal.any` is explicitly rejected by that precedent's comment.

- [ ] **Step 1: Client.** `request(path, init, timeoutMs, signal?: AbortSignal)`:
  - At the top (after the budget check): `if (signal?.aborted) throw new SonioxVoicesError('aborted', 'Cancelled by the caller', 0);` — refuse before spending a fetch.
  - Replace `signal: AbortSignal.timeout(timeoutMs)` with the precedent's shape: a manual controller; `const timer = setTimeout(() => controller.abort(new DOMException(\`Request timed out after ${timeoutMs / 1000}s\`, 'TimeoutError')), timeoutMs);` and `const forwardAbort = () => controller.abort(signal?.reason ?? new DOMException('Cancelled by the caller', 'AbortError')); signal?.addEventListener('abort', forwardAbort, { once: true });` — fetch gets `controller.signal`; a `finally` clears the timer and removes the listener.
  - Catch mapping splits by reason name: `TimeoutError` → existing `SonioxVoicesError('timeout', ..., 408)`; `AbortError` → `SonioxVoicesError('aborted', 'Cancelled by the caller', 0)`; everything else → `'network'` as today.
  - `mine(budgetMs?, signal?)` and `ensure({pin, clip?, budgetMs?, signal?})` pass it through; `remove()` unchanged. Check `SonioxVoicesError`'s code type — if it is a closed union, add `'aborted'`; grep every switch/if over the codes and confirm none needs a new arm beyond what Step 2 adds (report what you find).
- [ ] **Step 2: Core.** `PrepareManagedVoiceDeps.signal?: AbortSignal`, threaded into every `ensure`/`mine` call; additionally checked (`signal?.aborted`) at each loop boundary where the deadline is checked today (before a new poll, before the pool-exhausted sleep-retry, before the clip retry). An `'aborted'` client error — and a positive `signal?.aborted` check — resolve through the SAME degrade path deadline exhaustion takes today (find it and mirror it exactly; the always-resolves contract holds). Update the deps JSDoc's worst-case paragraph (37-55): with a signal, in-flight requests abort too; the ~135s figure becomes the no-signal worst case.
- [ ] **Step 3: Hook.** `prepareManagedVoice({ client: ..., loadClip: ..., signal: ports.signal })`. The existing post-await `ports.signal.aborted` check stays (it now usually sees an already-degraded result, and still guards the non-network tail).
- [ ] **Step 4: Tests.**
  - Client: caller signal fired pre-flight → `'aborted'` error, fetch never called; fired mid-flight (mock fetch rejects with the forwarded reason) → `'aborted'`, NOT `'timeout'`; timeout still maps to `'timeout'` when the caller signal never fires; listener removed after settle (fire the signal after resolution — nothing throws, no unhandled rejection).
  - Core: signal fired between warm-ensure and the poll loop → resolves via the deadline-style degrade result, no further client calls; deps without signal behave byte-identically to today (existing tests unchanged and green).
  - Hook: existing aborted test still passes unchanged.
- [ ] **Step 5: Gates.** Full suite green; tsc baseline unchanged.
- [ ] **Step 6: Commit**

```bash
git add src/services/clients/ManagedVoicesClient.ts src/services/clients/ManagedVoicesClient.test.ts src/services/providers/managedVoicePrep.ts src/services/providers/managedVoicePrep.test.ts src/services/providers/KizunaAISonioxProviderConfig.ts
git commit -m "feat(providers): the voice-prep network calls honor the start aborter"
```

### Task 5: The buttons cancel an in-flight Start

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: all 30 `src/locales/*/translation.json` (one new key)

With Tasks 3-4, `disconnectConversation` genuinely cancels a Start. The buttons expose it: today the simple button's init-time click is dead (routes to connectConversation, blocked by the re-entry guard) and the advanced button is disabled outright.

- [ ] **Step 1: Locale key.** Add `mainPanel.clickToCancel`: en `"Click to cancel"`, translated appropriately in the other 29 locales (mirror how `mainPanel.preparingVoice` landed — same file positions, real translations, not English copies). Run the locale-consistency test to prove parity.

- [ ] **Step 2: Simple footer button** (~4069-4095): onClick becomes `isSessionActive || isInitializing ? disconnectConversation : connectConversation`; add `title={isInitializing ? t('mainPanel.clickToCancel', 'Click to cancel') : !isSessionActive ? startBlockMessage : undefined}`. The init-time label (spinner + phase) stays.

- [ ] **Step 3: Advanced footer button** (~4189-4227): disabled becomes `!isSessionActive && !canStartSession && !isInitializing` (an init-time click must be allowed); onClick's dispatch becomes `if (isSessionActive || isInitializing) { disconnectConversation(); } else { connectConversation(); }` and the trackEvent action becomes `isSessionActive ? 'stop' : isInitializing ? 'cancel' : 'start'`; add `title={isInitializing ? t('mainPanel.clickToCancel', 'Click to cancel') : undefined}` on the button. Init-time label stays.

- [ ] **Step 4: Sanity trace (report, no code):** confirm in writing the cancel path for each phase — during prepare (aborter fires → silent discard; with T4 the network calls abort too), during acquire (T3's post-acquire release), after clients start constructing (pre-existing disconnect flow). Note that `disconnectConversation`'s re-entry guard makes double-cancel safe.

- [ ] **Step 5: Gates.** Full suite green (incl. locale-consistency); tsc baseline unchanged; `npx vite build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/locales
git commit -m "feat(mainpanel): an in-flight start is cancellable from both footers"
```

### Task 6: Stage close-out

- [ ] **Step 1: Sweep + gates**

- `grep -n "soniox\|Soniox" src/components/MainPanel/MainPanel.tsx` — classify every hit; allowed: the Both-mode planning identifiers inside `connectConversation` (`sonioxBothPlan`, `sonioxSharedBoth`, `sonioxSplitBoth` and their wiring uses) and comments. Any soniox-named identifier in state/render-tree code = BLOCKED.
- `grep -nE "Provider\.[A-Z_]+" src/components/MainPanel/MainPanel.tsx` — still exactly the 8 analytics fallbacks + comments.
- `npx vitest run` green; `npx vite build` succeeds.

- [ ] **Step 2: Spec corrections** (append-only landed-reality notes, the S4/S5/S6 precedent, under the UI section and the S7 row's context): (a) the "remaining ladder removal" was a no-op — S4-S6 had already deleted every rung; nothing remained for S7; (b) `<SessionCountdown>` landed with props `{ active, getSnapshot: () => BudgetSnapshot | null }` and self-nulling render (the budget gate lives inside the component), not a conditionally-rendered `getSnapshot`-only sketch; the state block deleted was S6's regeared block (the sketch's L1409-1452 anchors were stale); (c) Start cancellability landed beyond the sketch: the S6 prepare-aborter became a Start-scoped aborter surviving through the acquire (post-acquire `release('aborted')`), `ManagedVoicesClient` gained a caller-signal path following the SonioxTtsRest no-`AbortSignal.any` precedent, and both footer buttons cancel during init (one new locale key `mainPanel.clickToCancel`; the advanced button is no longer disabled while initializing — a deliberate, small visible-behavior change); (d) `formatRemainingTime` moved with the countdown into the component.

- [ ] **Step 3: Ledger note** (echo to this plan's SDD progress.md): "S7 open item: ManagedSonioxSession.acquire still takes no AbortSignal (the lease acquire itself is short; the post-acquire release covers its window) — revisit only if acquire latency ever grows."

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md
git commit -m "docs(specs): record the landed S7 contract deltas"
```

---

## Self-review notes

- **Spec coverage**: component render test with interval + low threshold → T1 cases 3-8; countdown gated on budget presence → T1 case 2 + the component's self-nulling render; no soniox identifier in the render tree → T2 deletes `sonioxCountdown`/`sonioxRemainingLow`, T6 sweeps; ladder removal → resolved as already-done, recorded in T6(a).
- **Carried S6 items**: acquire-window gap → T3 (with a golden mirror case); ManagedVoicesClient signal → T4 (per the SonioxTtsRest precedent); the cancel affordance driving both → T5. ManagedSonioxSession.acquire signal explicitly re-parked in T6 Step 3.
- **Type consistency**: `BudgetSnapshot` reused from ProviderDescriptor (no new type); `getSnapshot`/`getBudgetSnapshot` naming consistent T1/T2; `startAbort`/`startAbortRef` naming consistent T3/T5.
- **Ordering**: T1 before T2 (component exists before render); T3 before T5 (cancel-during-init must reach the acquire window to be sound); T4 before T5 (so cancel actually interrupts the network worst case); T3 and T4 independent of each other; T6 last.
- **Deliberate scope exclusions**: no MainPanel React harness (the buttons' wiring is review-verified + the seam behavior is pinned at the hook/golden level); no ManagedSonioxSession.acquire signal; no S8 items.
