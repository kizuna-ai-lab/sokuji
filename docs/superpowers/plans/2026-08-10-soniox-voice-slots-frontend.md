# Managed Soniox Custom Voices — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in Kizuna AI (managed) Soniox user record one reference clip, have the backend build a cloned voice from it, and speak with that voice — with the clip living only on their device and the cloned voice treated as a cache entry that can vanish and be rebuilt.

**Architecture:** Three seams. (1) A tiny IndexedDB database holds the one reference clip, client-side only. (2) `SonioxVoiceSection` stops constructing a `SonioxVoicesClient` and takes a `VoiceLibrarySource` instead, so BYOK and managed differ only in which implementation is handed in. (3) A pure `prepareManagedVoice()` function runs on the Start path in `MainPanel`, calls `POST /ensure` with a pin, polls to `ready`, and — when anything goes wrong — falls back to a built-in voice **for that session only** and explains why after the session is up.

**Tech Stack:** React 19 + TypeScript, Zustand, `idb`, react-i18next, Vitest + Testing Library, `fake-indexeddb`.

## Global Constraints

- **Repository:** `sokuji-react`. The backend half is already merged-pending in `kizuna-ai-lab/sokuji-backend` PR #13, branch `feat/soniox-managed-voice-slots`. Do not edit the backend from this plan.
- **Branch:** `feat/soniox-managed-voices-frontend`, cut from `feat/soniox-managed-voice-slots` (which carries this feature's spec, the backend plan, and this plan as doc commits). You are already on it — never switch branches. Do NOT push and do NOT open a PR: pushing and PR creation require jiangzhuo's explicit per-act approval, every time.
- **Node 24** (`.nvmrc`). Before any test run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24`.
- **Test command:** `npx vitest run <path>` for one file, `npm test -- --run` for the suite. Baseline measured at Task 1: **2124 tests passing, 0 skipped**. Never let it drop.
- **`Blob.prototype.arrayBuffer` does not exist under this repo's jsdom.** Any test (or production code reached by a test) that reads a Blob's bytes must feature-detect and fall back to `FileReader`, the way `src/lib/local-inference/voiceStorage.ts` already does. `src/lib/soniox/voiceClipStorage.ts` carries a `readBlobAsArrayBuffer` helper written for exactly this — reuse its shape. Test code in this plan that calls `await blob.arrayBuffer()` directly is wrong as written and must be adapted.
- **`tsc --noEmit` is NOT clean in this repo** (~113 pre-existing errors). Do not gate anything on it, and do not "fix" errors you did not create. The correctness gate is vitest.
- **English only** in all code, comments, and commit messages.
- **No new npm dependencies.** `idb`, `fake-indexeddb`, `lucide-react` and `react-i18next` are already present.
- **Locale parity is enforced by a test.** `src/locales/locales.consistency.test.ts` asserts every one of the 30 non-English catalogs has *exactly* English's key set. Adding a key to `en/translation.json` without adding it to all 30 others fails the suite. Task 6 does this in one pass; Tasks 1–5 must therefore use `t('key', 'English default')` with a literal default so the UI still reads correctly before Task 6 lands.
- **Conventional commits**, one per task. Never `git push`.

## The backend contract (as merged, not as originally specced)

Read this before writing any wire code. It is the source of truth; the design doc predates the implementation in two places.

Base URL: `` `${getApiUrl()}/soniox/voices` `` — `getApiUrl()` comes from `src/utils/environment.ts` and already resolves to `https://sokuji.kizuna.ai/api` in production. Every call carries `Authorization: Bearer <better-auth session token>`.

| Call | Request | Success | Failures |
|---|---|---|---|
| `GET /mine` | — | `200 { voice: null }` or `200 { voice: { voiceId, status, createdAt } }` | `401 {error:'authentication_required'}`, `403 {error:'verified_account_required'}` |
| `POST /ensure` | **multipart/form-data**: `pin` = `"1"` or `"0"`, `clip` = file (optional) | `200 { voiceId, status: 'ready' \| 'processing' }` | `401 authentication_required`, `403 verified_account_required` / `wallet_frozen`, `402 insufficient_balance`, `503 wallet_unavailable`, `409 clip_required`, `409 {error:'pool_exhausted', retryAfterMs}`, `409 superseded`, `502 create_failed` |
| `DELETE /mine` | — | `200 { ok: true }` | `401`, `403`, `409 {error:'voice_pinned'}` |

Three details that are easy to get wrong:

1. **`GET /mine`'s `status` is Soniox's raw four-value enum** — `'not_computed' | 'processing' | 'ready' | 'failed'`. `POST /ensure`'s `status` is normalized to only `'ready' | 'processing'`. Do not assume they are the same union.
2. **`POST /ensure` always reads `formData()`**, so the body must always be multipart even when there is no clip to send. A JSON body throws inside the handler.
3. **`ensure` succeeds without a clip when the slot is warm.** That is the fast path and it must be tried first — the clip is up to 10 MB, and uploading it at every session start would be pure waste.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/soniox/voiceClipStorage.ts` | The one reference clip, in its own IndexedDB database. Nothing else touches that database. |
| `src/lib/soniox/voiceClipStorage.test.ts` | Round-trip, overwrite, clear, and the "load never throws" contract. |
| `src/services/clients/ManagedVoicesClient.ts` | HTTP against the three backend endpoints. Turns every non-2xx into a `SonioxVoicesError` whose `errorType` is the backend's slug. |
| `src/services/clients/ManagedVoicesClient.test.ts` | Wire shape (multipart, pin flag, bearer) and every error mapping. |
| `src/components/Settings/sections/voiceLibrarySource.ts` | The `VoiceLibrarySource` interface plus the two adapters (`byokVoiceSource`, `managedVoiceSource`). |
| `src/components/Settings/sections/voiceLibrarySource.test.ts` | Both adapters against fakes; the clip-saving side effect of the managed create. |
| `src/components/MainPanel/prepareManagedVoice.ts` | Pure-ish Start-path routine: ensure → maybe upload → poll → verdict. No React, no i18n. |
| `src/components/MainPanel/prepareManagedVoice.test.ts` | Every branch of that routine with injected fakes and a fake clock. |

**Modified**

| File | Change |
|---|---|
| `src/services/clients/SonioxVoicesClient.ts` | `SonioxVoicesError` gains an optional `retryAfterMs`. Nothing else. |
| `src/components/Settings/sections/SonioxVoiceSection.tsx` | Takes `source: VoiceLibrarySource \| null` instead of building a client from `settings.apiKey`. Stops hiding the custom group when `managed`. |
| `src/components/Settings/sections/SonioxCloneConfirmModal.tsx` | Two optional props: `notice` (a paragraph above the name field) and `showName` (default `true`). |
| `src/components/Settings/sections/ProviderSpecificSettings.tsx` | Builds the right source for the active provider and passes it down. |
| `src/components/MainPanel/MainPanel.tsx` | Runs `prepareManagedVoice` before `connect()`, overrides `sessionConfig.voice`, shows a "preparing" label, appends the fallback notice after the session is up. |
| `src/locales/*/translation.json` (31 files) | Nine new keys. |

---

### Task 1: The reference clip's own IndexedDB database

**Files:**
- Create: `src/lib/soniox/voiceClipStorage.ts`
- Test: `src/lib/soniox/voiceClipStorage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `saveVoiceClip(blob: Blob): Promise<void>`, `loadVoiceClip(): Promise<Blob | null>`, `clearVoiceClip(): Promise<void>`, `resetVoiceClipStorageForTesting(): Promise<void>`.

**Why its own database, not a store in `sokuji-models`:** raising `sokuji-models`' version makes it unopenable by any older build sharing the same browser profile, which has already blanked this project's Models UI once (see `src/lib/local-inference/nativeVoiceStorage.ts`'s header for the same decision and the same reason).

**Why the blob is stored as an `ArrayBuffer` + a MIME string rather than as a `Blob`:** structured-cloning a `Blob` into IndexedDB is fine in Chromium but not dependable under jsdom + `fake-indexeddb`, and a storage module whose tests cannot run is a storage module nobody will change safely.

- [ ] **Step 1: Establish the baseline test count**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
npm test -- --run 2>&1 | tail -6
```

Write the observed "Tests N passed" number into your notes. Every later task compares against it.

- [ ] **Step 2: Write the failing test**

Create `src/lib/soniox/voiceClipStorage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saveVoiceClip,
  loadVoiceClip,
  clearVoiceClip,
  resetVoiceClipStorageForTesting,
} from './voiceClipStorage';

beforeEach(async () => { await resetVoiceClipStorageForTesting(); });

const clip = (bytes: number[], type = 'audio/wav') => new Blob([new Uint8Array(bytes)], { type });

describe('voiceClipStorage', () => {
  it('round-trips a clip with its bytes and MIME type intact', async () => {
    await saveVoiceClip(clip([1, 2, 3, 4]));
    const got = await loadVoiceClip();
    expect(got).not.toBeNull();
    expect(got!.type).toBe('audio/wav');
    expect(new Uint8Array(await got!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('holds exactly one clip — saving again replaces it', async () => {
    // One account owns one voice, so a second recording is a REPLACEMENT.
    // Accumulating clips would grow unboundedly and leave the rebuild path
    // guessing which one built the voice that exists.
    await saveVoiceClip(clip([1]));
    await saveVoiceClip(clip([2, 2]));
    const got = await loadVoiceClip();
    expect(new Uint8Array(await got!.arrayBuffer())).toEqual(new Uint8Array([2, 2]));
  });

  it('reports no clip before anything is saved, and after a clear', async () => {
    expect(await loadVoiceClip()).toBeNull();
    await saveVoiceClip(clip([9]));
    await clearVoiceClip();
    expect(await loadVoiceClip()).toBeNull();
  });

  it('answers null rather than throwing when IndexedDB is unusable', async () => {
    // loadVoiceClip runs on the session-start path. A private-mode or
    // quota-blocked IndexedDB must degrade to "this device has no clip" —
    // which the caller already handles — instead of throwing an exception
    // into the middle of starting a session.
    await resetVoiceClipStorageForTesting();
    const original = globalThis.indexedDB;
    // @ts-expect-error deliberately breaking the global for this assertion
    globalThis.indexedDB = { open: () => { throw new Error('denied'); } };
    try {
      expect(await loadVoiceClip()).toBeNull();
    } finally {
      globalThis.indexedDB = original;
      await resetVoiceClipStorageForTesting();
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/lib/soniox/voiceClipStorage.test.ts
```

Expected: FAIL — `Failed to resolve import "./voiceClipStorage"`.

- [ ] **Step 4: Implement**

Create `src/lib/soniox/voiceClipStorage.ts`:

```ts
/**
 * voiceClipStorage — the single reference recording a managed Soniox voice is
 * built from, held on THIS device and nowhere else.
 *
 * Its own database ('sokuji-voice-clip', version 1), deliberately not a new
 * store inside the shared 'sokuji-models' DB: raising that database's version
 * makes it unopenable for any older build sharing the browser profile, which
 * has already blanked this project's Models UI once. See
 * src/lib/local-inference/nativeVoiceStorage.ts for the same call.
 *
 * One record, key 'me'. A managed account owns exactly one voice, so a second
 * recording REPLACES the first rather than accumulating.
 *
 * The clip is the reason a cache-evicted voice can be rebuilt silently, and
 * the reason no biometric material is ever stored on our servers. It is also
 * why a voice cannot follow the user to a device that has never recorded one —
 * a deliberate trade, recorded in the design doc's known limitations.
 *
 * Stored as raw bytes + MIME type rather than as a Blob: structured-cloning a
 * Blob into IndexedDB is dependable in Chromium but not under jsdom +
 * fake-indexeddb, and untestable storage is storage nobody can change safely.
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'sokuji-voice-clip';
const DB_VERSION = 1;
const STORE = 'clip';
const KEY = 'me';

interface StoredClip {
  bytes: ArrayBuffer;
  type: string;
  createdAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    }).catch((error) => {
      // Never cache a rejected promise: a transient failure (a blocked
      // upgrade, a locked profile) would otherwise poison every later call
      // for the lifetime of the page.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Replace this device's reference clip. Throws on failure — the caller is a
 *  deliberate user action ("use this recording"), and silently not saving it
 *  would strand the user with a voice they can never rebuild. */
export async function saveVoiceClip(blob: Blob): Promise<void> {
  const db = await getDb();
  const record: StoredClip = {
    bytes: await blob.arrayBuffer(),
    type: blob.type || 'audio/wav',
    createdAt: Date.now(),
  };
  await db.put(STORE, record, KEY);
}

/** This device's reference clip, or null if there isn't one.
 *
 *  Never throws. This runs on the session-start path, where a private-mode or
 *  quota-blocked IndexedDB must read as "no clip on this device" — an outcome
 *  the caller already handles — rather than as an exception thrown into the
 *  middle of starting a session. */
export async function loadVoiceClip(): Promise<Blob | null> {
  try {
    const db = await getDb();
    const record = (await db.get(STORE, KEY)) as StoredClip | undefined;
    if (!record) return null;
    return new Blob([record.bytes], { type: record.type });
  } catch (error) {
    console.warn('[Sokuji] [voiceClipStorage] Could not read the stored clip:', error);
    return null;
  }
}

/** Forget this device's clip. Called when the user deletes their voice: a
 *  delete that left the source recording behind would not be a delete. */
export async function clearVoiceClip(): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE, KEY);
  } catch (error) {
    console.warn('[Sokuji] [voiceClipStorage] Could not clear the stored clip:', error);
  }
}

