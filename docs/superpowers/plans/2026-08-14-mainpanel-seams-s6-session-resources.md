# MainPanel Seams S6: Session Resources (Managed Lease) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the managed Soniox session lease out of MainPanel onto a new generic `acquireSessionResources`/`SessionResources` descriptor seam, and land the prepareToStart aborter that S4's contract promised.

**Architecture:** The lease block in `connectConversation` (wiring resolution → token → `ManagedSonioxSession.acquire()` → per-leg options → budget → end()) becomes an optional descriptor method on the kizuna twin; MainPanel holds one provider-agnostic `sessionResourcesRef`, applies leg options generically, releases from `afterBothLegs` at both teardown sites, and drives the countdown off `resources.budget` (a data condition). A Start re-entry guard plus a live abort path make `ports.signal` real.

**Tech Stack:** TypeScript/React (sokuji), vitest, existing descriptor registry.

**Spec:** `docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md` §`acquireSessionResources` (L210-251). Landed-reality corrections discovered during planning are listed in Task 7 and get recorded in the spec the same way S4/S5 did.

## Global Constraints

- MainPanel dispatches on capabilities and data, never provider identity. Post-stage sweep whitelist for `grep -nE "Provider\.[A-Z_]+" src/components/MainPanel/MainPanel.tsx`: exactly the 8 analytics fallbacks + comments. The countdown gate (`provider !== Provider.KIZUNA_AI_SONIOX`, today ~L1298) and the lease gate (`isManagedSoniox`, today ~L1948-1950) must be GONE.
- Descriptors and provider-seam modules never import settingsStore (settingsStore imports every descriptor — the reverse edge cycles). i18n and `services/clients/*` imports are allowed in descriptors (precedent: ManagedVoicesClient, and `ManagedSonioxSession` itself imports i18n at runtime).
- `ClientOptions.sonioxManaged` keeps its exact name and shape (churn control, spec L250). After this stage it is produced (twin's `legClientOptions`) and consumed (twin's `createClient`) inside the same descriptor module; MainPanel's only remaining mention is the generic `legOptions?.sonioxManaged` credential-skip check in `createAIClient`, which is a data check on a ClientOptions field, not provider-identity dispatch.
- Ref-null-before-release is preserved verbatim at both teardown sites: `afterBothLegs` reads the ref, nulls it, THEN calls `release(...)` — that ordering is the re-entrancy guard against a double session-end POST.
- Normative acquire error path (spec L247): the descriptor either returns resources or throws AFTER cleaning up its own partial state (`session.end()` is idempotent and no-ops without a lease). MainPanel sets `sessionResourcesRef` only on success and NEVER calls `release()` for a failed acquire; the outer catch routes through `disconnectConversation` whose `afterBothLegs` then finds a null ref.
- The effective-textOnly rule (`speakerWillStart ? useSettingsStore.getState().textOnly : true`) and its full rationale comment stay at the MainPanel computation site (spec L232-237); the descriptor consumes the resolved value.
- `managedSonioxSplit.test.ts` must stay green through Task 1's move with only import-path edits.
- Per task: `npx vitest run` fully green; `npx tsc --noEmit 2>&1 | grep -c "error TS"` unchanged from the pre-task baseline (baseline it first); tasks touching MainPanel also run `npx vite build`. One commit per task with the exact message given; `git status --porcelain` clean after commit (untracked `.superpowers/` is gitignored and fine); never push mid-stage.

## Key current-code facts (verified 2026-08-14, HEAD f8b8109a)

