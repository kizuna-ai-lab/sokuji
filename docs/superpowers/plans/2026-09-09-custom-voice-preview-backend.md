# Custom Voice Preview — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `POST /api/soniox/session-key` issue a single-use TTS key for a
voice preview, billed through the existing reconciler, without any shipped
client observing a change.

**Architecture:** A preview is a session with one TTS stream and no STT. A new
`preview_tts` role joins the closed role vocabulary; a third `mode` value
expands to it; the lease table's invariant widens from "at least one
transcription stream" to "at least one stream, STT or TTS". Everything else —
attribution via `client_reference_id`, `cost × K` pricing, the sweep — is reused
unchanged.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Drizzle over D1
(SQLite), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-custom-voice-preview-design.md`
(phase 1 of §9; §5.4 and §5.6 are the substantive sections)

**Repository:** This plan executes in **`kizuna-ai-lab/sokuji-backend`**, not in
the repo that holds it. The spec lives in `kizuna-ai-lab/sokuji` because it
covers both repos, and the plan is kept beside it so the two travel together.
Copy or reference this file from the backend repo when starting; every path
below is relative to the backend repo root.

## Global Constraints

- **No shipped client may observe a change.** Existing clients never send the
  new mode. `sttApiKey` becomes optional in the response *type* but must still
  always be present for every other mode — Task 5 pins this with its own test.
- **English-only** for all comments and documentation.
- **Conventional commit format** for every commit.
- **`npm test`** runs `vitest run`. **`npx tsc --noEmit`** is the type gate and
  is what turns Task 1's one-line union edit into the worklist for the rest.
- **Money is integer µUSD** throughout; 1 USD = 1,000,000 µUSD.
- **The role vocabulary is closed and self-enforcing.** `expandStreamRoles` is
  the only thing that mints role strings; `clientRefIdFor` re-checks membership
  at the mint site. Never accept a client-declared stream list.
- **`REVENUE_COEFFICIENT_K = 2.0`** and `CONSERVATIVE_RATE_MICRO_USD_PER_HOUR =
  { stt: 1_100_000, tts: 1_400_000 }` are existing values; do not change them.
- **Measured values to cite in comments** (spec §2): one preview costs Soniox
  678 µUSD, charging the user ~1356 µUSD; Soniox's real org ceilings are
  `transcribe_concurrent: 100` and `tts_concurrent: 25`; a one-shot REST `/tts`
  call does occupy one `tts_concurrent` slot.

---

### Task 1: The `preview_tts` role

**Files:**
- Modify: `src/config/soniox.ts`
- Test: `src/config/soniox.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `"preview_tts"` as a member of `SonioxStreamRole`
  - `SonioxAudioMode` gains `"voice_preview"`
  - `isPreviewRoleSet(roles: readonly SonioxStreamRole[]): boolean`
  - `PREVIEW_KEY_TTL_S: number` (= 30)
  - `expandStreamRoles({mode: "voice_preview", …})` → `["preview_tts"]`
  - `normalizeSessionShape({mode: "voice_preview"})` → `{mode: "voice_preview", textOnly: true, bothSplit: false}`

- [ ] **Step 1: Write the failing tests**

Append to `src/config/soniox.test.ts`:

```ts
describe("preview_tts role", () => {
    it("is a member of the closed vocabulary", () => {
        expect(isSonioxStreamRole("preview_tts")).toBe(true);
        expect(SONIOX_STREAM_ROLES).toContain("preview_tts");
    });

    it("is scoped to the tts_rt usage type and carries no mask bit", () => {
        expect(usageTypeForRole("preview_tts")).toBe("tts_rt");
        expect(roleKind("preview_tts")).toBe("tts");
        expect(sttRoleBit("preview_tts")).toBe(0);
    });

    it("expands from the voice_preview mode and nothing else", () => {
        expect(expandStreamRoles({ mode: "voice_preview", textOnly: true, bothSplit: false }))
            .toEqual(["preview_tts"]);
    });

    it("normalizes a bare voice_preview body", () => {
        expect(normalizeSessionShape({ mode: "voice_preview" }))
            .toEqual({ mode: "voice_preview", textOnly: true, bothSplit: false });
    });

    it("recognises its own role set and no other", () => {
        expect(isPreviewRoleSet(["preview_tts"])).toBe(true);
        expect(isPreviewRoleSet(["spk_stt", "spk_tts"])).toBe(false);
        expect(isPreviewRoleSet([])).toBe(false);
        // A preview is exactly one stream. A set that merely contains the role
        // is a bug, not a preview, and must not take the preview branches.
        expect(isPreviewRoleSet(["spk_stt", "preview_tts"])).toBe(false);
    });

    it("consumes a TTS slot and no transcription slot", () => {
        expect(usesTtsFor(["preview_tts"])).toBe(true);
        expect(sttStreamCount(["preview_tts"])).toBe(0);
    });
});

describe("every session mode still owns a transcription stream", () => {
    // The belt that replaces acquire's dropped guard (Task 3): no SESSION shape
    // may expand to a zero-STT role set, so only a preview can ever take the
    // widened invariant's new branch.
    const sessionShapes: SonioxSessionShape[] = [
        { mode: "speaker", textOnly: true, bothSplit: false },
        { mode: "speaker", textOnly: false, bothSplit: false },
        { mode: "participant", textOnly: true, bothSplit: false },
        { mode: "both", textOnly: true, bothSplit: true },
        { mode: "both", textOnly: false, bothSplit: true },
        { mode: "both", textOnly: true, bothSplit: false },
        { mode: "both", textOnly: false, bothSplit: false },
    ];
    it.each(sessionShapes)("%o expands to at least one STT role", (shape) => {
        expect(sttStreamCount(expandStreamRoles(shape))).toBeGreaterThanOrEqual(1);
    });
});
```

Add whatever of `isPreviewRoleSet`, `PREVIEW_KEY_TTL_S`, `SonioxSessionShape`,
`roleKind`, `sttStreamCount`, `usesTtsFor`, `usageTypeForRole` is missing to the
file's existing import from `./soniox`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/config/soniox.test.ts`
Expected: FAIL. `isPreviewRoleSet` is not exported, and `expandStreamRoles` does
not accept `"voice_preview"` (TypeScript will also reject the literal).

- [ ] **Step 3: Add the role and the mode**

In `src/config/soniox.ts`:

```ts
export const SONIOX_STREAM_ROLES = [
    "spk_stt", "spk_tts", "par_stt", "par_tts", "mix_stt", "mix_tts",
    // A voice preview: one synthesis REST call, no transcription. Deliberately
    // NOT `spk_tts` — attribution and pricing both branch on this role, and
    // reusing a session role would make a preview indistinguishable from a
    // session's synthesis leg in the usage logs.
    "preview_tts",
] as const;

export type SonioxAudioMode = "speaker" | "participant" | "both" | "voice_preview";
```

Add to `ROLE_USAGE_TYPE` — the ONE table, which is what `roleKind` reads, so
adding the row here is all that is needed for `roleKind("preview_tts") === "tts"`:

```ts
    preview_tts: "tts_rt",
```

`sttRoleBit` needs no change: `STT_ROLE_BIT` has no `preview_tts` key, so the
`role in STT_ROLE_BIT` test already returns 0. That asymmetry is load-bearing —
a TTS role carries no bit, which is why a preview lease cannot release through
the mask predicate and Task 7 releases it explicitly instead.

