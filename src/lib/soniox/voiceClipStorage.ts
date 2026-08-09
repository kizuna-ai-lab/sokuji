/**
 * voiceClipStorage — the single reference recording a managed Soniox voice is
 * built from, held on THIS device and nowhere else.
 *
 * Its own database ('sokuji-voice-clip'), deliberately not a new store inside
 * the shared 'sokuji-models' DB: raising that database's version makes it
 * unopenable for any older build sharing the browser profile, which has
 * already blanked this project's Models UI once. See
 * src/lib/local-inference/nativeVoiceStorage.ts for the same call. This
 * database is new on this branch and nothing else opens it, so versioning it
 * is safe here in a way versioning 'sokuji-models' is not.
 *
 * One record, key 'me' — but the record NAMES ITS OWNING ACCOUNT, and is only
 * ever handed back to that account. A device is shared; an account is not.
 * Without the owner check, user A's recording would be read on the session
 * path of whoever signed in next and uploaded under THEIR account: A's
 * biometric material reaching Soniox without A's consent, and B speaking in
 * A's voice. The one-record shape is kept on purpose — a device holding
 * several users' recordings is a worse privacy position, not a better one, so
 * a save by anyone REPLACES whatever was there. That also keeps the original
 * invariant intact: a managed account owns exactly one voice, so a second
 * recording replaces the first rather than accumulating.
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
/** v2 added `accountId` to the record. */
const DB_VERSION = 2;
const STORE = 'clip';
const KEY = 'me';

interface StoredClip {
  /** Better Auth account id this recording belongs to. Any other account
   *  reads it as "no clip on this device". */
  accountId: string;
  bytes: ArrayBuffer;
  type: string;
  createdAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
          return;
        }
        if (oldVersion < 2) {
          // A v1 record carries no owner, so it can never be matched to an
          // account — and leaving an unattributable biometric recording
          // readable on a shared device is precisely the failure this
          // version exists to close. Drop it; the owner can re-record.
          transaction.objectStore(STORE).delete(KEY);
        }
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

/**
 * Read a Blob as an ArrayBuffer, compatible with both browser and jsdom environments.
 * jsdom's Blob may not implement arrayBuffer(); fall back to FileReader.
 */
function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Replace this device's reference clip, owned by `accountId`. Throws on
 *  failure — the caller is a deliberate user action ("use this recording"),
 *  and silently not saving it would strand the user with a voice they can
 *  never rebuild.
 *
 *  Storing without an owner is refused rather than defaulted: an ownerless
 *  record is readable by every later signed-in user of this device, which is
 *  the exact bug the `accountId` field exists to prevent. */
export async function saveVoiceClip(accountId: string, blob: Blob): Promise<void> {
  if (!accountId) {
    throw new Error('[Sokuji] [voiceClipStorage] Refusing to store a reference clip with no owning account');
  }
  const db = await getDb();
  const record: StoredClip = {
    accountId,
    bytes: await readBlobAsArrayBuffer(blob),
    type: blob.type || 'audio/wav',
    createdAt: Date.now(),
  };
  await db.put(STORE, record, KEY);
}

/** `accountId`'s reference clip on this device, or null if there isn't one —
 *  including when the stored clip belongs to a DIFFERENT account, which reads
 *  exactly like "this device has no clip for you" because for this account it
 *  does not. A missing `accountId` (nobody signed in) is the same answer.
 *
 *  Never throws. This runs on the session-start path, where a private-mode or
 *  quota-blocked IndexedDB must read as "no clip on this device" — an outcome
 *  the caller already handles — rather than as an exception thrown into the
 *  middle of starting a session. */
export async function loadVoiceClip(accountId: string | null | undefined): Promise<Blob | null> {
  try {
    if (!accountId) return null;
    const db = await getDb();
    const record = (await db.get(STORE, KEY)) as StoredClip | undefined;
    if (!record || record.accountId !== accountId) return null;
    return new Blob([record.bytes], { type: record.type });
  } catch (error) {
    console.warn('[Sokuji] [voiceClipStorage] Could not read the stored clip:', error);
    return null;
  }
}

/** Forget this device's clip. Called when the user deletes their voice: a
 *  delete that left the source recording behind would not be a delete.
 *
 *  Deliberately NOT account-scoped, and deliberately THROWS on failure:
 *
 *  - Unscoped. The record is a single slot, so scoping the delete would mean
 *    refusing to remove another account's record — leaving one that nobody
 *    currently signed in can clear. That is not a free choice, and it does
 *    have a downside: since an evicted voice's placeholder became deletable,
 *    there is a concrete path where B, signed in on A's device, deletes A's
 *    stale placeholder and destroys A's recording along with it. The trade is
 *    made knowingly — erring toward removing biometric material rather than
 *    retaining it, and A can re-record — not because no cost exists.
 *  - Throwing, for the same reason `saveVoiceClip` throws. Swallowing the
 *    failure would let the UI report a voice deleted while the recording it
 *    was built from is still sitting on this device — precisely the "left
 *    behind after an explicit delete" outcome this feature's privacy claim
 *    rules out. The caller decides what to say about it. */
export async function clearVoiceClip(): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, KEY);
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
