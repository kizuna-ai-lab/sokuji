/**
 * nativeVoiceStorage — IndexedDB-backed library for user-recorded native voices.
 *
 * Own database: 'sokuji-native-voices', version 1
 *   Store 'voices': keyPath 'id' (auto-increment number) → StoredNativeVoice
 *
 * Deliberately NOT inside the shared 'sokuji-models' DB:
 *   - upgrading the shared DB's version makes it unopenable for older builds
 *     sharing the same profile (IndexedDB forbids versioned opens below the
 *     existing version — this blanked the Models UI on main), and
 *   - voices are user assets, not re-downloadable cache; they must not be
 *     wiped by modelStorage.clearAll() ("Delete all models").
 *
 * A one-time lazy migration moves records out of the legacy shared-DB
 * 'native_voices' store created by earlier dev builds of this branch.
 *
 * Audio is stored as raw Float32 PCM (ArrayBuffer) + sampleRate.
 */

import { openDB, type IDBPDatabase } from 'idb';

export interface StoredNativeVoice {
  id: number;
  name: string;
  audio: ArrayBuffer;
  sampleRate: number;
  createdAt: number;
  /** Optional reference transcript for the clip (used by ASR-conditioned
   *  voice cloning). Absent on voices recorded before this field existed. */
  transcript?: string;
}

const DB_NAME = 'sokuji-native-voices';
const DB_VERSION = 1;
const STORE = 'voices';

/** Legacy location: 'native_voices' store inside the shared models DB (the
 *  short-lived v3 schema of 'sokuji-models' from earlier builds of this branch). */
const LEGACY_DB_NAME = 'sokuji-models';
const LEGACY_STORE = 'native_voices';

let dbPromise: Promise<IDBPDatabase> | null = null;

async function migrateFromLegacyStore(db: IDBPDatabase): Promise<void> {
  try {
    // Never CREATE the legacy DB just to look inside it.
    const existing = await indexedDB.databases?.();
    if (!existing?.some(d => d.name === LEGACY_DB_NAME)) return;

    // Unversioned open: works whatever version the shared DB is at.
    const legacy = await openDB(LEGACY_DB_NAME);
    try {
      if (!legacy.objectStoreNames.contains(LEGACY_STORE)) return;
      const records = (await legacy.getAll(LEGACY_STORE)) as StoredNativeVoice[];
      if (records.length > 0) {
        const tx = db.transaction(STORE, 'readwrite');
        for (const record of records) {
          // Explicit ids on an autoIncrement keyPath are preserved by put().
          await tx.store.put(record);
        }
        await tx.done;
        await legacy.clear(LEGACY_STORE);
        console.info(`[Sokuji] [NativeVoiceStorage] migrated ${records.length} voice(s) out of the shared models DB`);
      }
    } finally {
      legacy.close();
    }
  } catch (err) {
    // Migration is best-effort: a failure must not take down the voice
    // library itself (the legacy records stay put for a later retry).
    console.warn('[Sokuji] [NativeVoiceStorage] legacy voice migration skipped:', err);
  }
}

function getNativeDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(d) {
          if (!d.objectStoreNames.contains(STORE)) {
            d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          }
        },
      });
      await migrateFromLegacyStore(db);
      return db;
    })().catch(err => {
      dbPromise = null; // don't poison the cache; allow retry
      throw err;
    });
  }
  return dbPromise;
}

export function uniquifyName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

export async function listNativeVoices(): Promise<StoredNativeVoice[]> {
  const conn = await getNativeDb();
  return ((await conn.getAll(STORE)) ?? []) as StoredNativeVoice[];
}

export async function getNativeVoice(id: number): Promise<StoredNativeVoice | undefined> {
  const conn = await getNativeDb();
  return (await conn.get(STORE, id)) as StoredNativeVoice | undefined;
}

export async function addNativeVoice(
  name: string, audio: Float32Array, sampleRate: number, transcript?: string,
): Promise<StoredNativeVoice> {
  const existing = await listNativeVoices();
  const finalName = uniquifyName(name.trim() || 'Voice', existing.map((v) => v.name));
  const buf = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
  const record: Omit<StoredNativeVoice, 'id'> = {
    name: finalName, audio: buf, sampleRate, createdAt: Date.now(), ...(transcript ? { transcript } : {}),
  };
  const conn = await getNativeDb();
  const id = (await conn.add(STORE, record)) as number;
  return { id, ...record };
}

export async function renameNativeVoice(id: number, name: string): Promise<void> {
  const conn = await getNativeDb();
  const cur = (await conn.get(STORE, id)) as StoredNativeVoice | undefined;
  if (!cur) throw new Error(`Native voice ${id} not found`);
  await conn.put(STORE, { ...cur, name });
}

export async function deleteNativeVoice(id: number): Promise<void> {
  const conn = await getNativeDb();
  await conn.delete(STORE, id);
}

export async function resetNativeVoiceStorageForTesting(): Promise<void> {
  const conn = await getNativeDb();
  await conn.clear(STORE);
}
