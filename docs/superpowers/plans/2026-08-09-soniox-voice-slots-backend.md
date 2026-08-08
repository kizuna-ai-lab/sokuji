# Managed Soniox Voice Slots — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `sokuji-backend` a 20-slot cache of Soniox voice objects — allocated on demand, kept warm between sessions, evicted LRU — plus the three endpoints the client drives it with.

**Architecture:** A `soniox_voice_slots` table keyed by `account_id` (the database enforces one slot per account, exactly as `session_leases` does). `VoiceSlotService` owns allocation and eviction as pure D1 statements, so the part most worth testing is testable without HTTP. A new `routes/soniox-voices.ts` exposes `GET /mine`, `POST /ensure` and `DELETE /mine`; the pin that protects a slot during a live session attaches to the two session handlers that already exist, and the reconciler that already proves sessions ended releases pins as a side effect.

**Tech Stack:** Cloudflare Workers, Hono, D1 + Drizzle, Better Auth, Vitest.

**Repo:** `sokuji-backend` (NOT sokuji-react — the spec lives there, the code does not).

**Spec:** `sokuji-react/docs/superpowers/specs/2026-08-09-soniox-managed-voice-slots-design.md`

## Global Constraints

- All code comments and identifiers in English. Repo comment style: say *why*, not *what*.
- `MAX_VOICE_SLOTS = 20` — Soniox's organization-wide ceiling. Mirrors the existing `MAX_STT_CONCURRENT` / `MAX_TTS_CONCURRENT` pattern in `src/config/soniox.ts`: our number must be raised in step with Soniox's, because the service refuses on OUR number.
- Reuse existing constants, never re-derive them: `KEY_START_WINDOW_S = 60`, `LEASE_MARGIN_MS = 15_000` (`src/config/soniox.ts`).
- The permanent Soniox key is `env.SONIOX_API_KEY`, already used by `createSonioxApi`. It must never leave the Worker.
- Eviction must be atomic — a single SQL statement whose effect is checked, never SELECT-then-DELETE. Two concurrent `ensure` calls must not pick the same victim, and must not both slip into the last free slot.
- Real-SQLite tests must **throw at load** when `node:sqlite` is unavailable, never `skipIf` — copy the rationale block from `src/services/session-lease.sqlite.test.ts`. Repo `.nvmrc` pins Node 24.
- Conventional commit messages. Do not push and do not open a PR — the user approves those separately.
- **Run every command on Node 24.** The repo's `.nvmrc` pins 24 and the two existing `*.sqlite.test.ts` files THROW AT LOAD on Node < 22 by design. A shell defaulting to Node 20 reports 2 failed suites and silently skips 50 more tests, which looks exactly like a regression you caused. Prefix every session:
  ```bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
  ```
  Baseline on Node 24 before any change: **49 files / 489 tests passing, 0 skipped**.
- Run `npm test` in `sokuji-backend` before each commit.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/db/voice-slot.schema.ts` | The `soniox_voice_slots` table | Create (Task 1) |
| `src/db/schema.ts` | Schema barrel drizzle-kit reads | Modify (Task 1) |
| `drizzle/0009_*.sql` | Generated migration | Create (Task 1) |
| `src/config/soniox.ts` | Slot quota + pin windows | Modify (Task 1) |
| `src/services/voice-slot.ts` | Allocation, eviction, pin/unpin | Create (Task 1) |
| `src/services/voice-slot.sqlite.test.ts` | The allocator against real SQLite | Create (Task 1) |
| `src/services/soniox-api.ts` | Voice CRUD against `/v1/voices` | Modify (Task 2) |
| `src/routes/soniox-voices.ts` | The three endpoints | Create (Task 3) |
| `src/routes/soniox-voices.test.ts` | Endpoint behaviour | Create (Task 3) |
| `src/index.ts` | Mount + CORS | Modify (Task 3) |
| `src/routes/soniox.ts` | Pin phase two, unpin | Modify (Task 4) |
| `src/services/soniox-reconcile.ts` | `SweepPorts.unpinVoiceSlot` | Modify (Task 5) |
| `src/durable-objects/SonioxReconcilerDO.ts` | Wire that port | Modify (Task 5) |
| `src/auth/index.ts` | `afterDelete` releases the slot | Modify (Task 6) |

---

### Task 1: Slot table and the allocator

The heart of the feature. Everything else calls into this.

**Files:**
- Create: `src/db/voice-slot.schema.ts`, `src/services/voice-slot.ts`, `src/services/voice-slot.sqlite.test.ts`
- Modify: `src/db/schema.ts`, `src/config/soniox.ts`
- Generated: `drizzle/0009_*.sql`

**Interfaces produced (later tasks depend on these exact names):**
```ts
export interface VoiceSlot {
  accountId: string; sonioxVoiceId: string;
  createdAt: number; lastUsedAt: number; pinnedUntil: number;
}
export type ReserveResult =
  | { ok: true; placeholderId: string; evictedVoiceId: string | null }
  | { ok: false; reason: "pool_exhausted"; evictedVoiceId: string | null };

