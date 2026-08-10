# Managed Soniox split "Both" mode — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Kizuna-managed Soniox account run "Both" mode as two independent Soniox sessions instead of one mixed stream, and bill it correctly.

**Architecture:** One lease still serves one session, but a lease can now own several Soniox streams. Each stream gets its own temporary key bound to its own four-segment `client_reference_id` carrying a role, because Soniox attributes usage by the key's reference and two streams sharing a key are indistinguishable in the usage logs. The lease tracks which streams started and which have ended as bitmasks and releases only when every started stream has reported. Charging switches from wall-clock at a per-SKU list rate to provider cost × 2.0, while budgeting keeps dividing the balance — by a conservative rate for the whole stream set.

**Tech Stack:** Cloudflare Workers, Hono, D1 + Drizzle, Durable Objects, Vitest, `node:sqlite` for the statement-level tests.

**Design of record:** `sokuji-react/docs/superpowers/specs/2026-08-11-soniox-managed-split-both-design.md`. Read it before Task BE2 — this plan implements it and does not restate its reasoning.

## Global Constraints

- **Node 24** (`.nvmrc`). Run `source ~/.nvm/nvm.sh && nvm use` before any test command. Four test files load `node:sqlite` and **throw at load** rather than skipping when it is absent, so a default Node 20 fails them for reasons unrelated to your change.
- **Tests:** `npx vitest run <path>` for one file, `npm run test` for the suite. `npx tsc --noEmit` **is** a gate in this repo (CI runs it) — unlike the frontend repo.
- **Merging to `main` deploys production.** `deploy.yml` runs tests, then `tsc --noEmit`, then applies D1 migrations, then deploys the Worker. Migrations land **before** the new Worker, so every schema change must be invisible to the currently-running Worker.
- **`K = 2.0`**, the revenue coefficient over provider cost. Defined **once**, as `REVENUE_COEFFICIENT_K` in `src/services/pricing.ts` (Task BE7). Task BE8 imports it and must not redefine it.
- **Conservative budget rates**, USD/hour, used only for budgeting and never for charging: `1.10` per `*_stt` stream, `1.40` per `*_tts` stream, in `src/services/soniox-budget.ts` — a module deliberately separate from the price table, because one number serving both meanings drifts silently.
- **Attribution is key-bound.** Probed live 2026-08-11: Soniox attributes a usage log to the `client_reference_id` bound to the temporary key, and ignores the one in the socket's config frame. One key per stream is therefore required, and the client's socket-level reference is inert.
- **Only the three STT roles get mask bits**: `spk_stt` = 1, `par_stt` = 2, `mix_stt` = 4. TTS roles get none — a session may legitimately produce zero TTS usage logs, so a TTS started-bit could never clear.
- English only in code, comments and commit messages. Conventional commits. Never `git push` without explicit approval.

### Cross-task contracts — these names are authoritative

Sections were drafted independently and disagreed in a few places. Where a task body disagrees with this table, **this table wins**:

| Concept | Authoritative name and home |
|---|---|
| Role type | `SonioxStreamRole` in `src/config/soniox.ts` |
| Role → stt/tts | `roleKind(role)` in `src/config/soniox.ts` |
| Matrix → role set | `expandStreamRoles(shape: SonioxSessionShape)` in `src/config/soniox.ts` (BE6) |
| Revenue coefficient | `REVENUE_COEFFICIENT_K` in `src/services/pricing.ts` (BE7 defines, BE8 imports) |
| Conservative rate | `conservativeRateUsdPerHour(roles)` in `src/services/soniox-budget.ts` (BE8) |
| Lease base reference | `baseRefFor(accountId, leaseId)`; `session_leases.client_ref_id` keeps holding the **three-segment** base ref |
| Per-stream reference | `clientRefIdFor(accountId, leaseId, role)` — **no two-argument overload**, so `tsc` fails loudly at any call site that still meant the base ref |

**The release port evolves across two tasks, on purpose.** BE4 introduces `SweepPorts.releaseLease(clientRefId, now): Promise<number>` — the row count is what makes a release observable. BE5 then replaces it with `SweepPorts.noteStreamEnded(clientRefId, now): Promise<StreamEndResult>`, same arguments, richer answer, because release becomes conditional on the masks. Each step is independently reviewable; do not try to skip to the second.

### Ordering — one sequence is catastrophic, the rest are merely wrong

**BE6 must not reach production before BE2, BE4 and BE5 are live.** BE6 is what starts emitting four-segment references. A reconciler that still requires three segments treats every one of them as *somebody else's traffic* — the silent path that exists to filter BYOK customers out of the shared org log stream. The result is no charge **and no release**: `reconciled_at` stays null with `expires_at` up to an hour out, so the account 409s on every Start for that hour, while the ghost lease keeps counting against `MAX_STT_CONCURRENT` / `MAX_TTS_CONCURRENT`. At 25 TTS leases, a handful of these takes managed speech-to-speech down for the whole organization.

- BE2 → BE4 → BE5 → BE6 is a hard chain.
- BE3 must precede BE5 (the masks need columns) and BE9 (the fence needs `pinned_by_lease`). It may land alongside BE2 and BE4.
- BE7 must precede BE8, which imports `REVENUE_COEFFICIENT_K` for its invariant test.
- **BE7 and BE8 must both precede BE6.** BE6 mints keys, and to do that it needs a budget — which means it consumes `conservativeRateUsdPerHour` from BE8 and, transitively, K from BE7. BE8 does not depend on BE6 in return: it aggregates over a role array and needs only BE2's type, not BE6's expansion. So BE6 is the LAST of {BE2, BE4, BE5, BE7, BE8} to reach production — which is also what the catastrophic-ordering rule above demands for an unrelated reason.
- **BE2 is not independently deployable** even though it mints nothing: after it, `parseClientRefId` rejects the three-segment references production is still emitting. It must ship in the same release as BE4's ownership-gated release path.
- **BE5 must not deploy without both its roleless default and its past-expiry backstop.** The shipped client posts `{ leaseId }` with no role; without the default, every in-flight session fails to extend past its 75 s start window.

### A user-visible consequence that must not be "fixed"

The conservative rates are deliberately **not** pinned to today's per-SKU values. Pinning them would re-open overdraft under cost × 2.0. So an existing single-stream user sees a **shorter quoted duration at the same balance** — while typically being charged **less** than today: `text_only` costs $0.12–0.32/hour measured, which at K = 2.0 is $0.24–0.64/hour against today's flat $0.60/hour. Both halves are intended. An implementer who "restores" the old divisor reintroduces the overdraft this design removes.

### Why this plan starts at BE2

BE1 was a decision task — resolve the spec's open items before writing code. It was completed during design: the attribution question was settled by a live probe, `K` was set by jiangzhuo, and the remaining constants are pinned above. Task numbering is left as drafted rather than renumbered, because the numbers are referenced across task bodies.

---

### Task BE2: Role vocabulary and the four-segment `client_reference_id` (pure functions; no minter switched)

**Files:**
- Modify: `src/config/soniox.ts` (insert after line 86, immediately below `usageTypesForMode`)
- Modify: `src/services/session-lease.ts` (lines 47–83 replaced; call sites at lines 124, 193, 280)
- Modify: `src/routes/soniox.ts` (comment at line 332)
- Test: `src/services/session-lease.test.ts` (lines 1–3 imports; `describe("clientRefIdFor")` at 203–219 and `describe("parseClientRefId")` at 221–267 replaced/extended)
- Test (ripple, fixtures only): `src/services/soniox-reconcile.test.ts`, `src/services/soniox-reconcile.sqlite.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. (BE1 pinned the constants this task hard-codes: role→bit `spk_stt`=1, `par_stt`=2, `mix_stt`=4; TTS roles get no bit.)
- Produces:
  - `type SonioxStreamRole = "spk_stt" | "spk_tts" | "par_stt" | "par_tts" | "mix_stt" | "mix_tts"` (`src/config/soniox.ts`)
  - `const SONIOX_STREAM_ROLES: readonly SonioxStreamRole[]`
  - `function isSonioxStreamRole(value: unknown): value is SonioxStreamRole`
  - `const ROLE_USAGE_TYPE: Record<SonioxStreamRole, SonioxUsageType>`
  - `function roleKind(role: SonioxStreamRole): "stt" | "tts"`
  - `const STT_ROLE_BIT: { readonly spk_stt: 1; readonly par_stt: 2; readonly mix_stt: 4 }`
  - `type SonioxSttRole = keyof typeof STT_ROLE_BIT`
  - `function sttRoleBit(role: SonioxStreamRole): number` (0 for every TTS role)
  - `function baseRefFor(accountId: string, leaseId: string): string` (`src/services/session-lease.ts`)
  - `function clientRefIdFor(accountId: string, leaseId: string, role: SonioxStreamRole): string`
  - `function isOurClientRef(ref: string | null | undefined): boolean`
  - `interface ParsedClientRef { accountId: string; leaseId: string; role: SonioxStreamRole | null; rawRole: string; baseRef: string }`
  - `function parseClientRefId(ref: string | null | undefined): ParsedClientRef | null`

> **Deployment note, read before starting.** This task is *not* independently deployable, even though it mints nothing. Production still emits three-segment references, and after this task `parseClientRefId` rejects three segments — so a deploy of BE2 alone would stop charging and stop releasing every live session. The branch must reach the task that decouples release from charging (`isOurClientRef` gate) and the task that mints per-role keys before anything ships. Nothing here changes what any *stored* string looks like: `session_leases.client_ref_id` keeps holding the three-segment base ref.

> **Node version.** Four test files load `node:sqlite` and *throw* rather than skip when it is missing. Run `source ~/.nvm/nvm.sh && nvm use` first (`.nvmrc` pins 24; a default of Node 20 makes four files fail at load for reasons unrelated to this task).

- [ ] **Step 1: Write the failing test for the role vocabulary**

Add these two imports and this `describe` block to `src/services/session-lease.test.ts`. Replace the file's first three lines:

```ts
import { describe, it, expect } from "vitest";
import { SessionLeaseService, clientRefIdFor, parseClientRefId } from "./session-lease";
import { MAX_STT_CONCURRENT, MAX_TTS_CONCURRENT } from "../config/soniox";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
    SessionLeaseService, baseRefFor, clientRefIdFor, parseClientRefId, isOurClientRef,
} from "./session-lease";
import {
    MAX_STT_CONCURRENT, MAX_TTS_CONCURRENT,
    SONIOX_STREAM_ROLES, ROLE_USAGE_TYPE, STT_ROLE_BIT,
    isSonioxStreamRole, roleKind, sttRoleBit,
} from "../config/soniox";
```

and append this block at the end of the file:

```ts
describe("stream role vocabulary", () => {
    it("is exactly the six roles of spec A1, in one place", () => {
        expect([...SONIOX_STREAM_ROLES]).toEqual([
            "spk_stt", "spk_tts", "par_stt", "par_tts", "mix_stt", "mix_tts",
        ]);
    });

    it("maps every role to the usage type its temporary key must be scoped to", () => {
        expect(ROLE_USAGE_TYPE).toEqual({
            spk_stt: "transcribe_websocket",
            par_stt: "transcribe_websocket",
            mix_stt: "transcribe_websocket",
            spk_tts: "tts_rt",
            par_tts: "tts_rt",
            mix_tts: "tts_rt",
        });
    });

    it("derives the stt/tts kind from that one map rather than a second table", () => {
        // Two literal tables drift; the second one drifts silently, because a
        // role that claims "stt" while its key is scoped to tts_rt only shows
        // up as a Soniox 401 days later.
        for (const role of SONIOX_STREAM_ROLES) {
            expect(roleKind(role)).toBe(ROLE_USAGE_TYPE[role] === "tts_rt" ? "tts" : "stt");
        }
    });

    it("gives a bit to the three transcription roles only", () => {
        expect(STT_ROLE_BIT).toEqual({ spk_stt: 1, par_stt: 2, mix_stt: 4 });
        expect(sttRoleBit("spk_stt")).toBe(1);
        expect(sttRoleBit("par_stt")).toBe(2);
        expect(sttRoleBit("mix_stt")).toBe(4);
    });

    it("gives NO bit to any TTS role, so no lease can wait on a log that may never exist", () => {
        // A TTS key may back zero sockets — the initial TTS connect is
        // best-effort — so a session can legitimately produce zero TTS usage
        // logs. A started-bit for a TTS role could then never be cleared and
        // `(ended & started) === started` would never hold again: a lease that
        // can never release, holding the account's 409 for its whole grant.
        expect(sttRoleBit("spk_tts")).toBe(0);
        expect(sttRoleBit("par_tts")).toBe(0);
        expect(sttRoleBit("mix_tts")).toBe(0);
    });

    it("assigns disjoint bits, so a two-leg split mask is unambiguous", () => {
        expect(sttRoleBit("spk_stt") | sttRoleBit("par_stt")).toBe(3);
    });

    it("recognises exactly the six roles and nothing else", () => {
        for (const role of SONIOX_STREAM_ROLES) expect(isSonioxStreamRole(role)).toBe(true);
        expect(isSonioxStreamRole("spk")).toBe(false);
        expect(isSonioxStreamRole("SPK_STT")).toBe(false);
        expect(isSonioxStreamRole("")).toBe(false);
        expect(isSonioxStreamRole(undefined)).toBe(false);
        expect(isSonioxStreamRole(7)).toBe(false);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts`

Expected: FAIL — `TypeError: sttRoleBit is not a function` (and the sibling assertions fail on `undefined` for `SONIOX_STREAM_ROLES` / `ROLE_USAGE_TYPE` / `STT_ROLE_BIT`).

- [ ] **Step 3: Implement the role vocabulary**

In `src/config/soniox.ts`, the current end of the mode block reads (lines 77–86):

```ts
/**
 * A temporary key is scoped to ONE usage type, so speech-to-speech needs two.
 * This is also why the client's declared mode is self-enforcing: asking for
 * text_only yields no TTS key, so the cheap rate cannot buy the expensive path.
 */
export function usageTypesForMode(mode: SonioxMode): SonioxUsageType[] {
    return mode === "speech_to_speech"
        ? ["transcribe_websocket", "tts_rt"]
        : ["transcribe_websocket"];
}
```

Insert immediately after that closing brace:

```ts
/**
 * The closed vocabulary of Soniox stream roles (spec A1).
 *
 * `client_reference_id` becomes `sokuji1:<accountId>:<leaseId>:<role>` — one
 * key, one reference, one role, one stream. That is a requirement, not a
 * convenience: probed live 2026-08-11, Soniox attributes a usage log to the
 * `client_reference_id` bound to the TEMPORARY KEY and ignores the one the
 * socket declares in its config frame. Two streams sharing one key are
 * therefore indistinguishable in the usage logs, and the reference a client
 * sends on its socket frames is inert.
 *
 * The prefix is the audio source: `spk` = microphone, `par` = far end / system
 * audio, `mix` = both mixed into a single stream (shared Both mode). Naming the
 * mixed stream `spk_*` would be a lie about what it carries.
 *
 * `par_tts` is unreachable in v1 — `createParticipantSessionConfig` forces
 * `textOnly: true`, so no participant-side TTS exists in any mode — but it
 * stays in the vocabulary so that adding a second TTS stream later is a change
 * of policy, not of wire format.
 */
export const SONIOX_STREAM_ROLES = [
    "spk_stt", "spk_tts", "par_stt", "par_tts", "mix_stt", "mix_tts",
] as const;

export type SonioxStreamRole = (typeof SONIOX_STREAM_ROLES)[number];

/** Narrowing guard for a value crossing a JS boundary — a request body, or the
 *  fourth segment of a usage log's reference. The TypeScript union proves
 *  nothing about either of those. */
export function isSonioxStreamRole(value: unknown): value is SonioxStreamRole {
    return typeof value === "string"
        && (SONIOX_STREAM_ROLES as readonly string[]).includes(value);
}

/**
 * Role -> the Soniox usage type its temporary key must be scoped to.
 *
 * This is the ONE table. `roleKind` below derives stt/tts from it rather than
 * restating it, because a second literal table would drift, and it would drift
 * silently: a role claiming "stt" while its key is scoped to `tts_rt` surfaces
 * only as a 401 on a socket the user is waiting on.
 */
export const ROLE_USAGE_TYPE: Record<SonioxStreamRole, SonioxUsageType> = {
    spk_stt: "transcribe_websocket",
    par_stt: "transcribe_websocket",
    mix_stt: "transcribe_websocket",
    spk_tts: "tts_rt",
    par_tts: "tts_rt",
    mix_tts: "tts_rt",
};

/** The kind a role's usage log must classify as. Second, independent signal
 *  next to the model-name prefix: with the kind present in the reference, a
 *  disagreement between role and model is an alarm, and an unrecognised model
 *  prefix can fall back to the role instead of stranding the lease. */
export function roleKind(role: SonioxStreamRole): "stt" | "tts" {
    return ROLE_USAGE_TYPE[role] === "tts_rt" ? "tts" : "stt";
}

/**
 * One bit per TRANSCRIPTION role, for the lease's `stt_started_mask` /
 * `stt_ended_mask`.
 *
 * Only the three `*_stt` roles get a bit, and that asymmetry is load-bearing.
 * Release fires when `(ended & started) === started && started != 0`. A usage
 * log appears only when a stream ENDS, and a TTS key may back zero sockets (the
 * initial TTS connect is best-effort) — so a session can legitimately produce
 * no TTS log at all. A TTS started-bit could therefore never be cleared, and
 * the lease would hold the account at 409 until its expiry every single time.
 *
 * The values are pinned literals, not derived from the array's index: they are
 * written into the database, so reordering `SONIOX_STREAM_ROLES` must not be
 * able to reinterpret a mask already stored on a live lease row.
 */
export const STT_ROLE_BIT = {
    spk_stt: 1,
    par_stt: 2,
    mix_stt: 4,
} as const;

export type SonioxSttRole = keyof typeof STT_ROLE_BIT;

/** The role's mask bit, or 0 for a role that has none (every TTS role). Total
 *  by design: callers thread whatever role a log carried through here without
 *  first having to know which half of the vocabulary it is in. */
export function sttRoleBit(role: SonioxStreamRole): number {
    return role in STT_ROLE_BIT ? STT_ROLE_BIT[role as SonioxSttRole] : 0;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts`

Expected: the 7 `stream role vocabulary` tests PASS. The file still fails on `TypeError: baseRefFor is not a function` (imported, not yet written) — that is Step 5's target.

- [ ] **Step 5: Write the failing tests for the two builders and the two predicates**

In `src/services/session-lease.test.ts`, replace the whole existing `describe("clientRefIdFor")` block (lines 203–219) and the whole existing `describe("parseClientRefId")` block (lines 221–267) — verbatim current start of the first one, so you can find the anchor:

```ts
describe("clientRefIdFor", () => {
    it("namespaces the reference so it is identifiable as ours", () => {
        expect(clientRefIdFor("acct1", "L1")).toBe("sokuji1:acct1:L1");
    });
```

with:

```ts
describe("baseRefFor", () => {
    it("produces the three-segment reference the lease row stores, byte for byte", () => {
        // This string is written to `session_leases.client_ref_id` and is what
        // every lease lookup keys on. It must not move when the wire format
        // grows a fourth segment.
        expect(baseRefFor("acct1", "L1")).toBe("sokuji1:acct1:L1");
    });

    it("rejects an accountId containing a colon", () => {
        // This repo's own convention builds composite subject keys as
        // `${subjectType}:${subjectId}` (wallet-service.ts). Passing one
        // straight through as accountId must fail loudly here, not silently
        // produce a ref that parseClientRefId cannot split back apart.
        expect(() => baseRefFor("org:acct1", "L1")).toThrow();
    });

    it("rejects a leaseId containing a colon", () => {
        expect(() => baseRefFor("acct1", "L:1")).toThrow();
    });
});

describe("clientRefIdFor", () => {
    it("appends the role, so every stream carries its own reference", () => {
        expect(clientRefIdFor("acct1", "L1", "spk_stt")).toBe("sokuji1:acct1:L1:spk_stt");
        expect(clientRefIdFor("acct1", "L1", "par_stt")).toBe("sokuji1:acct1:L1:par_stt");
        expect(clientRefIdFor("acct1", "L1", "mix_tts")).toBe("sokuji1:acct1:L1:mix_tts");
    });

    it("extends the base ref rather than re-deriving the format", () => {
        expect(clientRefIdFor("acct1", "L1", "spk_tts"))
            .toBe(`${baseRefFor("acct1", "L1")}:spk_tts`);
    });

    it("rejects an accountId or leaseId containing a colon", () => {
        expect(() => clientRefIdFor("org:acct1", "L1", "spk_stt")).toThrow();
        expect(() => clientRefIdFor("acct1", "L:1", "spk_stt")).toThrow();
    });

    it("rejects a role containing a colon", () => {
        // Unreachable while the vocabulary is colon-free — but the cast below
        // is exactly what a value arriving from a request body looks like to
        // the compiler, and a colon here would make the ref unsplittable.
        expect(() => clientRefIdFor("acct1", "L1", "spk:stt" as any)).toThrow();
    });

    it("rejects a role outside the closed vocabulary, at mint time", () => {
        // A typo caught here costs a 500 on one request. The same typo minted
        // into a temporary key is invisible until a usage log arrives days
        // later carrying a role nothing recognises.
        expect(() => clientRefIdFor("acct1", "L1", "spk_sst" as any)).toThrow();
    });
});

describe("isOurClientRef", () => {
    // Ownership and parsing are deliberately two predicates. This one answers
    // "is this ours at all?" and is what the release path is gated on; the
    // parse answers "can I bill this?" and rejects the legacy three-segment
    // form. Collapsing them strands every session that was live at deploy —
    // and does it silently, because rejecting a reference is indistinguishable
    // from a BYOK customer's traffic in the same org log stream.
    it("accepts the legacy three-segment form", () => {
        expect(isOurClientRef("sokuji1:acct1:L1")).toBe(true);
    });

    it("accepts the four-segment form", () => {
        expect(isOurClientRef("sokuji1:acct1:L1:spk_stt")).toBe(true);
        expect(isOurClientRef(clientRefIdFor("acct1", "L1", "par_stt"))).toBe(true);
    });

    it("accepts a shape it does not understand, on purpose", () => {
        // Loosest possible test: a false negative here is silent and costs the
        // account its lease for up to an hour, while a false positive costs at
        // most a release that reports zero rows changed.
        expect(isOurClientRef("sokuji1:acct1:L1:spk_stt:extra")).toBe(true);
        expect(isOurClientRef("sokuji1:acct1:L1:not_a_role")).toBe(true);
    });

    it("does not accept a prefix that merely STARTS with ours", () => {
        // Compared as a whole segment, never with startsWith: "sokuji10" is a
        // different namespace, not ours.
        expect(isOurClientRef("sokuji10:acct1:L1:spk_stt")).toBe(false);
    });

    it("rejects BYOK traffic, empty and null", () => {
        expect(isOurClientRef("team-7:call-91")).toBe(false);
        expect(isOurClientRef("other:acct:lease")).toBe(false);
        expect(isOurClientRef("noColonHere")).toBe(false);
        expect(isOurClientRef("")).toBe(false);
        expect(isOurClientRef(null)).toBe(false);
    });
});

describe("parseClientRefId", () => {
    it("returns null for null input", () => {
        expect(parseClientRefId(null)).toBeNull();
    });

    it("returns null for an empty string", () => {
        expect(parseClientRefId("")).toBeNull();
    });

    it("returns null for a string with no colon", () => {
        expect(parseClientRefId("noColonHere")).toBeNull();
    });

    it("returns null for an empty accountId, leaseId or role", () => {
        expect(parseClientRefId("sokuji1::L1:spk_stt")).toBeNull();
        expect(parseClientRefId("sokuji1:acct1::spk_stt")).toBeNull();
        expect(parseClientRefId("sokuji1:acct1:L1:")).toBeNull();
    });

    it("parses a well-formed four-segment reference into its parts and its base ref", () => {
        expect(parseClientRefId("sokuji1:acct1:L1:par_stt")).toEqual({
            accountId: "acct1",
            leaseId: "L1",
            role: "par_stt",
            rawRole: "par_stt",
            baseRef: "sokuji1:acct1:L1",
        });
    });

    it("round-trips whatever clientRefIdFor produces, and its baseRef is the lease's stored key", () => {
        const parsed = parseClientRefId(clientRefIdFor("acct1", "L1", "spk_tts"))!;
        expect(parsed.accountId).toBe("acct1");
        expect(parsed.leaseId).toBe("L1");
        expect(parsed.role).toBe("spk_tts");
        expect(parsed.baseRef).toBe(baseRefFor("acct1", "L1"));
    });

    it("parses an unrecognised role as OURS with an unknown role, never as not-ours", () => {
        // The null path is the SILENT path (it is the normal path for BYOK
        // traffic). Dropping an unknown role into it would hide the failure
        // completely; it has to come back as ours so the caller can alarm.
        const parsed = parseClientRefId("sokuji1:acct1:L1:spk_sst");
        expect(parsed).not.toBeNull();
        expect(parsed!.accountId).toBe("acct1");
        expect(parsed!.leaseId).toBe("L1");
        expect(parsed!.role).toBeNull();
        expect(parsed!.rawRole).toBe("spk_sst"); // evidence for the alarm text
        expect(parsed!.baseRef).toBe("sokuji1:acct1:L1");
    });

    it("rejects exactly three segments, which the OWNERSHIP predicate still accepts", () => {
        // Decision 5: legacy three-segment logs are not billable. A4: those
        // same sessions must still release their lease. Both hold only because
        // these are two different functions.
        expect(parseClientRefId("sokuji1:acct1:L1")).toBeNull();
        expect(isOurClientRef("sokuji1:acct1:L1")).toBe(true);
    });

    // The organisation's Soniox usage-log stream also carries BYOK customers'
    // sessions. Accepting a foreign reference on SHAPE alone would bill one of
    // our accounts for a stranger's session -- or, when no such wallet exists,
    // feed the reconciler a charge that can never succeed.
    it("rejects a foreign four-segment reference that merely LOOKS like ours", () => {
        expect(parseClientRefId("a:b:c:d")).toBeNull();
        expect(parseClientRefId("team-7:call-91:x:y")).toBeNull();
        expect(parseClientRefId("sokuji10:acct1:L1:spk_stt")).toBeNull();
    });

    it("rejects the old un-namespaced shape", () => {
        expect(parseClientRefId("acct1:L1")).toBeNull();
    });

    it("rejects a reference with extra segments", () => {
        expect(parseClientRefId("sokuji1:acct1:L1:spk_stt:extra")).toBeNull();
    });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts`

Expected: FAIL — `TypeError: baseRefFor is not a function`, plus `TypeError: isOurClientRef is not a function`, plus the existing `parseClientRefId` tests failing on the new four-segment expectations.

- [ ] **Step 7: Implement the builders and predicates**

In `src/services/session-lease.ts`, replace lines 47–83 verbatim. Current text (the anchor):

```ts
/** Throws if `accountId` or `leaseId` contains `:` — a colon inside either part
 *  would make the joined ref ambiguous to split back apart (see
 *  `parseClientRefId`, which requires exactly three colon-separated parts).
 *  This repo already builds composite ids as `${subjectType}:${subjectId}`
 *  elsewhere (wallet-service.ts); passing one of those straight through as
 *  `accountId` must fail loudly here rather than silently misattribute a lease
 *  later. */
export function clientRefIdFor(accountId: string, leaseId: string): string {
    if (accountId.includes(":")) {
        throw new Error(`clientRefIdFor: accountId must not contain ':' (got ${JSON.stringify(accountId)})`);
    }
    if (leaseId.includes(":")) {
        throw new Error(`clientRefIdFor: leaseId must not contain ':' (got ${JSON.stringify(leaseId)})`);
    }
    return `${CLIENT_REF_PREFIX}:${accountId}:${leaseId}`;
}

/**
 * Parse a Soniox `client_reference_id` back into its parts, or null if the
 * reference is not one of ours.
 *
 * Ownership is decided by the `CLIENT_REF_PREFIX` token, not by shape. The
 * reconciler feeds EVERY log line in the org's stream through this, so a
 * false-positive parse charges one of our accounts for someone else's session
 * (or, when no such wallet exists, feeds a permanently-failing charge into the
 * sweep). Requiring exactly three parts is what makes the split unambiguous —
 * `clientRefIdFor` already refuses a colon inside either half.
 */
export function parseClientRefId(ref: string | null): { accountId: string; leaseId: string } | null {
    if (!ref) return null;
    const parts = ref.split(":");
    if (parts.length !== 3) return null;
    const [prefix, accountId, leaseId] = parts;
    if (prefix !== CLIENT_REF_PREFIX) return null;
    if (!accountId || !leaseId) return null;
    return { accountId, leaseId };
}
```

New text:

```ts
/**
 * The THREE-segment `sokuji1:<accountId>:<leaseId>`.
 *
 * This is what `session_leases.client_ref_id` stores and what every lease
 * lookup, mask update and release keys on. It is deliberately NOT what is
 * bound to a Soniox temporary key: keys carry the four-segment, role-bearing
 * form built by `clientRefIdFor` below, and the two must never be swapped.
 * Handing Soniox a base ref makes two streams of one session indistinguishable
 * in the usage logs; handing the database a role ref makes every lookup miss
 * silently.
 *
 * Throws if `accountId` or `leaseId` contains `:` — a colon inside either part
 * would make the joined ref ambiguous to split back apart (see
 * `parseClientRefId`, which requires exactly four colon-separated parts).
 * This repo already builds composite ids as `${subjectType}:${subjectId}`
 * elsewhere (wallet-service.ts); passing one of those straight through as
 * `accountId` must fail loudly here rather than silently misattribute a lease
 * later.
 */
export function baseRefFor(accountId: string, leaseId: string): string {
    if (accountId.includes(":")) {
        throw new Error(`baseRefFor: accountId must not contain ':' (got ${JSON.stringify(accountId)})`);
    }
    if (leaseId.includes(":")) {
        throw new Error(`baseRefFor: leaseId must not contain ':' (got ${JSON.stringify(leaseId)})`);
    }
    return `${CLIENT_REF_PREFIX}:${accountId}:${leaseId}`;
}

/**
 * The FOUR-segment `sokuji1:<accountId>:<leaseId>:<role>` bound to ONE Soniox
 * temporary key.
 *
 * One key, one reference, one role, one stream. Required, not tidy: Soniox
 * attributes a usage log to the reference bound to the KEY and ignores the one
 * the socket declares in its config frame (probed live 2026-08-11), so two
 * streams sharing a key cannot be told apart afterwards.
 *
 * Three guards, one per part. The role guard is the one that pays: a typo
 * rejected here costs a 500 on one request, while a typo minted into a key is
 * invisible until a usage log arrives days later carrying a role nothing
 * recognises. The colon check runs first so a role that is both colon-bearing
 * and unknown reports the ambiguity it actually causes; the membership check
 * is the real gate, and stays reachable for any other bad value.
 */
export function clientRefIdFor(accountId: string, leaseId: string, role: SonioxStreamRole): string {
    if (String(role).includes(":")) {
        throw new Error(`clientRefIdFor: role must not contain ':' (got ${JSON.stringify(role)})`);
    }
    if (!isSonioxStreamRole(role)) {
        throw new Error(
            `clientRefIdFor: unknown role ${JSON.stringify(role)} ` +
            `(expected one of ${SONIOX_STREAM_ROLES.join(", ")})`
        );
    }
    return `${baseRefFor(accountId, leaseId)}:${role}`;
}

/**
 * Is this reference ours at all? Prefix token only.
 *
 * Deliberately a DIFFERENT predicate from `parseClientRefId`, and deliberately
 * the loosest test that can be written. `parseClientRefId` answers "can I bill
 * this?" and rejects the legacy three-segment form (decision 5); this answers
 * "is this ours?" and accepts three segments, four, and anything else carrying
 * our namespace token. The release path is gated on THIS one, never on the
 * parse — otherwise every session that was live at deploy keeps its lease with
 * `reconciled_at` null and up to an hour of `expires_at` left, 409ing the
 * account on every Start and counting against MAX_STT_CONCURRENT the whole
 * time. Losing those sessions' revenue is an accepted cost; losing the
 * accounts is not.
 *
 * Compares the first SEGMENT rather than using `startsWith`, so `sokuji10:…`
 * — a different namespace — is not mistaken for ours.
 */
export function isOurClientRef(ref: string | null | undefined): boolean {
    if (!ref) return false;
    return ref.split(":", 1)[0] === CLIENT_REF_PREFIX;
}

export interface ParsedClientRef {
    accountId: string;
    leaseId: string;
    /** null when the fourth segment is not in the closed vocabulary. This is
     *  "ours, with an unknown role" — an ALARM, not a rejection. */
    role: SonioxStreamRole | null;
    /** The fourth segment exactly as it arrived, so the alarm can say what it
     *  saw. Always present; equals `role` whenever `role` is non-null. */
    rawRole: string;
    /** The three-segment `sokuji1:<accountId>:<leaseId>` — byte-identical to
     *  `baseRefFor(accountId, leaseId)`, i.e. the value in the lease row's
     *  `client_ref_id` column. Every DB lookup takes THIS, never the raw
     *  four-segment reference the log carried. */
    baseRef: string;
}

/**
 * Parse a Soniox `client_reference_id` back into its parts, or null if the
 * reference is not one of ours to BILL.
 *
 * Ownership is decided by the `CLIENT_REF_PREFIX` token, not by shape. The
 * reconciler feeds EVERY log line in the org's stream through this, so a
 * false-positive parse charges one of our accounts for someone else's session
 * (or, when no such wallet exists, feeds a permanently-failing charge into the
 * sweep). Requiring exactly four parts is what makes the split unambiguous —
 * `clientRefIdFor` already refuses a colon inside any of them.
 *
 * Two failure modes are distinguished on purpose:
 *
 *  - Three segments — a legacy reference from a session that was live at
 *    deploy. Returns null: not billable (decision 5). Its lease still gets
 *    released, via `isOurClientRef`, which is why that is a separate function.
 *  - Four segments with a role nobody recognises. Returns a parse with
 *    `role: null`. It must NOT take the null path: that path is silent by
 *    design (it is the normal path for BYOK customers' traffic) and would hide
 *    the failure entirely.
 */
export function parseClientRefId(ref: string | null | undefined): ParsedClientRef | null {
    if (!ref) return null;
    const parts = ref.split(":");
    if (parts.length !== 4) return null;
    const [prefix, accountId, leaseId, rawRole] = parts;
    if (prefix !== CLIENT_REF_PREFIX) return null;
    if (!accountId || !leaseId || !rawRole) return null;
    return {
        accountId,
        leaseId,
        role: isSonioxStreamRole(rawRole) ? rawRole : null,
        rawRole,
        // Cannot throw: a four-way split proves neither half contains a colon.
        // Built through the shared builder anyway, so the base format has one
        // definition and a parse can never disagree with a mint.
        baseRef: baseRefFor(accountId, leaseId),
    };
}
```

Then extend the import block at the top of the same file. Current lines 1–4:

```ts
import {
    KEY_START_WINDOW_S, LEASE_MARGIN_MS,
    MAX_STT_CONCURRENT, MAX_TTS_CONCURRENT,
} from "../config/soniox";
```

become:

```ts
import {
    KEY_START_WINDOW_S, LEASE_MARGIN_MS,
    MAX_STT_CONCURRENT, MAX_TTS_CONCURRENT,
    SONIOX_STREAM_ROLES, isSonioxStreamRole,
    type SonioxStreamRole,
} from "../config/soniox";
```

- [ ] **Step 8: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts`

Expected: FAIL, but only inside `describe("acquire")` / `markStarted` / `findByClientRef` / `getExpiresAt` — `TypeError: clientRefIdFor is not a function`-shaped errors are gone; what remains is the three intra-file call sites still calling `clientRefIdFor` with two arguments, which now throws `clientRefIdFor: unknown role undefined (expected one of spk_stt, …)`. All `baseRefFor` / `clientRefIdFor` / `isOurClientRef` / `parseClientRefId` / `stream role vocabulary` blocks PASS. Step 9 fixes the three call sites.

- [ ] **Step 9: Switch the three intra-file call sites to `baseRefFor`**

Three one-line edits in `src/services/session-lease.ts`. They must produce a string identical to today's, because it is written to and read from `session_leases.client_ref_id`.

Line 124, inside `acquire`:

```ts
        const clientRefId = clientRefIdFor(p.accountId, p.leaseId);
```
becomes
```ts
        // The BASE ref: this is the lease's identity in the database and the
        // value every mask update and release fences on. Per-stream, role-
        // bearing references are minted at key-issue time and never stored.
        const clientRefId = baseRefFor(p.accountId, p.leaseId);
```

Line 193, inside `markStarted`:

```ts
        const clientRefId = clientRefIdFor(accountId, leaseId);
```
becomes
```ts
        const clientRefId = baseRefFor(accountId, leaseId);
```

Line 280, inside `getExpiresAt`:

```ts
        const clientRefId = clientRefIdFor(accountId, leaseId);
```
becomes
```ts
        const clientRefId = baseRefFor(accountId, leaseId);
```

- [ ] **Step 10: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts src/services/session-lease.sqlite.test.ts`

Expected: PASS — all tests in both files. (`session-lease.sqlite.test.ts` executes the real statement text and proves the stored `client_ref_id` is still `sokuji1:acct1:L1`.)

- [ ] **Step 11: Switch the remaining `clientRefIdFor` call sites — the route tests and one stale comment**

`src/routes/soniox.test.ts` line 4:

```ts
import { clientRefIdFor } from "../services/session-lease";
```
becomes
```ts
import { baseRefFor } from "../services/session-lease";
```

Line 136, inside `fakeLeaseService`:

```ts
                    // The real builder, so this fake cannot drift from the
                    // namespaced format the reconciler parses.
                    clientRefId: clientRefIdFor(p.accountId, p.leaseId),
```
becomes
```ts
                    // The real builder, so this fake cannot drift from the
                    // namespaced format the lease row stores. The BASE ref:
                    // per-stream role references are minted per key, not here.
                    clientRefId: baseRefFor(p.accountId, p.leaseId),
```

Line 367:

```ts
        expect(calls.json?.body.clientReferenceId).toBe(clientRefIdFor("u1", calls.json?.body.leaseId));
```
becomes
```ts
        expect(calls.json?.body.clientReferenceId).toBe(baseRefFor("u1", calls.json?.body.leaseId));
```

Lines 386–388:

```ts
        expect(calls.json?.body.clientReferenceId).toBe(
            clientRefIdFor("u1", calls.json?.body.leaseId)
        );
```
becomes
```ts
        expect(calls.json?.body.clientReferenceId).toBe(
            baseRefFor("u1", calls.json?.body.leaseId)
        );
```

And `src/routes/soniox.ts` line 332 — comment only, keeping it truthful about which function throws:

```ts
        // clientRefIdFor (called via markStarted) THROWS on a colon — it would
```
becomes
```ts
        // baseRefFor (called via markStarted) THROWS on a colon — it would
```

- [ ] **Step 12: Run the route tests and the typechecker**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/soniox.test.ts && npx tsc --noEmit`

Expected: PASS, and `tsc` exits 0 with no output. (`tsc` is the gate that proves no two-argument `clientRefIdFor` call survives anywhere.)

- [ ] **Step 13: Move the reconciler's test fixtures to the four-segment form**

The reconciler's own source is untouched by this task, but every fixture in its tests carries a now-unbillable three-segment reference. Rewrite the literals — the sweep still passes the log's raw reference to `releaseLease`, so the `h.released` expectations move with them:

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
sed -i 's/"sokuji1:acct1:L1"/"sokuji1:acct1:L1:spk_stt"/g' src/services/soniox-reconcile.test.ts
sed -i 's/"sokuji1:frozen-acct:L1"/"sokuji1:frozen-acct:L1:spk_stt"/g' src/services/soniox-reconcile.test.ts
sed -i 's/"sokuji1:other-acct:L2"/"sokuji1:other-acct:L2:spk_stt"/g' src/services/soniox-reconcile.test.ts
sed -i 's/"sokuji1:acct1:L1"/"sokuji1:acct1:L1:spk_stt"/g; s/"sokuji1:acct1:L9"/"sokuji1:acct1:L9:spk_stt"/g; s/"sokuji1:acct1:L2"/"sokuji1:acct1:L2:spk_stt"/g' src/services/soniox-reconcile.sqlite.test.ts
```

Two of those were TTS logs and must carry a TTS role instead. In `src/services/soniox-reconcile.test.ts`, the `ttsLog` fixture now reads:

```ts
const ttsLog = {
    uuid: "u-tts", client_reference_id: "sokuji1:acct1:L1:spk_tts", model: "tts-rt-v1",
```

wait — after the sed it reads `"sokuji1:acct1:L1:spk_stt"`. Change that one line to:

```ts
const ttsLog = {
    uuid: "u-tts", client_reference_id: "sokuji1:acct1:L1:spk_tts", model: "tts-rt-v1",
```

And in `src/services/soniox-reconcile.sqlite.test.ts`, the second log of the speech-to-speech pair now reads `client_reference_id: "sokuji1:acct1:L2:spk_stt", // SAME client_reference_id — one session.`; change that line to:

```ts
            client_reference_id: "sokuji1:acct1:L2:spk_tts", // SAME lease, different role — one session.
```

- [ ] **Step 14: Add the regression evidence for decision 5**

In `src/services/soniox-reconcile.test.ts`, inside the existing `describe("buildCharge", …)` block, immediately after the test that starts `it("charges the STT entry at the lease's SKU rate on its audio duration"`, add:

```ts
    // Decision 5: sessions that were live at deploy carry a three-segment
    // reference and lose their revenue. They must NOT lose their lease — that
    // release rides on `isOurClientRef`, which is a different predicate from
    // this parse and accepts three segments.
    it("produces no charge for a legacy three-segment reference", () => {
        expect(buildCharge({ ...sttLog, client_reference_id: "sokuji1:acct1:L1" }, "soniox:text_only"))
            .toBeNull();
    });
```

- [ ] **Step 15: Run the whole suite**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && source ~/.nvm/nvm.sh && nvm use && npm test`

Expected: PASS for every file this task touched. Two pre-existing failures in `src/db/migrations.sqlite.test.ts` (`session_leases has exactly the columns session.schema.ts declares`, `soniox_voice_slots has exactly the columns voice-slot.schema.ts declares`) come from the uncommitted migration-0010 work in the tree and are **not** this task's — confirm with `git stash list` / `git status` that those files are none of yours, and do not stage them in Step 16.

- [ ] **Step 16: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/config/soniox.ts \
        src/services/session-lease.ts \
        src/services/session-lease.test.ts \
        src/routes/soniox.ts \
        src/routes/soniox.test.ts \
        src/services/soniox-reconcile.test.ts \
        src/services/soniox-reconcile.sqlite.test.ts
git commit -m "$(cat <<'EOF'
feat(soniox): four-segment client_reference_id with a closed role vocabulary

Soniox attributes a usage log to the client_reference_id bound to the
temporary KEY and ignores the one the socket declares in its config frame
(probed live 2026-08-11). Two streams sharing one key are therefore
indistinguishable afterwards, so a split Both session needs one key per
stream and one reference per key: sokuji1:<accountId>:<leaseId>:<role>.

Ownership and parsing are two predicates, not one. parseClientRefId answers
"can I bill this?" and rejects the legacy three-segment form; the prefix-only
isOurClientRef answers "is this ours at all?" and accepts three and four.
Collapsed into one function, every session live at deploy would keep its
lease with reconciled_at null for up to an hour — 409 on every Start and a
row counting against MAX_STT_CONCURRENT the whole time — and it would fail
silently, because a rejected reference looks exactly like BYOK traffic.

An unrecognised role parses as ours-with-unknown-role rather than as
not-ours, for the same reason: the not-ours path is silent by design.

Only the three transcription roles get a mask bit. A TTS key may back zero
sockets, so a session can legitimately produce no TTS usage log; a TTS
started-bit could never be cleared and would build a lease that never
releases.

Nothing yet mints a role-bearing reference: baseRefFor reproduces today's
three-segment string byte for byte, and every existing call site now uses
it, so the stored client_ref_id is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task BE3: Additive migration 0010 — lease role masks, the transcription-stream count, and the voice-slot lease fence

All work is in `sokuji-backend` (`/home/jiangzhuo/Desktop/kizunaai/sokuji-backend`). Every path below is relative to that repo root.

This task changes **nothing** a currently-shipped client can observe. It adds columns, backfills them so the arithmetic is unchanged, and swaps `countActive`'s `COUNT(*)` for a `SUM` that is numerically identical for every single-stream lease. `markStarted`, `release`, `markEndSignalled`, `findByClientRef` and `getExpiresAt` are **not touched** here — the mask OR and the release predicate belong to a later task.

**Files:**
- Create: `src/db/migrations.sqlite.test.ts`
- Create: `drizzle/0010_session_leases_role_masks.sql`
- Create: `drizzle/meta/0010_snapshot.json`
- Modify: `drizzle/meta/_journal.json` (append after the `idx: 9` entry, currently ends at line 66)
- Modify: `src/db/session.schema.ts` (insert after line 47, `endSignalledAt`)
- Modify: `src/db/voice-slot.schema.ts` (insert after line 30, `pinnedUntil`)
- Modify: `src/services/session-lease.ts` (lines 21-30 `AcquireParams`, 88-101 `countActive`, 113-178 `acquire`)
- Modify: `src/config/soniox.ts` (line 52, `MAX_STT_CONCURRENT`'s docstring)
- Test: `src/services/session-lease.sqlite.test.ts` (lines 87-93 `makeSqlite`, plus new cases)
- Test: `src/services/session-lease.test.ts` (lines 16, 27-28, 34-40 — the positional fake D1)
- Test: `src/services/voice-slot.sqlite.test.ts` (lines 49-51, 86, 215)

**Interfaces:**
- Consumes: nothing from earlier tasks. Existing today: `MAX_STT_CONCURRENT`, `MAX_TTS_CONCURRENT`, `KEY_START_WINDOW_S`, `LEASE_MARGIN_MS` from `src/config/soniox.ts`; `clientRefIdFor(accountId: string, leaseId: string): string` from `src/services/session-lease.ts`.
- Produces:
  - `AcquireParams.sttStreamCount?: number` — optional, defaults to `1`.
  - `SessionLeaseService.countActive(now: number): Promise<{ stt: number; tts: number }>` — signature unchanged, `stt` now means transcription **streams**.
  - `SessionLeaseService.acquire(p: AcquireParams): Promise<AcquireResult>` — unchanged signature.
  - DB columns `session_leases.stt_started_mask`, `session_leases.stt_ended_mask`, `session_leases.stt_stream_count` (all `integer DEFAULT 0 NOT NULL`) and `soniox_voice_slots.pinned_by_lease` (`text`, nullable).
  - Drizzle TS fields `sessionLeases.sttStartedMask`, `sessionLeases.sttEndedMask`, `sessionLeases.sttStreamCount`, `sonioxVoiceSlots.pinnedByLease`.
  - Migration tag `0010_session_leases_role_masks`; snapshot id `7c1f4a02-9d3b-4e58-a1c6-0f2b5d8e41aa`, `prevId` `23f020f5-ea9e-4c94-8026-796057d39ecf`.
  - Exported test constant `MIGRATIONS` (a `string[]` of `.sql` filenames in journal order) in both `session-lease.sqlite.test.ts` and `voice-slot.sqlite.test.ts` — module-local, not exported across files.

Every command below needs Node ≥ 22 (`node:sqlite`). The repo pins Node 24 in `.nvmrc`. Prefix each shell session with:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v24.18.0
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
```

---

- [ ] **Step 1: Write the failing test**

Create `src/db/migrations.sqlite.test.ts`. This is the guard against the landmine that adding columns to the drizzle TS schema **without** the `.sql` file passes every existing test and then throws `no such column` in production, because D1 builds the table from `drizzle/*.sql`, not from the schema.

```ts
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { sessionLeases } from "./session.schema";
import { sonioxVoiceSlots } from "./voice-slot.schema";

/**
 * The drizzle TS schema and the SQL that actually runs in production must agree.
 *
 * Nothing else in this repo checks that. The TS schema is what every unit test
 * (and the fake D1 in session-lease.test.ts) implicitly believes, but D1 builds
 * the real table from `drizzle/*.sql` — `wrangler d1 migrations apply` reads the
 * .sql files, not the schema. So adding a column to session.schema.ts and
 * forgetting the migration passes the ENTIRE suite and then throws
 * `no such column` on the first production request. This file is the only place
 * that catches it, by executing every migration in journal order against a real
 * engine and diffing the resulting columns against the schema's.
 *
 * It also pins the three artefacts drizzle-kit keeps in sync and a hand-authored
 * migration can silently break: the .sql, the journal entry, and the
 * meta/NNNN_snapshot.json whose `prevId` chain the NEXT `db:generate` reads. A
 * missing or unchained snapshot does not fail anything today — it fails weeks
 * later, as a bogus diff in someone else's migration.
 *
 * `node:sqlite` (Node's built-in SQLite) is only available on Node >= 22.
 * Do NOT `it.skipIf(!DatabaseSync)` here — a silently-skipped schema guard is
 * worse than no guard, because its green checkmark looks like coverage that was
 * never executed. If node:sqlite is unavailable this file throws at load time
 * so the suite FAILS LOUDLY instead of quietly skipping.
 */
const nodeRequire = createRequire(import.meta.url);
let DatabaseSync: any;
try {
    ({ DatabaseSync } = nodeRequire("node:sqlite"));
} catch (err) {
    throw new Error(
        "migrations.sqlite.test.ts requires node:sqlite (Node >= 22) and the current " +
        "runtime does not have it. This test intentionally does NOT skip when node:sqlite " +
        "is missing, because a skipped test here would hide a schema/migration divergence " +
        "that only fails in production. Run on Node >= 22, e.g.:\n" +
        '  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use v24.18.0\n' +
        "(see .nvmrc for the pinned version).\n" +
        `Original error: ${err instanceof Error ? err.message : String(err)}`
    );
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.resolve(here, "../../drizzle");

interface JournalEntry { idx: number; version: string; when: number; tag: string; breakpoints: boolean }

function journal(): { entries: JournalEntry[] } {
    return JSON.parse(readFileSync(path.join(DRIZZLE_DIR, "meta/_journal.json"), "utf8"));
}

/** Strip drizzle-kit's `--> statement-breakpoint` markers (not valid SQL —
 *  drizzle's own migrator strips these before executing) and hand the rest
 *  to sqlite3_exec, which accepts multiple `;`-separated statements. */
function loadMigration(file: string): string {
    return readFileSync(path.join(DRIZZLE_DIR, file), "utf8").replace(/--> statement-breakpoint/g, "");
}

/** Every migration, in journal order — the same order wrangler applies them. */
function migratedDatabase(): InstanceType<typeof DatabaseSync> {
    const sqlite = new DatabaseSync(":memory:");
    for (const entry of journal().entries) {
        sqlite.exec(loadMigration(`${entry.tag}.sql`));
    }
    return sqlite;
}

function sqlColumnNames(sqlite: InstanceType<typeof DatabaseSync>, table: string): string[] {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.map((r) => r.name).sort();
}

function schemaColumnNames(table: any): string[] {
    return Object.values(getTableColumns(table)).map((c: any) => c.name).sort();
}

describe("drizzle migrations vs the TS schema", () => {
    it("session_leases has exactly the columns session.schema.ts declares", () => {
        const sqlite = migratedDatabase();
        expect(sqlColumnNames(sqlite, "session_leases")).toEqual(schemaColumnNames(sessionLeases));
    });

    it("soniox_voice_slots has exactly the columns voice-slot.schema.ts declares", () => {
        const sqlite = migratedDatabase();
        expect(sqlColumnNames(sqlite, "soniox_voice_slots")).toEqual(schemaColumnNames(sonioxVoiceSlots));
    });

    it("migration 0010 adds the split-Both lease columns and the voice-slot lease fence", () => {
        const sqlite = migratedDatabase();
        expect(sqlColumnNames(sqlite, "session_leases")).toEqual(
            expect.arrayContaining(["stt_started_mask", "stt_ended_mask", "stt_stream_count"])
        );
        expect(sqlColumnNames(sqlite, "soniox_voice_slots")).toContain("pinned_by_lease");
    });

    it("backfills a pre-0010 lease to one transcription stream, so SUM(stt_stream_count) equals the old COUNT(*)", () => {
        // `stt_stream_count` has to be DEFAULT 0 for the ALTER to be additive,
        // but 0 is never a legitimate live value: a lease row already in the
        // table when the migration runs would count as ZERO transcriptions for
        // the rest of its life, quietly loosening the org ceiling. The backfill
        // statement in 0010 is what makes the new SUM numerically identical to
        // the COUNT(*) it replaces for every row a shipped client ever created.
        const sqlite = new DatabaseSync(":memory:");
        for (const entry of journal().entries) {
            if (entry.tag === "0010_session_leases_role_masks") {
                sqlite.exec(`
                    INSERT INTO session_leases (
                        account_id, lease_id, provider, sku, uses_tts, client_ref_id,
                        issued_at, expires_at, max_duration_s, budget_micro_usd,
                        started_at, reconciled_at, end_signalled_at
                    ) VALUES (
                        'legacy-acct', 'L1', 'soniox', 'soniox:text_only', 0,
                        'sokuji1:legacy-acct:L1', 1000, 76000, 900, 250000, NULL, NULL, NULL
                    )
                `);
            }
            sqlite.exec(loadMigration(`${entry.tag}.sql`));
        }

        const row = sqlite.prepare(
            "SELECT stt_stream_count, stt_started_mask, stt_ended_mask FROM session_leases WHERE account_id = 'legacy-acct'"
        ).get() as any;
        expect(row.stt_stream_count).toBe(1);
        expect(row.stt_started_mask).toBe(0);
        expect(row.stt_ended_mask).toBe(0);
    });

    it("every .sql file has a journal entry and every journal entry has a .sql file", () => {
        const sqlFiles = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith(".sql")).sort();
        const tags = journal().entries.map((e) => `${e.tag}.sql`).sort();
        expect(tags).toEqual(sqlFiles);
    });

    it("every journal entry has a snapshot whose prevId chains to the one before it", () => {
        let prev: string | null = null;
        for (const entry of journal().entries) {
            const file = path.join(DRIZZLE_DIR, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`);
            // A hand-authored migration that skips the snapshot breaks the NEXT
            // `npm run db:generate`, which diffs against the latest snapshot —
            // it would re-emit columns this migration already added.
            expect(existsSync(file), `missing snapshot for ${entry.tag}`).toBe(true);
            const snap = JSON.parse(readFileSync(file, "utf8"));
            if (prev !== null) {
                expect(snap.prevId, `snapshot for ${entry.tag} is not chained`).toBe(prev);
            }
            prev = snap.id;
        }
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/db/migrations.sqlite.test.ts`

Expected: FAIL, 2 of 6 tests, 4 passing:

```
 × drizzle migrations vs the TS schema > migration 0010 adds the split-Both lease columns and the voice-slot lease fence
   → expected [ 'account_id', …(12) ] to deeply equal ArrayContaining{…}
 × drizzle migrations vs the TS schema > backfills a pre-0010 lease to one transcription stream, so SUM(stt_stream_count) equals the old COUNT(*)
   → no such column: stt_stream_count
 Tests  2 failed | 4 passed (6)
```

The four passing ones are the regression guard: schema and SQL agree at 0009 and must still agree at 0010.

- [ ] **Step 3: Declare the three lease columns in the drizzle TS schema**

In `src/db/session.schema.ts`, find this (lines 42-48):

```ts
        /** Set by session-end (a hint, not a transaction — see
         *  `SessionLeaseService.markEndSignalled`). Reset to NULL on every
         *  `acquire()` so a stale flag from a PRIOR session on this same
         *  account_id row never leaks into a fresh lease. Feeds
         *  `unreconciledLeaseQuery` only; never gates `release()`. */
        endSignalledAt: integer("end_signalled_at"),
    },
```

Replace the `endSignalledAt: integer("end_signalled_at"),` line and the `},` after it with:

```ts
        endSignalledAt: integer("end_signalled_at"),
        /** Bitmask of the transcription roles whose stream is confirmed
         *  connected (`spk_stt` = 1, `par_stt` = 2, `mix_stt` = 4; TTS roles get
         *  no bit, because a session may legitimately produce zero TTS logs and
         *  a bit nothing can clear would build a lease that never releases).
         *  Reset to 0 in `acquire`'s ON CONFLICT set list as a LITERAL, never a
         *  bound parameter, for exactly the reason `endSignalledAt` is: the row
         *  is reused (account_id is the PK), so a mask left over from the PRIOR
         *  lease would make a brand-new session look partly finished. */
        sttStartedMask: integer("stt_started_mask").notNull().default(0),
        /** Bitmask of the transcription roles whose Soniox usage log has
         *  arrived — the only un-forgeable proof that a stream is over. Release
         *  fires when `(ended & started) = started AND started != 0`. Reset to 0
         *  in `acquire` as a literal, same reason as `sttStartedMask`. */
        sttEndedMask: integer("stt_ended_mask").notNull().default(0),
        /** How many Soniox transcription streams this lease was issued for: 1
         *  for every session shape a shipped client can request, 2 for split
         *  Both. `countActive` SUMs this instead of counting rows, so a split
         *  session costs the org ceiling what it actually consumes.
         *  DEFAULT 0 is what makes the ALTER TABLE additive, but 0 is never a
         *  legitimate live value — migration 0010 backfills every pre-existing
         *  row to 1 in the same file, so the new SUM is numerically identical to
         *  the COUNT(*) it replaces. */
        sttStreamCount: integer("stt_stream_count").notNull().default(0),
    },
```

- [ ] **Step 4: Declare `pinned_by_lease` on the voice-slot TS schema**

In `src/db/voice-slot.schema.ts`, find this (lines 27-31):

```ts
        /** Protection window. Covers both "being built" and "in a session", so
         *  eviction has one rule instead of two: a row with pinned_until >= now
         *  is never a victim. */
        pinnedUntil: integer("pinned_until").notNull(),
    },
```

Replace the `pinnedUntil` line and the `},` after it with:

```ts
        pinnedUntil: integer("pinned_until").notNull(),
        /** The `lease_id` of the session that pinned this slot, or NULL when the
         *  pin is the pre-lease build window (`prepareManagedVoice` runs before
         *  any lease exists). It exists so the unpin can be FENCED —
         *  `WHERE account_id = ? AND pinned_by_lease = ?` — the same discipline
         *  `reserve`/`finalize` already use: a late unpin from a finished
         *  session must not strip the pin off the session that replaced it. */
        pinnedByLease: text("pinned_by_lease"),
    },
```

`text` is already imported on line 1 of that file (`import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";`) — no import change needed.

- [ ] **Step 5: Hand-author `drizzle/0010_session_leases_role_masks.sql`**

Both scopes go in ONE file so two tasks cannot collide on the same migration index. Create `drizzle/0010_session_leases_role_masks.sql` with exactly:

```sql
ALTER TABLE `session_leases` ADD `stt_started_mask` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_leases` ADD `stt_ended_mask` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_leases` ADD `stt_stream_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `session_leases` SET `stt_stream_count` = 1 WHERE `stt_stream_count` = 0;--> statement-breakpoint
ALTER TABLE `soniox_voice_slots` ADD `pinned_by_lease` text;
```

The `UPDATE` is the reason this file is hand-authored rather than generated: `drizzle-kit generate` emits the three `ALTER`s and nothing else, and `stt_stream_count = 0` on a lease that was live when the migration ran would count as zero transcriptions against the org ceiling for the rest of that lease's life. No primary key is rebuilt, so there is no window in which the deployed Worker and the applied schema disagree.

- [ ] **Step 6: Write the 0010 snapshot and the journal entry**

`drizzle/meta/0010_snapshot.json` must exist and chain from 0009, or the next `npm run db:generate` re-emits these columns. Derive it from 0009 rather than hand-typing 25 KB of JSON. Run:

```bash
cat > /tmp/mk0010.mjs <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
const DIR = "drizzle/meta";
const snap = JSON.parse(readFileSync(`${DIR}/0009_snapshot.json`, "utf8"));
snap.prevId = snap.id;                                        // 23f020f5-ea9e-4c94-8026-796057d39ecf
snap.id = "7c1f4a02-9d3b-4e58-a1c6-0f2b5d8e41aa";             // pinned, so this is reproducible
const int0 = (name) => ({ name, type: "integer", primaryKey: false, notNull: true, autoincrement: false, default: 0 });
const leases = snap.tables.session_leases.columns;
leases.stt_started_mask = int0("stt_started_mask");
leases.stt_ended_mask = int0("stt_ended_mask");
leases.stt_stream_count = int0("stt_stream_count");
snap.tables.soniox_voice_slots.columns.pinned_by_lease =
    { name: "pinned_by_lease", type: "text", primaryKey: false, notNull: false, autoincrement: false };
writeFileSync(`${DIR}/0010_snapshot.json`, JSON.stringify(snap, null, 2) + "\n");
const journal = JSON.parse(readFileSync(`${DIR}/_journal.json`, "utf8"));
// Guarded so re-running the script cannot append a duplicate entry.
if (!journal.entries.some((e) => e.idx === 10)) {
    journal.entries.push({ idx: 10, version: "6", when: 1786400000000, tag: "0010_session_leases_role_masks", breakpoints: true });
    writeFileSync(`${DIR}/_journal.json`, JSON.stringify(journal, null, 2) + "\n");
}
EOF
node /tmp/mk0010.mjs
tail -9 drizzle/meta/_journal.json
```

The journal must now end with:

```json
    {
      "idx": 10,
      "version": "6",
      "when": 1786400000000,
      "tag": "0010_session_leases_role_masks",
      "breakpoints": true
    }
  ]
}
```

- [ ] **Step 7: Run the guard test and watch it pass**

Run: `npx vitest run src/db/migrations.sqlite.test.ts`

Expected: PASS — `Tests  6 passed (6)`

- [ ] **Step 8: Write the failing acquire/countActive tests**

In `src/services/session-lease.sqlite.test.ts`, find this (lines 87-93):

```ts
function makeSqlite() {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(loadMigration("0006_session_leases.sql"));
    sqlite.exec(loadMigration("0007_unique_client_ref.sql"));
    sqlite.exec(loadMigration("0008_session_leases_end_signalled.sql"));
    return sqlite;
}
```

Replace it with:

```ts
/** Every migration that touches a table this file exercises, in journal order.
 *  0009 creates `soniox_voice_slots`, which this file never reads — but 0010
 *  ALTERs BOTH tables in one file (deliberately: two scopes cannot then collide
 *  on the same migration index), so 0009 has to be applied for 0010 to load. */
const MIGRATIONS = [
    "0006_session_leases.sql",
    "0007_unique_client_ref.sql",
    "0008_session_leases_end_signalled.sql",
    "0009_sour_junta.sql",
    "0010_session_leases_role_masks.sql",
];

function makeSqlite() {
    const sqlite = new DatabaseSync(":memory:");
    for (const file of MIGRATIONS) sqlite.exec(loadMigration(file));
    return sqlite;
}
```

Then, in the same file, find the end of the first `acquire` case (lines 137-139):

```ts
            expect(row.started_at).toBeNull();
            expect(row.reconciled_at).toBeNull();
        });
```

Replace it with:

```ts
            expect(row.started_at).toBeNull();
            expect(row.reconciled_at).toBeNull();
            // A shipped client asks for one transcription stream and gets one.
            expect(row.stt_stream_count).toBe(1);
            expect(row.stt_started_mask).toBe(0);
            expect(row.stt_ended_mask).toBe(0);
        });

        it("writes the issued transcription stream count, so a split session costs the org ceiling two", async () => {
            const r = await svc.acquire({ ...base, leaseId: "L1", sttStreamCount: 2, now: 1000 });
            expect(r.ok).toBe(true);
            expect(readRow(sqlite, "acct1").stt_stream_count).toBe(2);
        });

        it("resets BOTH masks on lease reuse, so a prior session's progress never leaks into a fresh one", async () => {
            // The row is REUSED (account_id is the PRIMARY KEY). Without literal
            // `stt_started_mask = 0, stt_ended_mask = 0` in the ON CONFLICT set
            // list, the new lease inherits the old one's ended bits and the
            // reconciler's `(ended & started) = started` predicate fires on a
            // brand-new, still-live session the instant its first leg connects.
            await svc.acquire({ ...base, leaseId: "L1", now: 1000 });
            sqlite.prepare(
                "UPDATE session_leases SET stt_started_mask = 1, stt_ended_mask = 1 WHERE account_id = 'acct1'"
            ).run();
            const expiry = readRow(sqlite, "acct1").expires_at as number;

            const r = await svc.acquire({ ...base, leaseId: "L2", now: expiry });
            expect(r.ok).toBe(true);
            const row = readRow(sqlite, "acct1");
            expect(row.lease_id).toBe("L2");
            expect(row.stt_started_mask).toBe(0);
            expect(row.stt_ended_mask).toBe(0);
        });
```

Finally, still in the same file, find this line inside the `acquire — quota arithmetic against real countActive() SQL` describe block (line 448 today):

```ts
    it("does not count a RELEASED lease toward either ceiling, freeing a slot before its deterministic expiry", async () => {
```

Insert these two cases immediately **before** it:

```ts
    it("counts a split lease as TWO transcriptions, not one row", async () => {
        // A7: `countActive` SUMs the issued stream counts instead of counting
        // rows, because a split Both session opens two Soniox transcription
        // streams against the org's ceiling while occupying one lease row.
        await svc.acquire({
            accountId: "split-acct", leaseId: "L1", provider: "soniox",
            sku: "soniox:text_only", usesTts: false, sttStreamCount: 2,
            maxDurationS: 900, budgetMicroUsd: 250_000, now: 1000,
        });
        expect(await svc.countActive(1000)).toEqual({ stt: 2, tts: 0 });
    });

    it("refuses a split session when only one transcription slot is left", async () => {
        // The single-stream form `counts.stt >= MAX` is not enough here: at 99
        // of 100 it would admit a session that needs two.
        await fillStt(MAX_STT_CONCURRENT - 1, 1000);
        expect(await svc.countActive(1000)).toEqual({ stt: MAX_STT_CONCURRENT - 1, tts: 0 });

        const split = await svc.acquire({
            accountId: "split-acct", leaseId: "L1", provider: "soniox",
            sku: "soniox:text_only", usesTts: false, sttStreamCount: 2,
            maxDurationS: 900, budgetMicroUsd: 250_000, now: 1000,
        });
        expect(split.ok).toBe(false);
        if (!split.ok) expect(split.reason).toBe("stt_full");

        // ...while a single-stream session at that exact moment still fits.
        const single = await svc.acquire({
            accountId: "single-acct", leaseId: "L1", provider: "soniox",
            sku: "soniox:text_only", usesTts: false,
            maxDurationS: 900, budgetMicroUsd: 250_000, now: 1000,
        });
        expect(single.ok).toBe(true);
    });

```

- [ ] **Step 9: Run them and watch them fail**

Run: `npx vitest run src/services/session-lease.sqlite.test.ts`

Expected: FAIL, 5 tests:

```
 × SessionLeaseService against real SQLite > acquire > succeeds on an empty table and every bound value lands in its intended column
   → expected +0 to be 1 // Object.is equality
 × SessionLeaseService against real SQLite > acquire > writes the issued transcription stream count, so a split session costs the org ceiling two
   → expected +0 to be 2 // Object.is equality
 × SessionLeaseService against real SQLite > acquire > resets BOTH masks on lease reuse, so a prior session's progress never leaks into a fresh one
   → expected 1 to be +0 // Object.is equality
 × acquire — quota arithmetic against real countActive() SQL > counts a split lease as TWO transcriptions, not one row
   → expected { stt: 1, tts: +0 } to deeply equal { stt: 2, tts: +0 }
 × acquire — quota arithmetic against real countActive() SQL > refuses a split session when only one transcription slot is left
   → expected true to be false // Object.is equality
 Tests  5 failed | 41 passed (46)
```

- [ ] **Step 10: Add `sttStreamCount` to `AcquireParams` and fix the STT ceiling test**

In `src/services/session-lease.ts`, find this (lines 21-30):

```ts
export interface AcquireParams {
    accountId: string;
    leaseId: string;
    provider: string;
    sku: string;
    usesTts: boolean;
    maxDurationS: number;
    budgetMicroUsd: number;
    now: number;
}
```

Replace the `usesTts: boolean;` line with:

```ts
    usesTts: boolean;
    /**
     * How many Soniox TRANSCRIPTION streams this lease is being issued for.
     *
     * 1 for every session shape a currently-shipped client can request; 2 for
     * split Both, which runs one stream per audio source. Optional and
     * defaulting to 1 so the call site in `routes/soniox.ts` — and every test
     * fixture — keeps compiling and keeps meaning exactly what it meant before.
     *
     * This is NOT a TTS count: `usesTts` stays the TTS weight (one lease can
     * back many successive TTS sockets, so a count would be a lie), and there is
     * deliberately no second TTS column for the two to disagree over.
     */
    sttStreamCount?: number;
```

Then find this (lines 113-116):

```ts
    async acquire(p: AcquireParams): Promise<AcquireResult> {
        const counts = await this.countActive(p.now);
        if (counts.stt >= MAX_STT_CONCURRENT) return { ok: false, reason: "stt_full" };
        if (p.usesTts && counts.tts >= MAX_TTS_CONCURRENT) return { ok: false, reason: "tts_full" };
```

Replace with:

```ts
    async acquire(p: AcquireParams): Promise<AcquireResult> {
        const sttStreamCount = p.sttStreamCount ?? 1;
        const counts = await this.countActive(p.now);
        // Written as "would this request push us OVER the ceiling" rather than
        // "are we already AT it", because a split session needs two slots and
        // must be refused at 99 of 100, not admitted. At sttStreamCount === 1
        // the two forms are the same inequality, so nothing a shipped client can
        // request changes behaviour.
        if (counts.stt + sttStreamCount > MAX_STT_CONCURRENT) return { ok: false, reason: "stt_full" };
        if (p.usesTts && counts.tts >= MAX_TTS_CONCURRENT) return { ok: false, reason: "tts_full" };
```

- [ ] **Step 11: Implement `countActive`'s SUM and `acquire`'s statement**

In `src/services/session-lease.ts`, find this (lines 91-96):

```ts
    async countActive(now: number): Promise<{ stt: number; tts: number }> {
        const row = await this.env.DATABASE.prepare(`
            SELECT COUNT(*) AS stt_active, COALESCE(SUM(uses_tts), 0) AS tts_active
            FROM session_leases
            WHERE expires_at > ? AND reconciled_at IS NULL
        `).bind(now).first();
```

Replace with — note the `WHERE` clause is byte-identical:

```ts
    async countActive(now: number): Promise<{ stt: number; tts: number }> {
        // `stt` sums the ISSUED transcription-stream counts rather than counting
        // rows: one lease row can own two Soniox transcription streams (split
        // Both), and the org ceiling is on STREAMS, not on sessions. For every
        // single-stream lease this is arithmetically identical to the COUNT(*)
        // it replaces — migration 0010 backfills pre-existing rows to 1 so that
        // holds for rows written before the column existed too.
        const row = await this.env.DATABASE.prepare(`
            SELECT COALESCE(SUM(stt_stream_count), 0) AS stt_active, COALESCE(SUM(uses_tts), 0) AS tts_active
            FROM session_leases
            WHERE expires_at > ? AND reconciled_at IS NULL
        `).bind(now).first();
```

Then find the comment and statement in `acquire` (lines 130-162):

```ts
        // end_signalled_at is deliberately NOT a bound parameter -- it is always
        // reset to NULL here, so its value never depends on bind position (see
        // `markEndSignalled`, which is the only thing that ever sets it). Reset
        // is required, not cosmetic: this row is reused (account_id is the PK),
        // so a flag left over from the PRIOR lease would otherwise make a brand
        // new, still-live session look like "work remains" to the reconciler
        // the instant it is issued.
        const res = await this.env.DATABASE.prepare(`
            INSERT INTO session_leases (
                account_id, lease_id, provider, sku, uses_tts, client_ref_id,
                issued_at, expires_at, max_duration_s, budget_micro_usd,
                started_at, reconciled_at, end_signalled_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
            ON CONFLICT(account_id) DO UPDATE SET
                lease_id = excluded.lease_id,
                provider = excluded.provider,
                sku = excluded.sku,
                uses_tts = excluded.uses_tts,
                client_ref_id = excluded.client_ref_id,
                issued_at = excluded.issued_at,
                expires_at = excluded.expires_at,
                max_duration_s = excluded.max_duration_s,
                budget_micro_usd = excluded.budget_micro_usd,
                started_at = NULL,
                reconciled_at = NULL,
                end_signalled_at = NULL
            WHERE session_leases.expires_at <= ? OR session_leases.reconciled_at IS NOT NULL
        `).bind(
            p.accountId, p.leaseId, p.provider, p.sku, p.usesTts ? 1 : 0, clientRefId,
            p.now, initialExpiry, p.maxDurationS, p.budgetMicroUsd,
            p.now
        ).run();
```

Replace it with:

```ts
        // end_signalled_at, stt_started_mask and stt_ended_mask are deliberately
        // NOT bound parameters -- all three are always reset here (to NULL, 0
        // and 0), so their values never depend on bind position (see
        // `markEndSignalled` and `markStarted`, the only things that ever set
        // them). Reset is required, not cosmetic: this row is reused (account_id
        // is the PK), so state left over from the PRIOR lease would otherwise
        // make a brand new, still-live session look like "work remains" to the
        // reconciler the instant it is issued -- and, for the masks, look
        // PARTLY FINISHED, so the release predicate
        // `(ended & started) = started` could fire on a session that has barely
        // begun.
        const res = await this.env.DATABASE.prepare(`
            INSERT INTO session_leases (
                account_id, lease_id, provider, sku, uses_tts, client_ref_id,
                issued_at, expires_at, max_duration_s, budget_micro_usd,
                stt_stream_count,
                started_at, reconciled_at, end_signalled_at,
                stt_started_mask, stt_ended_mask
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0)
            ON CONFLICT(account_id) DO UPDATE SET
                lease_id = excluded.lease_id,
                provider = excluded.provider,
                sku = excluded.sku,
                uses_tts = excluded.uses_tts,
                client_ref_id = excluded.client_ref_id,
                issued_at = excluded.issued_at,
                expires_at = excluded.expires_at,
                max_duration_s = excluded.max_duration_s,
                budget_micro_usd = excluded.budget_micro_usd,
                stt_stream_count = excluded.stt_stream_count,
                started_at = NULL,
                reconciled_at = NULL,
                end_signalled_at = NULL,
                stt_started_mask = 0,
                stt_ended_mask = 0
            WHERE session_leases.expires_at <= ? OR session_leases.reconciled_at IS NOT NULL
        `).bind(
            p.accountId, p.leaseId, p.provider, p.sku, p.usesTts ? 1 : 0, clientRefId,
            p.now, initialExpiry, p.maxDurationS, p.budgetMicroUsd, sttStreamCount,
            p.now
        ).run();
```

- [ ] **Step 12: Repair the positional fake D1 in `session-lease.test.ts`**

This is the second landmine: that file's fake D1 keys the `countActive` branch on the literal string `COUNT(*)` and destructures `acquire`'s binds **by position**. Both just broke. Run `npx vitest run src/services/session-lease.test.ts` first to see it:

```
 × acquire > replaces a lease that has expired
   → expected false to be true // Object.is equality
 × acquire > refuses when the STT concurrency ceiling is reached
   → expected true to be false // Object.is equality
 × acquire > refuses a speech-to-speech session at the TTS ceiling while text-only still fits
   → expected true to be false // Object.is equality
 Tests  3 failed | 27 passed (30)
```

Fix one: find line 16:

```ts
                    if (sql.includes("COUNT(*)")) return { stt_active: counts.stt, tts_active: counts.tts };
```

Replace with:

```ts
                    // Keyed on the OUTPUT alias, not on the aggregate function:
                    // `countActive` moved from COUNT(*) to SUM(stt_stream_count)
                    // and a branch keyed on "COUNT(*)" silently stopped matching,
                    // handing every ceiling test `{stt: 0, tts: 0}`.
                    if (sql.includes("stt_active")) return { stt_active: counts.stt, tts_active: counts.tts };
```

Fix two: find lines 27-28:

```ts
                        const [accountId, leaseId, provider, sku, usesTts, clientRefId,
                               issuedAt, expiresAt, maxDurationS, budgetMicroUsd, now] = this._binds;
```

Replace with:

```ts
                        // POSITIONAL, matching acquire's bind array exactly.
                        // `sttStreamCount` was appended after budgetMicroUsd and
                        // BEFORE the trailing `now` that feeds the ON CONFLICT
                        // WHERE clause — inserting a bind anywhere else silently
                        // shifts every field after it.
                        const [accountId, leaseId, provider, sku, usesTts, clientRefId,
                               issuedAt, expiresAt, maxDurationS, budgetMicroUsd,
                               sttStreamCount, now] = this._binds;
```

Fix three: find lines 38-39 (inside the same branch's store write):

```ts
                            max_duration_s: maxDurationS, budget_micro_usd: budgetMicroUsd,
                            started_at: null, reconciled_at: null,
                        };
```

Replace with:

```ts
                            max_duration_s: maxDurationS, budget_micro_usd: budgetMicroUsd,
                            stt_stream_count: sttStreamCount,
                            started_at: null, reconciled_at: null,
                            // Literals in the real statement's SET list, so the
                            // fake models the reset rather than the carry-over.
                            stt_started_mask: 0, stt_ended_mask: 0,
                        };
```

- [ ] **Step 13: Point `voice-slot.sqlite.test.ts`'s harness at the full migration list**

That file builds its in-memory database from 0009 alone, so it never sees `pinned_by_lease`. Find this (lines 46-51):

```ts
/** Strip drizzle-kit's `--> statement-breakpoint` markers (not valid SQL —
 *  drizzle's own migrator strips these before executing) and hand the rest
 *  to sqlite3_exec, which accepts multiple `;`-separated statements. */
function loadMigration(file: string): string {
    return readFileSync(path.join(DRIZZLE_DIR, file), "utf8").replace(/--> statement-breakpoint/g, "");
}
```

Append immediately after it:

```ts

/** Every migration needed to build `soniox_voice_slots`, in journal order.
 *  0010 ALTERs BOTH `session_leases` and `soniox_voice_slots` in one file
 *  (deliberately: two scopes cannot then collide on the same migration index),
 *  so the lease table's own migrations have to be applied here even though this
 *  file never reads it. */
const MIGRATIONS = [
    "0006_session_leases.sql",
    "0007_unique_client_ref.sql",
    "0008_session_leases_end_signalled.sql",
    "0009_sour_junta.sql",
    "0010_session_leases_role_masks.sql",
];
```

Then replace **both** occurrences of this line (one at line 86 inside `harness()`, one at line 215 inside the competing-insert test):

```ts
    sqlite.exec(loadMigration("0009_sour_junta.sql"));
```

with:

```ts
    for (const file of MIGRATIONS) sqlite.exec(loadMigration(file));
```

Leave `src/services/soniox-reconcile.sqlite.test.ts` alone — its `MIGRATIONS` list is 0000-0005 and it never creates `session_leases`, so 0010 does not apply to it.

- [ ] **Step 14: Correct `MAX_STT_CONCURRENT`'s docstring**

In `src/config/soniox.ts`, find this (lines 52-53):

```ts
/** Soniox org quota: concurrent realtime transcriptions. */
export const MAX_STT_CONCURRENT = 100;
```

Replace with:

```ts
/** Soniox org quota: concurrent realtime transcription STREAMS — not sessions,
 *  and not leases. One lease is one stream for every session shape except split
 *  Both, which opens one stream per audio source and therefore consumes two.
 *  `SessionLeaseService.countActive` sums each lease's issued
 *  `stt_stream_count` for exactly this reason; universal split adoption would
 *  halve the number of concurrent managed users this number allows. */
export const MAX_STT_CONCURRENT = 100;
```

- [ ] **Step 15: Run the whole suite and the typechecker, and watch them pass**

Run:

```bash
npx vitest run
npx tsc --noEmit
```

Expected: `Test Files  53 passed (53)` / `Tests  586 passed (586)`, and `tsc --noEmit` exits 0 with no output.

If you also want the migration applied to your local D1: `npm run db:migrate:dev`. Production applies it in `.github/workflows/deploy.yml` via `wrangler d1 migrations apply DATABASE --remote`, **before** `wrangler deploy`.

- [ ] **Step 16: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add drizzle/0010_session_leases_role_masks.sql \
        drizzle/meta/0010_snapshot.json \
        drizzle/meta/_journal.json \
        src/db/migrations.sqlite.test.ts \
        src/db/session.schema.ts \
        src/db/voice-slot.schema.ts \
        src/config/soniox.ts \
        src/services/session-lease.ts \
        src/services/session-lease.test.ts \
        src/services/session-lease.sqlite.test.ts \
        src/services/voice-slot.sqlite.test.ts
git commit -m "$(cat <<'EOF'
feat(soniox): count transcription streams, not leases, against the org ceiling

Migration 0010 adds session_leases.stt_started_mask / stt_ended_mask /
stt_stream_count and soniox_voice_slots.pinned_by_lease in one file, so the
lease-lifecycle and voice-pin scopes cannot collide on the same index. All
three lease columns are INTEGER NOT NULL DEFAULT 0; the same file backfills
stt_stream_count to 1 for every pre-existing row, so countActive's new
SUM(stt_stream_count) is numerically identical to the COUNT(*) it replaces for
every session shape a shipped client can request.

acquire writes stt_stream_count (AcquireParams.sttStreamCount, optional,
default 1) and resets both masks to 0 as LITERALS in the ON CONFLICT set list,
for the same reason end_signalled_at already does: the row is reused, and an
inherited ended-mask would make a brand-new session look partly finished.

Adds src/db/migrations.sqlite.test.ts, which executes every migration in
journal order and diffs the result against the drizzle TS schema — the one
thing that catches a schema column with no matching .sql, which passes the
whole suite and then throws `no such column` in production.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task BE4: Decouple lease release from charging in the reconciler sweep, and make release report changed rows

**Repo for this whole task:** `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend`. Every path below is relative to it, and every command runs from it. The two `*.sqlite.test.ts` files throw at load time on Node < 22 (they deliberately do not skip), so run `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use` first — `.nvmrc` pins 24.

**Files:**
- Modify: `src/services/session-lease.ts` (lines 243–249, `release`)
- Modify: `src/services/soniox-reconcile.ts` (line 3 import; new `ownedAccountId` after line 41; lines 235–248 `SweepSummary`; line 261 `SweepPorts.releaseLease`; lines 354–382 counters/summary; lines 398–494 the per-log loop)
- Modify: `src/durable-objects/SonioxReconcilerDO.ts` — **no edit required.** Line 141 is `releaseLease: (clientRefId, now) => leaseService.release(clientRefId, now)`; once `release` returns `Promise<number>` that arrow satisfies the widened port type by inference. Do not touch the file; `npx tsc --noEmit` in Step 13 is the proof.
- Test: `src/services/session-lease.test.ts` (append after line 310)
- Test: `src/services/session-lease.sqlite.test.ts` (insert before line 333)
- Test: `src/services/soniox-reconcile.test.ts` (import at lines 9–11; `HarnessOpts` at lines 163–190; the `releaseLease` stub at lines 230–233; append two describes after line 941)
- Test: `src/services/soniox-reconcile.sqlite.test.ts` (lines 166–168, the `releaseLease` stub)

**Interfaces:**
- Consumes (from BE2, exported by `src/services/session-lease.ts`): `isOurClientRef(ref: string | null): boolean` — the prefix-only ownership predicate; true for BOTH `sokuji1:<acct>:<lease>` and `sokuji1:<acct>:<lease>:<role>`, false for anything without the `sokuji1` prefix.
- Consumes (already imported at `src/services/soniox-reconcile.ts:3`): `parseClientRefId(ref: string | null)` — the BILLING parser, which after BE2 returns `null` for a three-segment reference.
- Produces:
  - `SessionLeaseService.release(clientRefId: string, now: number): Promise<number>` — rows changed.
  - `SweepPorts.releaseLease(clientRefId: string, now: number): Promise<number>`
  - `ownedAccountId(ref: string | null): string | null`, exported from `src/services/soniox-reconcile.ts`
  - `SweepSummary.leaseNotFound: number`
  - `HarnessOpts.releaseChanges?: number` in `src/services/soniox-reconcile.test.ts`

---

- [ ] **Step 1: Write the failing test for `release` reporting changed rows (fake D1)**

Append to the end of `src/services/session-lease.test.ts` (the file currently ends at line 310 with a `});` closing the `getExpiresAt` describe):

```ts

describe("release", () => {
    // The reconciler is the only caller that reads this number, and it needs it:
    // a usage log that releases NO row while its session should still be live is
    // the one signal that an account is 409-locked with a ghost lease still
    // counting against MAX_STT_CONCURRENT / MAX_TTS_CONCURRENT. A `void` return
    // makes that state invisible.
    it("reports the number of lease rows it changed", async () => {
        const { env } = makeEnv();
        const svc = new SessionLeaseService(env);
        await svc.acquire({ ...base, leaseId: "L1", now: 1000 });
        expect(await svc.release("sokuji1:acct1:L1", 1500)).toBe(1);
    });

    it("reports 0 for a reference no lease carries any more", async () => {
        // Routine, not exceptional: account_id is this table's PRIMARY KEY, so
        // the account's next session REUSES the row with a new client_ref_id and
        // the previous reference simply stops existing.
        const { env } = makeEnv();
        const svc = new SessionLeaseService(env);
        await svc.acquire({ ...base, leaseId: "L1", now: 1000 });
        expect(await svc.release("sokuji1:acct1:L-GONE", 1500)).toBe(0);
    });
});
```

Then, in `src/services/session-lease.sqlite.test.ts`, insert the block below immediately BEFORE this existing anchor at line 333:

```ts
    describe("client_ref_id UNIQUE index", () => {
```

The block to insert (same 4-space nesting as its siblings):

```ts
    describe("release", () => {
        // The fake-D1 sibling asserts this by bind position; this executes the
        // REAL UPDATE text, so a changed WHERE clause that silently matches
        // nothing (or matches everything) is caught here rather than in prod.
        it("reports 1 for a live lease and 0 for a reference that is gone", async () => {
            await svc.acquire({ ...base, leaseId: "L1", now: 1000 });
            expect(await svc.release("sokuji1:acct1:L-GONE", 1500)).toBe(0);
            expect(readRow(sqlite, "acct1").reconciled_at).toBeNull();

            expect(await svc.release("sokuji1:acct1:L1", 1500)).toBe(1);
            expect(readRow(sqlite, "acct1").reconciled_at).toBe(1500);
        });
    });

```

- [ ] **Step 2: Run them and watch them fail**

Run:
```
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts src/services/session-lease.sqlite.test.ts
```
Expected: FAIL, three tests, each `AssertionError: expected undefined to be 1` / `expected undefined to be 0` — `release` currently returns `Promise<void>`, so `await svc.release(...)` is `undefined`.

- [ ] **Step 3: Implement — `release` returns changed rows, and the port type widens with it**

Edit 1 of 4 — `src/services/session-lease.ts`, replace lines 243–249 verbatim:

```ts
    /** Mark a lease reconciled, freeing the account immediately rather than
     *  waiting for its (already short) expiry. */
    async release(clientRefId: string, now: number): Promise<void> {
        await this.env.DATABASE.prepare(
            "UPDATE session_leases SET reconciled_at = ? WHERE client_ref_id = ?"
        ).bind(now, clientRefId).run();
    }
```

with:

```ts
    /**
     * Mark a lease reconciled, freeing the account immediately rather than
     * waiting for its (already short) expiry.
     *
     * Returns the number of rows changed. 0 means no lease carries this
     * reference any more, which is ROUTINE for an old log — `account_id` is
     * this table's PRIMARY KEY, so the account's next session reuses the row
     * with a new `client_ref_id` and the previous reference stops existing —
     * and an ALARM for a young one, where it means a live session's
     * proof-of-end landed with nothing to release. `runSweep` is the only
     * caller that reads it, and it is the only thing that can tell those two
     * cases apart, because it is the only caller that knows the log's age.
     */
    async release(clientRefId: string, now: number): Promise<number> {
        const res = await this.env.DATABASE.prepare(
            "UPDATE session_leases SET reconciled_at = ? WHERE client_ref_id = ?"
        ).bind(now, clientRefId).run();
        return res.meta?.changes ?? 0;
    }
```

Edit 2 of 4 — `src/services/soniox-reconcile.ts`, replace line 261 verbatim:

```ts
    releaseLease(clientRefId: string, now: number): Promise<void>;
```

with:

```ts
    /** Mark the lease reconciled. Returns the number of lease rows changed:
     *  0 when no live lease carries this reference. The sweep needs the count,
     *  not a `void` — an `stt` log that releases nothing while its session
     *  should still be live is the only signal that an account is 409-locked
     *  behind a ghost lease, and it is invisible without it. */
    releaseLease(clientRefId: string, now: number): Promise<number>;
```

Edit 3 of 4 — `src/services/soniox-reconcile.test.ts`, replace lines 230–233 verbatim:

```ts
        async releaseLease(clientRefId) {
            if (opts.releaseThrows) throw new Error("D1_ERROR: release failed");
            released.push(clientRefId);
        },
```

with:

```ts
        async releaseLease(clientRefId) {
            if (opts.releaseThrows) throw new Error("D1_ERROR: release failed");
            released.push(clientRefId);
            // Rows the UPDATE changed. Defaults to 1 — the ordinary case, where
            // a live lease carried this reference. A test wanting the "no lease
            // matched" branch sets `releaseChanges: 0`; that number is the only
            // way the sweep can learn the state, so it is the only way a test
            // can drive the alarm.
            return opts.releaseChanges ?? 1;
        },
```

and in the same file add this option to `HarnessOpts`, immediately after the existing `releaseThrows?: boolean;` line (line 172):

```ts
    /** Rows `releaseLease` reports it changed. 0 models "no live lease carries
     *  this reference any more" — the state the missing-lease alarm exists to
     *  surface. */
    releaseChanges?: number;
```

Edit 4 of 4 — `src/services/soniox-reconcile.sqlite.test.ts`, replace lines 166–168 verbatim:

```ts
        async releaseLease(clientRefId) {
            released.push(clientRefId);
        },
```

with:

```ts
        async releaseLease(clientRefId) {
            released.push(clientRefId);
            // Lease storage is stubbed wholesale in this file (see the harness
            // docstring — only the money path runs against real SQL), so this
            // reports the ordinary "one live lease released" answer. The
            // 0-rows branch is covered in soniox-reconcile.test.ts.
            return 1;
        },
```

- [ ] **Step 4: Run them and watch them pass**

Run:
```
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts src/services/session-lease.sqlite.test.ts src/services/soniox-reconcile.test.ts src/services/soniox-reconcile.sqlite.test.ts
```
Expected: PASS, all four files.

- [ ] **Step 5: Write the failing tests for release decoupled from charging**

First extend the config import in `src/services/soniox-reconcile.test.ts`, replacing lines 9–11 verbatim:

```ts
import {
    VOICE_BUILD_PIN_MS, SONIOX_VOICE_QUOTA, MANAGED_VOICE_NAME_PREFIX,
} from "../config/soniox";
```

with:

```ts
import {
    VOICE_BUILD_PIN_MS, SONIOX_VOICE_QUOTA, MANAGED_VOICE_NAME_PREFIX,
    UNRECONCILED_LEASE_MAX_AGE_MS,
} from "../config/soniox";
```

Then append to the end of the same file (it currently ends at line 941 with `});`):

```ts

// ---------------------------------------------------------------------------
// Release decoupled from charging (design A4)
// ---------------------------------------------------------------------------

describe("runSweep — a log we own releases its lease even when it produces no charge", () => {
    // Decision 5 accepts losing the REVENUE of sessions that were live when the
    // four-segment reference format deployed: their three-segment references are
    // rejected by `parseClientRefId`, so `buildCharge` returns null. It does NOT
    // accept losing those accounts. Without this decoupling `reconciled_at` stays
    // null with `expires_at` up to an hour out, so the account 409s on every Start
    // for that hour AND its ghost lease keeps counting against MAX_STT_CONCURRENT
    // / MAX_TTS_CONCURRENT. At 25 TTS leases, a handful of stranded sessions takes
    // managed speech-to-speech down for the whole organization.
    //
    // Every reference here is written out in full rather than taken from
    // BASE_LOG, so these tests say what they mean whichever format that fixture
    // carries.

    const LEGACY_REF = "sokuji1:acct1:L1"; // three segments: ours, not billable

    it("releases and unpins a legacy three-segment stt log that is never charged", async () => {
        const h = makeHarness({
            pages: [{ logs: [makeLog({
                uuid: "u-legacy", client_reference_id: LEGACY_REF, model: "stt-rt-v5",
            })] }],
        });

        const summary = await runSweep(h.ports);

        expect(h.charges).toEqual([]);            // decision 5: the revenue is gone
        expect(summary.charged).toBe(0);
        expect(h.released).toEqual([LEGACY_REF]); // A4: the lease is NOT
        expect(summary.releasedLeases).toBe(1);
        expect(h.unpinnedVoiceSlots).toEqual([{ accountId: "acct1", now: NOW }]);
        expect(summary.processed).toBe(1);
    });

    it("takes the account id from the reference, not from the charge", async () => {
        // `charge.subjectId` is a null dereference the moment a log can release
        // without charging, and that expression sits OUTSIDE the unpin's own
        // try/catch — it would abort the ENTIRE sweep, losing every later log's
        // billing, on exactly the class of log this change exists to serve.
        const h = makeHarness({
            pages: [{ logs: [makeLog({
                uuid: "u-legacy", client_reference_id: "sokuji1:acct-xyz:L9", model: "stt-rt-v5",
            })] }],
        });

        const summary = await runSweep(h.ports);

        expect(h.unpinnedVoiceSlots).toEqual([{ accountId: "acct-xyz", now: NOW }]);
        expect(summary.processed).toBe(1);
    });

    it("still refuses another customer's reference entirely", async () => {
        // The gate widens from "billable" to "ours". It must not widen to
        // "anything": the org's log stream carries BYOK customers' sessions, and
        // releasing on one of those would free a live lease of ours at random.
        const h = makeHarness({
            pages: [{ logs: [
                makeLog({ uuid: "u-byok", client_reference_id: "team-7:call-91",
                          model: "stt-rt-v5", end_time: "2026-07-25T11:10:00.000Z" }),
                makeLog({ uuid: "u-none", client_reference_id: null,
                          model: "stt-rt-v5", end_time: "2026-07-25T11:11:00.000Z" }),
                makeLog({ uuid: "u-v2", client_reference_id: "sokuji2:acct1:L1:spk_stt",
                          model: "stt-rt-v5", end_time: "2026-07-25T11:12:00.000Z" }),
            ] }],
        });

        const summary = await runSweep(h.ports);

        expect(h.released).toEqual([]);
        expect(h.unpinnedVoiceSlots).toEqual([]);
        expect(h.charges).toEqual([]);
        expect(summary.processed).toBe(3);
    });

    it("still does not release on a tts log we own but cannot charge", async () => {
        // A TTS socket reconnects mid-session, so a tts- log can arrive while the
        // session is still live. Decoupling release from CHARGING must not
        // decouple it from the stt- proof-of-end.
        const h = makeHarness({
            pages: [{ logs: [makeLog({
                uuid: "u-legacy-tts", client_reference_id: LEGACY_REF, model: "tts-rt-v1",
            })] }],
        });

        await runSweep(h.ports);

        expect(h.released).toEqual([]);
        expect(h.unpinnedVoiceSlots).toEqual([]);
    });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run:
```
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/soniox-reconcile.test.ts -t "releases its lease even when it produces no charge"
```
Expected: FAIL — the first two tests fail with `AssertionError: expected [] to deeply equal [ 'sokuji1:acct1:L1' ]` (and the account-id test with `expected [] to deeply equal [ { accountId: 'acct-xyz', now: … } ]`), because `runSweep` still hits `if (!charge) { advanceTo(log.end_time); continue; }` at line 412 and never reaches the release block. The other two tests pass already.

- [ ] **Step 7: Implement — widen the gate to ownership and let a chargeless log through**

Edit 1 of 5 — `src/services/soniox-reconcile.ts`, replace line 3 verbatim:

```ts
import { parseClientRefId } from "./session-lease";
```

with:

```ts
import { parseClientRefId, isOurClientRef } from "./session-lease";
```

Edit 2 of 5 — in the same file, insert this function immediately after the closing brace of `classifyLog` (line 41) and before the `buildCharge` docstring:

```ts

/**
 * The account a log belongs to, for a reference we own — or `null` when the
 * reference is not ours at all.
 *
 * Deliberately NOT `parseClientRefId(ref)?.accountId`. That function is the
 * BILLING parser: it rejects the legacy three-segment form, and the whole point
 * of A4 is that a three-segment log still releases its lease and unpins its
 * voice slot. Ownership is decided by `isOurClientRef` — the single prefix
 * predicate, so there is still exactly one answer to "is this ours" — and the
 * account id is then positional, which is safe because both shapes are
 * `sokuji1:<accountId>:…` and `clientRefIdFor` refuses a colon inside any part.
 *
 * Collapsing this back into the billing parser is the failure A4 exists to
 * prevent, and it is SILENT: a rejected reference is indistinguishable from a
 * BYOK customer's traffic in the org's shared usage-log stream.
 */
export function ownedAccountId(ref: string | null): string | null {
    if (!ref || !isOurClientRef(ref)) return null;
    const accountId = ref.split(":")[1];
    return accountId ? accountId : null;
}
```

Edit 3 of 5 — replace lines 400–408 verbatim:

```ts
                // Not ours: the org's usage-log stream also carries BYOK
                // users' traffic and our own manual testing. Nothing to do
                // with it, so it counts as fully processed.
                const clientRefId = log.client_reference_id;
                if (!clientRefId || !parseClientRefId(clientRefId)) {
                    advanceTo(log.end_time);
                    continue;
                }
```

with:

```ts
                // Not ours: the org's usage-log stream also carries BYOK
                // users' traffic and our own manual testing. Nothing to do
                // with it, so it counts as fully processed.
                //
                // The gate is OWNERSHIP, not billability. `ownedAccountId`
                // rests on the prefix-only `isOurClientRef`, which accepts the
                // legacy three-segment reference as well as the four-segment
                // one; `parseClientRefId` (still used by `buildCharge` below)
                // rejects three segments because it answers "can I bill this?".
                // Gating HERE on the billing parser would strand every session
                // that was live when the four-segment format deployed:
                // `reconciled_at` stays null with `expires_at` up to an hour
                // out, so the account 409s on every Start for that hour AND its
                // ghost lease keeps counting against MAX_STT_CONCURRENT /
                // MAX_TTS_CONCURRENT. Losing those sessions' revenue is an
                // accepted cost; losing the account is not.
                const clientRefId = log.client_reference_id;
                const accountId = ownedAccountId(clientRefId);
                if (!clientRefId || accountId == null) {
                    advanceTo(log.end_time);
                    continue;
                }
```

Edit 4 of 5 — replace lines 410–415 verbatim:

```ts
                const leaseSku = await ports.findLeaseSku(clientRefId);
                const charge = buildCharge(log, leaseSku);
                if (!charge) { // buildCharge agrees this log isn't ours.
                    advanceTo(log.end_time);
                    continue;
                }
```

with:

```ts
                const leaseSku = await ports.findLeaseSku(clientRefId);
                // `null` means this log is OURS but NOT BILLABLE — today that is
                // a legacy three-segment reference, which `parseClientRefId`
                // refuses. It suppresses the charge and nothing else: the
                // release and unpin below still run. There is deliberately no
                // `continue` here any more; putting one back re-couples release
                // to charging and reintroduces the stranded-lease failure.
                const charge = buildCharge(log, leaseSku);
```

Edit 5 of 5 — replace lines 417–491 verbatim (the classify/alarm block, the charge block and the release block, in one contiguous region):

```ts
                const kind = classifyLog(log);
                if (kind === "other") {
                    unknownModels++;
                    if (!unknownModelReported) {
                        unknownModelReported = true;
                        console.error(
                            `SONIOX RECONCILER ALARM: unrecognised Soniox model "${log.model}" ` +
                            `(log ${log.uuid}, sessionRef=${charge.sessionRef}). Only "stt-" and ` +
                            `"tts-" prefixes are understood; anything else bills the user ZERO at ` +
                            `full provider cost and never releases its lease. If Soniox renamed a ` +
                            `model prefix, EVERY session is now in this state.`
                        );
                    }
                }

                const result = await ports.charge(charge);
                if (!result.success) {
                    if (!isTerminalChargeError(result.error)) {
                        // Retryable: throw so the watermark holds HERE (at the
                        // previous log) and the next sweep re-covers this one.
                        console.error(
                            `SonioxReconcilerDO.sweep: charge failed for log ${log.uuid} ` +
                            `(sessionRef=${charge.sessionRef}): ${result.error}`
                        );
                        throw new Error(
                            `Soniox reconcile: charge failed for log ${log.uuid}: ${result.error ?? "unknown error"}`
                        );
                    }
                    // Terminal: this charge will never succeed, so retrying it
                    // forever would only stop every OTHER account being billed.
                    // Write it off loudly and keep going.
                    terminalFailures++;
                    console.error(
                        `SONIOX RECONCILER: unbillable usage written off — log ${log.uuid}, ` +
                        `account ${charge.subjectId}, sessionRef=${charge.sessionRef}, ` +
                        `model ${log.model}, cost ${charge.providerCostMicroUsd}µUSD: ${result.error}`
                    );
                } else {
                    charged++;
                }

                // Only an STT log releases the lease -- a usage log appears
                // only after its session ends, and the TTS stream cannot
                // outlive the STT stream of the same session, so STT is the
                // one proof that the session is over.
                //
                // Deliberately NOT extended to 'tts' or 'other': a TTS socket
                // reconnects mid-session (the server drops an idle TTS stream
                // after ~11s), so a TTS log can arrive while the session is
                // still running. Releasing on it would free a LIVE lease and
                // let one balance fund two concurrent sessions. An
                // unrecognised prefix costs at most one lease expiry window,
                // which the alarm above surfaces long before it matters.
                if (kind === "stt") {
                    await ports.releaseLease(clientRefId, sweepStartedAt);
                    releasedLeases++;

                    // Same proof, same account -- ride the lease release to
                    // also free the voice-slot pin a live session installed.
                    // Guarded separately from releaseLease: this is cache
                    // maintenance on top of billing work that has ALREADY
                    // happened (the charge above already landed), so it must
                    // never be able to abort a sweep that is otherwise done.
                    // A slot that misses its unpin here just rides out its
                    // pin's TTL, same as an unreleased lease rides out its
                    // own -- degrade, don't fail.
                    try {
                        await ports.unpinVoiceSlot(charge.subjectId, sweepStartedAt);
                    } catch (err) {
                        console.error(
                            `SonioxReconcilerDO.sweep: voice-slot unpin failed for account ` +
                            `${charge.subjectId} (log ${log.uuid}): ${err}`
                        );
                    }
                }
```

with:

```ts
                const kind = classifyLog(log);
                if (kind === "other") {
                    unknownModels++;
                    if (!unknownModelReported) {
                        unknownModelReported = true;
                        // Named by REFERENCE, not by `charge.sessionRef`: a log
                        // can reach here with no charge at all now.
                        console.error(
                            `SONIOX RECONCILER ALARM: unrecognised Soniox model "${log.model}" ` +
                            `(log ${log.uuid}, ref=${clientRefId}). Only "stt-" and ` +
                            `"tts-" prefixes are understood; anything else bills the user ZERO at ` +
                            `full provider cost and never releases its lease. If Soniox renamed a ` +
                            `model prefix, EVERY session is now in this state.`
                        );
                    }
                }

                // Charging is now OPTIONAL for a log we own. Everything inside
                // this block is skipped when `buildCharge` declined, and the
                // lease work below still happens either way.
                if (charge) {
                    const result = await ports.charge(charge);
                    if (!result.success) {
                        if (!isTerminalChargeError(result.error)) {
                            // Retryable: throw so the watermark holds HERE (at the
                            // previous log) and the next sweep re-covers this one.
                            console.error(
                                `SonioxReconcilerDO.sweep: charge failed for log ${log.uuid} ` +
                                `(sessionRef=${charge.sessionRef}): ${result.error}`
                            );
                            throw new Error(
                                `Soniox reconcile: charge failed for log ${log.uuid}: ${result.error ?? "unknown error"}`
                            );
                        }
                        // Terminal: this charge will never succeed, so retrying it
                        // forever would only stop every OTHER account being billed.
                        // Write it off loudly and keep going.
                        terminalFailures++;
                        console.error(
                            `SONIOX RECONCILER: unbillable usage written off — log ${log.uuid}, ` +
                            `account ${charge.subjectId}, sessionRef=${charge.sessionRef}, ` +
                            `model ${log.model}, cost ${charge.providerCostMicroUsd}µUSD: ${result.error}`
                        );
                    } else {
                        charged++;
                    }
                }

                // Only an STT log releases the lease -- a usage log appears
                // only after its session ends, and the TTS stream cannot
                // outlive the STT stream of the same session, so STT is the
                // one proof that the session is over.
                //
                // Deliberately NOT extended to 'tts' or 'other': a TTS socket
                // reconnects mid-session (the server drops an idle TTS stream
                // after ~11s), so a TTS log can arrive while the session is
                // still running. Releasing on it would free a LIVE lease and
                // let one balance fund two concurrent sessions. An
                // unrecognised prefix costs at most one lease expiry window,
                // which the alarm above surfaces long before it matters.
                //
                // This block is reached whether or not the log was charged.
                // That is A4: decision 5 accepts losing a legacy log's revenue,
                // never its account's lease.
                if (kind === "stt") {
                    const changed = await ports.releaseLease(clientRefId, sweepStartedAt);
                    if (changed > 0) {
                        releasedLeases++;
                    }

                    // Same proof, same account -- ride the lease release to
                    // also free the voice-slot pin a live session installed.
                    //
                    // The account comes from the REFERENCE (`accountId`), never
                    // from `charge.subjectId`: `charge` can be null here now,
                    // and that dereference would sit OUTSIDE the try/catch
                    // below, aborting the whole sweep -- and every later log's
                    // billing with it -- on exactly the legacy log this block
                    // exists to serve.
                    //
                    // Guarded separately from releaseLease: this is cache
                    // maintenance riding on work that has already happened, so
                    // it must never be able to abort a sweep that is otherwise
                    // done. A slot that misses its unpin here just rides out
                    // its pin's TTL, same as an unreleased lease rides out its
                    // own -- degrade, don't fail.
                    try {
                        await ports.unpinVoiceSlot(accountId, sweepStartedAt);
                    } catch (err) {
                        console.error(
                            `SonioxReconcilerDO.sweep: voice-slot unpin failed for account ` +
                            `${accountId} (log ${log.uuid}): ${err}`
                        );
                    }
                }
```

Finally, document the changed meaning of the counter — in the same file replace this line inside `SweepSummary` (line 238):

```ts
    releasedLeases: number;
```

with:

```ts
    /** Leases this sweep actually RELEASED — counted from the rows `release`
     *  reports it changed, not from the number of `stt` logs seen. The two stop
     *  being the same number once a session can open more than one
     *  transcription stream: a split Both session emits two `stt` logs against
     *  one lease, and only the log that completes the lease's predicate
     *  releases it. */
    releasedLeases: number;
```

- [ ] **Step 8: Run them and watch them pass**

Run:
```
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/soniox-reconcile.test.ts
```
Expected: PASS, whole file — the four new tests plus every pre-existing one (`still releases the lease of a session whose charge was written off`, `releases once, on the STT log`, `neither charges nor releases against another customer's reference`, `a voice-slot unpin failure must not fail the sweep`).

- [ ] **Step 9: Write the failing tests for the missing-lease alarm**

Append to the end of `src/services/soniox-reconcile.test.ts`:

```ts

describe("runSweep — an stt log that releases nothing is an alarm, not a silent skip", () => {
    // `release` reporting 0 rows means no `session_leases` row carries this
    // reference. For an OLD log that is routine: account_id is the lease table's
    // PRIMARY KEY, so the row is reused by the account's next session and the
    // old reference simply stops existing. For a YOUNG one it means a live
    // session's proof-of-end arrived with nothing to release — that account
    // cannot start a session until its lease expires, and the ghost lease keeps
    // counting against the org's concurrency ceilings. Age is the only thing
    // separating the two, and the log's own end_time is the only clock left,
    // because the lease is gone by definition.

    it("names the log and the reference when a young log matches no lease", async () => {
        const errors = captureErrors();
        const h = makeHarness({
            releaseChanges: 0,
            pages: [{ logs: [makeLog({
                uuid: "u-orphan",
                client_reference_id: "sokuji1:acct1:L1:spk_stt",
                model: "stt-rt-v5",
                // One minute before the sweep clock: well inside the window.
                end_time: new Date(NOW - 60_000).toISOString(),
            })] }],
        });

        const summary = await runSweep(h.ports);

        expect(summary.releasedLeases).toBe(0);
        expect(summary.leaseNotFound).toBe(1);
        const written = errors.mock.calls.map((c) => String(c[0])).join("\n");
        expect(written).toContain("u-orphan");
        expect(written).toContain("sokuji1:acct1:L1:spk_stt");
    });

    it("stays silent for a log older than UNRECONCILED_LEASE_MAX_AGE_MS", async () => {
        // Every account that starts a second session makes its first session's
        // reference unmatched forever. Without the age gate the alarm would fire
        // on ordinary, healthy traffic and mean nothing.
        const errors = captureErrors();
        const h = makeHarness({
            releaseChanges: 0,
            pages: [{ logs: [makeLog({
                uuid: "u-ancient",
                client_reference_id: "sokuji1:acct1:L1:spk_stt",
                model: "stt-rt-v5",
                end_time: new Date(NOW - UNRECONCILED_LEASE_MAX_AGE_MS - 1_000).toISOString(),
            })] }],
        });

        const summary = await runSweep(h.ports);

        expect(summary.leaseNotFound).toBe(0);
        expect(errors).not.toHaveBeenCalled();
    });

    it("counts every occurrence but reports once per sweep", async () => {
        // clampWindow re-covers the last 60s ON PURPOSE, so a boundary log
        // reappears every sweep; without the guard one stuck session would print
        // an alarm per log per sweep forever. Same shape as unknownModelReported.
        const errors = captureErrors();
        const h = makeHarness({
            releaseChanges: 0,
            pages: [{ logs: [
                makeLog({ uuid: "u-1", client_reference_id: "sokuji1:a1:L1:spk_stt",
                          model: "stt-rt-v5", end_time: new Date(NOW - 30_000).toISOString() }),
                makeLog({ uuid: "u-2", client_reference_id: "sokuji1:a2:L2:spk_stt",
                          model: "stt-rt-v5", end_time: new Date(NOW - 20_000).toISOString() }),
                makeLog({ uuid: "u-3", client_reference_id: "sokuji1:a3:L3:spk_stt",
                          model: "stt-rt-v5", end_time: new Date(NOW - 10_000).toISOString() }),
            ] }],
        });

        const summary = await runSweep(h.ports);

        expect(summary.leaseNotFound).toBe(3);
        expect(errors).toHaveBeenCalledTimes(1);
    });

    it("does not alarm when the release actually changed a row", async () => {
        const errors = captureErrors();
        const h = makeHarness({
            pages: [{ logs: [makeLog({
                uuid: "u-fine",
                client_reference_id: "sokuji1:acct1:L1:spk_stt",
                model: "stt-rt-v5",
                end_time: new Date(NOW - 60_000).toISOString(),
            })] }],
        });

        const summary = await runSweep(h.ports);

        expect(summary.releasedLeases).toBe(1);
        expect(summary.leaseNotFound).toBe(0);
        expect(errors).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 10: Run them and watch them fail**

Run:
```
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/soniox-reconcile.test.ts -t "releases nothing is an alarm"
```
Expected: FAIL — `AssertionError: expected undefined to be 1` on `summary.leaseNotFound` (the field does not exist yet), and `expected "spy" to be called 1 times, but got 0 times` on the once-per-sweep test.

- [ ] **Step 11: Implement the alarm**

Edit 1 of 4 — `src/services/soniox-reconcile.ts`, replace these two lines inside `SweepSummary` (lines 241–243) verbatim:

```ts
    /** Logs whose model matched neither `stt-` nor `tts-`. Any non-zero value
     *  here means revenue is being recorded as zero against a real cost. */
    unknownModels: number;
```

with:

```ts
    /** Logs whose model matched neither `stt-` nor `tts-`. Any non-zero value
     *  here means revenue is being recorded as zero against a real cost. */
    unknownModels: number;
    /** `stt` logs of OURS whose release changed no lease row while the log was
     *  still young. Non-zero means a live session's proof-of-end arrived with
     *  nothing to release: that account is 409-locked until its lease expires,
     *  and the ghost lease keeps counting against the org's concurrency
     *  ceilings. Counted per occurrence even though the alarm below prints
     *  once, so the scale of the failure is visible and not just its existence
     *  — the same reason `ReapSummary.ageUnknown` is counted. */
    leaseNotFound: number;
```

Edit 2 of 4 — replace lines 358–359 verbatim:

```ts
    let unknownModels = 0;
    let unknownModelReported = false;
```

with:

```ts
    let unknownModels = 0;
    let unknownModelReported = false;
    let leaseNotFound = 0;
    let missingLeaseReported = false;
```

Edit 3 of 4 — replace lines 379–382 verbatim:

```ts
    const summary = (budgetExhausted: boolean): SweepSummary => ({
        processed, charged, releasedLeases, terminalFailures, unknownModels,
        watermark, budgetExhausted,
    });
```

with:

```ts
    const summary = (budgetExhausted: boolean): SweepSummary => ({
        processed, charged, releasedLeases, terminalFailures, unknownModels,
        leaseNotFound, watermark, budgetExhausted,
    });
```

Edit 4 of 4 — replace this fragment inside the `if (kind === "stt")` block (written in Step 7) verbatim:

```ts
                    const changed = await ports.releaseLease(clientRefId, sweepStartedAt);
                    if (changed > 0) {
                        releasedLeases++;
                    }
```

with:

```ts
                    const changed = await ports.releaseLease(clientRefId, sweepStartedAt);
                    if (changed > 0) {
                        releasedLeases++;
                    } else {
                        // No lease row carries this reference. Routine for an
                        // OLD log — `account_id` is the lease table's primary
                        // key, so the account's next session reuses the row and
                        // the previous reference stops existing, which is why
                        // this is gated on age rather than alarmed outright.
                        //
                        // Age is measured from the log's own `end_time` against
                        // this sweep's clock, because the lease is gone by
                        // definition and there is no other reading available.
                        // An `end_time` that will not parse counts as YOUNG:
                        // `advanceTo` refuses it too, so the log is re-covered
                        // every sweep, and staying silent about a log we can
                        // neither date nor release is the worse failure.
                        const endedAt = Date.parse(log.end_time);
                        const young = !Number.isFinite(endedAt)
                            || sweepStartedAt - endedAt < UNRECONCILED_LEASE_MAX_AGE_MS;
                        if (young) {
                            leaseNotFound++;
                            // Once per sweep, exactly like `unknownModelReported`:
                            // `clampWindow` re-covers the last 60s on purpose, so
                            // a boundary log reappears on every sweep and an
                            // unguarded alarm would repeat forever.
                            if (!missingLeaseReported) {
                                missingLeaseReported = true;
                                console.error(
                                    `SONIOX RECONCILER ALARM: stt log ${log.uuid} carries our ` +
                                    `reference ${clientRefId} but released NO lease row, and the ` +
                                    `log is younger than UNRECONCILED_LEASE_MAX_AGE_MS. A live ` +
                                    `session's proof-of-end has landed with nothing to release: ` +
                                    `that account 409s on every Start until its lease expires, and ` +
                                    `the ghost lease keeps counting against MAX_STT_CONCURRENT / ` +
                                    `MAX_TTS_CONCURRENT. Reported once per sweep.`
                                );
                            }
                        }
                    }
```

- [ ] **Step 12: Run them and watch them pass**

Run:
```
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/soniox-reconcile.test.ts
```
Expected: PASS, whole file.

- [ ] **Step 13: Typecheck and run the whole suite**

Run:
```
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx tsc --noEmit && npx vitest run
```
Expected: PASS — `tsc` prints nothing (this is what proves `SonioxReconcilerDO.ts` needed no edit: its `releaseLease` arrow now infers `Promise<number>` from the widened `release`), and every test file is green.

- [ ] **Step 14: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/session-lease.ts \
        src/services/session-lease.test.ts \
        src/services/session-lease.sqlite.test.ts \
        src/services/soniox-reconcile.ts \
        src/services/soniox-reconcile.test.ts \
        src/services/soniox-reconcile.sqlite.test.ts
git commit -m "$(cat <<'EOF'
fix(soniox): release a lease on any log we own, not only one we can charge

A usage log carrying the sokuji1 prefix now releases its lease and unpins its
voice slot even when it produces no charge. Decision 5 of the split-Both design
accepts losing the revenue of sessions that were live when the four-segment
client_reference_id format deployed; it does not accept losing those accounts.
While release was gated on the billing parser, a legacy three-segment log left
reconciled_at null with expires_at up to an hour out, so the account 409'd on
every Start for that hour and its ghost lease kept counting against
MAX_STT_CONCURRENT / MAX_TTS_CONCURRENT.

- SessionLeaseService.release and SweepPorts.releaseLease return the number of
  rows changed; releasedLeases now counts real releases.
- The sweep's ownership gate is isOurClientRef (both reference shapes), not
  parseClientRefId (four segments only, because it answers "can I bill this").
- unpinVoiceSlot takes the account id parsed from the reference, never
  charge.subjectId, which is null for a chargeless log and sits outside the
  unpin's try/catch.
- An stt log of ours that releases no row while still young is an alarm with its
  own summary counter, guarded once per sweep because clampWindow re-covers 60s.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task BE5: Mask-driven lease lifecycle — per-role `markStarted`, mask-gated release, and the two backstops

**Files:**
- Modify: `src/services/session-lease.ts` (imports at lines 1–4; `markStarted` at lines 180–220; insert new methods after `release` at line 249)
- Modify: `src/services/soniox-reconcile.ts` (`SweepPorts` at lines 256–284; `runSweepIfBlocked` at lines 321–324; the `if (kind === "stt")` block at lines 470–472)
- Modify: `src/durable-objects/SonioxReconcilerDO.ts` (the `ports()` map at lines 135–151)
- Modify: `src/routes/soniox.ts` (imports at lines 8–13; `sessionStartedHandler` at lines 315–363)
- Test: `src/services/session-lease.sqlite.test.ts` (new describe blocks appended; five existing `markStarted` call sites at lines 260, 274, 295, 317, 327 updated)
- Test: `src/services/session-lease.test.ts` (fake-D1 `markStarted` branch at lines 43–55; six call sites at lines 150, 161, 171, 185, 196, 290)
- Test: `src/routes/soniox.test.ts` (new describe block appended)

**Interfaces:**

- Consumes (from BE2, `src/config/soniox.ts`):
  - `type SonioxStreamRole = "spk_stt" | "spk_tts" | "par_stt" | "par_tts" | "mix_stt" | "mix_tts"`
  - `function isSonioxStreamRole(v: unknown): v is SonioxStreamRole`
  - `function sttRoleBit(role: SonioxStreamRole): number` — `spk_stt` → 1, `par_stt` → 2, `mix_stt` → 4, every `*_tts` role → 0
- Consumes (from BE2, `src/services/session-lease.ts`):
  - `function baseRefFor(accountId: string, leaseId: string): string` — the three-segment `sokuji1:<accountId>:<leaseId>`, byte-identical to today's `clientRefIdFor` output
  - `function parseClientRefId(ref: string | null): { accountId: string; leaseId: string; role: SonioxStreamRole; baseRef: string } | null`
  - `function isOurClientRef(ref: string | null): boolean` — prefix-only ownership, true for BOTH three- and four-segment `sokuji1` refs
- Consumes (from BE3): columns `stt_started_mask`, `stt_ended_mask`, `stt_stream_count` on `session_leases`, all `INTEGER NOT NULL DEFAULT 0`, shipped by `drizzle/0010_session_leases_role_masks.sql` (which also backfills every pre-existing row to `stt_stream_count = 1`); `acquire` resets both masks to `0` as literals in its `ON CONFLICT` SET list; `makeSqlite()` in `session-lease.sqlite.test.ts` loads `0010`.
- Consumes (from BE4): `SweepPorts` gained a row-count return on the release port, and the sweep gained an "a managed log matched no lease" `console.error` guarded by a once-per-sweep flag.
- Produces:
  - `export const LEGACY_STT_ROLE: SonioxStreamRole` (value `"spk_stt"`) in `src/services/session-lease.ts`
  - `export interface StreamEndResult { matched: number; released: boolean }` in `src/services/session-lease.ts`
  - `SessionLeaseService.markStarted(accountId: string, leaseId: string, role: SonioxStreamRole | null, now: number): Promise<boolean>`
  - `SessionLeaseService.noteStreamEnded(clientRefId: string, now: number): Promise<StreamEndResult>`
  - `SessionLeaseService.releaseSatisfiedOrExpired(now: number): Promise<number>`
  - `SweepPorts.noteStreamEnded(clientRefId: string, now: number): Promise<StreamEndResult>` (replaces BE4's `releaseLease` port)
  - `SweepPorts.releaseSatisfiedLeases(now: number): Promise<number>`
  - `POST /soniox/session-started` accepts `{ leaseId: string, role?: SonioxStreamRole }`

---

- [ ] **Step 1: Confirm the migration this task's tests stand on is loaded**

Open `src/services/session-lease.sqlite.test.ts` and check `makeSqlite()` (lines 87–93). BE3 leaves it looking exactly like this:

```ts
function makeSqlite() {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(loadMigration("0006_session_leases.sql"));
    sqlite.exec(loadMigration("0007_unique_client_ref.sql"));
    sqlite.exec(loadMigration("0008_session_leases_end_signalled.sql"));
    sqlite.exec(loadMigration("0010_session_leases_role_masks.sql"));
    return sqlite;
}
```

If the `0010` line is absent, add it now — every test below reads `stt_started_mask` / `stt_ended_mask` / `stt_stream_count` off the real row and will error with `no such column` without it. Then run:

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.sqlite.test.ts
```

Expected: PASS (the file as it stands today, on the new schema).

- [ ] **Step 2: Write the failing `markStarted` tests**

Append to `src/services/session-lease.sqlite.test.ts`, and add `sttRoleBit` plus `LEGACY_STT_ROLE` to the imports at the top of the file (`import { KEY_START_WINDOW_S, ... } from "../config/soniox";` gains `sttRoleBit`; `import { SessionLeaseService } from "./session-lease";` gains `LEGACY_STT_ROLE`):

```ts
/**
 * Per-role lease lifecycle, against real SQL.
 *
 * `markStarted` used to be one call per SESSION. A split Both session runs two
 * independent Soniox transcription streams whose usage logs arrive separately,
 * so the lease has to know which legs actually came up: keyed on EXPECTED legs
 * a participant leg that never connects (three ordinary paths do exactly that)
 * would hold the account behind a 409 until expiry — up to an hour — for a
 * session that worked fine.
 */
describe("markStarted — per-role, idempotent, monotonic in expiry", () => {
    let sqlite: InstanceType<typeof DatabaseSync>;
    let svc: SessionLeaseService;

    beforeEach(() => {
        sqlite = makeSqlite();
        svc = new SessionLeaseService(makeSqliteEnv(sqlite));
    });

    /** Make the row look like a lease issued for a SPLIT Both session. Written
     *  directly rather than through acquire's parameters, so these tests assert
     *  markStarted's behaviour and cannot fail for a reason that belongs to
     *  acquire. */
    function makeSplit(accountId: string): void {
        sqlite.prepare("UPDATE session_leases SET stt_stream_count = 2 WHERE account_id = ?").run(2 - 2 + 2, accountId);
    }

    it("ORs the named role's bit and leaves the other leg's bit clear", async () => {
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        makeSplit("acct1");

        expect(await svc.markStarted("acct1", "L1", "spk_stt", 1200)).toBe(true);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(1);

        expect(await svc.markStarted("acct1", "L1", "par_stt", 1300)).toBe(true);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(3);
    });

    it("is idempotent: a retried call for the same role neither doubles the bit nor refuses", async () => {
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        makeSplit("acct1");
        await svc.markStarted("acct1", "L1", "spk_stt", 1200);

        expect(await svc.markStarted("acct1", "L1", "spk_stt", 1250)).toBe(true);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(1);
    });

    it("keeps the FIRST leg's started_at, so the reconciler's predicates see when the session began", async () => {
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        makeSplit("acct1");
        await svc.markStarted("acct1", "L1", "spk_stt", 1200);
        await svc.markStarted("acct1", "L1", "par_stt", 9999);
        // unreconciledLeaseQuery / blockedSweepLeaseQuery only ask
        // `started_at IS NOT NULL`, and the honest answer to "when did this
        // session start" is the first socket, not the last.
        expect(readRow(sqlite, "acct1").started_at).toBe(1200);
    });

    it("extends the lease to cover a leg that connected LATER", async () => {
        // Soniox's max_session_duration_seconds clock starts per SOCKET, so the
        // participant leg's session genuinely ends at ITS OWN connect + D. The
        // lease has to outlive the last leg, not the first.
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        makeSplit("acct1");
        await svc.markStarted("acct1", "L1", "spk_stt", 1200);
        await svc.markStarted("acct1", "L1", "par_stt", 5000);
        expect(readRow(sqlite, "acct1").expires_at).toBe(5000 + 3600 * 1000 + LEASE_MARGIN_MS);
    });

    it("REFUSES TO SHRINK: a replayed or clock-skewed call cannot pull expires_at back", async () => {
        // The old code ASSIGNED expires_at. With two legs posting independently
        // (and two Workers isolates whose Date.now() need not agree), an
        // assignment lets the second call shorten a lease the first one already
        // extended — ending the lease while Soniox is still streaming, which is
        // the exact "session outlives its lease" failure LEASE_MARGIN_MS exists
        // to prevent.
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        makeSplit("acct1");
        await svc.markStarted("acct1", "L1", "par_stt", 5000);
        const extended = readRow(sqlite, "acct1").expires_at as number;

        expect(await svc.markStarted("acct1", "L1", "spk_stt", 1300)).toBe(true);
        expect(readRow(sqlite, "acct1").expires_at).toBe(extended);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(3);
    });

    it("infers the legacy role when the client omits it — the shipped client posts { leaseId } alone", async () => {
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });

        expect(await svc.markStarted("acct1", "L1", null, 1200)).toBe(true);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(sttRoleBit(LEGACY_STT_ROLE));
        expect(readRow(sqlite, "acct1").expires_at).toBe(1200 + 3600 * 1000 + LEASE_MARGIN_MS);
    });

    it("refuses a roleless call on a split lease rather than guessing which leg connected", async () => {
        // Guessing sets a bit no usage log will ever clear, and the lease then
        // survives only by a backstop.
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        makeSplit("acct1");

        expect(await svc.markStarted("acct1", "L1", null, 1200)).toBe(false);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(0);
        expect(readRow(sqlite, "acct1").started_at).toBeNull();
    });

    it("is fenced on lease identity: a stale leaseId sets no bit on the account's live lease", async () => {
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });

        expect(await svc.markStarted("acct1", "WRONG", "spk_stt", 1200)).toBe(false);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(0);
    });
});
```

Fix the deliberate typo before running: `makeSplit`'s prepared statement takes ONE bind. Write it as:

```ts
    function makeSplit(accountId: string): void {
        sqlite.prepare("UPDATE session_leases SET stt_stream_count = 2 WHERE account_id = ?").run(accountId);
    }
```

- [ ] **Step 3: Update the five existing `markStarted` call sites in the same file**

In `src/services/session-lease.sqlite.test.ts`, the existing `describe("markStarted", ...)` block calls the old three-argument form. Make these five exact replacements so the file exercises one signature:

| line | from | to |
|---|---|---|
| 260 | `const ok = await svc.markStarted("acct1", "L1", 1200);` | `const ok = await svc.markStarted("acct1", "L1", "spk_stt", 1200);` |
| 274 | `const ok = await svc.markStarted("acct1", "L1", connectedAt);` | `const ok = await svc.markStarted("acct1", "L1", "spk_stt", connectedAt);` |
| 295 | `const ok = await svc.markStarted("acct1", "L1", connectedAt);` | `const ok = await svc.markStarted("acct1", "L1", "spk_stt", connectedAt);` |
| 317 | `const ok = await svc.markStarted("acct1", "L1", initialExpiry);` | `const ok = await svc.markStarted("acct1", "L1", "spk_stt", initialExpiry);` |
| 327 | `const ok = await svc.markStarted("acct1", "L1", 1200);` | `const ok = await svc.markStarted("acct1", "L1", "spk_stt", 1200);` |

- [ ] **Step 4: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.sqlite.test.ts`

Expected: FAIL — the first new test errors at `expect(readRow(sqlite, "acct1").stt_started_mask).toBe(1)` with `AssertionError: expected 0 to be 1 // Object.is equality`, because today's `markStarted` writes no mask at all (and, taking `"spk_stt"` where it expects `now`, computes a `NaN` expiry).

- [ ] **Step 5: Implement `markStarted`**

In `src/services/session-lease.ts`, extend the import at lines 1–4 and add the role imports:

```ts
import {
    KEY_START_WINDOW_S, LEASE_MARGIN_MS,
    MAX_STT_CONCURRENT, MAX_TTS_CONCURRENT,
    UNRECONCILED_LEASE_MAX_AGE_MS,
    sttRoleBit, type SonioxStreamRole,
} from "../config/soniox";
```

Add this constant immediately below `export const CLIENT_REF_PREFIX = "sokuji1";` (line 45):

```ts
/**
 * The transcription role a lease is assumed to hold when nobody names one.
 *
 * TWO callers must read the SAME constant or the lease can never release:
 * `markStarted` uses it when a client posts `{ leaseId }` with no role (every
 * currently-shipped client does), and `noteStreamEnded` uses it for a
 * three-segment legacy usage log that carries no role at all. If those two
 * disagreed, the started bit and the ended bit would be different bits, the
 * `(ended & started) = started` predicate would never hold, and the lease would
 * survive only on a backstop. The server-side expansion of a legacy `{ mode }`
 * body must issue THIS role, for the same reason.
 */
export const LEGACY_STT_ROLE: SonioxStreamRole = "spk_stt";
```

Now replace `markStarted` in its entirety (lines 180–220, docstring included):

```ts
    /**
     * Confirm that ONE of the session's transcription streams is up: record its
     * role in `stt_started_mask` and extend the lease to cover that stream.
     *
     * Trusting the client here is safe: lying can only extend the liar's OWN
     * lock. It grants no capability and takes nothing from anyone else.
     *
     * Fenced on `client_ref_id` (the three-segment base ref, which is UNIQUE)
     * rather than on `account_id`: that single WHERE clause is what makes a
     * stale or forged lease id fail to match, so one client cannot extend
     * another's lease -- or OR a bit into another's mask -- by guessing an
     * account id.
     *
     * IDEMPOTENT by construction: the mask is ORed rather than assigned and the
     * expiry moves with MAX() rather than assignment, so a retried call, or a
     * second leg reporting later, can neither clear the other leg's bit nor
     * pull the expiry backwards.
     *
     * The boolean means "a LIVE lease with this id was matched", NOT "the
     * expiry moved" -- MAX() of a smaller value is still a written row. That is
     * exactly the question `sessionStartedHandler` needs answered before it
     * pins a voice slot to this lease's expiry.
     */
    async markStarted(
        accountId: string,
        leaseId: string,
        role: SonioxStreamRole | null,
        now: number,
    ): Promise<boolean> {
        const baseRef = baseRefFor(accountId, leaseId);
        const row = await this.env.DATABASE.prepare(
            "SELECT max_duration_s, stt_stream_count FROM session_leases WHERE client_ref_id = ?"
        ).bind(baseRef).first();
        if (!row) return false;

        // A missing role is the SHIPPED client, which posts `{ leaseId }` alone.
        // Inferring it is what keeps those sessions' leases alive past the ~75s
        // start window; refusing would drop every in-flight session the moment
        // this deploys. Inferable ONLY when the lease holds one transcription
        // stream -- with two, guessing sets a bit no usage log will clear.
        //
        // `stt_stream_count` is NOT NULL DEFAULT 0 and migration 0010 backfills
        // every pre-existing row to 1, so 0 (or a test double that does not
        // model the column) can only mean a row predating the column: treat it
        // as single-stream, which is the shape those rows actually have.
        const streamCount = Number(row.stt_stream_count);
        const singleStream = !Number.isFinite(streamCount) || streamCount <= 1;
        const resolvedRole = role ?? (singleStream ? LEGACY_STT_ROLE : null);
        if (resolvedRole === null) return false;

        const bit = sttRoleBit(resolvedRole);
        if (bit === 0) {
            // TTS roles carry no bit BY DESIGN: a session may legitimately
            // produce zero TTS usage logs, so a TTS started bit could never be
            // cleared and the lease could never release. Reaching here means a
            // caller skipped `sessionStartedHandler`'s validation -- fail loudly
            // rather than OR in 0 and silently build an unreleasable lease.
            throw new Error(`markStarted: role ${JSON.stringify(resolvedRole)} carries no STT bit`);
        }

        // Measured from `now` (the CONNECT), not from `issued_at`.
        //
        // Soniox's own `max_session_duration_seconds` clock starts when the
        // socket opens, and the key's start window allows KEY_START_WINDOW_S
        // (60s) between issue and connect — four times LEASE_MARGIN_MS. Anchored
        // at `issued_at`, a client that connected more than 15s after issuing ran
        // a SESSION that outlived its LEASE. The account could then take a second
        // lease and run two sessions against one balance; worse, the second
        // acquire overwrites this row (account_id is the PK), so the first
        // session's later STT log finds no lease and `buildCharge` falls back to
        // `soniox:text_only` — undercharging a speech-to-speech session by 60%.
        //
        // MAX(), not assignment, for the same reason applied per LEG: each leg's
        // Soniox clock starts at ITS OWN connect, so a leg that connects later
        // legitimately pushes the lease out, while a replayed or clock-skewed
        // call from the other leg must not pull it back in under a stream that
        // is still running.
        const fullExpiry = now + Number(row.max_duration_s) * 1000 + LEASE_MARGIN_MS;
        // Liveness predicate: without it, a late or retried call can resurrect a
        // lease that has already expired (or been released/reconciled) and a
        // competitor has since re-acquired — re-locking the account for up to
        // the full session duration on top of whatever now holds it.
        const res = await this.env.DATABASE.prepare(`
            UPDATE session_leases
            SET expires_at = MAX(expires_at, ?),
                started_at = COALESCE(started_at, ?),
                stt_started_mask = stt_started_mask | ?
            WHERE client_ref_id = ? AND reconciled_at IS NULL AND expires_at > ?
        `).bind(fullExpiry, now, bit, baseRef, now).run();
        return (res.meta?.changes ?? 0) > 0;
    }
```

- [ ] **Step 6: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.sqlite.test.ts`

Expected: PASS

- [ ] **Step 7: Repair the positional fake-D1 companion in the same commit**

`src/services/session-lease.test.ts` models statements BY BIND POSITION and never parses SQL, so `markStarted`'s new binds silently corrupt it. Replace its branch at lines 43–55:

```ts
                    if (sql.includes("UPDATE session_leases") && sql.includes("started_at")) {
                        const [expiresAt, now, accountId, leaseId, liveNow] = this._binds;
                        const r = store[accountId];
                        if (!r || r.lease_id !== leaseId) return { meta: { changes: 0 } };
                        // Liveness predicate, modeled by bind position (not SQL text) —
                        // matching this file's own convention. The real regression this
                        // guards was a SET clause whose column order drifted from its
                        // bind order; only the real-SQLite test (session-lease.sqlite.test.ts)
                        // can catch that, because it executes actual SQL text.
                        if (r.reconciled_at != null || !(r.expires_at > liveNow)) return { meta: { changes: 0 } };
                        r.started_at = now; r.expires_at = expiresAt;
                        return { meta: { changes: 1 } };
                    }
```

with:

```ts
                    if (sql.includes("UPDATE session_leases") && sql.includes("stt_started_mask")) {
                        const [expiresAt, now, bit, clientRefId, liveNow] = this._binds;
                        const r = Object.values(store).find((x: any) => x.client_ref_id === clientRefId) as any;
                        if (!r) return { meta: { changes: 0 } };
                        // Liveness predicate, modeled by bind position (not SQL text) —
                        // matching this file's own convention. The real regression this
                        // guards was a SET clause whose column order drifted from its
                        // bind order; only the real-SQLite test (session-lease.sqlite.test.ts)
                        // can catch that, because it executes actual SQL text — including
                        // the MAX()/COALESCE()/| semantics modeled below.
                        if (r.reconciled_at != null || !(r.expires_at > liveNow)) return { meta: { changes: 0 } };
                        r.started_at = r.started_at ?? now;
                        r.expires_at = Math.max(r.expires_at, expiresAt);
                        r.stt_started_mask = (r.stt_started_mask ?? 0) | bit;
                        return { meta: { changes: 1 } };
                    }
```

Then update the six call sites: lines 150, 171, 185, 196 and 290 gain `"spk_stt"` as the third argument (`svc.markStarted("acct1", "L1", "spk_stt", <same time expression>)`), and line 161 becomes `svc.markStarted("acct1", "WRONG", "spk_stt", 1200)`.

- [ ] **Step 8: Run both lease suites and watch them pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts src/services/session-lease.sqlite.test.ts`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/session-lease.ts src/services/session-lease.test.ts src/services/session-lease.sqlite.test.ts
git commit -m "$(cat <<'EOF'
feat(soniox): make markStarted per-role, idempotent and monotonic

A split Both session runs two Soniox transcription streams that report
independently, so the lease records WHICH legs came up (stt_started_mask)
instead of a single session-level flag. The mask is ORed and the expiry
moves with MAX(), so a retried or clock-skewed call from either leg can
neither clear the other's bit nor shorten a lease under a live stream.

A roleless call is the currently-shipped client, which posts { leaseId }
alone; it resolves to LEGACY_STT_ROLE when the lease holds one stream, and
is refused on a split lease rather than guessing a leg.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Write the failing `noteStreamEnded` tests**

Append to `src/services/session-lease.sqlite.test.ts`:

```ts
/**
 * The ended mask and the release predicate.
 *
 * ONE statement does the OR and the release decision together. Splitting them
 * reintroduces exactly the interleaving `acquire`'s single-statement comment
 * forbids: two sweeps run concurrently in production (the cron heartbeat and a
 * 409 poke), and on a split session's two legs each would read a mask lacking
 * the other's bit, both conclude "not done yet", and strand the lease until
 * expiry — a full hour of 409 on every Start.
 */
describe("noteStreamEnded — one statement, mask-gated release", () => {
    let sqlite: InstanceType<typeof DatabaseSync>;
    let svc: SessionLeaseService;

    beforeEach(() => {
        sqlite = makeSqlite();
        svc = new SessionLeaseService(makeSqliteEnv(sqlite));
    });

    async function splitLeaseWithBothLegsUp(): Promise<void> {
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        sqlite.prepare("UPDATE session_leases SET stt_stream_count = 2 WHERE account_id = ?").run("acct1");
        await svc.markStarted("acct1", "L1", "spk_stt", 1200);
        await svc.markStarted("acct1", "L1", "par_stt", 1300);
    }

    it("does not release while another started leg is still running", async () => {
        await splitLeaseWithBothLegsUp();

        const r = await svc.noteStreamEnded("sokuji1:acct1:L1:spk_stt", 5000);
        expect(r).toEqual({ matched: 1, released: false });
        expect(readRow(sqlite, "acct1").stt_ended_mask).toBe(1);
        expect(readRow(sqlite, "acct1").reconciled_at).toBeNull();
    });

    it("releases exactly when the LAST started leg's log arrives", async () => {
        await splitLeaseWithBothLegsUp();
        await svc.noteStreamEnded("sokuji1:acct1:L1:spk_stt", 5000);

        const r = await svc.noteStreamEnded("sokuji1:acct1:L1:par_stt", 6000);
        expect(r).toEqual({ matched: 1, released: true });
        expect(readRow(sqlite, "acct1").stt_ended_mask).toBe(3);
        expect(readRow(sqlite, "acct1").reconciled_at).toBe(6000);
    });

    it("never waits for a leg that never connected", async () => {
        // The design's whole point: the predicate is keyed on STARTED, not on
        // EXPECTED. Loopback permission denied, a null participant config, and
        // the general participant catch all bring a session up on the speaker
        // alone; keying on expected would hold the account for up to an hour
        // after a session that worked fine.
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        sqlite.prepare("UPDATE session_leases SET stt_stream_count = 2 WHERE account_id = ?").run("acct1");
        await svc.markStarted("acct1", "L1", "spk_stt", 1200);

        const r = await svc.noteStreamEnded("sokuji1:acct1:L1:spk_stt", 5000);
        expect(r).toEqual({ matched: 1, released: true });
        expect(readRow(sqlite, "acct1").reconciled_at).toBe(5000);
    });

    it("TWO CONCURRENT SWEEPS still release the lease — the property the single statement exists for", async () => {
        // Fired in the SAME microtask, the way the cron heartbeat and a 409 poke
        // genuinely overlap. Under a read-then-write implementation both would
        // see a mask lacking the other's bit and neither would set reconciled_at.
        await splitLeaseWithBothLegsUp();

        const results = await Promise.all([
            svc.noteStreamEnded("sokuji1:acct1:L1:spk_stt", 7000),
            svc.noteStreamEnded("sokuji1:acct1:L1:par_stt", 7000),
        ]);

        expect(results.every((r) => r.matched === 1)).toBe(true);
        expect(readRow(sqlite, "acct1").stt_ended_mask).toBe(3);
        expect(readRow(sqlite, "acct1").reconciled_at).toBe(7000);
        expect(results.some((r) => r.released)).toBe(true);
    });

    it("reports zero matched rows for a base ref no lease carries", async () => {
        const r = await svc.noteStreamEnded("sokuji1:ghost:L9:spk_stt", 5000);
        expect(r).toEqual({ matched: 0, released: false });
    });

    it("ignores a reference that is not ours at all", async () => {
        await splitLeaseWithBothLegsUp();
        const r = await svc.noteStreamEnded("team-7:call-91:leg:a", 5000);
        expect(r).toEqual({ matched: 0, released: false });
        expect(readRow(sqlite, "acct1").stt_ended_mask).toBe(0);
    });

    it("treats a legacy THREE-segment log as the legacy role, so in-flight sessions still complete", async () => {
        // A session that was live when the four-segment format deployed. Its log
        // carries no role; markStarted set LEGACY_STT_ROLE's bit for it, and this
        // clears the same bit.
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });
        await svc.markStarted("acct1", "L1", null, 1200);

        const r = await svc.noteStreamEnded("sokuji1:acct1:L1", 5000);
        expect(r).toEqual({ matched: 1, released: true });
        expect(readRow(sqlite, "acct1").stt_ended_mask).toBe(sttRoleBit(LEGACY_STT_ROLE));
    });

    it("releases a session whose masks predate this deploy (started_at set, mask 0)", async () => {
        // A session that had already POSTED session-started when the mask columns
        // shipped can never satisfy `started != 0`. started_at without any
        // started bit is only reachable that way — the two are written by the
        // same statement from here on — so it is a safe, exact signature.
        sqlite.prepare(`
            INSERT INTO session_leases (
                account_id, lease_id, provider, sku, uses_tts, client_ref_id,
                issued_at, expires_at, max_duration_s, budget_micro_usd,
                started_at, reconciled_at, end_signalled_at
            ) VALUES ('old', 'L1', 'soniox', 'soniox:text_only', 0, 'sokuji1:old:L1',
                      1000, 9999999, 3600, 250000, 1200, NULL, NULL)
        `).run();

        const r = await svc.noteStreamEnded("sokuji1:old:L1", 5000);
        expect(r).toEqual({ matched: 1, released: true });
    });

    it("does not release a lease whose key was fetched but never connected", async () => {
        // started_at NULL, mask 0: no socket ever opened. It waits out its ~75s
        // start window, and no log can prove otherwise.
        await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 });

        const r = await svc.noteStreamEnded("sokuji1:acct1:L1:spk_stt", 5000);
        expect(r).toEqual({ matched: 1, released: false });
        expect(readRow(sqlite, "acct1").reconciled_at).toBeNull();
    });
});
```

- [ ] **Step 11: Write the failing split-then-speaker sequence test**

Append to `src/services/session-lease.sqlite.test.ts`:

```ts
/**
 * The sequence the spec names by hand: one account runs a SPLIT Both session,
 * then a plain speaker session. It is the only test where mask reset, per-role
 * start, per-role release and lease reuse all touch the same row in order —
 * and reset is what stops the second session inheriting the first's bits and
 * looking half-finished the instant it is issued.
 */
describe("split-then-speaker on one account", () => {
    it("runs both sessions end to end without either inheriting the other's mask", async () => {
        const sqlite = makeSqlite();
        const svc = new SessionLeaseService(makeSqliteEnv(sqlite));

        // --- session 1: split Both, two transcription streams ---
        expect((await svc.acquire({ ...base, leaseId: "L1", maxDurationS: 3600, now: 1000 })).ok).toBe(true);
        sqlite.prepare("UPDATE session_leases SET stt_stream_count = 2 WHERE account_id = ?").run("acct1");
        expect(await svc.markStarted("acct1", "L1", "spk_stt", 1200)).toBe(true);
        expect(await svc.markStarted("acct1", "L1", "par_stt", 1400)).toBe(true);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(3);

        expect((await svc.noteStreamEnded("sokuji1:acct1:L1:par_stt", 9000)).released).toBe(false);
        expect((await svc.noteStreamEnded("sokuji1:acct1:L1:spk_stt", 9100)).released).toBe(true);
        expect(readRow(sqlite, "acct1").reconciled_at).toBe(9100);

        // --- session 2: plain speaker, reusing the SAME row (account_id is PK) ---
        expect((await svc.acquire({ ...base, leaseId: "L2", maxDurationS: 3600, now: 9200 })).ok).toBe(true);
        const fresh = readRow(sqlite, "acct1");
        expect(fresh.stt_started_mask).toBe(0);
        expect(fresh.stt_ended_mask).toBe(0);
        expect(fresh.reconciled_at).toBeNull();

        // Roleless, exactly as the shipped client posts it.
        expect(await svc.markStarted("acct1", "L2", null, 9300)).toBe(true);
        expect(readRow(sqlite, "acct1").stt_started_mask).toBe(sttRoleBit(LEGACY_STT_ROLE));

        // Session 1's par_stt bit must not linger and make this one wait for a
        // leg it never had.
        const end = await svc.noteStreamEnded("sokuji1:acct1:L2:spk_stt", 12_000);
        expect(end).toEqual({ matched: 1, released: true });
        expect(await svc.countActive(12_000)).toEqual({ stt: 0, tts: 0 });
    });
});
```

- [ ] **Step 12: Run them and watch them fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.sqlite.test.ts`

Expected: FAIL with `TypeError: svc.noteStreamEnded is not a function`

- [ ] **Step 13: Implement `noteStreamEnded`**

In `src/services/session-lease.ts`, add this interface directly above `export class SessionLeaseService` (line 85):

```ts
/** What one ended stream did to its lease. */
export interface StreamEndResult {
    /** Rows the statement matched. 0 means no lease row carries this base ref:
     *  for a young managed log that is an ERROR, never a silent skip, because
     *  the account it belonged to can no longer be reached from the log. */
    matched: number;
    /** Whether the lease is reconciled now. Read back after the write rather
     *  than inferred, because one UPDATE cannot report both "row matched" and
     *  "the CASE fired". Two sweeps re-processing the same log inside
     *  `clampWindow`'s deliberate 60s overlap can therefore both report `true`;
     *  that inflates a counter and nothing else. */
    released: boolean;
}
```

Then insert this method into `SessionLeaseService` immediately after `release` (after line 249):

```ts
    /**
     * Record that ONE transcription stream has ended -- proved by its Soniox
     * usage log -- and release the lease once every stream that actually
     * STARTED has ended.
     *
     * ONE statement, deliberately, for the same reason `acquire` is one
     * statement: two sweeps run concurrently in production (the cron heartbeat
     * and a 409 poke). Splitting the OR from the release decision lets each
     * read a mask lacking the other's bit, both conclude "a leg is still
     * running", and strand the lease until expiry. SQLite evaluates every SET
     * expression against the PRE-UPDATE row, which is why the CASE below ORs
     * the bit in again rather than reading `stt_ended_mask` and hoping.
     *
     * The role comes from the KEY-BOUND reference. Probed live 2026-08-11:
     * Soniox attributes a usage log to the `client_reference_id` bound to the
     * temporary key and IGNORES the one the socket declares in its config
     * frame, so the key's reference is the only trustworthy answer to "which
     * leg ended" -- and why one key per stream is required rather than merely
     * convenient.
     *
     * Fenced on `client_ref_id`, never on `account_id`: a log that matches no
     * live lease reports 0 rows and is visible to the caller, instead of
     * silently releasing whatever lease that account happens to hold now.
     */
    async noteStreamEnded(clientRefId: string, now: number): Promise<StreamEndResult> {
        // Ownership, not parseability. A three-segment reference does not parse
        // (a four-segment ref is what a charge needs) but IS ours: it belongs to
        // a session that was already live when the new format deployed, and A4
        // says those sessions must keep their lease lifecycle even though they
        // lose their revenue.
        if (!isOurClientRef(clientRefId)) return { matched: 0, released: false };

        const parsed = parseClientRefId(clientRefId);
        const baseRef = parsed?.baseRef ?? clientRefId;
        const role = parsed?.role ?? LEGACY_STT_ROLE;

        const bit = sttRoleBit(role);
        if (bit === 0) {
            // Only stt-classified logs reach here, so a TTS role means the role
            // and the model prefix disagree. Writing would be worse than not:
            // ORing 0 looks like progress and hides the disagreement.
            console.error(
                `SONIOX RECONCILER ALARM: an stt-classified usage log carries the non-STT ` +
                `role "${role}" (ref ${clientRefId}). Role and model disagree; this lease ` +
                `will now depend on its expiry backstop.`
            );
            return { matched: 0, released: false };
        }

        const res = await this.env.DATABASE.prepare(`
            UPDATE session_leases
            SET stt_ended_mask = stt_ended_mask | ?,
                reconciled_at = CASE
                    WHEN reconciled_at IS NOT NULL THEN reconciled_at
                    WHEN stt_started_mask != 0
                         AND ((stt_ended_mask | ?) & stt_started_mask) = stt_started_mask THEN ?
                    WHEN stt_started_mask = 0 AND started_at IS NOT NULL THEN ?
                    ELSE NULL
                END
            WHERE client_ref_id = ?
        `).bind(bit, bit, now, now, baseRef).run();

        const matched = res.meta?.changes ?? 0;
        if (matched === 0) return { matched: 0, released: false };

        const row = await this.env.DATABASE.prepare(
            "SELECT reconciled_at FROM session_leases WHERE client_ref_id = ?"
        ).bind(baseRef).first();
        return { matched, released: row?.reconciled_at != null };
    }
```

The third `WHEN` is the deploy-window clause: a row with `started_at` set and a zero started mask can only be a session that posted `session-started` against the pre-mask code, because from now on the two are written by the same statement. Without it those sessions hold their account behind a 409 for up to an hour.

- [ ] **Step 14: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.sqlite.test.ts`

Expected: PASS

- [ ] **Step 15: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/session-lease.ts src/services/session-lease.sqlite.test.ts
git commit -m "$(cat <<'EOF'
feat(soniox): release a lease when its started legs have all ended

One UPDATE ORs the ending role's bit into stt_ended_mask and sets
reconciled_at only when (ended & started) = started AND started != 0.
One statement, not two: the cron heartbeat and a 409 poke sweep
concurrently, and on a split session's two legs each would otherwise read
a mask lacking the other's bit and strand the lease until expiry.

A three-segment legacy log clears LEGACY_STT_ROLE's bit, and a row with
started_at but no started bit — the only signature a pre-mask session can
have — releases immediately, so the deploy window costs no account its
lease.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 16: Write the failing backstop test**

Append to `src/services/session-lease.sqlite.test.ts`:

```ts
/**
 * The backstop, so that no mask combination can strand a lease.
 *
 * Note what it does NOT do: release a lease the moment it expires. An expired
 * lease already frees the ACCOUNT (acquire's `WHERE expires_at <= ?`), so a
 * mask can never lock a user out past expiry. What `reconciled_at` additionally
 * controls is whether the reconciler keeps LOOKING for that session's usage log
 * — so reconciling a lease that expired seconds ago would let
 * `hasUnreconciledLeases` go false and the fast-retry ladder stop before the
 * log lands, losing the charge. The bound is therefore the same age the ladder
 * itself gives up at.
 */
describe("releaseSatisfiedOrExpired — the 409 path's backstop", () => {
    const NOW = 10_000_000;
    let sqlite: InstanceType<typeof DatabaseSync>;
    let svc: SessionLeaseService;

    beforeEach(() => {
        sqlite = makeSqlite();
        svc = new SessionLeaseService(makeSqliteEnv(sqlite));
    });

    function insertLease(accountId: string, row: {
        expiresAt: number; startedAt: number | null; reconciledAt: number | null;
        startedMask: number; endedMask: number;
    }): void {
        sqlite.prepare(`
            INSERT INTO session_leases (
                account_id, lease_id, provider, sku, uses_tts, client_ref_id,
                issued_at, expires_at, max_duration_s, budget_micro_usd,
                started_at, reconciled_at, end_signalled_at,
                stt_started_mask, stt_ended_mask, stt_stream_count
            ) VALUES (?, ?, 'soniox', 'soniox:text_only', 0, ?, 1000, ?, 3600, 250000, ?, ?, NULL, ?, ?, 2)
        `).run(
            accountId, `L-${accountId}`, `sokuji1:${accountId}:L-${accountId}`,
            row.expiresAt, row.startedAt, row.reconciledAt, row.startedMask, row.endedMask
        );
    }

    it("releases a lease whose started legs have all ended but whose reconciled_at was never written", async () => {
        insertLease("done", {
            expiresAt: NOW + 3_600_000, startedAt: NOW - 60_000, reconciledAt: null,
            startedMask: 3, endedMask: 3,
        });
        expect(await svc.releaseSatisfiedOrExpired(NOW)).toBe(1);
        expect(readRow(sqlite, "done").reconciled_at).toBe(NOW);
    });

    it("leaves a lease whose second leg is still running", async () => {
        insertLease("live", {
            expiresAt: NOW + 3_600_000, startedAt: NOW - 60_000, reconciledAt: null,
            startedMask: 3, endedMask: 1,
        });
        expect(await svc.releaseSatisfiedOrExpired(NOW)).toBe(0);
        expect(readRow(sqlite, "live").reconciled_at).toBeNull();
    });

    it("leaves a lease that has never started, mask 0 and all", async () => {
        insertLease("unused", {
            expiresAt: NOW + 60_000, startedAt: null, reconciledAt: null,
            startedMask: 0, endedMask: 0,
        });
        expect(await svc.releaseSatisfiedOrExpired(NOW)).toBe(0);
    });

    it("does NOT release a lease that expired seconds ago — its usage log may still be in flight", async () => {
        insertLease("justgone", {
            expiresAt: NOW - 5_000, startedAt: NOW - 900_000, reconciledAt: null,
            startedMask: 1, endedMask: 0,
        });
        expect(await svc.releaseSatisfiedOrExpired(NOW)).toBe(0);
        expect(readRow(sqlite, "justgone").reconciled_at).toBeNull();
    });

    it("releases an ancient expired lease regardless of mask, so nothing is stranded forever", async () => {
        insertLease("ancient", {
            expiresAt: NOW - UNRECONCILED_LEASE_MAX_AGE_MS - 1, startedAt: 1000, reconciledAt: null,
            startedMask: 0, endedMask: 0,
        });
        expect(await svc.releaseSatisfiedOrExpired(NOW)).toBe(1);
        expect(readRow(sqlite, "ancient").reconciled_at).toBe(NOW);
    });

    it("does not touch a lease already reconciled", async () => {
        insertLease("gone", {
            expiresAt: NOW - UNRECONCILED_LEASE_MAX_AGE_MS - 1, startedAt: 1000, reconciledAt: NOW - 500,
            startedMask: 3, endedMask: 3,
        });
        expect(await svc.releaseSatisfiedOrExpired(NOW)).toBe(0);
        expect(readRow(sqlite, "gone").reconciled_at).toBe(NOW - 500);
    });
});
```

- [ ] **Step 17: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.sqlite.test.ts`

Expected: FAIL with `TypeError: svc.releaseSatisfiedOrExpired is not a function`

- [ ] **Step 18: Implement the backstop**

In `src/services/session-lease.ts`, add this method to `SessionLeaseService` directly after `noteStreamEnded`:

```ts
    /**
     * Backstop invoked on the 409 path -- a user is, right now, blocked on the
     * account's lease. Pure D1: it spends NO Soniox budget, so it can run ahead
     * of `blockedSweepLeaseQuery`'s gate without weakening the cron heartbeat's
     * zero-cost-when-idle guarantee.
     *
     * Two disjuncts, and the age bound on the second is load-bearing:
     *
     *  - Started legs have all ended. The session is over by definition; some
     *    combination of sweeps left `reconciled_at` unwritten anyway.
     *  - The lease expired at least UNRECONCILED_LEASE_MAX_AGE_MS ago. NOT "the
     *    lease expired": an expired lease already frees the ACCOUNT (see
     *    `acquire`'s WHERE), so no mask can lock a user out past expiry, while
     *    `reconciled_at` additionally decides whether the reconciler keeps
     *    LOOKING for the session's usage log. Reconciling a lease that expired
     *    seconds ago would let `unreconciledLeaseQuery` go false and stop the
     *    fast-retry ladder before Soniox posts the log -- losing the charge.
     *    The bound is the same age at which the ladder gives up anyway, so
     *    past it nothing is lost.
     *
     * Returns the number of leases freed, so a caller can log it.
     */
    async releaseSatisfiedOrExpired(now: number): Promise<number> {
        const res = await this.env.DATABASE.prepare(`
            UPDATE session_leases
            SET reconciled_at = ?
            WHERE reconciled_at IS NULL
              AND (
                    (stt_started_mask != 0 AND (stt_ended_mask & stt_started_mask) = stt_started_mask)
                 OR expires_at <= ?
              )
        `).bind(now, now - UNRECONCILED_LEASE_MAX_AGE_MS).run();
        return res.meta?.changes ?? 0;
    }
```

- [ ] **Step 19: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.sqlite.test.ts`

Expected: PASS

- [ ] **Step 20: Wire the sweep ports to the new methods**

In `src/services/soniox-reconcile.ts`, replace the `releaseLease` member of `SweepPorts` (line 261, as BE4 left it returning a row count):

```ts
    releaseLease(clientRefId: string, now: number): Promise<void>;
```

with:

```ts
    /** Record that ONE transcription stream ended, and release the lease when
     *  every stream that STARTED has ended. Takes the log's own reference --
     *  three- or four-segment -- because the role it carries is the only
     *  trustworthy "which leg ended" signal (Soniox attributes a log to the
     *  reference bound to the KEY, not the one the socket declares).
     *  `matched === 0` means no lease carries that base ref; `released` means
     *  the lease is reconciled now. */
    noteStreamEnded(clientRefId: string, now: number): Promise<StreamEndResult>;
    /** D1-only backstop for the 409 path: free every lease whose started legs
     *  have all ended, plus anything so long expired that no sweep will chase
     *  it again. Spends no Soniox budget. Returns the number freed. */
    releaseSatisfiedLeases(now: number): Promise<number>;
```

Extend that file's existing import from `./session-lease` to bring in `type StreamEndResult`.

Then replace `runSweepIfBlocked`'s body (lines 321–324):

```ts
export async function runSweepIfBlocked(ports: SweepPorts): Promise<SweepSummary | null> {
    if (!(await ports.hasReleasableLease())) return null;
    return runSweep(ports);
}
```

with:

```ts
export async function runSweepIfBlocked(ports: SweepPorts): Promise<SweepSummary | null> {
    // Backstop FIRST, and before the gate: it is a D1 write, not a Soniox
    // request, so it costs nothing from the token bucket, and it is the only
    // thing that can free a lease whose logs all arrived but whose release was
    // never written -- a sweep cannot, because it only ever reacts to a log it
    // is seeing for the first time. Deliberately NOT on the cron heartbeat's
    // path: this fires only when a real, authenticated user is blocked.
    const freed = await ports.releaseSatisfiedLeases(ports.now());
    if (freed > 0) {
        console.log(`SonioxReconciler: backstop released ${freed} lease(s) on the blocked path`);
    }
    if (!(await ports.hasReleasableLease())) return null;
    return runSweep(ports);
}
```

`blockedSweepLeaseQuery` itself is UNCHANGED: it answers "is spending a Soniox request worth it", which the backstop does not change.

- [ ] **Step 21: Switch the sweep's release call to the mask-aware port**

In `src/services/soniox-reconcile.ts`, inside the `if (kind === "stt") {` block (line 470 in the pre-BE4 file), replace BE4's release call and its counter increment with:

```ts
                    const { matched, released } = await ports.noteStreamEnded(clientRefId, sweepStartedAt);
                    if (released) releasedLeases++;
```

Keep BE4's "a managed stt log matched no lease" `console.error` and its once-per-sweep flag exactly as they are, changing only the condition that triggers it from BE4's row count to `matched === 0`. Extend the block's existing comment with:

```ts
                    // A split session emits TWO stt logs against ONE lease, and
                    // only the second releases it -- so `releasedLeases` counts
                    // leases freed, never logs processed.
```

- [ ] **Step 22: Rebind the ports in the Durable Object**

In `src/durable-objects/SonioxReconcilerDO.ts`, in `ports()` (line 141), replace:

```ts
            releaseLease: (clientRefId, now) => leaseService.release(clientRefId, now),
```

with:

```ts
            noteStreamEnded: (clientRefId, now) => leaseService.noteStreamEnded(clientRefId, now),
            releaseSatisfiedLeases: (now) => leaseService.releaseSatisfiedOrExpired(now),
```

`SessionLeaseService.release` stays: it is still the unconditional force-release `sessionKeyHandler` uses when Soniox key issuance fails.

- [ ] **Step 23: Typecheck and run the reconciler suites**

Run:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx tsc --noEmit && npx vitest run src/services/soniox-reconcile.test.ts src/services/soniox-reconcile.sqlite.test.ts
```

Expected: PASS. Any hand-written `SweepPorts` object in those two test files needs `noteStreamEnded: async () => ({ matched: 1, released: true })` and `releaseSatisfiedLeases: async () => 0` in place of its `releaseLease` stub; `tsc` names every one of them.

- [ ] **Step 24: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/session-lease.ts src/services/session-lease.sqlite.test.ts src/services/soniox-reconcile.ts src/services/soniox-reconcile.test.ts src/services/soniox-reconcile.sqlite.test.ts src/durable-objects/SonioxReconcilerDO.ts
git commit -m "$(cat <<'EOF'
feat(soniox): back the mask predicate with a 409-path backstop

runSweepIfBlocked now runs a pure-D1 pass that frees any lease whose
started legs have all ended, plus anything expired longer ago than the
reconciler's own give-up age. It spends no Soniox budget, and it is the
only thing that can free a lease whose logs all arrived but whose release
was never written — a sweep only ever reacts to a log it sees for the
first time.

The age bound is not cosmetic: reconciling a just-expired lease would let
hasUnreconciledLeases go false and stop the fast-retry ladder before the
usage log lands, losing the charge.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 25: Write the failing route tests for the optional role**

Append to `src/routes/soniox.test.ts`:

```ts
describe("sessionStartedHandler — the optional per-role body", () => {
    function handlerWithLease(markStarted: (...args: any[]) => Promise<boolean>) {
        const leaseSvc = { ...fakeLeaseService().svc, markStarted };
        return createSonioxHandlers({
            makeWalletService: () => fakeWallet(0) as any,
            makeSessionLeaseService: () => leaseSvc as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        }).sessionStartedHandler;
    }

    it("passes the declared role straight through to markStarted", async () => {
        let seen: any[] | undefined;
        const handler = handlerWithLease(async (...args: any[]) => { seen = args; return true; });
        const { c, calls } = makeCtx({ session: USER, body: { leaseId: "lease-123", role: "par_stt" } });

        await handler(c);

        expect(calls.json?.status).toBe(200);
        expect(seen?.slice(0, 3)).toEqual(["u1", "lease-123", "par_stt"]);
    });

    it("passes null when the client omits role — every shipped client posts { leaseId } alone", async () => {
        // Rejecting a roleless body would drop the lease extension of every
        // in-flight session the moment this deploys, leaving them to expire at
        // the ~75s start window mid-call.
        let seen: any[] | undefined;
        const handler = handlerWithLease(async (...args: any[]) => { seen = args; return true; });
        const { c, calls } = makeCtx({ session: USER, body: { leaseId: "lease-123" } });

        await handler(c);

        expect(calls.json?.status).toBe(200);
        expect(seen?.slice(0, 3)).toEqual(["u1", "lease-123", null]);
    });

    it("400s on a role outside the closed vocabulary instead of ORing nothing", async () => {
        let called = false;
        const handler = handlerWithLease(async () => { called = true; return true; });
        const { c, calls } = makeCtx({ session: USER, body: { leaseId: "lease-123", role: "spk" } });

        await handler(c);

        expect(calls.json?.status).toBe(400);
        expect(called).toBe(false);
    });

    it("400s on a TTS role, which carries no started bit by design", async () => {
        // A TTS started bit could never be cleared — a session may legitimately
        // produce zero TTS usage logs — so accepting one builds a lease that can
        // only ever be freed by a backstop.
        let called = false;
        const handler = handlerWithLease(async () => { called = true; return true; });
        const { c, calls } = makeCtx({ session: USER, body: { leaseId: "lease-123", role: "spk_tts" } });

        await handler(c);

        expect(calls.json?.status).toBe(400);
        expect(called).toBe(false);
    });
});
```

- [ ] **Step 26: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/soniox.test.ts`

Expected: FAIL — the first test errors at `expect(seen?.slice(0, 3)).toEqual(["u1", "lease-123", "par_stt"])` with `expected [ 'u1', 'lease-123', <timestamp> ] to deeply equal [ 'u1', 'lease-123', 'par_stt' ]`, because the handler still calls the three-argument form. The TTS-role test also fails with `expected 200 to be 400`.

- [ ] **Step 27: Implement the route change**

In `src/routes/soniox.ts`, extend the config import at lines 8–11:

```ts
import {
    MAX_SESSION_S, MIN_SESSION_S, KEY_START_WINDOW_S, ttsKeyExpiresInSeconds,
    skuForMode, usageTypesForMode, type SonioxMode,
    isSonioxStreamRole, sttRoleBit, type SonioxStreamRole,
} from "../config/soniox";
```

Then, in `sessionStartedHandler`, replace lines 336–342:

```ts
        if (leaseId.includes(":")) {
            return c.json({ error: "Invalid leaseId" }, 400);
        }

        const leaseService = deps.makeSessionLeaseService(c.env);
        const now = Date.now();
        const started = await leaseService.markStarted(userId, leaseId, now);
```

with:

```ts
        if (leaseId.includes(":")) {
            return c.json({ error: "Invalid leaseId" }, 400);
        }

        // OPTIONAL by contract, not by oversight: every currently-shipped client
        // posts `{ leaseId }` alone, and the backend deploys before they do.
        // Requiring the role would leave each of those sessions at the ~75s
        // start-window TTL and drop the lease mid-call. A missing role is
        // resolved to the legacy single-STT role by `markStarted`, which refuses
        // when the lease holds two streams rather than guessing a leg.
        //
        // A *_tts role is refused as hard as an unknown one: TTS roles carry no
        // started bit, because a session may legitimately produce zero TTS usage
        // logs, so a TTS bit could never be cleared and the lease would only
        // ever be freed by a backstop.
        const rawRole: unknown = body?.role;
        let role: SonioxStreamRole | null = null;
        if (rawRole !== undefined && rawRole !== null) {
            if (!isSonioxStreamRole(rawRole) || sttRoleBit(rawRole) === 0) {
                return c.json({ error: "Invalid role" }, 400);
            }
            role = rawRole;
        }

        const leaseService = deps.makeSessionLeaseService(c.env);
        const now = Date.now();
        // `started` means "this account really holds this lease right now" --
        // NOT "the expiry moved". markStarted's expiry is MAX()-ed, so a leg
        // reporting a shorter window still writes its row and still returns
        // true; that is the right question for the voice-slot gate below, which
        // only needs to know the lease is this caller's before pinning a slot to
        // its expiry.
        const started = await leaseService.markStarted(userId, leaseId, role, now);
```

Finally, update the fake at `src/routes/soniox.test.ts` line 151 so its arity matches the real service:

```ts
            markStarted: async (_accountId: string, _leaseId: string, _role: string | null, _now: number) => true,
```

- [ ] **Step 28: Run the whole suite and typecheck**

Run:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx tsc --noEmit && npm run test
```

Expected: PASS

- [ ] **Step 29: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/routes/soniox.ts src/routes/soniox.test.ts
git commit -m "$(cat <<'EOF'
feat(soniox): accept an optional per-stream role on session-started

{ leaseId, role } with role optional: the shipped clients post { leaseId }
alone and the backend deploys before they do, so requiring it would leave
every in-flight session at the ~75s start-window TTL. An unknown role and
a *_tts role are both 400 — a TTS role carries no started bit, so it would
build a lease nothing can ever release.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task BE7: Cost-based charging — `usdToMicroUsd(cost_usd) × K` with K = 2.0, opt-in per `ChargeRequest`, with a time-based floor

**Repo for this whole task: `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend`.** Every path below is relative to it; run every command from that directory.

**Files:**
- Modify: `src/services/pricing.ts` (module docstring lines 1–9; new constant + function after line 17)
- Modify: `src/services/billing-service.ts` (`ChargeRequest.sku` doc lines 8–16; destructure lines 40–44; amount block lines 46–53; metadata bind line 98)
- Modify: `src/services/soniox-reconcile.ts` (`classifyLog` doc lines 29–41; `buildCharge` doc + body lines 43–93; `isTerminalChargeError` lines 147–158; `SweepSummary` lines 235–248; `runSweep` counters lines 354–359, summary literal lines 379–382, unknown-model alarm lines 418–430)
- Modify: `src/routes/soniox.ts` (accepted-risk comment lines 246–273)
- Test: `src/services/pricing.test.ts`
- Test: `src/services/billing-service.test.ts`
- Test: `src/services/soniox-reconcile.test.ts`

**Interfaces:**
- Consumes (already exist, unchanged by this task): `usdToMicroUsd(usd: number): number`; `chargeMicroUsd(sku: string, billableSeconds: number): number`; `parseClientRefId(ref: string | null)`; `UsageLog { uuid, client_reference_id, model, start_time, end_time, input_audio_duration_ms, cost_usd: string }`.
- Produces:
  - `export const REVENUE_COEFFICIENT_K = 2.0` in `src/services/pricing.ts` — **the only definition of K in the worker.**
  - `export function costTimesKMicroUsd(providerCostMicroUsd: number): number` in `src/services/pricing.ts` — **the only place K is multiplied.**
  - `ChargeRequest.pricing?: "time" | "cost_times_k"` in `src/services/billing-service.ts`; absent means `"time"`.
  - New terminal error string returned by `BillingService.charge`: `"Cost-based charge requires providerCostMicroUsd"`.
  - `SweepSummary.zeroCostLogs: number` in `src/services/soniox-reconcile.ts`.
  - `buildCharge(log: UsageLog, leaseSku: string | null): ChargeRequest | null` — same signature, but now always returns `pricing: "cost_times_k"` and a non-null `sku`.

**Where the multiplication lives — decided, do not re-open.** `ChargeRequest` carries a **mode flag**, and `BillingService` applies K through `costTimesKMicroUsd`. `buildCharge` does **not** compute an amount and `ChargeRequest` gains **no** `amount` field. Splitting it (an amount computed in one place, K read in another) is exactly how K ends up defined twice.

**Precedence when both a `sku` and a usable cost are present:** `pricing` wins outright. Under `"cost_times_k"` the `sku` **no longer sets the price**; it survives only as (a) the rate source for the zero-cost floor and (b) the `metadata.sku` label. Under `"time"` (or an absent `pricing`) behaviour is byte-identical to today, `sku: null` included.

**The floor is a zero-replacement, not a `Math.max`.** A usable cost is used as-is even when it is below today's list price — that is the point of the move, and taking `max()` with the list rate would keep every user at today's price and make the cost model decorative. It also contradicts the pinned expectation that an existing single-stream user is typically charged **less** than today.

**Consequences this task accepts — put these in the PR description, do not let a reviewer discover them:**
- The ledger's human-readable description is built from `billableSeconds`, and a Soniox TTS row keeps `billableSeconds: 0`, so a **charged** TTS row reads `Usage: soniox/tts-rt-v1 0s` in user-visible history while a real amount was deducted.
- The admin **margin KPI degenerates to `cost × (K − 1)`** for Soniox rows and stops being an independent observable; it is a restatement of K.
- **`metadata.sku` loses meaning for Soniox rows** — it is a label, not what the row was priced at.
- The unknown-model alarm's claim that an unrecognised prefix "bills the user ZERO at full provider cost" **becomes false**: the log is still charged `cost × K`. The alarm's remaining teeth are lease release, not revenue.
- Two existing tests change **by construction**, not as regressions: `soniox-reconcile.test.ts` → "records the TTS entry as a cost-only row so the user is not charged twice" (rewritten in Step 11), and nothing else. Every other existing test in all three files must still pass untouched — that is the evidence that openai and volcengine are unaffected.

**If BE4 has already landed** (it precedes this task), `classifyLog` takes an optional second `role` argument and `runSweep`'s release/unpin has moved out of the charge-succeeded branch. Neither affects the edits below: keep whatever second argument BE4 added at each `classifyLog` call site and change only the lines quoted here.

---

- [ ] **Step 1: Write the failing test for K and the cost→charge conversion**

Edit `src/services/pricing.test.ts`. Replace the import block (lines 1–7):

```ts
import { describe, it, expect } from "vitest";
import {
    RATE_USD_PER_HOUR,
    chargeMicroUsd,
    usdToMicroUsd,
    minBalanceMicroUsd,
} from "./pricing";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
    RATE_USD_PER_HOUR,
    REVENUE_COEFFICIENT_K,
    chargeMicroUsd,
    costTimesKMicroUsd,
    usdToMicroUsd,
    minBalanceMicroUsd,
} from "./pricing";
```

and append at the end of the file:

```ts
describe("REVENUE_COEFFICIENT_K", () => {
    it("is the single agreed revenue coefficient over provider cost", () => {
        expect(REVENUE_COEFFICIENT_K).toBe(2.0);
    });
});

describe("costTimesKMicroUsd", () => {
    it("multiplies the provider's cost by K", () => {
        // 0.05134800 USD of Soniox STT -> 51_348 µUSD of cost -> 102_696 µUSD charged.
        expect(costTimesKMicroUsd(51_348)).toBe(102_696);
        expect(costTimesKMicroUsd(1)).toBe(2);
    });

    it("rounds up so a partial micro-dollar is never given away", () => {
        // K itself cannot produce a fraction, but a caller can hand us one
        // (e.g. an unrounded `cost_usd * 1e6`), and the same rule as
        // chargeMicroUsd must apply.
        expect(costTimesKMicroUsd(0.5)).toBe(1);
        expect(costTimesKMicroUsd(1.5)).toBe(3);
    });

    it("returns zero for a non-positive or non-finite cost, signalling 'unusable'", () => {
        // Zero is the contract for "this cost figure cannot price the row";
        // BillingService reads it as the trigger for the time-based floor.
        expect(costTimesKMicroUsd(0)).toBe(0);
        expect(costTimesKMicroUsd(-10)).toBe(0);
        expect(costTimesKMicroUsd(NaN)).toBe(0);
        expect(costTimesKMicroUsd(Infinity)).toBe(0);
    });

    it("is the only place K is applied: the function agrees with the constant", () => {
        // If someone ever hardcodes a second 2.0 elsewhere, this is the
        // assertion that keeps THIS one honest.
        expect(costTimesKMicroUsd(1_000_000)).toBe(Math.ceil(1_000_000 * REVENUE_COEFFICIENT_K));
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/pricing.test.ts`

Expected: FAIL. Vitest reports a transform/import error naming the missing bindings, e.g. `SyntaxError: The requested module './pricing' does not provide an export named 'REVENUE_COEFFICIENT_K'` (and `costTimesKMicroUsd`), so the whole file fails to load.

- [ ] **Step 3: Implement K and `costTimesKMicroUsd` in `src/services/pricing.ts`**

Replace the module docstring, lines 1–9:

```ts
/**
 * Pricing for usage-based wallet deduction.
 *
 * Users are charged by TIME at a per-SKU list price. What a provider charges us
 * is recorded separately on the ledger (`provider_cost_micro_usd`) so margin is
 * an observable quantity rather than a hardcoded multiplier.
 *
 * All money is integer micro-USD: 1 USD = 1,000,000 µUSD.
 */
```

with:

```ts
/**
 * Pricing for usage-based wallet deduction.
 *
 * TWO pricing modes exist, and the caller picks one EXPLICITLY via
 * `ChargeRequest.pricing`:
 *
 *  - `"time"` — the default, and the only mode the openai and volcengine
 *    relays use: charged by TIME at a per-SKU list price from
 *    `RATE_USD_PER_HOUR`. Unchanged in every respect.
 *  - `"cost_times_k"` — Soniox only: charged at what the provider charged us,
 *    multiplied by `REVENUE_COEFFICIENT_K`.
 *
 * CORRECTION to what this docstring used to claim. Margin is an observable
 * quantity only under `"time"`. Under `"cost_times_k"` a row's
 * `amount_micro_usd` is its `provider_cost_micro_usd` scaled by K, so the admin
 * margin KPI degenerates to `cost x (K - 1)` for those rows: it restates K
 * rather than measuring anything. Do not read a healthy Soniox margin as
 * evidence that pricing is working.
 *
 * All money is integer micro-USD: 1 USD = 1,000,000 µUSD.
 */
```

Then insert immediately after line 17 (`export const MICRO_USD_PER_USD = 1_000_000;`):

```ts
/**
 * The revenue coefficient over provider cost, for `"cost_times_k"` pricing.
 *
 * DEFINED EXACTLY ONCE, ON PURPOSE. Every multiplication by K in this worker
 * goes through `costTimesKMicroUsd` below. A second literal `2.0` anywhere else
 * is the precise failure this constant exists to prevent: the two copies would
 * be re-priced independently and nothing in the system would notice the
 * divergence, because both would keep producing plausible money.
 *
 * Budgeting deliberately does NOT read this constant. How long a session is
 * GRANTED comes from a separate conservative-rate table, because one number
 * serving both "what we charge" and "how long we grant" drifts silently.
 */
export const REVENUE_COEFFICIENT_K = 2.0;

/**
 * What the user pays, in µUSD, for a provider cost of `providerCostMicroUsd`.
 *
 * Rounds UP for the same reason `chargeMicroUsd` does: a partial micro-dollar
 * is never given away.
 *
 * Returns 0 for a non-positive or non-finite input, and that zero is a
 * CONTRACT, not an accident: it is how a caller learns the provider's cost
 * figure was unusable. `BillingService.charge` reads it as the trigger for the
 * time-based floor, so a log with real audio behind it is never billed zero.
 */
export function costTimesKMicroUsd(providerCostMicroUsd: number): number {
    if (!Number.isFinite(providerCostMicroUsd) || providerCostMicroUsd <= 0) return 0;
    return Math.ceil(providerCostMicroUsd * REVENUE_COEFFICIENT_K);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/services/pricing.test.ts`

Expected: PASS (all describes green, including the pre-existing `RATE_USD_PER_HOUR`, `chargeMicroUsd`, `usdToMicroUsd` and `minBalanceMicroUsd` blocks).

- [ ] **Step 5: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/pricing.ts src/services/pricing.test.ts
git commit -m "feat(billing): define the revenue coefficient K in exactly one place

K = 2.0 and costTimesKMicroUsd are the sole definition and the sole
application of the cost multiplier. Corrects the module docstring's claim
that margin is an independent observable: under cost x K it degenerates to
cost x (K-1) for those rows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 6: Write the failing tests for opt-in cost pricing in `BillingService`**

Append these cases inside the existing `describe("BillingService.charge", ...)` block in `src/services/billing-service.test.ts`, just before its closing `});`:

```ts
    it("charges provider cost x K when pricing is cost_times_k", async () => {
        const { env, row } = makeEnv(1_000_000);
        const svc = new BillingService(env);
        const r = await svc.charge({
            ...base, sku: "soniox:text_only", billableSeconds: 720.426,
            providerCostMicroUsd: 51_348, pricing: "cost_times_k", externalId: "e1",
        });
        expect(r.success).toBe(true);
        expect(r.chargedMicroUsd).toBe(102_696);
        expect(row.balance_micro_usd).toBe(897_304);
    });

    it("lets a cheap cost undercut the list rate — cost x K is a floor, not a maximum", async () => {
        // 720.426s at soniox:text_only ($0.60/hr) would be 120_072 µUSD under
        // time pricing; cost x K is 102_696. The user pays LESS. If this ever
        // reads 120_072, someone has turned the floor into a Math.max and the
        // cost model has become decorative.
        const { env } = makeEnv(1_000_000);
        const svc = new BillingService(env);
        const r = await svc.charge({
            ...base, sku: "soniox:text_only", billableSeconds: 720.426,
            providerCostMicroUsd: 51_348, pricing: "cost_times_k", externalId: "e1",
        });
        expect(r.chargedMicroUsd).toBe(102_696);
        expect(r.chargedMicroUsd).toBeLessThan(chargeMicroUsd("soniox:text_only", 720.426));
    });

    it("falls back to the time-based charge when the provider cost is unusable", async () => {
        // Soniox reported no cost for a log that carried real audio. Billing
        // zero would silently give the session away; the SKU rate is the floor.
        const { env, row } = makeEnv(1_000_000);
        const svc = new BillingService(env);
        const r = await svc.charge({
            ...base, sku: "soniox:text_only", billableSeconds: 3600,
            providerCostMicroUsd: 0, pricing: "cost_times_k", externalId: "e1",
        });
        expect(r.chargedMicroUsd).toBe(600_000);
        expect(row.balance_micro_usd).toBe(400_000);
    });

    it("floors a zero-duration row at zero, not at a session rate", async () => {
        // A Soniox tts log carries billableSeconds: 0 because its
        // input_audio_duration_ms is GENERATED speech, not session wall-clock.
        // Charging that at a per-hour session rate would not be a floor but an
        // unrelated number, so the floor must land on 0 here.
        const { env, row } = makeEnv(1_000_000);
        const svc = new BillingService(env);
        const r = await svc.charge({
            ...base, sku: "soniox:speech_to_speech", model: "tts-rt-v1",
            billableSeconds: 0, providerCostMicroUsd: 0,
            pricing: "cost_times_k", externalId: "e1",
        });
        expect(r.success).toBe(true);
        expect(r.chargedMicroUsd).toBe(0);
        expect(row.balance_micro_usd).toBe(1_000_000);
    });

    it("refuses cost pricing with no cost field at all, with a terminal-classifiable message", async () => {
        // A caller bug, not a bad provider figure. The message prefix is
        // load-bearing: isTerminalChargeError classifies by prefix and treats
        // anything unrecognised as RETRYABLE, which would wedge the Soniox
        // reconciler's watermark and stop billing for EVERY account.
        const { env, row } = makeEnv(1_000_000);
        const svc = new BillingService(env);
        const r = await svc.charge({
            ...base, sku: "soniox:text_only", billableSeconds: 3600,
            pricing: "cost_times_k", externalId: "e1",
        });
        expect(r.success).toBe(false);
        expect(r.error).toBe("Cost-based charge requires providerCostMicroUsd");
        expect(row.balance_micro_usd).toBe(1_000_000);
    });

    it("ignores the provider cost entirely when pricing is omitted", async () => {
        // This is the proof that openai and volcengine are untouched: both
        // relays pass providerCostMicroUsd and neither passes `pricing`, so
        // both must still be charged at their SKU's list rate.
        const { env, row } = makeEnv(3_000_000);
        const svc = new BillingService(env);
        const r = await svc.charge({
            ...base, provider: "openai", sku: "openai:realtime_translate",
            model: "gpt-realtime-translate", billableSeconds: 3600,
            providerCostMicroUsd: 2_040_000, externalId: "e1",
        });
        expect(r.chargedMicroUsd).toBe(2_500_000);   // list rate, not 4_080_000
        expect(row.balance_micro_usd).toBe(500_000);
    });

    it("records the pricing mode on the ledger row so a Soniox row is self-describing", async () => {
        // metadata.sku stops describing what a Soniox row was priced at, so the
        // mode has to be on the row or nobody can reconstruct the price later.
        const { env, calls } = makeEnv(1_000_000);
        const svc = new BillingService(env);
        await svc.charge({
            ...base, sku: "soniox:text_only", billableSeconds: 90,
            providerCostMicroUsd: 6632, pricing: "cost_times_k", externalId: "e1",
        });
        const insert = calls.find((c) => c.sql.includes("INSERT") && c.sql.includes("wallet_ledger"))!;
        // metadata is bind #8 (index 7).
        expect(JSON.parse(insert.binds[7]).pricing).toBe("cost_times_k");
    });

    it("records the default pricing mode for a time-priced row", async () => {
        const { env, calls } = makeEnv(1_000_000);
        const svc = new BillingService(env);
        await svc.charge({
            ...base, sku: "soniox:text_only", billableSeconds: 90, externalId: "e1",
        });
        const insert = calls.find((c) => c.sql.includes("INSERT") && c.sql.includes("wallet_ledger"))!;
        expect(JSON.parse(insert.binds[7]).pricing).toBe("time");
    });
```

Also extend the import at the top of that file (line 2):

```ts
import { BillingService } from "./billing-service";
```

to:

```ts
import { BillingService } from "./billing-service";
import { chargeMicroUsd } from "./pricing";
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run src/services/billing-service.test.ts`

Expected: FAIL. TypeScript/vitest rejects `pricing` as an unknown property on `ChargeRequest` (`Object literal may only specify known properties, and 'pricing' does not exist in type 'ChargeRequest'`), and at runtime "charges provider cost x K…" reports `expected 102696, received 120072` because the SKU rate is still applied.

- [ ] **Step 8: Implement the pricing mode in `src/services/billing-service.ts`**

Change the import, line 1:

```ts
import { chargeMicroUsd } from "./pricing";
```

to:

```ts
import { chargeMicroUsd, costTimesKMicroUsd } from "./pricing";
```

Replace the `sku` field doc, lines 8–16:

```ts
    /** Provider family, for grouping and description text. */
    provider: string;
    /**
     * Billing SKU that sets the rate. `null` writes a cost-only row: it records
     * what a provider charged us for work already billed under another row
     * (e.g. the TTS half of a Soniox speech-to-speech session), without
     * charging the user twice.
     */
    sku: string | null;
```

with:

```ts
    /** Provider family, for grouping and description text. */
    provider: string;
    /**
     * Billing SKU.
     *
     * Under `"time"` pricing it SETS THE RATE, and `null` writes a cost-only
     * row: what a provider charged us for work already billed under another
     * row, without charging the user twice.
     *
     * CORRECTION: the Soniox TTS log is no longer such a row. Under
     * `"cost_times_k"` every log carries its own cost and is charged on it, so
     * there is no double-charge left to avoid and the cost-only special case is
     * dissolved. Under that mode `sku` does NOT set the price — it is only the
     * rate source for the zero-cost floor and the `metadata.sku` label, which
     * for Soniox rows therefore no longer describes what the row was priced at.
     * `null` stays available for any future caller that genuinely wants a
     * zero-amount row.
     */
    sku: string | null;
    /**
     * How to price this charge. ABSENT MEANS `"time"`, and that default is the
     * proof that the openai and volcengine relays are untouched: neither passes
     * this field, so neither can reach the cost branch at all.
     *
     * PRECEDENCE when both a `sku` and a usable cost are present: `pricing`
     * wins outright. See `sku` above for what it degrades to.
     */
    pricing?: "time" | "cost_times_k";
```

Replace the destructure, lines 40–44:

```ts
        const {
            subjectType, subjectId, provider, sku, model,
            billableSeconds, providerCostMicroUsd,
            externalId, sessionRef, occurredAt, metadata,
        } = request;
```

with:

```ts
        const {
            subjectType, subjectId, provider, sku, model,
            billableSeconds, providerCostMicroUsd, pricing,
            externalId, sessionRef, occurredAt, metadata,
        } = request;
```

Replace the amount block, lines 46–53:

```ts
        // 1. What to deduct. A null SKU is a cost-only row and charges nothing.
        let amount: number;
        try {
            amount = sku === null ? 0 : chargeMicroUsd(sku, billableSeconds);
        } catch (e) {
            // Unknown SKU: surface it rather than silently billing zero.
            return { success: false, error: (e as Error).message };
        }
```

with:

```ts
        // 1. What to deduct. `pricing` is opt-in and defaults to "time", so
        //    every caller that predates cost-based pricing takes the identical
        //    branch it always took, with the identical result.
        let amount: number;
        try {
            if (pricing === "cost_times_k") {
                if (providerCostMicroUsd == null) {
                    // A caller bug, not a bad provider figure: cost-based
                    // pricing with no cost at all can never be priced, and no
                    // number of retries adds the field. The message prefix is
                    // load-bearing — `isTerminalChargeError` classifies by
                    // prefix and treats ANYTHING UNRECOGNISED AS RETRYABLE, so
                    // an unclassified string here makes the Soniox reconciler
                    // throw, hold its watermark, re-derive the identical window
                    // and re-fetch this same log forever, halting billing for
                    // EVERY account. Introducing a new failure string and
                    // classifying it must happen in the same commit.
                    return { success: false, error: "Cost-based charge requires providerCostMicroUsd" };
                }
                const costBased = costTimesKMicroUsd(providerCostMicroUsd);
                // FLOOR, NOT A MAXIMUM. A usable cost is used as-is even when it
                // is below the SKU's list price — that is the entire point of
                // moving to cost x K, and a Math.max here would pin every user
                // at today's price and make the cost model decorative. The
                // time-based charge is reached ONLY when the provider's figure
                // is unusable (<= 0, which is also what an unparseable
                // `cost_usd` becomes upstream via `usdToMicroUsd`), so a log
                // with real audio behind it never bills zero. When
                // `billableSeconds` is 0 the floor is legitimately 0: a Soniox
                // tts log's duration is generated speech, not session
                // wall-clock, and charging it at a per-hour session rate would
                // not be a floor but an unrelated number. The caller alarms on
                // that case — see `SweepSummary.zeroCostLogs`.
                amount = costBased > 0
                    ? costBased
                    : (sku === null ? 0 : chargeMicroUsd(sku, billableSeconds));
            } else {
                amount = sku === null ? 0 : chargeMicroUsd(sku, billableSeconds);
            }
        } catch (e) {
            // Unknown SKU: surface it rather than silently billing zero.
            return { success: false, error: (e as Error).message };
        }
```

Finally replace the metadata bind, line 98:

```ts
            JSON.stringify({ ...metadata, provider, sku, model }),
```

with:

```ts
            // `pricing` is written explicitly (defaulted, never left undefined)
            // because `sku` stops describing what a cost-priced row was priced
            // at; without the mode on the row, a past charge cannot be
            // reconstructed from the ledger at all.
            JSON.stringify({ ...metadata, provider, sku, model, pricing: pricing ?? "time" }),
```

- [ ] **Step 9: Run it and watch it pass**

Run: `npx vitest run src/services/billing-service.test.ts`

Expected: PASS — all pre-existing cases plus the eight new ones.

- [ ] **Step 10: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/billing-service.ts src/services/billing-service.test.ts
git commit -m "feat(billing): opt-in cost x K pricing with a time-based floor

ChargeRequest.pricing defaults to \"time\", so the openai and volcengine
relays cannot reach the new branch. Under \"cost_times_k\" the sku no longer
sets the price; an unusable provider cost falls back to the SKU rate as a
floor rather than billing zero. A missing cost field returns a terminal
error string, classified in the same series of commits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 11: Write the failing tests for `buildCharge` — the TTS cost-only row dissolves**

In `src/services/soniox-reconcile.test.ts`, replace the existing case at lines 43–50:

```ts
    it("records the TTS entry as a cost-only row so the user is not charged twice", () => {
        const c = buildCharge(ttsLog, "soniox:speech_to_speech")!;
        expect(c.sku).toBeNull();
        expect(c.billableSeconds).toBe(0);
        expect(c.providerCostMicroUsd).toBe(30_000);
        expect(c.externalId).toBe("u-tts");
        expect(c.sessionRef).toBe("acct1:L1");
    });
```

with:

```ts
    it("charges the TTS entry on its own cost — the cost-only row is dissolved", () => {
        // Under cost x K there is no double-charge left to avoid: the STT log
        // is priced on STT cost and the TTS log on TTS cost, so `sku: null` /
        // amount 0 would simply give the TTS spend away.
        const c = buildCharge(ttsLog, "soniox:speech_to_speech")!;
        expect(c.pricing).toBe("cost_times_k");
        expect(c.sku).toBe("soniox:speech_to_speech");
        expect(c.providerCostMicroUsd).toBe(30_000);
        expect(c.externalId).toBe("u-tts");
        expect(c.sessionRef).toBe("acct1:L1");
        // Still zero, on purpose: a tts log's input_audio_duration_ms is
        // GENERATED speech, not session wall-clock. The visible cost is that
        // this row's ledger description reads "0s" while a real amount moved.
        expect(c.billableSeconds).toBe(0);
    });

    it("asks for cost-based pricing on the STT entry too", () => {
        const c = buildCharge(sttLog, "soniox:speech_to_speech")!;
        expect(c.pricing).toBe("cost_times_k");
        expect(c.providerCostMicroUsd).toBe(51_348);
    });

    it("keeps a sku on every log as the floor's rate source", () => {
        // The sku no longer prices the row, but it is the ONLY thing that can
        // price the degenerate zero-cost case, so it must never be null again.
        expect(buildCharge(sttLog, "soniox:speech_to_speech")!.sku).toBe("soniox:speech_to_speech");
        expect(buildCharge(ttsLog, null)!.sku).toBe("soniox:text_only");
    });
```

And append to the existing `describe("isTerminalChargeError", ...)` block, before its closing `});`:

```ts
    it("treats a cost-based charge with no cost figure as terminal", () => {
        // The default for an unrecognised string is RETRYABLE, which is right
        // for a D1 blip and catastrophic for this: runSweep would throw, hold
        // the watermark, and re-fetch the same poison log forever, halting
        // billing for every account. A new failure string must be named here in
        // the commit that introduces it.
        expect(isTerminalChargeError("Cost-based charge requires providerCostMicroUsd")).toBe(true);
    });
```

- [ ] **Step 12: Run it and watch it fail**

Run: `npx vitest run src/services/soniox-reconcile.test.ts`

Expected: FAIL with three failures: `charges the TTS entry on its own cost` → `expected null to be 'soniox:speech_to_speech'`; `asks for cost-based pricing on the STT entry too` → `expected undefined to be 'cost_times_k'`; `treats a cost-based charge with no cost figure as terminal` → `expected false to be true`.

- [ ] **Step 13: Implement `buildCharge` and `isTerminalChargeError` in `src/services/soniox-reconcile.ts`**

Replace the `buildCharge` docstring and its return literal, lines 43–93. Before:

```ts
/**
 * Turn one Soniox usage log into a billing charge, or `null` if the log
 * isn't ours (BYOK traffic and manual testing share the org's log stream).
 *
 * Only the `'stt'` entry is charged at the lease's SKU rate, on its own
 * audio duration. A `'tts'` (or unrecognized `'other'`) entry becomes a
 * cost-only row -- `sku: null`, `billableSeconds: 0` -- so `BillingService`
 * records what Soniox charged us (margin visibility) without touching the
 * user's balance. Adding a TTS log's duration to billable time would
 * double-charge: it measures generated speech, not session wall-clock.
 *
 * `leaseSku` is `null` when the lease has already expired/been reconciled by
 * the time this log arrives; falling back to the cheaper `text_only` SKU
 * under-charges rather than over-charges in that case.
 */
export function buildCharge(log: UsageLog, leaseSku: string | null): ChargeRequest | null {
```

After:

```ts
/**
 * Turn one Soniox usage log into a billing charge, or `null` if the log
 * isn't ours (BYOK traffic and manual testing share the org's log stream).
 *
 * EVERY log is charged, on its OWN provider cost, at `cost x K`
 * (`pricing: "cost_times_k"`). The old `'tts'`/`'other'` cost-only branch
 * -- `sku: null`, amount 0 -- is gone: it existed only to avoid double-charging
 * a TTS socket whose session was already billed by wall-clock, and per-log cost
 * pricing has no such double to avoid. One key can back many successive TTS
 * sockets and therefore many logs; a per-log coefficient handles that
 * naturally.
 *
 * `sku` is kept on every charge, and is deliberately never null now, because
 * it is the ONLY rate source for the zero-cost floor in `BillingService`. It no
 * longer describes what the row was priced at, which is why `metadata.sku` is
 * a label rather than a price for Soniox rows.
 *
 * `billableSeconds` stays 0 for a non-STT log. That is what restricts the floor
 * to STT: a TTS log's `input_audio_duration_ms` measures GENERATED speech, not
 * session wall-clock, so pricing it at a per-hour session rate would not be a
 * floor but an unrelated number. The accepted cost is that a charged TTS ledger
 * row's human-readable description reads `... 0s` in user-visible history.
 *
 * `leaseSku` is `null` when the lease has already expired/been reconciled by
 * the time this log arrives; falling back to the cheaper `text_only` SKU
 * under-charges rather than over-charges in that degenerate case.
 */
export function buildCharge(log: UsageLog, leaseSku: string | null): ChargeRequest | null {
```

Then, inside the same function, replace these three lines of the returned object (currently lines 80–82):

```ts
        sku: isStt ? (leaseSku ?? "soniox:text_only") : null,
        model: log.model,
        billableSeconds: isStt ? log.input_audio_duration_ms / 1000 : 0,
```

with:

```ts
        sku: leaseSku ?? "soniox:text_only",
        pricing: "cost_times_k",
        model: log.model,
        billableSeconds: isStt ? log.input_audio_duration_ms / 1000 : 0,
```

Next replace the `classifyLog` docstring, lines 29–41. Before:

```ts
/** Separate the two usage-log streams one speech-to-speech session emits.
 *  Only the STT entry represents session wall-clock; the TTS entry's
 *  `input_audio_duration_ms` is generated speech, unrelated to session
 *  length (see `buildCharge`).
 *
 *  `'other'` is an ALARM condition, not a routine branch — see
 *  `runSweep`. If Soniox ever renamed the STT prefix every session would land
 *  here, billing zero at full provider cost. */
```

After:

```ts
/** Separate the two usage-log streams one speech-to-speech session emits.
 *  Only the STT entry represents session wall-clock; the TTS entry's
 *  `input_audio_duration_ms` is generated speech, unrelated to session
 *  length (see `buildCharge`).
 *
 *  `'other'` is still an ALARM condition, not a routine branch — see
 *  `runSweep` — but for a NARROWER reason than it used to be. Under cost-based
 *  pricing an unrecognised prefix is still charged (`cost x K`), so it no
 *  longer bills zero at full provider cost. What it still costs is the LEASE:
 *  only an `'stt'` log is treated as proof the session ended. */
```

Finally, add the new terminal classification inside `isTerminalChargeError`, immediately after the `No rate configured` line (currently line 156) and before `return false;`:

```ts
    // billing-service.ts: `Cost-based charge requires providerCostMicroUsd`.
    // A log that reaches cost-based pricing with no cost field at all is a
    // caller bug, and will be one again on every retry. Named explicitly rather
    // than left to the default, because the default below is RETRYABLE: an
    // unrecognised failure string makes `runSweep` throw, hold the watermark,
    // re-derive the identical window and re-fetch this same log forever, which
    // stops billing for EVERY account and not just this one. The default stays
    // retryable on purpose (a D1 blip must be retried); the discipline is that
    // any NEW failure mode is named here in the same commit that creates it.
    if (error.startsWith("Cost-based charge")) return true;
```

- [ ] **Step 14: Run it and watch it pass**

Run: `npx vitest run src/services/soniox-reconcile.test.ts`

Expected: PASS for the `buildCharge` and `isTerminalChargeError` describes. (The `runSweep` describes still pass too — nothing there has changed yet.)

- [ ] **Step 15: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/soniox-reconcile.ts src/services/soniox-reconcile.test.ts
git commit -m "feat(soniox): price every usage log on its own cost

buildCharge asks for cost x K on every log, dissolving the tts cost-only
row: with per-log cost pricing there is no double-charge left to avoid.
billableSeconds stays 0 for tts so the floor cannot price generated speech
as session wall-clock. isTerminalChargeError classifies the new cost-mode
failure string, which the retryable default would otherwise turn into a
reconciler-wide stall.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 16: Write the failing tests for the zero-cost alarm and its sweep counter**

Append to `src/services/soniox-reconcile.test.ts`, at the end of the file:

```ts
describe("runSweep — cost-based pricing", () => {
    it("asks for cost pricing on every log it charges", async () => {
        const h = makeHarness({
            pages: [{ logs: [makeLog({ uuid: "u-stt" }), makeLog({ uuid: "u-tts", model: "tts-rt-v1" })] }],
        });
        await runSweep(h.ports);
        expect(h.charges.map((c) => c.pricing)).toEqual(["cost_times_k", "cost_times_k"]);
    });

    it("counts every log with audio but no usable cost, and alarms once per sweep", async () => {
        // clampWindow deliberately re-covers the last 60s, so a boundary log is
        // re-processed on every sweep; an unguarded alarm would be a per-minute
        // log flood. Same guard shape as the unknown-model alarm.
        const errors = captureErrors();
        const h = makeHarness({
            pages: [{
                logs: [
                    makeLog({ uuid: "u-nocost", cost_usd: "0.0000000000", end_time: "2026-07-25T11:10:00.000Z" }),
                    makeLog({ uuid: "u-badcost", cost_usd: "not-a-number", end_time: "2026-07-25T11:11:00.000Z" }),
                    makeLog({ uuid: "u-fine", end_time: "2026-07-25T11:12:00.000Z" }),
                ],
            }],
        });

        const summary = await runSweep(h.ports);

        expect(summary.zeroCostLogs).toBe(2);
        expect(summary.charged).toBe(3);          // the floor charges them, never zero
        expect(summary.unknownModels).toBe(0);    // a different failure, a different counter

        const written = errors.mock.calls.map((c) => String(c[0])).join("\n");
        expect(written).toContain("u-nocost");
        expect(written).toContain("cost_usd");
        expect(written).not.toContain("u-badcost"); // once-per-sweep guard
    });

    it("does not alarm on a zero-cost log that also carried no audio", async () => {
        // A tts log routinely reports input_audio_duration_ms: 0, and a zero
        // cost there is unremarkable. Counting it would drown the real signal.
        const errors = captureErrors();
        const h = makeHarness({
            pages: [{
                logs: [makeLog({
                    uuid: "u-silent-tts", model: "tts-rt-v1",
                    input_audio_duration_ms: 0, cost_usd: "0.0000000000",
                })],
            }],
        });

        const summary = await runSweep(h.ports);
        expect(summary.zeroCostLogs).toBe(0);
        const written = errors.mock.calls.map((c) => String(c[0])).join("\n");
        expect(written).not.toContain("u-silent-tts");
    });

    it("writes off a cost-mode failure instead of wedging the whole reconciler", async () => {
        // The concrete catastrophe this task exists to prevent: one bad log
        // classified retryable holds the watermark and stops billing for every
        // account. It must be written off and the sweep must reach the next log.
        captureErrors();
        const h = makeHarness({
            watermark: "2026-07-25T11:00:00.000Z",
            pages: [{
                logs: [
                    makeLog({ uuid: "u-nocostfield", end_time: "2026-07-25T11:10:00.000Z" }),
                    makeLog({ uuid: "u-next", client_reference_id: "sokuji1:other-acct:L2", end_time: "2026-07-25T11:20:00.000Z" }),
                ],
            }],
            charge: (req) => req.externalId === "u-nocostfield"
                ? { success: false, error: "Cost-based charge requires providerCostMicroUsd" }
                : { success: true },
        });

        const summary = await runSweep(h.ports);
        expect(summary.terminalFailures).toBe(1);
        expect(summary.charged).toBe(1);
        expect(Date.parse(summary.watermark!))
            .toBeGreaterThanOrEqual(Date.parse("2026-07-25T11:20:00.000Z"));
    });
});
```

- [ ] **Step 17: Run it and watch it fail**

Run: `npx vitest run src/services/soniox-reconcile.test.ts -t "cost-based pricing"`

Expected: FAIL — `counts every log with audio but no usable cost, and alarms once per sweep` reports `expected undefined to be 2` for `summary.zeroCostLogs` (and TypeScript flags `zeroCostLogs` as absent from `SweepSummary`).

- [ ] **Step 18: Implement the counter and the alarm in `src/services/soniox-reconcile.ts`**

Add the field to `SweepSummary`, immediately after the `unknownModels` field (currently lines 240–243):

```ts
    /** Logs whose model matched neither `stt-` nor `tts-`. Any non-zero value
     *  here means revenue is being recorded as zero against a real cost. */
    unknownModels: number;
    /** Logs that carried real audio but no usable `cost_usd`, so cost-based
     *  pricing could not price them and the time-based SKU rate was used as a
     *  floor instead. Non-zero means our revenue for those rows is a fallback
     *  ESTIMATE rather than `cost x K`, and probably that Soniox changed the
     *  shape of the `cost_usd` field. Its own counter, separate from
     *  `unknownModels`: an unrecognised MODEL and an unusable COST are
     *  different failures with different fixes. */
    zeroCostLogs: number;
```

Replace the counter declarations, lines 354–360:

```ts
    let processed = 0;
    let charged = 0;
    let releasedLeases = 0;
    let terminalFailures = 0;
    let unknownModels = 0;
    let unknownModelReported = false;
    let cursor: string | undefined;
```

with:

```ts
    let processed = 0;
    let charged = 0;
    let releasedLeases = 0;
    let terminalFailures = 0;
    let unknownModels = 0;
    let unknownModelReported = false;
    let zeroCostLogs = 0;
    let zeroCostReported = false;
    let cursor: string | undefined;
```

Replace the summary literal, lines 379–382:

```ts
    const summary = (budgetExhausted: boolean): SweepSummary => ({
        processed, charged, releasedLeases, terminalFailures, unknownModels,
        watermark, budgetExhausted,
    });
```

with:

```ts
    const summary = (budgetExhausted: boolean): SweepSummary => ({
        processed, charged, releasedLeases, terminalFailures, unknownModels,
        zeroCostLogs, watermark, budgetExhausted,
    });
```

Replace the unknown-model alarm text, lines 418–430. Before:

```ts
                const kind = classifyLog(log);
                if (kind === "other") {
                    unknownModels++;
                    if (!unknownModelReported) {
                        unknownModelReported = true;
                        console.error(
                            `SONIOX RECONCILER ALARM: unrecognised Soniox model "${log.model}" ` +
                            `(log ${log.uuid}, sessionRef=${charge.sessionRef}). Only "stt-" and ` +
                            `"tts-" prefixes are understood; anything else bills the user ZERO at ` +
                            `full provider cost and never releases its lease. If Soniox renamed a ` +
                            `model prefix, EVERY session is now in this state.`
                        );
                    }
                }
```

After:

```ts
                const kind = classifyLog(log);
                if (kind === "other") {
                    unknownModels++;
                    if (!unknownModelReported) {
                        unknownModelReported = true;
                        console.error(
                            `SONIOX RECONCILER ALARM: unrecognised Soniox model "${log.model}" ` +
                            `(log ${log.uuid}, sessionRef=${charge.sessionRef}). Only "stt-" and ` +
                            `"tts-" prefixes are understood. CORRECTION to the older wording: ` +
                            `under cost-based pricing this log IS still charged (cost x K), so ` +
                            `it no longer bills the user ZERO at full provider cost. What it ` +
                            `still costs is the LEASE — an unrecognised prefix is not treated as ` +
                            `proof the session ended, so nothing releases here. If Soniox ` +
                            `renamed a model prefix, EVERY session is now in this state.`
                        );
                    }
                }

                // Cost-based pricing cannot price a log whose provider cost is
                // missing, zero or unparseable. `BillingService` falls back to
                // the time-based SKU rate so the row never bills zero, but that
                // fallback is an ESTIMATE, not the cost model, and a rising
                // count means Soniox's `cost_usd` has changed shape underneath
                // us. Gated on real audio: a tts log routinely reports
                // `input_audio_duration_ms: 0`, and a zero cost there is
                // unremarkable and would drown the signal. Guarded once per
                // sweep exactly like the alarm above, because `clampWindow`'s
                // deliberate 60s overlap re-processes boundary logs every sweep.
                if (charge.pricing === "cost_times_k"
                    && (charge.providerCostMicroUsd ?? 0) <= 0
                    && log.input_audio_duration_ms > 0) {
                    zeroCostLogs++;
                    if (!zeroCostReported) {
                        zeroCostReported = true;
                        console.error(
                            `SONIOX RECONCILER ALARM: log ${log.uuid} (model ${log.model}, ` +
                            `sessionRef=${charge.sessionRef}) carried ` +
                            `${log.input_audio_duration_ms}ms of audio but its cost_usd ` +
                            `"${log.cost_usd}" is not a usable positive number. Cost-based ` +
                            `pricing cannot price it, so it is being charged at the time-based ` +
                            `SKU floor instead: revenue for these rows is an estimate rather ` +
                            `than cost x K. While this is non-zero, check whether Soniox ` +
                            `changed the cost_usd field.`
                        );
                    }
                }
```

- [ ] **Step 19: Run it and watch it pass**

Run: `npx vitest run src/services/soniox-reconcile.test.ts`

Expected: PASS — the whole file, including every pre-existing `runSweep` describe.

- [ ] **Step 20: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/soniox-reconcile.ts src/services/soniox-reconcile.test.ts
git commit -m "feat(soniox): alarm on a usage log with audio but no usable cost

SweepSummary.zeroCostLogs gets its own counter, separate from unknownModels:
an unrecognised model and an unusable cost are different failures. Guarded
once per sweep because clampWindow re-covers the last 60s every time.
Corrects the unknown-model alarm's now-false claim that an unrecognised
prefix bills the user zero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 21: Rewrite the leaked-TTS-key accepted-risk comment in `src/routes/soniox.ts`**

Its whole argument rested on TTS being cost-only, which is now false. Replace lines 246–273. Before:

```ts
                    //
                    // Accepted risk: a reusable key alive for the whole session lets
                    // a client open several concurrent TTS sockets with it. This is
                    // NOT bounded by per-socket wallet billing: a speech_to_speech
                    // session's TTS usage is recorded cost-only (buildCharge gives
                    // every tts-* log sku: null / billableSeconds: 0, and
                    // BillingService.charge turns sku: null into amount: 0 — by
                    // design, so the STT charge that already covers the session
                    // isn't doubled). So a speech_to_speech key requested with the
                    // minimum affordable balance, whose STT socket is never opened,
                    // costs the wallet nothing while the reusable TTS key can still
                    // drive real Soniox TTS spend (~$0.70/hr of generated speech per
                    // stream) across however many concurrent sockets it opens.
                    //
                    // What DOES bound this: the key lives behind one authenticated
                    // account with exactly one active lease at a time (so at most one
                    // leaked/reused key per account); every socket opened with it is
                    // independently capped at max_session_duration_seconds; the key
                    // itself stops working after this session's granted duration (up
                    // to MAX_SESSION_S, and never above TTS_KEY_MAX_TTL_S regardless);
                    // and MAX_TTS_CONCURRENT caps how many TTS streams the whole org
                    // can have open at once, however they're distributed across
                    // accounts. There is no Soniox mechanism (single_use or
                    // otherwise) to shrink this further once a key must survive
                    // repeated reconnects; this is the deliberate trade-off for
                    // fixing the silent-401 bug above. The residual STT-free-TTS-
                    // spend vector is tracked in the design doc's Follow-ups section,
                    // not solved here.
```

After:

```ts
                    //
                    // Accepted risk: a reusable key alive for the whole session lets
                    // a client open several concurrent TTS sockets with it.
                    //
                    // WHAT CHANGED: this used to be argued as unbilled org spend,
                    // because a tts-* log was recorded cost-only (sku: null,
                    // amount 0) so the STT charge covering the session was not
                    // doubled. Under cost-based pricing that special case is gone:
                    // every tts-* log is charged cost x K like any other log. So
                    // extra TTS sockets now bill the USER who asked for the key,
                    // rather than quietly costing the org. That is a better failure,
                    // not a solved problem — the wallet is post-paid and a usage log
                    // only lands after a socket closes, so an account can be driven
                    // well negative before anything notices.
                    //
                    // What DOES bound this: every socket opened with the key is
                    // independently capped at max_session_duration_seconds; the key
                    // itself stops working after this session's granted duration (up
                    // to MAX_SESSION_S, and never above TTS_KEY_MAX_TTL_S regardless);
                    // and MAX_TTS_CONCURRENT caps how many TTS streams the whole org
                    // can have open at once, however they're distributed across
                    // accounts.
                    //
                    // What does NOT bound it, contrary to what this comment used to
                    // claim: "one active lease at a time, so at most one leaked key
                    // per account". A lease releases as soon as its usage log lands,
                    // while the TTS key it minted stays valid for its full
                    // expires_in_seconds afterwards — so a client running short
                    // sessions back to back accumulates independently valid keys as
                    // fast as leases release, and Soniox has no revoke API. The real
                    // enforcement points are the NUMBER OF KEYS MINTED and
                    // MAX_TTS_CONCURRENT. There is no Soniox mechanism (single_use or
                    // otherwise) to shrink this further once a key must survive
                    // repeated reconnects; this is the deliberate trade-off for
                    // fixing the silent-401 bug above.
```

- [ ] **Step 22: Run the whole suite and the type check**

Run: `npx vitest run && npx tsc --noEmit`

Expected: PASS. Every test file green (the comment edit is inert), and `tsc` clean of NEW errors introduced by this task — `SweepSummary.zeroCostLogs` is now supplied everywhere a summary is constructed, and `ChargeRequest.pricing` is optional so every existing caller still type-checks.

- [ ] **Step 23: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/routes/soniox.ts
git commit -m "docs(soniox): correct the leaked-TTS-key risk analysis for cost x K

Its premise (tts usage is cost-only, so a leaked key costs the org rather
than the user) is false under cost-based pricing: a leaked key now bills the
user. Also drops the false 'one active lease at a time' bound, which a lease
releasing before its key expires has always defeated.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task BE8: Conservative per-role-set budgeting, threaded to all four consumers

Repo: **`sokuji-backend`** (all paths below are relative to `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend`).

**Read this before you start — it is the user-visible consequence of this task.**
The conservative budgeting rates introduced here are **deliberately NOT pinned to today's
per-SKU list prices** (`soniox:text_only` $0.60/hr, `soniox:speech_to_speech` $1.50/hr).
Pinning them would re-open overdraft, because charging is moving to `provider cost × K`
with `K = 2.0`, whose worst case exceeds those list rates. The result is that **an existing
single-stream user sees a SHORTER quoted duration at the same balance** — $0.30 buys 981 s
of text-only instead of 1800 s — **while typically being CHARGED LESS than today**, because
measured Soniox cost × 2.0 lands well below the conservative estimate. Both halves of that
sentence must survive into the code comments; do not "fix" the shorter duration.

**Ordering:** this task must be executed **after** the task that adds the role vocabulary and
the server-side expansion to `src/config/soniox.ts`. It consumes those exports by name.

**Files:**
- Modify: `src/services/pricing.ts` (docstring block at lines 60–66 and 74–81; new exports added after line 17 and after line 66)
- Create: `src/services/soniox-budget.ts`
- Create: `src/services/soniox-budget.test.ts`
- Modify: `src/services/pricing.test.ts` (imports at lines 2–7; new describes appended after line 76)
- Modify: `src/routes/soniox.ts` (import line 12; `SessionBudget` + `computeSessionBudget` lines 15–37; handler lines 171–181; response line 300)
- Modify: `src/routes/soniox.test.ts` (lines 1–36)
- Modify: `src/routes/wallet-status.ts` (line 1, line 49)
- Modify: `src/routes/wallet-status.test.ts` (lines 20–24)

**Interfaces:**

- Consumes (from `src/config/soniox.ts`, produced by the role-vocabulary/expansion task — the
  names must match **verbatim** or this task will not compile):
  - `export type SonioxStreamRole = "spk_stt" | "spk_tts" | "par_stt" | "par_tts" | "mix_stt" | "mix_tts"`
  - `export type SonioxStreamRoleKind = "stt" | "tts"`
  - `export function roleKind(role: SonioxStreamRole): SonioxStreamRoleKind`
  - `export function expandStreamRoles(input: { mode: "speaker" | "participant" | "both"; textOnly: boolean; bothSplit: boolean }): SonioxStreamRole[]`
  - existing: `export const MIN_SESSION_S = 60`, `export const MAX_SESSION_S = 3600`
- Consumes (from the same task, inside `sessionKeyHandler`): a local `const roles: SonioxStreamRole[]`
  holding the server-expanded role set, in scope at `src/routes/soniox.ts:171`.
- Produces:
  - `pricing.ts`: `export const REVENUE_COEFFICIENT_K = 2.0`
  - `pricing.ts`: `export function microUsdForRate(rateUsdPerHour: number, seconds: number): number`
  - `soniox-budget.ts`: `export const WORST_CASE_PROVIDER_COST_MICRO_USD_PER_HOUR: Record<SonioxStreamRoleKind, number>`
  - `soniox-budget.ts`: `export const CONSERVATIVE_RATE_MICRO_USD_PER_HOUR: Record<SonioxStreamRoleKind, number>`
  - `soniox-budget.ts`: `export function conservativeRateMicroUsdPerHour(roles: readonly SonioxStreamRole[]): number`
  - `soniox-budget.ts`: `export function conservativeRateUsdPerHour(roles: readonly SonioxStreamRole[]): number`
  - `soniox-budget.ts`: `export function sonioxStartFloorMicroUsd(roles: readonly SonioxStreamRole[]): number`
  - `soniox-budget.ts`: `export type { SonioxStreamRole } from "../config/soniox"` (re-export)
  - `routes/soniox.ts`: `export interface SessionBudget { affordable: boolean; durationS: number; rateUsdPerHour: number; budgetMicroUsd: number; floorMicroUsd: number }`
  - `routes/soniox.ts`: `export function computeSessionBudget(balanceMicroUsd: number, roles: readonly SonioxStreamRole[]): SessionBudget`

---

- [ ] **Step 1: Write the failing test for `K` and `microUsdForRate`**

In `src/services/pricing.test.ts`, replace the import block at lines 1–7:

```ts
import { describe, it, expect } from "vitest";
import {
    RATE_USD_PER_HOUR,
    chargeMicroUsd,
    usdToMicroUsd,
    minBalanceMicroUsd,
} from "./pricing";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
    RATE_USD_PER_HOUR,
    REVENUE_COEFFICIENT_K,
    chargeMicroUsd,
    microUsdForRate,
    usdToMicroUsd,
    minBalanceMicroUsd,
} from "./pricing";
```

and append these two describes at the very end of the file (after the closing `});` on line 76):

```ts
describe("REVENUE_COEFFICIENT_K", () => {
    it("is the agreed revenue coefficient over provider cost", () => {
        expect(REVENUE_COEFFICIENT_K).toBe(2.0);
    });
});

describe("microUsdForRate", () => {
    it("is the one arithmetic behind every time-at-a-rate number", () => {
        expect(microUsdForRate(0.6, 3600)).toBe(600_000);
        expect(microUsdForRate(1.5, 60)).toBe(25_000);
    });

    it("rounds up so a partial micro-dollar is never free", () => {
        // 1s at $0.60/hr = 166.67 µUSD
        expect(microUsdForRate(0.6, 1)).toBe(167);
    });

    it("returns zero for non-positive or non-finite durations", () => {
        expect(microUsdForRate(0.6, 0)).toBe(0);
        expect(microUsdForRate(0.6, -5)).toBe(0);
        expect(microUsdForRate(0.6, NaN)).toBe(0);
        expect(microUsdForRate(0.6, Infinity)).toBe(0);
    });

    // A zero or negative rate is a programming error, never an input: budgeting
    // divides a balance BY the rate, so a zero would hand out an unbounded
    // session rather than a free one.
    it("throws on a non-positive or non-finite rate", () => {
        expect(() => microUsdForRate(0, 3600)).toThrow(/rate must be a positive finite number/);
        expect(() => microUsdForRate(-1, 3600)).toThrow(/rate must be a positive finite number/);
        expect(() => microUsdForRate(NaN, 3600)).toThrow(/rate must be a positive finite number/);
    });

    it("gives byte-identical results to the SKU-keyed helpers it now backs", () => {
        expect(chargeMicroUsd("soniox:text_only", 1)).toBe(microUsdForRate(0.6, 1));
        expect(minBalanceMicroUsd("soniox:speech_to_speech", 60)).toBe(microUsdForRate(1.5, 60));
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/pricing.test.ts`

Expected: FAIL — the file does not compile, with `No matching export in "src/services/pricing.ts" for import "REVENUE_COEFFICIENT_K"` (and the same for `microUsdForRate`).

- [ ] **Step 3: Implement `K` and `microUsdForRate` in `src/services/pricing.ts`**

`REVENUE_COEFFICIENT_K` already exists in `src/services/pricing.ts` — Task BE7 put it there, immediately after `export const MICRO_USD_PER_USD = 1_000_000;`. **Do not add it again.** Verify it reads exactly as below and move on; a second definition of a money constant is the one failure that keeps producing plausible numbers while disagreeing:

```ts
/**
 * The revenue coefficient applied over a provider's own cost when a charge is
 * priced from COST rather than from time.
 *
 * DEFINED HERE AND NOWHERE ELSE. Two consumers read it and they must never
 * drift apart: the cost-based charge (`provider cost × K`, what a managed
 * Soniox user actually pays) and the conservative budgeting estimate in
 * `soniox-budget.ts`, which is required by test to stay at or above
 * `K × worst-case provider cost`. A second literal `2.0` written anywhere else
 * re-opens overdraft silently — the budget would keep granting time at the old
 * coefficient while the charge ran at the new one.
 */
export const REVENUE_COEFFICIENT_K = 2.0;   // BE7 added this — verify only
```

Then replace the whole of `chargeMicroUsd` (lines 60–66):

```ts
/** What the user pays for `billableSeconds` at `sku`'s list rate, in µUSD. */
export function chargeMicroUsd(sku: string, billableSeconds: number): number {
    const rate = rateFor(sku);
    if (!Number.isFinite(billableSeconds) || billableSeconds <= 0) return 0;
    // Round up so a partial micro-dollar is never given away.
    return Math.ceil((billableSeconds / 3600) * rate * 1_000_000);
}
```

with:

```ts
/**
 * Seconds at an hourly USD rate, in integer µUSD, rounded UP.
 *
 * The single arithmetic behind every "time × rate" number in the system:
 * `chargeMicroUsd` and `minBalanceMicroUsd` below, and — through
 * `soniox-budget.ts` — a managed Soniox session's granted `budgetMicroUsd` and
 * its Start-gate balance floor. They share this function on purpose: the design
 * requires ONE rate to reach all four of a session's consumers, and sharing the
 * arithmetic is what stops a rounding difference from quietly separating them
 * again after the rate has been unified.
 *
 * Rounds up so a partial micro-dollar is never given away. A non-positive or
 * non-finite RATE throws rather than returning zero: budgeting divides a
 * balance by this rate, so a zero would grant an unbounded session, not a free
 * one — the opposite of failing safe.
 */
export function microUsdForRate(rateUsdPerHour: number, seconds: number): number {
    if (!Number.isFinite(rateUsdPerHour) || rateUsdPerHour <= 0) {
        throw new Error(
            `microUsdForRate: rate must be a positive finite number (got ${rateUsdPerHour})`
        );
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.ceil((seconds / 3600) * rateUsdPerHour * MICRO_USD_PER_USD);
}

/** What the user pays for `billableSeconds` at `sku`'s list rate, in µUSD. */
export function chargeMicroUsd(sku: string, billableSeconds: number): number {
    // rateFor first, so an unknown SKU still throws even for a zero duration.
    return microUsdForRate(rateFor(sku), billableSeconds);
}
```

Then replace the body of `minBalanceMicroUsd` (lines 78–81):

```ts
export function minBalanceMicroUsd(sku: string, minSessionSeconds: number): number {
    const rate = rateFor(sku);
    return Math.ceil((minSessionSeconds / 3600) * rate * 1_000_000);
}
```

with:

```ts
export function minBalanceMicroUsd(sku: string, minSessionSeconds: number): number {
    return microUsdForRate(rateFor(sku), minSessionSeconds);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/pricing.test.ts`

Expected: PASS — 20 tests. The eleven pre-existing assertions (list rates, one-hour charges, prorating, round-up, unknown-SKU throw, `minBalanceMicroUsd` at 10_000 / 25_000) must all still pass unchanged; they are the evidence that routing `chargeMicroUsd` through `microUsdForRate` changed no value.

- [ ] **Step 5: Write the failing conservative-rate test, including the mandatory invariant**

Create `src/services/soniox-budget.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
    CONSERVATIVE_RATE_MICRO_USD_PER_HOUR,
    WORST_CASE_PROVIDER_COST_MICRO_USD_PER_HOUR,
    conservativeRateMicroUsdPerHour,
    conservativeRateUsdPerHour,
    sonioxStartFloorMicroUsd,
} from "./soniox-budget";
import { REVENUE_COEFFICIENT_K } from "./pricing";
import { expandStreamRoles, roleKind, type SonioxStreamRole } from "../config/soniox";

/**
 * Every `{mode, textOnly, bothSplit}` the request validator can accept.
 *
 * Enumerated rather than hand-listed as seven role sets, because the server
 * owns the expansion: the point of the invariant below is that NO set the
 * server can issue escapes it, and a hand-written list would silently stop
 * covering a new matrix row the day one is added.
 */
const ALL_ISSUABLE_INPUTS = (["speaker", "participant", "both"] as const).flatMap((mode) =>
    [true, false].flatMap((textOnly) =>
        [true, false].map((bothSplit) => ({ mode, textOnly, bothSplit })),
    ),
);

/** The provider-cost side of the invariant, summed the same way the estimate is. */
function worstCaseProviderCostMicroUsdPerHour(roles: readonly SonioxStreamRole[]): number {
    return roles.reduce(
        (sum, role) => sum + WORST_CASE_PROVIDER_COST_MICRO_USD_PER_HOUR[roleKind(role)],
        0,
    );
}

describe("the conservative estimate covers cost × K for every issuable set", () => {
    // THE invariant. If this fails, a session can be granted more time than its
    // budget can pay for at the coefficient it will actually be charged at,
    // which is overdraft — the exact failure the separate estimate table exists
    // to prevent.
    it("never budgets below K × worst-case provider cost, for every set the server can issue", () => {
        for (const input of ALL_ISSUABLE_INPUTS) {
            const roles = expandStreamRoles(input);
            const estimate = conservativeRateMicroUsdPerHour(roles);
            const floor = REVENUE_COEFFICIENT_K * worstCaseProviderCostMicroUsdPerHour(roles);
            expect(
                estimate,
                `set ${JSON.stringify(roles)} from ${JSON.stringify(input)}`,
            ).toBeGreaterThanOrEqual(floor);
        }
    });

    it("holds per stream, which is why it holds for every sum of streams", () => {
        expect(CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.stt).toBeGreaterThanOrEqual(
            REVENUE_COEFFICIENT_K * WORST_CASE_PROVIDER_COST_MICRO_USD_PER_HOUR.stt,
        );
        expect(CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.tts).toBeGreaterThanOrEqual(
            REVENUE_COEFFICIENT_K * WORST_CASE_PROVIDER_COST_MICRO_USD_PER_HOUR.tts,
        );
    });

    it("pins both tables, so a tuning edit to either shows up as a failure here", () => {
        expect(WORST_CASE_PROVIDER_COST_MICRO_USD_PER_HOUR).toEqual({ stt: 550_000, tts: 700_000 });
        expect(CONSERVATIVE_RATE_MICRO_USD_PER_HOUR).toEqual({ stt: 1_100_000, tts: 1_400_000 });
    });
});

describe("conservativeRateUsdPerHour", () => {
    it("is the AGGREGATE for the set, not a per-stream price", () => {
        expect(conservativeRateUsdPerHour(["spk_stt"])).toBe(1.1);
        expect(conservativeRateUsdPerHour(["spk_stt", "spk_tts"])).toBe(2.5);
        expect(conservativeRateUsdPerHour(["par_stt"])).toBe(1.1);
        expect(conservativeRateUsdPerHour(["mix_stt"])).toBe(1.1);
        expect(conservativeRateUsdPerHour(["mix_stt", "mix_tts"])).toBe(2.5);
        expect(conservativeRateUsdPerHour(["spk_stt", "par_stt"])).toBe(2.2);
        expect(conservativeRateUsdPerHour(["spk_stt", "spk_tts", "par_stt"])).toBe(3.6);
    });

    it("makes split cost exactly one extra STT stream over shared", () => {
        const shared = conservativeRateMicroUsdPerHour(["mix_stt"]);
        const split = conservativeRateMicroUsdPerHour(["spk_stt", "par_stt"]);
        expect(split - shared).toBe(CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.stt);
    });

    // A zero rate would make `balance ÷ rate` infinite and grant an unbounded
    // session, so an empty set must fail loudly rather than budget for free.
    it("throws on an empty set", () => {
        expect(() => conservativeRateUsdPerHour([])).toThrow(/empty role set/);
    });

    it("throws on a role with no configured rate rather than budgeting for free", () => {
        expect(() => conservativeRateUsdPerHour(["nope" as SonioxStreamRole])).toThrow(
            /No conservative rate configured for role/,
        );
    });
});

describe("sonioxStartFloorMicroUsd", () => {
    /**
     * These four numbers are the contract with the frontend. sokuji-react's
     * `src/services/providers/sonioxManagedMinBalance.ts` is a deliberately
     * import-free leaf module (the subtitle window renders the same gate), so
     * it cannot read them from here and mirrors them as literals instead.
     * Changing one of these without changing the mirror puts a green Start
     * button in front of a user who is about to be handed a 402.
     */
    it("is one minimum-length session at the set's aggregate rate", () => {
        expect(sonioxStartFloorMicroUsd(["mix_stt"])).toBe(18_334); // shared, text-only
        expect(sonioxStartFloorMicroUsd(["mix_stt", "mix_tts"])).toBe(41_667); // shared, speech
        expect(sonioxStartFloorMicroUsd(["spk_stt", "par_stt"])).toBe(36_667); // split, text-only
        expect(sonioxStartFloorMicroUsd(["spk_stt", "spk_tts", "par_stt"])).toBe(60_000); // split, speech
    });

    it("rises for split, which is the honest half of decision 2", () => {
        expect(sonioxStartFloorMicroUsd(["spk_stt", "par_stt"])).toBeGreaterThan(
            sonioxStartFloorMicroUsd(["mix_stt"]),
        );
    });

    // Recorded as a test rather than as a comment, because it is the one
    // user-visible regression this change ships: the same wallet buys a
    // shorter session than it did at the old $0.60/hr list rate.
    it("is above the retired per-SKU floors, so an existing user's floor rises", () => {
        expect(sonioxStartFloorMicroUsd(["spk_stt"])).toBeGreaterThan(10_000); // was soniox:text_only
        expect(sonioxStartFloorMicroUsd(["spk_stt", "spk_tts"])).toBeGreaterThan(25_000); // was speech_to_speech
    });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/soniox-budget.test.ts`

Expected: FAIL — `Failed to resolve import "./soniox-budget" from "src/services/soniox-budget.test.ts". Does the file exist?`

- [ ] **Step 7: Implement `src/services/soniox-budget.ts`**

Create `src/services/soniox-budget.ts`:

```ts
/**
 * Conservative budgeting estimate for a managed Soniox session.
 *
 * SEPARATE FROM `pricing.ts`'s `RATE_USD_PER_HOUR` ON PURPOSE, and in a
 * separate file so the separation is structural rather than a convention.
 * That table is a PRICE — what a user is charged per hour under time-based
 * billing. This one is an ESTIMATE — how fast we assume a session COULD burn
 * money, used only to decide how long a balance is allowed to run and where
 * the Start floor sits. One number serving both meanings drifts silently:
 * every time someone tunes the price for product reasons, the overdraft
 * guarantee moves with it and nobody notices.
 *
 * The estimate is deliberately NOT pinned to today's per-SKU list rates
 * ($0.60 / $1.50 per hour). Pinning it would re-open overdraft, because
 * charging is `provider cost × REVENUE_COEFFICIENT_K` and the worst case of
 * that exceeds those list rates. The user-visible consequence is written down
 * here so it is not later rediscovered as a bug report:
 *
 *   an existing single-stream user sees a SHORTER quoted duration at the same
 *   balance ($0.30 buys 981s of text-only instead of 1800s), while typically
 *   being CHARGED LESS than before, because measured Soniox cost × 2.0 lands
 *   well under this estimate.
 *
 * Both halves of that are intended. The estimate is the session ALLOWANCE, not
 * the bill.
 */

import { MIN_SESSION_S, roleKind, type SonioxStreamRole, type SonioxStreamRoleKind } from "../config/soniox";
import { MICRO_USD_PER_USD, microUsdForRate } from "./pricing";

/** Re-exported so a consumer of this module's "roles in, money out" API does
 *  not need a second import just for the parameter type. */
export type { SonioxStreamRole } from "../config/soniox";

/**
 * Worst-case PROVIDER cost per hour per stream, in µUSD — what Soniox could
 * charge us for one stream of this kind running flat out for an hour.
 *
 * Calibration behind the STT figure, measured live 2026-08-11: a 3.23s stream
 * with no recognised speech cost $0.000110 (≈$0.12/hr); a 10.08s stream of
 * real speech with one_way translation cost $0.000776 (≈$0.28/hr). The spread
 * is translation OUTPUT text, which dominates. 0.55 is roughly double the
 * dense measurement, leaving headroom for a two-way, continuously-speaking
 * session in a language that produces more output tokens per second than
 * anything measured. The TTS figure is Soniox's ~$0.70/hr of generated speech.
 *
 * This table exists so the invariant in the test file is a real check rather
 * than a tautology. It is NEVER a charge — nothing bills from these numbers.
 */
export const WORST_CASE_PROVIDER_COST_MICRO_USD_PER_HOUR: Record<SonioxStreamRoleKind, number> = {
    stt: 550_000,
    tts: 700_000,
};

/**
 * The conservative budgeting rate per stream, in µUSD per hour.
 *
 * Each entry is exactly `REVENUE_COEFFICIENT_K × worst-case provider cost` for
 * that kind of stream. Written as its own literal table rather than computed
 * from the row above, so that raising the estimate for a product reason cannot
 * silently drag the invariant it is measured against up with it — the test
 * compares the two tables and fails the moment the estimate drops below
 * K × cost.
 */
export const CONSERVATIVE_RATE_MICRO_USD_PER_HOUR: Record<SonioxStreamRoleKind, number> = {
    stt: 1_100_000,
    tts: 1_400_000,
};

/**
 * The AGGREGATE conservative rate for a whole issued stream set, in µUSD/hr:
 * the sum over its streams. Never a per-stream price — a split Both session
 * runs two transcriptions and therefore burns allowance at two streams' rate.
 *
 * Integer µUSD throughout. Summing 1.10 + 1.40 + 1.10 in floating point is a
 * pointless risk to take on a number that decides how long a session runs and
 * whether it starts at all.
 *
 * Throws on an empty set: a zero rate would make `balance ÷ rate` infinite and
 * hand out an unbounded session — failing loud, not free. Throws on a role
 * with no configured rate for the same reason `rateFor` in pricing.ts does.
 */
export function conservativeRateMicroUsdPerHour(roles: readonly SonioxStreamRole[]): number {
    if (roles.length === 0) {
        throw new Error("conservativeRateMicroUsdPerHour: empty role set has no rate");
    }
    let total = 0;
    for (const role of roles) {
        const rate = CONSERVATIVE_RATE_MICRO_USD_PER_HOUR[roleKind(role)];
        if (rate == null) {
            throw new Error(`No conservative rate configured for role "${role}"`);
        }
        total += rate;
    }
    return total;
}

/** The same aggregate as a USD/hour number, which is the unit the session-key
 *  response and the client's allowance countdown speak. Lossless: every entry
 *  is a whole number of µUSD, so the division is exact at these magnitudes. */
export function conservativeRateUsdPerHour(roles: readonly SonioxStreamRole[]): number {
    return conservativeRateMicroUsdPerHour(roles) / MICRO_USD_PER_USD;
}

/**
 * Balance floor for STARTING a session with this stream set: the cost of one
 * minimum-length session at the set's aggregate conservative rate.
 *
 * This is the fourth consumer of the one rate (the other three being the
 * granted `durationS`, the `rateUsdPerHour` returned to the client, and
 * `budgetMicroUsd`). It shares `microUsdForRate` with them so the four cannot
 * disagree by a rounding step.
 *
 * The frontend mirrors these numbers as literals in sokuji-react's
 * `src/services/providers/sonioxManagedMinBalance.ts`, which is import-free by
 * design (the subtitle window renders the same Start gate and must not pull
 * the client into its bundle) and so cannot read them from here. Its test
 * restates this arithmetic, so a change on either side surfaces as a failing
 * test rather than as a Start button that lies about a 402.
 */
export function sonioxStartFloorMicroUsd(roles: readonly SonioxStreamRole[]): number {
    return microUsdForRate(conservativeRateUsdPerHour(roles), MIN_SESSION_S);
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/soniox-budget.test.ts`

Expected: PASS — 9 tests.

- [ ] **Step 9: Rewrite the `computeSessionBudget` tests onto role sets**

In `src/routes/soniox.test.ts`, replace lines 1–36 exactly as they stand:

```ts
import { describe, it, expect } from "vitest";
import { computeSessionBudget, createSonioxHandlers } from "./soniox";
import { chargeMicroUsd } from "../services/pricing";
import { clientRefIdFor } from "../services/session-lease";
import { KEY_START_WINDOW_S, TTS_KEY_MAX_TTL_S, ttsKeyExpiresInSeconds } from "../config/soniox";

describe("computeSessionBudget", () => {
    it("is an exact division, not an estimate — that is what makes overdraft ~zero", () => {
        // $0.60/hr: $0.30 buys exactly 1800s.
        expect(computeSessionBudget(300_000, "soniox:text_only").durationS).toBe(1800);
        // $1.50/hr: $0.75 buys exactly 1800s.
        expect(computeSessionBudget(750_000, "soniox:speech_to_speech").durationS).toBe(1800);
    });

    it("caps at one hour however large the balance", () => {
        expect(computeSessionBudget(100_000_000, "soniox:text_only").durationS).toBe(3600);
        expect(computeSessionBudget(100_000_000, "soniox:speech_to_speech").durationS).toBe(3600);
    });

    it("reports affordable=false below one minimum-length session", () => {
        // text_only floor is $0.010; speech_to_speech is $0.025.
        expect(computeSessionBudget(9_999, "soniox:text_only").affordable).toBe(false);
        expect(computeSessionBudget(10_000, "soniox:text_only").affordable).toBe(true);
        expect(computeSessionBudget(24_999, "soniox:speech_to_speech").affordable).toBe(false);
        expect(computeSessionBudget(25_000, "soniox:speech_to_speech").affordable).toBe(true);
    });

    it("never returns a duration below the minimum for an affordable balance", () => {
        expect(computeSessionBudget(10_000, "soniox:text_only").durationS).toBe(60);
    });

    it("carries the SKU rate so the client can meter without its own rate table", () => {
        expect(computeSessionBudget(300_000, "soniox:text_only").rateUsdPerHour).toBe(0.6);
        expect(computeSessionBudget(300_000, "soniox:speech_to_speech").rateUsdPerHour).toBe(1.5);
    });
});
```

with:

```ts
import { describe, it, expect } from "vitest";
import { computeSessionBudget, createSonioxHandlers } from "./soniox";
import { chargeMicroUsd, microUsdForRate } from "../services/pricing";
import { sonioxStartFloorMicroUsd } from "../services/soniox-budget";
import { clientRefIdFor } from "../services/session-lease";
import { KEY_START_WINDOW_S, TTS_KEY_MAX_TTL_S, ttsKeyExpiresInSeconds } from "../config/soniox";

describe("computeSessionBudget", () => {
    it("is an exact division at the SET's aggregate conservative rate", () => {
        // $1.10/hr for one transcription stream: $0.30 buys 981s.
        expect(computeSessionBudget(300_000, ["spk_stt"]).durationS).toBe(981);
        // $2.50/hr for transcription + synthesis: $0.75 buys 1080s.
        expect(computeSessionBudget(750_000, ["spk_stt", "spk_tts"]).durationS).toBe(1080);
    });

    // The user-visible half of decision 2, asserted rather than commented: a
    // second transcription stream costs a second stream's worth of allowance,
    // so the same wallet buys about half the wall-clock time.
    it("halves the granted duration for a split Both session at the same balance", () => {
        const shared = computeSessionBudget(300_000, ["mix_stt"]).durationS;
        const split = computeSessionBudget(300_000, ["spk_stt", "par_stt"]).durationS;
        expect(shared).toBe(981);
        expect(split).toBe(490);
        expect(computeSessionBudget(750_000, ["spk_stt", "spk_tts", "par_stt"]).durationS).toBe(749);
    });

    // Recorded because it WILL generate support questions: the conservative
    // estimate is above the retired list rates on purpose (see soniox-budget.ts),
    // so an unchanged single-stream user's quoted duration gets shorter.
    it("quotes a shorter duration than the retired per-SKU list rate did", () => {
        expect(computeSessionBudget(300_000, ["spk_stt"]).durationS).toBeLessThan(1800);
        expect(computeSessionBudget(750_000, ["spk_stt", "spk_tts"]).durationS).toBeLessThan(1800);
    });

    it("caps at one hour however large the balance", () => {
        expect(computeSessionBudget(100_000_000, ["spk_stt"]).durationS).toBe(3600);
        expect(computeSessionBudget(100_000_000, ["spk_stt", "spk_tts", "par_stt"]).durationS).toBe(3600);
    });

    it("reports affordable=false below one minimum-length session for THIS set", () => {
        expect(computeSessionBudget(18_333, ["mix_stt"]).affordable).toBe(false);
        expect(computeSessionBudget(18_334, ["mix_stt"]).affordable).toBe(true);
        expect(computeSessionBudget(41_666, ["mix_stt", "mix_tts"]).affordable).toBe(false);
        expect(computeSessionBudget(41_667, ["mix_stt", "mix_tts"]).affordable).toBe(true);
        expect(computeSessionBudget(36_666, ["spk_stt", "par_stt"]).affordable).toBe(false);
        expect(computeSessionBudget(36_667, ["spk_stt", "par_stt"]).affordable).toBe(true);
        expect(computeSessionBudget(59_999, ["spk_stt", "spk_tts", "par_stt"]).affordable).toBe(false);
        expect(computeSessionBudget(60_000, ["spk_stt", "spk_tts", "par_stt"]).affordable).toBe(true);
    });

    it("never returns a duration below the minimum for an affordable balance", () => {
        expect(computeSessionBudget(18_334, ["mix_stt"]).durationS).toBe(60);
        expect(computeSessionBudget(60_000, ["spk_stt", "spk_tts", "par_stt"]).durationS).toBe(60);
    });

    it("carries the AGGREGATE rate for the set, not a per-stream price", () => {
        expect(computeSessionBudget(300_000, ["mix_stt"]).rateUsdPerHour).toBe(1.1);
        expect(computeSessionBudget(300_000, ["mix_stt", "mix_tts"]).rateUsdPerHour).toBe(2.5);
        expect(computeSessionBudget(300_000, ["spk_stt", "par_stt"]).rateUsdPerHour).toBe(2.2);
        expect(computeSessionBudget(750_000, ["spk_stt", "spk_tts", "par_stt"]).rateUsdPerHour).toBe(3.6);
    });

    // The whole point of the change: ONE rate reaches all four consumers, so
    // the countdown the client renders and the cutoff the server grants cannot
    // drift. Recomputing budgetMicroUsd from a per-SKU list rate — which the
    // handler used to do — is exactly how they drifted.
    it("derives budgetMicroUsd and the floor from the same rate as durationS", () => {
        const sets: readonly (readonly ["spk_stt" | "mix_stt", ...string[]])[] = [];
        void sets; // documentation only; the concrete cases follow
        for (const roles of [
            ["mix_stt"],
            ["mix_stt", "mix_tts"],
            ["spk_stt", "par_stt"],
            ["spk_stt", "spk_tts", "par_stt"],
        ] as const) {
            const b = computeSessionBudget(500_000, roles);
            expect(b.budgetMicroUsd).toBe(microUsdForRate(b.rateUsdPerHour, b.durationS));
            expect(b.floorMicroUsd).toBe(sonioxStartFloorMicroUsd(roles));
            // Never advertise more spend than the wallet actually holds.
            expect(b.budgetMicroUsd).toBeLessThanOrEqual(500_000);
        }
    });

    it("reports a zero budget and the set's floor when unaffordable", () => {
        const b = computeSessionBudget(1_000, ["mix_stt"]);
        expect(b.affordable).toBe(false);
        expect(b.durationS).toBe(0);
        expect(b.budgetMicroUsd).toBe(0);
        expect(b.floorMicroUsd).toBe(18_334);
    });

    it("throws on an empty set rather than granting an unbounded session", () => {
        expect(() => computeSessionBudget(300_000, [])).toThrow(/empty role set/);
    });
});
```

- [ ] **Step 10: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/soniox.test.ts -t computeSessionBudget`

Expected: FAIL — `AssertionError: expected 1800 to be 981` on the first case (the old SKU-keyed implementation ignores the array and looks up `RATE_USD_PER_HOUR[undefined]`, so depending on order you may instead see `Error: No rate configured for SKU "spk_stt"`). Either way the block is red.

- [ ] **Step 11: Implement the new `computeSessionBudget` and thread it through the handler**

In `src/routes/soniox.ts`, replace the pricing import on line 12:

```ts
import { RATE_USD_PER_HOUR, minBalanceMicroUsd, chargeMicroUsd, MICRO_USD_PER_USD } from "../services/pricing";
```

with:

```ts
import { MICRO_USD_PER_USD, microUsdForRate } from "../services/pricing";
import {
    conservativeRateUsdPerHour, sonioxStartFloorMicroUsd, type SonioxStreamRole,
} from "../services/soniox-budget";
```

Then replace lines 15–37 exactly as they stand:

```ts
export interface SessionBudget {
    affordable: boolean;
    durationS: number;
    rateUsdPerHour: number;
}

/**
 * How long a balance buys at a SKU's rate.
 *
 * Because Part A charges by time, this is a division rather than a guess — which
 * is why the session budget is exact and overdraft is structurally ~zero.
 */
export function computeSessionBudget(balanceMicroUsd: number, sku: string): SessionBudget {
    const rate = (RATE_USD_PER_HOUR as Record<string, number>)[sku];
    if (rate == null) throw new Error(`No rate configured for SKU "${sku}"`);
    const floor = minBalanceMicroUsd(sku, MIN_SESSION_S);
    if (!Number.isFinite(balanceMicroUsd) || balanceMicroUsd < floor) {
        return { affordable: false, durationS: 0, rateUsdPerHour: rate };
    }
    const seconds = (balanceMicroUsd / MICRO_USD_PER_USD / rate) * 3600;
    const durationS = Math.min(MAX_SESSION_S, Math.max(MIN_SESSION_S, Math.floor(seconds)));
    return { affordable: true, durationS, rateUsdPerHour: rate };
}
```

with:

```ts
export interface SessionBudget {
    affordable: boolean;
    durationS: number;
    /**
     * The AGGREGATE conservative rate for the whole issued stream set — not a
     * per-stream price, and NOT what the user is charged (Soniox is charged
     * from provider cost × K). It is the rate the session's allowance burns
     * at, and it is returned to the client under this name.
     */
    rateUsdPerHour: number;
    /** What THIS session may consume over `durationS` at that rate. Computed
     *  here rather than at the call site so it cannot come from a different
     *  rate than `durationS` did. Zero when unaffordable. */
    budgetMicroUsd: number;
    /** The balance floor this call tested against — the same number the
     *  frontend's Start gate mirrors. Reported even when unaffordable, so a
     *  402 can say what would have been enough. */
    floorMicroUsd: number;
}

/**
 * How long a balance buys for a given SET of Soniox streams.
 *
 * The rate is a CONSERVATIVE ESTIMATE for the whole set (see
 * services/soniox-budget.ts), no longer a per-SKU list price, because charging
 * is now provider cost × K and a list rate can no longer bound it. Two
 * consequences, both intended:
 *
 *   - a split Both session runs two transcription streams and so is granted
 *     roughly half the duration at the same balance, and refused at a higher
 *     floor. We do not absorb the difference.
 *   - an existing single-stream user's quoted duration gets SHORTER than it was
 *     at the old $0.60/$1.50 list rates, while their bill typically gets
 *     smaller. The estimate is the allowance, not the price.
 *
 * All four consumers of the rate are produced here — `durationS`,
 * `rateUsdPerHour`, `budgetMicroUsd`, `floorMicroUsd` — so no caller can
 * reintroduce a second rate by recomputing one of them.
 */
export function computeSessionBudget(
    balanceMicroUsd: number,
    roles: readonly SonioxStreamRole[],
): SessionBudget {
    // Throws on an empty set or an unrated role: a missing rate must fail
    // loudly, never budget for free (an infinite session, in this direction).
    const rate = conservativeRateUsdPerHour(roles);
    const floorMicroUsd = sonioxStartFloorMicroUsd(roles);
    if (!Number.isFinite(balanceMicroUsd) || balanceMicroUsd < floorMicroUsd) {
        return { affordable: false, durationS: 0, rateUsdPerHour: rate, budgetMicroUsd: 0, floorMicroUsd };
    }
    const seconds = (balanceMicroUsd / MICRO_USD_PER_USD / rate) * 3600;
    const durationS = Math.min(MAX_SESSION_S, Math.max(MIN_SESSION_S, Math.floor(seconds)));
    return {
        affordable: true,
        durationS,
        rateUsdPerHour: rate,
        budgetMicroUsd: microUsdForRate(rate, durationS),
        floorMicroUsd,
    };
}
```

Then in `sessionKeyHandler`, replace lines 171–181 exactly as they stand:

```ts
        const budget = computeSessionBudget(balance.balanceMicroUsd, sku);
        if (!budget.affordable) {
            return c.json({ error: "Insufficient balance" }, 402);
        }

        // What THIS session can actually consume, not the whole wallet balance:
        // durationS is capped at MAX_SESSION_S, so a large balance must not be
        // advertised as spendable in one session. The client meter divides this
        // by rateUsdPerHour to show remaining time, and that must track the
        // session's actual cutoff, not the account's total funds.
        const sessionBudgetMicroUsd = chargeMicroUsd(sku, budget.durationS);
```

with (`roles` is the server-expanded role set already in scope from the expansion task):

```ts
        const budget = computeSessionBudget(balance.balanceMicroUsd, roles);
        if (!budget.affordable) {
            return c.json({ error: "Insufficient balance" }, 402);
        }

        // What THIS session can actually consume, not the whole wallet balance:
        // durationS is capped at MAX_SESSION_S, so a large balance must not be
        // advertised as spendable in one session. The client meter divides this
        // by rateUsdPerHour to show remaining time, and that must track the
        // session's actual cutoff, not the account's total funds.
        //
        // READ OFF `budget`, never recomputed. This line used to be
        // `chargeMicroUsd(sku, budget.durationS)` — a SECOND rate lookup, at the
        // per-SKU list price, for a duration that had been granted at a
        // different rate. That is precisely how the client's countdown and the
        // server's grant drift apart, and it is why the rate now has exactly one
        // producer.
        const sessionBudgetMicroUsd = budget.budgetMicroUsd;
```

Finally, in the 200 response block, replace line 300:

```ts
            rateUsdPerHour: budget.rateUsdPerHour,
```

with:

```ts
            // The AGGREGATE allowance rate for this session's whole stream set
            // — not a per-stream price, and not the price that will be charged
            // (Soniox charges from provider cost × K). The client meters its
            // remaining allowance against this and against budgetMicroUsd.
            rateUsdPerHour: budget.rateUsdPerHour,
```

- [ ] **Step 12: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/soniox.test.ts`

Expected: PASS for the `computeSessionBudget` describe block (10 tests). The route-handler describes in the same file belong to the expansion/keys task and must also be green before you commit; if one of them fails on `sessionBudgetMicroUsd`, its expectation is the old `chargeMicroUsd(sku, durationS)` number and must be updated to `budget.budgetMicroUsd`.

- [ ] **Step 13: Write the failing wallet-status test**

In `src/routes/wallet-status.test.ts`, replace lines 20–24:

```ts
    it("exposes the SKU rate table", () => {
        const r = buildWalletStatus({ balanceMicroUsd: 0, frozen: false }, 0);
        expect(r.rates["soniox:text_only"]).toBe(0.6);
        expect(r.rates["soniox:speech_to_speech"]).toBe(1.5);
    });
```

with:

```ts
    // For Soniox these entries stopped being prices: charging is provider cost
    // × K, so there is no hourly list price to publish. What the client needs
    // from this payload is the rate its session ALLOWANCE burns at — the same
    // conservative aggregate computeSessionBudget grants against. Publishing
    // the old list rates here while the grant used the conservative rate would
    // put the client's own estimate and the server's cutoff ~2x apart.
    it("publishes Soniox as the session-allowance rate, not a price", () => {
        const r = buildWalletStatus({ balanceMicroUsd: 0, frozen: false }, 0);
        expect(r.rates["soniox:text_only"]).toBe(1.1);
        expect(r.rates["soniox:speech_to_speech"]).toBe(2.5);
    });

    it("leaves the other providers' list prices untouched", () => {
        const r = buildWalletStatus({ balanceMicroUsd: 0, frozen: false }, 0);
        expect(r.rates["openai:realtime_translate"]).toBe(2.5);
        expect(r.rates["volcengine:ast_v2"]).toBe(5.0);
    });
```

- [ ] **Step 14: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/wallet-status.test.ts`

Expected: FAIL with `AssertionError: expected 0.6 to be 1.1`.

- [ ] **Step 15: Implement the wallet-status change**

In `src/routes/wallet-status.ts`, replace line 1:

```ts
import { RATE_USD_PER_HOUR, MICRO_USD_PER_USD } from "../services/pricing";
```

with:

```ts
import { RATE_USD_PER_HOUR, MICRO_USD_PER_USD } from "../services/pricing";
import { conservativeRateUsdPerHour } from "../services/soniox-budget";
```

and replace line 49:

```ts
        rates: { ...RATE_USD_PER_HOUR },
```

with:

```ts
        rates: {
            ...RATE_USD_PER_HOUR,
            // Soniox is charged from the provider's own cost (`cost × K`), so
            // it has no hourly list price left to publish. What a client can
            // usefully do with a per-hour number is estimate how long its
            // balance will run, and that is the conservative ALLOWANCE rate
            // `computeSessionBudget` grants against — publishing the old list
            // rates here while the grant used the conservative rate would leave
            // the client's estimate and the server's cutoff ~2x apart.
            //
            // The keys stay SKU-shaped because already-shipped clients index
            // this map by SKU string. The two Soniox SKUs map onto the two
            // single-client stream sets; split Both has no SKU and is not
            // representable here, and does not need to be — its rate reaches
            // the client on the session-key response's `rateUsdPerHour`, which
            // is the authority for a session that has actually been granted.
            "soniox:text_only": conservativeRateUsdPerHour(["spk_stt"]),
            "soniox:speech_to_speech": conservativeRateUsdPerHour(["spk_stt", "spk_tts"]),
        },
```

- [ ] **Step 16: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/wallet-status.test.ts`

Expected: PASS — 9 tests.

- [ ] **Step 17: Run the whole suite and the typecheck**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run && npx tsc --noEmit`

Expected: PASS, and `tsc --noEmit` prints nothing. If `tsc` complains that `chargeMicroUsd` is imported but unused anywhere, delete the stale import — `src/routes/soniox.ts` no longer charges at a list rate.

- [ ] **Step 18: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/pricing.ts src/services/pricing.test.ts \
        src/services/soniox-budget.ts src/services/soniox-budget.test.ts \
        src/routes/soniox.ts src/routes/soniox.test.ts \
        src/routes/wallet-status.ts src/routes/wallet-status.test.ts
git commit -m "$(cat <<'EOF'
feat(soniox): budget on a conservative per-role-set rate

Budgeting stops reading the per-SKU list price and reads a separate
conservative estimate table keyed on the expanded stream set: $1.10/hr per
transcription stream, $1.40/hr per synthesis stream, each exactly K x the
worst-case provider cost (K = 2.0, defined once in pricing.ts). A split Both
session runs two transcriptions and is therefore granted about half the
duration at the same balance, and refused at a higher floor.

The estimate lives in its own module, separate from RATE_USD_PER_HOUR, because
one number serving both "price" and "how fast could this burn" drifts silently
the first time the price is tuned. An invariant test asserts
conservativeRate(set) >= K x worstCaseProviderCost(set) for every set the
server's expansion can issue.

One rate now reaches all four of its consumers - the granted durationS, the
rateUsdPerHour returned to the client (documented as the AGGREGATE for the set,
not a per-stream price), budgetMicroUsd, and the Start-gate floor the frontend
mirrors - because computeSessionBudget produces all four and the handler reads
them off rather than recomputing budgetMicroUsd at a list rate.

User-visible and intended: an existing single-stream user sees a SHORTER quoted
duration at the same balance ($0.30 buys 981s of text-only, not 1800s) while
typically being charged LESS, since measured cost x 2.0 lands under the
estimate. The Start floor rises from 10_000/25_000 to 18_334/41_667 uUSD.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task BE6: Server-side stream expansion, per-role key minting, additive response

**Files:**
- Modify: `sokuji-backend/src/config/soniox.ts` (add after line 26; replace lines 73–86)
- Modify: `sokuji-backend/src/services/session-lease.ts` (lines 21–30, line 123)
- Modify: `sokuji-backend/src/routes/soniox.ts` (lines 5–12, 15–37, 47–49, 133–311)
- Create: `sokuji-backend/src/config/soniox.test.ts`
- Test: `sokuji-backend/src/services/session-lease.test.ts` (line 3 import; add one describe)
- Test: `sokuji-backend/src/routes/soniox.test.ts` (replace lines 2–5, 7–36, 136, 210–219, 339–390, 392–454; add three describes)

**Interfaces:**

- Consumes (from BE2, `src/config/soniox.ts`):
  `export type SonioxStreamRole = "spk_stt" | "spk_tts" | "par_stt" | "par_tts" | "mix_stt" | "mix_tts"`
- Consumes (from BE2, `src/services/session-lease.ts`):
  `export function clientRefIdFor(accountId: string, leaseId: string, role: SonioxStreamRole): string`
  `export function baseRefFor(accountId: string, leaseId: string): string`
- Consumes (from BE3, `src/services/session-lease.ts`): `AcquireParams` has gained `sttStreamCount: number`, and `acquire` writes it into the `INSERT`.
- Produces (`src/config/soniox.ts`):
  `export const PARTICIPANT_KEY_START_WINDOW_S = 180`
  `export const REVENUE_COEFFICIENT_K = 2.0`
  `export const CONSERVATIVE_RATE_USD_PER_HOUR_PER_STT_STREAM = 1.1`
  `export const CONSERVATIVE_RATE_USD_PER_HOUR_PER_TTS_STREAM = 1.4`
  `export type SonioxAudioMode = "speaker" | "participant" | "both"`
  `export interface SonioxSessionShape { mode: SonioxAudioMode; textOnly: boolean; bothSplit: boolean }`
  `export function normalizeSessionShape(body: unknown): SonioxSessionShape | null`
  `export function expandStreamRoles(shape: SonioxSessionShape): SonioxStreamRole[]`
  `export function usageTypeForRole(role: SonioxStreamRole): SonioxUsageType`
  `export function sttStreamCount(roles: readonly SonioxStreamRole[]): number`
  `export function usesTtsFor(roles: readonly SonioxStreamRole[]): boolean`
  `export function skuForRoles(roles: readonly SonioxStreamRole[]): "soniox:text_only" | "soniox:speech_to_speech"`
  `export function primaryRole(roles: readonly SonioxStreamRole[]): SonioxStreamRole`
  `export function keyStartWindowForRole(role: SonioxStreamRole): number`
  `export function maxKeyStartWindowS(roles: readonly SonioxStreamRole[]): number`
  `export function conservativeRateUsdPerHour(roles: readonly SonioxStreamRole[]): number`
  (`skuForMode` and `usageTypesForMode` are DELETED — nothing else in the repo imports them; verified by grep.)
- Produces (`src/services/session-lease.ts`): `AcquireParams` gains `startWindowS?: number`.
- Produces (`src/routes/soniox.ts`):
  `export function computeSessionBudget(balanceMicroUsd: number, rateUsdPerHour: number): SessionBudget`
  `export function microUsdAtRate(rateUsdPerHour: number, seconds: number): number`
  `export function earliestExpiresAt(values: readonly string[]): string | undefined`
- Produces (wire): `POST /soniox/session-key` response gains
  `streams: Array<{ role: SonioxStreamRole; apiKey: string; clientReferenceId: string; expiresAt: string }>`
  while `sttApiKey` / `ttsApiKey` / `clientReferenceId` stay and come from the primary leg, and `expiresAt` becomes the **earliest** expiry among issued keys.

**What this task deliberately changes for already-shipped clients** (put it in the PR body; do not let a reviewer discover it):
a shipped `{ mode: "text_only" }` request keeps working, and its response keeps every field it reads — but `rateUsdPerHour` moves from `0.6` to `1.1`, and `speech_to_speech` from `1.5` to `2.5`, because budgeting now runs on conservative per-stream rates (1.10/hr per `*_stt`, 1.40/hr per `*_tts` = K × worst-case provider cost, K = 2.0). At the same balance a single-stream user is quoted a **shorter** duration than today while, under BE7's cost × K charging, typically being **charged less**. Pinning the legacy rows to today's 0.6/1.5 was considered and rejected: it re-opens overdraft under cost × K.

---

- [ ] **Step 1: Write the failing test — the expansion is total and closed**

Create `sokuji-backend/src/config/soniox.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
    expandStreamRoles, usageTypeForRole, sttStreamCount, usesTtsFor,
    skuForRoles, primaryRole,
    type SonioxSessionShape, type SonioxStreamRole,
} from "./soniox";

/** EVERY input the expansion can ever be handed: 3 modes x textOnly x bothSplit.
 *  Enumerated rather than sampled, because "total and closed" is the property
 *  under test — a spot check cannot tell an eighth reachable role set from a
 *  seventh. */
const ALL_SHAPES: SonioxSessionShape[] = (["speaker", "participant", "both"] as const).flatMap(
    (mode) => [true, false].flatMap(
        (textOnly) => [true, false].map((bothSplit) => ({ mode, textOnly, bothSplit }))
    )
);

describe("expandStreamRoles — total and closed (spec A6)", () => {
    it("reaches exactly the seven rows of the matrix and nothing else", () => {
        const reachable = new Set(ALL_SHAPES.map((s) => expandStreamRoles(s).join(",")));
        expect([...reachable].sort()).toEqual([
            "mix_stt",
            "mix_stt,mix_tts",
            "par_stt",
            "spk_stt",
            "spk_stt,par_stt",
            "spk_stt,spk_tts",
            "spk_stt,spk_tts,par_stt",
        ]);
    });

    it("maps each matrix row to its exact role list, in mint order", () => {
        expect(expandStreamRoles({ mode: "speaker", textOnly: true, bothSplit: false })).toEqual(["spk_stt"]);
        expect(expandStreamRoles({ mode: "speaker", textOnly: false, bothSplit: false })).toEqual(["spk_stt", "spk_tts"]);
        expect(expandStreamRoles({ mode: "participant", textOnly: true, bothSplit: false })).toEqual(["par_stt"]);
        expect(expandStreamRoles({ mode: "both", textOnly: true, bothSplit: false })).toEqual(["mix_stt"]);
        expect(expandStreamRoles({ mode: "both", textOnly: false, bothSplit: false })).toEqual(["mix_stt", "mix_tts"]);
        expect(expandStreamRoles({ mode: "both", textOnly: true, bothSplit: true })).toEqual(["spk_stt", "par_stt"]);
        expect(expandStreamRoles({ mode: "both", textOnly: false, bothSplit: true })).toEqual(["spk_stt", "spk_tts", "par_stt"]);
    });

    it("ignores textOnly for participant-only — createParticipantSessionConfig forces text", () => {
        expect(expandStreamRoles({ mode: "participant", textOnly: false, bothSplit: true })).toEqual(["par_stt"]);
    });

    it("ignores bothSplit outside 'both' — a split speaker-only session is not a thing", () => {
        expect(expandStreamRoles({ mode: "speaker", textOnly: true, bothSplit: true })).toEqual(["spk_stt"]);
    });

    it("never returns par_tts: the participant channel has no synthesis in v1", () => {
        for (const s of ALL_SHAPES) {
            expect(expandStreamRoles(s)).not.toContain("par_tts" as SonioxStreamRole);
        }
    });

    it("never returns more than ONE tts stream, so no request can mint two reusable TTS keys", () => {
        // The structural property A2 demands and a client-declared stream list
        // with a blocklist cannot give: ['spk_tts'] alone is not merely
        // rejected, it is unrepresentable.
        for (const s of ALL_SHAPES) {
            const tts = expandStreamRoles(s).filter((r) => usageTypeForRole(r) === "tts_rt");
            expect(tts.length).toBeLessThanOrEqual(1);
        }
    });

    it("always contains at least one STT stream, so the started/ended mask is never vacuous", () => {
        // A role set with zero STT roles would make `(ended & started) === started`
        // true forever with started === 0, i.e. a lease that can never release.
        for (const s of ALL_SHAPES) {
            expect(sttStreamCount(expandStreamRoles(s))).toBeGreaterThanOrEqual(1);
        }
    });
});

describe("derivations off the expansion", () => {
    it("counts STT streams for the lease's concurrency weight", () => {
        expect(sttStreamCount(["spk_stt"])).toBe(1);
        expect(sttStreamCount(["spk_stt", "spk_tts"])).toBe(1);
        expect(sttStreamCount(["spk_stt", "spk_tts", "par_stt"])).toBe(2);
    });

    it("derives uses_tts and the SKU from the roles, never from the request", () => {
        expect(usesTtsFor(["spk_stt"])).toBe(false);
        expect(usesTtsFor(["spk_stt", "par_stt"])).toBe(false);
        expect(usesTtsFor(["mix_stt", "mix_tts"])).toBe(true);
        expect(skuForRoles(["spk_stt", "par_stt"])).toBe("soniox:text_only");
        expect(skuForRoles(["spk_stt", "spk_tts", "par_stt"])).toBe("soniox:speech_to_speech");
    });

    it("names the primary leg as the FIRST STT role — spk_stt, par_stt or mix_stt, never a TTS role", () => {
        expect(primaryRole(["spk_stt", "spk_tts"])).toBe("spk_stt");
        expect(primaryRole(["par_stt"])).toBe("par_stt");
        expect(primaryRole(["mix_stt", "mix_tts"])).toBe("mix_stt");
        // Split Both has two STT legs; the speaker is the primary one.
        expect(primaryRole(["spk_stt", "spk_tts", "par_stt"])).toBe("spk_stt");
    });

    it("maps roles to Soniox usage types by suffix", () => {
        expect(usageTypeForRole("spk_stt")).toBe("transcribe_websocket");
        expect(usageTypeForRole("par_stt")).toBe("transcribe_websocket");
        expect(usageTypeForRole("mix_stt")).toBe("transcribe_websocket");
        expect(usageTypeForRole("spk_tts")).toBe("tts_rt");
        expect(usageTypeForRole("mix_tts")).toBe("tts_rt");
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/config/soniox.test.ts`

Expected: FAIL — `TypeError: expandStreamRoles is not a function` (vite-node resolves a missing named export to `undefined` rather than throwing at import, so the failure surfaces at the first call).

- [ ] **Step 3: Implement the expansion and its derivations**

In `src/config/soniox.ts`, DELETE lines 73–86 verbatim:

```ts
export function skuForMode(mode: SonioxMode): "soniox:text_only" | "soniox:speech_to_speech" {
    return mode === "speech_to_speech" ? "soniox:speech_to_speech" : "soniox:text_only";
}

/**
 * A temporary key is scoped to ONE usage type, so speech-to-speech needs two.
 * This is also why the client's declared mode is self-enforcing: asking for
 * text_only yields no TTS key, so the cheap rate cannot buy the expensive path.
 */
export function usageTypesForMode(mode: SonioxMode): SonioxUsageType[] {
    return mode === "speech_to_speech"
        ? ["transcribe_websocket", "tts_rt"]
        : ["transcribe_websocket"];
}
```

and put this in its place:

```ts
// ---------------------------------------------------------------------------
// Stream roles and the mode matrix (spec A2 / A6)
// ---------------------------------------------------------------------------

/**
 * The AUDIO shape of a session. This is vocabulary TWO of the two DISJOINT
 * vocabularies that share the request key `mode`:
 *
 *   vocabulary 1 (legacy, currently shipped): "text_only" | "speech_to_speech"
 *                — a BILLING shape, with no textOnly/bothSplit fields at all.
 *   vocabulary 2 (this one):                  "speaker" | "participant" | "both"
 *                — an AUDIO shape, with textOnly and bothSplit alongside it.
 *
 * They are told apart by VALUE and nothing else (see `normalizeSessionShape`).
 * An implementer who assumes one vocabulary either 400s every currently-shipped
 * client during the deploy window, or mis-expands a new one.
 */
export type SonioxAudioMode = "speaker" | "participant" | "both";

/** The matrix inputs the client sends. NOT a stream list: see
 *  `expandStreamRoles` for why the server owns the expansion. */
export interface SonioxSessionShape {
    mode: SonioxAudioMode;
    textOnly: boolean;
    bothSplit: boolean;
}

/**
 * The ONLY source of a session's key set. Total over its input and closed over
 * its output: exactly the seven rows of spec A6 are reachable and nothing else.
 *
 * This replaces `usageTypesForMode` and keeps its self-enforcing property. The
 * alternative — a client-declared stream list validated by a blocklist — is
 * strictly weaker: a request for `['spk_tts']` alone passes "no par_tts" and
 * "at most one *_tts", yet mints a non-single_use TTS key valid for the whole
 * granted duration against an API with no revoke, while an empty STT
 * expectation makes the mask release predicate vacuously true forever. Here
 * that request is not rejected, it is unrepresentable.
 *
 * Order is the MINT order and also fixes the primary leg (`primaryRole` takes
 * the first STT role), so do not reorder these arrays casually.
 */
export function expandStreamRoles(shape: SonioxSessionShape): SonioxStreamRole[] {
    switch (shape.mode) {
        case "speaker":
            return shape.textOnly ? ["spk_stt"] : ["spk_stt", "spk_tts"];
        case "participant":
            // textOnly is IGNORED here, not defaulted: createParticipantSessionConfig
            // sets textOnly: true unconditionally, so no participant-side TTS
            // exists in any mode. bothSplit is meaningless outside `both`.
            return ["par_stt"];
        case "both":
            if (shape.bothSplit) {
                // Two independent Soniox sessions; attribution is physical.
                // Only the SPEAKER leg carries synthesis — the participant leg
                // is text-only by the same hardcoded config as above.
                return shape.textOnly
                    ? ["spk_stt", "par_stt"]
                    : ["spk_stt", "spk_tts", "par_stt"];
            }
            // Shared: PcmMixer mixes mic + system audio into ONE stream, so the
            // role is `mix_*`. Calling it `spk_*` would be a lie about which
            // audio source feeds it.
            return shape.textOnly ? ["mix_stt"] : ["mix_stt", "mix_tts"];
    }
    // Unreachable while `mode` is the closed union above. The `never`
    // assignment is what turns ADDING a mode into a compile error rather than
    // a silent `undefined` role set — `npm run build` (npx tsc --noEmit) is
    // what enforces it, and CI runs it.
    const exhaustive: never = shape.mode;
    throw new Error(`expandStreamRoles: unhandled mode ${String(exhaustive)}`);
}

/** A temporary key is scoped to ONE usage type. Derived from the role's own
 *  suffix so there is no second table to keep in sync. */
export function usageTypeForRole(role: SonioxStreamRole): SonioxUsageType {
    return role.endsWith("_tts") ? "tts_rt" : "transcribe_websocket";
}

/** How many transcription STREAMS this set opens. Stored on the lease, because
 *  a split Both session must count as two against MAX_STT_CONCURRENT — the
 *  ceiling is on streams, not on leases. */
export function sttStreamCount(roles: readonly SonioxStreamRole[]): number {
    return roles.filter((r) => usageTypeForRole(r) === "transcribe_websocket").length;
}

/** The lease's TTS weight, derived from the expansion rather than from the
 *  request, so the declared mode can never buy an undeclared TTS stream. */
export function usesTtsFor(roles: readonly SonioxStreamRole[]): boolean {
    return roles.some((r) => usageTypeForRole(r) === "tts_rt");
}

/** The lease row's `sku` column, kept for the ledger and the response's legacy
 *  `sku` field. It is NOT what budgeting reads any more — see
 *  `conservativeRateUsdPerHour`. */
export function skuForRoles(
    roles: readonly SonioxStreamRole[]
): "soniox:text_only" | "soniox:speech_to_speech" {
    return usesTtsFor(roles) ? "soniox:speech_to_speech" : "soniox:text_only";
}

/**
 * The leg whose key backs the response's FLAT `sttApiKey` / `clientReferenceId`
 * fields: the lease's single STT role — spk_stt for speaker and for both-split,
 * par_stt for participant-only, mix_stt for both-shared.
 *
 * "Primary" cannot simply mean "speaker": a participant-only session has no
 * speaker leg at all, and returning `undefined` there would break a shipped
 * client's very first read of the response.
 */
export function primaryRole(roles: readonly SonioxStreamRole[]): SonioxStreamRole {
    const first = roles.find((r) => usageTypeForRole(r) === "transcribe_websocket");
    if (!first) {
        // Unreachable through expandStreamRoles (every row has an STT leg) —
        // loud rather than silent, because a set with no STT leg would also be
        // a lease that can never release.
        throw new Error(`primaryRole: role set has no STT stream: ${roles.join(",")}`);
    }
    return first;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/config/soniox.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/config/soniox.ts src/config/soniox.test.ts
git commit -m "feat(soniox): expand the mode matrix into a closed stream-role set

Replaces usageTypesForMode. The server owns the expansion, so the seven rows
of the design's A6 matrix are the only reachable key sets and a client cannot
name a stream list at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 6: Write the failing test — the normaliser, both vocabularies**

Append to `sokuji-backend/src/config/soniox.test.ts`:

```ts
import {
    normalizeSessionShape, keyStartWindowForRole, maxKeyStartWindowS,
    conservativeRateUsdPerHour, KEY_START_WINDOW_S, PARTICIPANT_KEY_START_WINDOW_S,
    CONSERVATIVE_RATE_USD_PER_HOUR_PER_STT_STREAM,
    CONSERVATIVE_RATE_USD_PER_HOUR_PER_TTS_STREAM,
} from "./soniox";

describe("normalizeSessionShape — two disjoint vocabularies on one key", () => {
    it("accepts the currently-shipped legacy vocabulary and expands it to the single-stream rows", () => {
        // These two are what every client in the field posts today. If this
        // ever 400s, the deploy window takes managed Soniox down.
        expect(normalizeSessionShape({ mode: "text_only" }))
            .toEqual({ mode: "speaker", textOnly: true, bothSplit: false });
        expect(normalizeSessionShape({ mode: "speech_to_speech" }))
            .toEqual({ mode: "speaker", textOnly: false, bothSplit: false });
    });

    it("ignores stray textOnly/bothSplit on a legacy body rather than mixing the vocabularies", () => {
        // A hybrid body is a client bug, not a request for split. The legacy
        // value fully determines the shape.
        expect(normalizeSessionShape({ mode: "text_only", textOnly: false, bothSplit: true }))
            .toEqual({ mode: "speaker", textOnly: true, bothSplit: false });
    });

    it("accepts the new vocabulary with explicit booleans", () => {
        expect(normalizeSessionShape({ mode: "speaker", textOnly: false }))
            .toEqual({ mode: "speaker", textOnly: false, bothSplit: false });
        expect(normalizeSessionShape({ mode: "both", textOnly: true, bothSplit: true }))
            .toEqual({ mode: "both", textOnly: true, bothSplit: true });
        expect(normalizeSessionShape({ mode: "both", textOnly: false, bothSplit: false }))
            .toEqual({ mode: "both", textOnly: false, bothSplit: false });
    });

    it("takes participant-only without a textOnly, because the participant config forces it", () => {
        expect(normalizeSessionShape({ mode: "participant" }))
            .toEqual({ mode: "participant", textOnly: true, bothSplit: false });
    });

    it("rejects a new-vocabulary body with a missing or non-boolean textOnly", () => {
        // Same reasoning as the original "no default for mode": a client bug
        // that drops textOnly must fail loudly, not silently buy the TTS path.
        expect(normalizeSessionShape({ mode: "speaker" })).toBeNull();
        expect(normalizeSessionShape({ mode: "speaker", textOnly: "false" })).toBeNull();
        expect(normalizeSessionShape({ mode: "both", bothSplit: true })).toBeNull();
    });

    it("rejects a 'both' body with a missing bothSplit rather than silently choosing shared", () => {
        // Choosing shared here would quietly halve the price of what the user
        // asked for and mis-attribute the session's audio.
        expect(normalizeSessionShape({ mode: "both", textOnly: true })).toBeNull();
        expect(normalizeSessionShape({ mode: "both", textOnly: true, bothSplit: 1 })).toBeNull();
    });

    it("rejects everything else with no default", () => {
        expect(normalizeSessionShape({})).toBeNull();
        expect(normalizeSessionShape({ mode: "bogus" })).toBeNull();
        expect(normalizeSessionShape({ mode: "" })).toBeNull();
        expect(normalizeSessionShape(null)).toBeNull();
        expect(normalizeSessionShape(undefined)).toBeNull();
    });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/config/soniox.test.ts`

Expected: FAIL — `TypeError: normalizeSessionShape is not a function`

- [ ] **Step 8: Implement the normaliser**

Append to the block written in Step 3:

```ts
/**
 * Turn a request body into the matrix inputs, or null for a loud 400.
 *
 * Discriminates the two vocabularies BY VALUE of `mode` — never by "did the
 * body also carry textOnly". A hybrid body is a client bug and the legacy
 * value wins outright, because guessing would be how a shipped client silently
 * gets a stream set it did not ask for during the deploy window.
 */
export function normalizeSessionShape(body: unknown): SonioxSessionShape | null {
    const b = (body ?? {}) as Record<string, unknown>;
    const mode = b.mode;

    // Vocabulary 1 — currently-shipped clients. `mode` is the BILLING shape and
    // expands to the legacy single-stream rows. A shipped client running shared
    // Both lands on spk_stt rather than mix_stt: a labelling imprecision only,
    // and self-consistent, because session-started infers a lease's single STT
    // role when the client (as shipped) posts no role at all.
    if (mode === "text_only") return { mode: "speaker", textOnly: true, bothSplit: false };
    if (mode === "speech_to_speech") return { mode: "speaker", textOnly: false, bothSplit: false };

    // Vocabulary 2 — new clients. `mode` is the AUDIO shape.
    if (mode === "participant") {
        // textOnly is structurally ignored here, so it is not required either.
        return { mode: "participant", textOnly: true, bothSplit: false };
    }
    if (mode === "speaker") {
        if (typeof b.textOnly !== "boolean") return null;
        return { mode: "speaker", textOnly: b.textOnly, bothSplit: false };
    }
    if (mode === "both") {
        if (typeof b.textOnly !== "boolean") return null;
        if (typeof b.bothSplit !== "boolean") return null;
        return { mode: "both", textOnly: b.textOnly, bothSplit: b.bothSplit };
    }
    return null;
}
```

- [ ] **Step 9: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/config/soniox.test.ts`

Expected: PASS on the normaliser describe; the start-window and rate describes are not written yet.

- [ ] **Step 10: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/config/soniox.ts src/config/soniox.test.ts
git commit -m "feat(soniox): normalise both mode vocabularies on one request key

'text_only'/'speech_to_speech' and 'speaker'/'participant'/'both' are disjoint
vocabularies sharing the key 'mode'; discriminate by value so a currently
shipped body still parses during the deploy window.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 11: Write the failing test — start windows and the conservative rate**

Append to `sokuji-backend/src/config/soniox.test.ts`:

```ts
describe("key start windows", () => {
    it("gives par_stt the wider window, because its leg waits on a loopback permission dialog", () => {
        expect(keyStartWindowForRole("par_stt")).toBe(PARTICIPANT_KEY_START_WINDOW_S);
        expect(PARTICIPANT_KEY_START_WINDOW_S).toBe(180);
        expect(PARTICIPANT_KEY_START_WINDOW_S).toBeGreaterThan(KEY_START_WINDOW_S);
    });

    it("leaves every other STT role on the short 60s window", () => {
        expect(keyStartWindowForRole("spk_stt")).toBe(KEY_START_WINDOW_S);
        expect(keyStartWindowForRole("mix_stt")).toBe(KEY_START_WINDOW_S);
    });

    it("reports the widest window a set issues, which is what the lease must outlast", () => {
        expect(maxKeyStartWindowS(["spk_stt", "spk_tts"])).toBe(KEY_START_WINDOW_S);
        expect(maxKeyStartWindowS(["par_stt"])).toBe(PARTICIPANT_KEY_START_WINDOW_S);
        expect(maxKeyStartWindowS(["spk_stt", "spk_tts", "par_stt"])).toBe(PARTICIPANT_KEY_START_WINDOW_S);
    });
});

describe("conservativeRateUsdPerHour — budgeting only, never charging", () => {
    it("is K x the worst-case provider cost per stream, K = 2.0", () => {
        // 0.55/hr worst-case per STT stream, 0.70/hr per TTS stream.
        expect(CONSERVATIVE_RATE_USD_PER_HOUR_PER_STT_STREAM).toBe(1.1);
        expect(CONSERVATIVE_RATE_USD_PER_HOUR_PER_TTS_STREAM).toBe(1.4);
    });

    it("aggregates over the whole set — one number for durationS, the quoted rate and the budget", () => {
        expect(conservativeRateUsdPerHour(["spk_stt"])).toBe(1.1);
        expect(conservativeRateUsdPerHour(["par_stt"])).toBe(1.1);
        expect(conservativeRateUsdPerHour(["mix_stt"])).toBe(1.1);
        expect(conservativeRateUsdPerHour(["spk_stt", "spk_tts"])).toBe(2.5);
        expect(conservativeRateUsdPerHour(["mix_stt", "mix_tts"])).toBe(2.5);
        expect(conservativeRateUsdPerHour(["spk_stt", "par_stt"])).toBe(2.2);
        expect(conservativeRateUsdPerHour(["spk_stt", "spk_tts", "par_stt"])).toBe(3.6);
    });

    it("makes split cost 2x shared at the same textOnly setting — decision 2, reflected honestly", () => {
        expect(conservativeRateUsdPerHour(["spk_stt", "par_stt"]))
            .toBe(2 * conservativeRateUsdPerHour(["mix_stt"]));
    });

    it("returns a 2-decimal number, so a rate change cannot leak float dust into a user-visible quote", () => {
        for (const r of [
            conservativeRateUsdPerHour(["spk_stt"]),
            conservativeRateUsdPerHour(["spk_stt", "spk_tts", "par_stt"]),
        ]) {
            expect(Math.round(r * 100) / 100).toBe(r);
        }
    });
});
```

- [ ] **Step 12: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/config/soniox.test.ts`

Expected: FAIL — `TypeError: keyStartWindowForRole is not a function`

- [ ] **Step 13: Implement the participant window and the rate table**

In `src/config/soniox.ts`, insert immediately after line 26 (`export const KEY_START_WINDOW_S = 60;`):

```ts
/** `expires_in_seconds` on the PARTICIPANT STT key specifically.
 *
 *  Three times KEY_START_WINDOW_S, and not a copy-paste slip: the participant
 *  leg is acquired AFTER the speaker's, behind the operating system's loopback
 *  / screen-audio permission dialog, which a human has to read and click. The
 *  key is minted inside the speaker's connect(), before that dialog is even
 *  shown, so a 60s window routinely expires while the dialog is still open and
 *  the participant leg 401s for a reason the user cannot act on.
 *
 *  The trade-off is a longer-lived single_use STT key. It is still single_use,
 *  still capped at max_session_duration_seconds, and still useless without the
 *  lease behind it — and `maxKeyStartWindowS` widens that lease to match, so
 *  the key cannot outlive its own lease. */
export const PARTICIPANT_KEY_START_WINDOW_S = 180;
```

Then append to the block written in Steps 3 and 8:

```ts
/** The key start window for one role. Only `par_stt` differs — see
 *  PARTICIPANT_KEY_START_WINDOW_S for why. TTS keys do not use this at all
 *  (their expires_in_seconds is the granted duration). */
export function keyStartWindowForRole(role: SonioxStreamRole): number {
    return role === "par_stt" ? PARTICIPANT_KEY_START_WINDOW_S : KEY_START_WINDOW_S;
}

/** The widest start window this set actually issues.
 *
 *  The LEASE's initial TTL has to cover it. Without this a participant-only
 *  session gets a key valid for 180s behind a lease that dies at 75s: the
 *  client connects at, say, 120s, `markStarted`'s `expires_at > ?` liveness
 *  guard refuses, the lease is never extended, and a second `acquire` can take
 *  the row out from under a session that is genuinely running. */
export function maxKeyStartWindowS(roles: readonly SonioxStreamRole[]): number {
    return roles.reduce(
        (widest, role) => Math.max(widest, keyStartWindowForRole(role)),
        KEY_START_WINDOW_S
    );
}

// ---------------------------------------------------------------------------
// Budgeting rates (spec A5)
// ---------------------------------------------------------------------------

// K and the conservative-rate table are NOT defined here. K lives in
// `src/services/pricing.ts` (Task BE7) and the budgeting rates in
// `src/services/soniox-budget.ts` (Task BE8), which is why both of those
// tasks must reach production before this one. Two definitions of a money
// constant is the failure this note exists to prevent: both would keep
// producing plausible numbers while disagreeing.

// `conservativeRateUsdPerHour(roles)` is imported from
// `src/services/soniox-budget.ts` (Task BE8). Do not re-implement it here —
// it is the ONE budgeting number for a stream set, and it must reach all four
// of its consumers from a single place or they drift.
import { conservativeRateUsdPerHour } from "../services/soniox-budget";
```

- [ ] **Step 14: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/config/soniox.test.ts`

Expected: PASS

- [ ] **Step 15: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/config/soniox.ts src/config/soniox.test.ts
git commit -m "feat(soniox): price a stream set on conservative per-stream rates

K x worst-case provider cost per stream, aggregated over the set, plus the
participant key's 180s start window and the widest-window helper the lease TTL
has to follow.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 16: Write the failing test — the lease's start window follows the widest key**

In `sokuji-backend/src/services/session-lease.test.ts`, change line 3 from:

```ts
import { MAX_STT_CONCURRENT, MAX_TTS_CONCURRENT } from "../config/soniox";
```

to:

```ts
import {
    MAX_STT_CONCURRENT, MAX_TTS_CONCURRENT,
    KEY_START_WINDOW_S, LEASE_MARGIN_MS, PARTICIPANT_KEY_START_WINDOW_S,
} from "../config/soniox";
```

and append to the end of the file:

```ts
describe("acquire — the lease's start window must cover the WIDEST key start window issued", () => {
    it("defaults to KEY_START_WINDOW_S when the caller names no window", async () => {
        const { env, store } = makeEnv();
        const svc = new SessionLeaseService(env);
        await svc.acquire({ ...base, leaseId: "L1", now: 1000 });
        expect(store["acct1"].expires_at).toBe(1000 + KEY_START_WINDOW_S * 1000 + LEASE_MARGIN_MS);
    });

    it("honours a wider window, so a 180s participant key cannot outlive its own lease", async () => {
        // A participant-only session's key is valid for 180s. Left on the 60s
        // default the lease dies at 75s, markStarted's `expires_at > ?` guard
        // refuses, and a competing acquire can take the row out from under a
        // session that is genuinely about to run.
        const { env, store } = makeEnv();
        const svc = new SessionLeaseService(env);
        await svc.acquire({
            ...base, leaseId: "L1", now: 1000,
            startWindowS: PARTICIPANT_KEY_START_WINDOW_S,
        });
        expect(store["acct1"].expires_at)
            .toBe(1000 + PARTICIPANT_KEY_START_WINDOW_S * 1000 + LEASE_MARGIN_MS);
    });
});
```

- [ ] **Step 17: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts`

Expected: FAIL on the second case — `AssertionError: expected 76000 to be 196000 // Object.is equality` (the extra param is ignored, so the lease still expires on the 60s window).

- [ ] **Step 18: Implement**

In `src/services/session-lease.ts`, replace lines 21–30 verbatim:

```ts
export interface AcquireParams {
    accountId: string;
    leaseId: string;
    provider: string;
    sku: string;
    usesTts: boolean;
    maxDurationS: number;
    budgetMicroUsd: number;
    now: number;
}
```

with (keeping whatever field BE3 added for the STT stream count — shown here as `sttStreamCount`):

```ts
export interface AcquireParams {
    accountId: string;
    leaseId: string;
    provider: string;
    sku: string;
    usesTts: boolean;
    sttStreamCount: number;
    maxDurationS: number;
    budgetMicroUsd: number;
    /** The widest key START window this session's key set actually issues, in
     *  seconds. Optional and defaulting to KEY_START_WINDOW_S, so every caller
     *  that predates split Both keeps today's 75s two-phase TTL exactly.
     *
     *  Load-bearing for the participant leg: its key gets
     *  PARTICIPANT_KEY_START_WINDOW_S (180s) because it waits on a loopback
     *  permission dialog, and a lease that expires at 75s would refuse that
     *  leg's markStarted on the liveness guard. */
    startWindowS?: number;
    now: number;
}
```

and replace line 123:

```ts
        const initialExpiry = p.now + KEY_START_WINDOW_S * 1000 + LEASE_MARGIN_MS;
```

with:

```ts
        const initialExpiry = p.now + (p.startWindowS ?? KEY_START_WINDOW_S) * 1000 + LEASE_MARGIN_MS;
```

- [ ] **Step 19: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/services/session-lease.test.ts src/services/session-lease.sqlite.test.ts`

Expected: PASS

- [ ] **Step 20: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/session-lease.ts src/services/session-lease.test.ts
git commit -m "feat(soniox): let acquire widen the lease's start window to the widest key

A participant STT key lives 180s. Without this the lease still died at 75s and
the participant leg's markStarted failed its own liveness guard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 21: Write the failing test — the two additive route helpers**

Append to `sokuji-backend/src/routes/soniox.test.ts`:

```ts
import { microUsdAtRate, earliestExpiresAt } from "./soniox";

describe("microUsdAtRate", () => {
    it("is the same arithmetic the granted duration is divided out of, so the two round-trip", () => {
        // $1.10/hr for 1800s = $0.55.
        expect(microUsdAtRate(1.1, 1800)).toBe(550_000);
        expect(microUsdAtRate(3.6, 3600)).toBe(3_600_000);
    });

    it("rounds UP, so a partial micro-dollar is never given away", () => {
        // 60s at $1.10/hr = 18333.33... µUSD.
        expect(microUsdAtRate(1.1, 60)).toBe(18_334);
    });

    it("is zero for a non-positive or non-finite duration", () => {
        expect(microUsdAtRate(1.1, 0)).toBe(0);
        expect(microUsdAtRate(1.1, -5)).toBe(0);
        expect(microUsdAtRate(1.1, Number.NaN)).toBe(0);
    });
});

describe("earliestExpiresAt", () => {
    it("returns the EARLIEST expiry, not the last one issued", () => {
        // The flat `expiresAt` is what a client uses to decide the key set is
        // still usable. With three keys the honest answer is the first to die —
        // today's last-wins value is already meaningless.
        expect(earliestExpiresAt([
            "2026-01-01T00:03:00Z",
            "2026-01-01T00:01:00Z",
            "2026-01-01T01:00:00Z",
        ])).toBe("2026-01-01T00:01:00Z");
    });

    it("passes a single value through", () => {
        expect(earliestExpiresAt(["2026-01-01T00:00:00Z"])).toBe("2026-01-01T00:00:00Z");
    });

    it("skips values it cannot parse rather than dropping the field", () => {
        expect(earliestExpiresAt(["not-a-date", "2026-01-01T00:05:00Z"]))
            .toBe("2026-01-01T00:05:00Z");
    });

    it("falls back to the first value when NOTHING parses, degrading to today's behaviour", () => {
        expect(earliestExpiresAt(["not-a-date", "also-not"])).toBe("not-a-date");
    });

    it("is undefined for an empty set", () => {
        expect(earliestExpiresAt([])).toBeUndefined();
    });
});
```

- [ ] **Step 22: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/soniox.test.ts`

Expected: FAIL — `TypeError: microUsdAtRate is not a function`

- [ ] **Step 23: Implement**

In `src/routes/soniox.ts`, insert immediately after the `SessionBudget` interface (after line 19, before `computeSessionBudget`):

```ts
/**
 * What `seconds` costs at a per-hour rate, in integer µUSD.
 *
 * Deliberately NOT `chargeMicroUsd(sku, …)`: the session budget is now derived
 * from the conservative rate for the whole STREAM SET, which no SKU names.
 * Feeding the budget from a SKU list rate while the granted duration came from
 * the conservative rate is exactly how the on-screen countdown and the real
 * cutoff drift apart.
 */
export function microUsdAtRate(rateUsdPerHour: number, seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    // Round up so a partial micro-dollar is never given away.
    return Math.ceil((seconds / 3600) * rateUsdPerHour * MICRO_USD_PER_USD);
}

/**
 * The flat `expiresAt` field: the EARLIEST expiry among the issued keys.
 *
 * Today's value is whatever the last iteration of the mint loop happened to
 * write, which is already meaningless (the TTS key's expiry is an hour out
 * while the STT key's is 60s). With up to three keys the only useful answer is
 * the first one to die.
 */
export function earliestExpiresAt(values: readonly string[]): string | undefined {
    let best: string | undefined;
    let bestMs = Infinity;
    for (const v of values) {
        const ms = Date.parse(v);
        if (Number.isNaN(ms)) continue;
        if (ms < bestMs) {
            bestMs = ms;
            best = v;
        }
    }
    // If NOTHING parsed, hand back the first value rather than dropping the
    // field: a change in Soniox's timestamp format should degrade to today's
    // behaviour, not to a missing expiry the client reads as "no key".
    return best ?? values[0];
}
```

- [ ] **Step 24: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/soniox.test.ts`

Expected: PASS (38 existing + the new helper tests)

- [ ] **Step 25: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/routes/soniox.ts src/routes/soniox.test.ts
git commit -m "feat(soniox): add rate-based budget arithmetic and an earliest-expiry pick

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

- [ ] **Step 26: Write the failing test — rewrite the test-file fixtures the new contract breaks**

Still in `sokuji-backend/src/routes/soniox.test.ts`, three fixtures must change before any handler test can be written.

**(a)** Replace lines 2–5:

```ts
import { computeSessionBudget, createSonioxHandlers } from "./soniox";
import { chargeMicroUsd } from "../services/pricing";
import { clientRefIdFor } from "../services/session-lease";
import { KEY_START_WINDOW_S, TTS_KEY_MAX_TTL_S, ttsKeyExpiresInSeconds } from "../config/soniox";
```

with:

```ts
import { computeSessionBudget, createSonioxHandlers, microUsdAtRate, earliestExpiresAt } from "./soniox";
import { baseRefFor, clientRefIdFor } from "../services/session-lease";
import {
    KEY_START_WINDOW_S, PARTICIPANT_KEY_START_WINDOW_S, TTS_KEY_MAX_TTL_S,
    ttsKeyExpiresInSeconds, conservativeRateUsdPerHour,
} from "../config/soniox";
```

(and delete the duplicate `import { microUsdAtRate, earliestExpiresAt } from "./soniox";` line added in Step 21.)

**(b)** Replace line 136 inside `fakeLeaseService`:

```ts
                    clientRefId: clientRefIdFor(p.accountId, p.leaseId),
```

with:

```ts
                    // The lease's ref is the THREE-segment base ref; the
                    // four-segment per-role refs are built by the handler.
                    clientRefId: baseRefFor(p.accountId, p.leaseId),
```

**(c)** Replace `capturingSonioxApi` (lines 210–219) so two keys of the same usage type are tellable apart:

```ts
/** A Soniox API stub that records the exact opts passed to each
 *  createTemporaryKey() call, so tests can assert the per-role
 *  singleUse/expiresInSeconds/clientReferenceId policy without inspecting HTTP
 *  request bodies. The returned apiKey is call-indexed, because a split session
 *  mints TWO transcribe_websocket keys and they must be distinguishable. */
function capturingSonioxApi(opts: { expiresAt?: string[] } = {}) {
    const seenOpts: any[] = [];
    return {
        createTemporaryKey: async (o: any) => {
            const i = seenOpts.length;
            seenOpts.push(o);
            return {
                apiKey: `key-${o.usageType}-${i}`,
                expiresAt: opts.expiresAt?.[i] ?? "2026-01-01T00:00:00Z",
            };
        },
        seenOpts,
    };
}
```

- [ ] **Step 27: Write the failing test — rewrite `computeSessionBudget`'s describe**

Replace lines 7–36 — the whole `describe("computeSessionBudget", …)` block, which currently passes a SKU string — with:

```ts
describe("computeSessionBudget", () => {
    it("is an exact division of balance by the SET's conservative rate, not an estimate", () => {
        // $1.10/hr (one STT stream): $0.55 buys exactly 1800s.
        expect(computeSessionBudget(550_000, 1.1).durationS).toBe(1800);
        // $2.50/hr (one STT + one TTS stream): $1.25 buys exactly 1800s.
        expect(computeSessionBudget(1_250_000, 2.5).durationS).toBe(1800);
    });

    it("halves the granted duration for split Both at the same balance — decision 2, honestly", () => {
        const shared = computeSessionBudget(550_000, 1.1).durationS;   // mix_stt
        const split = computeSessionBudget(550_000, 2.2).durationS;    // spk_stt + par_stt
        expect(shared).toBe(1800);
        expect(split).toBe(900);
    });

    it("caps at one hour however large the balance", () => {
        expect(computeSessionBudget(100_000_000, 1.1).durationS).toBe(3600);
        expect(computeSessionBudget(100_000_000, 3.6).durationS).toBe(3600);
    });

    it("reports affordable=false below one minimum-length session at that rate", () => {
        // 60s at $1.10/hr rounds up to 18,334 µUSD.
        expect(computeSessionBudget(18_333, 1.1).affordable).toBe(false);
        expect(computeSessionBudget(18_334, 1.1).affordable).toBe(true);
        // 60s at $3.60/hr is exactly 60,000 µUSD — the split speech-to-speech floor.
        expect(computeSessionBudget(59_999, 3.6).affordable).toBe(false);
        expect(computeSessionBudget(60_000, 3.6).affordable).toBe(true);
    });

    it("never returns a duration below the minimum for an affordable balance", () => {
        expect(computeSessionBudget(18_334, 1.1).durationS).toBe(60);
    });

    it("echoes the aggregate rate back so the client can meter without its own table", () => {
        expect(computeSessionBudget(550_000, 2.2).rateUsdPerHour).toBe(2.2);
    });

    it("throws on a non-positive rate rather than granting an unbounded session", () => {
        expect(() => computeSessionBudget(550_000, 0)).toThrow(/invalid rate/);
        expect(() => computeSessionBudget(550_000, Number.NaN)).toThrow(/invalid rate/);
    });
});
```

- [ ] **Step 28: Write the failing test — rewrite the two handler describes the contract makes false**

**(a)** Replace lines 339–390 — the whole `describe("sessionKeyHandler — clientReferenceId in the response (item 7)", …)` block, whose second test asserts ONE shared reference across both key calls — with:

```ts
describe("sessionKeyHandler — every key carries its OWN four-segment reference", () => {
    it("puts the PRIMARY leg's own reference in the flat clientReferenceId field", async () => {
        const { svc: leaseSvc } = fakeLeaseService();
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => leaseSvc as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "text_only" } });

        await sessionKeyHandler(c);

        expect(calls.json?.status).toBe(200);
        // Four segments, ending in the primary role — NOT the lease's bare
        // three-segment base ref, which no key is bound to any more.
        expect(calls.json?.body.clientReferenceId)
            .toBe(clientRefIdFor("u1", calls.json?.body.leaseId, "spk_stt"));
        expect(calls.json?.body.clientReferenceId).not.toBe(calls.json?.body.leaseId);
        expect(calls.json?.body.clientReferenceId.split(":")).toHaveLength(4);
    });

    it("gives the STT and TTS keys DIFFERENT references, because attribution is key-bound", async () => {
        // Probed live 2026-08-11: Soniox attributes a usage log to the
        // client_reference_id bound to the KEY and ignores the one the socket
        // declares. Two keys sharing a reference are indistinguishable in the
        // usage logs — which is what would make a split session's two legs
        // untellable apart and the ended mask undriveable.
        const sonioxApi = capturingSonioxApi();
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => sonioxApi as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "speech_to_speech" } });

        await sessionKeyHandler(c);

        expect(calls.json?.status).toBe(200);
        expect(sonioxApi.seenOpts).toHaveLength(2);
        const refs = sonioxApi.seenOpts.map((o) => o.clientReferenceId);
        expect(new Set(refs).size).toBe(2);
        const leaseId = calls.json?.body.leaseId;
        expect(refs).toEqual([
            clientRefIdFor("u1", leaseId, "spk_stt"),
            clientRefIdFor("u1", leaseId, "spk_tts"),
        ]);
    });
});
```

**(b)** Replace lines 392–454 — the whole `describe("sessionKeyHandler — budgetMicroUsd is the session's spendable amount…")` block, which computes its expectations with `chargeMicroUsd(sku, …)` — with:

```ts
describe("sessionKeyHandler — budgetMicroUsd is the session's spendable amount, not the wallet balance", () => {
    it("a balance-limited session: budget = balance, at the SET's conservative rate", async () => {
        // $1.10/hr for one STT stream: $0.55 buys exactly 1800s, so
        // microUsdAtRate round-trips back to the original balance.
        const balanceMicroUsd = 550_000;
        let seenBudget: number | undefined;
        const { svc: leaseSvc } = fakeLeaseService();
        const wrappedLease = {
            ...leaseSvc,
            acquire: async (p: any) => {
                seenBudget = p.budgetMicroUsd;
                return leaseSvc.acquire(p);
            },
        };
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(balanceMicroUsd) as any,
            makeSessionLeaseService: () => wrappedLease as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "text_only" } });

        await sessionKeyHandler(c);

        const expected = microUsdAtRate(conservativeRateUsdPerHour(["spk_stt"]), 1800);
        expect(expected).toBe(balanceMicroUsd);
        expect(calls.json?.body.budgetMicroUsd).toBe(expected);
        expect(seenBudget).toBe(expected); // same value stored on the lease
        expect(calls.json?.body.maxSessionDurationSeconds).toBe(1800);
    });

    it("a cap-limited session: budget is the cost of the capped hour, not the balance", async () => {
        const balanceMicroUsd = 100_000_000;
        let seenBudget: number | undefined;
        const { svc: leaseSvc } = fakeLeaseService();
        const wrappedLease = {
            ...leaseSvc,
            acquire: async (p: any) => {
                seenBudget = p.budgetMicroUsd;
                return leaseSvc.acquire(p);
            },
        };
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(balanceMicroUsd) as any,
            makeSessionLeaseService: () => wrappedLease as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "text_only" } });

        await sessionKeyHandler(c);

        const oneHour = microUsdAtRate(conservativeRateUsdPerHour(["spk_stt"]), 3600);
        expect(oneHour).toBe(1_100_000);
        expect(calls.json?.body.maxSessionDurationSeconds).toBe(3600);
        expect(calls.json?.body.budgetMicroUsd).toBe(oneHour);
        expect(calls.json?.body.budgetMicroUsd).not.toBe(balanceMicroUsd);
        expect(seenBudget).toBe(oneHour);
    });
});
```

- [ ] **Step 29: Write the failing test — the legacy replay, i.e. the deploy window**

Append to `sokuji-backend/src/routes/soniox.test.ts`:

```ts
describe("sessionKeyHandler — currently-shipped request/response shapes still work (deploy window)", () => {
    it("replays a shipped { mode: 'text_only' } body and returns every flat field that client reads", async () => {
        const sonioxApi = capturingSonioxApi();
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => sonioxApi as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "text_only" } });

        await sessionKeyHandler(c);

        expect(calls.json?.status).toBe(200);
        const b = calls.json?.body;
        expect(typeof b.sttApiKey).toBe("string");
        expect(b.ttsApiKey).toBeUndefined();
        expect(typeof b.expiresAt).toBe("string");
        expect(b.maxSessionDurationSeconds).toBe(3600);
        expect(typeof b.budgetMicroUsd).toBe("number");
        expect(b.rateUsdPerHour).toBe(conservativeRateUsdPerHour(["spk_stt"]));
        expect(b.sku).toBe("soniox:text_only");
        expect(typeof b.leaseId).toBe("string");
        expect(typeof b.clientReferenceId).toBe("string");
        // The legacy single-stream set: exactly one key, transcription only.
        expect(sonioxApi.seenOpts).toHaveLength(1);
        expect(sonioxApi.seenOpts[0].usageType).toBe("transcribe_websocket");
        expect(sonioxApi.seenOpts[0].singleUse).toBe(true);
        expect(sonioxApi.seenOpts[0].expiresInSeconds).toBe(KEY_START_WINDOW_S);
    });

    it("replays a shipped { mode: 'speech_to_speech' } body as the two-key set", async () => {
        const sonioxApi = capturingSonioxApi();
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => sonioxApi as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "speech_to_speech" } });

        await sessionKeyHandler(c);

        expect(calls.json?.status).toBe(200);
        expect(calls.json?.body.sku).toBe("soniox:speech_to_speech");
        expect(typeof calls.json?.body.sttApiKey).toBe("string");
        expect(typeof calls.json?.body.ttsApiKey).toBe("string");
        expect(sonioxApi.seenOpts.map((o) => o.usageType))
            .toEqual(["transcribe_websocket", "tts_rt"]);
    });
});
```

- [ ] **Step 30: Write the failing test — the new vocabulary and split minting**

Append to `sokuji-backend/src/routes/soniox.test.ts`:

```ts
describe("sessionKeyHandler — the new mode/textOnly/bothSplit vocabulary (spec A6)", () => {
    it("split Both with speech mints THREE keys, each bound to its own four-segment reference", async () => {
        const sonioxApi = capturingSonioxApi();
        let seenAcquire: any;
        const { svc: leaseSvc } = fakeLeaseService();
        const wrappedLease = {
            ...leaseSvc,
            acquire: async (p: any) => { seenAcquire = p; return leaseSvc.acquire(p); },
        };
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(100_000_000) as any,
            makeSessionLeaseService: () => wrappedLease as any,
            makeSonioxApi: () => sonioxApi as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({
            session: USER,
            body: { mode: "both", textOnly: false, bothSplit: true },
        });

        await sessionKeyHandler(c);

        expect(calls.json?.status).toBe(200);
        const leaseId = calls.json?.body.leaseId;

        expect(sonioxApi.seenOpts.map((o) => o.usageType))
            .toEqual(["transcribe_websocket", "tts_rt", "transcribe_websocket"]);
        expect(sonioxApi.seenOpts.map((o) => o.clientReferenceId)).toEqual([
            clientRefIdFor("u1", leaseId, "spk_stt"),
            clientRefIdFor("u1", leaseId, "spk_tts"),
            clientRefIdFor("u1", leaseId, "par_stt"),
        ]);

        // Start windows: the participant leg waits on a permission dialog.
        expect(sonioxApi.seenOpts[0].expiresInSeconds).toBe(KEY_START_WINDOW_S);
        expect(sonioxApi.seenOpts[2].expiresInSeconds).toBe(PARTICIPANT_KEY_START_WINDOW_S);
        // Both STT keys share the cutoff, so both legs 403 in the same second.
        expect(sonioxApi.seenOpts[0].maxSessionDurationSeconds)
            .toBe(sonioxApi.seenOpts[2].maxSessionDurationSeconds);
        // single_use holds per KIND, not per leg.
        expect(sonioxApi.seenOpts.map((o) => o.singleUse)).toEqual([true, false, true]);

        // The lease carries the counts the server derived, not anything the
        // client declared.
        expect(seenAcquire.sttStreamCount).toBe(2);
        expect(seenAcquire.usesTts).toBe(true);
        expect(seenAcquire.startWindowS).toBe(PARTICIPANT_KEY_START_WINDOW_S);

        // Per-stream structure, plus the flat fields from the primary leg.
        expect(calls.json?.body.streams.map((s: any) => s.role))
            .toEqual(["spk_stt", "spk_tts", "par_stt"]);
        expect(calls.json?.body.sttApiKey).toBe(calls.json?.body.streams[0].apiKey);
        expect(calls.json?.body.ttsApiKey).toBe(calls.json?.body.streams[1].apiKey);
        expect(calls.json?.body.clientReferenceId)
            .toBe(clientRefIdFor("u1", leaseId, "spk_stt"));
        expect(calls.json?.body.rateUsdPerHour)
            .toBe(conservativeRateUsdPerHour(["spk_stt", "spk_tts", "par_stt"]));
    });

    it("participant-only mints ONE key and takes its flat fields from par_stt, not from an absent speaker", async () => {
        const sonioxApi = capturingSonioxApi();
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => sonioxApi as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "participant" } });

        await sessionKeyHandler(c);

        expect(calls.json?.status).toBe(200);
        expect(sonioxApi.seenOpts).toHaveLength(1);
        expect(sonioxApi.seenOpts[0].expiresInSeconds).toBe(PARTICIPANT_KEY_START_WINDOW_S);
        expect(calls.json?.body.ttsApiKey).toBeUndefined();
        expect(calls.json?.body.clientReferenceId)
            .toBe(clientRefIdFor("u1", calls.json?.body.leaseId, "par_stt"));
        expect(calls.json?.body.streams.map((s: any) => s.role)).toEqual(["par_stt"]);
    });

    it("split Both text-only halves the granted duration at the same balance", async () => {
        const make = (body: any) => {
            const { sessionKeyHandler } = createSonioxHandlers({
                makeWalletService: () => fakeWallet(550_000) as any,
                makeSessionLeaseService: () => fakeLeaseService().svc as any,
                makeSonioxApi: () => fakeSonioxApi() as any,
                makeSonioxReconciler: () => fakeReconciler().svc,
                makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
            });
            return { handler: sessionKeyHandler, ctx: makeCtx({ session: USER, body }) };
        };

        const shared = make({ mode: "both", textOnly: true, bothSplit: false });
        await shared.handler(shared.ctx.c);
        const split = make({ mode: "both", textOnly: true, bothSplit: true });
        await split.handler(split.ctx.c);

        expect(shared.ctx.calls.json?.body.maxSessionDurationSeconds).toBe(1800);
        expect(split.ctx.calls.json?.body.maxSessionDurationSeconds).toBe(900);
    });

    it("400s a 'both' body with no bothSplit rather than silently choosing shared", async () => {
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "both", textOnly: true } });
        await sessionKeyHandler(c);
        expect(calls.json?.status).toBe(400);
    });

    it("400s a 'speaker' body with no textOnly rather than silently buying the TTS path", async () => {
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(10_000_000) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: { mode: "speaker" } });
        await sessionKeyHandler(c);
        expect(calls.json?.status).toBe(400);
    });
});

describe("sessionKeyHandler — the flat expiresAt is the EARLIEST key expiry", () => {
    it("reports the first key to die, not the last one minted", async () => {
        // The TTS key lives an hour; the STT keys live 60s/180s. Reporting the
        // loop's last write (today's behaviour) tells a client the whole set is
        // good for an hour when its transcription key is already gone.
        const sonioxApi = capturingSonioxApi({
            expiresAt: [
                "2026-01-01T00:01:00Z", // spk_stt
                "2026-01-01T01:00:00Z", // spk_tts
                "2026-01-01T00:03:00Z", // par_stt
            ],
        });
        const { sessionKeyHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(100_000_000) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => sonioxApi as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => fakeVoiceSlotService().svc as any,
        });
        const { c, calls } = makeCtx({
            session: USER,
            body: { mode: "both", textOnly: false, bothSplit: true },
        });

        await sessionKeyHandler(c);

        expect(calls.json?.status).toBe(200);
        expect(calls.json?.body.expiresAt).toBe("2026-01-01T00:01:00Z");
    });
});
```

- [ ] **Step 31: Run it and watch it fail**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run src/routes/soniox.test.ts`

Expected: FAIL on many cases at once, headlined by `Error: No rate configured for SKU "1.1"` (the old `computeSessionBudget` still looks its second argument up in `RATE_USD_PER_HOUR`) and `AssertionError: expected 400 to be 200` on every new-vocabulary case (the old `isSonioxMode` guard rejects `mode: "both"`).

- [ ] **Step 32: Implement — imports, `computeSessionBudget`, and deleting `isSonioxMode`**

**(a)** In `src/routes/soniox.ts`, replace lines 5–12 verbatim:

```ts
import { createSessionLeaseService, type SessionLeaseService } from "../services/session-lease";
import { createVoiceSlotService, type VoiceSlotService } from "../services/voice-slot";
import { createWalletService, type WalletService } from "../services/wallet-service";
import {
    MAX_SESSION_S, MIN_SESSION_S, KEY_START_WINDOW_S, ttsKeyExpiresInSeconds,
    skuForMode, usageTypesForMode, type SonioxMode,
} from "../config/soniox";
import { RATE_USD_PER_HOUR, minBalanceMicroUsd, chargeMicroUsd, MICRO_USD_PER_USD } from "../services/pricing";
```

with:

```ts
import { clientRefIdFor, createSessionLeaseService, type SessionLeaseService } from "../services/session-lease";
import { createVoiceSlotService, type VoiceSlotService } from "../services/voice-slot";
import { createWalletService, type WalletService } from "../services/wallet-service";
import {
    MAX_SESSION_S, MIN_SESSION_S, ttsKeyExpiresInSeconds,
    normalizeSessionShape, expandStreamRoles, usageTypeForRole, primaryRole,
    skuForRoles, sttStreamCount, usesTtsFor, keyStartWindowForRole,
    maxKeyStartWindowS, conservativeRateUsdPerHour,
    type SonioxStreamRole,
} from "../config/soniox";
import { MICRO_USD_PER_USD } from "../services/pricing";
```

**(b)** Replace `computeSessionBudget` (lines 21–37) verbatim:

```ts
/**
 * How long a balance buys at a SKU's rate.
 *
 * Because Part A charges by time, this is a division rather than a guess — which
 * is why the session budget is exact and overdraft is structurally ~zero.
 */
export function computeSessionBudget(balanceMicroUsd: number, sku: string): SessionBudget {
    const rate = (RATE_USD_PER_HOUR as Record<string, number>)[sku];
    if (rate == null) throw new Error(`No rate configured for SKU "${sku}"`);
    const floor = minBalanceMicroUsd(sku, MIN_SESSION_S);
    if (!Number.isFinite(balanceMicroUsd) || balanceMicroUsd < floor) {
        return { affordable: false, durationS: 0, rateUsdPerHour: rate };
    }
    const seconds = (balanceMicroUsd / MICRO_USD_PER_USD / rate) * 3600;
    const durationS = Math.min(MAX_SESSION_S, Math.max(MIN_SESSION_S, Math.floor(seconds)));
    return { affordable: true, durationS, rateUsdPerHour: rate };
}
```

with:

```ts
/**
 * How long a balance buys at the CONSERVATIVE AGGREGATE RATE for this
 * session's whole stream set.
 *
 * Takes a rate, not a SKU, because a split Both session's stream set has no
 * SKU: a SKU names a billing shape, and this is now an allowance estimate.
 * The caller derives the rate from the expansion (`conservativeRateUsdPerHour`)
 * so that ONE number feeds durationS, the rate quoted back to the client, and
 * budgetMicroUsd. Two of them coming from different tables is how the on-screen
 * countdown and the real cutoff drift apart.
 */
export function computeSessionBudget(balanceMicroUsd: number, rateUsdPerHour: number): SessionBudget {
    // Fail loudly: a zero or NaN rate would divide out to an unbounded session.
    if (!Number.isFinite(rateUsdPerHour) || rateUsdPerHour <= 0) {
        throw new Error(`computeSessionBudget: invalid rate ${rateUsdPerHour}`);
    }
    const floor = microUsdAtRate(rateUsdPerHour, MIN_SESSION_S);
    if (!Number.isFinite(balanceMicroUsd) || balanceMicroUsd < floor) {
        return { affordable: false, durationS: 0, rateUsdPerHour };
    }
    const seconds = (balanceMicroUsd / MICRO_USD_PER_USD / rateUsdPerHour) * 3600;
    const durationS = Math.min(MAX_SESSION_S, Math.max(MIN_SESSION_S, Math.floor(seconds)));
    return { affordable: true, durationS, rateUsdPerHour };
}
```

**(c)** Delete `isSonioxMode` (lines 47–49) verbatim:

```ts
function isSonioxMode(v: unknown): v is SonioxMode {
    return v === "text_only" || v === "speech_to_speech";
}
```

- [ ] **Step 33: Implement — the handler's front half (validation, expansion, lease)**

In `src/routes/soniox.ts`, replace lines 141–213 of `sessionKeyHandler` — from `let body: any = {};` down to and including the `stt_full | tts_full` return — with:

```ts
        let body: any = {};
        try {
            body = await c.req.json();
        } catch {
            body = {};
        }

        // TWO DISJOINT VOCABULARIES SHARE THE KEY `mode`, and
        // `normalizeSessionShape` discriminates them by VALUE:
        // 'text_only'/'speech_to_speech' are the currently-shipped BILLING
        // shape and expand to the legacy single-stream rows;
        // 'speaker'/'participant'/'both' are the new AUDIO shape, with
        // textOnly/bothSplit alongside. Still no default: a client bug that
        // drops `mode` (or drops `textOnly` on the new path) must fail loudly
        // rather than silently buy the more expensive synthesis path.
        const shape = normalizeSessionShape(body);
        if (!shape) {
            return c.json({
                error: "Invalid mode. Use { mode: 'speaker'|'participant'|'both', textOnly, bothSplit }, or the legacy 'text_only'|'speech_to_speech'",
            }, 400);
        }

        // THE SERVER owns the expansion. This is the only source of the key
        // set — never a client-supplied stream list with a blocklist, which is
        // strictly weaker (see `expandStreamRoles`). Everything below derives
        // from it: which keys to mint, each key's reference, uses_tts, the STT
        // stream count and the budget rate.
        const roles = expandStreamRoles(shape);
        const sku = skuForRoles(roles);
        const usesTts = usesTtsFor(roles);
        const sttCount = sttStreamCount(roles);
        const rateUsdPerHour = conservativeRateUsdPerHour(roles);

        const walletService = deps.makeWalletService(c.env);
        const balance = await walletService.getBalance("user", userId);
        // getBalance returns null ONLY on a DB error (a genuinely missing wallet
        // row comes back as a valid zero-balance object) — fail closed with 503,
        // the same status TranslateRelayDO/VolcengineAST2RelayDO use for this
        // exact case, rather than reporting a transient infra failure as a
        // permission error the client would read as "don't retry".
        if (!balance) {
            return c.json({ error: "Wallet unavailable" }, 503);
        }
        if (balance.frozen) {
            return c.json({ error: "Wallet is frozen" }, 403);
        }

        const budget = computeSessionBudget(balance.balanceMicroUsd, rateUsdPerHour);
        if (!budget.affordable) {
            return c.json({ error: "Insufficient balance" }, 402);
        }

        // What THIS session can actually consume, not the whole wallet balance:
        // durationS is capped at MAX_SESSION_S, so a large balance must not be
        // advertised as spendable in one session. Computed from the SAME rate
        // the duration was divided out of, so the client's countdown tracks the
        // session's real cutoff.
        const sessionBudgetMicroUsd = microUsdAtRate(rateUsdPerHour, budget.durationS);

        const leaseService = deps.makeSessionLeaseService(c.env);
        const leaseId = crypto.randomUUID();
        const now = Date.now();

        const acquireResult = await leaseService.acquire({
            accountId: userId,
            leaseId,
            provider: "soniox",
            sku,
            usesTts,
            // Concurrency is counted per STREAM, not per lease: a split Both
            // session opens two transcriptions and must count as two against
            // MAX_STT_CONCURRENT.
            sttStreamCount: sttCount,
            maxDurationS: budget.durationS,
            budgetMicroUsd: sessionBudgetMicroUsd,
            // The lease has to outlast the widest key start window this set
            // issues — 180s when a par_stt key is in it.
            startWindowS: maxKeyStartWindowS(roles),
            now,
        });

        if (!acquireResult.ok) {
            if (acquireResult.reason === "active_lease") {
                // A user is actively blocked on this lease right now -- poke for
                // an immediate sweep, not the debounced one session-end uses,
                // and mark it `blocked` so the reconciler uses the 409 gate
                // rather than the idle heartbeat's. Without that flag a client
                // that force-quit (no `session-end`, expiry up to an hour out)
                // matched nothing, so relaunching hit this same 409 until the
                // lease expired.
                c.executionCtx.waitUntil(deps.makeSonioxReconciler(c.env).poke({ blocked: true }));
                return c.json({ error: "Another session is already active", retryAfterMs: 3000 }, 409);
            }
            // stt_full | tts_full — the org-wide Soniox concurrency ceiling, not a
            // per-account problem.
            return c.json({ error: "Soniox capacity is temporarily full" }, 503);
        }
```

- [ ] **Step 34: Implement — the handler's back half (per-role minting and the response)**

Replace the remainder of `sessionKeyHandler` — from `const lease = acquireResult.lease;` (line 215) through the closing `});` of the final `c.json` (line 310) — with:

```ts
        const lease = acquireResult.lease;
        const sonioxApi = deps.makeSonioxApi(c.env);

        const streams: Array<{
            role: SonioxStreamRole;
            apiKey: string;
            clientReferenceId: string;
            expiresAt: string;
        }> = [];

        try {
            for (const role of roles) {
                const usageType = usageTypeForRole(role);
                const isTts = usageType === "tts_rt";

                // ONE KEY, ONE REFERENCE, ONE ROLE — required, not merely tidy.
                // Probed live 2026-08-11: Soniox attributes a usage log to the
                // client_reference_id bound to the KEY and ignores the one the
                // socket declares in its config frame. Two streams sharing a key
                // are therefore indistinguishable in the usage logs, so a split
                // session's two legs could not be told apart and the lease's
                // ended-mask could not be driven at all. The reference the
                // client echoes on its socket frames is inert; it is a no-op and
                // must never be the only thing carrying a role.
                const clientReferenceId = clientRefIdFor(lease.accountId, lease.leaseId, role);

                const key = await sonioxApi.createTemporaryKey({
                    usageType,
                    // STT keys: single_use, with only a START window —
                    // KEY_START_WINDOW_S (60s), or PARTICIPANT_KEY_START_WINDOW_S
                    // (180s) for par_stt, whose leg waits on a loopback
                    // permission dialog. single_use is what stops one issued key
                    // opening two concurrent transcriptions.
                    //
                    // TTS key: MUST be reusable and MUST outlive the session,
                    // because the client is *designed* to reconnect the TTS
                    // socket — Soniox drops an idle TTS stream after ~5.3s (408;
                    // measured live against tts-rt-v1), so a reconnect happens
                    // after almost every conversational pause, and a single_use
                    // key 401s on that reconnect. So its expires_in_seconds is
                    // the granted duration, clamped by ttsKeyExpiresInSeconds /
                    // TTS_KEY_MAX_TTL_S — Soniox's own, independent 3600s
                    // ceiling on this field.
                    //
                    // ACCEPTED RISK, RESTATED: two premises of the old version of
                    // this comment are now false, so it is rewritten rather than
                    // trimmed. A reusable TTS key alive for the whole session
                    // lets a client open several concurrent TTS sockets with it.
                    //   (1) It is NO LONGER true that this costs the wallet
                    //       nothing. TTS logs used to be recorded cost-only
                    //       (sku: null -> amount 0). Under cost x K charging every
                    //       tts-* log bills the USER, so the exposure is now the
                    //       account's own balance, not pure provider spend.
                    //   (2) It is NO LONGER true that "one active lease at a
                    //       time" bounds it to one key per account. The key
                    //       outlives its lease, Soniox has no revoke API, and a
                    //       client running short sessions accumulates
                    //       independently valid keys as fast as leases release.
                    // What DOES bound it: the key stops working after this
                    // session's granted duration (<= TTS_KEY_MAX_TTL_S); every
                    // socket opened with it is independently capped at
                    // max_session_duration_seconds; MAX_TTS_CONCURRENT caps the
                    // whole org's open TTS streams; and the NUMBER of keys minted
                    // is decided here by the server-side expansion, which can
                    // never issue more than one TTS key for a session.
                    expiresInSeconds: isTts
                        ? ttsKeyExpiresInSeconds(budget.durationS)
                        : keyStartWindowForRole(role),
                    // Both STT keys of a split session share this, so at the
                    // granted-duration cutoff both legs 403 within the same
                    // second rather than one outliving the other.
                    maxSessionDurationSeconds: budget.durationS,
                    clientReferenceId,
                    singleUse: !isTts,
                });

                streams.push({ role, apiKey: key.apiKey, clientReferenceId, expiresAt: key.expiresAt });
            }
        } catch (error) {
            // A Soniox failure must not leave the account locked behind a lease
            // whose only purpose was to guard a session that never started.
            //
            // NAMED, not widened silently: a partial mint now leaks up to TWO
            // already-issued keys instead of one (split speech-to-speech mints
            // spk_stt, spk_tts, par_stt in that order, so a failure on the third
            // leaves the first two live), and one of them is the non-single_use
            // TTS key. Soniox has no revoke API, so the leaked keys are bounded
            // only by their own expires_in_seconds — the STT ones by their start
            // window, the TTS one by the granted duration.
            await leaseService.release(lease.clientRefId, Date.now());
            console.error("Soniox createTemporaryKey failed:", error);
            return c.json({ error: "Failed to issue Soniox session key" }, 502);
        }

        // The PRIMARY leg backs the flat, legacy response fields: the lease's
        // single STT role — spk_stt for speaker and for both-split, par_stt for
        // participant-only, mix_stt for both-shared.
        const primary = primaryRole(roles);
        const primaryStream = streams.find((s) => s.role === primary);
        if (!primaryStream) {
            // Unreachable: `roles` always contains its own primary role and the
            // loop above either minted every key or threw. Loud rather than a
            // response with a missing sttApiKey, which a client reads as "no key".
            throw new Error(`sessionKeyHandler: no key minted for primary role ${primary}`);
        }
        // At most one TTS role exists in any row of the matrix, so this find is
        // unambiguous by construction.
        const ttsStream = streams.find((s) => usageTypeForRole(s.role) === "tts_rt");

        return c.json({
            // --- flat fields, kept so a currently-shipped client is unchanged
            // during the deploy window ---
            sttApiKey: primaryStream.apiKey,
            ttsApiKey: ttsStream?.apiKey,
            // The EARLIEST expiry among the issued keys. Today's value is
            // whichever the mint loop wrote last, which is already meaningless.
            expiresAt: earliestExpiresAt(streams.map((s) => s.expiresAt)),
            maxSessionDurationSeconds: budget.durationS,
            budgetMicroUsd: sessionBudgetMicroUsd,
            // An AGGREGATE allowance rate for the whole stream set, not a
            // per-stream price and no longer a per-SKU list price.
            rateUsdPerHour: budget.rateUsdPerHour,
            sku,
            leaseId,
            // The PRIMARY leg's own four-segment reference — the exact value
            // bound to that key. A client may still echo it as
            // client_reference_id on its socket frames; that echo is a
            // documented NO-OP (Soniox honours the key-bound value), kept only
            // because removing it buys nothing.
            clientReferenceId: primaryStream.clientReferenceId,
            // --- additive: one entry per Soniox stream this session may open ---
            streams,
        });
```

`src/services/soniox-api.ts` is **unchanged**: `clientReferenceId` is already a per-call field on `CreateTemporaryKeyOpts`, so per-stream references need nothing there. Do not go looking for a change in that file.

- [ ] **Step 35: Run it and watch it pass**

Run: `cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend && npx vitest run && npx tsc --noEmit`

Expected: PASS — the whole backend suite green, and `tsc --noEmit` clean (CI runs it via `npm run build`).

- [ ] **Step 36: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/routes/soniox.ts src/routes/soniox.test.ts
git commit -m "feat(soniox): mint one key per stream, each with its own role reference

sessionKeyHandler expands the matrix inputs server-side and mints up to three
temporary keys, each bound to its own four-segment client_reference_id --
required, because Soniox attributes usage to the key-bound reference and
ignores the socket-level one. The response gains a per-stream structure while
every flat field stays, populated from the primary STT leg; expiresAt becomes
the earliest expiry among the issued keys.

Budgeting moves to a conservative aggregate rate for the stream set, so a
single-stream user is quoted a shorter duration at the same balance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task BE9: Fence the voice-slot unpin on lease identity

Today `VoiceSlotService.unpin` is `UPDATE soniox_voice_slots SET pinned_until = 0, last_used_at = ? WHERE account_id = ?` — account-scoped. Any teardown path frees whatever pin that account happens to hold, whoever installed it. A dead session's Soniox usage log arrives minutes later and strips the pin off the session that started since, handing a live call's voice to the LRU evictor. Spec A9 closes this by storing the pinning `lease_id` on the slot row and fencing the unpin on it — the same discipline `reserve`/`finalize`/`release` already use.

A pin is claimed **before any lease exists** (`prepareManagedVoice` runs before the first client is constructed), so a pin with `pinned_by_lease IS NULL` matches no lease and is deliberately left alone: its own short TTL is what reclaims it. `session-started` is where such a pin gets an owner.

**Files:**
- Modify: `src/services/voice-slot.ts` (interface 4-10, `get` 43-56, `reserve` 106-110, `touch` 174-189, `unpin` 191-195)
- Modify: `src/services/session-lease.ts` (append `currentLeaseId` after `getExpiresAt`, which ends at line 286)
- Modify: `src/routes/soniox.ts` (`sessionStartedHandler` 353-356, `sessionEndHandler` 383-399)
- Modify: `src/services/soniox-reconcile.ts` (`SweepPorts.unpinVoiceSlot` 262-265, call site 483-490)
- Modify: `src/durable-objects/SonioxReconcilerDO.ts` (port wiring, line 142)
- Test: `src/services/voice-slot.sqlite.test.ts` (harness 84-89, new describe appended at end)
- Test: `src/routes/soniox.test.ts` (`fakeVoiceSlotService` 164-184, `fakeLeaseService` 124-161, pin assertion 579, `sessionEndHandler` describe 726-742)
- Test: `src/services/soniox-reconcile.test.ts` (harness 200, port 234-237, assertion 521)

All paths are relative to `/home/jiangzhuo/Desktop/kizunaai/sokuji-backend`.

**Interfaces:**
- Consumes: `drizzle/0010_session_leases_role_masks.sql` containing `ALTER TABLE soniox_voice_slots ADD pinned_by_lease text;` and `sonioxVoiceSlots.pinnedByLease` in `src/db/voice-slot.schema.ts` (both produced by BE3)
- Consumes: `parseClientRefId(ref: string | null)` from `src/services/session-lease.ts`, returning at minimum `{ accountId: string; leaseId: string } | null`
- Produces: `VoiceSlot.pinnedByLease: string | null`
- Produces: `VoiceSlotService.touch(accountId: string, now: number, pinnedUntil?: number, pinnedByLease?: string): Promise<void>`
- Produces: `VoiceSlotService.unpin(accountId: string, leaseId: string, now: number): Promise<boolean>`
- Produces: `SessionLeaseService.currentLeaseId(accountId: string): Promise<string | null>`
- Produces: `SweepPorts.unpinVoiceSlot(accountId: string, leaseId: string, now: number): Promise<void>`

---

- [ ] **Step 1: Confirm BE3's column actually shipped in the SQL, not just the TS schema**

D1 is migrated from `drizzle/*.sql`, never from the TS schema. A column that exists only in `voice-slot.schema.ts` passes every unit test and then throws `no such column: pinned_by_lease` on the first production request.

Run:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
grep -n "pinned_by_lease" drizzle/0010_session_leases_role_masks.sql src/db/voice-slot.schema.ts
```

Expected — both files hit:
```
drizzle/0010_session_leases_role_masks.sql:5:ALTER TABLE `soniox_voice_slots` ADD `pinned_by_lease` text;
src/db/voice-slot.schema.ts:37:        pinnedByLease: text("pinned_by_lease"),
```

If either is missing, STOP: BE3 is incomplete and this task cannot proceed. The column must be nullable with no default — a pin claimed before any lease exists has nothing to put there.

---

- [ ] **Step 2: Point the SQLite harness at the migration chain that includes 0010**

`voice-slot.sqlite.test.ts` loads only `0009`. Migration `0010` also ALTERs `session_leases`, which that in-memory DB never creates, so loading 0010 alone throws `no such table: session_leases`.

Current code at `src/services/voice-slot.sqlite.test.ts:84-89`:
```ts
function harness() {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(loadMigration("0009_sour_junta.sql"));
    const env = makeSqliteEnv(sqlite);
    return { svc: new VoiceSlotService(env), env };
}
```

Replace with:
```ts
function harness() {
    const sqlite = new DatabaseSync(":memory:");
    // 0006-0008 create `session_leases`, a table this file never touches. They
    // are here only because migration 0010 carries BOTH scopes' ALTERs in one
    // file (the lease role masks AND this table's `pinned_by_lease`), and an
    // ALTER against a table that was never created throws. Replaying the chain
    // is the same move soniox-reconcile.sqlite.test.ts already makes; a
    // hand-picked subset is what would drift.
    sqlite.exec(loadMigration("0006_session_leases.sql"));
    sqlite.exec(loadMigration("0007_unique_client_ref.sql"));
    sqlite.exec(loadMigration("0008_session_leases_end_signalled.sql"));
    sqlite.exec(loadMigration("0009_sour_junta.sql"));
    sqlite.exec(loadMigration("0010_session_leases_role_masks.sql"));
    const env = makeSqliteEnv(sqlite);
    return { svc: new VoiceSlotService(env), env };
}
```

---

- [ ] **Step 3: Write the failing fence test**

Append to the end of `src/services/voice-slot.sqlite.test.ts`, after the `describe("the manual-voice headroom", ...)` block that closes at line 475:

```ts
/**
 * A9's fence. `unpin` used to be `WHERE account_id = ?`: every teardown path
 * freed whatever pin the account held at that moment, whoever installed it.
 * Split "Both" makes that worse (two legs tear down separately), but the bug
 * is reachable today — a finished session's usage log arrives minutes late and
 * unpins the voice a session that started since is actively using, handing it
 * to the LRU evictor mid-call.
 */
describe("VoiceSlotService.unpin fencing on lease identity", () => {
    /** A pin in the shape `sessionStartedHandler` installs: well past the build
     *  window, so it is the SESSION pin under test and not the reservation's
     *  own (which touch() only ever raises). */
    const SESSION_PIN = NOW + VOICE_BUILD_PIN_MS + 100_000;

    /** A finalized slot holding a real voice, pinned by `leaseId`. */
    async function pinnedBy(svc: VoiceSlotService, leaseId: string) {
        const r = await reserveOk(svc, "acct-a", NOW);
        await svc.finalize("acct-a", r.placeholderId, "voice-real");
        await svc.touch("acct-a", NOW, SESSION_PIN, leaseId);
    }

    it("releases the pin its own lease installed and reports that it changed a row", async () => {
        const { svc } = harness();
        await pinnedBy(svc, "L1");

        expect(await svc.unpin("acct-a", "L1", NOW + 5)).toBe(true);

        const slot = (await svc.get("acct-a"))!;
        expect(slot.pinnedUntil).toBe(0);
        expect(slot.lastUsedAt).toBe(NOW + 5);
        expect(slot.sonioxVoiceId).toBe("voice-real"); // cache kept; only the pin moved
        // The fence value is cleared with the pin, so a replayed unpin cannot
        // keep matching forever. The reconciler re-processes logs ON PURPOSE
        // (clampWindow overlaps the watermark by 60s), so this call WILL arrive
        // more than once for the same lease.
        expect(slot.pinnedByLease).toBeNull();
        expect(await svc.unpin("acct-a", "L1", NOW + 6)).toBe(false);
    });

    it("refuses to strip a pin a NEWER lease installed", async () => {
        // The scenario the fence exists for: L1's session ended, its usage log
        // is still in flight at Soniox, and the user has already started L2.
        const { svc } = harness();
        await pinnedBy(svc, "L1");
        await svc.touch("acct-a", NOW + 10, SESSION_PIN + 50_000, "L2");

        expect(await svc.unpin("acct-a", "L1", NOW + 20)).toBe(false);

        const slot = (await svc.get("acct-a"))!;
        expect(slot.pinnedUntil).toBe(SESSION_PIN + 50_000); // L2 still protected
        expect(slot.pinnedByLease).toBe("L2");
        // L2's own unpin still works, proving the fence — not some other
        // predicate — is what refused above.
        expect(await svc.unpin("acct-a", "L2", NOW + 30)).toBe(true);
        expect((await svc.get("acct-a"))!.pinnedUntil).toBe(0);
    });

    it("leaves a pin that no lease installed alone — only its own TTL reclaims it", async () => {
        // `prepareManagedVoice` claims the pin BEFORE any lease exists, so the
        // phase-one pin has a NULL fence. Nothing can name it, so the fence must
        // not be the thing that reclaims it — the TTL is.
        const { svc } = harness();
        const r = await reserveOk(svc, "acct-a", NOW);
        await svc.finalize("acct-a", r.placeholderId, "voice-real");
        const PHASE_ONE_PIN = NOW + 60_000;
        await svc.touch("acct-a", NOW, PHASE_ONE_PIN); // `ensure`'s pin: no lease id

        expect((await svc.get("acct-a"))!.pinnedByLease).toBeNull();
        expect(await svc.unpin("acct-a", "L1", NOW + 5)).toBe(false);
        expect((await svc.get("acct-a"))!.pinnedUntil).toBe(PHASE_ONE_PIN);

        // Not stranded: once the pin has lapsed the pin-fenced release path
        // takes the row, exactly as it did before this change.
        expect(await svc.release("acct-a", "voice-real", PHASE_ONE_PIN + 1)).toBe("voice-real");
        expect(await svc.get("acct-a")).toBeNull();
    });

    it("a session-started pin adopts a slot claimed before that lease existed", async () => {
        // The one place a pre-lease pin gets an owner. Without it the fence
        // would make EVERY managed session's unpin a no-op.
        const { svc } = harness();
        const r = await reserveOk(svc, "acct-a", NOW);
        await svc.finalize("acct-a", r.placeholderId, "voice-real");
        await svc.touch("acct-a", NOW, NOW + 60_000);          // ensure, no lease yet
        await svc.touch("acct-a", NOW + 1, SESSION_PIN, "L1"); // session-started

        const slot = (await svc.get("acct-a"))!;
        expect(slot.pinnedByLease).toBe("L1");
        expect(slot.pinnedUntil).toBe(SESSION_PIN);
        expect(await svc.unpin("acct-a", "L1", NOW + 2)).toBe(true);
    });

    it("an un-owned re-pin mid-session does not orphan the live session's fence", async () => {
        // A pre-warm (`ensure` with pin=1) can land while a session is running.
        // Clearing the fence there would make the live session's own unpin a
        // no-op, holding the slot for the lease's FULL expiry — up to an hour.
        const { svc } = harness();
        await pinnedBy(svc, "L1");
        await svc.touch("acct-a", NOW + 10, NOW + 60_000); // no lease id

        expect((await svc.get("acct-a"))!.pinnedByLease).toBe("L1");
        expect(await svc.unpin("acct-a", "L1", NOW + 20)).toBe(true);
    });

    it("a rebuild drops the previous session's fence with the row it replaces", async () => {
        // reserve() repurposes the row for a NEW build. A lease id left behind
        // would let that finished session's late log unpin a voice that is
        // still being built, exposing a half-built voice to eviction.
        const { svc } = harness();
        await pinnedBy(svc, "L1");
        await reserveOk(svc, "acct-a", NOW + 10); // rebuild: new placeholder, build pin

        const slot = (await svc.get("acct-a"))!;
        expect(slot.pinnedByLease).toBeNull();
        expect(await svc.unpin("acct-a", "L1", NOW + 20)).toBe(false);
        expect(slot.pinnedUntil).toBe(NOW + 10 + VOICE_BUILD_PIN_MS);
    });
});
```

---

- [ ] **Step 4: Run it and watch it fail**

Run (the `nvm` preamble is mandatory — this file throws at load time on Node < 22, and the shell default here is Node 20):
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
npx vitest run src/services/voice-slot.sqlite.test.ts
```

Expected: FAIL — 6 failures in `VoiceSlotService.unpin fencing on lease identity`, the first being:
```
AssertionError: expected undefined to be true // Object.is equality
 ❯ src/services/voice-slot.sqlite.test.ts
   expect(await svc.unpin("acct-a", "L1", NOW + 5)).toBe(true);
```
(today's `unpin` returns `void` and ignores the third argument). The 21 pre-existing tests in this file must still pass.

---

- [ ] **Step 5: Implement — the row now records who pinned it**

In `src/services/voice-slot.ts`, replace the interface at lines 4-10:
```ts
export interface VoiceSlot {
    accountId: string;
    sonioxVoiceId: string;
    createdAt: number;
    lastUsedAt: number;
    pinnedUntil: number;
}
```
with:
```ts
export interface VoiceSlot {
    accountId: string;
    sonioxVoiceId: string;
    createdAt: number;
    lastUsedAt: number;
    pinnedUntil: number;
    /** The `lease_id` of the session holding the CURRENT pin, or null when no
     *  lease is behind it: the pre-lease build/start pin `ensure` installs
     *  (`prepareManagedVoice` runs before any client, and therefore before any
     *  lease exists), or a slot that is not pinned at all. A null here is
     *  deliberately un-unpinnable — see `unpin`. */
    pinnedByLease: string | null;
}
```

Then replace `get`'s statement and mapping at lines 44-55:
```ts
        const row = await this.env.DATABASE.prepare(
            `SELECT account_id, soniox_voice_id, created_at, last_used_at, pinned_until
             FROM soniox_voice_slots WHERE account_id = ?`
        ).bind(accountId).first();
        if (!row) return null;
        return {
            accountId: String(row.account_id),
            sonioxVoiceId: String(row.soniox_voice_id),
            createdAt: Number(row.created_at),
            lastUsedAt: Number(row.last_used_at),
            pinnedUntil: Number(row.pinned_until),
        };
```
with:
```ts
        const row = await this.env.DATABASE.prepare(
            `SELECT account_id, soniox_voice_id, created_at, last_used_at, pinned_until, pinned_by_lease
             FROM soniox_voice_slots WHERE account_id = ?`
        ).bind(accountId).first();
        if (!row) return null;
        return {
            accountId: String(row.account_id),
            sonioxVoiceId: String(row.soniox_voice_id),
            createdAt: Number(row.created_at),
            lastUsedAt: Number(row.last_used_at),
            pinnedUntil: Number(row.pinned_until),
            // Not String()-ed unconditionally: the column is nullable, and
            // String(null) is the four-character string "null", which would
            // match nothing yet read as a real lease id in a debugger.
            pinnedByLease: row.pinned_by_lease == null ? null : String(row.pinned_by_lease),
        };
```

---

- [ ] **Step 6: Implement — `reserve` clears the fence, `touch` stamps it, `unpin` honours it**

In `src/services/voice-slot.ts`, replace `reserve`'s own-account UPDATE at lines 106-110:
```ts
            await this.env.DATABASE.prepare(
                `UPDATE soniox_voice_slots
                 SET soniox_voice_id = ?, created_at = ?, last_used_at = ?, pinned_until = ?
                 WHERE account_id = ?`
            ).bind(placeholderId, now, now, pinnedUntil, accountId).run();
```
with:
```ts
            await this.env.DATABASE.prepare(
                `UPDATE soniox_voice_slots
                 SET soniox_voice_id = ?, created_at = ?, last_used_at = ?, pinned_until = ?,
                     pinned_by_lease = NULL
                 WHERE account_id = ?`
            ).bind(placeholderId, now, now, pinnedUntil, accountId).run();
```
with this comment inserted immediately above that statement, under the existing "An account rebuilding its own slot" comment:
```ts
            // The fence is cleared with the row it belonged to. A previous
            // session's lease id surviving into a fresh build would let that
            // finished session's late usage log unpin a voice that is still
            // being built, handing a half-built voice to the LRU evictor.
```

Replace `touch` at lines 174-189:
```ts
    /** Mark the slot used; optionally extend the pin. Omitting `pinnedUntil`
     *  must leave the existing pin untouched — a pre-warm must never shorten
     *  the protection a live session installed. */
    async touch(accountId: string, now: number, pinnedUntil?: number): Promise<void> {
        if (pinnedUntil === undefined) {
            await this.env.DATABASE.prepare(
                `UPDATE soniox_voice_slots SET last_used_at = ? WHERE account_id = ?`
            ).bind(now, accountId).run();
            return;
        }
        await this.env.DATABASE.prepare(
            `UPDATE soniox_voice_slots
             SET last_used_at = ?, pinned_until = MAX(pinned_until, ?)
             WHERE account_id = ?`
        ).bind(now, pinnedUntil, accountId).run();
    }
```
with:
```ts
    /**
     * Mark the slot used; optionally extend the pin, and optionally record the
     * lease that owns it.
     *
     * Omitting `pinnedUntil` must leave the existing pin untouched — a pre-warm
     * must never shorten the protection a live session installed.
     *
     * Omitting `pinnedByLease` leaves the existing OWNER untouched, and that is
     * load-bearing rather than lazy. `ensure` installs the phase-one pin before
     * any lease exists, so it has no owner to pass; if that call cleared the
     * column it could land mid-session (a pre-warm while a call is running) and
     * orphan the live session's fence, making that session's own unpin a no-op
     * and holding the slot for the lease's full expiry.
     *
     * When `pinnedByLease` IS given it is written unconditionally, not
     * MAX()-guarded: the most recent `session-started` owns the pin, which is
     * the same "newest wins" rule `reserve` applies to the row itself.
     */
    async touch(
        accountId: string, now: number, pinnedUntil?: number, pinnedByLease?: string
    ): Promise<void> {
        if (pinnedUntil === undefined) {
            await this.env.DATABASE.prepare(
                `UPDATE soniox_voice_slots SET last_used_at = ? WHERE account_id = ?`
            ).bind(now, accountId).run();
            return;
        }
        if (pinnedByLease === undefined) {
            await this.env.DATABASE.prepare(
                `UPDATE soniox_voice_slots
                 SET last_used_at = ?, pinned_until = MAX(pinned_until, ?)
                 WHERE account_id = ?`
            ).bind(now, pinnedUntil, accountId).run();
            return;
        }
        await this.env.DATABASE.prepare(
            `UPDATE soniox_voice_slots
             SET last_used_at = ?, pinned_until = MAX(pinned_until, ?), pinned_by_lease = ?
             WHERE account_id = ?`
        ).bind(now, pinnedUntil, pinnedByLease, accountId).run();
    }
```

Replace `unpin` at lines 191-195:
```ts
    async unpin(accountId: string, now: number): Promise<void> {
        await this.env.DATABASE.prepare(
            `UPDATE soniox_voice_slots SET pinned_until = 0, last_used_at = ? WHERE account_id = ?`
        ).bind(now, accountId).run();
    }
```
with:
```ts
    /**
     * Release the pin THIS lease installed, and report whether it really did.
     *
     * FENCED on `pinned_by_lease` for the same reason `finalize` and `release`
     * are fenced: teardown paths run late and out of order. Account-scoped —
     * the shape this replaced — it freed whatever pin the account currently
     * held, so a finished session's usage log (which Soniox may post minutes
     * after the socket closed) could strip the pin off a session that has
     * started since, handing a live call's voice to the LRU evictor.
     *
     * A pin with a NULL `pinned_by_lease` matches no lease and is deliberately
     * left alone. That is the pre-lease pin `ensure` installs: the voice is
     * claimed before any lease exists, so nobody can name it. It is reclaimed
     * by its own short `SLOT_PIN_START_MS` TTL, which is what stops this fence
     * from stranding it — the TTL, not a caller, is the backstop.
     *
     * The fence value is cleared along with the pin, so a replayed unpin
     * reports `false` instead of matching forever. The reconciler re-processes
     * logs ON PURPOSE (`clampWindow` overlaps the watermark by 60s), so the
     * same lease's unpin will arrive more than once.
     *
     * Split "Both" sends both legs' STT logs under one lease id: the first
     * unpin wins, the second reports `false`, and nothing counts them.
     */
    async unpin(accountId: string, leaseId: string, now: number): Promise<boolean> {
        const res = await this.env.DATABASE.prepare(
            `UPDATE soniox_voice_slots
             SET pinned_until = 0, pinned_by_lease = NULL, last_used_at = ?
             WHERE account_id = ? AND pinned_by_lease = ?`
        ).bind(now, accountId, leaseId).run();
        return (res.meta?.changes ?? 0) > 0;
    }
```

---

- [ ] **Step 7: Run it and watch it pass**

Run:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
npx vitest run src/services/voice-slot.sqlite.test.ts src/db/migrations.sqlite.test.ts
```

Expected: PASS — 27 tests in `voice-slot.sqlite.test.ts` (21 existing + 6 new) and 6 in `migrations.sqlite.test.ts`.

---

- [ ] **Step 8: Write the failing route tests for `session-end`'s fence**

`sessionEndHandler` has no lease id: the currently-shipped client POSTs an empty body. It is read server-side instead.

In `src/routes/soniox.test.ts`, replace `fakeVoiceSlotService` at lines 164-184:
```ts
/** A VoiceSlotService stub recording every touch()/unpin() call, with
 *  optional rejection so tests can assert the session handlers survive a
 *  voice-slot failure. Mirrors soniox-voices.test.ts's fakeVoiceSlotService. */
function fakeVoiceSlotService(opts: { touchThrows?: boolean; unpinThrows?: boolean } = {}) {
    const touchCalls: Array<{ accountId: string; now: number; pinnedUntil?: number }> = [];
    const unpinCalls: Array<{ accountId: string; now: number }> = [];
    return {
        svc: {
            touch: async (accountId: string, now: number, pinnedUntil?: number) => {
                touchCalls.push({ accountId, now, pinnedUntil });
                if (opts.touchThrows) throw new Error("voice slot touch failed");
            },
            unpin: async (accountId: string, now: number) => {
                unpinCalls.push({ accountId, now });
                if (opts.unpinThrows) throw new Error("voice slot unpin failed");
            },
        },
        touchCalls,
        unpinCalls,
    };
}
```
with:
```ts
/** A VoiceSlotService stub recording every touch()/unpin() call, with
 *  optional rejection so tests can assert the session handlers survive a
 *  voice-slot failure. Mirrors soniox-voices.test.ts's fakeVoiceSlotService. */
function fakeVoiceSlotService(opts: { touchThrows?: boolean; unpinThrows?: boolean } = {}) {
    const touchCalls: Array<{
        accountId: string; now: number; pinnedUntil?: number; pinnedByLease?: string;
    }> = [];
    const unpinCalls: Array<{ accountId: string; leaseId: string; now: number }> = [];
    return {
        svc: {
            touch: async (
                accountId: string, now: number, pinnedUntil?: number, pinnedByLease?: string
            ) => {
                touchCalls.push({ accountId, now, pinnedUntil, pinnedByLease });
                if (opts.touchThrows) throw new Error("voice slot touch failed");
            },
            unpin: async (accountId: string, leaseId: string, now: number) => {
                unpinCalls.push({ accountId, leaseId, now });
                if (opts.unpinThrows) throw new Error("voice slot unpin failed");
                return true;
            },
        },
        touchCalls,
        unpinCalls,
    };
}
```

In the same file, add `currentLeaseId` to `fakeLeaseService`'s `svc` object, immediately after the `markStarted` line at 151:
```ts
            markStarted: async () => true,
            // The account's live lease, as sessionEndHandler reads it to fence
            // the voice-slot unpin. A string by default because the common case
            // IS a live lease; the "no lease" case is staged explicitly by the
            // one test that cares.
            currentLeaseId: async () => "lease-current",
```

Add one assertion to the existing pin test, immediately after line 579 (`expect(touchCalls[0].pinnedUntil).toBe(E);`):
```ts
        // The pin was claimed before this lease existed (prepareManagedVoice
        // runs before the first client is constructed). This is the one place
        // it gets an owner — without the stamp, session-end's fenced unpin
        // would match nothing and every managed session would hold its slot
        // until the lease's full expiry.
        expect(touchCalls[0].pinnedByLease).toBe("lease-123");
```

Replace the `sessionEndHandler` unpin test at lines 726-742:
```ts
    it("unpins the voice slot", async () => {
        const { svc: slotSvc, unpinCalls } = fakeVoiceSlotService();
        const { sessionEndHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(0) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => slotSvc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: {} });

        await sessionEndHandler(c);

        expect(calls.json?.status).toBe(200);
        expect(unpinCalls).toHaveLength(1);
        expect(unpinCalls[0].accountId).toBe("u1");
    });
```
with:
```ts
    it("unpins the voice slot, fenced on the lease the account currently holds", async () => {
        const { svc: slotSvc, unpinCalls } = fakeVoiceSlotService();
        const { sessionEndHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(0) as any,
            makeSessionLeaseService: () => fakeLeaseService().svc as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => slotSvc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: {} });

        await sessionEndHandler(c);

        expect(calls.json?.status).toBe(200);
        // The lease id is read SERVER-SIDE, not taken from the body: the
        // currently-shipped client POSTs `{}` here, so a body field it never
        // sends would turn every unpin into a silent no-op — and the pin would
        // then hold the slot for the whole granted duration of every managed
        // session, throttling the org-wide pool.
        expect(unpinCalls).toEqual([
            { accountId: "u1", leaseId: "lease-current", now: expect.any(Number) },
        ]);
    });

    it("does not unpin at all when the account holds no live lease", async () => {
        // Nothing to fence on. An unfenced fallback here would reintroduce the
        // exact bug A9 closes: freeing whatever pin the account currently
        // holds, including one installed by a session that started since.
        const { svc: slotSvc, unpinCalls } = fakeVoiceSlotService();
        const leaseSvc = { ...fakeLeaseService().svc, currentLeaseId: async () => null };
        const { sessionEndHandler } = createSonioxHandlers({
            makeWalletService: () => fakeWallet(0) as any,
            makeSessionLeaseService: () => leaseSvc as any,
            makeSonioxApi: () => fakeSonioxApi() as any,
            makeSonioxReconciler: () => fakeReconciler().svc,
            makeVoiceSlotService: () => slotSvc as any,
        });
        const { c, calls } = makeCtx({ session: USER, body: {} });

        await sessionEndHandler(c);

        expect(calls.json?.status).toBe(200);
        expect(unpinCalls).toEqual([]);
    });
```

---

- [ ] **Step 9: Run it and watch it fail**

Run:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
npx vitest run src/routes/soniox.test.ts
```

Expected: FAIL — three failures.
- `sessionStartedHandler — voice slot pin phase two > raises the voice slot pin to the lease's own expiry`: `AssertionError: expected undefined to be 'lease-123'` (the handler passes no fourth argument yet).
- `sessionEndHandler > unpins the voice slot, fenced on the lease the account currently holds`: `AssertionError: expected [ { accountId: 'u1', leaseId: <a millisecond timestamp>, now: undefined } ] to deeply equal [ { accountId: 'u1', leaseId: 'lease-current', now: Any<Number> } ]` — today's handler still calls `unpin(userId, now)`, so `now` lands in the `leaseId` slot.
- `sessionEndHandler > does not unpin at all when the account holds no live lease`: `AssertionError: expected [ { …one call… } ] to deeply equal []`.

---

- [ ] **Step 10: Implement the server-side lease lookup**

Append to `src/services/session-lease.ts`, inside `SessionLeaseService`, immediately after `getExpiresAt` (which closes at line 286) and before the class's closing brace:
```ts

    /**
     * The lease id this account currently holds, or null when it holds none.
     *
     * Scoped exactly like `markEndSignalled` (`account_id` + `reconciled_at IS
     * NULL`), so the two statements can never disagree about which lease a
     * `session-end` is talking about. `account_id` is the primary key, so this
     * matches at most one row.
     *
     * Exists so `sessionEndHandler` can fence the voice-slot unpin on lease
     * identity WITHOUT the client naming a lease. The currently-shipped client
     * POSTs an empty body to `/soniox/session-end`; a `leaseId` field it never
     * sends would make the fenced unpin match nothing on every managed session,
     * which fails silently and holds each slot until its lease expires.
     * Reading it here also means one client cannot name another's lease.
     *
     * Deliberately NOT filtered on `expires_at > now`: an expired-but-unreconciled
     * lease is still the lease whose pin this account installed, and unpinning
     * it is exactly right — the session is over.
     */
    async currentLeaseId(accountId: string): Promise<string | null> {
        const row = await this.env.DATABASE.prepare(
            "SELECT lease_id FROM session_leases WHERE account_id = ? AND reconciled_at IS NULL"
        ).bind(accountId).first();
        return row ? String(row.lease_id) : null;
    }
```

---

- [ ] **Step 11: Implement the two route handlers**

In `src/routes/soniox.ts`, replace the `sessionStartedHandler` pin call at lines 353-356:
```ts
                const expiresAt = await leaseService.getExpiresAt(userId, leaseId);
                if (expiresAt !== null) {
                    await deps.makeVoiceSlotService(c.env).touch(userId, now, expiresAt);
                }
```
with:
```ts
                const expiresAt = await leaseService.getExpiresAt(userId, leaseId);
                if (expiresAt !== null) {
                    // The lease id goes onto the row with the pin. The slot was
                    // claimed before this lease existed (prepareManagedVoice
                    // runs before any client is constructed), so this is where
                    // the pin gets an owner — and an owner is what session-end
                    // and the reconciler fence their unpin on.
                    await deps.makeVoiceSlotService(c.env).touch(userId, now, expiresAt, leaseId);
                }
```

Replace `sessionEndHandler`'s body at lines 383-399:
```ts
        const userId = session.user.id;
        const now = Date.now();

        try {
            await deps.makeSessionLeaseService(c.env).markEndSignalled(userId, now);
        } catch (error) {
            console.error("sessionEndHandler: markEndSignalled failed:", error);
        }

        // A voice slot is a cache, not a lease: failing to move its pin must
        // never fail the session itself. The pinned_until timestamp is the
        // backstop if this call is the one that goes missing.
        try {
            await deps.makeVoiceSlotService(c.env).unpin(userId, now);
        } catch (error) {
            console.error("sessionEndHandler: voice slot unpin failed:", error);
        }
```
with:
```ts
        const userId = session.user.id;
        const now = Date.now();
        const leaseService = deps.makeSessionLeaseService(c.env);

        try {
            await leaseService.markEndSignalled(userId, now);
        } catch (error) {
            console.error("sessionEndHandler: markEndSignalled failed:", error);
        }

        // A voice slot is a cache, not a lease: failing to move its pin must
        // never fail the session itself. The pinned_until timestamp is the
        // backstop if this call is the one that goes missing.
        //
        // The lease id is read SERVER-SIDE, not taken from the body. The
        // currently-shipped client POSTs `{}` here, so a body field it never
        // sends would make the fenced unpin match nothing on every session --
        // failing silently, and holding each slot for its whole granted
        // duration. Reading it here also stops one client naming another's
        // lease. `markEndSignalled` does not touch `reconciled_at`, so the
        // lease is still current at this point.
        //
        // No lease means nothing to fence on, so no unpin at all. An unfenced
        // fallback would be precisely the bug this change closes.
        try {
            const leaseId = await leaseService.currentLeaseId(userId);
            if (leaseId !== null) {
                await deps.makeVoiceSlotService(c.env).unpin(userId, leaseId, now);
            }
        } catch (error) {
            console.error("sessionEndHandler: voice slot unpin failed:", error);
        }
```

---

- [ ] **Step 12: Run it and watch it pass**

Run:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
npx vitest run src/routes/soniox.test.ts
```

Expected: PASS — every test in the file, including `voice slot pin — a failure must never fail the session handlers` (its `unpinThrows` fake is now reached through the `leaseId !== null` branch, because `fakeLeaseService` supplies `"lease-current"`).

---

- [ ] **Step 13: Write the failing reconciler-port test**

In `src/services/soniox-reconcile.test.ts`, replace line 200:
```ts
    const unpinnedVoiceSlots: { accountId: string; now: number }[] = [];
```
with:
```ts
    const unpinnedVoiceSlots: { accountId: string; leaseId: string; now: number }[] = [];
```

Replace the port at lines 234-237:
```ts
        async unpinVoiceSlot(accountId, now) {
            if (opts.unpinVoiceSlotThrows) throw new Error("D1_ERROR: unpin failed");
            unpinnedVoiceSlots.push({ accountId, now });
        },
```
with:
```ts
        async unpinVoiceSlot(accountId, leaseId, now) {
            if (opts.unpinVoiceSlotThrows) throw new Error("D1_ERROR: unpin failed");
            unpinnedVoiceSlots.push({ accountId, leaseId, now });
        },
```

Replace the assertion at line 521:
```ts
        expect(h.unpinnedVoiceSlots).toEqual([{ accountId: "acct1", now: NOW }]);
```
with:
```ts
        // Both halves come from the reference the log itself carries
        // (BASE_LOG's `sokuji1:acct1:L1`), so the unpin is fenced on the
        // session that installed the pin rather than on the account. Unfenced,
        // this call frees whatever pin `acct1` holds right now — which may
        // belong to a session that started after this log's session ended.
        expect(h.unpinnedVoiceSlots).toEqual([{ accountId: "acct1", leaseId: "L1", now: NOW }]);
```

Run:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
npx vitest run src/services/soniox-reconcile.test.ts
```

Expected: FAIL — `runSweep > releasing a lease also unpins that account's voice slot`:
```
AssertionError: expected [ { accountId: 'acct1', leaseId: 1753441800000, now: undefined } ]
to deeply equal [ { accountId: 'acct1', leaseId: 'L1', now: 1753441800000 } ]
```

---

- [ ] **Step 14: Implement the sweep port and its DO wiring**

In `src/services/soniox-reconcile.ts`, replace the port declaration at lines 262-265:
```ts
    /** Un-evict-proof a voice slot. Called alongside `releaseLease` on the
     *  same STT proof-of-end -- see the call site's comment for why a slot
     *  unpin failure must never be allowed to propagate out of the sweep. */
    unpinVoiceSlot(accountId: string, now: number): Promise<void>;
```
with:
```ts
    /** Un-evict-proof a voice slot, FENCED on the lease that installed the pin.
     *  Called alongside `releaseLease` on the same STT proof-of-end -- see the
     *  call site's comment for why a slot unpin failure must never be allowed
     *  to propagate out of the sweep, and why the lease id is not optional. */
    unpinVoiceSlot(accountId: string, leaseId: string, now: number): Promise<void>;
```

Replace the call at lines 483-490:
```ts
                    try {
                        await ports.unpinVoiceSlot(charge.subjectId, sweepStartedAt);
                    } catch (err) {
                        console.error(
                            `SonioxReconcilerDO.sweep: voice-slot unpin failed for account ` +
                            `${charge.subjectId} (log ${log.uuid}): ${err}`
                        );
                    }
```
with:
```ts
                    try {
                        // Both arguments come from the reference the LOG
                        // carries, not from `charge`: the unpin must be fenced
                        // on the session that installed the pin, and `charge`
                        // is the wrong source anyway once a log can release a
                        // lease without producing one (reading `charge.subjectId`
                        // off a null would throw OUTSIDE this try and abort the
                        // whole sweep).
                        //
                        // Null-guarded on purpose: a legacy three-segment
                        // reference releases its lease but does not parse, and
                        // there is then no lease id to fence on. That session's
                        // pin rides out its own TTL — the documented degrade,
                        // not a bug to "fix" with an unfenced unpin.
                        const pinRef = parseClientRefId(clientRefId);
                        if (pinRef) {
                            await ports.unpinVoiceSlot(
                                pinRef.accountId, pinRef.leaseId, sweepStartedAt
                            );
                        }
                    } catch (err) {
                        console.error(
                            `SonioxReconcilerDO.sweep: voice-slot unpin failed for ` +
                            `${clientRefId} (log ${log.uuid}): ${err}`
                        );
                    }
```

In `src/durable-objects/SonioxReconcilerDO.ts`, replace line 142:
```ts
            unpinVoiceSlot: (accountId, now) => createVoiceSlotService(env).unpin(accountId, now),
```
with:
```ts
            // `unpin` now reports whether it changed a row; the sweep has no use
            // for that answer (a `false` just means a newer session owns the pin,
            // which is the fence working), so it is awaited and dropped rather
            // than widening the port's return type.
            unpinVoiceSlot: async (accountId, leaseId, now) => {
                await createVoiceSlotService(env).unpin(accountId, leaseId, now);
            },
```

---

- [ ] **Step 15: Run the whole suite and watch it pass**

Run:
```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
npx vitest run --project backend
```

Expected: PASS — every backend test file, including `soniox-reconcile.sqlite.test.ts` (its `async unpinVoiceSlot() {}` stub takes no parameters and stays compatible) and `routes/soniox-voices.test.ts` (it declares its own `FakeSlotRow` and casts the service `as any`, so the new required `VoiceSlot.pinnedByLease` field does not reach it — do not add the field there).

---

- [ ] **Step 16: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-backend
git add src/services/voice-slot.ts src/services/voice-slot.sqlite.test.ts \
        src/services/session-lease.ts \
        src/routes/soniox.ts src/routes/soniox.test.ts \
        src/services/soniox-reconcile.ts src/services/soniox-reconcile.test.ts \
        src/durable-objects/SonioxReconcilerDO.ts
git commit -m "$(cat <<'EOF'
fix(soniox): fence the voice-slot unpin on the lease that pinned it

unpin was account-scoped, so any teardown freed any pin for that account:
a finished session's usage log, which Soniox posts minutes late, could
strip the pin off the session that started since and hand a live call's
voice to the LRU evictor. The pin now records its lease (session-started
stamps it; reserve clears it with the row it replaces) and unpin matches
on it, the same fencing discipline reserve/finalize already use.

A pin claimed before any lease exists carries a NULL owner and is
deliberately left alone -- prepareManagedVoice runs before the first
client, so nobody can name that pin. Its own short TTL reclaims it.

session-end reads the account's current lease server-side rather than
taking one from the body: shipped clients POST {} there, and a field
they never send would make every unpin a silent no-op.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```