- Lease block: `MainPanel.tsx` ~1938-2010 inside `connectConversation` (starts ~1769). `startDescriptor` (fetched for prepareToStart at ~1797) is still in scope there.
- `resolveManagedSonioxWiring(input): ManagedSonioxWiring` — never returns null; the null case in today's `managedWiring` is the provider gate, not the resolver.
- `managedLegOptions(leg: SessionLeg, session, wiring): ClientOptions['sonioxManaged']` — returns `undefined` for a leg with no role; `SessionLeg = 'speaker' | 'participant'` (verify in `managedSonioxSplit.ts`).
- `ManagedSonioxSession` constructor takes `{ sessionToken, onEvent?: (type: string, data: unknown) => void }`; `onEvent` fires exactly two types: `'session.retry'` (acquire, on 409) and `'session.started_refused'` (reportStartedRefusal). The spec's single-member vocabulary is stale — corrected in Task 7.
- `end()` guard: `if (!leaseId || this.endSignalled) return;` — idempotent AND no-op without a lease.
- `SonioxBudgetSnapshot` lives in `SonioxCostMeter.ts` (not ManagedSonioxSession.ts); `session.getBudgetSnapshot(): SonioxBudgetSnapshot | null`; MainPanel currently converts via `computeSonioxRemainingMs(Date.now(), info)` / `computeSonioxBudgetTotalMs(info)` each second, caching the snapshot once in `sonioxBudgetInfoRef`.
- Teardown: exactly two literal `await teardownSessionLegs({...})` sites — site 1 in `disconnectConversation` (~1666, callbacks at 1666-1725, afterBothLegs lease lines at ~1721-1723), site 2 in the noChannelCameUp abort branch (~2503-2522, NO `speaker` callback by design, its comment at 2490-2496 explains why). The outer catch (~2625) reaches teardown only via `await disconnectConversation()`.
- `managedSonioxSessionRef` has exactly 3 write sites: acquire (~2001), site-1 afterBothLegs (~1721-1723), site-2 afterBothLegs (~2519).
- prepareToStart dispatch (~1801-1826) already creates a REAL `prepareAbort = new AbortController()` with a comment explicitly deferring the aborter to S6; nothing calls `.abort()` and nothing checks `.aborted` yet. `connectConversation` has NO re-entry guard (acknowledged at ~419-427, "left for a later stage"); `disconnectConversation` has `disconnectInProgressRef`.
- Countdown effect (~1295-1325) gates on `provider !== Provider.KIZUNA_AI_SONIOX` with deps `[isSessionActive, provider]`; `sonioxRemainingLow` derives below it; the JSX consuming `sonioxCountdown` is duplicated in both footers (~4132-4139, ~4276-4283) and is S7's target — S6 keeps `sonioxCountdown`/`sonioxRemainingLow`/JSX, only regears the data source.
- `createAIClient(useWebRTC, sonioxManaged?: ClientOptions['sonioxManaged'])` (~796-844): merges `sonioxManaged` into the ClientOptions literal handed to `descriptor.createClient`; skips `extractCredentials` when `sonioxManaged` is present (the acquire already spent the auth token).
- `KIZUNA_SIGN_IN_REQUIRED` is exported from `KizunaAISonioxProviderConfig.ts`; MainPanel imports it today only for the lease block's token check.
- Stale prose: `ManagedSonioxSession.ts:27` and `SonioxSessionOutcome.ts:49` reference a function `managedSonioxArgFor` that no longer exists (it's `managedLegOptions` now).

---

### Task 1: Relocate managedSonioxSplit beside its future caller

**Files:**
- Move: `src/components/MainPanel/managedSonioxSplit.ts` → `src/services/providers/managedSonioxSplit.ts`
- Move: `src/components/MainPanel/managedSonioxSplit.test.ts` → `src/services/providers/managedSonioxSplit.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx` (one import path)
- Modify: any other importer found by grep (expect none besides the test itself)

The kizuna twin (Task 3) will call `resolveManagedSonioxWiring`/`managedLegOptions`, and a descriptor must not import from `components/`. The module is already pure by construction (both imports are `import type`; its own header says so) — this is the S5-T1 precedent applied again.

- [ ] **Step 1: Verify the module is pure and find all importers**

Run: `grep -rn "managedSonioxSplit" src/ --include='*.ts' --include='*.tsx' -l` and `head -30 src/components/MainPanel/managedSonioxSplit.ts`. Expected importers: `MainPanel.tsx`, the test file, nothing else. Both module imports must be `import type`.

- [ ] **Step 2: git mv both files, fix import paths**

```bash
git mv src/components/MainPanel/managedSonioxSplit.ts src/services/providers/managedSonioxSplit.ts
git mv src/components/MainPanel/managedSonioxSplit.test.ts src/services/providers/managedSonioxSplit.test.ts
```

In the moved module: its `import type ... from '../../services/providers/ProviderDescriptor'` becomes `'./ProviderDescriptor'`; its `import type ... from '../../services/clients/ManagedSonioxSession'` becomes `'../clients/ManagedSonioxSession'`. In the moved test: relative paths one level shallower accordingly. In `MainPanel.tsx`: `from './managedSonioxSplit'` → `from '../../services/providers/managedSonioxSplit'`. Append one line to the module's header comment: `// Moved beside its caller (KizunaAISonioxProviderConfig.acquireSessionResources, S6); stays type-only-import pure so a descriptor uses it without cycles.`

- [ ] **Step 3: Gates**

Run: `npx vitest run` (all green, same test count), `npx tsc --noEmit` count unchanged. Grep tree for `components/MainPanel/managedSonioxSplit` — zero hits.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(providers): move the managed-soniox split module beside its future caller"
```

### Task 2: The acquireSessionResources contract

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts`
- Modify: `src/services/providers/descriptorRegistry.test.ts` (append S6 describe at EOF)

**Interfaces (Produces):** `BudgetSnapshot`, `SessionResources`, `AcquireSessionResourcesContext`, and the optional method `acquireSessionResources?` — consumed verbatim by Tasks 3-6.

- [ ] **Step 1: Add the types to ProviderDescriptor.ts** (place them after the `PrepareOutcome`/`PreparePorts`/`InitPhase` block; `acquireSessionResources?` goes on the interface directly after `prepareToStart?`):

```ts
/** Provider-neutral view of a metered session budget. The soniox descriptor
 *  adapts its SonioxBudgetSnapshot behind this; nothing provider-shaped
 *  crosses the seam. */
export interface BudgetSnapshot {
  remainingMs: number;
  totalMs: number;
}

/**
 * Session-scoped resources a provider acquires before any client exists and
 * releases after every client is down. MainPanel holds exactly one,
 * provider-agnostically, in sessionResourcesRef.
 */
export interface SessionResources {
  /** Per-leg additions to ClientOptions (today: the sonioxManaged bundle).
   *  Empty object when this leg gets nothing. A non-empty result means the
   *  acquire already produced this leg's credentials, so createAIClient
   *  skips extractCredentials for it. */
  legClientOptions(role: 'speaker' | 'participant'): Partial<ClientOptions>;
  /** Present iff the session runs on a metered budget. Drives the countdown
   *  generically — a data condition, not a provider condition. Returns null
   *  while the budget is not yet known. */
  budget?: () => BudgetSnapshot | null;
  /** Idempotent. 'aborted' = Start failed after acquire (the no-channel
   *  abort branch); 'disconnect' = normal teardown, including the
   *  init-failure unwind that routes through disconnectConversation. Called
   *  from afterBothLegs at both teardown sites, strictly after both legs are
   *  down — and never for a failed acquire (see acquireSessionResources). */
  release(reason: 'disconnect' | 'aborted'): void;
}

export interface AcquireSessionResourcesContext {
  getAuthToken: () => Promise<string | null>;
  /** The session's channel matrix, resolved by MainPanel. `textOnly` is the
   *  EFFECTIVE session text-only-ness — `speakerWillStart ? <store snapshot>
   *  : true` — resolved at the call site; the rule and its rationale live at
   *  the MainPanel computation, the descriptor consumes the value. */
  wiring: {
    speakerWillStart: boolean;
    participantWillStart: boolean;
    sharedBoth: boolean;
    splitBoth: boolean;
    textOnly: boolean;
  };
  /** Session-lifecycle events for the realtime log. Closed vocabulary — the
   *  managed lease emits 'session.retry' (409 on acquire) and
   *  'session.started_refused' (a refused session-started report). MainPanel
   *  forwards these to addRealtimeEvent; the log renders unknown types
   *  generically. */
  onEvent: (type: 'session.retry' | 'session.started_refused', data: unknown) => void;
}
```

Method on the descriptor interface, directly after `prepareToStart?`:

```ts
  /**
   * Acquire session-scoped resources (a lease, metered credentials) before
   * any client is constructed. Undefined on providers whose clients carry
   * their own key — MainPanel treats undefined as null resources.
   *
   * Deliberately separate from createClient: acquiring is an awaited network
   * round trip, createClient is synchronous and per-leg, and the resources
   * outlive any one client.
   *
   * Error path (normative): either return resources or throw AFTER cleaning
   * up your own partial state (ManagedSonioxSession.end() is idempotent and
   * no-ops without a lease, so a wrapper's catch may always call it).
   * MainPanel catches the throw, unwinds Start through the existing abort
   * path, and NEVER calls release() for a failed acquire.
   */
  acquireSessionResources?(ctx: AcquireSessionResourcesContext): Promise<SessionResources | null>;
```

- [ ] **Step 2: Append the registry pin at EOF of descriptorRegistry.test.ts** (mirror of the S4 block at its L614-626):

```ts
describe('S6 acquireSessionResources', () => {
  it('is declared only where a session leases resources (kizuna-soniox)', () => {
    const WITH_RESOURCES = [Provider.KIZUNA_AI_SONIOX];
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(typeof d.acquireSessionResources === 'function', `resource hook presence for ${id}`)
        .toBe(WITH_RESOURCES.includes(id));
    }
    // BYOK Soniox is explicitly resource-less: a user's own key never
    // exchanges a lease, mints no metered budget, and must not POST
    // session-end to the managed backend.
    expect(ProviderConfigFactory.getDescriptor(Provider.SONIOX).acquireSessionResources).toBeUndefined();
  });
});
```

Run: `npx vitest run src/services/providers/descriptorRegistry.test.ts` — the new it() FAILS (twin has no method yet). That is expected and correct ordering IF Task 3 lands in the same review cycle; since each task gates on a fully green suite, instead mark the assertion to match current reality: write `const WITH_RESOURCES: Provider[] = [];` with a `// Task 3 flips this to [Provider.KIZUNA_AI_SONIOX]` comment, and Task 3's commit flips it. The BYOK negative assertion stays as-is (true both before and after).

- [ ] **Step 3: Gates** — full suite green, tsc baseline unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(providers): descriptors learn acquireSessionResources / SessionResources"
```

### Task 3: The kizuna twin acquires its lease through the seam

**Files:**
- Modify: `src/services/providers/KizunaAISonioxProviderConfig.ts`
- Modify: `src/services/providers/descriptorRegistry.test.ts` (flip `WITH_RESOURCES`)
- Test: `src/services/providers/acquireSessionResources.kizunaSoniox.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's types; Task 1's `resolveManagedSonioxWiring`/`managedLegOptions` from `./managedSonioxSplit`; `ManagedSonioxSession` (runtime import), `computeSonioxRemainingMs`/`computeSonioxBudgetTotalMs`/`SonioxBudgetSnapshot` from `../clients/SonioxCostMeter`.
- Produces: `KizunaAISonioxProviderConfig.acquireSessionResources` — the only implementation; Task 4 dispatches it, Task 5 goldens it.

- [ ] **Step 1: Implement the method** (BYOK `SonioxProviderConfig` gets NOTHING):

```ts
async acquireSessionResources(ctx: AcquireSessionResourcesContext): Promise<SessionResources | null> {
  // The whole wiring decision, in one pure value: the matrix body to buy,
  // and the STT role each leg runs. Both roles are derived from the body,
  // so they mirror the server's own expansion — `credentialsFor` throws for
  // a role that was never issued, and `session-started` answers 400
  // `role_not_issued`, which leaves the lease at its start window while
  // both Soniox keys stay valid for the full grant.
  const wiring = resolveManagedSonioxWiring({
    speakerWillStart: ctx.wiring.speakerWillStart,
    participantWillStart: ctx.wiring.participantWillStart,
    textOnly: ctx.wiring.textOnly,
    sonioxSharedBoth: ctx.wiring.sharedBoth,
    sonioxSplitBoth: ctx.wiring.splitBoth,
  });
  const token = await ctx.getAuthToken();
  if (!token) throw new Error(KIZUNA_SIGN_IN_REQUIRED);
  const session = new ManagedSonioxSession({
    sessionToken: token,
    // The session's sink is typed `(type: string, ...)` because it must not
    // depend on any event union; the ctx port carries the closed two-member
    // vocabulary, so this narrows rather than widens — same escape as when
    // SonioxClient emitted these itself.
    onEvent: (type, data) =>
      ctx.onEvent(type as Parameters<AcquireSessionResourcesContext['onEvent']>[0], data),
  });
  try {
    await session.acquire(wiring.acquire);
  } catch (error) {
    // Normative error path: clean up our own partial state, then rethrow.
    // end() no-ops without a lease, so this is safe wherever acquire failed.
    session.end();
    throw error;
  }
  // Static budget parameters are read once (they don't change over the
  // lease); remaining time is recomputed against the clock on every call —
  // the caller polls once a second.
  let snapshot: SonioxBudgetSnapshot | null = null;
  return {
    legClientOptions: (role) => {
      const options = managedLegOptions(role, session, wiring);
      return options ? { sonioxManaged: options } : {};
    },
    budget: () => {
      snapshot ??= session.getBudgetSnapshot();
      return snapshot
        ? {
            remainingMs: computeSonioxRemainingMs(Date.now(), snapshot),
            totalMs: computeSonioxBudgetTotalMs(snapshot),
          }
        : null;
    },
    release: () => {
      // end() carries its own idempotency and no-lease guards; the reason
      // parameter is contract vocabulary, not behavior, today.
      session.end();
    },
  };
}
```

Verify `SessionLeg` is exactly `'speaker' | 'participant'` so `legClientOptions`'s parameter type matches `managedLegOptions`'s first parameter; if `SessionLeg` is a distinct alias, pass `role` through directly (they are structurally identical) and note it in the report.

- [ ] **Step 2: Flip the registry pin** — `WITH_RESOURCES = [Provider.KIZUNA_AI_SONIOX]`, drop the Task-3 comment.

- [ ] **Step 3: Write the tests** (`acquireSessionResources.kizunaSoniox.test.ts`, mock `../clients/ManagedSonioxSession` with a `vi.fn()` class exposing `acquire`/`end`/`getBudgetSnapshot`/`credentialsFor` spies; use `vi.useFakeTimers()` for budget math):

1. speaker-only ctx → `session.acquire` called with `{ mode: 'speaker', textOnly: <ctx value>, bothSplit: false }` (real `resolveManagedSonioxWiring` runs).
2. null token → throws `KIZUNA_SIGN_IN_REQUIRED`; `ManagedSonioxSession` never constructed.
3. `acquire` rejects → `end()` called exactly once, the same error rethrown, nothing returned.
4. `legClientOptions('speaker')` on a speaker-only session → `{ sonioxManaged: { credentials, session, role: 'spk_stt', announcesSessionOutcome: true } }` (credentials from the `credentialsFor` spy); `legClientOptions('participant')` → `{}` (no role).
5. `budget()` returns null while `getBudgetSnapshot` returns null, then `{ remainingMs, totalMs }` computed via the real SonioxCostMeter helpers once a snapshot exists; the snapshot is fetched at most once after it is non-null (spy call count stays 2 across three `budget()` calls: one null, one hit, one cached).
6. `release('disconnect')` and `release('aborted')` each delegate to `end()`.
7. constructor `onEvent` forwards `('session.retry', data)` to `ctx.onEvent` with the same arguments.

- [ ] **Step 4: Gates** — full suite green (registry pin now passes flipped), tsc baseline unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/KizunaAISonioxProviderConfig.ts src/services/providers/descriptorRegistry.test.ts src/services/providers/acquireSessionResources.kizunaSoniox.test.ts
git commit -m "feat(providers): the kizuna-soniox twin leases its session through acquireSessionResources"
```

### Task 4: MainPanel holds one sessionResourcesRef

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

**Interfaces (Consumes):** Task 2's `SessionResources` type; Task 3's implementation via `startDescriptor.acquireSessionResources?.(...)`.

- [ ] **Step 1: Swap the refs and regear the countdown** (today ~1290-1325). Delete `sonioxBudgetInfoRef` and `managedSonioxSessionRef`; add:

```ts
// The session-scoped resources for the CURRENT session (today: the managed
// Soniox lease). Live here, not in a client, because they outlive any one
// client and acquiring them is an awaited round trip that
// ProviderDescriptor.createClient cannot make.
const sessionResourcesRef = useRef<SessionResources | null>(null);
```

Replace the countdown effect body (keep `sonioxCountdown` state and `sonioxRemainingLow` untouched — S7 owns them):

```ts
useEffect(() => {
  // Data condition, not a provider condition: the countdown runs whenever
  // the session's resources are metered. The resources are acquired before
  // any client is constructed and isSessionActive flips only after the legs
  // come up, so the ref is already populated on this effect's first
  // active-session run — for every managed row of the matrix including
  // split, which is why the allowance lives on the SESSION, not a client.
  const budget = isSessionActive ? sessionResourcesRef.current?.budget : undefined;
  if (!budget) {
    setSonioxCountdown(null);
    return;
  }
  const update = () => setSonioxCountdown(budget());
  update();
  const interval = setInterval(update, 1000);
  return () => clearInterval(interval);
}, [isSessionActive, provider]);
```

(`provider` stays in the deps: switching provider between sessions re-arms the effect exactly as today.)

- [ ] **Step 2: Replace the lease block** (~1938-2010, from the `// The managed Soniox lease belongs to the SESSION` comment through `managedSonioxSession = session; }`) with the generic dispatch. The textOnly rationale comment moves INTO the ctx literal verbatim; the design-decision-7 comment survives reworded:

```ts
// Session-scoped resources (design decision 7): everything the client used
// to do inside connect() — the session-key exchange, its 409 retry, the
// cost meter, and the session-started/session-end notifications — happens
// behind the descriptor's acquireSessionResources now.
//
// Deliberately NOT inside createAIClient: acquiring is an awaited network
// round trip and ProviderDescriptor.createClient is synchronous and returns
// exactly one client, so the descriptor cannot own it without going async
// for all eleven providers. On failure the descriptor cleans up its own
// partial state and throws; the outer catch unwinds through
// disconnectConversation, whose afterBothLegs finds this ref still null —
// a failed acquire is never release()d.
const sessionResources = startDescriptor.acquireSessionResources
  ? await startDescriptor.acquireSessionResources({
      getAuthToken,
      wiring: {
        speakerWillStart,
        participantWillStart,
        sharedBoth: sonioxSharedBoth,
        splitBoth: sonioxSplitBoth,
        // Must match the config of the leg that will actually run, because
        // it decides whether a TTS key is minted at all and at what rate
        // the allowance is spent.
        //
        // Speaker: the same one-shot snapshot getSessionConfig() reads below
        // (settingsStore: `config.textOnly = state.textOnly`). It stays the
        // speaker's answer in split Both too — the participant leg is
        // text-only either way, so only the speaker can want synthesis.
        //
        // No speaker leg: NOT that snapshot.
        // createParticipantSessionConfig() hard-codes `textOnly: true`
        // whatever the user's setting says, so reading the store here would
        // buy a speech-to-speech lease for a session that never opens a TTS
        // socket, and burn the countdown at that rate. (The backend also
        // ignores `textOnly` for mode 'participant'; this keeps the client
        // honest rather than relying on that.)
        textOnly: speakerWillStart ? useSettingsStore.getState().textOnly : true,
      },
      // The store's event union doesn't contain these types, exactly as when
      // SonioxClient emitted them (emitRealtime casts the whole event
      // `as any`); the same escape, narrowed to the one field that needs it.
      onEvent: (type, data) =>
        addRealtimeEvent({ type: type as EventData['type'], data }, 'client', type),
    })
  : null;
sessionResourcesRef.current = sessionResources;
```

- [ ] **Step 3: Leg call sites** — both `createAIClient` calls swap their second argument:

```ts
speakerClientRef.current = await createAIClient(
  useWebRTC,
  sessionResources?.legClientOptions('speaker'),
);
```

and the participant call site equivalently with `'participant'` (read the current call — it may sit behind `resolveParticipantSlot`; only the second argument changes).

- [ ] **Step 4: Widen createAIClient** (~796-844): second parameter becomes

```ts
    // Per-leg additions from the session's resources
    // (SessionResources.legClientOptions) — today the managed Soniox
    // sonioxManaged bundle; undefined/empty for BYOK and for every provider
    // whose descriptor acquires nothing. Stated BY REFERENCE, never restated.
    legOptions?: Partial<ClientOptions>,
```

The credential skip keys on the field, not the object (an empty `{}` means "no additions" and must still extract):

```ts
    // The managed twin's "credential" IS the auth session token, and
    // acquireSessionResources has already spent it: the exchange left the
    // temporary Soniox keys in legOptions.sonioxManaged.credentials.
    // Re-running extractCredentials would fire a second getToken round trip
    // for a value this path no longer reads; the sign-in gate it provided
    // lives in the acquire path (KIZUNA_SIGN_IN_REQUIRED).
    const creds = legOptions?.sonioxManaged
      ? ({ ok: true, primary: '' } as const)
      : await descriptor.extractCredentials(slice, { getAuthToken });
```

and the final options literal spreads: `descriptor.createClient({ transport: effectiveTransportType, webrtcOptions, ...legOptions })` (replacing the explicit `sonioxManaged` field).

- [ ] **Step 5: Both afterBothLegs sites release**. Site 1 (disconnectConversation, ~1721-1723):

```ts
afterBothLegs: () => {
  const resources = sessionResourcesRef.current;
  sessionResourcesRef.current = null;
  resources?.release('disconnect');
},
```

Site 2 (noChannelCameUp branch, ~2517-2521, keep its two-line comment adjusting `end()` → `release()`):

```ts
// Idempotent, and a no-op when nothing was acquired. The ref is
// cleared BEFORE release() so no re-entry can produce a second POST.
afterBothLegs: () => {
  const aborted = sessionResourcesRef.current;
  sessionResourcesRef.current = null;
  aborted?.release('aborted');
},
```

- [ ] **Step 6: Sweep the corpse.** Delete the now-dead locals (`isManagedSoniox`, `managedWiring`, `managedSonioxSession`) and imports: `ManagedSonioxSession`, `computeSonioxRemainingMs`, `computeSonioxBudgetTotalMs`, `SonioxBudgetSnapshot`, `resolveManagedSonioxWiring`, `managedLegOptions`, `KIZUNA_SIGN_IN_REQUIRED`. Add `SessionResources` to the existing type-only ProviderDescriptor import. `teardownSessionLegs` and `resolveParticipantSlot` imports STAY. Delete `kizunaBaseProvider`/`isKizunaManagedProvider` from the Provider import ONLY if grep shows no remaining use in the file. Grep gates: `managedSonioxSessionRef|sonioxBudgetInfoRef|isManagedSoniox|managedWiring|KIZUNA_SIGN_IN_REQUIRED` → zero hits in MainPanel.tsx.

- [ ] **Step 7: Gates** — `npx vitest run` green, tsc baseline unchanged, `npx vite build` succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): the managed lease runs through sessionResourcesRef"
```

### Task 5: The resources seam gets its golden

**Files:**
- Test: `src/services/providers/sessionResourcesWiring.test.ts` (new)

**Interfaces (Consumes):** the real twin `acquireSessionResources` (mocked `ManagedSonioxSession` only), the real `teardownSessionLegs` from `./managedSonioxSplit`.

Follow the voicePrepWiring.test.ts pattern: drive real production seams, mirror MainPanel's application semantics in a small helper, assert the CONTRACT KEYS so a drift on either side goes red.

- [ ] **Step 1: Write the test file** with these cases (mock `../clients/ManagedSonioxSession` as in Task 3's test; get the descriptor via `ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX)`):

1. **Leg-options key contract**: `legClientOptions('speaker')` for a speaker-only acquire returns an object whose ONLY key is `sonioxManaged` (`expect(Object.keys(opts)).toEqual(['sonioxManaged'])`) and whose `sonioxManaged.role` is `'spk_stt'` — pins the twin's production against the ClientOptions field name MainPanel's `legOptions?.sonioxManaged` check consumes.
2. **Release ordering (site-1 mirror)**: with acquired `resources`, run the REAL `teardownSessionLegs` with an order log —

```ts
const order: string[] = [];
let ref: SessionResources | null = resources;
await teardownSessionLegs({
  speaker: async () => { order.push('speaker-down'); },
  participant: async () => { order.push('participant-down'); },
  afterBothLegs: () => {
    const r = ref; ref = null;
    r?.release('disconnect');
    order.push('release');
  },
});
expect(order).toEqual(['speaker-down', 'participant-down', 'release']);
expect(endSpy).toHaveBeenCalledTimes(1);
```

3. **A throwing speaker leg cannot strand the release**: same shape, `speaker` rejects — assert `participant-down` and `release` still happen (the nested-finally guarantee the spec calls load-bearing).
4. **Abort-site mirror**: no `speaker` callback at all (site 2 passes none), `release('aborted')` — still exactly one `end()`.
5. **Failed acquire is never released**: `acquire` rejects → the thrown error propagates, `end()` was called once by the twin's own catch, and no `SessionResources` object exists for anyone to release — then a site-1-mirror teardown run with `ref = null` (what MainPanel's outer catch → disconnect does) calls `release` zero additional times (`endSpy` count stays 1).
6. **Double release collapses**: call `release('disconnect')` twice through the ref-null mirror (second run sees null ref) → `end()` called exactly once from the mirror; and a direct second `resources.release('aborted')` delegates to `end()` again, which is fine because the REAL `end()` guard (`!leaseId || endSignalled`) makes the POST fire once — assert via the mock that release simply delegates, and state in a comment that end()'s own idempotency is pinned by ManagedSonioxSession's tests.

- [ ] **Step 2: Red/green the key contract** — temporarily rename the twin's `sonioxManaged` key in `legClientOptions` and watch case 1 fail; restore. Note the check in the report.

- [ ] **Step 3: Gates** — full suite green, tsc baseline unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/sessionResourcesWiring.test.ts
git commit -m "test(providers): golden the session-resources seam and its release ordering"
```