export class VoiceSlotService {
  constructor(env: CloudflareBindings)
  get(accountId: string): Promise<VoiceSlot | null>
  reserve(accountId: string, now: number): Promise<ReserveResult>
  finalize(accountId: string, placeholderId: string, sonioxVoiceId: string): Promise<boolean>
  touch(accountId: string, now: number, pinnedUntil?: number): Promise<void>
  unpin(accountId: string, now: number): Promise<void>
  release(accountId: string): Promise<string | null>
}
export function createVoiceSlotService(env: CloudflareBindings): VoiceSlotService
```

- [ ] **Step 1: Add the constants**

In `src/config/soniox.ts`, append:

```ts
/** Soniox's organization-wide ceiling on stored voices, counted across all
 *  projects. Like MAX_STT_CONCURRENT above, this mirrors THEIR quota and must
 *  be raised in step with it — raising Soniox's alone changes nothing, because
 *  VoiceSlotService.reserve refuses on OUR number. */
export const MAX_VOICE_SLOTS = 20;

/** How long a slot is protected while its voice is being built at Soniox.
 *  Derived from the client's waitUntilReady timeout (60s) plus the usual
 *  margin, because the build is what this window has to outlast.
 *
 *  Equal to SLOT_PIN_START_MS today. Kept separate on purpose: it bounds a
 *  Soniox build, not a socket handshake, and config in this file already
 *  learned that lesson once — see MAX_SESSION_S vs TTS_KEY_MAX_TTL_S, whose
 *  comment explains why two coincidentally-equal constants must not be
 *  merged. */
export const VOICE_BUILD_PIN_MS = 60_000 + LEASE_MARGIN_MS;

/** Phase-one pin, set before a session starts, when no lease exists yet to
 *  copy an expiry from. Same expression and constants as
 *  SessionLeaseService.acquire's initialExpiry, for the same reason: it must
 *  cover "voice is ready" through session-key to socket-up. Phase two
 *  (session-started) replaces it with the lease's own expires_at. */
export const SLOT_PIN_START_MS = KEY_START_WINDOW_S * 1000 + LEASE_MARGIN_MS;
```

- [ ] **Step 2: Add the table**

Create `src/db/voice-slot.schema.ts`:

```ts
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * One cached Soniox voice per account, under an organization-wide ceiling of
 * MAX_VOICE_SLOTS.
 *
 * `account_id` is the primary key, so the table itself enforces "one slot per
 * account" — there is no second row to race with. Same trick, same reason, as
 * `session_leases`.
 *
 * The reference recording is NOT here and is never stored server-side: it
 * lives in the user's browser and is uploaded only when a voice must be built.
 * That is what makes eviction cheap — whatever is evicted can be rebuilt by
 * the one party that still holds the clip.
 */
export const sonioxVoiceSlots = sqliteTable(
    "soniox_voice_slots",
    {
        accountId: text("account_id").primaryKey(),
        /** Soniox's voice UUID, or a `pending:<uuid>` placeholder while the
         *  slot is reserved but the voice has not been created yet. Unique so
         *  a duplicate can never make two accounts share one Soniox voice. */
        sonioxVoiceId: text("soniox_voice_id").notNull(),
        createdAt: integer("created_at").notNull(),
        /** LRU key. Touched by every ensure, whether it pre-warms or pins. */
        lastUsedAt: integer("last_used_at").notNull(),
        /** Protection window. Covers both "being built" and "in a session", so
         *  eviction has one rule instead of two: a row with pinned_until >= now
         *  is never a victim. */
        pinnedUntil: integer("pinned_until").notNull(),
    },
    (table) => ({
        voiceIdx: uniqueIndex("idx_voice_slots_voice_id").on(table.sonioxVoiceId),
        lruIdx: index("idx_voice_slots_lru").on(table.pinnedUntil, table.lastUsedAt),
    })
);

export type SonioxVoiceSlot = typeof sonioxVoiceSlots.$inferSelect;
```

In `src/db/schema.ts`, import and spread it exactly like the others:

```ts
import * as voiceSlotSchema from "./voice-slot.schema";
// ... inside the `schema` const: ...voiceSlotSchema,
// ... and add: export * from "./voice-slot.schema";
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0009_*.sql` containing `CREATE TABLE soniox_voice_slots` and the two indexes. Read it and confirm before continuing — Task 1's test loads this file by name.

- [ ] **Step 4: Write the failing allocator tests**

Create `src/services/voice-slot.sqlite.test.ts`. Copy the `node:sqlite` guard, `loadMigration` and `makeSqliteEnv` helpers verbatim from `src/services/session-lease.sqlite.test.ts` (same rationale — a fake D1 that maps binds by position cannot catch a column/bind drift, and the eviction statement here is exactly that shape), adjusting only the thrown message to name this file. Then:

```ts
const NOW = 1_800_000_000_000;