- [ ] **Step 4: Add the expansion, the normalizer branch, and the two helpers**

In `expandStreamRoles`, before the `default:` arm:

```ts
        case "voice_preview":
            // One stream, no STT. `textOnly` and `bothSplit` are structurally
            // meaningless here and are ignored the way `participant` ignores
            // `textOnly`.
            return ["preview_tts"];
```

In `normalizeSessionShape`, after the `participant` branch:

```ts
    if (mode === "voice_preview") {
        // VOCABULARY 2, third value. No textOnly requirement: a preview has no
        // cheaper variant to be silently upsold from, which is the risk the
        // `speaker`/`both` rows require the field against.
        return { mode: "voice_preview", textOnly: true, bothSplit: false };
    }
```

And, next to the other role predicates:

```ts
/** Soniox `expires_in_seconds` for a preview key, and the preview lease's own
 *  start window. One REST call, never a reconnect (spec §2A), so 30 s is
 *  generous: a preview-sized sentence synthesizes in about 760 ms. */
export const PREVIEW_KEY_TTL_S = 30;

/**
 * Is this role set a voice preview?
 *
 * Exactly one role, and it is `preview_tts`. Not "contains preview_tts": a set
 * that mixes it with session roles is unreachable through
 * `expandStreamRoles` and is a bug, so it must fall through to the ordinary
 * session paths and fail there rather than quietly buy a preview's price and a
 * preview's balance floor.
 */
export function isPreviewRoleSet(roles: readonly SonioxStreamRole[]): boolean {
    return roles.length === 1 && roles[0] === "preview_tts";
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/config/soniox.test.ts`
Expected: PASS.

- [ ] **Step 6: Follow the type gate**

Run: `npx tsc --noEmit`
Expected: errors in every exhaustive switch over `SonioxStreamRole` or
`SonioxAudioMode` that now lacks a `preview_tts` / `voice_preview` arm. Fix each
by adding the arm; do **not** add a `default` that swallows it. If a site has no
sensible preview answer, leave it throwing with a message naming the role —
`primaryRole` is the model to copy, and Task 5 is what stops it being reached.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm test
git add src/config/soniox.ts src/config/soniox.test.ts
git commit -m "feat(soniox): add the preview_tts role and the voice_preview mode"
```

---

### Task 2: The preview SKU, rate and balance floor

**Files:**
- Modify: `src/services/pricing.ts`
- Modify: `src/config/soniox.ts` (`skuForRoles` return type)
- Modify: `src/services/soniox-budget.ts` (`sonioxStartFloorMicroUsd`)
- Modify: `src/routes/soniox.ts` (`computeSessionBudget`)
- Test: `src/services/pricing.test.ts`, `src/services/soniox-budget.test.ts`,
  `src/routes/soniox.test.ts`

**Interfaces:**
- Consumes: `isPreviewRoleSet`, `PREVIEW_KEY_TTL_S` (Task 1).
- Produces:
  - `"soniox:voice_preview"` as a `BillingSku` with a registered rate
  - `skuForRoles(["preview_tts"])` → `"soniox:voice_preview"`
  - `PREVIEW_MIN_SESSION_S: number` (= 10) in `src/config/soniox.ts`
  - `computeSessionBudget(balance, ["preview_tts"])` →
    `{affordable, durationS: 30, rateUsdPerHour: 1.4, budgetMicroUsd, floorMicroUsd}`

- [ ] **Step 1: Write the failing tests**

In `src/services/pricing.test.ts`:

```ts
it("prices the voice-preview SKU rather than throwing on it", () => {
    // An unregistered SKU makes chargeMicroUsd throw, which fails the whole
    // charge in BillingService — so registration is not cosmetic even though
    // cost-based pricing never reads this rate for a preview.
    expect(() => chargeMicroUsd("soniox:voice_preview", 30)).not.toThrow();
    expect(chargeMicroUsd("soniox:voice_preview", 0)).toBe(0);
});
```

In `src/services/soniox-budget.ts`'s test file:

```ts
it("floors a preview at ten seconds of TTS, not a minimum session", () => {
    // MIN_SESSION_S (60 s) would demand ~23,334 microUSD to allow a preview
    // that charges ~1,356 (spec section 2C) — a 17x gate on a two-cent-per-
    // twenty feature.
    const floor = sonioxStartFloorMicroUsd(["preview_tts"]);
    expect(floor).toBe(microUsdForRate(1.4, PREVIEW_MIN_SESSION_S));
    expect(floor).toBeLessThan(sonioxStartFloorMicroUsd(["spk_stt"]));
});

