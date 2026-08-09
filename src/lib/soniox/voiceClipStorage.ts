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

/** Replace this device's reference clip. Throws on failure — the caller is a
 *  deliberate user action ("use this recording"), and silently not saving it
 *  would strand the user with a voice they can never rebuild. */
export async function saveVoiceClip(blob: Blob): Promise<void> {
  const db = await getDb();
  const record: StoredClip = {
    bytes: await readBlobAsArrayBuffer(blob),
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