function seed(svc: VoiceSlotService, env: any, n: number, opts: { pinned: boolean }) {
  // Rows are inserted directly so each gets a distinct last_used_at, oldest first.
  for (let i = 0; i < n; i++) {
    env.DATABASE.prepare(
      `INSERT INTO soniox_voice_slots
       (account_id, soniox_voice_id, created_at, last_used_at, pinned_until)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(`acct-${i}`, `voice-${i}`, NOW, NOW + i, opts.pinned ? NOW + 1_000_000 : 0).run();
  }
}

describe("VoiceSlotService.reserve", () => {
  it("takes a free slot when the pool has room", async () => {
    const { svc } = harness();
    const r = await svc.reserve("acct-new", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evictedVoiceId).toBeNull();
    const slot = await svc.get("acct-new");
    expect(slot!.sonioxVoiceId).toMatch(/^pending:/);
    // Reserved rows are protected while the build runs, or a competing
    // reserve would evict a slot whose voice is still being created.
    expect(slot!.pinnedUntil).toBe(NOW + VOICE_BUILD_PIN_MS);
  });

  it("evicts the least-recently-used unpinned slot when the pool is full", async () => {
    const { svc, env } = harness();
    seed(svc, env, MAX_VOICE_SLOTS, { pinned: false });
    const r = await svc.reserve("acct-new", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evictedVoiceId).toBe("voice-0"); // oldest last_used_at
    expect(await svc.get("acct-0")).toBeNull();
    expect(await svc.get("acct-new")).not.toBeNull();
  });

  it("never evicts a pinned slot — a full pool of live sessions is refused", async () => {
    const { svc, env } = harness();
    seed(svc, env, MAX_VOICE_SLOTS, { pinned: true });
    const r = await svc.reserve("acct-new", NOW);
    expect(r).toEqual({ ok: false, reason: "pool_exhausted" });
    expect(await svc.get("acct-0")).not.toBeNull();
  });

  it("two reserves racing for the last free slot: exactly one wins", async () => {
    const { svc, env } = harness();
    seed(svc, env, MAX_VOICE_SLOTS - 1, { pinned: true });
    const [a, b] = await Promise.all([svc.reserve("x", NOW), svc.reserve("y", NOW)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const rows = await env.DATABASE.prepare(
      "SELECT COUNT(*) AS n FROM soniox_voice_slots"
    ).bind().first();
    expect(Number(rows.n)).toBe(MAX_VOICE_SLOTS);
  });

  it("re-reserving for an account that already holds a slot replaces its row", async () => {
    const { svc } = harness();
    await svc.reserve("acct-a", NOW);
    await svc.finalize("acct-a", "real-1");
    const r = await svc.reserve("acct-a", NOW + 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.evictedVoiceId).toBe("real-1"); // its own voice must be deleted at Soniox
    expect((await svc.get("acct-a"))!.sonioxVoiceId).toMatch(/^pending:/);
  });
});

describe("VoiceSlotService pin lifecycle", () => {
  it("finalize swaps the placeholder for the real voice id", async () => {
    const { svc } = harness();
    await svc.reserve("acct-a", NOW);
    await svc.finalize("acct-a", "voice-real");
    expect((await svc.get("acct-a"))!.sonioxVoiceId).toBe("voice-real");
  });

  it("touch updates last_used_at and, when asked, extends the pin", async () => {
    const { svc } = harness();
    await svc.reserve("acct-a", NOW);
    await svc.finalize("acct-a", "voice-real");
    await svc.touch("acct-a", NOW + 100, NOW + 999_999);
    const slot = (await svc.get("acct-a"))!;
    expect(slot.lastUsedAt).toBe(NOW + 100);
    expect(slot.pinnedUntil).toBe(NOW + 999_999);
  });

  it("touch without a pin leaves the existing pin alone", async () => {
    const { svc } = harness();
    await svc.reserve("acct-a", NOW);
    const before = (await svc.get("acct-a"))!.pinnedUntil;
    await svc.touch("acct-a", NOW + 100);
    expect((await svc.get("acct-a"))!.pinnedUntil).toBe(before);
  });

  it("unpin makes the slot evictable again but keeps the voice", async () => {
    const { svc } = harness();
    await svc.reserve("acct-a", NOW);
    await svc.finalize("acct-a", "voice-real");
    await svc.unpin("acct-a", NOW);
    const slot = (await svc.get("acct-a"))!;
    expect(slot.pinnedUntil).toBe(0);
    expect(slot.sonioxVoiceId).toBe("voice-real");
  });

  it("release drops the row and reports the voice id to delete at Soniox", async () => {
    const { svc } = harness();
    await svc.reserve("acct-a", NOW);
    await svc.finalize("acct-a", "voice-real");
    expect(await svc.release("acct-a")).toBe("voice-real");
    expect(await svc.get("acct-a")).toBeNull();
    expect(await svc.release("acct-a")).toBeNull(); // idempotent
  });
});
```

Write `harness()` to build a `DatabaseSync`, exec `loadMigration("0009_<generated name>.sql")`, and return `{ svc: new VoiceSlotService(makeSqliteEnv(db)), env: makeSqliteEnv(db) }` — reuse ONE env object for both so the seeded rows and the service share a connection.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test -- --run src/services/voice-slot.sqlite.test.ts`
Expected: FAIL — `voice-slot.ts` does not exist yet.

- [ ] **Step 6: Implement the service**

Create `src/services/voice-slot.ts`:

```ts
import { MAX_VOICE_SLOTS, VOICE_BUILD_PIN_MS } from "../config/soniox";
import type { CloudflareBindings } from "../env";

export interface VoiceSlot {
    accountId: string;
    sonioxVoiceId: string;
    createdAt: number;
    lastUsedAt: number;
    pinnedUntil: number;
}

export type ReserveResult =
    | { ok: true; placeholderId: string; evictedVoiceId: string | null }
    /** Even a refusal can carry a voice the caller must delete: the eviction
     *  succeeded and then someone took the freed space. Dropping that id
     *  strands the voice at Soniox with no reference anywhere in our table —
     *  a permanent loss of one of the twenty slots. */
    | { ok: false; reason: "pool_exhausted"; evictedVoiceId: string | null };

export class VoiceSlotService {
    constructor(private env: CloudflareBindings) {}

    async get(accountId: string): Promise<VoiceSlot | null> {
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
    }

    /**
     * Claim this account's slot ahead of creating the voice at Soniox.
     *
     * The row is written BEFORE the Soniox create, holding a `pending:` id,
     * because the slot is the scarce resource and the UUID does not exist
     * yet. Reserving after the create would let two accounts both find room,
     * both create, and both insert — 21 voices against a ceiling of 20.
     *
     * Returns any voice id the caller must now delete at Soniox: either an
     * evicted stranger's, or this account's own previous voice when it is
     * rebuilding.
     */
    async reserve(accountId: string, now: number): Promise<ReserveResult> {
        const placeholderId = `pending:${crypto.randomUUID()}`;
        const pinnedUntil = now + VOICE_BUILD_PIN_MS;

        // An account rebuilding its own slot is not competing for capacity —
        // it already holds one. Take its row (and hand back the old voice for
        // deletion) without touching anyone else's.
        const mine = await this.get(accountId);
        if (mine) {
            await this.env.DATABASE.prepare(
                `UPDATE soniox_voice_slots
                 SET soniox_voice_id = ?, created_at = ?, last_used_at = ?, pinned_until = ?
                 WHERE account_id = ?`
            ).bind(placeholderId, now, now, pinnedUntil, accountId).run();
            const previous = mine.sonioxVoiceId.startsWith("pending:") ? null : mine.sonioxVoiceId;
            return { ok: true, placeholderId, evictedVoiceId: previous };
        }

        // One statement: the count and the insert cannot interleave, so two
        // callers cannot both slip into the last free slot. Splitting this
        // into a SELECT COUNT followed by an INSERT reopens exactly that race.
        const inserted = await this.env.DATABASE.prepare(
            `INSERT INTO soniox_voice_slots
                 (account_id, soniox_voice_id, created_at, last_used_at, pinned_until)
             SELECT ?, ?, ?, ?, ?
             WHERE (SELECT COUNT(*) FROM soniox_voice_slots) < ?`
        ).bind(accountId, placeholderId, now, now, pinnedUntil, MAX_VOICE_SLOTS).run();
        if ((inserted.meta?.changes ?? 0) > 0) {
            return { ok: true, placeholderId, evictedVoiceId: null };
        }

        // Pool is full. Evict the least-recently-used UNPINNED slot, atomically:
        // the subquery picks the victim and the DELETE commits it in one
        // statement, so two concurrent reserves cannot agree on the same row.
        const victim = await this.env.DATABASE.prepare(
            `DELETE FROM soniox_voice_slots
             WHERE account_id = (
                 SELECT account_id FROM soniox_voice_slots
                 WHERE pinned_until < ?
                 ORDER BY last_used_at ASC LIMIT 1
             )
             RETURNING soniox_voice_id`
        ).bind(now).first();
        if (!victim) return { ok: false, reason: "pool_exhausted", evictedVoiceId: null };

        const retry = await this.env.DATABASE.prepare(
            `INSERT INTO soniox_voice_slots
                 (account_id, soniox_voice_id, created_at, last_used_at, pinned_until)
             SELECT ?, ?, ?, ?, ?
             WHERE (SELECT COUNT(*) FROM soniox_voice_slots) < ?`
        ).bind(accountId, placeholderId, now, now, pinnedUntil, MAX_VOICE_SLOTS).run();
        if ((retry.meta?.changes ?? 0) === 0) {
            // Someone took the space we just freed between our DELETE and our
            // INSERT. The victim's row is already gone, so this return value is
            // the ONLY surviving reference to its voice — hand it back even on
            // the refusal path or it lives at Soniox forever, holding one of
            // twenty slots that nothing can ever reclaim.
            return {
                ok: false,
                reason: "pool_exhausted",
                evictedVoiceId: String(victim.soniox_voice_id),
            };
        }
        return { ok: true, placeholderId, evictedVoiceId: String(victim.soniox_voice_id) };
    }

    /**
     * Swap the `pending:` placeholder for the id Soniox actually issued.
     *
     * Fenced on the placeholder, and reports whether it won. One account gets
     * one slot, so a second reserve deliberately overwrites the first — which
     * means the first caller may already have created a voice at Soniox by
     * the time it gets here. Without the fence it would overwrite the winner's
     * row and strand the winner's voice; with it, `false` tells the loser to
     * delete the voice it just created, leaving exactly one voice per account.
     */
    async finalize(accountId: string, placeholderId: string, sonioxVoiceId: string): Promise<boolean> {
        const res = await this.env.DATABASE.prepare(
            `UPDATE soniox_voice_slots SET soniox_voice_id = ?
             WHERE account_id = ? AND soniox_voice_id = ?`
        ).bind(sonioxVoiceId, accountId, placeholderId).run();
        return (res.meta?.changes ?? 0) > 0;
    }

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

    async unpin(accountId: string, now: number): Promise<void> {
        await this.env.DATABASE.prepare(
            `UPDATE soniox_voice_slots SET pinned_until = 0, last_used_at = ? WHERE account_id = ?`
        ).bind(now, accountId).run();
    }

    /** Drop the row and report the voice to delete at Soniox, or null if this
     *  account held nothing (so callers can be idempotent). */
    async release(accountId: string): Promise<string | null> {
        const row = await this.env.DATABASE.prepare(
            `DELETE FROM soniox_voice_slots WHERE account_id = ? RETURNING soniox_voice_id`
        ).bind(accountId).first();
        if (!row) return null;
        const id = String(row.soniox_voice_id);
        return id.startsWith("pending:") ? null : id;
    }
}

export function createVoiceSlotService(env: CloudflareBindings): VoiceSlotService {
    return new VoiceSlotService(env);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- --run src/services/voice-slot.sqlite.test.ts`
Expected: PASS.

Note the `touch` test asserting the pin is extended uses `MAX(pinned_until, ?)`; if the "touch without a pin leaves the existing pin alone" test fails, the two branches were collapsed into one.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/db src/config/soniox.ts src/services/voice-slot.ts src/services/voice-slot.sqlite.test.ts drizzle
git commit -m "feat(soniox): add the voice slot table and its LRU allocator"
```

---

### Task 2: Voice CRUD against Soniox

**Files:**
- Modify: `src/services/soniox-api.ts`
- Test: `src/services/soniox-api.test.ts` (exists — extend it)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: a `VoiceStatus` type and three methods on the object
  `createSonioxApi(apiKey)` returns —
  ```ts
  export type VoiceStatus = "not_computed" | "processing" | "ready" | "failed";

  createVoice(name: string, clip: Blob, filename: string): Promise<{ id: string }>
  getVoice(id: string): Promise<{ id: string; status: VoiceStatus } | null>
  deleteVoice(id: string): Promise<void>
  ```
  Export `VoiceStatus` from `soniox-api.ts` alongside the existing `TempKey` /
  `UsageLog` interfaces; Task 3 imports it.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/soniox-api.test.ts`:

```ts
describe("voice management", () => {
  it("createVoice posts multipart to /v1/voices with the permanent key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 201, json: async () => ({ id: "voice-abc" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const api = createSonioxApi("perm-key");

    const out = await api.createVoice("My Voice", new Blob([new Uint8Array([1, 2])]), "clip.wav");

    expect(out).toEqual({ id: "voice-abc" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.soniox.com/v1/voices");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer perm-key");
    // Multipart body — the browser/Worker sets its own boundary, so no
    // Content-Type of ours may be present or the boundary is lost.
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("getVoice reports the tts-rt-v1 status and returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ id: "v1", models: [{ model: "tts-rt-v1", status: "ready" }] }),
    }));
    expect(await createSonioxApi("k").getVoice("v1")).toEqual({ id: "v1", status: "ready" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    expect(await createSonioxApi("k").getVoice("gone")).toBeNull();
  });

  it("deleteVoice treats 404 as success so cleanup is idempotent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await expect(createSonioxApi("k").deleteVoice("gone")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/services/soniox-api.test.ts`
Expected: FAIL — `createVoice is not a function`.

- [ ] **Step 3: Implement**

In `src/services/soniox-api.ts`, add to the object returned by `createSonioxApi`:

```ts
        /**
         * Create a cloned voice. Multipart with exactly `name` + `file`, per
         * Soniox's API — no metadata or owner fields exist, which is why
         * ownership lives in our own table.
         *
         * Deliberately no Content-Type header: fetch derives it from the
         * FormData along with the multipart boundary, and setting it by hand
         * drops the boundary and makes Soniox reject the body.
         */
        async createVoice(name: string, clip: Blob, filename: string): Promise<{ id: string }> {
            const form = new FormData();
            form.set("name", name);
            form.set("file", clip, filename);
            const res = await fetch(`${API_BASE}/v1/voices`, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}` },
                body: form,
            });
            if (!res.ok) {
                // Same shape as createTemporaryKey above: this module has no
                // retry policy of its own, so Soniox's own words about WHY it
                // refused (bad audio format, oversize clip, malformed
                // multipart) are the only diagnostic the operator ever gets.
                let body = "";
                try { body = await res.text(); } catch {}
                throw new Error(`Soniox createVoice failed: ${res.status} ${body.slice(0, 300)}`);
            }
            const body = await res.json() as { id: string };
            return { id: body.id };
        },

        /** Readiness for the one TTS model we run. `null` means the voice is
         *  gone at Soniox — the signal that a slot must be rebuilt. */
        async getVoice(id: string): Promise<{ id: string; status: VoiceStatus } | null> {
            const res = await fetch(`${API_BASE}/v1/voices/${id}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (res.status === 404) return null;
            if (!res.ok) {
                let body = "";
                try { body = await res.text(); } catch {}
                throw new Error(`Soniox getVoice failed: ${res.status} ${body.slice(0, 300)}`);
            }
            const body = await res.json() as { id: string; models?: Array<{ model: string; status: string }> };
            const entry = body.models?.find((m) => m.model === "tts-rt-v1");
            return { id: body.id, status: (entry?.status ?? "not_computed") as VoiceStatus };
        },

        /** 404 is success: cleanup runs from several paths (eviction, user
         *  delete, account deletion) and must never fail because someone else
         *  already removed it. */
        async deleteVoice(id: string): Promise<void> {
            const res = await fetch(`${API_BASE}/v1/voices/${id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!res.ok && res.status !== 404) {
                let body = "";
                try { body = await res.text(); } catch {}
                throw new Error(`Soniox deleteVoice failed: ${res.status} ${body.slice(0, 300)}`);
            }
        },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- --run src/services/soniox-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

Run: `npm test`

```bash
git add src/services/soniox-api.ts src/services/soniox-api.test.ts
git commit -m "feat(soniox): add voice create/get/delete to the API client"
```

---

### Task 3: The three endpoints

**Files:**
- Create: `src/routes/soniox-voices.ts`, `src/routes/soniox-voices.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `VoiceSlotService` (Task 1), `createSonioxApi(...).createVoice/getVoice/deleteVoice` (Task 2).
- Produces: `GET /api/soniox/voices/mine`, `POST /api/soniox/voices/ensure`, `DELETE /api/soniox/voices/mine`; and `createSonioxVoiceHandlers(deps)` for tests, mirroring `createSonioxHandlers` in `routes/soniox.ts`.

- [ ] **Step 1: Widen CORS before anything else**

`src/index.ts` allows only `["GET", "POST", "OPTIONS"]` on `/api/soniox/*`. `DELETE /mine` would fail its preflight in the browser with no server-side trace. Add `"DELETE"` to `allowMethods` in **both** `app.use("/api/soniox/*", cors({...}))` and `app.use("/api/soniox", cors({...}))`.

- [ ] **Step 2: Write the failing endpoint tests**

Create `src/routes/soniox-voices.test.ts`, following `src/routes/soniox.test.ts` for how it fakes auth and injects deps. Cover:

```ts
it("requires authentication", async () => {
  // no session -> 401 from every route
});

it("GET /mine returns null when the account holds no slot", async () => {
  // -> { voice: null }
});

it("GET /mine reads status through to Soniox, not from our row", async () => {
  // slot row exists; getVoice returns processing -> { voice: { status: 'processing' } }
  // and the row itself carries no status column to read.
});

it("GET /mine reports null when Soniox no longer has the voice", async () => {
  // getVoice -> null (404) -> { voice: null }, so the client knows to rebuild.
});

it("ensure with a warm slot touches it and returns ready without calling createVoice", async () => {
  // getVoice -> ready; createVoice must NOT be called; last_used_at advanced.
});

it("ensure without a clip and without a slot returns clip_required", async () => {
  // -> 409 { error: 'clip_required' }
});

it("ensure with a clip creates the voice and finalizes the slot", async () => {
  // reserve -> createVoice -> finalize; response { voiceId, status: 'processing' }
});

it("ensure deletes the evicted voice at Soniox", async () => {
  // pool full of unpinned slots -> deleteVoice called with the victim's id
});

it("ensure pokes the reconciler before reporting pool_exhausted", async () => {
  // all pinned -> poke({ blocked: true }) called, response 409 pool_exhausted
});

it("ensure with pin=1 applies the phase-one pin", async () => {
  // pinned_until === now + SLOT_PIN_START_MS
});

it("DELETE /mine refuses while the slot is pinned", async () => {
  // -> 409, and deleteVoice not called
});

it("DELETE /mine removes the row and the Soniox voice", async () => {
  // deleteVoice called with the stored id, and release runs BEFORE it
});

// The three branches this whole task exists for. Each one, if broken, silently
// leaks a voice at Soniox: the row leaves our table and nothing can reclaim it,
// costing one of twenty slots permanently. Assert the ARGUMENTS, not just that
// a delete happened — passing the wrong id here deletes the wrong voice.
it("ensure deletes the voice it just built when finalize reports it was superseded", async () => {
  // finalize -> false; deleteVoice called with created.id (NOT placeholderId,
  // NOT the account's existing voice); response 409 superseded
});

it("ensure releases the reservation when createVoice throws", async () => {
  // release(accountId) called; response 502. Without it, a row holding a
  // `pending:` id that never resolves occupies a slot until something evicts it.
});

it("ensure deletes a voice stranded by a lost eviction race", async () => {
  // reserve -> { ok: false, reason: 'pool_exhausted', evictedVoiceId: 'voice-stranded' }
  // deleteVoice('voice-stranded') called; response still 409 pool_exhausted
});

it("GET /mine leaves an in-flight reservation alone", async () => {
  // slot's sonioxVoiceId starts with `pending:` -> neither getVoice nor release
  // is called, so a concurrent GET cannot release an account's own in-flight
  // reservation
});
```

Write each body against the fake deps, asserting on the fakes' call arguments — the same style `soniox.test.ts` uses.

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- --run src/routes/soniox-voices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the routes**

Create `src/routes/soniox-voices.ts` with a `createSonioxVoiceHandlers(deps)` factory (deps: `makeVoiceSlotService`, `makeSonioxApi`, `makeSonioxReconciler`) exactly like `createSonioxHandlers`, exporting production handlers wired to the real services, and a Hono router mounting:

`ensureHandler` is the whole state machine and is the part worth writing out:

```ts
async function ensureHandler(c: Context<SonioxVoicesEnv>) {
    const auth = c.get("auth");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) return c.json({ error: "Authentication required" }, 401);
    const accountId = session.user.id;

    const form = await c.req.formData();
    const wantsPin = form.get("pin") === "1";
    const clip = form.get("clip");
    const now = Date.now();
    // Phase-one pin only. Phase two (the lease's own expires_at) is installed
    // by session-started; see the design doc's pin lifecycle.
    const pinnedUntil = wantsPin ? now + SLOT_PIN_START_MS : undefined;

    const slots = deps.makeVoiceSlotService(c.env);
    const soniox = deps.makeSonioxApi(c.env);

    // A slot row is a claim on capacity, not proof the voice exists: Soniox is
    // the authority on that, so status is always read through rather than
    // cached in our row, where it would drift on a build that finishes, fails,
    // or is deleted out of band.
    const existing = await slots.get(accountId);
    if (existing && !existing.sonioxVoiceId.startsWith("pending:")) {
        const live = await soniox.getVoice(existing.sonioxVoiceId);
        if (live && live.status !== "failed") {
            await slots.touch(accountId, now, pinnedUntil);
            return c.json({
                voiceId: existing.sonioxVoiceId,
                status: live.status === "ready" ? "ready" : "processing",
            });
        }
        // live === null (gone at Soniox) or failed (terminal) — fall through
        // and rebuild, which needs the clip.
    }

    if (!(clip instanceof Blob)) {
        // The caller holds the only copy of the recording, so only it can
        // rebuild. Telling it so is the whole protocol for a clip-less device.
        return c.json({ error: "clip_required" }, 409);
    }

    const reserved = await slots.reserve(accountId, now);
    if (!reserved.ok) {
        if (reserved.evictedVoiceId) {
            // reserve() evicted a row and then lost the freed space. Its
            // return value is the only surviving reference to that voice.
            try {
                await soniox.deleteVoice(reserved.evictedVoiceId);
            } catch (error) {
                console.error("ensureHandler: stranded voice delete failed:", error);
            }
        }
        // Every pinned slot might be held by a session that has already died
        // without saying so. A sweep reads Soniox's usage logs, which only
        // appear after a session ends, and frees those pins — so contend
        // first, refuse second. Same move sessionKeyHandler makes on a 409.
        c.executionCtx.waitUntil(deps.makeSonioxReconciler(c.env).poke({ blocked: true }));
        return c.json({ error: "pool_exhausted", retryAfterMs: 3000 }, 409);
    }

    if (reserved.evictedVoiceId) {
        // Best effort: the row is already gone, so a failure here leaks one
        // voice at Soniox rather than corrupting our accounting.
        try {
            await soniox.deleteVoice(reserved.evictedVoiceId);
        } catch (error) {
            console.error("ensureHandler: evicted voice delete failed:", error);
        }
    }

    try {
        // Namespaced because Soniox voice names are unique per project and
        // carry no owner field — the name is the only place provenance can
        // live on their side.
        const created = await soniox.createVoice(
            `u_${accountId}`,
            clip,
            "reference.wav"
        );
        const won = await slots.finalize(accountId, reserved.placeholderId, created.id);
        if (!won) {
            // A second reserve for this same account overwrote our slot while
            // Soniox was building. One account owns one voice, so the newer
            // request wins and this one cleans up after itself — otherwise the
            // voice we just created has no row pointing at it and never dies.
            try {
                await soniox.deleteVoice(created.id);
            } catch (error) {
                console.error("ensureHandler: superseded voice delete failed:", error);
            }
            return c.json({ error: "superseded" }, 409);
        }
        await slots.touch(accountId, now, pinnedUntil);
        return c.json({ voiceId: created.id, status: "processing" });
    } catch (error) {
        // Drop the reservation, or a row holding a `pending:` id that will
        // never resolve occupies one of twenty slots until it is evicted.
        await slots.release(accountId);
        console.error("ensureHandler: createVoice failed:", error);
        return c.json({ error: "Failed to create the voice" }, 502);
    }
}
```

`mineHandler` (GET) resolves the slot, calls `getVoice`, and on `null` **releases the row before answering** `{ voice: null }` — the slot named a voice that no longer exists, and leaving the row would hold capacity for nothing. Otherwise `{ voice: { voiceId, status, createdAt } }`.

`deleteMineHandler` refuses with `409` while `pinnedUntil >= now` — a voice cannot be pulled out from under a live session — and otherwise `release`s the row and then calls `deleteVoice`, in that order, so a Soniox outage cannot block the user from removing their own voice.

Mount in `src/index.ts` next to the existing one:

```ts
import sonioxVoiceRoutes from "./routes/soniox-voices";
app.route("/api/soniox/voices", sonioxVoiceRoutes);
```

Register it BEFORE `app.route("/api/soniox", sonioxRoutes)` so the more specific prefix wins.

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -- --run src/routes/soniox-voices.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite and commit**

Run: `npm test`

```bash
git add src/routes/soniox-voices.ts src/routes/soniox-voices.test.ts src/index.ts
git commit -m "feat(soniox): add the managed voice slot endpoints"
```

---

### Task 4: Pin phase two, and unpin on session end

**Files:**
- Modify: `src/routes/soniox.ts` (`sessionStartedHandler`, `sessionEndHandler`)
- Test: `src/routes/soniox.test.ts`

**Interfaces:**
- Consumes: `VoiceSlotService.touch/unpin` (Task 1). `createSonioxHandlers`'s deps object gains `makeVoiceSlotService`.

- [ ] **Step 1: Write the failing tests**

In `src/routes/soniox.test.ts`:

```ts
it("session-started raises the voice slot pin to the lease's own expiry", async () => {
  // lease row expires_at = E; after POST /session-started the slot's
  // pinned_until === E. Asserting the VALUE (not merely "it was called")
  // is the point: recomputing a duration here instead of copying the
  // lease's is exactly the bug this design avoids.
});

it("session-started still succeeds when the account holds no voice slot", async () => {
  // the common case — most sessions use a built-in voice
});

it("session-end unpins the voice slot", async () => {
  // pinned_until === 0 afterwards
});

it("a voice-slot failure never fails the session handlers", async () => {
  // make touch/unpin reject; the endpoints still return ok
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/routes/soniox.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `sessionStartedHandler`, after `markStarted` succeeds, read the account's lease row's `expires_at` and call `touch(userId, now, expiresAt)`. In `sessionEndHandler`, call `unpin(userId, now)`.

Wrap both in try/catch that logs and continues, matching how `sessionEndHandler` already guards `markEndSignalled`:

```ts
// A voice slot is a cache, not a lease: failing to move its pin must never
// fail the session itself. The pinned_until timestamp is the backstop if
// this call is the one that goes missing.
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- --run src/routes/soniox.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

Run: `npm test`

```bash
git add src/routes/soniox.ts src/routes/soniox.test.ts
git commit -m "feat(soniox): pin a voice slot for the life of its session"
```

---

### Task 5: The reconciler releases pins

**Files:**
- Modify: `src/services/soniox-reconcile.ts`, `src/durable-objects/SonioxReconcilerDO.ts`
- Test: `src/services/soniox-reconcile.test.ts`

**Interfaces:**
- Consumes: `VoiceSlotService.unpin` (Task 1).
- Produces: `SweepPorts.unpinVoiceSlot(accountId: string, now: number): Promise<void>`.

- [ ] **Step 1: Write the failing test**

In `src/services/soniox-reconcile.test.ts`:

```ts
it("releasing a lease also unpins that account's voice slot", async () => {
  // Drive a sweep with one stt- usage log whose clientRefId parses to
  // accountId 'acct-1'. Assert unpinVoiceSlot was called with 'acct-1'.
  // This is the un-forgeable path: the usage log proves the session ended,
  // which is why no heartbeat is needed to bound a leaked pin.
});

it("does not unpin on a tts- log", async () => {
  // A TTS socket reconnects mid-session, so a tts- log does not mean the
  // session is over — the same reason it does not release the lease.
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- --run src/services/soniox-reconcile.test.ts`
Expected: FAIL — `unpinVoiceSlot` is not part of `SweepPorts`.

- [ ] **Step 3: Implement**

Add `unpinVoiceSlot(accountId: string, now: number): Promise<void>` to `SweepPorts`. In the sweep, inside the existing `if (kind === "stt")` branch that calls `releaseLease`, also call `unpinVoiceSlot` with the accountId already parsed from the clientRefId. Wire it in `SonioxReconcilerDO.ts` next to `releaseLease`:

```ts
unpinVoiceSlot: (accountId, now) => createVoiceSlotService(this.env).unpin(accountId, now),
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- --run src/services/soniox-reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

Run: `npm test`

```bash
git add src/services/soniox-reconcile.ts src/durable-objects/SonioxReconcilerDO.ts src/services/soniox-reconcile.test.ts
git commit -m "feat(soniox): free a voice slot's pin when the reconciler proves the session ended"
```

---

### Task 6: Account deletion releases the slot

The one path that leaks a slot permanently if missed — an ownerless voice, built from a real person's recording, holding one of twenty places.

**Files:**
- Modify: `src/auth/index.ts`
- Test: `src/auth/index.test.ts` (create if absent)

**Interfaces:**
- Consumes: `VoiceSlotService.release` (Task 1), `createSonioxApi(...).deleteVoice` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
it("deleting an account deletes its Soniox voice and its slot row", async () => {
  // invoke the configured deleteUser.afterDelete hook with a user id that
  // holds a slot; assert release() ran and deleteVoice() was called with the
  // stored voice id.
});

it("account deletion survives a Soniox delete failure", async () => {
  // deleteVoice rejects; the row is still gone and the hook does not throw —
  // a user must always be able to delete their account.
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run src/auth`
Expected: FAIL — no `afterDelete` hook is configured.

- [ ] **Step 3: Implement**

In `src/auth/index.ts`, extend `deleteUser` from `{ enabled: true }` to add an `afterDelete` hook that releases the slot and deletes the voice, ordered so the row goes first:

```ts
// Row first, voice second: if the Soniox call fails we have still freed the
// slot, and the orphaned voice is a bounded leak the next eviction reclaims.
// The reverse order could leave a row pointing at a voice that no longer
// exists AND refuse to let the user delete their account.
```

Swallow and log Soniox failures — account deletion must not be blockable by a third-party outage.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run src/auth`
Expected: PASS.

- [ ] **Step 5: Full suite, and confirm the migration applies**

Run: `npm test`
Run: `npm run db:migrate:dev`
Expected: `0009` applies cleanly to the local D1.

- [ ] **Step 6: Commit**

```bash
git add src/auth
git commit -m "feat(soniox): release a voice slot when its account is deleted"
```

---

## After the plan

The backend is then complete and independently testable, but **not yet reachable by any client** — `sokuji-react` still shows managed users built-in voices only. That is the second plan, written once this contract is real.

Deployment: nothing manual. `.github/workflows/deploy.yml` applies D1 migrations
as its own step **before** the deploy step, and queues concurrent pushes rather
than cancelling them so two runs cannot race the schema.

`wrangler deploy` itself never executes SQL — it uploads the Worker and its
bindings, and `drizzle-kit generate` only writes the file. That separation is
deliberate: code deploys are frequent and reversible, schema changes are not,
and redeploying an older script would not undo a migration.

`0009` is additive and referenced by nothing that exists today, so the ordering
is forgiving in a way `0005` was not: an old Worker against the new table is
fine because it does not know the table exists, and a new Worker against a
missing table breaks only the voice endpoints, leaving sessions, billing and
the wallet untouched. `0005` was a column *rename*, which is why the runbook
treats migrate-before-deploy as load-bearing — but that hazard does not apply
here.