### Task 6: The aborter lands

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/services/providers/KizunaAISonioxProviderConfig.ts` (hook honors the signal)
- Modify: `src/services/providers/prepareToStart.kizunaSoniox.test.ts` (new case)
- Modify: `src/services/providers/voicePrepWiring.test.ts` (aborted-discard mirror case)

This is the aborter S4's contract promised (the deferral comment sits at today's ~1801-1806) plus the Start re-entry guard without which an abort ref is unsound (a second Start would clobber the first's controller).

- [ ] **Step 1: Refs** — next to `disconnectInProgressRef`:

```ts
// Start re-entry guard, the disconnect guard's mirror: a second Start while
// one is mid-flight would run two prepares (and two resource acquires)
// against one set of session refs, and let one attempt's initPhase clear
// stomp the other's label. Blocked outright, like disconnect re-entry.
const connectInProgressRef = useRef(false);
// The in-flight Start's prepare aborter. disconnectConversation fires it so
// a teardown racing a pending prepareToStart discards that prepare's result
// silently (the normative rule on ProviderDescriptor.prepareToStart)
// instead of applying patches to a session that no longer exists.
const prepareAbortRef = useRef<AbortController | null>(null);
```

- [ ] **Step 2: Guard connectConversation.** First lines of the callback body:

```ts
if (connectInProgressRef.current) {
  console.info('[Sokuji] [MainPanel] connectConversation re-entry blocked (already in progress)');
  return;
}
connectInProgressRef.current = true;
```

and extend the EXISTING `finally` (the one doing `setIsInitializing(false)`):

```ts
} finally {
  setIsInitializing(false);
  connectInProgressRef.current = false;
  prepareAbortRef.current = null;
}
```

- [ ] **Step 3: Make the signal live.** At the prepare dispatch, replace the five-line deferral comment (~1802-1806) with:

```ts
// A live aborter: disconnectConversation fires it if a teardown races this
// prepare. The aborted-discard check below implements the contract's
// silent-discard rule — the result (or rejection) of an aborted prepare is
// thrown away and nothing is shown.
const prepareAbort = new AbortController();
prepareAbortRef.current = prepareAbort;
```

Directly after the try/catch that produces `prepared` (BEFORE the `if (!prepared.ok)` branch):

```ts
prepareAbortRef.current = null;
if (prepareAbort.signal.aborted) {
  // A teardown raced the prepare: discard the result (or rejection)
  // silently — nothing applied, nothing shown.
  return;
}
```

(The early return passes through the outer `finally`, which resets `isInitializing` and the two refs.)

- [ ] **Step 4: disconnect aborts.** In `disconnectConversation`, immediately after its re-entry guard sets `disconnectInProgressRef.current = true`:

```ts
// Discard any in-flight prepare: its patches would target the session this
// teardown is ending.
prepareAbortRef.current?.abort();
prepareAbortRef.current = null;
```

- [ ] **Step 5: The kizuna hook honors the signal.** In `KizunaAISonioxProviderConfig.prepareToStart`, right after `const result = await prepareManagedVoice(...)` resolves (inside the try, before mapping through `resolveVoicePrepOutcome`):

```ts
if (ports.signal.aborted) {
  // The Start this prepare belonged to is gone; hand back nothing to apply.
  // MainPanel discards an aborted prepare wholesale anyway — this keeps the
  // hook honest about the contract rather than relying on that.
  return { ok: true };
}
```

(The network core itself does not yet take an external signal — `ManagedVoicesClient` only knows `budgetMs`/`AbortSignal.timeout` internally. Threading a caller signal through its API is future work, recorded in the stage ledger; the S7 countdown/cancel UI is its natural driver.)

- [ ] **Step 6: Tests.**
- `prepareToStart.kizunaSoniox.test.ts`, new case: the mocked core fires the ports' AbortController during its await, then resolves normally → the hook returns exactly `{ ok: true }` (no sessionPatch/settingsPatch/expect/notice) and `onPhase` was still cleared to null (the finally).
- `voicePrepWiring.test.ts`, one new mirror case in the envelope describe: an outcome arriving after the signal fired is discarded wholesale — the mirror application helper takes `aborted: boolean` mirroring MainPanel's new check-before-apply line, and with `aborted: true` neither patch is applied, no notice appended (mirrors the `return` before `if (!prepared.ok)`).

- [ ] **Step 7: Also update** the stale race-note sentence (~419-427): the clause "connectConversation has no re-entry guard, so a double-Start can still let one attempt's clear stomp another's label; that hazard predates this hook and is left for a later stage" is now false — rewrite to state the guard exists (`connectInProgressRef`) and the hazard is closed.

- [ ] **Step 8: Gates** — full suite green, tsc baseline unchanged, `npx vite build` succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/services/providers/KizunaAISonioxProviderConfig.ts src/services/providers/prepareToStart.kizunaSoniox.test.ts src/services/providers/voicePrepWiring.test.ts
git commit -m "feat(mainpanel): the prepare aborter goes live behind a start re-entry guard"
```

