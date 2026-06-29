/**
 * nativeVoiceStorage — IndexedDB-backed library for user-recorded native voices.
 *
 * Schema (in shared 'sokuji-models' DB, version 3+):
 *   Store 'native_voices':
 *     keyPath: 'id' (auto-increment number)
 *     value: StoredNativeVoice
 *
 * Audio is stored as raw Float32 PCM (ArrayBuffer) + sampleRate.
 */

import { getDb } from './modelStorage';

export interface StoredNativeVoice {
  id: number;
  name: string;
  audio: ArrayBuffer;
  sampleRate: number;
  createdAt: number;
}

const STORE = 'native_voices';

export function uniquifyName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

export async function listNativeVoices(): Promise<StoredNativeVoice[]> {
  const conn = await getDb();
  return ((await conn.getAll(STORE)) ?? []) as StoredNativeVoice[];
}

export async function getNativeVoice(id: number): Promise<StoredNativeVoice | undefined> {
  const conn = await getDb();
  return (await conn.get(STORE, id)) as StoredNativeVoice | undefined;
}

export async function addNativeVoice(
  name: string, audio: Float32Array, sampleRate: number,
): Promise<StoredNativeVoice> {
  const existing = await listNativeVoices();
  const finalName = uniquifyName(name.trim() || 'Voice', existing.map((v) => v.name));
  const buf = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
  const record: Omit<StoredNativeVoice, 'id'> = { name: finalName, audio: buf, sampleRate, createdAt: Date.now() };
  const conn = await getDb();
  const id = (await conn.add(STORE, record)) as number;
  return { id, ...record };
}

export async function renameNativeVoice(id: number, name: string): Promise<void> {
  const conn = await getDb();
  const cur = (await conn.get(STORE, id)) as StoredNativeVoice | undefined;
  if (!cur) throw new Error(`Native voice ${id} not found`);
  await conn.put(STORE, { ...cur, name });
}

export async function deleteNativeVoice(id: number): Promise<void> {
  const conn = await getDb();
  await conn.delete(STORE, id);
}

export async function resetNativeVoiceStorageForTesting(): Promise<void> {
  const conn = await getDb();
  await conn.clear(STORE);
}