/** Test-only: drop the memoized connection so a fresh IDBFactory is picked up. */
export async function resetVoiceClipStorageForTesting(): Promise<void> {
  try {
    const db = await dbPromise;
    db?.close();
  } catch {
    // A connection that never opened has nothing to close.
  }
  dbPromise = null;
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {
    // The global may be deliberately broken by a test; nothing to clean up.
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

```bash
npx vitest run src/lib/soniox/voiceClipStorage.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/soniox/voiceClipStorage.ts src/lib/soniox/voiceClipStorage.test.ts
git commit -m "feat(soniox): store the managed voice's reference clip on-device"
```

---

### Task 2: `ManagedVoicesClient` — the wire to the backend's three endpoints

**Files:**
- Create: `src/services/clients/ManagedVoicesClient.ts`
- Create: `src/services/clients/ManagedVoicesClient.test.ts`
- Modify: `src/services/clients/SonioxVoicesClient.ts` (add `retryAfterMs` to `SonioxVoicesError`)

**Interfaces:**
- Consumes: `SonioxVoicesError` from `SonioxVoicesClient.ts`; `getApiUrl()` from `src/utils/environment.ts`.
- Produces:
  ```ts
  type ManagedVoiceStatus = 'not_computed' | 'processing' | 'ready' | 'failed';
  interface ManagedVoice { voiceId: string; status: ManagedVoiceStatus; createdAt: number }
  class ManagedVoicesClient {
    constructor(getToken: () => Promise<string | null>)
    mine(): Promise<ManagedVoice | null>
    ensure(opts: { pin: boolean; clip?: Blob }): Promise<{ voiceId: string; status: 'ready' | 'processing' }>
    remove(): Promise<void>
  }
  ```

**Why it throws `SonioxVoicesError` rather than returning a result union:** `SonioxVoiceSection` already has one error vocabulary and one `mapCreateError` that branches on `errorType`. Reusing that class means the managed source drops into the existing section with no translation layer, and the backend's slugs (`clip_required`, `pool_exhausted`, `voice_pinned`, …) become `errorType` values verbatim.

- [ ] **Step 1: Add `retryAfterMs` to the shared error class**

In `src/services/clients/SonioxVoicesClient.ts`, replace the `SonioxVoicesError` class with:

```ts
export class SonioxVoicesError extends Error {
  constructor(
    readonly errorType: string,
    message: string,
    readonly status: number,
    /** Server's own hint for how long to wait before retrying. Only the
     *  managed backend sends one (409 pool_exhausted); Soniox's direct API
     *  does not, which is why it is optional. */
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'SonioxVoicesError';
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/clients/ManagedVoicesClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ManagedVoicesClient } from './ManagedVoicesClient';
import { SonioxVoicesError } from './SonioxVoicesClient';

const TOKEN = 'sess_abc';
const make = () => new ManagedVoicesClient(async () => TOKEN);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ManagedVoicesClient.mine', () => {
  it('returns null when the account holds no voice', async () => {
    fetchMock.mockResolvedValue(json(200, { voice: null }));
    expect(await make().mine()).toBeNull();
  });

  it('returns the voice with Soniox\'s raw status', async () => {
    // GET /mine reads status THROUGH to Soniox, so it carries the full
    // four-value enum — 'not_computed' included. Narrowing it to
    // ready/processing here would silently mislabel a voice that has not
    // begun building.
    fetchMock.mockResolvedValue(json(200, {
      voice: { voiceId: 'v1', status: 'not_computed', createdAt: 1000 },
    }));
    expect(await make().mine()).toEqual({ voiceId: 'v1', status: 'not_computed', createdAt: 1000 });
  });

  it('sends the session token as a bearer', async () => {
    fetchMock.mockResolvedValue(json(200, { voice: null }));
    await make().mine();
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses to call at all without a token', async () => {
    // Firing an unauthenticated request would spend a round trip to learn
    // what we already know, and the 401 would surface as an infrastructure
    // error rather than "sign in".
    const client = new ManagedVoicesClient(async () => null);
    await expect(client.mine()).rejects.toMatchObject({ errorType: 'authentication_required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ManagedVoicesClient.ensure', () => {
  it('posts multipart with pin=1 and no clip on the warm path', async () => {
    // The clip is up to 10 MB. Uploading it when the slot is already warm
    // would waste the user's uplink on every single session start.
    fetchMock.mockResolvedValue(json(200, { voiceId: 'v1', status: 'ready' }));
    const res = await make().ensure({ pin: true });
    expect(res).toEqual({ voiceId: 'v1', status: 'ready' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/soniox\/voices\/ensure$/);
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('pin')).toBe('1');
    expect(form.get('clip')).toBeNull();
    // A Content-Type header would clobber the multipart boundary fetch
    // generates for us, and the backend's formData() parse would fail.
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('attaches the clip when one is supplied, and pin=0 when not pinning', async () => {
    fetchMock.mockResolvedValue(json(200, { voiceId: 'v2', status: 'processing' }));
    const clip = new Blob([new Uint8Array([1, 2])], { type: 'audio/wav' });
    await make().ensure({ pin: false, clip });
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('pin')).toBe('0');
    expect(form.get('clip')).toBeInstanceOf(Blob);
  });

  it('surfaces pool_exhausted with the server\'s own retry hint', async () => {
    // The backend pokes its reconciler before refusing, so its hint is a
    // real estimate of when a pin might have been freed — better than any
    // constant we could pick here.
    fetchMock.mockResolvedValue(json(409, { error: 'pool_exhausted', retryAfterMs: 3000 }));
    await expect(make().ensure({ pin: true })).rejects.toMatchObject({
      errorType: 'pool_exhausted',
      status: 409,
      retryAfterMs: 3000,
    });
  });

  it.each([
    [409, 'clip_required'],
    [409, 'superseded'],
    [402, 'insufficient_balance'],
    [403, 'wallet_frozen'],
    [403, 'verified_account_required'],
    [502, 'create_failed'],
    [503, 'wallet_unavailable'],
  ])('passes the backend slug through for %i %s', async (status, slug) => {
    fetchMock.mockResolvedValue(json(status, { error: slug }));
    await expect(make().ensure({ pin: true })).rejects.toMatchObject({ errorType: slug, status });
  });

  it('normalizes a transport failure instead of leaking a TypeError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await make().ensure({ pin: true }).catch((e) => e);
    expect(err).toBeInstanceOf(SonioxVoicesError);
    expect(err.errorType).toBe('network');
  });
});

describe('ManagedVoicesClient.remove', () => {
  it('resolves on 200', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await expect(make().remove()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('rejects with voice_pinned while a session holds the slot', async () => {
    fetchMock.mockResolvedValue(json(409, { error: 'voice_pinned' }));
    await expect(make().remove()).rejects.toMatchObject({ errorType: 'voice_pinned', status: 409 });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/services/clients/ManagedVoicesClient.test.ts
```

Expected: FAIL — `Failed to resolve import "./ManagedVoicesClient"`.

- [ ] **Step 4: Implement**

Create `src/services/clients/ManagedVoicesClient.ts`:

```ts
/**
 * ManagedVoicesClient — the managed (Kizuna AI) counterpart to
 * SonioxVoicesClient. Where the BYOK client talks to Soniox's /v1/voices with
 * the user's permanent project key, this one talks to our own backend with a
 * Better Auth session token, because managing voices needs a permanent Soniox
 * key that a managed user never has.
 *
 * The backend runs Soniox's 20-voice organization quota as a CACHE: an account
 * holds at most one voice, warm voices are kept, and the least recently used
 * one is evicted when someone else needs the space. Two consequences shape
 * this API:
 *
 *  - `ensure` is the only way to obtain a voice, and it is idempotent. Call it
 *    without a clip first: a warm slot answers immediately and no upload
 *    happens. Only a `clip_required` refusal means this device must upload.
 *  - The voice id is NOT stable across a rebuild. Every `ensure` response is
 *    authoritative and must be written through to settings.
 *
 * Errors are thrown as SonioxVoicesError with the backend's own slug as
 * `errorType`, so SonioxVoiceSection's existing error mapping works unchanged
 * whichever source is behind it.
 */
import { getApiUrl } from '../../utils/environment';
import { SonioxVoicesError } from './SonioxVoicesClient';

export type ManagedVoiceStatus = 'not_computed' | 'processing' | 'ready' | 'failed';

export interface ManagedVoice {
  voiceId: string;
  /** Read through to Soniox by the backend, so this is Soniox's full enum —
   *  not the ready/processing pair `ensure` narrows its answer to. */
  status: ManagedVoiceStatus;
  createdAt: number;
}

const REQUEST_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export class ManagedVoicesClient {
  constructor(private readonly getToken: () => Promise<string | null>) {}

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const token = await this.getToken();
    if (!token) {
      // Asking the server to tell us what we already know costs a round trip
      // and returns a 401 that reads like an outage instead of "sign in".
      throw new SonioxVoicesError('authentication_required', 'Sign in to manage your voice', 401);
    }
    let res: Response;
    try {
      res = await fetch(`${getApiUrl()}/soniox/voices${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new SonioxVoicesError('timeout', `Request timed out after ${timeoutMs / 1000}s`, 408);
      }
      throw new SonioxVoicesError('network', e instanceof Error ? e.message : String(e), 0);
    }
    if (!res.ok) await this.throwBackendError(res);
    return res;
  }

  /** Every failing response from this backend carries `{ error: '<slug>' }`,
   *  and 409 pool_exhausted additionally carries `retryAfterMs`. Preserve both
   *  verbatim: the slug is what callers branch on, and the hint comes from a
   *  reconciler poke we cannot second-guess from here. */
  private async throwBackendError(res: Response): Promise<never> {
    let slug = 'http_error';
    let retryAfterMs: number | undefined;
    try {
      const body = await res.json();
      if (typeof body?.error === 'string') slug = body.error;
      if (typeof body?.retryAfterMs === 'number') retryAfterMs = body.retryAfterMs;
    } catch {
      // Non-JSON body (a gateway error page): the status still carries meaning.
    }
    throw new SonioxVoicesError(slug, `HTTP ${res.status}`, res.status, retryAfterMs);
  }

  /** This account's voice as the backend currently sees it, or null when it
   *  holds none — including while a build has been reserved but has no real
   *  Soniox id yet. */
  async mine(): Promise<ManagedVoice | null> {
    const res = await this.request('/mine', { method: 'GET' }, REQUEST_TIMEOUT_MS);
    const body = await res.json();
    return body?.voice ?? null;
  }

  /**
   * Claim (or refresh) this account's slot.
   *
   * `pin: true` protects the slot from eviction for a short start window and
   * is what the session-start path asks for; the backend extends that pin to
   * the session's own expiry once the session actually starts.
   *
   * Omit `clip` first. A warm slot needs no upload, and `clip_required` is the
   * backend's way of saying this device must supply the recording.
   */
  async ensure(opts: { pin: boolean; clip?: Blob }): Promise<{ voiceId: string; status: 'ready' | 'processing' }> {
    const form = new FormData();
    form.set('pin', opts.pin ? '1' : '0');
    if (opts.clip) form.set('clip', opts.clip, 'reference.wav');
    // No Content-Type header on purpose: fetch generates the multipart
    // boundary, and setting the header by hand strips it, which makes the
    // backend's formData() parse fail.
    const res = await this.request(
      '/ensure',
      { method: 'POST', body: form },
      opts.clip ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS
    );
    const body = await res.json();
    return { voiceId: body.voiceId, status: body.status };
  }

  /** Give the slot back. Refused with `voice_pinned` while a live session
   *  still holds it. */
  async remove(): Promise<void> {
    await this.request('/mine', { method: 'DELETE' }, REQUEST_TIMEOUT_MS);
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

```bash
npx vitest run src/services/clients/ManagedVoicesClient.test.ts src/services/clients/SonioxVoicesClient.test.ts
```

Expected: PASS. Both files — the second proves the `SonioxVoicesError` signature change broke nothing.

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/ManagedVoicesClient.ts src/services/clients/ManagedVoicesClient.test.ts src/services/clients/SonioxVoicesClient.ts
git commit -m "feat(soniox): add the managed voice-slot backend client"
```

---

### Task 3: The `VoiceLibrarySource` seam, with BYOK behaviour unchanged

**Files:**
- Create: `src/components/Settings/sections/voiceLibrarySource.ts`
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx`
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:1782-1787`
- Test: `src/components/Settings/sections/SonioxVoiceSection.test.tsx` (existing, 775 lines — adapt its setup, do not rewrite its assertions)

**Interfaces:**
- Consumes: `SonioxVoicesClient`, `SonioxVoice` (Task 2's file, unchanged parts).
- Produces:
  ```ts
  interface VoiceLibrarySource {
    list(): Promise<SonioxVoice[]>;
    create(name: string, clip: Blob, fileName?: string): Promise<SonioxVoice>;
    delete(id: string): Promise<void>;
    waitUntilReady(id: string): Promise<SonioxVoice>;
    readonly canPreview: boolean;
  }
  function byokVoiceSource(client: SonioxVoicesClient): VoiceLibrarySource;
  ```

**This is the riskiest edit in the plan.** `SonioxVoiceSection` is 508 lines of carefully-guarded async state (generation counters, staleness refs, a preview cache keyed to the client identity). The whole point of this task is that its BYOK behaviour comes out **bit-identical**; the existing 775-line test file is the proof. Change the plumbing, not the logic.

- [ ] **Step 1: Write the source module**

Create `src/components/Settings/sections/voiceLibrarySource.ts`:

```ts
/**
 * The seam SonioxVoiceSection sits on.
 *
 * The section used to construct a SonioxVoicesClient from `settings.apiKey`
 * and short-circuit it to null for managed accounts, which is why the managed
 * twin could only ever show built-in voices. Lifting that construction out
 * turns "where do voices come from" into a parameter: BYOK talks to Soniox
 * directly with the user's project key, managed talks to our backend with a
 * session token, and the section itself stops knowing the difference.
 *
 * `canPreview` is part of the contract because auditioning a voice means
 * synthesizing a sample, which needs a Soniox key the managed user does not
 * have. That is a property of the SOURCE, not of the section.
 */
import type { SonioxVoice, SonioxVoicesClient } from '../../../services/clients/SonioxVoicesClient';

export interface VoiceLibrarySource {
  /** Every voice this source can offer. The managed source returns zero or
   *  one, so the section's list rendering is unchanged either way. */
  list(): Promise<SonioxVoice[]>;
  create(name: string, clip: Blob, fileName?: string): Promise<SonioxVoice>;
  delete(id: string): Promise<void>;
  waitUntilReady(id: string): Promise<SonioxVoice>;
  /** False when auditioning is impossible because this source has no Soniox
   *  key to synthesize a sample with. */
  readonly canPreview: boolean;
}

/** BYOK: SonioxVoicesClient already satisfies the interface; this only names
 *  the fact and pins `canPreview`. */
export function byokVoiceSource(client: SonioxVoicesClient): VoiceLibrarySource {
  return {
    list: () => client.list(),
    create: (name, clip, fileName) => client.create(name, clip, fileName),
    delete: (id) => client.delete(id),
    waitUntilReady: (id) => client.waitUntilReady(id),
    canPreview: true,
  };
}
```

- [ ] **Step 2: Rewire the section's props and internals**

In `src/components/Settings/sections/SonioxVoiceSection.tsx`:

Replace the props interface and the client `useMemo` (lines 46-91) with:

```ts
export interface SonioxVoiceSectionProps {
  /** `targetLanguage` and `ttsSpeed` drive the preview audition so it matches
   *  what the session would actually speak. `apiKey` is BYOK-only and is
   *  empty for managed accounts — the preview path is gated on
   *  `source.canPreview`, not on this field. */
  settings: { voice: string; apiKey: string; targetLanguage: string; ttsSpeed: number };
  onUpdate: (patch: { voice: string }) => void;
  /** Where voices come from, or null when this account cannot manage any yet
   *  (BYOK with no API key pasted, managed with no session). Null keeps the
   *  create/delete affordances hidden rather than reaching a null crash. */
  source: VoiceLibrarySource | null;
  /** Copy variant only: managed accounts get a different consent statement
   *  and no name field, because the backend names the voice itself. */
  managed: boolean;
  isSessionActive: boolean;
}
```

```ts
const SonioxVoiceSection: React.FC<SonioxVoiceSectionProps> = ({
  settings,
  onUpdate,
  source,
  managed,
  isSessionActive,
}) => {
  const { t } = useTranslation();
  // Latest-value ref so an in-flight `refresh()` can tell, at resolution
  // time, whether the source it was issued against is still current — an
  // explicit guard alongside the generation counter below rather than
  // relying solely on effect-cleanup ordering when `source` changes mid-fetch.
  const sourceRef = useRef(source);
  useEffect(() => { sourceRef.current = source; }, [source]);
```

Then apply these mechanical substitutions through the rest of the file — no logic changes:

| Before | After |
|---|---|
| `client` (the memo) | `source` (the prop) |
| `clientRef` | `sourceRef` |
| `requestClient` | `requestSource` |
| `createClient` (local const in `handleConfirm` / `finishCreate`) | `createSource` |
| `createClient: SonioxVoicesClient` (parameter type of `finishCreate`) | `createSource: VoiceLibrarySource` |
| `const [listState, setListState] = useState<...>(client ? 'loading' : 'idle')` | `…(source ? 'loading' : 'idle')` |
| `useEffect(() => { previewCacheRef.current.clear(); }, [client])` | `…, [source])` |
| `onPreview={client ? handlePreview : undefined}` | `onPreview={source?.canPreview ? handlePreview : undefined}` |
| `manageNote={client ? … : undefined}` | `manageNote={source?.canPreview ? … : undefined}` |
| `importModes: client ? ['record', 'upload'] : []` | `importModes: source ? ['record', 'upload'] : []` |
| `onImport={client ? onImport : undefined}` etc. | `onImport={source ? onImport : undefined}` etc. |
| `if (!client) return null;` in `handlePreview` | `if (!source?.canPreview) return null;` |

Remove the `SonioxVoicesClient` value import — after the seam, nothing in this file constructs one. Keep `useMemo` and `useCallback`: the `entries` memo still uses one and the next edit adds a use of the other. Add `import type { VoiceLibrarySource } from './voiceLibrarySource';`.

Then delete the two `managed`-driven suppressions in the `entries` memo, because a managed source now lists a real voice:

```ts
    const custom: VoiceEntry[] = clones.map((v) => ({
      id: v.id,
      label: isFailed(v)
        ? `${managedName(v)} — ${t('settings.sonioxVoiceFailedBadge', 'failed')}`
        : isReady(v)
          ? managedName(v)
          : `${managedName(v)} — ${t('settings.sonioxVoiceProcessingBadge', 'processing…')}`,
      group: 'custom',
      removable: true,
      // A processing/failed clone stays listed (and deletable via the
      // manage list) but can't be picked: a session started with it
      // couldn't synthesize. Auto-select only ever happens post-`ready`.
      disabled: !isReady(v),
    }));
```

with, just above the memo:

```ts
  // The managed backend names voices itself (`u_<account>_<token>`) and never
  // shows that name to anyone, so the section supplies the label instead of
  // rendering an internal identifier at the user.
  const managedName = useCallback(
    (v: SonioxVoice) => (managed ? t('settings.sonioxManagedVoiceName', 'My voice') : v.name),
    [managed, t]
  );
```

and change the placeholder guard from `if (!managed && settings.voice && …)` to:

```ts
    if (settings.voice && !known.has(settings.voice) && listState !== 'loading') {
      custom.push({
        id: settings.voice,
        label: source
          ? t('settings.sonioxVoiceDeletedPlaceholder', '(deleted voice)')
          : settings.voice,
```

Update the memo's dependency array to `[clones, managed, managedName, settings.voice, listState, source, t]`.

Dropping `!managed` from that guard does change one thing for managed accounts before Task 4 lands: a stale UUID in the `kizunaSoniox` slice would render as a raw id rather than being hidden. That state cannot exist yet — the managed twin has never been able to create a custom voice — and Task 4 gives managed a real source that resolves it properly. Do not re-add the special case to "fix" it.

Finally, make the list-error copy honest for both sources:

```ts
      {listState === 'error' && (
        <div className="setting-item">
          <div className="setting-description">
            {managed
              ? t('settings.sonioxManagedVoiceListError', 'Could not load your voice — check your connection and try again.')
              : t('settings.sonioxVoiceListError', 'Could not load cloned voices — check the API key.')}{' '}
```

- [ ] **Step 3: Rewire the render site**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, add the import near the other section imports:

```ts
import { byokVoiceSource, type VoiceLibrarySource } from './voiceLibrarySource';
import { SonioxVoicesClient } from '../../../services/clients/SonioxVoicesClient';
```

Add the source at the **component's top level**, alongside the other hooks — not inside the Soniox render block, which is a conditional branch, and hooks must never be called conditionally:

```ts
  // Memoized on primitives, never constructed inline. SonioxVoiceSection's
  // load effect depends on this object's identity, so a fresh instance per
  // render would refetch the voice list on every render — the same class of
  // bug CLAUDE.md warns about for audio devices (depend on `deviceId`, not on
  // the device object).
  const sonioxVoiceSource = useMemo<VoiceLibrarySource | null>(
    // Managed sources arrive in Task 4; until then a managed account has no
    // source, which is exactly the built-ins-only behaviour it has today.
    () => (!isKizunaManagedProvider(provider) && sonioxApiKey
      ? byokVoiceSource(new SonioxVoicesClient(sonioxApiKey))
      : null),
    [provider, sonioxApiKey]
  );
```

`sonioxApiKey` is the active slice's key as a plain string. If `activeSonioxSettings` is only computed inside the render block, read the field at top level instead:

```ts
  const sonioxApiKey = useSettingsStore(
    (s) => (s[ProviderConfigFactory.getDescriptor(provider).settingsSliceKey as keyof typeof s] as { apiKey?: string })?.apiKey ?? ''
  );
```

Then change the element to:

```tsx
        <SonioxVoiceSection
          settings={activeSonioxSettings}
          onUpdate={updateActiveSonioxSettings}
          source={sonioxVoiceSource}
          managed={managed}
          isSessionActive={isSessionActive}
        />
```

- [ ] **Step 4: Adapt the existing test file's setup only**

In `src/components/Settings/sections/SonioxVoiceSection.test.tsx`, the tests currently mock `SonioxVoicesClient` and render with `managed={false}`. Change the *setup* so it builds a fake source and passes it as `source`, leaving every assertion as it is:

```ts
import type { VoiceLibrarySource } from './voiceLibrarySource';

/** A fake source standing in for whatever the section used to construct
 *  internally. The assertions below are unchanged from before the seam
 *  existed — that is the point of this file: BYOK behaviour must come out
 *  bit-identical. */
function fakeSource(over: Partial<VoiceLibrarySource> = {}): VoiceLibrarySource {
  return {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    waitUntilReady: vi.fn(),
    canPreview: true,
    ...over,
  } as VoiceLibrarySource;
}
```

Every `render(<SonioxVoiceSection … managed={false} />)` gains `source={someFakeSource}`; the "no API key" cases pass `source={null}`.

- [ ] **Step 5: Run the section's tests plus the settings tests**

```bash
npx vitest run src/components/Settings/sections/SonioxVoiceSection.test.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx
```

Expected: PASS, with the same test count as before. If any assertion needed changing to pass, stop — that means behaviour moved, which this task forbids.

- [ ] **Step 6: Run the full suite**

```bash
npm test -- --run 2>&1 | tail -6
```

Expected: the Task 1 baseline count, still all passing.

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/sections/voiceLibrarySource.ts \
        src/components/Settings/sections/SonioxVoiceSection.tsx \
        src/components/Settings/sections/SonioxVoiceSection.test.tsx \
        src/components/Settings/sections/ProviderSpecificSettings.tsx
git commit -m "refactor(soniox): give the voice section a source seam"
```

---

### Task 4: The managed source, and the settings UI that uses it

**Files:**
- Modify: `src/components/Settings/sections/voiceLibrarySource.ts` (add `managedVoiceSource`)
- Create: `src/components/Settings/sections/voiceLibrarySource.test.ts`
- Modify: `src/components/Settings/sections/SonioxCloneConfirmModal.tsx`
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx` (managed modal props + error mapping)

**Interfaces:**
- Consumes: `ManagedVoicesClient` (Task 2), `saveVoiceClip` / `clearVoiceClip` (Task 1), `VoiceLibrarySource` (Task 3).
- Produces: `function managedVoiceSource(client: ManagedVoicesClient): VoiceLibrarySource`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Settings/sections/voiceLibrarySource.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { managedVoiceSource } from './voiceLibrarySource';
import { SonioxVoicesError } from '../../../services/clients/SonioxVoicesClient';
import { loadVoiceClip, resetVoiceClipStorageForTesting } from '../../../lib/soniox/voiceClipStorage';
import type { ManagedVoicesClient } from '../../../services/clients/ManagedVoicesClient';

beforeEach(async () => { await resetVoiceClipStorageForTesting(); });

const fakeClient = (over: Partial<ManagedVoicesClient> = {}) => ({
  mine: vi.fn().mockResolvedValue(null),
  ensure: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  ...over,
} as unknown as ManagedVoicesClient);

const clip = () => new Blob([new Uint8Array([7, 7, 7])], { type: 'audio/wav' });

describe('managedVoiceSource.list', () => {
  it('is empty when the account holds no voice', async () => {
    expect(await managedVoiceSource(fakeClient()).list()).toEqual([]);
  });

  it('projects the single voice into the shape the section renders', async () => {
    // The section decides ready/failed by looking for a tts-rt-v1 entry in
    // `models`. Without that projection a perfectly ready managed voice
    // renders as "processing…" forever and can never be selected.
    const client = fakeClient({
      mine: vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'ready', createdAt: 42 }),
    });
    const [voice] = await managedVoiceSource(client).list();
    expect(voice.id).toBe('v1');
    expect(voice.models).toEqual([{ model: 'tts-rt-v1', status: 'ready' }]);
  });
});

describe('managedVoiceSource.create', () => {
  it('stores the clip on this device before asking the backend to build', async () => {
    // The clip is the ONLY copy: the backend never keeps it. Saving after a
    // successful build would lose it whenever the build fails, leaving a user
    // who has to re-record for a retry.
    const client = fakeClient({
      ensure: vi.fn().mockResolvedValue({ voiceId: 'v9', status: 'processing' }),
    });
    const created = await managedVoiceSource(client).create('ignored', clip());
    expect(created.id).toBe('v9');
    const stored = await loadVoiceClip();
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(new Uint8Array([7, 7, 7]));
  });

  it('keeps the clip when the build request fails', async () => {
    const client = fakeClient({
      ensure: vi.fn().mockRejectedValue(new SonioxVoicesError('pool_exhausted', 'busy', 409, 3000)),
    });
    await expect(managedVoiceSource(client).create('x', clip())).rejects.toMatchObject({
      errorType: 'pool_exhausted',
    });
    expect(await loadVoiceClip()).not.toBeNull();
  });

  it('does not pin — building a voice is not starting a session', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v9', status: 'processing' });
    await managedVoiceSource(fakeClient({ ensure })).create('x', clip());
    expect(ensure).toHaveBeenCalledWith({ pin: false, clip: expect.any(Blob) });
  });
});

describe('managedVoiceSource.delete', () => {
  it('forgets the local clip too — a delete that leaves the recording is not a delete', async () => {
    const client = fakeClient();
    const source = managedVoiceSource(client);
    await source.create('x', clip()).catch(() => {});
    await source.delete('v1');
    expect(client.remove).toHaveBeenCalled();
    expect(await loadVoiceClip()).toBeNull();
  });

  it('keeps the clip when the backend refuses the delete', async () => {
    // A voice_pinned refusal means nothing was deleted anywhere. Dropping the
    // clip here would punish the user for a failed request.
    const client = fakeClient({
      remove: vi.fn().mockRejectedValue(new SonioxVoicesError('voice_pinned', 'pinned', 409)),
      ensure: vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'processing' }),
    });
    const source = managedVoiceSource(client);
    await source.create('x', clip());
    await expect(source.delete('v1')).rejects.toMatchObject({ errorType: 'voice_pinned' });
    expect(await loadVoiceClip()).not.toBeNull();
  });
});

describe('managedVoiceSource.waitUntilReady', () => {
  it('resolves once the backend reports ready', async () => {
    const mine = vi.fn()
      .mockResolvedValueOnce({ voiceId: 'v1', status: 'processing', createdAt: 1 })
      .mockResolvedValueOnce({ voiceId: 'v1', status: 'ready', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), { intervalMs: 0 });
    const voice = await source.waitUntilReady('v1');
    expect(voice.models?.[0].status).toBe('ready');
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it('rejects terminally on failed', async () => {
    // Soniox's `failed` is terminal — retrying the same clip can only fail
    // again. The section maps voice_failed to "try a clearer clip".
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'failed', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), { intervalMs: 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'voice_failed' });
  });

  it('rejects when the slot disappears mid-build', async () => {
    // Another device's ensure() can supersede this build, or the LRU can
    // evict the row. Either way there is nothing left to wait for.
    const source = managedVoiceSource(fakeClient({ mine: vi.fn().mockResolvedValue(null) }), { intervalMs: 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'voice_failed' });
  });

  it('gives up after the timeout rather than polling forever', async () => {
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'processing', createdAt: 1 });
    const source = managedVoiceSource(fakeClient({ mine }), { intervalMs: 0, timeoutMs: 0 });
    await expect(source.waitUntilReady('v1')).rejects.toMatchObject({ errorType: 'timeout' });
  });
});

describe('managedVoiceSource previewing', () => {
  it('cannot preview — there is no Soniox key to synthesize with', async () => {
    expect(managedVoiceSource(fakeClient()).canPreview).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/components/Settings/sections/voiceLibrarySource.test.ts
```

Expected: FAIL — `managedVoiceSource is not a function`.

- [ ] **Step 3: Implement the managed source**

Append to `src/components/Settings/sections/voiceLibrarySource.ts`:

```ts
import type { ManagedVoicesClient, ManagedVoice } from '../../../services/clients/ManagedVoicesClient';
import { SonioxVoicesError } from '../../../services/clients/SonioxVoicesClient';
import { saveVoiceClip, clearVoiceClip } from '../../../lib/soniox/voiceClipStorage';

const TTS_MODEL = 'tts-rt-v1';

/** Project the backend's flat voice record into the per-model shape the
 *  section reads readiness from. Without this the section's isReady/isFailed
 *  helpers find no matching model entry and every managed voice renders as
 *  "processing…" forever. */
function toSonioxVoice(voice: ManagedVoice): SonioxVoice {
  return {
    id: voice.voiceId,
    // The backend's real name is an internal identifier (`u_<account>_<token>`)
    // that must never be shown; SonioxVoiceSection supplies the label.
    name: '',
    created_at: new Date(voice.createdAt).toISOString(),
    models: [{ model: TTS_MODEL, status: voice.status }],
  };
}

/**
 * Managed (Kizuna AI): the account's single cached voice, via our backend.
 *
 * Two things differ from BYOK in ways the section must not have to know:
 *
 *  - The clip is saved to this device BEFORE the build request goes out. The
 *    backend keeps no copy, so the clip is the only thing that can rebuild an
 *    evicted voice — and saving it only on success would lose it exactly when
 *    a retry needs it most.
 *  - `name` is ignored. The backend names voices itself, uniquely per build,
 *    because Soniox enforces name uniqueness per project.
 */
export function managedVoiceSource(
  client: ManagedVoicesClient,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): VoiceLibrarySource {
  const { intervalMs = 1500, timeoutMs = 60_000 } = opts;
  return {
    async list() {
      const voice = await client.mine();
      return voice ? [toSonioxVoice(voice)] : [];
    },

    async create(_name, clip) {
      await saveVoiceClip(clip);
      // pin: false — building a voice from the settings panel is not starting
      // a session, and a pin taken here would hold one of the pool's scarce
      // slots against eviction for no session's benefit.
      const created = await client.ensure({ pin: false, clip });
      return toSonioxVoice({ voiceId: created.voiceId, status: created.status, createdAt: Date.now() });
    },

    async delete(_id) {
      // The backend deletes THE account's voice; there is only one, so the id
      // is informational. Order matters: clearing the clip first would lose
      // the recording even when the backend refuses (voice_pinned).
      await client.remove();
      await clearVoiceClip();
    },

    async waitUntilReady(id) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const voice = await client.mine();
        if (!voice) {
          // Another device superseded this build, or the LRU evicted the row.
          // There is nothing left to wait for, and the section's voice_failed
          // branch already says "try again".
          throw new SonioxVoicesError('voice_failed', 'The voice is no longer available', 404);
        }
        if (voice.status === 'ready') return toSonioxVoice(voice);
        if (voice.status === 'failed') {
          throw new SonioxVoicesError('voice_failed', 'Voice processing failed', 503);
        }
        if (Date.now() >= deadline) {
          throw new SonioxVoicesError('timeout', 'Voice processing timed out', 408);
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },

    // Auditioning synthesizes a sample, which needs a Soniox key a managed
    // user does not have.
    canPreview: false,
  };
}
```

Also add `SonioxVoice` to the existing type import at the top of the file if it is currently `import type { SonioxVoice, SonioxVoicesClient }` — it already is.

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run src/components/Settings/sections/voiceLibrarySource.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Give the confirm modal its managed variant**

In `src/components/Settings/sections/SonioxCloneConfirmModal.tsx`, add two optional props:

```ts
  /** Extra statement shown above the name field. Managed accounts use it to
   *  say where the recording goes, since it leaves the device for a service
   *  the user did not hand a key to themselves. */
  notice?: string;
  /** False hides the name field entirely. The managed backend names voices
   *  itself, so offering a name the user cannot influence would be a lie. */
  showName?: boolean;
```

Destructure them with `showName = true`, render the notice above the `<input>`:

```tsx
        {notice && (
          <p className="soniox-clone-confirm-modal__notice">{notice}</p>
        )}
        {showName && (
          <input
            type="text"
            className="text-input"
            value={name}
            maxLength={128}
            placeholder={t('settings.sonioxVoiceNamePlaceholder', 'Name for a new cloned voice (optional)')}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        )}
```

Add to `src/components/Settings/sections/VoiceLibrarySection.scss` (where the modal's other styles live — confirm with `grep -n 'soniox-clone-confirm-modal' src/components/Settings/sections/*.scss`):

```scss
.soniox-clone-confirm-modal__notice {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  opacity: 0.75;
}
```

- [ ] **Step 6: Pass the variant, and map the managed error slugs, in the section**

In `SonioxVoiceSection.tsx`, extend `mapCreateError` with the backend's slugs:

```ts
      if (e.errorType === 'pool_exhausted') {
        return new Error(t('settings.sonioxVoicePoolExhausted', 'All custom voice slots are in use right now — please try again in a moment.'));
      }
      if (e.errorType === 'voice_pinned') {
        return new Error(t('settings.sonioxVoicePinned', 'This voice is in use by a running session — end the session before deleting it.'));
      }
      if (e.errorType === 'insufficient_balance') {
        return new Error(t('settings.sonioxVoiceInsufficientBalance', 'Add balance to your account before building a custom voice.'));
      }
```

and render the modal with the managed variant:

```tsx
      <SonioxCloneConfirmModal
        key={pendingSeq}
        isOpen={pending !== null}
        audioBlob={pending?.blob ?? null}
        error={modalError}
        busy={modalBusy}
        showName={!managed}
        notice={managed
          ? t(
              'settings.sonioxManagedCloneNotice',
              'This recording is sent to Kizuna AI and passed on to Soniox to build your voice. It is not stored on our servers — it stays on this device so your voice can be rebuilt later.'
            )
          : undefined}
        onConfirm={(name) => void handleConfirm(name)}
        onClose={closeModal}
      />
```

- [ ] **Step 7: Build the managed source at the render site**

In `ProviderSpecificSettings.tsx`, add near the other hooks at the component's top level (NOT inside the Soniox render block — hooks must not be conditional):

```ts
  // useAuth() returns a fresh object (and a fresh getToken) on every render.
  // Capturing it in a ref and closing over the ref keeps the memo below stable,
  // so SonioxVoiceSection's load effect does not refetch on every render — the
  // same class of bug the audio-device code avoids by depending on deviceId
  // rather than on the device object.
  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; }, [getToken]);
```

and replace Task 3's `sonioxVoiceSource` memo with:

```ts
  const sonioxVoiceSource = useMemo<VoiceLibrarySource | null>(() => {
    if (isKizunaManagedProvider(provider)) {
      return managedVoiceSource(
        new ManagedVoicesClient(async () => (getTokenRef.current ? getTokenRef.current() : null))
      );
    }
    return sonioxApiKey ? byokVoiceSource(new SonioxVoicesClient(sonioxApiKey)) : null;
  }, [provider, sonioxApiKey]);
```

The element already reads `source={sonioxVoiceSource}` from Task 3. Extend the imports:

```ts
import { byokVoiceSource, managedVoiceSource, type VoiceLibrarySource } from './voiceLibrarySource';
import { ManagedVoicesClient } from '../../../services/clients/ManagedVoicesClient';
```

- [ ] **Step 8: Run the settings tests**

```bash
npx vitest run src/components/Settings/sections/ src/services/clients/
```

Expected: PASS. If `ProviderSpecificSettings.soniox.test.tsx` asserts that the managed twin renders no custom voices, that assertion is now wrong on purpose — update it to assert the managed section receives a non-null `source`, and say so in the commit message.

- [ ] **Step 9: Full suite, then commit**

```bash
npm test -- --run 2>&1 | tail -6
git add -A src/components/Settings/sections src/services/clients src/lib/soniox
git commit -m "feat(soniox): manage the account's cached voice from settings"
```

---

### Task 5: Prepare the voice when a session starts

**Files:**
- Create: `src/components/MainPanel/prepareManagedVoice.ts`
- Create: `src/components/MainPanel/prepareManagedVoice.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx`

**Interfaces:**
- Consumes: `ManagedVoicesClient` (Task 2), `loadVoiceClip` (Task 1).
- Produces:
  ```ts
  type VoicePrepFailure = 'clip_required' | 'pool_exhausted' | 'voice_failed' | 'unavailable';
  type VoicePrepResult = { ok: true; voiceId: string } | { ok: false; reason: VoicePrepFailure };
  function prepareManagedVoice(deps: {
    client: ManagedVoicesClient;
    loadClip: () => Promise<Blob | null>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<VoicePrepResult>;
  function voicePrepNotice(reason: VoicePrepFailure): { key: string; defaultValue: string };
  ```

**Why this lives outside the component:** `connectConversation` is ~560 lines inside a `useCallback`. Anything added there is untestable without standing up the whole panel. A free function with injected clock, sleep, and client is testable in milliseconds — and this routine has six branches worth testing.

**Why it must not go into `computeStartGate`:** that function is pure and is called by the subtitle window, a sibling React tree. An async, uploading, ten-second side effect inside it would destroy the property that lets both surfaces derive the same answer from the same inputs.

- [ ] **Step 1: Write the failing test**

Create `src/components/MainPanel/prepareManagedVoice.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { prepareManagedVoice, voicePrepNotice } from './prepareManagedVoice';
import { SonioxVoicesError } from '../../services/clients/SonioxVoicesClient';
import type { ManagedVoicesClient } from '../../services/clients/ManagedVoicesClient';

const clip = () => new Blob([new Uint8Array([1])], { type: 'audio/wav' });

const deps = (over: {
  ensure?: unknown;
  mine?: unknown;
  loadClip?: () => Promise<Blob | null>;
} = {}) => ({
  client: {
    ensure: over.ensure ?? vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'ready' }),
    mine: over.mine ?? vi.fn(),
    remove: vi.fn(),
  } as unknown as ManagedVoicesClient,
  loadClip: over.loadClip ?? (async () => clip()),
  sleep: async () => {},
  pollIntervalMs: 0,
});

describe('prepareManagedVoice', () => {
  it('takes the warm path without uploading anything', async () => {
    // The whole point of a warm cache entry: no 10 MB upload, no ten-second
    // wait, session starts immediately.
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v1', status: 'ready' });
    const loadClip = vi.fn();
    const res = await prepareManagedVoice(deps({ ensure, loadClip }));
    expect(res).toEqual({ ok: true, voiceId: 'v1' });
    expect(ensure).toHaveBeenCalledWith({ pin: true, clip: undefined });
    expect(loadClip).not.toHaveBeenCalled();
  });

  it('uploads the local clip only when the backend asks for one', async () => {
    const ensure = vi.fn()
      .mockRejectedValueOnce(new SonioxVoicesError('clip_required', 'need clip', 409))
      .mockResolvedValueOnce({ voiceId: 'v2', status: 'ready' });
    const res = await prepareManagedVoice(deps({ ensure }));
    expect(res).toEqual({ ok: true, voiceId: 'v2' });
    expect(ensure).toHaveBeenNthCalledWith(2, { pin: true, clip: expect.any(Blob) });
  });

  it('gives up gracefully when this device has never recorded a clip', async () => {
    // Warm slots follow the user anywhere they sign in; a COLD slot on a
    // clip-less device cannot be rebuilt, and that is a documented limitation
    // rather than an error to retry.
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('clip_required', 'need clip', 409));
    const res = await prepareManagedVoice(deps({ ensure, loadClip: async () => null }));
    expect(res).toEqual({ ok: false, reason: 'clip_required' });
  });

  it('polls until the build reports ready', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v3', status: 'processing' });
    const mine = vi.fn()
      .mockResolvedValueOnce({ voiceId: 'v3', status: 'processing', createdAt: 1 })
      .mockResolvedValueOnce({ voiceId: 'v3', status: 'ready', createdAt: 1 });
    expect(await prepareManagedVoice(deps({ ensure, mine }))).toEqual({ ok: true, voiceId: 'v3' });
  });

  it('retries a pool_exhausted refusal exactly once, on the server\'s hint', async () => {
    // The backend pokes its reconciler before refusing, so a pin held by a
    // dead session may well be freed by the time the hint elapses. Retrying
    // forever, though, would just hold Start open while nothing improves.
    const ensure = vi.fn()
      .mockRejectedValueOnce(new SonioxVoicesError('pool_exhausted', 'busy', 409, 3000))
      .mockResolvedValueOnce({ voiceId: 'v4', status: 'ready' });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await prepareManagedVoice({ ...deps({ ensure }), sleep });
    expect(res).toEqual({ ok: true, voiceId: 'v4' });
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('reports pool_exhausted when the retry is refused too', async () => {
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('pool_exhausted', 'busy', 409, 1));
    expect(await prepareManagedVoice(deps({ ensure }))).toEqual({ ok: false, reason: 'pool_exhausted' });
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('reports voice_failed on a terminal build failure', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v5', status: 'processing' });
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v5', status: 'failed', createdAt: 1 });
    expect(await prepareManagedVoice(deps({ ensure, mine }))).toEqual({ ok: false, reason: 'voice_failed' });
  });

  it('reports unavailable rather than throwing into session start', async () => {
    // Whatever goes wrong here, the session itself is still perfectly
    // startable with a built-in voice. Throwing would abort the whole start.
    const ensure = vi.fn().mockRejectedValue(new SonioxVoicesError('network', 'offline', 0));
    expect(await prepareManagedVoice(deps({ ensure }))).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('stops polling at the deadline', async () => {
    const ensure = vi.fn().mockResolvedValue({ voiceId: 'v6', status: 'processing' });
    const mine = vi.fn().mockResolvedValue({ voiceId: 'v6', status: 'processing', createdAt: 1 });
    const res = await prepareManagedVoice({ ...deps({ ensure, mine }), timeoutMs: 0 });
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('voicePrepNotice', () => {
  it('gives every failure its own actionable sentence', () => {
    const reasons = ['clip_required', 'pool_exhausted', 'voice_failed', 'unavailable'] as const;
    const notices = reasons.map((r) => voicePrepNotice(r));
    // Distinct copy per reason: "your custom voice didn't work" tells the user
    // nothing they can act on, and three of these four have different fixes.
    expect(new Set(notices.map((n) => n.key)).size).toBe(4);
    for (const n of notices) expect(n.defaultValue.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/components/MainPanel/prepareManagedVoice.test.ts
```

Expected: FAIL — `Failed to resolve import "./prepareManagedVoice"`.

- [ ] **Step 3: Implement**

Create `src/components/MainPanel/prepareManagedVoice.ts`:

```ts
/**
 * Make the account's managed custom voice usable, right before a session
 * starts.
 *
 * The backend runs Soniox's voice quota as an LRU cache, so a voice the user
 * selected days ago may have been evicted since. This routine claims the slot
 * (pinning it against eviction for the start window), rebuilds from this
 * device's stored clip if the cache entry is gone, and waits for the build.
 *
 * It NEVER throws. Every failure resolves to a reason, because the session is
 * still perfectly startable with a built-in voice — losing spoken output in
 * the user's own voice is a degradation, not a reason to refuse to translate.
 * The caller falls back for that session only and explains why afterwards; the
 * stored preference is left alone so the next session tries again.
 *
 * Deliberately outside MainPanel: `connectConversation` is a ~560-line
 * useCallback, and this routine has six branches worth testing. Deliberately
 * NOT inside `computeStartGate` either — that function is pure and is
 * evaluated by the subtitle window too, so an uploading ten-second side effect
 * there would break the property that lets both surfaces agree.
 */
import type { ManagedVoicesClient } from '../../services/clients/ManagedVoicesClient';
import { SonioxVoicesError } from '../../services/clients/SonioxVoicesClient';

export type VoicePrepFailure = 'clip_required' | 'pool_exhausted' | 'voice_failed' | 'unavailable';

export type VoicePrepResult =
  | { ok: true; voiceId: string }
  | { ok: false; reason: VoicePrepFailure };

export interface PrepareManagedVoiceDeps {
  client: ManagedVoicesClient;
  loadClip: () => Promise<Blob | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Ceiling for the whole build wait. A cold build is ~10 s; this is the
   *  point at which we stop holding Start open and fall back. */
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_RETRY_MS = 3000;

export async function prepareManagedVoice(deps: PrepareManagedVoiceDeps): Promise<VoicePrepResult> {
  const {
    client,
    loadClip,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    timeoutMs = 60_000,
    pollIntervalMs = 1500,
  } = deps;

  const deadline = now() + timeoutMs;

  try {
    // Warm-path first, deliberately without the clip: a cached voice needs no
    // upload at all, and the clip can be 10 MB.
    let ensured = await ensureOnce(undefined);
    if (!ensured.ok) return ensured;

    if (ensured.value.status === 'ready') return { ok: true, voiceId: ensured.value.voiceId };

    for (;;) {
      if (now() >= deadline) return { ok: false, reason: 'unavailable' };
      await sleep(pollIntervalMs);
      const voice = await client.mine();
      // A vanished row means another device superseded this build or the LRU
      // evicted it. Rebuilding here would race the same way again.
      if (!voice) return { ok: false, reason: 'voice_failed' };
      if (voice.status === 'ready') return { ok: true, voiceId: voice.voiceId };
      if (voice.status === 'failed') return { ok: false, reason: 'voice_failed' };
    }
  } catch (error) {
    console.error('[Sokuji] [prepareManagedVoice] Unexpected failure:', error);
    return { ok: false, reason: 'unavailable' };
  }

  /** One `ensure`, with the two refusals that have a next move: `clip_required`
   *  (upload this device's clip) and `pool_exhausted` (wait out the backend's
   *  own hint, once). Both are attempted at most once, so Start is never held
   *  open by a loop that cannot make progress. */
  async function ensureOnce(
    clip: Blob | undefined,
    opts: { retriedPool?: boolean; retriedClip?: boolean } = {}
  ): Promise<{ ok: true; value: { voiceId: string; status: 'ready' | 'processing' } } | { ok: false; reason: VoicePrepFailure }> {
    try {
      // pin: true — this slot must survive until the session's own lease takes
      // over the pin at session-started.
      const value = await client.ensure({ pin: true, clip });
      return { ok: true, value };
    } catch (error) {
      if (!(error instanceof SonioxVoicesError)) {
        console.error('[Sokuji] [prepareManagedVoice] ensure failed:', error);
        return { ok: false, reason: 'unavailable' };
      }
      if (error.errorType === 'clip_required' && !opts.retriedClip) {
        const stored = await loadClip();
        // No clip here means this device has never recorded one. Warm slots
        // follow the user anywhere; a cold slot cannot, by design.
        if (!stored) return { ok: false, reason: 'clip_required' };
        return ensureOnce(stored, { ...opts, retriedClip: true });
      }
      if (error.errorType === 'pool_exhausted' && !opts.retriedPool) {
        await sleep(error.retryAfterMs ?? DEFAULT_RETRY_MS);
        return ensureOnce(clip, { ...opts, retriedPool: true });
      }
      if (error.errorType === 'pool_exhausted') return { ok: false, reason: 'pool_exhausted' };
      if (error.errorType === 'clip_required') return { ok: false, reason: 'clip_required' };
      return { ok: false, reason: 'unavailable' };
    }
  }
}

/** The sentence to show once the session is up. Separate from the routine so
 *  the routine stays free of i18n, and so the copy can be reviewed as copy. */
export function voicePrepNotice(reason: VoicePrepFailure): { key: string; defaultValue: string } {
  switch (reason) {
    case 'clip_required':
      return {
        key: 'mainPanel.sonioxVoiceClipMissing',
        defaultValue: 'This device has no voice recording, so this session uses a built-in voice. Record one in Settings to speak in your own voice here.',
      };
    case 'pool_exhausted':
      return {
        key: 'mainPanel.sonioxVoicePoolBusy',
        defaultValue: 'All custom voice slots are in use right now, so this session uses a built-in voice. Your own voice will be used again next time.',
      };
    case 'voice_failed':
      return {
        key: 'mainPanel.sonioxVoiceBuildFailed',
        defaultValue: 'Your custom voice could not be built, so this session uses a built-in voice. Try recording a clearer clip in Settings.',
      };
    case 'unavailable':
    default:
      return {
        key: 'mainPanel.sonioxVoiceUnavailable',
        defaultValue: 'Your custom voice is unavailable right now, so this session uses a built-in voice.',
      };
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run src/components/MainPanel/prepareManagedVoice.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Wire it into `connectConversation`**

In `src/components/MainPanel/MainPanel.tsx`:

Add the imports:

```ts
import { prepareManagedVoice, voicePrepNotice } from './prepareManagedVoice';
import { ManagedVoicesClient } from '../../services/clients/ManagedVoicesClient';
import { loadVoiceClip } from '../../lib/soniox/voiceClipStorage';
import { SonioxProviderConfig } from '../../services/providers/SonioxProviderConfig';
```

Add near the other `useState` declarations (beside `initProgress` at line ~250):

```ts
  // Distinct from initProgress: preparing a cloned voice can take ~10s of
  // uploading and building, and "Loading (1/3)…" would be a lie about what
  // the user is waiting for. Mirrors the nativeAsrLoading label swap.
  const [voicePreparing, setVoicePreparing] = useState(false);
```

Add a module-level constant beside the other module constants at the top of the file:

```ts
/** Soniox's built-in voice names. A `settings.voice` outside this set is a
 *  cloned-voice UUID, which is the only case that needs preparing. */
const SONIOX_BUILTIN_VOICES = new Set(
  new SonioxProviderConfig().getConfig().voices.map((v) => v.value)
);
const SONIOX_DEFAULT_VOICE = 'Maya';
```

Inside `connectConversation`, immediately after the no-channel guard (the `if (!speakerWillStart && !participantWillStart)` block ending at line ~1755) and before `const sessionMode = useAudioStore.getState().mode;`, insert:

```ts
      // Managed cloned voices are cache entries, not registrations: the one
      // selected days ago may have been evicted since. Claim (and if needed
      // rebuild) it now, before any client exists — the backend pins the slot
      // for a short start window, which session-started then extends to the
      // session's own expiry.
      //
      // Only the speaker channel speaks: createParticipantSessionConfig is
      // text-only, so a participant-only session has no voice to prepare.
      let preparedVoiceId: string | null = null;
      let voicePrepMessage: string | null = null;
      const sonioxVoiceSetting = (useSettingsStore.getState()[
        ProviderConfigFactory.getDescriptor(provider).settingsSliceKey as keyof SettingsStore
      ] as { voice?: string })?.voice;
      if (
        speakerWillStart &&
        !textOnly &&
        (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX &&
        isKizunaManagedProvider(provider) &&
        sonioxVoiceSetting &&
        !SONIOX_BUILTIN_VOICES.has(sonioxVoiceSetting)
      ) {
        setVoicePreparing(true);
        try {
          const result = await prepareManagedVoice({
            client: new ManagedVoicesClient(getAuthToken),
            loadClip: loadVoiceClip,
          });
          if (result.ok) {
            preparedVoiceId = result.voiceId;
            // A rebuilt voice comes back with a DIFFERENT Soniox UUID, so
            // every ensure response is authoritative. Writing it through here
            // is what keeps the settings dropdown pointing at a voice that
            // actually exists.
            if (result.voiceId !== sonioxVoiceSetting) {
              useSettingsStore.getState().updateKizunaSoniox({ voice: result.voiceId });
            }
          } else {
            const notice = voicePrepNotice(result.reason);
            voicePrepMessage = t(notice.key, notice.defaultValue);
          }
        } finally {
          setVoicePreparing(false);
        }
      }
```

Right after `const sessionConfig = getSessionConfig();` (line ~1842), add:

```ts
        // Same shape as the `bidirectional` override below: sessionConfig is a
        // plain object built for this connect() alone. The fallback is applied
        // to THIS SESSION only and never written back to settings — a busy
        // pool tonight must not silently demote the user's voice preference
        // forever.
        if (preparedVoiceId) {
          (sessionConfig as SonioxSessionConfig).voice = preparedVoiceId;
        } else if (voicePrepMessage) {
          (sessionConfig as SonioxSessionConfig).voice = SONIOX_DEFAULT_VOICE;
        }
```

Right after the `participantErrorMessage` append block (line ~2205-2214), add:

```ts
      // Appended after the setItems overwrite above for the same reason as
      // participantErrorMessage: setItems(getConversationItems()) would wipe
      // anything appended earlier in this function.
      if (voicePrepMessage) {
        setItems(prevItems => [...prevItems, {
          id: `voice-prep-${Date.now()}`,
          role: 'system',
          // `error` is what every system notice in this codebase uses,
          // including SonioxClient's own emitSystemNotice — it is the only
          // system-item type the bubble renderer and subtitleIdleState both
          // understand. A friendlier-sounding type nobody renders would be a
          // notice the user never sees.
          type: 'error',
          status: 'completed',
          createdAt: Date.now(),
          formatted: { text: voicePrepMessage },
        }]);
      }
```

Finally, swap the Start-button labels. In the simple panel (line ~3676):

```tsx
                      {voicePreparing
                        ? t('simplePanel.preparingVoice', 'Preparing your voice…')
                        : initProgress
                          ? t('simplePanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: initProgress.completed, total: initProgress.total })
                          : nativeAsrLoading
                            ? t('simplePanel.loadingModel', 'Loading model…')
                            : t('simplePanel.connecting', 'Connecting...')}
```

and in the advanced panel (line ~3802):

```tsx
                      {voicePreparing
                        ? t('mainPanel.preparingVoice', 'Preparing your voice…')
                        : initProgress
                          ? t('mainPanel.initProgress', 'Loading ({{completed}}/{{total}})...', { completed: initProgress.completed, total: initProgress.total })
                          : t('mainPanel.initializing')}
```

Then extend `connectConversation`'s dependency array (line ~2265) with `getAuthToken`, `textOnly`, and `t` if they are not already listed. `getAuthToken` especially: it closes over the Better Auth session, and a stale copy would mint the voice request with a token from a previous sign-in — a 401 that looks like an outage. `textOnly` is already in scope from `useTextOnly()` at line 362.

- [ ] **Step 6: Run the MainPanel tests and the full suite**

```bash
npx vitest run src/components/MainPanel/
npm test -- --run 2>&1 | tail -6
```

Expected: PASS at the Task 1 baseline plus this task's new tests. `MainPanel` has substantial existing coverage — if a test breaks, the prepare block is running when it should be skipped (check the `isKizunaManagedProvider` and built-in-voice guards first).

- [ ] **Step 7: Commit**

```bash
git add src/components/MainPanel/prepareManagedVoice.ts \
        src/components/MainPanel/prepareManagedVoice.test.ts \
        src/components/MainPanel/MainPanel.tsx
git commit -m "feat(soniox): prepare the managed custom voice before a session starts"
```

---

### Task 6: Locale keys across all 31 catalogs

**Files:**
- Modify: `src/locales/en/translation.json` and all 30 sibling catalogs
- Test: `src/locales/locales.consistency.test.ts` (existing — it is the gate, do not edit it)

**Interfaces:**
- Consumes: the `t('key', 'default')` calls added in Tasks 3–5.
- Produces: nothing importable; this task makes the suite green and the UI translated.

The twelve keys, with their English text (copy these verbatim — the `t(key, default)` defaults written in Tasks 3–5 must match these exactly, or the app shows one string and the catalogs another):

| Key | English |
|---|---|
| `settings.sonioxManagedVoiceName` | `My voice` |
| `settings.sonioxManagedVoiceListError` | `Could not load your voice — check your connection and try again.` |
| `settings.sonioxManagedCloneNotice` | `This recording is sent to Kizuna AI and passed on to Soniox to build your voice. It is not stored on our servers — it stays on this device so your voice can be rebuilt later.` |
| `settings.sonioxVoicePoolExhausted` | `All custom voice slots are in use right now — please try again in a moment.` |
| `settings.sonioxVoicePinned` | `This voice is in use by a running session — end the session before deleting it.` |
| `settings.sonioxVoiceInsufficientBalance` | `Add balance to your account before building a custom voice.` |
| `mainPanel.sonioxVoiceClipMissing` | `This device has no voice recording, so this session uses a built-in voice. Record one in Settings to speak in your own voice here.` |
| `mainPanel.sonioxVoicePoolBusy` | `All custom voice slots are in use right now, so this session uses a built-in voice. Your own voice will be used again next time.` |
| `mainPanel.sonioxVoiceBuildFailed` | `Your custom voice could not be built, so this session uses a built-in voice. Try recording a clearer clip in Settings.` |
| `mainPanel.sonioxVoiceUnavailable` | `Your custom voice is unavailable right now, so this session uses a built-in voice.` |
| `simplePanel.preparingVoice` | `Preparing your voice…` |
| `mainPanel.preparingVoice` | `Preparing your voice…` |

- [ ] **Step 1: Confirm the table matches what Tasks 3–5 actually wrote**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
grep -rho "t(\s*'[a-zA-Z]*\.[a-zA-Z]*'" \
  src/components/Settings/sections/SonioxVoiceSection.tsx \
  src/components/Settings/sections/SonioxCloneConfirmModal.tsx \
  src/components/MainPanel/prepareManagedVoice.ts \
  src/components/MainPanel/MainPanel.tsx \
  | sed "s/.*'\(.*\)'/\1/" | sort -u \
  | node -e "
const en = require('./src/locales/en/translation.json');
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flat(v, p ? p + '.' + k : k) : [p ? p + '.' + k : k]);
const have = new Set(flat(en));
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  input.split('\n').filter(Boolean).forEach((k) => { if (!have.has(k)) console.log('MISSING', k); });
});"
```

Every `MISSING` line is this task's work. If it names a key absent from the table above, the implementer renamed something — add it here rather than inventing a translation for a key nobody will look up.

- [ ] **Step 2: Add them to English first**

Insert each key into `src/locales/en/translation.json` under its existing top-level section (`settings`, `mainPanel`, `simplePanel`), keeping the file's alphabetical-within-section ordering if it has one.

- [ ] **Step 3: Watch the parity test fail for all 30 other catalogs**

```bash
npx vitest run src/locales/locales.consistency.test.ts
```

Expected: FAIL — 30 failures, each naming the keys that catalog is missing. This is the gate proving the next step is necessary.

- [ ] **Step 4: Translate into all 30 catalogs**

For each of `ar bn de es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_CN zh_TW`, add every key with a real translation into that language — not the English string copied over.

Two rules the parity test enforces, and one it cannot:
- **Placeholders must survive verbatim.** None of these twelve strings has one, so none may gain one.
- **No empty strings.**
- (Unenforced but required) **`—` em dashes and `…` ellipses are part of the copy.** Match the punctuation conventions each catalog already uses for its neighbours — several already localize the em dash.

Match tone with the surrounding keys in each file: these are terse, non-alarming status sentences, not error shouting.

- [ ] **Step 5: Run the parity test until it passes**

```bash
npx vitest run src/locales/locales.consistency.test.ts
```

Expected: PASS, all 30 catalogs.

- [ ] **Step 6: Full suite**

```bash
npm test -- --run 2>&1 | tail -6
```

Expected: the Task 1 baseline plus every test added by Tasks 1–5, all passing, **0 skipped**.

- [ ] **Step 7: Commit**

```bash
git add src/locales
git commit -m "i18n(soniox): translate the managed custom voice copy"
```

---

## Manual verification before calling this done

Automated tests cover the logic; these three cover what only a real run can show. Run against a signed-in account with a funded wallet, provider = KizunaAI Soniox.

1. **Cold build.** Delete any existing voice, record a clip in Settings, confirm the modal shows the managed privacy notice and no name field, and watch the entry go `processing…` → selectable. Then Start a session and confirm spoken output is in the cloned voice.
2. **Warm reuse.** End the session, Start again. It should NOT re-upload — the button goes straight past "Preparing your voice…" and the session starts at normal speed. (Watch the network panel: exactly one small `POST /ensure`, no multipart body.)
3. **Rebuild after eviction.** Delete the voice at the backend out of band (or wait for an eviction), then Start. The button should show "Preparing your voice…" for ~10 s, the session should start in the cloned voice, and the settings dropdown should still show a selected custom voice — with a *different* UUID underneath.

Also confirm the BYOK Soniox path is untouched: paste a Soniox key, list/record/preview/delete a clone. Task 3 is the edit that could have broken it.

## Known gaps this plan deliberately leaves

- **No pre-warming at selection time.** Choosing the voice in Settings does not claim a slot, so the first session after an eviction pays the ~10 s build. Pre-warming would hold a scarce slot for a session that may never start.
- **No cross-device clip sync.** By design: the clip never reaches our servers.
- **`session-end` unpinning is account-scoped, not lease-scoped.** The client already holds the `leaseId`; sending it and scoping the unpin is a backend-side follow-up recorded in the design doc's known limitations.
- **A `pool_exhausted` fallback is silent until the session is up.** The notice cannot be appended earlier because `connectConversation` resets the rendered item list; that is the trap PR #383 documented.