### Task 7: Stage close-out

- [ ] **Step 1: Sweep + gates**

- `grep -nE "Provider\.[A-Z_]+" src/components/MainPanel/MainPanel.tsx` — classify all; expected residue: 8 analytics fallbacks + comments ONLY. The countdown gate and lease gate must be GONE. Any other hit = BLOCKED.
- `grep -n "ManagedSonioxSession\|SonioxCostMeter\|managedLegOptions\|resolveManagedSonioxWiring\|KIZUNA_SIGN_IN_REQUIRED" src/components/MainPanel/MainPanel.tsx` — zero hits (comments included; reword any comment that still names them, the S5-M-finding precedent says greps should come back clean where cheap).
- `npx vitest run` green; `npx vite build` succeeds.

- [ ] **Step 2: Prose fixes** — `ManagedSonioxSession.ts:27` and `SonioxSessionOutcome.ts:49`: `managedSonioxArgFor` → `managedLegOptions` (comment-only; verify current line numbers by grep).

- [ ] **Step 3: Spec corrections** (one commit, the S4/S5 precedent — append landed-reality notes to the spec's `acquireSessionResources` section, do not rewrite the sketch): (a) `onEvent`'s closed vocabulary is TWO members — `'session.retry' | 'session.started_refused'` — the sketch's single-member claim was stale against `ManagedSonioxSession`'s two emission sites; (b) `legClientOptions` returns `{}` (never undefined) and `createAIClient`'s second parameter widened to `Partial<ClientOptions>` spread with the credential skip keyed on `legOptions?.sonioxManaged`; (c) the countdown effect regeared onto `resources.budget` in S6 (S7 note: only the `<SessionCountdown>` component extraction and state-block removal remain); (d) the ref-before-acquire trick is gone — the descriptor owns failed-acquire cleanup exactly as the normative path specifies, and MainPanel sets the ref only on success; (e) the prepare aborter + Start re-entry guard landed in S6 as the section's deferral comment promised (quote-check the spec's S6/S4 sentences about the aborter; minimal edits only where wording mismatches). Also record in the ledger (not the spec): threading an external AbortSignal through `ManagedVoicesClient` remains open for S7's cancel affordance.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md src/services/clients/ManagedSonioxSession.ts src/services/clients/SonioxSessionOutcome.ts
git commit -m "docs(specs): record the landed S6 contract deltas"
```

---

## Self-review notes

- **Spec coverage**: contract sketch → T2 (with the onEvent vocabulary corrected); twin wrapping resolveManagedSonioxWiring + acquire + managedLegOptions → T3; one provider-agnostic sessionResourcesRef → T4; release('disconnect') from afterBothLegs / release('aborted') from the abort branch / failed-acquire-never-released → T4+T5 (golden); `ClientOptions.sonioxManaged` name+shape kept, produced and consumed in the descriptor module → T1+T3; textOnly rule stays at MainPanel → T4 Step 2; countdown as data condition → T4 Step 1 (S6 does the data source; S7 keeps the component extraction); release-ordering assertion from the spec's S6 row → T5 cases 2-5; the aborter (spec's normative silent-discard + the code's own S6 deferral comment) → T6.
- **Type consistency**: `SessionResources`/`BudgetSnapshot`/`AcquireSessionResourcesContext` named identically in T2/T3/T4/T5; `legClientOptions(role)` role type matches `SessionLeg`; `WITH_RESOURCES` two-step (empty in T2, flipped in T3) keeps every task's suite green.
- **Ordering argument**: T1 before T3 (import direction); T2 before T3 (types); T3 before T4 (MainPanel dispatches a method that must exist — note the dispatch is optional-chained, so T4 would run even without T3, but the countdown/leg options would silently no-op for managed sessions; sequential landing avoids that window entirely); T5 after T4 so the golden mirrors the landed application shape; T6 independent of T5 but after T4 (it edits the same MainPanel region the lease block vacated).
- **Deliberate deltas from the spec sketch, each recorded in T7**: onEvent vocabulary (two members), legClientOptions `{}`-never-undefined, createAIClient widening, countdown regeared one stage early (forced: the ref it read is deleted in S6), descriptor-owned failed-acquire cleanup replacing the ref-before-acquire trick.
- **What S6 deliberately does NOT do**: no `<SessionCountdown>` component, no state-block deletion, no cancel-affordance UI, no external signal through ManagedVoicesClient's network calls, no analytics/anchor/WebRTC work (S7/S8).