it("still floors every session shape at a minimum session", () => {
    expect(sonioxStartFloorMicroUsd(["spk_stt"]))
        .toBe(microUsdForRate(1.1, MIN_SESSION_S));
});
```

In `src/routes/soniox.test.ts`:

```ts
describe("computeSessionBudget for a preview", () => {
    it("grants the key's TTL, not a metered session", () => {
        const b = computeSessionBudget(10_000_000, ["preview_tts"]);
        expect(b.affordable).toBe(true);
        expect(b.durationS).toBe(PREVIEW_KEY_TTL_S);
        // Honest small numbers, never null: changing these field types would
        // leak this change into every client that meters against them.
        expect(b.rateUsdPerHour).toBe(1.4);
        expect(b.budgetMicroUsd).toBe(microUsdForRate(1.4, PREVIEW_KEY_TTL_S));
    });

    it("refuses below the preview floor and reports it", () => {
        const floor = sonioxStartFloorMicroUsd(["preview_tts"]);
        const b = computeSessionBudget(floor - 1, ["preview_tts"]);
        expect(b.affordable).toBe(false);
        expect(b.floorMicroUsd).toBe(floor);
        expect(b.durationS).toBe(0);
    });

    it("leaves every session shape's budget untouched", () => {
        const b = computeSessionBudget(10_000_000, ["spk_stt", "spk_tts"]);
        expect(b.durationS).toBeGreaterThanOrEqual(MIN_SESSION_S);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/pricing.test.ts src/services/soniox-budget.test.ts src/routes/soniox.test.ts`
Expected: FAIL — `chargeMicroUsd` throws `No rate configured for SKU
"soniox:voice_preview"`, and the preview budget returns a 60-second duration.

- [ ] **Step 3: Register the SKU and widen `skuForRoles`**

In `src/services/pricing.ts`:

```ts
export const RATE_USD_PER_HOUR: Record<BillingSku, number> = {
    "soniox:text_only": 0.6,
    "soniox:speech_to_speech": 1.5,
    // Registered so `chargeMicroUsd` cannot throw, NOT because a preview is
    // ever time-priced. Cost-based pricing charges cost x K from the usage log;
    // this rate is reached only when the provider's cost figure is unusable,
    // and a TTS log's billableSeconds is 0, so the result is 0 either way.
    // Set to the synthesis rate so the number is not misleading if it is ever
    // read by something new.
    "soniox:voice_preview": 1.5,
    "openai:realtime_translate": 2.5,
    "volcengine:ast_v2": 5.0,
};
```

Add `"soniox:voice_preview"` to the `BillingSku` union wherever it is declared
(`npx tsc --noEmit` will point at the `Record` if you miss it).

In `src/config/soniox.ts`:

```ts
export function skuForRoles(
    roles: readonly SonioxStreamRole[]
): "soniox:text_only" | "soniox:speech_to_speech" | "soniox:voice_preview" {
    // Checked first: a preview also "uses TTS", so the synthesis test below
    // would claim it and bill it as a speech-to-speech session.
    if (isPreviewRoleSet(roles)) return "soniox:voice_preview";
    return usesTtsFor(roles) ? "soniox:speech_to_speech" : "soniox:text_only";
}
```

- [ ] **Step 4: Add the preview floor**

In `src/config/soniox.ts`, beside `MIN_SESSION_S`:

```ts
/** Balance floor basis for a preview, in seconds of its conservative rate.
 *  A preview charges about 1,356 microUSD (spec section 2C), so ten seconds of
 *  TTS — about three previews — is headroom without gating the feature behind
 *  a minimum session's worth of balance. */
export const PREVIEW_MIN_SESSION_S = 10;
```

In `src/services/soniox-budget.ts`:

```ts
export function sonioxStartFloorMicroUsd(roles: readonly SonioxStreamRole[]): number {
    // A preview is one REST call, so MIN_SESSION_S is the wrong basis: it would
    // demand 60 s of TTS money to allow a call that bills for about three.
    const seconds = isPreviewRoleSet(roles) ? PREVIEW_MIN_SESSION_S : MIN_SESSION_S;
    return microUsdForRate(conservativeRateUsdPerHour(roles), seconds);
}
```

- [ ] **Step 5: Add the budget branch**

In `src/routes/soniox.ts`, at the top of `computeSessionBudget`:

```ts
    // A preview is not a metered session. Its duration is the key's TTL, and
    // there is nothing for a client to meter against — but the fields are still
    // filled with honest small numbers rather than nulls, so no response field
    // changes type. Placed before the shared path because `maxSessionSecondsFor`
    // would hand a preview a full synthesis session cap and MIN_SESSION_S would
    // floor its duration at 60 s.
    if (isPreviewRoleSet(roles)) {
        const rate = conservativeRateUsdPerHour(roles);
        const floorMicroUsd = sonioxStartFloorMicroUsd(roles);
        if (!Number.isFinite(balanceMicroUsd) || balanceMicroUsd < floorMicroUsd) {
            return { affordable: false, durationS: 0, rateUsdPerHour: rate, budgetMicroUsd: 0, floorMicroUsd };
        }
        return {
            affordable: true,
            durationS: PREVIEW_KEY_TTL_S,
            rateUsdPerHour: rate,
            budgetMicroUsd: microUsdForRate(rate, PREVIEW_KEY_TTL_S),
            floorMicroUsd,
        };
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including every pre-existing budget and pricing test unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/services/pricing.ts src/config/soniox.ts src/services/soniox-budget.ts src/routes/soniox.ts src/services/pricing.test.ts src/services/soniox-budget.test.ts src/routes/soniox.test.ts
git commit -m "feat(soniox): price a voice preview at its own SKU and floor"
```

---

### Task 3: Widen the lease invariant

**Files:**
- Modify: `src/services/session-lease.ts`
- Modify: `src/db/session.schema.ts` (comments only)
- Modify: `src/config/soniox.ts` (`MAX_STT_CONCURRENT` comment only)
- Test: `src/services/session-lease.test.ts`, `src/services/session-lease.sqlite.test.ts`

**Interfaces:**
- Consumes: `preview_tts` (Task 1).
- Produces: `acquire` accepts `sttRoles: ["preview_tts"]` and writes
  `stt_stream_count = 0`, `uses_tts = 1`; `countActive()` reports that lease as
  0 STT and 1 TTS.

**This task touches the critical path for every paying session.** The tests come
first and the behaviour-preserving claims are what they exist to prove.

- [ ] **Step 1: Write the failing tests**

In `src/services/session-lease.sqlite.test.ts` (it has a real D1/SQLite fixture,
which is what makes the `countActive` assertions meaningful):

```ts
it("accepts a TTS-only lease and counts it against TTS alone", async () => {
    const svc = createSessionLeaseService(env);
    const now = Date.now();
    const res = await svc.acquire({
        accountId: "acct-preview", leaseId: "lease-preview", provider: "soniox",
        sku: "soniox:voice_preview", region: "us", usesTts: true,
        sttRoles: ["preview_tts"], sttStreamCount: 0,
        maxDurationS: PREVIEW_KEY_TTL_S, budgetMicroUsd: 4000,
        startWindowS: PREVIEW_KEY_TTL_S, now,
    });
    expect(res.ok).toBe(true);

    const counts = await svc.countActive(now);
    // The whole point: a preview opens no transcription stream, so it must not
    // consume one of the 100 STT slots. Before the clamp was dropped, the
    // stored 0 read back as 1.
    expect(counts.stt).toBe(0);
    expect(counts.tts).toBe(1);
});

it("admits a TTS-only lease while the STT ceiling is full", async () => {
    const svc = createSessionLeaseService(env);
    const now = Date.now();
    await seedActiveLeases(env, { count: MAX_STT_CONCURRENT, now });
    const res = await svc.acquire({
        accountId: "acct-preview", leaseId: "lease-preview", provider: "soniox",
        sku: "soniox:voice_preview", region: "us", usesTts: true,
        sttRoles: ["preview_tts"], sttStreamCount: 0,
        maxDurationS: PREVIEW_KEY_TTL_S, budgetMicroUsd: 4000,
        startWindowS: PREVIEW_KEY_TTL_S, now,
    });
    expect(res.ok).toBe(true);
});

it("refuses a TTS-only lease only when the TTS ceiling is full", async () => {
    const svc = createSessionLeaseService(env);
    const now = Date.now();
    await seedTtsLeases(env, { count: MAX_TTS_CONCURRENT, now });
    const res = await svc.acquire({
        accountId: "acct-preview", leaseId: "lease-preview", provider: "soniox",
        sku: "soniox:voice_preview", region: "us", usesTts: true,
        sttRoles: ["preview_tts"], sttStreamCount: 0,
        maxDurationS: PREVIEW_KEY_TTL_S, budgetMicroUsd: 4000,
        startWindowS: PREVIEW_KEY_TTL_S, now,
    });
    expect(res).toEqual({ ok: false, reason: "tts_full" });
});

it("still counts every session lease as at least one transcription stream", async () => {
    const svc = createSessionLeaseService(env);
    const now = Date.now();
    await svc.acquire({
        accountId: "acct-session", leaseId: "lease-session", provider: "soniox",
        sku: "soniox:speech_to_speech", region: "us", usesTts: true,
        sttRoles: ["spk_stt", "spk_tts"], sttStreamCount: 1,
        maxDurationS: 600, budgetMicroUsd: 100_000, now,
    });
    const counts = await svc.countActive(now);
    expect(counts.stt).toBe(1);
    expect(counts.tts).toBe(1);
});
```

`seedActiveLeases` is a local helper for this test only — write it in the same
file:

```ts
async function seedActiveLeases(
    env: CloudflareBindings, opts: { count: number; now: number }
): Promise<void> {
    const svc = createSessionLeaseService(env);
    for (let i = 0; i < opts.count; i++) {
        await svc.acquire({
            accountId: `filler-${i}`, leaseId: `filler-lease-${i}`, provider: "soniox",
            sku: "soniox:text_only", region: "us", usesTts: false,
            sttRoles: ["spk_stt"], sttStreamCount: 1,
            maxDurationS: 600, budgetMicroUsd: 100_000, now: opts.now,
        });
    }
}

/** The same, for the TTS ceiling: speech-to-speech leases, one TTS slot each. */
async function seedTtsLeases(
    env: CloudflareBindings, opts: { count: number; now: number }
): Promise<void> {
    const svc = createSessionLeaseService(env);
    for (let i = 0; i < opts.count; i++) {
        await svc.acquire({
            accountId: `tts-filler-${i}`, leaseId: `tts-filler-lease-${i}`,
            provider: "soniox", sku: "soniox:speech_to_speech", region: "us",
            usesTts: true, sttRoles: ["spk_stt", "spk_tts"], sttStreamCount: 1,
            maxDurationS: 600, budgetMicroUsd: 100_000, now: opts.now,
        });
    }
}
```

In `src/services/session-lease.test.ts` (the plain-node file, for the guards):

```ts
it("refuses an empty role set", async () => {
    await expect(acquireWith({ sttRoles: [] })).rejects.toThrow(
        /at least one stream/
    );
});

it("refuses a negative stream count", async () => {
    await expect(acquireWith({ sttStreamCount: -1 })).rejects.toThrow(
        /must be >= 0/
    );
});

it("refuses a lease that would own no stream at all", async () => {
    await expect(acquireWith({ sttStreamCount: 0, usesTts: false, sttRoles: undefined }))
        .rejects.toThrow(/at least one stream/);
});
```

Shape `acquireWith` on whatever fixture that file already uses to call
`acquire`; if it has none, build the params inline in each test the way the
sqlite tests above do.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/session-lease.test.ts src/services/session-lease.sqlite.test.ts`
Expected: FAIL. `acquire` throws `sttRoles must contain at least one
transcription role`, and `countActive` reports `stt: 1` for the preview lease.

- [ ] **Step 3: Relax the guards**

In `src/services/session-lease.ts`'s `acquire`, replace the two existing guards.
Remove:

```ts
        if (p.sttStreamCount !== undefined && p.sttStreamCount < 1) { … }
```

and, inside the `p.sttRoles !== undefined` block, remove the
`rolesSttCount === 0` throw. Then add, after `sttStreamCount` is resolved:

```ts
        // THE INVARIANT, in one place. It used to be "a live lease always owns
        // at least one TRANSCRIPTION stream", enforced as sttStreamCount >= 1
        // plus a required transcription role. That was narrower than what it
        // protected: what must not happen is a lease that owns NOTHING, because
        // it would hold the account's lock while consuming no ceiling and
        // proving nothing. A voice preview owns one TTS stream and no STT, and
        // is legitimate. STT and TTS are peers here, each bounded by its own
        // ceiling below.
        if (p.sttStreamCount !== undefined && p.sttStreamCount < 0) {
            throw new Error(
                `acquire: sttStreamCount must be >= 0 (got ${p.sttStreamCount})`
            );
        }
        if (p.sttRoles !== undefined && p.sttRoles.length === 0) {
            throw new Error("acquire: sttRoles must name at least one stream (got [])");
        }
        if (sttStreamCount + (p.usesTts ? 1 : 0) < 1) {
            throw new Error(
                "acquire: a lease must own at least one stream, STT or TTS " +
                `(got ${sttStreamCount} STT and usesTts=${p.usesTts})`
            );
        }
```

- [ ] **Step 4: Make the two ceiling checks the same shape**

Replace:

```ts
        if (counts.stt + sttStreamCount > MAX_STT_CONCURRENT) return { ok: false, reason: "stt_full" };
        if (p.usesTts && counts.tts >= MAX_TTS_CONCURRENT) return { ok: false, reason: "tts_full" };
```

with:

```ts
        // Both written as "would this request push us OVER the ceiling", because
        // a split session needs two slots and must be refused at 99 of 100, not
        // admitted. The forms used to differ — one additive, one a threshold —
        // which was a leftover from TTS being capped at one stream per lease.
        // The `> 0` guard is what makes the STT check a true no-op for a
        // TTS-only lease: without it, a lease adding no transcription stream
        // would still be refused whenever the org already sat at its STT
        // ceiling.
        if (sttStreamCount > 0 && counts.stt + sttStreamCount > MAX_STT_CONCURRENT) {
            return { ok: false, reason: "stt_full" };
        }
        if (p.usesTts && counts.tts + 1 > MAX_TTS_CONCURRENT) {
            return { ok: false, reason: "tts_full" };
        }
```

- [ ] **Step 5: Drop the read-side clamp**

In `countActive`, replace the SQL with:

```ts
        const row = await this.env.DATABASE.prepare(`
            SELECT COALESCE(SUM(stt_stream_count), 0) AS stt_active,
                   COALESCE(SUM(uses_tts), 0) AS tts_active
            FROM session_leases
            WHERE expires_at > ? AND reconciled_at IS NULL
        `).bind(now).first();
```

Replace the clamp's long paragraph with:

```ts
        // `stt` sums the ISSUED transcription-stream counts rather than counting
        // rows: one lease row can own two Soniox transcription streams (split
        // Both), and the org ceiling is on STREAMS, not on sessions. `tts` is a
        // plain sum of a 0/1 flag because at most one TTS role exists in any row
        // of the matrix (pinned by config/soniox.test.ts).
        //
        // A zero is now a truthful zero. It used to be clamped to 1 by
        // COALESCE(NULLIF(stt_stream_count, 0), 1), which defended rows written
        // by a Worker predating the column: deploy.yml applies migrations before
        // deploying, so during that one window an old INSERT left the row at the
        // column's DEFAULT 0. That defence is spent — migration 0010 ends with
        // `UPDATE session_leases SET stt_stream_count = 1 WHERE stt_stream_count
        // = 0`, a lease lives at most about an hour so no such row can still be
        // live, and `acquire` is the only writer and always names the column. The
        // clamp is now the thing that would be wrong: it cannot tell "the writer
        // did not say" from "this lease owns no transcription stream", and a
        // preview lease would silently consume one of the 100 STT slots it never
        // opened.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, with every pre-existing lease test unchanged — that is the
behaviour-preserving claim, and a failure here means it is false.

- [ ] **Step 7: Rewrite the comments that state the old invariant**

Four remaining sites. Each currently tells the reader that a zero is illegal,
and each is now the only thing that would mislead them:

1. `src/db/session.schema.ts`, `sttStreamCount`: replace "0 is never a
   legitimate live value" with a note that 0 is legitimate for a lease that owns
   only a TTS stream (a voice preview), and that the migration's backfill is
   what makes every pre-existing row 1.
2. `src/db/session.schema.ts`, the `issued_stt_mask` docstring's aside about
   `sttStreamCount`'s 0 "loosening" the ceiling — the loosening is now explicit
   and intended for a preview.
3. `src/services/session-lease.ts`, `AcquireParams.sttStreamCount`: replace
   "Must be `>= 1` when provided — `acquire` throws otherwise. A live lease
   always owns at least one transcription stream." with the widened invariant
   and a pointer to the combined check in `acquire`.
4. `src/config/soniox.ts`, `MAX_STT_CONCURRENT`: it enumerates which shapes own
   one stream; add that a voice-preview lease owns none, and that Soniox's real
   ceiling is 100 (spec §2D confirms our mirror).

- [ ] **Step 8: Commit**

```bash
npm test && npx tsc --noEmit
git add src/services/session-lease.ts src/db/session.schema.ts src/config/soniox.ts src/services/session-lease.test.ts src/services/session-lease.sqlite.test.ts
git commit -m "refactor(lease): a live lease owns at least one stream, STT or TTS"
```

---

### Task 4: Show a preview as a preview in the ledger

**Files:**
- Modify: `src/routes/wallet-ledger.ts`
- Modify: `src/services/wallet-service.ts` (`LEDGER_USE_KIND_EXPR`)
- Test: `src/routes/wallet-ledger.test.ts`

**Interfaces:**
- Consumes: `"soniox:voice_preview"` (Task 2), `preview_tts` (Task 1).
- Produces: `EntryKind` gains `"tts_preview"`; `GroupKind` gains
  `"voice_preview"`; `LEDGER_USE_KIND_EXPR` maps the `preview_tts` role to
  `'tts_preview'`.

- [ ] **Step 1: Write the failing tests**

In `src/routes/wallet-ledger.test.ts`:

```ts
it("derives tts_preview from the preview role", () => {
    expect(deriveEntryKind(rowWith({ role: "preview_tts", model: "tts-rt-v2" })))
        .toBe("tts_preview");
});

it("calls a preview-only group a voice preview, not a session", () => {
    // Grouping is by reference_id, which is the lease's sessionRef, so every
    // preview forms its own group. Without this the billing history shows a
    // session that never happened — once per preview.
    const g = deriveGroupKind([entryWith({ kind: "tts_preview" })]);
    expect(g).toBe("voice_preview");
});

it("still calls a group with any session usage a session", () => {
    expect(deriveGroupKind([
        entryWith({ kind: "tts_preview" }),
        entryWith({ kind: "stt_speaker" }),
    ])).toBe("session");
});

it("keeps a preview out of the text-only label", () => {
    const g = buildGroup([rowWith({ role: "preview_tts", sku: "soniox:voice_preview" })]);
    expect(g.kind).toBe("voice_preview");
    expect(g.textOnly).toBeUndefined();
});

it("agrees with the SQL kind expression on every role", () => {
    // The TypeScript map and LEDGER_USE_KIND_EXPR are two implementations of
    // one rule and nothing enforced their agreement before this test. This
    // change is the first to add a member since the map was written.
    for (const role of SONIOX_STREAM_ROLES) {
        expect(sqlKindFor(role)).toBe(ROLE_KINDS[role] ?? "usage");
    }
});
```

`sqlKindFor` evaluates `LEDGER_USE_KIND_EXPR` against a one-row fixture in the
sqlite harness this file already uses for its other SQL assertions; if it has
none, put this one test in `src/services/wallet-service.getUsageSummary.sqlite.test.ts`
instead, which does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/routes/wallet-ledger.test.ts`
Expected: FAIL — `deriveEntryKind` returns `"tts"` (the `tts-*` model-prefix
fallback) and `deriveGroupKind` returns `"session"`.

- [ ] **Step 3: Add the entry kind**

In `src/routes/wallet-ledger.ts`, add `"tts_preview"` to the `EntryKind` union
and to `ROLE_KINDS`:

```ts
    preview_tts: "tts_preview",
```

Keep `"tts_preview"` **inside** `USAGE_KINDS`: a preview is consumption, and the
dashboard's Billing/Usage split is on `event_type = 'use'` regardless. Removing
it instead would fall through to `entries[0].kind` in `deriveGroupKind` and
label the group `adjustment` — a different wrong answer.

- [ ] **Step 4: Add the group kind**

Add `"voice_preview"` to `GroupKind`, and in `deriveGroupKind`, before the
generic session branch:

```ts
    // Checked BEFORE the session branch: a preview entry is consumption, so the
    // generic test below would claim it and call the group a session.
    const usage = entries.filter((e) => USAGE_KINDS.has(e.kind));
    if (usage.length > 0 && usage.every((e) => e.kind === "tts_preview")) {
        return "voice_preview";
    }
```

Leave the `textOnly` line as it is — it is already guarded by
`group.kind === "session"`, so a `voice_preview` group can never reach it.

- [ ] **Step 5: Add the SQL arm**

In `src/services/wallet-service.ts`, inside `LEDGER_USE_KIND_EXPR`'s first
`CASE`, beside the other role arms:

```sql
        WHEN 'preview_tts' THEN 'tts_preview'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/wallet-ledger.ts src/services/wallet-service.ts src/routes/wallet-ledger.test.ts
git commit -m "feat(wallet): show a voice preview as a preview, not a phantom session"
```

---

### Task 5: Issue a preview key from `session-key`

**Files:**
- Modify: `src/routes/soniox.ts`
- Modify: `src/config/soniox.ts` (add `keyParamsForRole`)
- Test: `src/routes/soniox.test.ts`, `src/config/soniox.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `keyParamsForRole(role, budget): { expiresInSeconds: number; singleUse: boolean }`
  - `POST /api/soniox/session-key` with `{mode: "voice_preview"}` →
    `{ttsApiKey, expiresAt, leaseId, region, streams, …}` and **no** `sttApiKey`

- [ ] **Step 1: Write the failing tests**

In `src/config/soniox.test.ts`:

```ts
describe("keyParamsForRole", () => {
    const budget = { durationS: 600 } as SessionBudget;
    it("gives an STT key its start window and burns it on first use", () => {
        expect(keyParamsForRole("spk_stt", budget))
            .toEqual({ expiresInSeconds: KEY_START_WINDOW_S, singleUse: true });
        expect(keyParamsForRole("par_stt", budget).expiresInSeconds)
            .toBe(PARTICIPANT_KEY_START_WINDOW_S);
    });
    it("keeps a session TTS key reusable for the granted duration", () => {
        // A single_use TTS key 401s on the reconnect the client makes after
        // every idle-timeout drop (~5.3 s), which silently kills spoken output
        // for the rest of the session.
        expect(keyParamsForRole("spk_tts", budget))
            .toEqual({ expiresInSeconds: ttsKeyExpiresInSeconds(600), singleUse: false });
    });
    it("burns a preview key after its one call", () => {
        // A preview makes exactly one REST call and never reconnects, so the
        // reason session TTS keys must be reusable does not apply (spec 2A).
        expect(keyParamsForRole("preview_tts", budget))
            .toEqual({ expiresInSeconds: PREVIEW_KEY_TTL_S, singleUse: true });
    });
});
```

In `src/routes/soniox.test.ts`. This file calls handlers **directly** with a
hand-built context — there is no HTTP layer in these tests — so copy the shape
of the existing `sessionKeyHandler — mode validation` block: build the handler
set with `createSonioxHandlers({...})`, build a context with `makeCtx({session:
USER, body})`, call the handler, and read `calls.json`. `USER`, `makeCtx`,
`fakeWallet`, `fakeLeaseService`, `fakeSonioxApi`, `capturingSonioxApi`,
`fakeReconciler` and `fakeVoiceSlotService` are all already defined in the file.

```ts
describe("sessionKeyHandler — voice preview", () => {
    /** The handler set every case below uses, with the balance and the Soniox
     *  API stub as the only knobs. */
    function handlers(opts: { balanceMicroUsd?: number; api?: any; lease?: any } = {}) {
        return createSonioxHandlers({
            makeWalletService: () => fakeWallet(opts.balanceMicroUsd ?? 10_000_000) as any,
            makeSessionLeaseService: () => (opts.lease ?? fakeLeaseService().svc) as any,
            makeSonioxApi: () => (opts.api ?? fakeSonioxApi()) as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
    }

    it("issues a TTS key and no STT key", async () => {
        const { sessionKeyHandler } = handlers();
        const { c, calls } = makeCtx({ session: USER, body: { mode: "voice_preview" } });
        await sessionKeyHandler(c);
        expect(calls.json?.status).toBe(200);
        const body = calls.json?.body;
        expect(body.ttsApiKey).toBeTruthy();
        expect(body.sttApiKey).toBeUndefined();
        expect(body.sku).toBe("soniox:voice_preview");
        expect(body.maxSessionDurationSeconds).toBe(PREVIEW_KEY_TTL_S);
        expect(body.streams).toHaveLength(1);
        expect(body.streams[0].role).toBe("preview_tts");
        expect(body.streams[0].clientReferenceId)
            .toBe(`sokuji1:${USER.user.id}:${body.leaseId}:preview_tts`);
    });

    it("mints that key single-use with the preview TTL", async () => {
        const api = capturingSonioxApi();
        const { sessionKeyHandler } = handlers({ api });
        const { c } = makeCtx({ session: USER, body: { mode: "voice_preview" } });
        await sessionKeyHandler(c);
        expect(api.calls).toHaveLength(1);
        expect(api.calls[0]).toMatchObject({
            usageType: "tts_rt",
            singleUse: true,
            expiresInSeconds: PREVIEW_KEY_TTL_S,
        });
    });

    it("passes the region through", async () => {
        const api = capturingSonioxApi();
        const { sessionKeyHandler } = handlers({ api });
        const { c, calls } = makeCtx({
            session: USER, body: { mode: "voice_preview", region: "jp" },
        });
        await sessionKeyHandler(c);
        expect(calls.json?.body.region).toBe("jp");
    });

    it("refuses below the preview floor and names it", async () => {
        const floor = sonioxStartFloorMicroUsd(["preview_tts"]);
        const { sessionKeyHandler } = handlers({ balanceMicroUsd: floor - 1 });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "voice_preview" } });
        await sessionKeyHandler(c);
        expect(calls.json?.status).toBe(402);
        expect(calls.json?.body.requiredMicroUsd).toBe(floor);
    });

    it("409s when the account already holds a lease", async () => {
        const { sessionKeyHandler } = handlers({
            lease: { ...fakeLeaseService().svc, acquire: async () => ({ ok: false, reason: "active_lease" }) },
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "voice_preview" } });
        await sessionKeyHandler(c);
        expect(calls.json?.status).toBe(409);
    });

    it("503s when the org's TTS ceiling is full", async () => {
        const { sessionKeyHandler } = handlers({
            lease: { ...fakeLeaseService().svc, acquire: async () => ({ ok: false, reason: "tts_full" }) },
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "voice_preview" } });
        await sessionKeyHandler(c);
        expect(calls.json?.status).toBe(503);
    });
});

describe("sessionKeyHandler — sttApiKey stays mandatory for every session mode", () => {
    // The optionality must not become general: this is the only thing standing
    // between a typo and a shipped client reading its response as "no key".
    const sessionBodies = [
        { mode: "text_only" },
        { mode: "speech_to_speech" },
        { mode: "speaker", textOnly: true },
        { mode: "speaker", textOnly: false },
        { mode: "participant" },
        { mode: "both", textOnly: true, bothSplit: true },
        { mode: "both", textOnly: false, bothSplit: true },
        { mode: "both", textOnly: true, bothSplit: false },
        { mode: "both", textOnly: false, bothSplit: false },
    ];
    it.each(sessionBodies)("%o still returns an sttApiKey", async (body) => {
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body });
        await sessionKeyHandler(c);
        expect(calls.json?.status).toBe(200);
        expect(calls.json?.body.sttApiKey).toBeTruthy();
    });
});
```

If `capturingSonioxApi` does not already expose the recorded arguments as
`.calls`, read its definition and use whatever field it does expose — do not add
a second capturing stub beside it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/config/soniox.test.ts src/routes/soniox.test.ts`
Expected: FAIL — `keyParamsForRole` is not exported, and the preview request
throws out of `primaryRole` (`role set has no STT stream`) as a 500.

- [ ] **Step 3: Add `keyParamsForRole`**

In `src/config/soniox.ts`:

```ts
/**
 * A temporary key's lifetime and reuse policy, for one role.
 *
 * One table rather than two inverted booleans at the mint site. The loop used
 * to compute `expiresInSeconds: isTts ? … : …` and `singleUse: !isTts`, which
 * reads fine for two cases and silently gets a third wrong: a preview is a TTS
 * role that wants the STT answer for `singleUse`.
 */
export function keyParamsForRole(
    role: SonioxStreamRole,
    budget: Pick<SessionBudget, "durationS">
): { expiresInSeconds: number; singleUse: boolean } {
    if (role === "preview_tts") {
        // One REST call, never a reconnect (spec 2A), so the stricter value is
        // available here even though session TTS keys must be reusable.
        return { expiresInSeconds: PREVIEW_KEY_TTL_S, singleUse: true };
    }
    if (roleKind(role) === "tts") {
        return { expiresInSeconds: ttsKeyExpiresInSeconds(budget.durationS), singleUse: false };
    }
    return { expiresInSeconds: keyStartWindowForRole(role), singleUse: true };
}
```

If `SessionBudget` lives in `src/routes/soniox.ts`, move its declaration to
`src/config/soniox.ts` and re-export it from the route, so the config module
does not import from a route.

- [ ] **Step 4: Use it in the mint loop, and guard `primaryRole`**

In `sessionKeyHandler`, replace the two computed fields in the
`createTemporaryKey` call with:

```ts
                const keyParams = keyParamsForRole(role, budget);
```

and pass `expiresInSeconds: keyParams.expiresInSeconds`,
`singleUse: keyParams.singleUse`.

Pass an explicit start window to `acquire` for a preview, so the lease's backstop
matches the key rather than `maxKeyStartWindowS`'s 60-second floor:

```ts
            startWindowS: isPreviewRoleSet(roles)
                // The lease must outlast the key it issues and no longer: 30 s
                // + LEASE_MARGIN_MS puts the backstop at 45 s, and the lease's
                // exclusivity window is the same window as its billing trigger
                // (spec 5.3), so a wider one costs the user a longer lock.
                ? PREVIEW_KEY_TTL_S
                : maxKeyStartWindowS(roles),
```

Then the response:

```ts
        // `primaryRole` throws on a role set with no STT leg, by design — such a
        // set would also be a lease that can never release through the mask
        // predicate. A preview is exactly that set, so ask only when there is a
        // transcription leg to ask about. The loud guard below is unchanged for
        // every session: it is what stops a response with a missing sttApiKey,
        // which a client reads as "no key".
        const primary = sttCount > 0 ? primaryRole(roles) : null;
        const primaryStream = primary ? streams.find((s) => s.role === primary) : null;
        if (primary && !primaryStream) {
            throw new Error(`sessionKeyHandler: no key minted for primary role ${primary}`);
        }
```

and in the returned object, `sttApiKey: primaryStream?.apiKey` and
`clientReferenceId: primaryStream?.clientReferenceId ?? streams[0].clientReferenceId`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. The "still returns an sttApiKey for every other mode" case is
the one to read carefully.

- [ ] **Step 6: Commit**

```bash
git add src/routes/soniox.ts src/config/soniox.ts src/routes/soniox.test.ts src/config/soniox.test.ts
git commit -m "feat(soniox): issue a single-use preview key from session-key"
```

---

### Task 6: `POST /api/soniox/preview-done`

**Files:**
- Modify: `src/routes/soniox.ts`
- Modify: `src/services/session-lease.ts` (add `markPreviewDone`)
- Test: `src/routes/soniox.test.ts`, `src/services/session-lease.sqlite.test.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces:
  - `SessionLeaseService.markPreviewDone(accountId: string, now: number): Promise<number>`
  - `POST /api/soniox/preview-done` → `204`, or `404` when the account holds no
    unreconciled preview lease

- [ ] **Step 1: Write the failing tests**

In `src/services/session-lease.sqlite.test.ts`:

```ts
it("marks a preview started and ended in one write, without extending the TTL", async () => {
    const svc = createSessionLeaseService(env);
    const now = Date.now();
    const res = await svc.acquire({
        accountId: "acct-preview", leaseId: "lease-preview", provider: "soniox",
        sku: "soniox:voice_preview", region: "us", usesTts: true,
        sttRoles: ["preview_tts"], sttStreamCount: 0,
        maxDurationS: PREVIEW_KEY_TTL_S, budgetMicroUsd: 4000,
        startWindowS: PREVIEW_KEY_TTL_S, now,
    });
    const before = (res as { lease: { expiresAt: number } }).lease.expiresAt;

    expect(await svc.markPreviewDone("acct-preview", now + 1000)).toBe(1);

    const row = await readLease(env, "acct-preview");
    expect(row.started_at).toBe(now + 1000);
    expect(row.end_signalled_at).toBe(now + 1000);
    // Both timestamps, no TTL move. session-started extends the lease to the
    // full granted duration, which for a 45 s preview lease is exactly wrong.
    expect(row.expires_at).toBe(before);
});

it("does not touch a session lease", async () => {
    const svc = createSessionLeaseService(env);
    const now = Date.now();
    await svc.acquire({
        accountId: "acct-session", leaseId: "lease-session", provider: "soniox",
        sku: "soniox:speech_to_speech", region: "us", usesTts: true,
        sttRoles: ["spk_stt", "spk_tts"], sttStreamCount: 1,
        maxDurationS: 600, budgetMicroUsd: 100_000, now,
    });
    expect(await svc.markPreviewDone("acct-session", now + 1000)).toBe(0);
    const row = await readLease(env, "acct-session");
    expect(row.started_at).toBeNull();
});
```

`readLease` is a local helper: `SELECT * FROM session_leases WHERE account_id = ?`.

In `src/routes/soniox.test.ts`, same direct-handler shape as Task 5:

```ts
describe("previewDoneHandler", () => {
    function handlers(markPreviewDone: () => Promise<number>) {
        const reconciler = fakeReconciler();
        const set = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => ({ ...fakeLeaseService().svc, markPreviewDone }) as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => reconciler.svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        return { ...set, reconciler };
    }

    it("204s on an empty body and pokes the reconciler with no delay", async () => {
        // No delay: the whole point of this endpoint is that the charge lands in
        // seconds rather than waiting for the cron heartbeat.
        const { previewDoneHandler, reconciler } = handlers(async () => 1);
        const { c, calls } = makeCtx({ session: USER, body: {} });
        const res: any = await previewDoneHandler(c);
        expect(res.status ?? calls.json?.status).toBe(204);
        expect(reconciler.pokeCalls).toEqual([{}]);
    });

    it("404s when the account holds no preview lease", async () => {
        const { previewDoneHandler } = handlers(async () => 0);
        const { c, calls } = makeCtx({ session: USER, body: {} });
        await previewDoneHandler(c);
        expect(calls.json?.status).toBe(404);
    });

    it("401s when unauthenticated, before touching the lease", async () => {
        let called = false;
        const { previewDoneHandler } = handlers(async () => { called = true; return 1; });
        const { c, calls } = makeCtx({ session: null, body: {} });
        await previewDoneHandler(c);
        expect(calls.json?.status).toBe(401);
        expect(called).toBe(false);
    });
});
```

`fakeReconciler()` already records its calls; use whatever field it exposes
(`pokeCalls` in its current definition) rather than adding another stub. `makeCtx`
has no `body(null, 204)` recorder, so either read the handler's return value as
above or give `makeCtx` a `body` method in the same change — whichever the file's
maintainer would find less surprising; if you add one, mirror `json`'s shape.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/session-lease.sqlite.test.ts src/routes/soniox.test.ts`
Expected: FAIL — `markPreviewDone` is not a function, and `/preview-done` 404s
as an unregistered route.

- [ ] **Step 3: Add `markPreviewDone`**

In `src/services/session-lease.ts`:

```ts
    /**
     * A preview is over: record both timestamps in one write.
     *
     * `started_at` is what makes `unreconciledLeaseQuery` report this region as
     * having work — without it no sweep is triggered by this lease and the
     * charge waits for unrelated traffic. `end_signalled_at` is what lets the
     * sweep run now rather than after the lease's 45 s backstop expiry. Neither
     * `session-started` nor `session-end` sets both, and `session-started` also
     * extends the TTL to the full granted duration, which a preview must not do.
     *
     * Scoped by SKU as well as account: a preview lease is the only kind this
     * may touch, so a client calling it during a session cannot forge a
     * session's start.
     */
    async markPreviewDone(accountId: string, now: number): Promise<number> {
        const res = await this.env.DATABASE.prepare(`
            UPDATE session_leases
            SET started_at = ?, end_signalled_at = ?
            WHERE account_id = ? AND sku = 'soniox:voice_preview'
              AND reconciled_at IS NULL
        `).bind(now, now, accountId).run();
        return res.meta?.changes ?? 0;
    }
```

- [ ] **Step 4: Add the handler and route**

In `src/routes/soniox.ts`, beside `sessionEndHandler`:

```ts
    /** A preview's synthesis is over. Empty body: the server reads the
     *  account's own lease rather than trusting the client to name one, the
     *  same rule `session-end` follows. */
    async function previewDoneHandler(c: Context<SonioxEnv>) {
        const auth = c.get("auth");
        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        if (!session?.user) {
            return c.json({ error: "Authentication required" }, 401);
        }
        const changed = await deps
            .makeSessionLeaseService(c.env)
            .markPreviewDone(session.user.id, Date.now());
        if (changed === 0) {
            // Nothing to mark: the lease expired, was already reconciled, or the
            // client never held one. Not an error the client can act on, but not
            // a success either — saying so keeps a silent client bug findable.
            return c.json({ error: "No preview lease to complete" }, 404);
        }
        // Nudge the reconciler now rather than waiting for the cron: the whole
        // point of this endpoint is that the charge lands in seconds.
        c.executionCtx.waitUntil(deps.makeSonioxReconciler(c.env).poke({}));
        return c.body(null, 204);
    }
```

Return it from `createSonioxHandlers`, add it to the module-level destructure,
and register it beside its siblings:

```ts
soniox.post("/preview-done", previewDoneHandler);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/soniox.ts src/services/session-lease.ts src/routes/soniox.test.ts src/services/session-lease.sqlite.test.ts
git commit -m "feat(soniox): add preview-done to trigger a preview's reconciliation"
```

---

### Task 7: Reconcile and release a preview

**Files:**
- Modify: `src/services/soniox-reconcile.ts`
- Modify: `src/services/soniox-api.ts` (`UsageLog`)
- Modify: `src/durable-objects/SonioxReconcilerDO.ts` (bind the new port)
- Test: `src/services/soniox-reconcile.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: after charging a `preview_tts` log the sweep releases that lease;
  the zero-cost alarm reads `output_audio_duration_ms`.

- [ ] **Step 1: Write the failing tests**

In `src/services/soniox-reconcile.test.ts`:

```ts
it("charges a preview at its lease's SKU with no special case", () => {
    const charge = buildCharge(
        usageLogWith({
            client_reference_id: "sokuji1:acct-1:lease-1:preview_tts",
            model: "tts-rt-v2", cost_usd: "0.000678",
        }),
        "soniox:voice_preview"
    );
    expect(charge).toMatchObject({
        subjectId: "acct-1",
        sku: "soniox:voice_preview",
        pricing: "cost_times_k",
        billableSeconds: 0,
        providerCostMicroUsd: 678,
        metadata: { role: "preview_tts" },
    });
});

it("releases a preview lease after charging its log", async () => {
    const ports = fakePorts({
        logs: [usageLogWith({
            client_reference_id: "sokuji1:acct-1:lease-1:preview_tts",
            model: "tts-rt-v2", cost_usd: "0.000678",
        })],
        leaseSku: "soniox:voice_preview",
    });
    await runSweep(() => ports, { region: "us" });
    // The mask predicate `(ended & started) = started AND started != 0` can
    // never hold for a lease with no STT bit, so without this the lease would
    // sit until its expiry backstop.
    expect(ports.releaseLease).toHaveBeenCalledWith("sokuji1:acct-1:lease-1", expect.any(Number));
    // And it must not go through noteStreamEnded, whose `matched === 0` alarm
    // is what would fire on a lease the sweep cannot find a transcription leg
    // for. That alarm is gated on `kind === "stt"`, so this asserts the gate
    // rather than the alarm text.
    expect(ports.noteStreamEnded).not.toHaveBeenCalled();
});

it("does not release a session's lease on its TTS log", async () => {
    const ports = fakePorts({
        logs: [usageLogWith({
            client_reference_id: "sokuji1:acct-1:lease-1:spk_tts",
            model: "tts-rt-v2", cost_usd: "0.001",
        })],
        leaseSku: "soniox:speech_to_speech",
    });
    await runSweep(() => ports, { region: "us" });
    // A session releases on its STT log's arrival, via the mask. Releasing on a
    // TTS log would free the lease while the transcription stream is still up.
    expect(ports.releaseLease).not.toHaveBeenCalled();
});

it("alarms on a zero-cost TTS log using the field a TTS log actually fills", async () => {
    const ports = fakePorts({
        logs: [usageLogWith({
            client_reference_id: "sokuji1:acct-1:lease-1:preview_tts",
            model: "tts-rt-v2", cost_usd: "0",
            input_audio_duration_ms: 0, output_audio_duration_ms: 3328,
        })],
        leaseSku: "soniox:voice_preview",
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await runSweep(() => ports, { region: "us" });
    expect(summary.zeroCostLogs).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("REVENUE LOSS"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/soniox-reconcile.test.ts`
Expected: FAIL — nothing releases the preview lease, and the zero-cost alarm
does not fire because it is gated on `input_audio_duration_ms > 0`, which a TTS
log reports as 0.

- [ ] **Step 3: Declare the field a TTS log fills**

In `src/services/soniox-api.ts`:

```ts
export interface UsageLog {
    uuid: string;
    client_reference_id: string | null;
    model: string;
    start_time: string;
    end_time: string;
    input_audio_duration_ms: number;
    /** Generated speech, in ms. A TTS log reports `input_audio_duration_ms: 0`
     *  and puts its duration here — measured 2026-09-09 (spec section 2C), which
     *  the reconciler's zero-cost alarm previously had no way to know. */
    output_audio_duration_ms: number;
    cost_usd: string;
}
```

- [ ] **Step 4: Fix the alarm gate**

In `src/services/soniox-reconcile.ts`, replace the alarm's duration test with a
kind-aware one:

```ts
                // Which field carries "there was real work here" depends on the
                // kind: an STT log measures the audio it consumed, a TTS log
                // measures the speech it produced and reports
                // input_audio_duration_ms as 0. Gating both on the input field —
                // as this did — made BOTH branches of this alarm unreachable for
                // every tts- log, so a Soniox cost_usd of 0 on synthesis would
                // have been given away in silence.
                const workMs = kind === "tts"
                    ? log.output_audio_duration_ms
                    : log.input_audio_duration_ms;
                if (charge && charge.pricing === "cost_times_k"
                    && (charge.providerCostMicroUsd ?? 0) <= 0
                    && workMs > 0) {
```

Leave the two message strings as they are.

- [ ] **Step 5: Add the release port**

`SweepPorts` has no way to release a lease outright. Its existing release paths
are `noteStreamEnded` (which releases only when every STARTED transcription
stream has ended — unsatisfiable for a lease with no STT bit) and
`releaseSatisfiedLeases` (a whole-table backstop for the 409 path). Add a
third, narrow one.

In `src/services/soniox-reconcile.ts`, beside `noteStreamEnded` in
`SweepPorts`:

```ts
    /** Release ONE lease by its three-segment base ref, unconditionally.
     *  For a lease that owns no transcription stream, the usage log itself is
     *  the proof of completion — there is no mask to clear, so
     *  `noteStreamEnded`'s predicate can never fire. Returns rows changed. */
    releaseLease(clientRefId: string, now: number): Promise<number>;
```

In `src/durable-objects/SonioxReconcilerDO.ts`, in the `ports()` object beside
the other lease-service bindings:

```ts
            releaseLease: async (clientRefId, now) =>
                createSessionLeaseService(env).release(clientRefId, now),
```

`SessionLeaseService.release(clientRefId, now)` already exists and already
fences on `client_ref_id`, which is the three-segment base ref the lease row
stores — the same value `sessionKeyHandler` releases on when a mint fails.

- [ ] **Step 6: Release a charged preview lease**

After the charge succeeds, beside the existing `kind === "stt"` release block:

```ts
                // A TTS-only lease cannot release through the mask: TTS roles
                // carry no bit, so `(ended & started) = started AND started != 0`
                // is never satisfiable and the lease would sit until its expiry
                // backstop. The principle is unchanged — the usage log is the
                // unforgeable proof the work is over — only the mechanism
                // differs: for STT that clears a bit, for a preview it releases
                // outright. Scoped to the preview role, not to `kind === "tts"`:
                // a session's TTS log must NOT release its lease while the
                // transcription stream is still running.
                if (parseClientRefId(clientRefId)?.rawRole === "preview_tts") {
                    await ports.releaseLease(leaseRef, sweepStartedAt);
                    releasedLeases++;
                }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/soniox-reconcile.ts src/services/soniox-api.ts src/durable-objects/SonioxReconcilerDO.ts src/services/soniox-reconcile.test.ts
git commit -m "feat(reconcile): release a charged preview lease, and fix the TTS zero-cost alarm"
```

---

## After the plan

Deploy and then confirm two things a test cannot:

1. **Nothing changed for sessions.** Start a managed session on each shape the
   client can request and check the ledger row still groups as a session with
   its usual kind and `textOnly` flag.
2. **The alarm gate is live but quiet.** §7's fix makes a previously unreachable
   alarm reachable. Expect no `REVENUE LOSS` lines; one would mean Soniox has
   started reporting `cost_usd: 0` on synthesis, which is exactly what the fix
   exists to surface.

Phase 2 (both frontend halves) is a separate plan, written after this deploys.
