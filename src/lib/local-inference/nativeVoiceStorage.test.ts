import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { addNativeVoice, listNativeVoices, getNativeVoice, renameNativeVoice, deleteNativeVoice, resetNativeVoiceStorageForTesting } from './nativeVoiceStorage';

beforeEach(async () => { await resetNativeVoiceStorageForTesting(); });

it('add then list returns the voice with audio + sampleRate', async () => {
  const v = await addNativeVoice('My Voice', new Float32Array([0.1, -0.2, 0.3]), 16000);
  const all = await listNativeVoices();
  expect(all.map((x) => x.name)).toEqual(['My Voice']);
  const got = await getNativeVoice(v.id);
  expect(got!.sampleRate).toBe(16000);
  expect(new Float32Array(got!.audio).length).toBe(3);
});
it('uniquifies duplicate names', async () => {
  await addNativeVoice('V', new Float32Array([0]), 16000);
  const b = await addNativeVoice('V', new Float32Array([0]), 16000);
  expect(b.name).not.toBe('V');
});
it('rename and delete work', async () => {
  const v = await addNativeVoice('A', new Float32Array([0]), 16000);
  await renameNativeVoice(v.id, 'B');
  expect((await getNativeVoice(v.id))!.name).toBe('B');
  await deleteNativeVoice(v.id);
  expect(await getNativeVoice(v.id)).toBeUndefined();
});

it('migrates legacy voices out of the shared models DB on first open', async () => {
  const { vi } = await import('vitest');
  const { openDB } = await import('idb');
  const { IDBFactory } = await import('fake-indexeddb');
  // Fresh IDB universe + fresh module (module-level dbPromise cache)
  globalThis.indexedDB = new IDBFactory();
  // Seed the legacy shared DB (v3 schema with a native_voices store + 1 record)
  const legacy = await openDB('sokuji-models', 3, {
    upgrade(db) {
      db.createObjectStore('files');
      db.createObjectStore('metadata');
      db.createObjectStore('voice_styles', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('native_voices', { keyPath: 'id', autoIncrement: true });
    },
  });
  await legacy.add('native_voices', {
    name: 'Legacy Voice', audio: new ArrayBuffer(4), sampleRate: 16000, createdAt: 1,
  });
  legacy.close();

  vi.resetModules();
  const fresh = await import('./nativeVoiceStorage');
  const voices = await fresh.listNativeVoices();
  expect(voices.map(v => v.name)).toEqual(['Legacy Voice']);

  // Legacy store was drained (no double-import on next open)
  const check = await openDB('sokuji-models');
  expect(await check.count('native_voices')).toBe(0);
  check.close();
});
