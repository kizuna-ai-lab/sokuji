/**
 * getDb() forward-compatibility: a newer branch (e.g. native-sidecar) may have
 * upgraded the shared 'sokuji-models' DB to a higher version in the same
 * browser/Electron profile. A versioned openDB(name, 2) against that DB throws
 * VersionError and, before the fix, left the Models section permanently blank.
 * Newer schemas are supersets of ours, so getDb() must retry with an
 * unversioned open and verify the stores it needs actually exist.
 */
import 'fake-indexeddb/auto'; // installs IDBRequest/IDBDatabase/etc. globals idb needs
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';

async function freshModelStorage() {
  const { vi } = await import('vitest');
  vi.resetModules();
  return await import('./modelStorage');
}

function seedDb(version: number, stores: string[]): Promise<void> {
  return openDB('sokuji-models', version, {
    upgrade(db) {
      for (const name of stores) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    },
  }).then(db => db.close());
}

beforeEach(() => {
  // Fresh IndexedDB universe per test; modelStorage's module-level dbPromise
  // cache is reset via resetModules in freshModelStorage().
  globalThis.indexedDB = new IDBFactory();
});

describe('getDb version resilience', () => {
  it('opens a fresh profile at version 2 with the expected stores', async () => {
    const storage = await freshModelStorage();
    const db = await storage.getDb();
    expect(db.version).toBe(2);
    for (const store of ['files', 'metadata', 'voice_styles']) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
  });

  it('falls back to an unversioned open when the DB is a newer superset (v3)', async () => {
    await seedDb(3, ['files', 'metadata', 'voice_styles', 'native_voices']);
    const storage = await freshModelStorage();
    const db = await storage.getDb();
    expect(db.version).toBe(3);
    // Still usable through the normal API (string payload: fake-indexeddb's
    // structured clone does not round-trip jsdom Blobs faithfully)
    await db.put('files', 'payload', 'm/f.bin');
    expect(await db.get('files', 'm/f.bin')).toBe('payload');
  });

  it('rejects when the newer DB is missing a store we require', async () => {
    await seedDb(3, ['files', 'metadata']); // no voice_styles
    const storage = await freshModelStorage();
    await expect(storage.getDb()).rejects.toMatchObject({ name: 'VersionError' });
  });

  it('a failed open is retryable (dbPromise is not a poisoned cache)', async () => {
    await seedDb(3, ['files', 'metadata']); // missing store → first open fails
    const storage = await freshModelStorage();
    await expect(storage.getDb()).rejects.toMatchObject({ name: 'VersionError' });
    // Simulate the situation being fixed (e.g. user cleared the bad DB)
    globalThis.indexedDB = new IDBFactory();
    const db = await storage.getDb();
    expect(db.version).toBe(2);
  });
});
